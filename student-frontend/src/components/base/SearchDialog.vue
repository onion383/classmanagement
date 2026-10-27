<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="visible"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10001] pointer-events-auto no-dialog-pulse"
        @click.self="$emit('close')"
      >
        <div class="bg-surface p-5 rounded-xl w-[600px] max-w-full shadow-lg dialog-card">
          <!-- 搜索框：沿用弹窗表单输入框规格（与添加学生等弹窗一致），左侧放大镜 -->
          <div class="relative mb-6">
            <Search :size="16" stroke-width="2.2" class="absolute left-3 top-1/2 -translate-y-1/2 z-[1] text-text-secondary pointer-events-none" />
            <input
              ref="inputEl"
              v-model="keyword"
              type="text"
              placeholder="搜索页面或设置…"
              autocomplete="off"
              spellcheck="false"
              class="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-surface-hover border border-border text-text focus:outline-none focus:border-primary"
              @keydown.down.prevent="moveActive(1)"
              @keydown.up.prevent="moveActive(-1)"
              @keydown.enter.prevent="confirmActive"
              @keydown.esc="$emit('close')"
            />
          </div>

          <!-- p-1：聚焦/高亮项有外发光时，滚动容器 overflow 会裁掉四边 -->
          <!-- 空态时关掉纵向滚动：空态块是 height:100%，加上容器的 p-1 内边距会高出几像素，
               overflow-y-auto 就会冒出一条多余的滚动条。空态本来也不需要滚动。 -->
          <div
            ref="listEl"
            class="h-[360px] max-h-[60vh] p-1 space-y-1"
            :class="results.length || remoteSearching ? 'overflow-y-auto' : 'overflow-y-hidden'"
          >
            <!-- 搜索无结果：与列表型表格的空态同款版式（图标 + 文案 + 按钮）。
                 给出「清除搜索」而不是只留一句提示：搜不到时最该做的是换个词或清掉重来，
                 给个一键清除的入口，比让用户自己退格更快。 -->
            <div v-if="!results.length && !remoteSearching" class="sd-empty">
              <svg class="sd-empty-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <circle cx="21" cy="21" r="12" opacity="0.75" />
                <path d="M30 30l10 10" stroke-linecap="round" opacity="0.85" />
              </svg>
              <p class="sd-empty-text">暂无搜索结果</p>
              <button type="button" class="sd-empty-btn" @click="clearKeyword">清除搜索</button>
            </div>
            <template v-else>
              <button
                v-for="(r, idx) in results"
                :key="keyword + '#' + r.id"
                class="tb-search-row w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-text transition-theme"
                :class="{ 'bg-surface-hover': idx === activeIndex }"
                :style="{ animationDelay: Math.min(idx, 10) * 30 + 'ms' }"
                @mousedown.prevent="goToResult(r)"
                @mouseenter="activeIndex = idx"
              >
                <span class="w-5 text-center shrink-0 text-base">{{ r.emoji }}</span>
                <span class="flex-1 min-w-0 truncate">{{ r.label }}</span>
                <span v-if="r.sub" class="shrink-0 max-w-[40%] truncate text-xs text-text-muted">{{ r.sub }}</span>
                <span class="shrink-0 text-xs text-text-muted">{{ r.group }}</span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Search } from '@lucide/vue'
import axios from 'axios'
import {
  PAGES, SETTINGS_SECTIONS, SETTINGS_ITEMS, matchKeywords, REMOTE_SOURCE, buildRemoteResults,
} from '../../config/searchData.js'

const props = defineProps({ visible: { type: Boolean, default: false } })
const emit = defineEmits(['close'])

const router = useRouter()
const route = useRoute()

const inputEl = ref(null)
const listEl = ref(null)
// 关键字 / 高亮项
const keyword = ref('')
const activeIndex = ref(0)
// 远程数据搜索结果（后端 /api/search 回填），与本地页面/设置结果合并展示
const remoteResults = ref([])
// 远程搜索进行中：用于避免本地无结果时过早闪现「无匹配结果」
const remoteSearching = ref(false)
// pinyin-match 的 match 函数（懒加载，首次打开搜索时动态 import，加载完成后本地结果自动重算）
const pinyinMatch = ref(null)

let pinyinPromise = null
let remoteTimer = null

// 本地可搜项（页面 + 设置）：静态数据，构建一次即可
const items = (() => {
  const out = []
  PAGES.forEach((p) => out.push({
    id: 'page:' + p.to, kind: 'page', group: '页面', label: p.label, emoji: p.emoji,
    route: p.to, keywords: [p.py], sub: p.group,
  }))
  SETTINGS_SECTIONS.forEach((s) => out.push({
    id: 'sec:' + s.key, kind: 'setting-section', group: '设置', label: s.label, emoji: '⚙️',
    route: '/settings', query: { focus: s.key }, keywords: [s.py], sub: '',
  }))
  SETTINGS_ITEMS.forEach((it) => out.push({
    id: 'item:' + it.section + ':' + it.label, kind: 'setting-item', group: '设置', label: it.label, emoji: '🔧',
    route: '/settings', query: { focus: it.section + '|' + it.label }, keywords: [it.py], sub: '',
  }))
  return out
})()

