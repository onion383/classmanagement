// ===== AI 工具执行逻辑·delete_impact（删除前引用影响预估）=====
// 纯代码搬运自 ../executors.js，行为不变。
const { db } = require('../../../../db');
const { READ_TABLES } = require('../../ai.constants');
// JSON 列解析复用单源实现（此前本文件自抄了一份 parseJsonOr，与 executors.common.js 的 aiParseJson 逐字相同）
const { safeJson } = require('../../../../utils/json');

// ===== delete_impact 工具：删除前的引用影响预估（只读）=====
// 在删掉某行前，先看看它在各处被引用了多少（分组/班干部/加减分/请假/座位表/值日表），避免删完才发现数据不一致。
const REFERENCE_RULES = {
  students: [
    { label: '分组（小组成员）', table: 'group_members', field: 'member_name', via: '姓名' },
    { label: '班干部', table: 'cadre_members', field: 'student_name', via: '姓名' },
    { label: '加分扣分记录', table: 'score_records', field: '姓名', via: '姓名' },
    { label: '请假记录', table: 'leave_records', field: '姓名', via: '姓名' },
  ],
  cadres: [{ label: '担任该职务的学生', table: 'cadre_members', field: 'cadre_id', via: 'id' }],
  groups: [{ label: '组内成员', table: 'group_members', field: 'group_id', via: 'id' }],
};

// 递归数出 JSON 里匹配的元素个数（座位里是学生 id 数字、值日表里是姓名字符串）
function countInJson(value, match) {
  let n = 0;
  const walk = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') { Object.keys(v).forEach((k) => walk(v[k])); return; }
    if (match(v)) n++;
  };
  walk(value);
  return n;
}
// 一行记录的展示名：姓名 / 小组成员 / 学生名 / 小组名 / 主题 / 名称，回退 #id
function rowDisplayName(row, id) {
  return row ? (row.姓名 || row.member_name || row.student_name || row.group_name || row.主题 || row.名称 || row.name || `#${id}`) : `#${id}`;
}

function impactOfRow(table, id) {
  const row = db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
  if (!row) return { table, id, error: `记录不存在（${table} id=${id}）` };
  const refs = [];
  const rules = REFERENCE_RULES[table] || [];
  for (const r of rules) {
    const val = r.via === '姓名' ? String(row['姓名'] || '') : id;
    if (val === '') continue;
    const cnt = db.prepare(`SELECT COUNT(*) AS n FROM "${r.table}" WHERE "${r.field}" = ?`).get(val).n;
    if (!cnt) continue;
    const samples = db.prepare(`SELECT * FROM "${r.table}" WHERE "${r.field}" = ? LIMIT 3`).all(val).map((x) => rowDisplayName(x, x.id));
    refs.push({ label: r.label, table: r.table, count: cnt, samples });
  }
  // 座位表 / 值日表：学生以 id（座位）或姓名（值日）散落在整块 JSON 里
  if (table === 'students') {
    const seatRow = db.prepare('SELECT seats FROM seat_layout WHERE id = 1').get();
    const seatHits = countInJson(safeJson(seatRow && seatRow.seats, []), (v) => v === id);
    if (seatHits) refs.push({ label: '当前座位表', table: 'seat_layout', count: seatHits, samples: [] });
    const name = String(row['姓名'] || '');
    if (name) {
      const dutyRow = db.prepare('SELECT cells FROM duty_layout WHERE id = 1').get();
      const dutyHits = countInJson(safeJson(dutyRow && dutyRow.cells, {}), (v) => v === name);
      if (dutyHits) refs.push({ label: '当前值日表', table: 'duty_layout', count: dutyHits, samples: [] });
    }
  }
  return {
    table,
    id,
    name: rowDisplayName(row, id),
    total: refs.reduce((n, r) => n + r.count, 0),
    refs,
  };
}

function runDeleteImpact({ table, id, ids } = {}) {
  if (!READ_TABLES[table]) return { error: `不存在的表：${table}` };
  const list = (Array.isArray(ids) ? ids : [id])
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 20);
  if (!list.length) return { error: '请提供要删除的记录 id（可先用 query 查出）' };
  const items = list.map((rid) => impactOfRow(table, rid));
  const bad = items.filter((it) => it.error);
  if (bad.length === items.length) return { error: bad[0].error };
  return {
    count: items.length,
    total: items.reduce((n, it) => n + (it.total || 0), 0),
    items,
    note: '以上是删除前查到的引用情况，尚未删除任何数据。',
  };
}

module.exports = { runDeleteImpact };
