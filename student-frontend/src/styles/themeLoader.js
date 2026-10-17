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

// 空闲预热其余主题样式（正式版同样生效）：把当前主题/模式之外、尚未加载的 CSS 在后台
// 按「逐条 + 让出空闲」备好，避免用户切主题或切日/夜时才去下载+解析——那会有一瞬
// 落在基础主题上（applyTheme 先改 data-theme 再 import CSS）。逐条而非并发，避免与交互抢资源。
// 不设 timeout：纯等真空闲，绝不因兜底把解析插进忙碌期（宁可晚预热）。
// 预热只是注入文件，各规则有属性作用域限定，属性不匹配时不生效，故对当前画面零影响。
export function prefetchThemeStyles() {
  const keys = Object.keys(LOADERS).filter((key) => !cache.has(key))
  if (!keys.length) return
  const idle = (fn) => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn)
    else setTimeout(fn, 300)
  }
  let i = 0
  const next = () => {
    if (i >= keys.length) return
    const key = keys[i++]
    Promise.resolve()
      .then(() => once(key))
      .then(() => idle(next))
  }
  idle(next)
}
