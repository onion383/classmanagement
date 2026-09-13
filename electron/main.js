const { app, BrowserWindow, ipcMain, desktopCapturer, screen, dialog, shell, protocol, Menu, globalShortcut, Notification, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { Readable } = require('stream')
const { exec } = require('child_process')
const startupTimer = require('./startup-timer')

// 安全通道主密钥（方案 A 的认证锚点 K_master）：本次运行周期内生成一次并复用于
// 「后端 fork env 注入」+「preload IPC 提供渲染层」。只参与前后端 HKDF 派生态，
// 不进线上传输。后端崩溃自动重启时复用同一值，保证已建立会话/前端持有的密钥仍一致。
let channelMasterKey = null
function getMasterKey() {
  if (!channelMasterKey) channelMasterKey = crypto.randomBytes(32).toString('hex')
  return channelMasterKey
}

// DB 静态加密主密钥（方案 A：首启现场随机生成 + safeStorage/DPAPI 持久化）：
// 取代原先明文写在 student-backend/.env、随安装包分发的 DB_MASTER_KEY。
// - Windows 上 safeStorage 底层走 DPAPI，密文绑定当前系统用户，解开安装包拿不到明文。
// - 首启：文件不存在 → 生成随机 32 字节 → 加密写 userData/data/db-master.key。
// - 之后：解密文件复用同一把钥匙，保证持久库可连续打开。
// - 兜底：safeStorage 不可用（非 Windows 等）时仅返回运行期随机值，不落明文文件。
// 数据目录/缓存目录解析（app-config.json，存于 userData，独立于业务数据目录以便启动即读）
function getAppConfigPath() {
  return path.join(app.getPath('userData'), 'app-config.json')
}
function resolveAppConfig() {
  try { return JSON.parse(fs.readFileSync(getAppConfigPath(), 'utf8')) || {} } catch (_) { return {} }
}
function saveAppConfig(patch) {
  const next = { ...resolveAppConfig(), ...patch }
  if (!next.dataDir) delete next.dataDir
  if (!next.thumbsDir) delete next.thumbsDir
  try { fs.writeFileSync(getAppConfigPath(), JSON.stringify(next, null, 2)) } catch (err) {
    console.error('[main] 写入 app-config 失败:', err?.message || err)
  }
  return next
}
// 数据库主目录：默认 userData/data，可被用户配置覆盖
function resolveDataDir() {
  const cfg = resolveAppConfig()
  return cfg.dataDir ? path.resolve(cfg.dataDir) : path.join(app.getPath('userData'), 'data')
}
// 相册缩略图缓存目录：默认位于数据目录下 album-thumbs，可单独配置为独立缓存位置
function resolveThumbsDir() {
  const cfg = resolveAppConfig()
  if (cfg.thumbsDir) return path.resolve(cfg.thumbsDir)
  return path.join(resolveDataDir(), 'album-thumbs')
}

let dbMasterKey = null
function getDbMasterKey() {
  if (dbMasterKey) return dbMasterKey
  // 主密钥文件与数据库同目录存放，随数据目录一起迁移；解析用配置后的 dataDir，保证两者一致
  const keyFile = path.join(resolveDataDir(), 'db-master.key')
  try {
    if (fs.existsSync(keyFile) && safeStorage.isEncryptionAvailable()) {
      const blob = fs.readFileSync(keyFile)
      try {
        dbMasterKey = safeStorage.decryptString(blob)
        return dbMasterKey
      } catch { /* 密文损坏/密钥变更，退回重新生成 */ }
    }
    dbMasterKey = crypto.randomBytes(32).toString('hex')
    if (safeStorage.isEncryptionAvailable()) {
      try {
        fs.mkdirSync(path.dirname(keyFile), { recursive: true })
        fs.writeFileSync(keyFile, safeStorage.encryptString(dbMasterKey))
      } catch (err) {
        console.error('[main] DB 主密钥持久化失败，将仅本次运行有效:', err?.message || err)
      }
    }
    return dbMasterKey
  } catch (err) {
    console.error('[main] DB 主密钥初始化失败，使用运行期随机值:', err?.message || err)
    dbMasterKey = crypto.randomBytes(32).toString('hex')
    return dbMasterKey
  }
}

// electron-acrylic-window：原生模块，走 Win32 SetWindowCompositionAttribute 启用真·亚克力毛玻璃，
// 不受 Win11「节能器」影响（Electron 原生 setBackgroundMaterial 会被节能器干扰变灰）。
//
// 注意：该包的 package.json main 指向 dist/index.js，但 dist/ 未编译产物（只有 src TS 源码 + 编译好的
// build/Release/vibrancy-wrapper.node），直接 require('electron-acrylic-window') 会失败。
// 因此绕开 JS 层，直接加载已编译的 N-API 原生模块，并自行封装 setVibrancy（解析 theme 的 AARRGGBB，
// 把 alpha 正确传给 Win32 —— 原库 vibrancy.ts 恒传 currentOpacity=0 导致模糊不可见）。
//
// 启动优化：原生模块**延迟到首次真正使用亚克力时**才 require（懒加载）。亚克力只对
// 无边框(Win11)主窗口和桌面小组件有效，放到文件顶部同步加载会额外占用启动关键路径；
// 改为首次 setVibrancy 时才加载 .node 二进制，命中模块缓存后后续调用零成本。
let acrylicNative = null
let setVibrancy = null

function getAcrylicNative() {
  if (acrylicNative === null) {
    try {
      // 原库编译产物：build/Release/vibrancy-wrapper.node（N-API 模块，跨 Electron 版本 ABI 稳定）
      const nativePath = path.join(__dirname, '..', 'node_modules', 'electron-acrylic-window', 'build', 'Release', 'vibrancy-wrapper.node')
      if (fs.existsSync(nativePath)) {
        acrylicNative = require(nativePath)
      }
    } catch (err) {
      console.error('[acrylic] 原生模块加载失败，亚克力降级为 CSS 回退:', err?.message || err)
    }
    // 懒加载只执行一次：无论成功与否都记录"已尝试"，避免每次调用都走 fs.existsSync/require
    if (typeof acrylicNative !== 'object' || typeof acrylicNative?.setVibrancy !== 'function') {
      acrylicNative = false
    }
  }
  return acrylicNative || null
}

// theme 形如 'AARRGGBB'（alpha 在前，与原生 gradientColor 的 ARGB 一致）
function parseARGB(theme) {
  let hex = String(theme || '80FFFFFF').replace(/^#/, '')
  if (hex.length === 6) hex = 'FF' + hex // 无 alpha 时默认不透明
  const a = parseInt(hex.slice(0, 2), 16)
  const r = parseInt(hex.slice(2, 4), 16)
  const g = parseInt(hex.slice(4, 6), 16)
  const b = parseInt(hex.slice(6, 8), 16)
  return { r, g, b, a }
}

// 惰性设置亚克力：首次调用触发原生模块加载，返回 true 表示亚克力已成功开启
setVibrancy = (win, options = {}) => {
  const native = getAcrylicNative()
  if (!native) return false
  const { r, g, b, a } = parseARGB(options.theme)
  const effect = options.effect === 'blur' ? 0 : 1 // 1 = acrylic（isRS4OrGreater 语义）
  // 取原生窗口句柄（int32），供 Win32 SetWindowCompositionAttribute 使用
  let hwnd
  try {
    hwnd = win.getNativeWindowHandle().readInt32LE(0)
  } catch (_) {
    throw new TypeError('NOT_VALID_WINDOW')
  }
  native.setVibrancy(hwnd, effect, r, g, b, a)
  return true
}

const disableVibrancy = (win) => {
  const native = getAcrylicNative()
  if (!native || typeof native.disableVibrancy !== 'function') return
  let hwnd
  try {
    hwnd = win.getNativeWindowHandle().readInt32LE(0)
  } catch (_) {
    return
  }
  native.disableVibrancy(hwnd)
}

console.log('[acrylic] 亚克力原生模块已进入懒加载（首次使用时才 require）')

let mainWindow
// 当前主窗口的边框模式：'native'（毛玻璃等其他主题，系统原生标题栏）| 'frameless'（Win11 主题，无边框自绘标题栏）。
// 边框无法在运行中切换，故跨模式切换时重建主窗口。
let mainWindowChrome = 'native'
let widgetWindow
let desktopWidgetWindow
let backendProcess

// 关闭确认菜单状态：
//   shutdownMenuOpen —— 菜单已弹出时不再重复弹（close 事件可能反复触发）；
//   allowMainClose  —— 用户已从菜单选择关闭主窗口，放行本次 close（绕过弹出菜单）。
let shutdownMenuOpen = false
let allowMainClose = false

// 「本次启用工具箱」会话级开关：仅影响本次运行浮窗显隐（不持久）。
// null = 尚未由浮窗初始化（浮窗会以持久「是否启用工具箱」作为本次默认注入）。
let sessionWidgetEnabled = null

const isDev = !app.isPackaged

// 单实例锁：防止手快点多次图标导致同时跑出多个应用实例。
// 第一个实例拿到锁；后续实例 requestSingleInstanceLock 返回 false，直接退出，
// 并把用户注意力拉回到已存在的主窗口。
const gotSingleInstanceLock = app.requestSingleInstanceLock()

// 用户又尝试启动一次（重复点击图标/快捷键）时，唤起已存在的主窗口而不是新开
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

// 打包模式用自定义 app:// 安全协议加载前端，避免 file:// 的「不透明 origin」导致
// localStorage 仅会话内生效、每次重启即清空（表现：重新登录 + 设置还原）。
// 标准+安全+supportFetchAPI 使其成为真实持久化的 origin。
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])

