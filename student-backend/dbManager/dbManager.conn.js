// =========================================================================
// dbManager.conn.js —— 多库加密核心·连接管理
// （原 dbManager.js 按职责拆分而来，纯代码搬运，行为不变）
//   打开/缓存/驱逐单个班主任库连接、请求上下文取库、后台暖机
// =========================================================================

const path = require('path');
const { initSchema } = require('../schema/schema');
const {
  dataDir, als, connCache, touchConn, setCachedConn, ensureIndex,
  openFile, registryFindBySlug, unwrapKey,
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

// 绑定：在请求上下文内设置当前班主任库 slug，并解析出连接放入上下文缓存
function withDb(slug, fn) {
  const rec = registryFindBySlug(slug);
  if (!rec) throw new Error('库不存在');
  const encrypted = rec.encrypted !== 0;
  const passphrase = encrypted ? unwrapKey(rec.wrapped_key) : null;
  const conn = getConn(slug, passphrase, encrypted);
  return als.run({ slug, conn }, () => fn({ slug, conn }));
}

// 后端就绪后的后台暖机：把一次性冷启动成本（require 原生 sqlite 模块、打开 index.db）
// 放到 listen 就绪信号之后、用户首个请求到达之前悄悄完成，消除登录/首屏的等待。
// 暖机失败不抛出，正常走懒加载兜底（与原先行为一致）。
function warmup() {
  try {
    ensureIndex();
  } catch (_) { /* 暖机失败不影响正常懒加载路径 */ }
}

module.exports = { getConn, evictConn, current, withDb, warmup };
