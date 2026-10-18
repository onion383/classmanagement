// =========================================================================
// backend.js —— 后端子进程的全生命周期管理
//
// 汇总主进程里与「后端 fork 子进程」相关的一切：
//   - 后端日志文件（userData/data/backend.log）
//   - 启动/停止（开发用系统 node、打包用 Electron 内置 Node 纯 Node 模式）
//   - 启动阶段状态（boot-status）与就绪检测（backend-ready）
//   - 启动失败兜底看门狗（backend-failed）
//   - 运行期心跳 + 假死判定 + 重连（backend-reconnecting）
//   - 即时健康探测（probe-backend）与各查询通道（backend-status / boot-status）
//
// 依赖注入：所有渲染窗口引用由 main.js 通过 registerBackendIpc 注入（getter 闭包，
// 调用时取当前值），用于向窗口广播启动状态/就绪/失败/重连事件。
//
// 与 perf.js 的耦合：后端内存自报 / GC 的一次性等待者归 perf.js 所有，本模块的
// onBackendMessage 把 mem-report / gc-report 转发给 perf.handleBackendMemReport / GcReport。
// =========================================================================

const { app, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const startupTimer = require('./startup-timer')
const perf = require('./perf')
const { getMasterKey, resolveDataDir, resolveThumbsDir, resolveSkillsDir, getDbMasterKey } = require('./config')

const isDev = !app.isPackaged

// 【启动剖析打点·仅开发模式】只在 dev 生效，打包版是空操作（不写控制台也不写时间线）
const _profMark = (name) => { if (isDev) startupTimer.mark(name) }

// 窗口引用出口：由 registerBackendIpc 注入（均为 getter，调用时取当前值）
let getMainWindow = () => null
let getWidgetWindow = () => null
let getDesktopWidgetWindow = () => null
let getMigrationWindow = () => null
let getSetupWindow = () => null

// 当前后端子进程句柄
let backendProcess = null
// 后端就绪状态：由后端子进程的 backend-ready 上报置位；供两种场景使用——
// 1) 就绪瞬间向所有已存在的渲染窗口广播；2) 晚于就绪才加载的窗口用 backend-status 查询兜住竞态
let backendReady = false
// 主进程侧的「等后端就绪」等待者：就绪上报到来时统一唤醒（见 waitForBackendReadySignal）
const backendReadyWaiters = new Set()
// 首次就绪回调（供启动计时锚点使用）：只在「本次进程生命周期内第一次就绪」时触发一次，
// 运行期重启后再次就绪不再触发（重启属于运行期，不算启动）。
let firstReadyCb = null
// 启动失败兜底：后端长时间起不来（看门狗超时）或自动重启用尽后置位，
// 向所有窗口广播 from-main{type:'backend-failed'}，由启动占位页给出「重启后端 / 退出应用」。
let backendFailed = false
let backendFailTimer = null
// 看门狗时长：SIM_BACKEND_FAIL 为测试开关（故意让后端起不来），用短超时便于快速看到失败提示
const BACKEND_FAIL_TIMEOUT = process.env.SIM_BACKEND_FAIL ? 3000 : 30000

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
    // 体积兜底：后端每次启动都追加一段、运行期还继续写，不设上限会无限增长。
    // 它是排查后端崩溃用的，超过 2MB 就只保留最近 1MB（最新一次启动一定在末尾）。
    try {
      const st = fs.statSync(logPath)
      if (st.size > 2 * 1024 * 1024) {
        const tail = fs.readFileSync(logPath, 'utf8').slice(-1024 * 1024)
        fs.writeFileSync(logPath, '（历史日志已截断，仅保留最近部分）\n' + tail)
      }
    } catch (_) { /* 首次启动文件不存在，忽略 */ }
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

// ===== 运行期心跳（检测「假死」）=====
// 后端可能「假死」：进程还在，但事件循环被同步操作（如 better-sqlite3 慢查询/锁等待）卡住，
// 既不退出也不响应。exit 事件不会触发，只能靠主进程主动探测。
// 每 30s 发一次 ping，单次等待 pong 上限 4s，连续 2 次无响应（约 1 分钟）才判定异常 ——
// 给合法长任务留足余量，避免误判后重启进程打断写库。
// 安全余量 = 间隔 × 次数，两个旋钮可互换：这里取「低频 + 少次」，误杀窗口约 1 分钟。
// 代价是纯周期检测最坏要等 ~1 分钟，所以另有「请求失败触发即时探测」兜住体验（见 probe-backend）。
const HEARTBEAT_INTERVAL = 30000
const HEARTBEAT_TIMEOUT = 4000
const HEARTBEAT_FAIL_LIMIT = 2
// 运行期崩溃测试开关（SIM_BACKEND_CRASH，默认关闭）：
//   once — 后端就绪 N 秒后杀掉它，重连的实例正常 → 验证「提示条 → 自动恢复」
//   dead — 同上，但此后重连实例的就绪上报一律忽略 → 验证「5 次失败 → 全屏失败页」
const SIM_BACKEND_CRASH = process.env.SIM_BACKEND_CRASH || ''
const SIM_BACKEND_CRASH_MS = Number(process.env.SIM_BACKEND_CRASH_MS) || 5000
let simCrashFired = false
// 运行期异常后最多重连 5 次，仍失败则复用「启动失败」页面（重启后端 / 退出应用）
const RECONNECT_MAX = 5
// dead 模式下必然等不到就绪，缩短单次等待让测试更快走到全屏
const RECONNECT_READY_TIMEOUT = SIM_BACKEND_CRASH === 'dead' ? 3000 : 10000
let heartbeatTimer = null
let heartbeatAwaitTimer = null
let heartbeatPending = false
let heartbeatFailStreak = 0
let heartbeatRunning = false
let reconnecting = false
// 一次性即时探测（probe-backend）的状态：与周期性心跳互不干扰
let probeWaiter = null
let probing = false
// 性能面板：后端内存自报 / GC 的一次性等待者已迁至 perf.js（memWaiter / gcWaiter）

// 后端就绪检测：仅用于 stdout 分片匹配 + 日志，不再作为建窗信号
// （主窗口在 whenReady 后立即创建，与后端并行启动）
let readyBuffer = ''

// 项目根目录（含 node_modules 里的 electron 等）：本模块位于 electron/main/，向上两级
const appRootDir = path.join(__dirname, '..', '..')

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
  _profMark('【prof】compileBackendProcess 进入')
  const { backendDir, backendPath } = getBackendPaths()
  const dataDir = resolveDataDir()
  const thumbsDir = resolveThumbsDir()
  const skillsDir = resolveSkillsDir()
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(thumbsDir, { recursive: true })
  fs.mkdirSync(skillsDir, { recursive: true })
  _profMark('【prof】后端路径/目录准备完成')

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
    // 用异步 exec 探测系统 node（而非 execFileSync 同步阻塞主线程），
    // 让后端 fork 与 createMainWindow 的初始化真正并行推进。
    const { fork, execFile } = require('child_process')
    const spawnDev = (execPath) => {
      _profMark('【prof】fork(dev) 调用前')
      const child = fork(backendPath, [], {
        cwd: backendDir,
        execPath,
        // 性能面板：让后端进程也暴露 global.gc，用于「回收」按钮
        execArgv: ['--expose-gc'],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          DATA_DIR: dataDir,
          ALBUM_THUMBS_DIR: thumbsDir,
          AI_SKILLS_DIR: skillsDir,
          SECURE_MASTER: getMasterKey(),
          DB_MASTER_KEY: getDbMasterKey(),
        },
      })
      backendProcess = child
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onErrData)
      child.on('error', onProcessorError)
      child.on('exit', onExit)
      child.on('exit', scheduleBackendRestart)
      child.on('disconnect', onDisconnect)
      child.on('message', onBackendMessage)
      _profMark('【prof】fork(dev) 返回')
    }
    if (process.env.NODE_EXEC_PATH) {
      spawnDev(process.env.NODE_EXEC_PATH)
      return
    }
    // 探测结果缓存到 userData：避免每次 dev 启动都先 spawn 一个 node 去问自己的路径
    //（约 0.3–1s）。缓存的路径失效（node 被卸载/移动）时自动回退到重新探测。
    const nodePathCache = path.join(app.getPath('userData'), 'dev-node-path.txt')
    try {
      const cached = fs.readFileSync(nodePathCache, 'utf8').trim()
      if (cached && fs.existsSync(cached)) {
        console.log('[main] 复用缓存的 node 路径:', cached)
        spawnDev(cached)
        return
      }
    } catch (_) { /* 无缓存，走探测 */ }
    execFile('node', ['-p', 'process.execPath'], { encoding: 'utf8' }, (err, out) => {
      const execPath = err ? 'node' : out.trim()
      if (!err) {
        try { fs.writeFileSync(nodePathCache, execPath) } catch (_) { /* 写缓存失败不影响启动 */ }
      }
      spawnDev(execPath)
    })
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
    // 性能面板：让后端进程也暴露 global.gc，用于「回收」按钮
    execArgv: ['--expose-gc'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      ALBUM_THUMBS_DIR: thumbsDir,
      AI_SKILLS_DIR: skillsDir,
      ELECTRON_RUN_AS_NODE: '1',
      SECURE_MASTER: getMasterKey(),
      DB_MASTER_KEY: getDbMasterKey(),
    },
  })

  backendProcess.stdout?.on('data', onData)
  backendProcess.stderr?.on('data', onErrData)
  backendProcess.on('error', onProcessorError)
  backendProcess.on('exit', onExit)
  backendProcess.on('exit', scheduleBackendRestart)
  backendProcess.on('disconnect', onDisconnect)
  backendProcess.on('message', onBackendMessage)
}

