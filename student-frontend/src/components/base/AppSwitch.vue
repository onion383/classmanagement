<template>
  <label class="app-switch" :class="{ 'is-checked': modelValue, 'is-disabled': disabled }">
    <!-- 原生 checkbox 只作无障碍与键盘内核（Tab / Space），视觉交给轨道 -->
    <input
      class="app-switch-input"
      type="checkbox"
      role="switch"
      :checked="modelValue"
      :disabled="disabled"
      :aria-checked="modelValue ? 'true' : 'false'"
      :aria-label="ariaLabel || undefined"
      @change="onChange"
    />
    <span class="app-switch-track" aria-hidden="true">
      <span class="app-switch-knob"></span>
    </span>
    <span v-if="$slots.default" class="app-switch-label"><slot /></span>
  </label>
</template>

<script setup>
defineProps({
  modelValue: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  // 没有可见文字标签时用它给读屏器一个名称
  ariaLabel: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'change'])

function onChange(e) {
  const value = e.target.checked
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<style scoped>
/* 开关：轨道 + 滑块，颜色全部取主题变量，四个主题与夜间层自动跟随。
   尺寸 38×22（轨道）/ 16（滑块），与 Windows 11 设置页的开关比例接近。 */
.app-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.app-switch.is-disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* 原生 checkbox 视觉隐藏但保持可聚焦；
   选择器带 .app-switch 前缀，压过 index.css 里 input[type="checkbox"] 的基础样式 */
.app-switch .app-switch-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  padding: 0;
  opacity: 0;
  pointer-events: none;
}

.app-switch-track {
  position: relative;
  display: block;
  width: 38px;
  height: 22px;
  flex: none;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-full);
  background-color: var(--color-surface-hover);
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.app-switch:not(.is-disabled):hover .app-switch-track {
  border-color: var(--color-primary);
}
.app-switch.is-checked .app-switch-track {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

.app-switch-knob {
  position: absolute;
  top: 50%;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  background-color: var(--color-text-secondary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transform: translateY(-50%);
  transition:
    transform 120ms cubic-bezier(0.4, 0, 0.2, 1),
    background-color 120ms ease;
}
.app-switch.is-checked .app-switch-knob {
  background-color: var(--color-text-inverse);
  /* 轨道内宽 36px，滑块 16px，左右各留 2px：左 2 → 右移 16 即对齐右端 */
  transform: translate(16px, -50%);
}

/* 键盘焦点环画在轨道上（原生 input 本身不可见） */
.app-switch .app-switch-input:focus-visible + .app-switch-track {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-light);
}

.app-switch-label {
  line-height: 1.2;
}

@media (prefers-reduced-motion: reduce) {
  .app-switch-track,
  .app-switch-knob {
    transition: none;
  }
}
</style>
