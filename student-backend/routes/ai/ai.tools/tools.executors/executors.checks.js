// ===== AI 工具执行：数据体检 / 冲突检测 / 权重评分 =====
// 纯代码搬运自 ../executors.js，行为不变。门面装配见 tools.js。
const { db } = require('../../../../db');
const {
  aiParseDate, aiParseJson, aiTodayStr, studentIdNameMap,
  unpackDutyModeCol, dutyModeLabel, aiLooksMultiCourse,
} = require('./executors.common');

// ===== run_checks 工具：按 checks 入参逐条执行数据校验（跑哪几条由调用方传入） =====
// 单条校验规则注册表：每条接收上下文 ctx（students/nameSet/idSet），返回该规则命中的明细数组
const CHECK_LABELS = {
  cadre_dangling: '班干部任职指向了不存在的学生',
  group_dangling: '分组名册成员不在学生名单里',
  leave_reversed: '请假结束时间早于开始时间',
  fee_negative: '班费金额为负',
  sno_duplicate: '学号重复',
};
const CHECK_RULES = {
  // 班干部任职指向不存在的学生
  cadre_dangling: (ctx) => db.prepare('SELECT id, cadre_id, student_id, student_name FROM cadre_members').all().filter((r) => {
    if (r.student_id != null && Number(r.student_id) > 0) return !ctx.idSet.has(Number(r.student_id));
    return !ctx.nameSet.has(String(r.student_name || ''));
  }).map((r) => ({ id: r.id, cadre_id: r.cadre_id, student_id: r.student_id, student_name: r.student_name })),
  // 分组名册成员不在学生名单里
  group_dangling: (ctx) => db.prepare('SELECT id, group_id, member_name FROM group_members').all()
    .filter((r) => String(r.member_name || '').trim() && !ctx.nameSet.has(String(r.member_name)))
    .map((r) => ({ id: r.id, group_id: r.group_id, member_name: r.member_name })),
  // 请假结束时间早于开始时间
  leave_reversed: () => {
    const out = [];
    for (const r of db.prepare('SELECT id, 姓名, 开始时间, 结束时间 FROM leave_records').all()) {
      const a = aiParseDate(r['开始时间']);
      const b = aiParseDate(r['结束时间']);
      if (a && b && b < a) out.push({ id: r.id, 姓名: r['姓名'], 开始时间: r['开始时间'], 结束时间: r['结束时间'] });
    }
    return out;
  },
  // 班费金额为负
  fee_negative: () => db.prepare('SELECT id, 收支类型, 收支金额, 收支时间, 备注 FROM fee_records').all()
    .filter((r) => Number(r['收支金额']) < 0)
    .map((r) => ({ id: r.id, 收支类型: r['收支类型'], 收支金额: r['收支金额'], 收支时间: r['收支时间'] })),
  // 学号重复
  sno_duplicate: (ctx) => {
    const bySno = {};
    for (const s of ctx.students) {
      const k = String(s['学号'] || '').trim();
      if (!k) continue;
      (bySno[k] = bySno[k] || []).push({ id: s.id, 姓名: s['姓名'] });
    }
    return Object.keys(bySno).filter((k) => bySno[k].length > 1).map((k) => ({ 学号: k, 人数: bySno[k].length, 学生: bySno[k] }));
  },
};
function runChecks({ checks } = {}) {
  // 跑哪几条规则：由 checks 入参决定，不传则全部
  let want = Object.keys(CHECK_RULES);
  if (checks != null) {
    const arr = Array.isArray(checks) ? checks : [checks];
    want = arr.map((c) => String(c).trim()).filter((c) => CHECK_RULES[c]);
    if (!want.length) return { error: `checks 只能是 ${Object.keys(CHECK_RULES).join('/')} 中的若干项` };
  }
  const students = db.prepare('SELECT id, 学号, 姓名 FROM students').all();
  const ctx = {
    students,
    nameSet: new Set(students.map((s) => String(s['姓名'] || '')).filter(Boolean)),
    idSet: new Set(students.map((s) => Number(s.id))),
  };
  const issues = [];
  for (const c of want) {
    const items = CHECK_RULES[c](ctx) || [];
    if (items.length) issues.push({ type: c, title: CHECK_LABELS[c], count: items.length, items });
  }
  const total = issues.reduce((n, it) => n + it.count, 0);
  return {
    ok: true, checked: want, total, clean: total === 0, issues,
    note: total === 0 ? '体检通过：所查规则均未发现问题' : `共发现 ${total} 处问题，分 ${issues.length} 类，见 issues`,
  };
}

