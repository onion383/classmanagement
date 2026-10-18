const fs = require('fs');
const path = require('path');
const { db, getFields } = require('../../db');
const { COLUMN_RULES } = require('../../services/sanitize');
const dbManager = require('../../dbManager');
const { READ_TABLES, WRITE_TABLES, JSON_WRITE_TABLES, DOC_UNDO_KEY } = require('./constants');
const { tableColumns, normColVal } = require('./helpers');

// 各 propose_* 工具通用的可选参数说明：来源标记（供撤销记录区分「哪批是子助手带来的」）
const SOURCE_DESC = '可选：若本次写入依据了 run_subagent 某子助手的核查结果，填「子助手名 · 任务」，如「数据体检员 · 清理重复项」；撤销记录里会据此标识来源。非子助手来源不要填。';


// ---------------- 工具定义 ----------------
const queryTool = {
  type: 'function',
  function: {
    name: 'query',
    description: '查询班级数据表。可指定表、过滤条件与排序。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(READ_TABLES), description: '要查询的表名' },
        where: { type: 'object', description: '过滤条件，如 {"状态":"请假中"}；键必须是该表的真实字段名（写错会被直接拒绝并返回可用字段），不确定字段名时可先不带 where 查询或在错误提示里获取', additionalProperties: { type: 'string' } },
        order_by: { type: 'string', description: '排序字段（可选）' },
        order_dir: { type: 'string', enum: ['asc', 'desc'], description: '排序方向' },
        limit: { type: 'number', description: '最多返回条数，默认 100，上限 500；必须是 ≥1 的整数（负数/非数字会被拒绝）' },
      },
      required: ['table'],
    },
  },
};

const proposeWriteTool = {
  type: 'function',
  function: {
    name: 'propose_write',
    description: '生成一条新增/修改/删除数据的提案。此调用不会真的修改数据，用户确认后才会执行。',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['add', 'update', 'delete'], description: 'add=新增, update=修改, delete=删除' },
        table: { type: 'string', enum: Object.keys(WRITE_TABLES), description: '目标表（仅支持可写表）' },
        data: {
          type: 'object',
          description: 'add: 完整新行对象；update: { id, changes }；delete: { id }',
        },
        source: { type: 'string', description: SOURCE_DESC },
      },
      required: ['operation', 'table', 'data'],
    },
  },
};

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

const showRecordTool = {
  type: 'function',
  function: {
    name: 'show_record',
    description: '把某条（或某几条）记录的完整信息以表格展示给用户（前端渲染）。用户想看具体记录的全部字段时用它，不要把这些字段值抄进正文。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(READ_TABLES), description: '记录所在的表名' },
        ids: { type: 'array', items: { type: 'number' }, description: '记录 id 列表（取自 query 结果里的 id 字段），最多 30 条' },
      },
      required: ['table', 'ids'],
    },
  },
};

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

const batchAddTool = {
  type: 'function',
  function: {
    name: 'propose_add_many',
    description: '批量新增多行数据（生成一条提案，用户确认后一次性写入）。需要新增 2 行及以上同表数据时用它，比逐条调用 propose_write 更合适。此调用不会真的改数据。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(WRITE_TABLES), description: '目标表（仅支持可写表）' },
        rows: { type: 'array', items: { type: 'object' }, description: '每行一个对象，字段与单条 add 相同；各行字段可以不同' },
        source: { type: 'string', description: SOURCE_DESC },
      },
      required: ['table', 'rows'],
    },
  },
};

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

const batchDeleteTool = {
  type: 'function',
  function: {
    name: 'propose_delete_many',
    description: '批量删除多行数据（生成一条提案，用户确认后一次性删除）。需要删除 2 条及以上同一张表记录时用它，比反复调用 propose_write 逐条删除更合适。必须先 query 查出目标记录的 id，再把 id 传给 ids，不要凭记忆编造 id；此调用不会真的改数据。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(WRITE_TABLES), description: '目标表（仅支持可写表）' },
        ids: { type: 'array', items: { type: 'number' }, description: '要删除的记录 id 列表（取自 query 结果的 id 字段），最多 50 条' },
        label: { type: 'string', description: '本次删除的简短说明，如「删除 3 条重复的请假记录」' },
        source: { type: 'string', description: SOURCE_DESC },
      },
      required: ['table', 'ids'],
    },
  },
};

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

const jsonWriteTool = {
  type: 'function',
  function: {
    name: 'propose_json_write',
    description: '对「整块 JSON 存储」的表（课表/座位表/座位权重/值日设置/值日表/值日权重/各模板，以及系统设置 widget_settings、学期设置 schedule_settings）做整块写入提案：按 id 覆盖指定列。此调用不会真的改数据，用户确认后才执行。必须先用 query 读出该行当前内容，再基于它给出「该列完整的新值」（整列整体替换，不要只给增量）；一次可写多列。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(JSON_WRITE_TABLES), description: '目标表（仅支持整块写入表）' },
        id: { type: 'number', description: '要修改的行 id，一般为 1' },
        values: { type: 'object', description: '要覆盖的列：{ 列名: 该列完整新值 }，值为对象/数组时整体替换（如 seats / cells / weights / settings / days / items）' },
        label: { type: 'string', description: '本次修改的简短说明，如「座位表：第 3 行调换」' },
        source: { type: 'string', description: SOURCE_DESC },
      },
      required: ['table', 'values'],
    },
  },
};

// ===== propose_frontend_setting：「前端外观/行为设置」的白名单与提案 =====
// 这些设置存于前端 localStorage（主题/日夜模式/图标样式…），后端不落库、不校验真实状态，
// 只做白名单校验并生成提案；用户确认后由前端经主题 store 立即应用（且可撤销）。
// 刻意排除：背景图片（路径风险）、桌面悬浮小组件开关（耦合主进程）、自定义主题、账号/密钥等敏感项。
const FRONT_SETTINGS = {
  theme: { label: '主题', type: 'enum', values: ['base', 'glass', 'glass2', 'win11', 'minimal'] },
  mode: { label: '日夜模式', type: 'enum', values: ['day', 'night'] },
  iconStyle: { label: '图标样式', type: 'enum', values: ['color', 'emoji'] },
  topbarColor: { label: '标题栏配色', type: 'enum', values: ['blue', 'light'] },
  animations: { label: '动画效果', type: 'boolean' },
  bgMaskOpacity: { label: '背景遮罩不透明度', type: 'number' },
  glassOpacity: { label: '毛玻璃不透明度', type: 'number' },
  mergeNotifications: { label: '提示合并', type: 'boolean' },
};

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

