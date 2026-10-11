// =========================================================================
// widget.js —— 工具箱浮窗 + 桌面小组件
//
// 汇总主进程里与「工具箱浮窗 / 桌面小组件」相关的窗口生命周期与 IPC：
//   - 工具箱浮窗：创建/隐藏/显示、拖动、缩放、全屏、鼠标穿透、右键菜单、会话级显隐
//   - 桌面小组件：创建/按启用状态建关（scheduleCreateDesktop / setDesktopEnabled）
//   - 相关 IPC：widgets-ready / desktop-widget-enabled / widget-* / to-widget / to-main 等
//
// 依赖注入：窗口引用与「开发服务器就绪后再导航」工具由 main.js 通过 registerWidgetIpc 注入
// （getter/闭包，调用时取当前值）。本模块自有的可变状态（两个窗口引用、拖动/缩放/全屏临时态、
// 桌面组件开关、会话级工具箱开关）全部收敛在本模块内。
//
// 与本模块 __dirname 相关的路径：本文件位于 electron/main/，preload.js 在上一级。
// =========================================================================

const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron')
const path = require('path')
const startupTimer = require('./startup-timer')
const { applyBackgroundMaterial } = require('./window-material')

const isDev = !app.isPackaged

// 窗口 / 工具出口：由 registerWidgetIpc 注入（均为调用时取当前值）
let getMainWindow = () => null
// 开发模式下「等 Vite 就绪再导航」的重试加载器（定义在 main.js，供主/引导/迁移/工具箱共用）
let loadUrlWithRetry = () => {}

// ===== 窗口引用 =====
let widgetWindow = null
let desktopWidgetWindow = null

// ===== 工具箱浮窗状态 =====
// 上次浮窗位置：销毁前记下，重建时恢复，避免「关掉再打开」跳回屏幕左侧中间
let lastWidgetBounds = null
// 居中前的位置：关闭工具后恢复用
let lastIconPosition = null
// 记录预期窗口尺寸，防止拖动时漂移
let currentWidgetSize = [48, 48]
// 拖动起点：窗口初始位置 / 鼠标初始位置 / 初始尺寸
let dragStartWindowPos = null
let dragStartMousePos = null
let dragStartWindowSize = null
// 全屏（注释工具）前的窗口位置与尺寸
let preFullscreenBounds = null
// 「本次启用工具箱」会话级开关：仅影响本次运行浮窗显隐（不持久）。
// null = 尚未由浮窗初始化（浮窗会以持久「是否启用工具箱」作为本次默认注入）。
let sessionWidgetEnabled = null

// ===== 桌面小组件状态 =====
// 「桌面小组件按需创建」：主窗口渲染层延迟到「首帧真正空闲」才回报，主进程据此错峰创建窗口
let desktopEnabled = true

// 小组件窗口四周留出的阴影绘制边距（px）。
// 渲染层用同值 padding 让「视觉内容」贴回原位置，因此窗口比内容大 2*M，且窗口位置相对视觉位置偏移 -M。
const WIDGET_SHADOW_MARGIN = 16

