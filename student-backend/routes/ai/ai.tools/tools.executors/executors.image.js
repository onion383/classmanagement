// ===== AI 工具执行：export_image（课表/座位表/值日表 → 排布图规格）=====
// 纯代码搬运自 ../executors.js，行为不变。门面装配见 tools.js。
const { db } = require('../../../../db');
const {
  aiParseJson, unpackDutyModeCol, studentIdNameMap,
} = require('./executors.common');

// 课表行标签：优先按 settings.sections 的节次结构取 lesson 行，退化为 periods/pass 序号
function buildScheduleRowLabels(settings, cells) {
  const out = [];
  const sections = settings && settings.sections;
  if (sections && typeof sections === 'object') {
    const order = ['morning', 'noon', 'afternoon', 'evening', 'night'];
    let lessonIdx = 0;
    for (const key of order) {
      const items = Array.isArray(sections[key]) ? sections[key] : [];
      for (const item of items) {
        if (item && item.type === 'lesson') { out.push({ label: item.name || `第${lessonIdx + 1}节`, lessonIdx }); lessonIdx++; }
        else out.push({ label: (item && item.name) || '', lessonIdx: null });
      }
    }
    return out;
  }
  const periods = Array.isArray(settings && settings.periods) ? settings.periods : [];
  const n = periods.length || cells.length;
  for (let i = 0; i < n; i++) out.push({ label: periods[i] || `第${i + 1}节`, lessonIdx: i });
  return out;
}
function buildScheduleImage() {
  const row = db.prepare('SELECT cells, settings FROM schedule WHERE id = 1').get();
  if (!row) return null;
  const cells = aiParseJson(row.cells, []) || [];
  const settings = aiParseJson(row.settings, {}) || {};
  const days = (Array.isArray(settings.days) && settings.days.length) ? settings.days : ['周一', '周二', '周三', '周四', '周五'];
  const cellText = (src, c) => {
    const v = (Array.isArray(src) ? src : [])[c];
    return v && typeof v === 'object' ? String(v.course || '') : String(v == null ? '' : v);
  };
  const lines = buildScheduleRowLabels(settings, cells);
  const hasLesson = lines.some((l) => l.lessonIdx != null);
  const source = hasLesson
    ? lines
    : cells.map((_, i) => ({ label: `第${i + 1}节`, lessonIdx: i }));
  if (!source.length) return null;
  const rows = source.map(({ label, lessonIdx }) => {
    const line = [label];
    for (let c = 0; c < days.length; c++) line.push(lessonIdx == null ? '' : cellText(cells[lessonIdx], c));
    return line;
  });
  return { target: 'schedule', title: '课程表', columns: ['节次', ...days], rows };
}
function buildSeatImage() {
  const row = db.prepare('SELECT seats FROM seat_layout WHERE id = 1').get();
  if (!row) return null;
  const seats = aiParseJson(row.seats, []) || [];
  if (!seats.length) return null;
  const cols = seats.reduce((mx, r) => Math.max(mx, Array.isArray(r) ? r.length : 0), 0);
  const idName = studentIdNameMap();
  const columns = ['', ...Array.from({ length: cols }, (_, c) => `第${c + 1}列`)];
  const rows = seats.map((r, i) => {
    const line = [`第${i + 1}排`];
    const arr = Array.isArray(r) ? r : [];
    for (let c = 0; c < cols; c++) {
      const v = arr[c];
      line.push(v == null || v === '' ? '' : (typeof v === 'number' ? (idName[v] || `#${v}`) : String(v)));
    }
    return line;
  });
  return { target: 'seat', title: '座位表', headnote: '讲台', columns, rows };
}
function buildDutyImage(mode) {
  const row = db.prepare('SELECT cells, settings FROM duty_layout WHERE id = 1').get();
  if (!row) return null;
  const cells = unpackDutyModeCol(row.cells, mode);
  const ms = unpackDutyModeCol(row.settings, mode);
  let days = Array.isArray(ms.days) && ms.days.length ? ms.days : null;
  if (!days) {
    const ds = db.prepare('SELECT days FROM duty_settings WHERE id = 1').get();
    days = ds ? (aiParseJson(ds.days, []) || []) : [];
  }
  if (!days.length) days = ['周一', '周二', '周三', '周四', '周五'];
  let items = Array.isArray(ms.items) ? ms.items.map((it) => it && it.name).filter(Boolean) : [];
  if (!items.length) items = Object.keys(cells || {});
  if (!items.length) return null;
  const rows = items.map((item) => {
    const line = [item];
    const daysMap = (cells && cells[item]) || {};
    for (const d of days) {
      const raw = daysMap[d];
      line.push(Array.isArray(raw) ? raw.filter(Boolean).join('、') : (raw == null ? '' : String(raw)));
    }
    return line;
  });
  return { target: 'duty', title: mode === 'big' ? '大扫除值日表' : '值日表', columns: ['劳动项目', ...days], rows };
}
function buildExportImage({ targets, mode, filename } = {}) {
  const all = ['schedule', 'seat', 'duty'];
  let list = all;
  if (targets != null) {
    const arr = Array.isArray(targets) ? targets : [targets];
    list = arr.map((t) => String(t).trim()).filter((t) => all.includes(t));
    if (!list.length) return { error: 'targets 只能是 schedule/seat/duty 中的一个或多个' };
  }
  const m = mode === 'big' ? 'big' : 'daily';
  const items = [];
  for (const t of list) {
    const built = t === 'schedule' ? buildScheduleImage() : t === 'seat' ? buildSeatImage() : buildDutyImage(m);
    if (built) items.push(built);
  }
  if (!items.length) return { error: '没有可导出的内容（对应数据为空）' };
  const name = String(filename || '').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 80) || '班级排布图';
  return { spec: { kind: 'image', filename: name, items } };
}

module.exports = { buildExportImage };