const frontSettingTool = {
  type: 'function',
  function: {
    name: 'propose_frontend_setting',
    description: '对软件的外观/行为设置做修改提案：给出设置项 key 与新值。此调用不会真正改动，用户确认后由前端立即应用（可撤销）。可改项：theme（主题：base 彩色色块/glass 毛玻璃/glass2 新毛玻璃/win11/ minimal 极简）、mode（day 日间/night 夜间，仅 glass、glass2 支持夜间）、iconStyle（color 彩色图标/emoji）、topbarColor（blue 深蓝/light 白色调）、animations（true 开启动画/false 关闭）、bgMaskOpacity（背景遮罩不透明度 0~1）、glassOpacity（毛玻璃不透明度 0~1）、mergeNotifications（true 合并相同提示/false 每次单独展示）。背景图片、自定义主题、账号与密钥不在可改范围。',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', enum: Object.keys(FRONT_SETTINGS), description: '设置项标识' },
        value: { type: 'string', description: '新值。布尔项填 "true"/"false"，数值项填数字字符串（如 "0.5"），枚举/主题项填对应 id' },
        label: { type: 'string', description: '本次修改的简短说明，如「切换到夜间模式」' },
      },
      required: ['key', 'value'],
    },
  },
};

// show_chart 工具：模型只给「类型 + 标签 + 数值」，后端转成前端可渲染的 chart 代码块
const CHART_TYPES = ['bar', 'pie', 'line'];

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

const chartTool = {
  type: 'function',
  function: {
    name: 'show_chart',
    description: '把数据画成图表展示给用户（前端渲染，可点击查看数值、可保存图片）。当用户想看趋势、占比、对比（如「各类型请假占比」「每月班费走势」）时用它，数据必须来自 query 结果。不要自己写图表代码块，也不要把数值逐条抄进正文。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: CHART_TYPES, description: 'bar=柱状图（对比）, pie=饼图（占比）, line=折线图（趋势）' },
        title: { type: 'string', description: '图表标题，如「各类型请假占比」' },
        labels: { type: 'array', items: { type: 'string' }, description: '各数据点的名称（x 轴标签 / 扇区名），最多 12 项' },
        values: { type: 'array', items: { type: 'number' }, description: '与 labels 一一对应的数值（饼图请用正数），最多 12 项' },
        unit: { type: 'string', description: '数值单位（可选），如「元」「人」「次」' },
      },
      required: ['type', 'labels', 'values'],
    },
  },
};

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

const askUserTool = {
  type: 'function',
  function: {
    name: 'ask_user',
    description: '向用户提问并给出候选选项，用户回答后继续对话。可一次提多个问题（每个问题自带 2~4 个选项），把需要确认的点一次问全。单选或需在几个方案里选一个时用普通选项；若需要用户同时选择多项（如「一起安排哪几项」「哪些学生」），把该问题的 multiple 设为 true 变成多选。界面会自动给每个问题附一个「其他」输入框供老师自由补充，你无需自己加「其他」选项。信息不足或需要用户确认时用它，不要自己猜测后再答。',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: '要问用户的问题列表（1~5 个），一次把需要确认的都问清楚',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: '问题内容，一句话说清' },
              options: { type: 'array', items: { type: 'string' }, description: '该问题的候选选项 2~4 个（用户点一下即当作回答）；确实需要用户自由输入时可省略' },
              multiple: { type: 'boolean', description: '是否多选：true=用户可同时勾选多个选项（并可同时在「其他」里补充）；默认 false=单选' },
            },
            required: ['question'],
          },
        },
      },
      required: ['questions'],
    },
  },
};

// save_memory 工具：把用户的长期偏好写入记忆 md 文档，后续对话持续生效
const memoryTool = {
  type: 'function',
  function: {
    name: 'save_memory',
    description: '把用户的长期偏好/设定写入长期记忆（md 文档），之后所有对话都会一直记得。当用户明确说「记住…」，或你识别到用户较稳定的长期偏好（如称呼、习惯、常用口径、固定格式）时调用。只记长期有效的信息，不要记一次性的临时内容。',
    parameters: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'string' }, description: '要记住的要点，每条一句话、简洁（如「称呼我为李老师」「班费金额统一用元」），最多 20 条' },
      },
      required: ['items'],
    },
  },
};

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

const skillTool = {
  type: 'function',
  function: {
    name: 'propose_skill',
    description: '生成一条「技能（Markdown 指令文件）」的变更提案：新建 / 更新 / 删除。此调用不会真的写入，需老师确认后才执行。技能会出现在老师聊天输入框打「/」的候选里，选中后其内容随本轮注入系统提示。',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['create', 'update', 'delete'], description: 'create=新建, update=用新正文覆盖已有技能, delete=删除技能' },
        name: { type: 'string', description: '技能名（即 md 文件名，不含 .md），简短好记，如「周报生成」' },
        content: { type: 'string', description: '技能正文（Markdown）。create / update 必填。要写成对你自己可执行的指令（何时适用、具体步骤、输出要求），而不是写给老师看的介绍。' },
      },
      required: ['operation', 'name'],
    },
  },
};

// read_document 工具：读取用户在本轮上传的附件内容（前端上传时已解析成文本并随请求带给后端）。
// 无界面交互：模型调用即直接返回文字，用于「文件内容不在对话里、按需再读」的场景。
const readDocumentTool = {
  type: 'function',
  function: {
    name: 'read_document',
    description: '读取用户在本轮上传的附件（文档/表格/PPT/文本）解析后的文字。文件内容不在对话里，需要查看该文件时调用；无任何界面交互，直接返回文字。对话里已能看到文件内容时不要重复调用。',
    parameters: { type: 'object', properties: {} },
  },
};

// ocr_image 工具：对对话里最近一张（或指定第 N 张）图片做文字识别。
// 借 Windows 系统自带 OCR 引擎（零新增依赖、离线、不增体积），识别到的文字回灌给模型继续处理。
const ocrTool = {
  type: 'function',
  function: {
    name: 'ocr_image',
    description: '识别图片里的文字（OCR）。当用户上传/粘贴的图片中包含文字，而你需要读取这些文字才能回答时（如「这张截图里写了什么」「把图片里的名单提取出来」），调用它。识别结果会返回给你，你再据此继续处理。',
    parameters: {
      type: 'object',
      properties: {
        image: { type: 'integer', description: '要识别的图片序号，从 1 开始，默认 1（指最近一条带图片的用户消息里的第几张图）' },
      },
    },
  },
};

