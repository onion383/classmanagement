// =========================================================================
// dbManager.js —— 多库加密核心
//
// 设计要点（对应需求「多库加密」）：
//   1. 每个班主任一个「自含加密库」：业务数据 + 应用设置 + 账号(含恢复密钥) 同库。
//   2. 服务端维护 index.db（主密钥加密），登记每个班主任库：
//        slug / 账号 / 库密钥(用主密钥包裹)。
//   3. 登录时用 index.db 定位账号 -> 解开库密钥 -> 打开对应班主任库 -> 校验密码。
//   4. 用 AsyncLocalStorage 把「当前请求所属的班主任库」绑定到请求上下文，
//      已有的 db.prepare(...) / tableService 等代码无需逐个改造即可命中正确库。
//
// 密钥约定：
//   - 主密钥 DB_MASTER_KEY：环境变量或 student-backend/.env，用于解密 index.db 与包裹库密钥。禁止硬编码。
//   - 库密钥：每个班主任库独立生成的随机密钥（32 字节 hex），用主密钥 AES-256-GCM 包裹后存入 index.db。
// =========================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { initSchema } = require('./schema');
const { normalizePhrase } = require('./services/recoveryKey');

// 原生模块懒加载：后端子进程启动时不加载 .node 二进制，首次真正需要打开
// 数据库时才 require，缩短 app.listen 就绪信号的时间，让主窗口更早出现。
let Database = null;
function getDatabase() {
  if (!Database) Database = require('better-sqlite3-multiple-ciphers');
  return Database;
}

