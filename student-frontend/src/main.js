import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/index.css'
import { loadThemeStyles } from './styles/themeLoader'
import { useThemeStore } from './stores/theme'
import { setupApiClient, backendBaseUrl } from './utils/httpClient'
import { ensureMediaToken, clearMediaToken } from './utils/apiUrl'
import { useNotification } from './composables/useNotification'
import { ensureDashboardData } from './composables/useDashboardData'
import { installInpProbe } from './utils/inpProbe'
import { SEND, INVOKE, RECEIVE } from './electronChannels.js'

// 401 提示条去重：记录最近一次已处理的 401 时间，避免同一瞬间并发 401 重复弹提示
let lastAuthPrompt = 0

// 运行期后端重连状态：主进程判定后端异常并开始重连时广播。
// 用于在重连期间禁用「写请求」的自动重试——重连意味着后端进程会被重启，
// 此时重发写请求，一旦原请求其实已经落库，就会产生重复数据（点名/成绩尤其敏感）。
// 只由运行期重连广播置位，启动阶段的等待重试不受影响。
let backendReconnecting = false
window.electron?.on?.(RECEIVE.FROM_MAIN, (msg) => {
  if (!msg) return
  if (msg.type === 'backend-reconnecting') backendReconnecting = !!msg.active
  else if (msg.type === 'backend-failed') backendReconnecting = !!msg.failed
})

// 统一装配 axios：baseURL、token 注入、401 处理、后端不可达探针与退避重试、安全通道加密。
// 主窗口在此注入三项专属行为：
//   - onAuthExpired：token 失效时清除过期 token、弹提示条并回到登录页（含时间戳去重）
//   - onUnreachable：请求失败即让主进程探测一次，把每次失败操作变成探针
//   - writeRetryGuard：主进程重连期间禁止写请求自动重发，避免重复落库
setupApiClient({
  baseURL: backendBaseUrl(),
  onAuthExpired: (error, config) => {
    const url = (config?.url || '')
    const isAuthReq = /(login|register|restore|recover)/i.test(url)
    if (!config?.__skipAuth && !isAuthReq && Date.now() - lastAuthPrompt > 2000) {
      lastAuthPrompt = Date.now()
      localStorage.removeItem('token')
      clearMediaToken()
      useNotification().error('登录已过期，请重新登录', 5000)
      if (router.currentRoute.value.path !== '/login') {
        router.push('/login')
      }
    }
  },
  onUnreachable: () => {
    // 没拿到任何响应 = 后端可能已不可达。让主进程立刻探测一次，不必等下一个心跳周期。
    window.electron?.invoke?.(INVOKE.PROBE_BACKEND).catch(() => {})
  },
  writeRetryGuard: (config) => {
    // 读请求本身幂等，重试没有副作用；只有写请求在重连期间不能自动重发
    if (!backendReconnecting) return true
    const m = (config?.method || 'get').toLowerCase()
    return m === 'get' || m === 'head'
  },
})

// 媒体凭据（<img>/CSS 用）：已有登录态时补一份/续期，避免首屏图片缺少受限凭据而 401。
// 与启动流程并行执行，不阻塞首屏渲染。
if (localStorage.getItem('token')) ensureMediaToken()

// ===== 关键路径优化：在 Vue 初始化之前就设置主题和预加载资源 =====

