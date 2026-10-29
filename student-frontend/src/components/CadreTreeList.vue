<template>
  <div>
    <!-- 职务行：母/子职务统一用蓝色标记，靠缩进区分层级 -->
    <div
      class="flex flex-wrap items-center gap-2 px-3 py-1.5 my-1.5 rounded-md text-text-inverse text-sm cursor-default transition-shadow duration-150"
      :class="[level === 0 ? 'row-root' : 'bg-primary', selectedId === node.id ? 'row-selected' : '']"
      @mousedown="onRowMouseDown"
      @dragover.prevent
      @drop.prevent.stop="onDropRow($event)"
    >
      <!-- 折叠箭头：只要展开区里有内容（本级学生或下级职务）就可折叠，不再因为「没有下级职务」而被禁用 -->
      <button
        type="button" @mousedown.prevent @click="toggle"
        :disabled="!hasContent"
        class="w-4 text-center leading-none text-xs cursor-pointer disabled:cursor-default disabled:opacity-30 transition-theme text-text-inverse/80 hover:text-text-inverse"
        title="折叠/展开"
      >{{ collapsed ? '▸' : '▾' }}</button>
      <!-- 拖柄：可拖动职务 -->
      <span
        class="cursor-grab select-none text-text-inverse/70"
        draggable="true"
        @dragstart="onDragStart($event, 'cadre', node.id)"
      >⠿</span>
      <span>{{ node.name }}</span>
      <!-- 任命 badge：仅统计本职务直接担任的学生数 / 上限（不含下级职务） -->
      <span class="chip">任命 {{ memberCount }}/{{ node.max_count }}</span>
      <!-- 添加学生：行内输入 + 确认（下拉备选逻辑与座位表一致） -->
      <span class="add-inline ml-auto">
        <input
          v-model="addKeyword"
          class="add-input"
          placeholder="添加学生"
          autocomplete="off"
          @click.stop
          @focus="onInputFocus"
          @input="onInputChange"
          @keydown="onInputKeydown"
          @blur="closeSuggest"
        />
        <button
          type="button"
          class="chip"
          :disabled="!String(addKeyword).trim()"
          @mousedown.prevent
          @click.stop="confirmAdd"
        >确认</button>
      </span>
      <!-- 行内操作 -->
      <span class="actions transition-theme text-text-inverse/80">
        <button class="chip" title="添加下级职务" type="button" @mousedown.prevent @click.stop="$emit('add-child', node)">＋ 添加下级</button>
        <button class="chip" title="设置本职位名称与可担任人数" type="button" @mousedown.prevent @click.stop="$emit('edit', node)">✎ 设置</button>
        <button class="chip danger" title="删除本职务（包含其成员）" type="button" @mousedown.prevent @click.stop="$emit('remove', node)">×</button>
      </span>
    </div>

    <!-- 子容器：缩进的虚线框，放本级学生与下级职务；也是拖放目标
         展开/折叠用 JS 钩子做 auto 高度过渡（钩子见 methods，过渡曲线见 .collapse-* 样式） -->
    <Transition
      name="collapse"
      @enter="onCollapseEnter"
      @after-enter="onCollapseAfterEnter"
      @leave="onCollapseLeave"
      @after-leave="onCollapseAfterLeave"
      @enter-cancelled="onCollapseCancel"
      @leave-cancelled="onCollapseCancel"
    >
    <div
      v-show="!collapsed"
      class="ml-6 mt-1 border border-dashed rounded-md p-1 min-h-[34px]"
      :class="level === 0 ? 'border-info/50' : 'border-info/40'"
      @dragover.prevent
      @drop.prevent.stop="onDropChild($event)"
    >
      <!-- 本级担任学生（缩进一级） -->
      <div
        v-for="m in node.members"
        :key="m.id"
        class="mb-1 last:mb-0 flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-md bg-surface-hover border border-border text-text text-xs"
        @dragover.prevent
        @drop.prevent.stop="onDropMember($event, m)"
      >
        <span class="cursor-grab select-none text-text-muted" draggable="true" @dragstart="onDragStart($event, 'member', m.id)">⠿</span>
        <span class="min-w-0 break-words">{{ m.student_name }}<span class="text-text-muted ml-1">{{ node.name }}</span></span>
        <span class="ml-auto">
          <button class="danger-sm" title="移除" type="button" @mousedown.prevent @click.stop="$emit('remove-member', node, m)">×</button>
        </span>
      </div>
      <!-- 下级职务（再缩进一级，与「本级学生」区分层级） -->
      <div v-if="node.children.length > 0" class="ml-6">
        <CadreTreeList
          v-for="child in node.children"
          :key="child.id"
          :node="child"
          :all-students="allStudents"
          :level="level + 1"
          :selected-id="selectedId"
          @select="$emit('select', $event)"
          @add-student="$emit('add-student', $event)"
          @add-child="$emit('add-child', $event)"
          @edit="$emit('edit', $event)"
          @remove="$emit('remove', $event)"
          @remove-member="$emit('remove-member', $event)"
          @drop-move="onDropBubble($event)"
        />
      </div>
      <div v-if="node.children.length === 0 && node.members.length === 0" class="text-xs text-text-muted px-2 py-1">暂无下级职务 / 担任学生，可拖入或添加</div>
    </div>
    </Transition>

    <!-- 候选下拉（Teleport 到 body + fixed 定位，与座位表 GridView 一致） -->
    <Teleport to="body">
      <div
        v-if="suggest.visible"
        class="candidate-popup fixed z-[10002] bg-surface border border-info shadow-lg rounded"
        :style="{ left: suggest.left + 'px', top: suggest.top + 'px', width: suggest.width + 'px', maxHeight: '200px', overflow: 'auto' }"
        @mousedown.stop
      >
        <div v-if="candidates.length > 0">
          <div
            v-for="(s, idx) in candidates"
            :key="s.id"
            :class="['px-3 py-2 text-sm cursor-pointer hover:bg-info/10 truncate', { 'bg-info/20': idx === suggest.index }]"
            @mousedown.prevent="pickCandidate(s)"
            @mouseenter="suggest.index = idx"
          >{{ s.姓名 }}</div>
        </div>
        <div v-else class="px-3 py-2 text-sm text-text-muted">无匹配学生</div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { useNotification } from '../composables/useNotification.js'
