// ===== AI 工具执行：查询 / 聚合 / 找人 / 跨表检索 =====
// 纯代码搬运自 ../executors.js，行为不变。门面装配见 tools.js。
const { db } = require('../../../../db');
const { READ_TABLES } = require('../../ai.constants');
const { tableColumns } = require('../../ai.helpers');
const { AGG_FNS } = require('../tools.schema');
const {
  pinyinMatch, aiParseJson, unpackDutyModeCol, dutyModeLabel, studentIdNameMap,
} = require('./executors.common');

function runQuery({ table, where, order_by, order_dir, limit }) {
  if (!READ_TABLES[table]) return { error: `不支持的查询表：${table}` };
  const cols = tableColumns(table);
  let sql = `SELECT * FROM "${table}"`;
  const params = [];
  if (where && typeof where === 'object') {
    const keys = Object.keys(where);
    // 未知字段必须报错：否则「字段名写错」会被静默丢掉，导致过滤失效、返回全表（数据错误 + 越权读取）
    const unknown = keys.filter((k) => !cols.includes(k));
    if (unknown.length) {
      return {
        error: `where 里的字段不存在：${unknown.join('、')}。该表可用字段：${cols.filter((c) => c !== 'id').join('、')}`,
      };
    }
    if (keys.length) {
      sql += ' WHERE ' + keys.map((k) => `"${k}" = ?`).join(' AND ');
      keys.forEach((k) => params.push(where[k]));
    }
  }
  if (order_by && cols.includes(order_by)) {
    sql += ` ORDER BY "${order_by}" ${order_dir === 'desc' ? 'DESC' : 'ASC'}`;
  } else {
    sql += ' ORDER BY id';
  }
  // limit 必须显式合法（≥1 的整数），非法值直接报错，不替用户猜成 1 或 100；上限 500 收口
  let lim = 100;
  if (limit != null) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1) return { error: `limit 需要是 1 以上的整数（收到：${limit}）` };
    lim = Math.min(n, 500);
  }
  sql += ` LIMIT ${lim}`;
  const rows = db.prepare(sql).all(...params);
  return { count: rows.length, rows };
}

// ===== aggregate 工具执行：直接在 SQL 里聚合统计 =====
//   count/sum/avg/min/max + group_by（最多 3 列）+ where（等值）+ 区间（where_range/where_ranges）+ order/limit。
//   列名一律与真实 schema 校验后按标识符引用（杜绝注入），结果为数据库算好的分组数据。
// 聚合结果列名：仅接受英文标识符，其余由内部按「fn_字段」生成，避免注入并保证结果对象 key 合法
function safeAlias(name) {
  const s = String(name == null ? '' : name).trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : '';
}