// export_file 工具：把二维数据导出为文件（Excel/CSV/Markdown/TXT/JSON）。
// 后端只做校验并生成「导出规格」下发给前端，由前端生成文件字节并弹系统保存对话框写入本地。
const EXPORT_FORMATS = ['xlsx', 'csv', 'md', 'txt', 'json'];
const exportTool = {
  type: 'function',
  function: {
    name: 'export_file',
    description: '把数据导出为文件并保存到本地（支持 Excel/CSV/Markdown/TXT/JSON）。当用户要求「导出成 Excel」「保存成表格文件」「打包下载」等时调用。先用 query 取数或自行整理好二维数据，再调用本工具；界面会弹出系统保存对话框，用户确认后文件即保存到本地。',
    parameters: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['xlsx', 'csv', 'md', 'txt', 'json'], description: '导出格式：xlsx=Excel 表格，csv=逗号分隔，md=Markdown 表格，txt=纯文本，json=JSON 数组' },
        filename: { type: 'string', description: '文件名（不含扩展名），如「班费明细_2026-10」' },
        columns: { type: 'array', items: { type: 'string' }, description: '表头列名数组' },
        rows: { type: 'array', items: { type: 'array', items: {} }, description: '数据行：二维数组，每行元素顺序与 columns 一一对应' },
        title: { type: 'string', description: '可选：表格顶部标题（xlsx 会写为首行标题）' },
      },
      required: ['format', 'filename', 'columns', 'rows'],
    },
  },
};

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

const timeTool = {
  type: 'function',
  function: {
    name: 'get_time',
    description: '获取当前日期和时间（本机时区）。用户问到“今天几号”“现在几点”“本周/本月/最近/还有几天”这类与当前时间有关的问题时，先调用它，不要凭记忆或猜测回答。',
    parameters: { type: 'object', properties: {} },
  },
};

// web_search 工具：调用 DeepSeek 官方搜索接口联网检索最新网页（仅 DeepSeek 模式下发）
const webSearchTool = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '联网搜索网页（调用 DeepSeek 官方搜索接口）。当问题涉及实时信息、最新新闻/政策、你不确定或可能过时的事实、需要外部资料（如教程、价格、赛事、人物近况）时使用。仅 DeepSeek 模式下可用；返回若干网页的标题、链接与摘要，请据此作答并注明来源链接，不要编造结果。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索词，1～128 个字符。支持搜索语法：site:、-site:、-关键词、-"短语"、"精确短语"、lang:zh,en、after:2025、before:2026 等，可组合使用' },
        count: { type: 'number', description: '返回条数，1～10，默认 5' },
      },
      required: ['query'],
    },
  },
};

// 执行 web_search：POST https://api.deepseek.com/v1/tools/search
//   鉴权用当前 DeepSeek 模型的 API Key；need_content 传 false（仅取标题/摘要，更快更省）
async function runWebSearch(args, ctx) {
  const { currentSettings } = require('./config');
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

// undo_change 工具：让 AI 回退自己此前通过写入提案做出的数据更改（复用 undo_history 撤销系统）
const undoTool = {
  type: 'function',
  function: {
    name: 'undo_change',
    description: '撤销你自己（AI 助手）此前对数据做出的更改。当用户说「撤销你刚才的修改」「把我刚让你加的那几条删掉」「回退上一步」「恢复原样」等，且指的是你之前改动的数据时，调用它。默认回退你最近一次数据更改（若是批量新增/删除，则整批一起回退）；传 steps=N 可一次回退最近 N 次更改（N 最多 20）。本工具只能撤销你自己做过的更改，不能撤销老师手动编辑产生的修改；若不确定用户指的是哪次更改，先调用 list_changes 查看撤销栈，或先用 ask_user 确认。',
    parameters: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          description: '可选：只撤销你此前在某一项数据上做出的最近一次更改。取值为数据名称，如 students、fee_records、leave_records、score_records、activities、countdowns、cadres，或「课程表」「座位表」「值日表」等整块数据。不填则撤销你最近一次做出的任意更改。',
        },
        steps: {
          type: 'number',
          description: '可选：一次回退最近几次更改（1=只回退最近一次，最多 20）。指定它时不要同时指定 table。',
        },
      },
    },
  },
};

// ===== aggregate 工具：数据库端聚合统计（避免拉整表自行计算 + 500 行截断）=====
// 支持的聚合方式（工具 schema 与执行逻辑共用，须定义在工具对象之前）
const AGG_FNS = ['count', 'sum', 'avg', 'min', 'max'];

const aggregateTool = {
  type: 'function',
  function: {
    name: 'aggregate',
    description: '对数据表做聚合统计（count/sum/avg/min/max），支持按列分组、等值过滤、区间过滤与排序。用于「某月班费支出合计」「各类型请假各多少次」「各班平均分」「某学生累计加分」等统计/汇总问题——由数据库直接算好返回，不要再用 query 拉整表自行计算。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(READ_TABLES), description: '要统计的表名' },
        metrics: {
          type: 'array',
          description: '聚合项数组（至少一项），每项 { fn, field, alias }：fn 为 count/sum/avg/min/max；count 可省略 field（表示计行数），sum/avg/min/max 必须给 field（真实字段名）；alias 为结果列名（可选，英文）',
          items: {
            type: 'object',
            properties: {
              fn: { type: 'string', enum: AGG_FNS, description: '聚合方式' },
              field: { type: 'string', description: '参与聚合的字段名（count 可省略表示计行数）' },
              alias: { type: 'string', description: '结果列名（可选，英文）' },
            },
            required: ['fn'],
          },
        },
        group_by: { type: 'string', description: '分组字段（可选）；按多个字段分组时用英文逗号分隔，如 "类型,状态"（最多 3 个）' },
        where: { type: 'object', description: '等值过滤，如 {"状态":"请假中"}；键必须是该表真实字段名（写错会被拒绝并返回可用字段）', additionalProperties: { type: 'string' } },
        where_range: {
          type: 'object',
          description: '单个区间过滤，如 {"field":"开始时间","gte":"2026-09-01","lte":"2026-09-30"}；日期用 YYYY-MM-DD 字符串比较。需要多个字段的区间时用 where_ranges',
          properties: {
            field: { type: 'string', description: '区间字段名' },
            gte: { type: 'string', description: '≥ 该值（可选）' },
            lte: { type: 'string', description: '≤ 该值（可选）' },
            gt: { type: 'string', description: '> 该值（可选）' },
            lt: { type: 'string', description: '< 该值（可选）' },
          },
          required: ['field'],
        },
        where_ranges: {
          type: 'array',
          description: '多个区间过滤（每一项与 where_range 同结构），需要同时对多个字段做区间过滤时用',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              gte: { type: 'string' },
              lte: { type: 'string' },
              gt: { type: 'string' },
              lt: { type: 'string' },
            },
            required: ['field'],
          },
        },
        order_by: { type: 'string', description: '排序依据（可选）：分组字段名或聚合别名' },
        order_dir: { type: 'string', enum: ['asc', 'desc'], description: '排序方向' },
        limit: { type: 'number', description: '最多返回多少组，默认 100，上限 500；必须是 ≥1 的整数' },
      },
      required: ['table', 'metrics'],
    },
  },
};

