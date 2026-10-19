// =========================================================================
// dbManager.base.js —— 多库加密核心·基础层
// （原 dbManager.js 按职责拆分而来，纯代码搬运，行为不变）
//   主密钥 / 数据目录与资源目录 / 密钥包裹与解包 / 请求上下文与连接缓存
//   连接基础原语（性能 pragma、打开文件）/ index.db 登记表
// =========================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { normalizePhrase } = require('../services/recoveryKey');

// 原生模块懒加载：后端子进程启动时不加载 .node 二进制，首次真正需要打开
// 数据库时才 require，缩短 app.listen 就绪信号的时间，让主窗口更早出现。
let Database = null;
function getDatabase() {
  if (!Database) Database = require('better-sqlite3-multiple-ciphers');
  return Database;
}

// 加载 .env（若存在），使密钥可从配置文件读取而不硬编码
// 注意：本文件位于 student-backend/dbManager/ 下，.env 与数据目录仍在 student-backend/ 层。
(function loadEnvFile() {
  const envFile = path.join(__dirname, '..', '.env');
  try {
    const content = fs.readFileSync(envFile, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch (_) { /* .env 不存在则忽略 */ }
})();

// ---------- 主密钥 ----------
const MASTER_KEY = process.env.DB_MASTER_KEY;
if (!MASTER_KEY) {
  throw new Error('未配置主密钥 DB_MASTER_KEY（请设置环境变量或 student-backend/.env）');
}
// 主密钥派生为 AES-256 包裹密钥
const WRAP_KEY = crypto.createHash('sha256').update(MASTER_KEY).digest();

// 数据目录优先取环境变量（打包后由 Electron 主进程指向 userData），兜底用 student-backend/data
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// 可写资源目录：上传文件（收据/背景图）统一放 dataDir 下，避免打包后 __dirname 位于只读
// asar 归档内导致写入失败（ENOTDIR/无权限）。
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }
const uploadsDir = ensureDir(path.join(dataDir, 'uploads'));
const backgroundDir = ensureDir(path.join(uploadsDir, 'background'));
// 相册缩略图缓存目录：可再生的缓存，默认可随数据目录走；被用户单独配置为独立缓存目录时
// 读 ALBUM_THUMBS_DIR（由 Electron 主进程按 app-config 注入），相册缩略图移到该位置。
const thumbsDir = ensureDir(
  process.env.ALBUM_THUMBS_DIR ? path.resolve(process.env.ALBUM_THUMBS_DIR) : path.join(dataDir, 'album-thumbs')
);
// 相册应用内回收站目录：删除照片时的文件先移到这里（可编程撤销还原），替代系统回收站。
const trashDir = ensureDir(path.join(dataDir, 'album-trash'));
// AI 数据快照目录：整库文件快照按 slug 隔离存于 dataDir/snapshots/<slug>/，文件名即时间戳。
// 快照是加密 .db 原文（沿用同一库密钥），还原时直接覆盖库文件，用于大批量写入前的「后悔药」。
const snapshotsDirRoot = ensureDir(path.join(dataDir, 'snapshots'));
function snapshotsDir(slug) {
  const safe = /^[A-Za-z0-9_@-]+$/.test(String(slug || '')) ? String(slug) : 'default';
  return ensureDir(path.join(snapshotsDirRoot, safe));
}

// ---------- 库密钥 包裹/解包 ----------
// wrapped = base64(iv).base64(tag).base64(ciphertext)
function wrapKey(plainKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', WRAP_KEY, iv);
  const enc = Buffer.concat([cipher.update(plainKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map(b => b.toString('base64')).join('.');
}

function unwrapKey(wrapped) {
  const [ivB, tagB, encB] = wrapped.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', WRAP_KEY, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
}

// ---------- 用户绑定钥匙（v2 便携备份） ----------
// 以「用户的密码/助记词」派生一把 AES 包裹钥匙，把库钥匙加密成密文装进备份包。
// 这样备份包不再依赖服务端主密钥：换台电脑、.env 完全不一样，只要本人知道密码/助记词即可解包。
// 规则：密码原样参与派生；助记词先归一化(只留汉字,兼容序号/空格)再派生，保证两边一致。
function deriveBundleWrapKey(secret) {
  return crypto.createHash('sha256').update('bundle:' + secret).digest();
}

// wrapPlainKeyBySecret(plainKey, secret) -> base64(iv).base64(tag).base64(密文)
function wrapKeyBySecret(plainKey, secret) {
  const wKey = deriveBundleWrapKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', wKey, iv);
  const enc = Buffer.concat([cipher.update(plainKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map(b => b.toString('base64')).join('.');
}

function unwrapKeyBySecret(wrapped, secret) {
  const [ivB, tagB, encB] = wrapped.split('.');
  const wKey = deriveBundleWrapKey(secret);
  const decipher = crypto.createDecipheriv('aes-256-gcm', wKey, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
}

// 从 v2 备份包里解出库钥匙：明文 key（无密码账号）优先级最高，否则用密码或助记词任一对上即可（AES-GCM 校验失败的密文在 try 里直接跳过）。
function decryptBundleKey({ key, wrappedByPassword, wrappedByMnemonic, password, mnemonic }) {
  if (key) return key;
  if (wrappedByPassword && password) {
    try { return unwrapKeyBySecret(wrappedByPassword, password); } catch (_) { /* 密码不对，尝试助记词 */ }
  }
  if (wrappedByMnemonic && mnemonic) {
    try { return unwrapKeyBySecret(wrappedByMnemonic, normalizePhrase(mnemonic)); } catch (_) { /* 助记词不对 */ }
  }
  throw new Error('无法解锁备份：密码或助记词不正确');
}

function sqlKey(passphrase) {
  return passphrase.replace(/'/g, "''");
}

// ---------- 请求上下文绑定 ----------
const als = new AsyncLocalStorage();
// 缓存已打开的库连接：slug -> { db, key }
const connCache = new Map();
// 缓存连接数量上限（LRU 驱逐策略：超过上限时关闭并移出最久未使用的连接）
const CONN_CACHE_MAX = 10;

// 记录对某连接的访问（命中时刷新 LRU 顺序）
function touchConn(slug) {
  if (connCache.has(slug)) {
    const conn = connCache.get(slug);
    connCache.delete(slug);
    connCache.set(slug, conn);
  }
}

// 写入缓存，超限时按 LRU 驱逐最久未使用的连接
function setCachedConn(slug, conn) {
  connCache.set(slug, conn);
  while (connCache.size > CONN_CACHE_MAX) {
    const oldestKey = connCache.keys().next().value;
    if (oldestKey == null) break;
    const evicted = connCache.get(oldestKey);
    connCache.delete(oldestKey);
    try { evicted.close(); } catch (_) { /* 关闭失败可忽略 */ }
  }
}

// ---------- 打开/创建 单个班主任库 ----------
// （基础原语层：完整的打开/创建流程见 dbManager.conn.js）
function applyPerfPragmas(conn) {
  // WAL：读写不互斥、大幅减少 fsync；synchronous=NORMAL 兼顾安全与性能；
  // cache_size=-20000（约20MB页缓存）；busy_timeout 避免并发写互相报锁；temp_store 放内存。
  // 先设 busy_timeout 再开 WAL，避免切换日志模式期间的锁等待。
  conn.pragma('busy_timeout = 5000');
  conn.pragma('journal_mode = WAL');
  conn.pragma('synchronous = NORMAL');
  conn.pragma('cache_size = -20000');
  conn.pragma('temp_store = MEMORY');
}

function openFile(dbPath, passphrase, encrypted = true) {
  const Database = getDatabase();
  const conn = new Database(dbPath);
  // 明文库（宽松模式）没有库钥匙，不能下发 pragma key，否则会被当作加密库而打不开
  if (encrypted) conn.pragma(`key = '${sqlKey(passphrase)}'`);
  applyPerfPragmas(conn);
  return conn;
}

// ---------- index.db（主密钥加密的登记表） ----------
let indexDb = null;

function ensureIndex() {
  if (indexDb) return indexDb;
  const indexPath = path.join(dataDir, 'index.db');
  const Database = getDatabase();
  indexDb = new Database(indexPath);
  indexDb.pragma(`key = '${sqlKey(MASTER_KEY)}'`);
  applyPerfPragmas(indexDb);
  indexDb.exec(`
    CREATE TABLE IF NOT EXISTS registry (
      slug TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      wrapped_key TEXT NOT NULL,
      encrypted INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // 兼容存量 index.db：老库没有 encrypted 列，补上并默认 1（加密），保证既有库行为不变
  const cols = indexDb.prepare('PRAGMA table_info(registry)').all();
  if (!cols.some((c) => c.name === 'encrypted')) {
    indexDb.exec('ALTER TABLE registry ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 1');
  }
  return indexDb;
}

// ---------- index.db 操作 ----------
function registryFindByUsername(username) {
  ensureIndex();
  return indexDb.prepare('SELECT slug, wrapped_key, encrypted FROM registry WHERE username = ?').get(username);
}

function registryFindBySlug(slug) {
  ensureIndex();
  return indexDb.prepare('SELECT * FROM registry WHERE slug = ?').get(slug);
}

function registryUpsert(slug, username, wrappedKey, encrypted = 1) {
  ensureIndex();
  indexDb.prepare(`
    INSERT INTO registry(slug, username, wrapped_key, encrypted) VALUES (?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET username = excluded.username, wrapped_key = excluded.wrapped_key, encrypted = excluded.encrypted
  `).run(slug, username, wrappedKey, encrypted ? 1 : 0);
}

// 仅切换某库的加密标记（明文化时保留原 wrapped_key 作占位，NOT NULL 约束不允许置空）
function registrySetEncrypted(slug, encrypted) {
  ensureIndex();
  indexDb.prepare('UPDATE registry SET encrypted = ? WHERE slug = ?').run(encrypted ? 1 : 0, slug);
}

// 从 index 登记表移除账号（删除账号用）
function registryDelete(slug) {
  ensureIndex();
  indexDb.prepare('DELETE FROM registry WHERE slug = ?').run(slug);
}

// 列出所有已登记的班主任账号（供登录页「从数据库注册」加载账号）
function registryList() {
  ensureIndex();
  return indexDb.prepare('SELECT slug, username FROM registry ORDER BY created_at').all();
}

module.exports = {
  getDatabase,
  MASTER_KEY,
  WRAP_KEY,
  dataDir,
  ensureDir,
  uploadsDir,
  backgroundDir,
  thumbsDir,
  trashDir,
  snapshotsDirRoot,
  snapshotsDir,
  wrapKey,
  unwrapKey,
  wrapKeyBySecret,
  decryptBundleKey,
  sqlKey,
  als,
  connCache,
  CONN_CACHE_MAX,
  touchConn,
  setCachedConn,
  applyPerfPragmas,
  openFile,
  ensureIndex,
  registryFindByUsername,
  registryFindBySlug,
  registryUpsert,
  registrySetEncrypted,
  registryDelete,
  registryList,
};
