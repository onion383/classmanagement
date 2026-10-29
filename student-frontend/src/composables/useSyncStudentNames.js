// 表格内联编辑中出现的「人名」，统一交给后端解析成学生身份：
//   · 正式名单里已有唯一同名 → 直接复用，不新建
//   · 没有 → 建一条「临时学生」（is_provisional=1），与正式学生共用同一套 id
//   · 正式名单里本来就有多个同名 → 后端返回候选，不新建（避免多出一条临时学生）
//
// 关键：不要在这里逐个 POST /students。两处同时输入同一个名字时，各自都会看到
// 「本地列表里没有」，于是各建一条；后端 resolve 在一个事务里按姓名查/建，
// 配合临时学生姓名的部分唯一索引，结果只可能指向同一个人。
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

// 把一批名字中「本地列表还不认识」的交给后端解析/建档，然后刷新列表与通知
export async function syncStudentNames(namesArr, scope = {}) {
  const { getKnown = () => [], refresh = async () => {}, notify = () => {} } = scope
  try {
    const names = new Set((namesArr || []).map(n => String(n || '').trim()).filter(Boolean))
    if (!names.size) return
    const known = new Set(getKnown().map(s => String(s.姓名 || '').trim()).filter(Boolean))
    const newcomers = [...names].filter(n => n && !known.has(n))
    if (!newcomers.length) return

    const res = await axios.post(`${API_BASE}/students/resolve`, { names: newcomers })
    const results = (res.data && res.data.results) || []
    // 解析结果可能包含新建的临时学生，刷新后候选框/名册立刻能看到它们
    await refresh()

    const created = results.filter(r => r && r.created).map(r => r.name)
    if (created.length) notify(`「${created.join('、')}」已记为临时学生`)
    // 重名（正式名单里有多个同名）不新建也不打扰用户：名字本来就在，后续按 id 选择即可
    results.filter(r => r && r.error).forEach(r => console.error('[student-sync]', r.name, r.error))
  } catch (e) { console.error(e) }
}

// 表格内联编辑中出现的「人名」，自动同步到学生管理。供值日、座位表等视图复用。
export async function syncStudentNamesFromRows(rows, scope = {}) {
  await syncStudentNames(extractNamesFromRows(rows), scope)
}
