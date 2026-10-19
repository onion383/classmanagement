const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const { db, _current: currentDb } = require('../db');
const dbManager = require('../dbManager/dbManager');
const { moveToTrash, deleteThumb } = require('../albumOps');
// 懒加载：ffmpeg 只为视频封面抓帧时使用，且可能触发按需下载，故不随顶层 require 加载
const { ensureFfmpeg } = require('../services/ffmpeg');
const { now } = require('../utils/sql');

// 服务端缩略图/视频封面生成
// 注：sharp 与 ffmpeg 服务都是重的依赖，改为用到时（genThumb 生成缩略图）才 require，
// 避免随 app.js 顶层 require(album) 一起在启动阶段加载，拖慢后端就绪。
// 缩略图缓存目录：统一放 DATA_DIR/album-thumbs（与数据库同层，随 userData 持久化）。
// 打包后 __dirname 位于只读 asar 内，不能把写入目录建立在 __dirname 下。
const THUMB_DIR = dbManager.thumbsDir;
try { fs.mkdirSync(THUMB_DIR, { recursive: true }); } catch (_) {}

const router = express.Router();

// ======================== 后台扫描任务管理 ========================
// 每个相册一轮扫描是一个 Task：记录进度 + 支持取消。模块级 Map 按 album_id 存当前任务。
const scanTasks = new Map();

const IMG_EXT = /\.(jpg|jpeg|png|gif|webp|bmp)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv|m4v|ogv)$/i;

function mediaTypeOf(fileName) {
  return VIDEO_EXT.test(fileName) ? 'video' : 'image';
}

function contentTypeOf(fileName) {
  const isVideo = VIDEO_EXT.test(fileName);
  const ext = path.extname(fileName).slice(1).toLowerCase() || (isVideo ? 'mp4' : 'jpeg');
  const mime = isVideo ? (ext === 'mkv' ? 'video/x-matroska' : `video/${ext === 'ogv' ? 'ogg' : ext}`) : `image/${ext}`;
  return mime;
}

