// ===== AI 工具执行：写入提案（propose_* / 批量操作）=====
// 纯代码搬运自 ../executors.js，行为不变。门面装配见 tools.js。
const { db } = require('../../../../db');
const { tableColumns, normColVal } = require('../../ai.helpers');
const { WRITE_TABLES, JSON_WRITE_TABLES } = require('../../ai.constants');
const { FRONT_SETTINGS, BATCH_ROW_TABLES, MAX_BATCH_OPS } = require('../tools.schema');

// propose_add_many 工具：批量新增多条数据，生成一条提案，用户确认后一次性写入
function normalizeBatchProposal({ table, rows }) {
  if (!WRITE_TABLES[table]) return { error: '该表暂不支持 AI 修改' };
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  if (!list.length) return { error: '缺少要新增的数据行（rows 不能为空）' };
  if (list.length > 50) return { error: `一次最多新增 50 行（当前 ${list.length} 行），请分批处理` };
  // 各表的必填字段校验（与单条新增的规则保持一致）
  const need = { students: '姓名', activities: '主题', countdowns: '名称' }[table];
  if (need) {
    const bad = list.findIndex((r) => !String(r[need] || '').trim());
    if (bad !== -1) return { error: `第 ${bad + 1} 行缺少「${need}」` };
  }
  return { ok: true, table, rows: list, count: list.length, label: `批量新增${WRITE_TABLES[table]}（${list.length} 条）` };
}

// propose_delete_many 工具：批量删除多条数据，生成一条提案，用户确认后一次性删除
// 最多一次 50 条；自动剔除库里不存在的 id（并把被忽略的 id 回报给模型），避免混入无效 id。
const MAX_DELETE_BATCH = 50;
function normalizeBatchDelete({ table, ids, label }) {
  if (!WRITE_TABLES[table]) return { error: '该表暂不支持 AI 删除' };
  const list = (Array.isArray(ids) ? ids : [])
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  const uniq = [...new Set(list)];
  if (!uniq.length) return { error: '缺少要删除的记录 id（ids 不能为空，请先用 query 查出 id）' };
  if (uniq.length > MAX_DELETE_BATCH) {
    return { error: `一次最多删除 ${MAX_DELETE_BATCH} 条（当前 ${uniq.length} 条），请分批处理` };
  }
  const existing = db
    .prepare(`SELECT id FROM "${table}" WHERE id IN (${uniq.map(() => '?').join(',')})`)
    .all(...uniq)
    .map((r) => r.id);
  if (!existing.length) return { error: '要删除的记录都不存在，请先用 query 核对 id' };
  const missing = uniq.filter((id) => !existing.includes(id));
  const lbl = String(label || '').trim().slice(0, 60) || `批量删除${WRITE_TABLES[table]}（${existing.length} 条）`;
  return { ok: true, table, ids: existing, count: existing.length, missing, label: lbl };
}

// propose_json_write 工具：「非行式」表的整块列写入。
// 这类表数据以整块 JSON 存在单列里，无法按行增删改，只能按 id 覆盖指定列。
// 模型须先 query 读当前行，再基于它给出「该列的完整新值」（整体替换，不是局部修改）。
function normalizeJsonProposal({ table, id, values, label }) {
  const tname = JSON_WRITE_TABLES[table];
  if (!tname) return { error: '该表暂不支持整块写入' };
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return { error: '缺少要写入的列值（values 须为「列名→该列完整新值」的对象）' };
  }
  const rid = Number.isInteger(id) ? id : 1;
  const cols = tableColumns(table);
  const row = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(rid);
  if (!row) return { error: `表中没有 id=${rid} 的行，请先用 query 读取现有数据` };
  // 仅保留该表真实列（剔除 id 与不存在的键），避免写入非法字段
  const keys = Object.keys(values).filter((k) => k !== 'id' && cols.includes(k) && values[k] !== undefined);
  if (!keys.length) return { error: '要写入的列名不在该表字段中，请先用 query 确认列名' };
  const next = {};
  const before = {};
  for (const k of keys) { next[k] = values[k]; before[k] = row[k]; }
  // 归一化比较：全部列都与当前内容相同则无意义，直接报错让模型修正
  const changed = keys.filter((k) => normColVal(before[k]) !== normColVal(next[k]));
  if (!changed.length) return { error: '提案内容与当前数据完全相同，无需修改' };
  const lbl = String(label || '').trim().slice(0, 60) || `修改${tname}`;
  return { ok: true, table, id: rid, values: next, before, label: lbl };
}

function normalizeFrontProposal({ key, value, label }) {
  const spec = FRONT_SETTINGS[key];
  if (!spec) return { error: `不支持的设置项：${key}` };
  let v = value;
  if (spec.type === 'boolean') {
    if (typeof v === 'string') v = v.trim().toLowerCase() !== 'false' && v.trim() !== '0' && v.trim() !== '';
    else v = !!v;
  } else if (spec.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) return { error: '该项需要 0~1 之间的数值' };
    v = Math.min(1, Math.max(0, n));
  } else if (spec.type === 'enum') {
    v = String(v).trim();
    if (!spec.values.includes(v)) return { error: `${spec.label} 取值无效，可选：${spec.values.join(' / ')}` };
  } else {
    v = String(v).trim();
  }
  const lbl = String(label || '').trim().slice(0, 60) || `修改${spec.label}`;
  return { ok: true, key, value: v, label: lbl };
}

