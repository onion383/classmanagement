// =========================================================================
// dbManager.conn.js —— 多库加密核心·连接管理
// （原 dbManager.js 按职责拆分而来，纯代码搬运，行为不变）
//   打开/缓存/驱逐单个班主任库连接、请求上下文取库、后台暖机
// =========================================================================

const path = require('path');
const { initSchema } = require('../schema/schema');
const {
  dataDir, als, connCache, touchConn, setCachedConn, ensureIndex,
  openFile, registryFindBySlug, unwrapKey, getUnlockedKey, clearUnlockedKey,
  beginConnUse, endConnUse,
} = require('./dbManager.base');

// 打开（或打开后初始化）某个 slug 对应的库并缓存
function getConn(slug, passphrase, encrypted = true) {
  if (connCache.has(slug)) {
    touchConn(slug);
    return connCache.get(slug);
  }
  const conn = openFile(path.join(dataDir, `${slug}.db`), passphrase, encrypted);
  initSchema(conn);
  setCachedConn(slug, conn);
  return conn;
}

// 关闭并移出某库的缓存连接（加密转换等需要独占文件句柄的场景使用）
function evictConn(slug) {
  if (connCache.has(slug)) {
    const conn = connCache.get(slug);
    try { conn.close(); } catch (_) { /* 关闭失败可忽略 */ }
    connCache.delete(slug);
  }
}

// ---------- 请求内取当前库 ----------
function current() {
  const ctx = als.getStore();
  if (ctx && ctx.slug && connCache.has(ctx.slug)) return connCache.get(ctx.slug);
  // 未通过 auth 中间件绑定库（如未登录直接访问业务接口）即拒绝访问
  throw new Error('未绑定数据库连接');
}

// 当前请求绑定的库标识（slug）。
// 用途：相册缩略图按库隔离目录 —— 各库的 album_photos.id 都从 1 开始自增，
// 若缩略图文件只按 {photoId}.jpg 命名并共用一个目录，不同库会互相覆盖（串图）。
// slug 在 withDb 里写入 ALS 上下文，故请求内随时可取。
function currentSlug() {
  const ctx = als.getStore();
  return (ctx && ctx.slug) || '';
}

// 绑定：在请求上下文内设置当前班主任库 slug，并解析出连接放入上下文缓存
function withDb(slug, fn) {
  const rec = registryFindBySlug(slug);
  if (!rec) throw new Error('库不存在');
  const encrypted = rec.encrypted !== 0;
  let passphrase = null;
  if (encrypted) {
    if (rec.protect === 1) {
      // 超级隐私模式：库钥匙只能来自本次登录解锁的内存表，主密钥拿不到
      passphrase = getUnlockedKey(slug);
      if (!passphrase) {
        const err = new Error('数据库已锁定，请重新登录');
        err.code = 'DB_LOCKED';
        throw err;
      }
    } else {
      passphrase = unwrapKey(rec.wrapped_key);
    }
  }
  const conn = getConn(slug, passphrase, encrypted);
  return als.run({ slug, conn }, () => {
    // 标记「本请求正在使用该连接」：连接缓存的 LRU 驱逐会跳过在用连接，
    // 避免并发切换库时把仍在执行查询的连接 close() 掉（B04-01）。
    beginConnUse(slug);
    const done = () => endConnUse(slug);
    let out;
    try {
      out = fn({ slug, conn });
    } catch (err) {
      done();
      throw err;
    }
    // 路由处理函数可能是 async：等它真正结束（含异常）后再减少计数
    if (out && typeof out.then === 'function') return Promise.resolve(out).finally(done);
    done();
    return out;
  });
}

// 锁定某库：关闭连接缓存并丢弃内存里的库钥匙（登出时调用）
function lockDb(slug) {
  if (!slug) return;
  evictConn(slug);
  clearUnlockedKey(slug);
}

// 后端就绪后的后台暖机：把一次性冷启动成本（require 原生 sqlite 模块、打开 index.db）
// 放到 listen 就绪信号之后、用户首个请求到达之前悄悄完成，消除登录/首屏的等待。
// 暖机失败不抛出，正常走懒加载兜底（与原先行为一致）。
function warmup() {
  try {
    ensureIndex();
  } catch (_) { /* 暖机失败不影响正常懒加载路径 */ }
}

module.exports = { getConn, evictConn, current, currentSlug, withDb, lockDb, warmup };
