// =========================================================================
// db.js —— 统一的数据库接入点
//
// 多库架构下，本文件不再固定打开单一数据库，而是通过 dbManager 按请求解析：
//   - 每个请求进入时，auth 中间件会通过 dbManager.withDb(slug) 绑定当前班主任库。
//   - 这里导出的 db 是一个 **_Proxy**_：对 db.prepare / db.exec / db.transaction 等
//     所有调用的访问，都会被转发到「当前请求绑定的库连接」。
//   因此系统中各处已有的 `const { db } = require('../db') .prepare(...)` 代码
//   无需逐个修改，即可自动命中登录者对应的班主任库。
//   - 在未绑定库的请求（如登录、忘记密码）中，db 回退到默认库（旧单库 default）。
//
// 兼容性说明：better-sqlite3 的 prepare/exec/transaction 都是「方法」，Proxy 的
// get 会把函数 this 绑定到当前连接，保证内部状态正确。
// =========================================================================

const dbManager = require('./dbManager');

// 解析当前请求对应的数据库连接（登录前回退默认库）
function currentDb() {
  return dbManager.current();
}

// 统一代理：所有属性/方法访问转发到当前库
const db = new Proxy({}, {
  get(_target, prop) {
    const conn = currentDb();
    if (conn == null) return undefined;
    const value = conn[prop];
    if (typeof value === 'function') {
      return value.bind(conn);
    }
    return value;
  },
  set(_target, prop, val) {
    const conn = currentDb();
    if (conn) conn[prop] = val;
    return true;
  },
});

// 与 db 代理等价、但始终绑定「默认库（default）」的连接（供不依赖登录上下文的场景）
// 惰性获取，避免加载阶段因密钥未配置而崩溃
function getDefaultDb() {
  return dbManager.getDefault();
}
const defaultDb = new Proxy({}, {
  get(_target, prop) {
    const conn = dbManager.getDefault();
    if (conn == null) return undefined;
    const value = conn[prop];
    if (typeof value === 'function') return value.bind(conn);
    return value;
  },
});

// ======================== 元数据/排序 工具（作用于当前库） ========================
function getFields(tableName) {
  const conn = currentDb();
  return conn.prepare(`SELECT column_name AS name, data_type AS type FROM table_meta WHERE table_name = ? ORDER BY sort_order`).all(tableName);
}

function renumber(tableName) {
  const conn = currentDb();
  const rows = conn.prepare(`SELECT id FROM ${tableName} ORDER BY position, id`).all();
  const stmt = conn.prepare(`UPDATE ${tableName} SET position = ? WHERE id = ?`);
  rows.forEach((r, i) => stmt.run(i + 1, r.id));
}

// 启动最小化：不再在 require 时预热默认库（打开加密库 + initSchema 全量建表/建索引）。
// 改由首次真正访问时懒初始化（见 dbManager 的 defaultDb / getConn 懒兜底），
// 让后端更快吐出就绪信号；首次碰库时的那点建库耗时顺延到该请求上，功能与结果不变。
// 若需要立即就绪也可在此手动 initDefault()，但会拖慢启动，属可选预热。

module.exports = {
  db,
  getFields,
  renumber,
  defaultDb,
  dbManager,
  _current: currentDb,
};