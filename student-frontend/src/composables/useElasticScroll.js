// 全局滚动增强：橡皮筋（到顶/底回弹） + 普通惯性（松手后滑行一小段）。
// 覆盖页面内所有可滚动容器（含动态出现的弹窗），不影响原生滚动条实时性。
//
// 两者共存规则：
//   - 正常滚动（未到边界）：原生即时滚动，松手后按最近滚动速度做惯性滑行、逐渐减速停下。
//   - 滚到顶/底后继续滚：触发橡皮筋，内容被拉开，松手后经 CSS 过渡回弹。
//   - 惯性滑行途中撞到顶/底：直接停下，不触发橡皮筋（橡皮筋只由真实滚轮越界触发）。
//
// 现状（临时）：整个模块停用——main.js 里的 startElasticScroll() 已注释，
// 橡皮筋与惯性滑行都不生效，滚动全部交回原生。
// **停用原因：橡皮筋效果不理想**（回弹手感不自然，不是性能问题）。勿当性能问题去"优化再启用"。
// 恢复顺序：先取消 main.js 的调用；若只要惯性，保持下面「橡皮筋：暂时注释」的三处注释即可
// （release() 函数、handleWheel 里的 pull 分支、定时器里的越界分流）。

// 本模块当前整体停用（见上方「现状（临时）」），但刻意保留了橡皮筋/惯性的完整参数与分支，
// 恢复时按注释里的三步直接启用即可。下列常量（MAX_PULL/DAMP/TRANS_*/DIR_SIGN）与被注释
// 分支里的 over 变量不属于死代码，因此整个文件豁免「未使用变量」检查。
/* eslint-disable no-unused-vars */
const MAX_PULL = 20    // 橡皮筋最大超出像素
const DAMP = 0.38      // 橡皮筋超出阻尼（让拉出速度慢于滚轮）
const SETTLE_MS = 480  // 橡皮筋回弹动画时长
const IDLE_MS = 120    // “松手”判定：滚动事件间隔超过此值视为停手（=0 会一拉即回、动画不可见）

const TRANS_BOUNDARY = 'transform 60ms linear' // 越界跟随时用（快）
const TRANS_SETTLE = `transform ${SETTLE_MS}ms cubic-bezier(0.25, 1, 0.3, 1)` // 回弹/复位用（慢）

const INERTIA_SCALE = 0.03 // 惯性速度换算：deltaY → 起步速度（px/帧）
const INERTIA_DECAY = 0.85 // 每帧（约 16.7ms）速度衰减系数
const INERTIA_MIN = 0.6    // 速度低于此值停止滑行
const INERTIA_SMOOTH = 0.75 // 速度平滑：老值权重（0.75）＋ 新值权重（0.25）

// 方向开关：1 ＝ 内容跟随滚动方向偏移；-1 ＝ 相反（实测不一致时翻转此值）
const DIR_SIGN = -1

const boundSet = new WeakSet() // 已绑定的元素
const metaMap = new WeakMap()  // el -> { pull, settleTimer, vel, inertiaId, lastFrame }

function metaOf(el) {
  if (!metaMap.has(el)) metaMap.set(el, { pull: 0, settleTimer: 0, vel: 0, inertiaId: 0, lastFrame: 0 })
  return metaMap.get(el)
}

function isScrollable(el) {
  if (!el || !el.isConnected || el.getAttribute('data-elastic') === 'off') return false
  // 快速路径：先检查 inline style，避免不必要的 getComputedStyle（强制重排）
  const is = el.style
  if (is.overflowY === 'auto' || is.overflowY === 'scroll' || is.overflow === 'auto' || is.overflow === 'scroll') return true
  if (is.overflowY === 'hidden' || is.overflowY === 'visible' || is.overflow === 'hidden' || is.overflow === 'visible') return false
  const st = getComputedStyle(el)
  return st.overflowY === 'auto' || st.overflowY === 'scroll'
    || st.overflow === 'auto' || st.overflow === 'scroll'
}

// 兼容 deltaMode：0=像素 1=行 2=页，统一转成像素
function normalizeDeltaY(e) {
  if (e.deltaMode === 1) return e.deltaY * 16
  if (e.deltaMode === 2) return e.deltaY * 100
  return e.deltaY
}

function stopInertia(m) {
  if (m.inertiaId) { cancelAnimationFrame(m.inertiaId); m.inertiaId = 0 }
}

function startInertia(el) {
  const m = metaOf(el)
  if (m.inertiaId) return
  m.lastFrame = performance.now()
  const step = (now) => {
    const dt = Math.min(48, now - m.lastFrame)
    m.lastFrame = now
    m.vel *= Math.pow(INERTIA_DECAY, dt / 16.7)
    if (Math.abs(m.vel) < INERTIA_MIN) { m.vel = 0; stopInertia(m); return }
    const max = el.scrollHeight - el.clientHeight
    let t = el.scrollTop - m.vel
    if (t < 0) t = 0
    else if (t > max) t = max
    // 惰性途中撞到顶/底：直接停下，不触发橡皮筋
    if (t === el.scrollTop) { m.vel = 0; stopInertia(m); return }
    el.scrollTop = t
    if (el.scrollTop <= 0 || el.scrollTop >= max - 0.5) { m.vel = 0; stopInertia(m); return }
    m.inertiaId = requestAnimationFrame(step)
  }
  m.inertiaId = requestAnimationFrame(step)
}

