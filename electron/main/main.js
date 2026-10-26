// ===== 桌面组件独立进程分流（必须在任何主应用逻辑之前）=====
// Explorer 重启会销毁桌面壳 Progman、级联销毁挂在其下的子窗口，Electron 随之原生崩溃；
// 因此桌面组件跑在独立进程里，由本入口通过 --desktop-widget-host 拉起后直接进入 host 模块，
// 不再执行单实例锁 / 后端 / 主窗口等主应用逻辑。详见 desktop-widget-host.js 顶部注释。
if (process.argv.includes('--desktop-widget-host')) {
  require('../desktop-widget-host')
  return
}

// 只保留 main.js 自身还在用的出口：托盘/菜单/通知/快捷键随各自模块迁出后不再需要
// （Menu/Tray/nativeImage/globalShortcut/Notification → tray.js 等，screen → widget.js）
const { app, BrowserWindow, ipcMain, shell, protocol, Menu, clipboard } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const startupTimer = require('./main.startup-timer')

// 异步 fs：主进程里凡是「可能慢」的磁盘操作（目录遍历、整目录复制/删除、大文件写盘）
// 一律走它，避免同步 IO 把事件循环堵住（同步期间窗口、菜单、IPC 全部停摆）。
const fsp = fs.promises

// 路径是否存在（异步版 existsSync，语义一致：不区分文件/目录）
async function pathExists(p) {
  try { await fsp.access(p); return true } catch (_) { return false }
}

// 【启动剖析打点·仅开发模式】主进程模块 require 逐项计时。打点只在 dev 生效：
// 打包版 _profMark 是空操作，既不写控制台也不写时间线。
const _profOn = !app.isPackaged
const _profMark = (name, t0) => {
  if (!_profOn) return
  startupTimer.mark(t0 ? `${name}（${Date.now() - t0}ms）` : name)
}
const _profReq = (p) => {
  const _t = _profOn ? Date.now() : 0
  const _m = require(p)
  _profMark(`【prof】require ${p}`, _t)
  return _m
}

// 内存采样与主密钥派生已分别迁至 perf.js / config.js 内部使用，main.js 不再直接引用
const { resolveCompileCacheDir, getMasterKey, saveAppConfig, resolveDataDir, resolveThumbsDir, resolveSkillsDir } = _profReq('./main.config')
const { setupRendererCodeCache, setupAppProtocol } = _profReq('./main.protocol')
const { applyBackgroundMaterial } = _profReq('./main.window-material')
const { buildWebPreferences } = _profReq('./main.web-prefs')
const usb = _profReq('./main.usb')
const updater = _profReq('./main.updater')
const dialogs = _profReq('./main.dialogs')
const apps = _profReq('./main.apps')
const perf = _profReq('./main.perf')
const tray = _profReq('./main.tray')
const backend = _profReq('./main.backend')
const widget = _profReq('./main.widget')
const webviewGuard = _profReq('./main.webview-guard')
const devLoader = _profReq('./main.dev-loader')
const migration = _profReq('./main.migration')

// 应用窗口/任务栏图标：与托盘同源，随 electron/**/* 一起打包，开发与生产均能直接读取。
// Windows 任务栏优先取窗口图标，设置后不再显示 Electron 默认图标（打包版还会用 win.icon 作为 exe 图标）。
const APP_ICON_PATH = path.join(__dirname, '..', 'app-icon.png')

// 性能面板：暴露 GC。
// 必须在 app ready 之前追加开关，主进程与各渲染进程才会提供 global.gc / window.gc；
// 所有调用处仍用 typeof gc === 'function' 兜底（如某些运行环境不生效）。
app.commandLine.appendSwitch('js-flags', '--expose-gc')

// Node 编译缓存（code cache）：把主进程启动过程中加载的模块字节码缓存到磁盘，
// 下一次启动直接复用、跳过解析 + 编译（仅对 Node 侧模块生效，收益在后续启动）。
// 目录固定放 userData 下（见 config.js 的 resolveCompileCacheDir），随版本/源码变更自动失效重建。
try {
  const ccDir = resolveCompileCacheDir()
  fs.mkdirSync(ccDir, { recursive: true })
  if (typeof module.enableCompileCache === 'function') module.enableCompileCache(ccDir)
} catch (_) { /* 编译缓存不可用时静默忽略，不影响启动 */ }

// 首启判定涉及同步读盘（app-config.json + existsSync index.db），提前到模块加载阶段完成，
// 不占用 whenReady → 建窗的关键路径。looksLikeFirstRun 是函数声明，此处调用已被提升。
const firstRunAtStartup = looksLikeFirstRun()

// ============ 窗口原生背景材质（BackgroundMaterial / 亚克力） ============
// 见 window-material.js：applyBackgroundMaterial / disableBackgroundMaterial

let mainWindow
// 当前主窗口的边框模式：'native'（毛玻璃等其他主题，系统原生标题栏）| 'frameless'（Win11 主题，无边框自绘标题栏）。
// 边框无法在运行中切换，故跨模式切换时重建主窗口。
let mainWindowChrome = 'native'

// 工具箱浮窗 / 桌面小组件窗口及其状态、相关 IPC
// 已迁至 widget.js（见 widget.js：createWidgetWindow / registerWidgetIpc / setDesktopEnabled）

// 后端子进程、就绪/失败状态、心跳/重连、启动状态文案（boot-status）
// 已迁至 backend.js（见 backend.js：startBackend / stopBackendProcess / setBootStatus / registerBackendIpc）

// 关闭确认菜单状态（shutdownMenuOpen / allowMainClose / mainRendererShutdownReady）
// 与系统托盘已迁至 tray.js（见 tray.js：handleMainClose / resetShutdownState / registerTrayIpc）

const isDev = !app.isPackaged

// 低版本系统提示调试开关：改为 1 时无条件显示提示画面（忽略真实系统版本与「不再提示」标记），
// 便于本地反复预览；改为 0 恢复按真实系统版本判定。也可用环境变量 OS_WARN_FORCE=1 临时覆盖。
const FORCE_OS_WARN = 0

// 首屏占位共享来源（splash/splash.css、splash/splash.html）与 dev 加载器
// 已迁至 dev-loader.js：见 devLoadingHtml / pollViteAndNavigate / loadUrlWithRetry