// 1. 立即设置主题 CSS 变量（不依赖 Pinia/Vue），防止 splash 到 Vue 渲染之间的闪烁
const THEME_KEY = 'app-theme'
const MODE_KEY = 'app-mode'
const CUSTOM_KEY = 'app-theme-custom'
const BG_IMAGE_KEY = 'app-bg-image'
const GLASS_KEY = 'app-glass-opacity'
const BG_MASK_KEY = 'app-bg-mask-opacity'
const savedTheme = localStorage.getItem(THEME_KEY) || 'glass'
document.documentElement.dataset.theme = savedTheme
// 全局日/夜模式：与主题同批在 Vue 初始化前落地，避免日→夜首帧闪烁
const savedMode = localStorage.getItem(MODE_KEY) === 'night' ? 'night' : 'day'
document.documentElement.dataset.mode = savedMode
// 按需加载当前主题/模式的样式：与其余启动逻辑并行开始；占位移除前会等它就绪（见 whenSplashReady），
// 避免出现「入口样式已应用、主题样式还没到」时闪一下基础主题配色。
const themeStylesReady = loadThemeStyles(savedTheme, savedMode)
// 应用自定义颜色
try {
  const custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}')
  Object.entries(custom).forEach(([key, value]) => {
    document.documentElement.style.setProperty(`--${key}`, value)
  })
} catch (_) {}
// 应用透明度
// 注意：这里不能用 `parseFloat(x) || 默认值` —— 滑块 min=0，0（完全透明）是合法值，
// 却会被 `||` 当成"没设置"而回退成默认值。必须用 Number.isFinite 判断。
const readNumSetting = (key, fallback) => {
  const v = parseFloat(localStorage.getItem(key))
  return Number.isFinite(v) ? v : fallback
}
const glassOpacity = readNumSetting(GLASS_KEY, 0.4)
const bgMaskOpacity = readNumSetting(BG_MASK_KEY, 0.6)
document.documentElement.style.setProperty('--glass-opacity', glassOpacity)
document.documentElement.style.setProperty('--bg-mask-opacity', bgMaskOpacity)
// 应用背景图：glass 用「自选图 ?? 内置默认图」，glass2（新毛玻璃）只用自选图
// —— 它自带的 CSS 光斑底已经提供了可模糊的内容，不需要再挂一张图片。
// glass 内置默认图日/夜各一张：夜间图本身是深色风景图，遮罩要更轻（bg-night-default）。
const DEFAULT_GLASS_BG = import.meta.env.PROD
  ? window.location.origin + '/glass-bg-opt.webp'
  : `${import.meta.env.BASE_URL}glass-bg-opt.webp`
const DEFAULT_GLASS_BG_NIGHT = import.meta.env.PROD
  ? window.location.origin + '/glass-bg-night.webp'
  : `${import.meta.env.BASE_URL}glass-bg-night.webp`
const customBg = localStorage.getItem(BG_IMAGE_KEY) || ''
const startupBgUrl = () => {
  if (customBg) return customBg
  if (savedTheme !== 'glass') return ''
  return savedMode === 'night' ? DEFAULT_GLASS_BG_NIGHT : DEFAULT_GLASS_BG
}
const startupBg = startupBgUrl()
// 仅「glass + 夜间 + 无自选图」时标记夜间内置底图，供 theme-night.css 配更轻遮罩
document.documentElement.classList.toggle(
  'bg-night-default',
  !customBg && savedTheme === 'glass' && savedMode === 'night'
)
console.log('[startup] 背景图 URL:', startupBg)
if (startupBg) {
  document.documentElement.style.setProperty('--bg-image', `url('${startupBg.replace(/'/g, "\\'")}')`)
  document.documentElement.classList.add('has-bg-image')
}

// 2. 预加载背景图到浏览器缓存（<link rel="preload"> 在 HTML 阶段已开始，此处再确保一次）
if (startupBg) { const img = new Image(); img.src = startupBg }

// 3. 预加载默认落地页组件（已登录→业务首页 DashboardView；未登录→登录页 Login），
//    与 Vue 初始化并行执行，命中路由实际首帧，避免首屏首帧多等一次 chunk 下载。
//    必须用静态字符串导入，保证 Vite/Rollup 能静态分析生成对应 chunk。
const landingPreload = localStorage.getItem('token')
  ? import('./views/DashboardView.vue')
  : import('./views/Login.vue')
landingPreload.catch(() => {})

// ===== Vue 应用初始化 =====
const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

// 全局注册 IconGlyph：页面主标题图标跟随「图标样式」设置（彩色 lucide / emoji）
import IconGlyph from './components/base/IconGlyph.vue'
app.component('IconGlyph', IconGlyph)

// 用 Pinia 的 themeStore 与 localStorage 同步（仅覆盖变量，不重复设置背景图）
const themeStore = useThemeStore()
themeStore.applyTheme()

