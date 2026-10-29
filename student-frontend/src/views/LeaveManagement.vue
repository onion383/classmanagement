<template>
  <div>
    <!-- 页面标题 -->
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-5 py-3 border border-border min-h-[4.5rem] flex items-center">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="leave" /> 请假管理</h1>
    </div>

    <!-- 切换栏 -->
    <Tabs :tabs="tabs" v-model="activeTab">
      <template #default>
      </template>
    </Tabs>

    <!-- 今日到班 -->
    <div v-if="activeTab === 'today'">
      <!-- 数据看板 -->
      <div class="grid grid-cols-3 gap-4 mb-6">
        <div class="bg-surface rounded-xl border border-border p-4">
          <div class="text-sm text-text-secondary">全班人数</div>
          <div class="text-2xl font-bold text-text">{{ totalStudents }} 人</div>
        </div>
        <div class="bg-success/10 rounded-xl border border-border p-4">
          <div class="text-sm text-text-secondary">在校人数</div>
          <div class="text-2xl font-bold text-success">{{ inSchool }} 人</div>
        </div>
        <div class="bg-danger/10 rounded-xl border border-border p-4">
          <div class="text-sm text-text-secondary">当前请假</div>
          <div class="text-2xl font-bold text-danger">{{ activeLeaves.length }} 人</div>
        </div>
      </div>

      <!-- 工具栏 -->
      <div class="mb-4 flex items-center gap-3 opbar">
        <button v-preload="loadAddLeaveDialog" @click="openAddLeave" class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded transition-theme">
          ＋ 添加请假
        </button>
        <button @click="refresh" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh transition-theme">
          <IconGlyph name="refresh" :size="14" tint="current" /> 刷新
        </button>
        <button v-preload="loadExportExcel" @click="openExportToday" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 transition-theme">
          <IconGlyph name="download" :size="14" tint="current" /> 导出今日表
        </button>
      </div>

      <!-- 当前请假中 -->
      <div class="bg-surface border border-border rounded-xl mb-4 overflow-hidden">
        <div class="px-5 py-3 border-b border-border font-bold text-text flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-danger inline-block"></span> 当前请假中（{{ activeLeaves.length }}人）
        </div>
        <DynamicTable
          fit-content
          no-select
          hide-add-row
          class="leave-today-table"
          :fields="activeLeaveFields"
          :rows="activeLeaveRows"
          :editing-cell="editingCell"
          actionsHeader="操作"
          emptyText="当前无请假学生"
          emptyActionText=""
          @startEdit="startEdit"
          @saveCell="saveCell"
          @swapRows="(from, to) => saveRowOrder('active', from, to)"
          @swapColumns="(from, to) => saveColumnOrder('active', from, to)"
        >
          <template #cell-type="{ row, field, editing }">
            <AppSelect v-if="editing" v-model="row.类型" :options="leaveTypeOptions" @change="saveCell(row, field)" class="w-full" />
            <span v-else @dblclick="startEdit(row, field)" class="px-2 py-0.5 rounded text-xs bg-danger/10 text-danger cursor-text">{{ row.类型 }}</span>
          </template>
          <template #cell-range="{ row }">
            <span class="whitespace-nowrap">{{ row._range }}</span>
          </template>
          <template #cell-dash="{ row, field, value, editing }">
            <input
              v-if="editing"
              v-model="row[field.name]"
              @blur="saveCell(row, field)"
              @keyup.enter="saveCell(row, field)"
              class="w-full h-6 leading-6 px-1 py-0 border border-transparent bg-warning/10 focus:outline-none focus:border-primary box-border"
            />
            <span v-else @dblclick="startEdit(row, field)" class="cursor-text">{{ value || '—' }}</span>
          </template>
          <template #row-actions="{ row }">
            <button @click="openEditLeave(row)" class="bg-info hover:bg-blue-700 text-text-inverse px-3 py-1 rounded text-xs mr-1 transition-theme">编辑</button>
            <button @click="returnLeave(row)" class="bg-success hover:bg-green-700 text-text-inverse px-3 py-1 rounded text-xs transition-theme">销假</button>
          </template>
        </DynamicTable>
      </div>

      <!-- 今日已返校 -->
      <div class="bg-surface border border-border rounded-xl overflow-hidden">
        <div class="px-5 py-3 border-b border-border font-bold text-text flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-success inline-block"></span> 今日已返校（{{ todayReturned.length }}人）
        </div>
        <DynamicTable
          fit-content
          no-select
          hide-add-row
          class="leave-today-table"
          :fields="returnedLeaveFields"
          :rows="returnedLeaveRows"
          :editing-cell="editingCell"
          actionsHeader="操作"
          emptyText="今日暂无返校记录"
          emptyActionText=""
          @startEdit="startEdit"
          @saveCell="saveCell"
          @swapRows="(from, to) => saveRowOrder('returned', from, to)"
          @swapColumns="(from, to) => saveColumnOrder('returned', from, to)"
        >
          <template #cell-range="{ row }">
            <span class="whitespace-nowrap">{{ row._range }}</span>
          </template>
          <template #cell-type-info="{ row, field, editing }">
            <AppSelect v-if="editing" v-model="row.类型" :options="leaveTypeOptions" @change="saveCell(row, field)" class="w-full" />
            <span v-else @dblclick="startEdit(row, field)" class="px-2 py-0.5 rounded text-xs bg-info/10 text-info cursor-text">{{ row.类型 }}</span>
          </template>
          <template #cell-dash="{ row, field, value, editing }">
            <input
              v-if="editing"
              v-model="row[field.name]"
              @blur="saveCell(row, field)"
              @keyup.enter="saveCell(row, field)"
              class="w-full h-6 leading-6 px-1 py-0 border border-transparent bg-warning/10 focus:outline-none focus:border-primary box-border"
            />
            <span v-else @dblclick="startEdit(row, field)" class="cursor-text">{{ value || '—' }}</span>
          </template>
          <template #row-actions="{ row }">
            <button @click="openEditLeave(row)" class="bg-info hover:bg-blue-700 text-text-inverse px-3 py-1 rounded text-xs mr-1 transition-theme">编辑</button>
            <button @click="unreturnLeave(row)" class="bg-warning hover:bg-yellow-600 text-text-inverse px-3 py-1 rounded text-xs transition-theme">撤销销假</button>
          </template>
        </DynamicTable>
      </div>
    </div>

    <!-- 请假记录页签：请假统计 + 请假记录（表格 / 时间轴） -->
    <div v-if="activeTab === 'records'">
      <!-- 请假统计 -->
      <h3 class="text-xl font-semibold text-text mb-4 flex items-center gap-2 min-h-7"><IconGlyph name="chart" :size="20" /> 请假统计</h3>
      <div class="mb-4 flex flex-wrap items-center gap-3 opbar">
        <button @click="refreshStats" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh transition-theme">
          <IconGlyph name="refresh" :size="14" tint="current" /> 刷新
        </button>
        <button v-preload="loadExportExcel" @click="openStatsExport" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 transition-theme">
          <IconGlyph name="download" :size="14" tint="current" /> 导出 Excel
        </button>
      </div>
      <div class="bg-surface border border-border rounded-xl p-5">
        <StatBarList :rows="leaveStatRows" name-key="姓名" value-key="合计" :bar-width="statBarWidth" empty-text="暂无请假统计" />
      </div>

      <!-- 请假记录子标题 -->
      <h3 class="text-xl font-semibold text-text mt-8 mb-4 flex items-center gap-2 min-h-7"><IconGlyph name="clipboard" :size="20" /> 请假记录</h3>

      <!-- 工具栏：视图切换右对齐 -->
      <div class="mb-4 flex items-center gap-3 opbar">
        <button v-preload="loadAddLeaveDialog" @click="openAddLeave" class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded transition-theme">
          ＋ 添加请假
        </button>
        <button @click="refresh" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh transition-theme">
          <IconGlyph name="refresh" :size="14" tint="current" /> 刷新
        </button>
        <button v-preload="loadExportExcel" @click="openRecordsExport" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 transition-theme">
          <IconGlyph name="download" :size="14" tint="current" /> 导出 Excel
        </button>
        <ViewSwitch v-model="recordsView" :options="recordsViewOptions" class="ml-auto" />
      </div>

      <!-- 同一固定高度容器：v-show 切换，两个视图都保持挂载，切换不闪动、不改变页面高度 -->
      <div class="records-panel h-[400px] min-h-0">
        <div v-show="recordsView === 'table'" class="h-full">
          <DynamicTable
            :fields="leaveFields"
            :rows="displayLeaves"
            :newRow="newRow"
            :editingCell="editingCell"
            :hideMoveButtons="true"
            :hideSelectAll="true"
            :maxRows="10"
            :opColumnWidth="190"
            @startEdit="startEdit"
            @saveCell="saveCell"
            @swapColumns="(from, to) => saveColumnOrder('records', from, to)"
            @deleteRow="deleteLeave"
            @addNewRowAtBottom="addNewRowAtBottom"
            @updateNewRow="onUpdateNewRow"
            @saveNewRow="saveNewRow"
            @cancelNewRow="cancelNewRow"
            @contextmenu.prevent="() => {}"
            @selectionChange="() => {}"
          >
            <template #row-actions-extra="{ row }">
              <button v-if="!row._isNew" @click="openEditLeave(row)" class="bg-info hover:bg-blue-700 text-text-inverse px-1.5 py-0.5 rounded mr-1 transition-theme">编辑</button>
            </template>
          </DynamicTable>
        </div>
        <div v-show="recordsView === 'timeline'" class="h-full">
          <LeaveTimeline fill-height :nodes="timelineNodes" :type-options="leaveTypeOptions" title="" />
        </div>
      </div>
    </div>

    <!-- 添加请假弹窗 -->
    <AddLeaveDialog
      v-if="addDialogMounted"
      :visible="addDialogVisible"
      :students="students"
      :type-options="leaveTypeOptions"
      :editing-record="editingLeave"
      @confirm="submitAdd"
      @update="updateLeave"
      @delete="rec => deleteLeave(rec?.id)"
      @ask-save-phones="askSavePhones"
      @cancel="addDialogVisible = false"
    />

    <!-- 导出弹窗 -->
    <ExportExcel
      v-if="exportMounted"
      :is-visible="exportVisible"
      :rows="exportRows"
      :fields="exportFields"
      :tableElement="todayTableEl"
      :defaultFilename="exportFilename"
      @export-finish="() => {}"
      @update:is-visible="exportVisible = $event"
    />

    <!-- 确认弹窗 -->
    <ConfirmDialog
      v-if="confirmMounted"
      :visible="confirm.visible"
      :message="confirm.message"
      type="confirm"
      :showCancel="true"
      @confirm="confirm.ok"
      @cancel="confirm.visible = false"
    />

    <!-- 假期已结束未销假提示弹窗 -->
    <OverdueLeaveDialog
      v-if="overdueDialogMounted"
      :visible="overdueDialogVisible"
      :records="overdueList"
      @not="handleOverdueNot"
      @ret="handleOverdueReturn"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onActivated, onDeactivated, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { reportError } from '../utils/reportError.js'
