import { LABELS, FRONT_LABELS } from './aiConstants.js'

// ask_user 提问结构归一：模型畸形输出可能缺 questions / options，
// 而前端多处直接读 `.length` / `[0]`（浮窗模板、分页、汇总答案），
// 一旦缺字段就是 TypeError 白屏。流式与历史恢复两条入口都先过一遍这里，
// 之后的代码可以放心按「数组」访问。
export function normalizeAsk(ask) {
  if (!ask || typeof ask !== 'object') return ask
  const questions = Array.isArray(ask.questions) ? ask.questions : []
  return {
    ...ask,
    questions: questions.map((q) => ({ ...q, options: Array.isArray(q && q.options) ? q.options : [] }))
  }
}

// 从数据库加载的消息反序列化：支持多模态 JSON 数组 + 过程块恢复
export function parseMessage(m) {
  let parsed = null
  if (m.role === 'user' && m.content && m.content.startsWith('[')) {
    try {
      const parts = JSON.parse(m.content)
      if (Array.isArray(parts)) {
        const text = parts.find((p) => p.type === 'text')?.text || ''
        const images = parts.filter((p) => p.type === 'image_url').map((p) => p.image_url.url)
        parsed = { role: 'user', content: text, images }
      }
    } catch (_) { /* 解析失败则当普通文本 */ }
  }
  if (!parsed) parsed = { role: m.role, content: m.content || '' }
  // 记住落库 id，回退功能据此精确删除本轮消息
  parsed._id = m.id
  // 该消息附带的文件（{name, text}）：随消息落库，后续轮次仍能在上下文里读取
  if (Array.isArray(m.attachments) && m.attachments.length) parsed.attachments = m.attachments
  // 过程块（步骤 / 思维链 / 耗时）从落库的 process 字段恢复，默认折叠
  if (m.role === 'assistant' && m.process) {
    parsed.steps = m.process.steps || []
    parsed.reasoning = m.process.reasoning || ''
    parsed.processMs = m.process.ms || 0
    parsed.tokens = m.process.tokens || 0
    parsed.promptTokens = m.process.promptTokens || 0
    parsed.completionTokens = m.process.completionTokens || 0
    // 待确认写提案 / 待回答提问的交互状态随过程块落库，刷新后恢复（否则只剩过程块，像被中断）
    if (m.process.proposal) parsed.proposal = m.process.proposal
    if (m.process.ask) parsed.ask = normalizeAsk(m.process.ask)
  }
  // 自动反馈（回答提问 / 执行或取消提案）：标记为不渲染气泡，其内容并入相邻助手消息的思维链
  if (m.role === 'user' && m.process && m.process.auto) {
    parsed._auto = true
    parsed._autoText = m.process.text || parsed.content || ''
  }
  return parsed
}

// 反序列化并按「反馈并入思维链」规则整理：
// 自动反馈的用户消息不渲染气泡，而是并入相邻助手消息（优先其前面的原提问/提案消息）的过程块。
export function parseMessages(rows) {
  const list = (rows || [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => parseMessage(m))
  const out = []
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!m._auto) { out.push(m); continue }
    // 找前面最近的助手消息；没有则退而并入后面最近的助手消息（受限的恢复窗口下拿不到原消息时）
    let target = null
    for (let j = out.length - 1; j >= 0; j--) { if (out[j].role === 'assistant') { target = out[j]; break } }
    if (!target) {
      for (let j = i + 1; j < list.length; j++) { if (list[j].role === 'assistant') { target = list[j]; break } }
    }
    if (target) {
      if (!target.steps) target.steps = []
      const fbText = m._autoText || m.content || ''
      // 反馈轮次已续写进原助手消息时，该步骤已随助手行的 process 落库，避免重复追加
      const dup = target.steps.some((s) => s.kind === 'text' && s.text === fbText)
      if (!dup) target.steps.push({ id: 'fb' + target.steps.length + '_' + i, kind: 'text', text: fbText, status: 'done' })
    }
  }
  return out
}

// 最后一条助手消息的索引（跳过其后的隐藏「自动反馈」用户消息）
export function lastAssistantIndex(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === 'assistant') return i
  }
  return -1
}

// 最后一条助手消息（跳过其后的隐藏「自动反馈」用户消息），供提问/提案/回退等定位当前这轮 AI 消息
export function lastAssistant(list) {
  const i = lastAssistantIndex(list)
  return i === -1 ? null : list[i]
}

