// 性能测量专用 Vite 配置（基准页打包用）：把 mode-bench / table-bench 一起打进产物。
// 与日常开发配置隔离；产物用于 testjs/tmp 下的 Electron 基准运行器。
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  base: './',
  build: {
    emptyOutDir: true,
    target: 'esnext',
    minify: 'oxc',
    modulePreload: { polyfill: false },
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 2000,
    reportCompressedSize: false,
    rolldownOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        'mode-bench': path.resolve(import.meta.dirname, 'mode-bench.html'),
        'table-bench': path.resolve(import.meta.dirname, 'table-bench.html'),
      },
    },
  },
})
