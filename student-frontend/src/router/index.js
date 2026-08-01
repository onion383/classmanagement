import { createRouter, createWebHistory } from 'vue-router'
import ClassroomView from '../views/ClassroomView.vue'
import FeeManagement from '../views/FeeManagement.vue'
import Login from '../views/Login.vue'
import SettingsView from '../views/SettingsView.vue'
import ScheduleView from '../views/ScheduleView.vue'
import SeatView from '../views/SeatView.vue';


const routes = [
  { path: '/', name: 'classroom', component: ClassroomView },
  { path: '/fee', name: 'fee', component: FeeManagement },
  { path: '/login', name: 'login', component: Login },
  { path: '/settings', name: 'settings', component: SettingsView, meta: { requiresAuth: true } },
  { path: '/account', redirect: '/settings' },
  { path: '/schedule', name: 'schedule', component: ScheduleView, meta: { requiresAuth: true } },
  { path: '/seats',name: 'SeatView',component: SeatView },
]

const router = createRouter({
  history: createWebHistory(),
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