function createWidgetWindow() {
  widgetWindow = new BrowserWindow({
    width: 48 + WIDGET_SHADOW_MARGIN * 2,
    height: 48 + WIDGET_SHADOW_MARGIN * 2,
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
      preload: path.join(__dirname, '..', 'preload.js'),
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

  // 初始位置：屏幕左边缘中间（窗口相对视觉位置偏移 -M，让图标仍贴在左边缘）
  const { height: screenH } = screen.getPrimaryDisplay().workAreaSize
  widgetWindow.setPosition(-WIDGET_SHADOW_MARGIN, Math.round(screenH / 2 - 24) - WIDGET_SHADOW_MARGIN)

  if (process.platform === 'darwin') {
    widgetWindow.setWindowButtonVisibility(false)
  }

  if (isDev) {
    loadUrlWithRetry(widgetWindow, 'http://127.0.0.1:5173/widget.html')
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
      const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize

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

  // 身份守卫：重启小组件时旧窗口的 closed 可能晚于新窗口创建触发，
  // 若不加判断会把刚建好的新引用置空（mainWindow 已是这种写法）。
  const self = widgetWindow
  widgetWindow.on('closed', () => {
    if (widgetWindow === self) widgetWindow = null
  })
}

// 工具箱浮窗的会话级显隐：隐藏即销毁，避免渲染进程常驻占用内存（约 20MB 量级）。
// 重新启用时按需重建并恢复上次位置；重建后浮窗自身会重新拉取状态，无需外部还原。
function hideWidgetWindow() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  try { lastWidgetBounds = widgetWindow.getBounds() } catch (_) { /* 忽略 */ }
  try { widgetWindow.destroy() } catch (_) { /* 忽略 */ }
  widgetWindow = null
}

function showWidgetWindow() {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    createWidgetWindow()
    if (lastWidgetBounds && widgetWindow && !widgetWindow.isDestroyed()) {
      try { widgetWindow.setPosition(lastWidgetBounds.x, lastWidgetBounds.y) } catch (_) { /* 忽略 */ }
    }
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.show()
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
      preload: path.join(__dirname, '..', 'preload.js'),
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
    desktopWidgetWindow.loadURL('http://127.0.0.1:5173/desktop-widget.html')
  } else {
    desktopWidgetWindow.loadURL('app://local/desktop-widget.html')
  }

  const self = desktopWidgetWindow
  desktopWidgetWindow.on('closed', () => {
    if (desktopWidgetWindow === self) desktopWidgetWindow = null
  })
}

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

function registerWidgetIpc(opts = {}) {
  if (typeof opts.getMainWindow === 'function') getMainWindow = opts.getMainWindow
  if (typeof opts.loadUrlWithRetry === 'function') loadUrlWithRetry = opts.loadUrlWithRetry

  // 主窗口渲染层空闲回报：同时创建工具箱浮窗，并（按启用状态）创建/关闭桌面小组件窗口
  ipcMain.on('widgets-ready', (event, enabled) => {
    const mainWindow = getMainWindow()
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
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (event.sender !== mainWindow.webContents) return
    setDesktopEnabled(enabled)
  })

  // 调整小组件窗口大小（带边界保护，防止超出屏幕）
  // 入参 [width, height] 为「视觉内容」尺寸；窗口实际会比它大 2*M，四周多出的部分用于绘制阴影。
  // 窗口位置保持不变——因为渲染层内容相对窗口固定偏移 M，所以视觉内容在屏幕上的位置不会变。
  ipcMain.on('widget-resize', (event, [width, height]) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      const M = WIDGET_SHADOW_MARGIN
      widgetWindow.setContentSize(width + M * 2, height + M * 2)
      const [actualW, actualH] = widgetWindow.getContentSize()
      currentWidgetSize = [actualW, actualH]

      // 回执：告知渲染层窗口尺寸已生效，便于其「先改尺寸、再显示内容」，避免固定延时造成的空窗
      try { widgetWindow.webContents.send('from-main', { type: 'widget-resized', width: actualW, height: actualH }) } catch (_) { /* 忽略 */ }

      // 边界保护：保证「视觉内容」（去掉阴影边距后的部分）不越出屏幕。
      // 因视觉内容相对窗口左上角偏移 M，窗口本身允许向外溢出 M。
      const [x, y] = widgetWindow.getPosition()
      const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize

      let newX = Math.min(Math.max(x, -M), screenW - width - M)
      let newY = Math.min(Math.max(y, -M), screenH - height - M)

      if (newX !== x || newY !== y) {
        widgetWindow.setPosition(newX, newY)
      }
    }
  })

  // 将窗口移动到指定位置
  ipcMain.on('widget-move-to', (event, position) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      const { height: screenH } = screen.getPrimaryDisplay().workAreaSize
      const [winWidth, winHeight] = widgetWindow.getSize()
      if (position === 'left-middle') {
        const x = 0
        const y = Math.round((screenH - winHeight) / 2)
        widgetWindow.setPosition(x, y)
      }
    }
  })

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
          hideWidgetWindow()
          // 通知设置页同步「本次启用工具箱」开关为关闭
          getMainWindow()?.webContents.send('from-main', { type: 'session-widget-changed' })
        },
      },
    ])
    menu.popup({ window: win || undefined })
  })

  // 会话级「本次启用工具箱」：仅影响本次运行浮窗显隐，不持久化
  ipcMain.on('widget-set-session-visible', (event, enabled) => {
    sessionWidgetEnabled = !!enabled
    // 开启即按需重建并显示；关闭即销毁窗口释放渲染进程，位置由 lastWidgetBounds 记忆
    if (sessionWidgetEnabled) showWidgetWindow()
    else hideWidgetWindow()
  })

  // 读取会话级开关；未初始化（尚未注入本次默认值）返回 null
  ipcMain.handle('get-session-widget-visible', () => sessionWidgetEnabled)

  // 桌面组件获取主窗口的 token（跨渲染进程共享，避免 cookie/localStorage 隔离）
  ipcMain.handle('get-main-token', () => {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      return mainWindow.webContents.executeJavaScript('localStorage.getItem("token")', true)
    }
    return null
  })

  // 拖动中：使用 setContentBounds 与 setContentSize 保持一致，避免 setBounds/setSize 边界计算差异
  ipcMain.on('widget-drag-move', (event, { screenX, screenY }) => {
    if (widgetWindow && !widgetWindow.isDestroyed() && dragStartWindowPos && dragStartMousePos && dragStartWindowSize) {
      const dx = screenX - dragStartMousePos[0]
      const dy = screenY - dragStartMousePos[1]
      let newX = Math.round(dragStartWindowPos[0] + dx)
      let newY = Math.round(dragStartWindowPos[1] + dy)

      const [width, height] = dragStartWindowSize
      const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize

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
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('from-widget', data)
    }
  })
}

module.exports = {
  registerWidgetIpc,
  createWidgetWindow,
  hideWidgetWindow,
  showWidgetWindow,
  createDesktopWidgetWindow,
  getWidgetWindow: () => widgetWindow,
  getDesktopWidgetWindow: () => desktopWidgetWindow,
  setDesktopWidgetWindow: (w) => { desktopWidgetWindow = w },
  isDesktopEnabled: () => desktopEnabled,
}