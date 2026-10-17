<template>
  <!-- 输入区 -->
  <div class="mt-0 flex gap-2 items-start flex-shrink-0 relative">
    <!-- 提问悬浮窗：AI 通过 ask_user 提问时在输入框上方弹出，选完即关闭（不混入对话流） -->
    <div
      v-if="pendingAsk"
      class="absolute bottom-full left-0 right-0 mb-2 z-20 text-left rounded-lg border border-border shadow-lg p-4 bg-white/55 backdrop-blur-md ai-glass-panel"
    >
      <div class="flex items-center justify-between gap-2 mb-2.5">
        <span class="text-sm font-semibold text-primary">AI 想确认一下</span>
        <button
          @click="$emit('dismiss')"
          class="text-text-muted hover:text-text text-base leading-none cursor-pointer"
          title="关闭"
        >✕</button>
      </div>
      <div v-if="pendingAsk.questions.length">
        <!-- 多问题：分页呈现，一页一题，底部「取消 / 下一页」（末页为「完成」），不再全部堆在一页 -->
        <template v-if="pendingAsk.questions.length > 1">
          <div class="text-xs text-text-muted mb-1">
            第 {{ askPage + 1 }} / {{ pendingAsk.questions.length }} 题<template v-if="askCurrent && askCurrent.multiple">（可多选）</template>
          </div>
          <div v-if="askCurrent" class="text-base text-text mb-3 break-words">
            <span class="text-text-muted mr-1">{{ askPage + 1 }}.</span>{{ askCurrent.question }}
          </div>
          <div v-if="askCurrent && askCurrent.options.length" class="space-y-2">
            <button
              v-for="(o, oi) in askCurrent.options"
              :key="oi"
              @click="$emit('pick', askPage, o)"
              :class="[optBase, isPicked(askCurrent, o) ? optOn : optOff]"
            >{{ o }}</button>
            <label :class="[optBase, 'flex items-center gap-1.5', isPicked(askCurrent, OTHER_KEY) ? optOn : optOff]">
              <span class="shrink-0">{{ OTHER_LABEL }}：</span>
              <input
                :value="askCurrent.other || ''"
                @input="$emit('other', askPage, $event.target.value)"
                @focus="$emit('pick', askPage, OTHER_KEY)"
                @keydown.enter.prevent="onOtherEnter"
                placeholder="请输入"
                class="flex-1 min-w-0 bg-transparent outline-none text-text placeholder:text-text-muted"
              />
            </label>
          </div>
          <div v-else class="text-sm text-text-muted">请直接在下方输入你的回答</div>
          <!-- 有选项的单选题：选中即自动跳下一题（末题即提交），无需再点按钮；
               无选项（自由作答）、多选、或已选「其他」需先填内容时，保留按钮行 -->
          <div v-if="askNeedConfirm" class="flex justify-end gap-2 mt-3">
            <button
              @click="$emit('dismiss')"
              class="text-sm px-3 py-1.5 rounded-sm border border-border bg-surface text-text-muted hover:text-text hover:bg-surface-hover transition-theme cursor-pointer"
            >取消</button>
            <button
              v-if="askPage < pendingAsk.questions.length - 1"
              @click="$emit('next')"
              :disabled="!askCanAdvance"
              class="text-sm px-4 py-1.5 rounded-sm border border-transparent bg-primary text-text-inverse hover:bg-primary-hover transition-theme cursor-pointer disabled:opacity-40 disabled:cursor-default"
            >下一页</button>
            <button
              v-else
              @click="$emit('submit')"
              :disabled="!askCanSubmit"
              class="text-sm px-4 py-1.5 rounded-sm border border-transparent bg-primary text-text-inverse hover:bg-primary-hover transition-theme cursor-pointer disabled:opacity-40 disabled:cursor-default"
            >完成</button>
          </div>
        </template>

        <!-- 单问题：单选点一下即发；多选或选了「其他」时，填好后点「完成」 -->
        <div v-else class="space-y-4">
          <div v-for="(q, qi) in pendingAsk.questions" :key="qi">
            <div class="text-base text-text mb-3 break-words">
              {{ q.question }}<span v-if="q.multiple" class="ml-1 text-xs text-text-muted">（可多选）</span>
            </div>
            <div v-if="q.options.length" class="space-y-2">
              <button
                v-for="(o, oi) in q.options"
                :key="oi"
                @click="$emit('pick', qi, o)"
                :class="[optBase, isPicked(q, o) ? optOn : optOff]"
              >{{ o }}</button>
              <label :class="[optBase, 'flex items-center gap-1.5', isPicked(q, OTHER_KEY) ? optOn : optOff]">
                <span class="shrink-0">{{ OTHER_LABEL }}：</span>
                <input
                  :value="q.other || ''"
                  @input="$emit('other', qi, $event.target.value)"
                  @focus="$emit('pick', qi, OTHER_KEY)"
                  @keydown.enter.prevent="$emit('submit')"
                  placeholder="请输入"
                  class="flex-1 min-w-0 bg-transparent outline-none text-text placeholder:text-text-muted"
                />
              </label>
            </div>
            <div v-else class="text-sm text-text-muted">请直接在下方输入你的回答</div>
          </div>
          <div v-if="singleNeedConfirm" class="flex justify-end gap-2">
            <button
              @click="$emit('dismiss')"
              class="text-sm px-3 py-1.5 rounded-sm border border-border bg-surface text-text-muted hover:text-text hover:bg-surface-hover transition-theme cursor-pointer"
            >取消</button>
            <button
              @click="$emit('submit')"
              :disabled="!askCanSubmit"
              class="text-sm px-4 py-1.5 rounded-sm border border-transparent bg-primary text-text-inverse hover:bg-primary-hover transition-theme cursor-pointer disabled:opacity-40 disabled:cursor-default"
            >完成</button>
          </div>
        </div>
      </div>
    </div>
    <!-- 写提案悬浮窗：AI 生成写入提案时在输入框上方弹出（与提问同款），确认执行或点 ✕ 关闭 -->
    <div
      v-if="pendingProposal"
      class="absolute bottom-full left-0 right-0 mb-2 z-20 text-left rounded-lg border border-border shadow-lg p-4 bg-white/55 backdrop-blur-md ai-glass-panel"
    >
      <div class="flex items-center justify-between gap-2 mb-2.5">
        <span class="text-sm font-semibold text-warning">{{ pendingProposal.label }}</span>
        <button
          @click="$emit('dismiss-proposal')"
          class="text-text-muted hover:text-text text-base leading-none cursor-pointer"
          title="取消"
        >✕</button>
      </div>
      <div class="text-xs text-text-muted mb-2">{{ frontProposalHint(pendingProposal) }}</div>
      <!-- 待写入数据用同款表格组件展示（新增/修改=待写入值，删除=将被删除的现有记录） -->
      <AiProposalTable :proposal="pendingProposal" />
      <div class="mt-3 flex justify-end gap-2">
        <button
          @click="$emit('dismiss-proposal')"
          :disabled="pendingProposal.executing"
          class="text-sm px-4 py-2 rounded-sm border border-border bg-surface text-text-muted hover:text-text hover:bg-surface-hover transition-theme cursor-pointer disabled:opacity-50 disabled:cursor-default"
        >取消</button>
        <button
          @click="$emit('confirm')"
          :disabled="pendingProposal.executing"
          class="bg-primary hover:bg-primary-hover text-text-inverse text-sm px-4 py-2 rounded-sm transition-theme disabled:opacity-50"
        >{{ pendingProposal.executing ? '执行中…' : '确认执行' }}</button>
      </div>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/*,.pdf,.doc,.docx,.pptx,.xls,.xlsx,.csv,.txt,.md,.json,.xml,.html"
      class="hidden"
      @change="onFileSelected"
    />
    <button
      v-if="!busy"
      @click="$emit('screenshot')"
      :disabled="capturing"
      class="border border-border bg-surface text-text px-2.5 py-2 rounded-lg hover:bg-surface-hover transition-theme flex-shrink-0 flex items-center justify-center disabled:opacity-50"
      title="截屏并作为图片发给 AI"
    ><IconGlyph :name="capturing ? 'loading' : 'camera'" :size="16" tint="current" /></button>
    <button
      v-if="!busy"
      @click="openFilePicker"
      class="border border-border bg-surface text-text px-2.5 py-2 rounded-lg hover:bg-surface-hover transition-theme flex-shrink-0 flex items-center justify-center"
      title="上传图片/PDF/Word/PPT/Excel/文本（支持粘贴图片）"
    ><IconGlyph name="paperclip" :size="16" tint="current" /></button>
    <textarea
      ref="textareaRef"
      v-model="inputModel"
      :placeholder="busy ? 'AI 正在回复…' : '输入问题，回车发送（Shift+Enter 换行），可粘贴图片'"
      :disabled="busy"
      rows="1"
      class="flex-1 border border-border bg-surface text-text px-3 py-2 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
      @keydown.enter.exact.prevent="$emit('send')"
      @paste="onPaste"
    />
    <button
      v-if="busy"
      @click="$emit('interrupt')"
      class="border border-border bg-surface text-text px-4 py-2 rounded-lg hover:bg-surface-hover transition-theme flex-shrink-0 inline-flex items-center gap-1.5"
      title="停止本次回复（已生成的内容会保留）"
    ><span class="stop-mark"></span>中断</button>
    <button
      v-else
      @click="$emit('send')"
      :disabled="!input.trim() && !attachedFile"
      class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded-lg transition-theme disabled:opacity-40 flex-shrink-0"
    >发送</button>
  </div>
</template>

<style scoped>
/* 「中断」按钮与「已中断」标记共用的小方块停止图标 */
.stop-mark {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: currentColor;
  flex-shrink: 0;
}
</style>

