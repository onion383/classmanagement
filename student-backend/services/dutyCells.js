// =========================================================================
// dutyCells.js —— 值日表 cells 的结构遍历（纯函数，不依赖数据库）
//
// 值日 cells 有两种存量结构（与 services/sanitize.js 的 cleanDutyCells 判定一致）：
//   ① 旧版整块 { 项目: { 星期: [姓名, ...] } }
//   ② 新版按模式打包 { daily: { 项目: {...} }, big: { 项目: {...} } }
//
// 原先「删除学生」的关联统计/清理只按旧版结构遍历：遇到打包结构时，
// cells['daily'] 拿到的是 {项目:{...}}，再往下取 list 得到的是对象而不是数组，
// 于是游客般跳过 —— 统计恒为 0、清理一条都不删，值日表里留着已删除学生的姓名。
// 本模块把「认结构」这件事收敛到一处，统计与清理共用。
// =========================================================================

// 结构判定与 routes 侧共用同一份实现，避免「值日页」与「清理/统计」两边口径分叉
const { MODES: DUTY_MODES, looksLikeDutyRoot } = require('./dutyMode');

// 顶层键全部是 daily/big 才视为模式打包；否则按旧版整块处理。
// 返回「根节点列表」：打包结构返回 daily/big 两个根，旧版返回 cells 自身。
function dutyRoots(cells) {
  if (!cells || typeof cells !== 'object' || Array.isArray(cells)) return [];
  const keys = Object.keys(cells);
  const isModeMap = keys.length > 0
    && keys.every((k) => DUTY_MODES.includes(k))
    && keys.some((k) => looksLikeDutyRoot(cells[k]));
  if (!isModeMap) return [cells];
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

// 把值日表里的 oldName 改成 newName（学生改名时级联）。
// 结构与统计/清理共用 dutyRoots，打包结构与旧版整块都能命中。
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
