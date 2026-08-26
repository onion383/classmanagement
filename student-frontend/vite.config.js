import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    // 预热首屏模块图：服务器启动时即预编译入口及关键依赖，
    // 避免第一个请求才逐文件编译导致窗口白屏过长。
    warmup: {
      clientFiles: [
        './src/main.js',
        './src/App.vue',
        './src/router/index.js',
        './src/stores/theme.js',
        './src/components/layout/Sidebar.vue',
        './src/components/base/NotificationToast.vue',
        './src/styles/index.css',
      ],
    },
    https: {
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem')
    },
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        widget: path.resolve(__dirname, 'widget.html'),
      },
      output: {
        // 大依赖单独拆包，延迟到使用时才被加载
        manualChunks(id) {
          if (id.includes('node_modules/exceljs')) {
            return 'exceljs';
          }
          if (id.includes('node_modules/html2canvas')) {
            return 'html2canvas';
          }
          if (id.includes('node_modules/jspdf')) {
            return 'jspdf';
          }
        }
      }
    }
  }
})