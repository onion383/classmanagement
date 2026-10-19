// 一键生成测试账号 + 完整测试数据
// 通过本地后端 HTTP API 写入（服务端需已启动：npm run electron:dev 或打包后运行）。
// 用法： node seed-test-data.js
// 说明：后端运行态已持有正确的主密钥，故这里走 HTTP 注册/登录/写业务数据，
//       生成的账号在应用内可直接登录。
'use strict';

const BASE = 'http://localhost:3000';

// ============ 账号 ============
const USERNAME = '测试班主任';
const PASSWORD = 'test1234';
const ROLE = 'teacher';

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

async function main() {
  // ---------- 1. 注册（已存在则直接登录） ----------
  let slug = null;
  try {
    const r = await req('POST', '/api/register', { username: USERNAME, password: PASSWORD, role: ROLE });
    slug = r.user.dbSlug;
    log(`注册成功 dbSlug=${slug}，恢复密钥：${r.recovery ? r.recovery.phrase : '(无密码账号)'}`);
  } catch (e) {
    if (!/该账号已被注册|已在登记/.test(String(e.message))) throw e;
    log(`账号已存在，改用登录`);
  }

  // ---------- 2. 登录获取 token ----------
  const login = await req('POST', '/api/login', { username: USERNAME, password: PASSWORD });
  const token = login.token;
  TOKEN = token;
  slug = login.user.dbSlug || slug;
  log(`登录成功 => ${USERNAME} (${slug})`);

  // ---------- 3. 学生（30 名） ----------
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
  // 先取已有学生，避免重复导入，也便于后续按姓名/学号引用
  let students = (await req('GET', '/api/students')).data;
  const existingNames = new Set(students.map(s => s.姓名));
  const missingNames = names.filter(n => !existingNames.has(n));
  const rows = missingNames.map((n, idx) => {
    const no = `2026${String(idx + 1).padStart(3, '0')}`;
    const age = 15 + (idx % 3);
    return [no, grade, cls, n, age, `138${String(10000000 + idx * 137).slice(0, 8)}`, `159${String(20000000 + idx * 191).slice(0, 8)}`];
  });
  if (rows.length) {
    await req('POST', '/api/students/import', { fields, rows });
    // 导入后重新拉取，拿最新 id 列表
    students = (await req('GET', '/api/students')).data;
    log(`导入 ${rows.length} 名学生`);
  } else {
    log(`学生已齐全，跳过导入`);
  }

  const nameToId = {};
  students.forEach(s => { nameToId[s.姓名] = s.id; });
  // 前 18 名男生，后 12 名女生（用于宿舍分组）
  const maleNames = names.slice(0, 18);
  const femaleNames = names.slice(18, 30);

  // ---------- 4. 座位（6 行 × 5 列，按学号顺序入座） ----------
  {
    const rowsN = 6, colsN = 5;
    const ids = students.map(s => s.id);
    const seats = [];
    for (let r = 0; r < rowsN; r++) {
      const row = [];
      for (let c = 0; c < colsN; c++) {
        const idx = r * colsN + c;
        row.push(idx < ids.length ? ids[idx] : null);
      }
      seats.push(row);
    }
    await req('PUT', '/api/seats', { mode: 'single', rows: rowsN, cols: colsN, seats, aisleCols: [], groupsConfig: [], settings: {} });
    log(`生成座位 6×5`);
  }

  // ---------- 5. 一般课表（8 节课 × 5 天） ----------
  {
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
    const cells = plan.map(row => row.map(c => ({ course: c })));
    await req('PUT', '/api/schedule/master', { cells, settings: { sections: SECTIONS, days: DAYS } });
    await req('POST', '/api/schedule/apply-master', {});
    log(`生成一般课表 8×5 并应用`);
  }

  // ---------- 6. 卫生值日 ----------
  {
    const days = ['周一', '周二', '周三', '周四', '周五'];
    const items = [
      { name: '擦黑板', difficulty: 0.6, count: 1 },
      { name: '倒垃圾', difficulty: 0.7, count: 2 },
      { name: '扫地', difficulty: 0.8, count: 2 }
    ];
    await req('PUT', '/api/duty/settings', { days, items });
    const cells = {};
    const pointer = { idx: 0 };
    const pick = (count) => {
      const out = [];
      for (let i = 0; i < count; i++) { out.push(names[pointer.idx % names.length]); pointer.idx++; }
      return out;
    };
    for (const it of items) {
      cells[it.name] = {};
      for (const d of days) cells[it.name][d] = pick(it.count);
    }
    await req('PUT', '/api/duty', { cells, settings: { days, items } });
    await req('PUT', '/api/duty/template', { cells, settings: { days, items } });
    log(`生成卫生值日 ${items.length} 项 × ${days.length} 天`);
  }

  // ---------- 7. 分组管理 ----------
  const dims = (await req('GET', '/api/group-manage/bootstrap')).dimensions;
  const defaultDim = dims.find(d => d.is_default === 1) || dims[0];
  // 7.1 默认「宿舍组」：男生 3 间、女生 2 间（每间 6 人）
  await req('PUT', `/api/group-manage/dimensions/${defaultDim.id}`, { male_group_count: 3, female_group_count: 2 });
  const hostels = await req('GET', `/api/group-manage/${defaultDim.id}`);
  {
    const maleGroups = hostels.groups.filter(g => g.gender === 0).sort((a, b) => a.sort_order - b.sort_order);
    const femaleGroups = hostels.groups.filter(g => g.gender === 1).sort((a, b) => a.sort_order - b.sort_order);
    const chunkGroup = async (list, groupsArr) => {
      for (const g of groupsArr) {
        const members = list.slice(groupsArr.indexOf(g) * 6, groupsArr.indexOf(g) * 6 + 6);
        for (const m of members) await req('POST', `/api/group-manage/groups/${g.id}/members`, { member_name: m, remark: '' });
      }
    };
    await chunkGroup(maleNames, maleGroups);
    await chunkGroup(femaleNames, femaleGroups);
  }
  // 7.2 新建「学习小组」维度 6 组 × 5 人
  const lx = await req('POST', '/api/group-manage/dimensions', { name: '学习小组', leader_title: '组长', members_per_group: 5, group_count: 6 });
  const lxDim = await req('GET', `/api/group-manage/${lx.id}`);
  for (const g of lxDim.groups) {
    const gi = lxDim.groups.indexOf(g);
    for (const m of names.slice(gi * 5, gi * 5 + 5)) await req('POST', `/api/group-manage/groups/${g.id}/members`, { member_name: m, remark: '' });
  }
  log(`生成宿舍组(男3+女2) + 学习小组(6组×5人)`);

  // ---------- 8. 班干部 ----------
  {
    const cadrePosts = ['班长', '副班长', '学习委员', '体育委员', '劳动委员', '文艺委员'];
    const pickStudent = (n, offset) => {
      const s = students[n];
      return { student_id: s.id, student_name: s.姓名 };
    };
    for (let i = 0; i < cadrePosts.length; i++) {
      const c = await req('POST', '/api/cadres', { name: cadrePosts[i], parent_id: 0, max_count: 2 });
      const m = pickStudent(i % students.length);
      await req('POST', `/api/cadres/${c.id}/members`, m);
    }
    log(`生成 6 个班干部职务并分配学生`);
  }

  // ---------- 9. 班费收支 ----------
  {
    const feeRows = [
      { 收支类型: '收', 收支金额: 500, 收支时间: '2026-09-01', 备注: '班费收缴' },
      { 收支类型: '支', 收支金额: 86.5, 收支时间: '2026-09-05', 备注: '购买扫把' },
      { 收支类型: '支', 收支金额: 120, 收支时间: '2026-09-08', 备注: '班级文化墙材料' },
      { 收支类型: '收', 收支金额: 60, 收支时间: '2026-09-10', 备注: '旧书回收' }
    ];
    for (const f of feeRows) await req('POST', '/api/fee-records', f);
    log(`生成 4 条班费收支`);
  }

  // ---------- 10. 请假 ----------
  {
    const leaves = [
      { studentId: nameToId[names[0]], 类型: '病假', 开始时间: '2026-09-09', 结束时间: '2026-09-10', 备注: '感冒发烧' },
      { studentId: nameToId[names[3]], 类型: '事假', 开始时间: '2026-09-12', 结束时间: '2026-09-12', 备注: '家中事务' }
    ];
    for (const l of leaves) await req('POST', '/api/leaves', l);
    log(`生成 2 条请假记录`);
  }

  // ---------- 11. 加分管理 ----------
  {
    const recs = [
      { studentId: nameToId[names[0]], 类型: '加分', 项目: '作业优秀', 分值: 2, 原因: '连续一周作业全对' },
      { studentId: nameToId[names[1]], 类型: '加分', 项目: '课堂积极', 分值: 1, 原因: '主动回答问题' },
      { studentId: nameToId[names[2]], 类型: '扣分', 项目: '迟到', 分值: 1, 原因: '早读迟到' },
      { group_name: '学习小组', source: 'group', 成员数: 5, 类型: '加分', 项目: '小组合作', 分值: 3, 原因: '完成小组任务' }
    ];
    for (const s of recs) await req('POST', '/api/scores', s);
    log(`生成 4 条加分/扣分`);
  }

  // ---------- 12. 班级活动 ----------
  {
    const acts = [
      { 时间: '2026-09-20 15:00', 主题: '班级运动会选拔', 地点: '操场', 简介: '挑选种子选手', 参与人员: '全体同学' },
      { 时间: '2026-10-01 09:00', 主题: '喜迎国庆主题班会', 地点: '教室', 简介: '爱国主义教育', 参与人员: '全体同学' }
    ];
    for (const a of acts) await req('POST', '/api/activities', a);
    log(`生成 2 个班级活动`);
  }

  // ---------- 13. 倒计时 ----------
  {
    const cds = [
      { 名称: '期中考试', 截止日: '2026-11-02', 包含这一天: 0 },
      { 名称: '元旦文艺汇演', 截止日: '2026-12-30', 包含这一天: 1 }
    ];
    for (const c of cds) await req('POST', '/api/countdowns', c);
    log(`生成 2 个倒计时`);
  }

  // ---------- 14. 首页班级信息 ----------
  {
    await req('PUT', '/api/widget-settings/class-info', {
      name: '三年级7班',
      motto: '勤奋求实，团结进取',
      mottoStyle: '学习路上永不停步',
      xuefeng: '乐学善思，笃行致远'
    });
    log(`生成班级信息`);
  }

  console.log('\n========== 完成 ==========');
  console.log('账号：' + USERNAME);
  console.log('密码：' + PASSWORD);
  console.log('库：' + slug);
  console.log('请回到登录页切换到该账号登录，即可看到全部测试数据。');
}

main().catch((e) => {
  console.error('\n❌ 生成失败：', e.message);
  process.exit(1);
});