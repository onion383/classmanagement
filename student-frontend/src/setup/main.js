import { createApp } from 'vue'
import { createPinia } from 'pinia'
import axios from 'axios'
import Setup from './Setup.vue'
// 复用全局主题变量（:root 默认值），使引导窗口与主界面配色一致
import '../styles/index.css'
import { useThemeStore } from '../stores/theme'
import { setupSecureAxios } from '../composables/secureAxios'

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
// 安全通道：与主窗口一致的请求体加密 / 响应解密（无开关时直通）
setupSecureAxios(axios)

const app = createApp(Setup)
const pinia = createPinia()
app.use(pinia)

// 套用当前主题：默认「毛玻璃（glass）」，用户在引导内切换后即时生效。
// applyTheme 内的 theme-chrome 通知来自非主窗口，主进程会直接忽略（见 electron/main.js）。
useThemeStore(pinia).applyTheme()

app.mount('#setup-app')