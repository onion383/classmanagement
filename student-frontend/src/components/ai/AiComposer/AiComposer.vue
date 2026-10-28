<template>
  <!-- 输入区：整体是一块二级毛玻璃（上半无边框输入框，下半工具行） -->
  <div class="mt-0 flex-shrink-0 relative">
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
      <div v-if="askQuestions.length">
        <!-- 多问题：分页呈现，一页一题，底部「取消 / 下一页」（末页为「完成」），不再全部堆在一页 -->
        <template v-if="askQuestions.length > 1">
          <div class="text-xs text-text-muted mb-1">
            第 {{ askPage + 1 }} / {{ askQuestions.length }} 题<template v-if="askCurrent && askCurrent.multiple">（可多选）</template>
          </div>
          <div v-if="askCurrent" class="text-base text-text mb-3 break-words">
            <span class="text-text-muted mr-1">{{ askPage + 1 }}.</span>{{ askCurrent.question }}
          </div>
          <div v-if="askCurrent && askOptions(askCurrent).length" class="space-y-2">
            <!-- 多选：每行前置复选框，点整行即勾选/取消 -->
            <template v-if="askCurrent.multiple">
              <label
                v-for="(o, oi) in askOptions(askCurrent)"
                :key="'m' + oi"
                :class="[optBase, 'flex items-center gap-2', isPicked(askCurrent, o) ? optOn : optOff]"
              >
                <input type="checkbox" :checked="isPicked(askCurrent, o)" @change="$emit('pick', askPage, o)" />
                <span class="min-w-0">{{ o }}</span>
              </label>
            </template>
            <!-- 单选：点选项即选中 -->
            <template v-else>
              <button
                v-for="(o, oi) in askOptions(askCurrent)"
                :key="'s' + oi"
                @click="$emit('pick', askPage, o)"
                :class="[optBase, isPicked(askCurrent, o) ? optOn : optOff]"
              >{{ o }}</button>
            </template>
            <label :class="[optBase, 'flex items-center gap-1.5', isPicked(askCurrent, OTHER_KEY) ? optOn : optOff]">
              <input
                v-if="askCurrent.multiple"
                type="checkbox"
                :checked="isPicked(askCurrent, OTHER_KEY)"
                @change="$emit('pick', askPage, OTHER_KEY)"
              />
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
               未选择时提供「跳过」按钮；无选项（自由作答）、多选、或已选「其他」需先填内容时，保留按钮行 -->
          <div v-if="askNeedConfirm || askSkipMode" class="flex justify-end gap-2 mt-3">
            <button
              @click="$emit('dismiss')"
              class="text-sm px-3 py-1.5 rounded-sm border border-border bg-surface text-text-muted hover:text-text hover:bg-surface-hover transition-theme cursor-pointer"
            >取消</button>
            <button
              v-if="askSkipMode"
              @click="$emit('skip')"
              class="text-sm px-4 py-1.5 rounded-sm border border-transparent bg-primary text-text-inverse hover:bg-primary-hover transition-theme cursor-pointer"
            >跳过</button>
            <button
              v-else-if="askPage < askQuestions.length - 1"
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

        <!-- 单问题：单选点一下即发；多选或选了「其他」时，填好后点「完成」；单选未选择时可「跳过」 -->
        <div v-else class="space-y-4">
          <div v-for="(q, qi) in askQuestions" :key="qi">
            <div class="text-base text-text mb-3 break-words">
              {{ q.question }}<span v-if="q.multiple" class="ml-1 text-xs text-text-muted">（可多选）</span>
            </div>
            <div v-if="askOptions(q).length" class="space-y-2">
              <!-- 多选：每行前置复选框，点整行即勾选/取消 -->
              <template v-if="q.multiple">
                <label
                  v-for="(o, oi) in askOptions(q)"
                  :key="'m' + oi"
                  :class="[optBase, 'flex items-center gap-2', isPicked(q, o) ? optOn : optOff]"
                >
                  <input type="checkbox" :checked="isPicked(q, o)" @change="$emit('pick', qi, o)" />
                  <span class="min-w-0">{{ o }}</span>
                </label>
              </template>
              <!-- 单选：点选项即选中 -->
              <template v-else>
                <button
                  v-for="(o, oi) in askOptions(q)"
                  :key="'s' + oi"
                  @click="$emit('pick', qi, o)"
                  :class="[optBase, isPicked(q, o) ? optOn : optOff]"
                >{{ o }}</button>
              </template>
              <label :class="[optBase, 'flex items-center gap-1.5', isPicked(q, OTHER_KEY) ? optOn : optOff]">
                <input
                  v-if="q.multiple"
                  type="checkbox"
                  :checked="isPicked(q, OTHER_KEY)"
                  @change="$emit('pick', qi, OTHER_KEY)"
                />
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
          <div v-if="singleNeedConfirm || singleSkipMode" class="flex justify-end gap-2">
            <button
              @click="$emit('dismiss')"
              class="text-sm px-3 py-1.5 rounded-sm border border-border bg-surface text-text-muted hover:text-text hover:bg-surface-hover transition-theme cursor-pointer"
            >取消</button>
            <button
              v-if="singleSkipMode"
              @click="$emit('skip')"
              class="text-sm px-4 py-1.5 rounded-sm border border-transparent bg-primary text-text-inverse hover:bg-primary-hover transition-theme cursor-pointer"
            >跳过</button>
            <button
              v-else
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
    <!-- 技能候选：输入框打「/」时在输入区上方弹出，按技能 md 文件名匹配（点中即启用） -->
    <div
      v-if="skillMenuOpen"
      class="absolute bottom-full left-0 mb-2 z-30 w-72 max-w-[85%] text-left rounded-lg border border-border shadow-lg p-1.5 bg-white/55 backdrop-blur-md ai-glass-panel"
    >
      <div class="px-2 py-1 text-[11px] text-text-muted">
        技能{{ skillQuery ? `：匹配「${skillQuery}」` : '' }}
      </div>
      <!-- 用 div 而非 button：毛玻璃主题会给所有 button 加描边皮肤 -->
      <div
        v-for="(s, i) in skillList"
        :key="s"
        class="w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-theme cursor-pointer"
        :class="i === skillIdx ? 'bg-surface-hover text-primary' : 'text-text'"
        @mouseenter="skillIdx = i"
        @mousedown.prevent="applySkill(s)"
      >
        <span class="truncate">{{ s }}</span>
      </div>
      <div v-if="!skillList.length" class="px-2 py-2 text-sm text-text-muted">
        {{ (skillOptions || []).length ? '没有匹配的技能' : '暂无技能文件，可在「数据管理」中新增文件' }}
      </div>
    </div>
    <!-- 权限挡位菜单：贴在「权限」按钮正上方（不是整个输入组件上方）。
         挡位用 Teleport 挂到 body：输入组件用的是 .bg-surface，毛玻璃主题给它带 contain:paint，
         面板内部的弹出层会被裁掉，所以必须挪到组件外面再按按钮位置定位。 -->
    <Teleport to="body">
      <div
        v-if="permMenuOpen"
        ref="permMenuRef"
        data-ai-float-keep
        class="w-52 rounded-lg border border-border shadow-lg p-1.5 bg-white/55 backdrop-blur-md ai-glass-panel text-left z-[10005]"
        :style="permMenuStyle"
      >
        <div class="px-2 py-1 text-[11px] text-text-muted">AI 写入权限</div>
        <!-- 选项用 div 而非 button：毛玻璃主题会给所有 button 加描边皮肤 -->
        <div
          v-for="o in PERMISSION_OPTIONS"
          :key="o.value"
          class="w-full flex items-center justify-between gap-2 px-2 py-2 rounded-md text-sm transition-theme cursor-pointer hover:bg-surface-hover"
          :class="o.value === permissionMode ? 'text-primary' : 'text-text'"
          @click="pickPermission(o.value)"
        >
          <span>{{ o.label }}</span>
          <span v-if="o.value === permissionMode">✓</span>
        </div>
      </div>
    </Teleport>
    <input
      ref="fileInput"
      type="file"
      accept="image/*,.pdf,.doc,.docx,.pptx,.xls,.xlsx,.csv,.txt,.md,.json,.xml,.html"
      class="hidden"
      @change="onFileSelected"
    />
    <!-- 二级毛玻璃容器：直接沿用主题卡片玻璃配方（.bg-surface），
         上半是标准输入框（带边框），下半工具行（左：截屏/附件/权限，右：模型/发送） -->
    <div class="composer-glass bg-surface">
      <!-- 输入框：沿用主题标准的输入框样式（边框 / 毛玻璃底 / 聚焦发光），
           外面再包一层内边距，让它和组件边界、下排按钮左对齐地留出边距 -->
      <div class="px-2.5 pt-2.5 pb-1">
        <!-- 已启用的技能（md 指令文件）：以小标签展示，可单个移除；随本轮请求注入系统提示 -->
        <div v-if="selectedSkills.length" class="flex flex-wrap gap-1.5 mb-1.5 px-0.5">
          <span v-for="s in selectedSkills" :key="s" class="skill-chip">
            <span class="truncate max-w-40">{{ s }}</span>
            <span class="skill-chip-x" title="移除技能" @click="$emit('remove-skill', s)">✕</span>
          </span>
        </div>
        <textarea
          ref="textareaRef"
          v-model="inputModel"
          :placeholder="busy ? 'AI 正在回复…' : '输入问题，回车发送（Shift+Enter 换行）；打「/」选择技能'"
          :disabled="busy"
          rows="1"
          class="w-full resize-none text-sm text-text placeholder:text-text-muted px-2.5 py-1.5 disabled:opacity-50"
          @input="onComposerInput"
          @keydown="onComposerKeydown"
          @blur="skillMenuOpen = false"
          @paste="onPaste"
        />
      </div>
      <div class="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1">
        <button
          v-if="!busy"
          class="dlg-close"
          @click="$emit('screenshot')"
          :disabled="capturing"
          title="截屏并作为图片发给 AI"
        ><IconGlyph :name="capturing ? 'loading' : 'camera'" :size="15" tint="current" /></button>
        <button
          v-if="!busy"
          class="dlg-close"
          @click="openFilePicker"
          title="上传图片/PDF/Word/PPT/Excel/文本（支持粘贴图片/文件）"
        ><IconGlyph name="paperclip" :size="15" tint="current" /></button>
        <button
          ref="permBtn"
          class="comp-perm"
          :class="permissionMode === aiPermissionFull ? 'is-full' : ''"
          :title="permissionMode === aiPermissionFull ? '当前：完全权限（AI 改数据不再逐次征求同意）' : '当前：全部审批（AI 每次改数据都要你确认）'"
          @click="togglePermMenu"
        >
          <ShieldAlert v-if="permissionMode === aiPermissionFull" :size="13" :stroke-width="1.8" />
          <ShieldCheck v-else :size="13" :stroke-width="1.8" />
          <span>{{ permissionMode === aiPermissionFull ? '完全权限' : '全部审批' }}</span>
        </button>
        <!-- 联网搜索开关：仅 DeepSeek 模式可用；其余模式下置灰禁用，避免隐藏造成入口不可发现 -->
        <button
          class="comp-perm comp-search"
          :class="searchAvailable && webSearch ? 'is-on' : ''"
          :disabled="!searchAvailable"
          :title="searchAvailable
            ? (webSearch ? '当前：已开启联网搜索（AI 可查最新网页信息）' : '当前：已关闭联网搜索（仅用已有知识回答）')
            : '联网搜索仅支持 DeepSeek 模型'"
          @click="searchAvailable && $emit('toggle-search')"
        >
          <Globe :size="13" :stroke-width="1.8" />
          <span>联网</span>
        </button>

        <div class="ml-auto flex items-center gap-1.5">
          <AppSelect
            v-if="modelOptions.length"
            :model-value="modelId"
            :options="modelOptions"
            :disabled="busy"
            compact
            class="!w-36 !text-xs"
            title="切换当前模型"
            @update:model-value="$emit('update:modelId', $event)"
          />
          <button
            v-if="busy"
            class="comp-perm"
            @click="$emit('interrupt')"
            title="停止本次回复（已生成的内容会保留）"
          ><span class="stop-mark"></span>中断</button>
          <button
            v-else
            class="comp-send"
            :disabled="!input.trim() && !attachedFile"
            @click="$emit('send')"
          >发送</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 「中断」按钮与「已中断」标记共用的小方块停止图标 */
