// =========================================================================
// startup-timer.js —— 启动事件计时器
//
// 在 Electron 主进程中记录关键启动事件的时间戳，输出到控制台和日志文件。
// 用于量化启动优化效果，定位瓶颈。
//
// 用法：
//   const timer = require('./startup-timer')
//   timer.mark('事件名称')
//   timer.report()  // 打印完整时间线
// =========================================================================

const path = require('path')
const fs = require('fs')

const marks = []
const startTime = Date.now()
const startHR = process.hrtime.bigint()

function mark(name) {
  const now = Date.now()
  const elapsed = now - startTime
  marks.push({ name, time: now, elapsed })
  // 同时输出到控制台，方便实时观察
  console.log(`[startup] +${elapsed}ms  ${name}`)
}

function msFromStart() {
  return Date.now() - startTime
}

// 结构化时间线：供性能面板读取（不改动原有 report/saveLog 的日志输出格式）。
// 返回 { total, marks: [{ label, at, delta }] }，at/delta 单位均为毫秒。
function getTimeline() {
  const list = marks.map((m, i) => ({
    label: m.name,
    at: m.elapsed,
    delta: i === 0 ? 0 : m.elapsed - marks[i - 1].elapsed,
  }))
  const total = marks.length > 0 ? marks[marks.length - 1].elapsed : 0
  return { total, marks: list }
}

function report() {
  console.log('\n========== 启动时间线 ==========')
  if (marks.length === 0) {
    console.log('  （无事件记录）')
    console.log('=================================\n')
    return
  }
  const first = marks[0]
  for (const m of marks) {
    const gap = m === first ? 0 : m.elapsed - (marks[marks.indexOf(m) - 1]?.elapsed || 0)
    console.log(`  +${String(m.elapsed).padStart(5)}ms  ${m.name}  (间隔 ${gap}ms)`)
  }
  const last = marks[marks.length - 1]
  console.log(`  总耗时: ${last.elapsed}ms`)
  console.log('=================================\n')
}

// 写入日志文件（可选）
function saveLog(filePath) {
  if (!filePath) {
    try {
      const { app } = require('electron')
      filePath = path.join(app.getPath('userData'), 'data', 'startup.log')
    } catch (_) {
      return
    }
  }
  try {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const lines = marks.map((m, i) => {
      const gap = i === 0 ? 0 : m.elapsed - marks[i - 1].elapsed
      return `+${String(m.elapsed).padStart(5)}ms  ${m.name}  (间隔 ${gap}ms)`
    })
    const total = marks.length > 0 ? marks[marks.length - 1].elapsed : 0
    const content = [
      `===== 启动时间线 @ ${new Date().toISOString()} =====`,
      ...lines,
      `总耗时: ${total}ms`,
      '',
    ].join('\n')
    fs.appendFileSync(filePath, content)
  } catch (_) { /* 忽略写入失败 */ }
}

module.exports = { mark, msFromStart, report, saveLog, getTimeline }