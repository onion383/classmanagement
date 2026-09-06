import { createApp } from 'vue'
import DesktopWidget from './DesktopWidget.vue'
import axios from 'axios'
import '../styles/index.css'
import { setupSecureAxios } from '../composables/secureAxios'

// 桌面组件在桌面常驻，不依赖主窗口的登录态同步。
// 通过 IPC 从主进程获取当前 token（主窗口保存的），避免 cookie 跨域读取问题。
// 若主进程尚未返回 token，则退回到 localStorage 中读取（兼容开发模式）。
let tokenPromise = null

function getToken() {
  if (!tokenPromise) {
    tokenPromise = (async () => {
      try {
        if (window.electron && window.electron.invoke) {
          const t = await window.electron.invoke('get-main-token')
          if (t) return t
        }
      } catch (_) {}
      return localStorage.getItem('token')
    })()
  }
  return tokenPromise
}

// 请求拦截器：自动附加 Token
axios.interceptors.request.use(async config => {
  const token = await getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：网络错误自动退避重试
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

createApp(DesktopWidget).mount('#desktop-widget-app')