function runAggregate({ table, metrics, group_by, where, where_range, where_ranges, order_by, order_dir, limit }) {
  if (!READ_TABLES[table]) return { error: `不支持的查询表：${table}` };
  const cols = tableColumns(table);
  const colSet = new Set(cols);
  const avail = cols.filter((c) => c !== 'id').join('、');
  const mets = (Array.isArray(metrics) ? metrics : []).filter((m) => m && typeof m === 'object');
  if (!mets.length) return { error: '缺少聚合方式（metrics 至少一项，如 [{"fn":"count"}]）' };
  if (mets.length > 8) return { error: '一次最多 8 个聚合项' };
  // 分组列（可选，最多 3 列）：字符串可含逗号分隔的多列，兼容数组写法
  const gRaw = Array.isArray(group_by) ? group_by : (group_by == null ? [] : String(group_by).split(/[,，]/));
  const groups = gRaw.map((g) => String(g).trim()).filter((g) => g !== '');
  const badG = groups.filter((g) => !colSet.has(g));
  if (badG.length) return { error: `group_by 字段不存在：${badG.join('、')}。该表可用字段：${avail}` };
  if (groups.length > 3) return { error: 'group_by 最多 3 列' };
  // SELECT 列表：先分组列，再聚合项（别名为合法标识符并去重）
  const select = groups.map((g) => `"${g}"`);
  const aliases = [];
  for (const m of mets) {
    const fn = String(m.fn || '').toLowerCase();
    if (!AGG_FNS.includes(fn)) return { error: `不支持的聚合方式：${m.fn}（可选 ${AGG_FNS.join('/')}）` };
    const field = m.field == null ? '' : String(m.field);
    let expr;
    if (fn === 'count' && (field === '' || field === '*')) {
      expr = 'COUNT(*)';
    } else {
      if (!field || !colSet.has(field)) {
        return { error: `聚合字段不存在：${field || '(空)'}。该表可用字段：${avail}` };
      }
      expr = `${fn.toUpperCase()}("${field}")`;
    }
    let base = safeAlias(m.alias) || (fn === 'count' && !field ? 'count' : `${fn}_${field.replace(/[^A-Za-z0-9_]/g, '')}`);
    let alias = base;
    let n = 2;
    while (aliases.includes(alias) || groups.includes(alias)) alias = `${base}_${n++}`;
    aliases.push(alias);
    select.push(`${expr} AS "${alias}"`);
  }
  // WHERE：等值 where + 区间（where_range 单个 / where_ranges 数组，每项 { field, gte, lte, gt, lt }）
  const conds = [];
  const params = [];
  if (where && typeof where === 'object' && !Array.isArray(where)) {
    const keys = Object.keys(where);
    const unknown = keys.filter((k) => !colSet.has(k));
    if (unknown.length) return { error: `where 里的字段不存在：${unknown.join('、')}。该表可用字段：${avail}` };
    for (const k of keys) { conds.push(`"${k}" = ?`); params.push(where[k]); }
  }
  const ranges = [
    ...(Array.isArray(where_ranges) ? where_ranges : []),
    ...(where_range && typeof where_range === 'object' && !Array.isArray(where_range) ? [where_range] : []),
  ];
  for (const rg of ranges) {
    if (!rg || typeof rg !== 'object') continue;
    const f = String(rg.field || '');
    if (!colSet.has(f)) return { error: `区间过滤字段不存在：${f || '(空)'}。该表可用字段：${avail}` };
    let used = false;
    for (const [k, op] of [['gte', '>='], ['lte', '<='], ['gt', '>'], ['lt', '<']]) {
      if (rg[k] != null && rg[k] !== '') { conds.push(`"${f}" ${op} ?`); params.push(rg[k]); used = true; }
    }
    if (!used) return { error: `区间过滤的「${f}」没有给出边界（gte/lte/gt/lt 至少一个）` };
  }
  // ORDER BY：只能是分组列或聚合别名
  let orderSql = '';
  if (order_by) {
    const ob = String(order_by);
    if (!aliases.includes(ob) && !groups.includes(ob)) {
      return { error: `order_by 只能用分组列或聚合别名：${[...groups, ...aliases].join('、') || '(无)'}` };
    }
    orderSql = ` ORDER BY "${ob}" ${order_dir === 'desc' ? 'DESC' : 'ASC'}`;
  } else if (groups.length) {
    orderSql = ` ORDER BY ${groups.map((g) => `"${g}"`).join(', ')}`;
  }
  let lim = 100;
  if (limit != null) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1) return { error: `limit 需要是 1 以上的整数（收到：${limit}）` };
    lim = Math.min(n, 500);
  }
  let sql = `SELECT ${select.join(', ')} FROM "${table}"`;
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  if (groups.length) sql += ' GROUP BY ' + groups.map((g) => `"${g}"`).join(', ');
  sql += orderSql;
  sql += ` LIMIT ${lim}`;
  const rows = db.prepare(sql).all(...params);
  return {
    count: rows.length,
    rows,
    group_by: groups,
    metrics: aliases,
    note: '以上是数据库直接聚合后的结果，可直接据此作答，无需再取原始记录',
  };
}

