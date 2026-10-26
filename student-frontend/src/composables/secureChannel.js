// 安全通道前端模块（方案 A）：与后端 services/secureChannel.js 配对的加密层。
//
// 启用方式：前置端到后端都开开关才会真正加密。
//   后端：启动时设置环境变量 SECURE_REQUIRE=1（同时主进程必会注入 SECURE_MASTER）。
//   前端：构建时 VITE_SECURE=1（或运行时 window.__SECURE_CHANNEL__=true）。
// 两者都关闭/缺一时，本模块 safe() 返回 false，axios 拦截器保持「直通」，不影响现有功能。
//
// 协议（与后端一致）：
//   - 认证锚点 K_master：经 electron IPC get-master-key 获取（主密钥只参与 HKDF，不上线）。
//   - 前向保密：每次建立会话前端生成 ephemeral P-256，与后端 ECDH 派生共享密，再 HKDF 出会话密钥。
//   - 数据面：AES-256-GCM；请求体加密为 JSON { session, d: b64(iv).b64(tag).b64(ct) }；
//     响应体为 { d: 同格式加密串 }，由后端中间件包装。

import { INVOKE } from '../electronChannels.js'

const subtle = typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : (globalThis.crypto && globalThis.crypto.subtle)
const BASE = 'http://localhost:3000'

let kMaster = null
let sessionKey = null
let sessionId = null
// 本会话是否已把登录身份绑定到后端：绑定后凭据里不再携带 token，
// 被动抓包只能拿到「不可复用」的一次性密文。
let authBound = false

export function safe() {
  if (typeof window !== 'undefined' && window.__SECURE_CHANNEL__ === true) return true
  return import.meta.env && import.meta.env.VITE_SECURE === '1'
}

async function getMasterKey() {
  if (kMaster) return kMaster
  const e = typeof window !== 'undefined' && window.electron
  if (e && typeof e.invoke === 'function') {
    kMaster = await e.invoke(INVOKE.GET_MASTER_KEY)
  } else if (import.meta.env && import.meta.env.VITE_SECURE_MASTER) {
    kMaster = import.meta.env.VITE_SECURE_MASTER
  }
  if (!kMaster || !/^[0-9a-f]{64}$/.test(String(kMaster))) return null
  return kMaster
}

// --- 信道凭据（X-Auth-Proof）---
// 把 { token?, ts, n } 用会话密钥加密后放进请求头：被动抓包只看到密文，
// 且 ts+nonce 让密文无法重放。会话已绑定身份后不再携带 token（只发 ts/n）。
function randomNonce() {
  const b = new Uint8Array(12)
  crypto.getRandomValues(b)
  return b64(b)
}

async function encryptAuthProof(token) {
  const { sessionId: sid, sessionKey: key } = await ensureSession()
  const payload = { ts: Date.now(), n: randomNonce() }
  if (token) payload.token = token
  const iv = new Uint8Array(12); crypto.getRandomValues(iv)
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(JSON.stringify(payload))))
  const tag = ct.subarray(ct.length - 16)
  const body = ct.subarray(0, ct.length - 16)
  return [sid, b64(iv), b64(tag), b64(body)].join('.')
}

// 会话身份绑定状态：首次带 token 的请求成功后置位；后端回 auth-required 时清除。
// （原先还导出了 isAuthBound()，全项目无人调用，已移除；状态本身仍由下面两个函数维护）
export function markAuthBound() { authBound = true }
export function resetAuthBinding() { authBound = false }

// 把登录凭据写进请求头，返回「本次是否携带了登录 token」：
//   安全模式 → X-Auth-Proof 密文凭据（已绑定且未强制时凭据内不含 token）
//   明文模式 → Authorization: Bearer（兼容未启用安全通道的环境）
// forceToken：绑定失效后重试时必须带 token 重新建立绑定。
export async function applyAuthHeader(headers, token, { forceToken = false } = {}) {
  const h = headers || {}
  delete h.Authorization
  delete h['X-Auth-Proof']
  if (!token) return false
  if (safe()) {
    try {
      const withToken = forceToken || !authBound
      h['X-Auth-Proof'] = await encryptAuthProof(withToken ? token : '')
      return withToken
    } catch (_) {
      // 握手异常时退化为明文头：后端会以 auth-required 拒绝并触发一次重建会话的重试
      h.Authorization = `Bearer ${token}`
      return true
    }
  }
  h.Authorization = `Bearer ${token}`
  return true
}


