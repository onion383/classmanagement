import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'classroom', component: () => import('../views/ClassroomView.vue') },
  { path: '/fee', name: 'fee', component: () => import('../views/FeeManagement.vue') },
  { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { requiresAuth: true } },
  { path: '/account', redirect: '/settings' },
  { path: '/schedule', name: 'schedule', component: () => import('../views/ScheduleView.vue'), meta: { requiresAuth: true } },
  { path: '/seats', name: 'SeatView', component: () => import('../views/SeatView.vue') },
  { path: '/leaves', name: 'leaves', component: () => import('../views/LeaveManagement.vue'), meta: { requiresAuth: true } },
  { path: '/widget-settings', name: 'widgetSettings', component: () => import('../views/WidgetSettingsView.vue'), meta: { requiresAuth: true } },
  { path: '/album', name: 'album', component: () => import('../views/AlbumView.vue'), meta: { requiresAuth: true } },
  { path: '/test', name: 'test', component: () => import('../views/TestView.vue') },
]

const router = createRouter({
  // 生产模式（file:// 协议）下 history 模式无法工作，改用 hash 模式
  history: import.meta.env.PROD ? createWebHashHistory() : createWebHistory(),
  routes
})

// 路由守卫必须在 router 实例创建之后
router.beforeEach((to, from) => {
  const token = localStorage.getItem('token')
  if (token) {
    return to.path === '/login' ? '/' : true
  } else {
    return to.path === '/login' ? true : '/login'
  }
})

export default router