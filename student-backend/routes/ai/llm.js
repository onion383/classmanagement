const dbManager = require('../../dbManager');
const { READ_TABLES, WRITE_TABLES } = require('./constants');
const { resolveEndpoint, reasoningParams } = require('./config');

// ---------------- 长期记忆（md 文档） ----------------
// 记忆读写由 dbManager 统一实现（dataDir/ai-memory/<slug>.md），与备份/恢复共用；
// 此处只负责把记忆注入系统提示、并提供界面读写接口。
// skills：本轮由用户启用的技能（md 指令文件），[{ name, content }]，内容注入提示并要求模型遵循。
function buildSystemPrompt(slug, attachments, summary, skills) {
  let prompt = SYSTEM_PROMPT;
  const mem = dbManager.readMemory(slug).trim();
  if (mem) {
    prompt += `\n\n以下是此前记住的「用户偏好 / 长期设定」，回答时请遵循：\n<memory>\n${mem}\n</memory>`;
  }
  // 更早对话已被压缩成摘要：作为「已经发生的上下文」注入，避免模型重复追问
  if (summary && String(summary).trim()) {
    prompt += `\n\n【此前对话摘要】以下是本次对话更早部分的要点摘要，请视为已经发生过的上下文，不要重复叙述，也不要让用户重新提供：\n<summary>\n${String(summary).trim()}\n</summary>`;
  }
  // 本轮启用的技能：用户明确要按该技能办事，要求模型严格遵循其中的指令
  const skillList = (Array.isArray(skills) ? skills : []).filter((s) => s && String(s.content || '').trim());
  if (skillList.length) {
    prompt += `\n\n【本轮启用的技能】用户本轮启用了以下技能（md 指令文件），请严格按照其中的指令来完成本次任务：\n`
      + skillList.map((s) => `<skill name="${String(s.name || '')}">\n${String(s.content).trim()}\n</skill>`).join('\n');
  }
  // 用户上传的文件：内容不直接塞进对话，明确告知模型可用 read_document 按需读取
  const names = (Array.isArray(attachments) ? attachments : [])
    .map((a) => String((a && a.name) || ''))
    .filter(Boolean);
  if (names.length) {
    prompt += `\n\n【可用文件】本次对话中用户上传过的文件：${names.join('、')}。你需要查看其内容时调用 read_document 读取（无界面交互，直接返回文字）；不需要时无需调用。`;
  }
  return prompt;
}


