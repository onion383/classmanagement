// =========================================================================
// utils/sql.js —— 路由公共 SQL 小工具
//
// 各业务路由大量重复「时间戳 / 字段白名单清洗 / INSERT·UPDATE 拼装 / 取最大 position」
// 这些样板逻辑，统一收敛到这里，行为与原先各文件内的本地实现完全一致。
// =========================================================================

const { db } = require('../db');

// 统一时间戳：YYYY-MM-DD HH:mm
function now() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 按白名单从请求体中挑出可写字段；空串/null 归一为 null
function cleanUp(data, editable) {
  const row = {};
  editable.forEach(k => {
    if (data[k] !== undefined) row[k] = (data[k] === '' || data[k] === null) ? null : data[k];
  });
  return row;
}

// 取某表当前最大 position（空表返回 0）
function maxPosition(table) {
  return db.prepare(`SELECT MAX(position) AS maxPos FROM ${table}`).get().maxPos || 0;
}

// 以 data 的键构造并执行 INSERT，返回 better-sqlite3 的 run 结果
function buildInsert(table, data) {
  const cols = Object.keys(data).map(c => `"${c}"`).join(',');
  const ph = Object.keys(data).map(() => '?').join(',');
  return db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${ph})`).run(...Object.values(data));
}

// 以 data 的键构造并执行 UPDATE ... WHERE id = ?
function buildUpdate(table, data, id) {
  const setClause = Object.keys(data).map(k => `"${k}" = ?`).join(', ');
  return db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).run(...Object.values(data), Number(id));
}

module.exports = { now, cleanUp, maxPosition, buildInsert, buildUpdate };