// resolve_student 工具：姓名/拼音/学号片段 → 去重候选
const resolveStudentTool = {
  type: 'function',
  function: {
    name: 'resolve_student',
    description: '按姓名、拼音或学号片段模糊查找学生，返回去重后的候选列表（含 id/学号/姓名/年级/班级）。写请假、加分等涉及具体学生的数据前，先用它确认目标学生，避免重名、同拼音写错人。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '姓名、拼音（如 "zs" / "zhangsan"）或学号片段' },
        limit: { type: 'number', description: '最多返回几个候选，默认 10，上限 20' },
      },
      required: ['query'],
    },
  },
};

// list_changes 工具：撤销栈可见
const listChangesTool = {
  type: 'function',
  function: {
    name: 'list_changes',
    description: '列出你自己（AI 助手）此前对数据做出的、目前仍可撤销的更改，按最近在前排列（step 1 = 最近一次）。用于回答「你刚才都改了什么」「能退到哪一步」，或在一次回退多步前先确认撤销栈；需要回退最近 N 次时再配合 undo_change（steps=N）。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最多列出几批更改，默认 10，上限 30' },
      },
    },
  },
};

// search_all 工具：跨表检索某人在本库各处的痕迹（查哪几张表由 tables 入参决定，不写死）
const searchAllTool = {
  type: 'function',
  function: {
    name: 'search_all',
    description: '给一个学生姓名/拼音/学号片段，跨表检索他在本库各处的痕迹。可用 tables 指定只查其中若干张表（不传则全部）：学生档案、加减分、请假、班干部任职、分组名册、座位表、值日表。用于「这个人的全部记录」「他为什么没被排进值日」等需要跨表对照的问题。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要搜索的学生姓名、拼音或学号片段' },
        tables: { type: 'array', items: { type: 'string', enum: ['students', 'score_records', 'leave_records', 'cadre_members', 'group_members', 'seat_layout', 'duty_layout'] }, description: '可选：只检索其中的某几张表；不传则检索全部' },
        limit: { type: 'number', description: '每张表最多返回多少条明细，默认 50，上限 200' },
      },
      required: ['query'],
    },
  },
};

// run_checks 工具：按 checks 入参逐条执行数据校验收查（查哪几条由调用方传入，不写死）
const runChecksTool = {
  type: 'function',
  function: {
    name: 'run_checks',
    description: '按 checks 入参逐条执行「数据体检」校验规则，可只跑其中若干条（不传则全部）。可用规则：cadre_dangling=班干部任职指向不存在的学生、group_dangling=分组名册成员不在学生名单里、leave_reversed=请假结束早于开始、fee_negative=班费金额为负、sno_duplicate=学号重复。用于「帮我检查一下数据」「有没有脏数据」「改动前先自检」。',
    parameters: {
      type: 'object',
      properties: {
        checks: { type: 'array', items: { type: 'string', enum: ['cadre_dangling', 'group_dangling', 'leave_reversed', 'fee_negative', 'sno_duplicate'] }, description: '可选：只跑其中的某几条规则；不传则跑全部' },
      },
    },
  },
};

// run_conflict_checks 工具：按 checks 入参逐条执行排布冲突检测（查哪几条由调用方传入，不写死）
const conflictChecksTool = {
  type: 'function',
  function: {
    name: 'run_conflict_checks',
    description: '按 checks 入参逐条执行排布类冲突检测，可只跑其中若干条（不传则全部）。可用规则：seat_duplicate=座位表同一人坐多个位置、duty_duplicate=值日表同一人同一天排多个劳动项目、countdown_passed=倒计时截止日已过、schedule_conflict=课表格内多课或行列数与设置不符。用于「检查座位表/值日表有没有排错」「有没有冲突」。',
    parameters: {
      type: 'object',
      properties: {
        checks: { type: 'array', items: { type: 'string', enum: ['seat_duplicate', 'duty_duplicate', 'countdown_passed', 'schedule_conflict'] }, description: '可选：只跑其中的某几条规则；不传则跑全部' },
        mode: { type: 'string', description: '可选：值日模式 daily=日常值日（默认）/ big=大扫除' },
      },
    },
  },
};

// export_image 工具：课表/座位表/值日表 → PNG 排布图
const exportImageTool = {
  type: 'function',
  function: {
    name: 'export_image',
    description: '把课表、座位表、值日表导出为 PNG 图片（export_file 只能导出表格数据，导不出这些「看的」排布图）。界面会弹出系统保存对话框，用户确认后保存到本地。',
    parameters: {
      type: 'object',
      properties: {
        targets: { type: 'array', items: { type: 'string', enum: ['schedule', 'seat', 'duty'] }, description: '要导出的内容，可多选：schedule=课表、seat=座位表、duty=值日表；默认全部导出' },
        mode: { type: 'string', description: '可选：值日模式 daily=日常值日（默认）/ big=大扫除' },
        filename: { type: 'string', description: '文件名（不含扩展名），默认「班级排布图」' },
      },
    },
  },
};

// score_weights 工具：按座位/值日权重给排布评分（复用界面「指数」口径）
const scoreWeightsTool = {
  type: 'function',
  function: {
    name: 'score_weights',
    description: '按座位权重/值日权重对排布评分：复用软件「座位指数/值日指数」口径（学期内每日快照按位置/项目权重逐天累加），返回每人累计得分与「最差（累计最高）的几个人」。用于排完座次/值日后验证是否均衡、谁最吃亏。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['seat', 'duty', 'both'], description: '评分对象：seat=座位、duty=值日、both=两者（默认）' },
        from: { type: 'string', description: '可选起始日期 YYYY-MM-DD，默认当前学期开始日' },
        to: { type: 'string', description: '可选截至日期 YYYY-MM-DD，默认今天' },
        top: { type: 'number', description: '返回最差的几人，默认 5，上限 50' },
        mode: { type: 'string', description: '值日模式 daily（默认）/ big' },
      },
    },
  },
};

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

const batchUpdateTool = {
  type: 'function',
  function: {
    name: 'propose_update_many',
    description: '批量修改同一张表的多行数据（生成一条提案，用户确认后一次性写入）。需要改 2 行及以上同表记录时用它（如「把这批请假记录状态统一改成已返校」「给这 10 个学生追加同一句备注」），比逐条调用 propose_write 更合适。两种写法：① updates:[{id,changes},...] 每行改动可以不同；② ids:[...] + changes:{...} 对这批 id 套用同一处改动。此调用不会真的改数据。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(WRITE_TABLES), description: '目标表（仅支持可写表）' },
        updates: {
          type: 'array',
          description: '逐行改动：每项 { id, changes }，changes 为「字段名 → 新值」对象；用 ids + changes 时不要传它',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: '记录 id（取自 query 结果）' },
              changes: { type: 'object', description: '要改的字段：{ 字段名: 新值 }' },
            },
            required: ['id', 'changes'],
          },
        },
        ids: { type: 'array', items: { type: 'number' }, description: '要统一修改的记录 id 列表（与 changes 搭配使用）' },
        changes: { type: 'object', description: '对 ids 里所有记录套用的同一处改动：{ 字段名: 新值 }' },
        label: { type: 'string', description: '本次修改的简短说明，如「统一标记为已返校」' },
        source: { type: 'string', description: SOURCE_DESC },
      },
      required: ['table'],
    },
  },
};