// ===== run_conflict_checks 工具：按 checks 入参逐条执行排布冲突检测（跑哪几条由调用方传入） =====
// 单条冲突检查注册表：每条接收上下文 ctx（mode），返回该规则命中的明细数组
const CONFLICT_LABELS = {
  seat_duplicate: '座位表同一人坐了多个位置',
  duty_duplicate: '值日表同一人同一天被排在多个劳动项目',
  countdown_passed: '倒计时截止日已过',
  schedule_conflict: '课表格内多课 / 结构异常',
};
const CONFLICT_RULES = {
  // 座位表：同一人坐多个位置
  seat_duplicate: () => {
    const row = db.prepare('SELECT seats FROM seat_layout WHERE id = 1').get();
    if (!row) return [];
    const seats = aiParseJson(row.seats, []) || [];
    const idName = studentIdNameMap();
    const pos = {};
    for (let r = 0; r < seats.length; r++) {
      const line = Array.isArray(seats[r]) ? seats[r] : [];
      for (let c = 0; c < line.length; c++) {
        const v = line[c];
        if (v == null || v === '') continue;
        (pos[String(v)] = pos[String(v)] || []).push({ 排: r + 1, 列: c + 1 });
      }
    }
    return Object.keys(pos).filter((k) => pos[k].length > 1).map((k) => ({
      姓名: idName[Number(k)] || k, 座位数: pos[k].length, 位置: pos[k],
    }));
  },
  // 值日表：同一人同一天被排在多个劳动项目
  duty_duplicate: (ctx) => {
    const row = db.prepare('SELECT cells FROM duty_layout WHERE id = 1').get();
    if (!row) return [];
    const modes = ctx.mode === 'big' ? ['big'] : ['daily'];
    const out = [];
    for (const m of modes) {
      const cells = unpackDutyModeCol(row.cells, m);
      const per = {}; // 姓名 → {星期: [项目]}
      for (const item of Object.keys(cells || {})) {
        const daysMap = cells[item] || {};
        for (const day of Object.keys(daysMap)) {
          const raw = daysMap[day];
          const list = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
          for (const nm of list) {
            if (!nm) continue;
            (per[nm] = per[nm] || {});
            (per[nm][day] = per[nm][day] || []).push(item);
          }
        }
      }
      for (const nm of Object.keys(per)) {
        for (const day of Object.keys(per[nm])) {
          if (per[nm][day].length > 1) out.push({ 模式: dutyModeLabel(m), 姓名: nm, 星期: day, 项目: per[nm][day] });
        }
      }
    }
    return out;
  },
  // 倒计时：截止日已过
  countdown_passed: () => {
    const today = aiTodayStr();
    return db.prepare('SELECT id, 名称, 截止日 FROM countdowns').all()
      .filter((r) => { const d = aiParseDate(r['截止日']); return d && d < today; })
      .map((r) => ({ id: r.id, 名称: r['名称'], 截止日: r['截止日'] }));
  },
  // 课表：格内多课 / 结构异常
  schedule_conflict: () => {
    const row = db.prepare('SELECT cells, settings FROM schedule WHERE id = 1').get();
    if (!row) return [];
    const cells = aiParseJson(row.cells, []) || [];
    const settings = aiParseJson(row.settings, {}) || {};
    const days = (Array.isArray(settings.days) && settings.days.length) ? settings.days : ['周一', '周二', '周三', '周四', '周五'];
    const out = [];
    for (let r = 0; r < cells.length; r++) {
      const line = Array.isArray(cells[r]) ? cells[r] : [];
      if (line.length && line.length !== days.length) {
        out.push({ 类型: '结构异常', 节次: r + 1, 说明: `该行有 ${line.length} 格，应为 ${days.length} 格（${days.length} 天）` });
      }
      for (let c = 0; c < line.length; c++) {
        const v = line[c];
        const text = v && typeof v === 'object' ? String(v.course || '') : String(v == null ? '' : v);
        if (aiLooksMultiCourse(text)) out.push({ 类型: '同节多课', 节次: r + 1, 星期: days[c] || `第${c + 1}列`, 内容: text });
      }
    }
    return out;
  },
};
function runConflictChecks({ checks, mode } = {}) {
  // 跑哪几条规则：由 checks 入参决定，不传则全部
  let want = Object.keys(CONFLICT_RULES);
  if (checks != null) {
    const arr = Array.isArray(checks) ? checks : [checks];
    want = arr.map((c) => String(c).trim()).filter((c) => CONFLICT_RULES[c]);
    if (!want.length) return { error: `checks 只能是 ${Object.keys(CONFLICT_RULES).join('/')} 中的若干项` };
  }
  const issues = [];
  for (const c of want) {
    const items = CONFLICT_RULES[c]({ mode }) || [];
    if (items.length) issues.push({ type: c, title: CONFLICT_LABELS[c], count: items.length, items });
  }
  const total = issues.reduce((n, it) => n + it.count, 0);
  return { ok: true, checked: want, total, issues, note: total === 0 ? '未检测到冲突' : `共发现 ${total} 处冲突，分 ${issues.length} 类，见 issues` };
}

