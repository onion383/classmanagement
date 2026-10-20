import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

import fs from 'fs'
import path from 'path'

// 渲染阻塞 CSS 改非阻塞：首屏占位（index.html / setup.html 里内联的 splash）只用内联样式，
// 不需要等 tailwind 全量 CSS（约 120KB）下载 + 解析才开始画。给构建产物里的
// <link rel="stylesheet"> 加 media="print" + onload 切回 all，首帧不再被 CSS 阻塞。
// 渲染层在移除首屏占位前会再等一次样式表就绪（见 src/main.js / src/subwindows/setup/main.js），
// 因此不会出现「界面无样式」的中间态。
// 放在 closeBundle 里直接改盘上产物：此时 Vite 注入的 CSS link 已写入，正则替换最可靠。
function nonBlockingCss(entries = ['index.html', 'setup.html']) {
  return {
    name: 'non-blocking-css',
    apply: 'build',
    closeBundle() {
      for (const name of entries) {
        const file = path.resolve(import.meta.dirname, 'dist', name)
        if (!fs.existsSync(file)) continue
        const html = fs.readFileSync(file, 'utf8')
        // 幂等：已带 media="print" 的 link 原样保留，避免重复构建时层层叠加该属性
        const out = html.replace(/<link rel="stylesheet"([^>]*?)>/g, (tag, attrs) =>
          /media="print"/.test(attrs)
            ? tag
            : `<link rel="stylesheet"${attrs} media="print" onload="this.media='all'">`
        )
        if (out !== html) fs.writeFileSync(file, out)
      }
    },
  }
}

// 首屏占位单一来源：index.html / setup.html 里只写 <!--splash-css--> 与 <!--splash-html--> 占位，
// 由本插件在 dev 与 build 两处都注入 splash/ 下的同一份样式与结构，避免同款加载画面维护多份。
// 用内联 <style> + 内联 DOM，保证首帧不等任何外部 JS/CSS 下载即可绘制。
function injectSplash() {
  const cssFile = path.resolve(import.meta.dirname, 'splash/splash.css')
  const htmlFile = path.resolve(import.meta.dirname, 'splash/splash.html')
  return {
    name: 'inject-splash',
    transformIndexHtml(html) {
      const css = fs.readFileSync(cssFile, 'utf8')
      const body = fs.readFileSync(htmlFile, 'utf8')
      return html
        .replace('<!--splash-css-->', `<style>\n${css}\n</style>`)
        .replace('<!--splash-html-->', body)
    },
  }
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), injectSplash(), nonBlockingCss()],
  server: {
    // 允许 dev server 读取仓库根：electron/ipc-channels.json 位于 vite root 之外，
    // 由 src/electronChannels.js 直接 import（构建时会被内联，dev 下经 fs 白名单放行）。
    fs: { allow: [path.resolve(import.meta.dirname), path.resolve(import.meta.dirname, '..')] },
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
        // 主题 CSS 改为按需动态加载（见 styles/themeLoader.js）：dev 下要等首次渲染才请求、才编译，
        // 故一并预热，避免首屏/切主题时现编译。仅 dev 生效，对正式版无影响。
        './src/styles/theme-glass.css',
        './src/styles/theme-glass2.css',
        './src/styles/theme-minimal.css',
        './src/styles/theme-win11.css',
        './src/styles/theme-night.css',
        // 首屏落地页（未登录→Login，已登录→Dashboard）：提前编译，避免跳转后才逐模块编译
        './src/views/Login.vue',
        './src/views/DashboardView.vue',
        './src/composables/useDashboardData.js',
        './src/subwindows/desktop-widget/main.js',
        './src/subwindows/desktop-widget/DesktopWidget.vue',
        // 首次安装引导窗口：全新安装首屏，提前编译避免引导页白屏
        './src/subwindows/setup/main.js',
        './src/subwindows/setup/Setup.vue',
        // 首屏依赖链补齐：主题工具（stores/theme 依赖）、引导页后端就绪等待、App 外壳的关闭菜单
        './src/utils/apiUrl.js',
        './src/utils/backendReady.js',
        './src/components/base/ShutdownMenuDialog.vue',
      ],
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
    // 运行环境只有 Electron（内嵌新版 Chromium），不存在需要兼容的老浏览器。
    // 指定 esnext 表示不做任何降级转译，避免多余语法转换与解析开销
    // （当前打包 Electron 43，Chromium 140+，新语法原生支持）。
    target: 'esnext',
    // 显式写出最小化器：Vite 8 默认就是 'oxc'，这里只是把默认值写明，
    // 避免以后误以为没启用压缩（CSS 最小化默认跟随 build.minify，无需单独配置）。
    minify: 'oxc',
    // Electron 的 Chromium 原生支持 modulepreload，关掉 Vite 注入的 polyfill
    // （它会被打进入口 chunk，对首屏只增加体积、无任何收益）。
    modulePreload: { polyfill: false },
    // 小资源内联阈值：本地 file:// 加载，请求数收益很小，此处仅为减少碎片文件。
    // 注：src 下当前没有被 Vite 处理的图片/字体资源，此项暂无实际产物变化。
    assetsInlineLimit: 8192,
    // 大 chunk 警告阈值：xlsx / exceljs / jspdf / html2canvas 本就是按需加载的独立 chunk，
    // 不占首屏，警告属噪音，调高阈值避免误导。
    chunkSizeWarningLimit: 1000,
    // 不在构建时统计 gzip 体积：日志更干净、构建略快（需要体积数据时用其它工具看）。
    reportCompressedSize: false,
    // Vite 8 已用 rolldown 取代 rollup，rollupOptions 是 deprecated 别名，这里改用新名（行为不变）
    rolldownOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        widget: path.resolve(import.meta.dirname, 'widget.html'),
        'desktop-widget': path.resolve(import.meta.dirname, 'desktop-widget.html'),
        migration: path.resolve(import.meta.dirname, 'migration.html'),
        setup: path.resolve(import.meta.dirname, 'setup.html'),
      },
    }
  }
})