import axios from 'axios'
import Tabs from '../components/base/Tabs.vue'
import ViewSwitch from '../components/base/ViewSwitch.vue'
import AppSelect from '../components/base/AppSelect.vue'
import DynamicTable from '../components/tables/DynamicTable/DynamicTable.vue'
import LeaveTimeline from '../components/base/LeaveTimeline.vue'
import { zhCollator } from '../utils/collator.js'
import StatBarList from '../components/base/StatBarList.vue'
import { useNotification } from '../composables/useNotification.js'
import { recordCellUndo, useUndoShortcut } from '../composables/useUndo.js'
import { formatDate, formatDateTime } from '../utils/dateTime.js'
import { applyRouteRowFocus } from '../composables/useRowFocus.js'

// 弹窗类组件懒加载：打开时才加载对应 chunk
const loadAddLeaveDialog = () => import('../components/dialogs/AddLeaveDialog.vue')
const AddLeaveDialog = defineAsyncComponent(loadAddLeaveDialog)
const loadExportExcel = () => import('../components/import-export/ExportExcel/ExportExcel.vue')
const ExportExcel = defineAsyncComponent(loadExportExcel)
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'))
const OverdueLeaveDialog = defineAsyncComponent(() => import('../components/dialogs/OverdueLeaveDialog.vue'))