.stop-mark {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: var(--radius-xs);
  background: currentColor;
  flex-shrink: 0;
}

/* 输入组件整体：普通二级毛玻璃——直接沿用主题的 .bg-surface 卡片玻璃配方
   （底色 / 模糊 / 边框 / 顶部高光都跟主题走，不再额外叠 30% 白，避免和外层聊天卡片不是一套颜色），
   只把圆角和阴影收成输入框的尺度。 */
.bg-surface.composer-glass {
  border-radius: var(--radius-control) !important;
  box-shadow: none !important;
}

/* 工具行按钮：毛玻璃主题会给所有 button 硬编码 1px 描边 + 12px 圆角 + 荧光描边环，
   这里统一压掉，做成无边框的方形/胶囊毛玻璃块（与 .dlg-close 同款配方）。 */
.comp-perm,
.comp-send {
  border: none !important;
  box-shadow: none !important;
  border-radius: var(--radius-control) !important;
}
.comp-perm::before,
.comp-send::before {
  display: none !important;
  content: none !important;
}
.comp-perm {
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 9px;
  background: color-mix(in srgb, var(--color-text) 7%, transparent);
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.comp-perm:hover {
  background: color-mix(in srgb, var(--color-text) 14%, transparent);
  color: var(--color-text);
}
/* 完全权限：用警示色标识当前处于高风险挡位 */
.comp-perm.is-full {
  background: color-mix(in srgb, var(--color-warning, #f59e0b) 16%, transparent);
  color: var(--color-warning, #f59e0b);
}
.comp-perm.is-full:hover {
  background: color-mix(in srgb, var(--color-warning, #f59e0b) 26%, transparent);
}
/* 联网搜索开启：用主题色标识已开启状态 */
.comp-search.is-on {
  background: color-mix(in srgb, var(--color-primary) 16%, transparent);
  color: var(--color-primary);
}
.comp-search.is-on:hover {
  background: color-mix(in srgb, var(--color-primary) 26%, transparent);
}
/* 非 DeepSeek 模式：置灰禁用（不隐藏），hover 不变化，明确不可点 */
.comp-search:disabled {
  opacity: 0.4;
  cursor: default;
}
.comp-search:disabled:hover {
  background: color-mix(in srgb, var(--color-text) 7%, transparent);
  color: var(--color-text-secondary);
}
.comp-send {
  height: 28px;
  padding: 0 14px;
  background: var(--color-primary);
  color: var(--color-text-inverse);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s;
}
.comp-send:hover:not(:disabled) { background: var(--color-primary-hover, var(--color-primary)); }
.comp-send:disabled { opacity: 0.4; cursor: default; }

/* 已启用技能的小标签（毛玻璃胶囊）：主题色淡底 + 主题色文字，尾部 ✕ 可移除 */
.skill-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  padding: 2px 4px 2px 8px;
  border-radius: var(--radius-control);
  border: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
  font-size: 12px;
  line-height: 1.5;
}
.skill-chip-x {
  cursor: pointer;
  padding: 1px 3px;
  border-radius: var(--radius-xs);
  font-size: 10px;
  line-height: 1;
  opacity: 0.65;
}
.skill-chip-x:hover { opacity: 1; }
</style>

<script>
import { ShieldAlert, ShieldCheck, Globe } from '@lucide/vue'
import AiProposalTable from '../../tables/AiProposalTable.vue'
import AppSelect from '../../base/AppSelect.vue'
import { useNotification } from '../../../composables/useNotification.js'
import { readFile, readAsDataURL } from '../../../composables/ai/aiFiles.js'
import { frontProposalHint } from '../../../composables/ai/aiMessages.js'
import { ASK_OTHER_KEY, ASK_OTHER_LABEL, AI_PERMISSION_FULL } from '../../../composables/ai/aiConstants.js'
import { _slashToken } from './AiComposer.skill.js'
import { isPicked, _isSingleUnpicked } from './AiComposer.ask.js'

export default {
  name: 'AiComposer',
  components: { AiProposalTable, AppSelect, ShieldAlert, ShieldCheck, Globe },
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
    // 写入权限挡位（由父侧持久化）：'approve' 全部审批 / 'full' 完全权限
    permissionMode: { type: String, default: 'approve' },
    // 联网搜索开关：当前是否开启（父侧持久化）；searchAvailable 表示当前模式是否支持（仅 DeepSeek）
    webSearch: { type: Boolean, default: true },
    searchAvailable: { type: Boolean, default: false },
    // 模型快捷切换：当前模型 id 与可选项（父侧 aiConversations 的 modelOptions）
    modelId: { type: [Number, String], default: null },
    modelOptions: { type: Array, default: () => [] },
    // 可用技能名列表（来自「数据管理」页维护的 md 指令文件）
    skillOptions: { type: Array, default: () => [] },
    // 本轮已启用的技能名（打「/」选中后加入，展示为可移除的小标签）
    selectedSkills: { type: Array, default: () => [] },
  },
  emits: [
    'update:input', 'send', 'interrupt', 'screenshot', 'attach',
    'pick', 'other', 'next', 'submit', 'skip', 'dismiss', 'confirm', 'dismiss-proposal',
    'pick-permission', 'update:modelId', 'select-skill', 'remove-skill', 'toggle-search',
  ],
  data() {
    return {
      OTHER_KEY: ASK_OTHER_KEY,
      OTHER_LABEL: ASK_OTHER_LABEL,
      aiPermissionFull: AI_PERMISSION_FULL,
      permMenuOpen: false,
      permBtnRect: null, // 「权限」按钮的视口位置（菜单按它定位，贴在按钮正上方）
      // 技能候选菜单：输入框打「/」时展开，按「/」后的关键词过滤技能名
      skillMenuOpen: false,
      skillQuery: '',
      skillIdx: 0,
      // 权限挡位菜单项（默认挡位在前）
      PERMISSION_OPTIONS: [
        { value: 'approve', label: '全部审批' },
        { value: AI_PERMISSION_FULL, label: '完全权限' },
      ],
    }
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
    // ask_user 结构兜底：缺 questions 时按「没有题目」渲染，模板里不再直接读 pendingAsk.questions.length
    askQuestions() {
      const a = this.pendingAsk
      return a && Array.isArray(a.questions) ? a.questions : []
    },
    // 分页分支需显式点「下一页 / 完成」的情况：无选项（自由作答）、多选、或已选「其他」需先填内容
    askNeedConfirm() {
      const q = this.askCurrent
      return !!q && (!this.askOptions(q).length || !!q.multiple || this.isPicked(q, ASK_OTHER_KEY))
    },
    // 单题分支：多选或已选「其他」时需要「完成」按钮
    singleNeedConfirm() {
      return this.askQuestions.some((q) => !!q.multiple || this.isPicked(q, ASK_OTHER_KEY))
    },
    // 分页分支当前题：单选、有选项且尚未选择 → 显示「跳过」
    askSkipMode() {
      const q = this.askCurrent
      return this._isSingleUnpicked(q)
    },
    // 单题分支：该题单选、有选项且尚未选择 → 显示「跳过」
    singleSkipMode() {
      const qs = this.askQuestions
      return qs.length === 1 && this._isSingleUnpicked(qs[0])
    },
    // 权限菜单定位：fixed 坐标由按钮 rect 推出，底边贴在按钮上方 6px 处
    permMenuStyle() {
      const r = this.permBtnRect
      if (!r) return { display: 'none' }
      return { position: 'fixed', left: `${r.left}px`, top: `${r.top - 6}px`, transform: 'translateY(-100%)' }
    },
    // 技能候选：排除已选，按「/」后的关键词做大小写不敏感的子串匹配
    skillList() {
      const q = (this.skillQuery || '').toLowerCase()
      const sel = this.selectedSkills || []
      return (this.skillOptions || [])
        .filter((s) => s && !sel.includes(s))
        .filter((s) => (q ? String(s).toLowerCase().includes(q) : true))
        .slice(0, 50)
    },
  },
  expose: ['openFilePicker', 'focusInput'],
  mounted() {
    // 点击输入区以外的任意位置关闭浮窗：提问浮窗（ask）、技能候选、权限挡位菜单。
    // 权限菜单被 Teleport 到 body，并不在 this.$el 里，所以必须用 permMenuRef 单独判断：
    // 既要在点击菜单内部时放行（否则 mousedown 先把菜单关掉，随后的 click 落不到选项上），
    // 也要排除「权限」按钮本身（它自己用 @click 开合，否则会先关再开、点了没反应）。
    this._onDocMouseDown = (e) => {
      const t = e.target
      const root = this.$el
      const inRoot = !!(root && root.contains(t))
      const menu = this.$refs.permMenuRef
      const inMenu = !!(menu && menu.contains(t))
      const btn = this.$refs.permBtn
      const inBtn = !!(btn && btn.contains(t))
      if (this.permMenuOpen && !inMenu && !inBtn) this.permMenuOpen = false
      if (this.skillMenuOpen && !inRoot) this.skillMenuOpen = false
      if (!this.pendingAsk) return
      if (inRoot || inMenu) return
      this.$emit('dismiss')
    }
    // Esc 也收起权限菜单（焦点通常停在输入框里，此时也要能关）
    this._onDocKeyDown = (e) => {
      if (e.key === 'Escape' && this.permMenuOpen) this.permMenuOpen = false
    }
    document.addEventListener('mousedown', this._onDocMouseDown, true)
    document.addEventListener('keydown', this._onDocKeyDown, true)
  },
  beforeUnmount() {
    if (this._onDocMouseDown) document.removeEventListener('mousedown', this._onDocMouseDown, true)
    if (this._onDocKeyDown) document.removeEventListener('keydown', this._onDocKeyDown, true)
    this._onDocMouseDown = null
    this._onDocKeyDown = null
  },
  methods: {
    // 待确认提案的说明文案。本组件是选项式 API（<script> 而非 <script setup>），
    // 模板只能访问实例上的成员，顶层 import 的函数必须挂到 methods 才能在模板里调用，
    // 否则渲染 proposal 浮窗时会抛 "frontProposalHint is not a function" 并中断整个页面。
    frontProposalHint,
    // 开合权限挡位菜单：打开时按「权限」按钮的位置定位，保证菜单贴在按钮正上方
    togglePermMenu() {
      if (this.permMenuOpen) { this.permMenuOpen = false; return }
      const r = this.$refs.permBtn && this.$refs.permBtn.getBoundingClientRect()
      if (!r || !r.width) return
      this.permBtnRect = { left: r.left, top: r.top }
      this.permMenuOpen = true
    },
    // 选中某个权限挡位：收起菜单并交给父侧处理（切到完全权限前父侧会先弹确认框）
    pickPermission(mode) {
      this.permMenuOpen = false
      this.$emit('pick-permission', mode)
    },
    // 纯逻辑函数已抽到同目录 ./AiComposer.skill.js（原样搬运，命名与逻辑不变）；
    // 本组件是选项式 API，仍挂到 methods，保证 this._slashToken 的调用点不变。
    _slashToken,
    // 输入变化：命中「/触发词」则展开技能候选菜单，否则收起
    onComposerInput(e) {
      const el = e.target
      const t = this._slashToken(el.value, el.selectionStart)
      if (t) {
        this.skillQuery = t.query
        this.skillIdx = 0
        this.skillMenuOpen = true
      } else {
        this.skillMenuOpen = false
      }
    },
    // 键盘：技能候选展开时接管上下键/回车/ESC；否则回车照常发送（Shift+Enter 换行）
    onComposerKeydown(e) {
      if (this.skillMenuOpen) {
        if (e.key === 'Escape') { e.preventDefault(); this.skillMenuOpen = false; return }
        if (this.skillList.length) {
          if (e.key === 'ArrowDown') { e.preventDefault(); this.skillIdx = (this.skillIdx + 1) % this.skillList.length; return }
          if (e.key === 'ArrowUp') { e.preventDefault(); this.skillIdx = (this.skillIdx - 1 + this.skillList.length) % this.skillList.length; return }
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.applySkill(this.skillList[this.skillIdx]); return }
        }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        this.$emit('send')
      }
    },
    // 选中技能：去掉输入框里的「/触发词」，把技能名交给父侧加入已选，并保持焦点
    applySkill(name) {
      if (!name) return
      this.skillMenuOpen = false
      const el = this.$refs.textareaRef
      if (el) {
        const t = this._slashToken(el.value, el.selectionStart)
        if (t) {
          const caret = el.selectionStart
          this.$emit('update:input', el.value.slice(0, t.start) + el.value.slice(caret))
          this.$nextTick(() => {
            try { el.focus(); el.setSelectionRange(t.start, t.start) } catch (_) { /* 忽略 */ }
          })
        }
      }
      this.$emit('select-skill', name)
    },
    // 纯逻辑函数已抽到同目录 ./AiComposer.ask.js（原样搬运，命名与逻辑不变）；
    // 仍挂到 methods，保证模板 isPicked(...) 与 this._isSingleUnpicked(...) 的调用点不变。
    isPicked,
    _isSingleUnpicked,
    // 某题的选项数组（缺失/非数组时按空数组）：模板里的 v-for / v-if 统一走这里，
    // 避免畸形 ask_user 结构让 q.options.length 直接抛 TypeError
    askOptions(q) {
      return q && Array.isArray(q.options) ? q.options : []
    },
    // 「其他」输入框回车：分页分支按当前位置前进，单题分支直接提交
    onOtherEnter() {
      const a = this.pendingAsk
      if (!a) return
      const n = this.askQuestions.length
      if (n > 1 && this.askPage < n - 1) {
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
    // 粘贴：剪贴板里的图片/文件都作为附件（图片直出 dataURL，其余文件复用既有上传解析链路）
    async onPaste(e) {
      const cd = e.clipboardData
      if (!cd) return
      // 先取 files（Chromium 直接给出 FileList），为空时再从 items 兜底（部分环境只暴露 items）
      const files = []
      if (cd.files && cd.files.length) {
        for (const f of cd.files) files.push(f)
      }
      if (!files.length && cd.items) {
        for (const it of cd.items) {
          if (it.kind === 'file') {
            const f = it.getAsFile()
            if (f) files.push(f)
          }
        }
      }
      // 非文件（纯文本等）→ 不拦截，走默认粘贴
      const file = files[0]
      if (!file) return
      e.preventDefault()
      // 一次只携带一个附件（多文件粘贴以第一个为准）
      if ((file.type || '').startsWith('image/')) {
        // readAsDataURL 在读盘失败时会 reject：不接住就会变成未处理的 Promise 拒绝
        try {
          const dataUrl = await readAsDataURL(file)
          const sizeLabel = file.size > 1048576
            ? (file.size / 1048576).toFixed(1) + ' MB'
            : (file.size / 1024).toFixed(0) + ' KB'
          this.$emit('attach', { name: file.name || '粘贴图片.png', isImage: true, dataUrl, textContent: '', sizeLabel })
        } catch (err) {
          console.error('[composer] 读取粘贴图片失败', err)
          useNotification().error('读取剪贴板图片失败，请重试')
        }
      } else {
        this.$emit('attach', await readFile(file))
      }
    },
  },
}
</script>
