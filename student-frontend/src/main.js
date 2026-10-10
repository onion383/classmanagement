import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import axios from 'axios'   // 必须导入
import './styles/index.css'
import { useThemeStore } from './stores/theme'
import { setupSecureAxios } from './composables/secureAxios'
import { useNotification } from './composables/useNotification'
import { waitForBackendReady } from './utils/backendReady'
import { ensureDashboardData } from './composables/useDashboardData'

// 生产模式（file:// 协议）下无 Vite 代理，需指定完整后端地址
if (import.meta.env.PROD) {
  axios.defaults.baseURL = 'http://localhost:3000'
}

// 请求拦截器
axios.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 401 提示条去重：记录最近一次已处理的 401 时间，避免同一瞬间并发 401 重复弹提示
let lastAuthPrompt = 0

// 运行期后端重连状态：主进程判定后端异常并开始重连时广播。
// 用于在重连期间禁用「写请求」的自动重试——重连意味着后端进程会被重启，
// 此时重发写请求，一旦原请求其实已经落库，就会产生重复数据（点名/成绩尤其敏感）。
// 只由运行期重连广播置位，启动阶段的等待重试不受影响。
let backendReconnecting = false
window.electron?.on?.('from-main', (msg) => {
  if (!msg) return
  if (msg.type === 'backend-reconnecting') backendReconnecting = !!msg.active
  else if (msg.type === 'backend-failed') backendReconnecting = !!msg.failed
})

// 读请求本身幂等，重试没有副作用；只有写请求在重连期间不能自动重发
const isWriteRequest = (config) => {
  const m = (config?.method || 'get').toLowerCase()
  return m !== 'get' && m !== 'head'
}

// 响应拦截器：主窗口先于后端启动时，首屏请求可能遇到「连接被拒」等网络错误
// （此时 error.response 为 undefined）。等待后端就绪信号（backend-ready）后再重试：
// 后端一就绪立即重试，不再盲等固定退避；信号缺失时退化为原先的退避等待。
// 有 HTTP 响应（4xx/5xx）的错误不重试，避免重复提交等副作用。
axios.interceptors.response.use(
  res => res,
  async (error) => {
    const config = error.config

    // token 失效（401，且非登录/注册/恢复等自身接口）：清除过期 token、
    // 弹出提示条并回到登录页。用时间戳锁去重：同一瞬间多个并发 401 只处理一次，
    // 但几秒后的再次过期仍能重新触发。
    if (error.response && error.response.status === 401) {
      const url = (config?.url || '')
      const isAuthReq = /(login|register|restore|recover)/i.test(url)
      if (!config?.__skipAuth && !isAuthReq && Date.now() - lastAuthPrompt > 2000) {
        lastAuthPrompt = Date.now()
        localStorage.removeItem('token')
        useNotification().error('登录已过期，请重新登录', 5000)
        if (router.currentRoute.value.path !== '/login') {
          router.push('/login')
        }
      }
    }

    // 主动取消的请求不是故障，既不探测也不重试
    if (error.code === 'ERR_CANCELED') return Promise.reject(error)

    if (!error.response && config) {
      // 没拿到任何响应 = 后端可能已不可达。让主进程立刻探测一次，
      // 把用户的每一次失败操作变成探针，不必等下一个心跳周期。
      if (!config.__probed) {
        config.__probed = true
        window.electron?.invoke?.('probe-backend').catch(() => {})
      }

      // 重连期间：写请求不自动重发，把失败直接交给调用方提示用户手动重试
      if (backendReconnecting && isWriteRequest(config)) {
        return Promise.reject(error)
      }

      const retryCount = config.__retryCount || 0
      if (retryCount < 6) {
        config.__retryCount = retryCount + 1
        await waitForBackendReady(200 * config.__retryCount)
        return axios(config)
      }
    }
    return Promise.reject(error)
  }
)

// 安全通道：请求体加密 + 响应体解密（仅 JSON API；无开关时直通）
setupSecureAxios(axios)

// ===== 关键路径优化：在 Vue 初始化之前就设置主题和预加载资源 =====

