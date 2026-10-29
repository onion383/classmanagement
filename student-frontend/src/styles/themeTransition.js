// 日/夜切换的过渡编排：把「可见的过渡」交给浏览器快照，把「逐元素过渡」瞬时化。
//
// 使用方：stores/theme.js 的 performThemeSwap(swap) 包住「改 data-mode」的那一下
// （swap 里同步改状态与 DOM），它会自动瞬时化元素过渡并做快照淡入。
//
// 背景（见 styles/theme-night.css / styles/themeLoader.js）：
//   theme-night.css 里近 200 条规则全部以 :root[data-mode="night"] 限定作用域，而
//   data-mode 挂在 <html> 上，是整棵 DOM 的祖先属性。属性一变，浏览器要对每个元素
//   重新匹配这些规则、重建 ComputedStyle，成本是 O(节点数)，表格多的时候尤其明显。
//
//   如果同时再让每个 button / tr / td 各做一次 0.2s 的颜色与阴影过渡（glass 主题给
//   所有 button 加了 background-color + box-shadow 过渡，DynamicTable 给 tr 加了
//   background-color 过渡），就变成「一次全量重算 + 上千个元素逐帧重绘 12 帧」。
//   而且这些元素多半压着 backdrop-filter，每一帧都要重新采样背景。这才是「表格一多就卡」
//   的主因，而不是重算本身。
//
// 做法：
//   1) 用 View Transitions API：浏览器在切换前后各拍一张整屏快照，两帧之间做 opacity
//      交叉淡入。淡入是合成器上的单层动画，主线程不参与，成本与 DOM 规模无关（O(1)）。
//   2) 快照回调里同步完成 data-mode 切换，并给 <html> 打上 theme-switching 类，
//      把元素级过渡/动画瞬时化 —— 否则它们会和快照淡入叠加，等于白付一遍逐帧重绘。
//
// 观感：整页从日间配色平滑淡到夜间配色。日夜变化的本就是大面积色块，与「逐元素渐变」
// 几乎看不出差别，但不再随表格/行数变慢。

// 切换事务窗口的类名，对应的 CSS 见 styles/index.css（过渡时长归零）
const SWITCHING_CLASS = 'theme-switching'

// 「新快照层起始不透明度」与「本次动画时长」的自定义属性名，CSS 见 styles/index.css。
// 平时不设，走 CSS 里的默认 0.62 / 100ms；连点打断时前者设成当前混合度的补数、
// 后者设成「这次切换已经过去了多久」，让反向从这一帧接着走、且用时与进来时等长。
const FROM_VAR = '--theme-switch-from'
const DURATION_VAR = '--theme-switch-duration'

// 是否用「快照 + 收尾」的方式做切换过渡。
//   true  = 有过渡：整页从旧配色收到新配色（CSS 见 index.css 的 theme-switch-in）
//   false = 瞬时切换：点下去当帧就换完色，最跟手，但没有任何渐变
// 当前开启快照：瞬时切换虽然最快，但整页硬切观感偏跳，还是保留收尾更自然。
// 想对比瞬时手感把这里改回 false 即可，CSS（::view-transition-* 那一段）不用动。
const SNAPSHOT_ENABLED = true

// 当前嵌套在事务窗口里的层数（连点/打断时会叠加，用计数而不是布尔）
let pendingInstants = 0

/**
 * 在一段「元素级过渡全部瞬时」的窗口内同步执行 fn。
 *
 * 这里刻意**不做**强制同步样式刷新（早期版本读过 offsetWidth）：
 *   CSS Transitions 规范在决定「要不要起过渡、起多长」时，用的是**变更后样式**里的
 *   transition-duration / delay。类和 data-mode 落在同一次样式重算里，变更后时长已经是
 *   0.001ms，过渡要么不起、要么瞬时结束。
 *   而强制刷新会让浏览器先把整篇样式重算一遍（类的后代选择器命中所有元素），
 *   data-mode 变更时再重算一遍 —— 切换成本直接翻倍，这正是「点下去要等一下」的来源。
 *
 * 两帧后再摘类：此时新配色已经提交上屏，摘掉类不会触发任何过渡。
 */
