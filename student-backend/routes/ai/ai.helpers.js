const { db, getFields } = require('../../db');
const dbManager = require('../../dbManager/dbManager');

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

// 表列名缓存（PRAGMA 一次后复用，避免每个请求都读 schema）。
// 键里带数据库 slug：不同学生库同名表结构可能不同，不能跨库复用。
const colCache = {};
function tableColumns(table) {
  let slug = 'default';
  try { slug = dbManager.currentSlug() || 'default'; } catch (_) { /* 非请求上下文时退回 default */ }
  const key = `${slug}:${table}`;
  if (colCache[key]) return colCache[key];
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  colCache[key] = cols;
  return cols;
}

// 表结构变更（加/删/改名列）后必须主动失效，否则 PRAGMA 结果会一直停留在旧结构
function clearTableColumnsCache(table) {
  Object.keys(colCache).forEach((key) => {
    if (!table || key.endsWith(`:${table}`)) delete colCache[key];
  });
}

// 回灌给模型的工具结果上限：查询/导出类工具可能返回整张大表，
// 全量塞进 history 会撑爆上下文并让后续请求变慢甚至失败。
const MAX_TOOL_RESULT_CHARS = 12000;
function toolResultContent(result) {
  let text;
  try { text = JSON.stringify(result); } catch (_) { text = JSON.stringify({ error: '工具结果无法序列化' }); }
  if (typeof text !== 'string') text = String(text);
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return text.slice(0, MAX_TOOL_RESULT_CHARS)
    + `\n…（工具结果过长，已截断；原长度 ${text.length} 字符。需要完整数据请缩小查询范围或分页）`;
}

// 表在列表页「实际展示的列」（与界面保持一致）：优先取 table_meta 中登记的列；
// 未登记时退回「除 id / position 外的所有列」——避免把 position、外键、created_at 等内部列露出来。
function displayColumns(table) {
  const fields = getFields(table);
  if (fields && fields.length) return fields.map((f) => f.name);
  return tableColumns(table).filter((c) => c !== 'id' && c !== 'position');
}


module.exports = { normColVal, serializeColVal, tableColumns, displayColumns, clearTableColumnsCache, toolResultContent };