function startBackend() {
  // 重启保护：仅当应用仍在运行时才重启，且限制最多 10 次，避免无限崩溃循环刷屏
  if (backendRestartCount >= 10) {
    const msg = `后端在启动阶段连续崩溃 ${backendRestartCount} 次，已停止自动重启。请查看日志：${getBackendLogPath()}\n`
    ensureBackendLogStream()
    if (backendLogStream) backendLogStream.write(`[fatal] ${msg}`)
    console.error(`[main] ${msg}`)
    // 自动重启用尽：直接进入失败态，让用户能手动重试或退出，而不是静默卡在加载页
    markBackendFailed()
    return
  }

  ensureBackendLogStream()
  backendLog(`[main] 正在启动后端 (第 ${backendRestartCount + 1} 次)...\n`)

  // 每次 fork 前复位就绪标记：重启期间前端应重新等待新的 backend-ready
  backendReady = false
  setBootStatus('正在启动本地服务…')
  armBackendFailWatchdog()
  compileBackendProcess()
}

// 向所有已存在的渲染窗口广播 from-main 事件
function broadcast(payload) {
  const wins = [getMainWindow(), getWidgetWindow(), getDesktopWidgetWindow(), getMigrationWindow(), getSetupWindow()]
  for (const w of wins) {
    try { if (w && !w.isDestroyed()) w.webContents.send('from-main', payload) } catch (_) { /* 忽略 */ }
  }
}