// 记录 Vue 挂载耗时（主进程通过 console-message 事件捕获 [startup] 前缀的日志）
// 全局橡皮筋滚动（轻回弹）+ 松手惯性滑行：暂时整体停用，全部恢复原生滚动。
// 恢复时取消下面两行注释即可（橡皮筋本身还需按 useElasticScroll.js 里的标记一并取消注释）
// import { startElasticScroll } from './composables/useElasticScroll'
// startElasticScroll()

// 弹窗遮罩点击脉冲（事件委托）：点遮罩本尊时卡片轻放大收回提示，点卡片内部不触发
import { initDialogOverlayPulse } from './utils/dialogOverlayPulse'
initDialogOverlayPulse()

// INP 归因探针：仅开发模式安装。`import.meta.env.DEV` 在打包版被静态替换为 false，
// 该调用连同上方 import 一起被摇树删除——正式版既无探针代码也无可观察开销。
if (import.meta.env.DEV) installInpProbe()

// 原生右键菜单：页面未自行处理右键（模板里没 .prevent）时，交给主进程弹系统菜单。
// 用 defaultPrevented 判定——表格/课堂/收费等已有自定义右键菜单的区域是 .stop.prevent，
// 事件已被拦截或标记为已处理，这里不会再弹一次。
window.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return
  const el = e.target
  const tag = el && el.tagName ? el.tagName.toLowerCase() : ''
  const isEditable = !!(el && (el.isContentEditable || tag === 'input' || tag === 'textarea'))
  const sel = window.getSelection ? window.getSelection() : null
  const hasSelection = !!(sel && sel.toString().trim())
  const anchor = el && el.closest ? el.closest('a[href]') : null
  const linkURL = anchor ? anchor.href : ''
  if (!isEditable && !hasSelection && !linkURL) return
  e.preventDefault()
  window.electron?.send(SEND.SHOW_NATIVE_CONTEXT_MENU, {
    isEditable,
    readOnly: !!(el && (el.readOnly === true || el.disabled === true)),
    hasSelection,
    linkURL,
  })
})

// 弹窗懒加载预取指令（v-preload）：悬停触发按钮时提前加载对应弹窗 chunk
import { vPreload } from './utils/dialogPrefetch'
app.directive('preload', vPreload)

// ===== 全局错误兜底 =====
// 目的：组件渲染、生命周期钩子、路由守卫里漏掉的异常，用户至少能看到一次提示，
// 控制台留下全量现场。这是「只覆盖常见用户路径」的前提——没有这层，漏掉的路径就是静默失效：
// 界面毫无反应，用户以为点错了，实际上后台已经报错。
//
// 为什么 unhandledrejection 只记日志、不弹提示：项目里有 91 处 fire-and-forget 的 `.catch(() => {})`
// （删临时文件、POST logout、打开外部链接），那里失败是常态而不是异常。
// 全局弹窗会变成噪音，反而把真正的错误淹没掉。
let lastVueErrorToast = 0
app.config.errorHandler = (err, instance, info) => {
  console.error('[vue-error]', info, err)
  // 渲染期错误可能在同一个 tick 内连发（同一份坏数据驱动多个组件重渲染）：
  // 2 秒内只提示一次，避免刷屏。同文案的合并由 useNotification 自身去重兜住。
  const now = Date.now()
  if (now - lastVueErrorToast > 2000) {
    lastVueErrorToast = now
    try {
      useNotification().error(`操作失败：${(err && err.message) || err}`)
    } catch (_) {
      // best-effort: 通知系统自身不可用时不能再抛，否则错误边界循环报错
    }
  }
}

window.addEventListener('unhandledrejection', (e) => {
  // 只记录，不 preventDefault：保留原始的「未处理」状态，便于开发者工具里定位。
  console.error('[unhandled-rejection]', e.reason)
})

const mountStart = performance.now()
// 首屏占位保活：Vue 挂载会清空 #app，但此刻首次导航往往还没完成（$route.path 仍是 '/'），
// App 会先渲染出「标题栏 + 侧边栏 + 空内容区」的外壳。这里把 index.html 的占位节点移到
// body 顶层继续盖住窗口，等首屏内容真正就绪后再整体移除，全程不出现「空壳界面」。
const splashEl = document.querySelector('#app .app-splash')
if (splashEl) {
  splashEl.style.zIndex = '2147483000'
  document.body.appendChild(splashEl)
}