// ===== propose_batch 工具：跨表一次性提案（一次确认、全部成功或全部失败）=====
// 行式表（含分组/职务成员表）走 add/update/delete；整块 JSON 表走 doc 整块列写入。
// 后端在单事务里执行，任一步失败整体回滚，避免「转学生」这类跨表写入留下半截数据。
const BATCH_ROW_TABLES = { ...WRITE_TABLES, group_members: '小组成员', cadre_members: '职务成员' };
const MAX_BATCH_OPS = 30;

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

const batchOpsTool = {
  type: 'function',
  function: {
    name: 'propose_batch',
    description: '把多张表的写操作打包成「一次确认、全部成功或全部失败」的提案（例如「新增一个转学生」要同时写 students + group_members + cadre_members，甚至再加座位表）。单表单条/多条的增删改仍用 propose_write / propose_add_many / propose_update_many / propose_delete_many；只有需要跨表或希望原子完成时才用它。ops 为操作数组（最多 30 个），每项：{action:"add"|"update"|"delete", table, data}（行式表，含 group_members/cadre_members；add 的 data 用真实字段名，无需给 id；update 的 data 为 {id, changes}；delete 的 data 为 {id}），或 {action:"doc", table, id, values}（整块 JSON 表，values 为「列名 → 该列完整新值」）。此调用不会真的改数据。',
    parameters: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          description: '要执行的操作数组（最多 30 个），见描述中的两种形式',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['add', 'update', 'delete', 'doc'], description: '操作类型' },
              table: { type: 'string', enum: [...Object.keys(BATCH_ROW_TABLES), ...Object.keys(JSON_WRITE_TABLES)], description: '目标表名' },
              data: { type: 'object', description: '行式操作的数据：add 为完整新行；update 为 {id, changes}；delete 为 {id}' },
              id: { type: 'number', description: 'doc 操作用：要写入的行 id，一般为 1' },
              values: { type: 'object', description: 'doc 操作用：{ 列名: 该列完整新值 }' },
            },
            required: ['action', 'table'],
          },
        },
        label: { type: 'string', description: '本次批量操作的简短说明，如「新增转学生王小明」' },
        source: { type: 'string', description: SOURCE_DESC },
      },
      required: ['ops'],
    },
  },
};

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

const describeTableTool = {
  type: 'function',
  function: {
    name: 'describe_table',
    description: '查看某张（或某几张）表有哪些字段、字段类型，以及枚举字段的取值范围。在写数据前若不确定字段名或枚举取值，先用它确认，避免写错字段被拒绝后再试错。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(READ_TABLES), description: '要查询的单张表名' },
        tables: { type: 'array', items: { type: 'string', enum: Object.keys(READ_TABLES) }, description: '要查询的多张表名（与 table 二选一）' },
      },
    },
  },
};

// ===== 整库快照：snapshot_create / snapshot_list / snapshot_restore =====
// 快照是当前班主任库整体的一份加密 .db 副本（沿用同一库密钥），用于大批量写入前的「后悔药」。
// 快照目录 dataDir/snapshots/<slug>/<时间戳>.db，只保留最近 MAX_SNAPSHOTS 份。
const MAX_SNAPSHOTS = 20;
const SNAPSHOT_NAME_RE = /^\d{8}-\d{6}$/;

function snapshotFiles(slug) {
  const dir = dbManager.snapshotsDir(slug);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => SNAPSHOT_NAME_RE.test(n.replace(/\.db$/, ''))); } catch (_) { names = []; }
  return names.sort().reverse(); // 时间戳升序即时间顺序，倒序=最新在前
}

// 创建快照：db.backup 落盘 → 只保留最近 20 份。执行前无需用户确认（是只读式备份）。
async function runSnapshotCreate(ctx) {
  const slug = ctx && ctx.slug;
  if (!slug) return { error: '未绑定数据库连接，无法创建快照' };
  const dir = dbManager.snapshotsDir(slug);
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const file = path.join(dir, `${stamp}.db`);
  await db.backup(file);
  const files = snapshotFiles(slug);
  for (const f of files.slice(MAX_SNAPSHOTS)) {
    try { fs.rmSync(path.join(dir, f), { force: true }); } catch (_) { /* 清理失败可忽略 */ }
  }
  return {
    ok: true, snapshot: stamp, created: true, count: Math.min(files.length, MAX_SNAPSHOTS),
    note: '快照已创建（加密整库副本）。正文一句话确认即可；要还原须老师再确认一次。',
  };
}

// 列出快照（只读）
function runSnapshotList(ctx) {
  const slug = ctx && ctx.slug;
  if (!slug) return { error: '未绑定数据库连接' };
  const dir = dbManager.snapshotsDir(slug);
  const items = snapshotFiles(slug).slice(0, MAX_SNAPSHOTS).map((f) => {
    let size = 0;
    try { size = fs.statSync(path.join(dir, f)).size; } catch (_) { /* 忽略 */ }
    return { snapshot: f.replace(/\.db$/, ''), size };
  });
  return { count: items.length, snapshots: items };
}

// 还原提案：只出提案不动数据（还原会覆盖当前全部数据，须老师确认）
function runSnapshotRestoreProposal(slug, { snapshot, label } = {}) {
  if (!slug) return { error: '未绑定数据库连接' };
  const name = String(snapshot || '').trim().replace(/\.db$/, '');
  if (!SNAPSHOT_NAME_RE.test(name)) return { error: '请提供有效的快照标识（如 20261017-183000，可先用 snapshot_list 查看）' };
  const dir = dbManager.snapshotsDir(slug);
  if (!fs.existsSync(path.join(dir, `${name}.db`))) return { error: `快照不存在：${name}，请先用 snapshot_list 查看可用快照` };
  const lbl = String(label || '').trim().slice(0, 60) || `还原到快照 ${name}`;
  return { ok: true, snapshot: name, label: lbl };
}

const snapshotCreateTool = {
  type: 'function',
  function: {
    name: 'snapshot_create',
    description: '在大批量写入（批量新增/删除/修改、跨表操作）之前，把当前数据库整体备份成一个快照文件（加密整库副本，自动只保留最近 20 份）。用户说「先备份一下」「留个后悔药」「写之前存一份」时用它。此调用会立即创建快照，不需要用户额外确认。',
    parameters: { type: 'object', properties: {} },
  },
};

