const { db, getFields } = require('../../db');

// 列值归一化：对象/数组按 JSON 文本、布尔按 1/0、其余按字符串，用于「是否与当前内容相同」的比较。
// 布尔归一为 1/0 是为了与 sqlite 里 INTEGER 列（如 toolbox_enabled / auto_apply）存的数值一致。
function normColVal(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  const t = s.trim();
  if (t.startsWith('[') || t.startsWith('{')) {
    try { const p = JSON.parse(t); if (p && typeof p === 'object') return JSON.stringify(p); } catch (_) { /* 非 JSON 文本 */ }
  }
  return s;
}

// 写库时序列化列值：对象/数组须转成 JSON 文本（sqlite 不能直接绑定对象），
// 布尔转为 1/0（否则会被当文本写入，破坏 INTEGER 列语义）。
function serializeColVal(v) {
  if (v != null && typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

// 表列名缓存（PRAGMA 一次后复用，避免每个请求都读 schema）
const colCache = {};
function tableColumns(table) {
  if (colCache[table]) return colCache[table];
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  colCache[table] = cols;
  return cols;
}

// 表在列表页「实际展示的列」（与界面保持一致）：优先取 table_meta 中登记的列；
// 未登记时退回「除 id / position 外的所有列」——避免把 position、外键、created_at 等内部列露出来。
function displayColumns(table) {
  const fields = getFields(table);
  if (fields && fields.length) return fields.map((f) => f.name);
  return tableColumns(table).filter((c) => c !== 'id' && c !== 'position');
}


module.exports = { normColVal, serializeColVal, tableColumns, displayColumns };