// ============ 启动耗时锚点：「窗口首次显示」============
// 「上次启动耗时」的口径：主进程启动 → 第一个窗口真正显示出来的那一刻（用户看到画面的时刻）。
// 所有窗口的显示都走 revealWindow()，锚点定死在那里（startupTimer.end 幂等，仅首次生效）：
// 主窗口是 ready-to-show（首帧绘制完成，未触发时走 1500ms 兜底 reveal）；引导窗口是
// setup-ready（dev 下此刻才 reveal；prod 下创建即显示，锚点顺延到 setup-ready 的 reveal）。
// 后端就绪、首屏数据就绪等更晚的事件不再抬高总耗时——「点开就看到窗口」即启动完成，
// 「点开就能用」（数据到位、占位页移除）另由时间线上的 mark 体现，两者可能是同一秒的不同时刻。

// U盘自动打开 IPC：与原先一致在模块加载阶段注册（不依赖 app ready）
usb.registerUsbIpc()

// 版本更新 IPC：与原先一致在模块加载阶段注册。状态广播只发给主窗口（与旧实现一致，
// 内部自带判空 + isDestroyed），故把出口函数注入 updater。
updater.registerUpdateIpc((payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('from-main', payload)
})

// 文件/文件夹对话框与本地文件读写 IPC：与其余模块一致在模块加载阶段注册
dialogs.registerDialogsIpc({
  getMainWindow: () => mainWindow,
  getWidgetWindow: () => widget.getWidgetWindow(),
})

// 常用软件（选择文件 + 启动）IPC
apps.registerAppsIpc({ getMainWindow: () => mainWindow })

// 性能面板 IPC + 内存采样（窗口/后端句柄以 getter 注入，调用时取当前值）
perf.registerPerfIpc({
  getMainWindow: () => mainWindow,
  getWidgetWindow: () => widget.getWidgetWindow(),
  getDesktopWidgetWindow: () => widget.getDesktopWidgetWindow(),
  setDesktopWidgetWindow: (w) => widget.setDesktopWidgetWindow(w),
  getMigrationWindow: () => migrationWindow,
  getSetupWindow: () => setupWindow,
  getBackendProcess: () => backend.getBackendProcess(),
  isBackendReady: () => backend.isBackendReady(),
  isDesktopEnabled: () => widget.isDesktopEnabled(),
  hideWidgetWindow: () => widget.hideWidgetWindow(),
  showWidgetWindow: () => widget.showWidgetWindow(),
  createDesktopWidgetWindow: () => widget.createDesktopWidgetWindow(),
})

// 托盘 + 无边框窗口控制 + 关闭确认菜单（窗口/重建入口以 getter 注入）
tray.registerTrayIpc({
  getMainWindow: () => mainWindow,
  getWidgetWindow: () => widget.getWidgetWindow(),
  getDesktopWidgetWindow: () => widget.getDesktopWidgetWindow(),
  createMainWindow,
})

// 后端生命周期 IPC（restart-backend / backend-failure / probe-backend / backend-status / boot-status）
// 广播目标窗口以 getter 注入，调用时取当前值
backend.registerBackendIpc({
  getMainWindow: () => mainWindow,
  getWidgetWindow: () => widget.getWidgetWindow(),
  getDesktopWidgetWindow: () => widget.getDesktopWidgetWindow(),
  getMigrationWindow: () => migrationWindow,
  getSetupWindow: () => setupWindow,
})

// 工具箱浮窗 / 桌面小组件 IPC（widgets-ready / widget-* / to-widget / to-main 等）
// 主窗口引用以 getter 注入，开发用「就绪后再导航」加载器以闭包注入
widget.registerWidgetIpc({
  getMainWindow: () => mainWindow,
  loadUrlWithRetry: devLoader.loadUrlWithRetry,
})

// INP 归因落盘（仅开发模式）：渲染层探针把交互耗时汇总经 'inp-report' 发来，
// 追加写入 <数据目录>/inp.log。打包版既不 require 该模块、也不注册通道。
if (!app.isPackaged) require('./main.inpLog').registerInpLogIpc()

// 单实例锁：防止手快点多次图标导致同时跑出多个应用实例。
// 第一个实例拿到锁；后续实例 requestSingleInstanceLock 返回 false，直接退出，
// 并把用户注意力拉回到已存在的主窗口。
const gotSingleInstanceLock = app.requestSingleInstanceLock()

// 注意：后端 fork 不能提前到这里（ready 之前）。fork 的 env 需要 DB_MASTER_KEY，而该值来自
// safeStorage 解密的 db-master.key；Windows 上 safeStorage.isEncryptionAvailable() 只有
// ready 之后才返回 true，提前调用会走进「生成随机新密钥」分支，导致加密库无法打开。
// 因此后端仍在 whenReady 内、建窗之后启动（见下方 app.whenReady 处）。

// 用户又尝试启动一次（重复点击图标/快捷键）时，唤起已存在的主窗口而不是新开
app.on('second-instance', () => {
  // 用户又点了一次图标：有主窗口就唤起，没有（已关闭进托盘）就重建
  tray.destroyTray()
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    createMainWindow()
  }
})

// 测试/调试用：仅开发模式且 INP_DEBUG=1 时开启 Chromium 远程调试端口，
// 供 scripts/inp-probe.mjs 通过 CDP 注入 INP 观测器并派发真实输入事件进行交互性能测量。
// 正式包一律不开启：避免他人用环境变量拉起带 CDP 的正式应用。
if (isDev && process.env.INP_DEBUG) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

// 打包模式用自定义 app:// 安全协议加载前端，避免 file:// 的「不透明 origin」导致
// localStorage 仅会话内生效、每次重启即清空（表现：重新登录 + 设置还原）。
// 标准+安全+supportFetchAPI 使其成为真实持久化的 origin。
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }
])

// 禁用控制台安全警告（仅开发模式）
if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

// 开发模式加载器（loadUrlWithRetry / devLoadingHtml / pollViteAndNavigate）
// 已迁至 dev-loader.js，行为与内嵌实现完全一致