// 启动阶段状态：加载页（inline loading 页 / setup.html 占位）的灰色副标题实时显示
// 「程序正在干嘛」。渲染层订阅 from-main 的 boot-status 事件，也可用 boot-status 查询兜住
// 「页面先加载、状态后更新」的竞态。文案只在变化时广播。
let bootStatusText = ''
function setBootStatus(text) {
  if (!text || text === bootStatusText) return
  bootStatusText = text
  broadcast({ type: 'boot-status', text })
}

function getBootStatusText() {
  return bootStatusText
}

// 后端子进程消息：心跳应答（pong）与就绪上报（backend-ready）。
// 就绪后广播给所有已存在的渲染窗口（广播 + backend-status 查询两者并存：广播覆盖
// 「窗口先存在」，查询覆盖「窗口后加载」）
function onBackendMessage(msg) {
  if (!msg) return
  // 心跳应答：清掉等待计时并复位连续失败计数
  if (msg.type === 'pong') {
    heartbeatPending = false
    heartbeatFailStreak = 0
    clearTimeout(heartbeatAwaitTimer)
    heartbeatAwaitTimer = null
    // 同时唤醒可能正在等待的即时探测
    if (probeWaiter) probeWaiter(true)
    return
  }
  // 性能面板：唤醒后端内存自报等待者
  if (msg.type === 'mem-report') {
    perf.handleBackendMemReport(msg.mem || null)
    return
  }
  // 性能面板：唤醒后端 GC 等待者
  if (msg.type === 'gc-report') {
    perf.handleBackendGcReport(!!msg.ok)
    return
  }
  if (msg.type !== 'backend-ready') return
  // 测试开关：SIM_BACKEND_FAIL 下故意忽略就绪上报，模拟「后端一直起不来」，用于验证失败提示
  if (process.env.SIM_BACKEND_FAIL) return
  // dead 模式：首次崩溃之后，重连实例的就绪上报全部忽略 → 重连必然超时失败 → 走满 5 次进全屏
  if (SIM_BACKEND_CRASH === 'dead' && simCrashFired) return
  backendReady = true
  // 已成功启动过：累计的重启计数清零，避免长生命周期里累计到上限后不再自动恢复
  backendRestartCount = 0
  clearBackendFailure()
  setBootStatus('本地服务已就绪')
  startHeartbeat()
  if (SIM_BACKEND_CRASH) armSimCrash()
  // 唤醒主进程侧「等后端就绪」的等待者（引导页的 detectFirstRun / runSetupWarmup 等）
  for (const fn of [...backendReadyWaiters]) fn()
  // 首次就绪回调（启动计时锚点）：只触发一次，随后清空
  if (firstReadyCb) { const fn = firstReadyCb; firstReadyCb = null; fn() }
  broadcast({ type: 'backend-ready' })
}

