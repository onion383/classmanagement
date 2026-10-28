// =========================================================================
// jwt.js —— 解析 JWT payload（base64url）
//
// 前端原来在两处各写一份 atob 解码：
//   · router/index.js 的过期检查
//   · utils/apiUrl.js 的媒体凭据过期判断
// 两处都直接 `atob(token.split('.')[1])`，但 JWT 用的是 **base64url**：
//   · 字符集是 `-` `_`，而 atob 只认标准 base64 的 `+` `/` —— payload 里一旦
//     出现这两个字符就会抛 InvalidCharacterError；
//   · 且 JWT 段不带 `=` 填充，长度不当时同样解码失败。
// 于是「过期检查」经常直接走 catch 分支，把已经过期的 token 当成未过期。
//
// 这里统一做：base64url → 标准 base64 → 补 padding → atob → UTF-8 解码 → JSON.parse。
// UTF-8 解码不能省：atob 返回的是 latin1 字符串，payload 里的中文用户名会被拆成字节，
// 不还原会得到乱码（exp 仍可读，但解析出的对象不可靠）。
// =========================================================================

// 解码失败返回 null（调用方自行决定「失败算过期还是交给后端兜底」）
export function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    // TextDecoder 在浏览器、Electron 渲染层与 Node 测试环境都可用
    return JSON.parse(new TextDecoder('utf-8').decode(bytes))
  } catch (_) {
    return null
  }
}
