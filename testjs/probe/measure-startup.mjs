// =========================================================================
// measure-startup.mjs —— 启动耗时测量脚本
//
// 目的：量化启动各阶段耗时，回答「后端慢还是前端慢」——
//   应用「总耗时」口径 = ready-to-show（窗口首次显示，由 main.js revealWindow 定锚点，
//   即 startup.log 的「总耗时」与性能面板「上次启动耗时」）；
//   诊断口径 = max(后端就绪, 占位页移除（界面可见）)，谁更晚谁就是瓶颈。
//
// 用法：
//   node testjs/measure-startup.mjs                  # 正式版整体启动（默认 3 次）
//   node testjs/measure-startup.mjs --runs=5         # 次数
//   node testjs/measure-startup.mjs --exe=<path>     # 指定打包 exe
//   node testjs/measure-startup.mjs --dev            # 未打包 electron + Vite（开发口径）
//   node testjs/measure-startup.mjs --real           # 用真实用户数据（不隔离；先关闭正在运行的应用）
//   node testjs/measure-startup.mjs --backend-only   # 只测后端冷启动（快，无 GUI）
//   node testjs/measure-startup.mjs --backend-only --cold   # 先清编译缓存 = 模拟首启
//   node testjs/measure-startup.mjs --json           # 机器可读输出
//   node testjs/measure-startup.mjs --duration=20000 # 单次最长运行时长（默认 15000ms）
//   node testjs/measure-startup.mjs --grace=8000     # 出现「启动完成」后再等多久（默认 6000ms，等日志落盘）
//   node testjs/measure-startup.mjs --exe-args="--no-sandbox"  # 给被启动的 exe/electron 追加参数
//
// 日志保存（重要）：
//   - 每次运行的原始终端输出 → <隔离目录>/logs/runN.log
//   - 应用自身写的时间线     → <隔离目录>/user-data/data/startup.log
//     打包版是 GUI 程序，标准输出常常抓不到，此时本脚本自动改用上面这份 startup.log。
//
// 说明：
//  - 数据完全隔离在 %LOCALAPPDATA%\BanjiiStartupMeasure（--user-data-dir + app-config.json），
//    不会动真实 %APPDATA% 下的数据，也不会触发单实例锁冲突。
//    不用项目目录：项目目录易被杀软实时扫描锁文件，会让 Chromium 的 GPU 持久缓存
//    报「另一个程序正在使用此文件」并导致 GPU 进程启动失败。可用环境变量 BANJI_ISO 覆盖。
//  - 正式版模式会实际弹出主窗口（测量需要真实渲染），每次测完自动结束进程树。
//  - Windows PowerShell 下中文可能显示为乱码，可先执行 `chcp 65001`。
// =========================================================================

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BACKEND_DIR = path.join(ROOT, 'student-backend')
const BACKEND_APP = path.join(BACKEND_DIR, 'app.js')
// 隔离目录默认放 LOCALAPPDATA（不放项目目录）：项目目录易被杀软实时扫描锁住文件，
// 会让 Chromium 的 GPU 持久缓存报「另一个程序正在使用此文件」并导致 GPU 进程启动失败。
// 可用环境变量 BANJI_ISO 覆盖，例如 $env:BANJI_ISO="D:\tmp\banji-measure"
const ISO_ROOT = process.env.BANJI_ISO || path.join(process.env.LOCALAPPDATA || ROOT, 'BanjiiStartupMeasure')
const ISO_USER_DATA = path.join(ISO_ROOT, 'user-data')
const ISO_DATA = path.join(ISO_ROOT, 'data')
const LOG_DIR = path.join(ISO_ROOT, 'logs')
const ELECTRON_EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const DEV_PORT = 5173
// 应用自身落盘的时间线（saveLog 写 userData/data/startup.log）。
// 隔离模式读隔离目录；--real（真实数据）读 %APPDATA% 下的真实 userData。
function appLogCandidates() {
  if (opt.real) {
    const roaming = process.env.APPDATA || ''
    return ['班集', 'campus-assistant'].map((n) => path.join(roaming, n, 'data', 'startup.log'))
  }
  return [
    path.join(ISO_USER_DATA, 'data', 'startup.log'),
    path.join(ISO_DATA, 'startup.log'),
  ]
}
// 测试用 DB 主密钥（64 位 hex = 32 字节）。正式版由主进程经 safeStorage 生成后注入；
// 这里只用于隔离目录内的测量，不触碰真实数据。
const TEST_DB_MASTER_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

