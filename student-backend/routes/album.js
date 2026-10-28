const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { db } = require('../db');
const dbManager = require('../dbManager/dbManager');
const { moveToTrash, deleteThumb } = require('../albumOps');
const albumThumbs = require('../albumThumbs');
const { now } = require('../utils/sql');
// 扫描子进程管理器：主进程**不跑扫描**，只负责派活/收报活/转发补图需求。
// 详见本文件末尾「后台扫描：委派给扫描子进程」段与 scanWorker.js 顶部注释。
const scanWorker = require('../scanWorker');

// 缩略图缓存目录：统一放 DATA_DIR/album-thumbs（与数据库同层，随 userData 持久化）。
// 打包后 __dirname 位于只读 asar 内，不能把写入目录建立在 __dirname 下。
const THUMB_DIR = dbManager.thumbsDir;
try { fs.mkdirSync(THUMB_DIR, { recursive: true }); } catch (_) {}

// 缩略图尺寸 / 质量 / 缓存版本
// 尺寸回到 512（曾经提到 1024 是为了排查「模糊」，后来查明是全局遮罩 CSS 在照片上盖了
// backdrop-filter 导致的，与分辨率无关，故恢复 512；单张约 27~35KB）。
// 改尺寸/质量时把 THUMB_VERSION +1：album_photos.thumb_v 记录生成时的版本，
// 旧缩略图会在下次被请求时自动按新参数重建，不需要手动清缓存。
// 本次只把上限从 1024 降回 512、版本不变（3）：已经生成的 1024 图仍然可用且更清晰，
// 不强制重建，只有新照片会按 512 生成。
// 本次 +1（4）：修复 ffmpeg 精简构建（x86asm 被关）导致的视频封面花屏，换用新构建的
// ffmpeg.exe 后重建所有旧视频封面；图片缩略图会顺带重建（sharp 输出不变，只是费一次 CPU）。
// （常量本体已搬到 albumScan.js —— 主进程与扫描子进程共用同一份，改一处即可；
//   本文件仍需要 THUMB_VERSION / genThumb / thumbOf / mediaTypeOf / VIDEO_EXT，
//   以及读表改表的状态函数，都从 albumScan.js 取。）
const {
  THUMB_VERSION,
  VIDEO_EXT,
  mediaTypeOf,
  genThumb,
  thumbOf,
  // 扫描状态（跨进程真源在库表 album_scan_tasks）
  readScanTask,
  readPendingScanTasks,
  persistScanClear,
} = require('../albumScan');

const router = express.Router();

// ---------- 缩略图 / 视频封面 ----------
// 生成 320px JPEG 小图：图片用 sharp 处理竖拍 EXIF 方向；视频用 ffmpeg 抓第 0.1 秒帧。
// 输出文件名固定为 {photoId}.jpg，写入 THUMB_DIR；成功返回路径，失败返回 ''（网格退回源文件/占位）。
// 实际的生成与缓存逻辑在 albumScan.js（genThumb / thumbOf），主进程与扫描子进程共用同一份。

// 按扩展名推断 Content-Type（源文件直传时用：/photo/:id/file 与 /save-as）。
function contentTypeOf(fileName) {
  const isVideo = VIDEO_EXT.test(fileName);
  const ext = path.extname(fileName).slice(1).toLowerCase() || (isVideo ? 'mp4' : 'jpeg');
  const mime = isVideo ? (ext === 'mkv' ? 'video/x-matroska' : `video/${ext === 'ogv' ? 'ogg' : ext}`) : `image/${ext}`;
  return mime;
}

// ---------- 请求路径的缩略图现场生成：配额闸 + 超量转子进程 ----------
//
// 扫描已经搬到子进程（worker.scan.js），主进程不再与扫描抢 CPU/线程池，
// 所以这里的「现场生成」只应服务于「零星几张」的情形——用户正好滚到几张还没出图的格子。
// 超过少量（ON_DEMAND_LIMIT）就整批丢给子进程生成：子进程有独立的 libuv 线程池，
// 生成这些图不会拖慢主进程的其他接口（这正是拆进程换来的收益）。
//
// 配额看的是**全局在途量**（在途 + 已转交子进程待生成），不能只看单次请求：
// 否则前端连续 10 个请求各缺 5 张时，主进程会老老实实生成 50 张，限流等于没有。
const ON_DEMAND_LIMIT = 8;
let onDemandInflight = 0;
// 已转交子进程、正在等它出图的 id（主进程不再重复生成，避免两边同时干同一件事）
//
// 用 Map 而不是 Set：要记「转交时刻」。子进程补图**可能失败**（源文件被删、
// 文件损坏），失败的 id 永远不会出现在子进程回报的 thumbs 列表里 —— 若无过期机制，
// 它会永久留在集合里。而配额闸把 pendingInChild.size 算在内，于是攒够 8 个之后
// 主进程就再也不肯现场生成任何图，所有缩略图请求恒 404（功能被锁死）。
// 故设 TTL：超过 PENDING_TTL_MS 还没出图的 id 视为失败，重新放行。
const PENDING_TTL_MS = 60000;
const pendingInChild = new Map();

// 申请现场生成配额。返回 false 表示本次拒绝（调用方应改为转交子进程 / 返回 404）。
function claimOnDemand(count) {
  const n = Math.max(0, count | 0);
  if (!n) return true;
  // 先清掉过期的僵尸 id，否则它们会把配额闸占死（见 PENDING_TTL_MS 说明）
  sweepPendingInChild();
  if (onDemandInflight + pendingInChild.size + n > ON_DEMAND_LIMIT) return false;
  onDemandInflight += n;
  return true;
}
function releaseOnDemand(count) {
  onDemandInflight = Math.max(0, onDemandInflight - Math.max(0, count | 0));
}

