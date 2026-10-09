<template>
  <div class="h-full flex flex-col">
    <!-- 工具栏按钮：视图切换 + 设置 + 刷新 -->
    <div class="mb-4 flex items-center gap-3 opbar">
      <div ref="switchRef" class="view-switch">
        <button type="button" tabindex="-1" aria-hidden="true" class="view-switch-thumb bg-primary text-text-inverse" :style="thumbStyle"></button>
        <button class="view-switch-btn" :class="{ on: view === 'tree' }" @click="view = 'tree'">树状</button>
        <button class="view-switch-btn" :class="{ on: view === 'chart' }" @click="view = 'chart'">组织图</button>
      </div>
      <button @click="onEditSelected" :disabled="!selectedNode" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
        <IconGlyph name="settings" :size="14" tint="current" /> 设置
      </button>
      <button @click="onAddRoot" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme flex items-center gap-1.5 cursor-pointer">＋ 添加职务</button>
      <button @click="onAddChildSelected" :disabled="!selectedNode" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">＋ 增加下级</button>
      <button @click="onRefresh" class="bg-text-muted text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
    </div>

    <!-- ====== 树状视图（默认，智能排表式嵌套列表） ====== -->
    <div v-if="view === 'tree'" class="tree-scroll bg-surface shadow-md rounded-xl border border-border p-4 flex-1 min-h-0 overflow-y-auto overflow-x-hidden" @click.self="selectedId = null">
      <!-- 空状态 -->
      <div v-if="!loading && tree.length === 0" class="text-center text-text-muted py-12">
        <p class="text-lg mb-2">还没有任何职务</p>
        <p class="text-sm">点击上方「＋ 添加职务」创建班主任、班长等职务，并逐级添加下级与担任学生。</p>
        <button @click="onAddRoot" class="mt-4 bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme cursor-pointer">＋ 添加职务</button>
      </div>

      <!-- 职务树：智能排表式嵌套列表，可拖拽排序（拖空白区可上移为顶级） -->
      <div v-else class="pb-2" @dragover.prevent @drop="onDropEmpty" @click.self="selectedId = null">
        <p class="text-xs text-text-muted mb-2">点击任意职务行可选中（选中后高亮蓝框）；选中后可用上方「增加下级」「设置」。按住 <span class="font-bold">⠿</span> 拖动可调整顺序；拖到某职务行前后可在同级重排，拖到某职务下方虚线框可将它变为下级；成员可跨职务拖动。操作即时保存。</p>
        <CadreTreeList
          v-for="root in tree"
          :key="root.id"
          :node="root"
          :all-students="allStudents"
          :level="0"
          :selected-id="selectedId"
          @select="selectedId = $event"
          @add-student="onAddStudentInline"
          @add-child="onAddChild"
          @edit="onEdit"
          @remove="onRemove"
          @remove-member="onRemoveMember"
          @drop-move="handleMove"
        />
      </div>
    </div>

    <!-- ====== 组织图视图（只读展示） ====== -->
    <div v-else class="bg-surface shadow-md rounded-xl border border-border px-6 py-5 flex-1 min-h-0 overflow-auto">
      <div v-if="!loading && tree.length === 0" class="text-center text-text-muted py-12">
        <p class="text-lg mb-2">还没有任何职务</p>
        <p class="text-sm">切换到「树状」视图，或点击上方「＋ 添加职务」。</p>
      </div>
      <div v-else class="flex flex-col items-center pt-4 pb-10">
        <cadre-tree-node v-for="root in tree" :key="root.id" :node="root" :readonly="true" />
      </div>
    </div>

    <!-- ============ 新增/编辑职务弹窗 ============ -->
    <Teleport to="body">
    <Transition name="dialog">
    <div v-if="nodeDialogVisible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10003]" @click.self="nodeDialogVisible = false">
      <div class="bg-surface p-6 rounded-xl w-96 shadow-card dialog-card border border-border">
        <h3 class="text-lg font-bold text-text mb-4">{{ editTarget ? '编辑职务' : (parentTarget ? '添加下级职务' : '添加职务') }}</h3>
        <label class="block text-sm text-text-secondary mb-1">职务名称</label>
        <input v-model="nodeForm.name" placeholder="如：学习委员、组长" class="border border-border bg-surface text-text px-3 py-2 rounded w-full mb-4" autofocus />
        <label class="block text-sm text-text-secondary mb-1">可担任人数</label>
        <input v-model.number="nodeForm.max_count" type="number" min="1" max="99" class="border border-border bg-surface text-text px-3 py-2 rounded w-full mb-4" />
        <div class="flex justify-end gap-2">
          <button @click="nodeDialogVisible = false" class="bg-surface-hover text-text border border-border px-4 py-2 rounded transition-theme cursor-pointer">取消</button>
          <button @click="submitNode" class="bg-primary text-text-inverse px-4 py-2 rounded transition-theme cursor-pointer">确定</button>
        </div>
      </div>
    </div>
    </Transition>
    </Teleport>

    <!-- ============ 二次确认弹窗 ============ -->
    <Teleport to="body">
    <Transition name="dialog">
    <div v-if="confirmMsg" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10004]" @click.self="confirmMsg = null">
      <div class="bg-surface p-6 rounded-xl w-96 shadow-card dialog-card border border-border">
        <h3 class="text-lg font-bold text-text mb-3">确认操作</h3>
        <p class="text-text-secondary mb-4">{{ confirmMsg }}</p>
        <div class="flex justify-end gap-2">
          <button @click="confirmMsg = null" class="bg-surface-hover text-text border border-border px-4 py-2 rounded transition-theme cursor-pointer">取消</button>
          <button @click="doConfirmDelete" class="bg-danger text-white px-4 py-2 rounded transition-theme cursor-pointer">删除</button>
        </div>
      </div>
    </div>
    </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import axios from 'axios'
