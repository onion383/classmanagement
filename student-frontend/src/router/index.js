import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import axios from 'axios'
import { ensureDashboardData } from '../composables/useDashboardData'
import { decodeJwtPayload } from '../utils/jwt'

const routes = [
  { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/students', name: 'classroom', component: () => import('../views/ClassroomView.vue') },
  { path: '/fee', name: 'fee', component: () => import('../views/FeeManagement.vue') },
  { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/SettingsView/SettingsView.vue'), meta: { requiresAuth: true } },
  { path: '/account', redirect: '/settings' },
  { path: '/schedule', name: 'schedule', component: () => import('../views/ScheduleView/ScheduleView.vue'), meta: { requiresAuth: true } },
  { path: '/seats', name: 'SeatView', component: () => import('../views/SeatView.vue') },
  { path: '/leaves', name: 'leaves', component: () => import('../views/LeaveManagement.vue'), meta: { requiresAuth: true } },
  { path: '/album', name: 'album', component: () => import('../views/AlbumView.vue'), meta: { requiresAuth: true } },
  { path: '/group-manage', name: 'groupManage', component: () => import('../views/GroupManageView.vue'), meta: { requiresAuth: true } },
  { path: '/scores', name: 'scoreManage', component: () => import('../views/ScoreManagement.vue'), meta: { requiresAuth: true } },
  { path: '/duty', name: 'duty', component: () => import('../views/DutyView.vue'), meta: { requiresAuth: true } },
  { path: '/activities', name: 'activities', component: () => import('../views/ActivitiesView.vue'), meta: { requiresAuth: true } },
  { path: '/ai-assistant', name: 'aiAssistant', component: () => import('../views/AiAssistant.vue'), meta: { requiresAuth: true, deferPrefetch: true } },
  { path: '/about', name: 'about', component: () => import('../views/AboutView.vue') },
  // 未知路径统一回首页：否则命中空路由，页面只渲染一个空白壳
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  // 生产模式（file:// 协议）下 history 模式无法工作，改用 hash 模式
  history: import.meta.env.PROD ? createWebHashHistory() : createWebHistory(),
  routes
})

// 校验本地 token 是否已过期：对比 JWT payload 的 exp（秒）。解码失败视为未过期，
// 由后端 401 兜底，避免因为解析异常把仍有效的登录误判踢回登录页。
// 解码必须走 base64url（见 utils/jwt.js）：原先直接 atob，payload 含 `-`/`_` 时会抛错，
// 过期检查形同虚设（过期 token 被当成有效，客户端仍往里跳）。
function isTokenExpired(token) {
  const payload = decodeJwtPayload(token)
  return !!payload && typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()
}

// 路由守卫必须在 router 实例创建之后
router.beforeEach(async (to, from) => {
  const stored = localStorage.getItem('token')
  if (stored && isTokenExpired(stored)) {
    // 残留的过期 token 直接在路由阶段清除，避免先渲染内部页、再被 401 踢回登录页的闪烁
    localStorage.removeItem('token')
    return to.path === '/login' ? true : '/login'
  }
  if (!stored) {
    return to.path === '/login' ? true : '/login'
  }

  // 已登录（本地有有效 token）。首次导航时向后端发一次轻量登录态校验，但**不阻塞首屏**：
  // 校验在后台进行，若 token 已被后端作废（如账号/数据库变更），由响应拦截器统一处理 401
  // （清 token + 提示 + 回登录页）。这样后端未就绪时首屏不再干等 /api/me 的往返。
  if (from.matched.length === 0) {
    axios.get('/api/me').catch(() => {})
  }

  // 已登录进入首页：提前并发拉取 Dashboard 数据，让数据与组件下载/挂载并行，减少首屏等待
  if (to.path === '/') ensureDashboardData()
  return to.path === '/login' ? '/' : true
})

// 空闲预热所有懒加载路由 chunk：登录后主窗口空闲时后台按「逐条 + 让出空闲」的方式
// 拉取各页面模块，让点击侧边栏跳转时不再等 chunk 下载/解析/V8 编译。
// 逐条而非并发，是为了避免同一时刻下载并解析大量 chunk 抢占主线程造成卡顿。
//
// meta.deferPrefetch 的路由（如 /ai-assistant）不在启动期预热，而是排在最后一档：
// 等所有常规路由都预热完、且系统真正空闲时才加载。这样既不抢启动资源，
// 又能在长时间空闲后把 chunk 备好，让首次打开浮窗近乎即时。
export function prefetchRoutes(options = {}) {
  const warmDeferred = options.warmDeferred !== false
  const loaders = []
  const deferred = []
  const seen = new Set()
  for (const record of router.getRoutes()) {
    const comp = record.components && record.components.default
    if (typeof comp !== 'function' || seen.has(comp)) continue
    seen.add(comp)
    if (record.meta && record.meta.deferPrefetch) deferred.push(comp)
    else loaders.push(comp)
  }
  const idle = (fn, timeout) => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout })
    else setTimeout(fn, 80)
  }
  let j = 0
  const nextDeferred = () => {
    if (j >= deferred.length) return
    const loader = deferred[j++]
    Promise.resolve()
      .then(() => loader())
      .catch(() => {})
      .then(() => idle(nextDeferred, 8000)) // 末档更保守：等更长的真空闲，避免与交互抢资源
  }
  let i = 0
  const next = () => {
    if (i >= loaders.length) {
      if (warmDeferred && deferred.length) idle(nextDeferred, 8000)
      return
    }
    const loader = loaders[i++]
    Promise.resolve()
      .then(() => loader())
      .catch(() => {})
      .then(() => idle(next, 2000)) // 每条加载完都让出一次空闲，避免连续解析阻塞交互
  }
  idle(next, 2000)
}

export default router