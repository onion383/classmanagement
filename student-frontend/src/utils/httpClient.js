import axios from 'axios'
import { setupSecureAxios } from '../composables/secureAxios'
import { waitForBackendReady, isBackendUnreachable } from './backendReady'

// 安全通道「会话过期」不是登录态失效：加密会话 15 分钟被动过期时，后端在请求解密阶段
// 直接回 401 且 body 为 { d:'session-expired' }（不是密文，也非登录 token 问题）。
// 这种 401 由 secureAxios 清会话、重新握手后重试，绝不能当成登录过期把用户踢回登录页。
function isSecureSessionExpired(error) {
  const d = error.response && error.response.data
  return !!d && typeof d === 'object' && d.d === 'session-expired'
}

// 各窗口入口（主窗口 / 引导窗口 / 悬浮组件 / 桌面组件）共用同一套 axios 装配：
// baseURL、登录态注入、401 登录失效处理、后端未就绪时的探针与退避重试、安全通道加密。
// 各窗口差异只用可选项表达，不传即保持「token 注入 + 未就绪重试 + 加密」的最小行为：
//   - baseURL：是否需要指定后端地址（主窗口生产态 / 桌面组件指定，其余走 Vite 代理）
//   - getToken：token 获取方式（桌面组件经 IPC 异步取）
//   - onAuthExpired：收到「登录态失效」401 时如何处理（清 token / 提示 / 跳登录）
//   - onUnreachable：请求判定为「后端不可达」时的探测回调（每次失败触发一次）
//   - writeRetryGuard：重连期间是否允许自动重发该请求（写请求禁重发，避免重复落库）
export function setupApiClient({
  baseURL,
  getToken = () => localStorage.getItem('token'),
  onAuthExpired,
  onUnreachable,
  writeRetryGuard = () => true,
} = {}) {
  if (baseURL) axios.defaults.baseURL = baseURL

  // 请求拦截器：自动附加登录 Token
  axios.interceptors.request.use(async (config) => {
    const token = await getToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  // 响应拦截器：
  //  1) 登录态失效：401（非安全通道会话过期）交 onAuthExpired 处理（清 token / 提示 / 跳登录）；
  //  2) 后端稍慢于窗口（或引导页「改储存目录」重启后端）时，首屏请求可能遇到「连接被拒」
  //     网络错误（此时 error.response 为 undefined）。这类错误不立即失败，而是先触发一次探测，
  //     再等后端就绪信号（backend-ready）后重试，后端一就绪立即重试、不盲等固定退避；
  //     有 HTTP 响应（4xx/5xx）的错误不重试，避免重复提交等副作用——但 502/503/504 网关错误
  //     例外（dev 下 Vite 代理对「上游未就绪」的包装，与「连接被拒」同义），见 isBackendUnreachable。
  axios.interceptors.response.use(
    res => res,
    async (error) => {
      const config = error.config

      // 登录态失效（401，且非安全通道会话过期）：交调用方决定是否清 token 并跳登录
      if (error.response && error.response.status === 401 && !isSecureSessionExpired(error)) {
        onAuthExpired?.(error, config)
      }

      // 主动取消的请求不是故障，既不探测也不重试
      if (error.code === 'ERR_CANCELED') return Promise.reject(error)

      if (isBackendUnreachable(error) && config) {
        // 没拿到任何响应 = 后端可能已不可达。触发一次探测，把用户的每一次失败操作变成探针
        if (!config.__probed) {
          config.__probed = true
          onUnreachable?.(error, config)
        }

        // 重连期间：写请求不自动重发，把失败直接交给调用方提示用户手动重试
        if (!writeRetryGuard(config)) return Promise.reject(error)

        const retryCount = config.__retryCount || 0
        if (retryCount < 6) {
          config.__retryCount = retryCount + 1
          // 启动窗口内的等待保持静默：主窗口此时仍被首屏占位页盖着，弹提示条毫无意义。
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