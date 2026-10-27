<template>
  <div class="leave-timeline bg-surface border border-border rounded-xl p-5" :class="{ 'tl-fill': fillHeight }">
    <!-- 标题（title 为空时不渲染，供页面把标题外置为子标题） -->
    <div v-if="title" class="flex items-center justify-between mb-4">
      <h3 class="text-base font-bold text-text">{{ title }}</h3>
    </div>

    <!-- 筛选区 -->
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <input
        v-model.trim="keyword"
        type="text"
        placeholder="按学生姓名筛选"
        class="px-3 py-1.5 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary w-48"
      />
      <div class="w-32"><AppSelect v-model="filterType" :options="filterTypeOptions" /></div>
      <div class="w-32"><AppSelect v-model="filterNode" :options="filterNodeOptions" /></div>
    </div>

    <!-- 时间轴 -->
    <div class="timeline" v-if="visibleNodes.length" :style="fillHeight ? null : { maxHeight: maxHeight + 'px' }">
      <div
        v-for="node in visibleNodes"
        :key="node.key"
        :data-row-id="node.key"
        class="timeline-row content-visibility-auto"
      >
        <div class="timeline-marker" :style="markerStyle(node)"></div>
        <!-- 右侧对齐模式（加分/扣分标签与操作按钮放右侧） -->
        <div v-if="alignRight" class="timeline-item flex" :style="itemStyle(node)">
          <div class="min-w-0 flex-1">
            <div class="text-xs text-text-muted mb-0.5">{{ node.time }}</div>
            <slot name="content" :node="node">
              <div class="text-sm text-text">{{ node.text }}</div>
            </slot>
          </div>
          <div class="flex items-center gap-2 shrink-0 self-center">
            <span class="px-2 py-0.5 rounded text-xs" :class="badgeClass(node)">
              {{ nodeTypeLabel(node.type) }}
            </span>
            <slot name="ops" :node="node" />
          </div>
        </div>
        <!-- 默认模式：内容上下堆叠，标签在下方 -->
        <template v-else>
          <div class="timeline-item" :style="itemStyle(node)">
            <div class="text-xs text-text-muted mb-0.5">{{ node.time }}</div>
            <div class="text-sm text-text">{{ node.text }}</div>
            <span class="inline-block mt-1 px-2 py-0.5 rounded text-xs" :class="badgeClass(node)">
              {{ nodeTypeLabel(node.type) }}
            </span>
            <slot name="ops" :node="node" />
          </div>
        </template>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="text-center text-text-muted py-8 text-sm">暂无匹配的时间轴记录</div>
  </div>
</template>

<script>
import AppSelect from './AppSelect.vue'
import { zhCollator } from '../../utils/collator.js'

export default {
  name: 'LeaveTimeline',
  components: { AppSelect },
  props: {
    // 节点结构：{ type, time, text, category, key }，type 对应 nodeTypes 里的 value
    nodes: { type: Array, default: () => [] },
    // 请假类型选项（用于筛选）
    typeOptions: { type: Array, default: () => [] },
    // 标题
    title: { type: String, default: '🗓️ 请假时间轴' },
    // 右侧对齐：把类型标签与操作按钮放到右侧（业务时间轴如加分/扣分使用）
    alignRight: { type: Boolean, default: false },
    // 时间轴列表最大高度（px），默认 420，业务方可按需调高
    maxHeight: { type: Number, default: 420 },
    // 撑满外层容器高度：外层给固定高度时，卡片与时间轴区域一起填满（用于和表格同高切换）
    fillHeight: { type: Boolean, default: false },
    // 节点类型配置：{ value, label, colorKey: 'info'|'success'|'danger', color: hex }
    nodeTypes: {
      type: Array,
      default: () => [
        { value: 'apply', label: '已申请', colorKey: 'info', color: '#3b82f6' },
        { value: 'leave', label: '离开校园', colorKey: 'danger', color: '#dc2626' },
        { value: 'return', label: '返校', colorKey: 'success', color: '#16a34a' }
      ]
    }
  },
  data() {
    return {
      keyword: '',
      filterType: '',
      filterNode: ''
    };
  },
  computed: {
    filterTypeOptions() {
      return [{ value: '', label: '全部类型' }, ...this.typeOptions];
    },
    filterNodeOptions() {
      return [{ value: '', label: '全部事件' }, ...this.nodeTypes];
    },
    visibleNodes() {
      const kw = this.keyword.toLowerCase();
      const type = this.filterType;
      const node = this.filterNode;
      return this.nodes
        .filter(n => {
          if (kw) {
            const haystack = Object.values(n).map(v => String(v || '')).join(' ').toLowerCase();
            if (!haystack.includes(kw)) return false;
          }
          if (type && n.category !== type) return false;
          if (node && n.type !== node) return false;
          return true;
        })
        .slice()
        .sort((a, b) => zhCollator.compare(String(b.time), String(a.time)));
    }
  },
  methods: {
    nodeTypeLabel(type) {
      const t = this.nodeTypes.find(n => n.value === type);
      return t ? t.label : type;
    },
    nodeColor(node) {
      const t = this.nodeTypes.find(n => n.value === node.type);
      return t ? t.color : '#9ca3af';
    },
    markerStyle(node) {
      const c = this.nodeColor(node);
      return { color: c, background: c };
    },
    itemStyle(node) {
      return { borderLeftColor: this.nodeColor(node) };
    },
    badgeClass(node) {
      const t = this.nodeTypes.find(n => n.value === node.type);
      const map = { info: 'bg-info/10 text-info', success: 'bg-success/10 text-success', danger: 'bg-danger/10 text-danger', muted: 'bg-surface-hover text-text-secondary border border-border' };
      return map[t && t.colorKey] || map.info;
    }
  }
};
</script>

<style scoped>
.timeline {
  position: relative;
  padding-left: 16px;
  max-height: 420px;
  overflow-y: auto;
}
/* fillHeight：卡片撑满外层，时间轴区域吃掉剩余高度并内部滚动（与表格同高切换时不跳动） */
.tl-fill {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.tl-fill .timeline {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
}
.timeline::before {
  content: '';
  position: absolute;
  left: 28px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--color-border, rgba(0, 0, 0, 0.12));
  border-radius: var(--radius-xs);
}
.timeline-row {
  position: relative;
  display: flex;
  align-items: center;
  /* 行内留出左侧内边距：行带 content-visibility:auto（绘制裁剪），
     圆点外圈描边必须落在行盒子内，否则会被裁掉 */
  padding: 0 0 18px 6px;
  gap: 2px;
}
.timeline-row:last-child {
  padding-bottom: 4px;
}
.timeline-marker {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 3px solid var(--color-surface, #ffffff);
  box-shadow: 0 0 0 2px currentColor;
}
.timeline-item {
  flex: 1;
  min-width: 0;
  background: var(--color-surface-hover, rgba(255, 255, 255, 0.5));
  border: 1px solid var(--color-border, rgba(0, 0, 0, 0.08));
  border-radius: var(--radius-control);
  padding: 8px 12px;
}
</style>