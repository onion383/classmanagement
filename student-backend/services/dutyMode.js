// 值日数据「模式拆分」的唯一实现。
//
// cells / settings / items 三个字段有两种历史结构：
//   ① 新版按模式打包：{ daily: {...}, big: {...} }
//   ② 旧版整块（没有模式概念）：{ 项目: { 星期: [...] } }
// 判定依据：顶层键**全部**是 daily/big 才视为新模式，否则整块归入日常。
//
// 这段判断此前在 routes/duty.js、routes/search.js、routes/ai/ai.dataRoutes.js、
// ai.tools/tools.executors/executors.common.js 各写了一份（fieldToModeMap / toModeMap /
// splitModeMap / unpackDutyModeCol），四份逐字相同、只改了函数名。
// 一旦其中一份改了口径，同一份数据在「值日页」和「AI 工具」里会被解释成不同结构，
// 所以必须单源。

const { safeJson } = require('../utils/json');

const MODES = ['daily', 'big'];

// 一个值像不像「某个模式下的值日根」（项目 → 星期 → 姓名数组）。
// 只判键名会把「旧版整块、且项目名恰好叫 daily/big」的数据误认成模式打包：
// 这种数据的下一层是「星期 → 数组」，而真正的模式根下一层是「项目 → 对象」。
// 空对象算像（刚切到该模式、还没填内容）。
function looksLikeDutyRoot(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const children = Object.values(v);
  if (!children.length) return true;
  return children.every((c) => c && typeof c === 'object' && !Array.isArray(c));
}

function toModeMap(field) {
  const obj = safeJson(field, {});
  if (!obj || typeof obj !== 'object') return { daily: {}, big: {} };
  const keys = Object.keys(obj);
  // 顶层键全是 daily/big **且**至少有一个真的长得像模式根，才认作新模式。
  // 用 some 而不是 every：另一个模式为 null / 畸形时仍应正常解包（保持原有宽容度）。
  const isModeMap = keys.length > 0
    && keys.every((k) => MODES.includes(k))
    && keys.some((k) => looksLikeDutyRoot(obj[k]));
  if (isModeMap) return { daily: obj.daily || {}, big: obj.big || {} };
  return { daily: obj, big: {} };
}

// 解包某个模式的数据（不存在时返回空对象）
const unpackMode = (field, mode) => toModeMap(field)[mode] || {};

// 把某个模式的数据写回打包结构（不影响另一个模式）
function packMode(field, mode, data) {
  const map = toModeMap(field);
  map[mode] = data;
  return map;
}

const normalizeMode = (m) => (m === 'big' ? 'big' : 'daily');

module.exports = { MODES, looksLikeDutyRoot, toModeMap, unpackMode, packMode, normalizeMode };
