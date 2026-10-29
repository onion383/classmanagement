// =========================================================================
// dbManager.account.js —— 多库加密核心·班主任账号
// （原 dbManager.js 按职责拆分而来，纯代码搬运，行为不变）
//   新建/删除账号、按账号或库文件定位、登录列表有效性过滤
// =========================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { initSchema } = require('../schema/schema');
const { normalizePhrase } = require('../services/recoveryKey');
const {
  dataDir, openFile, wrapKey, unwrapKey, newPrivacySalt,
  SCRYPT_PARAMS, serializeScryptParams,
  wrapKeyByPrivacySecret, unwrapKeyByPrivacySecret,
  setUnlockedKey, getUnlockedKey,
  registryFindByUsername, registryFindBySlug, registryUpsert, registryDelete, registryList,
  registrySetPrivacy, registryClearPrivacy, registrySetPasswordWrap,
} = require('./dbManager.base');
const { getConn, evictConn } = require('./dbManager.conn');

// 用「密码 / 恢复词」解出受保护库的库钥匙。密码优先，失败再试恢复词；
// 两者都对不上返回 null（由调用方转成「密码错误 / 恢复词不正确」）。
// 两份包裹各自记录 KDF 参数，解锁按登记行的参数派生（缺省回退当前默认参数）。
function unlockPrivacy(rec, { password, mnemonic } = {}) {
  if (rec.wrapped_by_password && password) {
    try {
      return {
        key: unwrapKeyByPrivacySecret(rec.wrapped_by_password, password, rec.kdf_salt, rec.kdf_params_password),
        by: 'password',
      };
    } catch (_) { /* 密码不对，继续尝试恢复词 */ }
  }
  if (rec.wrapped_by_mnemonic && mnemonic) {
    try {
      return {
        key: unwrapKeyByPrivacySecret(rec.wrapped_by_mnemonic, normalizePhrase(mnemonic), rec.mnemonic_salt, rec.kdf_params_mnemonic),
        by: 'mnemonic',
      };
    } catch (_) { /* 恢复词不对 */ }
  }
  return null;
}

function privacyError(message) {
  const err = new Error(message);
  err.code = 'PRIVACY_UNLOCK';
  return err;
}

