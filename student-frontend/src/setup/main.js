import { createApp } from 'vue'
import { createPinia } from 'pinia'
import axios from 'axios'
import Setup from './Setup.vue'
// 复用全局主题变量（:root 默认值），使引导窗口与主界面配色一致
import '../styles/index.css'
import { useThemeStore } from '../stores/theme'
import { setupSecureAxios } from '../composables/secureAxios'
import { waitForBackendReady } from '../utils/backendReady'

// 生产模式（app:// 协议）下无 Vite 代理，需指定完整后端地址；开发模式走 Vite 代理
if (import.meta.env.PROD) {
  axios.defaults.baseURL = 'http://localhost:3000'
}
// 带登录态：注册成功后 token 写入 localStorage，后续班级信息接口据此鉴权
axios.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
// 响应拦截器：引导页「改储存目录」会重启后端，期间请求会命中「连接被拒」网络错误。
// 这类错误不立即失败，而是等后端就绪信号（backend-ready）后再重试；信号缺失时退化为退避等待。
// 有 HTTP 响应（4xx/5xx）的错误不重试，避免重复提交等副作用。
axios.interceptors.response.use(
  res => res,
  async (error) => {
    const config = error.config
    if (!error.response && config) {
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
// 安全通道：与主窗口一致的请求体加密 / 响应解密（无开关时直通）
setupSecureAxios(axios)

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