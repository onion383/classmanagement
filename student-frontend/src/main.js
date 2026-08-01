import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import axios from 'axios'   // 必须导入
import './styles/index.css'
import { useThemeStore } from './stores/theme'




// 请求拦截器
axios.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

// 初始化主题（必须在 mount 前应用，避免闪烁）
const themeStore = useThemeStore()
themeStore.applyTheme()

app.mount('#app')