// 主题样式按需加载：只加载「当前主题 + 当前日/夜模式」对应的 CSS，其余主题/夜间的样式不参与首屏。
//
// 为什么可以按需：各主题 CSS 全部以属性选择器限定作用域
//   （主题 = :root[data-theme="..."] / :root:is([data-theme="glass"], [data-theme="win11"])，
//     夜间 = :root[data-mode="night"]...），属性不匹配时文件里的规则本就不生效。
// 因此「只加载当前主题」与「全部加载」视觉等价，只是省掉了未用主题的下载与解析。
//
// 实现：Vite 会把每个动态 import 的 CSS 拆成独立 chunk，运行时按需注入 <link>。
// 未使用的主题（如默认玻璃主题下的 glass2 / minimal / win11 / 夜间层）不会被打进首屏样式。

// 每个主题需要的 CSS 文件（按加载顺序）。
// base 只用入口样式里的 theme-base.css，无需额外文件；自定义主题走 JS 变量，也无需文件。
const THEME_MODULES = {
  glass: ['theme-glass'],
  // win11 复用 glass 的变量块（theme-glass.css 的变量作用域含 win11），故两个文件一起加载
  win11: ['theme-glass', 'theme-win11'],
  glass2: ['theme-glass2'],
  minimal: ['theme-minimal'],
}
// 仅 glass / glass2 实现了夜间配色（见 theme-night.css 与 stores/theme.js 的 NIGHT_THEMES）
const NIGHT_THEMES = ['glass', 'glass2']

const LOADERS = {
  'theme-glass': () => import('./theme-glass.css'),
  'theme-win11': () => import('./theme-win11.css'),
  'theme-glass2': () => import('./theme-glass2.css'),
  'theme-minimal': () => import('./theme-minimal.css'),
  'theme-night': () => import('./theme-night.css'),
}

// 缓存的是「加载 Promise」而非布尔：并发/重复调用共享同一次加载，都能正确等到完成。
const cache = new Map()
function once(key) {
  if (cache.has(key)) return cache.get(key)
  const p = LOADERS[key]().catch((err) => {
    // 失败不阻塞启动：移除缓存以便下次切换主题时重试；缺这份样式最多退化为基础主题外观。
    cache.delete(key)
    console.warn('[themeStyles] 样式加载失败:', key, err)
  })
  cache.set(key, p)
  return p
}

// 加载当前主题 + 当前模式所需的样式，返回 Promise（调用方 await 它可确保渲染前样式已就绪）。
export function loadThemeStyles(theme, mode) {
  const keys = [...(THEME_MODULES[theme] || [])]
  if (mode === 'night' && NIGHT_THEMES.includes(theme)) keys.push('theme-night')
  return Promise.all(keys.map(once))
}

// =========================================================================
// 夜间模式的「样式预热」——解决首次切换日/夜时的明显卡顿
// =========================================================================
//
// 问题（实测，2026-10-20，Electron 37 / GPU 加速，基准见 student-frontend/mode-bench.html）：
//   首次把 data-mode 从 day 改成 night → 约 200~280ms，期间有一个 180ms+ 的主线程长任务；
//   之后每次切换只要 15~25ms。差了十几倍。
//
// 原因：theme-night.css 里的 176 条规则全部以 :root[data-mode="night"] 限定作用域。
//   data-mode 挂在 <html> 上，是整棵 DOM 的祖先属性。属性一变，浏览器要：
//     ① 重新匹配所有以该属性为条件的规则；
//     ② 为每个受影响元素重建 ComputedStyle（首轮还要把这些规则编译进内部表示）。
//   这一步是「首次」才付的，之后内部表示与样式缓存都热了，故很快。
//   注意：这不是背景图解码（预热图片只值 25~50ms），也不是毛玻璃重采样
//   （关掉全部 backdrop-filter 后耗时几乎不变）。
//
// 做法：空闲期里偷偷把 data-mode 切到 night、再切回 day，各渲染一帧。
//   目的只是「让浏览器把夜间规则编译/匹配过一遍」，把那份一次性成本挪到空闲期，
//   用户第一次点切换时就只剩 15~25ms。实测首次切换 237ms → 13ms，且不再产生长任务。
//
// 安全性：
//   ① 预热期间用户若在看屏幕，会看到一闪而过。规避办法见下（预热放在首屏之后、
//      且整段包在「不可见」状态下完成 —— 具体见 warmNightMode）。
//   ② 预热会改 documentElement.dataset.mode，必须严格切回原值，否则会把用户界面切成夜间。
//   ③ 预热只对实现了夜间配色的主题有意义（glass / glass2），其余主题夜间规则本就为空。
//   ④ 预热必须等夜间 CSS 加载完（否则规则还没到，匹配不到等于没预热）。

// 已预热过的主题集合：按主题分别记录。
// 用 Set 而非单个布尔量：night 规则虽在同一份 theme-night.css 里，但按 data-theme 分成了
// glass / glass2 两批选择器。用户在 base 主题下启动、之后才切到 glass 时，glass 那批规则
// 同样需要「首次匹配」一次，故要能对每个主题各预热一次。
const warmedThemes = new Set()

