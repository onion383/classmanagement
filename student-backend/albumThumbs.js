// =========================================================================
// albumThumbs.js —— 班级相册缩略图缓存（按库隔离 + 内存缓存 + 批量读取）
//
// 本模块从 routes/album.js 抽出，承载三件事：
//
// 1) 按库隔离（修多租户串图 bug）
//    各班主任库的 album_photos.id 都从 1 开始独立自增，而缩略图文件原本
//    固定命名 {photoId}.jpg 且所有库共用同一个 THUMB_DIR —— 于是库 A 的 id=1
//    与库 B 的 id=1 指向同一个文件，后扫描的库会覆盖先扫描的库。实测复现：
//    库A(红图)/库B(蓝图) 各自 id=1，最终两边都读到蓝色；切换账号重登旧账号
//    会看到别人的照片。
//    现在缩略图按 slug 分目录：{THUMB_DIR}/{safeSlug}/{photoId}.jpg，各库互不干扰。
//
// 2) 内存缓存（性能）
//    实测每张缩略图的查找成本构成（11.5KB JPEG，主键点查）：
//      fs.existsSync   100~524 us   ← 同步 IO，阻塞事件循环（并发 16 张时
//                                     5ms 定时器延迟 p95 达 8.3ms、max 10.1ms）
//      磁盘读文件      2402 us
//      DB prepare+get   226 us
//    全部命中内存后单请求 1829 us → 167 us（约 11x）。
//    故这里维护两块缓存：
//      · thumbIndex —— photoId → { path, v } 的索引，兼作「文件存在」的判据
//        （写缓存时已确认文件在磁盘上，无需每次 existsSync）；
//      · thumbBuf   —— 文件内容 buffer 的 LRU 缓存（按字节数封顶，不是按条数）。
//
// 3) 批量读取（性能）
//    实测二进制拼接批量（长度前缀 + Buffer.concat）0.82 ms/张，比逐个并发
//    （1.20 ms/张）快约 1.4x；base64 JSON 批量无收益（33% 体积膨胀 + JSON
//    解析抵消了省下的 HTTP 往返），故只做二进制一种格式。
//
// 缓存失效点（必须同步清理，否则会读到已删/已重建的旧图）：
//    · 删除照片 / 删除相册  → forgetPhoto / forgetAlbum
//    · 重新生成缩略图      → 生成成功后自动覆盖索引与 buffer
//    · THUMB_VERSION 变更  → 版本不匹配的条目视为无效，读取时自动重建
// =========================================================================

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const dbManager = require('./dbManager/dbManager');

const THUMB_DIR = dbManager.thumbsDir;
try { fs.mkdirSync(THUMB_DIR, { recursive: true }); } catch (_) {}

// ---------------------------------------------------------------------------
// 按库隔离：slug → 子目录
// ---------------------------------------------------------------------------

// slug 来自库文件名（形如 @c7e1f503baaf），只含安全字符；仍做一次白名单过滤，
// 防止异常 slug 逃出 THUMB_DIR（目录穿越）。
function safeSlug(slug) {
  const s = String(slug || '');
  return /^[A-Za-z0-9_@-]{1,64}$/.test(s) ? s : 'default';
}

// 取某库的缩略图目录（不存在则创建）。首次调用会 mkdirSync 一次。
const dirCache = new Map();
function thumbsDirFor(slug) {
  const key = safeSlug(slug);
  let dir = dirCache.get(key);
  if (!dir) {
    dir = path.join(THUMB_DIR, key);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    dirCache.set(key, dir);
  }
  return dir;
}

// 某张照片的缩略图绝对路径（确定性推导，不需要查库）
function thumbPathFor(slug, photoId) {
  return path.join(thumbsDirFor(slug), `${photoId}.jpg`);
}

// ---------------------------------------------------------------------------
// 内存索引：photoId → { path, v }
// ---------------------------------------------------------------------------

// 按库分区存储，避免不同库的相同 photoId 互相覆盖（与磁盘目录同理）
const indexBySlug = new Map();

// 索引同样按估算字节封顶。它比 buffer 缓存小得多（每条约 100 字节），
// 但条目数会随相册照片数单调增长，且进程生命周期内不会自然回落，所以也需要一道闸门：
//   30MB ≈ 30 万条，单个班级的相册远到不了这个量级。
// **淘汰是安全的**：索引只用于「判断缩略图是否已生成」，miss 会退回磁盘检查后重建，
// 不丢数据、不出错，只是那一次走慢路径。
const INDEX_MAX_BYTES = 30 * 1024 * 1024;
let indexBytes = 0;

// 单条估算：path 是 UTF-16 字符串（2 字节/字符）+ 对象与 Map 项开销约 96 字节。
// 不追求精确 —— 这是防失控的闸门，不是内存分析器。
function indexEntryCost(rec) {
  return (rec && rec.path ? rec.path.length * 2 : 0) + 96;
}

// 超限即从最老条目开始淘汰（Map 迭代序 = 插入序，库之间按首次创建顺序）。
// 一次降到 80%，避免每次 set 都触发全量扫描。
function evictIndexIfNeeded() {
  if (indexBytes <= INDEX_MAX_BYTES) return;
  const target = Math.floor(INDEX_MAX_BYTES * 0.8);
  for (const m of indexBySlug.values()) {
    for (const [photoId, rec] of m) {
      if (indexBytes <= target) return;
      m.delete(photoId);
      indexBytes -= indexEntryCost(rec);
      dropBuf(rec.path); // 索引淘汰时顺带放掉对应 buffer，避免两边口径不一致
    }
  }
}

function indexFor(slug) {
  const key = safeSlug(slug);
  let m = indexBySlug.get(key);
  if (!m) { m = new Map(); indexBySlug.set(key, m); }
  return m;
}