// 1. 立即设置主题 CSS 变量（不依赖 Pinia/Vue），防止 splash 到 Vue 渲染之间的闪烁
const THEME_KEY = 'app-theme'
const CUSTOM_KEY = 'app-theme-custom'
const BG_IMAGE_KEY = 'app-bg-image'
const GLASS_KEY = 'app-glass-opacity'
const BG_MASK_KEY = 'app-bg-mask-opacity'
const savedTheme = localStorage.getItem(THEME_KEY) || 'glass'
document.documentElement.dataset.theme = savedTheme
// 应用自定义颜色
try {
  const custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}')
  Object.entries(custom).forEach(([key, value]) => {
    document.documentElement.style.setProperty(`--${key}`, value)
  })
} catch (_) {}
// 应用透明度
const glassOpacity = parseFloat(localStorage.getItem(GLASS_KEY)) || 0.4
const bgMaskOpacity = parseFloat(localStorage.getItem(BG_MASK_KEY)) || 0.6
document.documentElement.style.setProperty('--glass-opacity', glassOpacity)
document.documentElement.style.setProperty('--bg-mask-opacity', bgMaskOpacity)
// 应用背景图：glass 用「自选图 ?? 内置默认图」，glass2（新毛玻璃）只用自选图
// —— 它自带的 CSS 光斑底已经提供了可模糊的内容，不需要再挂一张图片。
const DEFAULT_GLASS_BG = import.meta.env.PROD
  ? window.location.origin + '/glass-bg-opt.jpg'
  : `${import.meta.env.BASE_URL}glass-bg-opt.jpg`
const startupBgUrl = () => {
  if (savedTheme !== 'glass' && savedTheme !== 'glass2') return ''
  return localStorage.getItem(BG_IMAGE_KEY) || (savedTheme === 'glass' ? DEFAULT_GLASS_BG : '')
}
const startupBg = startupBgUrl()
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

// 弹窗懒加载预取指令（v-preload）：悬停触发按钮时提前加载对应弹窗 chunk
import { vPreload } from './utils/dialogPrefetch'
app.directive('preload', vPreload)

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
  const dropSplash = () => {
    if (dropped || !splashEl.isConnected) return
    // 占位页同时是启动失败提示的载体：后端未就绪（可能稍后失败）或已失败时都必须保留，
    // 否则失败提示没有落脚处。只有后端确实就绪后才允许移除占位。
    if (backendFailed || !backendOk) return
    dropped = true
    // 硬切：等路由组件真正绘制完成后直接移除占位，不做透明度过渡。
    // 过渡会让占位文案与下方页面同时可见（「层叠」观感），硬切则是一帧换一帧。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (splashEl.isConnected) splashEl.remove()
    }))
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
      try { await window.electron?.invoke('restart-backend') } catch (_) {}
      // 后端已重新 fork：整页重载重走一遍启动流程（若仍起不来会再次显示本提示）
      setTimeout(() => location.reload(), 400)
    }
    quitBtn.onclick = () => window.electron?.send('quit-app')
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

  window.electron?.on('from-main', (msg) => {
    if (!msg) return
    if (msg.type === 'backend-ready') markBackendOk()
    else if (msg.type === 'backend-failed') setBackendFailed(msg.failed)
  })
  // 兜住「先就绪/先失败、后加载」的竞态
  window.electron?.invoke('backend-status').then((ok) => { if (ok) markBackendOk() }).catch(() => {})
  window.electron?.invoke('backend-failure').then((f) => { if (f) setBackendFailed(true) }).catch(() => {})

  // 首屏内容就绪 = 首次导航完成 + 样式已应用 + （落地业务首页时）首页数据已到。
  // 只等 router.isReady() 会早于首页 9 个接口返回，导致占位先消失、页面还在填充，
  // 所以这里把首页数据也纳入等待。ensureDashboardData 内部各请求均有 .catch() 兜底，
  // Promise 必定 resolve，不会把占位永久卡住；仍加 2s 上限，避免后端异常时干等。
  const whenSplashReady = router.isReady().catch(() => {}).then(() => {
    const onHome = router.currentRoute.value.path === '/' && localStorage.getItem('token')
    const dataReady = onHome
      ? Promise.race([ensureDashboardData().catch(() => {}), new Promise((r) => setTimeout(r, 2000))])
      : Promise.resolve()
    return Promise.all([whenStylesReady(), dataReady])
  })

  whenSplashReady.then(() => { splashReady = true; dropSplash() })
  // 兜底：路由守卫抛错/卡住时也移除，避免界面被永久挡在占位页后面。
  setTimeout(dropSplash, 5000)
}

