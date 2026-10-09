// 性能测量专用 Vite 配置：与日常开发配置（vite.config.js）隔离。
// 两种模式：
//   1) 测量服务器模式（默认）：5174 端口跑源码，API 代理到测试后端 3100；
//   2) 预览生产构建：PERF_TARGET=dist + PREF_PORT=5175，serve 打包产物（无开发态开销，最接近真实手感）。
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

const target = process.env.PERF_TARGET === 'dist' ? 'dist' : 'serve'
const port = Number(process.env.PERF_PORT || (target === 'dist' ? 5175 : 5174))
const apiTarget = `http://localhost:${process.env.PERF_BACKEND_PORT || 3100}`

const https = {
  key: fs.readFileSync(path.resolve(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.resolve(__dirname, 'cert.pem')),
}

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    https,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/uploads': { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    https,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/uploads': { target: apiTarget, changeOrigin: true },
    },
  },
  base: './',
})