// ===== propose_update_many 工具：批量修改同一张表的多行 =====
// 两种入参：① updates:[{id,changes},...]（每行改动可不同）；② ids:[...] + changes:{...}（对这批 id 套用同一处改动）。
// 二者都归并为统一的 updates 列表；最多 50 行。逐行复用 tableColumns 校验列并生成「旧值 → 新值」对照。
const MAX_UPDATE_BATCH = 50;

// 单行改动 → 校验 + 生成 diff（与 propose_write 的 diff 口径一致）
function buildUpdateDiff(table, id, changes) {
  const cols = tableColumns(table);
  const unknown = Object.keys(changes).filter((k) => k !== 'id' && !cols.includes(k));
  if (unknown.length) {
    return { error: `要修改的字段不存在：${unknown.join('、')}。该表可用字段：${cols.filter((c) => c !== 'id').join('、')}` };
  }
  const row = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
  if (!row) return { error: `要修改的记录不存在（id=${id}），请先用 query 核对` };
  const diff = Object.keys(changes)
    .filter((k) => k !== 'id')
    .map((k) => ({ field: k, from: row[k] == null ? '' : row[k], to: changes[k] == null ? '' : changes[k] }));
  return { ok: true, diff };
}

function normalizeBatchUpdate({ table, updates, ids, changes, label }) {
  if (!WRITE_TABLES[table]) return { error: '该表暂不支持 AI 修改' };
  const common = changes && typeof changes === 'object' && !Array.isArray(changes) ? changes : null;
  let list = [];
  if (Array.isArray(updates)) {
    list = updates
      .filter((u) => u && typeof u === 'object' && !Array.isArray(u))
      .map((u) => ({ id: Number(u.id), changes: u.changes && typeof u.changes === 'object' && !Array.isArray(u.changes) ? u.changes : null }));
  } else if (Array.isArray(ids) && common) {
    list = ids.map((id) => ({ id: Number(id), changes: common }));
  }
  if (!list.length) return { error: '缺少要修改的内容（提供 updates 数组，或 ids + changes 表示对这批记录套用同一处改动）' };
  if (list.length > MAX_UPDATE_BATCH) return { error: `一次最多修改 ${MAX_UPDATE_BATCH} 行（当前 ${list.length} 行），请分批处理` };
  const normalized = [];
  const diffs = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!Number.isInteger(it.id) || it.id <= 0) return { error: `第 ${i + 1} 行缺少有效的记录 id` };
    if (!it.changes || !Object.keys(it.changes).length) return { error: `第 ${i + 1} 行缺少要修改的字段（changes 不能为空）` };
    const d = buildUpdateDiff(table, it.id, it.changes);
    if (d.error) return { error: `第 ${i + 1} 行：${d.error}` };
    normalized.push({ id: it.id, changes: it.changes });
    diffs.push({ id: it.id, diff: d.diff });
  }
  const lbl = String(label || '').trim().slice(0, 60) || `批量修改${WRITE_TABLES[table]}（${normalized.length} 条）`;
  return { ok: true, table, updates: normalized, diffs, count: normalized.length, label: lbl };
}