const API = '/api'

defineOptions({ name: 'LeaveManagement' })

const { success: notifySuccess, error: notifyError, info: notifyInfo } = useNotification()

const route = useRoute()
const router = useRouter()
// 行定位宿主：显式传路由对象（身份稳定供 useRowFocus 记签名；不再经实例代理）
const rowFocusHost = { route, router }

// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销、重做请假表
useUndoShortcut('leave_records', {
  onAfterUndo: (label) => { loadAll(); notifySuccess(label ? `已撤销：${label}` : '已撤销') },
  onAfterRedo: (label) => { loadAll(); notifySuccess(label ? `已重做：${label}` : '已重做') }
})

const activeTab = ref('today')
// 请假记录页签的视图：表格 / 时间轴
const recordsView = ref('table')
const recordsViewOptions = [
  { value: 'table', label: '表格' },
  { value: 'timeline', label: '时间轴' }
]
const loading = ref(false)
const students = ref([])
const leaves = ref([])
const addDialogVisible = ref(false)
const addDialogMounted = ref(false)
const editingLeave = ref(null)
const editingCell = ref(null)
const newRow = ref(null)
const exportVisible = ref(false)
const exportMounted = ref(false)
// 导出内容来源：today 今日到班 / records 请假记录 / stats 请假统计
const exportKind = ref('records')
const confirm = ref({ visible: false, message: '', ok: null })
const confirmMounted = ref(false)
const leaveTypeOptions = ['病假', '事假', '其他']
// 假期已结束未销假的提示弹窗
const overdueDialogVisible = ref(false)
const overdueDialogMounted = ref(false)
const overdueList = ref([])
// 本次会话内已提醒过（无论处理与否）的记录 id，避免重复弹窗
const promptedIds = new Set()
const todayExportFields = [
  { name: '姓名' },
  { name: '类型' },
  { name: '开始时间' },
  { name: '结束时间' },
  { name: '家长联系电话' },
  { name: '学生联系电话' },
  { name: '状态' },
  { name: '返校时间' }
]
// 请假统计导出列
const leaveStatExportFields = [
  { name: '姓名' },
  { name: '病假' },
  { name: '事假' },
  { name: '其他' },
  { name: '合计' }
]
const leaveFields = ref([
  { name: '姓名', type: '文字' },
  { name: '类型', type: '文字', control: 'select', options: ['病假', '事假', '其他'] },
  { name: '开始时间', type: '文字' },
  { name: '结束时间', type: '文字' },
  { name: '家长联系电话', type: '文字' },
  { name: '学生联系电话', type: '文字' },
  { name: '状态', type: '文字', control: 'select', options: ['请假中', '已返校', '已取消'] },
  { name: '备注', type: '文字' }
])
// 今日到班两张表的列定义（顺序可拖动并保存到后端；slot 指向模板里的自定义单元格）
const activeLeaveFields = ref([
  { name: 'position', label: '#' },
  { name: '姓名' },
  { name: '类型', slot: 'cell-type' },
  { name: '请假时段', slot: 'cell-range' },
  { name: '家长联系电话', slot: 'cell-dash' },
  { name: '学生联系电话', slot: 'cell-dash' },
  { name: '备注', slot: 'cell-dash' }
])
const returnedLeaveFields = ref([
  { name: 'position', label: '#' },
  { name: '姓名' },
  { name: '请假时段', slot: 'cell-range' },
  { name: '家长联系电话', slot: 'cell-dash' },
  { name: '学生联系电话', slot: 'cell-dash' },
  { name: '原因（类型）', slot: 'cell-type-info' },
  { name: '返校时间' }
])
const tabs = [
  { value: 'today', label: '今日到班' },
  { value: 'records', label: '请假记录' }
]

