// ===== AI 工具执行逻辑（门面：装配 + 过程块文案 + 展示类工具）=====
// 历史上从 ai.tools.js 纯代码搬运而来；现已按域下沉为：
//   ./executors.proposal.js  提案写入（propose_* / 批量操作）
//   ./executors.query.js     查询 / 聚合 / 找人 / 跨表检索
//   ./executors.checks.js    数据体检 / 冲突检测 / 权重评分
//   ./executors.image.js     export_image 排布图规格
//   ./executors.snapshot.js  整库快照
//   ./executors.impact.js    删除影响预估
//   ./executors.common.js    通用小工具（日期 / JSON / 拼音 / 值日解包）
// 本文件只保留「展示类工具 + 过程块文案」并统一再导出，对外接口与拆分前一致。
const { db, getFields } = require('../../../../db');
const { COLUMN_RULES } = require('../../../../services/sanitize');
const dbManager = require('../../../../dbManager/dbManager');
const { READ_TABLES, WRITE_TABLES, JSON_WRITE_TABLES } = require('../../ai.constants');
const { tableColumns } = require('../../ai.helpers');
const { CHART_TYPES } = require('../tools.schema');
const { aiParseDate, aiDateStr } = require('./executors.common');
const snapshot = require('./executors.snapshot');
const impact = require('./executors.impact');
const proposal = require('./executors.proposal');
const query = require('./executors.query');
const checks = require('./executors.checks');
const image = require('./executors.image');

// show_record 工具：模型只给「表名 + id」，后端转成前端可渲染的 record 代码块
function runShowRecord({ table, ids }) {
  if (!READ_TABLES[table]) return { error: `不支持的数据表：${table}` };
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 30);
  if (!list.length) return { error: '缺少有效的记录 id' };
  return { block: '```record\n' + JSON.stringify({ table, ids: list }) + '\n```', table, count: list.length };
}

// 把数据块（record 表格 / chart 图表）拼到回复末尾，前端按 ```record / ```chart 解析并渲染
function appendBlocks(text, blocks) {
  if (!blocks.length) return text;
  return text ? `${text}\n\n${blocks.join('\n\n')}` : blocks.join('\n\n');
}

// show_chart 工具：模型只给「类型 + 标签 + 数值」，后端转成前端可渲染的 chart 代码块
function runShowChart({ type, title, labels, values, unit }) {
  const t = CHART_TYPES.includes(type) ? type : 'bar';
  const ls = (Array.isArray(labels) ? labels : []).map((x) => String(x == null ? '' : x).slice(0, 30)).slice(0, 12);
  const vs = (Array.isArray(values) ? values : []).map((x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; }).slice(0, 12);
  const n = Math.min(ls.length, vs.length);
  if (n < 1) return { error: '缺少图表数据（labels 与 values 至少各需要 1 项）' };
  const data = {
    type: t,
    title: String(title || '').slice(0, 40),
    unit: String(unit || '').slice(0, 8),
    labels: ls.slice(0, n),
    values: vs.slice(0, n),
  };
  // 饼图按占比绘制，负值无意义
  if (t === 'pie' && data.values.reduce((a, b) => a + Math.max(0, b), 0) <= 0) {
    return { error: '饼图需要至少一个大于 0 的数值（占比数据请用正数）' };
  }
  return { block: '```chart\n' + JSON.stringify(data) + '\n```', type: t, count: n, title: data.title };
}

// ask_user 工具：模型向用户提问并给候选选项，用户回答后作为新一轮消息继续对话
//   支持一次提多个问题：questions: [{ question, options, multiple }]
//   multiple=true 时该题为多选；界面会自动附加一个「其他」输入框供用户自由补充。
function normalizeAsk({ question, options, questions, multiple }) {
  const normOne = (q, opts, multi) => {
    const text = typeof q === 'string' ? q.trim().slice(0, 200) : '';
    if (!text) return null;
    const list = (Array.isArray(opts) ? opts : [])
      .map((o) => (typeof o === 'string' ? o.trim().slice(0, 60) : ''))
      .filter(Boolean)
      .slice(0, 6);
    // multiple：多选（可同时勾选多项，并与界面自带的「其他」补充并存）；选项不足 2 个时无意义
    return { question: text, options: list, multiple: !!multi && list.length > 1 };
  };
  // 优先按新的一次多问解析；兼容模型偶发的单问题写法
  let list = [];
  if (Array.isArray(questions) && questions.length) {
    list = questions
      .map((it) => normOne(it && it.question, it && it.options, it && it.multiple))
      .filter(Boolean)
      .slice(0, 5);
  } else {
    const one = normOne(question, options, multiple);
    if (one) list = [one];
  }
  if (!list.length) return { error: '缺少问题内容' };
  return { ok: true, ask: { questions: list } };
}

