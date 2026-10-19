// =========================================================================
// inpProbe.js —— INP 归因探针（仅开发模式）
//
// 目的：把「哪一类交互慢、慢在哪一段」量出来，而不是靠感觉判断 INP。
// INP 只看「交互 → 下一帧被画出来」的耗时，它由三段构成：
//   inputDelay   事件开始 → 处理函数开始（主线程正忙时的排队时间）
//   processing   处理函数执行（同步计算、以及 await 的网络往返都算在这里）
//   presentation 处理完成 → 下一帧真正画出来（渲染 / 合成 / 毛玻璃重采样）
// 三段分开统计，才能判断该往哪个方向优化（点击即反馈 / 重活后置 / 削合成抖动）。
//
// 输出两级视图：
//   ① 类别聚合：切换页面 / 打开弹窗 / 弹窗内操作 / 确认保存 / 表格输入 / 键盘 / 其它
//   ② 元素明细 Top：保留原始 tag.class「文案」，用于精确落到具体控件
//
// 正式版不安装：调用点用 `if (import.meta.env.DEV)` 包裹，打包时整段被摇树删除；
// 模块内再加一道 DEV 兜底，万一被别处误引入也是直接 return，零副作用。
//
// 用法：dev 控制台 __inp() 导出并返回汇总、__inpReset() 清空；每 15s 有新增自动导出。
// =========================================================================

const DEV = import.meta.env.DEV
// 只记录 ≥40ms 的交互，过滤掉大量无关紧要的快速点击
const MIN_DURATION = 40
// 每 15s 自动导出一次新增样本（自上次导出起无新样本时不导出）
const AUTO_DUMP_MS = 15000
// 明细视图最多保留多少条（类别视图不截断）
const DETAIL_TOP = 15

const KEY_EVENTS = { keydown: 1, keyup: 1, keypress: 1 }
// 按钮文案启发式：确认/保存类优先判定，其次才是「打开弹窗」类
const SAVE_TEXT = /保存|确定|提交|应用|删除|确认|同步|上传/
const OPEN_TEXT = /新增|添加|新建|设置|导入|导出|补录|排表|编辑|详情|管理|切换/
// 弹窗容器识别：各弹窗并未统一 role="dialog"，所以叠加类名兜底
const DIALOG_SEL = '[role="dialog"], [class*="dialog"], [class*="Dialog"], [class*="modal"], [class*="Modal"], [class*="overlay"], [class*="Overlay"]'

const byCategory = new Map() // 类别 -> stats
const byTarget = new Map()   // '事件 → 元素' -> stats
let observer = null
let autoTimer = null
let pendingSinceDump = 0

// 目标元素做成人能看懂的短标签：tag#id.class「按钮文案」
function labelOf(target) {
  if (!target || !target.tagName) return '(未知目标)'
  const tag = target.tagName.toLowerCase()
  const id = target.id ? `#${target.id}` : ''
  let cls = ''
  if (typeof target.className === 'string' && target.className.trim()) {
    cls = '.' + target.className.trim().split(/\s+/).slice(0, 2).join('.')
  }
  const text = (target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 14)
  return text ? `${tag}${id}${cls}「${text}」` : `${tag}${id}${cls}`
}

// 交互归类：按「用户视角」分到切换页面 / 打开弹窗 / 确认保存 / 表格输入 等
function classify(entry) {
  if (KEY_EVENTS[entry.name]) return '键盘'
  const t = entry.target
  if (!t || typeof t.closest !== 'function') return '其它'
  const dialog = t.closest(DIALOG_SEL)
  // 切换页面：任意锚点跳转（弹窗内的链接归入弹窗操作）
  if (!dialog && t.closest('a[href]')) return '切换页面'
  const btn = t.closest('button, [role="button"], a, .btn')
  const text = ((btn || t).textContent || '').trim()
  // 确认/保存类优先于「弹窗内操作」——保存按钮通常就在弹窗里
  if (btn && SAVE_TEXT.test(text)) return '确认保存'
  if (dialog) return '弹窗内操作'
  if (btn && OPEN_TEXT.test(text)) return '打开弹窗'
  const tag = (t.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return '表格输入'
  if (t.closest('td, th, [contenteditable="true"]')) return '表格输入'
  return '其它'
}

// 记一桶：只保留「最长那次」的三段拆分，避免把不同交互的耗时混在一起平均
function bump(map, key, entry, sample) {
  const b = map.get(key) || { count: 0, max: 0, inputDelay: 0, processing: 0, presentation: 0, sample: '' }
  b.count++
  if (entry.duration > b.max) {
    b.max = Math.round(entry.duration)
    b.inputDelay = Math.round(entry.processingStart - entry.startTime)
    b.processing = Math.round(entry.processingEnd - entry.processingStart)
    b.presentation = Math.round(entry.startTime + entry.duration - entry.processingEnd)
    b.sample = sample
  }
  map.set(key, b)
}

function record(entry) {
  // 只统计真正的用户交互：click / pointerdown / keydown 等才有非 0 的 interactionId
  if (!entry.interactionId) return
  if (entry.duration < MIN_DURATION) return
  const label = labelOf(entry.target)
  bump(byCategory, classify(entry), entry, `${entry.name} → ${label}`)
  bump(byTarget, `${entry.name} → ${label}`, entry, label)
  pendingSinceDump++
}

function toRows(map, keyName, limit) {
  const rows = [...map.entries()]
    .map(([key, b]) => ({
      [keyName]: key,
      次数: b.count,
      最长: b.max,
      输入延迟: b.inputDelay,
      处理: b.processing,
      呈现: b.presentation,
      典型: b.sample,
    }))
    .sort((a, b) => b.最长 - a.最长)
  return limit ? rows.slice(0, limit) : rows
}

// 导出汇总：同时打印、回传主进程落盘，并把数据 return 出去（供 CDP 脚本读取）
function dump(reason) {
  if (!byCategory.size) {
    console.log(`[inp] 暂无 ≥${MIN_DURATION}ms 的交互样本`)
    return { reason, categories: [], details: [] }
  }
  const categories = toRows(byCategory, '类别')
  const details = toRows(byTarget, '交互', DETAIL_TOP)
  console.log(`[inp] 按交互类别（${reason}，单位 ms）`)
  console.table(categories)
  console.log(`[inp] 最慢交互明细 Top ${details.length}`)
  console.table(details)
  // 同步一份给主进程落盘（electron/main.inpLog.js → <数据目录>/inp.log）。
  // 探针只在 dev 安装，打包版不会走到这里，通道名也不会被使用。
  try { window.electron?.send?.('inp-report', { reason, categories, details }) } catch (_) {}
  return { reason, categories, details }
}

export function installInpProbe() {
  if (!DEV || observer) return
  if (typeof PerformanceObserver === 'undefined') return
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record(entry)
    })
    observer.observe({ type: 'event', buffered: true, durationThreshold: MIN_DURATION })
    autoTimer = setInterval(() => {
      if (!pendingSinceDump) return
      pendingSinceDump = 0
      dump('自动')
    }, AUTO_DUMP_MS)
    window.__inp = () => { pendingSinceDump = 0; return dump('手动') }
    window.__inpReset = () => {
      byCategory.clear()
      byTarget.clear()
      pendingSinceDump = 0
      console.log('[inp] 已清空')
    }
    console.log(`[inp] 归因探针已启用（仅统计 ≥${MIN_DURATION}ms 的用户交互）；__inp() 导出并返回汇总、__inpReset() 清空`)
  } catch (err) {
    console.warn('[inp] 探针启用失败:', err?.message || err)
  }
}
