// 登录凭据与当前用户的唯一存取点（localStorage）。
//
// 此前 token 有 37 处、currentUser 有 14 处裸 localStorage 读写散在 22 个文件里：
// 键名/序列化/清空口径（登出是否连用户一起清）由各处独立维护，策略一变要全库搜改。
// 收拢到本模块后，存取策略只发生在这里。
//
// 跨窗口共享是有意设计（Electron 主窗口/引导窗口/悬浮组件/桌面组件同 origin 共享
// localStorage），不是泄漏面：本地数据本来就在同一用户目录下。

const TOKEN_KEY = 'token'
const USER_KEY = 'currentUser'

// ---- 登录 token ----
// 读：未登录统一返回 ''（历史调用点有 || '' 与 if(判空) 两种口味，'' 兼容两者）
function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || '' } catch (_) { return '' }
}
function setToken(token) {
  try { if (token) localStorage.setItem(TOKEN_KEY, token) } catch (_) { /* 隐私模式等写失败忽略 */ }
}
function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY) } catch (_) {}
}

// ---- 当前用户（登录返回的 user 对象，JSON 持久化）----
// 读：未登录/损坏返回 null（需要空对象的调用点自己 || {}）
function getCurrentUser() {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (_) { return null }
}
function setCurrentUser(user) {
  try { if (user) localStorage.setItem(USER_KEY, JSON.stringify(user)) } catch (_) {}
}
function clearCurrentUser() {
  try { localStorage.removeItem(USER_KEY) } catch (_) {}
}

// ---- 组合操作（登录成功写全套 / 登出清全套）----
function setAuth(token, user) {
  setToken(token)
  setCurrentUser(user)
}
function clearAuth() {
  clearToken()
  clearCurrentUser()
}

export {
  TOKEN_KEY, USER_KEY,
  getToken, setToken, clearToken,
  getCurrentUser, setCurrentUser, clearCurrentUser,
  setAuth, clearAuth,
}