// ---------- 参数解析 ----------
const opt = {
  runs: 3,
  timeout: 30000,
  duration: 15000,
  grace: 6000,
  backendOnly: false,
  dev: false,
  exe: null,
  json: false,
  cold: false,
  real: false,
  exeArgs: '',
}
for (const a of process.argv.slice(2)) {
  const num = (s, d) => { const v = Number(s); return Number.isFinite(v) && v > 0 ? v : d }
  if (a === '--backend-only') opt.backendOnly = true
  else if (a === '--dev') opt.dev = true
  else if (a === '--json') opt.json = true
  else if (a === '--cold') opt.cold = true
  else if (a === '--real') opt.real = true
  else if (a.startsWith('--runs=')) opt.runs = Math.max(1, num(a.slice(7), 3))
  else if (a.startsWith('--timeout=')) opt.timeout = num(a.slice(10), 30000)
  else if (a.startsWith('--duration=')) opt.duration = num(a.slice(11), 15000)
  else if (a.startsWith('--grace=')) opt.grace = num(a.slice(8), 6000)
  else if (a.startsWith('--exe=')) opt.exe = a.slice(6)
  else if (a.startsWith('--exe-args=')) opt.exeArgs = a.slice(11)
  else if (a === '-h' || a === '--help') { printHelp(); process.exit(0) }
  else { console.error(`未知参数：${a}`); printHelp(); process.exit(1) }
}

// ---------- 工具 ----------
function findPackagedExe() {
  if (opt.exe) return existsSync(opt.exe) ? opt.exe : null
  const candidates = []
  for (const dir of readdirSync(ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    if (!/^(release|dist|out)/i.test(dir.name)) continue
    const unpacked = path.join(ROOT, dir.name, 'win-unpacked')
    if (!existsSync(unpacked)) continue
    for (const f of readdirSync(unpacked)) if (f.endsWith('.exe')) candidates.push(path.join(unpacked, f))
  }
  return candidates[0] || null
}

// 隔离数据目录：预写 app-config.json，把 dataDir 指到隔离目录，避免写真实用户数据。
// --real 时不隔离，直接用真实 %APPDATA% 数据（需先关闭正在运行的应用，避免单实例锁冲突）。
function prepareIso() {
  mkdirSync(LOG_DIR, { recursive: true })
  if (opt.real) return
  mkdirSync(ISO_USER_DATA, { recursive: true })
  mkdirSync(ISO_DATA, { recursive: true })
  writeFileSync(
    path.join(ISO_USER_DATA, 'app-config.json'),
    JSON.stringify({ dataDir: ISO_DATA }, null, 2),
    'utf8',
  )
}

function killTree(pid) {
  try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch (_) {}
}

function appLogPath() {
  const list = appLogCandidates()
  return list.find((p) => existsSync(p)) || list[0]
}
function appLogSize() {
  try { return statSync(appLogPath()).size } catch (_) { return 0 }
}

// 解析应用 startup.log 的新增段落（权威数据源；stdout 抓不到时靠它）
// 行格式：+  812ms  事件名  (间隔 12ms)    /    总耗时: 1234ms
function readNewLogMarks(fromSize) {
  try {
    const buf = readFileSync(appLogPath())
    const text = buf.subarray(fromSize).toString('utf8')
    const marks = []
    let inDump = false // 报告结尾会整段重复打印一次时间线，跳过以免重复计数
    for (const line of text.split(/\r?\n/)) {
      if (line.includes('=====')) { inDump = true; continue }
      if (inDump) continue
      const m = line.match(/^\s*\+\s*(\d+)ms\s+(.+?)\s+\(间隔\s+\d+ms\)\s*$/)
      if (m) { marks.push({ name: m[2].trim(), at: Number(m[1]), src: 'file' }); continue }
      const t = line.match(/^\s*总耗时:\s*([\d.]+)ms\s*$/)
      if (t) marks.push({ name: '__total__', at: Math.round(Number(t[1])), src: 'file' })
    }
    return marks
  } catch (_) { return [] }
}

// 解析 stdout/stderr 里的 [startup] 打点
// 格式：[startup] +812ms  事件名  (间隔 12ms)  |  [startup] 名称 @epochMs（渲染层原始）
function parseStdoutMarks(text, wallStart, seen) {
  const marks = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('[startup]')) continue
    const m = line.match(/\[startup\]\s*\+(\d+)ms\s+(.+?)(?:\s+\(间隔\s*\d+ms\))?\s*$/)
    if (m) {
      const name = m[2].trim()
      if (!seen.has(name)) { seen.add(name); marks.push({ name, at: Number(m[1]), src: 'stdout' }) }
      continue
    }
    const r = line.match(/\[startup\]\s+(.+?)\s*@(\d{12,})\s*$/)
    if (r) {
      const name = r[1].trim()
      if (!seen.has(name)) { seen.add(name); marks.push({ name, at: Math.round(Number(r[2]) - wallStart), src: 'stdout-approx' }) }
    }
  }
  return marks
}

