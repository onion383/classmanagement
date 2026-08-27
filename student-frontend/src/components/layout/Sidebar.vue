<template>
  <div class="w-60 bg-sidebar text-text-inverse min-h-screen p-4 flex flex-col">
    <h2 class="text-lg font-bold mb-6">📋 校园助手</h2>
    <nav class="space-y-2 flex-1" @pointerover="onNavOver">
      <!-- ===== 基础信息 ===== -->
      <div class="text-[11px] text-white/40 uppercase tracking-wider px-3 pt-1 pb-0.5">基础信息</div>
      <router-link to="/" class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme" active-class="bg-sidebar-active">📚 学生管理</router-link>
      <router-link to="/group-manage" class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme" active-class="bg-sidebar-active">👥 分组管理</router-link>
      <router-link to="/schedule" class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme" active-class="bg-sidebar-active">📅 课程表</router-link>

      <div class="border-t border-white/10 my-2"></div>

      <!-- ===== 核心管理 ===== -->
      <div class="text-[11px] text-white/40 uppercase tracking-wider px-3 pt-1 pb-0.5">核心管理</div>
      <router-link to="/fee" class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme" active-class="bg-sidebar-active">💰 班费管理</router-link>
      <router-link to="/seats" class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme" active-class="bg-sidebar-active">🪑 座位管理</router-link>
      <router-link to="/duty" class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme" active-class="bg-sidebar-active">🧹 卫生值日</router-link>
      <router-link to="/leaves" class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme" active-class="bg-sidebar-active">🛌 请假管理</router-link>
      <router-link to="/scores" class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme" active-class="bg-sidebar-active">🏅 加分管理</router-link>

      <div class="border-t border-white/10 my-2"></div>

      <!-- ===== 活动中心 ===== -->
      <div class="text-[11px] text-white/40 uppercase tracking-wider px-3 pt-1 pb-0.5">活动中心</div>
      <router-link to="/album" class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme" active-class="bg-sidebar-active">📷 学生相册</router-link>
      <router-link to="/activities" class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme" active-class="bg-sidebar-active">🎉 班级活动</router-link>

      <div class="border-t border-white/10 my-2"></div>

      <!-- ===== 系统管理 ===== -->
      <div class="text-[11px] text-white/40 uppercase tracking-wider px-3 pt-1 pb-0.5">系统管理</div>
      <router-link to="/settings" class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme" active-class="bg-sidebar-active">⚙️ 系统设置</router-link>
      <router-link to="/about" class="block px-3 py-2 rounded hover:bg-sidebar-hover transition-theme" active-class="bg-sidebar-active">ℹ️ 关于软件</router-link>
    </nav>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { prefetchRoute } from '../../utils/routePrefetch.js'

const router = useRouter()

function onNavOver(e) {
  const link = e.target.closest('a[href]')
  if (!link) return
  prefetchRoute(router, link.getAttribute('href'))
}
</script>