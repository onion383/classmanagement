#!/usr/bin/env node
// =========================================================================
// run-smoke.cjs —— 冒烟测试总入口
//
// 作用：一次跑完 smoke/ 下所有冒烟脚本，汇总通过/失败。
// 每个脚本**仍然可以单独跑**：node testjs/smoke/<文件名>
// 判定标准：进程退出码 0 = 通过，非 0 = 失败（脚本内部自己 assert 并 exit(1)）。
//
// 用法：
//   node testjs/run-smoke.cjs                跑全部
//   node testjs/run-smoke.cjs --list         只列出会跑哪些
//   node testjs/run-smoke.cjs --only=auth    只跑文件名含 auth 的（可重复传）
//   node testjs/run-smoke.cjs --skip=pdf     跳过文件名含 pdf 的（可重复传）
//   node testjs/run-smoke.cjs --bail         第一个失败就停
//
// 设计说明：
//   · **串行**执行。冒烟脚本会各占端口、临时目录（testjs/tmp/…），并行会互相干扰。
//   · stdio 直接透传，脚本自己的彩色输出/断言信息原样可见，不做二次包装。
//   · 需要后端在跑的脚本（见 NEEDS_BACKEND）在后端未就绪时判为 SKIP 而非失败——
//     这类脚本测的是完整业务链路，没有后端本来就没法跑。
//     启动后端：npm run electron:dev，或 node student-backend/app.js。
//     注意：**安全模式的后端不能用来跑这类脚本**（只认 X-Auth-Proof，Bearer 会被判 401），
//     所以需要后端的脚本应自己起隔离后端（参考 smoke/auth-smoke.js）。
//   · .py 脚本用 `python` 跑；找不到 python 则 SKIP（字体校验那类依赖 fontTools）。
//   · **退出码 3 = 脚本自己判定「环境不具备，跳过」**（如缺 fontTools），不计失败。
// =========================================================================

const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')

const SMOKE_DIR = path.join(__dirname, 'smoke')
const NODE_EXT = new Set(['.cjs', '.mjs', '.js'])
// 必须「外部已有后端在跑」的脚本（文件名 → 说明）。启动方式见文件头。
// 目前为空：auth-smoke.js 已改为**自己起一个隔离后端**（随机端口 + 临时数据目录 +
// 不注入 SECURE_MASTER），不再依赖外部 3000 端口。
// 原因：安全模式下后端只认 X-Auth-Proof 信道凭据，纯 HTTP 客户端带 Bearer 会被
// 直接判 401，对着 Electron fork 的后端跑必然全红 —— 那不是产品 bug，是测试环境错配。
const NEEDS_BACKEND = new Set()
const BACKEND_PORT = Number(process.env.PORT) || 3000
const BACKEND_HOST = '127.0.0.1'
// 有产物依赖的脚本必须按顺序跑：pdf-subset-verify.mjs 先生成 subset-out*.ttf，
// font-subset-verify.py 再读取产物校验。只按文件名字典序会反过来，干净检出必假失败。
const ORDER_HINT = new Map([
  ['pdf-subset-verify.mjs', 0],
  ['font-subset-verify.py', 1],
])

// ---------- 参数 ----------
const args = process.argv.slice(2)
const opt = { list: false, bail: false, only: [], skip: [] }
for (const a of args) {
  if (a === '--list') opt.list = true
  else if (a === '--bail') opt.bail = true
  else if (a.startsWith('--only=')) opt.only.push(a.slice(7))
  else if (a.startsWith('--skip=')) opt.skip.push(a.slice(7))
  else if (a === '-h' || a === '--help') {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 24).join('\n').replace(/^\/\/ ?/gm, ''))
    process.exit(0)
  } else {
    console.error(`未知参数：${a}（用 --help 看用法）`)
    process.exit(2)
  }
}

// ---------- 收集脚本 ----------
function collect() {
  if (!fs.existsSync(SMOKE_DIR)) {
    console.error(`未找到 smoke 目录：${SMOKE_DIR}`)
    process.exit(2)
  }
  return fs
    .readdirSync(SMOKE_DIR)
    .filter((f) => {
      const ext = path.extname(f).toLowerCase()
      return NODE_EXT.has(ext) || ext === '.py'
    })
    .filter((f) => !f.startsWith('_') && !f.startsWith('.'))
    .filter((f) => (opt.only.length ? opt.only.some((k) => f.includes(k)) : true))
    .filter((f) => (opt.skip.length ? !opt.skip.some((k) => f.includes(k)) : true))
    .sort((a, b) => {
      const oa = ORDER_HINT.has(a) ? ORDER_HINT.get(a) : 100
      const ob = ORDER_HINT.has(b) ? ORDER_HINT.get(b) : 100
      return oa - ob || a.localeCompare(b)
    })
}

