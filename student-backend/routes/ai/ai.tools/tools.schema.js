// ===== AI 工具 schema（下发给模型的工具定义，纯数据、无副作用） =====
// 仅含 *Tool 常量与它们引用的共享常量；执行逻辑见 tools.executors/executors.js，装配与派发见 tools.js。
const { READ_TABLES, WRITE_TABLES, JSON_WRITE_TABLES } = require('../ai.constants');

// 各 propose_* 工具通用的可选参数说明：来源标记（供撤销记录区分「哪批是子助手带来的」）
const SOURCE_DESC = '可选：若本次写入依据了 run_subagent 某子助手的核查结果，填「子助手名 · 任务」，如「数据体检员 · 清理重复项」；撤销记录里会据此标识来源。非子助手来源不要填。';

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

const jsonWriteTool = {
  type: 'function',
  function: {
    name: 'propose_json_write',
    description: '对「整块 JSON 存储」的表（课表/座位表/座位权重/值日设置/值日表/值日权重/各模板，以及系统设置 widget_settings）做整块写入提案：按 id 覆盖指定列。此调用不会真的改数据，用户确认后才执行。必须先用 query 读出该行当前内容，再基于它给出「该列完整的新值」（整列整体替换，不要只给增量）；一次可写多列。',
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

const CHART_TYPES = ['bar', 'pie', 'line'];

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

const teachingWeekTool = {
  type: 'function',
  function: {
    name: 'teaching_week',
    description: '计算教学周次：结合当前学期（semesters）的起止日期回答「现在是第几周」「距期末考试还有几周」。用户问到第几周、还有几周考试/放假这类问题且与学期进度有关时用它，不要凭记忆数。期末日优先取倒计时表里名称含「期末/考试」的最近一项，没有则用学期结束日。',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '可选：以哪一天为准计算，格式 YYYY-MM-DD；不填则用今天' },
      },
    },
  },
};

module.exports = {
  SOURCE_DESC, FRONT_SETTINGS, CHART_TYPES, AGG_FNS, BATCH_ROW_TABLES, MAX_BATCH_OPS,
  queryTool, proposeWriteTool, showRecordTool, batchAddTool, batchDeleteTool, jsonWriteTool,
  frontSettingTool, chartTool, askUserTool, memoryTool, skillTool, readDocumentTool, ocrTool,
  exportTool, timeTool, webSearchTool, undoTool, aggregateTool, resolveStudentTool,
  listChangesTool, searchAllTool, runChecksTool, conflictChecksTool, exportImageTool,
  scoreWeightsTool, batchUpdateTool, batchOpsTool, describeTableTool,
  snapshotCreateTool, snapshotListTool, snapshotRestoreTool, deleteImpactTool, teachingWeekTool,
};
