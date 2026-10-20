// 日/夜切换的过渡编排：把「可见的过渡」交给浏览器快照，把「逐元素过渡」瞬时化。
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
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(release))
    } else {
      setTimeout(release, 32)
    }
  }
}

// 是否可以用快照做过渡：
//   - Electron 44（Chromium 140+）已支持 startViewTransition
//   - 用户关掉「动画效果」时（html.no-animations）明确要求静态化，不做淡入
function snapshotTransitionAllowed() {
  if (!SNAPSHOT_ENABLED) return false
  if (typeof document.startViewTransition !== 'function') return false
  if (document.documentElement.classList.contains('no-animations')) return false
  return true
}

// 正在播放的那次快照过渡。用于「连点时立刻掉头」：
// 新的一次切换到来时先把它掐掉，不让用户等上一次淡完。
let inflight = null

function skipInflight() {
  const prev = inflight
  inflight = null
  if (!prev) return false
  try {
    prev.skipTransition()
  } catch (_) {}
  return true
}

/**
 * 执行一次日/夜切换，并对「切换」本身做过渡。
 *
 * 打断语义：如果上一次的淡入还没播完（用户在连续点击），这次不排新的一段 dissolve，
 * 而是先掐掉旧的、再把新配色「瞬时」落地。原因：
 *   快照过渡的「旧快照」只能从 DOM 拍，而 DOM 在回调里已经改成目标色了，
 *   所以新的一段 dissolve 拍不到「当前混合到一半」的画面，硬做会先跳一下再淡一次，
 *   看起来像卡了一下。瞬时落地反而最像「立刻掉头」。
 *
 * @param {() => void} swap 真正改状态、改 DOM 的同步函数（由调用方保证幂等）
 */
export function performThemeSwap(swap) {
  // ① 打断上一次还没播完的过渡：立刻掐掉，本次瞬时落地（不等上一次淡完）
  if (skipInflight()) {
    withInstantStyles(swap)
    return
  }
  // ② 不支持 / 用户关了动画：退化为瞬时切换，功能不受影响
  if (!snapshotTransitionAllowed()) {
    withInstantStyles(swap)
    return
  }
  let ran = false
  const run = () => {
    if (ran) return
    ran = true
    withInstantStyles(swap)
  }
  try {
    const transition = document.startViewTransition(run)
    inflight = transition
    const clear = () => {
      if (inflight === transition) inflight = null
    }
    // 被后续切换打断（skipTransition）或快照失败都不影响最终状态：
    // swap 已在回调里同步执行完毕，DOM 只会落在正确的那一态。
    if (transition.finished && typeof transition.finished.then === 'function') {
      transition.finished.then(clear, clear)
    } else {
      clear()
    }
    if (transition.ready && typeof transition.ready.catch === 'function') {
      transition.ready.catch(() => {})
    }
    if (transition.updateCallbackDone && typeof transition.updateCallbackDone.catch === 'function') {
      // swap 内部若抛错，别留下未处理的 rejection
      transition.updateCallbackDone.catch(() => {})
    }
  } catch (err) {
    // 极端情况（并发调用、文档不可见等）：退化为无过渡切换
    inflight = null
    run()
  }
}