// =========================================================================
// 总开关：是否做「空闲期预热」
// -------------------------------------------------------------------------
// 现状（2026-10-20，用户反馈后关闭）：默认关闭。
//
// 关闭原因：预热会在空闲时把整页「日 → 夜 → 日」跑一遍。理论上用 body{visibility:hidden}
// 藏住就不会被看到，但仍有可见的视觉异常 —— 切换主题时能感到画面有一次不必要的闪动/
// 底色跳变。视觉上不划算，故整体停用。
//
// 保留下面全部实现而只是关掉开关，是为了日后若要恢复（换个不闪的手段做预热）时不必重写。
// 预热的收益与代价详见下方 warmNightMode 的注释。
const NIGHT_WARM_ENABLED = false

// 导出给调用方（App.vue / stores/theme.js）判断：开关关闭时连空闲回调都不用排。
export function isNightWarmEnabled() {
  return NIGHT_WARM_ENABLED
}

/**
 * 预热夜间模式：让「首次切换日/夜」的那次性样式编译成本挪到空闲期发生。
 *
 * @param {string} theme 当前主题
 * @param {string} mode 当前模式（'day' | 'night'）
 * @returns {Promise<void>} 预热完成（或跳过）后 resolve
 */
export function warmNightMode(theme, mode) {
  // ⓪ 总开关关闭时直接返回：连夜间 CSS 都不加载、页面一动不动。
  if (!NIGHT_WARM_ENABLED) return Promise.resolve()
  // ① 当前已是夜间：夜间规则本来就在生效，无需预热（省掉一次无谓的闪动）
  if (mode === 'night') return Promise.resolve()
  // ② 只有实现了夜间配色的主题才有夜间规则可预热
  if (!NIGHT_THEMES.includes(theme)) return Promise.resolve()
  // ③ 该主题已预热过就不重复做
  if (warmedThemes.has(theme)) return Promise.resolve()
  warmedThemes.add(theme)

  const root = document.documentElement
  const bodyEl = document.body
  // ④ 记录原值。预热结束后必须切回，否则会把用户界面留在夜间。
  const prevMode = root.dataset.mode
  const prevNightDefault = root.classList.contains('bg-night-default')
  // ⑤ 预热期间把整页藏起来：否则用户会看到「日→夜→日」闪一下。
  //    visibility:hidden 只跳过绘制，浏览器仍会做样式重算 —— 而我们正是要预热这部分成本。
  //    （项目内没有元素显式设 visibility:visible，故整页都会被藏住。）
  const prevVisibility = bodyEl.style.visibility

  // 恢复原状。若预热期间用户自己切了模式（root.dataset.mode 已不是我们设的 'night'），
  // 说明用户表达了意图，此时不覆盖，交给 applyTheme 的结果。
  const restore = () => {
    if (root.dataset.mode === 'night') {
      root.dataset.mode = prevMode
      if (prevNightDefault) root.classList.add('bg-night-default')
      else root.classList.remove('bg-night-default')
    }
    bodyEl.style.visibility = prevVisibility
  }

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

  // ⑥ 夜间 CSS 必须先到位，否则匹配不到规则 = 白预热
  return loadThemeStyles(theme, 'night')
    .then(nextFrame)
    .then(() => {
      bodyEl.style.visibility = 'hidden'
      // 切到夜间：这一帧浏览器会匹配并编译全部夜间规则（就是我们要预热的那份成本）
      root.dataset.mode = 'night'
      root.classList.add('bg-night-default')
      return nextFrame()
    })
    .then(() => {
      restore()
      return nextFrame()
    })
    .catch((err) => {
      // 预热失败不能影响正常使用：静默恢复原状即可
      try { restore() } catch (_) {}
      console.warn('[themeStyles] 夜间模式预热失败:', err?.message || err)
    })
}

// 空闲预热其余主题样式（正式版同样生效）：把当前主题/模式之外、尚未加载的 CSS 在后台
// 按「逐条 + 让出空闲」备好，避免用户切主题或切日/夜时才去下载+解析——那会有一瞬
// 落在基础主题上（applyTheme 先改 data-theme 再 import CSS）。逐条而非并发，避免与交互抢资源。
// 不设 timeout：纯等真空闲，绝不因兜底把解析插进忙碌期（宁可晚预热）。
// 预热只是注入文件，各规则有属性作用域限定，属性不匹配时不生效，故对当前画面零影响。
export function prefetchThemeStyles() {
  const keys = Object.keys(LOADERS).filter((key) => !cache.has(key))
  if (!keys.length) return
  let i = 0
  const next = () => {
    if (i >= keys.length) return
    const key = keys[i++]
    Promise.resolve()
      .then(() => once(key))
      .then(() => window.requestIdleCallback(next))
  }
  window.requestIdleCallback(next)
}