// 类似 registryList，但只返回「数据库有效」的账号：需满足
//   1) 库钥匙能用当前主密钥解包（unwrapKey 不抛错）
//   2) 对应库文件能正常打开
//   3) 库内 users 表确实存在该账号行
// 任一不满足（如主密钥变更后旧库打不开、登记残留的幽灵账号）即视为无效，从登录列表隐藏。
function registryListValid() {
  const valid = [];
  for (const rec of registryList()) {
    // 超级隐私模式的库没有口令打不开，不能做「打开验证」；
    // 只要库文件还在就列出来，登录时再用密码/恢复词解锁。
    if (rec.protect === 1) {
      if (fs.existsSync(path.join(dataDir, `${rec.slug}.db`))) {
        valid.push({ slug: rec.slug, username: rec.username, protect: true });
      }
      continue;
    }
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
// 超级隐私模式：必须带 password 或 mnemonic，从两份口令包裹里解出库钥匙；
// 解出的钥匙只进内存表（unlockedKeys），不落盘，登出即丢。
// 返回 { slug, conn, protect, unlockedBy }；账号不存在返回 null。
function resolveByUsername(username, { password, mnemonic } = {}) {
  const rec = registryFindByUsername(username);
  if (!rec) return null;
  const encrypted = rec.encrypted !== 0;

  if (rec.protect === 1) {
    const unlocked = unlockPrivacy(rec, { password, mnemonic });
    if (!unlocked) throw privacyError(mnemonic && !password ? '恢复词不正确' : '账号或密码错误');
    setUnlockedKey(rec.slug, unlocked.key, unlocked.by);
    return {
      slug: rec.slug,
      conn: getConn(rec.slug, unlocked.key, encrypted),
      protect: true,
      unlockedBy: unlocked.by,
    };
  }

  const passphrase = encrypted ? unwrapKey(rec.wrapped_key) : null;
  return { slug: rec.slug, conn: getConn(rec.slug, passphrase, encrypted), protect: false };
}

// 当前账号是否开启超级隐私模式
function isProtected(username) {
  const rec = registryFindByUsername(username);
  return !!(rec && rec.protect === 1);
}

// 开启超级隐私模式：把现有库钥匙改用「登录密码 + 恢复词」各包裹一份，抹掉主密钥包裹。
// 调用方（路由）负责校验登录密码、生成恢复词；这里只做密钥层。
function enablePrivacy(username, { password, mnemonic }) {
  const rec = registryFindByUsername(username);
  if (!rec) throw new Error('账号不存在');
  if (rec.encrypted === 0) throw new Error('明文库无法开启超级隐私模式');
  if (rec.protect === 1) return { enabled: true, already: true };
  if (!password) throw new Error('该账号未设置登录密码，无法开启超级隐私模式');
  if (!mnemonic) throw new Error('缺少恢复词');

  const key = unwrapKey(rec.wrapped_key);
  const passwordSalt = newPrivacySalt();
  const mnemonicSalt = newPrivacySalt();
  const kdfParams = serializeScryptParams(SCRYPT_PARAMS);
  registrySetPrivacy(rec.slug, {
    passwordSalt,
    mnemonicSalt,
    kdfParamsPassword: kdfParams,
    kdfParamsMnemonic: kdfParams,
    wrappedByPassword: wrapKeyByPrivacySecret(key, password, passwordSalt, SCRYPT_PARAMS),
    wrappedByMnemonic: wrapKeyByPrivacySecret(key, normalizePhrase(mnemonic), mnemonicSalt, SCRYPT_PARAMS),
  });
  setUnlockedKey(rec.slug, key);
  return { enabled: true, slug: rec.slug };
}

// 关闭超级隐私模式：用密码解出库钥匙，改回主密钥包裹（恢复自动解锁）。
function disablePrivacy(username, { password }) {
  const rec = registryFindByUsername(username);
  if (!rec) throw new Error('账号不存在');
  if (rec.protect !== 1) return { enabled: false };
  const unlocked = unlockPrivacy(rec, { password });
  if (!unlocked) throw privacyError('密码错误');
  registryClearPrivacy(rec.slug, wrapKey(unlocked.key));
  setUnlockedKey(rec.slug, unlocked.key);
  return { enabled: false };
}

// 改登录密码时同步换掉「密码包裹」（恢复词包裹不受影响）。
// useMemoryKey：本次会话就是用恢复词解锁的（用户已忘记旧密码），直接用内存里的库钥匙重包裹，
// 不再要求旧密码；否则必须用旧密码解包验证。
function rewrapPassword(username, { oldPassword, newPassword, useMemoryKey = false }) {
  const rec = registryFindByUsername(username);
  if (!rec || rec.protect !== 1) return { changed: false };
  let unlocked = oldPassword
    ? unlockPrivacy(rec, { password: oldPassword })
    : null;
  if (!unlocked && useMemoryKey) {
    const memKey = getUnlockedKey(rec.slug);
    if (memKey) unlocked = { key: memKey };
  }
  if (!unlocked) throw privacyError('密码错误');
  const salt = newPrivacySalt();
  // 改密码时把这份包裹升级到当前 KDF 参数；恢复词包裹仍按它自己的参数解锁
  registrySetPasswordWrap(
    rec.slug, salt,
    wrapKeyByPrivacySecret(unlocked.key, newPassword, salt, SCRYPT_PARAMS),
    serializeScryptParams(SCRYPT_PARAMS)
  );
  setUnlockedKey(rec.slug, unlocked.key);
  return { changed: true };
}

// 「从数据库文件登录」：根据用户选中的库文件名（@xxxx.db）定位本机
// 已登记库，解包钥匙并打开，返回该库内的账号。外来/无登记或本地解不开的库会抛错（
// 此时引导用户走备份恢复导入 .json 包）。仅传文件名作定位，不读取文件内容。
function resolveByDbFile(filename) {
  // 仅文件名作定位：班主任库名为 @xxxx（十二位十六进制）；去掉 .db 后缀即 slug。
  let slug = filename.endsWith('.db') ? filename.slice(0, -3) : filename;
  const rec = registryFindBySlug(slug);
  if (!rec) throw new Error('本机未找到该数据库登记，若为换机/外来库请使用“从备份恢复”导入');
  if (rec.protect === 1) {
    throw new Error('该账号已开启超级隐私模式，请直接输入账号与密码（或恢复词）登录');
  }
  const encrypted = rec.encrypted !== 0;
  const passphrase = encrypted ? unwrapKey(rec.wrapped_key) : null;
  const conn = getConn(slug, passphrase, encrypted); // 打开失败(钥匙不匹配)会在此抛错
  const row = conn.prepare('SELECT username FROM users ORDER BY id LIMIT 1').get();
  if (!row) throw new Error('该数据库内没有可用账号');
  return { slug, username: row.username };
}

module.exports = {
  registryListValid, createTeacher, deleteTeacher, resolveByUsername, resolveByDbFile,
  isProtected, enablePrivacy, disablePrivacy, rewrapPassword,
};