// 主窗口统一「无边框透明 + 窗外亚克力」：所有主题一致，由渲染层自绘标题栏
// （标题栏显示应用名），避免原生标题栏与侧边栏标题重复。边框类型不再随主题切换。
function createMainWindow() {
  _profMark('【prof】createMainWindow 进入')
  // 主窗口（重）建时移除托盘图标：主窗口已恢复，无需再驻留托盘
  tray.destroyTray()
  // （新窗口）关闭菜单状态复位（allowMainClose / shutdownMenuOpen / mainRendererShutdownReady）
  tray.resetShutdownState()
  mainWindowChrome = 'frameless'
  // webPreferences 提出对象字面量单独计时（仅 dev 打点用；打包版行为与内联写法完全一致）
  const _profWpT0 = Date.now()
  const _webPrefs = buildWebPreferences({ devTools: true, webviewTag: true })
  _profMark('【prof】buildWebPreferences 完成', _profWpT0)
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: '班集',
    icon: APP_ICON_PATH,
    // 全部主题统一：无边框 + 系统原生背景材质(backgroundMaterial)，用自绘标题栏。
    // 不用 transparent（透明窗口会禁用系统材质）；backgroundMaterial 绘制在窗口背景，
    // 渲染层用半透明元素 + backdrop-filter 磨砂透出。Win11 也据此自动为窗口加圆角。
    frame: false,
    transparent: false,
    backgroundMaterial: 'acrylic',
    // 首屏显示时机：先隐藏，等首帧内容绘制完成（ready-to-show）后再显示，避免窗口先露出一层
    // 空亚克力底。dev 下首帧是内联 loading 页、prod 下是 index.html 的 splash 占位，
    // 二者都是不透明画面，因此窗口出现的那一刻就是「毛玻璃 + 内容」，与引导窗口同一套做法。
    show: false,
    backgroundColor: '#f0f4f8',
    // 渲染进程安全配置见 web-prefs.js（各窗口统一）。后台节流保持默认：
    // 窗口失焦/最小化/被遮挡时暂停后台重绘，降低后台 GPU/CPU 占用。
    webPreferences: _webPrefs,
  })
  _profMark('【prof】BrowserWindow 构造返回')

  // 立即绑定全局（供 theme-chrome 重建等判断）；内部事件全部用局部 win 引用，
  // 避免重建时旧窗口的 'closed' 事件把 mainWindow 置空，影响到刚创建的新窗口。
  mainWindow = win

  // 所有主题统一（无边框 + 系统材质）：BrowserWindow 构造已带 backgroundMaterial: 'acrylic'，
  // 此处不再重复调 setBackgroundMaterial（省掉启动关键路径上一次 DWM 往返）。
  // 透明度磨砂由渲染层 CSS backdrop-filter 完成。

  if (isDev) {
    // 第一步：加载本地 inline 页面，窗口立即显示（< 1s）
    backend.setBootStatus('正在启动开发服务器…')
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(devLoader.devLoadingHtml())}`)
    startupTimer.mark('开始加载 loading 页面')
    // loading 页首帧只作计时标记，不阻塞下面的 Vite 轮询
    win.webContents.once('did-finish-load', () => {
      if (win.webContents.getURL().startsWith('data:')) startupTimer.mark('loading 页面加载完成')
    })
    // 第二步：立即开始后台轮询 Vite（不再等 loading 页 did-finish-load 才发起），
    // 就绪后自动跳转。Vite 已在运行时可直接跳转，省下等 loading 页加载的数百毫秒。
    devLoader.pollViteAndNavigate(win)
  } else {
    backend.setBootStatus('正在加载界面…')
    win.loadURL('app://local/index.html')
  }

  // 监听渲染进程的 [startup] 日志，记录 Vue 挂载等首屏耗时。
  // 开发模式的 Vite 页面在跳转后才生效，此监听同样覆盖。
  // 仅记录「首次加载」：重启前端（webContents.reload）会重新打这些日志，若继续记录，
  // 其 elapsed 以主进程已运行的时长为基准，会把重启前的时间也一并算进启动耗时——故首屏完成后停收。
  let rendererStartupLogged = false
  // 例外：占位页移除（界面真正可见）必然发生在 did-finish-load 之后，必须放行才能记录；
  // 但只认第一次，避免 reload 再打一遍把时间线污染成两份。
  let splashDropLogged = false
  win.webContents.on('console-message', (event, level, message) => {
    const isSplashDrop = message.startsWith('[startup] 占位页移除')
    if (rendererStartupLogged && !(isSplashDrop && !splashDropLogged)) return
    if (message.startsWith('[startup]')) {
      // 渲染层自报时刻协议：日志尾部带「@<epoch 毫秒>」表示该行由渲染层发出，
      // 数值为事件真实发生时刻（performance.timeOrigin + performance.now()）。
      // 按它打点可剔除 console-message 的跨进程投递延迟；未附数值时退回送达时刻。
      const selfAt = / @(\d{10,})$/.exec(message)
      const at = selfAt ? Number(selfAt[1]) : null
      const label = message.replace('[startup] ', '').replace(/ @\d{10,}$/, '')
      if (isSplashDrop) splashDropLogged = true
      if (at !== null) startupTimer.markAt(label, at)
      else startupTimer.mark(label)
    }
  })
  // 非 data: 页面（真正的应用首屏）加载完成 → 首屏日志已收完，之后的重载不再计入启动时间线
  win.webContents.on('did-finish-load', () => {
    if (!win.webContents.getURL().startsWith('data:')) rendererStartupLogged = true
  })

  // 首帧渲染完成后再显示窗口，消除「先露出一层空亚克力（或白屏）再渲染」的启动观感。
  // 兜底：渲染层异常导致 ready-to-show 始终不触发时也先把窗口显示出来（此时已加载的
  // 占位页保证不是空白），避免应用看起来「没启动」。正常情况 ready-to-show 会先到并取消它。
  // 注意：不要改用 dom-ready 提前显示——type="module" 脚本是 defer 的，DOMContentLoaded 会等
  // 入口 bundle 执行完才触发，实测 dom-ready 始终晚于 ready-to-show，提前不了。
  win.__revealTimer = setTimeout(() => revealWindow(win), 1500)

  // 用局部 win 判断/显示，避免重建时 mainWindow 被旧窗口 closed 置空导致新窗口无法显示。
  win.once('ready-to-show', () => {
    startupTimer.mark('ready-to-show（窗口首次显示）')
    // 启动锚点即此处：下面 revealWindow() 内定死「窗口首次显示」（startupTimer.end 幂等）。
    clearTimeout(win.__revealTimer)
    // 显示前再次确认系统亚克力材质（隐藏状态下创建时材质可能尚未生效），
    // 确保窗口出现的那一刻就是「毛玻璃 + 内容」，而不是一层空底色。
    revealWindow(win)
  })

  // 主窗口关闭拦截：点击关闭时不直接关闭，而在窗口中央弹出"怎样关闭"菜单。
  // 覆盖系统 ✕ 与无边框自绘标题栏的关闭按钮（二者最终都触发 close 事件）。
  // 正在整体退出（app.quit）或用户已在菜单里选定关闭主窗口时不拦截。
  win.on('close', (e) => {
    tray.handleMainClose(e, win)
  })

  win.on('closed', () => {
    // 仅当关闭的是当前引用的窗口时才清空，避免重建时旧窗口的 closed 事件误清新窗口
    if (mainWindow === win) {
      mainWindow = null
    }
  })
}

// 小组件窗口（工具箱浮窗 / 桌面小组件）的创建与显隐、相关 IPC
// 已迁至 widget.js（见 widget.js：createWidgetWindow / hideWidgetWindow / showWidgetWindow /
//   createDesktopWidgetWindow / setDesktopEnabled / registerWidgetIpc）

// ========== 后端生命周期 ==========
// 见 backend.js：startBackend / stopBackendProcess / shutdownBackend / setBootStatus /
//   waitForBackendReadySignal / registerBackendIpc（backend-status / boot-status / probe-backend 等）

// 见 perf.js：registerPerfIpc（perf-snapshot / perf-restart-frontend / perf-restart-widget / perf-gc / perf-startup）/ startMemSampling

// 用户点「退出应用」：置退出标志以跳过主窗口「关闭确认菜单」的拦截，直接退出
ipcMain.on('quit-app', () => {
  app.isQuitting = true
  app.quit()
})

// 原生右键菜单：渲染层在「页面未自行处理右键」时发来请求（见前端 main.js 的全局 contextmenu 监听）。
// Electron 默认不提供右键菜单，此前输入框/文本区右键没有任何反应；这里按上下文弹出系统原生菜单
// （用 role 让系统负责文案本地化与撤销/剪切等可用态），右键手感更接近桌面应用。
ipcMain.on('show-native-context-menu', (event, opts = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return
  const template = []
  if (opts.isEditable && !opts.readOnly) {
    template.push(
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' },
      { role: 'selectAll' },
    )
  } else if (opts.hasSelection) {
    // 只读输入框 / 普通选中文本：只给复制
    template.push({ role: 'copy' })
  }
  if (opts.linkURL) {
    if (template.length) template.push({ type: 'separator' })
    template.push(
      { label: '在浏览器中打开', click: () => { try { shell.openExternal(opts.linkURL) } catch (_) {} } },
      { label: '复制链接地址', click: () => clipboard.writeText(opts.linkURL) },
    )
  }
  if (!template.length) return
  Menu.buildFromTemplate(template).popup({ window: win })
})

// AI 助手悬浮图标右键菜单：与工具箱一致，仅提供「本次退出」——
// 本次运行隐藏悬浮图标与浮窗（不持久化，重启恢复），主程序与后端照常运行。
ipcMain.on('ai-context-menu', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) return
  const menu = Menu.buildFromTemplate([
    {
      label: '本次退出',
      click: () => {
        if (!win.isDestroyed()) win.webContents.send('from-main', { type: 'ai-widget-exit' })
      },
    },
  ])
  menu.popup({ window: win })
})

// ========== 渲染层静态资源（app:// 协议 + 渲染进程代码缓存） ==========
// 见 protocol.js：setupRendererCodeCache / setupAppProtocol

// 「桌面小组件按需创建」与 widgets-ready / desktop-widget-enabled 已迁至 widget.js
// （见 widget.js：scheduleCreateDesktop / setDesktopEnabled / registerWidgetIpc）

// 后端就绪检测（detectBackendReady / readyBuffer）已随后端生命周期迁至 backend.js：
// backend.js 在 startBackend 里自行监听子进程 stdout 并做滚动缓冲 + 子串匹配，此处不再保留副本。

// ========== 版本更新（自建：GitHub Releases + Inno Setup 静默升级）==========
// 见 updater.js：registerUpdateIpc（get-app-version / update-check / update-install）/ runUpdateFlow

app.whenReady().then(() => {
  startupTimer.mark('app.whenReady 就绪')

  // 未拿到单实例锁：说明已有另一个实例在运行，本实例直接退出
  if (!gotSingleInstanceLock) {
    app.quit()
    return
  }

  try {
    // 渲染进程 V8 代码缓存：必须在首个页面加载前设置，故紧跟 ready 先做。
    setupRendererCodeCache()

    setupAppProtocol()
    startupTimer.mark('协议注册完成')

    // 先建窗口、后 fire 后端：窗口创建位于首屏关键路径上（用户第一眼看到的就是它），
    // 而 fork 有 ~60ms 同步阻塞开销（spawn 子进程）。后端是独立子进程，前端靠 backend-ready
    // 事件 + 退避重试兜底「后端稍晚就绪」，因此调换顺序无副作用。
    // 【实测结论·勿再调换】把 fork 提到建窗之前：前端链整体后移 ~65ms、后端就绪只提前 ~10ms，
    // 「界面可见」反而推迟 ~143ms（1169→1312ms）。故维持本顺序。
    // 【实测结论·勿再尝试】把 fork 放进 worker_thread 以规避这 ~60ms 同步阻塞：dev 测量
    // （--dev --real，BANJI_BACKEND_WORKER 开关）下与直连 fork 无「可分辨」差异——中位
    // 「后端就绪/界面可见」754/1241ms vs 基线 775/1247ms，全都落在 dev 抖动（单次可见耗时
    // 波动高达 ±60~230ms）之内；而代价是一整套 worker 生命周期、IPC 双向转发、按 pid
    // 兜底杀进程的复杂度与「退出时残留后端进程」风险。净收益不可测，已回退。
    // （不能把 fork 提到 ready 之前：DB_MASTER_KEY 依赖 safeStorage，见文件上方说明。）
    // 全新安装（本机无任何账号库）先弹首次引导向导，完成后再进入主界面；
    // 非首启维持原路径——主窗口立即创建，不增加任何串行等待。
    // 首次引导默认只在「本机全新安装」（firstRunAtStartup，即数据目录无 index.db）时出现，
    // 开发模式不再默认进入；需要预览引导页时用 FORCE_SETUP=1，跳过时用 FORCE_SETUP=0。
    const forceSetup = process.env.FORCE_SETUP === '1'
    const skipSetup = process.env.FORCE_SETUP === '0'

    // 进入正式启动：建窗（启动窗口或主窗口）→ 起后端 → 内存采样。
    // 「启动窗口」= 引导窗口；它同时承担低版本系统提示（plan.warn 为首屏提示画面）。
    const proceedStartup = () => {
      const needWarn = shouldWarnOsVersion()
      const needSetup = !skipSetup && (forceSetup || firstRunAtStartup)
      if (needWarn || needSetup) {
        launchPlan = { warn: needWarn, setup: needSetup }
        if (needWarn) startupTimer.mark('命中低版本系统，先显示提示画面')
        createSetupWindow(launchPlan)
        startupTimer.mark('createSetupWindow 完成')
      } else {
        // 主窗口立即创建：它加载的静态前端（app://local/index.html 或 dev 的 Vite）不依赖后端，
        // 登录页/首页骨架无需后端即可渲染，前端通过 axios 响应重试兜底「后端未就绪」的短暂窗口。
        createMainWindow()
        startupTimer.mark('createMainWindow 完成')
      }

      backend.startBackend()
      startupTimer.mark('startBackend 完成')

      // 性能面板内存历史：自启动即开始定时采样「总计」，用于「平均（近一分钟）/ 最高（自启动起）」
      perf.startMemSampling()
    }

    // 低版本提示与首次引导合并到同一个启动窗口：命中任一项即在窗口内按「提示 → 引导」顺序展示，
    // 不再单开提示窗口；都未命中时走原路径——主窗口立即创建，不增加任何串行等待。
    proceedStartup()

    // 版本更新：启动后延迟做一次「检查 + 下载」（避开首屏关键路径，仅打包环境）
    if (app.isPackaged) {
      setTimeout(() => { updater.runUpdateFlow() }, 8000)
    }

    // 5s 后输出启动时间线并保存日志
    setTimeout(() => {
      startupTimer.report()
      startupTimer.saveLog()
    }, 5000)

    // U盘自动打开非启动关键路径：延后到主窗口创建后再读配置/开监听，
    // 避免 loadUsbAutoOpenConfig 读盘与 getDriveLetters 同步遍历盘符阻塞主窗口创建。
    setTimeout(() => {
      usb.loadUsbAutoOpenConfig()
      if (usb.isUsbAutoOpenEnabled()) usb.startUsbWatch()
    }, 0)
  } catch (err) {
    console.error('[main] app.whenReady 初始化失败:', err)
  }
}).catch(err => {
  console.error('[main] app.whenReady 未捕获错误:', err)
})

// ========== U盘自动打开 ==========
// 见 usb.js：registerUsbIpc / loadUsbAutoOpenConfig / startUsbWatch

// 后端就绪 / 启动阶段状态查询（backend-status / boot-status）已迁至 backend.js 的 registerBackendIpc

// 在系统默认浏览器打开外链
ipcMain.handle('open-external', (event, url) => {
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url)
  }
})

// 右侧网页抽屉 webview 安全护栏 + 刷新快捷键拦截：见 webview-guard.js
// （原内嵌于此处的 isHttpUrl / app.on('web-contents-created') 已整体迁出，行为不变）
webviewGuard.registerWebviewGuard({ getMainWindow: () => mainWindow, isDev })

// ========== 桌面小组件·常用软件 ==========
// 见 apps.js：registerAppsIpc（apps-select-file / apps-launch）

// 工具箱浮窗相关 IPC（widget-resize / widget-move-to / widget-center / widget-fullscreen /
//   widget-set-visible / widget-drag-* / widget-context-menu / get-session-widget-visible /
//   get-main-token 等）已迁至 widget.js 的 registerWidgetIpc

// 安全通道主密钥：提供给渲染进程（含工具箱/桌面组件）参与前后端 HKDF 派生态。
ipcMain.handle('get-master-key', () => getMasterKey())

// 恢复词等敏感内容：展示期间令窗口排除在屏幕捕获之外（Windows 走 SetWindowDisplayAffinity，
// 截图/录屏得到黑块），关闭或离开设置页时立即恢复。
ipcMain.handle('set-content-protection', (event, enabled) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  try { win.setContentProtection(!!enabled) } catch (_) { return false }
  return true
})

// 复制敏感文本：写剪贴板，并在 TTL 后「仅当剪贴板仍是这段文本」时清空，
// 不覆盖用户后来复制的内容。默认 60 秒。
ipcMain.handle('copy-sensitive-text', (event, { text, ttlMs } = {}) => {
  if (typeof text !== 'string' || !text) return false
  clipboard.writeText(text)
  const ttl = Math.min(Math.max(Number(ttlMs) || 60000, 1000), 10 * 60 * 1000)
  setTimeout(() => {
    try { if (clipboard.readText() === text) clipboard.clear() } catch (_) { /* 读剪贴板失败忽略 */ }
  }, ttl)
  return true
})

// 见 tray.js：registerTrayIpc（shutdown-action / win-minimize / win-maximize-toggle / win-close）/
// handleMainClose / resetShutdownState / createTray / destroyTray / isTrayAlive / beginCloseWithoutMenu

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

// 工具箱浮窗的拖动/移动/尺寸/全屏/鼠标穿透，以及 to-widget / to-main 转发，
// 全部由 widget.js 的 registerWidgetIpc 注册（见本文件上方 widget.registerWidgetIpc 调用）。

// ========== 文件/文件夹对话框与本地文件读写 ==========
// 见 dialogs.js：registerDialogsIpc（select-folder / open-folder / select-image-file /
// save-background-image / save-file / open-file / screenshot-capture / note-save / get-data-directories）

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
    // 渲染进程安全配置见 web-prefs.js（各窗口统一）
    webPreferences: buildWebPreferences(),
  })
  migrationWindow = win

  // 系统原生背景材质（亚克力）：与主窗口一致，窗口创建后确认应用一次（系统不支持时自动回退）
  if (process.platform === 'win32') applyBackgroundMaterial(win, 'acrylic')

  // 迁移进行中拦截关闭（系统 ✕ / Alt+F4）；失败后由「返回主界面」按钮放行
  win.on('close', (e) => { if (migrationRunning) e.preventDefault() })
  win.on('closed', () => { if (migrationWindow === win) migrationWindow = null })

  if (isDev) {
    devLoader.loadUrlWithRetry(win, 'http://127.0.0.1:5173/migration.html')
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
ipcMain.on('migration-dismiss', async (event, data) => {
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
  // 失败时不再自动清理：默认保留已复制内容，只有用户确认「确定」才清除。
  // 清理改为异步并 await：既保持「先清理、再重开主窗口」的原顺序，
  // 又不会像同步 rmSync 那样在删目录期间把主进程整条堵住。
  if (data && data.clean) await cleanupMigrationTarget()
  reopenAfterMigration()
})

// 清理迁移目标目录：仅清掉本次复制写入的内容（用户选定的既有空目录保留目录本身）
async function cleanupMigrationTarget() {
  const ctx = migrationContext
  if (!ctx) return
  try {
    // rm 带 force:true 时目标不存在也不报错，省掉一次 existsSync 同步探测
    if (ctx.createdTarget) await fsp.rm(ctx.target, { recursive: true, force: true })
    else await migration.clearDir(ctx.target)
  } catch (err) {
    console.warn('[main] 清理迁移目标目录失败:', err?.message || err)
  }
}

// 关闭除进度窗口外的全部窗口。必须先建好进度窗口再调用，保证窗口数不为 0，
// 否则会触发 window-all-closed 让应用直接退出。
function closeAllWindowsExceptMigration() {
  if (!migrationWindow || migrationWindow.isDestroyed()) return
  tray.beginCloseWithoutMenu()
  const widgetWindow = widget.getWidgetWindow()
  const desktopWidgetWindow = widget.getDesktopWidgetWindow()
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

// ========== 低版本系统提示（启动前检测）==========
// Windows 10 1709（build 16299）以下：软件依赖的新版 Chromium 特性可能缺失，运行中易异常/崩溃。
// 命中且用户未勾选「不再提示」时，在启动窗口内先显示一屏与安装器同款的提示画面：
// 点「退出程序」直接退出应用，点「忽略」继续（进入引导或主界面），
// 点「获取最新的 Windows」用默认浏览器打开系统下载页并退出。
// 「不再提示」写入 userData 标记文件（安装器侧写注册表）。
// 注意：Electron 本身在 Win7/8.1 上无法启动，故应用内检测实际只覆盖「能启动但版本偏低」的 Win10。
// 「获取最新的 Windows」指向的系统下载页（用默认浏览器打开）
const WIN_DOWNLOAD_URL = 'https://www.microsoft.com/zh-cn/software-download/windows11'

function osWarningSkipPath() {
  return path.join(app.getPath('userData'), 'os-version-warning-skipped')
}

// 解析系统版本：os.release() 形如 "10.0.19045"（Win10）/ "6.1.7601"（Win7）
function getWindowsBuild() {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(os.release() || '')
  if (!m) return null
  return { major: parseInt(m[1], 10), build: parseInt(m[3], 10) }
}

// 是否需要提示：非 Windows 不提示；Win10 且 build >= 16299（1709）视为达标；
// 低于 Win10 或 Win10 但 build 偏低时提示。「不再提示」标记存在时直接跳过。
function shouldWarnOsVersion() {
  if (FORCE_OS_WARN === 1 || process.env.OS_WARN_FORCE === '1') return true
  if (process.platform !== 'win32') return false
  try { if (fs.existsSync(osWarningSkipPath())) return false } catch (_) {}
  const v = getWindowsBuild()
  if (!v) return false
  if (v.major > 10) return false
  if (v.major === 10 && v.build >= 16299) return false
  return true
}

// ========== 首次安装引导向导 ==========
// 全新安装（本机无任何有效账号）时先弹出独立的引导窗口，用户完成初始化后才进入正式使用。
// 复用 preload.js 与「无边框 + 系统亚克力」窗口方案，固定尺寸、不可缩放。
let setupWindow = null
let setupRunning = false
// 本次启动窗口要展示的画面计划：warn=先显示低版本提示，setup=提示后继续走首次引导。
// 窗口创建前由 proceedStartup 写入，渲染层通过 launch-plan invoke 取用决定首屏画面。
let launchPlan = { warn: false, setup: false }
// 预热进度：引导界面完全加载完成后才后台推进，渲染层可在任意时刻通过 get-setup-warmup 补齐状态
let setupWarmup = { phase: '', detail: '', percent: 0, done: false }
let setupWarmupStarted = false

// 等待后端就绪信号（主进程侧）已迁至 backend.js：backend.waitForBackendReadySignal

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
    // 优先等就绪信号：后端一就绪立即重试；信号缺失时退化为 250ms 退避
    await backend.waitForBackendReadySignal(250)
  }
}

// 引导未完成标记：引导窗口创建后即写下，正常走完引导（setup-complete）时删除。
// 后端子进程一启动就会暖机生成 index.db，单靠 index.db 无法判断“用户是否走完引导”，
// 因此用它保证「引导中途关闭/退出 → 下次启动仍重新进入引导」，而不是直接进入主窗口。
function setupPendingMarkerPath() {
  return path.join(app.getPath('userData'), 'setup-incomplete')
}

// 快速首启判定：存在「引导未完成」标记，或数据目录里还没有 index.db（从未初始化过任何账号库）
function looksLikeFirstRun() {
  try {
    if (fs.existsSync(setupPendingMarkerPath())) return true
    return !fs.existsSync(path.join(resolveDataDir(), 'index.db'))
  } catch (_) { return false }
}

// 首启判定：FORCE_SETUP=1 强制为真；否则先看文件系统，再等后端就绪看有效账号是否为空
//
// 注意：**当前启动流程没有调用它**。实际判定用的是上面同步版 looksLikeFirstRun()，
// 经由 firstRunAtStartup 参与 needSetup 计算（见 proceedStartup）。
// 两者差别只有一种场景：index.db 存在、但里面一个有效账号都没有 —— 同步版会判成「非首启」。
// 这个函数是当时为覆盖该场景写的，保留在此以免丢失意图；接线前需确认登录页是否有兜底入口。
/* eslint-disable-next-line no-unused-vars */
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
  if (setupWarmupStarted) return
  setupWarmupStarted = true
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

// 显示窗口（主窗口 / 引导窗口共用）：显示前再次确认系统亚克力材质（隐藏状态下创建时材质
// 可能尚未生效），确保窗口出现的那一刻就是「毛玻璃 + 内容」，而不是一层空底色。
// 同时是「启动完成」锚点：第一个被显示的窗口即用户看到画面的时刻（startupTimer.end 幂等，
// 仅首次调用生效），此后后端就绪、首屏数据等更晚事件都不再抬高「上次启动耗时」。
function revealWindow(win) {
  if (!win || win.isDestroyed()) return
  if (process.platform === 'win32') applyBackgroundMaterial(win, 'acrylic')
  win.show()
  startupTimer.end('窗口首次显示')
}

// 创建引导窗口：固定尺寸、无边框、系统亚克力，引导期间禁止关闭。
// 该窗口同时承担「低版本系统提示」：plan.warn 为真时首屏显示提示画面，用户点「忽略」后
// 再切到欢迎/引导（plan.setup）或直接进主窗口。单一窗口、单一页面，复用同一套卡片样式。
function createSetupWindow(plan = launchPlan) {
  if (setupWindow && !setupWindow.isDestroyed()) {
    setupWindow.focus()
    return setupWindow
  }
  launchPlan = { warn: !!plan.warn, setup: !!plan.setup }
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
    // 首屏显示时机：dev 下先隐藏，等渲染层挂载完成（setup-ready）后再显示，避免先露出空的亚克力底；
    // prod 下静态文件加载极快，直接显示（占位页是纯内联 HTML/CSS，不依赖 JS），窗口"秒出画面"。
    show: !isDev,
    title: '班集',
    icon: APP_ICON_PATH,
    // 渲染进程安全配置见 web-prefs.js（各窗口统一）
    webPreferences: buildWebPreferences(),
  })
  setupWindow = win
  setupRunning = true
  // 记「引导未完成」：仅当本次确有引导流程（plan.setup）时写下，走完引导（setup-complete）才清除；
  // 中途关闭/退出后下次启动仍进入引导。纯低版本提示（warn-only）不写标记，避免把自己变成「需引导」。
  if (launchPlan.setup) {
    try { fs.writeFileSync(setupPendingMarkerPath(), '1') } catch (_) { /* 标记失败不阻塞引导 */ }
  }

  // 兜底（仅 dev：窗口初始隐藏）：渲染层异常/过慢时也先把窗口显示出来，
  // 此时 setup.html 的占位保证不是空白。正常情况下 setup-ready 会先到并取消此定时器。
  if (isDev) win.__revealTimer = setTimeout(() => revealWindow(win), 1500)

  // 引导未完成前禁止关闭（系统 ✕ / Alt+F4）
  win.on('close', (e) => { if (setupRunning) e.preventDefault() })
  win.on('closed', () => {
    clearTimeout(win.__revealTimer)
    if (setupWindow === win) setupWindow = null
  })

  // 启动计时点：dev 下先记 loading 页、跳转后记真实页面；prod 下直接记引导页面首帧
  win.webContents.on('did-finish-load', () => {
    const u = win.webContents.getURL()
    startupTimer.mark(u.startsWith('data:') ? '引导窗口 loading 页完成' : '引导页面加载完成')
  })

  if (isDev) {
    // 与主窗口一致：先渲染本地 inline loading 页（窗口立即出画面，不再白屏），
    // Vite 就绪后立即跳转到 setup.html；引导窗口不开 DevTools。
    // 与主窗口共用同一份 loading 模板（标题同为「班集」），
    // 灰色副标题由 boot-status 实时驱动，不出现两种不同的加载画面
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(devLoader.devLoadingHtml())}`)
    // 直接探测 setup.html：命中即跳转，等待期间 Vite 已顺带编译好该页面
    devLoader.loadUrlWithRetry(win, 'http://127.0.0.1:5173/setup.html')
  } else {
    win.loadURL('app://local/setup.html')
  }

  // 预热不在此处启动：等引导界面完全加载完成（setup-ready）后再后台进行
  return win
}