export function formatTime(t) {
  if (!t) return ''
  const d = new Date(t)
  const now = new Date()
  const diff = now - d
  // 今天
  if (diff < 86400000 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  // 昨天
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear()) {
    return '昨天 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  // 今年
  if (d.getFullYear() === now.getFullYear()) {
    return (d.getMonth() + 1) + '/' + d.getDate()
  }
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate()
}

// 从文件消息内容中提取文件名
export function extractFileName(content) {
  const m = content && content.match(/^文件「(.+?)」/)
  return m ? m[1] : ''
}

// 从文件消息内容中提取用户文字
export function extractUserText(content) {
  if (!content) return ''
  // 旧格式（历史消息）：文件内容包在 ``` 代码块里，用户文字在其后——去掉文件内容只留用户文字
  const idx = content.indexOf('\n```\n')
  if (idx !== -1) {
    const after = content.slice(idx + 5).trim() // 跳过 ```\n
    return after.replace(/^(\n|$)/, '')
  }
  // 新格式：`文件「name」` 后跟用户文字（附件内容不再随消息发出，改由 AI 按需读取）
  if (content.startsWith('文件「')) {
    const nl = content.indexOf('\n')
    return nl === -1 ? '' : content.slice(nl + 1).trim()
  }
  return ''
}

// 构建助手消息的「过程块」落库对象：步骤 / 思维链 / 耗时，外加需要跨刷新保留的交互状态
// （待确认写提案 proposal、待回答提问 ask）。这些状态不落库的话，刷新后正文为空的提案轮 /
// 提问轮会只剩过程块，看起来像被中断、任务丢失。
export function buildProc(m) {
  if (!m) return null
  const hasProcess = (m.steps && m.steps.length) || m.reasoning || m.processMs || m.tokens
  if (!hasProcess && !m.proposal && !m.ask) return null
  const proc = {
    steps: m.steps || [], reasoning: m.reasoning || '',
    ms: m.processMs || 0, tokens: m.tokens || 0,
    promptTokens: m.promptTokens || 0, completionTokens: m.completionTokens || 0,
  }
  if (m.proposal) proc.proposal = m.proposal
  if (m.ask) proc.ask = m.ask
  return proc
}

export function tableLabel(t) { return LABELS[t] || t }

// 逐行比较两段文本（markdown 技能正文等），返回行级 diff：
// { added, removed, lines:[{type:'add'|'del'|'ctx', text}] }。
// 用 LCS（最长公共子序列）保证「已存在的行」被判为上下文，而不是整段替换；
// 行数过大时退化为「全删 + 全增」，避免 O(m*n) DP 卡顿。
export function lineDiff(before, after) {
  const A = String(before == null ? '' : before).split('\n')
  const B = String(after == null ? '' : after).split('\n')
  const m = A.length
  const n = B.length
  if (m * n > 250000) {
    return {
      added: n,
      removed: m,
      lines: [...A.map((text) => ({ type: 'del', text })), ...B.map((text) => ({ type: 'add', text }))],
    }
  }
  // dp[i][j] = A[i..] 与 B[j..] 的最长公共子序列长度
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const lines = []
  let i = 0, j = 0, added = 0, removed = 0
  while (i < m && j < n) {
    if (A[i] === B[j]) { lines.push({ type: 'ctx', text: A[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push({ type: 'del', text: A[i] }); i++; removed++ }
    else { lines.push({ type: 'add', text: B[j] }); j++; added++ }
  }
  while (i < m) { lines.push({ type: 'del', text: A[i++] }); removed++ }
  while (j < n) { lines.push({ type: 'add', text: B[j++] }); added++ }
  return { added, removed, lines }
}

// 网格表 → 承载「格子」的字段名（与 AiGridPreview.vue 的 FAMILY 家族保持一致）：
// 座位类取 seats、权重取 weights、课表/值日取 cells（值日的 cells 是 {项目:{星期:[人名]}}）。
const GRID_CELL_KEY = {
  seat_layout: 'seats', seat_template: 'seats', seat_weight: 'weights',
  schedule: 'cells', master_schedule: 'cells', duty_layout: 'cells', duty_template: 'cells',
}

// 网格表 → 目标页锚点前缀（与各页 GridView 的 anchor-prefix 一致）。
// 用于把「改动明细」里改动的格子定位到目标页的对应单元格。
const GRID_ANCHOR = {
  schedule: 's', master_schedule: 'm',
  seat_layout: 'seat', seat_template: 'seatt', seat_weight: 'seatw',
}

// 把二维网格字段规整成二维数组；非数组（如值日的 {项目:{星期:[]}}）返回 null（暂不支持定位）。
function normalizeGrid(data) {
  if (!Array.isArray(data)) return null
  return data.map((row) => (Array.isArray(row) ? row : [row]))
}
// 取格子的「值」：课表格是 {course}，座位/权重是数字或字符串
function cellText(v) {
  if (v == null) return ''
  if (typeof v === 'object') return v.course == null ? '' : String(v.course)
  return String(v)
}

// 在 before/values 之间找第一个发生变化的格子，返回目标页可用的定位串：
//   课表 `s/m:<节次行>:<星期列>`；座位/权重 `seat|seatt|seatw:<行>:<真实列>`。
// 第三段为「真实列」（不含走廊列），由目标页按自身几何换算成显示列。
// 找不到差异或表不支持时返回 null（调用方回退为只跳页面）。
export function gridCellFocus(table, before, values) {
  const anchor = GRID_ANCHOR[table]
  const key = GRID_CELL_KEY[table]
  if (!anchor || !key) return null
  const a = normalizeGrid(values && values[key])
  if (!a) return null
  const b = normalizeGrid(before && before[key])
  let fallback = null
  for (let r = 0; r < a.length; r++) {
    const rowA = a[r] || []
    const rowB = (b && b[r]) || []
    for (let c = 0; c < rowA.length; c++) {
      const va = cellText(rowA[c])
      const vb = cellText(rowB[c])
      if (va === vb) continue
      const coord = `${anchor}:${r}:${c}`
      if (vb === '') return coord   // 由空变有值（新增内容）优先定位
      if (!fallback) fallback = coord
    }
  }
  return fallback
}

// 单个「格子」是否有值：空串/空数组/空对象视为空，数字（含 0）视为有值
function isFilled(v) {
  if (v == null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (typeof v === 'number') return true
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.some(isFilled)
  if (typeof v === 'object') {
    if ('course' in v) return isFilled(v.course)
    return Object.values(v).some(isFilled)
  }
  return false
}

// 统计网格表「格子」数：从 values 里取格子字段，逐格判断非空。
// 座位/课表是二维数组，值日是 {项目:{星期:[人名]}}，两种结构都支持。
export function countNonEmptyCells(values, table) {
  const key = GRID_CELL_KEY[table]
  if (!key || !values || typeof values !== 'object') return 0
  const data = values[key]
  if (data == null) return 0
  if (Array.isArray(data)) {
    let n = 0
    for (const row of data) {
      if (Array.isArray(row)) n += row.filter(isFilled).length
      else if (isFilled(row)) n++
    }
    return n
  }
  if (typeof data === 'object') {
    let n = 0
    for (const v of Object.values(data)) {
      if (Array.isArray(v)) {
        for (const d of v) {
          if (Array.isArray(d)) n += d.filter(isFilled).length
          else if (isFilled(d)) n++
        }
      } else if (isFilled(v)) n++
    }
    return n
  }
  return 0
}

// 汇总一个「已执行」提案的改动量，供消息里的改动总结条与明细抽屉共用。
// 口径：行状表按「条」（修改按改动字段数），网状表按「非空格」，技能 md 按「行」。
// 返回 { total: 项数, added, removed, items:[{ key,label,isGrid,isSkill,added,removed,actions }] }
export function summarizeProposalChanges(p) {
  const empty = { total: 0, added: 0, removed: 0, items: [] }
  if (!p || !p.executed || p.reverted) return empty
  if (p.kind === 'front' || p.kind === 'snapshot_restore') return empty
  const items = []

  if (p.kind === 'skill') {
    // 技能 md：更新时按行数（行级 diff）计，其余（新建/删除）不计入条数
    if (p.operation !== 'update' || p.before == null || p.content == null) return empty
    const d = lineDiff(p.before, p.content)
    if (!d.added && !d.removed) return empty
    items.push({
      key: `skill:${p.name}`, label: `${p.name}.md`, isSkill: true, added: d.added, removed: d.removed,
      actions: [{ type: 'lines', count: d.added + d.removed, diff: d }],
    })
  } else if (p.kind === 'json') {
    // 网状表整块写入：新值里的非空格各计 +1，被覆盖掉的原有非空格各计 -1
    if (!p.table) return empty
    const added = countNonEmptyCells(p.values, p.table)
    const removed = p.gridBefore ? countNonEmptyCells(p.gridBefore, p.table) : 0
    if (!added && !removed) return empty
    items.push({
      key: `grid:${p.table}`, label: tableLabel(p.table), isGrid: true, added, removed,
      actions: [{ type: 'cells', count: added, values: p.values, before: p.gridBefore || null }],
    })
  } else if (p.kind === 'batch_ops') {
    // 跨表批量操作：逐项按表与动作归组累加（新增 +1 / 删除 -1 / 修改按字段数）
    const map = new Map()
    for (const op of (Array.isArray(p.ops) ? p.ops : [])) {
      const t = op && op.table
      if (!t) continue
      const g = map.get(t) || { table: t, added: 0, removed: 0, changed: 0, add: [], del: [], update: [] }
      const id = op.id != null ? op.id : (op.data && op.data.id)
      if (op.action === 'add') { g.added++; g.add.push(op.data || op.values || {}) }
      else if (op.action === 'delete') { g.removed++; g.del.push({ id }) }
      else if (op.action === 'update') {
        const changes = (op.data && op.data.changes) || {}
        g.changed += Object.keys(changes).length
        g.update.push({ id, changes })
      }
      map.set(t, g)
    }
    for (const g of map.values()) {
      const added = g.added + g.changed
      const removed = g.removed + g.changed
      if (!added && !removed) continue
      items.push({
        key: `table:${g.table}`, label: tableLabel(g.table), added, removed,
        actions: [
          ...(g.add.length ? [{ type: 'add', count: g.add.length, rows: g.add }] : []),
          ...(g.del.length ? [{ type: 'del', count: g.del.length, rows: g.del }] : []),
          ...(g.update.length ? [{ type: 'update', count: g.changed, rows: g.update }] : []),
        ],
      })
    }
  } else {
    // 行状表：单条 / 批量 的新增、删除、修改
    const t = p.table
    if (!t) return empty
    const data = p.data || {}
    let added = 0, removed = 0
    const actions = []
    if (p.operation === 'add') {
      const rows = p.batch ? (Array.isArray(data.rows) ? data.rows : []) : [data]
      added = rows.length
      actions.push({ type: 'add', count: rows.length, rows })
    } else if (p.operation === 'delete') {
      const ids = Array.isArray(data.ids) ? data.ids : (data.id != null ? [data.id] : [])
      removed = ids.length
      actions.push({ type: 'del', count: ids.length, ids, rows: p.deletedRows || [] })
    } else if (p.operation === 'update') {
      const n = p.batch
        ? (Array.isArray(p.diffs) ? p.diffs.reduce((s, u) => s + (Array.isArray(u.diff) ? u.diff.length : 0), 0) : 0)
        : Object.keys(data.changes || {}).length
      added = n; removed = n
      actions.push({ type: 'update', count: n, rows: p.batch ? p.diffs : [{ changes: data.changes || {} }] })
    }
    if (!added && !removed) return empty
    items.push({ key: `table:${t}`, label: tableLabel(t), added, removed, actions })
  }

  const added = items.reduce((s, it) => s + it.added, 0)
  const removed = items.reduce((s, it) => s + it.removed, 0)
  return { total: items.length, added, removed, items }
}

// 待确认提案的说明文案：前端设置提案写「将修改设置」，其余写「将写入表名」
export function frontProposalHint(p) {
  if (p && p.kind === 'front') return `将修改「${FRONT_LABELS[p.key] || p.key || '设置'}」`
  if (p && p.kind === 'batch_ops') return `将执行 ${Array.isArray(p.ops) ? p.ops.length : 0} 项跨表操作（全部成功或全部失败）`
  if (p && p.kind === 'snapshot_restore') return `将把整个数据库还原到快照 ${p.snapshot}（覆盖当前全部数据，无法撤销）`
  if (p && p.kind === 'skill') {
    const verb = { create: '新建', update: '更新', delete: '删除' }[p.operation] || '修改'
    // markdown 更新：按「行」计算改动量，摘要直接给出新增/删除行数
    if (p.operation === 'update' && p.before != null && p.content != null) {
      const d = lineDiff(p.before, p.content)
      return `将${verb}技能「${p.name || ''}」（新增 ${d.added} 行 · 删除 ${d.removed} 行）`
    }
    return `将${verb}技能「${p.name || ''}」（保存到技能库）`
  }
  if (p && p.operation === 'update' && p.batch) return `将批量修改「${tableLabel(p.table)}」的 ${Array.isArray(p.diffs) ? p.diffs.length : 0} 条记录`
  return `将写入「${tableLabel(p && p.table)}」`
}

// 是否有「处理过程」可展示：有步骤/思维链，或仍在等待首个输出（占位提示）
export function hasProcess(m) {
  if (m.role === 'user') return false
  if (m.reasoning || (m.steps && m.steps.length)) return true
  return !!m._live && !m.processDone && !m.content && !m.proposal
}

// 本消息的过程块里是否已含「思考」步骤（思考已作为时间轴步骤呈现，思维链 blob 会被清空）
export function hasReasonStep(m) {
  return !!(m.steps && m.steps.some((s) => s.kind === 'reason'))
}

// 过程块标题：进行中显示当前步骤，结束后显示「处理过程 · N 步 · 耗时」
export function processTitle(m) {
  if (m._live && !m.processDone) {
    const running = (m.steps || []).slice().reverse().find((s) => s.status === 'running')
    return running ? running.title : '正在处理…'
  }
  const parts = ['处理过程']
  const n = (m.steps || []).length
  if (n) parts.push(`${n} 步`)
  if (m.processMs) parts.push(`${(m.processMs / 1000).toFixed(1)}s`)
  return parts.join(' · ')
}

export function stepIcon(st) {
  if (st.kind === 'reason') return '✻'
  if (st.kind === 'text') return '·'
  if (st.status === 'error') return '✕'
  if (st.status === 'running') return '●'
  return '✓'
}

export function stepClass(st) {
  if (st.kind === 'reason') return 'text-text-muted/60'
  if (st.kind === 'text') return 'text-text-muted/60'
  if (st.status === 'error') return 'text-danger'
  if (st.status === 'running') return 'text-primary animate-pulse'
  return 'text-success'
}

export function stepSeconds(st) {
  return (st.ms / 1000).toFixed(1) + 's'
}

// 生成速度（tokens/s）：输出 tokens ÷ 耗时；无输出 token 或耗时则返回 null（不显示）
export function tokenSpeed(m) {
  const out = m.completionTokens || m.tokens
  if (!m.processMs || !out) return null
  return out / (m.processMs / 1000)
}

// 过程块里点工具步骤：二级展开/收起该工具返回的结果明细
export function toggleStepDetail(st) {
  st._open = !st._open
}

// 仅当这是最后一条助手回复、且其上一条是用户提问时可重试
// （反馈轮次已并入同一条助手消息，其后可能跟着隐藏的「自动反馈」用户消息，这里一并容忍）
export function isRetryable(list, i, busy) {
  if (busy) return false
  const m = list[i]
  if (!m || m.role !== 'assistant' || m.loading) return false
  for (let j = i + 1; j < list.length; j++) {
    if (!isAutoMessage(list[j])) return false
  }
  const prev = list[i - 1]
  return !!(prev && prev.role === 'user' && !isAutoMessage(prev))
}

// 最近一轮是否可回退：仅最后一条助手回复、且其上一条是用户提问
// （反馈轮次已并入同一条助手消息，其后可能跟着隐藏的「自动反馈」用户消息，这里一并容忍）
export function isRollbackable(list, i, busy) {
  if (busy) return false
  const m = list[i]
  if (!m || m.role !== 'assistant' || m.loading) return false
  for (let j = i + 1; j < list.length; j++) {
    if (!isAutoMessage(list[j])) return false
  }
  const prev = list[i - 1]
  return !!(prev && prev.role === 'user' && !isAutoMessage(prev))
}

// 自动反馈消息（回答提问 / 执行或取消提案后回填给 AI 的提示），不算「本轮真实提问」，也不渲染气泡
export function isAutoMessage(m) {
  return m.role === 'user' && (!!m._auto || /^(已执行|已取消|执行失败)：/.test(m.content || ''))
}