const snapshotListTool = {
  type: 'function',
  function: {
    name: 'snapshot_list',
    description: '列出当前已有的数据库快照（按最新在前），用于回答「有哪些备份」「上次备份是什么时候」，或在还原前确认可用快照标识。',
    parameters: { type: 'object', properties: {} },
  },
};

const snapshotRestoreTool = {
  type: 'function',
  function: {
    name: 'snapshot_restore',
    description: '把数据库还原到某个快照（覆盖当前全部数据）。用户要「回退到某个时间点」「用之前的备份恢复」时用它——但此调用只生成提案，须老师确认后才会真正还原；还原会丢弃快照之后的所有改动（含老师手动编辑），务必先向用户说明清楚。snapshot 取 snapshot_list 返回的标识（如 20261017-183000）。',
    parameters: {
      type: 'object',
      properties: {
        snapshot: { type: 'string', description: '要还原到的快照标识，如 20261017-183000（取自 snapshot_list）' },
        label: { type: 'string', description: '本次还原的简短说明' },
      },
      required: ['snapshot'],
    },
  },
};

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
function parseJsonOr(str, fallback) {
  try { const v = JSON.parse(str); return v == null ? fallback : v; } catch (_) { return fallback; }
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
    const seatHits = countInJson(parseJsonOr(seatRow && seatRow.seats, []), (v) => v === id);
    if (seatHits) refs.push({ label: '当前座位表', table: 'seat_layout', count: seatHits, samples: [] });
    const name = String(row['姓名'] || '');
    if (name) {
      const dutyRow = db.prepare('SELECT cells FROM duty_layout WHERE id = 1').get();
      const dutyHits = countInJson(parseJsonOr(dutyRow && dutyRow.cells, {}), (v) => v === name);
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

const deleteImpactTool = {
  type: 'function',
  function: {
    name: 'delete_impact',
    description: '删除某条（或某几条）记录前，先查它会牵连到哪些地方：分组、班干部、加分扣分、请假、座位表、值日表各有多少处引用。删除前（尤其删学生）先用它看影响，避免删完才发现数据不一致。此调用只查看、不会删除任何数据。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: Object.keys(READ_TABLES), description: '要删除的记录所在的表名' },
        id: { type: 'number', description: '要删除的记录 id（单条）' },
        ids: { type: 'array', items: { type: 'number' }, description: '要删除的多条记录 id（最多 20 条，与 id 二选一）' },
      },
      required: ['table'],
    },
  },
};

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

const teachingWeekTool = {
  type: 'function',
  function: {
    name: 'teaching_week',
    description: '计算教学周次：结合学期设置（schedule_settings 的起止日期）回答「现在是第几周」「距期末考试还有几周」。用户问到第几周、还有几周考试/放假这类问题且与学期进度有关时用它，不要凭记忆数。期末日优先取倒计时表里名称含「期末/考试」的最近一项，没有则用学期结束日。',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '可选：以哪一天为准计算，格式 YYYY-MM-DD；不填则用今天' },
      },
    },
  },
};

// 撤销 AI 助手自己此前的更改：查 undo_history 里 origin 非空的最近一批记录，逐条回退
//   args.steps>1 时一次回退最近 N 批；否则按 table（可选）回退最近一批。
async function runUndoChange(args) {
  const undo = require('../undo');
  const steps = args && args.steps != null ? Number(args.steps) : 0;
  if (steps > 1) {
    if (typeof undo.undoAiChanges !== 'function') return { ok: false, error: '撤销功能不可用' };
    return undo.undoAiChanges(steps);
  }
  const key = args && args.table != null ? String(args.table).trim() : '';
  if (typeof undo.undoAiChange !== 'function') return { ok: false, error: '撤销功能不可用' };
  return undo.undoAiChange(key || undefined);
}

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
let PM_MOD;
function pinyinMatch(text, key) {
  if (PM_MOD === undefined) {
    try { PM_MOD = require('pinyin-match'); } catch (_) { PM_MOD = null; }
  }
  if (!PM_MOD || typeof PM_MOD.match !== 'function') return false;
  try { return !!PM_MOD.match(text, key); } catch (_) { return false; }
}

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
  const undo = require('../undo');
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

// ===================== 通用小工具（日期 / JSON / 姓名） =====================
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

// ===== export_image 工具：课表/座位表/值日表 → 排布图规格（前端渲染成 PNG） =====
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

// ===== run_subagent 工具：启动「只读子助手」并行处理独立子任务 =====
// 子助手在受限上下文（角色名 + 一句话任务 + 期望字段 + 口径）与受限工具子集
// （llm.js 的 SUBAGENT_TOOL_NAMES：只有查询/统计/校验类，无任何写入与提问工具）里跑，
// 只读、不改数据、不直连用户提问，按固定契约返回结构化结果。
const subagentTool = {
  type: 'function',
  function: {
    name: 'run_subagent',
    description: '启动 1~4 个「只读子助手」并行处理相互独立的核查子任务。适用：① 任务可拆成 3 个以上互不依赖的子问题（并行体检）；② 单次需扫过超过 500 行；③ 对关键数字做独立复核（让不带主上下文的子助手用原始数据重算）。子助手只读、不改数据、不会直接向老师提问（拿不准的事写入其返回的 needs_user_decision）。每个子任务返回 {task, result, basis, count, samples, error, needs_user_decision}，其中 basis/count 用于核对其查询范围。此调用不会改数据。',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: '要并行跑的子任务列表（1~4 个）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '子助手角色名，如「数据体检员」' },
              task: { type: 'string', description: '一句话目标' },
              returns: { type: 'string', description: '期望返回的字段/口径（可选）' },
              context: { type: 'string', description: '涉及的表名 + 口径（可选），如「结余=收入-支出，不含未报销」' },
            },
            required: ['name', 'task'],
          },
        },
      },
      required: ['tasks'],
    },
  },
};

const MAX_SUBAGENT_TASKS = 4;      // 一次最多并行几个子任务（控制成本与延迟）
const MAX_SUBAGENT_ROUNDS = 6;     // 单个子任务最多几轮推理（防死循环，与主循环口径一致）

// 解析子助手返回的正文为契约对象：容错剥离 ```json 围栏，取首个 '{' 到最后一个 '}' 的片段；
// 解析失败则兜底成「未按契约返回」，避免把整段自然语言当成结果结构。
function parseSubagentResult(text, task) {
  const raw = String(text || '').trim();
  let body = raw;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start !== -1 && end > start) body = body.slice(start, end + 1);
  try {
    const obj = JSON.parse(body);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
  } catch (_) { /* 落到兜底 */ }
  return { task, result: raw, basis: '', count: 0, samples: [], error: '子助手未按契约返回 JSON', needs_user_decision: [] };
}

