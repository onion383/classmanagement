// =========================================================================
// perf.js —— 性能面板相关 IPC 与内存采样
//
// 汇总主进程里性能面板用的一组请求-响应通道与后台采样：
//   perf-snapshot / perf-restart-frontend / perf-restart-widget / perf-relaunch-app / perf-gc / perf-startup
//   以及 startMemSampling 后台「总计内存」定时采样。
//
// 依赖注入：窗口引用与后端进程句柄由 main.js 通过 registerPerfIpc 注入（均为 getter 闭包，
// 调用时取当前值）；本模块只读窗口/后端状态，唯一需要写回的是桌面小组件窗口引用（销毁重建），
// 通过注入的 setDesktopWidgetWindow 回写。
//
// 与后端消息的耦合：后端内存自报 / GC 的一次性等待者（memWaiter / gcWaiter）归本模块所有，
// 由 main.js 的 onBackendMessage 转发调用 handleBackendMemReport / handleBackendGcReport。
// =========================================================================

const { app, ipcMain } = require('electron')
const { getPrivateWorkingSetKB } = require('./privateWorkingSet')
const startupTimer = require('./startup-timer')

// 窗口 / 后端句柄出口：由 registerPerfIpc 注入
let getMainWindow = () => null
let getWidgetWindow = () => null
let getDesktopWidgetWindow = () => null
let setDesktopWidgetWindow = () => {}
let getMigrationWindow = () => null
let getSetupWindow = () => null
let getBackendProcess = () => null
let isBackendReady = () => false
let isDesktopEnabled = () => true
let hideWidgetWindow = () => {}
let showWidgetWindow = () => {}
let createDesktopWidgetWindow = () => {}

// 性能面板：后端内存自报 / GC 的一次性等待者（各自独立，别复用 probeWaiter）
let memWaiter = null
let gcWaiter = null

// 向后端发消息做一次性查询（内存自报 / GC），照 pingOnce 的一次性等待者写法，
// 但使用各自独立的 waiter 变量，避免与 probeWaiter / 心跳互相干扰。
function queryBackendMemory(timeout = 1500) {
  return new Promise((resolve) => {
    const proc = getBackendProcess()
    if (!proc || !isBackendReady()) return resolve(null)
    let timer = null
    const finish = (v) => {
      if (memWaiter !== finish) return
      memWaiter = null
      clearTimeout(timer)
      resolve(v)
    }
    memWaiter = finish
    timer = setTimeout(() => finish(null), timeout)
    try { proc.send({ type: 'mem-query' }) } catch (_) { finish(null) }
  })
}

// 串行化后端内存查询：内存历史采样与面板快照可能并发，而二者共用同一个 memWaiter，
// 不串行会让先发起的查询被覆盖而超时。这里用一条 Promise 链排队，保证同一时刻只有一个查询在途。
let memQueryChain = Promise.resolve()
function queryBackendMemorySerial(timeout = 1500) {
  const run = () => queryBackendMemory(timeout)
  const p = memQueryChain.then(run, run)
  memQueryChain = p.then(() => {}, () => {})
  return p
}

function queryBackendGc(timeout = 1500) {
  return new Promise((resolve) => {
    const proc = getBackendProcess()
    if (!proc || !isBackendReady()) return resolve(null)
    let timer = null
    const finish = (v) => {
      if (gcWaiter !== finish) return
      gcWaiter = null
      clearTimeout(timer)
      resolve(v)
    }
    gcWaiter = finish
    timer = setTimeout(() => finish(null), timeout)
    try { proc.send({ type: 'gc-request' }) } catch (_) { finish(null) }
  })
}

// onBackendMessage 转发入口：唤醒后端内存自报等待者
function handleBackendMemReport(mem) {
  if (memWaiter) memWaiter(mem || null)
}

// onBackendMessage 转发入口：唤醒后端 GC 等待者
function handleBackendGcReport(ok) {
  if (gcWaiter) gcWaiter(!!ok)
}

