// 一键生成测试账号 + 完整测试数据
// 通过本地后端 HTTP API 写入（服务端需已启动：npm run electron:dev 或打包后运行）。
// 用法： node seed-test-data.js
//       可选环境变量：SEED_BASE（默认 http://127.0.0.1:3000）
//                     SEED_USER / SEED_PASSWORD（默认 测试班主任 / test1234）
//       安全开关：--yes（或 SEED_ASSUME_YES=1）——见下方注释
// 说明：后端运行态已持有正确的主密钥，故这里走 HTTP 注册/登录/写业务数据，
//       生成的账号在应用内可直接登录。脚本可重复执行：已存在的数据会跳过或按同名重建，
//       不会重复插入学生/班费/加减分/活动/倒计时/职务。
//
// ⚠ 该脚本会**覆盖**目标库的座位/课表/值日/分组/班级信息等测试数据。
//   因此默认只允许「本机回环地址 + 默认测试账号」直接运行；换成真实账号或远程地址时
//   必须显式加 --yes，避免在用户正在使用的班级库上误运行。
'use strict';

const BASE = process.env.SEED_BASE || 'http://127.0.0.1:3000';

// ============ 账号（可用环境变量覆盖，便于多次灌不同账号） ============
const DEFAULT_USERNAME = '测试班主任';
const USERNAME = process.env.SEED_USER || DEFAULT_USERNAME;
const PASSWORD = process.env.SEED_PASSWORD || 'test1234';
const ROLE = 'teacher';

// 覆盖式写入的显式确认：命令行 --yes 或环境变量（供 CI 使用）
const ALLOW_OVERWRITE = process.argv.includes('--yes') || process.env.SEED_ASSUME_YES === '1';
// 只有指向本机、且用的是默认测试账号时才允许「无确认」运行
const IS_LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(BASE);
const IS_DEFAULT_ACCOUNT = USERNAME === DEFAULT_USERNAME;

// 登录后写入，后续所有请求自动携带
let TOKEN = '';

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

function log(step) { console.log('✔', step); }
function skip(step) { console.log('·', step); }