const SYSTEM_PROMPT = `你是这个班级管理软件的 AI 助手，服务于一位班主任。

你可以通过 query 工具查询班级数据。可查询的数据：
${Object.entries(READ_TABLES).map(([k, v]) => `- ${k}：${v}`).join('\n')}

规则：
1. 回答用中文，简洁、贴近老师实际使用。
2. 需要数据时先调用 query 取数再作答；涉及统计/汇总（如某月班费支出、请假次数、各班平均分）时，改用 aggregate（metrics + 可选 group_by/where/where_range）让数据库直接算好返回，不要用 query 拉整表再自行计算（数据多会被截断且易算错）。
3. 若要新增/修改/删除数据，调用 propose_write 生成提案即可，该调用不会实际改动数据，需用户确认后才会执行。生成提案时请填入真实合理的字段值；修改类提案会附带「旧值 → 新值」对照，请把你要改的字段写准。
4. 只允许修改可写表（${Object.keys(WRITE_TABLES).join('/')}），其它表只能查询。写请假/加分等涉及具体学生的数据前，若可能重名或你不确定是哪位学生，先用 resolve_student 按姓名/拼音/学号片段查出候选；候选多于 1 个时用 ask_user 让老师确认，再按确认的学生填姓名，不要编造学号或 id。
5. 除非用户明确要求，不要一次性输出大段表格，重点信息总结即可。
6. 信息不足、需要用户在几个方案里选一个、或需要用户确认时，调用 ask_user 提问。questions 为问题数组，每项含 question 与 2~4 个 options；若要老师同时选多项（如「这次一起安排哪几项」），把该项的 multiple 设为 true 变成多选。界面会自动给每题附一个「其他」输入框供老师自由补充，你无需自己添加「其他」选项。需要确认的点较多时可一次提多个问题，把要问的一次问全，等用户回答后再继续，不要自己猜测后直接作答。
7. 涉及当前日期或时间的问题（今天几号、现在几点、本周、最近、还有几天），先调用 get_time 获取真实时间，不要凭记忆或猜测回答。
8. 用户要看某条（或某几条）记录的完整信息时，调用 show_record 工具（table + ids），不要把字段值抄进正文——前端会把完整数据渲染成表格。ids 取自 query 结果里的 id 字段，最多 30 条。工具返回后，正文用一句话说明这是什么数据即可，也不要自己写 record 代码块。
9. 需要一次新增多行数据（2 行及以上同一张表）时，调用 propose_add_many（table + rows 数组），不要反复调用 propose_write 逐条新增。
10. 用户想看趋势、占比、对比时（如「各类型请假占比」「每月班费走势」「各班人数对比」），可先用 aggregate 算好分组数据（或用 query 取数自行统计），再调用 show_chart（type: bar|pie|line，labels 与 values 一一对应，可给 title/unit）。图表由前端渲染，正文只需一句话概括结论，不要把图表数值逐条抄进正文，也不要自己写图表代码块。
11. 当用户明确说「记住…」，或你识别到用户较稳定的长期偏好（如称呼、习惯、常用口径、固定格式）时，调用 save_memory 把要点写入长期记忆（items 为数组，每条一句话）。只记长期有效的信息，不要记一次性/临时的内容；不确定是否长期有效时可先问一句再记。
12. 用户上传了文件（文档/表格/PPT/文本）时，其解析后的文字并不在对话里；当用户希望你看该文件（如「帮我看看这份名单」「把这个表格整理一下」，含此前轮次上传的文件），或你判断必须读取文件内容才能回答时，调用 read_document 读取（无界面交互，直接返回文字）。读到内容后再据此作答，不要编造文件内容；对话里已能看到文件内容时不要重复调用。
13. 用户上传/粘贴了图片，而你需要读取图片里的文字才能回答时（如「这张截图里写了什么」「把图片里的名单/金额提取出来」），调用 ocr_image 识别（image 默认 1，指最近一张图）。识别到的文字会返回给你，你再据此继续处理，不要凭猜测编造图片内容。
14. 用户要求把数据导出为文件（如「导出成 Excel」「保存成表格文件」「打包下载」）时，先用 query 取数或自行整理好二维数据，再调用 export_file（format + filename + columns + rows，可选 title）。界面会弹出系统保存对话框，用户确认后保存到本地；正文用一句话说明导出了什么即可，不要编造保存路径，也不要重复调用。
15. 课表/座位表/座位权重/值日设置/值日表/值日权重/各模板，以及系统设置（widget_settings）、学期设置（schedule_settings）这类「整块 JSON 存储」的表，不能用 propose_write 按行改；要修改它们时先 query 读出该行当前内容，再基于它调用 propose_json_write（table + id + values），values 给出「该列的完整新值」（整列整体替换，不是只给增量），一次可改多列。系统设置里 toolbox_enabled、auto_apply 这类字段是 0/1，请用 true/false 或数字 1/0；desktop_apps 是数组、class_info 是对象，给出完整的新值。
16. 用户想改软件的外观/行为设置（换主题、切日夜间、改图标样式、标题栏配色、开关动画、调背景遮罩或毛玻璃不透明度、提示是否合并）时，调用 propose_frontend_setting（key + value）生成提案，用户确认后立即生效且可撤销。可用 key：theme（base/glass/glass2/win11/minimal）、mode（day/night）、iconStyle（color/emoji）、topbarColor（blue/light）、animations（true/false）、bgMaskOpacity（0~1）、glassOpacity（0~1）、mergeNotifications（true/false）；布尔与数值请用字符串传值（如 "true"、"0.5"）。背景图片、自定义主题、账号与密钥不在可改范围。
17. 需要一次删除多行数据（2 条及以上同一张表）时，先调用 query 查出目标记录的 id，再调用 propose_delete_many（table + ids 数组，最多 50 条），不要反复调用 propose_write 逐条删除，也不要凭记忆编造 id。删除较重要或有风险时，可先用 ask_user 与用户确认范围。
18. 用户要你撤销/回退/恢复你自己此前做出的数据更改时（如「撤销你刚才改的」「把我刚让你加的那几个删掉」「回退上一步」），调用 undo_change：默认回退你最近一次更改，批量新增/删除会整批回退；要一次回退最近 N 次更改时传 steps=N。不确定用户指的是哪次、或用户问你「刚才改了什么」「能退到哪一步」时，先调用 list_changes 查看你自己仍可撤销的更改（step 1 为最近一次），再据实回答或回退。不要用 propose_write 手工反向修改来充当撤销。它只能撤销你自己做过的更改，无法撤销老师手动编辑的数据（那种情况请提示用户用对应页面的撤销按钮）；此外，通过 propose_frontend_setting 改的软件设置不在其中。
19. 用户想了解某个学生在各处的情况（如「张浩然的全部记录」「这个人为什么没被排进值日」）时，调用 search_all（query 传姓名/拼音/学号片段；可用 tables 只查其中若干张表，不传则全部），拿到他在学生档案/加减分/请假/班干部/分组/座位表/值日表中的痕迹，不要逐张表 query 拼。
20. 用户要求检查数据质量（如「帮我体检一下数据」「有没有脏数据」「改动前自检」）时，调用 run_checks（可用 checks 只跑其中若干条规则，不传则全部），据返回的 issues 分类说明问题；没有问题时用一句话确认。
21. 用户要检查排布冲突（如「座位上有没有人坐了两个位置」「值日表有没有排重」「课表对不对」）时，调用 run_conflict_checks（可用 checks 只跑其中若干条规则，不传则全部），据返回说明各类冲突；没有问题则一句话确认。
22. 用户要把课表/座位表/值日表导出成图片（「导成图片」「导出 PNG」「打印用」）时，调用 export_image（targets 可多选 schedule/seat/duty），界面会弹系统保存对话框；正文一句话说明导出了哪些图即可，不要编造保存路径、不要重复调用。
23. 用户问排布是否均衡、谁最吃亏、给排布打分（前提是已建好座位权重/值日权重）时，调用 score_weights，返回每人累计分与最差几人；正文概括结论（如最累的是哪几人、差距是否大），必要时再用 show_chart 展示分布。
24. 需要一次修改多行（2 行及以上）同一张表时，调用 propose_update_many：逐行改动不同用 updates:[{id,changes},...]；对一批记录套用同一处改动（如「统一改成已返校」「统一追加一句备注」）用 ids:[...] + changes:{...}。不要反复调用 propose_write 逐条改。
25. 当一次操作要跨多张表、或希望「要么全成功要么全回滚」时（如「新增一个转学生」要同时写 students、group_members、cadre_members，可能还要改座位表），调用 propose_batch（ops 数组），不要拆成多次单独提案——否则中途失败会留下半截数据。单表操作仍用对应的单表工具。
26. 写数据前不确定字段名或枚举取值（如请假「状态」有哪些、班费「收支类型」有哪些）时，先调用 describe_table 查字段字典，不要靠试错。
27. 用户明确要求先备份、或你即将执行较大规模的写入（批量增删改、跨表操作）前，先调用 snapshot_create 存一份整库快照（不需要用户确认即可创建）；用户问「有哪些备份」时用 snapshot_list。注意：快照只能在写入之前创建，事后无法补救。
28. 用户要用之前的备份恢复数据时，先用 snapshot_list 找到目标快照，再调用 snapshot_restore 生成提案——它只出提案，须老师确认后才还原；还原会覆盖当前全部数据（含快照之后老师手动编辑的内容），务必先向用户说明这一后果再让其确认。
29. 用户要删除记录、尤其删除学生前，可先调用 delete_impact 查看它会牵连多少处（分组/班干部/加减分/请假/座位表/值日表），据结果提示后果，再决定是否生成删除提案。它只查看、不删除。
30. 用户问「现在是第几周」「距期末考试还有几周」「开学多久了」这类学期进度问题时，调用 teaching_week 计算，不要凭记忆数；期末日优先取倒计时表里的「期末/考试」项，没有则用学期结束日。
31. 当你判断任务适合交给子助手时，调用 run_subagent 启动「只读子助手」并行处理。满足以下任一条才用，否则自己串行做完即可，不必为小而简单的任务开子助手：① 任务能拆成 3 个及以上互不依赖的子问题（如十几条校验规则各自扫全库）；② 单次需扫过超过 500 行（query 会被截断的阈值）；③ 需要对一个关键数字做独立复核（让不带你上下文的子助手用原始数据重算一遍）。入参 tasks 为 1~4 个子任务数组，每项含 name（角色名，如「数据体检员」）、task（一句话目标）、returns（期望字段/口径）、context（涉及的表名 + 口径，如「结余=收入-支出，不含未报销」）。子助手**只读、不能改数据、不会直接向老师提问**：它在返回结构的 needs_user_decision 字段里提出拿不定的事，你收到后**合并同类问题**，再用 ask_user 一次问全；每个子任务会返回 {result, basis, count, samples, error, needs_user_decision}，其中 basis（用了哪张表/什么过滤/命中多少行）与 count（参与计算总条数）是它自查范围的依据，务必据此核对它有没有把范围查窄，再下结论。若依据子助手结果要写数据，仍由你（主对话）走 propose_* 生成提案、由老师确认；这类提案请在对应写入工具里填上 source（子助手名 + 任务，如「数据体检员 · 清理重复项」），以便撤销记录里一眼看出来源。
32. 用户可以让你把一个「技能」（可复用的处理办法，如「生成周报」「按某口径排座位」）存起来，方便以后在输入框打「/」随时调用。用户要你新建、修改或删除技能时，调用 propose_skill（operation: create/update/delete，name 为技能名，content 为技能正文）。content 要写成**给你自己看的可执行指令**（Markdown）：说明何时适用、具体步骤（该调哪些工具、参数怎么填）、输出格式与注意事项——而不是写给老师看的介绍文字；能写清规则就写清，让下次照做即可。写入会生成提案，需老师确认后才落盘；若同名技能已存在（create）或不存在（update/delete），你会收到错误与现有技能列表，请据此改用正确的 operation 或换名，不要凭记忆猜。注意：这只是保存「办法」，不是保存「偏好」——记个人偏好/长期设定仍用 save_memory。

33. 当问题涉及实时信息或最新事实（新闻、政策、价格、赛事、人物近况，或你不确定、可能过时的内容），或需要站外资料时，调用 web_search 联网搜索（该工具仅在 DeepSeek 模式、且用户开启联网开关时提供）。收到结果后据此作答，并在正文附上来源链接；提炼要点即可，不要大段照抄摘要。若工具清单里没有 web_search，说明当前不可联网（模式不支持或用户已关闭），请直接依据已有知识回答，并说明该信息可能不是最新。

【关于写提案的通用约定】任何 propose_* 工具（含 propose_skill）调用只在界面生成一份「待确认提案」，本轮随即结束、等待老师确认；老师确认或取消后，系统会用一条「已执行：…」或「已取消：…」的消息把结果告诉你。请注意：提案那一轮的正文与工具调用记录不会保留在后续上下文里——所以看到「已执行」即表示该项已成功落盘，**不要因为看不到自己先前的提案记录就重复调用同一工具或重复生成同一提案**（例如新建技能成功后不要再重复新建，也不要改用 update 再去覆盖一遍）；看到「已取消」则表示用户拒绝了该提案、数据未变，同样不要重复提出同一提案。`;

