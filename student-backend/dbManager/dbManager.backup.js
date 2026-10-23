// =========================================================================
// dbManager.backup.js —— 多库加密核心·备份与迁移
// （原 dbManager.js 按职责拆分而来，纯代码搬运，行为不变）
//   库文件路径 / 导出包组装 / 备份恢复落盘 / 就地切换落盘加密方式
// =========================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  getDatabase, dataDir, wrapKey, unwrapKey, sqlKey,
  registryFindBySlug, registryUpsert, registrySetEncrypted,
  getUnlockedKey,
} = require('./dbManager.base');
const { evictConn } = require('./dbManager.conn');

// 库文件路径：每个班主任库独立落盘为 ${slug}.db（slug 形如 @xxxxxxxxxxxx）
function dbFilePath(slug) {
  return path.join(dataDir, `${slug}.db`);
}

// 供备份/导出：返回当前 slug 对应库文件路径与密钥
function exportBundle(slug) {
  const rec = registryFindBySlug(slug);
  if (!rec) throw new Error('库不存在');
  const encrypted = rec.encrypted !== 0;
  return {
    slug,
    username: rec.username,
    wrappedKey: rec.wrapped_key,
    filePath: dbFilePath(slug),
    encrypted,
    // 明文库没有库钥匙（数据本身不加密），key 为 null
    // 超级隐私模式：wrapped_key 为空，只能取本次登录解锁后留在内存里的库钥匙
    key: encrypted
      ? (rec.protect === 1 ? (getUnlockedKey(slug) || (() => { throw new Error('数据库已锁定，请重新登录'); })()) : unwrapKey(rec.wrapped_key))
      : null,
  };
}

// 供备份/恢复：写入教师库文件并在 index 登记（幂等）。
// 参数 dbKey 为「已解出的库钥匙」（明文，仅加密库需要）——由调用方用密码/助记词解出的，本处只负责落盘与登记。
// encrypted=false 表示恢复的是一个明文库，不包裹库钥匙、登记为明文。
function restoreBundle({ slug, username, data, dbKey, encrypted = true }) {
  if (!slug || !username || typeof data !== 'string') {
    throw new Error('备份数据不完整');
  }
  if (encrypted && !dbKey) {
    throw new Error('备份数据不完整');
  }
  // 强约束 slug：仅允许 @ 开头 + 十六进制的内部格式，防止路径穿越/覆盖其它库
  if (!/^@[0-9a-f]{12}$/.test(slug)) {
    throw new Error('非法的库标识');
  }
  const filePath = dbFilePath(slug);
  fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
  // 覆盖 .db 后必须清掉同名的 -wal/-shm 残留，否则旧库的日志会被 New 库重放导致损坏
  for (const suffix of ['-wal', '-shm']) {
    try { fs.rmSync(filePath + suffix, { force: true }); } catch (_) { /* 忽略 */ }
  }
  // 用本机主密钥重新包裹库钥匙后登记，后续登录走常规主密钥路径即可打开；
  // 明文库无需钥匙，wrapped_key 留空占位（NOT NULL 约束）
  registryUpsert(slug, username, encrypted ? wrapKey(dbKey) : '', encrypted ? 1 : 0);
  evictConn(slug);
  return { slug };
}