app.mount('#app')
console.log(`[startup] Vue 挂载完成: ${Math.round(performance.now() - mountStart)}ms`)

// 样式就绪：构建产物里的 CSS 已改为非阻塞加载（media="print" + onload 切回 all），
// 移除占位前必须先确认它已应用，否则会露出一瞬间无样式界面。
// dev 下样式由 Vite 用 JS 注入、没有 link 标签，此等待立即完成。
const whenStylesReady = () => Promise.all(
  [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => new Promise((resolve) => {
    if (l.sheet) return resolve()
    const done = () => resolve()
    l.addEventListener('load', done)
    l.addEventListener('error', done)
    setTimeout(done, 2000)
  }))
)

if (splashEl) {
  let dropped = false
  let backendFailed = false
  let backendOk = false
  let splashReady = false
  // 乐观退出开关（可回退）：
  //   true  = 不再等 main 的 backend-ready 信号：样式 + 路由就绪即移除占位页。后端稍后才起时，
  //           首屏那批请求由 axios 响应拦截器等到 backend-ready 后自动重试（isBackendUnreachable 分支），
  //           等待期间由首页骨架屏顶着——这段等待从「整窗被占位页挡住」变成「只挡住内容区」。
  //           占位页此时已不在，启动失败提示改由 App.vue 的 backend-overlay 承载。
  //   false = 旧方案：后端就绪后才允许移除（占位页兼作启动失败提示的载体）。当前取 false。
  const SPLASH_EXIT_BEFORE_BACKEND = false
  const dropSplash = () => {
    if (dropped || !splashEl.isConnected) return
    // 占位页同时是启动失败提示的载体：已失败时必须保留，否则失败提示没有落脚处
    // （该情形下改由 App.vue 的 backend-overlay 兜住）。后端尚未就绪是否放行见上方开关。
    if (backendFailed) return
    if (!backendOk && !SPLASH_EXIT_BEFORE_BACKEND) return
    dropped = true
    // 硬切：等路由组件真正绘制完成后直接移除占位，不做透明度过渡。
    // 过渡会让占位文案与下方页面同时可见（「层叠」观感），硬切则是一帧换一帧。
    // 只等一帧：DOM 早已被 Vue 渲染队列刷完（微任务），这一帧的绘制会把「移除占位」与
    // 「首屏内容」合并进同一帧，观感仍是硬切；多等第二帧只是白等一次帧边界——
    // 毛玻璃首次 raster 卡顿时，一次帧边界实测可达 ~180ms。
    requestAnimationFrame(() => {
      if (!splashEl.isConnected) return
      splashEl.remove()
      // 打点「界面真正可见」：占位移除的下一帧就是应用首屏被绘制的时刻。
      // 主进程的启动时间线会捕获这条（见 electron/main.js 的 console-message 监听）。
      // 尾部 @<epoch 毫秒> 是渲染层自报的事件时刻：主进程按它打点，剔除跨进程投递延迟。
      // performance.timeOrigin 为文档导航开始的 epoch 毫秒数，与主进程 Date.now() 同一把钟。
      console.log(`[startup] 占位页移除（界面可见） @${Math.round(performance.timeOrigin + performance.now())}`)
      // 广播给 App.vue：此刻才回报「小组件就绪」，避免主进程建窗的同步开销压在启动关键路径上。
      window.dispatchEvent(new Event('app-visible'))
    })
  }

  // ===== 启动失败兜底 =====
  // 后端长时间起不来（看门狗超时）或自动重启用尽时，主进程广播 from-main{type:'backend-failed'}；
  // 晚于失败才加载的窗口用 backend-failure 查询兜住竞态。给出「重启后端 / 退出应用」两条出路，
  // 避免用户被永久卡在「加载中」而没有任何自救手段。
  const tipEl = splashEl.querySelector('.tip')

  const buildFailBox = () => {
    const box = document.createElement('div')
    box.className = 'fail-box'
    const msg = document.createElement('div')
    msg.className = 'fail-msg'
    msg.textContent = '后台启动失败，请点击下面按钮重试或退出应用重试'
    const row = document.createElement('div')
    row.className = 'fail-row'
    const retryBtn = document.createElement('button')
    retryBtn.className = 'fail-btn primary'
    retryBtn.textContent = '重启后端'
    const quitBtn = document.createElement('button')
    quitBtn.className = 'fail-btn'
    quitBtn.textContent = '退出应用'
    retryBtn.onclick = async () => {
      retryBtn.disabled = true
      quitBtn.disabled = true
      retryBtn.textContent = '重启中…'
      try { await window.electron?.invoke(INVOKE.RESTART_BACKEND) } catch (_) {}
      // 后端已重新 fork：整页重载重走一遍启动流程（若仍起不来会再次显示本提示）
      setTimeout(() => location.reload(), 400)
    }
    quitBtn.onclick = () => window.electron?.send(SEND.QUIT_APP)
    row.appendChild(retryBtn)
    row.appendChild(quitBtn)
    box.appendChild(msg)
    box.appendChild(row)
    return box
  }

  const setBackendFailed = (failed) => {
    backendFailed = !!failed
    if (!splashEl.isConnected) return
    // 失败态把转圈图标换成蓝色感叹号三角（与运行期异常页同一套观感）
    splashEl.classList.toggle('is-failed', backendFailed)
    const box = splashEl.querySelector('.fail-box')
    if (backendFailed) {
      if (box) return
      if (tipEl) tipEl.style.display = 'none'
      splashEl.appendChild(buildFailBox())
    } else {
      if (box) box.remove()
      if (tipEl) tipEl.style.display = ''
      // 后端恢复后：若首屏早已就绪，补一次占位移除
      if (splashReady) dropSplash()
    }
  }

  const markBackendOk = () => {
    if (backendOk) return
    backendOk = true
    if (splashReady) dropSplash()
  }

  window.electron?.on(RECEIVE.FROM_MAIN, (msg) => {
    if (!msg) return
    if (msg.type === 'backend-ready') markBackendOk()
    else if (msg.type === 'backend-failed') setBackendFailed(msg.failed)
  })
  // 兜住「先就绪/先失败、后加载」的竞态
  window.electron?.invoke(INVOKE.BACKEND_STATUS).then((ok) => { if (ok) markBackendOk() }).catch(() => {})
  window.electron?.invoke(INVOKE.BACKEND_FAILURE).then((f) => { if (f) setBackendFailed(true) }).catch(() => {})

  // 骨架屏方案开关（可回退）：
  //   true  = 只在首页(Dashboard)做骨架屏。占位页不再等首页数据，首次导航一就绪即移除，
  //           「数据还在路上」这段等待改由首页自身的骨架屏承接；其余页面照常直接渲染。
  //   false = 旧方案：占位页一直等到首页 9 个接口返回后才移除（整窗被多挡一段接口往返）。当前取 false。
  // 回退方式：把常量改回 true 即可（新分支代码原样保留）。
  const HOME_SKELETON_ONLY = false

  // 首屏内容就绪 = 首次导航完成 + 样式已应用 + （旧方案下，落地业务首页时）首页数据已到。
  // 新方案只等路由与样式：首页数据不再阻塞占位移除，未到的部分由 DashboardView 骨架屏先顶上，
  // 避免占位页长时间挡在整窗前。ensureDashboardData 各请求均有 .catch() 兜底，不会永久卡住。
  const whenSplashReady = router.isReady().catch(() => {}).then(() => {
    const onHome = router.currentRoute.value.path === '/' && localStorage.getItem('token')
    const dataReady = (onHome && !HOME_SKELETON_ONLY)
      ? Promise.race([ensureDashboardData().catch(() => {}), new Promise((r) => setTimeout(r, 2000))])
      : Promise.resolve()
    return Promise.all([whenStylesReady(), dataReady, themeStylesReady])
  })

  whenSplashReady.then(() => { splashReady = true; dropSplash() })
  // 兜底：路由守卫抛错/卡住时也移除，避免界面被永久挡在占位页后面。
  setTimeout(dropSplash, 5000)
} else {
  // 没有占位页的窗口（理论上不会发生）：直接广播，否则小组件要等 App 里的兜底计时才建
  window.dispatchEvent(new Event('app-visible'))
}

