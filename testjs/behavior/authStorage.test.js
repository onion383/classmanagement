// =========================================================================
// authStorage.test.js —— 登录态策略点行为（token / currentUser 单点契约）
//
// 运行：npm run test:behavior
// 被测：student-frontend/src/utils/authStorage.js
// 这是全库唯一的登录态存取点（22 个文件经它读写），行为契约：
//   · 未登录读 token 返回 ''（历史调用点有 || '' 与判空两种口味，'' 兼容两者）；
//   · setToken 拒绝空值（不能把 ''/null 写进去伪装成"已登录"）；
//   · getCurrentUser 对缺失/坏 JSON 一律返回 null（需要空对象的调用点自己 || {}）；
//   · setAuth/clearAuth 是"整套写/整套清"（登出不能只清一半）。
// =========================================================================
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

// 简易内存 localStorage：模块只在函数体内访问全局，调用前装好即可
function installFakeStorage() {
  const store = new Map()
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
    _store: store,
  }
  return global.localStorage
}

const loadAuth = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/authStorage.js')).href)

test('authStorage：未登录读 token 返回空串（兼容 ||\'\' 与判空两种调用口味）', async () => {
  const ls = installFakeStorage()
  const { getToken } = await loadAuth()
  assert.equal(getToken(), '')
  ls.setItem('token', 'abc')
  assert.equal(getToken(), 'abc')
})

test('authStorage：setToken 拒绝空值/空串，不会伪装成已登录', async () => {
  const ls = installFakeStorage()
  const { setToken, getToken } = await loadAuth()
  setToken('')
  setToken(null)
  setToken(undefined)
  assert.equal(getToken(), '')
  assert.equal(ls._store.has('token'), false)
  setToken('real-token')
  assert.equal(getToken(), 'real-token')
})

test('authStorage：getCurrentUser 对缺失与坏 JSON 一律返回 null', async () => {
  const ls = installFakeStorage()
  const { getCurrentUser } = await loadAuth()
  assert.equal(getCurrentUser(), null)
  ls.setItem('currentUser', '{不是 JSON')
  assert.equal(getCurrentUser(), null)
  ls.setItem('currentUser', JSON.stringify({ username: '张三' }))
  assert.deepEqual(getCurrentUser(), { username: '张三' })
})

test('authStorage：setCurrentUser 序列化整对象，null 不写入', async () => {
  const ls = installFakeStorage()
  const { setCurrentUser, getCurrentUser } = await loadAuth()
  setCurrentUser(null)
  assert.equal(ls._store.has('currentUser'), false)
  setCurrentUser({ username: '李四', role: 'teacher' })
  assert.deepEqual(getCurrentUser(), { username: '李四', role: 'teacher' })
})

test('authStorage：setAuth 整套写、clearAuth 整套清（登出不留半套）', async () => {
  const ls = installFakeStorage()
  const { setAuth, clearAuth, getToken, getCurrentUser } = await loadAuth()
  setAuth('tok-1', { username: '王五' })
  assert.equal(getToken(), 'tok-1')
  assert.equal(getCurrentUser().username, '王五')
  clearAuth()
  assert.equal(getToken(), '')
  assert.equal(getCurrentUser(), null)
  assert.equal(ls._store.has('token'), false)
  assert.equal(ls._store.has('currentUser'), false)
})

test('authStorage：clearToken 只清 token，不动用户（改密码换 token 的场景）', async () => {
  installFakeStorage()
  const { setAuth, clearToken, getToken, getCurrentUser } = await loadAuth()
  setAuth('tok-2', { username: '赵六' })
  clearToken()
  assert.equal(getToken(), '')
  assert.equal(getCurrentUser().username, '赵六')
})
