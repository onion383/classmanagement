import { LABELS, FRONT_LABELS } from './aiConstants.js'

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
    if (m.process.ask) parsed.ask = m.process.ask
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

// 待确认提案的说明文案：前端设置提案写「将修改设置」，其余写「将写入表名」
export function frontProposalHint(p) {
  if (p && p.kind === 'front') return `将修改「${FRONT_LABELS[p.key] || p.key || '设置'}」`
  if (p && p.kind === 'batch_ops') return `将执行 ${Array.isArray(p.ops) ? p.ops.length : 0} 项跨表操作（全部成功或全部失败）`
  if (p && p.kind === 'snapshot_restore') return `将把整个数据库还原到快照 ${p.snapshot}（覆盖当前全部数据，无法撤销）`
  if (p && p.kind === 'skill') {
    const verb = { create: '新建', update: '更新', delete: '删除' }[p.operation] || '修改'
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
