// 表格内联编辑中出现的「人名」，若不在学生管理中，自动新增到学生（仅姓名，其余字段留空）。
// 供值日、座位表等「在表格里输入人名」的视图复用，避免两处重复实现。
import axios from 'axios'

const API_BASE = '/api'

// 从多行子行表格(rows)中提取所有姓名（跳过占位/走廊等特殊格）
export function extractNamesFromRows(rows = []) {
  const names = new Set()
  rows.forEach(r => {
    if (r && Array.isArray(r.cells)) r.cells.forEach(c => {
      if (c && !c._isAisle) {
        const n = String(c.course || '').trim()
        if (n) names.add(n)
      }
    })
  })
  return names
}

// 把一批名字中不在学生管理里的，新增到学生（仅姓名，其余字段留空），并刷新列表与通知
export async function syncStudentNames(namesArr, scope = {}) {
  const { getKnown = () => [], refresh = async () => {}, notify = () => {} } = scope
  try {
    const names = new Set((namesArr || []).map(n => String(n || '').trim()).filter(Boolean))
    if (!names.size) return
    const known = new Set(getKnown().map(s => String(s.姓名 || '').trim()).filter(Boolean))
    const newcomers = [...names].filter(n => n && !known.has(n))
    if (!newcomers.length) return
    for (const n of newcomers) {
      try { await axios.post(`${API_BASE}/students`, { 姓名: n }) } catch (e) { console.error(e) }
    }
    await refresh()
    if (newcomers.length) notify(`「${newcomers.join('、')}」已新增到学生管理`)
  } catch (e) { console.error(e) }
}

// 表格内联编辑中出现的「人名」，自动同步到学生管理。供值日、座位表等视图复用。
export async function syncStudentNamesFromRows(rows, scope = {}) {
  await syncStudentNames(extractNamesFromRows(rows), scope)
}