// 后端子进程退出（非主动停止）→ 走与心跳异常相同的重连流程。
// 用一个短延迟把退出与重连解耦，避免同一个 exit 触发多次重连。
// 绑定发生在「实际 fork 成立后」（见 compileBackendProcess 内两种 fork 分支），
// 兼容开发模式下「异步探测 system node 后才 fork」的场景。
function scheduleBackendRestart() {
  clearTimeout(backendRestartTimer)
  backendRestartTimer = setTimeout(() => {
    if (app.isQuitting || reconnecting) return
    backendProcess = null
    handleBackendDown('后端进程意外退出')
  }, 1500)
}

// ===== 启动失败兜底 =====
// 场景一：后端进程不退出但始终起不来（如端口被占，后端自身在无限重试）→ 靠看门狗超时判定。
// 场景二：后端反复崩溃、自动重启次数用尽（见 startBackend）→ 直接判定。
// 判定后广播 backend-failed，启动占位页显示「重启后端 / 退出应用」；后端恢复时广播 failed:false。
function broadcastBackendFailed(failed) {
  broadcast({ type: 'backend-failed', failed })
}

function markBackendFailed() {
  if (backendFailed) return
  backendFailed = true
  clearTimeout(backendFailTimer)
  backendFailTimer = null
  backendLog('[main] 后端启动失败（超时或自动重启用尽），已提示用户重试或退出\n')
  setBootStatus('本地服务启动失败')
  broadcastBackendFailed(true)
}

function clearBackendFailure() {
  clearTimeout(backendFailTimer)
  backendFailTimer = null
  if (!backendFailed) return
  backendFailed = false
  broadcastBackendFailed(false)
}