// 开发模式：忽略自签名 HTTPS 证书错误
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isDev) {
    event.preventDefault()
    callback(true)
  } else {
    callback(false)
  }
})

// 禁用控制台安全警告（仅开发模式）
if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

function loadUrlWithRetry(win, url, retries = 30) {
  win.loadURL(url).catch((err) => {
    if (retries > 0) {
      console.log(`[Electron] 等待 ${url} 就绪，剩余重试 ${retries}...`)
      setTimeout(() => loadUrlWithRetry(win, url, retries - 1), 1000)
    } else {
      console.error(`[Electron] 无法加载 ${url}:`, err.message)
    }
  })
}

// 开发模式：先加载本地 inline loading 页面，不等 Vite 就绪。
// 这样窗口能在 < 1s 内弹出（显示 loading 动画），
// 后台轮询 Vite 就绪后自动跳转到热更新页面。
const DEV_LOADING_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
html,body{margin:0;height:100%}
body{background:linear-gradient(160deg,#eef2ff 0%,#e2e8ff 100%)}
.s{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.spin{animation:r 1.4s linear infinite;transform-origin:center}
.l{font-size:22px;font-weight:600;color:#1e40af;letter-spacing:1px}
.t{font-size:13px;color:#6b7280}
@keyframes r{to{transform:rotate(360deg)}}
</style></head>
<body><div class="s">
<svg width="34" height="34" viewBox="0 0 22 22">
<circle cx="11" cy="11" r="8" fill="none" stroke="rgba(30,64,175,.25)" stroke-width="3"/>
<circle class="spin" cx="11" cy="11" r="8" fill="none" stroke="#1e40af" stroke-width="3" stroke-dasharray="42" stroke-dashoffset="12" stroke-linecap="round"/>
</svg>
<span class="l">班级管理系统</span>
<span class="t">启动开发服务器…</span>
</div></body></html>`

// 轮询 Vite 开发服务器：用 https.get 轻量探测，不阻塞渲染进程。
// Vite 就绪后导航到其 URL，并打开 DevTools。
// 重试上限留足 ~4s 预算（现在轮询在创建窗口后立刻开始，比之前提前约 0.5s）。
function pollViteAndNavigate(win, retries = 40) {
  const https = require('https')
  const req = https.get('https://127.0.0.1:5173/', { rejectUnauthorized: false }, (res) => {
    res.resume() // 消耗响应体，避免内存泄漏
    startupTimer.mark('Vite 就绪，开始跳转')
    if (win && !win.isDestroyed()) {
      win.loadURL('https://127.0.0.1:5173/')
      win.webContents.openDevTools()
      win.webContents.once('did-finish-load', () => {
        startupTimer.mark('Vite 页面加载完成')
      })
    }
  })
  req.on('error', () => {
    if (retries > 0 && win && !win.isDestroyed()) {
      setTimeout(() => pollViteAndNavigate(win, retries - 1), 100)
    }
  })
  req.end()
}

// 主窗口边框模式：'native'（毛玻璃等其他主题，系统原生标题栏）| 'frameless'（Win11 主题，无边框自绘标题栏）。
// 边框无法在运行中切换，故跨模式切换时重建主窗口（此前 createMainWindow 已固定 no 边框）。
function createMainWindow(mode = 'native') {
  // （新窗口）关闭菜单状态复位：allowMainClose 不会在旧窗口关闭后自动清掉，
  // 若不清零，重建后的新主窗口点关闭会被静默放行、不再弹菜单。
  allowMainClose = false
  shutdownMenuOpen = false
  // 新窗口渲染层未加载完成，待其 ready 回报后才允许渲染层接管关闭菜单
  mainRendererShutdownReady = false
  const isFrameless = mode === 'frameless'
  mainWindowChrome = mode
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '班级管理系统',
    // 边框模式随主题切换（切到不同边框类型时由 recreateMainWindow 重建，见 theme-chrome）：
    //   - 毛玻璃等其他主题 → 系统原生边框，带最小化/最大化/关闭；
    //   - Win11 主题 → 无边框 + 透明，用自绘标题栏，靠窗外亚克力模糊透出桌面。
    frame: !isFrameless,
    transparent: isFrameless,
    // 启动消除白屏：原生边框窗口等首帧渲染完成（ready-to-show）再显示；
    // 无边框(Win11)透明+亚克力窗口则用 show:true 立即显示——透明窗口在
    // show:false+ready-to-show 下会因渲染太快而无法正常上屏（见组件移植经验）。
    // backgroundColor 兜底防原生窗口白屏。
    show: isFrameless,
    backgroundColor: isFrameless ? '#00000000' : '#f9fafb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 标记渲染进程启用安全通道（preload 据此暴露 window.__SECURE_CHANNEL__，
      // 前端只在置位后才对业务 JSON API 启用加密传输）
      additionalArguments: ['--secure-channel'],
      // 开启 OS 级沙箱：即使注入成功也跑不出渲染进程安全边界。
      // 若 Electron 版本回退出现沙箱启动崩溃（binding.startupData 为 null），
      // 再回退为 false：contextIsolation + nodeIntegration:false 仍是软件层兜底。
      sandbox: true,
      // webSecurity 仅开发模式关闭（用于加载自签名 https 的 Vite 服务）；
      // 生产环境必须保持开启，禁止在打包后关闭网页安全策略。
      webSecurity: !isDev,
      // 窗口隐藏/最小化时自动节流渲染进程定时器与 rAF，降低后台内存与 CPU 占用
      backgroundThrottling: true,
      // 关闭拼写检查，节省渲染进程内存
      spellcheck: false,
      // 支持开发者工具（生产模式亦可手动打开，用于调试）
      devTools: true,
    }
  })

  // 立即绑定全局（供 theme-chrome 重建等判断）；内部事件全部用局部 win 引用，
  // 避免重建时旧窗口的 'closed' 事件把 mainWindow 置空，影响到刚创建的新窗口。
  mainWindow = win

  // Win11 主题（无边框透明窗口）：开启窗外亚克力模糊。
  // 其他主题为不透明的原生边框窗口，页面直接绘制背景，无需亚克力。
  // 注意：必须「立即」调用而非等 ready-to-show——透明窗口在 Windows 上 ready-to-show
  // 不可靠（小组件因此改用 show:true），等它可能永远不触发导致亚克力失效。
  // 模块内部会 getNativeWindowHandle()，窗口同步创建后 handle 已有效，直接调用即可。
  if (isFrameless && process.platform === 'win32' && setVibrancy) {
    try {
      setVibrancy(win, {
        // AARRGGBB：alpha 不能为 0（否则亚克力模糊不可见，窗口呈不通透实体）。
        // 用适度的白色着色（≈50% 白），让桌面背景模糊透出，同时保留磨砂质感。
        theme: '80FFFFFF',
        effect: 'acrylic',
        disableOnBlur: false,
        useCustomWindowRefreshMethod: false,
      })
      console.log('[acrylic] 主窗口亚克力已开启 (mode=frameless)')
    } catch (err) {
      // 若 handle 尚未就绪，交给 ready-to-show 兜底重试
      console.error('[acrylic] 主窗口亚克力立即开启失败，等待 ready-to-show 重试:', err?.message || err)
    }
  }

  if (isDev) {
    // 第一步：加载本地 inline 页面，窗口立即显示（< 1s）
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DEV_LOADING_HTML)}`)
    startupTimer.mark('开始加载 loading 页面')
    // loading 页首帧只作计时标记，不阻塞下面的 Vite 轮询
    win.webContents.once('did-finish-load', () => {
      if (win.webContents.getURL().startsWith('data:')) startupTimer.mark('loading 页面加载完成')
    })
    // 第二步：立即开始后台轮询 Vite（不再等 loading 页 did-finish-load 才发起），
    // 就绪后自动跳转。Vite 已在运行时可直接跳转，省下等 loading 页加载的数百毫秒。
    pollViteAndNavigate(win)
  } else {
    win.loadURL('app://local/index.html')
    // 生产模式：监听渲染进程的 [startup] 日志，记录 Vue 挂载时间
    win.webContents.on('console-message', (event, level, message) => {
      if (message.startsWith('[startup]')) {
        startupTimer.mark(message.replace('[startup] ', ''))
      }
    })
  }

  // 监听渲染进程的 [startup] 日志（开发模式也监听，Vite 页面跳转后生效）
  win.webContents.on('console-message', (event, level, message) => {
    if (message.startsWith('[startup]')) {
      startupTimer.mark(message.replace('[startup] ', ''))
    }
  })

  // 首帧渲染完成后再显示窗口，消除「先白屏再渲染」的启动观感。
  // 用局部 win 判断/显示，避免重建时 mainWindow 被旧窗口 closed 置空导致新窗口无法显示。
  win.once('ready-to-show', () => {
    startupTimer.mark('ready-to-show（窗口首次显示）')

    // 无边框(Win11)透明窗口：此时 native handle 已就绪，开启窗外亚克力模糊透出桌面。
    if (isFrameless && process.platform === 'win32' && setVibrancy) {
      console.log('[acrylic] ready-to-show，开启窗外亚克力')
      try {
        setVibrancy(win, {
          theme: '00FFFFFF', // alpha=0：只负责模糊，不染色、不画系统边框，边框/底色全交渲染层
          effect: 'acrylic',
          disableOnBlur: false,
          useCustomWindowRefreshMethod: false,
        })
        console.log('[acrylic] 主窗口亚克力已开启')
      } catch (err) {
        // handle 异常或系统不支持时降级为 CSS 半透明回退
        console.error('[acrylic] 主窗口亚克力开启失败，降级 CSS:', err?.message || err)
      }
    }

    if (!win.isDestroyed()) win.show()
  })

  // 主窗口关闭拦截：点击关闭时不直接关闭，而在窗口中央弹出"怎样关闭"菜单。
  // 覆盖系统 ✕ 与无边框自绘标题栏的关闭按钮（二者最终都触发 close 事件）。
  // 正在整体退出（app.quit）或用户已在菜单里选定关闭主窗口时不拦截。
  win.on('close', (e) => {
    if (app.isQuitting || allowMainClose) return
    e.preventDefault()
    if (shutdownMenuOpen) return
    shutdownMenuOpen = true
    // 关闭菜单由渲染层（主页面）弹出，复用现有弹窗组件与动画；
    // 仅当渲染层尚未就绪/不可用时回退到主进程原生菜单。
    if (!requestShutdownMenu(win)) {
      showShutdownMenu(win) // —— 由 requestShutdownMenu 内部针对未就绪的情况再置回 false
    }
  })

  win.on('closed', () => {
    // 仅当关闭的是当前引用的窗口时才清空，避免重建时旧窗口的 closed 事件误清新窗口
    if (mainWindow === win) {
      mainWindow = null
    }
  })
}

function createWidgetWindow() {
  widgetWindow = new BrowserWindow({
    width: 48,
    height: 48,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ['--secure-channel'],
      webSecurity: !isDev,
      backgroundThrottling: true,
      spellcheck: false,
      devTools: isDev,
    }
  })

  // 初始位置：屏幕左边缘中间
  const { height: screenH } = require('electron').screen.getPrimaryDisplay().workAreaSize
  widgetWindow.setPosition(0, Math.round(screenH / 2 - 24))

  if (process.platform === 'darwin') {
    widgetWindow.setWindowButtonVisibility(false)
  }

  if (isDev) {
    loadUrlWithRetry(widgetWindow, 'https://127.0.0.1:5173/widget.html')
  } else {
    widgetWindow.loadURL('app://local/widget.html')
  }

  widgetWindow.on('blur', () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.webContents.send('from-main', { type: 'blur' })
    }
  })

  // 窗口被拖动后做边界保护（防止完全拖出屏幕）
  widgetWindow.on('moved', () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      const [x, y] = widgetWindow.getPosition()
      const [width, height] = currentWidgetSize
      const { width: screenW, height: screenH } = require('electron').screen.getPrimaryDisplay().workAreaSize

      let newX = x
      let newY = y
      const minVisible = 50
      newX = Math.max(-width + minVisible, Math.min(newX, screenW - minVisible))
      newY = Math.max(-height + minVisible, Math.min(newY, screenH - minVisible))

      if (newX !== x || newY !== y) {
        widgetWindow.setPosition(newX, newY)
      }
    }
  })

  widgetWindow.on('closed', () => {
    widgetWindow = null
  })
}

