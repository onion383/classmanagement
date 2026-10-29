<template>
  <!-- 右侧网页抽屉：与左侧「对话列表」抽屉同款毛玻璃卡片，从右侧滑入，内嵌 <webview> 打开链接网页。
       webview 由模板声明（vite.config 里已按 isCustomElement 放行），交给 Vue 管理节点生命周期；
       早期版本用 createElement + appendChild 手动挂载，现在不需要了。
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
    <div class="relative flex-1 min-h-0 link-host">
      <!-- 独立会话分区（无 persist: 前缀 = 内存级）：外部网页的 Cookie / localStorage / 登录态
           与本应用的 default session 完全隔离，互不可见、互不影响，关闭后即清空。 -->
      <webview
        ref="wv"
        class="link-webview absolute inset-0"
        partition="ai-link-preview"
        :src="url || 'about:blank'"
      />
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center text-sm text-text-muted pointer-events-none">加载中…</div>
      <div v-if="failed" class="absolute inset-x-0 top-0 text-center text-xs text-danger py-1.5 bg-surface/80">网页加载失败，可能不允许内嵌，可点右上角「在浏览器打开」</div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

defineOptions({ name: 'AiLinkPanel' })

const props = defineProps({
  url: { type: String, default: '' },
})
defineEmits(['close', 'open-external'])

const pageTitle = ref('')
const loading = ref(false)
const failed = ref(false)
// 模板 ref：webview 元素由 Vue 创建/销毁，这里只拿引用挂事件监听
const wv = ref(null)

let _onTitle = null
let _onStart = null
let _onStop = null
let _onFail = null

// 抽屉已打开时切换链接：src 由模板绑定驱动（Vue 更新属性即触发导航），这里只清旧标题
watch(() => props.url, () => {
  pageTitle.value = ''
})

onMounted(() => {
  const el = wv.value
  if (!el) return
  // 标题/加载态：webview 支持的三个标准事件
  _onTitle = (e) => { pageTitle.value = (e && e.title) || '' }
  _onStart = () => { loading.value = true; failed.value = false }
  _onStop = () => { loading.value = false }
  _onFail = (e) => {
    loading.value = false
    // errorCode -3（ABORTED）多出现在重定向/被取消场景，忽略；其余主框架失败才提示
    if (e && e.errorCode !== -3 && e.isMainFrame !== false) failed.value = true
  }
  el.addEventListener('page-title-updated', _onTitle)
  el.addEventListener('did-start-loading', _onStart)
  el.addEventListener('did-stop-loading', _onStop)
  el.addEventListener('did-fail-load', _onFail)
  loading.value = true
})

onBeforeUnmount(() => {
  const el = wv.value
  if (!el) return
  // 元素本身由 Vue 卸载，这里只摘监听，避免持有已销毁节点
  if (_onTitle) el.removeEventListener('page-title-updated', _onTitle)
  if (_onStart) el.removeEventListener('did-start-loading', _onStart)
  if (_onStop) el.removeEventListener('did-stop-loading', _onStop)
  if (_onFail) el.removeEventListener('did-fail-load', _onFail)
  _onTitle = _onStart = _onStop = _onFail = null
})

function hostOf(url) {
  try { return new URL(url).host } catch (_) { return url }
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
/* 抽屉内圆角统一为主题表面圆角，压掉毛玻璃主题给 button 的皮肤与 .dlg-close 的默认档。 */
.link-panel,
.link-panel button {
  border-radius: var(--radius-surface) !important;
}
/* 内嵌网页是矩形，只让外层面板裁角 */
.link-host { overflow: hidden; }
/* webview 原先是 JS 设 inline style（100%/100%/flex/无边框），改由类统一描述 */
.link-webview {
  width: 100%;
  height: 100%;
  display: flex;
  border: none;
}
</style>