ipcMain.on('setup-ready', (event) => {
  if (!setupWindow || setupWindow.isDestroyed()) return
  if (event.sender !== setupWindow.webContents) return
  // 引导界面已挂载：dev 下此刻显示窗口（毛玻璃与引导界面同时出现）；prod 下窗口本就已显示
  clearTimeout(setupWindow.__revealTimer)
  startupTimer.mark('引导界面挂载完成')
  // 引导窗口的显示时刻即启动锚点（revealWindow 内定死）；用户在引导页的停留不计入启动耗时。
  revealWindow(setupWindow)
  // 界面完全加载完成后，再让出一次事件循环，随后才在后台开始预热（不与首帧显示抢资源）。
  // 纯低版本提示（plan.setup 为假）没有引导流程，无需预热。
  if (launchPlan.setup) setTimeout(() => { runSetupWarmup() }, 0)
})

// 渲染层首屏画面：读取本次启动计划（是否先显示低版本提示 / 是否走引导）
ipcMain.handle('launch-plan', (event) => {
  if (setupWindow && !setupWindow.isDestroyed() && event.sender !== setupWindow.webContents) {
    return { warn: false, setup: false }
  }
  return launchPlan
})

// 低版本提示「忽略」：按勾选记录「不再提示」。
// 若本次还需走引导（plan.setup），主进程不动窗口，由渲染层自行从提示画面切到欢迎画面；
// 若只是提示（warn-only），提示画面即最后一屏——直接进主窗口并关闭启动窗口。
ipcMain.on('launch-skip-warn', (event, payload) => {
  if (!setupWindow || setupWindow.isDestroyed()) return
  if (event.sender !== setupWindow.webContents) return
  if (payload && payload.remember) {
    try { fs.writeFileSync(osWarningSkipPath(), '1') } catch (_) { /* 标记失败不影响启动 */ }
  }
  if (!launchPlan.setup) {
    setupRunning = false
    try { fs.rmSync(setupPendingMarkerPath(), { force: true }) } catch (_) {}
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close()
  }
})