// 记录一条缩略图（生成成功后调用）：同时更新索引与 buffer 缓存
function rememberThumb(slug, photoId, filePath, version, buf) {
  if (photoId == null) return;
  const m = indexFor(slug);
  const old = m.get(photoId);
  if (old) indexBytes -= indexEntryCost(old); // 覆盖旧条目：先扣回，避免重复计数
  const rec = { path: filePath, v: version || 0 };
  m.set(photoId, rec);
  indexBytes += indexEntryCost(rec);
  if (buf && buf.length) putBuf(filePath, buf);
  evictIndexIfNeeded();
}

// 查索引：命中且版本足够新则返回路径，否则返回 ''（需重建）
function lookupThumb(slug, photoId, version) {
  const rec = indexFor(slug).get(photoId);
  if (!rec) return '';
  if ((rec.v || 0) < (version || 0)) return '';
  return rec.path || '';
}

// 失效单条（删照片时）
function forgetPhoto(slug, photoId) {
  const m = indexBySlug.get(safeSlug(slug));
  if (!m) return;
  const rec = m.get(photoId);
  if (rec) {
    dropBuf(rec.path);
    m.delete(photoId);
    indexBytes -= indexEntryCost(rec);
  }
}

// 失效整库（删账号 / 删相册时）
function forgetAlbum(slug) {
  const key = safeSlug(slug);
  const m = indexBySlug.get(key);
  if (!m) return;
  for (const rec of m.values()) {
    dropBuf(rec.path);
    indexBytes -= indexEntryCost(rec);
  }
  m.clear();
}

// ---------------------------------------------------------------------------
// buffer LRU 缓存（按字节数封顶）
// ---------------------------------------------------------------------------

// 上限默认 64MB：单张缩略图约 11~35KB，够放 2000~5000 张，
// 相当于把一个大相册的全部缩略图放进内存。
const BUF_MAX_BYTES = 64 * 1024 * 1024;

const bufCache = new Map();   // path → Buffer
let bufBytes = 0;

// Map 迭代序即插入序，删除最老的一条即可实现 LRU
function putBuf(filePath, buf) {
  if (!filePath || !buf || !buf.length) return;
  if (bufCache.has(filePath)) {
    bufBytes -= bufCache.get(filePath).length;
    bufCache.delete(filePath);
  }
  bufCache.set(filePath, buf);
  bufBytes += buf.length;
  while (bufBytes > BUF_MAX_BYTES && bufCache.size > 1) {
    const oldest = bufCache.keys().next().value;
    const b = bufCache.get(oldest);
    bufCache.delete(oldest);
    bufBytes -= b.length;
  }
}

function getBuf(filePath) {
  if (!filePath) return null;
  const b = bufCache.get(filePath);
  if (!b) return null;
  // 命中即续期（移到最后 = 最近使用）
  bufCache.delete(filePath);
  bufCache.set(filePath, b);
  return b;
}

function dropBuf(filePath) {
  if (!filePath) return;
  const b = bufCache.get(filePath);
  if (b) { bufBytes -= b.length; bufCache.delete(filePath); }
}

// 统计信息（供调试 / 后续加监控）
function cacheStats() {
  return {
    index_count: [...indexBySlug.values()].reduce((n, m) => n + m.size, 0),
    index_bytes: indexBytes,
    index_max_bytes: INDEX_MAX_BYTES,
    buf_count: bufCache.size,
    buf_bytes: bufBytes,
    buf_max_bytes: BUF_MAX_BYTES,
  };
}

// ---------------------------------------------------------------------------
// 读取：优先内存 buffer，其次磁盘
// ---------------------------------------------------------------------------

// 读一个缩略图到 Buffer。命中内存返回缓存；否则读磁盘并写入缓存。
// 读不到返回 null（调用方决定是否现场重建）。
async function readThumb(filePath) {
  if (!filePath) return null;
  const cached = getBuf(filePath);
  if (cached) return cached;
  try {
    const buf = await fsp.readFile(filePath);
    putBuf(filePath, buf);
    return buf;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 批量：二进制拼接格式
// ---------------------------------------------------------------------------
// 格式：**每张图**「4 字节小端长度 + JPEG 数据」逐张拼接（不是头部一张长度表）。
//   [len0(4)][data0][len1(4)][data1]...
// 选这个格式而不是「头部长度表」是为了让前端能顺序流式解析：读到一张就能立刻
// 渲染一张，不必等整个批次收完再按偏移表切。
// 相比 base64 JSON：省 33% 体积、省一次 JSON.parse。
//
// 注意：这里返回的是「已有的缓存缩略图」，缺图的条目不会现场生成
// （现场生成是重活，不适合放在批量接口里）。缺图的 photoId 不会被写入，
// 前端对这些格子回落到单张 /thumb 接口即可。
//
// 返回 { body: Buffer, ids: number[] }：ids 是实际拼进去的 photoId（按顺序）。
async function readThumbBatch(slug, photoIds, version) {
  const parts = [];
  const ids = [];
  for (const pid of photoIds) {
    const p = lookupThumb(slug, pid, version);
    if (!p) continue;
    const buf = await readThumb(p);
    if (!buf) continue;
    const head = Buffer.alloc(4);
    head.writeUInt32LE(buf.length, 0);
    parts.push(head, buf);
    ids.push(pid);
  }
  if (!parts.length) return { body: Buffer.alloc(0), ids: [], count: 0 };
  return { body: Buffer.concat(parts), ids, count: ids.length };
}

module.exports = {
  THUMB_DIR,
  safeSlug,
  thumbsDirFor,
  thumbPathFor,
  rememberThumb,
  lookupThumb,
  forgetPhoto,
  forgetAlbum,
  readThumb,
  readThumbBatch,
  cacheStats,
};