// 创建桌面小组件：常驻桌面、鼠标穿透、不挡应用
function createDesktopWidgetWindow() {
  if (desktopWidgetWindow && !desktopWidgetWindow.isDestroyed()) return
  desktopWidgetWindow = new BrowserWindow({
    width: 320,
    height: 540,
    frame: false,
    // 需要 transparent: true 才能让 Win32 亚克力效果透出桌面背景
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ['--secure-channel'],
      webSecurity: !isDev,
      backgroundThrottling: true,
      spellcheck: false,
      devTools: true,
    }
  })

  // Windows 10/11 原生亚克力毛玻璃：走 Win32 API，不受 Win11「节能器」影响。
  // 颜色 alpha 置 0，让 CSS 边框/底色成为唯一可见边框；关闭库的自定义刷新避免额外边框。
  if (process.platform === 'win32' && setVibrancy) {
    try {
      setVibrancy(desktopWidgetWindow, {
        theme: '00FFFFFF',
        effect: 'acrylic',
        disableOnBlur: false,
        useCustomWindowRefreshMethod: false,
      })
    } catch (_) { /* 编译产物异常时忽略，走 CSS 半透明回退 */ }
  }
  // 初始位置：屏幕右上角，高度接近屏幕高度
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const widgetHeight = Math.round(screenH * 0.95)
  desktopWidgetWindow.setContentSize(320, widgetHeight)
  desktopWidgetWindow.setPosition(screenW - 340, Math.round((screenH - widgetHeight) / 2))

  if (process.platform === 'darwin') {
    desktopWidgetWindow.setWindowButtonVisibility(false)
  }

  if (isDev) {
    desktopWidgetWindow.loadURL('https://127.0.0.1:5173/desktop-widget.html')
  } else {
    desktopWidgetWindow.loadURL('app://local/desktop-widget.html')
  }

  desktopWidgetWindow.on('closed', () => {
    desktopWidgetWindow = null
  })
}

