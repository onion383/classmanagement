<template>
  <!-- 右侧网页抽屉：与左侧「对话列表」抽屉同款毛玻璃卡片，从右侧滑入，内嵌 <webview> 打开链接网页。
       项目未配置 Vue 自定义元素白名单，故 webview 用 JS 动态创建、装载时挂到 host、卸载时摘除。
       flex 布局让头部固定、正文自适应撑满。 -->
  <div class="link-panel pointer-events-auto absolute top-3 right-3 bottom-3 w-[520px] max-w-[72%] bg-surface border border-border shadow-md overflow-hidden flex flex-col">
    <div class="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-border flex-shrink-0">
      <div class="min-w-0 flex-1">
        <div class="text-[13px] font-semibold text-text truncate leading-none">{{ pageTitle || hostOf(url) }}</div>
        <div class="text-[11px] text-text-muted truncate leading-none mt-1">{{ url }}</div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button
          class="text-text-muted hover:text-text text-xs leading-none cursor-pointer px-1.5 py-1 whitespace-nowrap"
          title="在系统默认浏览器打开"
          @click="$emit('open-external', url)"
        >在浏览器打开</button>
        <button class="dlg-close" title="关闭" @click="$emit('close')">✕</button>
      </div>
    </div>
    <div class="relative flex-1 min-h-0">
      <div ref="host" class="link-host absolute inset-0"></div>
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center text-sm text-text-muted pointer-events-none">加载中…</div>
      <div v-if="failed" class="absolute inset-x-0 top-0 text-center text-xs text-danger py-1.5 bg-surface/80">网页加载失败，可能不允许内嵌，可点右上角「在浏览器打开」</div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'AiLinkPanel',
  props: {
    url: { type: String, default: '' },
  },
  emits: ['close', 'open-external'],
  data() {
    return { pageTitle: '', loading: false, failed: false }
  },
  watch: {
    // 抽屉已打开时切换链接：直接改 webview 的 src 复用同一个进程，不重建
    url(v) {
      if (this._wv && v) this._wv.setAttribute('src', v)
      this.pageTitle = ''
    },
  },
  mounted() {
    this._createWebview()
  },
  beforeUnmount() {
    const wv = this._wv
    if (wv) {
      if (this._onTitle) wv.removeEventListener('page-title-updated', this._onTitle)
      if (this._onStart) wv.removeEventListener('did-start-loading', this._onStart)
      if (this._onStop) wv.removeEventListener('did-stop-loading', this._onStop)
      if (this._onFail) wv.removeEventListener('did-fail-load', this._onFail)
      if (wv.parentNode) wv.parentNode.removeChild(wv)
    }
    this._wv = null
  },
  methods: {
    hostOf(url) {
      try { return new URL(url).host } catch (_) { return url }
    },
    _createWebview() {
      const host = this.$refs.host
      if (!host) return
      const wv = document.createElement('webview')
      // 独立会话分区（无 persist: 前缀 = 内存级）：外部网页的 Cookie / localStorage / 登录态
      // 与本应用的 default session 完全隔离，互不可见、互不影响，关闭后即清空。
      wv.setAttribute('partition', 'ai-link-preview')
      wv.setAttribute('src', this.url || 'about:blank')
      wv.style.width = '100%'
      wv.style.height = '100%'
      wv.style.display = 'flex'
      wv.style.border = 'none'
      // 标题/加载态：webview 支持的三个标准事件
      this._onTitle = (e) => { this.pageTitle = (e && e.title) || '' }
      this._onStart = () => { this.loading = true; this.failed = false }
      this._onStop = () => { this.loading = false }
      this._onFail = (e) => {
        this.loading = false
        // errorCode -3（ABORTED）多出现在重定向/被取消场景，忽略；其余主框架失败才提示
        if (e && e.errorCode !== -3 && e.isMainFrame !== false) this.failed = true
      }
      wv.addEventListener('page-title-updated', this._onTitle)
      wv.addEventListener('did-start-loading', this._onStart)
      wv.addEventListener('did-stop-loading', this._onStop)
      wv.addEventListener('did-fail-load', this._onFail)
      this._wv = wv
      host.appendChild(wv)
      this.loading = true
    },
  },
}
</script>

<style scoped>
/* 面板本体：position 必须保持 absolute（压掉 .bg-surface 自带的 relative），玻璃配方对齐左侧会话抽屉。
   选择器用 .bg-surface.link-panel 提高到 (0,3,0)，理由同 AiConversationPanel（主题注入顺序会飘）。 */
.bg-surface.link-panel {
  position: absolute !important;
  backdrop-filter: blur(30px) saturate(1.2) !important;
  background-color: rgba(255, 255, 255, 0.5) !important;
  /* 极淡暖黄调，与左侧抽屉一致 */
  background-image: linear-gradient(rgba(255, 205, 130, 0.01), rgba(255, 205, 130, 0.01));
}
/* 抽屉内圆角统一为主题卡片圆角，压掉毛玻璃主题给 button 硬编码的 12px 皮肤与 .dlg-close 的 --radius-md */
.link-panel,
.link-panel button {
  border-radius: var(--radius-surface, var(--radius-card, 12px)) !important;
}
/* 内嵌网页是矩形，只让外层面板裁角 */
.link-host { overflow: hidden; }
</style>
