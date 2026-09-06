import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import axios from 'axios'   // 必须导入
import './styles/index.css'
import { useThemeStore } from './stores/theme'
import { setupSecureAxios } from './composables/secureAxios'

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

// 响应拦截器：主窗口先于后端启动时，首屏请求可能遇到「连接被拒」等网络错误
// （此时 error.response 为 undefined）。自动退避重试，等后端就绪，避免白屏/报错。
// 有 HTTP 响应（4xx/5xx）的错误不重试，避免重复提交等副作用。
axios.interceptors.response.use(
  res => res,
  async (error) => {
    const config = error.config
    if (!error.response && config) {
      const retryCount = config.__retryCount || 0
      if (retryCount < 6) {
        config.__retryCount = retryCount + 1
        await new Promise(r => setTimeout(r, 500 * config.__retryCount))
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
const glassOpacity = parseFloat(localStorage.getItem(GLASS_KEY)) || 0.5
const bgMaskOpacity = parseFloat(localStorage.getItem(BG_MASK_KEY)) || 0.65
document.documentElement.style.setProperty('--glass-opacity', glassOpacity)
document.documentElement.style.setProperty('--bg-mask-opacity', bgMaskOpacity)
// 应用背景图（毛玻璃主题默认使用内置背景）
if (savedTheme === 'glass') {
  const bg = localStorage.getItem(BG_IMAGE_KEY) || (import.meta.env.PROD ? window.location.origin + '/glass-bg-opt.jpg' : `${import.meta.env.BASE_URL}glass-bg-opt.jpg`)
  console.log('[startup] 背景图 URL:', bg)
  if (bg) {
    document.documentElement.style.setProperty('--bg-image', `url('${bg.replace(/'/g, "\\'")}')`)
    document.documentElement.classList.add('has-bg-image')
  }
}

// 2. 预加载背景图到浏览器缓存（<link rel="preload"> 在 HTML 阶段已开始，此处再确保一次）
if (savedTheme === 'glass') {
  const bg = localStorage.getItem(BG_IMAGE_KEY) || (import.meta.env.PROD ? window.location.origin + '/glass-bg-opt.jpg' : `${import.meta.env.BASE_URL}glass-bg-opt.jpg`)
  if (bg) { const img = new Image(); img.src = bg }
}

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
// 全局橡皮筋滚动（轻回弹）：正常滚动保持原生，仅滚到顶/底越界时才弹性回弹
import { startElasticScroll } from './composables/useElasticScroll'
startElasticScroll()

const mountStart = performance.now()
app.mount('#app')
console.log(`[startup] Vue 挂载完成: ${Math.round(performance.now() - mountStart)}ms`)

