<template>
  <div class="color-swatch">
    <button
      v-for="color in presetColors"
      :key="color"
      class="swatch-btn"
      :class="{ active: modelValue === color }"
      :style="{ backgroundColor: color }"
      :title="color"
      @click="select(color)"
    ></button>
    <div class="custom-color-wrapper">
      <input
        ref="colorInput"
        type="color"
        :value="customColor"
        @input="onCustomInput"
        class="color-input"
      />
      <button
        class="swatch-btn add-btn"
        :class="{ active: isCustomActive }"
        @click="openPicker"
        title="自定义颜色"
      >
        <span class="plus-icon">+</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '#000000' },
  presetColors: {
    type: Array,
    default: () => ['#ef4444', '#000000', '#3b82f6']
  }
})

const emit = defineEmits(['update:modelValue'])

const colorInput = ref(null)
const customColor = ref('#000000')

const isCustomActive = computed(() => {
  return !props.presetColors.includes(props.modelValue)
})

function select(color) {
  emit('update:modelValue', color)
}

function openPicker() {
  colorInput.value?.click()
}

function onCustomInput(e) {
  const color = e.target.value
  customColor.value = color
  emit('update:modelValue', color)
}
</script>

<style scoped>
.color-swatch {
  display: flex;
  align-items: center;
  gap: 6px;
}

.swatch-btn {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: border-color 0.15s, transform 0.15s;
}

.swatch-btn:hover {
  transform: scale(1.15);
}

.swatch-btn.active {
  border-color: var(--color-text, #111827);
  transform: scale(1.1);
}

.add-btn {
  background: var(--color-bg, #f9fafb);
  border: 2px dashed var(--color-border, #d1d5db);
  display: flex;
  align-items: center;
  justify-content: center;
}

.add-btn.active {
  border-style: solid;
  border-color: var(--color-text, #111827);
}

.plus-icon {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-secondary, #6b7280);
  line-height: 1;
}

.custom-color-wrapper {
  position: relative;
  display: flex;
}

.color-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
</style>