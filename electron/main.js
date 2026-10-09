const { app, BrowserWindow, ipcMain, desktopCapturer, screen, dialog, shell, protocol, Menu, globalShortcut, Notification, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { Readable } = require('stream')
const { exec } = require('child_process')
const startupTimer = require('./startup-timer')

// Node 编译缓存（code cache）：把主进程启动过程中加载的模块字节码缓存到磁盘，
// 下一次启动直接复用、跳过解析 + 编译（仅对 Node 侧模块生效，收益在后续启动）。
// 必须在其它业务模块 require 之前调用；目录固定放 userData 下，随版本/源码变更自动失效重建。
function resolveCompileCacheDir() {
  return path.join(app.getPath('userData'), 'node-compile-cache')
}
try {
  const ccDir = resolveCompileCacheDir()
  fs.mkdirSync(ccDir, { recursive: true })
  if (typeof module.enableCompileCache === 'function') module.enableCompileCache(ccDir)
} catch (_) { /* 编译缓存不可用时静默忽略，不影响启动 */ }

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
  // 写失败必须抛错：否则「切配置」这一步会静默失败，而调用方（如数据目录搬迁）
  // 会继续删掉旧目录，导致数据在新目录、配置却指向已删除的旧目录。
  try {
    fs.writeFileSync(getAppConfigPath(), JSON.stringify(next, null, 2))
  } catch (err) {
    console.error('[main] 写入 app-config 失败:', err?.message || err)
    throw new Error('配置文件写入失败：' + (err?.message || err))
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

// ============ 窗口原生背景材质（BackgroundMaterial / 亚克力） ============
// 使用 Electron 官方内置的 setBackgroundMaterial('acrylic'|'mica'|'none')，随主版本维护，
// 替代已停更的 electron-acrylic-window。仅 Windows 11 22H2+ 生效，其余系统自动回退普通背景。
// 备注：文档/经验记录原生材质在 Win11「节能器(省电)」开启时可能被干扰变灰，属系统级行为。
//
// 主窗口为「不透明无边框」窗口，backgroundMaterial 绘制在窗口背景上；CSS 半透明元素 + backdrop-filter
// 叠加即可磨砂透出材质。返回 true 表示已应用（系统支持时）。
function applyBackgroundMaterial(win, material = 'acrylic') {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return false
  try {
    const m = ['auto', 'none', 'mica', 'acrylic', 'tabbed'].includes(material) ? material : 'acrylic'
    win.setBackgroundMaterial(m)
    return m !== 'none'
  } catch (err) {
    console.error('[acrylic] setBackgroundMaterial 失败，回退普通背景:', err?.message || err)
    return false
  }
}

// 关闭窗口系统背景材质（恢复普通背景）。用于：窗口销毁前 / 系统不支持时。
const disableBackgroundMaterial = (win) => {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return
  try { win.setBackgroundMaterial('none') } catch (_) {}
}

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

// 等待开发服务器就绪后再让窗口导航。
// 关键点：先用轻量 https 探测目标地址（不改变窗口显示内容），命中后才真正 loadURL，
// 避免每次重试都导航一次、失败时窗口停在错误页（表现为白屏/报错闪现）。
// 重试间隔 200ms（原来 1000ms），Vite 一就绪几乎立刻跳转。
function loadUrlWithRetry(win, url, retries = 150, intervalMs = 200) {
  if (!win || win.isDestroyed()) return
  const https = require('https')
  const req = https.get(url, { rejectUnauthorized: false }, (res) => {
    res.resume() // 消耗响应体，避免内存泄漏
    if (win.isDestroyed()) return
    console.log(`[Electron] 开发服务器就绪，开始加载 ${url}`)
    win.loadURL(url).catch((err) => {
      console.error(`[Electron] 加载 ${url} 失败:`, err.message)
    })
  })
  req.on('error', () => {
    if (win.isDestroyed()) return
    if (retries > 0) {
      // 200ms 一次的高频重试不再逐条打日志，每 25 次提示一次进度（约 5s）
      if (retries % 25 === 0) console.log(`[Electron] 等待 ${url} 就绪，剩余重试 ${retries}...`)
      setTimeout(() => loadUrlWithRetry(win, url, retries - 1, intervalMs), intervalMs)
    } else {
      console.error(`[Electron] 无法加载 ${url}: 开发服务器未就绪`)
    }
  })
  req.end()
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
// Vite 就绪后导航到首页并打开 DevTools。
// 重试上限留足 ~4s 预算（轮询在创建窗口后立刻开始）。
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

// 主窗口统一「无边框透明 + 窗外亚克力」：所有主题一致，由渲染层自绘标题栏
// （标题栏显示应用名），避免原生标题栏与侧边栏标题重复。边框类型不再随主题切换。
function createMainWindow() {
  // （新窗口）关闭菜单状态复位：allowMainClose 不会在旧窗口关闭后自动清掉，
  // 若不清零，重建后的新主窗口点关闭会被静默放行、不再弹菜单。
  allowMainClose = false
  shutdownMenuOpen = false
  // 新窗口渲染层未加载完成，待其 ready 回报后才允许渲染层接管关闭菜单
  mainRendererShutdownReady = false
  const isFrameless = true
  mainWindowChrome = 'frameless'
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '班级管理系统',
    // 全部主题统一：无边框 + 系统原生背景材质(backgroundMaterial)，用自绘标题栏。
    // 不用 transparent（透明窗口会禁用系统材质）；backgroundMaterial 绘制在窗口背景，
    // 渲染层用半透明元素 + backdrop-filter 磨砂透出。Win11 也据此自动为窗口加圆角。
    frame: false,
    transparent: false,
    backgroundMaterial: 'acrylic',
    show: true,
    backgroundColor: '#f0f4f8',
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
      // 后台节流：采用默认节流，窗口失焦/最小化/被遮挡时暂停后台重绘，降低后台 GPU/CPU 占用。
      // 代价是切到其它应用时亚克力/毛玻璃可能退回纯灰，点回窗口即恢复。
      spellcheck: false,
      // 支持开发者工具（生产模式亦可手动打开，用于调试）
      devTools: true,
    }
  })

  // 立即绑定全局（供 theme-chrome 重建等判断）；内部事件全部用局部 win 引用，
  // 避免重建时旧窗口的 'closed' 事件把 mainWindow 置空，影响到刚创建的新窗口。
  mainWindow = win

  // 所有主题统一（无边框 + 系统材质）：BrowserWindow 构造已带 backgroundMaterial: 'acrylic'，
  // 无需再手动开启；这里仅在系统不支持时回退日志。透明度磨砂由渲染层 CSS backdrop-filter 完成。
  if (process.platform === 'win32') {
    applyBackgroundMaterial(win, 'acrylic')
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

    // 系统材质已在创建时配置；这里再次确认应用（窗口此刻完整可见，确保材质就绪）。
    if (process.platform === 'win32') {
      applyBackgroundMaterial(win, 'acrylic')
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
      // 后台节流：与主窗口一致关掉，确保持续重绘、亚克力/毛玻璃不因失焦变灰
      backgroundThrottling: false,
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
    // 不用 transparent（透明窗口会禁用系统背景材质）；改用不透明 + backgroundMaterial，
    // 系统材质绘制在窗口背景上，渲染层半透明元素透出磨砂，与主窗口方案一致。
    transparent: false,
    backgroundMaterial: 'acrylic',
    backgroundColor: '#f0f4f8',
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
      // 后台节流：与主窗口一致关掉，确保持续重绘、亚克力/毛玻璃不因失焦变灰
      backgroundThrottling: false,
      spellcheck: false,
      devTools: true,
    }
  })

  // Windows 系统原生背景材质：BackgroundMaterial 已随窗口创建时配置，此处再次确认应用。
  if (process.platform === 'win32') {
    applyBackgroundMaterial(desktopWidgetWindow, 'acrylic')
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
          // 后端模块编译缓存：让后续启动跳过 require 模块的解析 + 编译
          NODE_COMPILE_CACHE: resolveCompileCacheDir(),
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
    // 探测结果缓存到 userData：避免每次 dev 启动都先 spawn 一个 node 去问自己的路径
    //（约 0.3–1s）。缓存的路径失效（node 被卸载/移动）时自动回退到重新探测。
    const nodePathCache = path.join(app.getPath('userData'), 'dev-node-path.txt')
    try {
      const cached = fs.readFileSync(nodePathCache, 'utf8').trim()
      if (cached && fs.existsSync(cached)) {
        console.log('[main] 复用缓存的 node 路径:', cached)
        spawnDev(cached)
        return
      }
    } catch (_) { /* 无缓存，走探测 */ }
    execFile('node', ['-p', 'process.execPath'], { encoding: 'utf8' }, (err, out) => {
      const execPath = err ? 'node' : out.trim()
      if (!err) {
        try { fs.writeFileSync(nodePathCache, execPath) } catch (_) { /* 写缓存失败不影响启动 */ }
      }
      spawnDev(execPath)
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
      // 后端模块编译缓存：让后续启动跳过 require 模块的解析 + 编译
      NODE_COMPILE_CACHE: resolveCompileCacheDir(),
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
// 性能要点：不做任何逐请求的同步 fs（原 existsSync+statSync 会阻塞主进程），
// 只在启动时 readdir 一次拿到顶级 html 入口名单，之后纯按路径规则直接流式读盘。
// prod 下也不再逐请求打日志。
const IMMUTABLE_ASSET_RE = /\.(js|css|wasm|png|jpe?g|gif|webp|svg|woff2?)$/i

function setupAppProtocol() {
  if (isDev) return
  const distDir = path.join(__dirname, '../student-frontend/dist')
  const root = path.normalize(distDir)
  const indexHtml = path.join(root, 'index.html')

  // 顶级 html 入口（index/setup/widget/migration/desktop-widget…），仅枚举一次
  let htmlEntries = new Set()
  try {
    htmlEntries = new Set(fs.readdirSync(distDir).filter((f) => f.endsWith('.html')))
  } catch (_) {
    // dist 缺失时不阻断启动，后续请求走 index.html 回退
  }

  const serveFile = (file, headers) =>
    new Response(Readable.toWeb(fs.createReadStream(file)), { headers })
  const serveIndex = () =>
    serveFile(indexHtml, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' })

  protocol.handle('app', (req) => {
    let p
    let file
    try {
      const url = new URL(req.url)
      p = decodeURIComponent(url.pathname)
      if (p === '/' || p === '') p = '/index.html'
      file = path.normalize(path.join(root, p))
      // 防目录穿越
      if (file !== root && !file.startsWith(root + path.sep)) {
        return new Response('Forbidden', { status: 403 })
      }
    } catch (_) {
      return new Response('Not Found', { status: 404 })
    }

    const ext = path.extname(file).toLowerCase()

    // 无扩展名 → 客户端路由（SPA），回退入口 html
    if (ext === '') return serveIndex()

    if (ext === '.html') {
      const name = p.replace(/^\/+/, '')
      // 已登记的顶级入口直接给；其余 html 路径按 SPA 路由回退
      if (!name.includes('/') && htmlEntries.has(name)) {
        return serveFile(file, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' })
      }
      return serveIndex()
    }

    // 其余带扩展名的静态资源（含 hash 命名的 bundle）：直接流式返回。
    // hash 资源可长缓存，让后续启动直接命中 Chromium 磁盘缓存；字体等短名资源不缓存。
    return serveFile(file, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': IMMUTABLE_ASSET_RE.test(file)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    })
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

    // 全新安装（本机无任何账号库）先弹首次引导向导，完成后再进入主界面；
    // 非首启维持原路径——主窗口立即创建，不增加任何串行等待。
    // 开发（测试）模式默认进入引导便于调试：FORCE_SETUP=0 可强制关闭，=1 可强制开启。
    const forceSetup = process.env.FORCE_SETUP === '1'
      || (process.env.FORCE_SETUP !== '0' && !app.isPackaged)
    if (forceSetup || looksLikeFirstRun()) {
      createSetupWindow()
      startupTimer.mark('createSetupWindow 完成')
    } else {
      // 主窗口立即创建：它加载的静态前端（app://local/index.html 或 dev 的 Vite）不依赖后端，
      // 登录页/首页骨架无需后端即可渲染，前端通过 axios 响应重试兜底「后端未就绪」的短暂窗口。
      createMainWindow()
      startupTimer.mark('createMainWindow 完成')
    }

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
// 主窗口已统一为「无边框透明 + 窗外亚克力」，不再随主题切换边框类型。
// 渲染进程切换主题时上报所需边框类型，此处一律按 frameless 处理（与当前一致），
// 不会触发重建，主题切换只需改 CSS。recreateMainWindow 保留，仅供未来确有
// 切换边框类型的特殊场景复用（重建会重载页面，由渲染层 applyTheme 恢复）。
function recreateMainWindow(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindowChrome === mode) return
  // 记住旧窗口的位置、大小、最大化状态，重建后恢复，避免窗口跳位
  const bounds = mainWindow.getBounds()
  const wasMaximized = mainWindow.isMaximized()
  mainWindow.destroy()
  createMainWindow()
  if (!mainWindow.isDestroyed()) {
    mainWindow.setBounds(bounds)
    if (wasMaximized) mainWindow.maximize()
  }
}

ipcMain.on('theme-chrome', (event, { mode }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win !== mainWindow) return
  // 统一无边框亚克力：无论渲染层报什么，都不再切换边框类型（mainWindowChrome 恒为 frameless，
  // 传 frameless 会使 recreateMainWindow 直接 return，主题切换因此不再重建窗口）。
  recreateMainWindow('frameless')
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
ipcMain.handle('select-folder', async (event) => {
  // 以调用方所在窗口为父窗口：首次安装引导期还没有主窗口，此时用引导窗口作父窗口，
  // 否则（mainWindow 为空）会直接返回空数组，导致引导里的「修改」按钮点了没反应。
  const senderWin = BrowserWindow.fromWebContents(event.sender)
  const parent = (senderWin && !senderWin.isDestroyed())
    ? senderWin
    : (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)
  const opts = {
    properties: ['openDirectory'],
    defaultPath: lastDialogDir || undefined,
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, opts)
    : await dialog.showOpenDialog(opts)
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

// ========== 数据库迁移进度窗口 ==========
// 待主窗口展示的提示：迁移时主窗口正在重建，先暂存于此，等新主窗口加载完成主动取走再弹提示条
// 形如 { type: 'success'|'info'|'warning'|'error', message: string }
let pendingMainNotification = null
ipcMain.handle('get-pending-notification', () => {
  const msg = pendingMainNotification
  pendingMainNotification = null
  return msg || null
})

// 迁移期间关闭所有其它窗口（主窗口/工具箱/桌面组件），只留一个不可关闭的进度窗口，
// 避免用户在迁移进行中操作数据库或强行中断造成数据损坏。
let migrationWindow = null
let migrationRunning = false
let migrationReadyResolve = null
// 进度窗口渲染层是否已挂载：未挂载时无法展示失败原因，失败需直接重开主窗口，避免留下无法关闭的空窗口
let migrationUiReady = false
// 本次迁移的上下文（目标目录等）：失败后由用户在进度窗口上决定是否清理
let migrationContext = null

// 向进度窗口推送消息（窗口不存在/已销毁时静默忽略）
function sendMigration(payload) {
  if (migrationWindow && !migrationWindow.isDestroyed()) {
    try { migrationWindow.webContents.send('from-main', payload) } catch (_) {}
  }
}

// 创建进度窗口：无边框透明 + 圆角卡片，置顶、不可缩放、迁移期间禁止关闭
function createMigrationWindow() {
  migrationUiReady = false
  const win = new BrowserWindow({
    // 尺寸写死：进行中 / 完成 / 移动失败 三种状态共用同一固定尺寸，窗口不随内容变化、不可缩放
    width: 460,
    height: 280,
    resizable: false,
    frame: false,
    // 与主窗口一致的毛玻璃方案：不用 transparent（透明窗口会禁用系统材质，backdrop-filter 无背景
    // 可模糊 → 卡片整体全透明），改用系统亚克力 + 不透明底色，由渲染层半透明卡片磨砂透出。
    // Win11 会据此自动给窗口加圆角。
    transparent: false,
    backgroundMaterial: 'acrylic',
    backgroundColor: '#f0f4f8',
    alwaysOnTop: true,
    skipTaskbar: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    center: true,
    title: '迁移数据库',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ['--secure-channel'],
      webSecurity: !isDev,
      spellcheck: false,
      devTools: isDev,
    },
  })
  migrationWindow = win

  // 系统原生背景材质（亚克力）：与主窗口一致，窗口创建后确认应用一次（系统不支持时自动回退）
  if (process.platform === 'win32') applyBackgroundMaterial(win, 'acrylic')

  // 迁移进行中拦截关闭（系统 ✕ / Alt+F4）；失败后由「返回主界面」按钮放行
  win.on('close', (e) => { if (migrationRunning) e.preventDefault() })
  win.on('closed', () => { if (migrationWindow === win) migrationWindow = null })

  if (isDev) {
    loadUrlWithRetry(win, 'https://127.0.0.1:5173/migration.html')
  } else {
    win.loadURL('app://local/migration.html')
  }
  return win
}

// 等进度窗口渲染层挂载完成，避免首帧进度消息丢失；超时兜底以免阻塞迁移
function waitMigrationReady(timeout = 4000) {
  return new Promise((resolve) => {
    let settled = false
    const done = () => { if (settled) return; settled = true; migrationReadyResolve = null; resolve() }
    migrationReadyResolve = done
    setTimeout(done, timeout)
  })
}

ipcMain.on('migration-ready', (event) => {
  if (!migrationWindow || migrationWindow.isDestroyed()) return
  if (event.sender !== migrationWindow.webContents) return
  migrationUiReady = true
  if (typeof migrationReadyResolve === 'function') migrationReadyResolve()
})

// 迁移失败后用户点击「返回主界面」/ 加密转换结束后进度窗口回报结果：
//   - 数据目录搬迁：按用户选择决定是否清理目标目录，再重开主窗口
//   - 数据库加密转换：由进度窗口回报 ok，主进程据此准备提示条后重开主窗口
ipcMain.on('migration-dismiss', (event, data) => {
  if (!migrationWindow || migrationWindow.isDestroyed()) return
  if (event.sender !== migrationWindow.webContents) return
  const ctx = migrationContext
  if (ctx && ctx.mode === 'crypt') {
    pendingMainNotification = data && data.ok
      ? { type: 'success', message: ctx.encrypt ? '数据库加密已启用' : '数据库加密已关闭' }
      : { type: 'info', message: ctx.encrypt ? '启用加密失败，数据库未发生改动' : '关闭加密失败，数据库未发生改动' }
    reopenAfterMigration()
    return
  }
  // 失败时不再自动清理：默认保留已复制内容，只有用户确认「确定」才清除
  if (data && data.clean) cleanupMigrationTarget()
  reopenAfterMigration()
})

// 清理迁移目标目录：仅清掉本次复制写入的内容（用户选定的既有空目录保留目录本身）
function cleanupMigrationTarget() {
  const ctx = migrationContext
  if (!ctx) return
  try {
    if (ctx.createdTarget) fs.rmSync(ctx.target, { recursive: true, force: true })
    else clearDir(ctx.target)
  } catch (err) {
    console.warn('[main] 清理迁移目标目录失败:', err?.message || err)
  }
}

// 关闭除进度窗口外的全部窗口。必须先建好进度窗口再调用，保证窗口数不为 0，
// 否则会触发 window-all-closed 让应用直接退出。
function closeAllWindowsExceptMigration() {
  if (!migrationWindow || migrationWindow.isDestroyed()) return
  allowMainClose = true
  shutdownMenuOpen = false
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close()
  if (desktopWidgetWindow && !desktopWidgetWindow.isDestroyed()) desktopWidgetWindow.close()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
}

// 迁移结束统一重开主窗口，并关闭进度窗口。
// 工具箱/桌面组件由主窗口渲染层就绪后回报 widgets-ready 自动按设置恢复，无需在此手动创建。
function reopenAfterMigration() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  migrationRunning = false
  migrationContext = null
  if (migrationWindow && !migrationWindow.isDestroyed()) migrationWindow.close()
}

// ========== 首次安装引导向导 ==========
// 全新安装（本机无任何有效账号）时先弹出独立的引导窗口，用户完成初始化后才进入正式使用。
// 复用 preload.js 与「无边框 + 系统亚克力」窗口方案，固定尺寸、不可缩放。
let setupWindow = null
let setupRunning = false
let setupUiReady = false
// 预热进度：窗口一打开即后台推进，渲染层可在任意时刻通过 get-setup-warmup 补齐状态
let setupWarmup = { phase: '', detail: '', percent: 0, done: false }

// 轮询后端 GET /api/accounts 直到返回 200（或超时）。返回有效账号数组；超时返回 null。
async function waitBackendReady(timeout = 15000) {
  const start = Date.now()
  for (;;) {
    try {
      const res = await fetch('http://localhost:3000/api/accounts')
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        return Array.isArray(data.accounts) ? data.accounts : []
      }
    } catch (_) { /* 后端尚未就绪，继续重试 */ }
    if (Date.now() - start > timeout) return null
    await new Promise((r) => setTimeout(r, 250))
  }
}

// 快速首启判定：数据目录里还没有 index.db（从未初始化过任何账号库）
function looksLikeFirstRun() {
  try {
    return !fs.existsSync(path.join(resolveDataDir(), 'index.db'))
  } catch (_) { return false }
}

// 首启判定：FORCE_SETUP=1 强制为真；否则先看文件系统，再等后端就绪看有效账号是否为空
async function detectFirstRun() {
  if (process.env.FORCE_SETUP === '1') return true
  if (looksLikeFirstRun()) return true
  const accounts = await waitBackendReady()
  return Array.isArray(accounts) && accounts.length === 0
}

// 向引导窗口推送预热进度（窗口不存在/已销毁时静默忽略）
function sendSetupWarmup(payload) {
  if (setupWindow && !setupWindow.isDestroyed()) {
    try { setupWindow.webContents.send('from-main', payload) } catch (_) {}
  }
}
function updateWarmup(phase, detail, percent, done = false) {
  setupWarmup = { phase, detail, percent, done }
  sendSetupWarmup({ type: 'setup-warmup', ...setupWarmup })
}

// 预热编排：真实的初始化动作（等后端就绪 + 建数据/缓存/编译缓存目录）。
// 编译缓存的收益在后续启动，因此该步不阻塞用户操作。
async function runSetupWarmup() {
  if (setupWarmup.done) return
  updateWarmup('启动服务', '正在启动本地服务', 15)
  const accounts = await waitBackendReady()
  if (accounts === null) {
    updateWarmup('启动服务', '本地服务启动较慢，可先继续', 15, false)
    return
  }
  updateWarmup('初始化数据目录', '正在准备数据目录', 55)
  try {
    fs.mkdirSync(resolveDataDir(), { recursive: true })
    fs.mkdirSync(resolveThumbsDir(), { recursive: true })
  } catch (_) { /* 目录创建失败不阻塞引导 */ }
  await new Promise((r) => setTimeout(r, 60))
  updateWarmup('准备编译缓存', '正在预热模块编译缓存', 85)
  try { fs.mkdirSync(resolveCompileCacheDir(), { recursive: true }) } catch (_) {}
  await new Promise((r) => setTimeout(r, 60))
  updateWarmup('完成', '优化已自动完成~', 100, true)
}

// 创建引导窗口：固定尺寸、无边框、系统亚克力，引导期间禁止关闭
function createSetupWindow() {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus()
    return setupWindow
  }
  setupUiReady = false
  const win = new BrowserWindow({
    width: 800,
    height: 540,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    // 与主窗口一致的毛玻璃方案：不用 transparent，改用系统亚克力 + 不透明底色，
    // 由渲染层半透明卡片磨砂透出（Win11 会据此自动给窗口加圆角）。
    transparent: false,
    backgroundMaterial: 'acrylic',
    backgroundColor: '#f0f4f8',
    center: true,
    title: '首次安装引导',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ['--secure-channel'],
      webSecurity: !isDev,
      spellcheck: false,
      devTools: isDev,
    },
  })
  setupWindow = win
  setupRunning = true

  if (process.platform === 'win32') applyBackgroundMaterial(win, 'acrylic')

  // 引导未完成前禁止关闭（系统 ✕ / Alt+F4）
  win.on('close', (e) => { if (setupRunning) e.preventDefault() })
  win.on('closed', () => { if (setupWindow === win) setupWindow = null })

  if (isDev) {
    // 与主窗口一致：先渲染本地 inline loading 页（窗口立即出画面，不再白屏），
    // Vite 就绪后立即跳转到 setup.html；引导窗口不开 DevTools。
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(DEV_LOADING_HTML)}`)
    win.webContents.on('did-finish-load', () => {
      const u = win.webContents.getURL()
      startupTimer.mark(u.startsWith('data:') ? '引导窗口 loading 页完成' : '引导页面加载完成')
    })
    // 直接探测 setup.html：命中即跳转，等待期间 Vite 已顺带编译好该页面
    loadUrlWithRetry(win, 'https://127.0.0.1:5173/setup.html')
  } else {
    win.loadURL('app://local/setup.html')
  }

  // 窗口一打开即在后台开始预热
  runSetupWarmup()
  return win
}

ipcMain.on('setup-ready', (event) => {
  if (!setupWindow || setupWindow.isDestroyed()) return
  if (event.sender !== setupWindow.webContents) return
  setupUiReady = true
})

// 引导完成：关闭引导窗口并创建主窗口（token 已写入同源 localStorage，主窗口据此直达首页）
ipcMain.on('setup-complete', (event) => {
  if (!setupWindow || setupWindow.isDestroyed()) return
  if (event.sender !== setupWindow.webContents) return
  setupRunning = false
  pendingMainNotification = { type: 'success', message: '初始化完成，欢迎使用' }
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close()
})

// 供晚挂载的渲染层补齐预热状态
ipcMain.handle('get-setup-warmup', () => setupWarmup)

// 引导期「储存设置」：写入初始数据/缓存目录。首次建库前直接写配置；
// 若引导中已建库（数据目录已存在），复用安全搬迁流程移动文件，随后重启后端让新目录生效。
ipcMain.handle('set-initial-data-dir', async (event, payload) => {
  const p = payload || {}
  const currentData = resolveDataDir()
  let dataDir = null
  if (p.dataDir) {
    const t = path.resolve(String(p.dataDir))
    if (t.toLowerCase() !== currentData.toLowerCase()) dataDir = t
  }
  let thumbsDir = null
  if (p.thumbsDir) {
    const t = path.resolve(String(p.thumbsDir))
    if (t.toLowerCase() !== resolveThumbsDir().toLowerCase()) thumbsDir = t
  }
  if (!dataDir && !thumbsDir) {
    return { ok: true, dataDir: currentData, thumbsDir: resolveThumbsDir(), changed: false }
  }

  if (dataDir) {
    // 防循环：不允许把数据目录迁到它自身内部
    const rel = path.relative(currentData, dataDir)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      throw new Error('新目录不能位于当前数据目录内部')
    }
    if (fs.existsSync(path.join(currentData, 'index.db'))) {
      // 已建库：复用安全搬迁流程（预检非空 → 校验 → 复制 → 复检 → 写配置 → 删旧目录）
      if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length > 0) {
        throw new Error('目标目录非空，请选择空目录')
      }
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
      await migrateDataDir(currentData, dataDir) // 内部已停止后端并写配置
    } else {
      // 尚未建库：直接创建目录并写配置，无需搬迁
      fs.mkdirSync(dataDir, { recursive: true })
      saveAppConfig({ dataDir })
    }
  }
  if (thumbsDir) {
    fs.mkdirSync(thumbsDir, { recursive: true })
    saveAppConfig({ thumbsDir })
  }

  // 重启后端让新目录生效（token 由同一 SECURE_MASTER 签发，重启后仍有效）
  await stopBackendProcess()
  startBackend()
  return { ok: true, dataDir: resolveDataDir(), thumbsDir: resolveThumbsDir(), changed: true }
})

// ========== 数据目录搬迁：带进度的校验 + 复制 ==========
const fsp = fs.promises

// 递归列出目录下所有文件（相对路径 + 绝对路径），顺序稳定
function listFilesRecursive(dir, prefix = '') {
  const out = []
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return out }
  for (const ent of entries) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...listFilesRecursive(full, rel))
    else if (ent.isFile()) out.push({ rel, full })
  }
  return out
}

// 流式算文件 SHA-256，并按块回报已读字节（供进度条使用）
async function sha256FileAsync(file, onBytes) {
  const hash = crypto.createHash('sha256')
  const fh = await fsp.open(file, 'r')
  try {
    const buf = Buffer.allocUnsafe(1 << 20) // 1MB
    let pos = 0
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos)
      if (!bytesRead) break
      hash.update(buf.subarray(0, bytesRead))
      pos += bytesRead
      if (onBytes) onBytes(bytesRead)
    }
  } finally {
    await fh.close()
  }
  return hash.digest('hex')
}

// 复制单个文件，按块回报已写字节（供进度条使用）
async function copyFileAsync(src, dst, onBytes) {
  await fsp.mkdir(path.dirname(dst), { recursive: true })
  const rh = await fsp.open(src, 'r')
  const wh = await fsp.open(dst, 'w')
  try {
    const buf = Buffer.allocUnsafe(1 << 20)
    let pos = 0
    for (;;) {
      const { bytesRead } = await rh.read(buf, 0, buf.length, pos)
      if (!bytesRead) break
      await wh.write(buf, 0, bytesRead, pos)
      pos += bytesRead
      if (onBytes) onBytes(bytesRead)
    }
  } finally {
    await rh.close()
    await wh.close()
  }
}

// 建立目录清单：相对路径 → { size, hash }，并回报总文件数/总字节数（用于进度）
async function buildInventory(dir, onProgress) {
  const files = listFilesRecursive(dir).map((f) => ({ ...f, size: fs.statSync(f.full).size }))
  const totalFiles = files.length
  const totalBytes = files.reduce((s, f) => s + f.size, 0)
  const map = new Map()
  let doneFiles = 0
  let doneBytes = 0
  for (const f of files) {
    const hash = await sha256FileAsync(f.full, (n) => {
      doneBytes += n
      if (onProgress) onProgress(doneFiles, totalFiles, doneBytes, totalBytes)
    })
    map.set(f.rel, { size: f.size, hash })
    doneFiles += 1
    if (onProgress) onProgress(doneFiles, totalFiles, doneBytes, totalBytes)
  }
  return { map, totalFiles, totalBytes }
}

// 目录整体指纹：对所有文件（按路径排序）的 路径+大小+内容哈希 再算一次 SHA-256。
// 用于搬迁后做「全局哈希」兜底校验，能一并发现文件缺失、内容变化与多出文件。
function globalHashOf(inventory) {
  const hash = crypto.createHash('sha256')
  for (const rel of [...inventory.keys()].sort()) {
    const e = inventory.get(rel)
    hash.update(`${rel}\u0000${e.size}\u0000${e.hash}\n`)
  }
  return hash.digest('hex')
}

// 清空目录内容但保留目录本身（用于回滚时优先保留用户选定的目录）
function clearDir(dir) {
  let entries = []
  try { entries = fs.readdirSync(dir) } catch (_) { return }
  for (const name of entries) {
    try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }) } catch (_) {}
  }
}

// 进度上报节流：高频字节回调合并为最多每 60ms 一次 IPC，避免刷爆渲染进程
function createProgressReporter() {
  let lastSent = 0
  let pending = null
  let timer = null
  const flush = () => {
    timer = null
    if (!pending) return
    sendMigration(pending)
    pending = null
    lastSent = Date.now()
  }
  return (payload, force = false) => {
    pending = payload
    const now = Date.now()
    if (force || now - lastSent >= 60) {
      if (timer) { clearTimeout(timer); timer = null }
      flush()
    } else if (!timer) {
      timer = setTimeout(flush, 60 - (now - lastSent))
    }
  }
}

// 执行数据目录整体搬迁：预检 → 校验源文件 → 复制（字节进度）→ 复检（失败文件单拷 + 全局哈希）→ 写配置。
// 任一步失败都抛错，由调用方清理目标目录、保留旧目录与旧配置并恢复后端。返回 { oldDirRemoved }。
async function migrateDataDir(oldDir, target) {
  const report = createProgressReporter()
  const emit = (phase, filesDone, filesTotal, percent, detail) => {
    report({
      type: 'migration-progress',
      phase,
      filesDone,
      filesTotal,
      percent: Math.max(0, Math.min(100, Math.round(percent || 0))),
      detail,
    })
  }

  // ---- 阶段「校验文件」：建立源目录清单（有效性预检已在进入迁移前完成） ----
  if (!fs.existsSync(oldDir)) throw new Error('当前数据目录不存在')

  // 停止后端，确保没有任何进程再读写这些数据库文件
  emit('校验文件', 0, 0, 0, '正在停止数据读写')
  await stopBackendProcess()

  const source = await buildInventory(oldDir, (doneFiles, totalFiles, doneBytes, totalBytes) => {
    emit('校验文件', doneFiles, totalFiles, totalBytes ? (doneBytes / totalBytes) * 100 : (totalFiles ? 100 : 0), '正在校验现有数据完整性')
  })
  const sourceGlobal = globalHashOf(source.map)
  emit('校验文件', source.totalFiles, source.totalFiles, 100, '校验完成')
  await new Promise((r) => setImmediate(r))

  // ---- 阶段「复制文件」：按字节进度整体复制（文件级并发，最多 COPY_CONCURRENCY 个同时进行） ----
  // 并发上限写死为 3：小文件多时能明显提速；再往上会让并发文件互相抢磁盘、反而更慢。
  const COPY_CONCURRENCY = 3
  emit('复制文件', 0, source.totalFiles, 0, '正在复制文件')
  let copiedFiles = 0
  let copiedBytes = 0
  const rels = [...source.map.keys()]
  let nextIdx = 0
  // 每个 worker 从队列里不断取下一个文件复制，直到取空。
  // copiedBytes / copiedFiles 只增不减，且 emit 内部已把百分比钳制到 0~100，多文件同时回报也保持单调推进。
  const copyWorker = async () => {
    while (nextIdx < rels.length) {
      const rel = rels[nextIdx++]
      const src = path.join(oldDir, rel)
      const dst = path.join(target, rel)
      try {
        await copyFileAsync(src, dst, (n) => {
          copiedBytes += n
          emit('复制文件', copiedFiles, source.totalFiles, source.totalBytes ? (copiedBytes / source.totalBytes) * 100 : 100, `正在复制文件 ${Math.min(copiedFiles + 1, source.totalFiles)}/${source.totalFiles}`)
        })
      } catch (err) {
        console.warn('[main] 复制文件失败，稍后单独重试:', rel, err?.message || err)
      }
      copiedFiles += 1
      emit('复制文件', copiedFiles, source.totalFiles, source.totalBytes ? (copiedBytes / source.totalBytes) * 100 : 100)
      await new Promise((r) => setImmediate(r))
    }
  }
  await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, rels.length) }, () => copyWorker()))

  // ---- 阶段「校验文件」：复检复制结果 ----
  const verify = async () => {
    const targetInv = await buildInventory(target, (doneFiles, totalFiles, doneBytes, totalBytes) => {
      emit('校验文件', doneFiles, totalFiles, totalBytes ? (doneBytes / totalBytes) * 100 : (totalFiles ? 100 : 0), '正在校验复制后的文件')
    })
    const mismatched = []
    for (const [rel, info] of source.map) {
      const t = targetInv.map.get(rel)
      if (!t || t.size !== info.size || t.hash !== info.hash) mismatched.push(rel)
    }
    // 目标多出源没有的文件同样视为不一致（防止复制到别处/脏数据）
    for (const rel of targetInv.map.keys()) {
      if (!source.map.has(rel)) mismatched.push(rel)
    }
    return { mismatched, targetInv }
  }

  emit('校验文件', 0, source.totalFiles, 0, '正在校验复制结果')
  let result = await verify()

  // 若发现部分文件失败：单独再复制一次这些文件（多出的则删除），随后再复检
  if (result.mismatched.length > 0) {
    const total = result.mismatched.length
    emit('校验文件', 0, total, 0, `发现 ${total} 个文件不一致，正在单独重新复制`)
    let redone = 0
    for (const rel of result.mismatched) {
      const src = path.join(oldDir, rel)
      const dst = path.join(target, rel)
      try {
        if (fs.existsSync(src)) await copyFileAsync(src, dst)
        else fs.rmSync(dst, { recursive: true, force: true }) // 源不存在 → 多余文件，删掉
      } catch (err) {
        console.warn('[main] 重拷失败:', rel, err?.message || err)
      }
      redone += 1
      emit('校验文件', redone, total, (redone / total) * 100, '正在单独重新复制失败文件')
      await new Promise((r) => setImmediate(r))
    }
    result = await verify()
  }

  // 全局哈希兜底：源目录与目标目录的整体指纹必须完全一致
  if (result.mismatched.length > 0 || globalHashOf(result.targetInv.map) !== sourceGlobal) {
    throw new Error(`新目录校验不一致（${result.mismatched.length} 个文件），已保留旧目录`)
  }
  emit('校验文件', source.totalFiles, source.totalFiles, 100, '校验完成')

  // ---- 写配置：只有前面全部通过才切换；写失败则中止且不删旧目录 ----
  try {
    saveAppConfig({ dataDir: target })
  } catch (err) {
    throw new Error('配置文件写入失败，已中止搬迁并保留旧目录：' + (err?.message || err))
  }

  // ---- 删除旧目录：删不掉仅记为残留，不算搬迁失败 ----
  let oldDirRemoved = true
  try {
    fs.rmSync(oldDir, { recursive: true, force: true })
  } catch (err) {
    oldDirRemoved = false
    console.warn('[main] 旧数据目录删除失败（搬迁已完成，新目录可用，可手动清理）:', err?.message || err)
  }
  return { oldDirRemoved }
}

// 停止后端子进程（不清 isQuitting 标志，便于随后重启）。
// 返回 Promise：等进程真正退出后再 resolve。Windows 上 kill() 是异步的，若不等它
// 退出就立刻拷贝/删除数据库文件，会因 .db/.db-wal/.db-shm 句柄尚未释放而 EBUSY/EPERM 失败。
// 同时摘掉 exit→scheduleBackendRestart 监听：本次是「主动停止」，不应再被自动重启拉起来
// （否则会和调用方的 startBackend() 一起 fork 出两个后端）。
function stopBackendProcess() {
  clearTimeout(backendRestartTimer)
  const proc = backendProcess
  backendProcess = null
  if (!proc) return Promise.resolve()
  try { proc.removeListener('exit', scheduleBackendRestart) } catch (_) { /* 忽略 */ }
  return new Promise((resolve) => {
    let settled = false
    const done = () => { if (settled) return; settled = true; resolve() }
    proc.once('exit', done)
    try { proc.kill() } catch (_) { done() }
    // 兜底：进程迟迟不退出也不能无限等待
    setTimeout(done, 3000)
  })
}

// 变更「数据库目录」：关闭全部其它窗口并弹出独立的迁移进度窗口，在其中完成
//   预检（有效班主任库/无再读写）→ 校验源文件 → 复制（字节进度）→ 复检（失败单拷 + 全局哈希）→ 写配置；
// 只有前面全部通过才切配置、删旧目录。配置写入失败会中止并保留旧目录，绝不产生「数据在新目录、
// 配置却指向已删除旧目录」的错位状态。
ipcMain.handle('set-data-dir', async (event, dir) => {
  if (migrationRunning) throw new Error('已有数据库迁移正在进行，请稍候')
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
  // 目标目录须为空（不存在则创建）；在开窗、停后端之前先快速失败
  let createdTarget = false
  if (fs.existsSync(target)) {
    if (fs.readdirSync(target).length > 0) throw new Error('目标目录非空，请选择空目录')
  } else {
    fs.mkdirSync(target, { recursive: true })
    createdTarget = true
  }
  // 预检：当前目录必须是有效的班主任数据库（登记表 + 主密钥），否则不进入迁移流程
  if (!fs.existsSync(oldDir)) throw new Error('当前数据目录不存在')
  if (!fs.existsSync(path.join(oldDir, 'index.db'))) throw new Error('当前数据目录缺少 index.db，无法确认数据库有效')
  if (!fs.existsSync(path.join(oldDir, 'db-master.key'))) throw new Error('当前数据目录缺少 db-master.key，无法确认数据库有效')

  migrationRunning = true
  migrationContext = { target, createdTarget, oldDir }
  // 先建好进度窗口，再关闭其它窗口：保证窗口数不为 0，避免触发 window-all-closed 退出应用
  createMigrationWindow()
  await waitMigrationReady()
  closeAllWindowsExceptMigration()

  try {
    const { oldDirRemoved } = await migrateDataDir(oldDir, target)
    // 成功：配置已切到新目录 → 重启后端（读取新 DATA_DIR）→ 重开主窗口并弹出成功提示条
    sendMigration({ type: 'migration-done' })
    await new Promise((r) => setTimeout(r, 700))
    pendingMainNotification = { type: 'success', message: '数据库移动成功' }
    startBackend()
    reopenAfterMigration()
    return { ok: true, dataDir: target, changed: true, oldDirRemoved }
  } catch (err) {
    console.error('[main] 数据目录搬迁失败:', err?.message || err)
    // 失败：旧目录与旧配置原样保留；新目录不再自动清理，交由用户在进度窗口确认后手动清除
    startBackend()
    // 失败提示条：用「提示」而非「错误」，语义为「搬迁未生效、数据安全」；用户关掉进度窗口后新主窗口展示
    pendingMainNotification = { type: 'info', message: '数据库移动失败，原数据库未发生改动' }
    sendMigration({ type: 'migration-error', message: err?.message || String(err), target })
    // 进度窗口渲染层未挂载（无法询问用户）时，直接重开主窗口，保留已复制内容待手动清理
    if (!migrationUiReady) reopenAfterMigration()
    throw new Error(err?.message || String(err))
  }
})

// 变更「数据库加密方式」：复用数据目录迁移那套流程——关闭全部其它窗口、只留独立进度窗口，
// 完成后自动重开主窗口并经提示条反馈结果。实际转换由后端的 NDJSON 流接口执行
// （只有后端加载 SQLCipher 原生模块，且 rekey 是同步阻塞操作），进度窗口渲染层承接进度并回报结果。
ipcMain.handle('set-db-encryption', async (event, payload) => {
  if (migrationRunning) throw new Error('已有数据库任务正在进行，请稍候')
  const encrypt = !!(payload && payload.encrypt)
  // 先取当前登录令牌交给进度窗口调用后端接口：接口只从 JWT 取 slug，绝不接受客户端传入 slug
  let token = null
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      token = await mainWindow.webContents.executeJavaScript('localStorage.getItem("token")', true)
    }
  } catch (_) { token = null }
  if (!token) throw new Error('登录状态已失效，请重新登录后再试')

  migrationRunning = true
  migrationContext = { mode: 'crypt', encrypt }
  // 先建好进度窗口，再关闭其它窗口：保证窗口数不为 0，避免触发 window-all-closed 退出应用
  createMigrationWindow()
  await waitMigrationReady()
  if (!migrationUiReady) {
    // 进度窗口渲染层未就绪：无法执行转换，直接放弃并恢复（此时其它窗口尚未关闭）
    migrationRunning = false
    migrationContext = null
    if (migrationWindow && !migrationWindow.isDestroyed()) migrationWindow.close()
    throw new Error('进度窗口加载失败，请重试')
  }
  closeAllWindowsExceptMigration()
  // 通知进度窗口开始转换（携带目标状态与登录令牌），其完成后经 migration-dismiss 回报结果
  sendMigration({ type: 'crypt-start', encrypt, token })
  return { ok: true, started: true, encrypt }
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
  // 配置写入失败必须中止，不能继续重启后端去用一个尚未生效的目录
  saveAppConfig({ thumbsDir: target })
  await stopBackendProcess()
  startBackend()
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

// 导出文件保存后：用系统默认应用打开
ipcMain.handle('open-file', async (event, { filePath }) => {
  if (!filePath) return { success: false, error: 'no filePath' }
  try {
    const error = await shell.openPath(filePath)
    return { success: !error, error: error || null }
  } catch (err) {
    return { success: false, error: err.message }
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
