<template>
  <div class="flex">
    <Sidebar />
    <main class="flex-1 p-6 bg-gray-50 min-h-screen">
      <router-view />
    </main>
  </div>
</template>

<script>
import Sidebar from './components/Sidebar.vue'

export default {
  components: { Sidebar }
}
</script>