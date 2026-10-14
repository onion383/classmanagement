// 前端日期格式化公共工具：多处对话框/页面需要把 Date 转换成
// datetime-local 输入值（YYYY-MM-DDTHH:mm）、存储展示值（YYYY-MM-DD HH:mm）或仅日期（YYYY-MM-DD）。
// 这些逻辑此前在每个文件里各自复制了一份 pad 补零代码，这里统一收敛。
export function pad2(n) {
  return String(n).padStart(2, '0')
}

// YYYY-MM-DD
export function formatDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// YYYY-MM-DD HH:mm
export function formatDateTime(d) {
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// datetime-local 输入框值：YYYY-MM-DDTHH:mm
export function formatDateTimeLocal(d) {
  return `${formatDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// 某天所在周的周一（与后端 mondayOf 同口径：一周从周一开始），入参出参均为 YYYY-MM-DD
export function mondayOf(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`)
  if (isNaN(d.getTime())) return ''
  const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  return formatDate(d)
}

// 日期字符串按天偏移：YYYY-MM-DD -> YYYY-MM-DD
export function shiftDateStr(dateStr, days) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`)
  if (isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + days)
  return formatDate(d)
}

// 两个日期字符串相差的天数（to - from，按自然日算）
export function diffDays(from, to) {
  const a = new Date(`${String(from).slice(0, 10)}T00:00:00`)
  const b = new Date(`${String(to).slice(0, 10)}T00:00:00`)
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0
  return Math.round((b - a) / 86400000)
}