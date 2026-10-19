<template>
  <div class="h-full flex flex-col" :class="floating ? 'rounded-card overflow-hidden' : ''">
    <!-- 顶部（页面模式显示标题） -->
    <div v-if="!floating" class="w-full bg-surface shadow-md rounded-card mb-4 px-5 py-3 border border-border min-h-[4.5rem] flex items-center justify-between">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="ai" /> AI 助手</h1>
      <div class="flex items-center gap-3">
        <span v-if="!enabled" class="text-xs text-text-muted">{{ enabled ? '' : '未启用' }}</span>
        <button
          @click="openDataManage"
          class="bg-surface-hover hover:bg-primary hover:text-text-inverse text-text px-4 py-2 rounded-sm transition-theme flex items-center gap-1.5"
          title="管理聊天记录与 Markdown 技能文件"
        ><Database :size="14" :stroke-width="1.8" /> 数据管理</button>
        <button
          @click="showSettings = true"
          class="bg-surface-hover hover:bg-primary hover:text-text-inverse text-text px-4 py-2 rounded-sm transition-theme flex items-center gap-1.5"
          title="AI 助手设置"
        ><IconGlyph name="settings" :size="14" tint="current" /> 设置</button>
      </div>
    </div>

    <!-- 加载中骨架 -->
    <div v-if="enabled === null" class="flex-1 flex items-center justify-center text-sm text-text-muted chat-surface border border-border bg-white/55 backdrop-blur-md ai-glass-panel">
      <div class="text-center space-y-2">
        <div class="animate-pulse">加载中…</div>
      </div>
    </div>

    <!-- 配置未就绪提示 -->
    <div v-else-if="!enabled" class="flex-1 flex items-center justify-center text-sm text-text-muted chat-surface border border-border bg-white/55 backdrop-blur-md ai-glass-panel">
      <div class="text-center space-y-2">
        <div>AI 助手尚未启用</div>
        <button @click="showSettings = true" class="text-info hover:underline inline-block cursor-pointer">点击【<IconGlyph name="settings" :size="13" tint="current" class="align-middle inline-block" /> 设置】填写 API Key 并启用</button>
      </div>
    </div>

    <template v-else-if="enabled">
      <!-- 外层容器同时是抽屉的定位父级：抽屉作为聊天卡片的「兄弟」而非后代，
           以避开聊天卡片 backdrop-blur-md 形成的 backdrop root（否则抽屉的 backdrop-filter
           无法模糊同为聊天卡片后代的消息文字，字会原样透出来）。 -->
      <div class="relative flex-1 flex gap-3 min-h-0">
        <!-- 聊天区 -->
        <div class="flex-1 flex flex-col min-h-0 bg-white/55 backdrop-blur-md ai-glass-panel border border-border chat-surface p-4 relative">
          <!-- 左上角工具条：卡片上沿一整条「第二层毛玻璃」。
               顶角沿用外层卡片的圆角、底角为 0，像圆角矩形被一条水平线砍一刀的上半部。
               负外边距必须与卡片 p-4 相等，才能铺满卡片上沿 -->
          <div class="chat-toolbar -mx-4 -mt-4 mb-1.5 flex items-center gap-1.5 flex-shrink-0 px-4 py-2">
            <button class="dlg-close" title="对话列表" @click="convDrawerOpen = true">
              <PanelLeft :size="15" stroke-width="1.8" />
            </button>
            <button class="dlg-close" title="新建对话" :disabled="busy" @click="newConversation">
              <Plus :size="15" stroke-width="1.8" />
            </button>
            <span class="chat-tb-divider"></span>
            <span class="chat-tb-title">{{ activeConvTitle || '新对话' }}</span>
          </div>

          <!-- 消息区：左右/上下都留出较宽松的内边距，让对话块与卡片边缘有呼吸感 -->
          <!-- ai-msg-list：见 styles/utilities.css —— 关掉列表内元素的 backdrop-filter，
               避免滚动时每帧重新模糊（气泡/头像/按钮都带模糊层，长对话会明显掉帧） -->
          <div ref="msgBox" class="ai-msg-list flex-1 overflow-auto space-y-4 px-3 py-3" @scroll="onMsgScroll" @click="onMsgClick">
            <AiChatMessages
              :messages="messages"
              :busy="busy"
              :active-reasoning-on="activeReasoningOn"
              :floating="floating"
              :is-retryable="isRetryable"
              :is-rollbackable="isRollbackable"
              :can-undo="canUndoChange"
              @new="newConversation"
              @copy="copyMessage"
              @retry="retryMessage"
              @undo="undoChange"
              @rollback="askRollback"
              @open-changes="openChangeDrawer"
              @goto="gotoTable"
            />
          </div>

          <!-- 附件预览 -->
          <div v-if="attachedFile" class="mb-2 flex items-center gap-2">
            <!-- 图片预览 -->
            <div v-if="attachedFile.isImage" class="relative border border-border rounded-lg overflow-hidden inline-block">
              <img :src="attachedFile.dataUrl" class="max-h-32 max-w-64" />
              <button
                @click="clearAttachment"
                class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-danger text-white rounded-full flex items-center justify-center text-xs leading-none cursor-pointer hover:bg-danger-hover"
                title="移除"
              >✕</button>
            </div>
            <!-- 文件预览 -->
            <div v-else class="relative border border-border rounded-lg bg-surface px-3 py-2 inline-flex items-center gap-2 max-w-full">
              <span class="text-sm">📄</span>
              <span class="text-sm font-medium text-text truncate max-w-40">{{ attachedFile.name }}</span>
              <span class="text-xs text-text-muted flex-shrink-0">({{ attachedFile.sizeLabel }})</span>
              <button
                @click="clearAttachment"
                class="text-text-muted hover:text-danger text-sm leading-none cursor-pointer flex-shrink-0"
                title="移除"
              >✕</button>
            </div>
          </div>

          <!-- 输入区（模型快捷切换已并入输入框右下角工具行） -->
          <AiComposer
            ref="composer"
            v-model:input="input"
            :busy="busy"
            :capturing="capturing"
            :attached-file="attachedFile"
            :pending-ask="pendingAsk"
            :ask-current="askCurrent"
            :ask-page="askPage"
            :ask-can-submit="askCanSubmit"
            :ask-can-advance="askCanAdvance"
            :pending-proposal="pendingProposal"
            :permission-mode="permissionMode"
            :web-search="webSearchOn"
            :search-available="searchAvailable"
            :model-id="activeModelId"
            :model-options="modelOptions"
            :skill-options="skillOptions"
            :selected-skills="selectedSkills"
            @pick-permission="onPickPermission"
            @toggle-search="onToggleSearch"
            @select-skill="onSelectSkill"
            @remove-skill="onRemoveSkill"
            @update:modelId="activeModelId = $event"
            @send="send"
            @interrupt="interrupt"
            @screenshot="captureScreenshot"
            @attach="setAttachment"
            @pick="pickAsk"
            @other="setAskOther"
            @next="askNext"
            @submit="submitAsk"
            @skip="skipAsk"
            @dismiss="dismissAsk"
            @confirm="confirmProposal"
            @dismiss-proposal="dismissProposal"
          />

        </div>

        <!-- 对话列表抽屉：聊天卡片的兄弟（不嵌在其内部），从左侧滑入覆盖聊天区；
             点遮罩 / 关闭按钮 / 选中会话即收起。
             时长用 :duration 显式给出，避免外层容器声明 transition——
             外层一旦真的改变 opacity/transform 就会形成 backdrop-filter 的 backdrop root，
             抽屉玻璃在移动时会采样不到背后内容、模糊被丢掉。 -->
        <Transition name="conv-drawer" :duration="{ enter: 220, leave: 160 }">
          <div v-if="convDrawerOpen" class="absolute inset-0 z-30 chat-surface overflow-hidden">
            <div class="conv-drawer-mask absolute inset-0" @click="convDrawerOpen = false"></div>
            <AiConversationPanel
              :conversations="visibleConversations"
              :active-id="conversationId"
              :busy="busy"
              :hidden-count="hiddenConvCount"
              @new="onConvNew"
              @select="onConvSelect"
              @delete="deleteConversation"
              @close="convDrawerOpen = false"
              @load-more="loadMoreConversations"
            />
          </div>
        </Transition>

        <!-- 网页抽屉：与对话列表抽屉同为聊天卡片的「兄弟」，从右侧滑入覆盖聊天区，
             用于把消息里的链接内嵌打开（点遮罩以外区域 / 关闭按钮即收起，也可「在浏览器打开」）。
             与左侧抽屉不同：外层面板以外的区域「可穿透点击」（pointer-events-none），
             这样抽屉已打开时再点消息里的其它链接会直达消息区、由 onMsgClick 直接切换地址，
             无需先关掉抽屉再点一次；「点外部关闭」改由 document 监听实现。
             动画只作用在 .link-panel（承载 backdrop-filter 的那层），理由同左侧抽屉。 -->
        <Transition name="link-drawer" :duration="{ enter: 220, leave: 160 }">
          <div v-if="linkDrawerOpen" class="absolute inset-0 z-30 chat-surface overflow-hidden pointer-events-none">
            <AiLinkPanel
              :url="linkDrawerUrl"
              @close="linkDrawerOpen = false"
              @open-external="openLinkExternal"
            />
          </div>
        </Transition>

        <!-- 改动明细抽屉：与网页抽屉同为聊天卡片「兄弟」，从右侧滑入。
             同样「面板以外可穿透点击」+ document 监听点外部关闭，动画只作用在 .change-panel。 -->
        <Transition name="change-drawer" :duration="{ enter: 220, leave: 160 }">
          <div v-if="changeDrawerOpen" class="absolute inset-0 z-30 chat-surface overflow-hidden pointer-events-none">
            <AiChangePanel
              :proposal="changeDrawerProposal"
              @close="changeDrawerOpen = false"
              @goto="gotoTable"
            />
          </div>
        </Transition>
      </div>
    </template>

    <!-- 删除确认弹窗 -->
    <ConfirmDialog
      :visible="confirmDeleteShow"
      message="确定删除该对话？删除后无法恢复。"
      :show-cancel="true"
      @confirm="onDeleteConfirm"
      @cancel="confirmDeleteShow = false"
    />

    <!-- 回退确认弹窗：提示 AI 更改的数据可能丢失 -->
    <ConfirmDialog
      :visible="rollbackConfirmShow"
      message="确定回退吗？AI 更改的数据可能会丢失。"
      :show-cancel="true"
      @confirm="onRollbackConfirm"
      @cancel="rollbackConfirmShow = false"
    />

    <!-- 完全权限确认弹窗：高风险挡位，必须显式确认才切换 -->
    <ConfirmDialog
      :visible="permConfirmShow"
      title="开启完全权限"
      message="开启完全权限可能会导致数据被AI意外删除，损坏，甚至攻击，确认开启吗"
      confirm-text="确认开启"
      :show-cancel="true"
      @confirm="onPermConfirm"
      @cancel="permConfirmShow = false"
    />

    <!-- AI 助手设置弹窗 -->
    <AiSettingsDialog :show="showSettings" @close="showSettings = false" @saved="onSettingsSaved" />

    <!-- 数据管理弹窗（标题栏「设置」旁的按钮启动）：首次打开才异步加载 -->
    <DataManageDialog v-if="dataManageOpened" v-model:visible="dataManageOpen" />

    <!-- 截屏选区：主窗口临时铺满整屏，冻结画面铺底 + 框选 + 确定/取消 -->
    <Teleport to="body">
      <div
        v-if="regionShot"
        data-ai-float-keep
        class="region-overlay"
        @mousedown="onRegionDown"
        @mousemove="onRegionMove"
        @mouseup="onRegionUp"
        @contextmenu.prevent
      >
        <img class="region-shot" :src="regionShot" alt="" draggable="false" />
        <div class="region-dim" :style="regionDimStyle"></div>
        <div v-if="regionRect" class="region-rect" :style="regionRectStyle">
          <span class="region-size">{{ Math.round(regionRect.w) }} × {{ Math.round(regionRect.h) }}</span>
        </div>
        <div class="region-toolbar" @mousedown.stop>
          <button class="region-btn region-btn-ok" :disabled="!regionRectReady" @click="confirmRegion">确定</button>
          <button class="region-btn" @click="cancelRegion">取消</button>
        </div>
        <div v-if="!regionRect" class="region-hint">按住鼠标左键拖动，框选要发给 AI 的区域</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ==================== 截屏选区遮罩 ====================
   主窗口此时已被主进程铺满整屏，这里用冻结的画面铺底 + 暗色遮罩挖出选区 */
