import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import axios from 'axios'   // 必须导入
import './style.css'




// 请求拦截器
axios.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

const app = createApp(App)
app.use(router)
app.mount('#app')