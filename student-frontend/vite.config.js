import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    // 保留你的 HTTPS 证书
    https: {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem')
    },
    port: 5173,
    // 加上代理
    proxy: {
      '/api': {
        target: 'http://localhost:3000',  // 指向你的后端 HTTPS
        changeOrigin: true,
        secure: false,                     // 忽略后端自签名证书
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})