function armBackendFailWatchdog() {
  clearTimeout(backendFailTimer)
  backendFailTimer = setTimeout(() => {
    if (app.isQuitting || backendReady) return
    markBackendFailed()
  }, BACKEND_FAIL_TIMEOUT)
}

// ===== 运行期心跳 + 重连 =====
// 探测：每 HEARTBEAT_INTERVAL 发一次 ping，单次等待 HEARTBEAT_TIMEOUT；
// 连续 HEARTBEAT_FAIL_LIMIT 次超时判定后端异常（假死），进入重连流程。
function startHeartbeat() {
  if (heartbeatRunning) return
  heartbeatRunning = true
  heartbeatFailStreak = 0
  heartbeatPending = false
  clearInterval(heartbeatTimer)
  clearTimeout(heartbeatAwaitTimer)
  heartbeatTimer = setInterval(heartbeatTick, HEARTBEAT_INTERVAL)
}

function stopHeartbeat() {
  heartbeatRunning = false
  heartbeatPending = false
  heartbeatFailStreak = 0
  clearInterval(heartbeatTimer)
  clearTimeout(heartbeatAwaitTimer)
  heartbeatTimer = null
  heartbeatAwaitTimer = null
}

function heartbeatTick() {
  if (app.isQuitting || reconnecting || heartbeatPending) return
  const proc = backendProcess
  if (!proc) return
  heartbeatPending = true
  try {
    proc.send({ type: 'ping', t: Date.now() })
  } catch (_) {
    heartbeatPending = false
    return
  }
  clearTimeout(heartbeatAwaitTimer)
  heartbeatAwaitTimer = setTimeout(() => {
    if (app.isQuitting || reconnecting || !heartbeatPending) return
    heartbeatPending = false
    // 进程已被替换（主动重启 / 迁移中停后端 / 已崩走重连），本次超时不计入
    if (proc !== backendProcess) return
    heartbeatFailStreak += 1
    backendLog(`[main] 后端心跳超时（第 ${heartbeatFailStreak}/${HEARTBEAT_FAIL_LIMIT} 次）\n`)
    if (heartbeatFailStreak >= HEARTBEAT_FAIL_LIMIT) handleBackendDown('后端无响应（疑似假死）')
  }, HEARTBEAT_TIMEOUT)
}

// 运行期崩溃测试：就绪后 N 秒杀掉后端进程，模拟「跑着跑着后端崩了」，
// 用来验证心跳/重连/全屏失败页整条链路。仅在设置 SIM_BACKEND_CRASH 时生效。
function armSimCrash() {
  if (simCrashFired) return
  simCrashFired = true
  backendLog(`[main] SIM_BACKEND_CRASH=${SIM_BACKEND_CRASH}：${SIM_BACKEND_CRASH_MS}ms 后杀掉后端\n`)
  setTimeout(() => {
    if (app.isQuitting) return
    const proc = backendProcess
    if (!proc) return
    backendLog('[main] SIM：模拟后端崩溃\n')
    try { proc.kill() } catch (_) { /* 忽略 */ }
  }, SIM_BACKEND_CRASH_MS)
}

// 广播运行期重连状态：渲染层据此显示「后端异常，正在重新连接（n/5）」，恢复后隐藏
function broadcastBackendReconnecting(active, attempt) {
  broadcast({ type: 'backend-reconnecting', active, attempt, max: RECONNECT_MAX })
}

