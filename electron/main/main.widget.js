// =========================================================================
// widget.js —— 工具箱浮窗 + 桌面小组件
//
// 汇总主进程里与「工具箱浮窗 / 桌面小组件」相关的窗口生命周期与 IPC：
//   - 工具箱浮窗：创建/隐藏/显示、拖动、缩放、全屏、鼠标穿透、右键菜单、会话级显隐
//   - 桌面小组件：**窗口跑在主进程里**（与工具箱同一套生命周期），320 × 工作区 95%、
//     透明（圆角由页面 CSS 绘制）。设置里可开启「常驻最底层」，实现是把窗口的 z 序
//     插到「Progman 之上、所有可见窗口之下」（见 main.desktop-layer.js），**不是**
//     SetParent 子窗口 —— 子窗口形态下移动会让 Electron 原生崩溃（0xC000041D）。
//   - 相关 IPC：widgets-ready / desktop-widget-enabled / desktop-widget-content-ready /
//     desktop-widget-drag-* / desktop-widget-open-page / get-desktop-layer-state /
//     widget-* / to-widget / to-main 等
//
// 桌面小组件为什么从独立进程合并回来（v0.8.x）：独立进程原本只为隔离「跨进程子窗口
// 被移动 → 原生崩溃」这一类问题，而置底实现改成顶层窗口 + z 序之后该诱因已消失；
// 合并省掉一个 Chromium browser/GPU 进程与整套 spawn/重建/会话快照逻辑。
// 代价：browser 进程级原生崩溃不再隔离（与工具箱同等风险水平）。渲染进程崩溃仍隔离，
// 且这里用 render-process-gone 自动重载兜底。
//
// 依赖注入：窗口引用与「开发服务器就绪后再导航」工具由 main.js 通过 registerWidgetIpc 注入
// （getter/闭包，调用时取当前值）。本模块自有的可变状态（两个窗口引用、拖动/缩放/全屏临时态、
// 桌面组件开关、会话级工具箱开关）全部收敛在本模块内。
//
// 与本模块 __dirname 相关的路径：本文件位于 electron/main/，preload 在上一级。
// =========================================================================

const fs = require('fs')
const path = require('path')
const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron')
const startupTimer = require('./main.startup-timer')
const { buildWebPreferences } = require('./main.web-prefs')
// Windows 置底：把组件窗口的 z 序插到「Progman 之上、所有可见窗口之下」
const desktopLayer = require('./main.desktop-layer')

const isDev = !app.isPackaged

// 窗口 / 工具出口：由 registerWidgetIpc 注入（均为调用时取当前值）
let getMainWindow = () => null
// 主窗口已关闭到托盘时，点击组件面板需要按原关闭策略重建主窗口（同样由 main.js 注入）
let createMainWindow = () => {}
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
// 置底是**唯一形态**（不再有开关）：窗口是否已成功置底；attach 失败时退回普通顶层窗口
let desktopLayerOn = false
// 拖动起点：内容矩形 + 鼠标位置（均为 DIP）
let desktopDragBounds = null
let desktopDragMouse = null
// 上屏兜底与 z 序自愈定时器
let desktopShowTimer = null
let desktopLayerWatchdog = null
let desktopContentReady = false
// 渲染层迟迟不发就绪信号（页面加载失败等）时的兜底上屏时间
const DESKTOP_READY_TIMEOUT_MS = 8000

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
    // 渲染进程安全配置见 web-prefs.js。浮窗需持续重绘，关闭后台节流，
    // 避免失焦时亚克力/毛玻璃变灰
    webPreferences: buildWebPreferences({ backgroundThrottling: false })
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

// 退出工具箱（右键菜单与菜单面板里的「退出工具箱」按钮共用）：
// 关闭浮窗 + 通知主窗口把持久化开关 toolboxEnabled 置 false。
// 主窗口负责调后端（后端 PUT 是整体覆盖，由它读完整设置再写回，避免清空保存路径），
// 因此设置页的「是否启用工具箱」会同步变为关闭，下次启动也不再出现。
function exitToolbox() {
  sessionWidgetEnabled = false
  hideWidgetWindow()
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('from-main', { type: 'toolbox-close-request' })
  }
}

