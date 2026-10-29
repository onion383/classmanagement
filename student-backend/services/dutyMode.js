// 值日数据「模式拆分」的唯一实现。
//
// cells / settings / items 字段统一存「按模式分键」的结构：{ daily: {...}, big: {...} }，
// 两种模式数据彼此独立。
//
// 拆包/打包此前在 routes/duty.js、routes/search.js、routes/ai/ai.dataRoutes.js、
// ai.tools/tools.executors/executors.common.js 各写了一份（fieldToModeMap / toModeMap /
// splitModeMap / unpackDutyModeCol），四份逐字相同、只改了函数名。
// 一旦其中一份改了口径，同一份数据在「值日页」和「AI 工具」里会被解释成不同结构，
// 所以必须单源。

const { safeJson } = require('../utils/json');

const MODES = ['daily', 'big'];

function toModeMap(field) {
  const obj = safeJson(field, {});
  if (!obj || typeof obj !== 'object') return { daily: {}, big: {} };
  return { daily: obj.daily || {}, big: obj.big || {} };
}

// 解包某个模式的数据。
// empty 是该字段的**空形态**：cells/settings/weights 的模式值是对象（默认 {}），items 的模式值是数组（须传 []）。
// 缺失或旧结构（非按模式分键）时必须回对应形态的空值——items 回 {} 会让前端 `items.forEach` 直接崩掉，
// 「旧结构读为空」的前提是空得像空，而不是回一个假对象。
const unpackMode = (field, mode, empty = {}) => {
  const v = toModeMap(field)[mode]
  if (Array.isArray(empty)) return Array.isArray(v) ? v : empty
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : empty
};

// 把某个模式的数据写回打包结构（不影响另一个模式）
function packMode(field, mode, data) {
  const map = toModeMap(field);
  map[mode] = data;
  return map;
}

const normalizeMode = (m) => (m === 'big' ? 'big' : 'daily');

module.exports = { MODES, toModeMap, unpackMode, packMode, normalizeMode };