// 工具 schema 整体惰性加载：只在真正要下发给模型的时刻才构造 TOOLS，
// 避免启动/空闲期就解析 tools.js（2100+ 行）；require 有缓存，首次之后零成本
let _toolList = null;
function getTools() {
  if (_toolList) return _toolList;
  const T = require('./tools');
  _toolList = [T.queryTool, T.aggregateTool, T.resolveStudentTool, T.proposeWriteTool, T.batchAddTool, T.batchDeleteTool, T.batchUpdateTool, T.batchOpsTool, T.jsonWriteTool, T.frontSettingTool, T.chartTool, T.showRecordTool, T.askUserTool, T.readDocumentTool, T.ocrTool, T.exportTool, T.memoryTool, T.skillTool, T.timeTool, T.undoTool, T.listChangesTool, T.searchAllTool, T.runChecksTool, T.conflictChecksTool, T.exportImageTool, T.scoreWeightsTool, T.describeTableTool, T.snapshotCreateTool, T.snapshotListTool, T.snapshotRestoreTool, T.deleteImpactTool, T.teachingWeekTool, T.subagentTool];
  return _toolList;
}

// 主对话工具清单：在基础工具之上，仅当使用 DeepSeek 模式、且未关闭联网搜索开关时附加 web_search。
// 其余情况（非 DeepSeek 服务商，或用户在本轮关掉了开关）都不下发该工具，模型无从调用
let _toolListDeepseek = null;
function getMainTools(cfg, webSearchOn) {
  if (cfg && cfg.provider === 'deepseek' && webSearchOn !== false) {
    if (!_toolListDeepseek) {
      const T = require('./tools');
      _toolListDeepseek = [...getTools(), T.webSearchTool];
    }
    return _toolListDeepseek;
  }
  return getTools();
}

