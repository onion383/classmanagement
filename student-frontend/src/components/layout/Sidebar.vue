<template>
  <div class="w-60 bg-sidebar text-text-inverse h-screen p-4 flex flex-col">
    <h2 class="text-lg font-bold mb-6 flex items-center gap-2">
      <component v-if="iconStyle === 'color'" :is="logoIcon" :size="20" class="shrink-0" stroke-width="2" :style="{ color: '#f1f5f9' }" />
      <span v-else class="nav-emoji">{{ logoEmoji }}</span>
      班级管理系统
    </h2>
    <nav class="space-y-2 flex-1 min-h-0 overflow-y-auto sidebar-scroll" @pointerover="onNavOver">
      <template v-for="group in navGroups" :key="group.title">
        <div class="text-[11px] text-white/40 uppercase tracking-wider px-3 pt-1 pb-0.5">{{ group.title }}</div>
        <router-link
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="nav-item hover:bg-sidebar-hover transition-theme"
          active-class="bg-sidebar-active"
        >
          <component
            v-if="iconStyle === 'color'"
            :is="item.lucide"
            :size="16"
            :stroke-width="2"
            :style="{ color: item.color }"
          />
          <span v-else class="nav-emoji">{{ item.emoji }}</span>
          {{ item.label }}
        </router-link>
        <div class="border-t border-white/10 my-2"></div>
      </template>
    </nav>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import {
  Users, Network, CalendarDays, Coins, Armchair, Broom, BedDouble, Medal,
  Images, PartyPopper, Bot, Settings, Info, GraduationCap, Home,
} from '@lucide/vue'
import { useThemeStore } from '../../stores/theme'
import { prefetchRoute } from '../../utils/routePrefetch.js'

const router = useRouter()

// 图标样式跟随主题设置：'lucide' 线性图标 | 'emoji' 表情
const { iconStyle } = storeToRefs(useThemeStore())
const logoIcon = GraduationCap
const logoEmoji = '🏫'

const navGroups = [
  {
    title: '概览',
    items: [
      { to: '/',              label: '班级概览', emoji: '🏠', color: '#10b981', lucide: Home },
    ],
  },
  {
    title: '基础信息',
    items: [
      { to: '/students',      label: '学生管理', emoji: '📚', color: '#60a5fa', lucide: Users },
      { to: '/group-manage',   label: '分组管理', emoji: '👥', color: '#818cf8', lucide: Network },
      { to: '/schedule',       label: '课程表',   emoji: '📅', color: '#22d3ee', lucide: CalendarDays },
    ],
  },
  {
    title: '核心管理',
    items: [
      { to: '/fee',            label: '班费管理', emoji: '💰', color: '#fbbf24', lucide: Coins },
      { to: '/seats',          label: '座位管理', emoji: '🪑', color: '#fb923c', lucide: Armchair },
      { to: '/duty',           label: '卫生值日', emoji: '🧹', color: '#34d399', lucide: Broom },
      { to: '/leaves',         label: '请假管理', emoji: '🛌', color: '#a78bfa', lucide: BedDouble },
      { to: '/scores',         label: '加分管理', emoji: '🏅', color: '#f87171', lucide: Medal },
    ],
  },
  {
    title: '活动中心',
    items: [
      { to: '/album',          label: '学生相册', emoji: '📷', color: '#f472b6', lucide: Images },
      { to: '/activities',     label: '班级活动', emoji: '🎉', color: '#fb7185', lucide: PartyPopper },
    ],
  },
  {
    title: '系统管理',
    items: [
      { to: '/ai-assistant',   label: 'AI 助手', emoji: '🤖', color: '#38bdf8', lucide: Bot },
      { to: '/settings',       label: '系统设置', emoji: '⚙️', color: '#94a3b8', lucide: Settings },
      { to: '/about',          label: '关于软件', emoji: 'ℹ️', color: '#cbd5e1', lucide: Info },
    ],
  },
]

function onNavOver(e) {
  const link = e.target.closest('a[href]')
  if (!link) return
  prefetchRoute(router, link.getAttribute('href'))
}
</script>

<style scoped>
/* 侧边栏细滚动条：窗口过高时导航区独立滚动，标题行固定不滚 */
.sidebar-scroll::-webkit-scrollbar {
  width: 6px;
}
.sidebar-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.25);
  border-radius: 3px;
}
.sidebar-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}
.sidebar-scroll::-webkit-scrollbar-track {
  background: transparent;
}
/* 导航项：图标 + 文字垂直居中，图标与文字间距固定，去掉链接下划线 */
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  text-decoration: none;
}
.nav-item svg,
.nav-item .nav-emoji {
  flex-shrink: 0;
}
/* Emoji 图标：与 lucide 16px 图标视觉等宽，保持垂直居中对齐 */
.nav-emoji {
  width: 20px;
  text-align: center;
  font-size: 14px;
  line-height: 1;
}
</style>