// propose_skill 工具：新建 / 更新 / 删除技能（md 指令文件），生成提案，老师确认后才落盘。
// 技能本身就是「给模型看的指令」，故正文由模型自己按 Markdown 写；这里只校验名字与存在性。
function skillNamesText(slug) {
  const names = dbManager.listSkills(slug).map((s) => s.name);
  if (!names.length) return '（当前还没有任何技能）';
  return names.length > 30 ? `${names.slice(0, 30).join('、')}…等 ${names.length} 个` : names.join('、');
}

function runProposeSkill(args, ctx) {
  const op = String((args && args.operation) || '');
  if (!['create', 'update', 'delete'].includes(op)) return { error: 'operation 必须是 create / update / delete' };
  const name = dbManager.normalizeSkillName(args && args.name);
  if (!name) return { error: '技能名不合法：不能为空，不能含 \\ / : * ? " < > | 等字符，最长 60 字' };
  const slug = ctx && ctx.slug;
  const exists = dbManager.skillExists(slug, name);
  if (op === 'delete') {
    if (!exists) return { error: `技能「${name}」不存在。现有技能：${skillNamesText(slug)}` };
    return {
      proposal: {
        kind: 'skill', operation: 'delete', name,
        before: dbManager.readSkill(slug, name).slice(0, 4000),
        label: `删除技能「${name}」`,
      },
    };
  }
  const content = String((args && args.content) == null ? '' : args.content);
  if (!content.trim()) return { error: `${op === 'create' ? '新建' : '更新'}技能必须给出 content（技能正文，Markdown 格式）` };
  if (op === 'create' && exists) return { error: `技能「${name}」已存在，请改用 operation=update 覆盖内容，或换一个名字` };
  if (op === 'update' && !exists) return { error: `技能「${name}」不存在。现有技能：${skillNamesText(slug)}` };
  return {
    proposal: {
      kind: 'skill', operation: op, name, content,
      ...(op === 'update' ? { before: dbManager.readSkill(slug, name).slice(0, 4000) } : {}),
      label: `${op === 'create' ? '新建' : '更新'}技能「${name}」`,
    },
  };
}

// export_file 工具：把二维数据导出为文件（Excel/CSV/Markdown/TXT/JSON）。
// 后端只做校验并生成「导出规格」下发给前端，由前端生成文件字节并弹系统保存对话框写入本地。
const EXPORT_FORMATS = ['xlsx', 'csv', 'md', 'txt', 'json'];