// 探测后端是否在监听（连不上就算没起）
function backendAlive() {
  return new Promise((resolve) => {
    const sock = net.connect({ host: BACKEND_HOST, port: BACKEND_PORT })
    const done = (ok) => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(600, () => done(false))
    sock.on('connect', () => done(true))
    sock.on('error', () => done(false))
  })
}

function which(cmd) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext)
      try {
        if (fs.statSync(p).isFile()) return p
      } catch (_) {}
    }
  }
  return null
}

function runOne(file) {
  const full = path.join(SMOKE_DIR, file)
  const isPy = path.extname(file).toLowerCase() === '.py'
  const python = isPy ? which('python') || which('python3') : null
  const cmd = isPy ? python : process.execPath
  const argv = isPy ? [full] : [full]
  return new Promise((resolve) => {
    const t0 = Date.now()
    const child = spawn(cmd, argv, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env, PORT: String(BACKEND_PORT) },
    })
    child.on('error', (e) => resolve({ file, code: -1, ms: Date.now() - t0, err: e.message }))
    child.on('exit', (code, signal) => resolve({ file, code: code ?? (signal ? -1 : 0), ms: Date.now() - t0 }))
  })
}

;(async () => {
  const files = collect()
  if (!files.length) {
    console.error('没有匹配到任何冒烟脚本（检查 --only/--skip）')
    process.exit(2)
  }

  if (opt.list) {
    console.log(`smoke/ 下共 ${files.length} 个脚本：`)
    files.forEach((f) => console.log(`  ${f}${NEEDS_BACKEND.has(f) ? '   [需后端]' : ''}`))
    process.exit(0)
  }

  const alive = await backendAlive()
  if (!alive && files.some((f) => NEEDS_BACKEND.has(f))) {
    console.log(`\n⚠ 后端未在 ${BACKEND_HOST}:${BACKEND_PORT} 监听，依赖后端的脚本会跳过。`)
    console.log('  需要时先启动：npm run electron:dev\n')
  }

  const results = []
  for (const f of files) {
    if (NEEDS_BACKEND.has(f) && !alive) {
      console.log(`\n── SKIP  ${f}（后端未启动）`)
      results.push({ file: f, code: null, ms: 0 })
      continue
    }
    const isPy = path.extname(f).toLowerCase() === '.py'
    if (isPy && !which('python') && !which('python3')) {
      console.log(`\n── SKIP  ${f}（未找到 python）`)
      results.push({ file: f, code: null, ms: 0 })
      continue
    }
    console.log(`\n── RUN   ${f}`)
    const r = await runOne(f)
    if (r.code === 3) {
      // 脚本自己判定「环境不具备」→ 跳过，不算失败
      results.push({ file: f, code: null, ms: r.ms, reason: '环境不具备' })
      console.log(`── SKIP  ${f}  (${r.ms}ms)`)
      continue
    }
    results.push(r)
    const tag = r.code === 0 ? 'PASS' : 'FAIL'
    console.log(`── ${tag}  ${f}  (${r.ms}ms)${r.err ? `  ${r.err}` : ''}`)
    if (r.code !== 0 && opt.bail) break
  }

  // ---------- 汇总 ----------
  const pass = results.filter((r) => r.code === 0)
  const fail = results.filter((r) => r.code !== 0 && r.code !== null)
  const skip = results.filter((r) => r.code === null)

  console.log('\n' + '='.repeat(56))
  console.log(`冒烟汇总：通过 ${pass.length} / 失败 ${fail.length} / 跳过 ${skip.length}（共 ${results.length}）`)
  if (fail.length) {
    console.log('\n失败项：')
    fail.forEach((r) => console.log(`  ✗ ${r.file}  exit=${r.code}`))
  }
  if (skip.length) {
    console.log('\n跳过项：')
    skip.forEach((r) => console.log(`  - ${r.file}  ${r.reason || (NEEDS_BACKEND.has(r.file) ? '后端未启动' : '缺少运行时')}`))
  }
  console.log('='.repeat(56))
  process.exit(fail.length ? 1 : 0)
})()
