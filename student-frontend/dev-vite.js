// =========================================================================
// dev-vite.js —— 直连 Vite 开发服务器（跳过 npm 套娃）
//
// 为什么需要这个文件：根 package.json 的脚本是 `cd student-frontend && npm run dev`，
// 在 Windows 上这要拉两层 npm（根 npm → 子 npm → 才轮到 vite）。实测（v8.3.4）：
//   · 经两层 npm：墙钟 2683ms（vite 自报 ready 仅 1223ms）→ 白等 1460ms
//   · 直连 vite  ：墙钟 1544ms（vite 自报 ready 1347ms）→ 开销仅 197ms
// 差额约 1.1s 全是进程启动开销，跟编译无关。concurrently 直接 spawn node 可完全省掉。
//
// 用法：
//   node student-frontend/dev-vite.js            # 等价于原来的 npm run dev
//   node student-frontend/dev-vite.js --port 5175 --strictPort
//   node student-frontend/dev-vite.js --vue36    # 走 Vue 3.6 预览通道（npm run dev:new）
//   node student-frontend/dev-vite.js --vue36 build  # 用 3.6 构建（npm run build:new）
//
// --vue36 由本启动器翻译成环境变量 VUE_CHANNEL=36 传给 Vite（见 vite.config.js），
// 自己并不传给 vite —— Vite 不认识这个参数，会直接报错退出。
// 其余参数（含 build 子命令）原样透传。
//
// 注意：cwd 必须是 student-frontend —— vite.config.js 用 import.meta.dirname 解析
// splash/ 与 dist/ 路径，换 cwd 会解析错。
// =========================================================================
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const viteBin = path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js')

const rawArgs = process.argv.slice(2)
const useVue36 = rawArgs.includes('--vue36')
const viteArgs = rawArgs.filter((arg) => arg !== '--vue36')

// 显式设置或清掉 VUE_CHANNEL：否则在已 export VUE_CHANNEL=36 的终端里跑普通 dev，
// 会莫名其妙用上 3.6，排查起来很费时间。
const env = { ...process.env }
if (useVue36) env.VUE_CHANNEL = '36'
else delete env.VUE_CHANNEL

// stdio: 'inherit' 保留 vite 的彩色输出与 Ctrl+C 行为，与直接跑 npm run dev 观感一致
const child = spawn(process.execPath, [viteBin, ...viteArgs], {
  cwd: dir,
  stdio: 'inherit',
  env,
  windowsHide: false,
})

child.on('exit', (code, signal) => {
  // concurrently 的 --kill-others 会发信号；被信号杀掉时按 0 退出，避免刷一屏错误码
  process.exit(code ?? (signal ? 0 : 1))
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill()
  })
}
