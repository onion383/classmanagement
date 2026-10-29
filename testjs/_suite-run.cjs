// =========================================================================
// _suite-run.cjs —— 测试板块轻量运行器核心（run-units / run-behavior 共用）
//
// 与 run-smoke 的边界：units/behavior 无环境依赖（不起端口、不碰产物、无 SKIP 约定），
// 这里只做「并行逐文件跑 node --test + 与 run-smoke 同款的 per-file PASS/FAIL 与汇总输出」。
// 并行度对齐 node --test 自身（子进程池），保证不比裸跑慢。不要往这里加 run-smoke
// 的环境机制——那是冒烟的环境依赖逼出来的。
//
// 用法（由 run-units.js / run-behavior.js 封装）：
//   [--only=xx]  只跑文件名含 xx 的（可重复传）
//   [--skip=xx]  跳过文件名含 xx 的（可重复传）
//   [--bail]     第一个失败文件出现后不再启动新文件（在途的跑完）
//   [--list]     只列出会跑哪些文件
// =========================================================================
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function parseArgs(argv) {
  const opt = { only: [], skip: [], bail: false, list: false }
  for (const a of argv) {
    if (a.startsWith('--only=')) opt.only.push(a.slice(7))
    else if (a.startsWith('--skip=')) opt.skip.push(a.slice(7))
    else if (a === '--bail') opt.bail = true
    else if (a === '--list') opt.list = true
  }
  return opt
}

// 从 node --test 的 TAP 输出里取 # tests / # pass / # fail
function parseCounts(tap) {
  const get = (k) => {
    const m = tap.match(new RegExp('^# ' + k + ' (\\d+)', 'm'))
    return m ? Number(m[1]) : null
  }
  return { tests: get('tests'), pass: get('pass'), fail: get('fail') }
}

function runOne(full) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, ['--test', full], {
      cwd: path.join(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', (e) => resolve({ ok: false, ms: Date.now() - t0, tap: String(e), counts: {} }))
    child.on('close', (code) =>
      resolve({ ok: code === 0, ms: Date.now() - t0, tap: out, counts: parseCounts(out) })
    )
  })
}

async function runSuite({ dir, label }) {
  const opt = parseArgs(process.argv.slice(2))
  const suiteDir = path.join(__dirname, dir)
  if (!fs.existsSync(suiteDir)) {
    console.error(`未找到测试目录：${suiteDir}`)
    process.exit(2)
  }
  const files = fs
    .readdirSync(suiteDir)
    .filter((f) => f.endsWith('.test.js'))
    .filter((f) => (opt.only.length ? opt.only.some((k) => f.includes(k)) : true))
    .filter((f) => (opt.skip.length ? !opt.skip.some((k) => f.includes(k)) : true))
    .sort()

  if (opt.list) {
    for (const f of files) console.log(f)
    return
  }
  if (!files.length) {
    console.error('没有匹配的测试文件')
    process.exit(2)
  }

  // 并行跑满（对齐 node --test 的子进程池）；--bail 时首个失败后不再启动新文件
  const results = []
  let stopped = false
  const queue = [...files]
  const limit = Math.min(files.length, Math.max(2, os.cpus().length || 2))
  async function worker() {
    while (queue.length) {
      if (stopped) return
      const f = queue.shift()
      const r = await runOne(path.join(suiteDir, f))
      r.f = f
      results.push(r)
      if (r.ok) {
        console.log(`── PASS  ${f}  (${r.counts.tests ?? '?'} tests, ${r.ms}ms)`)
      } else {
        // 失败时把完整 TAP 倒出来，让断言信息可见
        process.stdout.write(r.tap)
        console.log(`── FAIL  ${f}  (${r.counts.pass ?? 0}/${r.counts.tests ?? '?'} tests, ${r.ms}ms)`)
        if (opt.bail) stopped = true
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker))

  results.sort((a, b) => files.indexOf(a.f) - files.indexOf(b.f))
  const failed = results.filter((x) => !x.ok)
  const totalTests = results.reduce((s, x) => s + (x.counts.tests || 0), 0)
  const totalPass = results.reduce((s, x) => s + (x.counts.pass || 0), 0)
  console.log('\n========================================================')
  console.log(
    `${label}汇总：文件 ${results.length - failed.length} 过 / ${failed.length} 挂` +
    `（共 ${files.length} 个文件 / ${totalTests} 条测试，过 ${totalPass} 条）`
  )
  if (failed.length) {
    console.log('失败文件：')
    for (const x of failed) console.log(`  - ${x.f}`)
  }
  if (stopped) console.log('（--bail：首个失败后未再启动剩余文件）')
  process.exit(failed.length ? 1 : 0)
}

module.exports = { runSuite }
