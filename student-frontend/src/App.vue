<template>
  <!-- 登录页：全屏、无侧边栏 -->
  <div v-if="$route.path === '/login'" class="h-screen">
    <router-view />
  </div>

  <!-- 其他页面：带侧边栏布局 -->
  <div v-else class="flex h-screen">
    <Sidebar />
    <main class="flex-1 p-6 bg-bg overflow-auto">
      <router-view />
    </main>
  </div>

  <!-- 全局通知弹窗 -->
  <NotificationToast />
</template>

<script>
import Sidebar from './components/Sidebar.vue'
import NotificationToast from './components/NotificationToast.vue'

export default {
  components: { Sidebar, NotificationToast }
}
</script>