// 低版本提示「获取最新的 Windows」：用默认浏览器打开系统下载页，随后退出班集
ipcMain.on('launch-open-download', (event) => {
  if (!setupWindow || setupWindow.isDestroyed()) return
  if (event.sender !== setupWindow.webContents) return
  shell.openExternal(WIN_DOWNLOAD_URL).catch(() => { /* 打不开浏览器时静默忽略，不影响退出 */ })
  app.isQuitting = true
  app.quit()
})

// 引导完成：关闭引导窗口并创建主窗口（token 已写入同源 localStorage，主窗口据此直达首页）
ipcMain.on('setup-complete', (event) => {
  if (!setupWindow || setupWindow.isDestroyed()) return
  if (event.sender !== setupWindow.webContents) return
  setupRunning = false
  // 引导正常完成：清除「未完成」标记，之后启动直接进主窗口
  try { fs.rmSync(setupPendingMarkerPath(), { force: true }) } catch (_) {}
  pendingMainNotification = { type: 'success', message: '初始化完成，欢迎使用' }
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close()
})

// 引导期关闭：用户点右上角关闭按钮（欢迎页与各步骤页均可）。完全退出应用——
// 放行引导窗口 close 拦截后 app.quit()，由 before-quit / window-all-closed 一并停掉后端子进程；
// 不写「引导完成」标记（标记在 createSetupWindow 时已写下），因此下次启动仍会重新进入引导，
// 绝不直接进入主窗口。
ipcMain.on('setup-quit', (event) => {
  if (!setupWindow || setupWindow.isDestroyed()) return
  if (event.sender !== setupWindow.webContents) return
  setupRunning = false
  app.isQuitting = true
  app.quit()
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
    if (await pathExists(path.join(currentData, 'index.db'))) {
      // 已建库：复用安全搬迁流程（预检非空 → 校验 → 复制 → 复检 → 写配置 → 删旧目录）
      if (await pathExists(dataDir) && (await fsp.readdir(dataDir)).length > 0) {
        throw new Error('目标目录非空，请选择空目录')
      }
      if (!(await pathExists(dataDir))) await fsp.mkdir(dataDir, { recursive: true })
      await migration.migrateDataDir(currentData, dataDir, sendMigration) // 内部已停止后端并写配置
    } else {
      // 尚未建库：直接创建目录并写配置，无需搬迁
      await fsp.mkdir(dataDir, { recursive: true })
      saveAppConfig({ dataDir })
    }
  }
  if (thumbsDir) {
    await fsp.mkdir(thumbsDir, { recursive: true })
    saveAppConfig({ thumbsDir })
  }

  // 重启后端让新目录生效（token 由同一 SECURE_MASTER 签发，重启后仍有效）
  await backend.stopBackendProcess()
  backend.startBackend()
  return { ok: true, dataDir: resolveDataDir(), thumbsDir: resolveThumbsDir(), changed: true }
})

