<template>
  <!-- 表头筛选面板：Teleport 到 body 后自己定位，避免被表格容器/弹窗的 overflow 裁剪 -->
  <div
    ref="panel"
    class="dtf-panel"
    :style="posStyle"
    @click.stop
    @mousedown.stop
    @contextmenu.stop.prevent
  >
    <!-- 排序：降序 / 升序（只读表不接收 toggleSort，故不显示） -->
    <div v-if="!readonly" class="dtf-sort">
      <button
        type="button"
        class="dtf-sort-btn"
        :class="{ 'is-on': sortOrder === 'desc' }"
        @click="$emit('sort', 'desc')"
      >
        <ArrowDown :size="13" stroke-width="2" />
        <span>降序</span>
      </button>
      <button
        type="button"
        class="dtf-sort-btn"
        :class="{ 'is-on': sortOrder === 'asc' }"
        @click="$emit('sort', 'asc')"
      >
        <ArrowUp :size="13" stroke-width="2" />
        <span>升序</span>
      </button>
    </div>

    <!-- 搜索框：只搜「下面这份值列表」，不改变数据筛选结果 -->
    <div class="dtf-search">
      <Search class="dtf-search-icon" :size="13" stroke-width="2" />
      <input
        ref="kw"
        v-model="keyword"
        class="dtf-search-input"
        :placeholder="'搜索' + (field === 'id' ? 'ID' : field) + '的值'"
        autocomplete="off"
        @keydown.enter.prevent="onEnter"
        @keydown.esc.prevent="$emit('close')"
      />
      <button v-if="keyword" type="button" class="dtf-search-clear" title="清空搜索" @click="keyword = ''">
        <X :size="11" stroke-width="2.6" />
      </button>
    </div>

    <!-- 搜索结果：值 + 出现次数 + 勾选态 -->
    <div class="dtf-list">
      <button
        v-for="(opt, i) in shownOptions"
        :key="opt.value"
        type="button"
        class="dtf-item"
        :class="{ 'is-on': opt.selected }"
        :style="{ '--i': i }"
        @click="$emit('toggle', opt.value)"
      >
        <span class="dtf-item-label">{{ displayValue(opt.value) }}</span>
        <span class="dtf-item-count">({{ opt.count }})</span>
        <Check class="dtf-item-check" :size="13" stroke-width="2.6" />
      </button>
      <p v-if="!shownOptions.length" class="dtf-none">{{ keyword ? '没有匹配的值' : '没有可选的值' }}</p>
    </div>

    <div class="dtf-foot">
      <span class="dtf-foot-info">已选 {{ selectedCount }}/{{ options.length }}</span>
      <button type="button" class="dtf-foot-btn" @click="$emit('clear')">清除筛选</button>
    </div>
  </div>
</template>

<script>
// 表头筛选面板（DynamicTable 专用）
// 职责：展示「排序 / 值搜索 / 值复选」三块，并把用户操作抛给 DynamicTable 处理；
// 自身只负责定位、关键字过滤与过渡动画，不持有筛选状态。
// 样式不走独立 css：基础样式在 styles/index.css，毛玻璃/夜间覆盖在各主题 css 里。
import { Search, Check, ArrowUp, ArrowDown, X } from '@lucide/vue'

const PANEL_W = 268

export default {
  name: 'ColumnFilter',
  components: { Search, Check, ArrowUp, ArrowDown, X },
  props: {
    field: { type: String, default: '' },
    // [{ value, count, selected }]
    options: { type: Array, default: () => [] },
    sortOrder: { type: String, default: '' },
    readonly: { type: Boolean, default: false },
    anchorEl: { type: Object, default: null }
  },
  emits: ['sort', 'toggle', 'clear', 'close'],
  data() {
    // 先放在屏幕外：mounted 里量出真实高度后再定位，避免出现一帧贴在左上角
    return { keyword: '', pos: { left: -9999, top: -9999 }, z: 10020 }
  },
  computed: {
    // 关键字只过滤「值列表」，纯前端过滤，不触发数据筛选
    shownOptions() {
      const kw = this.keyword.trim().toLowerCase()
      if (!kw) return this.options
      return this.options.filter(o => this.displayValue(o.value).toLowerCase().includes(kw))
    },
    selectedCount() { return this.options.filter(o => o.selected).length },
    posStyle() { return { left: this.pos.left + 'px', top: this.pos.top + 'px', zIndex: this.z } }
  },
  mounted() {
    this.place()
    // 打开即聚焦搜索框：直接开打要筛的值
    this.$nextTick(() => { if (this.$refs.kw) this.$refs.kw.focus() })
    window.addEventListener('resize', this.onViewportChange)
  },
  beforeUnmount() { window.removeEventListener('resize', this.onViewportChange) },
  methods: {
    displayValue(v) { return v === '' ? '（空白）' : v },
    // 面板贴在触发按钮下方；下方空间不足则翻到上方，左右夹在视口内
    place() {
      const el = this.$refs.panel
      const h = el ? el.offsetHeight : 260
      const a = this.anchorEl
      let left = Math.round((window.innerWidth - PANEL_W) / 2)
      let top = 96
      if (a && typeof a.getBoundingClientRect === 'function') {
        const r = a.getBoundingClientRect()
        left = Math.min(Math.max(8, r.right - PANEL_W), Math.max(8, window.innerWidth - PANEL_W - 8))
        top = r.bottom + 6
        if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6)
      }
      this.pos = { left, top }
      this.z = this._layerZ()
    },
    // 层级：从触发按钮往上取祖先里最大的 z-index 再叠一层，保证压过包住表格的弹窗/浮层
    _layerZ() {
      let max = 0
      let el = this.anchorEl
      while (el && el !== document.body && el !== document.documentElement) {
        const z = parseInt(window.getComputedStyle(el).zIndex, 10)
        if (!Number.isNaN(z) && z > max) max = z
        el = el.parentElement
      }
      return Math.max(10020, max + 10)
    },
    onViewportChange() { this.$emit('close') },
    // 只剩一个匹配值时，回车直接勾选，省一次点击
    onEnter() {
      if (this.shownOptions.length === 1) this.$emit('toggle', this.shownOptions[0].value)
    }
  }
}
</script>
