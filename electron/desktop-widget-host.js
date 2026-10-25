// =========================================================================
// desktop-widget-host.js —— 桌面小组件的独立进程入口
//
// 为什么要有这个进程：
//   桌面组件是**常驻**在桌面上的独立窗口，与主应用生命周期不同（主应用退出后它可继续存在），
//   且它需要**崩溃隔离**：组件窗口一旦因外部原因（Explorer 重启、驱动异常等）导致 Electron
//   原生崩溃（实测整个进程瞬间消失，无 JS 异常、无 dmp），若与主应用同进程，主应用会跟着陪葬。
//   放进独立进程后，崩溃只影响这个子进程，主进程侧（main.desktop-widget-process.js）
//   检测到它退出会自动重建，主应用毫发无损。
//
// 入口方式：
//   由 electron/main/main.js 在**最顶部**检测 argv 里的 --desktop-widget-host 后 require 本文件，
//   因此不会再执行主应用的单实例锁、后端、主窗口等逻辑。
//
// 窗口形态（**与第一版一致**）：
//   顶层窗口 + 系统亚克力材质（backgroundMaterial:'acrylic'），**不挂桌面层**。
//   原因：DWM 的系统背景材质只对**顶层窗口**生效 —— 挂成桌面层子窗口（WS_CHILD）后
//   亚克力会完全失效，窗口退化成一块死白板（即「背景模糊消失」的根因，已实测确认）。
//   详见下方 createWindow 的说明。
//
// 状态继承：
//   不修改 userData（与主应用共用同一个 Chromium profile），所以 app://local 这个 origin 下的
//   localStorage 与主窗口是同一份——token、主题、玻璃/日夜等设置全部自动继承，渲染层不需要改。
// =========================================================================

const fs = require('fs')
const { app, BrowserWindow, ipcMain, screen, protocol } = require('electron')

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
// 是否已成功挂到桌面层（仅设置里开启「常驻最底层」时为 true）
let attached = false

// 诊断日志：host 进程以 stdio:'ignore' 启动，console.warn 一行都看不到，
// 页面加载失败这类问题在用户侧就是完全静默的。这里把原因落到 userData 下的日志文件。
function logDiag(msg) {
  try {
    const p = require('path').join(app.getPath('userData'), 'desktop-layer.log')
    fs.appendFileSync(p, '[' + new Date().toISOString() + '] ' + msg + '\n')
  } catch (_) {
    /* 忽略 */
  }
}

