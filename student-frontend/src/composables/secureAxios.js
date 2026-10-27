// 安全通道与 axios 的集成层：为「业务 JSON API」自动加解密。
// 三个入口（主窗 / 工具箱浮窗 / 桌面小组件）复用同一份拦截器，避免重复代码。
//
// 只对 JSON 请求体加密，FormData（文件上传）与 GET（无 body）直通；
// 响应若为 { d: 'iv.tag.ct' } 密文则自动解密后写回 res.data。
// 会话过期（15 分钟）导致解密失败时，清空会话并重试一次（重新握手），
// 避免一次请求因为被动过期而失败。

import {
  safe, encryptBody, decryptBody, clearSession,
  markAuthBound, resetAuthBinding,
} from './secureChannel'

export function setupSecureAxios(axios) {
  if (!safe()) return

  // 请求加密
  axios.interceptors.request.use(async config => {
    // 重试请求：错误/解密重试时已用新会话重新加密好 data，这里直接放行，
    // 避免把已加密的 {session,d} 信封再加密一次（二次封装会让后端解出乱数据）。
    if (config.__retrySecure === true) return config
    const d = config.data
    if (d == null) return config
    // 已是密文信封（后端未就绪重试等场景复用同一 config）：不能再加密一次，
    // 否则后端只解一层，路由拿到的是 { session, d } 而不是真实请求体。
    if (typeof d === 'object' && typeof d.session === 'string' && typeof d.d === 'string') return config
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
    // 请求确实带了登录 token 且成功：标记本会话已绑定身份，
    // 之后普通请求只发不含 token 的信道凭据。
    if (res.config && res.config.__authProofToken) markAuthBound()
    const d = res.data
    if (d && typeof d === 'object' && typeof d.d === 'string') {
      try {
        res.data = await decryptBody(d.d)
      } catch (e) {
        // 解密失败 = 这条响应是用「另一个会话」加密的。典型场景：页面并发发多个 GET，
        // 其中某个请求先撞上 401（会话过期/后端重启）触发重握手，模块级 sessionKey 被换掉，
        // 其它在途请求的响应就解不开了。
        // 旧逻辑只对「有请求体」的请求重试，GET 直接拿到 { d } 信封交回调用方——
        // 桌面组件把信封当课表/值日数据用（settings.sections）→ 渲染崩成白板。
        // 这里对所有方法统一：清会话、重建信道、原请求重发一次（GET 直接重发，
        // 有 body 的按新会话重新加密），彻底自愈。
        clearSession()
        const cfg = res.config
        if (cfg && cfg.__retryDecrypt !== true) {
          cfg.__retryDecrypt = true
          if (cfg.__origData) {
            try {
              cfg.__retrySecure = true
              cfg.data = await encryptBody(cfg.__origData)
            } catch (_) {
              // 重新加密失败：旧会话的密文原样重发必然解不开，按原响应对待、由调用方兜底
              return res
            }
          }
          try {
            return axios(cfg)
          } catch (_) { /* 重发失败：按原响应对待 */ }
        }
      }
    }
    return res
  }, async err => {
    // 安全通道会话过期：后端在「请求解密」阶段直接回 401 且 body 为 { d:'session-expired' }，
    // 不是密文、也不是登录态问题。此处清空旧会话、重新握手、把原请求体重新加密后原样重发一次，
    // 避免用户被误判为「登录过期」踢回登录页（与 aiChat 流式请求的重试行为保持一致）。
    const sd = err.response && err.response.data
    const cfg = err.config
    // 信道身份未绑定/绑定失效：后端要求带 token 重新认证。清掉绑定标记，
    // 用「强制携带 token」的凭据把原请求重发一次（body 已是密文，原样复用）。
    const authRequired = err.response && err.response.status === 401
      && String(err.response.headers?.['x-auth-required'] || '') === '1'
    // 凭据降级：安全模式下握手失败 → applyAuthHeader 退回明文 Bearer，而后端在安全模式下
    // **不收明文凭据** → 必然 401。这不是「登录过期」，绝不能清 token 把用户踢回登录页；
    // 应清掉会话重新握手、带 token 重发一次。
    // 用**独立**的重试标志（__retryDegraded）：不与 auth-required 分支共用 __retryAuth，
    // 否则「降级 → 重试 → 又撞上 auth-required」时后者会被误跳过，用户直接掉登录页。
    if (err.response && err.response.status === 401 && cfg && cfg.__credentialDegraded
      && cfg.__retryDegraded !== true) {
      cfg.__retryDegraded = true
      cfg.__forceAuthToken = true
      clearSession()
      if (cfg.__origData) {
        cfg.__retrySecure = true
        try {
          cfg.data = await encryptBody(cfg.__origData)
        } catch (_) {
          // 重新加密失败：body 若还是明文就原样重发；已是密文则重发必然解不开
          const d = cfg.data
          const isCipher = d && typeof d === 'object' && typeof d.session === 'string' && typeof d.d === 'string'
          if (isCipher) return Promise.reject(err)
        }
      }
      try {
        return axios(cfg)
      } catch (_) { /* 重发失败：按原错误返回 */ }
    }
    if (authRequired && cfg && cfg.__retryAuth !== true) {
      cfg.__retryAuth = true
      cfg.__forceAuthToken = true
      if (cfg.__origData) cfg.__retrySecure = true // 已加密，勿二次封装
      resetAuthBinding()
      try {
        return axios(cfg)
      } catch (_) { /* 重发失败：按原错误返回 */ }
    }
    // 会话过期：后端 15 分钟 TTL 清掉了信道会话、或后端重启 → 回 401 且 body 为 { d:'session-expired' }。
    // **任何方法都要清会话重试一次**：旧实现要求请求带 body（cfg.__origData），于是 GET 请求
    // （首屏绝大多数请求都是 GET）撞上过期时既不重试也不重建会话，前端会一直用已失效的
    // 会话密钥发请求 → 全站持续 401，且会话永远回不来。
    // 同样用**独立**标志（__retrySession）：不与 __retrySecure 共用，否则前面某个分支
    // 置过 __retrySecure 时，这里就会被跳过（而这恰恰是最需要重建会话的场景）。
    if (err.response && err.response.status === 401 && sd && typeof sd === 'object'
      && sd.d === 'session-expired' && cfg && cfg.__retrySession !== true) {
      cfg.__retrySession = true
      cfg.__retrySecure = true
      clearSession()
      if (cfg.__origData) {
        try {
          // 带 body 的要按**新会话**重新加密（旧密文绑定的是旧会话密钥）
          cfg.data = await encryptBody(cfg.__origData)
        } catch (_) {
          // 重新握手失败（如后端暂时不可用）：body 若还是明文就原样重发（后端安全模式也收明文体）；
          // 已是旧会话的密文则重发必然解不开 —— 此时不重发，按原错误返回
          const d = cfg.data
          const isCipher = d && typeof d === 'object' && typeof d.session === 'string' && typeof d.d === 'string'
          if (isCipher) return Promise.reject(err)
        }
      }
      try {
        return axios(cfg)
      } catch (_) { /* 重新握手仍失败：按原错误返回，由调用方兜底 */ }
    }
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