import { ref, computed, nextTick } from 'vue'

defineOptions({ name: 'CadreTreeList' })

const props = defineProps({
  node: { type: Object, required: true },
  allStudents: { type: Array, default: () => [] },
  level: { type: Number, default: 0 },
  selectedId: { type: [Number, String], default: null }
})

const emit = defineEmits(['add-child', 'edit', 'remove', 'remove-member', 'drop-move', 'select', 'add-student'])

const collapsed = ref(false)
// 行内添加学生的输入内容
const addKeyword = ref('')
// 候选下拉状态（定位方式与座位表一致）
const suggest = ref({ visible: false, index: 0, left: 0, top: 0, width: 0 })

let activeInputEl = null

const hasChildren = computed(() => {
  return !!(props.node.children && props.node.children.length)
})
// 本职务直接担任的学生数（不含下级职务）
const memberCount = computed(() => {
  return (props.node.members || []).length
})
// 展开区里是否有内容（本级学生或下级职务）：有内容即可折叠，空职务才禁用箭头
const hasContent = computed(() => {
  return hasChildren.value || memberCount.value > 0
})
// 候选学生：排除本职务已担任的学生，按姓名过滤（逻辑与座位表一致）
const candidates = computed(() => {
  const kw = String(addKeyword.value || '').toLowerCase().trim()
  const existing = new Set((props.node.members || []).map(m => String(m.student_name || '').trim()))
  const lower = studentNameLower.value
  return props.allStudents.filter(s => {
    const name = String(s.姓名 ?? '')
    return !existing.has(name.trim()) && (!kw || (lower.get(s) || '').includes(kw))
  })
})
// 学生姓名小写缓存：只在名单变更时重建一次，编辑框每次按键不必逐项构造小写字符串
const studentNameLower = computed(() => {
  const map = new Map()
  for (const s of props.allStudents) map.set(s, String(s.姓名 ?? '').toLowerCase())
  return map
})