// 把 app.getAppMetrics() 的一条记录转成面板用的内存/CPU 结构。
// 注意：只能在 app ready 后调用；memory.workingSetSize / privateBytes 单位为 KB。
function metricToMem(m) {
  return {
    pid: m.pid,
    workingSetKB: m.memory?.workingSetSize ?? null,
    privateKB: m.memory?.privateBytes ?? null,
    cpu: m.cpu?.percentCPUUsage ?? null,
  }
}

// 通过 CDP 触发某个渲染进程的 GC；DevTools 已打开时 attach 会失败，整段吞掉异常
async function collectRendererGarbage(wc) {
  if (!wc || wc.isDestroyed()) return false
  try {
    wc.debugger.attach('1.3')
  } catch (_) {
    return false
  }
  try {
    await wc.debugger.sendCommand('HeapProfiler.collectGarbage')
    return true
  } catch (_) {
    return false
  } finally {
    try { wc.debugger.detach() } catch (_) { /* 断开失败忽略 */ }
  }
}

// 收集逐进程内存列表（主进程 / 各渲染窗口 / GPU / 各服务进程 / 后端）。
// 面板快照与内存历史采样共用，保证两处口径一致。
async function collectProcList() {
  // 渲染进程按所属窗口取友好名（同一 pid 后写覆盖，主窗口优先级最高）
  const labelByPid = new Map()
  const addWin = (label, win) => {
    try {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        labelByPid.set(win.webContents.getOSProcessId(), label)
      }
    } catch (_) { /* 忽略 */ }
  }
  addWin('迁移窗口', getMigrationWindow())
  addWin('引导窗口', getSetupWindow())
  addWin('桌面组件', getDesktopWidgetWindow())
  addWin('小组件', getWidgetWindow())
  addWin('前端窗口', getMainWindow())

  const procs = []
  let metrics = []
  try { metrics = app.getAppMetrics() } catch (_) { metrics = [] }

  // 主进程
  const browser = metrics.find((m) => m.type === 'Browser')
  if (browser) procs.push({ key: 'main', name: '主进程', kind: 'main', ...metricToMem(browser) })

  // 各渲染进程
  for (const m of metrics.filter((x) => x.type === 'Tab')) {
    procs.push({
      key: `tab-${m.pid}`,
      name: labelByPid.get(m.pid) || '渲染进程',
      kind: 'renderer',
      ...metricToMem(m),
    })
  }

  // GPU 进程
  for (const m of metrics.filter((x) => x.type === 'GPU')) {
    procs.push({ key: `gpu-${m.pid}`, name: 'GPU 进程', kind: 'gpu', ...metricToMem(m) })
  }

  // 各服务进程（网络/存储/音频等，取 Chromium 给的服务名）
  for (const m of metrics.filter((x) => x.type === 'Utility')) {
    procs.push({
      key: `util-${m.pid}`,
      name: m.serviceName || m.name || '服务进程',
      kind: 'utility',
      ...metricToMem(m),
    })
  }

  // 后端：Node 子进程不在 getAppMetrics 里，由它用 process.memoryUsage() 自报（字节 → KB）
  const mem = await queryBackendMemorySerial()
  if (mem) {
    const backendProcess = getBackendProcess()
    procs.push({
      key: 'backend',
      name: '后端',
      kind: 'backend',
      pid: backendProcess?.pid ?? null,
      workingSetKB: Math.round((mem.rss || 0) / 1024),
      // Node 不直接暴露「私有提交量」，用 V8 堆 + external（native 分配）近似，
      // 以便与 Chromium 各进程的 privateBytes 口径对齐。
      privateKB: Math.round(((mem.heapUsed || 0) + (mem.external || 0)) / 1024),
      cpu: null,
    })
  }

  // 内存口径统一改为「专用工作集」（与任务管理器「进程」页一致），逐进程按 pid 覆盖。
  // 计数器不可用（非 Windows / koffi 缺失）时 privWsKB 留空，前端回退到 Electron 自带口径。
  const pwMap = getPrivateWorkingSetKB()
  if (pwMap) {
    for (const p of procs) {
      const kb = p.pid == null ? undefined : pwMap.get(p.pid)
      if (typeof kb === 'number') p.privWsKB = Math.round(kb)
    }
  }
  return procs
}

