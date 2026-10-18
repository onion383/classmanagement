// 「按记录定位」通用逻辑（第二阶段跨页定位）。
//
// 标题栏全局搜索点击「业务数据」结果后，会跳转 /xxx?focus=<id>。
// 目标页读到 query.focus 后：滚动到对应记录行并播放一次高亮闪动，随后清掉 query。
// 行元素需带 [data-row-id]：DynamicTable 已内置；自定义渲染的页面自行在行根元素上添加。
//
// 用法：
//   Options API：watch/activated/mounted 里调用 applyRouteRowFocus(this)
//   <script setup>：const inst = getCurrentInstance();
//                  watch/onActivated/onMounted 里调用 applyRouteRowFocus(inst.proxy)
// 需要先切页签/展开等预处理时，通过 options.parse(key) 返回定位 id
// （返回 null/undefined 表示时机未到，跳过本次，等待下次触发）。

// 闪动样式：沿用设置页搜索跳转的「圆角荧光边框呼吸」（内描边 + 内发光）。
// 用 box-shadow 实现：主题对 <td> 底色是 !important，会盖掉 background 动画，
// 而 box-shadow 未被强制，且内阴影绘制在底色之上、文字之下；内描边也不会像外阴影那样
// 被相邻单元格的背景遮住。节奏放慢为 3 次 × 1s 的呼吸。
const BLINK_COUNT = 3
const BLINK_MS = 1000
const BLINK_ON = 'inset 0 0 0 3px rgba(37, 99, 235, 0.7), inset 0 0 16px 2px rgba(37, 99, 235, 0.5)'
const BLINK_OFF = 'inset 0 0 0 3px rgba(37, 99, 235, 0), inset 0 0 16px 2px rgba(37, 99, 235, 0)'

// 每个宿主组件已处理过的 focus 签名（去重，防 watch 与 activated 重复触发）。
// 用 WeakMap 挂在模块内，避免往组件实例上写额外属性。
const sigMap = new WeakMap()
// 每个宿主的「时机未到」内部重试状态：{ n, timer }
const retryMap = new WeakMap()

const RETRY_TRIES = 25
const RETRY_INTERVAL = 80