function toggle() {
  if (hasContent.value) collapsed.value = !collapsed.value
}
// 选中：按下即选中（不用等 click 的抬起时机），响应更跟手
function onRowMouseDown(e) {
  // 行内输入框有自己的交互（原 @click.stop 亦不选中），其余区域按下即选中
  if (e.target.closest('input, select, textarea, .add-inline')) return
  emit('select', props.node.id)
}
// 标记最近的滚动容器「正在做展开/折叠动画」：期间隐藏滚动条，结束后恢复。
// 用计数兼容动画重叠/取消，避免类名被提前摘掉。
function markScroller(el, on) {
  const scroller = el && el.closest && el.closest('.tree-scroll')
  if (!scroller) return
  const n = Math.max(0, Number(scroller.dataset.animCount || 0) + (on ? 1 : -1))
  scroller.dataset.animCount = String(n)
  scroller.classList.toggle('is-animating', n > 0)
}
// ============ 展开/折叠：auto 高度过渡（height:auto 无法用纯 CSS 过渡，故用 JS 量取实际高度） ============
function onCollapseEnter(el) {
  markScroller(el, true)
  el.style.overflow = 'hidden'
  el.style.height = '0px'
  void el.offsetHeight // 强制回流，保证确实从 0 开始过渡
  el.style.height = el.scrollHeight + 'px'
}
function onCollapseAfterEnter(el) {
  // 过渡结束后还原自适应高度，之后再添加/移除学生也能自然撑开
  el.style.height = ''
  el.style.overflow = ''
  markScroller(el, false)
}
function onCollapseLeave(el) {
  markScroller(el, true)
  el.style.overflow = 'hidden'
  el.style.height = el.scrollHeight + 'px'
  void el.offsetHeight
  el.style.height = '0px'
}
function onCollapseAfterLeave(el) {
  el.style.height = ''
  el.style.overflow = ''
  markScroller(el, false)
}
// 过渡被快速切换打断时不会触发 after-*，这里补一次归还，避免滚动条一直被隐藏
function onCollapseCancel(el) {
  markScroller(el, false)
}
// 候选弹窗定位：输入框视口坐标，越界时左移/上翻（同座位表）
function positionSuggest(el) {
  if (!el) return
  const r = el.getBoundingClientRect()
  const w = Math.max(180, r.width)
  const h = 200
  let x = r.left
  let y = r.bottom + 2
  if (x + w > window.innerWidth) x = Math.max(0, window.innerWidth - w - 8)
  if (y + h > window.innerHeight) y = Math.max(0, r.top - h - 2)
  suggest.value.left = x
  suggest.value.top = y
  suggest.value.width = w
}
function onInputFocus(e) {
  activeInputEl = e.currentTarget
  suggest.value.index = 0
  nextTick(() => {
    positionSuggest(activeInputEl)
    suggest.value.visible = candidates.value.length > 0
  })
}
function onInputChange(e) {
  activeInputEl = e.currentTarget
  suggest.value.index = 0
  nextTick(() => {
    positionSuggest(activeInputEl)
    suggest.value.visible = candidates.value.length > 0
  })
}
function onInputKeydown(e) {
  const list = candidates.value
  if (e.key === 'Tab' || e.key === 'Enter') {
    if (list.length > 0) { e.preventDefault(); pickCandidate(list[suggest.value.index]) }
    return
  }
  if (e.key === 'ArrowDown') {
    if (list.length > 0) { e.preventDefault(); suggest.value.index = (suggest.value.index + 1) % list.length }
    return
  }
  if (e.key === 'ArrowUp') {
    if (list.length > 0) { e.preventDefault(); suggest.value.index = (suggest.value.index - 1 + list.length) % list.length }
    return
  }
  if (e.key === 'Escape') closeSuggest()
}
// 选中候选项：填入输入框
function pickCandidate(s) {
  addKeyword.value = String(s.姓名 ?? '')
  closeSuggest()
}
function closeSuggest() {
  suggest.value.visible = false
}
// 确认添加：添加到当前职务后清空输入框
function confirmAdd() {
  const name = String(addKeyword.value || '').trim()
  if (!name) return
  const student = props.allStudents.find(s => String(s.姓名 || '').trim() === name)
  // 找不到对应学生时不能发 id:null（后端/父组件会当成合法成员写入），必须先提示
  if (!student) {
    useNotification().error(`未找到学生「${name}」，请从候选列表中选择`)
    return
  }
  closeSuggest()
  addKeyword.value = ''
  emit('add-student', { nodeId: props.node.id, student })
}
// 拖拽数据：JSON 携带类型与 id
function onDragStart(e, type, id) {
  e.dataTransfer.setData('text/plain', JSON.stringify({ type, id }))
  e.dataTransfer.effectAllowed = 'move'
}
// 拖到职务行上：职务→同级重排（按指针上下分为前/后）；成员→追加到该职务
function onDropRow(e) {
  const dragged = readDrag(e)
  if (!dragged) return
  if (dragged.type === 'member') {
    emit('drop-move', { dragged, target: { kind: 'append', nodeId: props.node.id } })
    return
  }
  const rect = e.currentTarget.getBoundingClientRect()
  const pos = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
  emit('drop-move', { dragged, target: { kind: 'node', nodeId: props.node.id, position: pos } })
}
// 拖到子容器上：职务→追加为该职务下级；成员→追加到该职务
function onDropChild(e) {
  const dragged = readDrag(e)
  if (!dragged) return
  emit('drop-move', { dragged, target: { kind: 'child', nodeId: props.node.id } })
}
// 拖到成员行上：成员→在所在职务内排序；职务→忽略
function onDropMember(e, m) {
  const dragged = readDrag(e)
  if (!dragged || dragged.type !== 'member') return
  emit('drop-move', { dragged, target: { kind: 'member', nodeId: props.node.id, memberId: m.id } })
}
function onDropBubble(payload) {
  emit('drop-move', payload)
}
function readDrag(e) {
  try { return JSON.parse(e.dataTransfer.getData('text/plain')) } catch (err) { return null }
}
</script>