// 加载 .env（若存在），使密钥可从配置文件读取而不硬编码
(function loadEnvFile() {
  const envFile = path.join(__dirname, '.env');
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

// 数据目录优先取环境变量（打包后由 Electron 主进程指向 userData），兜底用本目录 data
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return indexDb;
}

// ---------- 打开/创建 单个班主任库 ----------
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

function openFile(dbPath, passphrase) {
  const Database = getDatabase();
  const conn = new Database(dbPath);
  conn.pragma(`key = '${sqlKey(passphrase)}'`);
  applyPerfPragmas(conn);
  return conn;
}

// 打开（或打开后初始化）某个 slug 对应的库并缓存
function getConn(slug, passphrase) {
  if (connCache.has(slug)) {
    touchConn(slug);
    return connCache.get(slug);
  }
  const conn = openFile(path.join(dataDir, `${slug}.db`), passphrase);
  initSchema(conn);
  setCachedConn(slug, conn);
  return conn;
}

// ---------- index.db 操作 ----------
function registryFindByUsername(username) {
  ensureIndex();
  return indexDb.prepare('SELECT slug, wrapped_key FROM registry WHERE username = ?').get(username);
}

function registryFindBySlug(slug) {
  ensureIndex();
  return indexDb.prepare('SELECT * FROM registry WHERE slug = ?').get(slug);
}

function registryUpsert(slug, username, wrappedKey) {
  ensureIndex();
  indexDb.prepare(`
    INSERT INTO registry(slug, username, wrapped_key) VALUES (?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET username = excluded.username, wrapped_key = excluded.wrapped_key
  `).run(slug, username, wrappedKey);
}

// 列出所有已登记的班主任账号（供登录页「从数据库注册」加载账号）
function registryList() {
  ensureIndex();
  return indexDb.prepare('SELECT slug, username FROM registry ORDER BY created_at').all();
}

// 类似 registryList，但只返回「数据库有效」的账号：需满足
//   1) 库钥匙能用当前主密钥解包（unwrapKey 不抛错）
//   2) 对应库文件能正常打开
//   3) 库内 users 表确实存在该账号行
// 任一不满足（如主密钥变更后旧库打不开、登记残留的幽灵账号）即视为无效，从登录列表隐藏。
function registryListValid() {
  const valid = [];
  for (const rec of registryList()) {
    try {
      const resolved = resolveByUsername(rec.username);
      if (!resolved) continue; // 登记表有账号但缺 slug 映射
      const row = resolved.conn.prepare('SELECT 1 FROM users WHERE username = ?').get(rec.username);
      if (row) valid.push({ slug: rec.slug, username: rec.username });
    } catch (err) {
      // 主密钥不匹配 / 库文件损坏 / 打开失败 → 该数据库无效，跳过
      console.warn('[registry] 账号无效，已过滤:', rec.username, '-', err.message);
    }
  }
  return valid;
}

// 新建一个班主任库：生成 slug + 随机库密钥 + 建库 + 建账号 + 登记 index。
// 返回 { slug }
function createTeacher(username, passwordHash, role) {
  const slug = '@' + crypto.randomBytes(6).toString('hex');
  const passphrase = crypto.randomBytes(32).toString('hex');
  const db = openFile(path.join(dataDir, `${slug}.db`), passphrase);
  initSchema(db);
  db.prepare('INSERT INTO users (id, username, password, role, db_slug) VALUES (1, ?, ?, ?, ?)')
    .run(username, passwordHash, role, slug);
  db.close();

  registryUpsert(slug, username, wrapKey(passphrase));
  return { slug };
}

// 通过账号定位并打开其对应的班主任库（供登录 / 忘记密码使用）。
// 返回 { slug, conn }；账号不存在返回 null。
function resolveByUsername(username) {
  const rec = registryFindByUsername(username);
  if (!rec) return null;
  const passphrase = unwrapKey(rec.wrapped_key);
  return { slug: rec.slug, conn: getConn(rec.slug, passphrase) };
}

// 「从数据库文件登录」：根据用户选中的库文件名（@xxxx.db）定位本机
// 已登记库，解包钥匙并打开，返回该库内的账号。外来/无登记或本地解不开的库会抛错（
// 此时引导用户走备份恢复导入 .json 包）。仅传文件名作定位，不读取文件内容。
function resolveByDbFile(filename) {
  // 仅文件名作定位：班主任库名为 @xxxx（十二位十六进制）；去掉 .db 后缀即 slug。
  let slug = filename.endsWith('.db') ? filename.slice(0, -3) : filename;
  const rec = registryFindBySlug(slug);
  if (!rec) throw new Error('本机未找到该数据库登记，若为换机/外来库请使用“从备份恢复”导入');
  const passphrase = unwrapKey(rec.wrapped_key);
  const conn = getConn(slug, passphrase); // 打开失败(钥匙不匹配)会在此抛错
  const row = conn.prepare('SELECT username FROM users ORDER BY id LIMIT 1').get();
  if (!row) throw new Error('该数据库内没有可用账号');
  return { slug, username: row.username };
}

// ---------- 请求内取当前库 ----------
function current() {
  const ctx = als.getStore();
  if (ctx && ctx.slug && connCache.has(ctx.slug)) return connCache.get(ctx.slug);
  // 未通过 auth 中间件绑定库（如未登录直接访问业务接口）即拒绝访问
  throw new Error('未绑定数据库连接');
}

// 绑定：在请求上下文内设置当前班主任库 slug，并解析出连接放入上下文缓存
function withDb(slug, fn) {
  const rec = registryFindBySlug(slug);
  if (!rec) throw new Error('库不存在');
  const passphrase = unwrapKey(rec.wrapped_key);
  const conn = getConn(slug, passphrase);
  return als.run({ slug, conn }, () => fn({ slug, conn }));
}

// 库文件路径：每个班主任库独立落盘为 ${slug}.db（slug 形如 @xxxxxxxxxxxx）
function dbFilePath(slug) {
  return path.join(dataDir, `${slug}.db`);
}

// 供备份/导出：返回当前 slug 对应库文件路径与密钥
function exportBundle(slug) {
  const rec = registryFindBySlug(slug);
  if (!rec) throw new Error('库不存在');
  return {
    slug,
    username: rec.username,
    wrappedKey: rec.wrapped_key,
    filePath: dbFilePath(slug),
    key: unwrapKey(rec.wrapped_key),
  };
}

// 供备份/恢复：写入教师库文件并在 index 登记（幂等）。
// 参数 dbKey 为「已解出的库钥匙」（明文）——由调用方用密码/助记词解出的，本处只负责落盘与登记。
function restoreBundle({ slug, username, data, dbKey }) {
  if (!slug || !username || !dbKey || typeof data !== 'string') {
    throw new Error('备份数据不完整');
  }
  // 强约束 slug：仅允许 @ 开头 + 十六进制的内部格式，防止路径穿越/覆盖其它库
  if (!/^@[0-9a-f]{12}$/.test(slug)) {
    throw new Error('非法的库标识');
  }
  const filePath = dbFilePath(slug);
  fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
  // 用本机主密钥重新包裹库钥匙后登记，后续登录走常规主密钥路径即可打开
  registryUpsert(slug, username, wrapKey(dbKey));
  // 若该库已缓存连接，使其失效并可按新文件重建
  if (connCache.has(slug)) {
    const conn = connCache.get(slug);
    try { conn.close(); } catch (_) { /* 关闭失败可忽略 */ }
    connCache.delete(slug);
  }
  return { slug };
}

// 后端就绪后的后台暖机：把一次性冷启动成本（require 原生 sqlite 模块、打开 index.db）
// 放到 listen 就绪信号之后、用户首个请求到达之前悄悄完成，消除登录/首屏的等待。
// 暖机失败不抛出，正常走懒加载兜底（与原先行为一致）。
function warmup() {
  try {
    ensureIndex();
  } catch (_) { /* 暖机失败不影响正常懒加载路径 */ }
}

module.exports = {
  ensureIndex,
  createTeacher,
  resolveByUsername,
  resolveByDbFile,
  registryFindByUsername,
  registryFindBySlug,
  wrapKey,
  unwrapKey,
  wrapKeyBySecret,
  decryptBundleKey,
  current,
  withDb,
  exportBundle,
  restoreBundle,
  registryList,
  registryListValid,
  warmup,
  // 可写资源目录（与数据库同层，随 userData 持久化）
  dataDir,
  uploadsDir,
  backgroundDir,
  thumbsDir,
  trashDir,
};