const totalStudents = computed(() => students.value.length)
const activeLeaves = computed(() => leaves.value.filter(l => l.状态 === '请假中'))
const todayReturned = computed(() => {
  const todayStr = formatDate(new Date())
  return leaves.value.filter(l => l.状态 === '已返校' && l.返校时间 && l.返校时间.startsWith(todayStr))
})
// 只读表格行：补 DynamicTable 必需的 _rowKey/_displayIndex，并预算好请假时段文案
const activeLeaveRows = computed(() => activeLeaves.value.map((l, i) => ({ ...l, _rowKey: l.id, _displayIndex: i + 1, _range: rangeOf(l) })))
const returnedLeaveRows = computed(() => todayReturned.value.map((l, i) => ({ ...l, _rowKey: l.id, _displayIndex: i + 1, _range: rangeOf(l) })))
const inSchool = computed(() => totalStudents.value - activeLeaves.value.length)
const displayLeaves = computed(() => {
  const list = leaves.value.map((r, i) => ({ ...r, _isNew: false, _rowKey: r.id, _displayIndex: i + 1, position: i + 1 }))
  if (newRow.value) list.push(newRow.value)
  return list
})
const todayExportRows = computed(() => {
  const all = [...activeLeaves.value, ...todayReturned.value]
  return all.map(l => ({
    姓名: l.姓名 || '',
    类型: l.类型 || '',
    开始时间: l.开始时间 || '',
    结束时间: l.结束时间 || '',
    家长联系电话: l.家长联系电话 || '',
    学生联系电话: l.学生联系电话 || '',
    状态: l.状态 || '',
    返校时间: l.返校时间 || ''
  }))
})
const todayTableEl = computed(() => {
  return null
})
// 导出内容随来源切换：今日到班 / 请假记录（排除未保存的新增行）/ 请假统计
const exportRows = computed(() => {
  if (exportKind.value === 'today') return todayExportRows.value
  if (exportKind.value === 'stats') return leaveStatRows.value
  return displayLeaves.value.filter(r => !r._isNew)
})
const exportFields = computed(() => {
  if (exportKind.value === 'today') return todayExportFields
  if (exportKind.value === 'stats') return leaveStatExportFields
  return leaveFields.value
})
const exportFilename = computed(() => {
  if (exportKind.value === 'today') return '今日请假表'
  if (exportKind.value === 'stats') return '请假统计'
  return '请假记录'
})
// 请假统计：按学生汇总请假次数（病假 / 事假 / 其他），合计降序、同数按姓名排
const leaveStatRows = computed(() => {
  const map = new Map()
  leaves.value.forEach(l => {
    const name = l.姓名 || '未知'
    let row = map.get(name)
    if (!row) {
      row = { 姓名: name, 病假: 0, 事假: 0, 其他: 0, 合计: 0 }
      map.set(name, row)
    }
    if (l.类型 === '病假') row.病假++
    else if (l.类型 === '事假') row.事假++
    else row.其他++
    row.合计++
  })
  return [...map.values()].sort((a, b) => b.合计 - a.合计 || zhCollator.compare(a.姓名, b.姓名))
})
// 统计条长度基准：出现次数最多的学生
const maxLeaveStat = computed(() => leaveStatRows.value.reduce((m, r) => Math.max(m, r.合计), 0))
const timelineNodes = computed(() => {
  const arr = []
  leaves.value.forEach(l => {
    const cat = l.类型 || '请假'
    const name = l.姓名 || ''
    if (l.created_at) {
      arr.push({ key: `${l.id}-apply`, type: 'apply', time: l.created_at, text: `${name} 申请请假（${cat}）`, category: cat })
    }
    if (l.开始时间) {
      arr.push({ key: `${l.id}-leave`, type: 'leave', time: l.开始时间, text: `${name} 请假（${cat}）离开校园`, category: cat })
    }
    if (l.状态 === '已返校' && l.返校时间) {
      arr.push({ key: `${l.id}-return`, type: 'return', time: l.返校时间, text: `${name} 返校`, category: cat })
    }
  })
  return arr
})

