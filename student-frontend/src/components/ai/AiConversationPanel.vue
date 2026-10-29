<template>
  <!-- 会话抽屉：浮在聊天区左侧的毛玻璃卡片。
       玻璃配方（背景模糊 + 顶部受光高光 + 发光描边 + 主题卡片圆角）与弹窗卡片一致，
       且必须和滑入动画落在「同一个元素」上（.conv-panel 自身承载 .bg-surface）：
       若把 blur 放在子层、transform 放在父层，父级的 transform/opacity 会形成
       backdrop-filter 的 backdrop root，子层模糊在移动时会采样不到背后内容而被丢掉。
       position 由下方 scoped 样式强制为 absolute，压掉 .bg-surface 自带的 relative。 -->
  <div class="conv-panel absolute top-3 left-3 bottom-3 w-64 max-w-[85%] bg-surface border border-border shadow-md overflow-hidden">
    <div class="flex flex-col min-h-0 h-full w-full">
      <div class="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-border flex-shrink-0">
        <span class="text-[13px] font-semibold text-text whitespace-nowrap leading-none">对话列表</span>
        <div class="flex items-center gap-1">
          <button
            @click="$emit('new')"
            :disabled="busy"
            class="text-text-muted hover:text-text text-lg leading-none cursor-pointer px-1.5 disabled:opacity-40"
            title="新建对话"
          >＋</button>
          <button class="dlg-close" title="收起对话列表" @click="$emit('close')">✕</button>
        </div>
      </div>
      <div class="conv-list flex-1 overflow-y-auto overflow-x-hidden min-h-0 space-y-1.5 p-2">
        <div
          v-for="conv in conversations"
          :key="conv.id"
          @click="$emit('select', conv.id)"
          class="flex items-center justify-between gap-2 px-2.5 py-2 cursor-pointer transition-theme group conv-r"
          :class="conv.id === activeId ? 'bg-primary/10 border border-primary' : 'hover:bg-surface-hover border border-transparent'"
        >
          <div class="min-w-0 flex-1">
            <div class="text-[13px] font-medium text-text truncate leading-snug">{{ conv.title }}</div>
            <div class="text-[11px] text-text-muted leading-snug mt-0.5">
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
          class="w-full text-center text-xs text-text-muted hover:text-text hover:bg-surface-hover transition-theme cursor-pointer py-2 conv-r"
          title="显示更早的会话"
        >加载更多历史对话（还有 {{ hiddenCount }} 条）</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatTime } from '../../composables/ai/aiMessages.js'

defineOptions({ name: 'AiConversationPanel' })
const props = defineProps({
  conversations: { type: Array, default: () => [] },
  activeId: { type: [Number, String], default: null },
  busy: { type: Boolean, default: false },
  hiddenCount: { type: Number, default: 0 },
})
defineEmits(['new', 'select', 'delete', 'close', 'load-more'])

// 会话总数（列表 + 尚未渲染的更早会话）：用于「暂无历史对话」空态判断
const totalCount = computed(() => {
  return props.conversations.length + props.hiddenCount
})
</script>

<style scoped>
/* 面板本体：position 必须保持 absolute（压掉 .bg-surface 自带的 relative），
   否则 Tailwind 的 top/left/bottom 会失效、抽屉落回文档流。
   选择器写成 .bg-surface.conv-panel 提高到 (0,3,0)：主题的 .bg-surface 也带 !important 且同为 (0,2,0)，
   而主题 CSS 是运行时动态注入、顺序会飘——不加特异性就会偶发被主题的白色/模糊盖回去。 */
.bg-surface.conv-panel {
  position: absolute !important;
  /* 背景模糊：比全站卡片略深，兼顾通透与玻璃质感 */
  backdrop-filter: blur(30px) saturate(1.2) !important;
  /* 白色底不透明度：0.5 让背后内容透出来被糊掉，保持玻璃感（过高会把模糊挡住，数值再大也看不出） */
  background-color: rgba(255, 255, 255, 0.5) !important;
  /* 极淡暖黄调：在玻璃底之上叠一层几乎不可察觉的暖色 */
  background-image: linear-gradient(rgba(255, 205, 130, 0.01), rgba(255, 205, 130, 0.01));
}

/* 抽屉内所有圆角（面板 / 会话条目 / 加载更多 / ＋、✕ 按钮）统一为「标题卡片、弹窗卡片」的主题表面圆角：
   --radius-surface 由各主题定义（glass/win11 = 20px，glass2 = 26px，基础 = 12px，极简 = 0）。
   !important 用于压掉毛玻璃主题给 button 的皮肤与 .dlg-close 的默认档。 */
.conv-r,
.conv-panel,
.conv-panel button {
  border-radius: var(--radius-surface) !important;
}
</style>