// ========== 数据目录搬迁：带进度的校验 + 复制 ==========
// 搬迁引擎（路径清单/哈希校验/复制/复检/写配置）已迁至 migration.js：
//   migration.migrateDataDir / buildInventory / listFilesRecursive / sha256FileAsync /
//   copyFileAsync / globalHashOf / clearDir / createProgressReporter

// 停止后端子进程（stopBackendProcess）已迁至 backend.js：backend.stopBackendProcess

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
  if (await pathExists(target)) {
    if ((await fsp.readdir(target)).length > 0) throw new Error('目标目录非空，请选择空目录')
  } else {
    await fsp.mkdir(target, { recursive: true })
    createdTarget = true
  }
  // 预检：当前目录必须是有效的班主任数据库（登记表 + 主密钥），否则不进入迁移流程
  if (!(await pathExists(oldDir))) throw new Error('当前数据目录不存在')
  if (!(await pathExists(path.join(oldDir, 'index.db')))) throw new Error('当前数据目录缺少 index.db，无法确认数据库有效')
  if (!(await pathExists(path.join(oldDir, 'db-master.key')))) throw new Error('当前数据目录缺少 db-master.key，无法确认数据库有效')

  migrationRunning = true
  migrationContext = { target, createdTarget, oldDir }
  // 先建好进度窗口，再关闭其它窗口：保证窗口数不为 0，避免触发 window-all-closed 退出应用
  createMigrationWindow()
  await waitMigrationReady()
  closeAllWindowsExceptMigration()

  try {
    const { oldDirRemoved } = await migration.migrateDataDir(oldDir, target, sendMigration)
    // 成功：配置已切到新目录 → 重启后端（读取新 DATA_DIR）→ 重开主窗口并弹出成功提示条
    sendMigration({ type: 'migration-done' })
    await new Promise((r) => setTimeout(r, 700))
    pendingMainNotification = { type: 'success', message: '数据库移动成功' }
    backend.startBackend()
    reopenAfterMigration()
    return { ok: true, dataDir: target, changed: true, oldDirRemoved }
  } catch (err) {
    console.error('[main] 数据目录搬迁失败:', err?.message || err)
    // 失败：旧目录与旧配置原样保留；新目录不再自动清理，交由用户在进度窗口确认后手动清除
    // 搬迁过程已停掉后端（migrateDataDir 内），这里必须把它重新拉起，否则用户返回主界面后
    // 前端将一直连不上后端。后端仍存活（失败发生在停后端之前）时不重复 fork 第二个进程。
    if (!backend.getBackendProcess()) backend.startBackend()
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
  await fsp.mkdir(target, { recursive: true })
  // 配置写入失败必须中止，不能继续重启后端去用一个尚未生效的目录
  saveAppConfig({ thumbsDir: target })
  await backend.stopBackendProcess()
  backend.startBackend()
  return { ok: true, thumbsDir: target, changed: true, oldThumbsDir: oldDir }
})