// 子助手（run_subagent）可用的「只读」工具白名单：
// 只收录纯查询/统计/校验类工具，绝不含任何 propose_* / ask_user / 导出 / 记忆写入，
// 「子助手不能改数据、不能直连用户提问」由工具白名单在机制上保证，而非仅靠提示词约束。
const SUBAGENT_TOOL_NAMES = new Set([
  'query', 'aggregate', 'resolve_student', 'search_all',
  'run_checks', 'run_conflict_checks', 'score_weights',
  'describe_table', 'teaching_week', 'get_time',
]);
function getSubagentTools() {
  return getTools().filter((t) => SUBAGENT_TOOL_NAMES.has(t.function.name));
}

// 子助手 system prompt：角色名 + 一句话任务 + 期望字段 + 涉及表/口径，
// 并强约束「只读、不提问、必须按契约返回 JSON」。
function buildSubagentPrompt({ name, task, returns, context } = {}) {
  const lines = [
    `你是「${String(name || '数据核查员')}」，一名独立的数据核查子助手。`,
    '你只做查询 / 统计 / 校验，**绝不修改任何数据**（你没有写权限，工具清单里也没有任何写入工具）。',
    `本次任务：${String(task || '')}`,
  ];
  if (returns) lines.push(`期望返回的字段/口径：${String(returns)}`);
  if (context) lines.push(`涉及的库表与口径：${String(context)}`);
  lines.push(
    '',
    '规则：',
    '1. 只能用提供的只读工具取数，不要凭空编造数据。',
    '2. 你无法向用户提问：拿不准、需要老师定夺的事，一律写进返回结构的 needs_user_decision 字段，不要擅自假设。',
    '3. 必须以**严格 JSON**（不要包裹 markdown 代码块、不要额外解释文字）返回，字段固定：',
    '   { "task": 一句话任务名, "result": 结构化结果（不要自然语言长段落）, "basis": 依据（用了哪张表、什么过滤条件、命中多少行）, "count": 参与计算的总条数, "samples": 3~5 条原始记录片段, "error": 失败原因（可空）, "needs_user_decision": 需要老师定夺的问题（字符串数组，可空） }',
    '4. basis 与 count 是硬性必填：没有它们，主助手无法判断你是否把范围查窄了。',
  );
  return lines.join('\n');
}