import CadreTreeNode from './CadreTreeNode.vue'
import CadreTreeList from './CadreTreeList.vue'
import { useNotification } from '../composables/useNotification'

const { success, error, info } = useNotification()

const API_BASE = '/api'
const tree = ref([])
const loading = ref(false)
const allStudents = ref([])

// 当前选中的职务行（选中后高亮蓝框，供工具栏「增加下级 / 设置」使用）
const selectedId = ref(null)
const selectedNode = computed(() => (selectedId.value == null ? null : findNode(tree.value, selectedId.value)))

// 视图切换：树状（默认） / 组织图（只读）
const view = ref('tree')

// 切换滑块：按当前按钮的实测位置/尺寸定位，让「按钮本体」滑动，
// 两个按钮文字宽度不同，宽度过渡时自然产生轻微伸缩。
const switchRef = ref(null)
const thumbStyle = ref({})
function syncThumb() {
  const box = switchRef.value
  if (!box) return
  const btn = box.querySelectorAll('.view-switch-btn')[view.value === 'tree' ? 0 : 1]
  if (!btn) return
  const boxRect = box.getBoundingClientRect()
  const btnRect = btn.getBoundingClientRect()
  const cs = getComputedStyle(box)
  // 绝对定位滑块的包含块是容器的 padding box，故减去边框宽度
  const bl = parseFloat(cs.borderLeftWidth) || 0
  const bt = parseFloat(cs.borderTopWidth) || 0
  thumbStyle.value = {
    width: `${btnRect.width}px`,
    height: `${btnRect.height}px`,
    transform: `translate(${btnRect.left - boxRect.left - bl}px, ${btnRect.top - boxRect.top - bt}px)`
  }
}
watch(view, () => nextTick(syncThumb))
onMounted(() => {
  nextTick(syncThumb)
  // 侧边栏折叠、窗口缩放、字体加载等导致的尺寸变化都重新定位
  if (typeof ResizeObserver !== 'undefined' && switchRef.value) {
    new ResizeObserver(syncThumb).observe(switchRef.value)
  }
})

const api = (options = {}) => {
  const opts = {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    ...options
  }
  return axios({ baseURL: API_BASE, method: 'get', ...opts })
}

async function loadTree() {
  loading.value = true
  try {
    const res = await api({ url: '/cadres' })
    tree.value = res.data.tree || []
    return true
  } catch (e) {
    error('加载职务树失败')
    return false
  } finally {
    loading.value = false
  }
}
// 工具栏「刷新」：重新拉取职务树并给出提示条反馈（失败时 loadTree 已弹错误提示，不再叠加成功提示）
async function onRefresh() {
  if (await loadTree()) success('已刷新班干部数据')
}

async function fetchStudents() {
  try {
    const res = await api({ url: '/students' })
    allStudents.value = res.data.data || res.data || []
  } catch (e) { /* 学生列表不可用时不阻塞 */ }
}

onMounted(() => { loadTree(); fetchStudents() })

// ============ 职务新增 / 编辑 / 删除 ============
const nodeDialogVisible = ref(false)
const editTarget = ref(null)
const parentTarget = ref(null)
const nodeForm = reactive({ name: '', max_count: 1 })

