import { safe, applyAuthHeader, encryptBody, decryptBody, resetAuthBinding } from '../composables/secureChannel'
import { decodeJwtPayload } from './jwt'

// 生产模式打包后以 file:// 协议运行，/api/... 会被解析到磁盘根目录导致 404（ERR_FILE_NOT_FOUND）。
// 因此 img / CSS 背景里直接拼 API 路径的地方，需显式补上完整后端地址；开发模式走 Vite 代理，保持相对路径即可。
export function apiUrl(path) {
  if (!path) return ''
  if (/^https?:\/\//.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path
  const base = import.meta.env.PROD ? 'http://localhost:3000' : ''
  return base + path
}

// 带鉴权的 fetch 封装：打包版渲染层为 app:// 协议，相对路径会被解析到该协议（拿不到后端），
// 且跨源请求默认不带 cookie，故统一补全后端地址并附带信道凭据。
// 供各窗口里绕过 axios 的裸 fetch（流式响应、二进制导入等）使用。
// 安全模式下凭据是 X-Auth-Proof 密文头；绑定失效时后端置 X-Auth-Required，这里带 token 重试一次。
export async function apiFetch(path, options = {}) {
  const send = async (forceToken) => {
    const headers = { ...(options.headers || {}) }
    let body = options.body
    const token = localStorage.getItem('token')
    if (token) await applyAuthHeader(headers, token, { forceToken })
    // JSON 请求体同样走会话加密（调用方已加密的 { session, d } 信封原样透传，避免二次封装）
    if (safe() && typeof body === 'string' && /application\/json/i.test(String(headers['Content-Type'] || ''))) {
      try {
        const parsed = JSON.parse(body)
        const already = parsed && typeof parsed.session === 'string' && typeof parsed.d === 'string'
        if (!already) body = JSON.stringify(await encryptBody(parsed))
      } catch (_) { /* 非 JSON 或加密失败：按明文发送，后端透明兼容 */ }
    }
    return fetch(apiUrl(path), { ...options, headers, body })
  }

  let res = await send(false)
  if (res.status === 401 && res.headers.get('x-auth-required') === '1') {
    resetAuthBinding()
    res = await send(true)
  }

  // 滑动续期：后端在 token 快到期时随响应下发新凭据（流式接口也是从响应头取）
  const renewed = res.headers.get('x-renewed-token')
  if (renewed) {
    try { localStorage.setItem('token', renewed) } catch (_) {}
  }
  const renewedMedia = res.headers.get('x-renewed-media')
  if (renewedMedia) storeMediaToken(renewedMedia)

  // 携带密文凭据的请求，后端会把 JSON 响应包成 { d }；调用方仍是 r.json()，在这里透明解密。
  // 二进制/SSE 响应不受影响（后端只包装 res.json）。
  if (safe() && String(res.headers.get('content-type') || '').includes('application/json')) {
    const origJson = res.json.bind(res)
    res.json = async () => {
      const data = await origJson()
      if (data && typeof data === 'object' && typeof data.d === 'string') {
        try { return await decryptBody(data.d) } catch (_) { return data }
      }
      return data
    }
  }
  return res
}

// ---------------------------------------------------------------------------
// 媒体凭据：<img> / CSS url() 无法携带自定义头，只能把凭据放进查询串。
// 安全模式下不再把登录 JWT 放进 URL（URL 会进 Referer/历史/日志），改用 scope=media 的
// 受限凭据：能取图、不能调业务 API，登出吊销 sid 后一并失效。
const MEDIA_KEY = 'mediaToken'

export function storeMediaToken(token) {
  if (!token || typeof token !== 'string') return
  try { localStorage.setItem(MEDIA_KEY, token) } catch (_) {}
}

export function clearMediaToken() {
  try { localStorage.removeItem(MEDIA_KEY) } catch (_) {}
}

// 读 JWT 的 exp（毫秒）；解析失败返回 0，视为已过期。
// base64url 的解码细节统一在 utils/jwt.js（直接 atob 遇到 `-`/`_` 会抛错）。
function jwtExp(token) {
  const payload = decodeJwtPayload(token)
  return payload && typeof payload.exp === 'number' ? payload.exp * 1000 : 0
}

let mediaRefresh = null
// 取一份新的媒体凭据：登录 token 仍有效即可，不必让用户重新登录。
// 并发调用共享同一个请求，避免首屏多个组件各自刷一次。
export function refreshMediaToken() {
  if (mediaRefresh) return mediaRefresh
  mediaRefresh = (async () => {
    const token = localStorage.getItem('token')
    if (!token || !safe()) return null
    try {
      const headers = {}
      await applyAuthHeader(headers, token, { forceToken: false })
      const res = await fetch(apiUrl('/api/auth/media-token'), { headers })
      if (!res.ok) return null
      let data = await res.json()
      if (data && typeof data === 'object' && typeof data.d === 'string') {
        data = await decryptBody(data.d)
      }
      if (data && data.mediaToken) {
        storeMediaToken(data.mediaToken)
        return data.mediaToken
      }
    } catch (_) { /* 刷新失败：沿用旧凭据，下次启动/登录再试 */ }
    return null
  })().finally(() => { mediaRefresh = null })
  return mediaRefresh
}

// 确保持有可用的媒体凭据（缺失或即将过期时才发起刷新）
export async function ensureMediaToken() {
  const token = localStorage.getItem('token')
  if (!token) return null
  const cur = localStorage.getItem(MEDIA_KEY)
  if (cur && jwtExp(cur) > Date.now() + 60 * 1000) return cur
  return refreshMediaToken()
}

// 资源 URL：<img> / CSS url() 等请求无法携带 Authorization 头，且打包版页面为 file:// 协议，
// 跨源也不会自动带上 Lax Cookie，故把凭据追加为查询参数。
// data:/blob: 无需鉴权，直接返回；安全模式用受限媒体凭据，明文模式沿用登录 token。
export function resourceUrl(path) {
  if (!path) return ''
  if (path.startsWith('data:') || path.startsWith('blob:')) return path
  const url = apiUrl(path)
  if (!url) return ''
  const token = safe()
    ? localStorage.getItem(MEDIA_KEY)
    : localStorage.getItem('token')
  if (!token) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(token)}`
}