// 后端日志文件：位于用户数据目录，用于持久化记录后端启动/崩溃原因，方便排查无需再抓终端
let backendLogStream = null

function getBackendLogPath() {
  return path.join(app.getPath('userData'), 'data', 'backend.log')
}

function ensureBackendLogStream() {
  if (backendLogStream) return
  try {
    const logPath = getBackendLogPath()
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    backendLogStream = fs.createWriteStream(logPath, { flags: 'a' })
    fs.appendFileSync(logPath, `\n===== Electron 启动后端 @ ${new Date().toISOString()} =====\n`)
  } catch (err) {
    console.error('[main] 无法创建后端日志文件:', err.message)
  }
}

function backendLog(text) {
  ensureBackendLogStream()
  if (backendLogStream) backendLogStream.write(text)
  process.stdout.write(`[backend] ${text}`)
}

let backendRestartCount = 0
let backendRestartTimer = null

// 后端就绪检测：仅用于 stdout 分片匹配 + 日志，不再作为建窗信号
// （主窗口在 whenReady 后立即创建，与后端并行启动）
let readyBuffer = ''

// 项目根目录（含 node_modules 里的 electron 等）
const appRootDir = path.join(__dirname, '..')

function getBackendPaths() {
  const backendDir = isDev
    ? path.join(appRootDir, 'student-backend')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'student-backend')
  const backendPath = path.join(backendDir, 'app.js')
  return { backendDir, backendPath }
}

// 开发模式子进程：使用系统 node（child_process.fork）。开发环境本就安装 Node，
// 用它启动稳定、可打印「服务器已启动」，也避免 Electron 内置 Node 在开发机上
// 的 crashpad 进程级崩溃。
// 打包模式子进程：child_process.fork + execPath=electron.exe + ELECTRON_RUN_AS_NODE=1，
// 以 Electron 内置 Node 的纯 Node 模式运行后端，目标机无需安装 Node.js，
// 实现免依赖分发（原生模块已通过 @electron/rebuild 针对 Electron ABI 重编译）。
function compileBackendProcess() {
  const { backendDir, backendPath } = getBackendPaths()
  const dataDir = resolveDataDir()
  const thumbsDir = resolveThumbsDir()
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(thumbsDir, { recursive: true })

  // 统一的输出/退出处理
  const onData = (chunk) => {
    backendLog(chunk)
    detectBackendReady(chunk)
  }
  const onErrData = (chunk) => {
    ensureBackendLogStream()
    if (backendLogStream) backendLogStream.write(`[err] ${chunk}`)
    process.stderr.write(`[backend:err] ${chunk}`)
  }
  const onProcessorError = (err) => {
    const msg = `后端启动失败(error): ${err?.message || err}\n`
    ensureBackendLogStream()
    if (backendLogStream) backendLogStream.write(`[fatal] ${msg}`)
    console.error('[main]', msg)
  }
  const onExit = (code, signal) => {
    const msg = `后端进程退出，码: ${code}, signal: ${signal} @ ${new Date().toISOString()}\n`
    ensureBackendLogStream()
    if (backendLogStream) backendLogStream.write(`[exit] ${msg}`)
    console.log(`[main] ${msg}`)
  }
  const onDisconnect = () => {
    const msg = `后端进程已断开连接 @ ${new Date().toISOString()}\n`
    ensureBackendLogStream()
    if (backendLogStream) backendLogStream.write(`[disconnect] ${msg}`)
    console.log(`[main] ${msg}`)
  }

  if (isDev) {
    // 开发模式：托管系统 node。注意：Electron 主进程中 child_process.fork 默认
    // execPath 是 process.execPath（electron.exe），会导致子进程用 Electron 内置
    // Node 运行后端并崩溃。必须显式指定系统 node 的可执行文件路径。
    // 用异步 exec 探测系统 node（而非 execFileSync 同步阻塞主线程），
    // 让后端 fork 与 createMainWindow 的初始化真正并行推进。
    const { fork, execFile } = require('child_process')
    const spawnDev = (execPath) => {
      const child = fork(backendPath, [], {
        cwd: backendDir,
        execPath,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          DATA_DIR: dataDir,
          ALBUM_THUMBS_DIR: thumbsDir,
          SECURE_MASTER: getMasterKey(),
          DB_MASTER_KEY: getDbMasterKey(),
        },
      })
      backendProcess = child
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onErrData)
      child.on('error', onProcessorError)
      child.on('exit', onExit)
      child.on('exit', scheduleBackendRestart)
      child.on('disconnect', onDisconnect)
    }
    if (process.env.NODE_EXEC_PATH) {
      spawnDev(process.env.NODE_EXEC_PATH)
      return
    }
    execFile('node', ['-p', 'process.execPath'], { encoding: 'utf8' }, (err, out) => {
      spawnDev(err ? 'node' : out.trim())
    })
    return
  }

  // 打包模式：用 Electron 内置 Node 以「纯 Node 模式」运行后端。
  // 关键：execPath 指向 process.execPath（electron.exe）+ ELECTRON_RUN_AS_NODE=1，
  // 让子进程以纯 Node.js 运行时启动，不连接 Electron crashpad，也不初始化界面，
  // 因此不会出现 utilityProcess 在 Windows 上的「not connected」进程级崩溃。
  // 原生模块已针对 Electron ABI 重编译（@electron/rebuild），目标机无需安装 Node.js。
  const { fork } = require('child_process')
  backendProcess = fork(backendPath, [], {
    cwd: backendDir,
    execPath: process.execPath,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      ALBUM_THUMBS_DIR: thumbsDir,
      ELECTRON_RUN_AS_NODE: '1',
      SECURE_MASTER: getMasterKey(),
      DB_MASTER_KEY: getDbMasterKey(),
    },
  })

  backendProcess.stdout?.on('data', onData)
  backendProcess.stderr?.on('data', onErrData)
  backendProcess.on('error', onProcessorError)
  backendProcess.on('exit', onExit)
  backendProcess.on('exit', scheduleBackendRestart)
  backendProcess.on('disconnect', onDisconnect)
}

function startBackend() {
  // 重启保护：仅当应用仍在运行时才重启，且限制最多 10 次，避免无限崩溃循环刷屏
  if (backendRestartCount >= 10) {
    const msg = `后端在启动阶段连续崩溃 ${backendRestartCount} 次，已停止自动重启。请查看日志：${getBackendLogPath()}\n`
    ensureBackendLogStream()
    if (backendLogStream) backendLogStream.write(`[fatal] ${msg}`)
    console.error(`[main] ${msg}`)
    return
  }

  ensureBackendLogStream()
  backendLog(`[main] 正在启动后端 (第 ${backendRestartCount + 1} 次)...\n`)

  compileBackendProcess()
}

// 后端子进程退出后自动重启：用一个短延迟把退出与重启解耦，避免同一个 exit 触发多次重启。
// 绑定发生在「实际 fork 成立后」（见 compileBackendProcess 内两种 fork 分支），
// 兼容开发模式下「异步探测 system node 后才 fork」的场景。
function scheduleBackendRestart() {
  clearTimeout(backendRestartTimer)
  backendRestartTimer = setTimeout(() => {
    if (app.isQuitting) return
    backendRestartCount += 1
    backendProcess = null
    startBackend()
  }, 1500)
}

// 打包模式静态资源 MIME 表
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
}

