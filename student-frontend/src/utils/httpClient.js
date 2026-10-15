import axios from 'axios'
import { setupSecureAxios } from '../composables/secureAxios'
import { waitForBackendReady, isBackendUnreachable } from './backendReady'

// 各窗口入口（主窗口 / 引导窗口 / 悬浮组件 / 桌面组件）共用同一套 axios 装配：
// baseURL、登录态注入、后端未就绪时的退避重试、安全通道加密。
// 差异只在两点：是否需要设置 baseURL，以及 token 的获取方式（桌面组件经 IPC 异步取）。
export function setupApiClient({ baseURL, getToken = () => localStorage.getItem('token') } = {}) {
  if (baseURL) axios.defaults.baseURL = baseURL

  // 请求拦截器：自动附加登录 Token
  axios.interceptors.request.use(async (config) => {
    const token = await getToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  // 响应拦截器：后端稍慢于窗口（或引导页「改储存目录」重启后端）时，首屏请求可能遇到
  // 「连接被拒」网络错误。这类错误不立即失败，而是等后端就绪信号后再重试；
  // 有 HTTP 响应（4xx/5xx）的错误不重试，避免重复提交等副作用——但 502/503/504 网关错误
  // 例外（dev 下 Vite 代理对「上游未就绪」的包装，与「连接被拒」同义），见 isBackendUnreachable。
  axios.interceptors.response.use(
    res => res,
    async (error) => {
      const config = error.config
      if (isBackendUnreachable(error) && config) {
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
  return axios
}

// 生产模式（app:// 协议）下无 Vite 代理，需指定完整后端地址；开发模式走 Vite 代理，保持相对路径。
export function backendBaseUrl() {
  return import.meta.env.PROD ? 'http://localhost:3000' : ''
}