// ===== score_weights 工具：复用「座位指数/值日指数」口径给排布评分 =====
// 座位：对学期内每日快照的每个座位，取其位置权重 weights[r][c] 累加到该学生名下（同 SeatView seatIndexRows）
function scoreSeatIndex(fromD, toD, lim) {
  const w = db.prepare('SELECT weights FROM seat_weight WHERE id = 1').get();
  const weights = w ? (aiParseJson(w.weights, []) || []) : [];
  const idName = studentIdNameMap();
  const sql = fromD
    ? 'SELECT seats FROM seat_history WHERE snap_date >= ? AND snap_date <= ? ORDER BY snap_date'
    : 'SELECT seats FROM seat_history WHERE snap_date <= ? ORDER BY snap_date';
  const rows = fromD ? db.prepare(sql).all(fromD, toD) : db.prepare(sql).all(toD);
  const acc = {};
  for (const row of rows) {
    const seats = aiParseJson(row.seats, []) || [];
    for (let r = 0; r < seats.length; r++) {
      const wRow = weights[r];
      if (!Array.isArray(wRow)) continue;
      const sRow = Array.isArray(seats[r]) ? seats[r] : [];
      for (let c = 0; c < sRow.length; c++) {
        const v = sRow[c];
        if (v == null || v === '') continue;
        const wv = wRow[c];
        if (typeof wv !== 'number') continue;
        const name = typeof v === 'number' ? (idName[v] || `#${v}`) : String(v);
        acc[name] = (acc[name] || 0) + wv;
      }
    }
  }
  const list = Object.keys(acc).map((name) => ({ 姓名: name, 得分: acc[name] })).filter((x) => x.得分 !== 0).sort((a, b) => b.得分 - a.得分);
  return { 覆盖天数: rows.length, 人数: list.length, 最差: list.slice(0, lim), 最好: list.slice(-lim).reverse() };
}
// 值日：对学期内每日快照的每个槽位，取其项目权重 weights[项目][星期] 累加到姓名（同 DutyView dutyIndexRows）
function scoreDutyIndex(fromD, toD, lim, mode) {
  const m = mode === 'big' ? 'big' : 'daily';
  const wr = db.prepare('SELECT weights FROM duty_weight WHERE id = 1').get();
  const weights = wr ? unpackDutyModeCol(wr.weights, m) : {};
  const params = [m];
  let sql = 'SELECT cells FROM duty_history WHERE mode = ?';
  if (fromD) { sql += ' AND snap_date >= ?'; params.push(fromD); }
  sql += ' AND snap_date <= ?'; params.push(toD);
  sql += ' ORDER BY snap_date';
  const rows = db.prepare(sql).all(...params);
  const acc = {};
  for (const row of rows) {
    const cells = aiParseJson(row.cells, {}) || {};
    for (const item of Object.keys(cells)) {
      const daysMap = cells[item] || {};
      const wItem = weights[item] || {};
      for (const day of Object.keys(daysMap)) {
        const wv = wItem[day];
        if (typeof wv !== 'number') continue;
        const raw = daysMap[day];
        const names = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
        for (const nm of names) { if (!nm) continue; acc[nm] = (acc[nm] || 0) + wv; }
      }
    }
  }
  const list = Object.keys(acc).map((name) => ({ 姓名: name, 得分: acc[name] })).filter((x) => x.得分 !== 0).sort((a, b) => b.得分 - a.得分);
  return { 模式: dutyModeLabel(m), 覆盖天数: rows.length, 人数: list.length, 最差: list.slice(0, lim), 最好: list.slice(-lim).reverse() };
}
function runScoreWeights({ type, from, to, top, mode } = {}) {
  const kind = (type === 'seat' || type === 'duty') ? type : 'both';
  let lim = 5;
  if (top != null) {
    const n = Number(top);
    if (!Number.isInteger(n) || n < 1) return { error: `top 需要是 1 以上的整数（收到：${top}）` };
    lim = Math.min(n, 50);
  }
  const st = db.prepare('SELECT semester_start FROM schedule_settings WHERE id = 1').get();
  const fromD = aiParseDate(from) || (st ? aiParseDate(st.semester_start) : '');
  const toD = aiParseDate(to) || aiTodayStr();
  const result = { ok: true, type: kind, range: { from: fromD || '(最早快照)', to: toD }, note: '口径与界面「座位指数/值日指数」一致：学期内每日快照按位置/项目权重逐天累加，数值越高代表承担越多（越吃亏）；最差=累计最高的前若干人。' };
  if (!fromD) result.note += ' 未设置学期开始日，已从最早快照算起。';
  if (kind === 'seat' || kind === 'both') result.seat = scoreSeatIndex(fromD, toD, lim);
  if (kind === 'duty' || kind === 'both') result.duty = scoreDutyIndex(fromD, toD, lim, mode);
  return result;
}

module.exports = { runChecks, runConflictChecks, runScoreWeights };
