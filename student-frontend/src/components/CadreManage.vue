<template>
  <div class="h-full flex flex-col">
    <!-- 工具栏按钮（与其他页面一致，无独立标题框） -->
    <div class="mb-4 flex items-center gap-3 opbar">
      <button @click="settingsVisible = true" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme flex items-center gap-1.5">
        <IconGlyph name="settings" :size="14" tint="current" /> 设置
      </button>
      <button @click="loadTree" :disabled="loading" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded transition-theme disabled:opacity-50 flex items-center gap-1.5 btn-refresh">
        {{ loading ? '刷新中…' : '' }}<IconGlyph v-if="!loading" name="refresh" :size="14" tint="current" /> 刷新
      </button>
    </div>

    <!-- 玻璃面板：组织关系图 -->
    <div class="bg-surface shadow-md rounded-xl border border-border px-6 py-5 flex-1 min-h-0 overflow-auto">
      <!-- 空状态 -->
      <div v-if="!loading && tree.length === 0" class="text-center text-text-muted py-12">
        <p class="text-lg mb-2">还没有任何职务</p>
        <p class="text-sm">点击上方「设置」用目录树创建班主任、班长等职务，并逐级添加下级与担任学生。</p>
      </div>

      <!-- 树形图 -->
      <div v-else class="flex flex-col items-center pt-4 pb-10">
        <cadre-tree-node
          v-for="root in tree"
          :key="root.id"
          :node="root"
          :all-students="allStudents"
          @add-member="onAddMember"
          @add-child="onAddChild"
          @edit="onEdit"
          @remove="onRemove"
          @remove-member="onRemoveMember"
        />
      </div>
    </div>

    <!-- ============ 设置窗口（Windows 目录树管理职务） ============ -->
    <Transition name="dialog">
    <div v-if="settingsVisible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10002]" @click.self="settingsVisible = false">
      <div class="bg-surface p-6 rounded-xl w-[28rem] shadow-card dialog-card border border-border flex flex-col max-h-[80vh]">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-text">设置职务</h3>
          <button @click="settingsVisible = false" class="text-text-secondary hover:text-text text-xl leading-none cursor-pointer">×</button>
        </div>
        <!-- 目录树 -->
        <div class="flex-1 min-h-0 overflow-auto border border-border rounded-lg bg-bg/40 py-1">
          <CadreTreeList
            v-for="root in tree"
            :key="root.id"
            :node="root"
            :all-students="allStudents"
            :level="0"
            @add-child="onAddChild"
            @edit="onEdit"
            @remove="onRemove"
            @add-member="onAddMember"
            @remove-member="onRemoveMember"
          />
          <div v-if="tree.length === 0" class="text-center text-text-muted py-10 text-sm">暂无职务，点击下方「添加职务」创建</div>
        </div>
        <!-- 底部操作 -->
        <div class="flex items-center justify-between gap-2 mt-4">
          <button @click="onAddRoot" class="bg-primary hover:bg-primary-hover text-text-inverse px-4 py-2 rounded transition-theme text-sm">＋ 添加职务</button>
          <button @click="settingsVisible = false" class="bg-surface-hover text-text border border-border px-4 py-2 rounded transition-theme cursor-pointer text-sm">关闭</button>
        </div>
      </div>
    </div>
    </Transition>

    <!-- ============ 新增/编辑职务弹窗 ============ -->
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

    <!-- ============ 添加担任学生弹窗 ============ -->
    <Transition name="dialog">
    <div v-if="memberDialogVisible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10003]" @click.self="memberDialogVisible = false">
      <div class="bg-surface p-6 rounded-xl w-96 shadow-card dialog-card border border-border">
        <h3 class="text-lg font-bold text-text mb-2">为「{{ memberTarget?.name }}」添加担任学生</h3>
        <div class="mb-1 text-xs text-text-muted">支持输入姓名自动补全，回车或点选确定（已选 {{ nodeMembers.length }}/{{ memberTarget?.max_count }} 人）</div>
        <div class="relative" v-if="!doneAdding">
          <input
            v-model="memberKeyword"
            @input="onMemberKeywordInput"
            @keydown="onMemberKeywordKeydown"
            placeholder="输入学生姓名"
            class="border border-border bg-surface text-text px-3 py-2 rounded w-full"
          />
          <!-- 候选列表 -->
          <div
            v-if="suggested.length > 0"
            class="absolute left-0 right-0 top-full mt-1 bg-surface border border-info shadow-lg rounded max-h-48 overflow-auto z-10"
          >
            <div
              v-for="(s, idx) in suggested"
              :key="s.id"
              :class="['px-3 py-2 text-sm cursor-pointer hover:bg-info/10 truncate', { 'bg-info/20': idx === suggestIndex }]"
              @mousedown.prevent="pickStudent(s)"
              @mouseenter="suggestIndex = idx"
            >{{ s.姓名 }}</div>
          </div>
        </div>
        <!-- 已加入列表 -->
        <div class="flex flex-wrap gap-2 mt-3">
          <span v-for="s in pickedStudents" :key="s.id" class="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded-full text-sm">
            {{ s.姓名 }}
            <button class="text-primary/70 hover:text-primary text-sm leading-none cursor-pointer" @click="removePicked(s.id)">×</button>
          </span>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button @click="memberDialogVisible = false" class="bg-surface-hover text-text border border-border px-4 py-2 rounded transition-theme cursor-pointer">取消</button>
          <button @click="confirmMembers" :disabled="pickedStudents.length === 0" class="bg-primary text-text-inverse px-4 py-2 rounded transition-theme cursor-pointer disabled:opacity-50">确定</button>
        </div>
      </div>
    </div>
    </Transition>

    <!-- ============ 二次确认弹窗 ============ -->
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
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import axios from 'axios'
import CadreTreeNode from './CadreTreeNode.vue'
import CadreTreeList from './CadreTreeList.vue'
import { useNotification } from '../composables/useNotification'