// 注册 app:// 协议：从打包产物目录安全地提供静态文件（支持 asar 内 fs 流式读取）。
function setupAppProtocol() {
  if (isDev) return
  const distDir = path.join(__dirname, '../student-frontend/dist')
  const root = path.normalize(distDir)
  protocol.handle('app', (req) => {
    try {
      const url = new URL(req.url)
      let p = decodeURIComponent(url.pathname)
      if (p === '/' || p === '') p = '/index.html'
      // 防目录穿越
      const file = path.normalize(path.join(root, p))
      console.log(`[app://] 请求: ${p} → ${file}`)
      if (file !== root && !file.startsWith(root + path.sep)) {
        console.log(`[app://] 禁止访问: ${file}`)
        return new Response('Forbidden', { status: 403 })
      }
      // 目录或缺失：SPA 路由回退 index.html
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        console.log(`[app://] 文件不存在，回退 index.html: ${file}`)
        return new Response(Readable.toWeb(fs.createReadStream(path.join(root, 'index.html'))), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
      const ct = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
      // hash 命名的编译产物（.js/.css/.wasm/图片等）可长缓存，让二次及以后启动直接命中磁盘缓存，
      // 免去每次重新读盘与解析前端 bundle，显著加快启动；入口 html 则 no-cache，避免升级后拿到旧壳。
      const headers = { 'content-type': ct }
      headers['cache-control'] = /\.(js|css|wasm|png|jpe?g|gif|webp|svg|woff2?)(\?.*)?$/i.test(file)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache'
      console.log(`[app://] 已提供: ${file} (${ct})`)
      return new Response(Readable.toWeb(fs.createReadStream(file)), { headers })
    } catch (_) {
      return new Response('Not Found', { status: 404 })
    }
  })
}

// 「桌面小组件按需创建」：主窗口渲染层延迟到「首帧真正空闲」才回报，主进程据此错峰创建桌面小组件窗口，
// 无固定延迟；未启用则不创建。
let desktopEnabled = true

function scheduleCreateDesktop() {
  if (!desktopEnabled) return
  if (!desktopWidgetWindow || desktopWidgetWindow.isDestroyed()) {
    createDesktopWidgetWindow()
    startupTimer.mark('桌面组件创建完成')
  }
}

function setDesktopEnabled(enabled) {
  desktopEnabled = !!enabled
  if (desktopEnabled) {
    scheduleCreateDesktop()
  } else if (desktopWidgetWindow && !desktopWidgetWindow.isDestroyed()) {
    // 关闭桌面小组件窗口（不影响主窗口与后端，不触发 window-all-closed 退出）
    desktopWidgetWindow.close()
  }
}

// 主窗口渲染层空闲回报：同时创建工具箱浮窗，并（按启用状态）创建/关闭桌面小组件窗口
ipcMain.on('widgets-ready', (event, enabled) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (event.sender !== mainWindow.webContents) return
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    createWidgetWindow()
    startupTimer.mark('widget 创建完成')
  }
  setDesktopEnabled(!!enabled)
})

// 设置页切换「桌面小组件」开关时实时建/关窗口（不依赖空闲时机）
ipcMain.on('desktop-widget-enabled', (event, enabled) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (event.sender !== mainWindow.webContents) return
  setDesktopEnabled(enabled)
})

// 后端就绪检测：后端 app.listen 回调会打印「服务器已启动」，这里仅作日志提示，
// 不再触发建窗（主窗口已提前创建）。stdout 可能被分片，做滚动缓冲 + 子串匹配。
function detectBackendReady(chunk) {
  readyBuffer += String(chunk)
  if (readyBuffer.length > 4096) readyBuffer = readyBuffer.slice(-4096)
  if (!/服务器已启动|listening|server started/i.test(readyBuffer)) return
  readyBuffer = ''
  startupTimer.mark('后端就绪')
  console.log('[main] 后端已就绪')
}

app.whenReady().then(() => {
  startupTimer.mark('app.whenReady 就绪')

  // 未拿到单实例锁：说明已有另一个实例在运行，本实例直接退出
  if (!gotSingleInstanceLock) {
    app.quit()
    return
  }

  try {
    setupAppProtocol()
    startupTimer.mark('协议注册完成')

    // 先 fire 后端：fork 子进程立刻启动，与下方 createMainWindow 的同步初始化并行推进，
    // 不再等主窗口创建完成后再启动后端（省去串行等待，后端更早就绪）。
    startBackend()
    startupTimer.mark('startBackend 完成')

    // 主窗口立即创建：它加载的静态前端（app://local/index.html 或 dev 的 Vite）不依赖后端，
    // 登录页/首页骨架无需后端即可渲染，前端通过 axios 响应重试兜底「后端未就绪」的短暂窗口。
    createMainWindow()
    startupTimer.mark('createMainWindow 完成')

    // 5s 后输出启动时间线并保存日志
    setTimeout(() => {
      startupTimer.report()
      startupTimer.saveLog()
    }, 5000)

    // U盘自动打开非启动关键路径：延后到主窗口创建后再读配置/开监听，
    // 避免 loadUsbAutoOpenConfig 读盘与 getDriveLetters 同步遍历盘符阻塞主窗口创建。
    setTimeout(() => {
      loadUsbAutoOpenConfig()
      if (usbAutoOpenEnabled) startUsbWatch()
    }, 0)
  } catch (err) {
    console.error('[main] app.whenReady 初始化失败:', err)
  }
}).catch(err => {
  console.error('[main] app.whenReady 未捕获错误:', err)
})

// ========== U盘自动打开 ==========
// 检测到新 U 盘插入时，自动用文件资源管理器打开它（仅 Windows 生效）。
// 开关持久化在 userData/usb-auto-open.json，与后端业务数据库解耦，主进程启动即可读到。
let usbAutoOpenEnabled = false
let usbPollTimer = null
let knownDrives = new Set()

function getUsbConfigPath() {
  return path.join(app.getPath('userData'), 'usb-auto-open.json')
}

function loadUsbAutoOpenConfig() {
  try {
    usbAutoOpenEnabled = !!JSON.parse(fs.readFileSync(getUsbConfigPath(), 'utf8')).enabled
  } catch (_) {
    usbAutoOpenEnabled = false
  }
}

function saveUsbAutoOpenConfig(enabled) {
  try { fs.writeFileSync(getUsbConfigPath(), JSON.stringify({ enabled })) } catch (_) {}
}

// 遍历 A-Z，返回当前所有存在的盘符集合（fs.access 探测，零依赖）
function getDriveLetters() {
  const drives = new Set()
  for (let i = 65; i <= 90; i++) {
    const drive = `${String.fromCharCode(i)}:\\`
    try { fs.accessSync(drive); drives.add(drive) } catch (_) {}
  }
  return drives
}

function startUsbWatch() {
  if (usbPollTimer || !usbAutoOpenEnabled) return
  // 用启动瞬间已挂载的盘做基线，避免把「本就在」的 U 盘误打开一次
  knownDrives = getDriveLetters()
  usbPollTimer = setInterval(() => {
    const current = getDriveLetters()
    for (const drive of current) {
      if (!knownDrives.has(drive)) {
        console.log(`[main] 检测到新存储设备：${drive}，自动打开`)
        shell.openPath(drive)
      }
    }
    knownDrives = current
  }, 1500)
}

function stopUsbWatch() {
  clearInterval(usbPollTimer)
  usbPollTimer = null
}

// 读取开关状态（供设置页初始化）
ipcMain.handle('get-usb-auto-open', () => ({ enabled: usbAutoOpenEnabled }))

// 在系统默认浏览器打开外链
ipcMain.handle('open-external', (event, url) => {
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url)
  }
})

// ========== 桌面小组件·常用软件 ==========
// 列表已改由后端数据库持久化（/api/widget-settings/apps），主进程仅负责
// 「选择软件文件+提取图标」和「点击启动」两项平台能力。
// 每项：{ id, name, path, icon }（icon 为提取自 exe/.lnk 图标的 dataURL，可为空）。

// 解析 .lnk 快捷方式的目标可执行程序路径（仅接受 .exe 目标，供取图标用）
async function resolveLnkTarget(lnkPath) {
  const { execFile } = require('child_process')
  return new Promise((resolve) => {
    const ps = [
      '-NoProfile', '-NonInteractive', '-Command',
      `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${lnkPath.replace(/'/g, "''")}'); if($s.TargetPath){$s.TargetPath}`,
    ]
    execFile('powershell.exe', ps, { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve('')
      const target = (stdout || '').trim()
      resolve(path.extname(target).toLowerCase() === '.exe' ? target : '')
    })
  })
}

