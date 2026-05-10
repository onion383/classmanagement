import { createRouter, createWebHistory } from 'vue-router'
import ClassroomView from '../views/ClassroomView.vue'
import FeeManagement from '../views/FeeManagement.vue'

const routes = [
  { path: '/', name: 'classroom', component: ClassroomView },
  { path: '/fee', name: 'fee', component: FeeManagement }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router