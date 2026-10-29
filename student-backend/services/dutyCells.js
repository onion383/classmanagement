// =========================================================================
// dutyCells.js —— 值日表 cells 的结构遍历（纯函数，不依赖数据库）
//
// 值日 cells 统一存「按模式分键」的结构：{ daily: { 项目: {...} }, big: { 项目: {...} } }。
//
// 本模块把「按模式取根节点」这件事收敛到一处，删除学生的关联统计/清理与改名级联共用。
// =========================================================================

const { MODES: DUTY_MODES } = require('./dutyMode');

// 返回各模式的「根节点列表」（项目 → 星期 → 姓名数组）；畸形模式值直接跳过
function dutyRoots(cells) {
  if (!cells || typeof cells !== 'object' || Array.isArray(cells)) return [];
  return DUTY_MODES
    .map((m) => cells[m])
    .filter((root) => root && typeof root === 'object' && !Array.isArray(root));
}

// 统计某个姓名在值日表里出现的次数（daily 与 big 都算）
function countDutyRefs(cells, name) {
  if (!name) return 0;
  let count = 0;
  for (const root of dutyRoots(cells)) {
    for (const item of Object.keys(root)) {
      const byDay = root[item];
      if (!byDay || typeof byDay !== 'object' || Array.isArray(byDay)) continue;
      for (const day of Object.keys(byDay)) {
        const list = byDay[day];
        if (Array.isArray(list)) count += list.filter((v) => v === name).length;
      }
    }
  }
  return count;
}

// 从值日表里移除某个姓名（就地修改 cells），返回移除数量
function removeDutyName(cells, name) {
  if (!name) return 0;
  let removed = 0;
  for (const root of dutyRoots(cells)) {
    for (const item of Object.keys(root)) {
      const byDay = root[item];
      if (!byDay || typeof byDay !== 'object' || Array.isArray(byDay)) continue;
      for (const day of Object.keys(byDay)) {
        const list = byDay[day];
        if (!Array.isArray(list)) continue;
        const kept = list.filter((v) => v !== name);
        removed += list.length - kept.length;
        byDay[day] = kept;
      }
    }
  }
  return removed;
}

// 把值日表里的 oldName 改成 newName（学生改名时级联）
function renameDutyName(cells, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return 0;
  let changed = 0;
  for (const root of dutyRoots(cells)) {
    for (const item of Object.keys(root)) {
      const byDay = root[item];
      if (!byDay || typeof byDay !== 'object' || Array.isArray(byDay)) continue;
      for (const day of Object.keys(byDay)) {
        const list = byDay[day];
        if (!Array.isArray(list)) continue;
        for (let i = 0; i < list.length; i++) {
          if (list[i] === oldName) { list[i] = newName; changed++; }
        }
      }
    }
  }
  return changed;
}

module.exports = { DUTY_MODES, dutyRoots, countDutyRefs, removeDutyName, renameDutyName };
