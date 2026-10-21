// =========================================================================
// desktop-widget-host.js —— 桌面小组件的独立进程入口
//
// 为什么要有这个进程：
//   桌面组件窗口要挂到 Windows 桌面层（Progman 的子窗口，见 main.desktop-layer.js），而
//   **Explorer 重启会销毁 Progman、级联销毁挂在其下的子窗口**，Electron/Chromium 遇到窗口树
//   被外部销毁会**原生崩溃**（实测：普通窗口在同样操作下完全无感；挂了桌面层的窗口会让整个
//   进程瞬间消失，无 JS 异常、无 dmp）。把组件放进独立进程后，Explorer 重启只会带走这个子进程，
//   主应用毫发无损；主进程侧（main.desktop-widget-process.js）检测到它退出会自动重建。
//
// 入口方式：
//   由 electron/main/main.js 在**最顶部**检测 argv 里的 --desktop-widget-host 后 require 本文件，
//   因此不会再执行主应用的单实例锁、后端、主窗口等逻辑。
//
// 状态继承：
//   不修改 userData（与主应用共用同一个 Chromium profile），所以 app://local 这个 origin 下的
//   localStorage 与主窗口是同一份——token、主题、玻璃/日夜等设置全部自动继承，渲染层不需要改。
// =========================================================================

const { app, BrowserWindow, ipcMain, screen, protocol } = require('electron')

const desktopLayer = require('./main/main.desktop-layer')
const { applyBackgroundMaterial } = require('./main/main.window-material')
const { buildWebPreferences } = require('./main/main.web-prefs')
const { setupAppProtocol } = require('./main/main.protocol')

const isDev = !app.isPackaged

// 继承主应用的 userData：同一 profile 才能共享 app://local 下的 localStorage（token、主题、玻璃/日夜）。
// 为什么需要显式传：开发模式下主进程是用「脚本路径 + 参数」拉起本进程的，Electron 找不到
// package.json，app.getName() 会回退成 "Electron"，userData 就变成 Roaming\Electron——
// 与主应用的 Roaming\campus-assistant 是两个 profile，localStorage 完全不共享。
// 必须在 app ready 之前设置。
if (process.env.DW_USER_DATA) {
  try {
    app.setPath('userData', process.env.DW_USER_DATA)
  } catch (e) {
    console.warn('[desktop-widget-host] 设置 userData 失败：', e && e.message)
  }
}

// 是否挂到桌面层。由主进程按设置/自动降级状态传入：带 --no-desktop-layer 时按普通顶层窗口创建
// （稳定优先：不会常驻最底层、会盖住其他窗口，但绝不碰 Progman，也就不存在 Explorer 重启的问题）。
const useDesktopLayer = !process.argv.includes('--no-desktop-layer')

// 打包模式用自定义 app:// 协议加载前端（与主应用一致）。
// 必须在 app ready 之前注册，因此放在模块顶层。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
])

let win = null
// 是否已成功挂到桌面层（false = 降级为普通顶层窗口）
let attached = false
// 拖动起点：窗口矩形 + 鼠标位置，均为「屏幕物理像素」
let dragStartRect = null
let dragStartMouse = null

// ===== 窗口 =====
function createWindow() {
  win = new BrowserWindow({
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
    // show:false：先创建但不上屏。桌面组件要在挂到桌面层之后再显示，
    // 否则它会先以普通顶层窗口身份出现在最前面闪一下（启动瞬间的可见闪烁）。
    show: false,
    webPreferences: buildWebPreferences({ devTools: true, backgroundThrottling: false }),
  })

  // Windows 系统原生背景材质：BackgroundMaterial 已随窗口创建时配置，此处再次确认应用。
  if (process.platform === 'win32') {
    applyBackgroundMaterial(win, 'acrylic')
  }

  // 初始位置：屏幕右上角，高度接近屏幕高度
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const widgetHeight = Math.round(screenH * 0.95)
  win.setContentSize(320, widgetHeight)
  win.setPosition(screenW - 340, Math.round((screenH - widgetHeight) / 2))

  // 挂到 Windows 桌面层：成为 Progman 的子窗口 → 常驻所有应用窗口之下、点击不被抬到前台。
  // attach() 内部会同时把样式改成 WS_CHILD（必须，否则点击会被激活流程吞掉），
  // 失败时自动恢复样式 + 解挂，退回普通顶层窗口。
  if (useDesktopLayer) {
    attached = desktopLayer.attach(win)
  }

  // 挂载完成后再显示：此时窗口已经是桌面层子窗口，不会在启动瞬间跑到最前面闪一下。
  // showInactive 不抢焦点——桌面挂件不该把用户当前窗口的焦点抢走。
  win.showInactive()

  win.on('close', () => {
    if (attached) {
      desktopLayer.detach(win)
      attached = false
    }
  })
  win.on('closed', () => {
    win = null
    // 窗口没了这个进程就没有存在意义（主进程侧的 enabled 决定是否重建）
    app.quit()
  })

  const url = isDev
    ? 'http://127.0.0.1:5173/desktop-widget.html'
    : 'app://local/desktop-widget.html'
  win.loadURL(url).catch((e) => {
    console.warn('[desktop-widget-host] 页面加载失败：', e && e.message)
  })
}

