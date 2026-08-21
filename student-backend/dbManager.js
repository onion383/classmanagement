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
//   - 旧单库：保留为默认库 slug = 'default'，其库密钥即原 DB_KEY，首次启动时自动登记进 index.db。
// =========================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const Database = require('better-sqlite3-multiple-ciphers');
const { initSchema } = require('./schema');
const { normalizePhrase } = require('./services/recoveryKey');

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

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

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

// 从 v2 备份包里解出库钥匙：密码或助记词任一对上即可（AES-GCM 校验失败的密文在 try 里直接跳过）。
function decryptBundleKey({ wrappedByPassword, wrappedByMnemonic, password, mnemonic }) {
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
// 缓存「default」的库连接
let defaultConn = null;

// ---------- index.db（主密钥加密的登记表） ----------
let indexDb = null;

function ensureIndex() {
  if (indexDb) return indexDb;
  const indexPath = path.join(dataDir, 'index.db');
  indexDb = new Database(indexPath);
  indexDb.pragma(`key = '${sqlKey(MASTER_KEY)}'`);
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
function openFile(dbPath, passphrase) {
  const conn = new Database(dbPath);
  conn.pragma(`key = '${sqlKey(passphrase)}'`);
  return conn;
}

// 打开（或打开后初始化）某个 slug 对应的库并缓存
function getConn(slug, passphrase) {
  if (connCache.has(slug)) return connCache.get(slug);
  const conn = openFile(path.join(dataDir, `${slug}.db`), passphrase);
  initSchema(conn);
  connCache.set(slug, conn);
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

// ---------- 请求内取当前库 ----------
function current() {
  const ctx = als.getStore();
  if (ctx && ctx.slug && connCache.has(ctx.slug)) return connCache.get(ctx.slug);
  return getDefault();
}

// 绑定：在请求上下文内设置当前班主任库 slug，并解析出连接放入上下文缓存
function withDb(slug, fn) {
  const rec = registryFindBySlug(slug);
  if (!rec) throw new Error('库不存在');
  const passphrase = unwrapKey(rec.wrapped_key);
  const conn = getConn(slug, passphrase);
  return als.run({ slug, conn }, () => fn({ slug, conn }));
}

// ---------- 默认库（旧单库 -> default） ----------
let DEFAULT_SLUG = 'default';
let DB_KEY = process.env.DB_KEY || '';

// 初始化默认库：用 DB_KEY 打开旧 database.db，并确保其在 index.db 中登记为 default。
function initDefault() {
  const dbPath = path.join(dataDir, 'database.db');
  // 若从未登记 default，则把旧库密钥登记进 index，保证登录定位可用
  if (!DB_KEY) {
    throw new Error('未配置默认库密钥 DB_KEY（请设置环境变量或 student-backend/.env）');
  }
  const conn = openFile(dbPath, DB_KEY);
  initSchema(conn);
  // 旧库 users 表迁移：补充 db_slug / recovery_hash 列
  {
    const cols = conn.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    if (!cols.includes('db_slug')) conn.exec(`ALTER TABLE users ADD COLUMN db_slug TEXT DEFAULT ''`);
    if (!cols.includes('recovery_hash')) conn.exec(`ALTER TABLE users ADD COLUMN recovery_hash TEXT DEFAULT ''`);
  }
  // 旧库账号迁移：把 admin 的 db_slug 指向 default
  conn.prepare('UPDATE users SET db_slug = ? WHERE db_slug IS NULL OR db_slug = \'\'').run(DEFAULT_SLUG);
  connCache.set(DEFAULT_SLUG, conn);
  defaultConn = conn;

  registryUpsert(DEFAULT_SLUG, 'admin', wrapKey(DB_KEY));
  // 兼容旧库中已有的 admin（若 db_slug 已被更新为 default，则无需再次登记账号）；
  // 若旧库存在 admin 但 index 中 default 已登记，保持一致性。
  return conn;
}

function getDefault() {
  if (!defaultConn) initDefault();
  return defaultConn;
}

// 库文件路径：默认库 default 落盘为 database.db（旧单库），其余 slug 为 ${slug}.db
function dbFilePath(slug) {
  return path.join(dataDir, slug === DEFAULT_SLUG ? 'database.db' : `${slug}.db`);
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
  if (!/^@[0-9a-f]{12}$/.test(slug) && slug !== DEFAULT_SLUG) {
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
    if (slug === DEFAULT_SLUG) defaultConn = null;
  }
  return { slug };
}

module.exports = {
  ensureIndex,
  createTeacher,
  resolveByUsername,
  registryFindByUsername,
  registryFindBySlug,
  wrapKey,
  unwrapKey,
  wrapKeyBySecret,
  decryptBundleKey,
  initDefault,
  getDefault,
  current,
  withDb,
  exportBundle,
  restoreBundle,
  registryList,
};