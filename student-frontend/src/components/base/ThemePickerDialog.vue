<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="visible"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10002] pointer-events-auto no-dialog-pulse"
        @click.self="$emit('close')"
      >
        <div class="bg-surface p-5 rounded-xl w-[520px] max-w-[92vw] shadow-lg dialog-card">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-bold text-text flex items-center gap-2"><Palette :size="18" /> 切换主题</h3>
            <button class="text-text-muted hover:text-text text-lg leading-none px-2 cursor-pointer" @click="$emit('close')">✕</button>
          </div>

          <!-- 主题卡片：点卡片立即生效（无需保存），与引导页「主题选择」一致 -->
          <div class="theme-grid">
            <button
              v-for="t in themeStore.allThemes"
              :key="t.id"
              type="button"
              class="theme-card"
              :class="{ 'is-active': themeStore.currentTheme === t.id }"
              @click="themeStore.setTheme(t.id)"
            >
              <span class="theme-preview" :style="previewStyle(t.id)">
                <span class="tp-side"></span>
                <span class="tp-bar"></span>
                <span class="tp-dot"></span>
              </span>
              <span class="theme-name">{{ t.name }}</span>
            </button>
          </div>

          <!-- 动画效果总开关：立即生效 -->
          <label class="anim-toggle">
            <input type="checkbox" :checked="themeStore.animationsEnabled" @change="onAnimationsChange" />
            <span class="anim-toggle-text">
              <span class="anim-toggle-label">启用动画效果</span>
              <span class="anim-toggle-desc">关闭后禁用全部过渡与动画（含窗口淡入淡出、弹窗与列表动效）</span>
            </span>
          </label>

          <p class="mt-3 text-xs text-text-muted">点击主题即可实时预览效果。</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { useThemeStore } from '../../stores/theme'
import { Palette } from '@lucide/vue'

defineProps({ visible: { type: Boolean, default: false } })
defineEmits(['close'])

const themeStore = useThemeStore()

// 主题预览色：仅用于缩略示意（真实配色由各主题 CSS 变量驱动），与引导页保持一致
const PREVIEW = {
  base: { bg: '#f9fafb', side: '#1f2937', bar: '#22c55e' },
  glass: { bg: '#dfe9f5', side: '#ffffff', bar: '#3b82f6' },
  glass2: { bg: '#e6ecff', side: '#ffffff', bar: '#5b7cfa' },
  win11: { bg: '#eef2f7', side: '#ffffff', bar: '#3b82f6' },
  minimal: { bg: '#ffffff', side: '#111827', bar: '#111827' },
}

function previewStyle(id) {
  const p = PREVIEW[id] || PREVIEW.glass
  return { background: p.bg, '--tp-side': p.side, '--tp-bar': p.bar }
}

function onAnimationsChange(e) {
  themeStore.setAnimationsEnabled(e.target.checked)
}
</script>

<style scoped>
.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.theme-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.theme-card.is-active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.theme-preview {
  position: relative;
  display: block;
  height: 52px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  overflow: hidden;
}
.tp-side {
  position: absolute;
  left: 5px;
  top: 5px;
  bottom: 5px;
  width: 26%;
  border-radius: 4px;
  background: var(--tp-side, var(--color-surface));
  opacity: 0.95;
}
.tp-bar {
  position: absolute;
  left: 35%;
  right: 5px;
  top: 5px;
  height: 10px;
  border-radius: 4px;
  background: var(--tp-bar, var(--color-primary));
  opacity: 0.9;
}
.tp-dot {
  position: absolute;
  left: 35%;
  right: 5px;
  top: 20px;
  bottom: 5px;
  border-radius: 4px;
  background: var(--color-surface);
  opacity: 0.75;
}
.theme-name {
  font-size: 13px;
  text-align: center;
  color: var(--color-text-secondary);
}
.theme-card.is-active .theme-name {
  color: var(--color-primary);
  font-weight: 600;
}

.anim-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  cursor: pointer;
}
.anim-toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.anim-toggle-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
}
.anim-toggle-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}
</style>