// ===== 桌面小组件：窗口生命周期（主进程内）=====
// 窗口形态：320 × 工作区 95% 的**顶层窗口** + 透明（四角圆角由页面 CSS border-radius 绘制，
// 见 DesktopWidget.vue）。置底模式只是把它的 z 序插到「Progman 之上、所有可见窗口之下」，
// 由 main.desktop-layer.js 负责；**不要**改回 SetParent 子窗口（移动会原生崩溃）。
//
// 拖动：渲染层 pointerdown/pointermove 上报 screenX/screenY（CSS 像素 = DIP），这里用
// getContentBounds 记起点、每帧 setContentBounds **连宽高一起**搬（只改位置会让窗口越拖越大，
// 工具箱浮窗当年同一个坑），松手 setContentSize 兜底并把落点写进 desktop-widget-pos.json。

function desktopPosFile() {
  return path.join(app.getPath('userData'), 'desktop-widget-pos.json')
}
// 桌面组件的诊断日志：沿用原来的 desktop-layer.log（与 startup.log 放一起），
// 排查「没显示 / 没置底 / 拖动异常」先看它。主进程侧只记关键节点，不刷流水账。
// 仅开发模式写入：正式打包版不产出 desktop-layer.log。
function logWidget(msg) {
  if (!isDev) return
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'desktop-layer.log'),
      '[' + new Date().toISOString() + '] ' + msg + '\n'
    )
  } catch (_) {
    /* 忽略 */
  }
}
function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (_) {
    return null
  }
}
function writeJsonFile(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj))
  } catch (e) {
    console.warn('[widget] 写状态文件失败：', file, e && e.message)
  }
}

function desktopWidgetUrl() {
  return isDev
    ? 'http://127.0.0.1:5173/desktop-widget.html'
    : 'app://local/desktop-widget.html'
}

function stopDesktopTimers() {
  if (desktopShowTimer) {
    clearTimeout(desktopShowTimer)
    desktopShowTimer = null
  }
  if (desktopLayerWatchdog) {
    clearInterval(desktopLayerWatchdog)
    desktopLayerWatchdog = null
  }
}

// 上屏：**先确认已贴到桌面之上，再显示**（反过来会先以普通顶层窗口浮到最前闪一下）
function showDesktopWidget() {
  const win = desktopWidgetWindow
  if (!win || win.isDestroyed() || win.isVisible()) return
  desktopLayerOn = desktopLayer.attach(win)
  if (desktopLayerOn) {
    win.showInactive()
    desktopLayer.reassert(win)
  } else {
    // attach 失败（非 Windows / koffi 缺失）：退回普通顶层窗口，只影响层级不影响可用性
    win.show()
  }
  logWidget('[widget] shown bottom=' + desktopLayerOn)
  startupTimer.mark('桌面组件上屏')
}

// 渲染层没发就绪信号（页面加载失败等）时仍要上屏，避免组件永远不出现
function scheduleDesktopShowFallback() {
  if (desktopContentReady || !desktopWidgetWindow) return
  if (desktopShowTimer) clearTimeout(desktopShowTimer)
  desktopShowTimer = setTimeout(() => {
    desktopShowTimer = null
    showDesktopWidget()
  }, DESKTOP_READY_TIMEOUT_MS)
}

// z 序自愈：Explorer 重启会重建 Progman，别的程序也可能插队，定时确认「仍在可见窗口之下」。
// 只调 z 序、不移动窗口，开销是几个 user32 调用。
function startDesktopLayerWatchdog() {
  if (desktopLayerWatchdog) return
  desktopLayerWatchdog = setInterval(() => {
    if (!desktopLayerOn) return
    const win = desktopWidgetWindow
    if (!win || win.isDestroyed()) return
    if (!desktopLayer.isJustAboveDesktop(win)) desktopLayer.reassert(win)
  }, 5000)
}