// CSS 属性选择器值转义：避免 id 内特殊字符破坏选择器
function cssQuote(v) {
  return String(v).replace(/["\\]/g, '\\$&')
}

// 在容器内按 [data-row-id] 找到目标行，滚动到可视区，等滚动停下后再播放高亮闪动。
// 命中返回 true；容器/元素缺失返回 false。
export function flashRowById(container, id) {
  if (!container || id == null || id === '') return false
  let el = null
  try {
    el = container.querySelector(`[data-row-id="${cssQuote(id)}"]`)
  } catch (_) {
    return false
  }
  if (!el) return false
  // 闪动用 box-shadow 而非 background-color：主题对 <td> 底色是 !important，会盖过 WAAPI 的
  // background 动画；box-shadow 未被强制，且内阴影绘制在底色之上、文字之下，能稳定显示。
  // 先滚到位置，等滚动停下后再闪动：否则闪动会被滚动过程消耗掉，滚到时已经闪完了。
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  runAfterScroll(el, () => playBlink(el))
  return true
}

// 播放闪动：圆角荧光边框呼吸 BLINK_COUNT 次
function playBlink(el) {
  if (typeof el.animate !== 'function') return
  // 行（DynamicTable 等普通表格）：整行只让「最外圈」变色——每个单元格只贡献上/下两条边，
  // 首格补左边、末格补右边，合起来就是包住整行的一圈荧光边框，单元格内部不变色。
  // 不能直接对 <tr> 加 box-shadow：外阴影会被相邻行/格的背景盖住，内阴影又被自身 <td> 底色盖住。
  if (el.tagName === 'TR') {
    const cells = Array.from(el.children)
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      if (typeof cell.animate === 'function') {
        cell.animate(cellEdgeFrames(i === 0, i === cells.length - 1), ANIM_OPTS)
      }
    }
    return
  }
  // 网格单元格 / 时间轴节点等独立元素：自身一圈内描边
  el.animate([
    { boxShadow: BLINK_OFF, offset: 0 },
    { boxShadow: BLINK_ON, offset: 0.5 },
    { boxShadow: BLINK_OFF, offset: 1 },
  ], ANIM_OPTS)
}

const ANIM_OPTS = { duration: BLINK_MS, iterations: BLINK_COUNT, easing: 'ease-in-out' }

// 单元格边框关键帧：上下边始终有；首格多一条左边、末格多一条右边，拼成整行的一圈边框
function cellEdgeFrames(isFirst, isLast) {
  const band = (a) => {
    const c = `rgba(37, 99, 235, ${a})`
    const parts = [`inset 0 3px 0 0 ${c}`, `inset 0 -3px 0 0 ${c}`]
    if (isFirst) parts.push(`inset 3px 0 0 0 ${c}`)
    if (isLast) parts.push(`inset -3px 0 0 0 ${c}`)
    return parts.join(', ')
  }
  return [
    { boxShadow: band(0), offset: 0 },
    { boxShadow: band(0.7), offset: 0.5 },
    { boxShadow: band(0), offset: 1 },
  ]
}

// 等目标元素滚动到位后再回调（避免闪动被平滑滚动过程吃掉）。
// 优先用 scrollend；不支持时用「scroll 事件静止 120ms」兜底；元素本就可见时立即回调。
function runAfterScroll(el, cb) {
  const win = (el.ownerDocument && el.ownerDocument.defaultView) ||
    (typeof window !== 'undefined' ? window : null)
  if (!win) { cb(); return }
  let started = false
  let settleTimer = null
  let noScrollTimer = null
  let maxTimer = null
  const cleanup = () => {
    if (settleTimer) clearTimeout(settleTimer)
    if (noScrollTimer) clearTimeout(noScrollTimer)
    if (maxTimer) clearTimeout(maxTimer)
    win.removeEventListener('scrollend', start, true)
    win.removeEventListener('scroll', onScroll, true)
  }
  function start() {
    if (started) return
    started = true
    cleanup()
    cb()
  }
  function onScroll() {
    if (noScrollTimer) { clearTimeout(noScrollTimer); noScrollTimer = null }
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(start, 120)
  }
  win.addEventListener('scrollend', start, true)
  win.addEventListener('scroll', onScroll, true)
  // 无需滚动（元素已在视口内）时，尽快开始
  noScrollTimer = setTimeout(start, 100)
  // 兜底：无论如何 1s 后开始
  maxTimer = setTimeout(start, 1000)
}

// 目标行可能因数据异步加载/页签切换而尚未渲染：按固定间隔重试，直到命中或超时。
export function focusRowWhenReady(containerGetter, id, { tries = 25, interval = 80 } = {}) {
  if (id == null || id === '') return
  let n = 0
  const attempt = () => {
    const c = typeof containerGetter === 'function' ? containerGetter() : containerGetter
    if (c && flashRowById(c, id)) return
    if (++n < tries) setTimeout(attempt, interval)
  }
  attempt()
}

// 读取路由 query.focus 并执行定位。
// host：组件公共实例（Options API 的 this / setup 里的 getCurrentInstance().proxy）。
// options.parse(key)：返回真正用于定位的 id，返回空值表示时机未到、跳过本次。
// options.container()：返回查询容器，默认 host.$el。
export function applyRouteRowFocus(host, options = {}) {
  const route = host && host.$route
  if (!route) return
  const raw = route.query ? route.query.focus : undefined
  if (raw == null || raw === '') {
    sigMap.set(host, '')
    clearRetry(host)
    return
  }
  const key = String(raw)
  if (key === sigMap.get(host)) return
  let id = key
  if (options.parse) {
    id = options.parse(key)
    // parse 返回空值 = 时机未到（数据/页签尚未就绪）：安排一次内部重试，等就绪后再定位
    if (id == null || id === '') { scheduleRetry(host, options); return }
  }
  sigMap.set(host, key)
  clearRetry(host)
  // 定位成功后清掉 query，避免回退/刷新时重复定位
  host.$router.replace({ path: route.path })
  const container = options.container ? options.container() : host.$el
  focusRowWhenReady(container, id)
}

// 内部重试：parse 依赖的数据/页签尚未就绪时，按固定间隔重跑 applyRouteRowFocus，直到命中或超时。
function scheduleRetry(host, options) {
  let st = retryMap.get(host)
  if (!st) { st = { n: 0, timer: null }; retryMap.set(host, st) }
  if (st.timer || st.n >= RETRY_TRIES) return
  st.timer = setTimeout(() => {
    st.timer = null
    st.n++
    applyRouteRowFocus(host, options)
  }, RETRY_INTERVAL)
}

function clearRetry(host) {
  const st = retryMap.get(host)
  if (st) {
    if (st.timer) clearTimeout(st.timer)
    retryMap.delete(host)
  }
}
