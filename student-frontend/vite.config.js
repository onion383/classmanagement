import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'

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

// ───────────────────────────────────────────────────────────────────────────
// Vue 3.6 预览通道（不新建 git 分支，只换依赖来源）
//
// 目的：想试 3.6 的性能，但不想动主线依赖，也不想开一条要长期 rebase 的分支。
// 做法：3.6 预发布版单独装在 ./vue36（见 vue36/package.json），主线 node_modules
// 里的 vue 仍是 3.5.x，两份互不覆盖；靠环境变量 VUE_CHANNEL=36 在运行时切过去。
//
// 开关只从环境变量进来，vite.config 本身不猜：dev-vite.js 加 --vue36 时注入它，
// 所以 `npm run dev` / `npm run electron:build` 的行为与改动前完全一致。
//
// 两处都必须换，缺一个就会「编译用 3.5、运行用 3.6」版本错配：
//   1. resolveId 把裸 'vue' 指到 3.6 的运行时（3.5 与 3.6 的响应式实现不同，
//      混用会出现两个 Vue 实例，provide/inject、ref 判等都失效）；
//   2. @vitejs/plugin-vue 的 compiler 显式传入 3.6 的 compiler-sfc
//      （不传就会从 config.root 解析到主线 3.5 的编译器，模板产物与运行时不匹配）。
// 插件用 enforce: 'pre'，先于内置 vite:resolve 与 plugin-vue 注入的 resolve.dedupe
// 生效，避免 dedupe 又把 'vue' 拉回主线。
// ───────────────────────────────────────────────────────────────────────────
const VUE36_DIR = path.resolve(import.meta.dirname, 'vue36')

async function loadVue36() {
  const pkgFile = path.join(VUE36_DIR, 'node_modules', 'vue', 'package.json')
  if (!fs.existsSync(pkgFile)) {
    throw new Error(
      '[vue36] 未找到 Vue 3.6 预览依赖，请先执行：npm run setup:vue36'
    )
  }
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
  const runtime = path.join(path.dirname(pkgFile), pkg.module || 'dist/vue.runtime.esm-bundler.js')
  const compilerEntry = path.join(VUE36_DIR, 'node_modules', 'vue', 'compiler-sfc', 'index.mjs')
  const compiler = await import(pathToFileURL(compilerEntry).href)
  if (typeof compiler.parse !== 'function' || typeof compiler.compileScript !== 'function') {
    throw new Error(`[vue36] ${compilerEntry} 不是可用的 compiler-sfc 入口`)
  }
  const plugin = {
    name: 'vue36-channel',
    enforce: 'pre',
    resolveId(id) {
      // 只接管裸 'vue'；子路径（如果以后用到）保持默认解析，行为与主线一致
      if (id === 'vue') return runtime
    },
    configResolved(config) {
      // dev / build 都打印，避免「以为在跑 3.6，实际还是 3.5」
      config.logger.info(
        `\x1b[35m[vue36]\x1b[0m ${config.command} 使用 vue@${pkg.version}（主线 node_modules 未改动）`
      )
    },
  }
  return { version: pkg.version, runtime, compiler, plugin }
}

// 顶层 await 可用：本文件是 ESM（student-frontend/package.json 是 "type": "module"），
// Vite 以 import() 加载配置，天然支持。未开通道时这里是 null，配置与改动前完全一致。
const vue36 = process.env.VUE_CHANNEL === '36' ? await loadVue36() : null

export default defineConfig({
  plugins: [
    // 顺序无实质影响（该插件是 enforce:'pre'），放最前只为读起来直观
    vue36?.plugin,
    vue({
      compiler: vue36?.compiler,
      template: {
        compilerOptions: {
          // Electron 的 <webview> 是内置自定义元素。不声明的话，Vue 会把它当成
          // 「未注册的组件」解析：模板里不渲染真实元素、控制台还会告警。
          // 声明后按原生元素处理，可以像普通标签一样写在模板里（见 AiLinkPanel.vue）。
          isCustomElement: (tag) => tag === 'webview',
        },
      },
    }),
    tailwindcss(),
    injectSplash(),
    nonBlockingCss(),
  ].filter(Boolean),
  // 预构建缓存按通道隔离：3.5 与 3.6 共用 node_modules/.vite 会互相污染，
  // 切换通道后必须重新预构建（否则会拿到上一版 vue 的 deps 产物）。
  //
  // optimizeDeps.exclude: ['vue'] 是必须的，不是调优：resolveId 把 'vue' 指成绝对源文件后，
  // 主入口拿到的是源文件版，而 pinia / vue-router 的预构建产物里内联了另一份 Vue ——
  // 实测就是「两份 Vue 并存」，响应式、provide/inject、instanceof 判断全部跨实例失效。
  // 排除后所有 import 'vue' 都收敛到同一份源文件；代价仅是 dev 下 vue 按模块逐个请求
  // （比打成一个 2.5MB chunk 略慢一点加载），换来的是只有一个 Vue 运行时。
  ...(vue36
    ? { cacheDir: path.join(VUE36_DIR, '.vite-cache'), optimizeDeps: { exclude: ['vue'] } }
    : {}),
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