const results = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return items
  const local = items.filter(r => matchKeywords(r.label + ' ' + (r.sub || ''), r.keywords, q, pinyinMatch.value))
  // 本地（页面/设置）结果在前，远程（业务数据）结果在后
  return local.concat(remoteResults.value)
})

watch(keyword, () => {
  activeIndex.value = 0
  scheduleRemoteSearch()
})

// 打开弹窗（visible 由 false 变为 true）：清空关键字重新开始，列全部可搜项并聚焦输入框
// （内置远程搜索 + 拼音库在首次打开时懒加载，行为与抽出前一致）
watch(() => props.visible, (v) => { if (v) onOpened() })
// 兜住「点击时 chunk 还没加载完」：组件挂载时若已是打开态，同样走一次打开初始化
onMounted(() => { if (props.visible) onOpened() })

function onOpened() {
  keyword.value = ''
  activeIndex.value = 0
  ensurePinyin()
  nextTick(() => inputEl.value?.focus())
}

// 懒加载拼音库：仅在首次打开搜索时动态 import（独立 chunk，不进初始包），
// 加载完成后把 match 函数写回响应式字段，本地搜索结果随之重算。
function ensurePinyin() {
  if (pinyinPromise) return
  pinyinPromise = import('pinyin-match')
    .then((m) => { const PM = m.default || m; pinyinMatch.value = PM.match })
    .catch(() => { pinyinPromise = null })
}

// 远程数据搜索：输入 debounce（约 250ms）后拉取 /api/search，回填 remoteResults。
// 关键字为空立即清空，不留上一轮结果。
function scheduleRemoteSearch() {
  clearTimeout(remoteTimer)
  const q = keyword.value.trim()
  if (!q) { remoteResults.value = []; remoteSearching.value = false; return }
  remoteSearching.value = true
  remoteTimer = setTimeout(() => fetchRemoteSearch(q), 250)
}

async function fetchRemoteSearch(q) {
  try {
    const { data } = await axios.get(REMOTE_SOURCE.endpoint, { params: { q } })
    // 竞态保护：响应回来时关键字已变则丢弃（快速输入时后发的请求可能先到）
    if (keyword.value.trim() !== q) return
    remoteResults.value = buildRemoteResults(data && data.groups)
  } catch (_) {
    // 后端未就绪/未登录：静默，仅清空远程结果，不影响本地搜索
    if (keyword.value.trim() === q) remoteResults.value = []
  } finally {
    if (keyword.value.trim() === q) remoteSearching.value = false
  }
}

function moveActive(dir) {
  const n = results.value.length
  if (!n) return
  let i = activeIndex.value + dir
  if (i < 0) i = n - 1
  if (i >= n) i = 0
  activeIndex.value = i
  nextTick(() => {
    listEl.value?.querySelectorAll('.tb-search-row')?.[activeIndex.value]
      ?.scrollIntoView({ block: 'nearest' })
  })
}

function confirmActive() {
  const r = results.value[activeIndex.value]
  if (r) goToResult(r)
}

// 清除搜索：清空关键字并把焦点留在输入框，方便直接换个词再搜。
// 远程结果也要一并清掉 —— keyword 变化会触发 watch → scheduleRemoteSearch，
// 关键字为空时它会自行清空 remoteResults，这里只需管本地文本与焦点。
function clearKeyword() {
  keyword.value = ''
  nextTick(() => inputEl.value?.focus())
}

function goToResult(r) {
  if (!r) return
  emit('close')
  const target = r.query ? { path: r.route, query: r.query } : r.route
  // 已在目标页且 query 未变时不重复导航（设置页应用后会自动清空 query，故再选同项仍能重新定位）
  if (route.fullPath === router.resolve(target).fullPath) return
  router.push(target)
}
</script>

<style scoped>
/* 搜索无结果：版式对齐列表型表格的 .dt-empty（图标 + 文案 + 按钮）。
   列表型表格在毛玻璃页面上，所以那边用透明底 + backdrop-filter；
   这里在弹窗的白底卡片里，改为浅灰底块，避免看起来像块补丁。 */
.sd-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
  /* 抵消父容器 space-y-1 给首元素加的 margin-top，否则整块被顶下去、底部溢出 */
  margin-top: -4px;
  animation: sd-empty-in 0.3s ease both;
}
@keyframes sd-empty-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
.sd-empty-icon {
  width: 44px;
  height: 44px;
  color: var(--color-text-muted, #94a3b8);
  opacity: 0.9;
}
.sd-empty-text {
  margin: 0;
  font-size: 15px;
  letter-spacing: 0.5px;
  color: var(--color-text-muted, #94a3b8);
}
/* 按钮配色与 DynamicTable 的 .dt-empty-btn 保持一致（#d9e5f8 底 + #1e3a6b 字） */
.sd-empty-btn {
  min-width: 100px;
  padding: 7px 18px;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.4;
  color: #1e3a6b;
  background: #d9e5f8;
  border: 1px solid #c3d6f2;
  border-radius: var(--radius-control);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(30, 58, 107, 0.10);
  transition: transform 0.15s ease, background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}
.sd-empty-btn:hover {
  background: #c9d9f2;
  border-color: #a9c3ea;
}
.sd-empty-btn:active { transform: scale(0.98); }
.sd-empty-btn:focus-visible {
  outline: 2px solid rgba(30, 58, 107, 0.55);
  outline-offset: 2px;
}
</style>