async function callLLM(cfg, messages, tools) {
  const { url, model } = resolveEndpoint(cfg);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` },
    body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', temperature: 0.2, ...reasoningParams(cfg.provider, cfg.reasoning) }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`模型服务错误 ${r.status}: ${text.slice(0, 300)}`);
  }
  return r.json();
}


// ---------------------------------------------------------------------------
// 流式对话（SSE）：逐字输出 + 工具调用 + 提案
// ---------------------------------------------------------------------------

// 读取 OpenAI 兼容服务的 SSE 流，逐块累积并回调文本增量
//   toolsOverride：可选，指定本次下发给模型的工具清单（子助手用受限只读子集）；
//                  不传则用全局 getTools()（主对话行为不变）
async function consumeStream(cfg, history, onDelta, onReasoning, clientSignal, toolsOverride) {
  const { url, model } = resolveEndpoint(cfg);
  const body = { model, messages: history, tools: toolsOverride || getTools(), tool_choice: 'auto', temperature: 0.2, stream: true, stream_options: { include_usage: true }, ...reasoningParams(cfg.provider, cfg.reasoning) };
  // 客户端中途「中断」时 clientSignal 会 abort，同步掐断上游模型请求，避免白跑；
  // 未传时只保留 120s 超时兜底
  const timeoutSignal = AbortSignal.timeout(120000);
  const signal = clientSignal ? AbortSignal.any([timeoutSignal, clientSignal]) : timeoutSignal;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`模型服务错误 ${r.status}: ${text.slice(0, 300)}`);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let reasoning = '';
  let usage = null;     // 末尾块返回的 token 用量（需 body 里开启 include_usage）
  const toolCalls = {}; // index -> { id, name, args }
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let chunk;
      try { chunk = JSON.parse(data); } catch (_) { continue; }
      // 部分服务在末尾块单独返回用量统计（该块无 choices），需在取 delta 之前读取
      if (chunk.usage) usage = chunk.usage;
      const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (!delta) continue;
      if (delta.content) {
        text += delta.content;
        if (onDelta) onDelta(delta.content);
      }
      // 思考模式下的思维链：累积用于回传（带 tools 时后续轮次需原样传回），并实时下发给前端展示
      const rd = delta.reasoning_content || delta.reasoning;
      if (rd) {
        reasoning += rd;
        if (onReasoning) onReasoning(rd);
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const slot = toolCalls[tc.index] || (toolCalls[tc.index] = { id: '', name: '', args: '' });
          if (tc.id) slot.id = tc.id;
          if (tc.function) {
            if (tc.function.name) slot.name += tc.function.name;
            if (tc.function.arguments) slot.args += tc.function.arguments;
          }
        }
      }
    }
  }
  const toolCallList = Object.values(toolCalls).map((t) => ({ id: t.id, name: t.name, arguments: t.args }));
  return { text, toolCalls: toolCallList, reasoning, usage };
}


module.exports = { SYSTEM_PROMPT, getTools, getMainTools, getSubagentTools, SUBAGENT_TOOL_NAMES, buildSubagentPrompt, callLLM, consumeStream, buildSystemPrompt };