<style scoped>
/* ============ 展开 / 折叠：非线性高度过渡 ============
   展开走回弹曲线（末端轻微超调后回稳），折叠走加速回退曲线；
   高度值由 JS 钩子实时量取，这里只负责缓动与淡入淡出 */
.collapse-enter-active {
  overflow: hidden;
  transition: height 0.2s cubic-bezier(0.34, 1.3, 0.64, 1), opacity 0.14s ease-out;
}
.collapse-leave-active {
  overflow: hidden;
  transition: height 0.14s cubic-bezier(0.5, 0, 0.85, 0.3), opacity 0.1s ease-in;
}
.collapse-enter-from,
.collapse-leave-to {
  opacity: 0;
}

/* 一级职务行：日间沿用主题蓝；夜间把主题蓝与深灰蓝混合，降低蓝色浓度（下级职务始终用纯 primary） */
.row-root {
  background-color: var(--color-primary, #3b82f6);
}
:root[data-mode="night"]:is([data-theme="glass"], [data-theme="glass2"]) .row-root {
  background-color: color-mix(in srgb, var(--color-primary, #3b82f6) 40%, #475569);
}

/* 选中行：白色内圈 + 蓝色外圈（蓝底行上也能看清） */
.row-selected {
  box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--color-info, #3b82f6);
}

/* 职务行内统一小控件：任命徽标 / 确认 / 操作按钮，除功能外外观完全一致 */
.chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  height: 22px;
  padding: 0 6px;
  margin: 0;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: var(--radius-xs);
  background: rgba(255, 255, 255, 0.2);
  color: inherit;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}
button.chip {
  cursor: pointer;
  font-family: inherit;
}
button.chip:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.35);
  color: #fff;
}
button.chip.danger:hover:not(:disabled) {
  background: var(--color-danger, #ef4444);
  color: #fff;
}
button.chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 添加学生：输入框与旁边控件同高、同圆角 */
.add-inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.add-input {
  width: 110px;
  height: 22px;
  padding: 0 6px;
  font-size: 12px;
  line-height: 1;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: var(--radius-xs);
  background: var(--color-surface, #fff);
  color: var(--color-text, #1f2937);
  outline: none;
}
.add-input:focus {
  border-color: var(--color-info, #3b82f6);
}

/* 行内操作：与「添加学生」之间用分隔线拉开距离，区分两类操作；组内间距与整行一致 */
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 10px;
  padding-left: 10px;
  border-left: 1px solid color-mix(in srgb, currentColor 30%, transparent);
}
.danger-sm {
  border: none;
  background: transparent;
  color: var(--color-text-muted, #6b7280);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  border-radius: var(--radius-xs);
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
}
.danger-sm:hover {
  background: var(--color-danger, #ef4444);
  color: #fff;
}
</style>