// 把「这些 id 的缩略图还没生成」转交给子进程生成。
//
// 队列只保留 id（不存路径）：路径以库里的 album_photos.file_path 为唯一真源，
// 子进程在库里查 id 对应的行再生成，避免与扫描写入的索引不一致。
// 转交后这些 id 记进 pendingInChild：主进程在子进程出图前不再自己生成，
// 免得两边同时对同一张照片跑 sharp（浪费 CPU，还会互相抢临时文件）。
function deferThumbDemand(slug, ids) {
  if (!ids || !ids.length) return;
  const nowTs = Date.now();
  for (const id of ids) pendingInChild.set(id, nowTs);
  // 兜底上限：极端情况下（子进程一直没出图）队列会一直攒，占内存。
  // 超出后丢最旧的，它们下次被请求时会重新入队。
  while (pendingInChild.size > 2000) {
    pendingInChild.delete(pendingInChild.keys().next().value);
  }
  scanWorker.forwardDemand(slug, ids);
}

// 子进程回报「这批缩略图出好了」→ 从 pendingInChild 移除，主进程下次请求就能直接命中。
function onChildThumbsGenerated(ids) {
  for (const id of ids) pendingInChild.delete(id);
}
scanWorker.onThumbGenerated(onChildThumbsGenerated);

// 清掉「转交后一直没出图」的过期 id（子进程补图失败的漏网之鱼）。
// 不清的话，配额闸会被这些僵尸 id 慢慢占满，最终所有缩略图请求都拿不到图。
function sweepPendingInChild() {
  const nowTs = Date.now();
  for (const [id, ts] of pendingInChild) {
    if (nowTs - ts >= PENDING_TTL_MS) pendingInChild.delete(id);
  }
}


// ---------- 相册 CRUD ----------

// 相册列表（含照片数、路径），按 sort_order 排序；共用于 GET /api/album 与 /api/dashboard
// cover_photo_id：相册卡片的封面取「最新一张图片」的 id（按 mtime 倒序，排除视频），
// 直接在 SQL 里筛出，避免把整个相册的上万行照片取回前端再过滤。
// 视频扩展名需与 mediaTypeOf 的判断保持一致，新增格式这里也要加。
const NOT_VIDEO_SQL = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'ogv']
  .map(ext => `LOWER(p.file_name) NOT LIKE '%.${ext}'`)
  .join(' AND ');