// 单个进程在面板采用的内存口径：优先专用工作集，回退私有提交量
function procMemKB(p) {
  if (typeof p.privWsKB === 'number') return p.privWsKB
  if (typeof p.privateKB === 'number') return p.privateKB
  return 0
}

// ========== 内存历史：总计 / 平均（近一分钟）/ 最高（自启动起）==========
// 由主进程定时采样，不依赖设置页是否打开——「最高」自程序启动即开始统计。
const MEM_SAMPLE_INTERVAL = 5000
const MEM_AVG_WINDOW = 60000
let memHistory = []        // [{ t, kb }]，仅保留近一分钟的样本
let memMaxKB = 0           // 自启动以来的最高总计
let memSampleTimer = null
let memSampling = false

function recordMemSample(kb) {
  if (!kb || kb <= 0) return
  const now = Date.now()
  memHistory.push({ t: now, kb })
  const cutoff = now - MEM_AVG_WINDOW
  while (memHistory.length && memHistory[0].t < cutoff) memHistory.shift()
  if (kb > memMaxKB) memMaxKB = kb
}

function memAvgKB() {
  if (!memHistory.length) return 0
  let sum = 0
  for (const h of memHistory) sum += h.kb
  return Math.round(sum / memHistory.length)
}

async function sampleMemTotal() {
  if (memSampling) return
  memSampling = true
  try {
    const procs = await collectProcList()
    recordMemSample(procs.reduce((s, p) => s + procMemKB(p), 0))
  } catch (_) { /* 采样失败静默忽略 */ }
  finally { memSampling = false }
}

function startMemSampling() {
  if (memSampleTimer) return
  sampleMemTotal()
  memSampleTimer = setInterval(sampleMemTotal, MEM_SAMPLE_INTERVAL)
}

