// =========================================================================
// webview-guard.js —— 右侧网页抽屉 <webview> 安全护栏 + 刷新快捷键拦截
//
// 由 main.js 在模块加载期调用 registerWebviewGuard({ getMainWindow, isDev }) 注册
// app.on('web-contents-created')。依赖注入：主窗口引用以 getter 闭包注入（调用时取当前值），
// isDev 由 main.js 传入（与 !app.isPackaged 一致）。原实现内嵌于 main.js，此处为等价的纯搬运。
// =========================================================================

const { app } = require('electron')

// 右侧网页抽屉用 <webview> 内嵌外部网页的安全护栏（外部内容视为不可信）：
// 只有 http/https 视为合法地址，其余协议（file:、data:、javascript: 等）一律拒绝。
function isHttpUrl(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))
}

// 注册 app.on('web-contents-created') 护栏（原 main.js 内嵌逻辑整体迁出）
function registerWebviewGuard({ getMainWindow, isDev }) {
  // 1) 创建 webview 前校验（will-attach-webview，绑定在宿主 webContents 上）：
  //    即使宿主渲染进程被注入恶意脚本，也无法构造出带 preload / nodeIntegration 的危险 webview。
  app.on('web-contents-created', (event, contents) => {
    // 禁用刷新快捷键：拦截 Ctrl/Cmd+R、Ctrl/Cmd+Shift+R（硬刷新）、F5、Ctrl+F5，
    // 避免用户误触导致整个界面重载、丢失当前操作状态。覆盖所有窗口（含 webview）。
    // 注：开发模式（isDev）下放行上述快捷键，便于快速重载看改动。
    if (!isDev) {
      contents.on('before-input-event', (e, input) => {
        if (input.type !== 'keyDown') return
        const mod = input.control || input.meta
        const key = (input.key || '').toLowerCase()
        if ((mod && key === 'r') || key === 'f5') e.preventDefault()
      })
    }

    // 宿主窗口：拦截其内部将要挂载的 webview，强制安全配置
    if (contents.getType && contents.getType() !== 'webview') {
      contents.on('will-attach-webview', (e, webPreferences, params) => {
        // 剥离任何自定义 preload：外部网页绝不加载本应用的 preload.js（不暴露 window.electron）
        delete webPreferences.preload
        // 强制关闭 Node 集成 / 强制开启隔离与沙箱（压掉任何来自渲染层的越权配置）
        webPreferences.nodeIntegration = false
        webPreferences.nodeIntegrationInSubFrames = false
        webPreferences.contextIsolation = true
        webPreferences.sandbox = true
        webPreferences.webSecurity = true
        // 只允许 http/https 地址进入 webview
        if (!isHttpUrl(params.src)) e.preventDefault()
      })
      return
    }

    // 2) webview（访客页）自身：拦下 target=_blank 的新窗口请求，改为在同一 webview 内跳转，
    //    内容始终留在抽屉里、不额外弹窗；并限制其内部导航协议白名单（阻断 file:/data: 等）。
    contents.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) contents.loadURL(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (e, url) => {
      if (!isHttpUrl(url)) e.preventDefault()
    })

    // 3) 禁止网页下载文件：拦截该会话（partition = ai-link-preview）的下载并取消，
    //    再通知主窗口弹出提示「下载文件请打开本地浏览器」。同一 partition 的 session 会被
    //    多个 webview 共享，用标记去重，避免重复绑定导致多次提示。
    const ses = contents.session
    if (ses && !ses.__aiLinkDownloadGuard) {
      ses.__aiLinkDownloadGuard = true
      ses.on('will-download', (e) => {
        e.preventDefault()
        const mainWindow = getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('from-main', { type: 'link-download-blocked' })
        }
      })
    }
  })
}

module.exports = { registerWebviewGuard }