// ===== resolve_student 工具：姓名/拼音/学号片段 → 去重候选 =====
//   写请假/加分前先确认目标学生，降低重名、同拼音写错人的风险。
//   拼音匹配复用前端同款依赖 pinyin-match（懒加载，加载失败时退化为文本/学号匹配）。
function runResolveStudent({ query, limit }) {
  const q = String(query == null ? '' : query).trim();
  if (!q) return { error: '缺少要匹配的内容（query），请给出学生姓名、拼音或学号片段' };
  const cols = tableColumns('students');
  const pick = ['id', '学号', '姓名', '年级', '班级'].filter((c) => cols.includes(c));
  const rows = db.prepare(`SELECT ${pick.map((c) => `"${c}"`).join(', ')} FROM students`).all();
  const lq = q.toLowerCase();
  // 匹配优先级：学号/姓名精确 > 姓名包含 > 学号包含 > 姓名拼音
  const rank = (r) => {
    const sno = String(r['学号'] == null ? '' : r['学号']).toLowerCase();
    const name = String(r['姓名'] == null ? '' : r['姓名']);
    if ((sno && sno === lq) || name === q) return 1;
    if (name.includes(q)) return 2;
    if (sno && sno.includes(lq)) return 3;
    if (pinyinMatch(name, q)) return 4;
    return 99;
  };
  const scored = [];
  for (const r of rows) {
    const rk = rank(r);
    if (rk < 99) scored.push({ r, rk });
  }
  scored.sort((a, b) => a.rk - b.rk || Number(a.r.id) - Number(b.r.id));
  let lim = 10;
  if (limit != null) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1) return { error: `limit 需要是 1 以上的整数（收到：${limit}）` };
    lim = Math.min(n, 20);
  }
  const total = scored.length;
  if (!total) return { ok: true, count: 0, total: 0, candidates: [], note: `没有匹配到「${q}」的学生，请核对姓名/拼音/学号` };
  const candidates = scored.slice(0, lim).map(({ r }) => r);
  return {
    ok: true,
    count: candidates.length,
    total,
    candidates,
    note: total > 1
      ? `匹配到 ${total} 名学生（存在重名或同拼音风险），请先把候选展示给老师确认，再按确认的学生写入`
      : '唯一匹配',
  };
}

// ===== list_changes 工具：撤销栈可见（列出 AI 自己仍可撤销的更改）=====
function runListChanges(args) {
  const undo = require('../../../undo/undo');
  if (typeof undo.listAiChanges !== 'function') return { error: '撤销功能不可用' };
  const list = undo.listAiChanges(args && args.limit);
  if (!list.length) return { ok: true, count: 0, changes: [], note: '你此前没有可撤销的更改' };
  return {
    ok: true,
    count: list.length,
    changes: list.map((b) => ({ step: b.step, label: b.label, count: b.count, keys: b.keys, ts: b.ts })),
    note: 'step 从 1 起（1 = 你最近一次更改）；要回退最近 N 次更改，调用 undo_change 并传 steps=N',
  };
}

