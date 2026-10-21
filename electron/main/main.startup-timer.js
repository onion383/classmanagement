// =========================================================================
// startup-timer.js —— 启动事件计时器
//
// 在 Electron 主进程中记录关键启动事件的时间戳，输出到控制台和日志文件。
// 用于量化启动优化效果，定位瓶颈。
//
// 用法：
//   const timer = require('./main.startup-timer')
//   timer.mark('事件名称')
//   timer.report()  // 打印完整时间线
// =========================================================================

const path = require('path')
const fs = require('fs')

const marks = []
const startTime = Date.now()
const startHR = process.hrtime.bigint()

// 起点校正：上面的零点只是「本计时器被 require」的时刻，而主进程 JS 此前已经跑了一段——
// 更早还隔着「Electron 进程创建 → Chromium/Node 引导 → main.js 顶层 require」。
// process.getCreationTime() 给出进程创建时刻，把这段量出来并计入总耗时；
// 取不到时保持 null，总耗时就退回旧口径（计时器加载 → 可见）。
let preStartMs = null
try {
  const createdAt = typeof process.getCreationTime === 'function' ? process.getCreationTime() : null
  if (typeof createdAt === 'number' && createdAt > 0 && createdAt <= startTime) {
    // 刻意保留原样小数：getCreationTime() 给的是微秒级精度的毫秒值（如 126.85693359375），
    // 这份精度会顺着 totalMs() 一路带到控制台与设置页性能面板（面板按秒呈现），不作截断。
    preStartMs = startTime - createdAt
  }
} catch (_) { /* 信息不可用则跳过校正 */ }

// 「启动完成」锚点：首个窗口首次显示时由 main.js 的 revealWindow() 调 end() 定死。
// 一旦设定，getTimeline().total 便固定为此刻耗时，不再被「用户在引导页停留」「引导完成后
// 才创建的窗口/小组件」「后端就绪 / 首屏数据就绪」等更晚的 mark 抬高——即口径为「纯启动耗时」，
// 只算到用户看到窗口画面的那一刻，不含交互停留与数据等待。
let endElapsed = null

function mark(name) {
  const now = Date.now()
  const elapsed = now - startTime
  marks.push({ name, time: now, elapsed })
  // 同时输出到控制台，方便实时观察
  console.log(`[startup] +${elapsed}ms  ${name}`)
}

// 用「事件真实发生时刻」打点：epochMs 为毫秒级 epoch（渲染层传 performance.timeOrigin + performance.now()）。
// 渲染层日志经 console-message 送到主进程存在几十毫秒投递延迟，按送达时刻打点会把这段延迟算进耗时；
// 由渲染层自报时刻、主进程只做搬运，即可去掉它。
// 数值越界（落在零点之前或远超本次启动）时退回送达时刻，避免脏值污染时间线。
function markAt(name, epochMs) {
  const at = Number(epochMs)
  if (!Number.isFinite(at) || at < startTime || at > startTime + 600000) return mark(name)
  const elapsed = Math.round(at - startTime)
  marks.push({ name, time: at, elapsed })
  console.log(`[startup] +${elapsed}ms  ${name}`)
}

function msFromStart() {
  return Date.now() - startTime
}

// 标记「启动完成」：首个窗口首次显示（main.js revealWindow）时调用，仅第一次生效（幂等）。
// 口径 = 进程启动 → 窗口首次显示；后端就绪、首屏数据等更晚事件不影响总耗时。
function end(name = '') {
  if (endElapsed !== null) return
  endElapsed = msFromStart()
  console.log(`[startup] +${endElapsed}ms  启动完成${name ? '：' + name : ''}`)
}

// 总耗时 = 「计时起点 → 事件」的耗时 + 「进程创建 → 计时起点」的前段（取不到前段时即为旧口径）
function totalMs() {
  const tail = endElapsed !== null
    ? endElapsed
    : (marks.length > 0 ? marks[marks.length - 1].elapsed : 0)
  return tail + (preStartMs || 0)
}

// 结构化时间线：供性能面板读取（不改动原有 report/saveLog 的日志输出格式）。
// 返回 { total, preStartMs, marks: [{ label, at, delta }] }，at/delta 单位均为毫秒。
// total 优先取「启动完成」锚点；未设定锚点（如异常路径）时回退到最后一条 mark。
// 两者都额外并入 preStartMs（进程创建 → 计时起点），与 report/saveLog 的总耗时口径一致。
function getTimeline() {
  const list = marks.map((m, i) => ({
    label: m.name,
    at: m.elapsed,
    delta: i === 0 ? 0 : m.elapsed - marks[i - 1].elapsed,
  }))
  return { total: totalMs(), preStartMs, marks: list }
}

function report() {
  console.log('\n========== 启动时间线 ==========')
  if (marks.length === 0) {
    console.log('  （无事件记录）')
    console.log('=================================\n')
    return
  }
  if (preStartMs !== null) {
    console.log(`  （零点为主进程计时器加载；Electron 进程创建更早 ${preStartMs}ms，已并入总耗时）`)
  }
  const first = marks[0]
  for (const m of marks) {
    const gap = m === first ? 0 : m.elapsed - (marks[marks.indexOf(m) - 1]?.elapsed || 0)
    console.log(`  +${String(m.elapsed).padStart(5)}ms  ${m.name}  (间隔 ${gap}ms)`)
  }
  // 总耗时口径与性能面板一致：优先取「启动完成」锚点，未设锚点时回退到最后一条 mark
  console.log(`  总耗时: ${totalMs()}ms`)
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
    // 体积兜底：这份日志每次启动都追加，正式版里也没有门控，长期用下去会无限增长。
    // 它只用于排查启动耗时，超过 512KB 就只保留最近一半（保留末尾，最新一次启动总在）。
    try {
      const st = fs.statSync(filePath)
      if (st.size > 512 * 1024) {
        const tail = fs.readFileSync(filePath, 'utf8').slice(-256 * 1024)
        fs.writeFileSync(filePath, '（历史日志已截断，仅保留最近部分）\n' + tail)
      }
    } catch (_) { /* 首次启动文件不存在，忽略 */ }
    const lines = marks.map((m, i) => {
      const gap = i === 0 ? 0 : m.elapsed - marks[i - 1].elapsed
      return `+${String(m.elapsed).padStart(5)}ms  ${m.name}  (间隔 ${gap}ms)`
    })
    const content = [
      `===== 启动时间线 @ ${new Date().toISOString()} =====`,
      preStartMs !== null ? `（进程创建 → 计时起点: ${preStartMs}ms，已并入总耗时）` : null,
      ...lines,
      `总耗时: ${totalMs()}ms`,
      '',
    ].filter((l) => l !== null).join('\n')
    fs.appendFileSync(filePath, content)
  } catch (_) { /* 忽略写入失败 */ }
}

module.exports = { mark, markAt, end, msFromStart, report, saveLog, getTimeline }