// 打开"选择软件程序/快捷方式"对话框，并提取其图标为 dataURL 返回
ipcMain.handle('apps-select-file', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true, error: '无主窗口' }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择常用软件',
    properties: ['openFile'],
    defaultPath: lastDialogDir || undefined,
    filters: [
      { name: '可执行程序与快捷方式', extensions: ['exe', 'lnk', 'bat', 'cmd'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return { canceled: true }
  const filePath = result.filePaths[0]
  lastDialogDir = path.dirname(filePath)
  const ext = path.extname(filePath).toLowerCase()
  let name = path.basename(filePath, ext) || filePath
  // bat/cmd 显示名字会带扩展名，去掉小尾巴，更整洁
  if (['.bat', '.cmd'].includes(ext)) name = path.basename(filePath, ext)
  let icon = ''
  try {
    // 快捷方式(.lnk)本身取不到目标程序图标，先解析出目标 exe 再取其图标
    const iconTarget = ext === '.lnk' ? await resolveLnkTarget(filePath) : ''
    const img = await app.getFileIcon(iconTarget || filePath, { size: 'large' })
    icon = img.toDataURL()
  } catch (_) { /* 图标提取失败则留空 */ }
  return { canceled: false, filePath, name, icon }
})

// 点击启动常用软件（.lnk/.exe/.bat 均可走 shell.openPath）
ipcMain.handle('apps-launch', (event, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { error: '路径为空' }
  shell.openPath(filePath)
  return {}
})

// 设置开关：持久化并实时启停监听
ipcMain.handle('set-usb-auto-open', (event, enabled) => {
  usbAutoOpenEnabled = !!enabled
  saveUsbAutoOpenConfig(usbAutoOpenEnabled)
  if (usbAutoOpenEnabled) startUsbWatch()
  else stopUsbWatch()
  return { enabled: usbAutoOpenEnabled }
})

// 调整小组件窗口大小（带边界保护，防止超出屏幕）
ipcMain.on('widget-resize', (event, [width, height]) => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.setContentSize(width, height)
    const [actualW, actualH] = widgetWindow.getContentSize()
    currentWidgetSize = [actualW, actualH]

    // 边界保护：确保窗口不超出屏幕
    const [x, y] = widgetWindow.getPosition()
    const { width: screenW, height: screenH } = require('electron').screen.getPrimaryDisplay().workAreaSize

    let newX = x
    let newY = y

    // 右边界保护
    if (newX + width > screenW) {
      newX = screenW - width
    }
    // 左边界保护
    if (newX < 0) {
      newX = 0
    }
    // 下边界保护
    if (newY + height > screenH) {
      newY = screenH - height
    }
    // 上边界保护
    if (newY < 0) {
      newY = 0
    }

    if (newX !== x || newY !== y) {
      widgetWindow.setPosition(newX, newY)
    }
  }
})

// 将窗口移动到指定位置
ipcMain.on('widget-move-to', (event, position) => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    const { height: screenH } = require('electron').screen.getPrimaryDisplay().workAreaSize
    const [winWidth, winHeight] = widgetWindow.getSize()
    if (position === 'left-middle') {
      const x = 0
      const y = Math.round((screenH - winHeight) / 2)
      widgetWindow.setPosition(x, y)
    }
  }
})

let lastIconPosition = null
let currentWidgetSize = [48, 48] // 记录预期窗口尺寸，防止拖动时漂移
let dragStartWindowPos = null
let dragStartMousePos = null
let dragStartWindowSize = null

// 将窗口居中显示（同时保存居中前的位置，以便关闭工具后恢复）
ipcMain.on('widget-center', () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    lastIconPosition = widgetWindow.getPosition()
    widgetWindow.center()
  }
})

// 恢复图标之前保存的位置
ipcMain.on('widget-restore-position', () => {
  if (widgetWindow && !widgetWindow.isDestroyed() && lastIconPosition) {
    widgetWindow.setPosition(lastIconPosition[0], lastIconPosition[1])
  }
})

// 全屏小组件（用于注释工具）
let preFullscreenBounds = null
ipcMain.on('widget-fullscreen', () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    preFullscreenBounds = {
      pos: widgetWindow.getPosition(),
      size: widgetWindow.getContentSize()
    }
    const { x, y, width, height } = screen.getPrimaryDisplay().bounds
    widgetWindow.setPosition(x, y)
    widgetWindow.setContentSize(width, height)
    widgetWindow.setAlwaysOnTop(true)
    widgetWindow.focus()
    currentWidgetSize = [width, height]
  }
})

// 从全屏恢复
ipcMain.on('widget-restore', () => {
  if (widgetWindow && !widgetWindow.isDestroyed() && preFullscreenBounds) {
    widgetWindow.setPosition(preFullscreenBounds.pos[0], preFullscreenBounds.pos[1])
    widgetWindow.setContentSize(preFullscreenBounds.size[0], preFullscreenBounds.size[1])
    widgetWindow.setAlwaysOnTop(true)
    widgetWindow.focus()
    currentWidgetSize = preFullscreenBounds.size
    preFullscreenBounds = null
  }
})

// 设置窗口是否忽略鼠标事件（true=透明区域穿透，false=正常接收）
ipcMain.on('widget-set-ignore-mouse', (event, ignore) => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.setIgnoreMouseEvents(ignore, { forward: true })
  }
})

// 设置工具箱可见性
ipcMain.on('widget-set-visible', (event, visible) => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    if (visible) {
      widgetWindow.setOpacity(1)
      widgetWindow.setIgnoreMouseEvents(false)
      widgetWindow.focus()
    } else {
      widgetWindow.setOpacity(0)
      widgetWindow.setIgnoreMouseEvents(true, { forward: true })
    }
  }
})

// 拖动开始：记录窗口初始位置、尺寸和鼠标初始位置
ipcMain.on('widget-drag-start', (event, { screenX, screenY }) => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    dragStartWindowPos = widgetWindow.getPosition()
    dragStartWindowSize = widgetWindow.getSize()
    dragStartMousePos = [screenX, screenY]
  }
})

// 工具箱浮窗右键菜单：当前提供「本次退出」，仅关闭浮窗（隐藏 widget），主程序与后端保留运行
ipcMain.on('widget-context-menu', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const menu = Menu.buildFromTemplate([
    {
      label: '本次退出',
      click: () => {
        sessionWidgetEnabled = false
        if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.hide()
        // 通知设置页同步「本次启用工具箱」开关为关闭
        mainWindow?.webContents.send('from-main', { type: 'session-widget-changed' })
      },
    },
  ])
  menu.popup({ window: win || undefined })
})

// 会话级「本次启用工具箱」：仅影响本次运行浮窗显隐，不持久化
ipcMain.on('widget-set-session-visible', (event, enabled) => {
  sessionWidgetEnabled = !!enabled
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    if (sessionWidgetEnabled) widgetWindow.show()
    else widgetWindow.hide()
  }
})

// 读取会话级开关；未初始化（尚未注入本次默认值）返回 null
ipcMain.handle('get-session-widget-visible', () => sessionWidgetEnabled)

// 桌面组件获取主窗口的 token（跨渲染进程共享，避免 cookie/localStorage 隔离）
ipcMain.handle('get-main-token', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.webContents.executeJavaScript('localStorage.getItem("token")', true)
  }
  return null
})

// 安全通道主密钥：提供给渲染进程（含工具箱/桌面组件）参与前后端 HKDF 派生态。
ipcMain.handle('get-master-key', () => getMasterKey())

// ============ 无边框自绘标题栏的窗口控制 ============
// 关闭确认菜单：点主窗口右上角关闭时居中弹出，让用户选择关闭范围。
// 菜单由**渲染层**用现有弹窗组件 + dialog-transition 动画弹出（触感一致）；
// 仅当渲染层尚未就绪（如启动瞬间点系统 ✕）时，回退到主进程原生菜单。
// 核心约束：只要还有任意窗口（含工具箱/桌面组件）存在，就由 window-all-closed 保证不关后端；
// 当最后一个窗口（组件）被关闭后自动触发 window-all-closed，从而关闭后端并退出。

// 渲染层是否已就绪可弹关闭菜单：由渲染层 ready 时经 shutdown-action 回报
let mainRendererShutdownReady = false

