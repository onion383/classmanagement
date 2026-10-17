<template>
  <div class="h-full flex flex-col" :class="floating ? 'rounded-card overflow-hidden' : ''">
    <!-- 顶部（页面模式显示标题） -->
    <div v-if="!floating" class="w-full bg-surface shadow-md rounded-card mb-4 px-5 py-3 border border-border min-h-[4.5rem] flex items-center justify-between">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="ai" /> AI 助手</h1>
      <div class="flex items-center gap-3">
        <span v-if="!enabled" class="text-xs text-text-muted">{{ enabled ? '' : '未启用' }}</span>
        <button
          @click="showSettings = true"
          class="bg-surface-hover hover:bg-primary hover:text-text-inverse text-text px-4 py-2 rounded-sm transition-theme flex items-center gap-1.5"
          title="AI 助手设置"
        ><IconGlyph name="settings" :size="14" tint="current" /> 设置</button>
      </div>
    </div>

    <!-- 加载中骨架 -->
    <div v-if="enabled === null" class="flex-1 flex items-center justify-center text-sm text-text-muted rounded-card border border-border bg-white/55 backdrop-blur-md ai-glass-panel">
      <div class="text-center space-y-2">
        <div class="animate-pulse">加载中…</div>
      </div>
    </div>

    <!-- 配置未就绪提示 -->
    <div v-else-if="!enabled" class="flex-1 flex items-center justify-center text-sm text-text-muted rounded-card border border-border bg-white/55 backdrop-blur-md ai-glass-panel">
      <div class="text-center space-y-2">
        <div>AI 助手尚未启用</div>
        <button @click="showSettings = true" class="text-info hover:underline inline-block cursor-pointer">点击【<IconGlyph name="settings" :size="13" tint="current" class="align-middle inline-block" /> 设置】填写 API Key 并启用</button>
      </div>
    </div>

    <template v-else-if="enabled">
      <div class="flex-1 flex gap-3 min-h-0">
        <!-- 左侧会话列表：可折叠（折叠后变成 1/2/3 数字栏），折叠状态写入 localStorage 记忆 -->
        <AiConversationPanel
          :conversations="visibleConversations"
          :active-id="conversationId"
          :collapsed="convCollapsed"
          :busy="busy"
          :hidden-count="hiddenConvCount"
          @new="newConversation"
          @select="switchConversation"
          @delete="deleteConversation"
          @toggle-collapse="toggleConvCollapsed"
          @load-more="loadMoreConversations"
        />

        <!-- 右侧聊天区 -->
        <div class="flex-1 flex flex-col min-h-0 bg-white/55 backdrop-blur-md ai-glass-panel border border-border rounded-card p-3">
          <!-- 消息区 -->
          <div ref="msgBox" class="flex-1 overflow-auto space-y-3 pr-1">
            <AiChatMessages
              :messages="messages"
              :busy="busy"
              :active-reasoning-on="activeReasoningOn"
              :is-retryable="isRetryable"
              :is-rollbackable="isRollbackable"
              :can-undo="canUndoChange"
              @new="newConversation"
              @copy="copyMessage"
              @retry="retryMessage"
              @undo="undoChange"
              @rollback="askRollback"
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

          <!-- 模型快捷切换 -->
          <div v-if="models.length" class="mb-1.5 flex items-center justify-end gap-1.5 flex-shrink-0">
            <span class="text-[10px] text-text-muted">模型</span>
            <AppSelect
              v-model="activeModelId"
              :options="modelOptions"
              :disabled="busy"
              compact
              class="!w-40 !text-xs"
              title="快捷切换当前模型"
            />
          </div>

          <!-- 输入区 -->
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
            @send="send"
            @interrupt="interrupt"
            @screenshot="captureScreenshot"
            @attach="setAttachment"
            @pick="pickAsk"
            @other="setAskOther"
            @next="askNext"
            @submit="submitAsk"
            @dismiss="dismissAsk"
            @confirm="confirmProposal"
            @dismiss-proposal="dismissProposal"
          />
        </div>
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

    <!-- AI 助手设置弹窗 -->
    <AiSettingsDialog :show="showSettings" @close="showSettings = false" @saved="onSettingsSaved" />

    <!-- 截屏选区：主窗口临时铺满整屏，冻结画面铺底 + 框选 + 确定/取消 -->
    <Teleport to="body">
      <div
        v-if="regionShot"
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
</style>

