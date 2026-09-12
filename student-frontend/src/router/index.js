import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import axios from 'axios'
import { ensureDashboardData } from '../composables/useDashboardData'
import { useNotification } from '../composables/useNotification'

const routes = [
  { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/students', name: 'classroom', component: () => import('../views/ClassroomView.vue') },
  { path: '/fee', name: 'fee', component: () => import('../views/FeeManagement.vue') },
  { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { requiresAuth: true } },
  { path: '/account', redirect: '/settings' },
  { path: '/schedule', name: 'schedule', component: () => import('../views/ScheduleView.vue'), meta: { requiresAuth: true } },
  { path: '/seats', name: 'SeatView', component: () => import('../views/SeatView.vue') },
  { path: '/leaves', name: 'leaves', component: () => import('../views/LeaveManagement.vue'), meta: { requiresAuth: true } },
  { path: '/widget-settings', name: 'widgetSettings', component: () => import('../views/WidgetSettingsView.vue'), meta: { requiresAuth: true } },
  { path: '/album', name: 'album', component: () => import('../views/AlbumView.vue'), meta: { requiresAuth: true } },
  { path: '/group-manage', name: 'groupManage', component: () => import('../views/GroupManageView.vue'), meta: { requiresAuth: true } },
  { path: '/scores', name: 'scoreManage', component: () => import('../views/ScoreManagement.vue'), meta: { requiresAuth: true } },
  { path: '/duty', name: 'duty', component: () => import('../views/DutyView.vue'), meta: { requiresAuth: true } },
  { path: '/activities', name: 'activities', component: () => import('../views/ActivitiesView.vue'), meta: { requiresAuth: true } },
  { path: '/ai-assistant', name: 'aiAssistant', component: () => import('../views/AiAssistant.vue'), meta: { requiresAuth: true } },
  { path: '/about', name: 'about', component: () => import('../views/AboutView.vue') },
]

const router = createRouter({
  // 生产模式（file:// 协议）下 history 模式无法工作，改用 hash 模式
  history: import.meta.env.PROD ? createWebHashHistory() : createWebHistory(),
  routes
})

// 校验本地 token 是否已过期：对比 JWT payload 的 exp（秒）。解码失败视为未过期，
// 由后端 401 兜底，避免因为解析异常把仍有效的登录误判踢回登录页。
function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()
  } catch {
    return false
  }
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

  // 已登录（本地有有效 token）。仅首次导航时向后端发一次轻量登录态校验：
  // 若 token 已被后端作废（如账号/数据库变更），在这里直接回登录页。
  // 守卫处于 pending 期间 Vue 不会挂载目标组件，因此内部页不会闪现。
  if (from.matched.length === 0) {
    try {
      await axios.get('/api/me', { __skipAuth: true })
    } catch (err) {
      if (err.response && err.response.status === 401) {
        localStorage.removeItem('token')
        useNotification().error('登录已过期，请重新登录', 5000)
        return to.path === '/login' ? true : '/login'
      }
      // 其它错误（后端未就绪等）放行，交由请求重试/401 拦截器兜底
    }
  }

  // 已登录进入首页：提前并发拉取 Dashboard 数据，让数据与组件下载/挂载并行，减少首屏等待
  if (to.path === '/') ensureDashboardData()
  return to.path === '/login' ? '/' : true
})

export default router