// 变更「AI 技能 md 目录」：技能是文本文件，采用「复制 → 校验 → 切配置 → 删旧目录」，
// 先复制保留旧目录，配置写失败则中止并保留旧目录，绝不产生「文件在新目录、配置却指向已删旧目录」的错位。
ipcMain.handle('set-skills-dir', async (event, dir) => {
  const target = path.resolve(String(dir || ''))
  const oldDir = resolveSkillsDir()
  if (!target || target.toLowerCase() === oldDir.toLowerCase()) {
    return { ok: true, skillsDir: oldDir, changed: false }
  }
  // 防循环：新目录不能在当前技能目录内部，反之亦然
  const rel = path.relative(oldDir, target)
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error('新目录不能位于当前技能目录内部')
  const relBack = path.relative(target, oldDir)
  if (relBack && !relBack.startsWith('..') && !path.isAbsolute(relBack)) throw new Error('当前技能目录不能位于新目录内部')
  // 目标目录须为空（不存在则创建）
  if (await pathExists(target)) {
    if ((await fsp.readdir(target)).length > 0) throw new Error('目标目录非空，请选择空目录')
  } else {
    await fsp.mkdir(target, { recursive: true })
  }
  // 停后端，避免搬迁过程中仍读写技能文件
  await backend.stopBackendProcess()
  try {
    if (await pathExists(oldDir)) {
      const names = await fsp.readdir(oldDir)
      for (const name of names) {
        // 整目录复制同样是磁盘密集操作：异步版在复制期间主进程仍可响应
        await fsp.cp(path.join(oldDir, name), path.join(target, name), { recursive: true })
      }
      // 校验：新目录顶层条目不少于旧目录，否则视为复制不完整
      if ((await fsp.readdir(target)).length < names.length) throw new Error('复制结果不完整')
    }
    saveAppConfig({ skillsDir: target })
  } catch (err) {
    // 失败：配置未改，旧目录原样保留；重启后端恢复原状
    backend.startBackend()
    throw new Error('技能目录切换失败：' + (err?.message || err))
  }
  // 复制完成且配置已切换：清理旧目录（失败仅告警，可手动删除）
  try {
    // force:true 时目录不存在也不报错，等价于原来的 existsSync + rmSync
    await fsp.rm(oldDir, { recursive: true, force: true })
  } catch (err) {
    console.warn('[main] 旧技能目录清理失败（新目录已生效，可手动删除）:', err?.message || err)
  }
  backend.startBackend()
  return { ok: true, skillsDir: target, changed: true, oldSkillsDir: oldDir }
})

// 图片/文件对话框、截屏、注释保存：见 dialogs.js（registerDialogsIpc）

app.isQuitting = false

// 应用退出收尾（shutdownBackend：置退出标志 + 杀后端 + 关闭日志流）已迁至 backend.js

app.on('window-all-closed', () => {
  // 托盘图标存在（主窗口关闭后进入后台运行）：保持进程与后端存活，
  // 由用户从托盘「打开主窗口」或「完全退出」决定后续。
  if (tray.isTrayAlive()) return
  backend.shutdownBackend()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    tray.destroyTray()
    createMainWindow()
    // 工具箱浮窗 / 桌面小组件不在此处直接创建：窗口归属 widget.js，
    // 新主窗口的渲染层挂载后会回报 widgets-ready，由 widget.js 按「是否启用」统一按需建窗
    // （与托盘「打开主窗口」路径一致，避免绕过会话级开关凭空拉起一个隐藏的浮窗渲染进程）。
  }
})

app.on('before-quit', () => {
  tray.destroyTray()
  backend.shutdownBackend()
})
