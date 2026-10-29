import { getToken as loadStoredToken, TOKEN_KEY } from '../../utils/authStorage.js'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import DesktopWidget from './DesktopWidget.vue'
import '../../styles/index.css'
import { setupApiClient, backendBaseUrl } from '../../utils/httpClient'
import { useThemeStore } from '../../stores/theme'

// ===== 登录态 =====
// 桌面组件现在与主窗口同进程、同 profile、同 origin（dev 都是 127.0.0.1:5173，
// 打包都是 app://local），所以 localStorage 本来就是同一份：直接读即可。
// 主窗口登录/退出会改 token，本窗口收到 storage 事件后清缓存，下一次请求重新读取。
let tokenPromise = null
// 无凭据告警只打一次：重试循环每 3 秒调一次 getToken，反复 warn 会在日志里刷屏
let tokenWarned = false

function getToken() {
  if (tokenPromise) return tokenPromise
  const token = loadStoredToken()
  if (!token) {
    // 空结果不缓存：组件可能比主窗口登录更早启动，登录完成后下一次请求要能重新取到
    if (import.meta.env.DEV && !tokenWarned) {
      tokenWarned = true
      // 打印页面真实地址与 localStorage 现有键名，便于区分
      // 「origin 不对 / profile 不对 / token 真的不在」三种情况。仅开发模式。
      console.warn('[desktop-widget] 无登录 token @', location.href,
        '| localStorage.length =', localStorage.length,
        '| keys =', Object.keys(localStorage).join(','))
    }
    return Promise.resolve(null)
  }
  tokenWarned = false
  tokenPromise = Promise.resolve(token)
  return tokenPromise
}

// 共用 axios 装配：登录态、网络错误退避重试、安全通道加密。
// 打包版加载自 app://local/desktop-widget.html，相对路径会被解析到该协议而拿不到后端，
// 故与其它窗口一样补全后端地址；开发模式仍走 Vite 代理的相对路径。
setupApiClient({
  baseURL: backendBaseUrl(),
  getToken,
  // 滑动续期拿到新 token 后同步本窗口缓存，避免常驻组件一直用旧 token 到过期
  onTokenRenewed: (token) => { tokenPromise = Promise.resolve(token) },
})

function bootstrap() {
  if (import.meta.env.DEV) console.info('[dw-timing] bootstrap 开始 ' + Date.now())

  const app = createApp(DesktopWidget)
  const pinia = createPinia()
  app.use(pinia)

  // 跟随主窗口主题（与工具箱浮窗同一套做法，见 src/subwindows/widget/main.js）：
  // 组件借用主题的配色（文字、卡片底色、圆角等），这样切换主题时组件也跟着变。
  //
  // 但**不画主题背景图**：组件的磨砂背景是**渲染层自绘**的（柔光渐变 + 奶白遮罩，
  // 见 DesktopWidget.vue 的 .dw-wallpaper / .dw-veil）。若这里再让主题画一层背景图
  // （--bg-image + body::before），就会把自绘的磨砂盖住、变成一张静态图片背景。
  // 所以必须在 applyTheme() 之前置位该开关。
  const theme = useThemeStore(pinia)
  theme.suppressBackgroundImage = true
  theme.applyTheme()
  // 标记「本窗口背景由渲染层自绘」：主题 CSS 遇到它会让 body 完全透明，
  // 露出下面自绘的渐变层（否则 body 的 #f0f4f8 底色会盖住它）。
  document.documentElement.classList.add('system-acrylic')

  // 同一 profile 下，主窗口改主题/日夜间/token 都会在本窗口触发 storage 事件
  window.addEventListener('storage', (e) => {
    if (!e.key) return
    if (e.key === TOKEN_KEY) {
      tokenPromise = null
      return
    }
    if (!e.key.startsWith('app-')) return
    theme.reloadFromStorage()
  })

  // 主题 CSS 不阻塞首帧：applyTheme() 内部已按需发起样式加载，同一份 Promise 会缓存。
  // 先挂载并显示骨架，主题样式到达后浏览器自动重绘。
  app.mount('#desktop-widget-app')
  if (import.meta.env.DEV) console.info('[dw-timing] 挂载完成 ' + Date.now())
}

bootstrap()