// 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，保留退出动画
watch(addDialogVisible, (n) => { if (n) addDialogMounted.value = true })
watch(exportVisible, (n) => { if (n) exportMounted.value = true })
watch(() => confirm.value.visible, (n) => { if (n) confirmMounted.value = true })
watch(overdueDialogVisible, (n) => { if (n) overdueDialogMounted.value = true })
// 跨页定位：标题栏全局搜索点「请假记录」结果跳转 /leaves?focus=<id>
watch(() => route.query.focus, () => { _applyRowFocus() })

// 非响应式实例状态
let _overdueTimer = null
// 请假时段展示的行对象缓存（WeakMap），行对象随每次加载重建，缓存自然失效
let _rangeCache = null

function _startOverdueTimer() {
  _stopOverdueTimer()
  _overdueTimer = setInterval(() => checkOverdue(), 10 * 60 * 1000)
}
function _stopOverdueTimer() {
  if (_overdueTimer) {
    clearInterval(_overdueTimer)
    _overdueTimer = null
  }
}
// 跨页定位：切到「请假记录」页签后滚动到目标并高亮闪动。
// 裸 id 定位请假记录表格的整行；`tl:<节点key>` 定位请假时间轴上的那一项（如 tl:12-leave）。
function _applyRowFocus() {
  applyRouteRowFocus(rowFocusHost, {
    parse: (key) => {
      activeTab.value = 'records'
      if (key.startsWith('tl:')) return key.slice('tl:'.length)
      return key
    }
  })
}
// 时间段展示：同日显示 "M-D H:mm~H:mm"，跨天显示完整起止
function formatRange(s, e) {
  s = s || ''
  e = e || ''
  const short = (str) => {
    if (!str) return ''
    const [d, t] = str.split(' ')
    const ps = d ? d.split('-') : []
    return `${Number(ps[1])}-${Number(ps[2])} ${t}`
  }
  if (!s && !e) return '—'
  if (!s) return short(e)
  if (!e) return short(s)
  const d1 = s.split(' ')[0]
  const d2 = e.split(' ')[0]
  if (d1 === d2) {
    return `${short(s).split(' ')[0]} ${s.split(' ')[1]}~${e.split(' ')[1]}`
  }
  return `${short(s)} ~ ${short(e)}`
}
// 请假时段展示：按行对象缓存结果，避免每次重渲染都重做一遍字符串切分。
// 缓存挂在行对象上（WeakMap），行对象随每次加载重建，缓存自然失效；起止时间变了也会重算。
function rangeOf(item) {
  if (!_rangeCache) _rangeCache = new WeakMap()
  const s = item.开始时间 || ''
  const e = item.结束时间 || ''
  const hit = _rangeCache.get(item)
  if (hit && hit.s === s && hit.e === e) return hit.text
  const text = formatRange(s, e)
  _rangeCache.set(item, { s, e, text })
  return text
}
async function loadAll() {
  loading.value = true
  try {
    const [stuRes, leavesRes] = await Promise.all([
      axios.get(`${API}/students`),
      axios.get(`${API}/leaves`)
    ])
    students.value = stuRes.data.data || []
    leaves.value = leavesRes.data.data || []
    return true
  } catch (err) {
    notifyError('加载失败')
    return false
  } finally {
    loading.value = false
  }
}
async function refresh() {
  // 失败时 loadAll 已提示「加载失败」，不能再走成功分支
  if (!await loadAll()) return
  notifySuccess(activeTab.value === 'today' ? '已刷新 今日请假 数据' : '已刷新 请假记录 数据')
  checkOverdue()
}
// 当前时间字符串，格式与结束时间保持一致（YYYY-MM-DD HH:mm）
function nowStr() {
  return formatDateTime(new Date())
}
// 检测「假期已结束但尚未销假」的记录并弹出提示
function checkOverdue() {
  const now = nowStr()
  // 状态为「请假中」且结束时间已到、且本会话未提醒过
  const overdue = activeLeaves.value.filter(
    (l) => l.结束时间 && l.结束时间 <= now && !promptedIds.has(l.id)
  )
  if (overdue.length === 0) return
  // 本次会话记录已提醒，避免该同学反复弹出
  overdue.forEach((l) => promptedIds.add(l.id))
  overdueList.value = overdue.map((l) => ({
    ...l,
    _range: formatRange(l.开始时间, l.结束时间)
  }))
  overdueDialogVisible.value = true
}
// 「未返校」：保持请假中，仅从本次弹窗列表移除
function handleOverdueNot(rec) {
  removeOverdue(rec.id)
}
// 「已经返校并销假」：调用销假接口后从列表移除
async function handleOverdueReturn(rec) {
  try {
    await axios.post(`${API}/leaves/${rec.id}/return`)
    notifySuccess(`${rec.姓名} 已返校并销假`)
    removeOverdue(rec.id)
    await loadAll()
  } catch (err) {
    reportError(err, { action: '销假' })
  }
}
function removeOverdue(id) {
  overdueList.value = overdueList.value.filter((l) => l.id !== id)
  if (overdueList.value.length === 0) overdueDialogVisible.value = false
}
async function submitAdd(payload) {
  try {
    await axios.post(`${API}/leaves`, payload)
    addDialogVisible.value = false
    notifySuccess('已添加请假')
    await loadAll()
  } catch (err) {
    reportError(err, { action: '添加' })
  }
}
function openAddLeave() {
  editingLeave.value = null
  addDialogVisible.value = true
}
function openEditLeave(item) {
  editingLeave.value = item
  addDialogVisible.value = true
}
async function updateLeave(payload) {
  const { id, ...fields } = payload
  try {
    await axios.put(`${API}/leaves/${id}`, fields)
    addDialogVisible.value = false
    notifySuccess('已保存')
    await loadAll()
  } catch (err) {
    reportError(err, { action: '保存' })
  }
}
function unreturnLeave(item) {
  confirm.value = {
    visible: true,
    message: `确认撤销「${item.姓名}」的销假，恢复为请假中吗？`,
    ok: async () => {
      confirm.value.visible = false
      try {
        await axios.post(`${API}/leaves/${item.id}/unreturn`)
        notifySuccess('已撤销销假')
        await loadAll()
      } catch (err) {
        notifyError('撤销失败')
      }
    }
  }
}
function returnLeave(item) {
  confirm.value = {
    visible: true,
    message: `确认 ${item.姓名} 已返校并销假吗？`,
    ok: async () => {
      confirm.value.visible = false
      try {
        await axios.post(`${API}/leaves/${item.id}/return`)
        notifySuccess('已销假')
        await loadAll()
      } catch (err) {
        notifyError('销假失败')
      }
    }
  }
}
// 修改了联系方式后，询问是否同步保存到学生档案
function askSavePhones(phoneUpdate) {
  const keys = Object.keys(phoneUpdate).filter(k => k !== 'studentId')
  const names = keys.join('、')
  confirm.value = {
    visible: true,
    message: `检测到你修改了「${names}」，是否将联系方式保存到班级管理的学生档案，方便之后使用？`,
    ok: async () => {
      confirm.value.visible = false
      try {
        const { studentId, ...fields } = phoneUpdate
        await axios.put(`${API}/students/${studentId}`, fields)
        notifySuccess('联系方式已保存')
        students.value = (await axios.get(`${API}/students`)).data.data || students.value
      } catch (err) {
        notifyError('联系方式保存失败')
      }
    }
  }
}
function startEdit(row, field) {
  editingCell.value = { rowKey: row._rowKey, field: field.name }
}
// 行拖动：今日到班是筛选后的子集，先把被拖行按「目标位置相邻行」插回整表顺序，再整表保存
async function saveRowOrder(table, from, to) {
  const subset = table === 'active' ? activeLeaves.value : todayReturned.value
  if (from === to || !subset[from]) return
  const moved = subset[from]
  const rest = subset.filter((_, i) => i !== from)
  const ids = leaves.value.map(l => l.id).filter(id => id !== moved.id)
  const neighbor = rest[to]
  let insertAt
  if (neighbor) insertAt = ids.indexOf(neighbor.id)
  else {
    const last = rest[rest.length - 1]
    insertAt = last ? ids.indexOf(last.id) + 1 : ids.length
  }
  if (insertAt < 0) insertAt = ids.length
  ids.splice(insertAt, 0, moved.id)
  try {
    await axios.post(`${API}/leaves/reorder`, { ids })
    await loadAll()
  } catch (err) {
    notifyError('排序保存失败')
  }
}
// 列拖动：本地立即重排，并把列顺序保存到后端（下次进入按保存的顺序渲染）
async function saveColumnOrder(table, from, to) {
  if (from === to) return
  const keys = { active: activeLeaveFields, returned: returnedLeaveFields, records: leaveFields }
  const key = keys[table]
  const arr = [...key.value]
  const [moved] = arr.splice(from, 1)
  if (!moved) return
  arr.splice(to, 0, moved)
  key.value = arr
  try {
    await axios.post(`${API}/leaves/today-columns`, { table, order: arr.map(f => f.name) })
  } catch (err) {
    notifyError('列顺序保存失败')
  }
}
// 读取后端保存的列顺序；未登记过的列保持原有相对位置追加在末尾
async function loadColumnOrder() {
  try {
    const { data } = await axios.get(`${API}/leaves/today-columns`)
    const apply = (fields, order) => {
      if (!Array.isArray(order) || order.length === 0) return fields
      const map = new Map(fields.map(f => [f.name, f]))
      const out = order.map(n => map.get(n)).filter(Boolean)
      fields.forEach(f => { if (!order.includes(f.name)) out.push(f) })
      return out
    }
    activeLeaveFields.value = apply(activeLeaveFields.value, data.active)
    returnedLeaveFields.value = apply(returnedLeaveFields.value, data.returned)
    leaveFields.value = apply(leaveFields.value, data.records)
  } catch (_) { /* 读取失败时保持默认列顺序 */ }
}
async function saveCell(row, field) {
  const val = row[field.name]
  // 旧值来源：编辑前的请假记录
  const oldLeave = leaves.value.find(l => l.id === row.id)
  const oldVal = oldLeave ? oldLeave[field.name] : undefined
  try {
    await axios.put(`${API}/leaves/${row.id}`, { [field.name]: val })
    if (oldVal !== val) recordCellUndo('leave_records', row.id, field.name, oldVal, val)
    notifySuccess('已保存')
  } catch (err) {
    notifyError('保存失败')
  }
  editingCell.value = null
  await loadAll()
}
// ---------- 行内新增一行 ----------
function addNewRowAtBottom() {
  if (newRow.value) return
  const empty = {}
  leaveFields.value.forEach(f => {
    if (f.name !== 'id' && f.name !== 'position') empty[f.name] = ''
  })
  newRow.value = { ...empty, _isNew: true, _rowKey: 'new' }
}
function onUpdateNewRow(fieldName, value) {
  if (newRow.value) newRow.value[fieldName] = value
}
function cancelNewRow() {
  newRow.value = null
}
async function saveNewRow() {
  if (!newRow.value) return
  const data = {}
  for (const f of leaveFields.value) {
    if (f.name === 'id' || f.name === 'position') continue
    data[f.name] = newRow.value[f.name] || ''
  }
  try {
    await axios.post(`${API}/leaves`, data)
    newRow.value = null
    notifySuccess('已添加请假记录')
    await loadAll()
  } catch (err) {
    reportError(err, { action: '添加' })
  }
}
function deleteLeave(id) {
  confirm.value = {
    visible: true,
    message: '是否删除该条请假数据？',
    ok: async () => {
      confirm.value.visible = false
      addDialogVisible.value = false // 关闭编辑弹窗
      try {
        await axios.delete(`${API}/leaves/${id}`)
        notifySuccess('已删除')
        await loadAll()
      } catch (err) {
        notifyError('删除失败')
      }
    }
  }
}
// 导出今日请假表：无数据时直接提示，不弹导出选项弹窗
function openExportToday() {
  if (todayExportRows.value.length === 0) return notifyInfo('暂无请假数据可导出')
  exportKind.value = 'today'
  exportVisible.value = true
}
// 导出请假记录：无数据时直接提示，不弹导出选项弹窗
function openRecordsExport() {
  if (leaves.value.length === 0) return notifyInfo('暂无请假记录可导出')
  exportKind.value = 'records'
  exportVisible.value = true
}
// 统计条长度：按最大次数归一到百分之百，最小保留 4% 以便零头也可见
function statBarWidth(row) {
  if (!maxLeaveStat.value) return 0
  return Math.max(4, Math.round(row.合计 / maxLeaveStat.value * 100))
}
// 刷新请假统计：与表格共用同一份请假数据
// loadAll 失败时内部已提示「加载失败」并 return false（不抛），所以不能用 try/catch 判断——
// 原来那个 catch 是死代码，失败时会同时弹「加载失败」和「已刷新 请假统计 数据」。
// 与同文件 refresh() 的写法保持一致。
async function refreshStats() {
  if (!await loadAll()) return
  notifySuccess('已刷新 请假统计 数据')
}
// 导出请假统计：无数据时直接提示
function openStatsExport() {
  if (leaveStatRows.value.length === 0) return notifyInfo('暂无请假统计可导出')
  exportKind.value = 'stats'
  exportVisible.value = true
}