// 请求渲染层在窗口中央弹出关闭菜单；渲染层未就绪/发送失败返回 false
function requestShutdownMenu(win) {
  if (!mainRendererShutdownReady) return false
  const ex = (w) => !!(w && !w.isDestroyed())
  try {
    win.webContents.send('from-main', {
      type: 'shutdown-menu',
      hasToolbox: ex(widgetWindow),
      hasDesktop: ex(desktopWidgetWindow),
    })
    return true
  } catch (_) {
    return false
  }
}

// 统一的「按所选范围关闭」逻辑：渲染层回传与原生菜单回退共用，避免重复
function closeMainWith(action) {
  shutdownMenuOpen = false
  if (action === 'all') { app.quit(); return }
  // 关闭组件（桌面组件窗口或工具箱窗口）后再关主窗口；组件未开启时无副作用
  if (action === 'toolbox' && widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close()
  if (action === 'desktop' && desktopWidgetWindow && !desktopWidgetWindow.isDestroyed()) desktopWidgetWindow.close()
  allowMainClose = true
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close() // 主窗口关闭：组件保留时后端仍存活
}

// 渲染层回报：就绪标记 / 用户选择（action）/ 取消
ipcMain.on('shutdown-action', (event, data) => {
  if (!data) return
  if (data === 'ready' || data?.type === 'ready') { mainRendererShutdownReady = true; return }
  if (data === 'cancel' || data?.action === 'cancel') { shutdownMenuOpen = false; return }
  const action = (typeof data === 'string' ? data : data?.action)
  closeMainWith(action === 'desktop' || action === 'toolbox' || action === 'all' || action === 'main' ? action : 'main')
})

// 原生菜单回退：仅渲染层未就绪时使用
function showShutdownMenu(win) {
  shutdownMenuOpen = true
  const ex = (w) => !!(w && !w.isDestroyed())
  const bounds = win.getBounds()
  // 组件不存在（未开启）时对应菜单项置灰，避免点了没反应造成困惑
  const menu = Menu.buildFromTemplate([
    { label: '关闭主窗口', click: () => closeMainWith('main') },
    { label: '关闭主窗口和工具箱', enabled: ex(widgetWindow), click: () => closeMainWith('toolbox') },
    { label: '关闭主窗口和桌面组件', enabled: ex(desktopWidgetWindow), click: () => closeMainWith('desktop') },
    { type: 'separator' },
    { label: '关闭所有窗口及其后端', click: () => closeMainWith('all') },
  ])
  // 菜单关闭（Esc / 点击空白）时复位，允许下次再弹
  menu.popup({
    window: win,
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
    callback: () => { shutdownMenuOpen = false },
  })
}

// 最小化
ipcMain.on('win-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) win.minimize()
})
// 最大化 / 还原
ipcMain.on('win-maximize-toggle', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
// 关闭
ipcMain.on('win-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) win.close()
})

// ============ 主题 → 窗口边框/亚克力开关 ============
// 渲染进程在切换主题时上报所需的边框类型：
//   - 毛玻璃等其他主题 → 'native'：重建为系统原生边框（标题栏/最小化/最大化/关闭回归原生）；
//   - Win11 主题 → 'frameless'：重建为无边框透明窗口，并在 createMainWindow 内开启窗外亚克力。
// 边框无法在运行中切换，仅当目标类型与当前不同时才重建，避免重复刷新。
// 重建会重载页面：主题、登录态均持久化在 localStorage，重载后由渲染层 applyTheme 恢复。
function recreateMainWindow(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindowChrome === mode) return
  // 记住旧窗口的位置、大小、最大化状态，重建后恢复，避免窗口跳位
  const bounds = mainWindow.getBounds()
  const wasMaximized = mainWindow.isMaximized()
  mainWindow.destroy()
  createMainWindow(mode)
  if (!mainWindow.isDestroyed()) {
    mainWindow.setBounds(bounds)
    if (wasMaximized) mainWindow.maximize()
  }
}

ipcMain.on('theme-chrome', (event, { mode }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win !== mainWindow) return
  const desired = mode === 'frameless' ? 'frameless' : 'native'
  recreateMainWindow(desired)
})

// 拖动中：使用 setContentBounds 与 setContentSize 保持一致，避免 setBounds/setSize 边界计算差异
ipcMain.on('widget-drag-move', (event, { screenX, screenY }) => {
  if (widgetWindow && !widgetWindow.isDestroyed() && dragStartWindowPos && dragStartMousePos && dragStartWindowSize) {
    const dx = screenX - dragStartMousePos[0]
    const dy = screenY - dragStartMousePos[1]
    let newX = Math.round(dragStartWindowPos[0] + dx)
    let newY = Math.round(dragStartWindowPos[1] + dy)

    const [width, height] = dragStartWindowSize
    const { width: screenW, height: screenH } = require('electron').screen.getPrimaryDisplay().workAreaSize

    const minVisible = 50
    newX = Math.max(-width + minVisible, Math.min(newX, screenW - minVisible))
    newY = Math.max(-height + minVisible, Math.min(newY, screenH - minVisible))

    widgetWindow.setContentBounds({ x: newX, y: newY, width, height })
  }
})

// 拖动结束：确保尺寸正确
ipcMain.on('widget-drag-end', () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    const w = currentWidgetSize[0]
    const h = currentWidgetSize[1]
    widgetWindow.setContentSize(w, h)
  }
})

// 主应用 -> 小组件
ipcMain.on('to-widget', (event, data) => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send('from-main', data)
  }
})

// 小组件 -> 主应用
ipcMain.on('to-main', (event, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('from-widget', data)
  }
})

// Electron 43 起，未传 defaultPath 时对话框默认打开「下载」目录，且系统不再记忆上次访问目录
// （43.0 breaking change）。这里自行记忆上次目录并回填 defaultPath，恢复 31 之前的体验。
let lastDialogDir = null

// 选择文件夹对话框
ipcMain.handle('select-folder', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { filePaths: [] }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: lastDialogDir || undefined,
  })
  if (!result.canceled && result.filePaths.length > 0) {
    lastDialogDir = result.filePaths[0]
  }
  return result
})

// 在文件管理器中打开指定文件夹
ipcMain.handle('open-folder', async (event, folderPath) => {
  if (!folderPath) return { error: '路径为空' }
  shell.openPath(folderPath)
  return {}
})

// ========== 数据目录 / 缓存目录（可自定义，含整体搬迁） ==========
// 当前数据目录与缓存目录信息（供设置页展示）
ipcMain.handle('get-data-directories', () => {
  return {
    dataDir: resolveDataDir(),
    thumbsDir: resolveThumbsDir(),
    defaultDataDir: path.join(app.getPath('userData'), 'data'),
    screenshotDir: path.join(app.getPath('pictures'), 'screenshots'),
  }
})

// 递归拷贝一个目录的内容（含子目录），用于数据目录整体搬迁
function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const ent of entries) {
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isDirectory()) {
      copyRecursive(s, d)
    } else {
      fs.mkdirSync(path.dirname(d), { recursive: true })
      fs.copyFileSync(s, d)
    }
  }
}

// 停止后端子进程（不清 isQuitting 标志，便于随后重启）
function stopBackendProcess() {
  clearTimeout(backendRestartTimer)
  if (backendProcess) {
    try { backendProcess.kill() } catch (_) {}
    backendProcess = null
  }
}

