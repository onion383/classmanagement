import { createApp } from 'vue'
import WidgetApp from './WidgetApp.vue'
import axios from 'axios'
import '../styles/index.css'
import { setupSecureAxios } from '../composables/secureAxios'

// 配置 API 基础地址（生产模式下 widget 使用 file:// 协议，必须使用完整地址）
axios.defaults.baseURL = 'http://localhost:3000'

// 请求拦截器：自动附加登录 Token
axios.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：后端稍慢于窗口时，首屏请求可能遇到「连接被拒」网络错误，自动退避重试。
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

createApp(WidgetApp).mount('#widget-app')