// created 等价：数据加载与超时检测初始化（不阻塞渲染）
;(async () => {
  await loadAll()
  await loadColumnOrder()
  // 打开页面后检测一次超时未销假
  checkOverdue()
  // 每 10 分钟低频检测一次（纯前端比较时间，成本极低）
  _startOverdueTimer()
})()

onMounted(() => { _applyRowFocus() })
// 页面被 KeepAlive 缓存：切走时走 deactivated（不会 unmount），必须停表；
// 切回时重新启动，避免缓存页在后台每 10 分钟白跑一次。
onActivated(() => {
  _applyRowFocus()
  _startOverdueTimer()
})
onDeactivated(() => { _stopOverdueTimer() })
onBeforeUnmount(() => { _stopOverdueTimer() })
</script>

<style scoped>
/* 今日到班两张只读表：表头保持「纯蓝底 + 白字」，不跟随内置表格的浅蓝吸顶底。
   日间用主题蓝实底；深色沿用班干部一级行的低浓度蓝（40% 主题蓝 + 60% 深灰蓝）。 */
:root:not([data-mode="night"]) .leave-today-table :deep(.table-scroll-wrapper thead th.bg-primary) {
  background-color: var(--color-primary) !important;
  background-image: none !important;
  color: #fff !important;
  backdrop-filter: none;
}
:root[data-mode="night"] .leave-today-table :deep(.table-scroll-wrapper thead th.bg-primary) {
  background-color: color-mix(in srgb, var(--color-primary, #3b82f6) 40%, #475569) !important;
  background-image: none !important;
  color: #fff !important;
  backdrop-filter: none;
}
</style>