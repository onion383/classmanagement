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
        './src/composables/secureAxios.js',
        './src/composables/useNotification.js',
        './src/components/layout/Sidebar.vue',
        './src/components/base/NotificationToast.vue',
        './src/components/base/AppSelect.vue',
        './src/components/base/IconGlyph.vue',
        './src/styles/index.css',
        // 首屏落地页（未登录→Login，已登录→Dashboard）：提前编译，避免跳转后才逐模块编译
        './src/views/Login.vue',
        './src/views/DashboardView.vue',
        './src/composables/useDashboardData.js',
        './src/desktop-widget/main.js',
        './src/desktop-widget/DesktopWidget.vue',
        // 首次安装引导窗口：全新安装首屏，提前编译避免引导页白屏
        './src/setup/main.js',
        './src/setup/Setup.vue',
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
    // 显式清空输出目录，避免旧 hash 文件残留被打进安装包
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        widget: path.resolve(__dirname, 'widget.html'),
        'desktop-widget': path.resolve(__dirname, 'desktop-widget.html'),
        migration: path.resolve(__dirname, 'migration.html'),
        setup: path.resolve(__dirname, 'setup.html'),
      },
    }
  }
})