// 启动一个进程：抓 stdout/stderr、落盘原始日志，直到出现结束标志（再等 grace）或达到 duration
function launchAndCollect({ cmd, args, cwd, env, until, label, runIndex }) {
  return new Promise((resolve) => {
    const wallStart = Date.now()
    const t0 = performance.now()
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const marks = []
    const seen = new Set()
    let raw = ''
    let settled = false
    let graceTimer = null
    const hardTimer = setTimeout(() => finish('duration'), opt.duration)

    const finish = (reason) => {
      if (settled) return
      settled = true
      clearTimeout(hardTimer)
      if (graceTimer) clearTimeout(graceTimer)
      killTree(child.pid)
      try { writeFileSync(path.join(LOG_DIR, `run${runIndex}.log`), raw, 'utf8') } catch (_) {}
      setTimeout(() => resolve({ marks, reason, raw, totalMs: performance.now() - t0 }), 600)
    }

    const onChunk = (buf) => {
      raw += buf.toString()
      for (const m of parseStdoutMarks(buf.toString(), wallStart, seen)) marks.push(m)
      if (until && raw.includes(until) && !graceTimer) {
        // 出现结束标志后不立刻杀：再等 grace，让应用把 startup.log 落盘
        graceTimer = setTimeout(() => finish('ok'), opt.grace)
      }
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('exit', (code) => finish('exit:' + code))
    setTimeout(() => finish('timeout'), opt.timeout)

    if (label) process.stdout.write(`${label} ... `)
  })
}

function pick(marks, ...names) {
  for (const n of names) {
    const hit = marks.find((m) => m.name.includes(n))
    if (hit) return hit.at
  }
  return null
}

function stats(list) {
  if (!list.length) return null
  const s = [...list].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  const median = s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
  const avg = Math.round(s.reduce((a, b) => a + b, 0) / s.length)
  return { min: s[0], median, max: s[s.length - 1], avg }
}

const fmt = (v) => (v === null ? '—' : `${v}ms`)
const fmtSigned = (v) => (v === null ? '—' : (v >= 0 ? `+${v}ms` : `${v}ms`))

function printHelp() {
  console.log(`
启动耗时测量脚本

  node testjs/measure-startup.mjs                  正式版整体启动（默认 3 次）
  node testjs/measure-startup.mjs --runs=5         指定运行次数
  node testjs/measure-startup.mjs --exe=<path>     指定打包后的 exe
  node testjs/measure-startup.mjs --dev            未打包 electron（需 Vite，开发口径）
  node testjs/measure-startup.mjs --real           用真实用户数据（不隔离；先关闭正在运行的应用）
  node testjs/measure-startup.mjs --backend-only   只测后端冷启动（快，无 GUI）
  node testjs/measure-startup.mjs --backend-only --cold   先清编译缓存（模拟首次启动）
  node testjs/measure-startup.mjs --duration=20000 单次最长运行时长（默认 15000ms）
  node testjs/measure-startup.mjs --grace=8000     出现「启动完成」后再等多久（默认 6000ms）
  node testjs/measure-startup.mjs --json           输出 JSON
  node testjs/measure-startup.mjs --timeout=60000  单次超时（默认 30000ms）
  node testjs/measure-startup.mjs --exe-args="--no-sandbox"   给被启动的 exe/electron 追加参数

日志：%LOCALAPPDATA%\\BanjiiStartupMeasure\\logs\\runN.log              原始输出
      %LOCALAPPDATA%\\BanjiiStartupMeasure\\user-data\\data\\startup.log 应用时间线（权威）
说明：正式版模式会真的弹出窗口；每次测完自动结束进程树。环境变量 BANJI_ISO 可改隔离目录。
`)
}

// ---------- 后端冷启动测量 ----------
// 从「进程创建」到「服务器已启动」：含 node 运行时启动 + listen 前同步 require + listen
async function measureBackendOnce(cold, runIndex) {
  const cacheDir = path.join(ISO_ROOT, 'node-compile-cache')
  if (cold) rmSync(cacheDir, { recursive: true, force: true })
  const t0 = performance.now()
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BACKEND_APP], {
      cwd: BACKEND_DIR,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_COMPILE_CACHE: cacheDir,
        DATA_DIR: ISO_DATA,
        ALBUM_THUMBS_DIR: path.join(ISO_DATA, 'album-thumbs'),
        DB_MASTER_KEY: process.env.DB_MASTER_KEY || TEST_DB_MASTER_KEY,
      },
    })
    let out = ''
    let settled = false
    const done = (reason) => {
      if (settled) return
      settled = true
      const ms = Math.round(performance.now() - t0)
      killTree(child.pid)
      try { writeFileSync(path.join(LOG_DIR, `backend-run${runIndex}.log`), out, 'utf8') } catch (_) {}
      resolve({ ms: reason === 'ready' ? ms : null, reason, tail: out.trim().split(/\r?\n/).slice(-5).join(' | ') })
    }
    const onChunk = (b) => {
      out += b.toString()
      if (out.includes('已启动')) done('ready')
    }
    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('exit', (c) => done('exit:' + c))
    setTimeout(() => done('timeout'), opt.timeout)
  })
}

