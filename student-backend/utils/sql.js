// =========================================================================
// utils/sql.js —— 路由公共 SQL 小工具
//
// 各业务路由大量重复「时间戳 / 字段白名单清洗 / INSERT·UPDATE 拼装 / 取最大 position」
// 这些样板逻辑，统一收敛到这里，行为与原先各文件内的本地实现完全一致。
// =========================================================================

const { db, getFields } = require('../db');
const { sanitizeField } = require('../services/sanitize');
const { validateRow } = require('../services/businessRules');

// 统一时间戳：YYYY-MM-DD HH:mm
function now() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 列名 → 类型（取自 table_meta；没有 table_meta 的表默认「文字」）
function typeMapOf(table) {
  const map = {};
  if (!table) return map;
  try {
    for (const f of getFields(table)) map[f.name] = f.type || '文字';
  } catch (_) { /* 表无 table_meta 时按「文字」处理 */ }
  return map;
}

// 按白名单从请求体中挑出可写字段，并做清洗与业务校验（文本/类型/枚举/数值范围/日期/路径/JSON 形状；空串 → null）
function cleanUp(data, editable, table) {
  const typeMap = typeMapOf(table);
  const row = {};
  editable.forEach(k => {
    if (data[k] !== undefined) row[k] = sanitizeField(data[k], table, k, typeMap[k]);
  });
  // 依赖既有数据的跨列校验（如请假「结束时间」必须晚于「开始时间」）
  validateRow(table, row, null);
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

// YYYY-MM-DD 且是真实存在的日期。
// 快照接口此前只校验「非空」，任意字符串都能入库，mondayOf/parseDateStr 会把它
// 解析成 NaN 日期（'NaN-NaN-NaN'），历史列表出现无法删除的幽灵周。
// 除了格式，还要拒绝 2026-02-30 这类「格式对但日期不存在」的输入。
function isDateStr(value) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00`);
  if (isNaN(d.getTime())) return false;
  return d.getFullYear() === Number(s.slice(0, 4))
    && d.getMonth() + 1 === Number(s.slice(5, 7))
    && d.getDate() === Number(s.slice(8, 10));
}

module.exports = { now, isDateStr, cleanUp, maxPosition, buildInsert, buildUpdate };