// 单个子任务：独立上下文 + 受限只读工具子集，循环取数直至子助手给出最终 JSON
async function runOneSubagent(cfg, item, ctx) {
  const { consumeStream, buildSubagentPrompt, getSubagentTools } = require('./llm');
  const name = String((item && item.name) || '数据核查员').slice(0, 40);
  const task = String((item && item.task) || '').trim();
  if (!task) {
    return { task: '', result: null, basis: '', count: 0, samples: [], error: '子任务缺少 task（目标）', needs_user_decision: [] };
  }
  const subTools = getSubagentTools();
  const history = [
    { role: 'system', content: buildSubagentPrompt({ name, task, returns: item.returns, context: item.context }) },
    { role: 'user', content: task },
  ];
  // 独立 blocks：子助手即便用到块类工具也不污染主对话正文
  const subCtx = { ...ctx, blocks: [] };
  for (let i = 0; i < MAX_SUBAGENT_ROUNDS; i++) {
    const { text, toolCalls, reasoning } = await consumeStream(cfg, history, null, null, ctx && ctx.signal, subTools);
    if (!toolCalls || !toolCalls.length) return parseSubagentResult(text, task);
    history.push({
      role: 'assistant',
      content: text || '',
      // 带 tools 的思考模式要求把思维链原样回传，否则后续轮次可能报错
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      tool_calls: toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } })),
    });
    for (const tc of toolCalls) {
      let targs = {};
      try { targs = JSON.parse(tc.arguments || '{}'); } catch (_) {}
      let result;
      try { result = (await runTool(tc.name, targs, subCtx)).result; }
      catch (e) { result = { error: e.message || '子助手工具执行失败' }; }
      history.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  return { task, result: null, basis: '', count: 0, samples: [], error: '子助手超过最大轮数仍未给出结论', needs_user_decision: [] };
}

// run_subagent：并行启动若干只读子助手，各自返回契约对象
async function runSubagent(args, ctx) {
  const { currentSettings } = require('./config');
  const list = Array.isArray(args && args.tasks)
    ? args.tasks.filter((t) => t && typeof t === 'object' && !Array.isArray(t))
    : [];
  if (!list.length) return { results: [], error: '缺少子任务（tasks 不能为空，每项含 name/task）' };
  const cfg = currentSettings();
  if (!cfg || !cfg.api_key) return { results: [], error: '尚未启用 / 配置 AI，子助手无法运行' };
  const tasks = list.slice(0, MAX_SUBAGENT_TASKS);
  const results = await Promise.all(tasks.map((t) =>
    runOneSubagent(cfg, t, ctx).catch((e) => ({
      task: String((t && t.task) || ''), result: null, basis: '', count: 0, samples: [],
      error: e.message || '子助手运行失败', needs_user_decision: [],
    }))
  ));
  return { results, count: results.length };
}

