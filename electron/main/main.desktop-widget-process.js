// =========================================================================
// desktop-widget-process.js —— 桌面组件独立进程的生命周期管理（主进程侧）
//
// 背景（为什么组件要跑独立进程）：
//   桌面组件窗口必须挂到 Windows 桌面层（Progman 的子窗口，见 main.desktop-layer.js），
//   而 **Explorer 重启会销毁 Progman、级联销毁挂在其下的子窗口**，Electron/Chromium 遇到
//   窗口树被外部销毁会原生崩溃。实测对照：同一时刻普通顶层窗口完全无感，挂了桌面层的窗口
//   会让整个进程瞬间消失（无 JS 异常、无 dmp）。所以把组件放进独立进程
//   （electron/desktop-widget-host.js），崩溃只影响它自己，主应用不受影响。
//
// 本模块只做三件事：
//   1) 启动 / 停止子进程（对应「设置里开关桌面组件」）；
//   2) 子进程意外退出（Explorer 重启、被杀）时自动重建，带限流避免崩溃循环；
//   3) 提供一个「伪窗口对象」给 tray / perf 等既有调用方，让它们的
//      `w && !w.isDestroyed()` 判断无需改动即可继续工作。
// =========================================================================

const { spawn, execFile } = require('child_process')
const path = require('path')
const fs = require('fs')
const { app, BrowserWindow } = require('electron')

// 与 main.js 入口分流里检测的参数保持一致
const HOST_ARG = '--desktop-widget-host'
// 开启桌面层用的参数（host 收到后才 SetParent 挂到 Progman 之下）。
// 默认**不挂**：组件是普通顶层窗口 —— 只有顶层窗口才能用系统亚克力材质
// （挂成子窗口后 DWM 材质完全失效，背景会退化成一块死白板）。
// 用户在设置里显式开启「常驻最底层」时才带上这个参数。
const LAYER_ARG = '--desktop-layer'
// 一分钟内最多自动重建次数：防止「启动即崩」时把 CPU 打满
const MAX_RESTARTS_PER_MIN = 6
// 意外退出后的延迟：Explorer 重启时 Progman 要几百毫秒才重建好，太早启动会挂不上桌面层
const RESTART_DELAY = 1200

// ===== 启动即崩 → 自动降级 =====
// 某些环境里桌面层根本挂不上（安全软件拦截跨进程 SetParent、系统策略、远程桌面等），
// 表现为组件一启动就崩。这时用户可能连设置页都进不去（旧版本还会带走整个应用），
// 所以必须让软件自己兜底：连续「启动即崩」达到阈值就自动关闭桌面层，改用普通窗口，
// 并持久化到 userData —— 下次启动直接按降级状态来，用户不用做任何事。
// 注意：Explorer 重启属于「跑了很久之后才崩」，不计入（否则正常场景会被误降级）。
const FAULT_WINDOW = 8000
const FAULT_LIMIT = 3

let child = null
let enabled = true
let quitting = false
let restartTimer = null
let restartTimes = []
// 子进程启动时刻：用于区分「启动即崩」和「正常运行后崩溃」
let startedAt = 0

// 持久化状态：desktopLayerEnabled=用户是否开启「常驻最底层」；autoDisabled=是否由自动降级关闭
const state = { desktopLayerEnabled: false, autoDisabled: false, faultStreak: 0 }

function stateFile() {
  return path.join(app.getPath('userData'), 'desktop-widget-state.json')
}

function loadState() {
  try {
    const raw = fs.readFileSync(stateFile(), 'utf8')
    const o = JSON.parse(raw) || {}
    state.desktopLayerEnabled = !!o.desktopLayerEnabled
    state.autoDisabled = !!o.autoDisabled
    state.faultStreak = Number(o.faultStreak) || 0
  } catch (_) {
    // 文件不存在 / 损坏：按默认（不挂桌面层，即普通顶层窗口 + 系统亚克力）来
  }
}

function saveState() {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(state))
  } catch (e) {
    console.warn('[desktop-widget] 保存状态失败：', e && e.message)
  }
}

loadState()

function buildCommand() {
  const env = { ...process.env }
  // 部分环境（含本机开发机）会置 ELECTRON_RUN_AS_NODE，那会让 electron 变成纯 Node 进程，
  // 没有 BrowserWindow 可用，必须剔除。
  delete env.ELECTRON_RUN_AS_NODE
  // 把主应用的 userData 传给子进程：共用同一 Chromium profile，app://local 下的 localStorage
  // （token、主题、玻璃/日夜）才能被组件继承。开发模式下子进程用脚本路径启动，Electron 找不到
  // package.json、app.getName() 会回退成 "Electron"，不显式传就会落到另一个 profile 上。
  try {
    env.DW_USER_DATA = app.getPath('userData')
  } catch (_) {
    /* 忽略 */
  }
  // 沙箱/GPU 相关的启动开关随父进程透传：某些环境（受限沙箱、远程桌面）必须带 no-sandbox
  // 才能起来，子进程不带就会直接崩（表现为组件一直重建失败）。
  const passthrough = process.argv.filter(
    (a) => a.startsWith('--no-sandbox') || a.startsWith('--disable-gpu')
  )
  // 用户开启「常驻最底层」时带上这个参数，host 才会 SetParent 挂到桌面层
  const layerArgs = state.desktopLayerEnabled ? [LAYER_ARG] : []
  // 打包后 exe 自带入口，只需传参数；开发模式要显式指定入口脚本。
  const args = app.isPackaged
    ? [HOST_ARG, ...layerArgs, ...passthrough]
    : [path.join(__dirname, '..', 'main', 'main.js'), HOST_ARG, ...layerArgs, ...passthrough]
  return { cmd: process.execPath, args, env }
}