function dateKey(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- 缩略图 / 视频封面 ----------
// 生成 320px JPEG 小图：图片用 sharp 处理竖拍 EXIF 方向；视频用 ffmpeg 抓第 0.1 秒帧。
// 输出文件名固定为 {photoId}.jpg，写入 THUMB_DIR；成功返回路径，失败返回 ''（网格退回源文件/占位）。

// 缩略图生成共享并发信号量：多个相册可同时扫描，限制同时进行的 sharp/ffmpeg 数量，
// 避免大相册批量扫描瞬间把内存/CPU 打满。
const MAX_CONCURRENT_THUMBS = 2;
let activeThumbs = 0;
const thumbWaiters = [];
function acquireThumbSlot() {
  if (activeThumbs < MAX_CONCURRENT_THUMBS) { activeThumbs++; return Promise.resolve(); }
  return new Promise(res => thumbWaiters.push(res));
}
function releaseThumbSlot() {
  activeThumbs--;
  const next = thumbWaiters.shift();
  if (next) { activeThumbs++; next(); }
}

async function genThumb(photoId, filePath, isVideo) {
  const out = path.join(THUMB_DIR, `${photoId}.jpg`);
  // 用唯一临时文件名落盘再改名：扫描后台生成与前端现场生成可能并发处理同一张照片，
  // 各写一个临时文件再改名为 {id}.jpg，避免同一路径并发写冲突；对调用方返回路径不变。
  const tmp = out + '.' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await acquireThumbSlot();
  try {
    if (isVideo) {
      // 用 LGPL 版 ffmpeg 抓帧（独立二进制命令行调用，不链接进主程序）。
      // 见 services/ffmpeg.js：定位本机/缓存 ffmpeg，缺失时按需下载 LGPL 构建。
      const ffmpegPath = await ensureFfmpeg();
      if (!ffmpegPath) { return ''; }
      await new Promise((resolve, reject) => {
        execFile(ffmpegPath, ['-y', '-ss', '0.1', '-i', filePath, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', tmp],
          err => err ? reject(err) : resolve());
      });
    } else {
      const sharp = require('sharp') // 懒加载原生库：首次生成缩略图时才加载，启动不背 sharp 初始化成本
      await sharp(filePath)
        .rotate() // 处理竖拍 EXIF 方向
        .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(tmp);
    }
    await fsp.rename(tmp, out);
    return out;
  } catch (_) {
    try { await fsp.unlink(tmp); } catch (_) {}
    return '';
  } finally {
    releaseThumbSlot();
  }
}

function thumbOf(photo) {
  const tp = photo.thumb_path;
  return tp && fs.existsSync(tp) ? tp : '';
}

// ---------- 扫描批量提交 ----------
// 相册扫描会写入成千上万行，每条语句默认单次提交在 WAL 模式下 fsync 开销小。
// 累积 N 条后手动提交一次，减少总提交次数。不使用跨 async 边界的 BEGIN/COMMIT，
// 避免 better-sqlite3 同步库在 await 期间被其他请求打断。
function createBatchedTxn(batchSize = 200) {
  let pending = 0;
  return {
    touch() {
      if (++pending >= batchSize) { this.flush(); }
    },
    open() { /* 不使用跨 await 的 BEGIN/COMMIT，WAL 模式单次提交已足够快 */ },
    flush() { pending = 0; },
    abort() { pending = 0; },
  };
}

// ---------- 相册 CRUD ----------

// 相册列表（含照片数、路径），按 sort_order 排序；共用于 GET /api/album 与 /api/dashboard
function readAlbums() {
  return db.prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM album_photos p WHERE p.album_id = a.id) AS photo_count
    FROM albums a ORDER BY a.sort_order ASC, a.id ASC
  `).all();
}

router.get('/', (req, res) => {
  try {
    res.json({ data: readAlbums() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/album 添加相册，并立即启动后台扫描
router.post('/', async (req, res) => {
  try {
    const name = (req.body && req.body.name) || '';
    const folder = (req.body && req.body.folder_path) || '';
    if (!name) return res.status(400).json({ error: '请输入相册名称' });
    if (!folder) return res.status(400).json({ error: '请输入文件夹路径' });
    let stat;
    try {
      stat = await fsp.stat(folder);
    } catch (_) {
      return res.status(400).json({ error: '文件夹不存在或无法访问' });
    }
    if (!stat.isDirectory()) return res.status(400).json({ error: '路径不是文件夹' });

    const result = db.prepare('INSERT INTO albums (name, folder_path, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(name, folder, now(), now());
    const albumId = result.lastInsertRowid;
    // 新相册默认排到最后
    db.prepare('UPDATE albums SET sort_order = ? WHERE id = ?').run(albumId, albumId);
    fullScan(albumId);
    res.json({ id: albumId, message: '相册已添加，正在扫描索引…' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/album/:id/rescan 手动重新扫描（增量/全量）
// 请求体 mode: 'incremental'（默认）或 'full'
router.post('/:id/rescan', (req, res) => {
  try {
    const albumId = Number(req.params.id);
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
    if (!album) return res.status(404).json({ error: '相册不存在' });
    const mode = req.body && req.body.mode === 'full' ? 'full' : 'incremental';
    if (mode === 'full') {
      fullScan(albumId);
    } else {
      incrementalScan(albumId);
    }
    res.json({ message: '已开始' + (mode === 'full' ? '完全更新' : '增量更新') + '照片索引' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/album/:id/stop 停止正在进行的扫描
router.post('/:id/stop', (req, res) => {
  const albumId = Number(req.params.id);
  const task = scanTasks.get(albumId);
  if (task) task.cancelled = true;
  res.json({ message: '已请求停止扫描' });
});

// GET /api/album/:id/status 查询扫描进度
router.get('/:id/status', (req, res) => {
  const albumId = Number(req.params.id);
  const task = scanTasks.get(albumId);
  if (!task) {
    return res.json({ scanning: false, progress: null });
  }
  res.json({
    scanning: !task.cancelled,
    scanned: task.scanned,
    total: task.total,
    canceled: task.cancelled,
  });
});

// PATCH /api/album/:id 修改相册名称/路径
router.patch('/:id', async (req, res) => {
  try {
    const albumId = Number(req.params.id);
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
    if (!album) return res.status(404).json({ error: '相册不存在' });
    const name = (req.body && req.body.name) || album.name;
    const folder = (req.body && req.body.folder_path) || album.folder_path;
    db.prepare('UPDATE albums SET name = ?, folder_path = ?, updated_at = ? WHERE id = ?').run(name, folder, now(), albumId);
    res.json({ message: '相册已更新' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/album/reorder 批量更新相册排序
router.put('/reorder', (req, res) => {
  try {
    const ids = req.body && req.body.ids;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须为数组' });
    const update = db.prepare('UPDATE albums SET sort_order = ? WHERE id = ?');
    ids.forEach((id, i) => update.run(i, id));
    res.json({ message: '排序已更新' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/album/:id 删除相册（仅删除索引，不删除磁盘照片）
router.delete('/:id', async (req, res) => {
  try {
    const albumId = Number(req.params.id);
    // 删除相册时清理其所有照片的缩略图缓存
    const thumbs = db.prepare('SELECT thumb_path FROM album_photos WHERE album_id = ? AND thumb_path != \'\'').all(albumId);
    await Promise.all(thumbs.map(r => fsp.unlink(r.thumb_path).catch(() => {})));
    db.prepare('DELETE FROM album_photos WHERE album_id = ?').run(albumId);
    db.prepare('DELETE FROM albums WHERE id = ?').run(albumId);
    const task = scanTasks.get(albumId);
    if (task) task.cancelled = true;
    res.json({ message: '相册已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 照片浏览 ========================

// GET /api/album/:id/photos 按时间（mtime）倒序分组的照片列表
router.get('/:id/photos', (req, res) => {
  try {
    const albumId = Number(req.params.id);
    const photos = db.prepare(`
      SELECT id, file_path, file_name, file_size, mtime, photo_date
      FROM album_photos WHERE album_id = ? ORDER BY mtime DESC, id DESC
    `).all(albumId);
    for (const p of photos) p.media_type = mediaTypeOf(p.file_name);
    // 按日期分组：date -> [photos]
    const groups = [];
    const byDate = new Map();
    for (const p of photos) {
      const key = p.photo_date || '未分类';
      if (!byDate.has(key)) { byDate.set(key, []); groups.push({ date: key, photos: byDate.get(key) }); }
      byDate.get(key).push(p);
    }
    res.json({ data: groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/album/photo/:photoId/file 读取源文件返回给前端展示（图片/视频）
// 支持 Range 请求：视频进度条拖动、快进、放大查看都需要它
router.get('/photo/:photoId/file', async (req, res) => {
  try {
    const photo = db.prepare('SELECT * FROM album_photos WHERE id = ?').get(Number(req.params.photoId));
    if (!photo) return res.status(404).json({ error: '照片不存在' });
    let stat;
    try {
      stat = await fsp.stat(photo.file_path);
    } catch (_) {
      return res.status(404).json({ error: '源文件已不存在' });
    }
    const total = stat.size;
    const mime = contentTypeOf(photo.file_name);
    const range = req.headers.range;

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(String(range));
      const start = m && m[1] !== '' ? parseInt(m[1], 10) : 0;
      const end = m && m[2] !== '' ? parseInt(m[2], 10) : total - 1;
      const chunkSize = Math.min(end - start + 1, total - start);
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${start + chunkSize - 1}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mime,
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(photo.file_path, { start, end: start + chunkSize - 1 }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(photo.file_path).pipe(res);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/album/photo/:photoId/thumb 返回网格用的缩略图 / 视频封面（320px JPEG）
// 有缩略图则返回缓存小图（长缓存）。
// 没有缩略图（全量扫描进行中、缩略图尚未后台生成完）时：现场用 genThumb 生成一张
// 320px 小图并写库缓存后再返回，绝不回退 pipe 源文件原图。否则网格在扫描中请求的
// 会是一张几 MB 的原图，几十张并发流进前端渲染进程，扫描期间内存会瞬间飙高。
// genThumb 内部自带并发信号量，现场生成不会同时打爆 CPU。生成失败返回 404，前端走占位。
router.get('/photo/:photoId/thumb', async (req, res) => {
  try {
    const photo = db.prepare('SELECT * FROM album_photos WHERE id = ?').get(Number(req.params.photoId));
    if (!photo) return res.status(404).json({ error: '照片不存在' });
    let tp = thumbOf(photo);
    if (!tp) {
      const isVideo = mediaTypeOf(photo.file_name) === 'video';
      tp = await genThumb(photo.id, photo.file_path, isVideo);
      if (tp) db.prepare('UPDATE album_photos SET thumb_path = ? WHERE id = ?').run(tp, photo.id);
    }
    if (!tp) return res.status(404).json({ error: '缩略图生成失败' });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return fs.createReadStream(tp).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/album/photo/:photoId 删除照片（移入应用内可还原回收站）+ 删除索引
router.delete('/photo/:photoId', async (req, res) => {
  try {
    const photo = db.prepare('SELECT * FROM album_photos WHERE id = ?').get(Number(req.params.photoId));
    if (!photo) return res.status(404).json({ error: '照片不存在' });
    // 移入应用内回收站（dataDir/album-trash），可撤销还原，不再直接丢系统回收站/永久删除
    try {
      await moveToTrash(photo);
    } catch (err) {
      return res.status(500).json({ error: '移入回收站失败：' + err.message });
    }
    // 清理已生成的缩略图缓存
    await deleteThumb(photo).catch(() => {});
    db.prepare('DELETE FROM album_photos WHERE id = ?').run(photo.id);
    res.json({ message: '已移入回收站' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/album/photo/:photoId/save-as 另存（下载到浏览器默认下载目录）
router.get('/photo/:photoId/save-as', async (req, res) => {
  try {
    const photo = db.prepare('SELECT * FROM album_photos WHERE id = ?').get(Number(req.params.photoId));
    if (!photo) return res.status(404).json({ error: '照片不存在' });
    let stat;
    try {
      stat = await fsp.stat(photo.file_path);
    } catch (_) {
      return res.status(404).json({ error: '源文件已不存在' });
    }
    // 附带 download 头，触发浏览器「另存为」
    res.setHeader('Content-Type', contentTypeOf(photo.file_name));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(photo.file_name)}`);
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(photo.file_path).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 后台扫描实现 ========================
// 递归读取文件夹及子目录下的所有图片，建立索引。异步渐进式执行，不阻塞其他请求。
// 通过 task.cancelled 支持「停止」：每遍历一批检查标志，被停止则当场终断。

// ---- 全量扫描：清空旧索引后重新扫描（前端会逐步显示新索引的数据） ---- 
async function fullScan(albumId) {
  const album = currentDb().prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
  if (!album) return;
  const prev = scanTasks.get(albumId);
  if (prev) prev.cancelled = true;

  const task = { cancelled: false, scanned: 0, total: 0 };
  scanTasks.set(albumId, task);

  // 在热路径中获取直接连接引用，避免每次 db.prepare 都经过 Proxy 的 get 陷阱检查
  const conn = currentDb();

  // 先清空旧索引，前端会逐步显示新索引的数据
  conn.prepare('DELETE FROM album_photos WHERE album_id = ?').run(albumId);

  const insert = conn.prepare('INSERT OR IGNORE INTO album_photos (album_id, file_path, file_name, file_size, mtime, photo_date) VALUES (?, ?, ?, ?, ?, ?)');
  const setThumb = conn.prepare('UPDATE album_photos SET thumb_path = ? WHERE id = ?');

  // 批量提交标记（WAL 模式下不用显式 BEGIN/COMMIT，仅用于计数）
  const txn = createBatchedTxn();

  // 迭代式目录遍历：用显式栈替代递归，避免深层嵌套时栈溢出
  const stack = [album.folder_path];
  while (stack.length > 0) {
    if (task.cancelled) break;
    const dir = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    task.total += entries.length;
    for (const ent of entries) {
      if (task.cancelled) break;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (IMG_EXT.test(ent.name) || VIDEO_EXT.test(ent.name)) {
        try {
          const st = await fsp.stat(full);
          const mtime = st.mtime.toISOString();
          const ri = insert.run(albumId, full, ent.name, st.size, mtime, dateKey(mtime));
          task.scanned++;
          txn.touch();
          const isVid = VIDEO_EXT.test(ent.name);
          const tp = await genThumb(ri.lastInsertRowid, full, isVid);
          if (tp) { setThumb.run(tp, ri.lastInsertRowid); txn.touch(); }
        } catch (_) {}
      }
    }
  }

  txn.flush();
  conn.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now(), albumId);
  // 即使被取消也清理 map 引用，避免已终止的任务残留 scanTasks（防内存累积）。
  // 仅当仍是当前任务时才删，防止误删后来新开始的扫描。
  const taskNow = scanTasks.get(albumId);
  if (taskNow === task) scanTasks.delete(albumId);
}

