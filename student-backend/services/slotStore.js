// =========================================================================
// slotStore.js —— 单例槽位表读写层
//
// 课表 / 值日 / 座位三个域原先各有一组高度同构的单例表（id=1 的 JSON 表），
// 物理上合并为三张按 kind 分行的表：
//   schedule_slots(current/master)、duty_slots(settings/current/template/weight/draft)、
//   seat_slots(current/template/draft/weight)
// 三域历史快照合并为 domain_history（按 domain 区分）。
//
// 逻辑表名（schedule / duty_layout / seat_template …）保持不变：
//   · 读：schema 里为每个逻辑名建了只读视图，既有 SELECT 无需改动；
//   · 写：统一走本模块（视图不可写），SQL 只此一处，避免写法散落。
// =========================================================================

const { db } = require('../db');

// 逻辑表名 → { 物理表, kind, 该 kind 允许读写的列 }
const SPEC = {
  schedule: { table: 'schedule_slots', kind: 'current', columns: ['cells', 'settings'] },
  master_schedule: { table: 'schedule_slots', kind: 'master', columns: ['cells', 'settings'] },

  duty_settings: { table: 'duty_slots', kind: 'settings', columns: ['days', 'items'] },
  duty_layout: { table: 'duty_slots', kind: 'current', columns: ['cells', 'settings'] },
  duty_template: { table: 'duty_slots', kind: 'template', columns: ['cells', 'settings'] },
  duty_weight: { table: 'duty_slots', kind: 'weight', columns: ['weights', 'settings'] },
  duty_draft: { table: 'duty_slots', kind: 'draft', columns: ['cells', 'settings', 'conditions', 'saved_at'] },

  seat_layout: { table: 'seat_slots', kind: 'current', columns: ['mode', 'rows', 'cols', 'seats', 'aisle_cols', 'groups_config', 'settings'] },
  seat_template: { table: 'seat_slots', kind: 'template', columns: ['mode', 'rows', 'cols', 'seats', 'aisle_cols', 'groups_config', 'settings'] },
  seat_draft: { table: 'seat_slots', kind: 'draft', columns: ['mode', 'rows', 'cols', 'seats', 'aisle_cols', 'groups_config', 'settings', 'conditions', 'saved_at'] },
  seat_weight: { table: 'seat_slots', kind: 'weight', columns: ['mode', 'rows', 'cols', 'weights', 'settings'] },
};

function isDoc(name) {
  return Object.prototype.hasOwnProperty.call(SPEC, name);
}

// 该逻辑表可读写的列（供 AI 工具做字段校验，替代对物理表的 PRAGMA）
function columnsOf(name) {
  return SPEC[name] ? SPEC[name].columns.slice() : [];
}

// 读取单例文档：返回与旧单表同形的对象（含 id: 1），只挑该 kind 的列
function getDoc(name) {
  const s = SPEC[name];
  if (!s) return null;
  const row = db.prepare(`SELECT * FROM ${s.table} WHERE kind = ?`).get(s.kind);
  if (!row) return null;
  const out = { id: 1 };
  for (const c of s.columns) out[c] = row[c];
  return out;
}