<script>
import AiProposalTable from '../tables/AiProposalTable.vue'
import { readFile } from '../../composables/ai/aiFiles.js'
import { frontProposalHint } from '../../composables/ai/aiMessages.js'
import { ASK_OTHER_KEY, ASK_OTHER_LABEL } from '../../composables/ai/aiConstants.js'

export default {
  name: 'AiComposer',
  components: { AiProposalTable },
  props: {
    input: { type: String, default: '' },
    busy: { type: Boolean, default: false },
    capturing: { type: Boolean, default: false },
    attachedFile: { type: Object, default: null },
    pendingAsk: { type: Object, default: null },
    askCurrent: { type: Object, default: null },
    askPage: { type: Number, default: 0 },
    askCanSubmit: { type: Boolean, default: false },
    askCanAdvance: { type: Boolean, default: false },
    pendingProposal: { type: Object, default: null },
  },
  emits: [
    'update:input', 'send', 'interrupt', 'screenshot', 'attach',
    'pick', 'other', 'next', 'submit', 'dismiss', 'confirm', 'dismiss-proposal',
  ],
  data() {
    return { OTHER_KEY: ASK_OTHER_KEY, OTHER_LABEL: ASK_OTHER_LABEL }
  },
  computed: {
    // v-model:input 的本组件内部双向绑定壳（父为唯一数据源）
    inputModel: {
      get() { return this.input },
      set(v) { this.$emit('update:input', v) },
    },
    // 选项行样式：单选/多选、分页/单题两条分支共用同一套类名
    optBase() {
      return 'w-full text-left text-sm px-3 py-2 rounded-sm border bg-surface text-text transition-theme cursor-pointer'
    },
    optOn() { return 'border-primary text-primary' },
    optOff() { return 'border-border hover:border-primary hover:text-primary' },
    // 分页分支需显式点「下一页 / 完成」的情况：无选项（自由作答）、多选、或已选「其他」需先填内容
    askNeedConfirm() {
      const q = this.askCurrent
      return !!q && (!q.options.length || !!q.multiple || this.isPicked(q, ASK_OTHER_KEY))
    },
    // 单题分支：多选或已选「其他」时需要「完成」按钮
    singleNeedConfirm() {
      const a = this.pendingAsk
      return !!a && a.questions.some((q) => !!q.multiple || this.isPicked(q, ASK_OTHER_KEY))
    },
  },
  expose: ['openFilePicker', 'focusInput'],
  methods: {
    // 选项是否已选中（多选为数组包含，单选为相等）
    isPicked(q, o) {
      return Array.isArray(q && q.picked) ? q.picked.includes(o) : !!(q && q.picked === o)
    },
    // 「其他」输入框回车：分页分支按当前位置前进，单题分支直接提交
    onOtherEnter() {
      const a = this.pendingAsk
      if (!a) return
      if (a.questions.length > 1 && this.askPage < a.questions.length - 1) {
        if (this.askCanAdvance) this.$emit('next')
      } else {
        this.$emit('submit')
      }
    },
    // 触发隐藏的 file input（供父侧 / 内部封装的按钮调用）
    openFilePicker() {
      this.$refs.fileInput.click()
    },
    // 聚焦输入框（回退到本轮提问前时把原提问带回并聚焦）
    focusInput() {
      if (this.$refs.textareaRef) this.$refs.textareaRef.focus()
    },
    async onFileSelected(e) {
      const file = e.target.files && e.target.files[0]
      if (!file) return
      e.target.value = ''
      this.$emit('attach', await readFile(file))
    },
    onPaste(e) {
      const items = e.clipboardData && e.clipboardData.items
      if (!items) return
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            const reader = new FileReader()
            reader.onload = (event) => {
              const name = file.name || '粘贴图片.png'
              const sizeLabel = file.size > 1048576
                ? (file.size / 1048576).toFixed(1) + ' MB'
                : (file.size / 1024).toFixed(0) + ' KB'
              this.$emit('attach', { name, isImage: true, dataUrl: event.target.result, textContent: '', sizeLabel })
            }
            reader.readAsDataURL(file)
          }
          e.preventDefault()
          return
        }
      }
    },
  },
}
</script>
