<template>
  <div class="p-3 rounded-lg bg-surface shadow-card border border-border">
    <div class="text-sm font-medium text-text mb-2">主题切换</div>
    <div class="flex gap-2">
      <button
        v-for="t in themes"
        :key="t.key"
        @click="setTheme(t.key)"
        class="flex-1 flex flex-col items-center gap-1 p-2 rounded-md border border-border transition-theme hover:bg-surface-hover"
        :class="{ 'ring-2 ring-primary': currentTheme === t.key && !hasCustomColors }"
      >
        <span
          class="w-6 h-6 rounded-full border border-border"
          :style="{ background: t.preview }"
        ></span>
        <span class="text-xs text-text-secondary">{{ t.label }}</span>
      </button>
    </div>

    <!-- 自定义颜色 -->
    <div class="mt-3 pt-3 border-t border-border">
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-medium text-text">自定义颜色</span>
        <button
          v-if="hasCustomColors"
          @click="resetCustomColors"
          class="text-xs text-danger hover:underline"
        >
          重置
        </button>
      </div>
      <div class="grid grid-cols-3 gap-2">
        <label
          v-for="item in customColorItems"
          :key="item.key"
          class="flex items-center gap-1.5 p-1.5 rounded border border-border hover:bg-surface-hover cursor-pointer transition-theme"
          :class="{ 'ring-1 ring-primary': customColors[item.key] }"
        >
          <input
            type="color"
            :value="customColors[item.key] || item.default"
            @input="setCustomColor(item.key, $event.target.value)"
            class="w-5 h-5 p-0 border-0 rounded overflow-hidden cursor-pointer"
          />
          <span class="text-xs text-text-secondary">{{ item.label }}</span>
        </label>
      </div>
      <p class="text-xs text-text-muted mt-2">
        选择颜色后会立即生效并保存到本地。
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useThemeStore } from '../stores/theme'

const themeStore = useThemeStore()
const { currentTheme, customColors } = storeToRefs(themeStore)
const { setTheme, setCustomColor, resetCustomColors } = themeStore

const themes = [
  { key: 'base', label: '默认', preview: '#22c55e' },
  { key: 'glass', label: '毛玻璃', preview: 'linear-gradient(135deg, #e0f2fe, #f0f9ff)' },
  { key: 'minimal', label: '极简', preview: '#ffffff' },
]

const customColorItems = [
  { key: 'color-primary', label: '主色', default: '#22c55e' },
  { key: 'color-bg', label: '背景', default: '#f9fafb' },
  { key: 'color-surface', label: '卡片', default: '#ffffff' },
  { key: 'color-text', label: '文字', default: '#111827' },
  { key: 'color-sidebar', label: '侧边栏', default: '#1f2937' },
  { key: 'color-border', label: '边框', default: '#e5e7eb' },
]

const hasCustomColors = computed(() => Object.keys(customColors.value).length > 0)
</script>
