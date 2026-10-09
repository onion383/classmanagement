<template>
  <!-- 高度过渡容器：展开/收起时 grid-template-rows 平滑过渡，使下方表格平滑下移/上移而非瞬移 -->
  <div class="search-panel-collapse mb-3" :class="{ open: shown }">
    <div class="search-panel-collapse__inner">
      <transition name="search-pop">
        <div v-if="shown" class="search-panel p-2 flex items-center gap-2">
          <span class="text-sm">搜索</span>
          <!-- 可切换列的下拉框：传了 fields 时用下拉 + 输入框；否则退化为旧式固定列名标签 -->
          <template v-if="hasFields">
            <AppSelect
              :model-value="searchField"
              :options="fieldOptions"
              placeholder="选择列"
              compact
              class="w-40"
              @update:model-value="v => $emit('update:searchField', v)"
            />
          </template>
          <template v-else>
            <label class="text-sm">「{{ searchField }}」：</label>
          </template>
          <input
            :value="text"
            @input="onInput"
            placeholder="输入关键字..."
            class="w-48 border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-info"
          />
          <button @click="$emit('close')" class="bg-surface-hover border border-border px-2 py-1 text-sm rounded cursor-pointer hover:bg-border text-text">取消</button>
        </div>
      </transition>
    </div>
  </div>
</template>

<script>
import AppSelect from './AppSelect.vue'
export default {
  name: 'SearchBar',
  components: { AppSelect },
  props: {
    searchField: String,
    keyword: String,
    // 可选列清单：传入则用下拉切换搜索列；不传保持旧的固定「搜索当前列」展示
    fields: { type: Array, default: () => [] },
    // 面板显隐控：不传时向后兼容——由 searchField 是否存在决定显示
    visible: { type: Boolean, default: undefined }
  },
  emits: ['update:keyword', 'update:searchField', 'close'],
  data() {
    return {
      // 本地输入文本：避免父级因搜索结果变化而每击键重渲染时，反复把受控 value 写回 DOM，
      // 导致输入框在 Chromium/Electron（尤其中文输入法）下失焦/光标跳位。
      text: (this.keyword ?? '') || ''
    }
  },
  watch: {
    // 仅当父层值变化（如选列后清空）才同步本地文本；击键时本地 text 已等同父值，不重复写回
    keyword(v) {
      if (v !== this.text) this.text = v ?? ''
    }
  },
  methods: {
    onInput(e) {
      this.text = e.target.value
      this.$emit('update:keyword', e.target.value)
    }
  },
  computed: {
    hasFields() {
      return (this.fields || []).length > 0
    },
    fieldOptions() {
      return this.fields.map(f => {
        // 支持字符串列，也支持字段对象（{name,type,...}）——取 name 作为下拉值
        const name = typeof f === 'string' ? f : (f.name ?? f.label ?? String(f))
        return { value: name, label: name }
      })
    },
    shown() {
      // 父组件显式传 visible 时以其为准（“点搜索按钮弹出”模式）；否则回退旧逻辑
      return this.visible !== undefined ? this.visible : !!this.searchField
    }
  }
}
</script>

<style scoped>
/* 高度过渡容器：用 grid 0fr→1fr 平滑展开/收起高度，下方表格随之平滑下移/上移（而非瞬移挤动） */
.search-panel-collapse {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.14s cubic-bezier(0.32, 0.72, 0.24, 1);
}
.search-panel-collapse.open {
  grid-template-rows: 1fr;
}
.search-panel-collapse__inner {
  overflow: hidden;
  min-height: 0;
}
/* 面板本身淡入（轻微下滑） */
.search-pop-enter-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.search-pop-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
/* 收起时只淡出，高度收拢交给上面的 grid 过渡，避免两条位移动画打架 */
.search-pop-leave-active {
  transition: opacity 0.14s ease;
}
.search-pop-leave-to {
  opacity: 0;
}
/* 让列下拉的触发区高度与右侧输入框一致（text-sm py-1） */
.search-panel :deep(.av-select__trigger) {
  padding: 4px 10px;
  min-height: 0;
}
</style>