function registerPerfIpc(opts = {}) {
  if (typeof opts.getMainWindow === 'function') getMainWindow = opts.getMainWindow
  if (typeof opts.getWidgetWindow === 'function') getWidgetWindow = opts.getWidgetWindow
  if (typeof opts.getDesktopWidgetWindow === 'function') getDesktopWidgetWindow = opts.getDesktopWidgetWindow
  if (typeof opts.setDesktopWidgetWindow === 'function') setDesktopWidgetWindow = opts.setDesktopWidgetWindow
  if (typeof opts.getMigrationWindow === 'function') getMigrationWindow = opts.getMigrationWindow
  if (typeof opts.getSetupWindow === 'function') getSetupWindow = opts.getSetupWindow
  if (typeof opts.getBackendProcess === 'function') getBackendProcess = opts.getBackendProcess
  if (typeof opts.isBackendReady === 'function') isBackendReady = opts.isBackendReady
  if (typeof opts.isDesktopEnabled === 'function') isDesktopEnabled = opts.isDesktopEnabled
  if (typeof opts.hideWidgetWindow === 'function') hideWidgetWindow = opts.hideWidgetWindow
  if (typeof opts.showWidgetWindow === 'function') showWidgetWindow = opts.showWidgetWindow
  if (typeof opts.createDesktopWidgetWindow === 'function') createDesktopWidgetWindow = opts.createDesktopWidgetWindow

  // 内存快照：逐进程列表 + 前端/后端/小组件存活状态 + 总计/平均/最高汇总
  ipcMain.handle('perf-snapshot', async () => {
    const procs = await collectProcList()
    const total = procs.reduce((s, p) => s + procMemKB(p), 0)
    // 面板打开时也记一笔，让「平均/最高」与逐进程列表的当前值保持同步
    recordMemSample(total)
    // 按用途分组：前端（主窗口渲染进程）/ 后端 / 其他（主进程、GPU、其他渲染/服务进程）
    const frontKB = procs.reduce((s, p) => s + (p.name === '前端窗口' ? procMemKB(p) : 0), 0)
    const backendKB = procs.reduce((s, p) => s + (p.kind === 'backend' ? procMemKB(p) : 0), 0)
    const otherKB = Math.max(0, total - frontKB - backendKB)
    // 存活状态按窗口/进程本身判定，不依赖指标里能否匹配到 pid
    const mainWindow = getMainWindow()
    const widgetWindow = getWidgetWindow()
    const desktopWidgetWindow = getDesktopWidgetWindow()
    const alive = {
      front: !!(mainWindow && !mainWindow.isDestroyed()),
      widget: !!((widgetWindow && !widgetWindow.isDestroyed()) || (desktopWidgetWindow && !desktopWidgetWindow.isDestroyed())),
      backend: procs.some((p) => p.kind === 'backend'),
    }
    return { procs, alive, total, avg1min: memAvgKB(), max: memMaxKB, frontKB, backendKB, otherKB }
  })

  // 重启前端：直接重载主窗口页面
  ipcMain.handle('perf-restart-frontend', () => {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload()
    return { ok: true }
  })

  // 重启小组件：销毁并重建原本存在的窗口，并尊重用户开关（关掉的不重新拉起）
  ipcMain.handle('perf-restart-widget', () => {
    // 工具箱浮窗：仅当原本存在时重建；重建后按会话级开关决定显隐
    const widgetWindow = getWidgetWindow()
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      // 隐藏态下窗口已被销毁，能进到这里说明当前可见；直接「销毁后重建」即完成重启
      hideWidgetWindow()
      showWidgetWindow()
    }
    // 桌面组件：仅当原本存在（说明当前已启用）时重建
    let desktopWidgetWindow = getDesktopWidgetWindow()
    if (desktopWidgetWindow && !desktopWidgetWindow.isDestroyed()) {
      try { desktopWidgetWindow.destroy() } catch (_) { /* 忽略 */ }
      setDesktopWidgetWindow(null)
      if (isDesktopEnabled()) createDesktopWidgetWindow()
    }
    return { ok: true }
  })

  // 全部重启（含 Electron 本体）：先调度 relaunch，再走正常退出流程。
  // 用 app.quit() 而非 app.exit()：quit 会触发 before-quit → shutdownBackend，
  // 干净停掉后端子进程后再退出并拉起新实例，避免后端残留。
  ipcMain.handle('perf-relaunch-app', () => {
    app.relaunch()
    app.quit()
    return { ok: true }
  })

  // 手动 GC：主进程 global.gc + 各渲染进程 CDP 回收 + 后端自报 GC
  ipcMain.handle('perf-gc', async () => {
    // 主进程
    let main = false
    try {
      if (typeof global.gc === 'function') { global.gc(); main = true }
    } catch (_) { /* 忽略 */ }

    // 渲染进程逐个回收（前端主窗口 + 工具箱/桌面组件）
    const mainWindow = getMainWindow()
    const widgetWindow = getWidgetWindow()
    const desktopWidgetWindow = getDesktopWidgetWindow()
    const front = await collectRendererGarbage(mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null)
    let widget = false
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widget = await collectRendererGarbage(widgetWindow.webContents)
    } else if (desktopWidgetWindow && !desktopWidgetWindow.isDestroyed()) {
      widget = await collectRendererGarbage(desktopWidgetWindow.webContents)
    }

    // 后端
    const backend = (await queryBackendGc()) === true

    return { main, front, widget, backend }
  })

  // 上次启动耗时与打点时间线
  ipcMain.handle('perf-startup', () => startupTimer.getTimeline())
}

module.exports = {
  registerPerfIpc,
  startMemSampling,
  handleBackendMemReport,
  handleBackendGcReport,
}