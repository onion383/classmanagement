// =========================================================================
// electron-page-probe.cjs —— 用 Electron 打开一个页面，把它自己的 console 输出与
// 页面里的 #out 文本打印到 stdout，然后退出。
//
// 用途：浏览器上下文里的断言页（要跑 Vite 转译的 ESM、要用 crypto.subtle）无法用
// 纯 Node 跑，只能起一个真实的 Electron 渲染进程。配合 smoke/ 下的脚本使用。
//
// 用法（由 Electron 执行，不是 node）：
//   electron testjs/tools/electron-page-probe.cjs <url> [超时毫秒]
// 输出：页面 console 的全部行 + 「---PAGE---」+ #out 的文本
// 退出码：0 = 正常加载；2 = 超时；3 = 加载失败
// =========================================================================
const { app, BrowserWindow } = require('electron')

const url = process.argv[2]
const timeoutMs = Number(process.argv[3]) || 30000

if (!url) {
  console.log('PROBE_NO_URL')
  app.exit(2)
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 700 })
  win.webContents.on('console-message', (e) => {
    console.log(String(e.message || ''))
  })
  win.webContents.on('did-fail-load', (e, code, desc) => {
    console.log('PROBE_LOAD_FAIL ' + code + ' ' + desc)
  })
  try {
    await win.loadURL(url)
  } catch (e) {
    console.log('PROBE_LOAD_FAIL ' + (e && e.message))
    app.exit(3)
    return
  }
  // 等页面里的断言跑完（页面自己会在 #out 里写结果）
  await new Promise((r) => setTimeout(r, 5000))
  try {
    const text = await win.webContents.executeJavaScript(
      "document.getElementById('out') ? document.getElementById('out').textContent : '(no #out element)'")
    console.log('---PAGE---')
    console.log(text)
  } catch (e) {
    console.log('PROBE_EVAL_FAIL ' + (e && e.message))
  }
  console.log('PROBE_DONE')
  app.exit(0)
}).catch((e) => {
  console.log('PROBE_FAIL ' + (e && e.message))
  app.exit(3)
})

setTimeout(() => {
  console.log('PROBE_TIMEOUT')
  app.exit(2)
}, timeoutMs)