// 统一的工具执行入口：流式 / 非流式共用
//   ctx.blocks 收集 record / chart 数据块；返回 { result, proposal?, ask? }
//   async：OCR 等工具需要等待外部进程，故统一 await 调用
async function runTool(name, args, ctx) {
  switch (name) {
    case 'query':
      return { result: runQuery(args) };
    case 'aggregate':
      return { result: runAggregate(args) };
    case 'resolve_student':
      return { result: runResolveStudent(args) };
    case 'list_changes':
      return { result: runListChanges(args) };
    case 'search_all':
      return { result: runSearchAll(args) };
    case 'run_checks':
      return { result: runChecks(args) };
    case 'run_conflict_checks':
      return { result: runConflictChecks(args) };
    case 'score_weights':
      return { result: runScoreWeights(args) };
    case 'export_image': {
      const e = buildExportImage(args || {});
      if (e.error) return { result: { ok: false, error: e.error } };
      return {
        exportImage: e.spec,
        result: {
          ok: true,
          generated: true,
          targets: e.spec.items.map((it) => it.target),
          count: e.spec.items.length,
          note: '排布图已生成，界面会弹出系统保存对话框由用户选择保存位置；正文用一句话说明导出了什么即可，不要编造保存路径，也不要重复调用本工具',
        },
      };
    }
    case 'propose_write': {
      const p = normalizeProposal(args);
      if (!p.ok) return { result: { ok: false, error: p.error } };
      return {
        proposal: { operation: p.operation, table: p.table, data: p.data, label: p.label, ...(p.diff ? { diff: p.diff } : {}), ...(args.source ? { originNote: String(args.source).slice(0, 80) } : {}) },
        result: {
          ok: true, message: p.label, pending_user_confirmation: true,
          ...(p.diff && p.diff.length ? { diff: p.diff } : {}),
        },
      };
    }
    case 'propose_add_many': {
      const b = normalizeBatchProposal(args);
      if (!b.ok) return { result: { ok: false, error: b.error } };
      return {
        proposal: { operation: 'add', batch: true, table: b.table, data: { rows: b.rows }, label: b.label, ...(args.source ? { originNote: String(args.source).slice(0, 80) } : {}) },
        result: { ok: true, message: b.label, count: b.count, pending_user_confirmation: true },
      };
    }
    case 'propose_delete_many': {
      const d = normalizeBatchDelete(args);
      if (!d.ok) return { result: { ok: false, error: d.error } };
      return {
        proposal: { operation: 'delete', batch: true, table: d.table, data: { ids: d.ids }, label: d.label, ...(args.source ? { originNote: String(args.source).slice(0, 80) } : {}) },
        result: {
          ok: true, message: d.label, count: d.count, pending_user_confirmation: true,
          ...(d.missing.length ? { note: `已忽略不存在的 id：${d.missing.join('、')}` } : {}),
        },
      };
    }
    case 'propose_json_write': {
      const j = normalizeJsonProposal(args);
      if (!j.ok) return { result: { ok: false, error: j.error } };
      return {
        proposal: { kind: 'json', table: j.table, id: j.id, values: j.values, before: j.before, label: j.label, ...(args.source ? { originNote: String(args.source).slice(0, 80) } : {}) },
        result: { ok: true, message: j.label, pending_user_confirmation: true },
      };
    }
    case 'propose_frontend_setting': {
      const f = normalizeFrontProposal(args);
      if (!f.ok) return { result: { ok: false, error: f.error } };
      return {
        proposal: { kind: 'front', key: f.key, value: f.value, label: f.label },
        result: { ok: true, message: f.label, pending_user_confirmation: true },
      };
    }
    case 'propose_skill': {
      const s = runProposeSkill(args, ctx);
      if (s.error) return { result: { ok: false, error: s.error } };
      return {
        proposal: s.proposal,
        result: { ok: true, message: s.proposal.label, pending_user_confirmation: true },
      };
    }
    case 'propose_update_many': {
      const u = normalizeBatchUpdate(args || {});
      if (!u.ok) return { result: { ok: false, error: u.error } };
      return {
        proposal: { operation: 'update', batch: true, table: u.table, data: { updates: u.updates }, diffs: u.diffs, label: u.label, ...(args.source ? { originNote: String(args.source).slice(0, 80) } : {}) },
        result: { ok: true, message: u.label, count: u.count, diffs: u.diffs, pending_user_confirmation: true },
      };
    }
    case 'propose_batch': {
      const b = normalizeBatchOps(args || {});
      if (!b.ok) return { result: { ok: false, error: b.error } };
      return {
        proposal: { kind: 'batch_ops', ops: b.ops, label: b.label, ...(args.source ? { originNote: String(args.source).slice(0, 80) } : {}) },
        result: { ok: true, message: b.label, count: b.count, pending_user_confirmation: true },
      };
    }
    case 'describe_table':
      return { result: runDescribeTable(args || {}) };
    case 'snapshot_create':
      return { result: await runSnapshotCreate(ctx) };
    case 'snapshot_list':
      return { result: runSnapshotList(ctx) };
    case 'snapshot_restore': {
      const r = runSnapshotRestoreProposal(ctx && ctx.slug, args || {});
      if (!r.ok) return { result: { ok: false, error: r.error } };
      return {
        proposal: { kind: 'snapshot_restore', snapshot: r.snapshot, label: r.label, warning: '还原将覆盖当前全部数据（含快照之后的所有改动），且无法撤销' },
        result: { ok: true, message: r.label, pending_user_confirmation: true, warning: '还原会覆盖当前全部数据，请向用户说明清楚后再确认' },
      };
    }
    case 'delete_impact':
      return { result: runDeleteImpact(args || {}) };
    case 'teaching_week':
      return { result: runTeachingWeek(args || {}) };
    case 'run_subagent':
      return { result: await runSubagent(args || {}, ctx) };
    case 'show_record': {
      const sr = runShowRecord(args);
      if (!sr.block) return { result: { ok: false, error: sr.error } };
      ctx.blocks.push(sr.block);
      return { result: { ok: true, displayed: true, table: sr.table, count: sr.count, note: '前端已把完整数据渲染为表格，正文无需再罗列字段值' } };
    }
    case 'show_chart': {
      const sc = runShowChart(args);
      if (!sc.block) return { result: { ok: false, error: sc.error } };
      ctx.blocks.push(sc.block);
      return { result: { ok: true, displayed: true, type: sc.type, count: sc.count, title: sc.title, note: '前端已把图表渲染出来，正文只需一句话概括结论' } };
    }
    case 'get_time':
      return { result: currentTimeInfo() };
    case 'web_search':
      return { result: await runWebSearch(args, ctx) };
    case 'undo_change':
      return { result: await runUndoChange(args) };
    case 'save_memory': {
      const r = dbManager.appendMemory(ctx && ctx.slug, args.items);
      if (r.error) return { result: { ok: false, error: r.error } };
      return { result: { ok: true, saved: true, count: r.count, note: '已写入长期记忆，正文用一句话确认即可' } };
    }
    case 'ask_user': {
      const a = normalizeAsk(args);
      if (!a.ok) return { result: { ok: false, error: a.error } };
      return { ask: a.ask, result: { ok: true, asked: true, count: a.ask.questions.length, questions: a.ask.questions.map((q) => q.question) } };
    }
    case 'read_document': {
      // 读取本轮用户上传的附件内容（前端上传时已解析成文本并随请求带来，无需任何界面交互）
      const list = ((ctx && Array.isArray(ctx.attachments)) ? ctx.attachments : [])
        .map((a) => ({ name: String((a && a.name) || '文件'), text: String((a && a.text) || '') }))
        .filter((a) => a.text.trim());
      if (!list.length) {
        return { result: { ok: false, error: '本轮没有可读取的附件文件，请提示用户用输入框旁的「上传文件」按钮添加后再试' } };
      }
      const MAX_LEN = 100000; // 与上传解析接口保持一致的截断上限
      let body = list.map((a) => `文件「${a.name}」的内容：\n${a.text}`).join('\n\n');
      if (body.length > MAX_LEN) body = body.slice(0, MAX_LEN) + `\n\n...（文件过长，已截断至 ${MAX_LEN} 字符）`;
      return {
        result: {
          ok: true,
          count: list.length,
          names: list.map((a) => a.name),
          text: body,
          note: '以上是用户本轮上传的文件内容，请据此作答；正文不要原样照抄整段文件内容',
        },
      };
    }
    case 'ocr_image': {
      const imgs = (ctx && ctx.images) || [];
      if (!imgs.length) return { result: { ok: false, error: '当前对话里没有可识别的图片' } };
      const n = Math.min(Math.max(parseInt(args && args.image, 10) || 1, 1), imgs.length);
      const ocr = require('../../services/ocr');
      const r = await ocr.recognizeDataUrl(imgs[n - 1]);
      if (!r.ok) return { result: { ok: false, error: r.error } };
      if (r.empty) {
        return { result: { ok: true, text: '', empty: true, note: '图片里没有识别到文字' } };
      }
      return { result: { ok: true, text: r.text, note: '以上是从图片中识别出的文字，请据此继续处理' } };
    }
    case 'export_file': {
      const e = normalizeExport(args || {});
      if (e.error) return { result: { ok: false, error: e.error } };
      return {
        exportFile: e.spec,
        result: {
          ok: true,
          generated: true,
          filename: e.spec.filename,
          format: e.spec.format,
          count: e.spec.rows.length,
          note: '导出文件已生成，界面会弹出系统保存对话框由用户选择保存位置；正文用一句话说明导出了什么即可，不要编造保存路径，也不要重复调用本工具',
        },
      };
    }
    default:
      return { result: { error: '未知工具' } };
  }
}


module.exports = {
  runTool, appendBlocks, latestUserImages, toolSummary, toolDetailText, TOOL_INFO, MAX_BATCH_OPS, BATCH_ROW_TABLES, SNAPSHOT_NAME_RE, runSnapshotCreate, runSnapshotList, queryTool, proposeWriteTool, showRecordTool, batchAddTool, batchDeleteTool, jsonWriteTool, frontSettingTool, chartTool, askUserTool, memoryTool, readDocumentTool, ocrTool, exportTool, timeTool, webSearchTool, undoTool, aggregateTool, resolveStudentTool, listChangesTool, searchAllTool, runChecksTool, conflictChecksTool, exportImageTool, scoreWeightsTool, batchUpdateTool, batchOpsTool, describeTableTool, snapshotCreateTool, snapshotListTool, snapshotRestoreTool, deleteImpactTool, teachingWeekTool, skillTool, subagentTool, runSubagent,
};
