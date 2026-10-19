// =========================================================================
// dbManager.account.js —— 多库加密核心·班主任账号
// （原 dbManager.js 按职责拆分而来，纯代码搬运，行为不变）
//   新建/删除账号、按账号或库文件定位、登录列表有效性过滤
// =========================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { initSchema } = require('../schema/schema');
const {
  dataDir, openFile, wrapKey, unwrapKey,
  registryFindByUsername, registryFindBySlug, registryUpsert, registryDelete, registryList,
} = require('./dbManager.base');
const { getConn, evictConn } = require('./dbManager.conn');

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

// 新建一个班主任库：生成 slug + 建库 + 建账号 + 登记 index。
// encrypted=true（默认）：生成随机库密钥并以主密钥包裹登记；encrypted=false 为宽松明文库，
// 不下发 PRAGMA key，登记 wrapped_key 占位为空串且 encrypted=0（明文库不允许密码）。
// 返回 { slug }
function createTeacher(username, passwordHash, role, encrypted = true) {
  const slug = '@' + crypto.randomBytes(6).toString('hex');
  const passphrase = encrypted ? crypto.randomBytes(32).toString('hex') : null;
  const db = openFile(path.join(dataDir, `${slug}.db`), passphrase, encrypted);
  initSchema(db);
  db.prepare('INSERT INTO users (id, username, password, role, db_slug) VALUES (1, ?, ?, ?, ?)')
    .run(username, passwordHash, role, slug);
  db.close();

  registryUpsert(slug, username, encrypted ? wrapKey(passphrase) : '', encrypted ? 1 : 0);
  return { slug };
}

// 彻底删除一个班主任账号：关闭其库连接 → 删除库文件及 WAL 边车 → 清除 index 登记。
// 顺序刻意如此：只有库文件确实删掉后才摘登记，避免出现「登记已摘、库文件仍在」的割裂；
// 若删除文件失败会抛出，此时登记与账号保持原样，用户可重试。
// 注意：uploads / 相册缩略图等为多账号共享资源，不属于单个账号，不在此清理。
function deleteTeacher(slug) {
  if (!slug || slug === 'default') throw new Error('无效的账号标识');
  evictConn(slug);
  const base = path.join(dataDir, `${slug}.db`);
  fs.rmSync(base, { force: true });
  fs.rmSync(`${base}-wal`, { force: true });
  fs.rmSync(`${base}-shm`, { force: true });
  registryDelete(slug);
}

// 通过账号定位并打开其对应的班主任库（供登录 / 忘记密码使用）。
// 返回 { slug, conn }；账号不存在返回 null。
function resolveByUsername(username) {
  const rec = registryFindByUsername(username);
  if (!rec) return null;
  const encrypted = rec.encrypted !== 0;
  const passphrase = encrypted ? unwrapKey(rec.wrapped_key) : null;
  return { slug: rec.slug, conn: getConn(rec.slug, passphrase, encrypted) };
}

// 「从数据库文件登录」：根据用户选中的库文件名（@xxxx.db）定位本机
// 已登记库，解包钥匙并打开，返回该库内的账号。外来/无登记或本地解不开的库会抛错（
// 此时引导用户走备份恢复导入 .json 包）。仅传文件名作定位，不读取文件内容。
function resolveByDbFile(filename) {
  // 仅文件名作定位：班主任库名为 @xxxx（十二位十六进制）；去掉 .db 后缀即 slug。
  let slug = filename.endsWith('.db') ? filename.slice(0, -3) : filename;
  const rec = registryFindBySlug(slug);
  if (!rec) throw new Error('本机未找到该数据库登记，若为换机/外来库请使用“从备份恢复”导入');
  const encrypted = rec.encrypted !== 0;
  const passphrase = encrypted ? unwrapKey(rec.wrapped_key) : null;
  const conn = getConn(slug, passphrase, encrypted); // 打开失败(钥匙不匹配)会在此抛错
  const row = conn.prepare('SELECT username FROM users ORDER BY id LIMIT 1').get();
  if (!row) throw new Error('该数据库内没有可用账号');
  return { slug, username: row.username };
}

module.exports = { registryListValid, createTeacher, deleteTeacher, resolveByUsername, resolveByDbFile };
