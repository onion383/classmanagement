// ===== AI 工具执行：通用小工具（日期 / JSON / 姓名 / 拼音 / 值日解包）=====
// 从 ../executors.js 纯代码搬运而来，逐个模块共享，行为不变。
const db = require('../../../../db').db;

let PM_MOD;
// 拼音匹配复用前端同款依赖 pinyin-match（懒加载，加载失败时退化为文本/学号匹配）
function pinyinMatch(text, key) {
  if (PM_MOD === undefined) {
    try { PM_MOD = require('pinyin-match'); } catch (_) { PM_MOD = null; }
  }
  if (!PM_MOD || typeof PM_MOD.match !== 'function') return false;
  try { return !!PM_MOD.match(text, key); } catch (_) { return false; }
}

function aiPad2(n) { return String(n).padStart(2, '0'); }
function aiDateStr(d) { return `${d.getFullYear()}-${aiPad2(d.getMonth() + 1)}-${aiPad2(d.getDate())}`; }
function aiTodayStr() { return aiDateStr(new Date()); }
// 从任意文本里抽出 YYYY-MM-DD（兼容 2026/9/1、2026.09.01 等写法）；抽不到返回 ''
function aiParseDate(s) {
  const m = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(String(s == null ? '' : s));
  if (!m) return '';
  return `${m[1]}-${aiPad2(Number(m[2]))}-${aiPad2(Number(m[3]))}`;
}
function aiParseJson(str, fallback) {
  try { const v = JSON.parse(str); return v == null ? fallback : v; } catch (_) { return fallback; }
}
const DUTY_MODE_LABELS = { daily: '日常值日', big: '大扫除' };
function dutyModeLabel(m) { return DUTY_MODE_LABELS[m] || m; }
// 解包「按模式分键」的值日数据（与 duty.js fieldToModeMap 同构）：旧版整块归入日常
function unpackDutyModeCol(field, mode) {
  let obj = (typeof field === 'object' && field !== null) ? field : aiParseJson(field, {});
  if (!obj || typeof obj !== 'object') return {};
  const keys = Object.keys(obj);
  const isModeMap = keys.length > 0 && keys.every((k) => k === 'daily' || k === 'big');
  if (isModeMap) return obj[mode] || {};
  return mode === 'daily' ? obj : {};
}
function studentIdNameMap() {
  const map = {};
  for (const s of db.prepare('SELECT id, 姓名 FROM students').all()) map[Number(s.id)] = String(s['姓名'] || '');
  return map;
}
// 课表格内是否含多门课（用顿号/斜杠/加号/逗号/与号等分隔出 ≥2 段非空文本）
function aiLooksMultiCourse(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return false;
  const parts = t.split(/[/／,，、+＋&|]/).map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2;
}

module.exports = {
  pinyinMatch,
  aiPad2, aiDateStr, aiTodayStr, aiParseDate, aiParseJson,
  DUTY_MODE_LABELS, dutyModeLabel, unpackDutyModeCol, studentIdNameMap, aiLooksMultiCourse,
};