// 创建桌面小组件窗口（幂等）。已存在则只把它显示出来。
function createDesktopWidgetWindow() {
  if (desktopWidgetWindow && !desktopWidgetWindow.isDestroyed()) {
    showDesktopWidget()
    return desktopWidgetWindow
  }

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const widgetHeight = Math.round(screenH * 0.95)
  const saved = readJsonFile(desktopPosFile())
  const startX = Number.isFinite(saved && saved.x) ? saved.x : screenW - 340
  const startY = Number.isFinite(saved && saved.y)
    ? saved.y
    : Math.round((screenH - widgetHeight) / 2)

  const win = new BrowserWindow({
    width: 320,
    height: widgetHeight,
    x: Math.round(startX),
    y: Math.round(startY),
    frame: false,
    // 逐像素透明：四角圆角由页面 CSS 绘制，窗口本身不能有不透明底漆
    transparent: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'none',
    alwaysOnTop: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    // 不能用 focusable:false：Windows 下会加 WS_EX_NOACTIVATE，窗口收不到任何鼠标输入。
    // show:false + 内容就绪后再 show：先建好并加载完，避免闪出空窗。
    show: false,
    webPreferences: buildWebPreferences({ backgroundThrottling: false }),
  })
  desktopWidgetWindow = win
  desktopContentReady = false
  logWidget('[widget] created pos=' + Math.round(startX) + ',' + Math.round(startY) +
    ' size=320x' + widgetHeight)

  // 渲染层 console（仅开发模式）与硬故障：主进程没有 stdio，统一落到 desktop-layer.log
  if (isDev) {
    let lastMsg = ''
    let lastAt = 0
    win.webContents.on('console-message', (e) => {
      if (!e || !e.message) return
      const text = String(e.message)
      if (e.level === 'info' && text.startsWith('[dw-timing]')) { logWidget(text); return }
      if (e.level !== 'error' && e.level !== 'warning') return
      if (text === lastMsg && Date.now() - lastAt < 30000) return
      lastMsg = text
      lastAt = Date.now()
      logWidget('[renderer:' + e.level + '] ' + text.slice(0, 600))
    })
  }
  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame) logWidget('主框架加载失败(' + code + ' ' + desc + '): ' + url)
  })

  // 渲染进程崩了（页面 OOM / GPU 掉驱动）别让窗口一直白着：自动重载一次。
  // 注意这只能兜住渲染进程级崩溃，browser 进程级崩仍会带走主应用（与工具箱同等风险）。
  win.webContents.on('render-process-gone', (e, details) => {
    console.warn('[widget] 桌面组件渲染进程退出：', JSON.stringify(details || {}))
    logWidget('[widget] render-process-gone ' + JSON.stringify(details || {}).slice(0, 300))
    if (desktopWidgetWindow !== win || win.isDestroyed()) return
    try {
      win.reload()
    } catch (_) {
      /* 忽略 */
    }
  })
  win.webContents.on('did-finish-load', () => scheduleDesktopShowFallback())

  // 用户点击会把窗口激活并抬到最前：失焦/再获焦都重新压回底层
  win.on('focus', () => {
    if (desktopLayerOn) desktopLayer.reassert(win)
  })
  win.on('blur', () => {
    if (desktopLayerOn) desktopLayer.reassert(win)
  })
  win.on('closed', () => {
    if (desktopWidgetWindow === win) desktopWidgetWindow = null
    desktopLayerOn = false
    desktopDragBounds = null
    desktopDragMouse = null
    stopDesktopTimers()
  })

  if (isDev) loadUrlWithRetry(win, desktopWidgetUrl())
  else win.loadURL(desktopWidgetUrl())

  // 置底：先插层（隐藏状态也能设 z 序），上屏等 content-ready
  desktopLayerOn = desktopLayer.attach(win)
  logWidget('[widget] bottom mode at create = ' + desktopLayerOn)
  if (desktopLayerOn) startDesktopLayerWatchdog()
  startupTimer.mark('桌面组件创建完成')
  return win
}

function destroyDesktopWidgetWindow() {
  const win = desktopWidgetWindow
  desktopWidgetWindow = null
  desktopLayerOn = false
  desktopDragBounds = null
  desktopDragMouse = null
  stopDesktopTimers()
  if (win && !win.isDestroyed()) win.destroy()
}

function setDesktopEnabled(enabled) {
  desktopEnabled = !!enabled
  if (desktopEnabled) createDesktopWidgetWindow()
  else destroyDesktopWidgetWindow()
}

// 组件面板点击：窗口就在本进程里，直接唤醒/重建主窗口并推路由。
// 主窗口可能已关闭到托盘（引用被置空），此时先按原关闭策略重建，再等页面真正加载完成
// （开发模式还会先经过 data: 占位页）后推路由。

function openMainPage(page) {
  let mainWindow = getMainWindow()
  let created = false
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
    mainWindow = getMainWindow()
    created = true
  }
  if (!mainWindow || mainWindow.isDestroyed()) return
  // 新建窗口交给 createMainWindow 自己的出现时机（ready-to-show），避免提前露出空窗
  if (!created) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  navigateMainWhenReady(mainWindow, page)
}

