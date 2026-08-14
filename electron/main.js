const { app, BrowserWindow, ipcMain, desktopCapturer, screen, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { fork } = require('child_process')

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
      webSecurity: false,
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
      webSecurity: !isDev,
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

function startBackend() {
  const backendPath = path.join(__dirname, '../student-backend/app.js')
  const backendCwd = path.join(__dirname, '../student-backend')

  // execPath: 'node' 强制使用系统安装的 Node.js，而非 Electron 内置的 Node
  backendProcess = fork(backendPath, [], {
    cwd: backendCwd,
    execPath: 'node',
    silent: false,
  })

  backendProcess.on('error', (err) => {
    console.error('后端启动失败:', err)
  })

  backendProcess.on('exit', (code) => {
    console.log(`后端进程退出，码: ${code}`)
  })
}

app.whenReady().then(() => {
  startBackend()

  // 等待后端启动后再创建窗口（简单延迟）
  setTimeout(() => {
    createMainWindow()
    createWidgetWindow()
  }, 1500)
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

// 选择文件夹对话框
ipcMain.handle('select-folder', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { filePaths: [] }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  return result
})

// 选择图片文件对话框（用于背景图片）
ipcMain.handle('select-image-file', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true, filePaths: [] }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0]
    // 检查文件大小（限制 50MB）
    const fileStat = fs.statSync(filePath)
    const maxSize = 50 * 1024 * 1024 // 50MB
    if (fileStat.size > maxSize) {
      return { canceled: true, error: '图片大小超过 50MB，请选择更小的图片' }
    }
    // 将文件复制到后端 uploads/background 目录
    const bgDir = path.join(__dirname, '../student-backend/uploads/background')
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
    const bgDir = path.join(__dirname, '../student-backend/uploads/background')
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
    defaultPath: defaultName,
    filters: ext ? [{ name: '文件', extensions: [ext.replace('.', '')] }] : undefined
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  try {
    const buffer = Buffer.from(data)
    fs.writeFileSync(result.filePath, buffer)
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

    const dataUrl = `data:image/png;base64,${image.toString('base64')}`
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

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
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
  if (backendProcess) {
    backendProcess.kill()
    backendProcess = null
  }
})
