// =========================================================================
// 通用「表格」导出模块
//   把纯二维数据（columns 表头 + rows 行数据，均为可转字符串的值）导出为 8 种格式之一。
//   供「数据管理」页的「导出聊天记录 / 导出 Markdown 文件」弹窗复用，
//   与 ExportExcel.vue（面向课表/座位等带特殊行语义的表格）相互独立、互不影响。
// =========================================================================
import { INVOKE } from '../electronChannels.js'
import { loadPdfFontBase64, collectPdfText } from '../utils/pdfFont.js'
import { sanitizeFileName } from '../utils/fileName.js'
import { csvCell } from '../utils/csvCell.js'
import { toRaw } from 'vue'

// 保存文件：Electron 下弹系统保存对话框，用户确认后才写入；浏览器则直接下载
export async function saveFileWithDialog(defaultName, blob) {
  // 文件名来自用户输入，落盘前统一清洗（非法字符 / 末尾点空格 / 超长），
  // 这里是所有导出格式的唯一出口，改这一处即可覆盖全部调用方
  const safeName = sanitizeFileName(defaultName)
  if (window.electron && typeof window.electron.invoke === 'function') {
    const arrayBuffer = await blob.arrayBuffer()
    const result = await window.electron.invoke(INVOKE.SAVE_FILE, { defaultName: safeName, data: arrayBuffer })
    if (result && !result.canceled && result.filePath) {
      // 保存成功后用系统默认应用打开文件
      window.electron.invoke(INVOKE.OPEN_FILE, { filePath: result.filePath }).catch(() => {})
    }
    return !!result && !result.canceled
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeName
  a.click()
  URL.revokeObjectURL(url)
  return true
}

// 与 ExportExcel 保持同一套格式清单与文案（观感一致）
export const FORMAT_OPTIONS = [
  { value: 'html', label: 'HTML 表格 (.html)' },
  { value: 'xlsx', label: 'Excel (.xlsx) - 带边框' },
  { value: 'csv', label: 'CSV (.csv) - 无样式' },
  { value: 'md', label: 'Markdown 文档 (.md)' },
  { value: 'txt', label: '纯文本 (.txt)' },
  { value: 'json', label: 'JSON 数据 (.json)' },
  { value: 'image', label: '图片 (.png)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
]
export const FORMAT_LABELS = {
  html: 'HTML 表格 (.html)', xlsx: 'Excel 表格 (.xlsx)', csv: '表格 (.csv)',
  md: 'Markdown 文档 (.md)', txt: '纯文本 (.txt)', json: 'JSON 数据 (.json)',
  image: 'PNG 图片 (.png)', pdf: 'PDF 文档 (.pdf)',
}

const s = (v) => String(v == null ? '' : v)
function escapeHtml(str) {
  return s(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}
const mdEscape = (v) => s(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')

// 规整输入：把 columns / rows 统一成字符串二维数组
function normalize(columns, rows) {
  const cols = (Array.isArray(columns) ? columns : []).map(s)
  const body = (Array.isArray(rows) ? rows : []).map((r) => {
    const arr = Array.isArray(r) ? r : [r]
    return cols.map((_, i) => s(arr[i]))
  })
  return { cols, body }
}

// 内联 HTML 片段（用于图片渲染，无 <html>/<body> 外壳）
function buildHtmlFragment(cols, body, title) {
  let html = `<div style="text-align:center; font-size:20px; font-weight:bold; margin-bottom:12px;">${escapeHtml(title)}</div>`
    + '<table style="border-collapse:collapse; margin:0 auto;"><thead><tr style="background-color:#4CAF50; color:white;">'
    + cols.map((h) => `<th style="border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle;">${escapeHtml(h)}</th>`).join('')
    + '</tr></thead><tbody>'
  for (const row of body) {
    html += '<tr>' + cols.map((_, i) => `<td style="border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle;">${escapeHtml(row[i])}</td>`).join('') + '</tr>'
  }
  html += '</tbody></table>'
  return html
}

async function exportXLSX(cols, body, name, title) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  const titleRow = ws.addRow([title])
  ws.mergeCells(1, 1, 1, Math.max(cols.length, 1))
  titleRow.height = 24
  titleRow.eachCell((c) => {
    c.font = { bold: true, size: 14, color: { argb: 'FF000000' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }
  })
  const headRow = ws.addRow(cols)
  headRow.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }
  })
  for (const row of body) {
    const dr = ws.addRow(row)
    dr.eachCell((c) => {
      c.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
      c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }
    })
  }
  // 列宽：按内容最长字符数（中文按 2.2 宽）估算
  for (let i = 1; i <= cols.length; i++) {
    let maxLen = cols[i - 1].length
    body.forEach((row) => {
      let len = 0
      for (const ch of s(row[i - 1])) len += /[\u4e00-\u9fa5]/.test(ch) ? 2.2 : 1
      if (len > maxLen) maxLen = len
    })
    ws.getColumn(i).width = Math.max(12, Math.min(maxLen + 6, 60))
  }
  const buf = await wb.xlsx.writeBuffer()
  return saveFileWithDialog(`${name}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}

async function exportHTML(cols, body, name, title) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(name)}</title></head><body>
    <h2 style="text-align:center;">${escapeHtml(title)}</h2>
    <table border="2" style="border-collapse:collapse; border-color:black;">
      <thead><tr>${cols.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${body.map((row) => '<tr>' + row.map((c) => `<td style="text-align:left; vertical-align:top;">${escapeHtml(c)}</td>`).join('') + '</tr>').join('')}</tbody>
    </table></body></html>`
  return saveFileWithDialog(`${name}.html`, new Blob([html], { type: 'text/html' }))
}

async function exportCSV(cols, body, name) {
  const csv = '\uFEFF' + [cols, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n')
  return saveFileWithDialog(`${name}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
}

async function exportMD(cols, body, name) {
  const line = (cells) => `| ${cells.map(mdEscape).join(' | ')} |`
  const md = [`# ${mdEscape(name)}`, '', line(cols), `| ${cols.map(() => '---').join(' | ')} |`, ...body.map(line)].join('\n') + '\n'
  return saveFileWithDialog(`${name}.md`, new Blob([md], { type: 'text/markdown;charset=utf-8;' }))
}

async function exportTXT(cols, body, name) {
  const line = (cells) => cells.map((c) => s(c).replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t')
  const txt = [line(cols), ...body.map(line)].join('\r\n') + '\r\n'
  return saveFileWithDialog(`${name}.txt`, new Blob([txt], { type: 'text/plain;charset=utf-8;' }))
}

async function exportJSON(cols, body, name) {
  const data = body.map((row) => { const o = {}; cols.forEach((h, i) => { o[h] = row[i] == null ? '' : row[i] }); return o })
  return saveFileWithDialog(`${name}.json`, new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json;charset=utf-8;' }))
}

async function exportImage(cols, body, name, title) {
  const { default: html2canvas } = await import('html2canvas')
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = buildHtmlFragment(cols, body, title)
  tempDiv.style.cssText = 'position:absolute; left:-9999px; top:0; padding:24px; background:#ffffff;'
  document.body.appendChild(tempDiv)
  try {
    const canvas = await html2canvas(tempDiv, { scale: 2, backgroundColor: '#ffffff' })
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return false
    return await saveFileWithDialog(`${name}.png`, blob)
  } finally { document.body.removeChild(tempDiv) }
}

async function exportPDF(cols, body, name, title) {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  let fontLoaded = false
  try {
    // 字体按「本次实际要画的字符」现做子集（十几 KB）再嵌入，不再整份塞 13MB 全量字体。
    // 加载链路（gzip 魔数判断）与「子集失败退回全量」的兜底见 utils/pdfFont.js。
    // toRaw：入参可能来自响应式状态，逐属性读代理比读原始对象慢得多（见 pdfFont.js 的说明）。
    const fontBase64 = await loadPdfFontBase64(collectPdfText(title, name, toRaw(cols), toRaw(body)))
    doc.addFileToVFS('NotoSansSC.ttf', fontBase64)
    doc.addFont('NotoSansSC.ttf', 'NotoSansSC', 'normal')
    doc.addFont('NotoSansSC.ttf', 'NotoSansSC', 'bold')
    fontLoaded = true
  } catch (e) { console.warn('中文字体加载失败:', e) }
  const pdfFont = fontLoaded ? 'NotoSansSC' : 'helvetica'
  doc.setFontSize(16)
  doc.setFont(pdfFont, 'normal')
  doc.text(title, doc.internal.pageSize.getWidth() / 2, 15, { align: 'center' })
  autoTable(doc, {
    startY: 22,
    head: [cols],
    body,
    theme: 'grid',
    styles: { font: pdfFont, fontStyle: 'normal', fontSize: 9, cellPadding: 1.5, halign: 'left', valign: 'middle' },
    headStyles: { font: pdfFont, fontStyle: 'normal', fillColor: [76, 175, 80], textColor: 255, halign: 'center' },
  })
  return saveFileWithDialog(`${name}.pdf`, doc.output('blob'))
}

// 按格式导出二维数据；返回是否成功保存（用户取消返回 false，不视为失败）
export async function runTableExport({ format, columns, rows, filename, title }) {
  const { cols, body } = normalize(columns, rows)
  if (!cols.length) return false
  const name = filename || '导出数据'
  const head = title || name
  switch (format) {
    case 'xlsx': return exportXLSX(cols, body, name, head)
    case 'csv': return exportCSV(cols, body, name)
    case 'md': return exportMD(cols, body, name)
    case 'txt': return exportTXT(cols, body, name)
    case 'json': return exportJSON(cols, body, name)
    case 'image': return exportImage(cols, body, name, head)
    case 'pdf': return exportPDF(cols, body, name, head)
    case 'html':
    default: return exportHTML(cols, body, name, head)
  }
}
