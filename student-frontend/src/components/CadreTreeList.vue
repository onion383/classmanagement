<template>
  <div class="ctd-node">
    <!-- Windows 目录树风格的一行职务 -->
    <div
      class="ctd-row"
      :style="{ paddingLeft: (level * 22 + 6) + 'px' }"
      @click="onClickRow"
    >
      <button class="ctd-toggle" :class="{ leaf: !hasChildren }" @click.stop="toggle">
        <svg v-if="hasChildren" class="tri" :class="{ open: !collapsed }" viewBox="0 0 10 10">
          <path d="M3 2 L7 5 L3 8 Z" />
        </svg>
      </button>
      <!-- 文件夹 / 文件图标 -->
      <svg v-if="hasChildren" class="icon" :class="collapsed ? 'folder' : 'folder-open'" viewBox="0 0 16 16">
        <path fill="currentColor" d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3l1.5 1.5H13.5A1.5 1.5 0 0 1 15 5v6.5A1.5 1.5 0 0 1 13.5 13h-11A1.5 1.5 0 0 1 1 11.5v-8z" />
      </svg>
      <svg v-else class="icon file" viewBox="0 0 16 16">
        <path fill="currentColor" d="M4 1h5l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm5 1v4h4L9 2z" />
      </svg>

      <span class="ctd-name">{{ node.name }}</span>
      <span class="ctd-count">{{ node.members.length }}/{{ node.max_count }}</span>

      <!-- 行内操作 -->
      <span class="ctd-actions" @click.stop>
        <button title="添加下级" @click="$emit('add-child', node)">＋</button>
        <button title="重命名 / 改人数" @click="$emit('edit', node)">✎</button>
        <button title="成员管理" @click="$emit('add-member', node)">&#128101;</button>
        <button class="danger" title="删除" @click="$emit('remove', node)">×</button>
      </span>
    </div>

    <!-- 子节点 -->
    <div v-if="!collapsed && hasChildren" class="ctd-children">
      <CadreTreeList
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :all-students="allStudents"
        :level="level + 1"
        @add-child="$emit('add-child', $event)"
        @edit="$emit('edit', $event)"
        @remove="$emit('remove', $event)"
        @add-member="$emit('add-member', $event)"
        @remove-member="$emit('remove-member', $event)"
      />
    </div>
  </div>
</template>

<script>
export default {
  name: 'CadreTreeList',
  props: {
    node: { type: Object, required: true },
    allStudents: { type: Array, default: () => [] },
    level: { type: Number, default: 0 }
  },
  data() {
    return { collapsed: false }
  },
  computed: {
    hasChildren() {
      return !!(this.node.children && this.node.children.length)
    }
  },
  methods: {
    toggle() {
      if (this.hasChildren) this.collapsed = !this.collapsed
    },
    onClickRow() {
      if (this.hasChildren) this.collapsed = !this.collapsed
    }
  }
}
</script>

<style scoped>
.ctd-node {
  min-width: max-content;
}
.ctd-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding-right: 8px;
  border-radius: 6px;
  cursor: default;
  white-space: nowrap;
}
.ctd-row:hover {
  background: color-mix(in srgb, var(--color-info, #3b82f6) 8%, transparent);
}
.ctd-toggle {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
}
.ctd-toggle.leaf {
  cursor: default;
}
.tri path {
  fill: var(--color-text-muted, #6b7280);
}
.tri.open path {
  fill: var(--color-text, #1f2937);
}
.icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.folder {
  color: var(--color-warning, #d97706);
}
.folder-open {
  color: var(--color-info, #3b82f6);
}
.file {
  color: var(--color-text-muted, #9ca3af);
}
.ctd-name {
  font-size: 13px;
  color: var(--color-text, #1f2937);
}
.ctd-count {
  font-size: 12px;
  color: var(--color-text-muted, #6b7280);
  background: color-mix(in srgb, var(--color-info, #3b82f6) 8%, transparent);
  padding: 0 7px;
  border-radius: 999px;
  flex-shrink: 0;
}
.ctd-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 8px;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.ctd-row:hover .ctd-actions {
  opacity: 1;
}
.ctd-actions button {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--color-text-secondary, #6b7280);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
}
.ctd-actions button:hover {
  background: color-mix(in srgb, var(--color-info, #3b82f6) 14%, transparent);
  color: var(--color-info, #3b82f6);
}
.ctd-actions button.danger:hover {
  background: var(--color-danger, #ef4444);
  color: #fff;
}
</style>