// =========================================================================
// _isolated-backend.cjs —— 冒烟脚本的「隔离后端」启动器
//
// 下划线前缀是刻意的：run-smoke.cjs 收集用例时会跳过 `_` / `.` 开头的文件，
// 所以这个文件不会被当成测试跑。新写需要真后端的冒烟脚本，require 它即可。
//
// 为什么需要它（而不是连一个现成的后端）：
//   Electron 主进程 fork 的后端**一定**注入 SECURE_MASTER（安全通道）。
//   安全模式下 middleware/auth.js 的 resolveAuth 在 hasMaster() 为真时直接返回
//   token: null，**根本不读 Authorization: Bearer** —— 只有 X-Auth-Proof 信道凭据才认。
//   纯 HTTP 的冒烟脚本不带信道凭据，对着这种后端跑会从第一个带鉴权的请求开始全红 401，
//   而那批红色**不是产品缺陷**，是环境错配。红久了就没人看了，等于这条链路零覆盖。
//   自起一个 PORT / DATA_DIR 隔离、不注入 SECURE_MASTER 的后端，结论才只反映业务逻辑。
//
// 用法：
//   const { startIsolatedBackend } = require('./_isolated-backend')
//   const h = await startIsolatedBackend()
//   await fetch(h.base + '/api/...')
//   await h.stop()          // 必须在退出前 await，否则临时目录删不掉（Windows 句柄延迟）
//
// 失败时 h.log() 里是后端自己的 stdout/stderr，便于定位「起不来」的原因。
// =========================================================================
const { spawn } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const crypto = require('node:crypto')

const ROOT = path.join(__dirname, '..', '..')
const APP_ENTRY = path.join(ROOT, 'student-backend', 'app.js')
const LOG_LIMIT = 8192

// 所有活跃实例：进程异常退出时兜底 kill，避免留下孤儿后端
const live = new Set()

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
}

function waitPort(port, timeoutMs, isDead) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = () => {
      // 子进程已经退出：不必等满超时，直接失败（日志由调用方带出）
      if (isDead && isDead()) return reject(new Error('后端进程提前退出'))
      const s = net.connect(port, '127.0.0.1')
      s.once('connect', () => { s.destroy(); resolve() })
      s.once('error', () => {
        s.destroy()
        if (Date.now() - t0 > timeoutMs) return reject(new Error(`后端启动超时（${timeoutMs}ms）`))
        setTimeout(tick, 250)
      })
    }
    tick()
  })
}

function killTree(child) {
  if (!child || child.exitCode !== null) return
  try { child.kill() } catch (_) { /* 已退出 */ }
}

// 等子进程真正退出，再删数据目录。
// 只靠 process.on('exit') 里删是不行的：那时后端可能仍持有 index.db 句柄，
// rmSync 会失败并被吞掉，于是在系统临时目录留下一堆残留目录（实测踩过）。
async function removeDirWithRetry(dir) {
  if (!dir) return
  for (let i = 0; i < 6; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
}

async function startIsolatedBackend(opts = {}) {
  const timeoutMs = opts.timeoutMs || 30000
  const port = opts.port || await freePort()
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), (opts.prefix || 'smoke') + '-'))

  const env = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    DB_MASTER_KEY: opts.masterKey || crypto.randomBytes(32).toString('hex'),
    ...(opts.env || {}),
  }
  // 显式剔除：终端或父进程可能透传安全通道密钥，留着就又会退回「只认信道凭据」的模式。
  // 若调用方确实想测安全模式，用 env 显式传回来。
  if (!opts.keepSecureChannel) {
    delete env.SECURE_MASTER
    delete env.DW_SECURE_MASTER
  }

  const child = spawn(process.execPath, [APP_ENTRY], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  const collect = (d) => {
    log += d
    if (log.length > LOG_LIMIT) log = log.slice(-LOG_LIMIT)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  const handle = {
    port,
    dataDir,
    base: 'http://127.0.0.1:' + port,
    child,
    _keepData: !!opts.keepData, // 供 exit 兜底判断要不要删目录
    log: () => log,
    async stop() {
      live.delete(handle)
      killTree(child)
      if (child.exitCode === null) {
        const exited = new Promise((r) => child.once('exit', r))
        await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))])
      }
      if (!opts.keepData) await removeDirWithRetry(dataDir)
    },
  }
  live.add(handle)

  try {
    await waitPort(port, timeoutMs, () => child.exitCode !== null)
  } catch (err) {
    // 起不来时把后端日志一起抛出去，否则调用方只看到「超时」无从下手
    await handle.stop().catch(() => {})
    const tail = log.slice(-1200).trim()
    throw new Error(`${err.message}${tail ? '\n后端日志:\n' + tail : ''}`)
  }
  return handle
}

// 兜底：脚本异常退出（含 stdout 管道被提前关闭导致的 EPIPE）时杀掉所有还活着实例。
// 这里再同步尝试删一次数据目录：异步清理来不及做，但子进程刚被 kill 时句柄通常已释放，
// 删不掉就留给系统临时目录 —— 不能因为清理失败反过来影响测试结论。
process.on('exit', () => {
  for (const h of live) {
    killTree(h.child)
    if (h._keepData) continue
    try { fs.rmSync(h.dataDir, { recursive: true, force: true }) } catch (_) { /* 句柄未释放 */ }
  }
})

module.exports = { startIsolatedBackend }
