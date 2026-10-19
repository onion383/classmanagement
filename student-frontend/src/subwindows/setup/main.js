import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Setup from './Setup.vue'
// 复用全局主题变量（:root 默认值），使引导窗口与主界面配色一致
import '../../styles/index.css'
import { loadThemeStyles } from '../../styles/themeLoader'
import { useThemeStore } from '../../stores/theme'
import { setupApiClient, backendBaseUrl } from '../../utils/httpClient'

// 各窗口共用的 axios 装配：baseURL、登录态注入、后端重启期间的退避重试、安全通道加密。
// 引导页「改储存目录」会重启后端，期间的网络错误由拦截器等就绪后自动重试。
setupApiClient({ baseURL: backendBaseUrl() })

// 挂载前等样式就绪：构建产物里的 CSS 已改为非阻塞加载（media="print" + onload 切回 all），
// 等它应用后再渲染，避免界面一闪无样式。dev 下样式由 Vite 用 JS 注入、没有 link 标签，立即完成；
// 2s 兜底避免极端情况把界面卡在未挂载状态。
const stylesReady = Promise.all(
  [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => new Promise((resolve) => {
    if (l.sheet) return resolve()
    const done = () => resolve()
    l.addEventListener('load', done)
    l.addEventListener('error', done)
    setTimeout(done, 2000)
  }))
)

// 解析首屏画面：低版本提示优先（主进程 launch-plan），否则欢迎页。
// 支持 URL ?screen=warning|welcome|wizard 直接预览——浏览器打开 setup.html 也能看指定画面。
async function resolveLaunch() {
  let plan = { warn: false, setup: true }
  let forced = ''
  try {
    forced = new URLSearchParams(location.search).get('screen') || ''
    const p = await window.electron?.invoke?.('launch-plan')
    if (p) plan = p
  } catch (_) {}
  if (forced === 'warning' || forced === 'welcome' || forced === 'wizard') {
    return { screen: forced, plan }
  }
  return { screen: plan.warn ? 'warning' : 'welcome', plan }
}

// 先解析画面、再等样式，二者就绪后才挂载：避免先渲染欢迎页再跳到提示页的闪动。
Promise.all([stylesReady, resolveLaunch()]).then(async ([, launch]) => {
  const app = createApp(Setup, { initialScreen: launch.screen, plan: launch.plan })
  const pinia = createPinia()
  app.use(pinia)
  // 套用当前主题：默认「毛玻璃（glass）」，用户在引导内切换后即时生效。
  // applyTheme 内的 theme-chrome 通知来自非主窗口，主进程会直接忽略（见 electron/main.js）。
  useThemeStore(pinia).applyTheme()
  // 等当前主题的按需样式就绪（applyTheme 已触发加载）后再挂载，避免闪一下基础主题配色。
  await loadThemeStyles(document.documentElement.dataset.theme, document.documentElement.dataset.mode)
  app.mount('#setup-app')
})