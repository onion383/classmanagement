<template>
  <!-- 左侧会话列表：可折叠（折叠后变成 1/2/3 数字栏），折叠状态写入 localStorage 记忆 -->
  <div
    class="conv-panel flex-shrink-0 bg-white/55 backdrop-blur-md ai-glass-panel border border-border rounded-card p-2 flex flex-col min-h-0"
    :class="collapsed ? 'w-12' : 'w-56'"
  >
    <div class="flex items-center mb-2" :class="collapsed ? 'w-8 justify-center' : 'justify-between px-1'">
      <span v-if="!collapsed" class="text-sm font-medium text-text whitespace-nowrap">对话列表</span>
      <button
        v-if="!collapsed"
        @click="$emit('new')"
        :disabled="busy"
        class="text-text-muted hover:text-text text-lg leading-none cursor-pointer disabled:opacity-40"
        title="新建对话"
      >＋</button>
      <button
        class="dlg-close"
        :title="collapsed ? '展开对话列表' : '收起对话列表'"
        @click="$emit('toggle-collapse')"
      >
        <PanelLeftOpen v-if="collapsed" :size="15" stroke-width="1.8" />
        <PanelLeftClose v-else :size="15" stroke-width="1.8" />
      </button>
    </div>
    <div v-if="!collapsed" class="conv-list flex-1 overflow-y-auto overflow-x-hidden min-h-0 space-y-1">
      <div
        v-for="conv in conversations"
        :key="conv.id"
        @click="$emit('select', conv.id)"
        class="flex items-center justify-between px-2 py-1.5 rounded-sm cursor-pointer transition-theme group"
        :class="conv.id === activeId ? 'bg-primary/10 border border-primary' : 'hover:bg-surface-hover border border-transparent'"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm text-text truncate">{{ conv.title }}</div>
          <div class="text-[10px] text-text-muted">
            {{ conv.msg_count }} 条消息 · {{ formatTime(conv.updated_at) }}
          </div>
        </div>
        <button
          @click.stop="$emit('delete', conv.id)"
          class="text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity text-sm leading-none px-1"
          title="删除对话"
        >✕</button>
      </div>
      <div v-if="!totalCount" class="text-center text-xs text-text-muted py-4">
        暂无历史对话
      </div>
      <!-- 默认只渲染最近 3 条，点这里每次多加载 10 条更早的会话。
           用 div 而非 button：与上面的会话条目同款外观（glass/win11 会给所有 button 加描边皮肤） -->
      <div
        v-if="hiddenCount > 0"
        @click="$emit('load-more')"
        class="w-full text-center text-xs text-text-muted hover:text-text hover:bg-surface-hover transition-theme cursor-pointer py-1.5 rounded-sm"
        title="显示更早的会话"
      >加载更多历史对话（还有 {{ hiddenCount }} 条）</div>
    </div>

    <!-- 折叠态：竖排数字钮（1、2、3…按列表顺序编号），点数字直接切换对话；
         悬停有 title 提示是哪条对话，当前对话用主色淡底 + 内描边标出 -->
    <div v-if="collapsed" class="conv-rail w-8 flex-1 overflow-y-auto overflow-x-hidden min-h-0 flex flex-col items-center gap-1">
      <button
        v-for="(conv, idx) in conversations"
        :key="conv.id"
        class="dlg-close conv-num"
        :class="{ 'conv-num-active': conv.id === activeId }"
        :title="conv.title"
        @click="$emit('select', conv.id)"
      >{{ idx + 1 }}</button>
      <div v-if="!totalCount" class="text-[10px] text-text-muted">无</div>
      <!-- 还有更早的会话：折叠态用「…」继续加载，点一次多出 10 个编号 -->
      <button
        v-if="hiddenCount > 0"
        class="dlg-close conv-num"
        title="加载更多历史对话"
        @click="$emit('load-more')"
      >…</button>
    </div>
  </div>
</template>

<style scoped>
/* ==================== 会话列表折叠 ====================
   展开=标题列表，折叠=数字栏，两种内容按需切换；容器宽度平滑过渡 + overflow 裁剪，
   避免宽度变化时内部重排造成的跳动。 */
.conv-panel {
  transition: width 0.15s ease;
  overflow: hidden;
}
/* 折叠态数字钮：尺寸沿用 .dlg-close（28px 方形毛玻璃、圆角跟随主题），数字小一档 */
.conv-num {
  font-size: 13px;
  font-weight: 600;
}
/* 当前对话：主色淡底 + 主色文字 + 内描边（用 inset 描边，避免被面板 overflow 裁掉） */
.conv-num-active {
  background: color-mix(in srgb, var(--color-primary) 20%, transparent) !important;
  color: var(--color-primary) !important;
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--color-primary) 45%, transparent) !important;
}
</style>

<script>
import { PanelLeftClose, PanelLeftOpen } from '@lucide/vue'
import { formatTime } from '../../composables/ai/aiMessages.js'

export default {
  name: 'AiConversationPanel',
  components: { PanelLeftClose, PanelLeftOpen },
  props: {
    conversations: { type: Array, default: () => [] },
    activeId: { type: [Number, String], default: null },
    collapsed: { type: Boolean, default: false },
    busy: { type: Boolean, default: false },
    hiddenCount: { type: Number, default: 0 },
  },
  emits: ['new', 'select', 'delete', 'toggle-collapse', 'load-more'],
  computed: {
    // 会话总数（列表 + 尚未渲染的更早会话）：用于「暂无历史对话 / 无」空态判断
    totalCount() {
      return this.conversations.length + this.hiddenCount
    },
  },
  methods: {
    formatTime,
  },
}
</script>