.region-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  cursor: crosshair;
  user-select: none;
  overflow: hidden;
}
.region-shot {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
}
.region-dim { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.45); }
.region-rect {
  position: absolute;
  border: 1px solid var(--color-primary, #22c55e);
}
.region-size {
  position: absolute;
  top: -22px;
  left: 0;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}
.region-toolbar {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  padding: 6px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.45);
}
.region-btn {
  padding: 5px 16px;
  border-radius: 8px;
  border: 1px solid var(--color-border, #e2e8f0);
  background: var(--color-surface, #fff);
  color: var(--color-text, #111827);
  font-size: 13px;
  cursor: pointer;
}
.region-btn:hover:not(:disabled) {
  border-color: var(--color-primary, #22c55e);
  color: var(--color-primary, #22c55e);
}
.region-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.region-btn-ok {
  background: var(--color-primary, #22c55e);
  border-color: transparent;
  color: #fff;
}
.region-btn-ok:hover:not(:disabled) { color: #fff; opacity: 0.9; }
.region-hint {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12px;
}

/* ==================== 对话列表抽屉 ====================
   遮罩只做「点击关闭」的透明层，不带背景模糊（不虚化下层聊天内容）；
   面板毛玻璃由 .conv-panel 自身的 .bg-surface 提供，从左滑出/滑入，缓动走 easeOutExpo，收尾柔和、不生硬。
   【关键】滑入的 transform 只作用在 .conv-panel（它就是带 backdrop-filter 的那一层），
   外层容器与遮罩都不做 opacity/transform 过渡——父级的 opacity<1 / transform 会形成
   backdrop-filter 的 backdrop root，让玻璃在移动时采样不到背后内容、模糊被丢掉。 */
.conv-drawer-mask {
  background: transparent;
}
.conv-drawer-enter-active .conv-panel {
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
.conv-drawer-leave-active .conv-panel {
  transition: transform 0.16s cubic-bezier(0.4, 0, 0.7, 0.2);
}
.conv-drawer-enter-from .conv-panel,
.conv-drawer-leave-to .conv-panel {
  transform: translateX(calc(-100% - 12px)); /* 额外让出左上角 12px 内边距，确保完全滑出不可见 */
}

/* ==================== 网页抽屉（右侧） ====================
   从右向左滑入/滑出；transform 只作用在承载 backdrop-filter 的 .link-panel 上。
   无遮罩层：外层面板以外的区域设为可穿透点击，抽屉已打开时再点消息里的其它链接
   可直达消息区直接切换地址，不必先关抽屉；「点外部关闭」由 document 监听处理。 */
.link-drawer-enter-active .link-panel {
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
.link-drawer-leave-active .link-panel {
  transition: transform 0.16s cubic-bezier(0.4, 0, 0.7, 0.2);
}
.link-drawer-enter-from .link-panel,
.link-drawer-leave-to .link-panel {
  transform: translateX(calc(100% + 12px)); /* 从右侧完全滑出（含右上角 12px 内边距） */
}

/* ==================== 改动明细抽屉（右侧） ====================
   与网页抽屉同款：从右向左滑入/滑出，transform 只作用在承载 backdrop-filter 的 .change-panel，
   无遮罩层（面板以外可穿透点击），「点外部关闭」由 document 监听处理。 */
.change-drawer-enter-active .change-panel {
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
.change-drawer-leave-active .change-panel {
  transition: transform 0.16s cubic-bezier(0.4, 0, 0.7, 0.2);
}
.change-drawer-enter-from .change-panel,
.change-drawer-leave-to .change-panel {
  transform: translateX(calc(100% + 12px));
}

/* 标题下方的大框（聊天区 / 加载态 / 未启用态）统一到主题卡片圆角，
   与抽屉、弹窗一致：glass / win11 = 20px，glass2 = 22px，其余主题回落 --radius-card。 */
.chat-surface {
  border-radius: var(--radius-surface, var(--radius-card, 12px));
}

/* 聊天区顶部工具条：卡片上沿一整条第二层毛玻璃。
   顶角沿用外层卡片圆角、底角 0，由底部 1px 主题边框色横线切开，
   形成「圆角矩形被水平线砍一刀」的上半部。 */
.chat-toolbar {
  border-bottom: 1px solid var(--color-border);
  border-top-left-radius: var(--radius-surface, var(--radius-card, 12px));
  border-top-right-radius: var(--radius-surface, var(--radius-card, 12px));
}
/* 只在日间给工具条提亮（白 30%，不发黑）；
   夜间不叠白：卡片底本是深蓝，叠白会把整条工具条冲淡发白。 */
:root:not([data-mode="night"]) .chat-toolbar {
  background-color: color-mix(in srgb, #fff 30%, transparent);
}
.chat-toolbar button:disabled { opacity: 0.45; cursor: not-allowed; }
/* 分隔线：1px 竖线，用主题边框色 */
.chat-tb-divider {
  width: 1px;
  height: 16px;
  flex-shrink: 0;
  background: var(--color-border);
}
/* 当前对话名称：占满剩余宽度，过长时省略；字号偏大、加粗，作为聊天区的标题 */
.chat-tb-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
}
</style>

<script>
import { defineAsyncComponent } from 'vue'
import axios from 'axios'
import { PanelLeft, Plus, Database } from '@lucide/vue'
import { useNotification } from '../composables/useNotification.js'
import ConfirmDialog from '../components/base/ConfirmDialog.vue'
import AiConversationPanel from '../components/ai/AiConversationPanel.vue'
import AiLinkPanel from '../components/ai/AiLinkPanel.vue'
import AiChangePanel from '../components/ai/AiChangePanel.vue'
import AiChatMessages from '../components/ai/AiChatMessages.vue'
import AiComposer from '../components/ai/AiComposer/AiComposer.vue'
import { ensureMarkdown, buildBlocks, updateLiveRender } from '../composables/ai/aiMarkdown.js'
import {
  parseMessages, lastAssistant, lastAssistantIndex, buildProc, isAutoMessage,
  isRetryable as isRetryableInList, isRollbackable as isRollbackableInList,
} from '../composables/ai/aiMessages.js'
import { triggerPendingExport as runPendingExport, triggerPendingImage as runPendingImage } from '../composables/ai/aiFiles.js'
import { AI_PERMISSION_KEY, AI_PERMISSION_FULL, AI_WEB_SEARCH_KEY, tableJumpTarget } from '../composables/ai/aiConstants.js'
import aiConversations from '../composables/ai/aiConversations.js'
import aiChat from '../composables/ai/aiChat.js'
import aiExec from '../composables/ai/aiExec.js'
import { INVOKE } from '../electronChannels.js'

// 读取本地保存的写入权限挡位（只有 'full' 视为完全权限，其余一律回落到默认的「全部审批」）
function readPermissionMode() {
  try {
    return localStorage.getItem(AI_PERMISSION_KEY) === AI_PERMISSION_FULL ? AI_PERMISSION_FULL : 'approve'
  } catch (_) { return 'approve' }
}

// 读取本地保存的联网搜索开关：默认开启，仅当显式存 '0' 时视为关闭
function readWebSearchOn() {
  try { return localStorage.getItem(AI_WEB_SEARCH_KEY) !== '0' } catch (_) { return true }
}

// 弹窗按需异步加载（首屏不带这份代码）。defineAsyncComponent 在动态 import 失败后
// 不会自动重试，组件会永久卡在"点了没反应"（HMR/依赖重优化期间的瞬时不稳就会触发）。
// 这里包一层重试：最多 3 次、间隔 300ms，让偶发加载失败能自愈，不必整页刷新。
function lazyDialog(loader) {
  return defineAsyncComponent(() => new Promise((resolve, reject) => {
    let tries = 0
    const attempt = () => {
      loader().then(resolve).catch((err) => {
        if (++tries >= 3) return reject(err)
        setTimeout(attempt, 300)
      })
    }
    attempt()
  }))
}

// AI 设置弹窗异步化：只在点设置时渲染，无已渲染路径（P2）
const AiSettingsDialog = lazyDialog(() => import('../components/dialogs/AiSettingsDialog.vue'))
// 数据管理弹窗异步化：只在首次点「数据管理」时加载，避免进入 AI 助手就带上这份代码
const DataManageDialog = lazyDialog(() => import('../components/data-manage/DataManageDialog.vue'))

export default {
  name: 'AiAssistant',
  components: { AiSettingsDialog, DataManageDialog, ConfirmDialog, AiConversationPanel, AiLinkPanel, AiChangePanel, AiChatMessages, AiComposer, PanelLeft, Plus, Database },
  // 逻辑模块以 mixin 合并为实例方法/computed，方法体保留 this.xxx 写法（不搬 data/watch/mounted/unmounted）
  mixins: [aiConversations, aiChat, aiExec],
  props: {
    // 页面模式 / 悬浮呼出模式（紧凑）
    floating: { type: Boolean, default: false },
  },
  emits: ['close'],
  data() {
    return {
      enabled: null, // null=加载中, false=未启用, true=已启用
      busy: false,
      messages: [],
      hasEarlier: false, // 是否还有更早的历史消息可补载（滚动到顶部时触发）
      loadingEarlier: false, // 更早历史补载中（防重入）
      earliestMsgId: null, // 已加载消息中最早一条的落库 id（上翻分页游标）
      input: '',
      conversationId: null, // 当前会话 id（持久化用），null 表示尚未创建
      conversationList: [], // 会话列表
      showSettings: false, // AI 设置弹窗
      dataManageOpen: false, // 数据管理弹窗是否显示
      dataManageOpened: false, // 是否已首次打开过（首次打开才异步加载弹窗代码）
      confirmDeleteShow: false, // 删除确认弹窗
      confirmDeleteId: null, // 待删除的会话 id
      rollbackConfirmShow: false, // 回退确认弹窗
      attachedFile: null,    // 当前待发送的附件：{name, isImage, dataUrl, textContent, sizeLabel}
      capturing: false,      // 截屏进行中（按钮转圈并禁用，避免重复触发）
      abortCtrl: null,       // 当前流式请求的 AbortController（供「中断」按钮停止响应）
      regionShot: null,      // 选区截屏的冻结画面（dataURL），非空时显示全屏选区遮罩
      regionRect: null,      // 已框选区域（视口 CSS 像素）：{x, y, w, h}
      regionDragging: false,
      regionStart: null,
      models: [],            // 已配置的模型列表（供输入区快捷切换）
      activeModelId: null,   // 当前选中的模型 id
      convDrawerOpen: false, // 对话列表抽屉是否展开
      linkDrawerOpen: false, // 网页抽屉是否展开（点击消息里的链接时打开）
      linkDrawerUrl: '',     // 网页抽屉当前打开的地址
      changeDrawerOpen: false, // 改动明细抽屉是否展开（点击改动总结条的「↗」时打开）
      changeDrawerProposal: null, // 改动明细抽屉展示的提案
      visibleConvCount: 3, // 会话列表默认只渲染最近 3 条，其余点「加载更多」再显示
      askPage: 0, // 多问题提问的分页索引（一页一题，从 0 开始）
      // AI 写入权限挡位：'approve' 全部审批（每次写入都要确认）/ 'full' 完全权限（写入提案自动执行）
      permissionMode: readPermissionMode(),
      webSearchOn: readWebSearchOn(), // 联网搜索开关（仅 DeepSeek 模式可用，本地持久化）
      permConfirmShow: false, // 切到完全权限前的风险确认弹窗
      // 技能（md 指令文件）：可选列表来自「数据管理」页；输入框打「/」选中后加入已选，随本轮请求注入系统提示
      skillOptions: [],
      selectedSkills: [],
    }
  },
  computed: {
    // 当前选中的模型是否为 DeepSeek：联网搜索仅在该模式下可用，据此决定开关是否显示
    searchAvailable() {
      const m = this.models.find((x) => x.is_active)
      return !!(m && m.provider === 'deepseek')
    },
    regionRectReady() {
      const r = this.regionRect
      return !!(r && r.w >= 4 && r.h >= 4)
    },
    // 当前会话标题（聊天区工具条上显示；未匹配到时为空）
    activeConvTitle() {
      const c = this.conversationList.find((x) => x.id === this.conversationId)
      return c ? c.title : ''
    },
    // 暗色遮罩上按选区挖洞：用 clip-path 多边形留出选区，拖动时只改这一个属性
    regionDimStyle() {
      const r = this.regionRect
      if (!r) return {}
      const { x, y, w, h } = r
      return { clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ${x + w}px ${y}px, ${x}px ${y}px)` }
    },
    regionRectStyle() {
      const r = this.regionRect
      return r ? { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' } : {}
    },
  },
  watch: {
    // 冒出新的待回答提问时，分页回到第一题
    pendingAsk(a) {
      if (a) this.askPage = 0
    },
    // 网页抽屉打开时挂 document 级监听：点击「抽屉面板以外、且不是消息链接」的地方即收起。
    // 之所以不在模板里放遮罩层：遮罩会盖住消息区，导致抽屉已打开时再点其它链接被遮罩吃掉，
    // 变成「先关抽屉、还要再点一次」；改用面板穿透 + document 监听后，点链接直达 onMsgClick 直接切换。
    linkDrawerOpen() { this.updateOutsideListener() },
    changeDrawerOpen() { this.updateOutsideListener() },
  },
  mounted() {
    // 后台预加载 markdown 库（不阻塞首次渲染）
    ensureMarkdown().then(() => this._computeAllHtml())
    this.loadEnabled()
    this.loadSkillOptions()
  },
  unmounted() {
    // 卸载时若仍在选区截屏，先把窗口还原，避免主窗口停在铺满整屏的状态
    if (this.regionShot) this.endRegionSelect()
    document.removeEventListener('mousedown', this.onDocMouseDown, true)
  },
  methods: {
    // ===== 薄转发：把纯函数模块桥接为实例方法，供本组件与方法组内的 this.xxx 调用 =====
    _buildBlocks(content) { return buildBlocks(content) },
    _updateLiveRender(m) { return updateLiveRender(m) },
    _parseMessages(rows) { return parseMessages(rows) },
    _lastAssistantIndex() { return lastAssistantIndex(this.messages) },
    _lastAssistant() { return lastAssistant(this.messages) },
    _buildProc(m) { return buildProc(m) },
    _isAutoMessage(m) { return isAutoMessage(m) },
    isRetryable(i) { return isRetryableInList(this.messages, i, this.busy) },
    isRollbackable(i) { return isRollbackableInList(this.messages, i, this.busy) },
    triggerPendingExport(m) { return runPendingExport(m) },
    triggerPendingImage(m) { return runPendingImage(m) },
    // 附件：由 AiComposer 读取/粘贴后回填到父状态
    setAttachment(file) { this.attachedFile = file },
    clearAttachment() {
      this.attachedFile = null
    },
    // ===== 技能（md 指令文件）：输入框打「/」按文件名匹配，选中即随本轮请求启用 =====
    // 拉取可选技能名（失败静默，不影响聊天）
    async loadSkillOptions() {
      try {
        const { data } = await axios.get('/api/ai/skills')
        const list = (data && data.data) || []
        this.skillOptions = list.map((s) => s && s.name).filter(Boolean)
        // 已选技能若已被删除，从已选里清掉
        this.selectedSkills = this.selectedSkills.filter((n) => this.skillOptions.includes(n))
      } catch (_) { this.skillOptions = [] }
    },
    // 选中一个技能：加入已选（去重）
    onSelectSkill(name) {
      if (!name || this.selectedSkills.includes(name)) return
      this.selectedSkills.push(name)
    },
    // 移除已选技能
    onRemoveSkill(name) {
      this.selectedSkills = this.selectedSkills.filter((n) => n !== name)
    },
    // 打开数据管理弹窗（标题栏「设置」旁的按钮）：首次打开时才异步加载弹窗组件
    openDataManage() {
      this.dataManageOpened = true
      this.dataManageOpen = true
    },
    // ===== 写入权限挡位（输入框工具行左下的「全部审批 / 完全权限」）=====
    // 选挡位：切到完全权限前先弹风险确认（高风险，必须显式确认）；切回全部审批立即生效
    onPickPermission(mode) {
      if (mode === this.permissionMode) return
      if (mode === AI_PERMISSION_FULL) { this.permConfirmShow = true; return }
      this.setPermissionMode('approve')
    },
    // 确认开启完全权限
    onPermConfirm() {
      this.permConfirmShow = false
      this.setPermissionMode(AI_PERMISSION_FULL)
    },
    // 写入挡位并持久化（下次打开沿用）
    setPermissionMode(mode) {
      this.permissionMode = mode
      try { localStorage.setItem(AI_PERMISSION_KEY, mode) } catch (_) { /* 忽略 */ }
    },
    // 切换联网搜索开关并持久化（下次打开沿用）
    onToggleSearch() {
      this.webSearchOn = !this.webSearchOn
      try { localStorage.setItem(AI_WEB_SEARCH_KEY, this.webSearchOn ? '1' : '0') } catch (_) { /* 忽略 */ }
    },
    // 抽屉内新建 / 切换会话后自动收起抽屉
    onConvNew() {
      this.newConversation()
      this.convDrawerOpen = false
    },
    onConvSelect(id) {
      this.switchConversation(id)
      this.convDrawerOpen = false
    },
    // 截屏：主进程先隐藏窗口截取整屏，本组件铺满整屏显示冻结画面供框选，确定后作为图片附件交给 AI
    async captureScreenshot() {
      const { error: notifyError } = useNotification()
      if (this.capturing || this.regionShot) return
      if (!window.electron || !window.electron.invoke) {
        notifyError('当前环境不支持截屏，请在桌面客户端中使用')
        return
      }
      this.capturing = true
      try {
        // 窗口模式：截屏时主窗口保持可见（画面带上应用界面），先把 AI 浮窗收起到图标位置，
        // 等收起动画走完再截，避免浮窗被截进画面；截屏结束后由 endRegionSelect 通知宿主重新展开
        if (this.floating) {
          this.$emit('capture-start')
          await new Promise((r) => setTimeout(r, 160))
        }
        const res = await window.electron.invoke(INVOKE.SCREENSHOT_REGION)
        if (!res || !res.success) throw new Error((res && res.error) || '截屏失败')
        this.regionShot = res.dataUrl
        this.regionRect = null
        // 等渲染层把冻结画面画好，再让窗口铺满整屏显示遮罩，避免露出原界面闪一下
        await this.$nextTick()
        await new Promise((r) => requestAnimationFrame(r))
        await window.electron.invoke(INVOKE.SCREENSHOT_REGION_SHOW)
        document.addEventListener('keydown', this.onRegionKey)
      } catch (err) {
        await this.endRegionSelect()
        notifyError('截屏失败：' + (err.message || '未知错误'))
      } finally {
        this.capturing = false
      }
    },
    // 选区开始：记录起点并初始化零尺寸选区
    onRegionDown(e) {
      if (e.button !== 0) return
      this.regionDragging = true
      this.regionStart = { x: e.clientX, y: e.clientY }
      this.regionRect = { x: e.clientX, y: e.clientY, w: 0, h: 0 }
    },
    onRegionMove(e) {
      if (!this.regionDragging || !this.regionStart) return
      const s = this.regionStart
      this.regionRect = {
        x: Math.min(s.x, e.clientX),
        y: Math.min(s.y, e.clientY),
        w: Math.abs(e.clientX - s.x),
        h: Math.abs(e.clientY - s.y),
      }
    },
    onRegionUp() {
      if (!this.regionDragging) return
      this.regionDragging = false
      // 误点（几乎没拖动）视为未框选，避免出现 1px 的选区
      if (this.regionRect && (this.regionRect.w < 4 || this.regionRect.h < 4)) this.regionRect = null
    },
    onRegionKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        this.cancelRegion()
      } else if (e.key === 'Enter' && this.regionRectReady) {
        e.preventDefault()
        this.confirmRegion()
      }
    },
    // 确定：按「视口尺寸 ↔ 原图尺寸」比例裁出选区，作为附件发给 AI
    async confirmRegion() {
      const rect = this.regionRect
      const shot = this.regionShot
      if (!rect || !shot || !this.regionRectReady) return
      const { error: notifyError } = useNotification()
      try {
        const img = new Image()
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = () => reject(new Error('图片加载失败'))
          img.src = shot
        })
        const scaleX = img.naturalWidth / window.innerWidth
        const scaleY = img.naturalHeight / window.innerHeight
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(rect.w * scaleX))
        canvas.height = Math.max(1, Math.round(rect.h * scaleY))
        const ctx = canvas.getContext('2d')
        ctx.drawImage(
          img,
          Math.round(rect.x * scaleX), Math.round(rect.y * scaleY), canvas.width, canvas.height,
          0, 0, canvas.width, canvas.height
        )
        const dataUrl = canvas.toDataURL('image/png')
        // 由 base64 长度估算图片大小（base64 约为原始字节的 4/3）
        const bytes = Math.round((dataUrl.split(',')[1] || '').length * 0.75)
        const sizeLabel = bytes > 1048576
          ? (bytes / 1048576).toFixed(1) + ' MB'
          : (bytes / 1024).toFixed(0) + ' KB'
        await this.endRegionSelect()
        this.attachedFile = { name: '截屏.png', isImage: true, dataUrl, textContent: '', sizeLabel }
      } catch (err) {
        await this.endRegionSelect()
        notifyError('截屏失败：' + (err.message || '未知错误'))
      }
    },
    cancelRegion() {
      this.endRegionSelect()
    },
    // 结束选区：先让主进程把窗口还原到截屏前状态，再清掉遮罩（顺序反了会露出铺满整屏的界面）
    async endRegionSelect() {
      document.removeEventListener('keydown', this.onRegionKey)
      try {
        if (window.electron && window.electron.invoke) await window.electron.invoke(INVOKE.SCREENSHOT_REGION_END)
      } catch (_) { /* 忽略 */ }
      this.regionShot = null
      this.regionRect = null
      this.regionDragging = false
      this.regionStart = null
      // 窗口模式：截屏流程结束，通知宿主把收起的 AI 浮窗重新展开
      if (this.floating) this.$emit('capture-end')
    },
    // 聊天区滚动到接近顶部时补载更早的历史消息（贴底由 scrollBottom 负责）
    onMsgScroll() {
      const box = this.$refs.msgBox
      if (!box || box.scrollTop > 60) return
      if (!this.hasEarlier || this.loadingEarlier) return
      this.loadEarlier()
    },
    // 点击消息里的网页链接：拦下 <a href>，默认在右侧网页抽屉内打开（不再跳转 Electron 窗口）
    onMsgClick(e) {
      if (!this.isHttpLink(e.target)) return
      const a = e.target.closest('a[href]')
      e.preventDefault()
      this.openLinkInDrawer(a.getAttribute('href') || '')
    },
    // 事件目标是否落在消息里「可内嵌打开」的 http(s) 链接内（onMsgClick 与 onDocMouseDown 共用）
    isHttpLink(t) {
      const a = t && t.closest ? t.closest('a[href]') : null
      if (!a) return false
      return /^https?:\/\//i.test(a.getAttribute('href') || '')
    },
    // 任一侧抽屉打开时挂 document 级监听，两扇都收起后摘除（同一函数引用，重复 add 为幂等）
    updateOutsideListener() {
      if (this.linkDrawerOpen || this.changeDrawerOpen) {
        document.addEventListener('mousedown', this.onDocMouseDown, true)
      } else {
        document.removeEventListener('mousedown', this.onDocMouseDown, true)
      }
    },
    // 点抽屉外部关闭：命中面板内、或点击的是消息链接 / 改动总结条上的「↗」时都不关闭
    // （后两者分别交给 onMsgClick / openChangeDrawer 直接切换，实现「抽屉已打开时无需先关掉」）
    onDocMouseDown(e) {
      const t = e.target
      const inLink = t && t.closest && (t.closest('.link-panel') || this.isHttpLink(t))
      if (!inLink) this.linkDrawerOpen = false
      const inChange = t && t.closest && (t.closest('.change-panel') || t.closest('.open-changes-btn'))
      if (!inChange) this.changeDrawerOpen = false
    },
    // 打开改动明细抽屉（已有抽屉则复用，仅切换展示的提案；同一提案重复点则收起，避免无反应）
    openChangeDrawer(m) {
      // 浮窗（窗口）模式精简：不提供改动明细抽屉
      if (this.floating) return
      const p = m && m.proposal
      if (!p) return
      if (this.changeDrawerOpen && this.changeDrawerProposal === p) { this.changeDrawerOpen = false; return }
      this.changeDrawerProposal = p
      this.changeDrawerOpen = true
    },
    // 从改动明细抽屉跳转到对应业务表：带 ?focus=<id> 时目标页会滚动到该行并闪动高亮
    // （复用 useRowFocus），跳转前先收起抽屉。
    gotoTable({ table, id, focus }) {
      const target = tableJumpTarget(table, id)
      if (!target) return
      this.changeDrawerOpen = false
      // focus 优先：网格表（课表/座位/权重）改动明细可带「精确到格子」的定位串
      const query = focus ? { focus } : target.query
      this.$router.push(query ? { path: target.path, query } : { path: target.path })
    },
    // 在右侧抽屉里打开某个地址（已有抽屉则复用，仅切换地址）
    openLinkInDrawer(url) {
      this.linkDrawerUrl = url
      this.linkDrawerOpen = true
    },
    // 用系统默认浏览器打开当前抽屉里的地址
    openLinkExternal(url) {
      if (!url) return
      if (window.electron && window.electron.invoke) window.electron.invoke(INVOKE.OPEN_EXTERNAL, url)
    },
    // 置底：合并到下一帧执行。流式输出时每个 chunk 都会请求置底，
    // 若每次都同步读写 scrollTop / scrollHeight 会反复触发强制布局；
    // 用 rAF 去重，把同一帧内的多次请求合并为一次（行为不变，仍始终贴底）。
    scrollBottom() {
      this.$nextTick(() => {
        if (this._scrollRaf) return
        this._scrollRaf = requestAnimationFrame(() => {
          this._scrollRaf = null
          const box = this.$refs.msgBox
          if (box) box.scrollTop = box.scrollHeight
        })
      })
    },
  },
}
</script>
