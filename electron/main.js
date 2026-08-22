const { app, BrowserWindow, ipcMain, desktopCapturer, screen, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')

let mainWindow
let widgetWindow
let backendProcess

const isDev = !app.isPackaged

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

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '校园助手',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 禁用 sandbox：Electron 43 的 sandboxed renderer 存在启动崩溃
      // （binding.startupData 为 null），导致 preload 无法注入 window.electron。
      // contextIsolation + nodeIntegration:false 仍保证渲染层隔离。
      sandbox: false,
      // webSecurity 仅开发模式关闭（用于加载自签名 https 的 Vite 服务）；
      // 生产环境必须保持开启，禁止在打包后关闭网页安全策略。
      webSecurity: !isDev,
      // 窗口隐藏/最小化时自动节流渲染进程定时器与 rAF，降低后台内存与 CPU 占用
      backgroundThrottling: true,
      // 关闭拼写检查，节省渲染进程内存
      spellcheck: false,
      // 生产模式关闭 DevTools，进一步缩小暴露面与内存开销
      devTools: isDev,
    }
  })

  if (isDev) {
    loadUrlWithRetry(mainWindow, 'https://127.0.0.1:5173/')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../student-frontend/dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
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
      sandbox: false,
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
    widgetWindow.loadFile(path.join(__dirname, '../student-frontend/dist/widget.html'))
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

// 窗口创建由后端就绪信号触发（不再写死延迟）；以下为就绪检测状态
let windowsCreated = false
let backendReadyFallbackTimer = null
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
  const dataDir = path.join(app.getPath('userData'), 'data')
  fs.mkdirSync(dataDir, { recursive: true })

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
    const { fork, execFileSync } = require('child_process')
    let systemNode = process.env.NODE_EXEC_PATH
    if (!systemNode) {
      try {
        systemNode = execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()
      } catch (_) {
        systemNode = 'node'
      }
    }
    const child = fork(backendPath, [], {
      cwd: backendDir,
      execPath: systemNode,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        DATA_DIR: dataDir,
      },
    })
    backendProcess = child
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onErrData)
    child.on('error', onProcessorError)
    child.on('exit', onExit)
    child.on('disconnect', onDisconnect)
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
      ELECTRON_RUN_AS_NODE: '1',
    },
  })

  backendProcess.stdout?.on('data', onData)
  backendProcess.stderr?.on('data', onErrData)
  backendProcess.on('error', onProcessorError)
  backendProcess.on('exit', onExit)
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

  // 监听退出并自动重启（放弃内核权限控后台后）；
  // 用一个短延迟把退出与重启解耦，避免同一个 exit 触发多次重启
  const onExit = () => {
    clearTimeout(backendRestartTimer)
    backendRestartTimer = setTimeout(() => {
      if (app.isQuitting) return
      backendRestartCount += 1
      backendProcess = null
      startBackend()
    }, 1500)
  }
  backendProcess.on('exit', onExit)
}

// 先建主窗口，等其页面加载完毕后再错峰建 widget（避免启动瞬间两个渲染进程并行抢占资源）
function openMainThenWidget() {
  createMainWindow()
  mainWindow?.webContents.once('did-finish-load', () => {
    setTimeout(() => { if (!widgetWindow || widgetWindow.isDestroyed()) createWidgetWindow() }, 300)
  })
}

// 后端就绪检测：后端 app.listen 回调会打印「服务器已启动」，作为建窗信号。
// stdout 可能被分片，这里做滚动缓冲 + 子串匹配，触发后只建一次窗。
function detectBackendReady(chunk) {
  if (windowsCreated) return
  readyBuffer += String(chunk)
  if (readyBuffer.length > 4096) readyBuffer = readyBuffer.slice(-4096)
  if (!/服务器已启动|listening|server started/i.test(readyBuffer)) return
  readyBuffer = ''
  windowsCreated = true
  clearTimeout(backendReadyFallbackTimer)
  openMainThenWidget()
}

app.whenReady().then(() => {
  startBackend()

  // 不再写死固定延迟：后端一旦就绪就建主窗口。
  // 兜底：若就绪信号因异常缺失（如日志被吞），预留超时仍建窗，避免卡在无窗口状态。
  backendReadyFallbackTimer = setTimeout(() => {
    if (!windowsCreated) { windowsCreated = true; openMainThenWidget() }
  }, 20000)
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
