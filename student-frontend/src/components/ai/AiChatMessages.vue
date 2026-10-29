<template>
  <div v-if="!messages.length" class="h-full flex items-center justify-center">
    <div class="text-center text-text-muted text-sm space-y-2">
      <div class="text-3xl">🤖</div>
      <div>你可以问我班级数据，例如：</div>
      <div class="space-y-1 text-xs">
        <div>「这个月班费支出了多少」</div>
        <div>「有多少同学在请病假」</div>
        <div>「新增一个学生 张三」</div>
      </div>
      <button v-if="!busy" @click="$emit('new')" class="text-info hover:underline">开始新对话</button>
    </div>
  </div>

  <template v-for="(m, i) in messages" :key="i">
  <!-- 自动反馈消息（回答提问 / 执行或取消提案）不作为用户气泡展示：其内容已写入原助手消息的思维链 -->
  <div v-if="!m._auto" class="flex" :class="m.role === 'user' ? 'justify-end' : 'justify-start'">
    <div :class="m.role === 'user' ? 'max-w-[80%] text-right' : 'w-full min-w-0'">
      <!-- 头像 + 名字放在正文上方同一行，正文占满整行宽度 -->
      <div v-if="m.role !== 'user'" class="mb-1.5 flex items-center gap-2.5 text-sm text-text">
        <span class="flex-shrink-0 w-7 h-7 rounded-full ai-glass-panel bg-white/55 backdrop-blur-md border border-border flex items-center justify-center text-primary">
          <IconGlyph name="ai" :size="16" tint="current" />
        </span>
        <span>AI小助手</span>
      </div>
      <div v-else class="mb-1.5 flex items-center justify-end">
        <span class="flex-shrink-0 w-7 h-7 rounded-full ai-glass-panel bg-white/55 backdrop-blur-md border border-border flex items-center justify-center text-text-muted">
          <IconGlyph name="user" :size="16" tint="current" />
        </span>
      </div>
      <!-- 用户消息中的图片 -->
      <div v-if="m.role === 'user' && m.images && m.images.length" class="mb-1.5 flex flex-wrap gap-1.5 justify-end">
        <img
          v-for="(img, idx) in m.images"
          :key="idx"
          :src="img"
          loading="lazy"
          class="max-w-48 max-h-36 rounded-lg border border-border object-cover"
        />
      </div>
      <div
        class="px-5 py-3.5 text-sm border"
        :class="m.role === 'user'
          ? 'user-bubble bg-primary text-text-inverse border-transparent whitespace-pre-wrap break-words'
          : 'assistant-bubble bg-surface text-text border-border whitespace-pre-wrap break-words'"
      >
        <!-- 处理过程（工具调用步骤 / 中间草稿 / 思维链）：流式展开，回答出现后自动收起 -->
        <div v-if="hasProcess(m)" class="mb-2.5 rounded-md bg-black/5 overflow-hidden">
          <button
            type="button"
            @click="m.processOpen = !m.processOpen"
            class="w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-text-muted hover:text-text cursor-pointer"
          >
            <span
              class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
              :class="m._live && !m.processDone ? 'bg-primary animate-pulse' : 'bg-text-muted/40'"
            ></span>
            <span class="min-w-0 truncate">{{ processTitle(m) }}</span>
            <span class="ml-auto flex-shrink-0 transition-transform duration-150" :class="m.processOpen ? 'rotate-180' : ''">▾</span>
          </button>
          <div v-if="m.processOpen" class="px-2.5 pb-2 space-y-1.5">
            <div v-if="m.reasoning" class="text-[13px] text-text-secondary whitespace-pre-wrap break-words max-h-40 overflow-auto">{{ m.reasoning }}</div>
            <div v-for="st in (m.steps || [])" :key="st.id" class="text-[13px] leading-6">
              <!-- 一级：思考 / 调用工具接口 的一行；带结果明细的工具步骤可点开做二级展开 -->
              <div
                class="flex items-start gap-1.5"
                :class="st.detail ? 'cursor-pointer hover:text-text' : ''"
                @click="st.detail && toggleStepDetail(st)"
              >
                <span class="flex-shrink-0 w-3.5 text-center" :class="stepClass(st)">{{ stepIcon(st) }}</span>
                <span v-if="st.kind === 'text' || st.kind === 'reason'" class="flex-1 min-w-0 whitespace-pre-wrap break-words" :class="st.kind === 'reason' ? 'text-text-secondary max-h-40 overflow-auto' : 'text-text-muted'">{{ st.text }}</span>
                <span v-else class="flex-1 min-w-0 text-text-muted">
                  <span :class="st.status === 'running' ? 'text-text-secondary' : ''">{{ st.title }}</span>
                  <span v-if="st.summary"> · {{ st.summary }}</span>
                  <span v-if="st.ms != null && st.status !== 'running'" class="text-text-muted/60"> · {{ stepSeconds(st) }}</span>
                </span>
                <span v-if="st.detail" class="flex-shrink-0 text-text-muted/60 transition-transform duration-150" :class="st._open ? 'rotate-180' : ''">▾</span>
              </div>
              <!-- 二级展开：工具返回的结果明细 -->
              <pre
                v-if="st.detail && st._open"
                class="mt-1 ml-5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs leading-5 text-text-secondary"
              >{{ st.detail }}</pre>
            </div>
          </div>
        </div>
        <span v-if="m.loading">思考中…</span>
        <template v-else-if="m.role === 'user'">
          <!-- 含文件内容的消息：显示文件标签 + 用户文字 -->
          <template v-if="m.content && m.content.startsWith('文件「')">
            <div class="flex items-center gap-1 text-primary/80 text-xs mb-1">
              <span class="text-xs">📄</span>
              <span class="font-medium truncate max-w-40">{{ extractFileName(m.content) }}</span>
            </div>
            <span>{{ extractUserText(m.content) || '（无内容）' }}</span>
          </template>
          <span v-else>{{ m.content || '（无内容）' }}</span>
        </template>
        <!-- 助手消息：拆成 markdown 片段（DOMPurify 清洗后渲染）、record 数据块（表格组件）与 chart 图表块 -->
        <template v-else-if="m._blocks">
          <template v-for="(b, bi) in m._blocks" :key="bi">
            <div v-if="b.type === 'md'" class="markdown-body whitespace-normal break-words" v-html="b.html"></div>
            <AiChart v-else-if="b.type === 'chart'" :data="b.data" />
            <AiRecordTable v-else :table="b.table" :ids="b.ids" />
          </template>
        </template>
        <!-- 流式输出中：已输出完的行即时按 markdown 渲染，未输出完的行先按纯文本占位 -->
        <template v-else-if="m._live">
          <div v-if="m._liveHtml" class="markdown-body whitespace-normal break-words" v-html="m._liveHtml"></div>
          <div v-if="m._liveTail" class="markdown-body whitespace-pre-wrap break-words"><AiStreamTail :text="m._liveTail" /></div>
        </template>
        <div v-else class="markdown-body whitespace-pre-wrap break-words">{{ m.content }}</div>
        <!-- 已开启推理但本次没收到思考内容 → 说明该模型/接口不返回思维链 -->
        <p
          v-if="m._live && m.role !== 'user' && !m.loading && activeReasoningOn && !m.reasoning && !hasReasonStep(m) && !m.proposal && m.content && !m.content.startsWith('⚠️')"
          class="mt-1 text-[10px] text-text-muted"
        >未返回思考内容 · 当前模型可能不支持思考模式</p>
      </div>
      <!-- 本轮数据/文件改动总结：折叠显示「改动了 N 个文件 +A -R」，点开逐项列出各表/各 md；
           右侧「↗」进右侧抽屉看明细（表格 / 网格 / 行级 diff）。撤回后整条消失。 -->
      <div v-if="changeSummary(m)" class="mt-2 rounded-lg border border-border overflow-hidden">
        <div
          class="flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer select-none transition-theme hover:bg-surface-hover"
          :title="m._changeOpen ? '收起明细' : '展开明细'"
          @click="toggleChangeOpen(m)"
        >
          <IconGlyph name="folder" :size="12" tint="current" class="text-text-muted flex-shrink-0" />
          <span class="text-text whitespace-nowrap">改动了 {{ changeSummary(m).total }} 个文件</span>
          <span class="text-success whitespace-nowrap">+{{ changeSummary(m).added }}</span>
          <span class="text-danger whitespace-nowrap">-{{ changeSummary(m).removed }}</span>
          <span class="ml-auto flex-shrink-0 text-text-muted transition-transform duration-150" :class="m._changeOpen ? 'rotate-180' : ''">▾</span>
          <button
            v-if="!floating"
            class="open-changes-btn ai-glass-panel bg-white/55 backdrop-blur-md border border-border rounded-sm px-2 py-1 text-text-muted hover:text-primary transition-theme cursor-pointer flex-shrink-0 leading-none"
            title="在右侧查看改动明细"
            @click.stop="$emit('open-changes', m)"
          >↗</button>
        </div>
        <div v-if="m._changeOpen" class="border-t border-border divide-y divide-border">
          <div v-for="it in changeSummary(m).items" :key="it.key" class="flex items-center gap-2 px-2.5 py-1.5 text-xs">
            <IconGlyph name="folder" :size="11" tint="current" class="text-text-muted flex-shrink-0" />
            <span class="text-text min-w-0 truncate" :title="it.label">{{ it.label }}</span>
            <span class="ml-auto text-success flex-shrink-0">+{{ it.added }}</span>
            <span class="text-danger flex-shrink-0">-{{ it.removed }}</span>
            <button
              v-if="canJumpItem(it)"
              class="text-[11px] leading-none px-2 py-1 flex-shrink-0 border border-border rounded-sm cursor-pointer text-text-muted hover:text-primary hover:border-primary transition-theme"
              title="跳转到该表"
              @click="$emit('goto', { table: tableOfItem(it), id: null })"
            >跳转</button>
          </div>
        </div>
      </div>
      <!-- 回复操作：复制 / 重试 / 撤回数据更改；右侧统计用时与 token（浮窗模式精简掉） -->
      <div v-if="m.role !== 'user' && !m.loading" class="mt-2 flex items-center gap-2 text-xs">
        <button
          @click="$emit('copy', m)"
          :disabled="!m.content"
          class="ai-glass-panel bg-white/55 backdrop-blur-md border border-border rounded-sm px-2.5 py-1 text-text-muted hover:text-primary transition-theme cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
          title="复制这条回复"
        ><IconGlyph name="clipboard" :size="12" tint="current" /> 复制</button>
        <button
          v-if="isRetryable(i)"
          @click="$emit('retry', i)"
          :disabled="busy"
          class="ai-glass-panel bg-white/55 backdrop-blur-md border border-border rounded-sm px-2.5 py-1 text-text-muted hover:text-primary transition-theme cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
          title="用上一条提问重新生成"
        ><IconGlyph name="refresh" :size="12" tint="current" /> 重试</button>
        <button
          v-if="m.proposal && (m.proposal.executed || m.proposal.reverted)"
          @click="$emit('undo', m)"
          :disabled="!canUndo(m) || busy"
          class="ai-glass-panel bg-white/55 backdrop-blur-md border border-border rounded-sm px-2.5 py-1 text-text-muted hover:text-danger transition-theme cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
          :title="m.proposal.reverted ? '已撤回这次数据更改' : '撤回这次对数据的更改'"
        ><IconGlyph name="undo" :size="12" tint="current" /> {{ m.proposal.reverted ? '已撤回' : '撤回更改' }}</button>
        <button
          v-if="isRollbackable(i)"
          @click="$emit('rollback')"
          :disabled="busy"
          class="ai-glass-panel bg-white/55 backdrop-blur-md border border-border rounded-sm px-2.5 py-1 text-text-muted hover:text-warning transition-theme cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
          title="回退到本轮提问前：还原本轮的数据更改，并把这条提问放回输入框"
        ><IconGlyph name="rollback" :size="12" tint="current" /> 回退</button>
        <span v-if="m.interrupted" class="ai-glass-panel bg-white/55 backdrop-blur-md border border-border rounded-sm px-2 py-0.5 text-text-muted inline-flex items-center gap-1.5">
          <span class="stop-mark"></span> 已中断
        </span>
        <span v-if="!floating && (m.processMs || m.tokens)" class="ml-auto text-text-muted/80 flex items-center gap-3 whitespace-nowrap">
          <span v-if="m.processMs">用时 {{ (m.processMs / 1000).toFixed(1) }}s</span>
          <span v-if="tokenSpeed(m) != null" title="生成速度：输出 tokens ÷ 耗时">{{ tokenSpeed(m).toFixed(1) }} tokens/s</span>
          <span v-if="m.tokens" :title="`输入 ${m.promptTokens} · 输出 ${m.completionTokens}`">{{ m.tokens }} tokens</span>
        </span>
      </div>
    </div>
  </div>
  </template>