// 后端异常（假死或意外退出）统一入口：最多重连 RECONNECT_MAX 次，每次 fork 后等就绪信号，
// 任一次成功即恢复心跳并广播解除提示；全部失败则复用「启动失败」页面（重启后端 / 退出应用）。
async function handleBackendDown(reason) {
  if (reconnecting || app.isQuitting) return
  reconnecting = true
  stopHeartbeat()
  backendLog(`[main] ${reason}，开始重连（最多 ${RECONNECT_MAX} 次）\n`)
  for (let attempt = 1; attempt <= RECONNECT_MAX; attempt++) {
    if (app.isQuitting) { reconnecting = false; return }
    broadcastBackendReconnecting(true, attempt)
    setBootStatus(`后端异常，正在重新连接（${attempt}/${RECONNECT_MAX}）…`)
    try { await stopBackendProcess() } catch (_) { /* 忽略 */ }
    if (app.isQuitting) { reconnecting = false; return }
    backendRestartCount = 0
    startBackend()
    setBootStatus(`后端异常，正在重新连接（${attempt}/${RECONNECT_MAX}）…`)
    const ok = await waitForBackendReadySignal(RECONNECT_READY_TIMEOUT)
    if (ok) {
      // 就绪后 onBackendMessage 已重启心跳并广播 backend-ready
      reconnecting = false
      backendLog(`[main] 后端第 ${attempt} 次重连成功\n`)
      broadcastBackendReconnecting(false, 0)
      return
    }
    backendLog(`[main] 后端第 ${attempt} 次重连失败\n`)
  }
  reconnecting = false
  broadcastBackendReconnecting(false, 0)
  markBackendFailed()
}

// 单次 ping：等 pong 回来的同时校验进程身份，避免把「已被替换的进程」算成成功
function pingOnce(proc) {
  return new Promise((resolve) => {
    if (!proc || proc !== backendProcess) return resolve(false)
    let timer = null
    const finish = (v) => {
      if (probeWaiter !== finish) return
      probeWaiter = null
      clearTimeout(timer)
      resolve(v)
    }
    probeWaiter = finish
    timer = setTimeout(() => finish(false), HEARTBEAT_TIMEOUT)
    try { proc.send({ type: 'ping', t: Date.now() }) } catch (_) { finish(false) }
  })
}

// 后端就绪检测：后端 app.listen 回调会打印「服务器已启动」，这里仅作日志提示，
// 不再触发建窗（主窗口已提前创建）。stdout 可能被分片，做滚动缓冲 + 子串匹配。
function detectBackendReady(chunk) {
  readyBuffer += String(chunk)
  if (readyBuffer.length > 4096) readyBuffer = readyBuffer.slice(-4096)
  if (!/服务器已启动|listening|server started/i.test(readyBuffer)) return
  readyBuffer = ''
  startupTimer.mark('后端就绪')
  console.log('[main] 后端已就绪')
}

// 停止后端子进程（不清 isQuitting 标志，便于随后重启）。
// 返回 Promise：等进程真正退出后再 resolve。Windows 上 kill() 是异步的，若不等它
// 退出就立刻拷贝/删除数据库文件，会因 .db/.db-wal/.db-shm 句柄尚未释放而 EBUSY/EPERM 失败。
// 同时摘掉 exit→scheduleBackendRestart 监听：本次是「主动停止」，不应再被自动重启拉起来
// （否则会和调用方的 startBackend() 一起 fork 出两个后端）。
function stopBackendProcess() {
  clearTimeout(backendRestartTimer)
  // 主动停止后端（迁移 / 加密转换 / 重连 / 退出）时一并停掉心跳，
  // 避免探测一个已不在的进程而被误判为「后端无响应」
  stopHeartbeat()
  backendReady = false
  const proc = backendProcess
  backendProcess = null
  if (!proc) return Promise.resolve()
  try { proc.removeListener('exit', scheduleBackendRestart) } catch (_) { /* 忽略 */ }
  return new Promise((resolve) => {
    let settled = false
    const done = () => { if (settled) return; settled = true; resolve() }
    proc.once('exit', done)
    try { proc.kill() } catch (_) { done() }
    // 兜底：进程迟迟不退出也不能无限等待
    setTimeout(done, 3000)
  })
}

