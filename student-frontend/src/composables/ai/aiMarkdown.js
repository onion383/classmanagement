// marked / DOMPurify 异步懒加载（减少页面 chunk 大小，降低 LCP）
// 模块级单例：整个应用共用一份，避免重复 import 与重复 addHook。
let _marked = null
let _purify = null

export async function ensureMarkdown() {
  if (_marked) return
  const [markedModule, purifyModule] = await Promise.all([
    import('marked'),
    import('dompurify'),
  ])
  _marked = markedModule.marked
  _purify = purifyModule.default
  _marked.setOptions({ gfm: true, breaks: true })
  _purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') node.setAttribute('target', '_blank')
  })
}

// markdown 库是否已就绪（供「重算全部 HTML」等场景判断，避免在未加载时解析报错）
export function isMarkdownReady() {
  return !!(_marked && _purify)
}

// 回复里的 ```record 代码块：AI 只指认「表名 + id」，由 AiRecordTable 去后端取完整数据渲染
export function parseRecordSpec(raw) {
  try {
    const spec = JSON.parse(raw.trim())
    const table = typeof spec?.table === 'string' ? spec.table : ''
    const rawIds = Array.isArray(spec?.ids) ? spec.ids : spec?.id != null ? [spec.id] : []
    const ids = rawIds.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 30)
    return table && ids.length ? { table, ids } : null
  } catch (_) {
    return null
  }
}
// 回复里的 ```chart 代码块：AI 只给「类型 + 标签 + 数值」，由 AiChart 组件绘制
export function parseChartSpec(raw) {
  try {
    const spec = JSON.parse(raw.trim())
    const type = ['bar', 'pie', 'line'].includes(spec?.type) ? spec.type : 'bar'
    const labels = Array.isArray(spec?.labels) ? spec.labels.map((x) => String(x == null ? '' : x)) : []
    const values = Array.isArray(spec?.values) ? spec.values.map(Number) : []
    const n = Math.min(labels.length, values.length)
    if (!n) return null
    return {
      type,
      title: String(spec?.title || ''),
      unit: String(spec?.unit || ''),
      labels: labels.slice(0, n),
      values: values.slice(0, n).map((v) => (Number.isFinite(v) ? v : 0)),
    }
  } catch (_) {
    return null
  }
}
export function parseBlocks(text) {
  const blocks = []
  const re = /```(record|chart)[ \t]*([\s\S]*?)```/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) blocks.push({ type: 'md', text: text.slice(last, m.index) })
    const kind = m[1]
    const raw = m[2]
    const spec = kind === 'record' ? parseRecordSpec(raw) : parseChartSpec(raw)
    // 解析不出（流式输出中途、数据不全等）就退化成普通代码块，避免内容被吞掉
    blocks.push(spec ? { type: kind, ...(kind === 'record' ? spec : { data: spec }) } : { type: 'md', text: '```' + kind + raw + '```' })
    last = m.index + m[0].length
  }
  if (last < text.length) blocks.push({ type: 'md', text: text.slice(last) })
  return blocks.filter((b) => b.type !== 'md' || b.text.trim())
}

// 把回复拆块：markdown 片段做 DOMPurify 清洗，record 数据块交给 AiRecordTable 组件
export function buildBlocks(content) {
  return parseBlocks(content).map((b) =>
    b.type === 'md' ? { ...b, html: _purify.sanitize(_marked.parse(b.text)) } : b
  )
}

// 流式输出中按「已完成的行」增量渲染 markdown：每输出完一行就渲染一行，未完成的行先按纯文本
export function updateLiveRender(m) {
  const text = m.content || ''
  // markdown 库未就绪时退回纯文本，避免已输出的内容不显示
  if (!_marked || !_purify) { m._liveHtml = ''; m._liveTail = text; return }
  const cut = text.lastIndexOf('\n')
  const head = cut === -1 ? '' : text.slice(0, cut + 1)
  m._liveTail = cut === -1 ? text : text.slice(cut + 1)
  // 没有新增完整行就不重算，保证「一行一渲染」而不是每个字符都重排
  if (head === m._liveSrc) return
  m._liveSrc = head
  m._liveHtml = head ? _purify.sanitize(_marked.parse(head)) : ''
}
