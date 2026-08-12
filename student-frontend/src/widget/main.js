import { createApp } from 'vue'
import WidgetApp from './WidgetApp.vue'
import axios from 'axios'
import '../styles/index.css'

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

createApp(WidgetApp).mount('#widget-app')