// ===== 窗口 =====
function createWindow() {
  // 窗口形态：**与第一版一致** —— 顶层窗口 + 系统亚克力材质。
  //
  // 为什么不挂桌面层（Progman 子窗口）：DWM 的系统背景材质（亚克力）**只对顶层窗口生效**。
  // 挂到桌面层后 attach() 会把窗口改成 WS_CHILD，于是：
  //   · acrylic 完全失效（实测：子窗口+亚克力的截图与「无材质」的像素统计完全一致，材质贡献为 0）；
  //   · CSS backdrop-filter 在子窗口里也采样不到背后的兄弟窗口；
  //   · 窗口若带不透明底色 → 退化成一整块死白板（即「背景模糊消失」的根因）。
  // 另实测过把顶层窗口压到 z 序底部（SetWindowPos HWND_BOTTOM / 插到 Progman 之后）：
  // 亚克力虽在，但**点击会被前面的窗口吃掉**（桌面 shell 挡输入）—— 与子窗口是同一个死结。
  // 故「真亚克力」与「常驻最底层」在 Windows 上互斥，这里按用户选择**优先保证真亚克力**。
  //
  // 保留独立进程的价值不受影响：Explorer 重启崩溃隔离、userData 继承、崩溃自动重建
  // 都与窗口层级无关（见文件顶部说明）。
  //
  // 若用户在设置里显式开启了「常驻最底层」（主进程会传 --desktop-layer），则挂到桌面层：
  // 此时**系统亚克力会失效**（DWM 材质只对顶层窗口生效），背景会退化成纯色。
  // 这是 Windows 层面的取舍，两种形态不可兼得（详见上方说明）。
  const useDesktopLayer = process.argv.includes('--desktop-layer')
  win = new BrowserWindow({
    width: 320,
    height: 540,
    frame: false,
    // 不用 transparent（透明窗口会禁用系统背景材质）。
    transparent: false,
    backgroundMaterial: 'acrylic',
    // 底色必须**透明**（#00000000）：它是不透明底漆，画在亚克力之上会把亚克力整个盖住。
    // 实测（同一位置截屏后与真实壁纸同区比色差）：
    //   backgroundColor:'#f0f4f8' → 色差 176（看到的是死底色，亚克力没透出）
    //   backgroundColor:'#00000000' → 色差 54（真实桌面被模糊透出 ✅）
    // 注意：主窗口等处用的 '#f0f4f8' 同样盖住了亚克力，但主窗口的毛玻璃观感靠的是
    // 卡片自身的 backdrop-filter，不依赖整窗亚克力，故不明显。桌面组件的整窗背景
    // 恰恰依赖亚克力，所以这里必须是透明底色。
    backgroundColor: '#00000000',
    alwaysOnTop: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    // 注意：这里不能用 focusable:false。Windows 下它会加 WS_EX_NOACTIVATE，实测该状态下窗口
    // 收不到任何鼠标输入（软件图标、按钮全点不动，拖动也失效）。
    // show:false + 稍后 show()：先建好并加载完，等首帧就绪再上屏，避免闪出空底色。
    // 另实测：顶层窗口用 show() **不会**抢焦点（showInactive 反而会抢），故用 show()。
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

  if (process.platform === 'darwin') {
    win.setWindowButtonVisibility(false)
  }

  // 挂到 Windows 桌面层（仅在设置里显式开启「常驻最底层」时）：成为 Progman 的子窗口 →
  // 常驻所有应用窗口之下、点击不被抬到前台。attach() 内部会同时把样式改成 WS_CHILD
  // （必须，否则点击会被激活流程吞掉），失败时自动恢复样式 + 解挂，退回普通顶层窗口。
  // 注意：此时系统亚克力失效（DWM 材质只对顶层窗口生效），背景是纯色 —— 这是取舍。
  if (useDesktopLayer) {
    const desktopLayer = require('./main/main.desktop-layer')
    attached = desktopLayer.attach(win)
    logDiag(
      (attached ? '已挂到桌面层' : '挂载失败，已退回普通窗口') +
        '（FFI 可用=' + String(desktopLayer.isAvailable()) + '）'
    )
  }

  // 显示时机：
  //  · 顶层窗口（默认）：用 show() 而非 showInactive()。实测结论与直觉相反 ——
  //    顶层窗口 **show() 不抢焦点**（焦点保持在前台应用），而 showInactive() 反而会抢。
  //    仍需延后到页面加载完成后才显示，避免闪出空底色。
  //  · 桌面层子窗口：showInactive()，避免抢用户当前窗口的焦点。
  if (attached) {
    win.showInactive()
  } else {
    showWhenReady()
  }

  win.on('close', () => {
    if (attached) {
      try {
        require('./main/main.desktop-layer').detach(win)
      } catch (_) {
        /* 忽略 */
      }
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
    logDiag('页面加载失败：' + url + ' — ' + ((e && e.message) || e))
  })
}

// 等首帧内容绘制完成再上屏：否则窗口出现的那一刻是一整块空底色（亚克力还没透出内容），
// 观感上像「闪一下白板」。ready-to-show 在无边框窗口上等价于首帧已绘制。
function showWhenReady() {
  if (!win || win.isDestroyed()) return
  const show = () => {
    if (win && !win.isDestroyed() && !win.isVisible()) win.show()
  }
  win.once('ready-to-show', show)
  // 兜底：某些情况下 ready-to-show 可能不触发（页面加载失败等），超时后仍要显示
  setTimeout(show, 1500)
}

// ===== IPC =====
// 渲染层会先向主进程要 token；独立进程这边没有主窗口可读，直接回 null，
// 渲染层随即回退到 localStorage（与主应用共用同一 userData，token 本来就在）。
//
// 桌面层模式的拖动 IPC：**只有挂到桌面层时才需要**。
// 顶层窗口用 Electron 原生的 -webkit-app-region: drag 即可（渲染层直接给 .drag-handle 加该样式）；
// 而桌面层子窗口里 app-region 会失效（系统把 SC_MOVE 转发给父窗 Progman，表现为完全拖不动），
// 只能由渲染层上报鼠标屏幕坐标、本进程 SetWindowPos 搬窗口。
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

// 拖动起点：窗口矩形 + 鼠标位置，均为「屏幕物理像素」
let dragStartRect = null
let dragStartMouse = null

function registerIpc() {
  ipcMain.handle('get-main-token', () => null)

  // 告诉渲染层当前是哪种形态：顶层窗口（原生 app-region 拖动）还是桌面层子窗口（自实现拖动）。
  // 渲染层据此决定拖动手柄用哪种方式。
  ipcMain.handle('get-desktop-layer-state', () => ({
    desktopLayerEnabled: !!attached,
    autoDisabled: false,
    faultStreak: 0,
  }))

  // 桌面层模式的自实现拖动。渲染层只在挂到桌面层时才发这些事件
  // （顶层窗口走原生 app-region，渲染层不会发）。
  ipcMain.on('desktop-widget-drag-start', (event, pos) => {
    if (!attached || !isWidgetSender(event) || !pos) return
    const desktopLayer = require('./main/main.desktop-layer')
    const rect = desktopLayer.getRect(win)
    if (!rect) return
    const s = desktopScaleFactor()
    dragStartRect = rect
    dragStartMouse = [Math.round(pos.screenX * s), Math.round(pos.screenY * s)]
  })

  ipcMain.on('desktop-widget-drag-move', (event, pos) => {
    if (!attached || !isWidgetSender(event) || !pos) return
    if (!dragStartRect || !dragStartMouse) return
    const desktopLayer = require('./main/main.desktop-layer')
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
    if (attached) {
      try {
        require('./main/main.desktop-layer').raiseToTop(win)
      } catch (_) {
        /* 忽略 */
      }
    }
  })
}

app.whenReady().then(() => {
  if (!isDev) setupAppProtocol()
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