function normalizeBatchOps({ ops, label }) {
  const list = (Array.isArray(ops) ? ops : []).filter((o) => o && typeof o === 'object' && !Array.isArray(o));
  if (!list.length) return { error: '缺少要执行的操作（ops 不能为空）' };
  if (list.length > MAX_BATCH_OPS) return { error: `一次最多 ${MAX_BATCH_OPS} 个操作（当前 ${list.length} 个），请分批处理` };
  const normalized = [];
  for (let i = 0; i < list.length; i++) {
    const op = list[i];
    const action = String(op.action || '').trim();
    const table = String(op.table || '').trim();
    const at = `第 ${i + 1} 个操作`;
    if (action === 'doc') {
      if (!JSON_WRITE_TABLES[table]) return { error: `${at}：该表不支持整块写入（${table || '未指定表'}）` };
      if (!op.values || typeof op.values !== 'object' || Array.isArray(op.values)) return { error: `${at}：缺少要写入的列值（values）` };
      normalized.push({ action: 'doc', table, id: Number.isInteger(op.id) ? op.id : 1, values: op.values });
      continue;
    }
    if (!['add', 'update', 'delete'].includes(action)) return { error: `${at}：action 必须是 add/update/delete/doc` };
    if (!BATCH_ROW_TABLES[table]) return { error: `${at}：该表不支持按行写入（${table || '未指定表'}）` };
    const data = op.data && typeof op.data === 'object' && !Array.isArray(op.data) ? op.data : null;
    if (!data) return { error: `${at}：缺少 data` };
    const cols = tableColumns(table);
    if (action === 'delete') {
      const id = Number(data.id);
      if (!Number.isInteger(id) || id <= 0) return { error: `${at}：删除必须提供有效的 id` };
      const row = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
      if (!row) return { error: `${at}：要删除的记录不存在（${table} id=${id}）` };
      normalized.push({ action: 'delete', table, id });
      continue;
    }
    if (action === 'update') {
      const id = Number(data.id);
      if (!Number.isInteger(id) || id <= 0) return { error: `${at}：修改必须提供有效的 id` };
      const changes = data.changes && typeof data.changes === 'object' && !Array.isArray(data.changes) ? data.changes : null;
      if (!changes || !Object.keys(changes).length) return { error: `${at}：缺少要修改的字段（changes）` };
      const unknown = Object.keys(changes).filter((k) => k !== 'id' && !cols.includes(k));
      if (unknown.length) return { error: `${at}：要修改的字段不存在：${unknown.join('、')}` };
      const row = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
      if (!row) return { error: `${at}：要修改的记录不存在（${table} id=${id}）` };
      normalized.push({ action: 'update', table, id, changes });
      continue;
    }
    // add：以库真实列为准，剔除未知字段与 id（id 由数据库自增，避免与既有记录冲突）
    const unknown = Object.keys(data).filter((k) => k !== 'id' && !cols.includes(k));
    if (unknown.length) return { error: `${at}：字段不存在：${unknown.join('、')}` };
    const row = Object.keys(data).filter((k) => k !== 'id').reduce((o, k) => { o[k] = data[k]; return o; }, {});
    if (!Object.keys(row).length) return { error: `${at}：新增缺少字段数据` };
    const need = { students: '姓名', activities: '主题', countdowns: '名称' }[table];
    if (need && !String(row[need] || '').trim()) return { error: `${at}：新增${BATCH_ROW_TABLES[table]}缺少「${need}」` };
    normalized.push({ action: 'add', table, data: row });
  }
  const lbl = String(label || '').trim().slice(0, 60) || `跨表批量操作（${normalized.length} 项）`;
  return { ok: true, ops: normalized, count: normalized.length, label: lbl };
}

function normalizeProposal({ operation, table, data }) {
  if (!['add', 'update', 'delete'].includes(operation)) return { ok: false, error: '不支持的写操作' };
  if (!WRITE_TABLES[table]) return { ok: false, error: '该表暂不支持 AI 修改' };
  if (!data || typeof data !== 'object') return { ok: false, error: '缺少写入数据' };
  const name = WRITE_TABLES[table];
  const label = { add: `新增${name}`, update: `修改${name}`, delete: `删除${name}` }[operation];
  // students 新增至少要有姓名，活动/倒计时至少要有主题/名称
  if (operation === 'add') {
    if (table === 'students' && !data['姓名']) return { ok: false, error: '新增学生必须提供姓名' };
    if (table === 'activities' && !data['主题']) return { ok: false, error: '新增活动必须提供主题' };
    if (table === 'countdowns' && !data['名称']) return { ok: false, error: '新增倒计时必须提供名称' };
    if (table === 'leave_records' && !data['姓名']) return { ok: false, error: '新增请假记录必须提供姓名' };
    if (table === 'score_records' && !data['姓名'] && !data.group_name) return { ok: false, error: '新增加分记录必须提供姓名（小组加分则提供 group_name）' };
    if (table === 'cadres' && !data.name) return { ok: false, error: '新增班干部职务必须提供职务名（name）' };
  }
  // update 顺带做「写入前校验」并生成「旧值 → 新值」对照（供用户确认时判断）
  let diff = null;
  if (operation === 'update') {
    const id = Number(data.id);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: '修改必须提供有效的记录 id' };
    const changes = data.changes && typeof data.changes === 'object' && !Array.isArray(data.changes) ? data.changes : null;
    if (!changes || !Object.keys(changes).length) return { ok: false, error: '缺少要修改的字段（data.changes 不能为空）' };
    const cols = tableColumns(table);
    const ava = cols.filter((c) => c !== 'id').join('、');
    const unknown = Object.keys(changes).filter((k) => k !== 'id' && !cols.includes(k));
    if (unknown.length) return { ok: false, error: `要修改的字段不存在：${unknown.join('、')}。该表可用字段：${ava}` };
    const row = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
    if (!row) return { ok: false, error: `要修改的记录不存在（id=${id}），请先用 query 核对` };
    diff = Object.keys(changes)
      .filter((k) => k !== 'id')
      .map((k) => ({ field: k, from: row[k] == null ? '' : row[k], to: changes[k] == null ? '' : changes[k] }));
  }
  return { ok: true, operation, table, data, label, diff };
}

module.exports = {
  normalizeProposal,
  normalizeBatchProposal, normalizeBatchDelete, normalizeJsonProposal, normalizeFrontProposal,
  normalizeBatchUpdate, normalizeBatchOps,
};