function onAddRoot() {
  editTarget.value = null
  parentTarget.value = null
  Object.assign(nodeForm, { name: '', max_count: 1 })
  nodeDialogVisible.value = true
}
function onAddChild(node) {
  editTarget.value = null
  parentTarget.value = node
  Object.assign(nodeForm, { name: '', max_count: 1 })
  nodeDialogVisible.value = true
}
function onEdit(node) {
  editTarget.value = node
  parentTarget.value = null
  Object.assign(nodeForm, { name: node.name, max_count: node.max_count })
  nodeDialogVisible.value = true
}
// 工具栏「增加下级」：为当前选中职务增加下级
function onAddChildSelected() {
  if (!selectedNode.value) return info('请先选择一个职务')
  onAddChild(selectedNode.value)
}
// 工具栏「设置」：编辑当前选中职务（与行内「编辑职务」一致）
function onEditSelected() {
  if (!selectedNode.value) return info('请先选择一个职务')
  onEdit(selectedNode.value)
}
// 职务下方行内「添加学生」确认后添加担任学生
async function onAddStudentInline({ nodeId, student }) {
  const node = findNode(tree.value, nodeId)
  if (node && node.members.length >= node.max_count) {
    return info(`「${node.name}」人数已达上限 ${node.max_count} 人`)
  }
  try {
    await api({ url: `/cadres/${nodeId}/members`, method: 'post', data: { student_id: student.id, student_name: student.姓名 } })
    success('已添加担任学生')
    await loadTree()
  } catch (e) {
    error(e.response?.data?.error || '添加失败')
  }
}

async function submitNode() {
  const name = String(nodeForm.name || '').trim()
  if (!name) return error('请输入职务名称')
  const maxCount = Math.max(1, Math.min(99, Number(nodeForm.max_count) || 1))
  try {
    if (editTarget.value) {
      await api({ url: `/cadres/${editTarget.value.id}`, method: 'put', data: { name, max_count: maxCount } })
      success('已保存')
    } else {
      await api({ url: '/cadres', method: 'post', data: { name, max_count: maxCount, parent_id: parentTarget.value ? parentTarget.value.id : 0 } })
      success('已添加')
    }
    nodeDialogVisible.value = false
    await loadTree()
  } catch (e) {
    error(e.response?.data?.error || '保存失败')
  }
}

const confirmMsg = ref(null)
const pendingDelete = ref(null)
function onRemove(node) {
  const hasChildren = node.children && node.children.length > 0
  pendingDelete.value = { id: node.id }
  confirmMsg.value = hasChildren
    ? `确定删除职务「${node.name}」吗？其担任学生将一并删除，下级职务将上移到其上级。`
    : `确定删除职务「${node.name}」吗？其担任学生将一并删除。`
}
async function doConfirmDelete() {
  const p = pendingDelete.value
  if (!p) return
  try {
    await api({ url: `/cadres/${p.id}`, method: 'delete' })
    success('已删除')
    confirmMsg.value = null
    pendingDelete.value = null
    await loadTree()
  } catch (e) {
    error(e.response?.data?.error || '删除失败')
  }
}

// ============ 担任学生 ============
async function onRemoveMember(node, m) {
  try {
    await api({ url: `/cadres/members/${m.id}`, method: 'delete' })
    success('已移除担任学生')
    await loadTree()
  } catch (e) {
    error(e.response?.data?.error || '移除失败')
  }
}

// ============ 拖拽排序（职务 & 成员，智能排表式） ============
function readDrag(e) {
  try { return JSON.parse(e.dataTransfer.getData('text/plain')) } catch (err) { return null }
}
function findNode(list, id) {
  for (const n of list) {
    if (n.id === id) return n
    if (n.children) { const r = findNode(n.children, id); if (r) return r }
  }
  return null
}
// 判断 parentId 是否在 id 的子树内（防循环）
function isDescendant(id, parentId) {
  const self = findNode(tree.value, id)
  return !!findNode(self ? self.children : [], parentId)
}
async function handleMove(payload) {
  const dragged = payload && payload.dragged
  if (!dragged) return
  const target = payload.target || {}
  try {
    if (dragged.type === 'member') await moveMember(dragged.id, target)
    else await moveCadre(dragged.id, target)
  } catch (e) {
    error(e.response?.data?.error || '移动失败')
  }
}
// 拖到设置面板 / 树状视图的空白区：职务上移到顶级并排在末尾
async function onDropEmpty(e) {
  const dragged = readDrag(e)
  if (!dragged || dragged.type !== 'cadre') return
  await handleMove({ dragged, target: { kind: 'empty' } })
}
async function moveCadre(id, target) {
  const kind = target.kind
  let parentId = 0
  let index = null
  if (kind === 'empty') {
    parentId = 0
    index = tree.value.map(n => n.id).filter(x => x !== id).length
  } else if (kind === 'child') {
    parentId = target.nodeId
    if (parentId === id || isDescendant(id, parentId)) return
  } else if (kind === 'node') {
    const t = findNode(tree.value, target.nodeId)
    if (!t) return
    parentId = t.parent_id || 0
    const sibs = parentId ? (findNode(tree.value, parentId) || { children: tree.value }).children : tree.value
    const arr = (sibs || []).map(n => n.id).filter(x => x !== id)
    let idx = arr.indexOf(target.nodeId)
    index = target.position === 'after' ? idx + 1 : idx
    if (index < 0) index = arr.length
    if (parentId === id || isDescendant(id, parentId)) return
  } else {
    return
  }
  await api({ url: `/cadres/${id}/move`, method: 'post', data: { parent_id: parentId, index } })
  success('已保存职务调整')
  await loadTree()
}
async function moveMember(id, target) {
  if (!target.nodeId) return
  let cadreId = target.nodeId
  let index = null
  if (target.kind === 'member') {
    const node = findNode(tree.value, target.nodeId)
    const arr = (node?.members || []).map(m => m.id).filter(x => x !== id)
    const idx = arr.indexOf(target.memberId)
    index = idx < 0 ? arr.length : idx
  }
  await api({ url: `/cadres/members/${id}/move`, method: 'post', data: { cadre_id: cadreId, index } })
  success('已保存学生调整')
  await loadTree()
}
</script>