// 校验并规整 export_file 参数为下发前端的导出规格
function normalizeExport({ format, filename, columns, rows, title }) {
  if (!EXPORT_FORMATS.includes(format)) {
    return { error: '不支持的导出格式（可选 xlsx/csv/md/txt/json）' };
  }
  const cols = Array.isArray(columns) ? columns.map((c) => String(c == null ? '' : c)).filter((c) => c !== '') : [];
  if (!cols.length) return { error: '缺少表头列（columns）' };
  const rws = Array.isArray(rows)
    ? rows.filter(Array.isArray).slice(0, 5000).map((r) => r.map((v) => (v == null ? '' : String(v))))
    : [];
  if (!rws.length) return { error: '没有可导出的数据行' };
  // 去掉文件名里对文件系统非法的字符，兜底一个默认名
  const name = String(filename || '').trim().replace(/[\\/:*?"<>|]/g, '').slice(0, 80) || 'AI导出';
  return { spec: { format, filename: name, columns: cols, rows: rws, title: title ? String(title).slice(0, 100) : '' } };
}

// 工具调用在下发给前端的「过程块」中的显示文案
//   running：执行中的标题（…）  done：执行完成后的标题
const TOOL_INFO = {
  query: { running: '正在查询数据…', done: '查询数据' },
  aggregate: { running: '正在统计汇总…', done: '统计汇总' },
  resolve_student: { running: '正在查找学生…', done: '查找学生' },
  list_changes: { running: '正在查看更改记录…', done: '查看更改记录' },
  propose_write: { running: '正在生成写入提案…', done: '生成写入提案' },
  propose_add_many: { running: '正在整理批量新增…', done: '生成批量新增提案' },
  propose_delete_many: { running: '正在整理批量删除…', done: '生成批量删除提案' },
  propose_json_write: { running: '正在整理整块修改…', done: '生成整块修改提案' },
  propose_frontend_setting: { running: '正在整理设置修改…', done: '生成设置修改提案' },
  show_chart: { running: '正在绘制图表…', done: '绘制图表' },
  show_record: { running: '正在读取记录…', done: '读取记录' },
  ask_user: { running: '正在整理问题…', done: '向你提问' },
  read_document: { running: '正在读取文件…', done: '读取文件' },
  ocr_image: { running: '正在识别图片文字…', done: '识别图片文字' },
  export_file: { running: '正在准备导出文件…', done: '导出文件' },
  save_memory: { running: '正在记下…', done: '保存记忆' },
  propose_skill: { running: '正在整理技能变更…', done: '生成技能变更提案' },
  get_time: { running: '正在获取时间…', done: '获取时间' },
  web_search: { running: '正在联网搜索…', done: '联网搜索' },
  undo_change: { running: '正在回退更改…', done: '回退更改' },
  search_all: { running: '正在跨表搜索…', done: '跨表搜索' },
  run_checks: { running: '正在体检数据…', done: '数据体检' },
  run_conflict_checks: { running: '正在检测冲突…', done: '检测冲突' },
  export_image: { running: '正在生成排布图…', done: '导出图片' },
  score_weights: { running: '正在按权重评分…', done: '权重评分' },
  propose_update_many: { running: '正在整理批量修改…', done: '生成批量修改提案' },
  propose_batch: { running: '正在整理跨表操作…', done: '生成跨表操作提案' },
  describe_table: { running: '正在读取字段字典…', done: '读取字段字典' },
  snapshot_create: { running: '正在创建快照…', done: '创建快照' },
  snapshot_list: { running: '正在列出快照…', done: '列出快照' },
  snapshot_restore: { running: '正在整理还原提案…', done: '生成还原提案' },
  delete_impact: { running: '正在预估删除影响…', done: '预估删除影响' },
  teaching_week: { running: '正在计算教学周次…', done: '计算教学周次' },
  run_subagent: { running: '子助手核查中…', done: '子助手核查' },
};

// 工具执行结果 → 过程块里的一行摘要
function toolSummary(name, result) {
  if (!result) return '';
  if (result.error) return `失败：${result.error}`;
  switch (name) {
    case 'query':
      return `共 ${result.count != null ? result.count : (result.rows || []).length} 条记录`;
    case 'aggregate':
      return `共 ${result.count != null ? result.count : (result.rows || []).length} 组`;
    case 'resolve_student':
      return result.count ? `匹配到 ${result.total || result.count} 名学生` : '未匹配到学生';
    case 'list_changes':
      return result.count ? `最近 ${result.count} 次更改` : '暂无可撤销的更改';
    case 'show_record':
      return `已展示 ${result.count || 0} 条记录`;
    case 'show_chart':
      return result.title || `${result.count || 0} 项数据`;
    case 'propose_add_many':
      return `共 ${result.count || 0} 行`;
    case 'propose_delete_many':
      return result.message || '等待确认';
    case 'propose_json_write':
      return result.message || '等待确认';
    case 'propose_frontend_setting':
      return result.message || '等待确认';
    case 'propose_skill':
      return result.message || '等待确认';
    case 'get_time':
      return result.datetime || '';
    case 'web_search':
      return result.empty ? '未搜索到结果' : (result.count ? `搜索到 ${result.count} 条网页` : '联网搜索');
    case 'undo_change':
      return result.count ? `已回退 ${result.count} 项更改` : '无可回退的更改';
    case 'search_all':
      return result.total ? `命中 ${result.total} 条痕迹` : '未找到相关痕迹';
    case 'run_checks':
      return result.clean ? '未发现脏数据' : `发现 ${result.total} 处问题`;
    case 'run_conflict_checks':
      return result.total ? `发现 ${result.total} 处冲突` : '未发现冲突';
    case 'score_weights':
      return '已按权重评分';
    case 'export_image':
      return result.targets && result.targets.length ? `已生成 ${result.targets.length} 张图片` : '已生成图片';
    case 'propose_update_many':
      return `共 ${result.count || 0} 行`;
    case 'propose_batch':
      return `共 ${result.count || 0} 项操作`;
    case 'describe_table':
      return `共 ${result.count || 0} 张表的字段`;
    case 'snapshot_create':
      return `已创建快照 ${result.snapshot || ''}`;
    case 'snapshot_list':
      return result.count ? `共 ${result.count} 份快照` : '暂无快照';
    case 'snapshot_restore':
      return result.message || '等待确认';
    case 'delete_impact':
      return result.total ? `共 ${result.total} 处引用` : '未被引用';
    case 'teaching_week':
      return result.week_label || result.date || '';
    case 'run_subagent': {
      const list = result.results || [];
      const failed = list.filter((r) => r && r.error).length;
      return failed ? `已核查 ${list.length} 个子任务（${failed} 个失败）` : `已核查 ${list.length} 个子任务`;
    }
    case 'ask_user':
      // 把问题文本带进过程块步骤（呈现为「向你提问 · <问题>」），气泡正文不再重复罗列
      return result.questions && result.questions.length ? result.questions.join('；') : '已向你提问';
    case 'read_document':
      return result.names && result.names.length ? result.names.join('、') : '读取文件';
    case 'ocr_image':
      return result.empty ? '未识别到文字' : `识别到 ${(result.text || '').length} 个字符`;
    case 'export_file':
      return result.filename ? `已生成 ${result.filename}.${result.format}` : '已生成导出文件';
    case 'save_memory':
      return `已记住 ${result.count || 0} 条`;
    case 'propose_write':
      return result.message || '等待确认';
    default:
      return '';
  }
}

// 工具返回结果 → 过程块「二级展开」里展示的明细文本（超长截断，避免 SSE / 落库负载过大）
function toolDetailText(result) {
  if (result == null) return '';
  try {
    const s = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return s.length > 2000 ? s.slice(0, 2000) + '\n…（内容过长已截断）' : s;
  } catch (_) {
    return '';
  }
}

// get_time 工具：把本机当前时间给模型（本地应用，即用户机器时间）
function currentTimeInfo() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const offset = -now.getTimezoneOffset() / 60;
  return {
    date,
    weekday: weekdays[now.getDay()],
    time,
    datetime: `${date} ${time}`,
    timezone: `UTC${offset >= 0 ? '+' : '-'}${Math.abs(offset)}`,
    timestamp: now.getTime(),
  };
}

// 执行 web_search：POST https://api.deepseek.com/v1/tools/search
//   鉴权用当前 DeepSeek 模型的 API Key；need_content 传 false（仅取标题/摘要，更快更省）
async function runWebSearch(args, ctx) {
  const { currentSettings } = require('../../ai.config');
  const cfg = (ctx && ctx.cfg) || currentSettings();
  if (!cfg || cfg.provider !== 'deepseek' || !cfg.api_key) {
    return { ok: false, error: '联网搜索仅在 DeepSeek 模式下可用' };
  }
  const query = String((args && args.query) || '').trim();
  if (!query) return { ok: false, error: '缺少搜索词 query' };
  const count = Math.min(Math.max(parseInt(args && args.count, 10) || 5, 1), 10);
  try {
    const r = await fetch('https://api.deepseek.com/v1/tools/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` },
      body: JSON.stringify({ query, count, need_content: false }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) {
      let msg = '';
      try { msg = ((await r.json()).error || {}).message || ''; } catch (_) { msg = (await r.text().catch(() => '')).slice(0, 200); }
      return { ok: false, error: `搜索服务返回 ${r.status}${msg ? `：${msg}` : ''}` };
    }
    const j = await r.json();
    const results = (Array.isArray(j.results) ? j.results : []).slice(0, count).map((x) => ({
      title: String((x && x.title) || ''),
      url: String((x && x.url) || ''),
      snippet: String((x && x.snippet) || ''),
      summary: String((x && x.summary) || '').slice(0, 1200),
      site_name: (x && x.site_name) || null,
      date: (x && x.date) || null,
    }));
    if (!results.length) return { ok: true, count: 0, query, empty: true, note: '未搜索到相关网页，请据已有知识作答并说明可能不是最新' };
    return {
      ok: true,
      count: results.length,
      query,
      results,
      note: '以上是联网搜索结果，请据此作答并附上来源链接；若信息仍不充分，可换关键词再搜一次，但不要重复相同搜索',
    };
  } catch (err) {
    return { ok: false, error: `联网搜索失败：${(err && err.message) || '网络错误'}` };
  }
}

// ===== describe_table 工具：字段字典（只读）=====
// 直接告诉模型某张表有哪些字段、类型与枚举范围，避免「字段名写错」先试错一次再重来。
function describeOneTable(table) {
  if (!READ_TABLES[table]) return { error: `不存在的表：${table}` };
  const cols = tableColumns(table);
  const meta = getFields(table) || [];
  const typeOf = new Map(meta.map((f) => [f.name, f.type]));
  const rules = COLUMN_RULES[table] || {};
  const fields = cols
    .filter((c) => c !== 'id')
    .map((c) => {
      const f = { name: c, type: typeOf.get(c) || '文字' };
      const r = rules[c];
      if (r) {
        if (r.kind === 'enum') { f.kind = 'enum'; f.enum = r.values; }
        else if (r.kind === 'number') { f.kind = 'number'; if (r.min != null) f.min = r.min; if (r.max != null) f.max = r.max; }
        else if (r.kind === 'date') f.kind = 'date';
        else if (r.kind === 'bool') f.kind = 'bool';
        else if (r.kind === 'json') f.kind = 'json';
      }
      return f;
    });
  const rowWritable = !!WRITE_TABLES[table];
  const jsonWritable = !!JSON_WRITE_TABLES[table];
  return {
    table,
    label: READ_TABLES[table],
    kind: rowWritable ? 'row' : (jsonWritable ? 'json' : 'readonly'),
    writable: rowWritable || jsonWritable,
    requires_confirm: rowWritable || jsonWritable,
    singleton: jsonWritable,
    fields,
  };
}
function runDescribeTable({ table, tables } = {}) {
  const names = (Array.isArray(tables) && tables.length ? tables : (table ? [table] : []))
    .map((t) => String(t).trim())
    .filter(Boolean);
  const uniq = [...new Set(names)].slice(0, 12);
  if (!uniq.length) return { error: '请提供 table（单张表）或 tables（表名数组）' };
  const out = uniq.map((t) => describeOneTable(t));
  const bad = out.filter((o) => o.error);
  if (bad.length === out.length) return { error: bad[0].error };
  return { count: out.length, tables: out };
}

// ===== 整库快照：snapshot_create / snapshot_list / snapshot_restore =====
// 已拆分至 ./executors.snapshot.js（纯代码搬运，行为不变）。

// ===== delete_impact 工具：删除前的引用影响预估（只读）=====
// 已拆分至 ./executors.impact.js（纯代码搬运，行为不变）。

// ===== teaching_week 工具：教学周次计算 =====
// 读 schedule_settings 的学期起止日；期末优先取倒计时表里名称含「期末/考试」的最近一项，回退学期结束日。
function aiDateObj(s) {
  const t = aiParseDate(s);
  if (!t) return null;
  const [y, m, d] = t.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
}

function runTeachingWeek({ date } = {}) {
  const base = date ? aiDateObj(date) : new Date();
  if (date && !base) return { error: `无法识别日期：${date}（请用 YYYY-MM-DD）` };
  base.setHours(0, 0, 0, 0);
  const todayStr = aiDateStr(base);
  const s = db.prepare('SELECT semester_start, semester_end FROM schedule_settings WHERE id = 1').get();
  const start = s && s.semester_start ? aiDateObj(s.semester_start) : null;
  const endFromSettings = s && s.semester_end ? aiDateObj(s.semester_end) : null;

  let exam = null;
  let examName = '';
  const cds = db.prepare('SELECT 名称, 截止日 FROM countdowns').all();
  for (const c of cds) {
    const nm = String(c.名称 || '');
    if (!/期末|考试/.test(nm)) continue;
    const dt = aiDateObj(c.截止日);
    if (!dt) continue;
    if (!exam || dt > exam) { exam = dt; examName = nm; }
  }
  if (!exam && endFromSettings) { exam = endFromSettings; examName = '学期结束'; }

  const DAY = 86400000;
  const out = { date: todayStr };
  if (start) {
    // 第几周：以学期开始日为第 1 周（与课表页周次口径一致）
    const week = Math.floor((base - start) / (DAY * 7)) + 1;
    out.semester_start = aiDateStr(start);
    out.week = week;
    out.week_label = week >= 1 ? `第 ${week} 周` : `学期尚未开始（开学日 ${aiDateStr(start)}）`;
  } else {
    out.note = '未设置学期开始日期，无法计算当前是第几周';
  }
  if (exam) {
    const days = Math.round((exam - base) / DAY);
    out.exam_date = aiDateStr(exam);
    out.exam_name = examName;
    out.days_to_exam = days;
    out.weeks_to_exam = days >= 0 ? Math.ceil(days / 7) : 0;
  } else {
    out.note = out.note || '未设置学期结束日期、倒计时表里也没有「期末/考试」项，无法计算距期末周数';
  }
  return out;
}

// 撤销 AI 助手自己此前的更改：查 undo_history 里 origin 非空的最近一批记录，逐条回退
//   args.steps>1 时一次回退最近 N 批；否则按 table（可选）回退最近一批。
async function runUndoChange(args) {
  const undo = require('../../../undo/undo');
  const steps = args && args.steps != null ? Number(args.steps) : 0;
  if (steps > 1) {
    if (typeof undo.undoAiChanges !== 'function') return { ok: false, error: '撤销功能不可用' };
    return undo.undoAiChanges(steps);
  }
  const key = args && args.table != null ? String(args.table).trim() : '';
  if (typeof undo.undoAiChange !== 'function') return { ok: false, error: '撤销功能不可用' };
  return undo.undoAiChange(key || undefined);
}

// 从对话历史里取出「最近一条带图片的用户消息」里的图片 data URL 列表：
// 前端把带图用户消息的 content 构造为 [{type:'text',text}, {type:'image_url',image_url:{url}}]
function latestUserImages(messages) {
  if (!Array.isArray(messages)) return [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user' || !Array.isArray(m.content)) continue;
    const imgs = m.content
      .filter((p) => p && p.type === 'image_url' && p.image_url && p.image_url.url)
      .map((p) => p.image_url.url);
    if (imgs.length) return imgs;
  }
  return [];
}

module.exports = {
  appendBlocks, latestUserImages, TOOL_INFO, toolSummary, toolDetailText,
  MAX_SNAPSHOTS: snapshot.MAX_SNAPSHOTS, SNAPSHOT_NAME_RE: snapshot.SNAPSHOT_NAME_RE,
  runShowRecord, runShowChart, normalizeAsk, runProposeSkill, normalizeExport,
  normalizeProposal: proposal.normalizeProposal,
  normalizeBatchProposal: proposal.normalizeBatchProposal,
  normalizeBatchDelete: proposal.normalizeBatchDelete,
  normalizeJsonProposal: proposal.normalizeJsonProposal,
  normalizeFrontProposal: proposal.normalizeFrontProposal,
  normalizeBatchUpdate: proposal.normalizeBatchUpdate,
  normalizeBatchOps: proposal.normalizeBatchOps,
  runQuery: query.runQuery,
  runAggregate: query.runAggregate,
  runResolveStudent: query.runResolveStudent,
  runListChanges: query.runListChanges,
  runSearchAll: query.runSearchAll,
  runChecks: checks.runChecks,
  runConflictChecks: checks.runConflictChecks,
  runScoreWeights: checks.runScoreWeights,
  buildExportImage: image.buildExportImage,
  runDescribeTable,
  runSnapshotCreate: snapshot.runSnapshotCreate, runSnapshotList: snapshot.runSnapshotList, runSnapshotRestoreProposal: snapshot.runSnapshotRestoreProposal, runDeleteImpact: impact.runDeleteImpact, runTeachingWeek,
  currentTimeInfo, runWebSearch, runUndoChange,
};
