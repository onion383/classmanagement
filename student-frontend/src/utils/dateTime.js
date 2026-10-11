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