<script>
import { defineAsyncComponent } from 'vue'
import { useNotification } from '../composables/useNotification.js'
import ConfirmDialog from '../components/base/ConfirmDialog.vue'
import AppSelect from '../components/base/AppSelect.vue'
import AiConversationPanel from '../components/ai/AiConversationPanel.vue'
import AiChatMessages from '../components/ai/AiChatMessages.vue'
import AiComposer from '../components/ai/AiComposer.vue'
import { CONV_COLLAPSE_KEY } from '../composables/ai/aiConstants.js'
import { ensureMarkdown, buildBlocks, updateLiveRender } from '../composables/ai/aiMarkdown.js'
import {
  parseMessages, lastAssistant, lastAssistantIndex, buildProc, isAutoMessage,
  isRetryable as isRetryableInList, isRollbackable as isRollbackableInList,
} from '../composables/ai/aiMessages.js'
import { triggerPendingExport as runPendingExport, triggerPendingImage as runPendingImage } from '../composables/ai/aiFiles.js'
import aiConversations from '../composables/ai/aiConversations.js'
import aiChat from '../composables/ai/aiChat.js'
import aiExec from '../composables/ai/aiExec.js'

// AI 设置弹窗异步化：只在点设置时渲染，无已渲染路径（P2）
const AiSettingsDialog = defineAsyncComponent(() => import('../components/dialogs/AiSettingsDialog.vue'))

export default {
  name: 'AiAssistant',
  components: { AiSettingsDialog, ConfirmDialog, AppSelect, AiConversationPanel, AiChatMessages, AiComposer },
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
      input: '',
      conversationId: null, // 当前会话 id（持久化用），null 表示尚未创建
      conversationList: [], // 会话列表
      showSettings: false, // AI 设置弹窗
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
      convCollapsed: localStorage.getItem(CONV_COLLAPSE_KEY) === '1', // 会话列表是否折叠
      visibleConvCount: 3, // 会话列表默认只渲染最近 3 条，其余点「加载更多」再显示
      askPage: 0, // 多问题提问的分页索引（一页一题，从 0 开始）
    }
  },
  computed: {
    // 选区截屏：框选区域是否已达到可确认的最小尺寸
    regionRectReady() {
      const r = this.regionRect
      return !!(r && r.w >= 4 && r.h >= 4)
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
  },
  mounted() {
    // 后台预加载 markdown 库（不阻塞首次渲染）
    ensureMarkdown().then(() => this._computeAllHtml())
    this.loadEnabled()
  },
  unmounted() {
    // 卸载时若仍在选区截屏，先把窗口还原，避免主窗口停在铺满整屏的状态
    if (this.regionShot) this.endRegionSelect()
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
        const res = await window.electron.invoke('screenshot-region')
        if (!res || !res.success) throw new Error((res && res.error) || '截屏失败')
        this.regionShot = res.dataUrl
        this.regionRect = null
        // 等渲染层把冻结画面画好，再让窗口铺满整屏显示遮罩，避免露出原界面闪一下
        await this.$nextTick()
        await new Promise((r) => requestAnimationFrame(r))
        await window.electron.invoke('screenshot-region-show')
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
        if (window.electron && window.electron.invoke) await window.electron.invoke('screenshot-region-end')
      } catch (_) { /* 忽略 */ }
      this.regionShot = null
      this.regionRect = null
      this.regionDragging = false
      this.regionStart = null
    },
    scrollBottom() {
      this.$nextTick(() => {
        const box = this.$refs.msgBox
        if (box) box.scrollTop = box.scrollHeight
      })
    },
  },
}
</script>