function readAlbums() {
  return db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM album_photos p WHERE p.album_id = a.id) AS photo_count,
      (SELECT p.id FROM album_photos p
        WHERE p.album_id = a.id AND ${NOT_VIDEO_SQL}
        ORDER BY p.mtime DESC, p.id DESC LIMIT 1) AS cover_photo_id
    FROM albums a ORDER BY a.sort_order ASC, a.id ASC
  `).all();
}

// 全局相册统计：按 file_path 去重，避免虚拟相册复制同一份索引时把照片数与体积算重
function readAlbumStats() {
  const row = db.prepare(`
    SELECT COUNT(*) AS photo_count, COALESCE(SUM(file_size), 0) AS total_size
    FROM (SELECT file_path, MAX(file_size) AS file_size FROM album_photos GROUP BY file_path)
  `).get() || {}
  return { photo_count: row.photo_count || 0, total_size: row.total_size || 0 }
}

router.get('/', (req, res) => {
    const data = readAlbums();
  res.json({ data, stats: { ...readAlbumStats(), album_count: data.length } });
});

// POST /api/album 新建相册
// · kind='folder'（默认）：绑定一个磁盘文件夹，递归扫描该文件夹**及其所有子文件夹**里的
//   图片/视频，后台建立索引（2026-10-22 起改为递归，子文件夹不再需要单独建相册）。
// · kind='virtual'（虚拟相册）：不绑定文件夹，从已有相册里挑照片，把这些照片的**索引**复制过来。
//   源相册本身是虚拟相册时，源侧的索引会被移走（一个增加一个减少）；源是文件夹相册时源侧不动
//   （文件夹相册代表磁盘目录内容，不能把里面的照片搬空）。
//   两种情况都不会碰磁盘上的任何文件。
router.post('/', async (req, res) => {
  try {
    const name = (req.body && req.body.name) || '';
    const kind = req.body && req.body.kind === 'virtual' ? 'virtual' : 'folder';
    if (!name) return res.status(400).json({ error: '请输入相册名称' });

    if (kind === 'virtual') {
      const ids = Array.isArray(req.body.photos)
        ? req.body.photos.map(p => Number(p && (p.photo_id ?? p.id ?? p))).filter(Boolean)
        : [];
      if (!ids.length) return res.status(400).json({ error: '请先选择照片' });
      const albumId = createVirtualAlbum(name, ids);
      return res.json({ id: albumId, message: '虚拟相册已创建' });
    }

    const folder = (req.body && req.body.folder_path) || '';
    if (!folder) return res.status(400).json({ error: '请输入文件夹路径' });
    let stat;
    try {
      stat = await fsp.stat(folder);
    } catch (_) {
      return res.status(400).json({ error: '文件夹不存在或无法访问' });
    }
    if (!stat.isDirectory()) return res.status(400).json({ error: '路径不是文件夹' });

    const result = db.prepare("INSERT INTO albums (name, folder_path, kind, created_at, updated_at) VALUES (?, ?, 'folder', ?, ?)")
      .run(name, folder, now(), now());
    const albumId = result.lastInsertRowid;
    // 新相册默认排到最后
    db.prepare('UPDATE albums SET sort_order = ? WHERE id = ?').run(albumId, albumId);
    // 浮动 promise 必须接 catch（扫描体内部已有 try/finally 兜底清理 task）
    dispatchFull(albumId, '');
    res.json({ id: albumId, message: '相册已添加，正在扫描索引…' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/album/merge 合并相册：把选中的多个**虚拟相册**合成一个新虚拟相册
// 文件夹相册代表磁盘目录，不能参与合并（会破坏目录与相册的对应关系）；全程只动索引。
router.post('/merge', (req, res) => {
  try {
    const ids = Array.isArray(req.body && req.body.album_ids)
      ? [...new Set(req.body.album_ids.map(Number).filter(Boolean))]
      : [];
    if (ids.length < 2) return res.status(400).json({ error: '请至少选择两个相册' });

    const getAlbum = db.prepare('SELECT id, name, kind FROM albums WHERE id = ?');
    const sourceAlbums = [];
    for (const id of ids) {
      const album = getAlbum.get(id);
      if (!album) return res.status(404).json({ error: '相册不存在或已被删除' });
      if (album.kind !== 'virtual') return res.status(400).json({ error: `文件夹相册「${album.name}」不能参与合并` });
      sourceAlbums.push(album);
    }

    const name = sourceAlbums.map(a => a.name).join(' + ');
    const getPhotos = db.prepare('SELECT * FROM album_photos WHERE album_id = ?');
    const insertPhoto = db.prepare(`
      INSERT OR IGNORE INTO album_photos (album_id, file_path, file_name, file_size, mtime, photo_date, exif_date, date_src, thumb_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')
    `);
    const deletePhotos = db.prepare('DELETE FROM album_photos WHERE album_id = ?');
    const deleteAlbum = db.prepare('DELETE FROM albums WHERE id = ?');

    // 事务内一次性完成：建新相册 → 复制照片索引（按 file_path 去重）→ 删源相册及其索引
    const run = db.transaction(() => {
      const r = db.prepare("INSERT INTO albums (name, folder_path, kind, created_at, updated_at) VALUES (?, '', 'virtual', ?, ?)")
        .run(name, now(), now());
      const newId = r.lastInsertRowid;
      db.prepare('UPDATE albums SET sort_order = ? WHERE id = ?').run(newId, newId);

      const thumbs = [];
      for (const album of sourceAlbums) {
        for (const p of getPhotos.all(album.id)) {
          insertPhoto.run(newId, p.file_path, p.file_name, p.file_size || 0, p.mtime || '', p.photo_date || '', p.exif_date || '', p.date_src || '');
          if (p.thumb_path) thumbs.push(p.thumb_path);
        }
        deletePhotos.run(album.id);
        deleteAlbum.run(album.id);
      }
      return { newId, thumbs };
    });

    const { newId, thumbs } = run();
    // 源索引已删除，其缩略图缓存不再被引用，顺手清理（失败无所谓）
    for (const tp of thumbs) fsp.unlink(tp).catch(() => {});
    res.json({ id: newId, message: `已合并 ${sourceAlbums.length} 个相册` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 创建虚拟相册：把选中的照片索引复制到新相册；源相册是虚拟相册时再把源行删掉（移动索引）。
// 全程只操作 album_photos 索引表，不移动/删除磁盘上的图片文件。
function createVirtualAlbum(name, photoIds) {
  const getPhoto = db.prepare('SELECT * FROM album_photos WHERE id = ?');
  const getAlbum = db.prepare('SELECT id, kind FROM albums WHERE id = ?');
  const insertPhoto = db.prepare(`
    INSERT OR IGNORE INTO album_photos (album_id, file_path, file_name, file_size, mtime, photo_date, exif_date, date_src, thumb_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')
  `);
  const deletePhoto = db.prepare('DELETE FROM album_photos WHERE id = ?');
  const movedThumbs = [];   // 源行被移走后没人引用的缩略图（按 photoId 记）

  const run = db.transaction(() => {
    const r = db.prepare('INSERT INTO albums (name, folder_path, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(name, '', 'virtual', now(), now());
    const albumId = r.lastInsertRowid;
    db.prepare('UPDATE albums SET sort_order = ? WHERE id = ?').run(albumId, albumId);

    for (const pid of photoIds) {
      const photo = getPhoto.get(pid);
      if (!photo) continue;
      const src = getAlbum.get(photo.album_id);
      // thumb_path 置空：新行有自己的 id，缩略图由 /thumb 按需生成（{新id}.jpg），
      // 不与源相册共用同一个缩略图文件，避免源侧删照片时把这张也一起删掉。
      insertPhoto.run(albumId, photo.file_path, photo.file_name, photo.file_size || 0, photo.mtime || '', photo.photo_date || '', photo.exif_date || '', photo.date_src || '');
      // 只有「源相册是虚拟相册」才移走索引；文件夹相册的索引保持不动
      if (src && src.kind === 'virtual') {
        deletePhoto.run(photo.id);
        movedThumbs.push(photo.id);
      }
    }
    return albumId;
  });

  const albumId = run();
  // 被移走那几行的缩略图缓存已经没人引用了，顺手清掉（失败无所谓）
  // 路径按库隔离推导（{THUMB_DIR}/{slug}/{photoId}.jpg）
  for (const pid of movedThumbs) {
    albumThumbs.forgetPhoto(dbManager.currentSlug(), pid);
    fsp.unlink(albumThumbs.thumbPathFor(dbManager.currentSlug(), pid)).catch(() => {});
  }
  return albumId;
}

// POST /api/album/:id/rescan 手动重新扫描（增量/全量/虚拟相册刷新）
// 请求体 mode: 'incremental'（默认）/ 'full' / 'virtual'
router.post('/:id/rescan', (req, res) => {
    const albumId = Number(req.params.id);
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
  if (!album) return res.status(404).json({ error: '相册不存在' });
  const mode = req.body && req.body.mode === 'full' ? 'full' : 'incremental';
  // 虚拟相册没有绑定文件夹，不能走「遍历目录」那两条路；
  // 但它的索引同样是拷贝来的（拍摄时间、缩略图版本都会过时），
  // 所以给它 'virtual' 模式：只按已有索引行更新字段与缩略图，不遍历磁盘、不增删行。
  if (album.kind === 'virtual') {
    dispatchVirtual(albumId, '');
    return res.json({ message: '已开始更新虚拟相册的照片信息与缩略图' });
  }
  // 派活给扫描子进程（真正干活的在 worker.scan.js 里），主进程不等待扫完 —— 接口立刻返回。
  if (mode === 'full') {
    dispatchFull(albumId, '');
  } else {
    dispatchIncremental(albumId, '');
  }
  res.json({ message: '已开始' + (mode === 'full' ? '完全更新' : '增量更新') + '照片索引' });
});

// POST /api/album/:id/stop 停止正在进行的扫描
router.post('/:id/stop', (req, res) => {
  const albumId = Number(req.params.id);
  const slug = dbManager.currentSlug();
  // 停止有两条通路：IPC（快）与库表 state（跨进程真源，IPC 断了也不丢）。
  // 用户主动停止 = 明确放弃这次扫描，不再保留断点（否则下次启动会把它续起来，与用户意图相反）。
  scanWorker.requestStop(slug, albumId);
  res.json({ message: '已请求停止扫描' });
});

// POST /api/album/:id/pause 暂停/继续扫描
// 请求体 paused：true（缺省）= 暂停，false = 继续。暂停只是让扫描循环在检查点原地等待，
// 任务本身仍在跑（进度保留），所以「任务管理」里那一行不会消失，可以随时继续。
router.post('/:id/pause', (req, res) => {
  const albumId = Number(req.params.id);
  const slug = dbManager.currentSlug();
  const task = scanWorker.getActive(albumId);
  if (!task) return res.json({ message: '当前没有扫描任务', paused: false });
  if (task.cancelled) return res.json({ message: '任务已停止', paused: false });
  const paused = !(req.body && req.body.paused === false);
  scanWorker.requestPause(slug, albumId, paused);
  res.json({ message: paused ? '已暂停扫描' : '已继续扫描', paused });
});

// GET /api/album/:id/status 查询扫描进度
//
// 读的是「主进程视角」：scanWorker 记录了本进程派出去、还在跑的任务。
// 暂停/停止的跨进程真源在库表 album_scan_tasks 里（由 scanWorker 转写），
// 这里一并读出来，让「暂停中」这个状态即使 IPC 消息丢了也能正确显示。
router.get('/:id/status', (req, res) => {
  const albumId = Number(req.params.id);
  const task = scanWorker.getActive(albumId);
  if (!task) {
    return res.json({ scanning: false, progress: null });
  }
  // 库表里的 state 优先（跨进程真源）；读不到就以内存视图为准
  let paused = !!task.paused;
  try {
    const row = readScanTask(db, albumId);
    if (row) paused = row.state === 'paused';
  } catch (_) {}
  res.json({
    scanning: !task.cancelled,
    paused,
    scanned: task.scanned,
    total: task.total,
    canceled: task.cancelled,
  });
});

// GET /api/album/tasks 列出当前所有相册扫描任务（给「任务管理」弹窗用）
// 直接读 scanWorker 的在跑任务：不管是用户点按钮发起的，还是软件自己发起的
// （添加相册后的首次全量扫描、撤销/重做相册触发的重扫、页面顶部刷新），
// 只要还在跑就一定能在这里看到。
router.get('/tasks', (req, res) => {
  try {
    const names = new Map(db.prepare('SELECT id, name FROM albums').all().map(a => [a.id, a.name]));
    const list = [];
    for (const task of scanWorker.listActive()) {
      list.push({
        id: `album-scan-${task.albumId}`,
        kind: 'album_scan',
        albumId: task.albumId,
        albumName: names.get(task.albumId) || `相册 #${task.albumId}`,
        mode: task.mode || 'incremental',
        scanning: !task.cancelled,
        paused: !!task.paused,
        cancelled: !!task.cancelled,
        scanned: task.scanned || 0,
        total: task.total || 0,
        startedAt: task.startedAt || '',
      });
    }
    res.json({ data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/album/tasks/pending 列出「上次没跑完」的扫描任务（断点续扫用）
//
// 与 /tasks 的区别：/tasks 读 scanWorker 的在跑任务（本进程正在跑的），
// 本接口读库表 album_scan_tasks（上次进程被杀/崩溃时留下的断点）。
// 两者互补：重启后内存是空的，但库里还留着断点，前端据此提示用户并续扫。
//
// 时机：前端在**完全启动后**（占位页移除 + 小组件就绪 + 延迟 4 秒）才调本接口，
// 后端自身**不会**在启动时自动续扫 —— 那会跟软件启动抢 CPU/IO。
router.get('/tasks/pending', (req, res) => {
  try {
    const rows = readPendingScanTasks(db);
    const list = rows.map(r => ({
      albumId: r.album_id,
      albumName: r.album_name || `相册 #${r.album_id}`,
      mode: r.mode || 'incremental',
      phase: r.phase || 'collect',
      scanned: r.scanned || 0,
      total: r.total || 0,
      startedAt: r.started_at || '',
      updatedAt: r.updated_at || '',
    }));
    res.json({ data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/album/tasks/resume 续跑上次没跑完的扫描任务
//
// 请求体：{ albumIds: [albumId, ...] }（不传则续跑全部待恢复任务）
// 行为：按库表里的断点续扫 —— 全量从 done_path 之后继续（不清空已扫好的索引），
//       增量同样从断点之后继续（已存在的文件靠 mtime 判断，天然幂等）。
// 已在跑的任务会被跳过（同相册同时只跑一个）。
router.post('/tasks/resume', (req, res) => {
  try {
    const rows = readPendingScanTasks(db);
    if (!rows.length) return res.json({ message: '没有待恢复的任务', resumed: 0 });
    const want = Array.isArray(req.body && req.body.albumIds)
      ? new Set(req.body.albumIds.map(Number).filter(v => Number.isInteger(v) && v > 0))
      : null;
    let resumed = 0;
    for (const r of rows) {
      const albumId = r.album_id;
      if (want && !want.has(albumId)) continue;
      // 已经在跑的不重复启动
      if (scanWorker.isDispatched(albumId)) continue;
      // 相册已不存在（被删了）→ 清掉断点，不再续
      const album = db.prepare('SELECT id, kind FROM albums WHERE id = ?').get(albumId);
      if (!album) {
        try { persistScanClear(db, albumId); } catch (_) {}
        continue;
      }
      // 派活给子进程，带上断点（done_path）让它从上次的位置接着扫。
      // 虚拟相册的续扫走 refreshVirtual，断点是「已处理到的行 id」而非文件路径，
      // 但都由同一个 done_path 字段承载，refreshVirtual 入口会自己按数字解析。
      const done = r.done_path || '';
      const mode = r.mode === 'full' ? 'full'
        : r.mode === 'virtual' ? 'virtual'
        : 'incremental';
      if (album.kind === 'virtual') {
        // 库里记的是 virtual 但相册已不是虚拟的（换了类型）→ 丢弃断点，不续
        if (mode !== 'virtual') { try { persistScanClear(db, albumId); } catch (_) {} continue; }
        dispatchVirtual(albumId, done);
      } else if (mode === 'virtual') {
        // 反过来：文件夹相册不该拿到 virtual 任务
        try { persistScanClear(db, albumId); } catch (_) {}
        continue;
      } else if (mode === 'full') dispatchFull(albumId, done);
      else dispatchIncremental(albumId, done);
      resumed++;
    }
    res.json({ message: resumed ? `已继续 ${resumed} 个未完成的扫描任务` : '没有可恢复的任务', resumed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/album/:id 修改相册名称/路径
router.patch('/:id', async (req, res) => {
    const albumId = Number(req.params.id);
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
  if (!album) return res.status(404).json({ error: '相册不存在' });
  const name = (req.body && req.body.name) || album.name;
  const folder = (req.body && req.body.folder_path) || album.folder_path;
  db.prepare('UPDATE albums SET name = ?, folder_path = ?, updated_at = ? WHERE id = ?').run(name, folder, now(), albumId);
  res.json({ message: '相册已更新' });
});

// PUT /api/album/reorder 批量更新相册排序
router.put('/reorder', (req, res) => {
    const ids = req.body && req.body.ids;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids 必须为数组' });
  const update = db.prepare('UPDATE albums SET sort_order = ? WHERE id = ?');
  ids.forEach((id, i) => update.run(i, id));
  res.json({ message: '排序已更新' });
});

// DELETE /api/album/:id 删除相册（仅删除索引，不删除磁盘照片）
router.delete('/:id', async (req, res) => {
    const albumId = Number(req.params.id);
  const slug = dbManager.currentSlug();
  // 删除相册时清理其所有照片的缩略图缓存
  // 路径按库隔离推导（{THUMB_DIR}/{slug}/{photoId}.jpg）；
  // 库里的 thumb_path 也一并清掉，避免索引删了但文件还在。
  const thumbs = db.prepare('SELECT id, thumb_path FROM album_photos WHERE album_id = ?').all(albumId);
  await Promise.all(thumbs.map(r => {
    albumThumbs.forgetPhoto(slug, r.id);
    const p = albumThumbs.thumbPathFor(slug, r.id);
    return Promise.all([fsp.unlink(p).catch(() => {}), r.thumb_path ? fsp.unlink(r.thumb_path).catch(() => {}) : null]);
  }));
  db.prepare('DELETE FROM album_photos WHERE album_id = ?').run(albumId);
  db.prepare('DELETE FROM albums WHERE id = ?').run(albumId);
  // 相册没了，正在跑的扫描也要停（子进程会在检查点发现相册已不存在而收工）
  scanWorker.requestStop(slug, albumId);
  res.json({ message: '相册已删除' });
});

// ======================== 照片浏览 ========================

// GET /api/album/:id/photos 按拍摄日期倒序分组的照片列表
// 排序键是 photo_date（图片自带的 EXIF 拍摄时间；读不到就是空串，不拿文件时间冒充）。
// 空串在 SQLite 里小于任何非空字符串，DESC 排序天然落到最后 —— 即「未知时间」在最底部。
// 同一天内仍按 mtime 倒序，保证组内顺序稳定。
router.get('/:id/photos', (req, res) => {
  try {
    const albumId = Number(req.params.id);
    const photos = db.prepare(`
      SELECT id, file_path, file_name, file_size, mtime, photo_date, exif_date, date_src
      FROM album_photos WHERE album_id = ?
      ORDER BY photo_date DESC, mtime DESC, id DESC
    `).all(albumId);
    for (const p of photos) p.media_type = mediaTypeOf(p.file_name);
    // 按日期分组：date -> [photos]
    // 读不到 EXIF 的照片 photo_date 为空串，统一归到「未知时间」这一组；
    // 排序时它天然在最底部（见上面的 ORDER BY 注释）。
    const groups = [];
    const byDate = new Map();
    for (const p of photos) {
      const key = p.photo_date || '未知时间';
      if (!byDate.has(key)) { byDate.set(key, []); groups.push({ date: key, photos: byDate.get(key) }); }
      byDate.get(key).push(p);
    }
    res.json({ data: groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/album/photos/move 把照片索引移动到另一个相册（只改索引，不动磁盘文件）
// 规则（与「新建虚拟相册」同一套约定）：
// · 目标必须是虚拟相册：文件夹相册代表磁盘目录本身，数量必须与文件夹（含子文件夹）里的文件数一致，
//   所以不允许把别的相册的照片索引塞进去；
// · 源是虚拟相册 → 源侧索引删除（来源数量减少）、目标侧新增，即真正的“移动”；
// · 源是文件夹相册 → 源侧索引保持不动，只在目标侧新增（来源数量仍等于文件夹（含子文件夹）文件数）；
// · 目标里已经有同一文件（file_path 相同）时不重复插入；所选照片本来就在目标相册的直接忽略。
// 请求体：{ photo_ids: [album_photos.id...], target_album_id }
router.post('/photos/move', (req, res) => {
  try {
    const rawIds = Array.isArray(req.body && req.body.photo_ids) ? req.body.photo_ids : []
    const ids = [...new Set(rawIds.map(v => Number(v)).filter(v => Number.isInteger(v) && v > 0))];
    if (!ids.length) return res.status(400).json({ error: '请先选择要移动的照片' });
    const targetId = Number(req.body && req.body.target_album_id);
    if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: '请选择要移动到的相册' });
    const target = db.prepare('SELECT id, name, kind FROM albums WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: '目标相册不存在' });
    if (target.kind !== 'virtual') return res.status(400).json({ error: '文件夹相册不支持移入照片，请选择虚拟相册' });

    const getPhoto = db.prepare('SELECT * FROM album_photos WHERE id = ?');
    const getAlbum = db.prepare('SELECT id, kind FROM albums WHERE id = ?');
    // thumb_path 置空：新行有自己的 id，缩略图由 /thumb 按需生成（{新id}.jpg），
    // 不与源行共用缓存文件，避免源侧以后删照片时把目标相册的缩略图一起删掉。
    const insertPhoto = db.prepare(`
      INSERT OR IGNORE INTO album_photos (album_id, file_path, file_name, file_size, mtime, photo_date, exif_date, date_src, thumb_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')
    `);
    const deletePhoto = db.prepare('DELETE FROM album_photos WHERE id = ?');
    const touchAlbum = db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?');

    let moved = 0;
    let skipped = 0;
    const movedThumbs = []; // 源行被移走后没人引用的缩略图（按 photoId 记，路径按库推导）
    const records = [];     // 交给前端登记撤销：撤销时据此把索引搬回来源

    const run = db.transaction(() => {
      for (const pid of ids) {
        const photo = getPhoto.get(pid);
        if (!photo || photo.album_id === targetId) { skipped++; continue; }
        const src = getAlbum.get(photo.album_id);
        if (!src) { skipped++; continue; }
        const info = insertPhoto.run(targetId, photo.file_path, photo.file_name, photo.file_size || 0, photo.mtime || '', photo.photo_date || '', photo.exif_date || '', photo.date_src || '');
        const inserted = info.changes > 0;
        if (inserted) moved++; else skipped++;
        // 只有虚拟相册的来源才把索引“搬走”；文件夹相册的索引保持不动
        const sourceRemoved = src.kind === 'virtual';
        if (sourceRemoved) {
          deletePhoto.run(photo.id);
          // 源行的缩略图缓存已无人引用（目标行是新 id，会按新 id 重新生成）→ 记下来删
          movedThumbs.push(photo.id);
        }
        // 两项都没发生时（目标已有同一文件、来源又不删）无需登记撤销
        if (!inserted && !sourceRemoved) continue;
        records.push({
          source_photo_id: photo.id,
          source_album_id: photo.album_id,
          source_kind: src.kind,
          file_path: photo.file_path,
          file_name: photo.file_name,
          file_size: photo.file_size || 0,
          mtime: photo.mtime || '',
          photo_date: photo.photo_date || '',
          exif_date: photo.exif_date || '',
          date_src: photo.date_src || '',
          inserted,
          source_removed: sourceRemoved,
        });
      }
      const touched = new Set(records.map(r => r.source_album_id));
      touched.add(targetId);
      for (const aid of touched) touchAlbum.run(now(), aid);
    });
    run();

    // 被移走那几行的缩略图缓存已经没人引用了，顺手清掉（失败无所谓）
    // 路径按库隔离推导（{THUMB_DIR}/{slug}/{photoId}.jpg）
    for (const pid of movedThumbs) {
      albumThumbs.forgetPhoto(dbManager.currentSlug(), pid);
      fsp.unlink(albumThumbs.thumbPathFor(dbManager.currentSlug(), pid)).catch(() => {});
    }

    const extra = skipped ? `，${skipped} 张已存在或无需移动` : '';
    res.json({
      moved,
      skipped,
      target_album_id: target.id,
      target_album_name: target.name,
      photos: records,
      message: `已移动 ${moved} 张照片到「${target.name}」${extra}`,
    });
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
      // 解析并校验 Range：非法/越界/多段统一回 416，避免 start/end 反了读出负长度或越界
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
      if (!m || (m[1] === '' && m[2] === '')) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}`, 'Accept-Ranges': 'bytes' });
        return res.end();
      }
      let start;
      let end;
      if (m[1] === '') {
        // 后缀范围 bytes=-N：取末尾 N 字节
        const suffix = parseInt(m[2], 10);
        if (!Number.isFinite(suffix) || suffix <= 0 || total === 0) {
          res.writeHead(416, { 'Content-Range': `bytes */${total}`, 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        start = Math.max(0, total - suffix);
        end = total - 1;
      } else {
        start = parseInt(m[1], 10);
        end = m[2] === '' ? total - 1 : parseInt(m[2], 10);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
          res.writeHead(416, { 'Content-Range': `bytes */${total}`, 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        end = Math.min(end, total - 1);
      }
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mime,
        'Cache-Control': 'no-cache',
      });
      const stream = fs.createReadStream(photo.file_path, { start, end });
      // 读盘失败时立刻销毁响应，避免前端拿到半截视频后一直转圈
      stream.on('error', (e) => {
        console.error('[album] 读取源文件失败:', e.message);
        res.destroy(e);
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      });
      const stream = fs.createReadStream(photo.file_path);
      stream.on('error', (e) => {
        console.error('[album] 读取源文件失败:', e.message);
        res.destroy(e);
      });
      stream.pipe(res);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/album/photo/:photoId/thumb 返回网格用的缩略图 / 视频封面（512px JPEG）
// 有缩略图则返回缓存小图（长缓存）。
// 没有缩略图（全量扫描进行中、缩略图尚未后台生成完）时：现场用 genThumb 生成一张
// 512px 小图并写库缓存后再返回，绝不回退 pipe 源文件原图。否则网格在扫描中请求的
// 会是一张几 MB 的原图，几十张并发流进前端渲染进程，扫描期间内存会瞬间飙高。
// 版本落后（thumb_v < THUMB_VERSION，即尺寸/质量改过）也走现场重建，旧缓存自动升级。
//
// 性能：先查内存索引/buffer 缓存（命中即零磁盘 IO），miss 才异步读盘；
// 不用 fs.existsSync（同步 IO 会阻塞事件循环）。
//
// 低干扰：现场生成要过配额闸 claimOnDemand（见「后台扫描的低干扰约定」）。
// 扫描期间主进程不能跟扫描抢 CPU/线程池，配额满了就把这个 id 记进需求队列，
// 由扫描循环顺手补；本次直接 404，前端走占位，下次请求就拿到了。
router.get('/photo/:photoId/thumb', async (req, res) => {
  let claimed = false;
  try {
    const slug = dbManager.currentSlug();
    const photo = db.prepare('SELECT * FROM album_photos WHERE id = ?').get(Number(req.params.photoId));
    if (!photo) return res.status(404).json({ error: '照片不存在' });
    let tp = thumbOf(photo, slug);
    const stale = (photo.thumb_v || 0) < THUMB_VERSION;
    if (!tp || stale) {
      if (!claimOnDemand(1)) {
        deferThumbDemand(slug, [photo.id]);
        return res.status(404).json({ error: '缩略图排队生成中' });
      }
      claimed = true;
      const isVideo = mediaTypeOf(photo.file_name) === 'video';
      const regenerated = await genThumb(photo.id, photo.file_path, isVideo, slug);
      if (regenerated) {
        tp = regenerated;
        db.prepare('UPDATE album_photos SET thumb_path = ?, thumb_v = ? WHERE id = ?').run(tp, THUMB_VERSION, photo.id);
      }
    }
    if (!tp) return res.status(404).json({ error: '缩略图生成失败' });
    // 读缓存（内存优先）：读不到说明文件已被外部删除 → 现场重建一次
    let buf = await albumThumbs.readThumb(tp);
    if (!buf) {
      if (!claimOnDemand(1)) {
        deferThumbDemand(slug, [photo.id]);
        return res.status(404).json({ error: '缩略图排队生成中' });
      }
      claimed = true;
      const isVideo = mediaTypeOf(photo.file_name) === 'video';
      const regenerated = await genThumb(photo.id, photo.file_path, isVideo, slug);
      if (!regenerated) return res.status(404).json({ error: '缩略图生成失败' });
      db.prepare('UPDATE album_photos SET thumb_path = ?, thumb_v = ? WHERE id = ?').run(regenerated, THUMB_VERSION, photo.id);
      buf = await albumThumbs.readThumb(regenerated);
      if (!buf) return res.status(404).json({ error: '缩略图生成失败' });
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (claimed) releaseOnDemand(1);
  }
});

// POST /api/album/photo/thumbs 批量取缩略图（性能优化）
//
// 背景：网格一次要显示几十上百张缩略图，逐个请求受浏览器同源并发连接数限制
// （HTTP/1.1 通常 6 条），往返开销占比很高。实测（后端已上内存缓存后）：
// 逐个并发 6 → 2.43 ms/张；批量每批 100 张 → 0.19 ms/张（约 10 倍）。
//
// 请求体：{ ids: [photoId, ...] }（也支持 query ?ids=1,2,3）
// 响应：二进制，每张图「4 字节小端长度 + JPEG 数据」逐张拼接；
//       响应头 X-Thumb-Ids 给出本次实际返回的 photoId 顺序（逗号分隔）。
// 缺图的 photoId 不会出现在响应里（源文件已删除、生成失败，或本次过不了配额排队中），
// 前端对这些格子回落到单张 /thumb 接口即可；下次请求就会拿到图。
// 缺图默认会现场生成（与单张接口同一套 genThumb 逻辑）—— 否则新扫描进来的照片
// thumb_v=0，批量会全部落空，接口形同虚设。生成受 MAX_CONCURRENT_THUMBS 信号量约束。
// 低干扰：缺图的两阶段处理（见「后台扫描的低干扰约定」）。
//   第一阶段：整批缺图数过配额闸 → 主进程现场生成（用户无感知，格子立刻有图）；
//   第二阶段：过不了闸 → 全部记进需求队列交给扫描任务，本次直接跳过。
// 不做「截断式」处理（只生成前 N 张、其余排队）：那样用户会看到同一屏里
// 靠前的格子有图、靠后的没有，比全都没有更难解释。
router.post('/photo/thumbs', async (req, res) => {
  let claimed = 0;
  try {
    const slug = dbManager.currentSlug();
    const body = req.body || {};
    let ids = Array.isArray(body.ids) ? body.ids : null;
    if (!ids && typeof req.query.ids === 'string') {
      ids = req.query.ids.split(',');
    }
    ids = (ids || []).map(Number).filter(v => Number.isInteger(v) && v > 0);
    // 上限保护：一次最多 200 张，避免超大请求打爆内存
    ids = ids.slice(0, 200);
    if (!ids.length) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Thumb-Ids', '');
      return res.end(Buffer.alloc(0));
    }
    // 先从库里取索引行（要 file_name 判断是否视频、file_path 用于现场生成）
    // better-sqlite3 不支持 IN (?) 的展开参数，必须用问号占位逐个绑定
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id, file_path, file_name, thumb_path, thumb_v FROM album_photos WHERE id IN (${placeholders})`).all(...ids);
    const byId = new Map(rows.map(r => [r.id, r]));

    // 先把「已有缓存的」和「缺图的」分开：配额闸只看缺图数，
    // 否则一个 200 张的请求会因为「其中180 张已缓存」被误拒。
    const parts = [];
    const gotIds = [];
    const missing = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) continue;
      // 优先用已缓存的缩略图（内存索引 → 库里的指针）
      const p = albumThumbs.lookupThumb(slug, id, THUMB_VERSION)
        || ((r.thumb_v || 0) >= THUMB_VERSION && r.thumb_path ? r.thumb_path : '');
      if (p) {
        albumThumbs.rememberThumb(slug, id, p, THUMB_VERSION, null);
        const buf = await albumThumbs.readThumb(p);
        if (buf) {
          // 每张图「4 字节小端长度 + JPEG 数据」逐张拼接（前端可流式解析）
          const head = Buffer.alloc(4);
          head.writeUInt32LE(buf.length, 0);
          parts.push(head, buf);
          gotIds.push(id);
          continue;
        }
      }
      missing.push(r);
    }
    if (missing.length) {
      if (claimOnDemand(missing.length)) {
        claimed = missing.length;
        for (const r of missing) {
          // 必须生成：否则新扫描进来的照片 thumb_v=0，批量会全部落空，接口形同虚设。
          // 生成受 MAX_CONCURRENT_THUMBS 信号量约束。
          const isVideo = mediaTypeOf(r.file_name) === 'video';
          const p = await genThumb(r.id, r.file_path, isVideo, slug);
          if (!p) continue;
          db.prepare('UPDATE album_photos SET thumb_path = ?, thumb_v = ? WHERE id = ?').run(p, THUMB_VERSION, r.id);
          albumThumbs.rememberThumb(slug, r.id, p, THUMB_VERSION, null);
          const buf = await albumThumbs.readThumb(p);
          if (!buf) continue;
          const head = Buffer.alloc(4);
          head.writeUInt32LE(buf.length, 0);
          parts.push(head, buf);
          gotIds.push(r.id);
        }
      } else {
        // 过不了配额：丢给扫描任务顺带补，本次不生成。
        deferThumbDemand(slug, missing.map(r => r.id));
      }
    }
    if (!parts.length) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('X-Thumb-Ids', '');
      return res.end(Buffer.alloc(0));
    }
    const body2 = Buffer.concat(parts);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', body2.length);
    res.setHeader('X-Thumb-Ids', gotIds.join(','));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(body2);
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (claimed) releaseOnDemand(claimed);
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
    // 清理已生成的缩略图缓存（按库隔离路径）
    await deleteThumb(photo, dbManager.currentSlug()).catch(() => {});
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
    // 与 /photo/:id/file 的两处流一致：stat 通过后、流真正打开前文件仍可能被删/占用，
    // Readable 的 error 没有监听就会变成 uncaughtException —— 本项目没有进程级兜底，
    // 那会直接崩掉后端（前端全废）。这里必须同样挂 error 并销毁响应。
    const stream = fs.createReadStream(photo.file_path);
    stream.on('error', (e) => {
      console.error('[album] 另存读取源文件失败:', e.message);
      res.destroy(e);
    });
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================== 后台扫描：委派给扫描子进程 ========================
//
// 2026-10-22 起，扫描（目录遍历 + 索引写入 + 缩略图生成）全部跑在**独立子进程**
// worker.scan.js 里，主进程只保留 HTTP 接口与「请求路径少量补图」。
// 为什么要拆进程：扫描要跑 sharp（占满 libuv 线程池）+ 大量磁盘 IO，与 HTTP 接口
// 同进程时其他接口的异步 fs 只能排队，表现为「一扫描全站变慢」。独立进程有自己
// 的 libuv/V8/GC。注意不能用 worker_threads —— libuv 线程池是进程级全局静态，
// 所有 Worker 共用同一个池子，Worker 只能隔离 V8 堆与 JS CPU，而 sharp 的解码
// 全在原生线程池上。
//
// 状态真源在库表 album_scan_tasks（跨进程共享），IPC 只承载「派活/报活」：
//   · 主进程 scanWorker.js 负责 fork / 派活 / 收报活 / 转发补图 / 空闲退出 / 崩溃重建
//   · /status、/tasks 读 scanWorker 的在跑任务视图；pause、stop 改表（state 列），
//     子进程在检查点读表（IPC 断了也不丢状态）
//   · worker 每生成一批缩略图就 IPC 回报，主进程用它预热内存索引
//
// 断点续扫（album_scan_tasks 的 done_path）与「低干扰」约定见 albumScan.js 顶部注释。

// 派活壳：从指定断点继续扫一个相册（真正的实现在子进程里）。
// 由 /tasks/resume 与新建/重扫调用。主进程不等待扫完 —— 接口立刻返回。
function dispatchFull(albumId, resumeFrom) {
  const slug = dbManager.currentSlug();
  scanWorker.dispatchScan(slug, albumId, 'full', resumeFrom || '');
}
function dispatchIncremental(albumId, resumeFrom) {
  const slug = dbManager.currentSlug();
  scanWorker.dispatchScan(slug, albumId, 'incremental', resumeFrom || '');
}
// 虚拟相册刷新：mode='virtual'，子进程走 albumScan.refreshVirtual（只按已有索引更新）
function dispatchVirtual(albumId, resumeFrom) {
  const slug = dbManager.currentSlug();
  scanWorker.dispatchScan(slug, albumId, 'virtual', resumeFrom || '');
}

module.exports = router;
// 供 /api/dashboard 聚合复用（挂在 router 函数对象上，不影响既有路由）
module.exports.readAlbums = readAlbums;

// 供 undo.js「撤销添加相册」调用：取消该相册仍在进行的扫描任务。
router.cancelScan = (albumId) => {
  scanWorker.requestStop(dbManager.currentSlug(), albumId);
};

// 供 undo.js「重做添加相册」调用：重新加入该文件夹，触发增量扫描（空索引会把现有文件当新增逐步索引）。
router.startScan = (albumId) => {
  if (scanWorker.isDispatched(albumId)) return;
  dispatchIncremental(albumId, '');
};