function b64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return typeof btoa === 'function' ? btoa(s) : s
}
function unb64(str) {
  const s = typeof atob === 'function' ? atob(str) : str
  const u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i)
  return u
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}
const utf8 = (s) => new TextEncoder().encode(s)

// 协商会话：若已有会话密钥则直接返回。
// 并发请求共用同一个握手 promise：否则首屏并发请求各自握手会互相覆盖会话，
// 导致「请求体用一个会话、凭据用另一个会话」的不一致。
let pendingSession = null
async function ensureSession() {
  if (sessionKey) return { sessionId, sessionKey }
  if (pendingSession) return pendingSession
  pendingSession = (async () => {
    const master = await getMasterKey()
    if (!master) throw new Error('secure channel: no master key')

    // 前端 ephemeral P-256
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const pub = b64(new Uint8Array(await subtle.exportKey('raw', kp.publicKey)))

    // 裸握手（握手不能加密，用 fetch 避免触发 axios 拦截器）
    const resp = await fetch(BASE + '/api/secure/handshake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pub }),
    })
    if (!resp.ok) throw new Error('secure channel: handshake failed ' + resp.status)
    const peer = await resp.json()

    const peerPub = await subtle.importKey('raw', unb64(peer.pub), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const shared = await subtle.deriveBits({ name: 'ECDH', public: peerPub }, kp.privateKey, 256)
    const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits'])
    const ke = await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: hexToBytes(master), info: utf8('campus-secure-v1') },
      ikm, 256,
    )
    sessionKey = await subtle.importKey('raw', ke, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    sessionId = peer.sessionId
    return { sessionId, sessionKey }
  })().finally(() => { pendingSession = null })
  return pendingSession
}

export async function encryptBody(obj) {
  const { sessionId: sid, sessionKey: key } = await ensureSession()
  const iv = new Uint8Array(12); crypto.getRandomValues(iv)
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(JSON.stringify(obj))))
  const tag = ct.subarray(ct.length - 16)
  const body = ct.subarray(0, ct.length - 16)
  return { session: sid, d: b64(iv) + '.' + b64(tag) + '.' + b64(body) }
}

export async function decryptBody(d) {
  const { sessionKey: key } = await ensureSession()
  const parts = String(d).split('.')
  if (parts.length !== 3) throw new Error('bad secure packet')
  const iv = unb64(parts[0]); const tag = unb64(parts[1]); const body = unb64(parts[2])
  const full = new Uint8Array(body.length + tag.length)
  full.set(body); full.set(tag, body.length)
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, full)
  return JSON.parse(new TextDecoder().decode(pt))
}

// --- 流式（SSE）专用封装 ---
// 请求体：安全通道开启时加密整个 body（与其它 JSON API 一致）；否则原样返回。
// 降级：握手失败时退回明文，保证「开关不一致」也能各自正常工作。
export async function encodeStreamRequest(obj) {
  if (!safe()) return obj
  try {
    return await encryptBody(obj)
  } catch (_) {
    clearSession()
    return obj
  }
}

// 响应帧：SSE 每帧先按 JSON 解析；命中 { d } 密文信封（后端 encodeStreamEvent/responseEncrypt 同形）
// 则解密还原为事件对象，明文帧直接返回。解析/解密失败返回 null，由调用方丢弃该帧。
// 注意：这里不清会话——流是用「发送该请求时的会话」加密的，清掉只会让后续帧继续解不开、
// 并把其它正常请求也在用的会话一起作废；真正过期的情况由请求层的 401 重握手兜底。
export async function decodeStreamEvent(raw) {
  let obj
  try { obj = JSON.parse(raw) } catch (_) { return null }
  if (obj && typeof obj === 'object' && typeof obj.d === 'string') {
    try {
      return await decryptBody(obj.d)
    } catch (_) { return null }
  }
  return obj
}

// 会话失效（15 分钟超时等）后强制清空，下次请求重新握手
export function clearSession() {
  sessionKey = null
  sessionId = null
  // 新会话在后端没有任何绑定，下一次请求必须重新携带 token 建立身份
  authBound = false
}