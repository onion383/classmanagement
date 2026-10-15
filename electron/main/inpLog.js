// =========================================================================
// inpLog.js —— INP 归因落盘（仅开发模式）
//
// 渲染层的 INP 探针（student-frontend/src/utils/inpProbe.js）每次导出汇总时，
// 把数据经 'inp-report' 通道发到这里，本模块追加写入 <数据目录>/inp.log，
// 便于不开 DevTools 也能直接读文件分析。
//
// payload 结构（两段）：
//   { reason, categories: [...], details: [...] }
//   categories —— 按交互类别聚合（切换页面 / 打开弹窗 / 确认保存 / 表格输入 …）
//   details    —— 最慢交互明细 Top N
//   两者行格式一致：{ <首列键>, 次数, 最长, 输入延迟, 处理, 呈现, 典型 }
//
// 与启动打点同一套 dev 门控：仅在开发模式注册（调用点用 !app.isPackaged 判定），
// 打包版既不 require 本模块、也不注册该通道，不会产生任何日志文件。
// =========================================================================

const { ipcMain, app } = require('electron')
const fs = require('fs')
const path = require('path')
const { resolveDataDir } = require('./config')

// 把行数组格式化成日志行；keyName 为「类别」或「交互」
function formatRows(rows, keyName) {
  return rows.map((r) => {
    const parts = [
      `${r[keyName]}`,
      `次数=${r.次数}`,
      `最长=${r.最长}ms（输入延迟=${r.输入延迟} / 处理=${r.处理} / 呈现=${r.呈现}）`,
    ]
    // 明细行的首列本身已是「事件 → 元素」，再附「典型」就重复了
    if (keyName === '类别' && r.典型) parts.push(`典型=${r.典型}`)
    return parts.join('  ')
  })
}

function registerInpLogIpc() {
  if (app.isPackaged) return // 打包版：不注册，永不落盘
  ipcMain.on('inp-report', (_event, payload) => {
    try {
      const p = payload || {}
      const categories = Array.isArray(p.categories) ? p.categories : []
      const details = Array.isArray(p.details) ? p.details : []

      const lines = [`===== INP 归因 @ ${new Date().toISOString()}（${p.reason || ''}，单位 ms）=====`]
      if (!categories.length && !details.length) {
        lines.push('（本轮无 ≥40ms 的交互样本）')
      } else {
        if (categories.length) {
          lines.push('-- 按交互类别 --')
          lines.push(...formatRows(categories, '类别'))
        }
        if (details.length) {
          lines.push('-- 最慢交互明细 --')
          lines.push(...formatRows(details, '交互'))
        }
      }
      lines.push('')

      const file = path.join(resolveDataDir(), 'inp.log')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.appendFileSync(file, lines.join('\n'))
    } catch (_) { /* 忽略写入失败 */ }
  })
}

module.exports = { registerInpLogIpc }