// 等待后端就绪信号（主进程侧）：已就绪立即返回 true；否则等 backend-ready 上报，
// 超时返回 false（此时由调用方继续退避重试兜底）。与渲染层 utils/backendReady.js 契约一致。
function waitForBackendReadySignal(timeout = 15000) {
  if (backendReady) return Promise.resolve(true)
  return new Promise((resolve) => {
    let done = false
    let timer = null
    const onReady = () => finish(true)
    const finish = (v) => {
      if (done) return
      done = true
      backendReadyWaiters.delete(onReady)
      clearTimeout(timer)
      resolve(v)
    }
    backendReadyWaiters.add(onReady)
    timer = setTimeout(() => finish(backendReady), timeout)
  })
}

// 应用退出时收尾：置退出标志、杀后端、关闭日志流
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

function getBackendProcess() {
  return backendProcess
}

function isBackendReady() {
  return backendReady
}

// 注册「首次就绪」回调：已就绪立即触发；否则登记，待第一次 backend-ready 上报时触发一次。
// 仅供启动计时锚点使用（运行期重启的就绪不再触发）。
function onFirstReady(fn) {
  if (typeof fn !== 'function') return
  if (backendReady) { fn(); return }
  firstReadyCb = fn
}

function registerBackendIpc(opts = {}) {
  if (typeof opts.getMainWindow === 'function') getMainWindow = opts.getMainWindow
  if (typeof opts.getWidgetWindow === 'function') getWidgetWindow = opts.getWidgetWindow
  if (typeof opts.getDesktopWidgetWindow === 'function') getDesktopWidgetWindow = opts.getDesktopWidgetWindow
  if (typeof opts.getMigrationWindow === 'function') getMigrationWindow = opts.getMigrationWindow
  if (typeof opts.getSetupWindow === 'function') getSetupWindow = opts.getSetupWindow

  // 用户点「重启后端」：复位重试计数与失败标记，先停掉旧进程再重新 fork，并重新武装看门狗
  ipcMain.handle('restart-backend', async () => {
    clearBackendFailure()
    backendRestartCount = 0
    backendReady = false
    try { await stopBackendProcess() } catch (_) { /* 忽略 */ }
    startBackend()
    return { ok: true }
  })

  // 失败态查询：兜住「主进程先失败、窗口后加载」的竞态
  ipcMain.handle('backend-failure', () => backendFailed)

  // 渲染层上报「请求没拿到响应」（连接被拒/中断）时调用：立刻做一次健康探测。
  // 把用户的每一次失败操作变成探针，不必等下一个 30s 心跳周期才发现后端不可达。
  // 探测成功 → 只是偶发（如请求被取消），不做任何处理；探测失败 → 后端确实不可达，立即走重连。
  // 启动阶段（backendReady 为假）一律不介入：那时该由启动看门狗与失败页负责，避免两套机制并行。
  ipcMain.handle('probe-backend', async () => {
    if (app.isQuitting || !backendReady) return { ok: false, skipped: true }
    if (reconnecting) return { ok: false, reconnecting: true }
    if (probing) return { ok: false, skipped: true }
    const proc = backendProcess
    if (!proc) return { ok: false, reconnecting: true }
    probing = true
    let alive = false
    try {
      alive = await pingOnce(proc)
    } finally {
      probing = false
    }
    if (alive) return { ok: true }
    backendLog('[main] 前端上报请求无响应，即时探测亦失败，进入重连\n')
    // 不 await：立即把结果还给渲染层，重连在后台推进
    handleBackendDown('后端不可达（前端请求失败触发）')
    return { ok: false, reconnecting: true }
  })

  // 后端就绪状态查询：兜住「后端先就绪、渲染层后注册监听」的竞态（广播事件会漏掉这类窗口）
  ipcMain.handle('backend-status', () => backendReady)

  // 启动阶段状态查询：加载页据此补齐当前「程序正在干嘛」（兜住「页面后加载」的竞态）
  ipcMain.handle('boot-status', () => bootStatusText)
}

module.exports = {
  registerBackendIpc,
  startBackend,
  stopBackendProcess,
  shutdownBackend,
  waitForBackendReadySignal,
  setBootStatus,
  getBootStatusText,
  getBackendProcess,
  isBackendReady,
  onFirstReady,
}