// ---------- 就地切换单个库的落盘加密方式（加密 <-> 明文） ----------
// 只作用于传入 slug 对应的那一个库，绝不触碰其它账号。
// 严格顺序：关闭连接 → 退出 WAL → 预检完整性 → 备份 → rekey → 转换后校验 → 回写登记 → 删备份；
// 任一步失败即从备份还原原库文件并保持原登记状态，绝不留下半加密/半明文的中间态。
// rekey 是 SQLCipher 的同步阻塞操作，因此本函数由后端执行；进度只到步骤级（无字节级回报）。
// 函数为 async：每上报一步就让出事件循环一次（tick），否则后续同步的 rekey 会把已写入的
// 进度一并阻塞到结束时才送达，进度窗口将看不到中间步骤。
async function convertDbEncryption(slug, encrypt, onProgress) {
  const rec = registryFindBySlug(slug);
  if (!rec) throw new Error('库不存在');
  const dbPath = dbFilePath(slug);
  if (!fs.existsSync(dbPath)) throw new Error('数据库文件不存在');

  const wasEncrypted = rec.encrypted !== 0;
  const targetEncrypted = !!encrypt;
  if (wasEncrypted === targetEncrypted) return { changed: false, encrypted: targetEncrypted };

  const report = (phase, detail, percent) => { if (onProgress) onProgress({ phase, detail, percent }); };
  const tick = () => new Promise((r) => setImmediate(r));
  const Database = getDatabase();
  const oldKey = wasEncrypted ? unwrapKey(rec.wrapped_key) : null;
  const newKey = targetEncrypted ? crypto.randomBytes(32).toString('hex') : null;
  const backupPath = `${dbPath}.rekey-backup`;

  const cleanSidecars = () => {
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(dbPath + suffix, { force: true }); } catch (_) { /* 忽略 */ }
    }
  };
  const integrityOk = (conn) => {
    const r = conn.pragma('integrity_check');
    const first = Array.isArray(r) ? (r[0] && (r[0].integrity_check || Object.values(r[0])[0])) : r;
    return String(first).toLowerCase() === 'ok';
  };
  // 以「无 WAL」方式打开：rekey 必须在非 WAL 模式下进行；key 为 null 表示明文库不开加密。
  const openRaw = (key) => {
    const conn = new Database(dbPath);
    if (key != null) conn.pragma(`key = '${sqlKey(key)}'`);
    try { conn.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) { /* 非 WAL 模式无 WAL 可 checkpoint */ }
    conn.pragma('journal_mode = DELETE');
    return conn;
  };

  // 先驱逐缓存连接（含 auth 中间件为本次请求打开的连接），确保转换期间本库无其它句柄
  evictConn(slug);

  let conn = null;
  try {
    // 1) 预检：原库能打开且完整
    report('校验文件', '正在校验当前数据库完整性', 5);
    await tick();
    conn = openRaw(oldKey);
    if (!integrityOk(conn)) throw new Error('当前数据库完整性校验未通过');
    conn.close();
    conn = null;

    // 2) 备份原库主文件（已退出 WAL，无 -wal/-shm 需一并备份）
    report('校验文件', '正在备份原数据库', 30);
    await tick();
    fs.copyFileSync(dbPath, backupPath);

    // 3) rekey：加密→明文用空串；明文→加密用新生成的随机库钥匙
    report('转换数据库', targetEncrypted ? '正在为数据库启用加密' : '正在移除数据库加密', 40);
    await tick();
    conn = openRaw(oldKey);
    conn.pragma(`rekey = '${sqlKey(targetEncrypted ? newKey : '')}'`);
    conn.close();
    conn = null;

    // 4) 转换后校验：用新状态重新打开并做完整性检查
    report('校验文件', '正在校验转换结果', 75);
    await tick();
    conn = openRaw(targetEncrypted ? newKey : null);
    if (!integrityOk(conn)) throw new Error('转换后完整性校验未通过');
    conn.close();
    conn = null;

    // 5) 回写登记表（唯一的状态持久化点）
    report('校验文件', '正在更新账号登记', 90);
    await tick();
    if (targetEncrypted) registryUpsert(slug, rec.username, wrapKey(newKey), 1);
    else registrySetEncrypted(slug, 0); // 明文库保留原 wrapped_key 作占位

    // 6) 清理备份与可能残留的 WAL/SHM
    try { fs.rmSync(backupPath, { force: true }); } catch (_) { /* 忽略 */ }
    cleanSidecars();
    report('校验文件', '转换完成', 100);
    await tick();
    return { changed: true, encrypted: targetEncrypted };
  } catch (err) {
    try { if (conn) conn.close(); } catch (_) { /* 忽略 */ }
    // 失败回滚：从备份还原原库文件，登记状态保持原样（备份删除失败则保留供人工处理）
    try {
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, dbPath);
        fs.rmSync(backupPath, { force: true });
        cleanSidecars();
      }
    } catch (_) { /* 回滚异常时保留备份文件，不掩盖原始错误 */ }
    throw err;
  }
}

module.exports = { dbFilePath, exportBundle, restoreBundle, convertDbEncryption };
