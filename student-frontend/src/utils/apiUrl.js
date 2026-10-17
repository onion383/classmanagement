// 生产模式打包后以 file:// 协议运行，/api/... 会被解析到磁盘根目录导致 404（ERR_FILE_NOT_FOUND）。
// 因此 img / CSS 背景里直接拼 API 路径的地方，需显式补上完整后端地址；开发模式走 Vite 代理，保持相对路径即可。
export function apiUrl(path) {
  if (!path) return ''
  if (/^https?:\/\//.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path
  const base = import.meta.env.PROD ? 'http://localhost:3000' : ''
  return base + path
}

// 带鉴权的 fetch 封装：打包版渲染层为 app:// 协议，相对路径会被解析到该协议（拿不到后端），
// 且跨源请求默认不带 cookie（后端鉴权中间件优先读 Authorization 头），故统一补全后端地址并附带 Token。
// 供各窗口里绕过 axios 的裸 fetch（流式响应、二进制导入等）使用。
export function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  const token = localStorage.getItem('token')
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(apiUrl(path), { ...options, headers })
}

// 资源 URL：<img> / CSS url() 等请求无法携带 Authorization 头，且打包版页面为 file:// 协议，
// 跨源也不会自动带上 Lax Cookie，故把 JWT 追加为查询参数，由后端 resolveToken 校验。
// data:/blob: 无需鉴权，直接返回；其余 URL 统一补 token。
export function resourceUrl(path) {
  if (!path) return ''
  if (path.startsWith('data:') || path.startsWith('blob:')) return path
  const url = apiUrl(path)
  if (!url) return ''
  const token = localStorage.getItem('token')
  if (!token) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(token)}`
}