async function runBackendOnly() {
  prepareIso()
  const rows = []
  for (let i = 1; i <= opt.runs; i++) {
    const r = await measureBackendOnce(opt.cold, i)
    rows.push(r)
    process.stdout.write(`#${i} 后端就绪 ${r.ms === null ? `失败(${r.reason})` : r.ms + 'ms'}`)
    if (r.ms === null && r.tail) process.stdout.write(`   ${r.tail}`)
    process.stdout.write('\n')
    await new Promise((res) => setTimeout(res, 800))
  }
  const ok = rows.filter((r) => r.ms !== null).map((r) => r.ms)
  const st = stats(ok)
  if (opt.json) {
    console.log(JSON.stringify({ mode: 'backend-only', cold: opt.cold, runs: rows, stats: st }, null, 2))
  } else if (st) {
    console.log(`\n后端就绪耗时（${opt.cold ? '冷：每次清编译缓存' : '热：复用编译缓存'}）`)
    console.log(`  最小 ${st.min}ms   中位 ${st.median}ms   平均 ${st.avg}ms   最大 ${st.max}ms   （有效 ${ok.length}/${opt.runs} 次）`)
    console.log(`  说明：不含主进程侧 fork 前的准备，也不含「就绪后再暖机(warmup)」的成本。`)
  }
  console.log(`\n原始输出日志：${LOG_DIR}`)
}

// ---------- 整体启动测量 ----------
async function waitForPort(port, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 500 }, (res) => { res.destroy(); resolve(true) })
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
    })
    if (ok) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