// 今天是本地日期字符串（与后端快照口径一致）
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function mondayOf(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  dt.setDate(dt.getDate() - day + (day === 0 ? -6 : 1));
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

async function main() {
  // ---------- 0. 目标确认（防止在真实班级库上误覆盖） ----------
  const target = `后端 ${BASE} · 账号「${USERNAME}」`;
  if (!ALLOW_OVERWRITE && !(IS_LOOPBACK && IS_DEFAULT_ACCOUNT)) {
    console.error(
      `⚠ 拒绝写入：${target}\n` +
      '  该脚本会用测试数据覆盖座位 / 课表 / 值日 / 分组 / 班级信息。\n' +
      '  只有「本机回环地址 + 默认测试账号」可以直接运行；其他目标请先确认不是正在使用的班级库，\n' +
      '  再加 --yes 重新执行（CI 可用环境变量 SEED_ASSUME_YES=1）。'
    );
    process.exit(1);
  }
  console.log(`目标：${target}${ALLOW_OVERWRITE ? '（已显式确认覆盖）' : ''}`);

  // ---------- 0.1 预检：后端必须已在运行（否则直接报 fetch failed，难以定位） ----------
  try {
    const probe = await fetch(BASE + '/api/accounts');
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (_) {
    throw new Error(`连不上后端 ${BASE}——请先启动应用（npm run electron:dev / 打包版），或用 SEED_BASE 指定地址`);
  }

  // ---------- 1. 注册（有密码账号需 confirm 后才真正建库；已存在则登录） ----------
  let slug = null;
  let recoveryPhrase = '';
  try {
    const r = await req('POST', '/api/register', { username: USERNAME, password: PASSWORD, role: ROLE });
    if (r.recovery && r.recovery.phrase) recoveryPhrase = r.recovery.phrase;
    if (r.draftId) {
      // 有密码账号：注册只生成草稿与恢复密钥，需确认后才建库并签发 token
      const c = await req('POST', '/api/register/confirm', { draftId: r.draftId });
      slug = c.user && c.user.dbSlug;
      if (c.token) TOKEN = c.token;
      log(`注册并确认成功 dbSlug=${slug}`);
    } else if (r.token) {
      TOKEN = r.token;
      slug = r.user && r.user.dbSlug;
      log(`注册成功 dbSlug=${slug}`);
    }
  } catch (e) {
    if (!/该账号已被注册|已在登记/.test(String(e.message))) throw e;
    skip(`账号已存在，改用登录`);
  }

  // ---------- 2. 登录获取 token ----------
  if (!TOKEN) {
    const login = await req('POST', '/api/login', { username: USERNAME, password: PASSWORD });
    TOKEN = login.token;
    slug = login.user.dbSlug || slug;
  }
  log(`登录成功 => ${USERNAME} (${slug})`);

  // ---------- 3. 学期（座位/值日补存与指数结算依赖学期起止日） ----------
  const SEM_START = '2026-09-01';
  const SEM_END = '2027-01-31';
  await req('PUT', '/api/schedule/settings', { semester_start: SEM_START, semester_end: SEM_END });
  log(`设置学期范围 ${SEM_START} ~ ${SEM_END}`);

  // ---------- 4. 学生（30 名，按姓名去重） ----------
  const names = [
    '赵一鸣', '钱子涵', '孙晓彤', '李明轩', '周雨晴',
    '吴俊杰', '郑婷婷', '王浩然', '冯思瑶', '陈宇翔',
    '褚梦琪', '卫立群', '蒋欣怡', '沈志鹏', '韩雅静',
    '杨建国', '朱晓琳', '秦文博', '许诗涵', '何嘉豪',
    '张静雯', '黄伟杰', '曹丽君', '袁俊豪', '邓雅琪',
    '刘子浩', '胡欣悦', '罗立新', '高梦洁', '唐文轩'
  ];
  const grade = '三年级', cls = '7班';
  const fields = ['学号', '年级', '班级', '姓名', '年龄', '家长联系电话', '学生联系电话'];
  let students = (await req('GET', '/api/students')).data;
  const existingNames = new Set(students.map(s => s.姓名));
  // 学号从现有最大值之后接续，避免与已有学生重复
  let nextNo = students.reduce((mx, s) => Math.max(mx, Number(s.学号) || 0), 2026000) + 1;
  const missingNames = names.filter(n => !existingNames.has(n));
  const rows = missingNames.map((n) => {
    const idx = nextNo - 2026001;
    const no = String(nextNo++);
    const age = 15 + (idx % 3);
    return [no, grade, cls, n, age, `138${String(10000000 + idx * 137).slice(0, 8)}`, `159${String(20000000 + idx * 191).slice(0, 8)}`];
  });
  if (rows.length) {
    await req('POST', '/api/students/import', { fields, rows });
    students = (await req('GET', '/api/students')).data;
    log(`导入 ${rows.length} 名学生`);
  } else {
    skip('学生已齐全，跳过导入');
  }

  const nameToId = {};
  students.forEach(s => { nameToId[s.姓名] = s.id; });
  const seeded = students.filter(s => names.includes(s.姓名));
  // 前 18 名男生，后 12 名女生（用于宿舍分组）
  const maleNames = names.slice(0, 18).filter(n => nameToId[n]);
  const femaleNames = names.slice(18, 30).filter(n => nameToId[n]);

  // ---------- 5. 座位（6 行 × 5 列，按学生顺序入座） ----------
  const SEAT_ROWS = 6, SEAT_COLS = 5;
  const seatMatrix = [];
  {
    const ids = seeded.map(s => s.id);
    for (let r = 0; r < SEAT_ROWS; r++) {
      const row = [];
      for (let c = 0; c < SEAT_COLS; c++) {
        const idx = r * SEAT_COLS + c;
        row.push(idx < ids.length ? ids[idx] : null);
      }
      seatMatrix.push(row);
    }
    await req('PUT', '/api/seats', { mode: 'single', rows: SEAT_ROWS, cols: SEAT_COLS, seats: seatMatrix, aisleCols: [], groupsConfig: [], settings: {} });
    log(`生成座位 ${SEAT_ROWS}×${SEAT_COLS}`);
  }

  // ---------- 6. 一般课表（8 节课 × 5 天） ----------
  const DAYS = ['周一', '周二', '周三', '周四', '周五'];
  const SECTIONS = {
    morning: [
      { name: '第1节', start: '08:10', end: '08:55', type: 'lesson' },
      { name: '第2节', start: '09:05', end: '09:50', type: 'lesson' },
      { name: '大课间', start: '09:50', end: '10:20', type: 'rest' },
      { name: '第3节', start: '10:20', end: '11:05', type: 'lesson' },
      { name: '第4节', start: '11:15', end: '12:00', type: 'lesson' }
    ],
    noon: [{ name: '午休', start: '12:00', end: '14:00', type: 'rest' }],
    afternoon: [
      { name: '第5节', start: '14:30', end: '15:15', type: 'lesson' },
      { name: '第6节', start: '15:25', end: '16:10', type: 'lesson' }
    ],
    evening: [{ name: '休息', start: '17:00', end: '18:30', type: 'rest' }],
    night: [
      { name: '晚修1', start: '19:00', end: '19:45', type: 'lesson' },
      { name: '晚修2', start: '19:55', end: '20:40', type: 'lesson' }
    ]
  };
  // 8 个 lesson 行；每格 { course }
  const plan = [
    ['语文', '语文', '数学', '英语', '数学'],
    ['数学', '数学', '英语', '语文', '英语'],
    ['英语', '语文', '语文', '数学', '语文'],
    ['物理', '化学', '生物', '政治', '地理'],
    ['化学', '物理', '政治', '历史', '生物'],
    ['体育', '体育', '信息', '音乐', '美术'],
    ['自习', '自习', '自习', '自习', '自习'],
    ['自习', '自习', '自习', '自习', '自习']
  ];
  const scheduleCells = plan.map(row => row.map(c => ({ course: c })));
  const scheduleSettings = { sections: SECTIONS, days: DAYS };
  {
    await req('PUT', '/api/schedule/master', { cells: scheduleCells, settings: scheduleSettings });
    await req('POST', '/api/schedule/apply-master', {});
    log(`生成一般课表 8×5 并应用`);
  }

  // ---------- 7. 卫生值日 ----------
  const dutyDays = DAYS;
  const dutyItems = [
    { name: '擦黑板', difficulty: 0.6, count: 1 },
    { name: '倒垃圾', difficulty: 0.7, count: 2 },
    { name: '扫地', difficulty: 0.8, count: 2 }
  ];
  const dutyCells = {};
  {
    // 用真实姓名池轮流分配，人数严格等于 count（否则后端一致性校验会拒绝）
    const namePool = seeded.map(s => s.姓名);
    let pointer = 0;
    const pick = (count) => {
      const out = [];
      for (let i = 0; i < count; i++) {
        out.push(namePool[pointer % namePool.length]);
        pointer++;
      }
      return out;
    };
    for (const it of dutyItems) {
      dutyCells[it.name] = {};
      for (const d of dutyDays) dutyCells[it.name][d] = pick(it.count);
    }
    await req('PUT', '/api/duty/settings', { days: dutyDays, items: dutyItems });
    await req('PUT', '/api/duty', { cells: dutyCells, settings: { days: dutyDays, items: dutyItems } });
    await req('PUT', '/api/duty/template', { cells: dutyCells, settings: { days: dutyDays, items: dutyItems } });
    // 值日项目权重（指数结算用）
    const weights = {};
    for (const it of dutyItems) {
      weights[it.name] = {};
      for (const d of dutyDays) weights[it.name][d] = Number((it.difficulty * 10).toFixed(1));
    }
    await req('PUT', '/api/duty/weight', { weights });
    log(`生成卫生值日 ${dutyItems.length} 项 × ${dutyDays.length} 天 + 权重`);
  }

  // ---------- 8. 座位权重 ----------
  {
    const weights = seatMatrix.map((row, r) => row.map((_, c) => {
      // 前排权重略低、中间略高，制造有区分度的指数数据
      return Number((1 + r * 0.4 + (c % 2 === 0 ? 0.2 : 0)).toFixed(1));
    }));
    await req('PUT', '/api/seats/weight', { mode: 'single', rows: SEAT_ROWS, cols: SEAT_COLS, weights, settings: {} });
    log(`生成座位权重 ${SEAT_ROWS}×${SEAT_COLS}`);
  }

  // ---------- 9. 分组管理 ----------
  const dims = (await req('GET', '/api/group-manage/bootstrap')).dimensions;
  const defaultDim = dims.find(d => d.is_default === 1) || dims[0];
  // 9.1 默认「宿舍组」：男生 3 间、女生 2 间（每间 6 人）
  //     注意：该接口会重建全部宿舍组（含成员），因此重复执行不会产生重复成员。
  await req('PUT', `/api/group-manage/dimensions/${defaultDim.id}`, { male_group_count: 3, female_group_count: 2 });
  {
    const hostels = await req('GET', `/api/group-manage/${defaultDim.id}`);
    const maleGroups = hostels.groups.filter(g => g.gender === 0).sort((a, b) => a.sort_order - b.sort_order);
    const femaleGroups = hostels.groups.filter(g => g.gender === 1).sort((a, b) => a.sort_order - b.sort_order);
    const fill = async (list, groupsArr) => {
      for (let gi = 0; gi < groupsArr.length; gi++) {
        const g = groupsArr[gi];
        const members = list.slice(gi * 6, gi * 6 + 6);
        for (const m of members) await req('POST', `/api/group-manage/groups/${g.id}/members`, { member_name: m, remark: '' });
      }
    };
    await fill(maleNames, maleGroups);
    await fill(femaleNames, femaleGroups);
  }
  // 9.2 「学习小组」维度 6 组 × 5 人：已存在同名维度先删除再重建，保证可重复执行
  {
    const old = dims.find(d => d.name === '学习小组' && !d.is_default);
    if (old) await req('DELETE', `/api/group-manage/dimensions/${old.id}`);
    const lx = await req('POST', '/api/group-manage/dimensions', { name: '学习小组', leader_title: '组长', members_per_group: 5, group_count: 6 });
    const lxDim = await req('GET', `/api/group-manage/${lx.id}`);
    for (let gi = 0; gi < lxDim.groups.length; gi++) {
      const slice = names.slice(gi * 5, gi * 5 + 5);
      for (const m of slice) await req('POST', `/api/group-manage/groups/${lxDim.groups[gi].id}/members`, { member_name: m, remark: '' });
    }
    log(`生成宿舍组(男3+女2) + 学习小组(6组×5人)`);
  }

  // ---------- 10. 班干部（按职务名去重） ----------
  {
    const tree = (await req('GET', '/api/cadres')).tree;
    const existingPosts = new Set();
    const walk = (nodes) => nodes.forEach(n => { existingPosts.add(n.name); if (n.children) walk(n.children); });
    walk(tree || []);
    const cadrePosts = ['班长', '副班长', '学习委员', '体育委员', '劳动委员', '文艺委员'];
    let created = 0;
    for (let i = 0; i < cadrePosts.length; i++) {
      if (existingPosts.has(cadrePosts[i])) continue;
      const c = await req('POST', '/api/cadres', { name: cadrePosts[i], parent_id: 0, max_count: 2 });
      const s = students[i % students.length];
      await req('POST', `/api/cadres/${c.id}/members`, { student_id: s.id, student_name: s.姓名 });
      created++;
    }
    log(created ? `生成 ${created} 个班干部职务并分配学生` : `班干部已存在，跳过`);
  }

  // ---------- 11. 班费收支（按备注去重） ----------
  {
    const existing = (await req('GET', '/api/fee-records')).data;
    const notes = new Set(existing.map(r => r.备注));
    const feeRows = [
      { 收支类型: '收入', 收支金额: 500, 收支时间: '2026-09-01', 备注: '班费收缴' },
      { 收支类型: '支出', 收支金额: 86.5, 收支时间: '2026-09-05', 备注: '购买扫把' },
      { 收支类型: '支出', 收支金额: 120, 收支时间: '2026-09-08', 备注: '班级文化墙材料' },
      { 收支类型: '收入', 收支金额: 60, 收支时间: '2026-09-10', 备注: '旧书回收' }
    ].filter(f => !notes.has(f.备注));
    for (const f of feeRows) await req('POST', '/api/fee-records', f);
    log(feeRows.length ? `生成 ${feeRows.length} 条班费收支` : '班费收支已存在，跳过');
  }

  // ---------- 12. 请假（按姓名+开始时间去重；结束必须晚于开始） ----------
  {
    const existing = (await req('GET', '/api/leaves')).data;
    const key = (r) => `${r.姓名}|${r.开始时间}`;
    const keys = new Set(existing.map(key));
    const pairs = [
      { name: names[0], row: { studentId: nameToId[names[0]], 类型: '病假', 开始时间: '2026-09-09', 结束时间: '2026-09-10', 备注: '感冒发烧' } },
      { name: names[3], row: { studentId: nameToId[names[3]], 类型: '事假', 开始时间: '2026-09-12', 结束时间: '2026-09-13', 备注: '家中事务' } }
    ];
    const leaves = pairs.filter(p => !keys.has(`${p.name}|${p.row.开始时间}`)).map(p => p.row);
    for (const l of leaves) await req('POST', '/api/leaves', l);
    log(leaves.length ? `生成 ${leaves.length} 条请假记录` : '请假记录已存在，跳过');
  }

  // ---------- 13. 加分管理（按原因去重） ----------
  {
    const existing = (await req('GET', '/api/scores')).data;
    const reasons = new Set(existing.map(r => r.原因));
    const recs = [
      { studentId: nameToId[names[0]], 类型: '加分', 项目: '作业优秀', 分值: 2, 原因: '连续一周作业全对' },
      { studentId: nameToId[names[1]], 类型: '加分', 项目: '课堂积极', 分值: 1, 原因: '主动回答问题' },
      { studentId: nameToId[names[2]], 类型: '扣分', 项目: '迟到', 分值: 1, 原因: '早读迟到' },
      { group_name: '学习小组', source: 'group', 成员数: 5, 类型: '加分', 项目: '小组合作', 分值: 3, 原因: '完成小组任务' }
    ].filter(r => !reasons.has(r.原因));
    for (const s of recs) await req('POST', '/api/scores', s);
    log(recs.length ? `生成 ${recs.length} 条加分/扣分` : '加分记录已存在，跳过');
  }

  // ---------- 14. 班级活动（按主题去重） ----------
  {
    const existing = (await req('GET', '/api/activities')).data;
    const titles = new Set(existing.map(r => r.主题));
    const acts = [
      { 时间: '2026-09-20 15:00', 主题: '班级运动会选拔', 地点: '操场', 简介: '挑选种子选手', 参与人员: '全体同学' },
      { 时间: '2026-10-01 09:00', 主题: '喜迎国庆主题班会', 地点: '教室', 简介: '爱国主义教育', 参与人员: '全体同学' }
    ].filter(a => !titles.has(a.主题));
    for (const a of acts) await req('POST', '/api/activities', a);
    log(acts.length ? `生成 ${acts.length} 个班级活动` : '班级活动已存在，跳过');
  }

  // ---------- 15. 倒计时（按名称去重） ----------
  {
    const existing = (await req('GET', '/api/countdowns')).data;
    const titles = new Set(existing.map(r => r.名称));
    const cds = [
      { 名称: '期中考试', 截止日: '2026-11-02', 包含这一天: 0 },
      { 名称: '元旦文艺汇演', 截止日: '2026-12-30', 包含这一天: 1 }
    ].filter(c => !titles.has(c.名称));
    for (const c of cds) await req('POST', '/api/countdowns', c);
    log(cds.length ? `生成 ${cds.length} 个倒计时` : '倒计时已存在，跳过');
  }

  // ---------- 16. 今日历史快照 + 学期补存（让「座位指数 / 值日指数」有数据） ----------
  const today = todayStr();
  try {
    await req('POST', '/api/schedule/snapshot', {
      week_start: mondayOf(today), cells: scheduleCells, settings: scheduleSettings,
    });
    await req('POST', '/api/seats/snapshot', {
      snap_date: today, mode: 'single', rows: SEAT_ROWS, cols: SEAT_COLS, seats: seatMatrix, settings: {},
    });
    await req('POST', '/api/duty/snapshot', {
      snap_date: today, mode: 'daily', cells: dutyCells, settings: { days: dutyDays, items: dutyItems },
    });
    // 学期范围内补存每日快照（只在缺失时补，可重复执行）
    const dutyBackfill = await req('POST', '/api/duty/snapshot/backfill', { mode: 'daily', includeToday: true });
    const seatBackfill = await req('POST', '/api/seats/snapshot/backfill', { includeToday: true });
    log(`生成今日快照；补存值日 ${dutyBackfill.inserted || 0} 天、座位 ${seatBackfill.inserted || 0} 天`);
  } catch (e) {
    skip(`历史快照跳过：${e.message}`);
  }

  // ---------- 17. 首页班级信息 ----------
  {
    await req('PUT', '/api/widget-settings/class-info', {
      name: '三年级7班',
      motto: '勤奋求实，团结进取',
      mottoStyle: '学习路上永不停步',
      xuefeng: '乐学善思，笃行致远'
    });
    log(`生成班级信息`);
  }

  // ---------- 18. 回读校验 ----------
  {
    const dash = await req('GET', '/api/dashboard');
    const seats = await req('GET', '/api/seats');
    const dutyHist = await req('GET', '/api/duty/history?mode=daily');
    const seatHist = await req('GET', '/api/seats/history');
    console.log(
      `校验：学生 ${dash.students.length} · 加分 ${dash.scores.length} · 请假 ${dash.leaves.length}` +
      ` · 活动 ${dash.activities.length} · 班费 ${dash.fees.length} · 倒计时 ${dash.countdowns.length}` +
      ` · 课表 ${dash.schedule.cells.length} 行 · 值日项目 ${dash.duty.settings.items.length}` +
      ` · 座位 ${seats.rows}×${seats.cols} · 值日历史 ${dutyHist.length} 周 · 座位历史 ${seatHist.length} 周`
    );
  }

  console.log('\n========== 完成 ==========');
  console.log('账号：' + USERNAME);
  console.log('密码：' + PASSWORD);
  console.log('库：' + slug);
  if (recoveryPhrase) console.log('恢复密钥：' + recoveryPhrase);
  console.log('请回到登录页切换到该账号登录，即可看到全部测试数据。');
}

main().catch((e) => {
  console.error('\n❌ 生成失败：', e.message);
  process.exit(1);
});
