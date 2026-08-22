<template>
  <div class="leave-timeline bg-surface border border-border rounded-xl p-5">
    <!-- 标题 -->
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-base font-bold text-text">🗓️ 请假时间轴</h3>
    </div>

    <!-- 筛选区 -->
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <input
        v-model.trim="keyword"
        type="text"
        placeholder="按学生姓名筛选"
        class="px-3 py-1.5 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary w-48"
      />
      <select
        v-model="filterType"
        class="px-3 py-1.5 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary"
      >
        <option value="">全部类型</option>
        <option v-for="t in typeOptions" :key="t" :value="t">{{ t }}</option>
      </select>
      <select
        v-model="filterNode"
        class="px-3 py-1.5 text-sm rounded-lg bg-surface-hover border border-border focus:outline-none focus:border-primary"
      >
        <option value="">全部事件</option>
        <option v-for="n in NODE_TYPES" :key="n.value" :value="n.value">{{ n.label }}</option>
      </select>
    </div>

    <!-- 时间轴 -->
    <div class="timeline" v-if="visibleNodes.length">
      <div
        v-for="node in visibleNodes"
        :key="node.key"
        class="timeline-row"
      >
        <div class="timeline-marker" :class="`marker-${node.type}`"></div>
        <div class="timeline-item" :class="`item-${node.type}`">
          <div class="text-xs text-text-muted mb-0.5">{{ node.time }}</div>
          <div class="text-sm text-text">{{ node.text }}</div>
          <span class="inline-block mt-1 px-2 py-0.5 rounded text-xs" :class="badgeClass(node.type)">
            {{ nodeTypeLabel(node.type) }}
          </span>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="text-center text-text-muted py-8 text-sm">暂无匹配的时间轴记录</div>
  </div>
</template>

<script>
export default {
  name: 'LeaveTimeline',
  props: {
    // 节点结构：{ type: 'apply'|'leave'|'return', time: '2026-08-15 07:30', text: 'xxx 请假 病假', category: '病假', key: 唯一标识 }
    nodes: { type: Array, default: () => [] },
    // 请假类型选项（用于筛选）
    typeOptions: { type: Array, default: () => [] }
  },
  data() {
    return {
      keyword: '',
      filterType: '',
      filterNode: '',
      NODE_TYPES: [
        { value: 'apply', label: '已申请', color: 'info' },
        { value: 'leave', label: '离开校园', color: 'danger' },
        { value: 'return', label: '返校', color: 'success' }
      ]
    };
  },
  computed: {
    visibleNodes() {
      const kw = this.keyword.toLowerCase();
      const type = this.filterType;
      const node = this.filterNode;
      return this.nodes
        .filter(n => {
          if (kw && !n.text.toLowerCase().includes(kw)) return false;
          if (type && n.category !== type) return false;
          if (node && n.type !== node) return false;
          return true;
        })
        .slice()
        .sort((a, b) => String(b.time).localeCompare(String(a.time)));
    }
  },
  methods: {
    nodeTypeLabel(type) {
      const t = this.NODE_TYPES.find(n => n.value === type);
      return t ? t.label : type;
    },
    badgeClass(type) {
      if (type === 'apply') return 'bg-info/10 text-info';
      if (type === 'return') return 'bg-success/10 text-success';
      return 'bg-danger/10 text-danger';
    }
  }
};
</script>

<style scoped>
.timeline {
  position: relative;
  padding-left: 15px;
  max-height: 420px;
  overflow-y: auto;
}
.timeline::before {
  content: '';
  position: absolute;
  left: 21px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--color-border, rgba(0, 0, 0, 0.12));
  border-radius: 2px;
}
.timeline-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 0 18px;
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
.marker-apply { color: var(--color-primary, #3b82f6); background: var(--color-primary, #3b82f6); }
.marker-return { color: #16a34a; background: #16a34a; }
.marker-leave { color: #dc2626; background: #dc2626; }
.timeline-item {
  flex: 1;
  min-width: 0;
  background: var(--color-surface-hover, rgba(255, 255, 255, 0.5));
  border: 1px solid var(--color-border, rgba(0, 0, 0, 0.08));
  border-radius: 10px;
  padding: 8px 12px;
}
.item-leave { border-left: 3px solid #dc2626; }
.item-apply { border-left: 3px solid var(--color-primary, #3b82f6); }
.item-return { border-left: 3px solid #16a34a; }
</style>