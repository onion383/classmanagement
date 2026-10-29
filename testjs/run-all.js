#!/usr/bin/env node
// run-all.js —— 全板块串跑总闸：units → behavior → smoke（冒烟最后，它最重）
//
// 用法：
//   node testjs/run-all.js          全量（含冒烟），打包前用
//   node testjs/run-all.js --fast   快测（units + behavior），每次提交用（即 npm test）
//   其余参数（--only= / --skip= / --bail）原样透传给各板块 runner
//
// 各板块打印自己的 per-file 明细与汇总；本脚本只负责串联与板块级记分。
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const args = process.argv.slice(2)
const fast = args.includes('--fast')
const passThrough = args.filter((a) => a !== '--fast')

const boards = [
  { name: '单元 units', script: 'run-units.js' },
  { name: '行为 behavior', script: 'run-behavior.js' },
]
if (!fast) boards.push({ name: '冒烟 smoke', script: 'run-smoke.cjs' })

const results = []
const t0 = Date.now()
for (const b of boards) {
  const t = Date.now()
  const r = spawnSync(process.execPath, [path.join(__dirname, b.script), ...passThrough], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  })
  results.push({ name: b.name, ok: r.status === 0, ms: Date.now() - t })
}

console.log('\n========================================================')
console.log(fast ? '板块汇总（快测）：' : '板块汇总（全量）：')
for (const x of results) {
  console.log(`  ${x.ok ? '✓' : '✗'} ${x.name.padEnd(16)} ${x.ok ? 'PASS' : 'FAIL'}  (${x.ms}ms)`)
}
console.log(`合计 ${Date.now() - t0}ms`)
process.exit(results.every((x) => x.ok) ? 0 : 1)