function start() {
  if (child) return true
  const { cmd, args, env } = buildCommand()
  let proc = null
  try {
    proc = spawn(cmd, args, { env, stdio: 'ignore' })
  } catch (e) {
    console.warn('[desktop-widget] 子进程启动失败：', e && e.message)
    return false
  }
  child = proc
  startedAt = Date.now()
  proc.on('error', (e) => {
    console.warn('[desktop-widget] 子进程错误：', e && e.message)
  })
  proc.on('exit', (code, signal) => onExit(proc, code, signal))
  return true
}

function onExit(proc, code, signal) {
  // 主动停止时 stop() 会先把 child 置空，此时 child !== proc：
  // 说明这次退出是「用户/程序要求的」，绝不能触发自动重建（否则托盘里关掉的组件会自己回来）。
  if (child !== proc) return
  child = null
  if (quitting || !enabled) return

  // ===== 启动即崩 → 自动降级 =====
  // 只统计「起来不到 FAULT_WINDOW 就退出」的情况：Explorer 重启属于跑了很久才崩，
  // 不计入，否则正常使用会被误降级。降级后本次的 start() 不再带 --desktop-layer
  // （改回普通顶层窗口 + 系统亚克力）。
  if (Date.now() - startedAt < FAULT_WINDOW) {
    state.faultStreak += 1
    if (state.faultStreak >= FAULT_LIMIT && state.desktopLayerEnabled) {
      state.desktopLayerEnabled = false
      state.autoDisabled = true
      saveState()
      console.warn(
        '[desktop-widget] 连续 ' + FAULT_LIMIT + ' 次启动即崩，已自动关闭「常驻最底层」（改用普通窗口 + 亚克力）；' +
          '组件仍会显示，可在「桌面小组件设置」里重新开启'
      )
      notifyAutoDisabled()
    } else {
      saveState()
    }
  } else if (state.faultStreak !== 0) {
    // 正常跑过一段时间：清零，避免偶发的一次早起崩溃累积成误降级
    state.faultStreak = 0
    saveState()
  }

  const now = Date.now()
  restartTimes = restartTimes.filter((t) => now - t < 60000)
  if (restartTimes.length >= MAX_RESTARTS_PER_MIN) {
    console.warn(
      '[desktop-widget] 短时间内重建次数过多，暂停自动重建（code=', String(code),
      'signal=', String(signal), '）'
    )
    return
  }
  restartTimes.push(now)

  if (restartTimer) return
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (enabled && !quitting) start()
  }, RESTART_DELAY)
}

function stop() {
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (!child) return
  const proc = child
  // 先解引用：exit 回调里 child !== proc，不会触发自动重建
  child = null
  try {
    proc.kill()
  } catch (_) {
    /* 忽略 */
  }
  // Electron 子进程收到 kill 不一定立刻退出，兜底强杀（含其下渲染进程）
  setTimeout(() => {
    try {
      if (proc.exitCode === null && proc.pid) {
        execFile('taskkill', ['/pid', String(proc.pid), '/f', '/t'], () => {})
      }
    } catch (_) {
      /* 忽略 */
    }
  }, 1000)
}

function setEnabled(flag) {
  enabled = !!flag
  if (enabled) start()
  else stop()
}

// 自动降级时通知界面（设置页据此提示「已因连续崩溃自动关闭」）
function notifyAutoDisabled() {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('from-main', { type: 'desktop-layer-auto-disabled' })
      }
    }
  } catch (_) {
    /* 忽略 */
  }
}

// 重启子进程才能让「是否挂桌面层」生效（该决定发生在窗口创建时）
function restartHost() {
  if (!child) {
    if (enabled && !quitting) start()
    return
  }
  stop()
  setTimeout(() => {
    if (enabled && !quitting) start()
  }, 400)
}

// 手动开启/关闭「常驻最底层」（layerEnabled=true 表示挂到桌面层）
// 注意：开启后窗口会变成 Progman 子窗口，**系统亚克力材质随之失效**（DWM 材质只对顶层窗口生效），
// 背景会退化成纯色。这是 Windows 层面的取舍，见 electron/desktop-widget-host.js 的说明。
function setDesktopLayerEnabled(layerEnabled) {
  const next = !!layerEnabled
  if (state.desktopLayerEnabled === next) return false
  state.desktopLayerEnabled = next
  // 用户手动改过：清掉「自动降级」标记与故障计数，避免界面一直显示自动降级提示
  state.autoDisabled = false
  state.faultStreak = 0
  saveState()
  restartHost()
  return true
}

function getDesktopLayerState() {
  return {
    desktopLayerEnabled: state.desktopLayerEnabled,
    autoDisabled: state.autoDisabled,
    faultStreak: state.faultStreak,
  }
}

function isRunning() {
  return !!child
}

function quit() {
  quitting = true
  stop()
}

// 伪窗口对象：tray / perf 等调用方只用 isDestroyed / close / destroy，
// 以及 webContents（取不到时它们的 try/catch 会自然跳过）。
function getProxy() {
  return {
    webContents: null,
    isDestroyed: () => !child,
    isVisible: () => !!child,
    close: () => stop(),
    destroy: () => stop(),
  }
}

// 应用退出时把子进程一并停掉（will-quit 在所有 before-quit 逻辑之后）
app.on('will-quit', () => quit())

module.exports = {
  start,
  stop,
  setEnabled,
  isRunning,
  getProxy,
  quit,
  setDesktopLayerEnabled,
  getDesktopLayerState,
  HOST_ARG,
  LAYER_ARG,
}