</template>

<style scoped>
/* 对话气泡圆角：提问框右下角小圆，回答框左下角小圆（镜像对称）。
   主体走 --radius-surface（气泡是浮层角色）；尾巴那一角取「主体 − 间距」的同心值，
   保证尾巴收口与主体圆弧同源，改主题时二者一起缩放、不会脱节。
   用固定值确保生效（!important 压过主题的 button/div 皮肤）。 */
.user-bubble { border-radius: var(--radius-surface) var(--radius-surface) var(--radius-control) var(--radius-surface) !important; }
.assistant-bubble { border-radius: var(--radius-surface) var(--radius-surface) var(--radius-surface) var(--radius-control) !important; }

/* 助手消息的 markdown 排版（加粗/斜体/表格/列表/代码） */
.markdown-body :deep(p) { margin: 0 0 0.5em; }
.markdown-body :deep(p:last-child) { margin-bottom: 0; }
.markdown-body :deep(strong) { font-weight: 700; }
.markdown-body :deep(em) { font-style: italic; }
.markdown-body :deep(code) {
  background: var(--color-surface-hover, #f1f5f9);
  padding: 0.1em 0.35em;
  border-radius: var(--radius-xs);
  font-size: 0.9em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.markdown-body :deep(pre) {
  background: var(--color-surface-hover, #f1f5f9);
  padding: 0.6em 0.8em;
  border-radius: var(--radius-control);
  overflow-x: auto;
  margin: 0.35em 0;
}
.markdown-body :deep(pre code) { background: transparent; padding: 0; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { margin: 0.25em 0 0.4em; padding-left: 1.3em; }
.markdown-body :deep(li) { margin: 0.1em 0; }
.markdown-body :deep(a) { color: var(--color-info, #2563eb); text-decoration: underline; }
.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 0.4em 0;
  width: 100%;
  font-size: 0.95em;
  display: block;
  overflow-x: auto;
}
.markdown-body :deep(th), .markdown-body :deep(td) {
  border: 1px solid var(--color-border, #e2e8f0);
  padding: 0.25em 0.6em;
}
.markdown-body :deep(th) {
  background: var(--color-surface-hover, #f1f5f9);
  font-weight: 600;
}
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3),
.markdown-body :deep(h4) { margin: 0.4em 0 0.25em; font-weight: 700; }
.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--color-border, #e2e8f0);
  padding-left: 0.7em;
  color: var(--color-text-muted, #64748b);
  margin: 0.4em 0;
}
/* 「中断」按钮与「已中断」标记共用的小方块停止图标 */
.stop-mark {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: var(--radius-xs);
  background: currentColor;
  flex-shrink: 0;
}
</style>

<script setup>
import AiChart from '../AiChart.vue'
import AiRecordTable from '../tables/AiRecordTable.vue'
import AiStreamTail from './AiStreamTail.vue'
import {
  hasProcess, processTitle, stepIcon, stepClass, stepSeconds, toggleStepDetail,
  hasReasonStep, tokenSpeed, extractFileName, extractUserText, summarizeProposalChanges,
} from '../../composables/ai/aiMessages.js'
import { TABLE_ROUTE } from '../../composables/ai/aiConstants.js'

defineOptions({ name: 'AiChatMessages' })
defineProps({
  messages: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  activeReasoningOn: { type: Boolean, default: false },
  // 浮窗（窗口）模式：精简掉用时 / token 统计与改动明细抽屉入口
  floating: { type: Boolean, default: false },
  // 父预计算的判定函数（保持与原渲染判定一致）
  isRetryable: { type: Function, required: true },
  isRollbackable: { type: Function, required: true },
  canUndo: { type: Function, required: true },
})
defineEmits(['new', 'copy', 'retry', 'undo', 'rollback', 'open-changes', 'goto'])

// 本轮数据/文件改动的汇总：仅在提案已执行且未撤回时返回非空（空则整条不渲染）。
// 结果缓存到消息上，避免长列表滚动时每帧重算；撤回后由 reverted 判断直接返回 null。
function changeSummary(m) {
  const p = m && m.proposal
  if (!p || !p.executed || p.reverted) return null
  if (!m._changeSummary) m._changeSummary = summarizeProposalChanges(p)
  return m._changeSummary.total ? m._changeSummary : null
}
function toggleChangeOpen(m) { m._changeOpen = !m._changeOpen }
// 项的 key 形如 grid:schedule / table:students / skill:xxx，取回原始表名（技能 md 无对应表）
function tableOfItem(it) { return (it.key || '').split(':')[1] || '' }
function canJumpItem(it) { return !!TABLE_ROUTE[tableOfItem(it)] }
</script>
