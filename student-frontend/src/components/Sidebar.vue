<template>
  <div class="w-60 bg-sidebar text-text-inverse min-h-screen p-4 flex flex-col">
    <h2 class="text-lg font-bold mb-6">📋 班级管理</h2>
    <nav class="space-y-2 flex-1">
      <router-link
        to="/"
        class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme"
        active-class="bg-sidebar-active"
      >
        📚 班级管理
      </router-link>
      <router-link
        to="/fee"
        class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme"
        active-class="bg-sidebar-active"
      >
        💰 班费管理
      </router-link>
      
      <!-- 课程表入口 -->
      <router-link
        to="/schedule"
        class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme"
        active-class="bg-sidebar-active"
      >
        📅 课程表
      </router-link>

      <router-link
        to="/seats"
        class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme"
        active-class="bg-sidebar-active"
      >
        🪑 座位管理
      </router-link>

      <router-link
        to="/widget-settings"
        class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme"
        active-class="bg-sidebar-active"
      >
        🔧 小组件设置
      </router-link>

      <router-link
        to="/test"
        class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme"
        active-class="bg-sidebar-active"
      >
        🧪 UI 测试
      </router-link>

      <router-link
        to="/settings"
        class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme"
        active-class="bg-sidebar-active"
      >
        ⚙️ 设置
      </router-link>
    </nav>

  </div>
</template>

<script setup>
</script>