// ===== search_all 工具：跨表检索某人在本库各处的痕迹（查哪几张表由 tables 入参决定） =====
// 单表检索器注册表：每个检索器接收上下文 ctx（q/matched/names/ids/idName/hit），返回该表命中的明细数组
const SEARCH_TABLE_LABELS = {
  students: '学生档案',
  score_records: '加减分记录',
  leave_records: '请假记录',
  cadre_members: '班干部任职',
  group_members: '分组名册',
  seat_layout: '座位表',
  duty_layout: '值日表',
};
const SEARCH_TABLE_SEARCHERS = {
  students: (ctx) => ctx.matched.map((s) => ({ id: s.id, 学号: s['学号'], 姓名: s['姓名'], 年级: s['年级'], 班级: s['班级'] })),
  score_records: (ctx) => db.prepare('SELECT id, 姓名, 学号, 类型, 项目, 分值, 原因, 加分时间 FROM score_records').all().filter((r) => ctx.hit(r['姓名'], r.student_id)),
  leave_records: (ctx) => db.prepare('SELECT id, 姓名, 类型, 开始时间, 结束时间, 状态 FROM leave_records').all().filter((r) => ctx.hit(r['姓名'], r.student_id)),
  cadre_members: (ctx) => db.prepare('SELECT id, student_id, student_name FROM cadre_members').all().filter((r) => ctx.hit(r.student_name, r.student_id)),
  group_members: (ctx) => db.prepare('SELECT id, group_id, member_name, remark FROM group_members').all().filter((r) => ctx.hit(r.member_name, null)),
  // 座位表：一格一人；值是数字(id)或姓名
  seat_layout: (ctx) => {
    const row = db.prepare('SELECT seats FROM seat_layout WHERE id = 1').get();
    if (!row) return [];
    const seats = aiParseJson(row.seats, []) || [];
    const out = [];
    for (let r = 0; r < seats.length; r++) {
      const line = Array.isArray(seats[r]) ? seats[r] : [];
      for (let c = 0; c < line.length; c++) {
        const v = line[c];
        if (v == null || v === '') continue;
        const isNum = typeof v === 'number';
        if (ctx.hit(isNum ? null : v, isNum ? v : null)) out.push({ 排: r + 1, 列: c + 1, 值: v, 姓名: isNum ? (ctx.idName[v] || `#${v}`) : String(v) });
      }
    }
    return out;
  },
  // 值日表：{项目:{星期:[姓名]}}，按模式解包
  duty_layout: (ctx) => {
    const row = db.prepare('SELECT cells FROM duty_layout WHERE id = 1').get();
    if (!row) return [];
    const out = [];
    for (const mode of ['daily', 'big']) {
      const cells = unpackDutyModeCol(row.cells, mode);
      for (const item of Object.keys(cells || {})) {
        const daysMap = cells[item] || {};
        for (const day of Object.keys(daysMap)) {
          const raw = daysMap[day];
          const list = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
          const hits = list.map((nm) => (nm == null ? '' : String(nm))).filter((nm) => nm && ctx.hit(nm, null));
          if (hits.length) out.push({ 模式: dutyModeLabel(mode), 项目: item, 星期: day, 姓名: hits.join('、') });
        }
      }
    }
    return out;
  },
};
function runSearchAll({ query, limit, tables } = {}) {
  const q = String(query == null ? '' : query).trim();
  if (!q) return { error: '缺少要搜索的内容（query），请给出学生姓名、拼音或学号片段' };
  const lq = q.toLowerCase();
  const students = db.prepare('SELECT id, 学号, 姓名, 年级, 班级 FROM students').all();
  const matched = students.filter((s) => {
    const name = String(s['姓名'] || '');
    const sno = String(s['学号'] || '').toLowerCase();
    return name === q || sno === lq || name.includes(q) || (sno && sno.includes(lq)) || pinyinMatch(name, q);
  });
  const names = new Set(matched.map((s) => String(s['姓名'] || '')));
  const ids = new Set(matched.map((s) => String(s.id)));
  const idName = studentIdNameMap();
  // 命中判定：id 命中，或姓名（含子串）命中——兼顾问「库里没有的学生」时仍能搜到其它表的残留
  const hit = (nameVal, idVal) => {
    if (idVal != null && idVal !== '' && ids.has(String(idVal))) return true;
    const nm = String(nameVal == null ? '' : nameVal);
    return nm !== '' && (names.has(nm) || nm.includes(q));
  };
  let max = 50;
  if (limit != null) {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1) return { error: `limit 需要是 1 以上的整数（收到：${limit}）` };
    max = Math.min(n, 200);
  }
  // 查哪几张表：由 tables 入参决定，不传则全部
  let want = Object.keys(SEARCH_TABLE_SEARCHERS);
  if (tables != null) {
    const arr = Array.isArray(tables) ? tables : [tables];
    want = arr.map((t) => String(t).trim()).filter((t) => SEARCH_TABLE_SEARCHERS[t]);
    if (!want.length) return { error: `tables 只能是 ${Object.keys(SEARCH_TABLE_SEARCHERS).join('/')} 中的若干项` };
  }
  const ctx = { q, matched, names, ids, idName, hit };
  const sections = [];
  for (const t of want) {
    const items = SEARCH_TABLE_SEARCHERS[t](ctx) || [];
    if (items.length) sections.push({ table: t, label: SEARCH_TABLE_LABELS[t], count: items.length, items: items.slice(0, max), truncated: items.length > max });
  }
  const total = sections.reduce((n, s) => n + s.count, 0);
  return {
    ok: true,
    query: q,
    tables: want,
    matched_students: matched.length,
    total,
    sections,
    note: matched.length === 0
      ? `学生档案里没有匹配「${q}」的学生，以下列出其它表中名称含「${q}」的记录；请核对姓名拼写`
      : (matched.length > 1 ? `学生档案匹配到 ${matched.length} 名学生（可能重名），已一并列出各自的痕迹` : '以下为该学生在本库中的全部痕迹'),
  };
}

module.exports = {
  runQuery, runAggregate, runResolveStudent, runListChanges, runSearchAll,
};