/* 橡皮筋：暂时注释（回弹动画的执行者，停用后不会写入任何 transform）
function release(el) {
  const m = metaOf(el)
  clearTimeout(m.settleTimer)
  m.settleTimer = 0
  stopInertia(m)
  if (m.pull === 0) return
  m.pull = 0
  el.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.25, 1, 0.3, 1)`
  el.style.transform = 'translateY(0)'
}
橡皮筋：暂时注释结束 */

function handleWheel(e) {
  const el = e.currentTarget
  if (!el) return
  const dy = normalizeDeltaY(e)
  if (!dy) return
  const m = metaOf(el)

  // 停止前一次的惯性 / 回弹计时
  stopInertia(m)
  clearTimeout(m.settleTimer)

  // 累积速度（供松手后惯性滑行）。精细/触控板的微小 dy 直接清零，避免与系统原生惯性叠双重
  if (Math.abs(dy) < 2) m.vel = 0
  else m.vel = m.vel * INERTIA_SMOOTH + dy * INERTIA_SCALE

  // 越界判断：仅当【当前已贴到顶/底 且 继续同向滚动】时触发橡皮筋，避免大步长 dy 误判
  const maxScrollTop = el.scrollHeight - el.clientHeight
  const over = (el.scrollTop <= 0 && dy > 0) || (el.scrollTop >= maxScrollTop - 0.5 && dy < 0)

  /* 橡皮筋：暂时注释（越界拉开 + 跟随位移）
  if (over) {
    // 橡皮筋：叠加跟随滚动方向的弹性偏移。
    // pull 已到上限/下限时 next===pull，跳过重复写 style，避免相同赋值仍触发样式重算（INP 优化）。
    const next = Math.max(-MAX_PULL, Math.min(MAX_PULL, m.pull + dy * DAMP))
    if (next !== m.pull) {
      m.pull = next
      el.style.transition = TRANS_BOUNDARY
      el.style.transform = `translateY(${m.pull * DIR_SIGN}px)`
    }
  } else if (m.pull !== 0) {
    // 回到正常区域：清空残留的橡皮筋偏移
    m.pull = 0
    el.style.transition = TRANS_SETTLE
    el.style.transform = 'translateY(0)'
  }
  橡皮筋：暂时注释结束 */

  // 松手（超过 IDLE_MS 无滚动事件）后：惯性滑行
  // （橡皮筋已停用，越界时不再回弹；惯性滑行撞到顶/底会自行停下，行为与原生一致）
  m.settleTimer = setTimeout(() => {
    startInertia(el)
  }, IDLE_MS)
}

export function bindElastic(el) {
  if (!el || boundSet.has(el) || !isScrollable(el)) return
  boundSet.add(el)
  el.addEventListener('wheel', handleWheel, { passive: false })
}

// 全局启动：扫描当前及未来（动态弹窗）出现的所有可滚动容器并绑定
let started = false
export function startElasticScroll() {
  if (started || typeof document === 'undefined') return
  started = true

  const scanAll = () => {
    document.querySelectorAll('*').forEach(el => {
      if (!boundSet.has(el) && el.scrollHeight > el.clientHeight + 1 && isScrollable(el)) bindElastic(el)
    })
  }
  const scanRoot = (root) => {
    if (!root) return
    if (root.nodeType === 1) {
      if (!boundSet.has(root) && root.scrollHeight > root.clientHeight + 1 && isScrollable(root)) bindElastic(root)
      root.querySelectorAll('*').forEach(el => {
        if (!boundSet.has(el) && el.scrollHeight > el.clientHeight + 1 && isScrollable(el)) bindElastic(el)
      })
    }
  }

  let pending = []
  let ticking = false
  const MAX_NODES_PER_FRAME = 16
  const flush = () => {
    ticking = false
    if (!pending.length) return
    const batch = pending.splice(0, MAX_NODES_PER_FRAME)
    batch.forEach(scanRoot)
    if (pending.length) {
      ticking = true
      requestAnimationFrame(flush)
    }
  }
  const scheduleNodes = (nodes) => {
    for (const n of nodes) { if (n.nodeType === 1) pending.push(n) }
    if (ticking || !pending.length) return
    ticking = true
    requestAnimationFrame(flush)
  }

  scanAll()
  const mo = new MutationObserver((mutations) => {
    const added = []
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length) added.push(...m.addedNodes)
    }
    if (added.length) scheduleNodes(added)
  })
  mo.observe(document.body, { childList: true, subtree: true })

  window.addEventListener('resize', () => { requestAnimationFrame(scanAll) })
}