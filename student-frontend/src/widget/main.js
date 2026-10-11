import { createApp } from 'vue'
import WidgetApp from './WidgetApp.vue'
import '../styles/index.css'
import { setupApiClient } from '../utils/httpClient'

// 配置 API 基础地址（生产模式下 widget 使用 file:// 协议，必须使用完整地址）
setupApiClient({ baseURL: 'http://localhost:3000' })

createApp(WidgetApp).mount('#widget-app')
