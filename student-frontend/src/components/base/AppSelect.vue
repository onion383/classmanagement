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

<script>
// 自定义下拉框：替代原生 <select>，适配圆角 + 毛玻璃 + 点击过渡动画。
// 用法：
//   <AppSelect v-model="xxx" :options="[{value:'a', label:'A'}, 'B']" placeholder="请选择" />
import '../../styles/select.css'
import { ChevronDown, Check } from '@lucide/vue'

export default {
  name: 'AppSelect',
  components: { ChevronDown, Check },
  props: {
    modelValue: { type: [String, Number], default: '' },
    // 支持字符串数组：['A','B']；或对象数组：[{value, label, disabled}]，省略 value 时取 label 本身。
    options: { type: Array, default: () => [] },
    placeholder: { type: String, default: '请选择' },
    disabled: { type: Boolean, default: false },
    // 紧凑模式：缩小 trigger 高度，用于标题条等高度受限场景
    compact: { type: Boolean, default: false }
  },
  emits: ['update:modelValue', 'change'],
  data() {
    return { open: false, hoverIdx: -1, menuPos: { left: 0, top: 0, width: 0 } }
  },
  computed: {
    list() {
      return this.options.map(o => {
        if (o && typeof o === 'object') return { value: o.value ?? o.label, label: o.label, disabled: !!o.disabled }
        return { value: o, label: String(o), disabled: false }
      })
    },
    resolved() {
      return this.list.find(o => o.value === this.modelValue) || null
    },
    display() {
      if (this.resolved) return this.resolved.label
      if (this.modelValue !== '' && this.modelValue != null) return String(this.modelValue)
      return this.placeholder
    },
    menuStyle() {
      if (!this.open) return {}
      // Teleport 到 body 后无法继承父级字号，主动读取组件自身字号同步给菜单
      const fs = this.$refs.rootRef && getComputedStyle(this.$refs.rootRef).fontSize
      const style = {
        position: 'fixed',
        left: this.menuPos.left + 'px',
        top: this.menuPos.top + 'px',
        width: this.menuPos.width + 'px',
        minWidth: '120px',
        zIndex: 10010,
      }
      if (fs) style.fontSize = fs
      return style
    }
  },
  methods: {
    toggle() {
      if (this.disabled) return
      this.open = !this.open
      this.hoverIdx = this.open ? this.list.findIndex(o => o.value === this.modelValue) : -1
      if (this.open) {
        const rect = this.$refs.rootRef?.getBoundingClientRect()
        if (rect) {
          this.menuPos = { left: rect.left, top: rect.bottom + 4, width: rect.width }
        }
      }
    },
    move(step) {
      if (!this.open) { this.open = true; return }
      const n = this.list.length
      if (!n) return
      let i = this.hoverIdx
      do { i = (i + step + n) % n } while (this.list[i].disabled && i !== this.hoverIdx)
      this.hoverIdx = i
    },
    commit(i) {
      const opt = this.list[i]
      if (!opt || opt.disabled) return
      this.$emit('update:modelValue', opt.value)
      this.$emit('change', opt.value)
      this.open = false
    },
    onDocClick(e) {
      if (this.open && this.$refs.rootRef && !this.$refs.rootRef.contains(e.target)) this.open = false
    }
  },
  mounted() { document.addEventListener('click', this.onDocClick) },
  beforeUnmount() { document.removeEventListener('click', this.onDocClick) }
}
</script>