<style scoped>
/* 视图切换：滑动式分段控件
   外层尺寸/圆角与隔壁 opbar 按钮一致（py-2，rounded 4px），无边框避免和外圆角差 1px */
.view-switch {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  /* 防止被工具栏 flex 压窄，保证两个标签始终并排、不换行不斜排 */
  flex: none;
  border-radius: 4px;
  background: var(--color-surface, #ffffff);
  overflow: hidden;
}
/* glass/win11：底面改用与自绘标题栏 .window-title-bar 完全相同的毛玻璃材质
   （同 blur/saturate 配方 + 同底色 + 同内高光），随 data-topbar-color 切深蓝/淡蓝 */
:root:is([data-theme="glass"], [data-theme="win11"]) .view-switch {
  backdrop-filter: blur(24px) saturate(1.4);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    inset 0 -1px 0 rgba(255, 255, 255, 0.4);
}
:root[data-topbar-color="light"]:is([data-theme="glass"], [data-theme="win11"]) .view-switch {
  background-color: rgba(219, 234, 254, 0.55);
}
:root[data-topbar-color="blue"]:is([data-theme="glass"], [data-theme="win11"]) .view-switch {
  background-color: rgba(30, 64, 175, 0.55);
}
/* 滑块尺寸 = 当前按钮本体（脚本实测），两个标签等宽，故滑块尺寸恒定、切换不变形 */
.view-switch-thumb {
  position: absolute;
  top: 0;
  left: 0;
  padding: 0;
  border: none;
  /* 自身不做圆角，四角完全交给容器的 overflow:hidden 裁切：
     只有一层圆角边缘，不会再出现「底色沿按钮四角露出」的缝 */
  border-radius: 0;
  /* 颜色/遮罩/阴影完全不在这里写死：模板上挂着与隔壁「添加职务」按钮
     完全相同的类（bg-primary text-text-inverse），且它是真正的 <button>，
     因此会命中同一批主题按钮规则，任意主题下颜色都与该按钮逐像素一致。 */
  pointer-events: none;
  transition:
    transform 0.26s cubic-bezier(0.34, 1.35, 0.64, 1),
    width 0.26s cubic-bezier(0.34, 1.35, 0.64, 1);
}
.view-switch-btn {
  position: relative;
  z-index: 1;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 两个标签等宽：滑块尺寸恒定，切换时不会忽大忽小 */
  width: 3.5rem;
  /* 与隔壁按钮同高（py-2），水平方向由等宽固定 */
  padding: 0.5rem 0;
  white-space: nowrap;
  border: none;
  background: transparent;
  color: var(--color-text-secondary, #6b7280);
  cursor: pointer;
  transition: color 0.2s ease-out;
}
.view-switch-btn.on {
  /* 与隔壁按钮一致：选中文字用反白色 */
  color: var(--color-text-inverse, #ffffff);
}
/* glass/win11 下「添加职务」按钮被主题规则改成淡绿底 + 深绿字（见 theme-glass.css），
   选中项文字同步为深绿，否则白字会与该底色糊在一起、与隔壁按钮观感不一致 */
:root:is([data-theme="glass"], [data-theme="win11"]) .view-switch-btn.on {
  color: #166534;
}
</style>