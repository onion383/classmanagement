// JSON 列读取的统一入口。
//
// 背景：座位表 / 课表 / 设置这类「整块 JSON」列，读取时各自裸调 JSON.parse，
// 全项目共 23 处。只要有一条记录畸形（历史 bug、外部工具改库、AI 写坏），
// 裸解析就会抛错 → 整条 GET 500 → 用户看到的是白板，而不是「这张表暂时读不出来」。
// 同一份「解析失败给默认值」的兜底此前在 duty / search / ai.dataRoutes 里逐字抄了 3 份，
// executors 里还有 2 份同形的 parseJson，这里收敛成一处。

// 解析单个 JSON 值，失败或为空时返回 fallback。
// label 只用于日志定位（通常是列名）。
function safeJson(value, fallback, label) {
  // 已经是对象/数组：部分调用方传的字段可能已解析过，原样返回，不做序列化往返
  if (value != null && typeof value === 'object') return value;
  if (value == null || value === '') return fallback;
  try {
    const v = JSON.parse(value);
    return v == null ? fallback : v;
  } catch (err) {
    console.warn(`[json] ${label || '字段'} 不是合法 JSON，按默认值处理：${err.message}`);
    return fallback;
  }
}

// 批量读取一条记录里的多个 JSON 列，返回以「输出名」为键的对象。
// spec 两种写法：
//   { settings: {} }                         输出名与列名相同
//   { aisleCols: ['aisle_cols', []] }        输出名与列名不同（前端要 camelCase）
// 判定 pair 时不能只看 Array.isArray：默认值本身可能就是一个数组（如 []），
// 那样 { cells: [] } 会被误当成 pair、解析出 undefined 列名。要求「长度 2 且首元素是字符串」。
// 注意：**写路径不能用它**。写库时把畸形数据兜底成空值会覆盖用户原有数据，
// 那种场景应该让解析失败显式抛错（见 routes/seats.js 的 updateSingleCell）。
const isPairSpec = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';

function readDocJson(row, spec) {
  const out = {};
  for (const [key, v] of Object.entries(spec)) {
    const pair = isPairSpec(v);
    const col = pair ? v[0] : key;
    const fallback = pair ? v[1] : v;
    out[key] = safeJson(row ? row[col] : null, fallback, col);
  }
  return out;
}

module.exports = { safeJson, readDocJson };
