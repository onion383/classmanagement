import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router'
import ClassroomView from '../views/ClassroomView.vue'
import FeeManagement from '../views/FeeManagement.vue'
import Login from '../views/Login.vue'
import SettingsView from '../views/SettingsView.vue'
import ScheduleView from '../views/ScheduleView.vue'
import SeatView from '../views/SeatView.vue';
import LeaveManagement from '../views/LeaveManagement.vue';
import WidgetSettingsView from '../views/WidgetSettingsView.vue';
import TestView from '../views/TestView.vue';
import AlbumView from '../views/AlbumView.vue';


const routes = [
  { path: '/', name: 'classroom', component: ClassroomView },
  { path: '/fee', name: 'fee', component: FeeManagement },
  { path: '/login', name: 'login', component: Login },
  { path: '/settings', name: 'settings', component: SettingsView, meta: { requiresAuth: true } },
  { path: '/account', redirect: '/settings' },
  { path: '/schedule', name: 'schedule', component: ScheduleView, meta: { requiresAuth: true } },
  { path: '/seats',name: 'SeatView',component: SeatView },
  { path: '/leaves', name: 'leaves', component: LeaveManagement, meta: { requiresAuth: true } },
  { path: '/widget-settings', name: 'widgetSettings', component: WidgetSettingsView, meta: { requiresAuth: true } },
  { path: '/album', name: 'album', component: AlbumView, meta: { requiresAuth: true } },
  { path: '/test', name: 'test', component: TestView },
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