const { success, error, info } = useNotification()

const API_BASE = '/api'
const tree = ref([])
const loading = ref(false)
const allStudents = ref([])
const settingsVisible = ref(false)

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
  } catch (e) {
    error('加载职务树失败')
  } finally {
    loading.value = false
  }
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
const memberDialogVisible = ref(false)
const memberTarget = ref(null)
const memberKeyword = ref('')
const suggestIndex = ref(0)
const pickedStudents = ref([]) // 本次弹窗新增的临时选择（尚未落库）

const suggested = computed(() => {
  const kw = (memberKeyword.value || '').toLowerCase().trim()
  const existing = new Set((memberTarget.value?.members || []).map(m => String(m.student_name || '').trim()))
  pickedStudents.value.forEach(s => existing.add(String(s.姓名 || '').trim()))
  return allStudents.value.filter(s => {
    const n = String(s.姓名 || '').toLowerCase()
    return (!kw || n.includes(kw)) && !existing.has(String(s.姓名 || '').trim())
  })
})

function onAddMember(node) {
  if (node.members.length >= node.max_count) {
    return info(`「${node.name}」人数已达上限 ${node.max_count} 人`)
  }
  memberTarget.value = node
  memberKeyword.value = ''
  suggestIndex.value = 0
  pickedStudents.value = []
  memberDialogVisible.value = true
}
function onMemberKeywordInput() {
  suggestIndex.value = 0
}
function onMemberKeywordKeydown(e) {
  if (e.key === 'Enter' || e.key === 'Tab') {
    if (suggested.value.length > 0) { e.preventDefault(); pickStudent(suggested.value[suggestIndex.value]) }
    return
  }
  if (e.key === 'ArrowDown') {
    if (suggested.value.length > 0) { e.preventDefault(); suggestIndex.value = (suggestIndex.value + 1) % suggested.value.length }
    return
  }
  if (e.key === 'ArrowUp') {
    if (suggested.value.length > 0) { e.preventDefault(); suggestIndex.value = (suggestIndex.value - 1 + suggested.value.length) % suggested.value.length }
    return
  }
}
function pickStudent(s) {
  if (pickedStudents.value.length >= memberTarget.value.max_count) {
    return info(`「${memberTarget.value.name}」人数已达上限 ${memberTarget.value.max_count} 人`)
  }
  if (!pickedStudents.value.some(x => x.id === s.id)) {
    pickedStudents.value.push(s)
  }
  memberKeyword.value = ''
  suggestIndex.value = 0
}
function removePicked(id) {
  pickedStudents.value = pickedStudents.value.filter(x => x.id !== id)
}
async function confirmMembers() {
  const node = memberTarget.value
  if (!node || pickedStudents.value.length === 0) return
  try {
    for (const s of pickedStudents.value) {
      await api({ url: `/cadres/${node.id}/members`, method: 'post', data: { student_id: s.id, student_name: s.姓名 } })
    }
    memberDialogVisible.value = false
    pickedStudents.value = []
    success('已添加担任学生')
    await loadTree()
  } catch (e) {
    error(e.response?.data?.error || '添加失败')
  }
}
async function onRemoveMember(node, m) {
  try {
    await api({ url: `/cadres/members/${m.id}`, method: 'delete' })
    await loadTree()
  } catch (e) {
    error(e.response?.data?.error || '移除失败')
  }
}
</script>

<style scoped>
</style>