// 变更「数据库目录」：先停后端释放文件锁 → 把旧目录整体拷贝到新目录 → 更新配置 → 重启后端。
// 采用「拷贝成功后再删旧目录」而非直接 move，避免中途失败时旧数据被破坏。
ipcMain.handle('set-data-dir', async (event, dir) => {
  const target = path.resolve(String(dir || ''))
  const oldDir = resolveDataDir()
  if (!target || target.toLowerCase() === oldDir.toLowerCase()) {
    return { ok: true, dataDir: oldDir, changed: false }
  }
  // 防循环：不允许把数据目录迁到它自身内部
  const rel = path.relative(oldDir, target)
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error('新目录不能位于当前数据目录内部')
  }
  if (target === oldDir) return { ok: true, dataDir: oldDir, changed: false }
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true })
  // 目标目录须为空（或不存在），避免与已有文件/旧数据混淆
  if (fs.readdirSync(target).length > 0 && fs.readdirSync(oldDir).length > 0) {
    throw new Error('目标目录非空，请选择空目录')
  }
  stopBackendProcess()
  try {
    copyRecursive(oldDir, target)
    saveAppConfig({ dataDir: target })
    fs.rmSync(oldDir, { recursive: true, force: true })
  } catch (err) {
    // 搬迁失败：删除可能已拷贝的部分，保留旧目录与人可读错误
    try { fs.rmSync(target, { recursive: true, force: true }) } catch (_) {}
    console.error('[main] 数据目录搬迁失败:', err?.message || err)
    throw new Error('数据搬迁失败：' + (err?.message || err))
  } finally {
    startBackend()
  }
  return { ok: true, dataDir: target, changed: true }
})

// 变更「相册缩略图缓存目录」：缩略图是可再生的缓存，无需搬迁文件，
// 直接更新配置并重启后端，让后端使用新缓存目录，已有小图按需重建。
ipcMain.handle('set-thumbs-dir', async (event, dir) => {
  const target = path.resolve(String(dir || ''))
  const oldDir = resolveThumbsDir()
  if (!target || target.toLowerCase() === oldDir.toLowerCase()) {
    return { ok: true, thumbsDir: oldDir, changed: false }
  }
  fs.mkdirSync(target, { recursive: true })
  saveAppConfig({ thumbsDir: target })
  stopBackendProcess()
  try { startBackend() } catch (_) {}
  return { ok: true, thumbsDir: target, changed: true, oldThumbsDir: oldDir }
})

// 选择图片文件对话框（用于背景图片）
ipcMain.handle('select-image-file', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true, filePaths: [] }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    defaultPath: lastDialogDir || undefined,
    filters: [
      { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (!result.canceled && result.filePaths.length > 0) {
    lastDialogDir = path.dirname(result.filePaths[0])
    const filePath = result.filePaths[0]
    // 检查文件大小（限制 50MB）
    const fileStat = fs.statSync(filePath)
    const maxSize = 50 * 1024 * 1024 // 50MB
    if (fileStat.size > maxSize) {
      return { canceled: true, error: '图片大小超过 50MB，请选择更小的图片' }
    }
    // 将文件复制到后端 uploads/background 目录
    // 打包后 __dirname 位于只读 asar 内，必须写到 userData/data/uploads/background（与后端 DATA_DIR 一致）
    const bgDir = path.join(app.getPath('userData'), 'data', 'uploads', 'background')
    if (!fs.existsSync(bgDir)) {
      fs.mkdirSync(bgDir, { recursive: true })
    }
    const fileName = `bg_${Date.now()}${path.extname(filePath)}`
    const destPath = path.join(bgDir, fileName)
    fs.copyFileSync(filePath, destPath)
    // 根据环境返回不同的 URL
    let imageUrl
    if (isDev) {
      // 开发模式：通过 Vite 代理访问 /api/background
      imageUrl = `/api/background/${fileName}`
    } else {
      // 生产模式：直接请求后端 API
      imageUrl = `http://localhost:3000/api/background/${fileName}`
    }
    return { canceled: false, filePath: destPath, fileUrl: imageUrl, originalName: path.basename(filePath) }
  }
  return result
})

// 保存背景图片（用于大图片，前端传入 base64）
ipcMain.handle('save-background-image', async (event, { name, base64 }) => {
  try {
    const bgDir = path.join(app.getPath('userData'), 'data', 'uploads', 'background')
    if (!fs.existsSync(bgDir)) {
      fs.mkdirSync(bgDir, { recursive: true })
    }
    // 从原始文件名获取扩展名
    const ext = name ? path.extname(name) || '.png' : '.png'
    const fileName = `bg_${Date.now()}${ext}`
    const destPath = path.join(bgDir, fileName)
    // 将 base64 写入文件
    const buffer = Buffer.from(base64, 'base64')
    fs.writeFileSync(destPath, buffer)
    // 根据环境返回不同的 URL
    let imageUrl
    if (isDev) {
      imageUrl = `/api/background/${fileName}`
    } else {
      imageUrl = `http://localhost:3000/api/background/${fileName}`
    }
    return { success: true, url: imageUrl, fileName }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// 导出文件保存对话框：用户确认保存后才写入文件并返回
ipcMain.handle('save-file', async (event, { defaultName, data }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true }
  const ext = path.extname(defaultName) || ''
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存文件',
    defaultPath: lastDialogDir ? path.join(lastDialogDir, defaultName) : defaultName,
    filters: ext ? [{ name: '文件', extensions: [ext.replace('.', '')] }] : undefined
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  try {
    const buffer = Buffer.from(data)
    fs.writeFileSync(result.filePath, buffer)
    lastDialogDir = path.dirname(result.filePath)
    return { canceled: false, filePath: result.filePath }
  } catch (err) {
    return { canceled: true, error: err.message }
  }
})

// 一键截屏：截取整个屏幕并保存到本地
// options.hideWidget: 是否隐藏 widget 窗口（默认 true）。截屏工具传 false 以保持 spinner 可见
ipcMain.handle('screenshot-capture', async (event, options) => {
  const hideWidget = options?.hideWidget !== false
  let wasVisible = false
  if (hideWidget && widgetWindow && !widgetWindow.isDestroyed()) {
    wasVisible = widgetWindow.isVisible()
    if (wasVisible) widgetWindow.setOpacity(0)
    // 等待一帧确保窗口已隐藏
    await new Promise(resolve => setTimeout(resolve, 150))
  }

  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.size
    const scaleFactor = primaryDisplay.scaleFactor || 1

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width * scaleFactor), height: Math.round(height * scaleFactor) }
    })

    const primarySource = sources.find(s => s.display_id === String(primaryDisplay.id)) || sources[0]
    const image = primarySource.thumbnail.toPNG()

    const saveDir = options?.saveDir || path.join(app.getPath('pictures'), 'screenshots')
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = path.join(saveDir, `screenshot_${timestamp}.png`)
    fs.writeFileSync(filePath, image)

    // dataUrl 仅按需生成：整屏 PNG base64 在主进程/IPC/渲染进程各持一份，
    // 内存开销大。默认生成以兼容旧调用；调用方（Screenshot.vue）不需要时可关闭。
    const withDataUrl = options?.withDataUrl !== false
    const dataUrl = withDataUrl ? `data:image/png;base64,${image.toString('base64')}` : ''
    return { success: true, filePath, dataUrl }
  } finally {
    // 恢复 widget 窗口透明度
    if (wasVisible && widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.setOpacity(1)
      // 显式恢复鼠标事件和焦点，避免 setOpacity 后透明窗口丢失交互
      widgetWindow.setIgnoreMouseEvents(false)
      widgetWindow.focus()
    }
  }
})

// 保存注释后的截图
ipcMain.handle('note-save', async (event, uint8Array, options) => {
  const buffer = Buffer.from(uint8Array)
  const saveDir = options?.saveDir || path.join(app.getPath('pictures'), 'screenshots')
  if (!fs.existsSync(saveDir)) {
    fs.mkdirSync(saveDir, { recursive: true })
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filePath = path.join(saveDir, `note_${timestamp}.png`)
  fs.writeFileSync(filePath, buffer)
  return { success: true, filePath }
})

app.isQuitting = false

function shutdownBackend() {
  app.isQuitting = true
  clearTimeout(backendRestartTimer)
  if (backendProcess) {
    try { backendProcess.kill() } catch (_) {}
    backendProcess = null
  }
  if (backendLogStream) {
    try { backendLogStream.end() } catch (_) {}
    backendLogStream = null
  }
}

app.on('window-all-closed', () => {
  shutdownBackend()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
    createWidgetWindow()
  }
})

app.on('before-quit', () => {
  shutdownBackend()
})
