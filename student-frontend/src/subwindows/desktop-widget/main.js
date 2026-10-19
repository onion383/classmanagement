import { createApp } from 'vue'
import DesktopWidget from './DesktopWidget.vue'
import '../../styles/index.css'
import { setupApiClient, backendBaseUrl } from '../../utils/httpClient'

// 桌面组件在桌面常驻，不依赖主窗口的登录态同步。
// 通过 IPC 从主进程获取当前 token（主窗口保存的），避免 cookie 跨域读取问题。
// 若主进程未返回 token，则退回到 localStorage 中读取（兼容开发模式）。
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

// 共用 axios 装配：登录态（此处经 IPC 取 token）、网络错误退避重试、安全通道加密。
// 打包版桌面组件加载自 app://local/desktop-widget.html（见 electron/main.widget.js），
// 相对路径会被解析到该协议而拿不到后端，故与其它窗口一样补全后端地址；开发模式仍走 Vite 代理的相对路径。
setupApiClient({ baseURL: backendBaseUrl(), getToken })

createApp(DesktopWidget).mount('#desktop-widget-app')