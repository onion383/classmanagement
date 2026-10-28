import { createApp } from 'vue'
import { createPinia } from 'pinia'
import WidgetApp from './WidgetApp.vue'
import '../../styles/index.css'
import { setupApiClient, backendBaseUrl } from '../../utils/httpClient'
import { loadThemeStyles } from '../../styles/themeLoader'
import { useThemeStore } from '../../stores/theme'

// 配置 API 基础地址：与 setup / desktop-widget 两个窗口共用 backendBaseUrl()（
// 生产模式返回完整地址，开发模式返回空串走 Vite 代理）。原来这里写死 'http://localhost:3000'，
// 后端端口一变（PORT 环境变量）本窗口就连不上，而其余窗口仍正常——跨窗口失配且难排查。
setupApiClient({ baseURL: backendBaseUrl() })

const app = createApp(WidgetApp)
const pinia = createPinia()
app.use(pinia)

// 跟随主窗口主题：与引导页同一套做法——先套用当前主题，等主题样式就绪后再挂载，
// 避免先闪一下基础主题配色（applyTheme 内的 theme-chrome 通知来自非主窗口，主进程会忽略）。
const theme = useThemeStore(pinia)
theme.applyTheme()

// 主窗口切主题/日夜间时写的是同源 localStorage，本窗口会收到 storage 事件，
// 据此重新读取设置并重新应用，实现实时跟随（只关心主题相关键，登录 token 等变化忽略）。
window.addEventListener('storage', (e) => {
  if (!e.key || !e.key.startsWith('app-')) return
  theme.reloadFromStorage()
})

loadThemeStyles(document.documentElement.dataset.theme, document.documentElement.dataset.mode)
  .finally(() => app.mount('#widget-app'))
