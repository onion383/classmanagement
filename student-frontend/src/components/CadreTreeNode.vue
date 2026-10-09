<template>
  <div class="cadre-node">
    <!-- 职务卡片 -->
    <div class="cadre-card" :class="isRoot ? 'cadre-card-root' : ''">
      <div class="cadre-card-head">
        <span class="cadre-name">{{ node.name }}</span>
        <span class="cadre-count">{{ node.members.length }}/{{ node.max_count }}</span>
        <div class="cadre-actions" v-if="!readonly">
          <button class="act" title="添加成员" @click="$emit('add-member', node)">＋</button>
          <button class="act" v-if="!isRoot" title="添加下级" @click="$emit('add-child', node)">⬇</button>
          <button class="act" title="编辑职务" @click="$emit('edit', node)">✎</button>
          <button class="act danger" title="删除职务" @click="$emit('remove', node)">×</button>
        </div>
      </div>
      <!-- 担任学生 -->
      <div class="cadre-members" v-if="node.members && node.members.length">
        <span v-for="m in node.members" :key="m.id" class="member-chip">
          {{ m.student_name }}
          <button v-if="!readonly" class="chip-x" title="移除" @click="$emit('remove-member', node, m)">×</button>
        </span>
      </div>
      <div v-else class="cadre-empty">暂无担任学生</div>
    </div>

    <!-- 子节点 -->
    <div class="branch" v-if="node.children && node.children.length">
      <div class="branch-v">
        <div class="branch-h"></div>
      </div>
      <div class="cadre-children">
        <div class="child" v-for="child in node.children" :key="child.id">
          <div class="child-v"></div>
          <CadreTreeNode
            :node="child"
            :all-students="allStudents"
            :readonly="readonly"
            @add-member="$emit('add-member', $event)"
            @add-child="$emit('add-child', $event)"
            @edit="$emit('edit', $event)"
            @remove="$emit('remove', $event)"
            @remove-member="$emit('remove-member', $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'CadreTreeNode',
  props: {
    node: { type: Object, required: true },
    allStudents: { type: Array, default: () => [] },
    readonly: { type: Boolean, default: false }
  },
  computed: {
    isRoot() {
      const p = Number(this.node.parent_id);
      return !p;
    }
  }
};
</script>

<style scoped>
.cadre-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 11rem;
}
.cadre-card {
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #e5e7eb);
  border-left: 3px solid var(--color-primary, #3b82f6);
  border-radius: 12px;
  padding: 8px 12px;
  min-width: 11rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  position: relative;
  z-index: 1;
}
.cadre-card-root {
  border-left-color: var(--color-info, #3b82f6);
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(147, 197, 253, 0.18));
  border-color: rgba(147, 197, 253, 0.6);
}
.cadre-card-root .cadre-name { color: var(--color-text, #1f2937); }
.cadre-card-root .cadre-count { color: var(--color-text-muted, #6b7280); }
.cadre-card-root .act { color: var(--color-text-secondary, #6b7280); }
.cadre-card-root .act:hover { background: var(--color-surface-hover, #f3f4f6); color: var(--color-info, #3b82f6); }
.cadre-card-root .cadre-members .member-chip {
  background: color-mix(in srgb, var(--color-info, #3b82f6) 10%, transparent);
  color: var(--color-info, #3b82f6);
}
.cadre-card-root .cadre-empty { color: var(--color-text-muted, #9ca3af); }

.cadre-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cadre-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text, #1f2937);
  white-space: nowrap;
}
.cadre-count {
  font-size: 11px;
  color: var(--color-text-muted, #6b7280);
  white-space: nowrap;
}
.cadre-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}
.act {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--color-text-secondary, #6b7280);
  border-radius: 5px;
  font-size: 13px;
  cursor: pointer;
  line-height: 1;
}
.act:hover { background: var(--color-surface-hover, #f3f4f6); color: var(--color-primary, #3b82f6); }
.act.danger:hover { background: var(--color-danger, #ef4444); color: #fff; }
.cadre-card-root .act.danger:hover { background: var(--color-danger, #ef4444); }

.cadre-members {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.member-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--color-primary, #3b82f6) / 10;
  background: color-mix(in srgb, var(--color-primary, #3b82f6) 10%, transparent);
  color: var(--color-primary, #3b82f6);
  font-size: 12px;
  padding: 1px 6px;
  border-radius: 999px;
}
.chip-x {
  border: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.65;
}
.chip-x:hover { opacity: 1; }
.cadre-empty {
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-text-muted, #9ca3af);
}

/* 连线区 */
.branch {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}
.branch-v {
  width: 100%;
  display: flex;
  justify-content: center;
}
.branch-v::before {
  content: '';
  width: 2px;
  height: 22px;
  background: var(--color-border, #cbd5e1);
}
.branch-h {
  height: 2px;
  flex: 1;
  max-width: 100%;
  background: var(--color-border, #cbd5e1);
  align-self: flex-start;
  margin-top: -14px;
}
.cadre-children {
  display: flex;
  justify-content: center;
  gap: 24px;
  padding-top: 0;
}
.child {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.child-v {
  width: 2px;
  height: 22px;
  background: var(--color-border, #cbd5e1);
}
</style>