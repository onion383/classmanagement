import axios from 'axios'
import { useNotification } from '../useNotification.js'
import { INVOKE } from '../../electronChannels.js'

export function readAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.readAsDataURL(file)
  })
}

export function readAsText(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.readAsText(file)
  })
}

export async function uploadAndParse(file) {
  const form = new FormData()
  form.append('file', file)
  try {
    const { data } = await axios.post('/api/ai/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    if (data.success) return data.data
    return { text: `文件名：${file.name}\n\n错误：${data.error || '解析失败'}` }
  } catch (err) {
    // 后端拒绝上传（类型/大小）时会带回具体的中文原因，优先展示
    const msg = err.response?.data?.error || err.message || '上传失败'
    return { text: `文件名：${file.name}\n\n错误：${msg}` }
  }
}

// 读取文件提取文本内容
export async function readFile(file) {
  const name = file.name
  const ext = name.split('.').pop().toLowerCase()
  const sizeLabel = file.size > 1048576
    ? (file.size / 1048576).toFixed(1) + ' MB'
    : (file.size / 1024).toFixed(0) + ' KB'

  // 图片：保持 data URL，用于 vision API
  if (file.type.startsWith('image/')) {
    const dataUrl = await readAsDataURL(file)
    return { name, isImage: true, dataUrl, textContent: '', sizeLabel }
  }

  // 文本类文件：直接在前端读取
  const textExts = ['txt', 'csv', 'md', 'json', 'xml', 'html', 'htm', 'js', 'py', 'rb', 'php', 'java', 'ts', 'tsx', 'jsx', 'css', 'scss', 'less', 'yaml', 'yml', 'log', 'sh', 'bat', 'env', 'ini', 'cfg', 'conf', 'sql', 'r', 'go', 'rs', 'swift', 'kt', 'toml']
  if (textExts.includes(ext)) {
    const text = await readAsText(file)
    const truncated = text.length > 100000 ? text.slice(0, 100000) + '\n\n...（文件太长，已截断）' : text
    return { name, isImage: false, dataUrl: '', textContent: truncated, sizeLabel }
  }

  // PDF / Excel / Word：上传到后端解析
  const result = await uploadAndParse(file)
  return { name, isImage: false, dataUrl: '', textContent: result.text, sizeLabel }
}

// ===== AI 导出文件：由 export_file 工具下发规格，前端生成字节并弹系统保存对话框 =====
// 保存走 Electron 的 save-file 通道（浏览器环境退回直接下载）
export async function saveExportWithDialog(defaultName, blob) {
  if (window.electron && typeof window.electron.invoke === 'function') {
    const arrayBuffer = await blob.arrayBuffer()
    const result = await window.electron.invoke(INVOKE.SAVE_FILE, { defaultName, data: arrayBuffer })
    if (result && !result.canceled && result.filePath) {
      // 保存成功后用系统默认应用打开文件
      window.electron.invoke(INVOKE.OPEN_FILE, { filePath: result.filePath }).catch(() => {})
    }
    return result && !result.canceled ? result.filePath : ''
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = defaultName
  a.click()
  URL.revokeObjectURL(url)
  return defaultName
}

// 按规格生成文件并保存：xlsx 用 ExcelJS，其余为纯文本序列化
export async function saveAiExport(spec) {
  const { success: notify, error: notifyError } = useNotification()
  if (!spec || !Array.isArray(spec.columns) || !spec.columns.length) return
  const { format, filename, columns, title } = spec
  const name = filename || 'AI导出'
  const dataRows = Array.isArray(spec.rows) ? spec.rows : []
  try {
    let blob
    let ext = format
    if (format === 'xlsx') {
      const { default: ExcelJS } = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Sheet1')
      if (title) {
        const tRow = ws.addRow([title])
        ws.mergeCells(1, 1, 1, columns.length)
        tRow.font = { bold: true, size: 14 }
        tRow.alignment = { horizontal: 'center', vertical: 'middle' }
        tRow.height = 22
      }
      const headRow = ws.addRow(columns)
      headRow.eachCell((c) => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4CAF50' } }
        c.alignment = { horizontal: 'center', vertical: 'middle' }
        c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }
      })
      dataRows.forEach((row) => {
        const dr = ws.addRow(row)
        dr.eachCell((c) => {
          c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }
        })
      })
      for (let i = 1; i <= columns.length; i++) ws.getColumn(i).width = 18
      const buf = await wb.xlsx.writeBuffer()
      blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    } else if (format === 'csv') {
      const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
      const csv = '\uFEFF' + [columns, ...dataRows].map((row) => row.map(esc).join(',')).join('\r\n')
      blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    } else if (format === 'md') {
      const esc = (v) => String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
      const line = (cells) => `| ${cells.map(esc).join(' | ')} |`
      const md = [`# ${esc(title || name)}`, '', line(columns), `| ${columns.map(() => '---').join(' | ')} |`, ...dataRows.map(line)].join('\n') + '\n'
      blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' })
    } else if (format === 'json') {
      const obj = dataRows.map((row) => { const o = {}; columns.forEach((c, i) => { o[c] = row[i] == null ? '' : row[i] }); return o })
      blob = new Blob([JSON.stringify(obj, null, 2) + '\n'], { type: 'application/json;charset=utf-8;' })
    } else {
      ext = 'txt'
      const line = (cells) => cells.map((c) => String(c == null ? '' : c).replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t')
      blob = new Blob([line(columns) + '\r\n' + dataRows.map(line).join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8;' })
    }
    const savedPath = await saveExportWithDialog(`${name}.${ext}`, blob)
    if (savedPath) notify(`已导出文件：${name}.${ext}`)
  } catch (err) {
    notifyError('导出失败：' + (err.message || '未知错误'))
  }
}

// ===== AI 导出图片：由 export_image 工具下发规格，前端用 html2canvas 渲染成 PNG =====
// 规格 items 内每项含 title + columns + rows（行是字符串数组），可多项纵向堆叠为一张图
export async function saveAiImage(spec) {
  const { success: notify, error: notifyError } = useNotification()
  if (!spec || !Array.isArray(spec.items) || !spec.items.length) return
  const esc = (str) => {
    const s = str == null ? '' : String(str)
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
  }
  const cellStyle = 'border:1px solid #ccc; padding:6px 12px; text-align:center; vertical-align:middle;'
  const blocks = []
  for (const it of spec.items) {
    const columns = Array.isArray(it.columns) ? it.columns : []
    const rows = Array.isArray(it.rows) ? it.rows : []
    let html = `<div style="text-align:center; font-size:20px; font-weight:bold; margin:16px 0 12px;">${esc(it.title || '')}</div>`
    html += '<table style="border-collapse:collapse; margin:0 auto;">'
    if (columns.length) {
      html += '<thead><tr style="background-color:#4CAF50; color:white;">'
        + columns.map((h) => `<th style="${cellStyle}">${esc(h)}</th>`).join('') + '</tr></thead>'
    }
    html += '<tbody>'
    if (it.headnote) {
      html += `<tr><td colspan="${Math.max(columns.length, 1)}" style="${cellStyle} font-weight:bold; background-color:#FFF9C4;">${esc(it.headnote)}</td></tr>`
    }
    for (const row of rows) {
      const cells = Array.isArray(row) ? row : columns.map((c) => row[c])
      html += '<tr>' + cells.map((v) => `<td style="${cellStyle}">${esc(v)}</td>`).join('') + '</tr>'
    }
    html += '</tbody></table>'
    blocks.push(html)
  }
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:absolute; left:-9999px; top:0; padding:24px; background:#ffffff;'
  wrap.innerHTML = blocks.join('<div style="height:24px;"></div>')
  document.body.appendChild(wrap)
  try {
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: '#ffffff' })
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('生成图片失败')
    const name = spec.filename || 'AI导出'
    const savedPath = await saveExportWithDialog(`${name}.png`, blob)
    if (savedPath) notify(`已导出图片：${name}.png`)
  } catch (err) {
    notifyError('导出图片失败：' + (err.message || '未知错误'))
  } finally {
    document.body.removeChild(wrap)
  }
}

// 流结束后触发一次（每个导出规格只处理一次）
export function triggerPendingExport(m) {
  const ef = m && m.exportFile
  if (!ef || ef.handled) return
  ef.handled = true
  saveAiExport(ef)
}

// 图片导出规格同样只处理一次
export function triggerPendingImage(m) {
  const ei = m && m.exportImage
  if (!ei || ei.handled) return
  ei.handled = true
  saveAiImage(ei)
}
