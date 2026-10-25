import { createApp } from 'vue'
import { createPinia } from 'pinia'
import DesktopWidget from './DesktopWidget.vue'
import '../../styles/index.css'
import { setupApiClient, backendBaseUrl } from '../../utils/httpClient'
import { loadThemeStyles } from '../../styles/themeLoader'
import { useThemeStore } from '../../stores/theme'
import { INVOKE } from '../../electronChannels.js'

// 桌面组件在桌面常驻，不依赖主窗口的登录态同步。
// 通过 IPC 从主进程获取当前 token（主窗口保存的），避免 cookie 跨域读取问题。
// 若主进程未返回 token，则退回到 localStorage 中读取（兼容开发模式）。
let tokenPromise = null

function getToken() {
  if (!tokenPromise) {
    tokenPromise = (async () => {
      try {
        if (window.electron && window.electron.invoke) {
          const t = await window.electron.invoke(INVOKE.GET_MAIN_TOKEN)
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
setupApiClient({
  baseURL: backendBaseUrl(),
  getToken,
  // 滑动续期拿到新 token 后同步本窗口缓存，避免常驻组件一直用旧 token 到过期
  onTokenRenewed: (token) => { tokenPromise = Promise.resolve(token) },
})

const app = createApp(DesktopWidget)
const pinia = createPinia()
app.use(pinia)

// 跟随主窗口主题（与工具箱浮窗同一套做法，见 src/subwindows/widget/main.js）：
// 组件借用主题的配色（文字、卡片底色、圆角等），这样切换主题时组件也跟着变。
//
// 但**不画主题背景图**：组件的磨砂背景来自**主进程的系统亚克力**（真实透出桌面被模糊，
// 与 Win11 窗口一致）。若这里再让主题画一层背景图（--bg-image + body::before），
// 就会把亚克力盖住、变成一张静态图片背景。所以必须在 applyTheme() 之前置位该开关。
// 不接主题的话，组件卡片配色不会跟随主题切换。
const theme = useThemeStore(pinia)
theme.suppressBackgroundImage = true
theme.applyTheme()
// 标记「本窗口用系统亚克力」：主题 CSS 遇到它会让 body 完全透明，
// 让主进程的亚克力材质透出来（否则 body 的 #f0f4f8 底色会把亚克力盖住）。
document.documentElement.classList.add('system-acrylic')

// 主窗口切主题/日夜间时写的是同源 localStorage，本窗口会收到 storage 事件，据此重新应用，
// 实现实时跟随（只关心主题相关键，登录 token 等变化忽略）。
window.addEventListener('storage', (e) => {
  if (!e.key || !e.key.startsWith('app-')) return
  theme.reloadFromStorage()
})

// 等主题样式就绪后再挂载，避免先闪一下基础主题配色。
loadThemeStyles(document.documentElement.dataset.theme, document.documentElement.dataset.mode)
  .finally(() => app.mount('#desktop-widget-app'))