// 等主窗口加载到真实页面再发 from-main：开发模式的 data: 占位页和加载中的页面都不能接。
// 主窗口已就绪时立即发；未就绪则挂到 did-finish-load，直到 URL 不再是 data: 为止。
function navigateMainWhenReady(mainWindow, page) {
  const wc = mainWindow.webContents
  let done = false
  const send = () => {
    if (done || wc.isDestroyed()) return
    const url = wc.getURL()
    if (!url || url.startsWith('data:') || wc.isLoading()) return
    done = true
    wc.removeListener('did-finish-load', send)
    wc.send('from-main', { type: 'navigate', path: page })
  }
  wc.on('did-finish-load', send)
  send()
}

function registerWidgetIpc(opts = {}) {
  if (typeof opts.getMainWindow === 'function') getMainWindow = opts.getMainWindow
  if (typeof opts.createMainWindow === 'function') createMainWindow = opts.createMainWindow
  if (typeof opts.loadUrlWithRetry === 'function') loadUrlWithRetry = opts.loadUrlWithRetry

  // 浮窗控制通道的统一发送方校验：只接受本进程创建的 widgetWindow 渲染层。
  // 各窗口同 origin，不校验时任何被注入的渲染层都能借这些通道移动/全屏/隐藏浮窗；
  // widget-exit 与 desktop-widget-* 早已有同等校验，这里把剩余通道补齐到同一强度。
  const fromWidgetWindow = (event) => {
    return !!widgetWindow && !widgetWindow.isDestroyed() && event.sender === widgetWindow.webContents
  }

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

  // 读取置底的实际状态（渲染层只用于日志与拖动手柄样式；置底是唯一形态，没有开关）。
  // autoDisabled/faultStreak 是独立进程时代的字段，保留形状、恒为 false/0。
  ipcMain.handle('get-desktop-layer-state', () => ({
    desktopLayerEnabled: desktopLayerOn,
    autoDisabled: false,
    faultStreak: 0,
  }))

  // ===== 桌面小组件窗口 IPC =====
  // 渲染层内容就绪：Vue 挂载完成且骨架 DOM 已生成。此时才显示窗口（置底模式下先插层再显示）。
  ipcMain.on('desktop-widget-content-ready', (event) => {
    const win = desktopWidgetWindow
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return
    desktopContentReady = true
    logWidget('[widget] content ready')
    if (desktopShowTimer) {
      clearTimeout(desktopShowTimer)
      desktopShowTimer = null
    }
    showDesktopWidget()
  })

  // 拖动：起点缓存内容矩形，每帧连宽高一起传（只改位置会让窗口越拖越大）
  ipcMain.on('desktop-widget-drag-start', (event, pos) => {
    const win = desktopWidgetWindow
    if (!win || win.isDestroyed() || event.sender !== win.webContents || !pos) return
    try {
      desktopDragBounds = win.getContentBounds()
    } catch (_) {
      desktopDragBounds = null
      return
    }
    desktopDragMouse = [pos.screenX, pos.screenY]
  })

  ipcMain.on('desktop-widget-drag-move', (event, pos) => {
    const win = desktopWidgetWindow
    if (!win || win.isDestroyed() || event.sender !== win.webContents || !pos) return
    if (!desktopDragBounds || !desktopDragMouse) return
    const { width, height } = desktopDragBounds
    const dx = pos.screenX - desktopDragMouse[0]
    const dy = pos.screenY - desktopDragMouse[1]
    const wa = screen.getPrimaryDisplay().workArea
    const minVisible = 60
    const nx = Math.max(
      Math.round(wa.x - width + minVisible),
      Math.min(Math.round(desktopDragBounds.x + dx), Math.round(wa.x + wa.width - minVisible))
    )
    const ny = Math.max(
      Math.round(wa.y - height + minVisible),
      Math.min(Math.round(desktopDragBounds.y + dy), Math.round(wa.y + wa.height - minVisible))
    )
    win.setContentBounds({ x: nx, y: ny, width, height })
  })

  ipcMain.on('desktop-widget-drag-end', (event) => {
    const win = desktopWidgetWindow
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return
    if (desktopDragBounds) {
      try {
        // 松手兜底尺寸 + 记住落点（重建后回到这里）
        win.setContentSize(desktopDragBounds.width, desktopDragBounds.height)
        const b = win.getContentBounds()
        writeJsonFile(desktopPosFile(), { x: Math.round(b.x), y: Math.round(b.y) })
        logWidget('[widget] drag end pos=' + Math.round(b.x) + ',' + Math.round(b.y))
      } catch (_) {
        /* 忽略 */
      }
    }
    desktopDragBounds = null
    desktopDragMouse = null
    // 松手后压回底层（拖动过程中可能被抬到前台）
    if (desktopLayerOn) desktopLayer.reassert(win)
  })

  // 点击组件面板（课程 / 值日 / 人数 / 倒计时）：唤醒主窗口并切路由。
  // 窗口就在本进程里，直接调用 openMainPage，不再需要父子进程消息中转。
  ipcMain.on('desktop-widget-open-page', (event, page) => {
    const win = desktopWidgetWindow
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return
    if (typeof page === 'string' && page.startsWith('/')) openMainPage(page)
  })

  // 调整小组件窗口大小（带边界保护，防止超出屏幕）
  // 入参 [width, height] 为「视觉内容」尺寸；窗口实际会比它大 2*M，四周多出的部分用于绘制阴影。
  // 窗口位置保持不变——因为渲染层内容相对窗口固定偏移 M，所以视觉内容在屏幕上的位置不会变。
  ipcMain.on('widget-resize', (event, [width, height]) => {
    if (fromWidgetWindow(event)) {
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
    if (fromWidgetWindow(event)) {
      const { height: screenH } = screen.getPrimaryDisplay().workAreaSize
      const [, winHeight] = widgetWindow.getSize()
      if (position === 'left-middle') {
        const x = 0
        const y = Math.round((screenH - winHeight) / 2)
        widgetWindow.setPosition(x, y)
      }
    }
  })

  // 将窗口居中显示（同时保存居中前的位置，以便关闭工具后恢复）
  ipcMain.on('widget-center', (event) => {
    if (fromWidgetWindow(event)) {
      lastIconPosition = widgetWindow.getPosition()
      widgetWindow.center()
    }
  })

  // 恢复图标之前保存的位置
  ipcMain.on('widget-restore-position', (event) => {
    if (fromWidgetWindow(event) && lastIconPosition) {
      widgetWindow.setPosition(lastIconPosition[0], lastIconPosition[1])
    }
  })

  // 全屏小组件（用于注释工具）
  ipcMain.on('widget-fullscreen', (event) => {
    if (fromWidgetWindow(event)) {
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
  ipcMain.on('widget-restore', (event) => {
    if (fromWidgetWindow(event) && preFullscreenBounds) {
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
    if (fromWidgetWindow(event)) {
      widgetWindow.setIgnoreMouseEvents(ignore, { forward: true })
    }
  })

  // 设置工具箱可见性
  ipcMain.on('widget-set-visible', (event, visible) => {
    if (fromWidgetWindow(event)) {
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
    if (fromWidgetWindow(event)) {
      dragStartWindowPos = widgetWindow.getPosition()
      dragStartWindowSize = widgetWindow.getSize()
      dragStartMousePos = [screenX, screenY]
    }
  })

  // 工具箱浮窗右键菜单：「关闭工具箱」= 连同持久化开关一起关掉（设置页的「是否启用工具箱」
  // 会同步变为关闭，下次启动也不再出现）。
  // 注意：渲染层菜单面板里的「退出工具箱」按钮走同一个 exitToolbox（见下方 widget-exit）。
  ipcMain.on('widget-context-menu', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const menu = Menu.buildFromTemplate([
      {
        label: '关闭工具箱',
        click: () => exitToolbox(),
      },
    ])
    menu.popup({ window: win || undefined })
  })

  // 菜单面板里的「退出工具箱」按钮（二次确认在渲染层做，确认后才会发这条）
  ipcMain.on('widget-exit', (event) => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return
    if (event.sender !== widgetWindow.webContents) return
    exitToolbox()
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

  // 桌面组件与主窗口同 origin，token 直接读自己的 localStorage；
  // 原来的 get-main-token IPC 已随独立进程一起删除。

  // 拖动中：使用 setContentBounds 与 setContentSize 保持一致，避免 setBounds/setSize 边界计算差异
  ipcMain.on('widget-drag-move', (event, { screenX, screenY }) => {
    if (fromWidgetWindow(event) && dragStartWindowPos && dragStartMousePos && dragStartWindowSize) {
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
  ipcMain.on('widget-drag-end', (event) => {
    if (fromWidgetWindow(event)) {
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
  // perf 面板关闭组件后会回写 null；同时清掉"已置底"标记，避免看门狗继续操作已销毁窗口
  setDesktopWidgetWindow: (w) => {
    desktopWidgetWindow = w
    if (!w) desktopLayerOn = false
  },
  isDesktopEnabled: () => desktopEnabled,
  isDesktopWidgetRunning: () => !!(desktopWidgetWindow && !desktopWidgetWindow.isDestroyed()),
}