// ---- 增量扫描：只扫描变动/新增文件，清理已删除文件 ----
async function incrementalScan(albumId) {
  const album = currentDb().prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
  if (!album) return;
  const prev = scanTasks.get(albumId);
  if (prev) prev.cancelled = true;

  const task = { cancelled: false, scanned: 0, total: 0 };
  scanTasks.set(albumId, task);

  // 在热路径中获取直接连接引用，避免每次 db.prepare 都经过 Proxy 的 get 陷阱检查
  const conn = currentDb();

  const insert = conn.prepare('INSERT OR IGNORE INTO album_photos (album_id, file_path, file_name, file_size, mtime, photo_date) VALUES (?, ?, ?, ?, ?, ?)');
  const updateMeta = conn.prepare('UPDATE album_photos SET file_name = ?, file_size = ?, mtime = ?, photo_date = ? WHERE id = ?');
  const setThumb = conn.prepare('UPDATE album_photos SET thumb_path = ? WHERE id = ?');
  const deletePhoto = conn.prepare('DELETE FROM album_photos WHERE id = ?');

  // 批量提交标记（WAL 模式下不用显式 BEGIN/COMMIT，仅用于计数）
  const txn = createBatchedTxn();

  // 1. 建立现有索引映射：file_path → 记录
  const existing = new Map();
  for (const r of conn.prepare('SELECT id, file_path, file_name, file_size, mtime FROM album_photos WHERE album_id = ?').all(albumId)) {
    existing.set(r.file_path, r);
  }

  const foundPaths = new Set();

  // 迭代式目录遍历：用显式栈替代递归，避免深层嵌套时栈溢出
  const stack = [album.folder_path];
  while (stack.length > 0) {
    if (task.cancelled) break;
    const dir = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    task.total += entries.length;
    for (const ent of entries) {
      if (task.cancelled) break;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (IMG_EXT.test(ent.name) || VIDEO_EXT.test(ent.name)) {
        foundPaths.add(full);
        try {
          const st = await fsp.stat(full);
          const mtime = st.mtime.toISOString();
          const old = existing.get(full);

          if (old) {
            // 文件已存在：检查 mtime 是否变化
            if (old.mtime !== mtime) {
              updateMeta.run(ent.name, st.size, mtime, dateKey(mtime), old.id);
              txn.touch();
              const isVid = VIDEO_EXT.test(ent.name);
              const tp = await genThumb(old.id, full, isVid);
              if (tp) { setThumb.run(tp, old.id); txn.touch(); }
              task.scanned++;
            }
            // mtime 相同则跳过
          } else {
            // 新文件：插入索引 + 生成缩略图
            const ri = insert.run(albumId, full, ent.name, st.size, mtime, dateKey(mtime));
            task.scanned++;
            txn.touch();
            const isVid = VIDEO_EXT.test(ent.name);
            const tp = await genThumb(ri.lastInsertRowid, full, isVid);
            if (tp) { setThumb.run(tp, ri.lastInsertRowid); txn.touch(); }
          }
        } catch (_) {}
      }
    }
  }

  // 2. 清理已删除文件（索引存在但磁盘已不存在）
  for (const [filePath, record] of existing) {
    if (!foundPaths.has(filePath)) {
      const tp = thumbOf(record);
      if (tp) await fsp.unlink(tp).catch(() => {});
      deletePhoto.run(record.id);
      txn.touch();
    }
  }
  txn.flush();

  conn.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now(), albumId);
  // 即使被取消也清理 map 引用，避免已终止的任务残留 scanTasks（防内存累积）。
  // 仅当仍是当前任务时才删，防止误删后来新开始的扫描。
  const taskNow = scanTasks.get(albumId);
  if (taskNow === task) scanTasks.delete(albumId);
}

module.exports = router;
// 供 /api/dashboard 聚合复用（挂在 router 函数对象上，不影响既有路由）
module.exports.readAlbums = readAlbums;

// 供 undo.js「撤销添加相册」调用：取消该相册仍在进行的扫描任务。
router.cancelScan = (albumId) => {
  const task = scanTasks.get(albumId);
  if (task) task.cancelled = true;
};

// 供 undo.js「重做添加相册」调用：重新加入该文件夹，触发增量扫描（空索引会把现有文件当新增逐步索引）。
router.startScan = (albumId) => {
  if (scanTasks.has(albumId)) return;
  incrementalScan(albumId).catch(() => {});
};