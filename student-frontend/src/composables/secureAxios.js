// 安全通道与 axios 的集成层：为「业务 JSON API」自动加解密。
// 三个入口（主窗 / 工具箱浮窗 / 桌面小组件）复用同一份拦截器，避免重复代码。
//
// 只对 JSON 请求体加密，FormData（文件上传）与 GET（无 body）直通；
// 响应若为 { d: 'iv.tag.ct' } 密文则自动解密后写回 res.data。
// 会话过期（15 分钟）导致解密失败时，清空会话并重试一次（重新握手），
// 避免一次请求因为被动过期而失败。

import { safe, encryptBody, decryptBody, clearSession } from './secureChannel'

export function setupSecureAxios(axios) {
  if (!safe()) return

  // 请求加密
  axios.interceptors.request.use(async config => {
    const d = config.data
    if (d == null) return config
    if (typeof FormData !== 'undefined' && d instanceof FormData) return config
    if (typeof d === 'string') return config // 已是序列化表单/查询串，非 JSON 对象
    try {
      config.__origData = d
      config.data = await encryptBody(d)
      config.headers = config.headers || {}
      config.headers['Content-Type'] = 'application/json'
    } catch (_) {
      // 加密失败（如握手异常）时不阻断请求，回落到明文直通，保证功能可用
    }
    return config
  })

  // 响应解密：失败一次视为会话过期，清空会话重试一次
  axios.interceptors.response.use(async res => {
    const d = res.data
    if (d && typeof d === 'object' && typeof d.d === 'string') {
      try {
        res.data = await decryptBody(d.d)
      } catch (e) {
        clearSession()
        const cfg = res.config
        if (cfg && cfg.__origData && cfg.__retrySecure !== true) {
          try {
            cfg.__retrySecure = true
            cfg.data = await encryptBody(cfg.__origData)
            return axios(cfg)
          } catch (_) {}
        }
      }
    }
    return res
  }, async err => {
    // 错误响应（4xx/5xx）在加密会话下同样被后端包成 { d: 'iv.tag.ct' }，
    // 这里也尝试解密，否则调用方拿到的 err.response.data 是密文，
    // 诸如后端返回的 needConfirm / error 等真实字段将无法读取。
    const d = err.response?.data
    if (d && typeof d === 'object' && typeof d.d === 'string') {
      try {
        err.response.data = await decryptBody(d.d)
      } catch (_) {
        // 非法/过期密文（如 { d:'session-expired' }）保持原样，由调用方兜底
      }
    }
    return Promise.reject(err)
  })
}