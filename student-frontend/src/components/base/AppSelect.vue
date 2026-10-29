<template>
  <div class="av-select" :class="{ 'av-select--open': open, 'av-select--disabled': disabled, 'av-select--compact': compact }" ref="rootRef">
    <!-- 触发区：圆角 + 毛玻璃底 + 点击按下反馈 -->
    <button
      type="button"
      class="av-select__trigger"
      :disabled="disabled"
      @click="toggle"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="open ? commit(hoverIdx) : (open = true)"
      @keydown.escape="open = false"
    >
      <span class="av-select__value" :class="{ 'av-select__value--placeholder': !resolved || resolved.value == null }">
        {{ display }}
      </span>
      <span class="av-select__arrow" aria-hidden="true"><ChevronDown :size="14" stroke-width="1.8" /></span>
    </button>

    <!-- 下拉菜单（Teleport 到 body 避免被父容器 overflow/transform/backdrop-filter 裁剪） -->
    <Teleport to="body">
      <ul v-if="open" class="av-select__menu" :style="menuStyle" role="listbox">
        <li
          v-for="(opt, i) in list"
          :key="opt.value == null ? i : opt.value"
          class="av-select__option"
          :class="{ 'av-select__option--active': i === hoverIdx, 'av-select__option--selected': opt.value === resolved?.value, 'av-select__option--disabled': opt.disabled }"
          @mouseenter="hoverIdx = i"
          @click="commit(i)"
        >
          <span class="av-select__option-label">{{ opt.label }}</span>
          <Check v-if="opt.value === resolved?.value" class="av-select__check" :size="14" stroke-width="1.8" />
        </li>
        <li v-if="!list.length" class="av-select__option av-select__option--empty">无选项</li>
      </ul>
    </Teleport>
  </div>
</template>

<script setup>
// 自定义下拉框：替代原生 <select>，适配圆角 + 毛玻璃 + 点击过渡动画。
// 用法：
//   <AppSelect v-model="xxx" :options="[{value:'a', label:'A'}, 'B']" placeholder="请选择" />
import '../../styles/select.css'
import { ChevronDown, Check } from '@lucide/vue'
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

defineOptions({ name: 'AppSelect' })

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  // 支持字符串数组：['A','B']；或对象数组：[{value, label, disabled}]，省略 value 时取 label 本身。
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: '请选择' },
  disabled: { type: Boolean, default: false },
  // 紧凑模式：缩小 trigger 高度，用于标题条等高度受限场景
  compact: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const hoverIdx = ref(-1)
const menuPos = ref({ left: 0, top: 0, width: 0 })
// menuZ：下拉菜单的层级。菜单 Teleport 到 body 后自成一层，必须压过"包住触发器的浮层"，
// 否则会被弹窗遮罩/AI 悬浮窗盖住（点开看不到或只看到一角）。
const menuZ = ref(10010)

const rootRef = ref(null)

const list = computed(() => {
  return props.options.map(o => {
    if (o && typeof o === 'object') return { value: o.value ?? o.label, label: o.label, disabled: !!o.disabled }
    return { value: o, label: String(o), disabled: false }
  })
})

const resolved = computed(() => {
  return list.value.find(o => o.value === props.modelValue) || null
})

const display = computed(() => {
  if (resolved.value) return resolved.value.label
  if (props.modelValue !== '' && props.modelValue != null) return String(props.modelValue)
  return props.placeholder
})

const menuStyle = computed(() => {
  if (!open.value) return {}
  // Teleport 到 body 后无法继承父级字号，主动读取组件自身字号同步给菜单
  const fs = rootRef.value && getComputedStyle(rootRef.value).fontSize
  const style = {
    position: 'fixed',
    left: menuPos.value.left + 'px',
    top: menuPos.value.top + 'px',
    width: menuPos.value.width + 'px',
    minWidth: '120px',
    zIndex: menuZ.value,
  }
  if (fs) style.fontSize = fs
  return style
})

function toggle() {
  if (props.disabled) return
  open.value = !open.value
  hoverIdx.value = open.value ? list.value.findIndex(o => o.value === props.modelValue) : -1
  if (open.value) {
    const rect = rootRef.value?.getBoundingClientRect()
    if (rect) {
      menuPos.value = { left: rect.left, top: rect.bottom + 4, width: rect.width }
    }
    menuZ.value = _layerZ()
  }
}

// 菜单层级：从触发器往上取祖先里最大的 z-index 再叠一层，保证压过包住它的浮层。
// 这样同一个下拉放在普通页面（无浮层，用 10010 兜底）、z-[10070] 的「添加模型」弹窗、
// z-[20001] 的 AI 悬浮窗里都能正常显示，不用每处浮层各写一个魔法数字。
function _layerZ() {
  let max = 0
  let el = rootRef.value
  while (el && el !== document.body && el !== document.documentElement) {
    const z = parseInt(window.getComputedStyle(el).zIndex, 10)
    if (!Number.isNaN(z) && z > max) max = z
    el = el.parentElement
  }
  return Math.max(10010, max + 10)
}

function move(step) {
  if (!open.value) { open.value = true; return }
  const n = list.value.length
  if (!n) return
  let i = hoverIdx.value
  do { i = (i + step + n) % n } while (list.value[i].disabled && i !== hoverIdx.value)
  hoverIdx.value = i
}

function commit(i) {
  const opt = list.value[i]
  if (!opt || opt.disabled) return
  emit('update:modelValue', opt.value)
  emit('change', opt.value)
  open.value = false
}

function onDocClick(e) {
  if (open.value && rootRef.value && !rootRef.value.contains(e.target)) open.value = false
}

// 滚动/resize 后按触发器新位置重排菜单；触发器滚出视口则直接收起
function onViewportChange() {
  if (!open.value) return
  const rect = rootRef.value?.getBoundingClientRect()
  if (!rect) return
  if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
    open.value = false
    return
  }
  menuPos.value = { left: rect.left, top: rect.bottom + 4, width: rect.width }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
})
</script>