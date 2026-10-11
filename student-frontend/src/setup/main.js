import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Setup from './Setup.vue'
// 复用全局主题变量（:root 默认值），使引导窗口与主界面配色一致
import '../styles/index.css'
import { useThemeStore } from '../stores/theme'
import { setupApiClient, backendBaseUrl } from '../utils/httpClient'

// 各窗口共用的 axios 装配：baseURL、登录态注入、后端重启期间的退避重试、安全通道加密。
// 引导页「改储存目录」会重启后端，期间的网络错误由拦截器等就绪后自动重试。
setupApiClient({ baseURL: backendBaseUrl() })

const app = createApp(Setup)
const pinia = createPinia()
app.use(pinia)

// 套用当前主题：默认「毛玻璃（glass）」，用户在引导内切换后即时生效。
// applyTheme 内的 theme-chrome 通知来自非主窗口，主进程会直接忽略（见 electron/main.js）。
useThemeStore(pinia).applyTheme()

// 挂载前等样式就绪：构建产物里的 CSS 已改为非阻塞加载（media="print" + onload 切回 all），
// 等它应用后再渲染，避免界面一闪无样式。dev 下样式由 Vite 用 JS 注入、没有 link 标签，立即完成；
// 2s 兜底避免极端情况把界面卡在未挂载状态。
Promise.all(
  [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => new Promise((resolve) => {
    if (l.sheet) return resolve()
    const done = () => resolve()
    l.addEventListener('load', done)
    l.addEventListener('error', done)
    setTimeout(done, 2000)
  }))
).then(() => app.mount('#setup-app'))