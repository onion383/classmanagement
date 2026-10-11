// =========================================================================
// tray.js —— 无边框自绘标题栏的窗口控制 + 系统托盘 + 关闭确认菜单
//
// 汇总主进程里与「关窗/托盘」相关的一组逻辑：
//   - 关闭确认菜单（渲染层弹窗为主、主进程原生菜单回退）
//   - 系统托盘（主窗口关闭后驻留，左键恢复、右键菜单）
//   - 无边框窗口控制通道：shutdown-action / win-minimize / win-maximize-toggle / win-close
//
// 依赖注入：窗口引用与「重建主窗口」由 main.js 通过 registerTrayIpc 注入（getter 闭包，
// 调用时取当前值）。关闭菜单相关的三个状态（shutdownMenuOpen / allowMainClose /
// mainRendererShutdownReady）与托盘实例归本模块所有，向 main.js 暴露少量语义化方法：
//   resetShutdownState / beginCloseWithoutMenu / handleMainClose / isTrayAlive 等。
// =========================================================================

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

// 关闭确认菜单状态：
//   shutdownMenuOpen —— 菜单已弹出时不再重复弹（close 事件可能反复触发）；
//   allowMainClose  —— 用户已从菜单选择关闭主窗口，放行本次 close（绕过弹出菜单）。
let shutdownMenuOpen = false
let allowMainClose = false
// 渲染层是否已就绪可弹关闭菜单：由渲染层 ready 时经 shutdown-action 回报
let mainRendererShutdownReady = false

// 系统托盘实例
let appTray = null

// 窗口 / 重建主窗口出口：由 registerTrayIpc 注入
let getMainWindow = () => null
let getWidgetWindow = () => null
let getDesktopWidgetWindow = () => null
let createMainWindow = () => {}

// 主窗口（重）建时复位关闭菜单状态：allowMainClose 不会在旧窗口关闭后自动清掉，
// 若不清零，重建后的新主窗口点关闭会被静默放行、不再弹菜单；同时新窗口渲染层未加载
// 完成，待其 ready 回报后才允许渲染层接管关闭菜单。
function resetShutdownState() {
  allowMainClose = false
  shutdownMenuOpen = false
  mainRendererShutdownReady = false
}

// 关闭除进度窗口外的全部窗口前调用：放行主窗口关闭并复位菜单打开标记，
// 避免主窗口 close 被关闭确认菜单拦截。
function beginCloseWithoutMenu() {
  allowMainClose = true
  shutdownMenuOpen = false
}

// 主窗口 close 事件拦截：点击关闭时不直接关闭，而在窗口中央弹出「怎样关闭」菜单。
// 正在整体退出（app.quit）或用户已在菜单里选定关闭主窗口时不拦截。
// 关闭菜单由渲染层（主页面）弹出，复用现有弹窗组件与动画；仅在渲染层尚未就绪/不可用时
// 回退到主进程原生菜单。
function handleMainClose(e, win) {
  if (app.isQuitting || allowMainClose) return
  e.preventDefault()
  if (shutdownMenuOpen) return
  shutdownMenuOpen = true
  if (!requestShutdownMenu(win)) {
    showShutdownMenu(win) // —— 由 requestShutdownMenu 内部针对未就绪的情况再置回 false
  }
}

// 请求渲染层在窗口中央弹出关闭菜单；渲染层未就绪/发送失败返回 false
function requestShutdownMenu(win) {
  if (!mainRendererShutdownReady) return false
  const ex = (w) => !!(w && !w.isDestroyed())
  try {
    win.webContents.send('from-main', {
      type: 'shutdown-menu',
      hasToolbox: ex(getWidgetWindow()),
      hasDesktop: ex(getDesktopWidgetWindow()),
    })
    return true
  } catch (_) {
    return false
  }
}

// 统一的「按所选范围关闭」逻辑：渲染层回传与原生菜单回退共用，避免重复
function closeMainWith(action) {
  shutdownMenuOpen = false
  const widgetWindow = getWidgetWindow()
  const desktopWidgetWindow = getDesktopWidgetWindow()
  if (action === 'all') { app.quit(); return }
  // 关闭组件（桌面组件窗口或工具箱窗口）后再关主窗口；组件未开启时无副作用
  if (action === 'toolbox' && widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close()
  if (action === 'desktop' && desktopWidgetWindow && !desktopWidgetWindow.isDestroyed()) desktopWidgetWindow.close()
  // 先创建托盘再关主窗口：即便主窗口是最后一个窗口，window-all-closed 也能据此保持后台运行
  // （若先关窗，window-all-closed 可能已先触发 shutdownBackend 并退出应用）
  createTray()
  allowMainClose = true
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close() // 主窗口关闭：组件保留时后端仍存活
}

// 托盘是否驻留（主窗口关闭后为 true）。window-all-closed 据此决定是否保持后台运行。
function isTrayAlive() {
  return !!appTray
}

function createTray() {
  if (appTray) return
  try {
    // 用 fs 读取后再建图：打包后 __dirname 位于 asar 内，读文件可被 Electron 透明重定向，
    // 比直接把 asar 内路径交给 nativeImage 更稳妥
    const icon = nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname, '..', 'tray-icon.png')))
    if (icon.isEmpty()) return
    appTray = new Tray(icon)
  } catch (_) {
    appTray = null
    return
  }
  appTray.setToolTip('班集')
  appTray.setContextMenu(Menu.buildFromTemplate([
    { label: '恢复主窗口', click: () => showMainFromTray() },
    { type: 'separator' },
    { label: '完全退出', click: () => { app.isQuitting = true; app.quit() } },
  ]))
  appTray.on('click', () => showMainFromTray())
}

function destroyTray() {
  if (!appTray) return
  try { appTray.destroy() } catch (_) { /* 忽略 */ }
  appTray = null
}

// 从托盘恢复主窗口：已存在则唤起，已关闭则重建，并移除托盘图标
function showMainFromTray() {
  destroyTray()
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    createMainWindow()
  }
}

// 原生菜单回退：仅渲染层未就绪时使用
function showShutdownMenu(win) {
  shutdownMenuOpen = true
  const ex = (w) => !!(w && !w.isDestroyed())
  const widgetWindow = getWidgetWindow()
  const desktopWidgetWindow = getDesktopWidgetWindow()
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

function registerTrayIpc(opts = {}) {
  if (typeof opts.getMainWindow === 'function') getMainWindow = opts.getMainWindow
  if (typeof opts.getWidgetWindow === 'function') getWidgetWindow = opts.getWidgetWindow
  if (typeof opts.getDesktopWidgetWindow === 'function') getDesktopWidgetWindow = opts.getDesktopWidgetWindow
  if (typeof opts.createMainWindow === 'function') createMainWindow = opts.createMainWindow

  // 渲染层回报：就绪标记 / 用户选择（action）/ 取消
  ipcMain.on('shutdown-action', (event, data) => {
    if (!data) return
    if (data === 'ready' || data?.type === 'ready') { mainRendererShutdownReady = true; return }
    if (data === 'cancel' || data?.action === 'cancel') { shutdownMenuOpen = false; return }
    const action = (typeof data === 'string' ? data : data?.action)
    closeMainWith(action === 'desktop' || action === 'toolbox' || action === 'all' || action === 'main' ? action : 'main')
  })

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
}

module.exports = {
  registerTrayIpc,
  createTray,
  destroyTray,
  isTrayAlive,
  resetShutdownState,
  beginCloseWithoutMenu,
  handleMainClose,
}