async function runApp() {
  prepareIso()
  let exe = null
  let args = []
  const cwd = ROOT
  let vite = null

  if (opt.dev) {
    if (!existsSync(ELECTRON_EXE)) { console.error('未找到 electron（node_modules/electron/dist/electron.exe），请先 npm install'); process.exit(1) }
    process.stdout.write('启动 Vite 开发服务器 ... ')
    vite = spawn('npm.cmd', ['run', 'dev'], { cwd: path.join(ROOT, 'student-frontend'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: true })
    const ok = await waitForPort(DEV_PORT, 60000)
    console.log(ok ? '就绪' : '超时（继续尝试）')
    exe = ELECTRON_EXE
    args = ['.']
    if (!opt.real) args.push(`--user-data-dir=${ISO_USER_DATA}`)
    if (opt.exeArgs) args.push(...opt.exeArgs.split(/\s+/).filter(Boolean))
  } else {
    exe = findPackagedExe()
    if (!exe) {
      console.error('未找到打包产物（release*/win-unpacked/*.exe）。请先执行：npm run electron:build，或用 --exe=<path> 指定。')
      process.exit(1)
    }
    args = []
    if (!opt.real) args.push(`--user-data-dir=${ISO_USER_DATA}`)
    if (opt.exeArgs) args.push(...opt.exeArgs.split(/\s+/).filter(Boolean))
    console.log(`使用 exe：${exe}${opt.exeArgs ? `（额外参数：${opt.exeArgs}）` : ''}`)
  }

  const rows = []
  let fileSourceUsed = 0
  try {
    for (let i = 1; i <= opt.runs; i++) {
      const logSizeBefore = appLogSize()
      const r = await launchAndCollect({ cmd: exe, args, cwd, until: '启动完成', label: `#${i} 运行中`, runIndex: i })
      // 合并两个数据源：应用 startup.log（权威）优先，stdout 打点补充
      const fileMarks = readNewLogMarks(logSizeBefore)
      const merged = []
      const pushUniq = (m) => { if (!merged.some((x) => x.name === m.name)) merged.push(m) }
      fileMarks.filter((m) => m.name !== '__total__').forEach(pushUniq)
      r.marks.forEach(pushUniq)
      const totalFromLog = fileMarks.find((m) => m.name === '__total__')
      if (fileMarks.length) fileSourceUsed++

      const backendReady = pick(merged, '后端就绪')
      // 「界面可见」候选：主窗口路径为「占位页移除」，引导/设置窗口路径为「引导界面挂载完成」。
      // 不要用「首屏可见」，它会误匹配到合并打点「启动完成：窗口首次显示」一类的汇总行。
      const visible = pick(merged, '占位页移除', '引导界面挂载完成')
      const done = pick(merged, '启动完成') ?? (totalFromLog ? totalFromLog.at : null)
      rows.push({ backendReady, visible, done, reason: r.reason, srcCount: { file: fileMarks.length, stdout: r.marks.length }, marks: merged })
      console.log(
        ` ${r.reason}  后端就绪=${fmt(backendReady)}  界面可见=${fmt(visible)}  启动完成=${fmt(done)}` +
        `  [来源 file=${fileMarks.filter((m) => m.name !== '__total__').length} stdout=${r.marks.length}]`,
      )
      await new Promise((res) => setTimeout(res, 1500))
    }
  } finally {
    if (vite) killTree(vite.pid)
  }

  const gap = (r) => (r.visible !== null && r.backendReady !== null ? r.visible - r.backendReady : null)
  const stB = stats(rows.map((r) => r.backendReady).filter((v) => v !== null))
  const stV = stats(rows.map((r) => r.visible).filter((v) => v !== null))
  const stD = stats(rows.map((r) => r.done).filter((v) => v !== null))

  if (opt.json) {
    console.log(JSON.stringify({ mode: opt.dev ? 'dev' : 'packaged', exe, runs: rows, stats: { backendReady: stB, visible: stV, done: stD } }, null, 2))
    return
  }

  console.log('\n========== 结果 ==========')
  console.log('运行   后端就绪    界面可见    启动完成    可见−后端')
  rows.forEach((r, i) => {
    console.log(
      `#${i + 1}    ${fmt(r.backendReady).padEnd(10)} ${fmt(r.visible).padEnd(10)} ${fmt(r.done).padEnd(10)} ${fmtSigned(gap(r))}`,
    )
  })
  if (stB && stV && stD) {
    console.log(`中位   ${fmt(stB.median).padEnd(10)} ${fmt(stV.median).padEnd(10)} ${fmt(stD.median).padEnd(10)} ${fmtSigned(stV.median - stB.median)}`)
    console.log('\n判断：')
    console.log(`  后端就绪中位 ${stB.median}ms，界面可见中位 ${stV.median}ms`)
    if (stV.median >= stB.median) {
      console.log(`  → 界面可见晚 ${stV.median - stB.median}ms，瓶颈在【前端首屏】（后端已先就绪，再优化后端无收益）`)
    } else {
      console.log(`  → 后端就绪晚 ${stB.median - stV.median}ms，瓶颈在【后端冷启动】（此时优化前端首屏无收益）`)
    }
  } else {
    console.log('\n未能取全关键打点。请检查下面两份日志，确认应用是否正常启动：')
    console.log(`  原始输出：${LOG_DIR}\\runN.log`)
    console.log(`  应用时间线：${appLogPath()}`)
  }
  if (fileSourceUsed === 0 && !(stB && stV && stD)) {
    console.log('\n提示：未从 startup.log 读到内容（可能是首启未走完、或日志尚未落盘）。')
    console.log('      可加大 --grace（默认 6000ms）与 --duration（默认 15000ms）后重试。')
  }
  console.log(opt.real ? '\n数据目录：真实 userData（未隔离）' : '\n隔离数据目录：' + ISO_ROOT)
}

// ---------- 入口 ----------
;(async () => {
  if (opt.backendOnly) await runBackendOnly()
  else await runApp()
})().catch((e) => { console.error(e); process.exit(1) })