export function withInstantStyles(fn) {
  const root = document.documentElement
  // 已经在事务窗口里（连点/打断嵌套）：类还在，计数保证只由最外层摘类
  pendingInstants++
  root.classList.add(SWITCHING_CLASS)
  try {
    return fn()
  } finally {
    const release = () => {
      pendingInstants--
      if (pendingInstants <= 0) {
        pendingInstants = 0
        root.classList.remove(SWITCHING_CLASS)
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(release))
  }
}

// 是否可以用快照做过渡：
//   - 用户关掉「动画效果」时（html.no-animations）明确要求静态化，不做淡入
function snapshotTransitionAllowed() {
  if (!SNAPSHOT_ENABLED) return false
  if (document.documentElement.classList.contains('no-animations')) return false
  return true
}

// 正在播放的那次快照过渡。用于「连点时接着当前混合度掉头」：
// 读它新快照层的当前不透明度与已播放时长，反向那一层从「1 − 该值」起步、用等长的时长退回。
let inflight = null
// 本次过渡的发起时刻：读不到动画对象时用它兜底估算已过去的时长
let inflightStartedAt = 0
// 在播动画的起始不透明度（首次切换是 CSS 默认的 0.62，反向则是当时算出的 1 − r）。
// 用来判断「这一程真正走了多远」，返回时长按这个距离等比缩短。
let inflightFrom = 0.62

// 读在播快照「新画面层」的当前不透明度 r（页面视觉 = 新快照×r + 旧快照×(1−r)）。
// 读不到（过渡已结束 / 浏览器不给伪元素算样式）时返回 null，调用方退回默认观感。
function readInflightOpacity() {
  if (!inflight) return null
  try {
    const style = window.getComputedStyle(document.documentElement, '::view-transition-new(root)')
    const value = parseFloat(style.opacity)
    if (Number.isFinite(value)) return Math.min(1, Math.max(0, value))
  } catch (_) {}
  return null
}

// 读在播快照动画已经播放了多久（毫秒）：反向就用这个时长退回，
// 做到「进来用了多久，返回就用多久」。拿不到动画对象时退回「发起时刻到现在」的估算值。
function readInflightElapsed() {
  if (!inflight) return null
  try {
    const animations = document.getAnimations()
    for (const animation of animations) {
      const pseudo = animation.effect && animation.effect.pseudoElement
      if (!pseudo || pseudo.indexOf('view-transition-new') === -1) continue
      const raw = animation.currentTime
      if (raw == null) continue // 尚未开始计时（还没排上帧）：别当成 0
      const time = Number(raw)
      if (Number.isFinite(time) && time >= 0) return time
    }
  } catch (_) {}
  const fallback = performance.now() - inflightStartedAt
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : null
}

/**
 * 当前是否有快照过渡正在播（含刚发起、回调还没跑的那一帧）。
 * 供调用方判断「模式值与目标一致」时是否真的可以省掉这一次过渡。
 */
export function isThemeSwapInFlight() {
  return inflight !== null
}

/**
 * 执行一次日/夜切换，并对「切换」本身做过渡。
 *
 * 打断语义：上一次的淡入还没播完（用户在连点）时，不掐掉它、也不排一段全新 dissolve，
 * 而是「接着当前混合度往回走」：
 *   页面在任意时刻的视觉 = 新快照 × r + 旧快照 × (1 − r)。
 *   反向时上一段的「旧快照」正好变成新一段的「新快照」，所以只要把新快照的起始
 *   不透明度设成 1 − r，第一帧就与当前画面完全一致，之后照常收到 1 ——
 *   观感上就是从「淡到一半」平滑地原路退回去，而不是硬切一刀。
 *   反向时长取「这一程已经走了多久 × 真正走过的比例」：80ms 时约 76ms 退回，
 *   10ms 时几乎瞬间退回（那 0.62 的跳起不算走过），时间与视觉距离都对得上。
 *   反向动画依然只动快照层的 opacity（合成器单层动画，成本与 DOM 规模无关），
 *   逐元素过渡仍在事务窗口里瞬时化。
 *
 * @param {() => void} swap 真正改状态、改 DOM 的同步函数（由调用方保证幂等）
 */
export function performThemeSwap(swap) {
  // ① 不支持 / 用户关了动画：退化为瞬时切换，功能不受影响
  if (!snapshotTransitionAllowed()) {
    inflight = null
    withInstantStyles(swap)
    return
  }
  // ② 上一段还在播：读出当前 r 与已播时长，反向就从这个混合度、用这段时长退回去
  const current = readInflightOpacity()
  const from = current == null ? null : Math.max(0, Math.min(1, 1 - current))
  const elapsed = current == null ? null : readInflightElapsed()
  // 返回时长 = 已用时长 × 这一程真正走过的比例：
  //   (r − 起始值) / (1 − 起始值) 就是动画实际推进的进度。
  // 这样 80ms 时反向约用 76ms；10ms 时几乎瞬间退回（首次切换那 0.62 是「跳起」的，
  // 不算走过），不会出现「只前进了一点、却要花整段时间退」。下限 16ms 兜一帧。
  const advanced = current == null ? 0 : (current - inflightFrom) / Math.max(0.001, 1 - inflightFrom)
  const ratio = Math.min(1, Math.max(0, advanced))
  const duration = elapsed == null ? null : Math.max(16, Math.round(elapsed * ratio))
  let ran = false
  const run = () => {
    if (ran) return
    ran = true
    withInstantStyles(() => {
      // 与 swap 里的 data-mode 写在同一次样式更新里，不额外付一次全量重排。
      // 不设时 CSS 用默认 0.62 / 100ms（首次切换的「先到位、再收尾」）。
      if (from != null) {
        document.documentElement.style.setProperty(FROM_VAR, String(from))
        if (duration != null) document.documentElement.style.setProperty(DURATION_VAR, `${duration}ms`)
      }
      swap()
    })
  }
  let transition
  try {
    // 已有在播过渡时，浏览器会自动把上一段 skip 掉再拍新快照，无需手动掐。
    inflightStartedAt = performance.now()
    // 记下这一次动画的起点：连点时用它算「真正走了多远」
    inflightFrom = from == null ? 0.62 : from
    transition = document.startViewTransition(run)
  } catch (err) {
    // 极端情况（并发调用、文档不可见等）：退化为无过渡切换
    inflight = null
    run()
    return
  }
  inflight = transition
  const done = () => {
    // 已被后来的一次切换接管：起点与时长变量由最新的那次负责清理
    if (inflight !== transition) return
    inflight = null
    document.documentElement.style.removeProperty(FROM_VAR)
    document.documentElement.style.removeProperty(DURATION_VAR)
  }
  // 被后续切换打断（自动 skip）或快照失败都不影响最终状态：
  // swap 已在回调里同步执行完毕，DOM 只会落在正确的那一态。
  transition.finished.then(done, done)
  transition.ready.catch(() => {})
  // swap 内部若抛错，别留下未处理的 rejection
  transition.updateCallbackDone.catch(() => {})
}