// ===== 拖动 IPC =====
// 挂到桌面层后 -webkit-app-region: drag 失效（SC_MOVE 被转发给父窗 Progman），
// 故由渲染层上报鼠标屏幕坐标、本进程直接 SetWindowPos 搬窗口。
// 坐标口径：渲染层 screenX/screenY 是 CSS 像素（= DIP），desktopLayer 一律用物理像素，
// 这里统一乘 scaleFactor 换算；窗口矩形始终经 desktopLayer.getRect 取，
// 绝不与 Electron getBounds/setBounds 的 DIP 口径混用，否则会漂移。
const desktopScaleFactor = () => screen.getPrimaryDisplay().scaleFactor || 1

const isWidgetSender = (event) => !!win && !win.isDestroyed() && event.sender === win.webContents

const desktopWorkAreaPhysical = (s) => {
  const wa = screen.getPrimaryDisplay().workArea
  return {
    left: Math.round(wa.x * s),
    top: Math.round(wa.y * s),
    right: Math.round((wa.x + wa.width) * s),
    bottom: Math.round((wa.y + wa.height) * s),
  }
}

function registerIpc() {
  ipcMain.on('desktop-widget-drag-start', (event, pos) => {
    if (!isWidgetSender(event) || !pos) return
    const rect = desktopLayer.getRect(win)
    if (!rect) return
    const s = desktopScaleFactor()
    dragStartRect = rect
    dragStartMouse = [Math.round(pos.screenX * s), Math.round(pos.screenY * s)]
  })

  ipcMain.on('desktop-widget-drag-move', (event, pos) => {
    if (!isWidgetSender(event) || !pos) return
    if (!dragStartRect || !dragStartMouse) return
    const s = desktopScaleFactor()
    const mx = Math.round(pos.screenX * s)
    const my = Math.round(pos.screenY * s)
    const width = dragStartRect.right - dragStartRect.left
    const height = dragStartRect.bottom - dragStartRect.top
    let nx = dragStartRect.left + (mx - dragStartMouse[0])
    let ny = dragStartRect.top + (my - dragStartMouse[1])

    // 边界保护：至少留 60px（DIP）在工作区内，防止拖到看不见的地方找不回来
    const wa = desktopWorkAreaPhysical(s)
    const minVisible = Math.round(60 * s)
    nx = Math.max(wa.left - width + minVisible, Math.min(nx, wa.right - minVisible))
    ny = Math.max(wa.top - height + minVisible, Math.min(ny, wa.bottom - minVisible))

    desktopLayer.moveWindow(win, nx, ny, width, height)
  })

  ipcMain.on('desktop-widget-drag-end', (event) => {
    if (!isWidgetSender(event)) return
    dragStartRect = null
    dragStartMouse = null
    // 松手后重新提一次 z 序：桌面图标层偶尔会把子窗口压回去，压回去就整块点不动了
    if (attached) desktopLayer.raiseToTop(win)
  })

  // 渲染层会先向主进程要 token；独立进程这边没有主窗口可读，直接回 null，
  // 渲染层随即回退到 localStorage（与主应用共用同一 userData，token 本来就在）。
  ipcMain.handle('get-main-token', () => null)
}

app.whenReady().then(() => {
  if (!isDev) setupAppProtocol()
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
