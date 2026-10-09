import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Migration from './Migration.vue'
// 复用全局主题变量（:root 默认值），使进度窗口与主界面配色一致
import '../styles/index.css'
import { useThemeStore } from '../stores/theme'

const app = createApp(Migration)
const pinia = createPinia()
app.use(pinia)

// 套用用户在设置里选的主题：主色、毛玻璃质感、「组件透明玻璃层」透明度、背景图全部跟随主题，
// 与主界面保持一致（基础主题主色绿、毛玻璃主题主色蓝、极简主题主色深灰）。
// applyTheme 内的 theme-chrome 通知来自非主窗口，主进程会直接忽略（见 electron/main.js）。
useThemeStore(pinia).applyTheme()

app.mount('#migration-app')