function serialize(v) {
  if (v != null && typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

// 更新单例文档：只写入该 kind 声明的列，未传的列保持不变
function setDoc(name, patch) {
  const s = SPEC[name];
  if (!s || !patch) return;
  const keys = Object.keys(patch).filter((k) => s.columns.includes(k) && patch[k] !== undefined);
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE ${s.table} SET ${set} WHERE kind = ?`)
    .run(...keys.map((k) => serialize(patch[k])), s.kind);
}

// ======================== 学期范围 ========================
// 当前学期起止日期（无当前学期时退回最新一条），供值日/座位补存与指数结算使用。
function semesterRange() {
  const row = db.prepare('SELECT start_date, end_date FROM semesters WHERE is_current = 1 ORDER BY id DESC LIMIT 1').get()
    || db.prepare('SELECT start_date, end_date FROM semesters ORDER BY id DESC LIMIT 1').get();
  return { start: (row && row.start_date) || '', end: (row && row.end_date) || '' };
}

// ======================== 历史快照 ========================
// payload 形状：
//   schedule → { cells, settings }
//   duty     → { cells, settings }
//   seat     → { mode, rows, cols, seats, aisleCols, groupsConfig, settings }
function parsePayload(text) {
  try {
    const p = JSON.parse(text || '{}');
    return p && typeof p === 'object' ? p : {};
  } catch (_) { return {}; }
}

function toRec(row) {
  return row ? { ...row, payload: parsePayload(row.payload) } : null;
}

// 按周聚合（代表日期 = 该周最后一天），供历史下拉框使用；mode 为 null 时不按模式过滤
function histWeeks(domain, mode) {
  const byMode = mode != null;
  const sql = `
    SELECT week_start, MAX(snap_date) AS last_date, MAX(created_at) AS created_at, COUNT(*) AS count
    FROM domain_history WHERE domain = ?${byMode ? ' AND mode = ?' : ''}
    GROUP BY week_start ORDER BY week_start DESC
  `;
  return byMode
    ? db.prepare(sql).all(domain, mode)
    : db.prepare(sql).all(domain);
}

// 某周最新一条快照；mode 为 null 时不按模式过滤
function histLatest(domain, weekStart, mode) {
  const byMode = mode != null;
  const sql = `SELECT * FROM domain_history WHERE domain = ? AND week_start = ?${byMode ? ' AND mode = ?' : ''}
    ORDER BY snap_date DESC, id DESC LIMIT 1`;
  const row = byMode
    ? db.prepare(sql).get(domain, weekStart, mode)
    : db.prepare(sql).get(domain, weekStart);
  return toRec(row);
}

// 按天查某条快照
function histFind(domain, snapDate, mode) {
  const row = mode != null
    ? db.prepare('SELECT * FROM domain_history WHERE domain = ? AND snap_date = ? AND mode = ?').get(domain, snapDate, mode)
    : db.prepare('SELECT * FROM domain_history WHERE domain = ? AND snap_date = ?').get(domain, snapDate);
  return toRec(row);
}

// 某天之前最近一条快照（补存时沿用）
function histPrev(domain, snapDate, mode) {
  const byMode = mode != null;
  const sql = `SELECT * FROM domain_history WHERE domain = ? AND snap_date < ?${byMode ? ' AND mode = ?' : ''}
    ORDER BY snap_date DESC LIMIT 1`;
  const row = byMode
    ? db.prepare(sql).get(domain, snapDate, mode)
    : db.prepare(sql).get(domain, snapDate);
  return toRec(row);
}

// 按天区间取快照（升序）；from/to 可只给其一
function histDaily(domain, { from, to, mode } = {}) {
  const conds = ['domain = ?'];
  const params = [domain];
  if (mode != null) { conds.push('mode = ?'); params.push(mode); }
  if (from) { conds.push('snap_date >= ?'); params.push(from); }
  if (to) { conds.push('snap_date <= ?'); params.push(to); }
  const rows = db.prepare(`SELECT * FROM domain_history WHERE ${conds.join(' AND ')} ORDER BY snap_date ASC`).all(...params);
  return rows.map(toRec);
}

function histInsert(domain, { weekStart = '', snapDate = '', mode = '', payload = {} } = {}) {
  const info = db.prepare('INSERT INTO domain_history (domain, week_start, snap_date, mode, payload) VALUES (?,?,?,?,?)')
    .run(domain, weekStart, snapDate, mode, JSON.stringify(payload));
  return Number(info.lastInsertRowid);
}

// 幂等写入：schedule 按 week_start；duty 按 snap_date + mode；seat 按 snap_date
function histUpsert(domain, rec = {}) {
  const { weekStart = '', snapDate = '', mode = '', payload = {} } = rec;
  let row;
  if (domain === 'schedule') {
    row = db.prepare('SELECT id FROM domain_history WHERE domain = ? AND week_start = ?').get(domain, weekStart);
  } else if (domain === 'duty') {
    row = db.prepare('SELECT id FROM domain_history WHERE domain = ? AND snap_date = ? AND mode = ?').get(domain, snapDate, mode);
  } else {
    row = db.prepare('SELECT id FROM domain_history WHERE domain = ? AND snap_date = ?').get(domain, snapDate);
  }
  if (row) {
    db.prepare('UPDATE domain_history SET week_start = ?, mode = ?, payload = ? WHERE id = ?')
      .run(weekStart, mode, JSON.stringify(payload), row.id);
    return row.id;
  }
  return histInsert(domain, { weekStart, snapDate, mode, payload });
}

// 合并更新某天快照的 payload 字段（座位补存的「今天覆盖」用）
function histUpdateByDate(domain, snapDate, mode, patch = {}) {
  const row = mode != null
    ? db.prepare('SELECT id, payload FROM domain_history WHERE domain = ? AND snap_date = ? AND mode = ?').get(domain, snapDate, mode)
    : db.prepare('SELECT id, payload FROM domain_history WHERE domain = ? AND snap_date = ?').get(domain, snapDate);
  if (!row) return false;
  const next = { ...parsePayload(row.payload), ...patch };
  db.prepare('UPDATE domain_history SET payload = ? WHERE id = ?').run(JSON.stringify(next), row.id);
  return true;
}

// 删除某一周（mode 为 null 时不按模式过滤）
function histDeleteWeek(domain, weekStart, mode) {
  const byMode = mode != null;
  const sql = `DELETE FROM domain_history WHERE domain = ? AND week_start = ?${byMode ? ' AND mode = ?' : ''}`;
  const info = byMode
    ? db.prepare(sql).run(domain, weekStart, mode)
    : db.prepare(sql).run(domain, weekStart);
  return info.changes;
}

module.exports = {
  isDoc, columnsOf, getDoc, setDoc,
  semesterRange,
  histWeeks, histLatest, histFind, histPrev, histDaily,
  histInsert, histUpsert, histUpdateByDate, histDeleteWeek,
};
