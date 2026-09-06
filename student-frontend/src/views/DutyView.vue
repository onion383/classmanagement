<template>
  <div>
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-5 py-3 border border-border min-h-[4.5rem] flex items-center justify-between">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2">
        <IconGlyph name="duty" /> 卫生值日
      </h1>
      <AppSelect v-model="dutyMode" :options="dutyModes" class="w-32" @change="onDutyModeChange" />
    </div>

    <Tabs :tabs="tabItems" v-model="activeTab">
      <template #default="{ activeTab }">
        <div v-if="activeTab === 'manage'">
          <section class="mb-8">
            <h2 class="text-xl font-semibold mb-4 flex items-center gap-2"><IconGlyph name="clipboard" :size="20" /> 当前值日表</h2>
            <div class="mb-4 flex flex-wrap items-center gap-3">
              <button @click="settingsVisible = true" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="settings" :size="14" tint="current" /> 设置</button>
              <button @click="arrangeVisible = true" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="zap" :size="14" tint="current" /> 智能排表</button>
              <button @click="refreshActive" class="bg-text-muted text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
              <button @click="applyMasterToActive" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="download" :size="14" tint="current" /> 从模板导入</button>
              <button @click="activeExportVisible = true" class="bg-warning text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="download" :size="14" tint="current" /> 导出值日表</button>
            </div>

            <div v-if="!activeLoaded" class="skeleton-block"></div>
            <GridView
              v-else
              :col-headers="settingsDays"
              :rows="dutyActiveRows"
              :hide-meta-columns="true"
              :show-row-number="true"
              :disable-row-drag="true"
              row-header-label="劳动项目"
              :enable-candidate="true"
              :candidate-items="allStudents"
              :candidate-exclude-ids="[]"
              candidate-label-field="姓名"
              candidate-placeholder="输入姓名"
              :min-table-height="200"
              @update:cells="onActiveCellsUpdate"
              @swap-rows="swapItems"
              @swap-columns="swapDays"
            />
            <ExportExcel v-if="activeExportMounted" :is-visible="activeExportVisible" :rows="activeExportRows" :fields="exportFields" defaultFilename="当前值日表" @update:is-visible="activeExportVisible = $event" />
          </section>

          <section>
            <h2 class="text-xl font-semibold mb-4 flex items-center gap-2"><IconGlyph name="box" :size="20" /> 值日模板</h2>
            <div class="mb-4 flex flex-wrap items-center gap-3">
              <button @click="refreshMaster" class="bg-text-muted text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
              <button @click="masterExportVisible = true" class="bg-warning text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="download" :size="14" tint="current" /> 导出值日表</button>
            </div>

            <div v-if="!masterLoaded" class="skeleton-block"></div>
            <GridView
              v-else
              :col-headers="settingsDays"
              :rows="dutyMasterRows"
              :hide-meta-columns="true"
              :show-row-number="true"
              :disable-row-drag="true"
              row-header-label="劳动项目"
              :enable-candidate="true"
              :candidate-items="allStudents"
              :candidate-exclude-ids="[]"
              candidate-label-field="姓名"
              candidate-placeholder="输入姓名"
              :min-table-height="200"
              @update:cells="onMasterCellsUpdate"
              @swap-rows="swapItems"
              @swap-columns="swapDays"
            />
            <ExportExcel v-if="masterExportMounted" :is-visible="masterExportVisible" :rows="masterExportRows" :fields="exportFields" defaultFilename="值日模板" @update:is-visible="masterExportVisible = $event" />
          </section>
        </div>

        <div v-else-if="activeTab === 'history'">
          <div v-if="historyLoading" class="skeleton-block"></div>
          <EmptySnapshot v-else-if="!historySnapshot" />
          <GridView v-else :col-headers="historyDays" :rows="historyRows" :hide-meta-columns="true" :show-row-number="true" row-header-label="劳动项目" :min-table-height="200" />
          <WeekSwitcher v-model:currentWeek="historyCurrentWeek" :weeks="historyWeeks" @update:currentWeek="loadHistorySnapshot" />
          <div class="text-center mt-4">
            <button @click="captureHistorySnapshot" class="bg-primary text-text-inverse px-4 py-2 rounded">📸 保存本周快照</button>
          </div>
        </div>
      </template>
    </Tabs>

    <!-- 值日设置弹窗 -->
    <DutySettingsDialog
      v-if="settingsMounted"
      :visible="settingsVisible"
      :days="settingsDays"
      :items="settingsItems"
      @save="saveSettings"
      @cancel="settingsVisible = false"
    />

    <!-- 值日智能排表弹窗 -->
    <DutyArrangementDialog
      v-if="arrangeMounted"
      :visible="arrangeVisible"
      :days="settingsDays"
      :items="settingsItems"
      :students="allStudents"
      @cancel="arrangeVisible = false"
      @confirm="onArrangeConfirm"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, defineAsyncComponent } from 'vue'
import axios from 'axios'
import Tabs from '../components/base/Tabs.vue'
import EmptySnapshot from '../components/base/EmptySnapshot.vue'
import GridView from '../components/tables/GridView.vue'
import WeekSwitcher from '../components/base/WeekSwitcher.vue'
import AppSelect from '../components/base/AppSelect.vue'
import { useNotification } from '../composables/useNotification.js'
import { useUndoShortcut, recordGridSnapshotUndo } from '../composables/useUndo.js'
import { syncStudentNamesFromRows, syncStudentNames } from '../composables/useSyncStudentNames.js'

// 弹窗类组件懒加载：打开时才加载对应 chunk
const DutySettingsDialog = defineAsyncComponent(() => import('../components/dialogs/DutySettingsDialog.vue'))
const DutyArrangementDialog = defineAsyncComponent(() => import('../components/dialogs/DutyArrangementDialog.vue'))
const ExportExcel = defineAsyncComponent(() => import('../components/import-export/ExportExcel.vue'))

const API_BASE = '/api'
const { success: notifySuccess, error: notifyError } = useNotification()

const activeTab = ref('manage')
const settingsVisible = ref(false)
const arrangeVisible = ref(false)

// 导出弹窗可见状态（受控模式配合 v-if 实现懒加载）
const activeExportVisible = ref(false)
const masterExportVisible = ref(false)

// 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，保留退出动画
const settingsMounted = ref(false)
const activeExportMounted = ref(false)
const masterExportMounted = ref(false)
const arrangeMounted = ref(false)
watch(() => settingsVisible.value, v => { if (v) settingsMounted.value = true })
watch(() => activeExportVisible.value, v => { if (v) activeExportMounted.value = true })
watch(() => masterExportVisible.value, v => { if (v) masterExportMounted.value = true })
watch(() => arrangeVisible.value, v => { if (v) arrangeMounted.value = true })
const tabItems = [
  { label: '值日管理', value: 'manage' },
  { label: '历史记录', value: 'history' }
]

// ==================== 全局设置（时间 + 劳动项目） ====================
const settingsDays = ref(['周一', '周二', '周三', '周四', '周五'])
const settingsItems = ref([])

// 学生名单（用于网格候选选择姓名）
const allStudents = ref([])

// 构建网状表格的 rows：每个劳动项目按「人数」拆成多行（每行一个人），首列跨行合并居中显示项目名，单元格存单个姓名
function buildGridRows(cells, items, days, readonly = false) {
  const list = items && items.length ? items : settingsItems.value
  const dayList = days && days.length ? days : settingsDays.value
  if (!list.length) return []
  const rows = []
  list.forEach(it => {
    const n = Math.max(1, Number(it.count) || 1)
    for (let k = 0; k < n; k++) {
      rows.push({
        _rowKey: `it_${it.name}_${k}`,
        label: it.name,
        _isReadonly: readonly,
        _rowHeaderRowSpan: k === 0 ? n : 0, // 首子行跨行合并，其余隐藏占位
        cells: dayList.map(day => ({ course: cells[it.name]?.[day]?.[k] || '' }))
      })
    }
  })
  return rows
}

// 把 GridView 返回的多行子行表格，按「项目名」分组回写为 cells[项目][星期] = [多个人名]
function reconstructCells(newRows, dayList) {
  const days = dayList && dayList.length ? dayList : settingsDays.value
  const groups = {}
  newRows.forEach(row => {
    if (row.label && !row._isSeparator && !row._isPodium) {
      if (!groups[row.label]) groups[row.label] = []
      groups[row.label].push(row.cells)
    }
  })
  const cells = {}
  Object.keys(groups).forEach(label => {
    cells[label] = {}
    const arr = groups[label]
    days.forEach((day, i) => { cells[label][day] = arr.map(c => (c[i] && c[i].course) || '') })
  })
  return cells
}

async function fetchSettings() {
  try {
    const res = await axios.get(`${API_BASE}/duty/settings?mode=${dutyMode.value}`)
    settingsDays.value = (res.data.days && res.data.days.length) ? res.data.days : ['周一', '周二', '周三', '周四', '周五']
    settingsItems.value = res.data.items || []
  } catch (e) { console.error(e) }
}

// ==================== 模式：日常值日 / 大扫除（数据各自独立） ====================
const dutyModes = [
  { value: 'daily', label: '日常值日' },
  { value: 'big', label: '大扫除' },
]
const dutyMode = ref(localStorage.getItem('class-duty-mode') || 'daily')
function onDutyModeChange() {
  localStorage.setItem('class-duty-mode', dutyMode.value)
  reloadAll()
}
async function reloadAll() {
  await fetchSettings()
  // 静默加载：切换模式时不清空 loading 层，避免下方表格出现“加载中→内容”的闪动
  await Promise.all([loadActive(true), loadMaster(true)])
}

async function fetchAllStudents() {
  try {
    const res = await axios.get(`${API_BASE}/students`)
    allStudents.value = res.data.data || res.data
  } catch (e) { console.error(e) }
}

// 值日 cells 是 {项目:{星期:[人名]}} 对象，扫描其中所有人名，同步给学生管理
function syncCellsNames(cellsObj) {
  const names = []
  Object.values(cellsObj || {}).forEach(dayObj =>
    Object.values(dayObj || {}).forEach(list =>
      (list || []).forEach(n => n && names.push(String(n).trim()))
    )
  )
  syncStudentNames([...new Set(names)], {
    getKnown: () => allStudents.value,
    refresh: fetchAllStudents,
    notify: notifySuccess
  })
}

// ==================== 当前值日表 ====================
const activeCells = ref({})
const activeLoaded = ref(false)
const loadActive = async (silent = false) => {
  if (!silent) activeLoaded.value = false
  try {
    const res = await axios.get(`${API_BASE}/duty?mode=${dutyMode.value}`)
    activeCells.value = res.data.cells || {}
    syncCellsNames(activeCells.value) // 加载后检测未收录姓名
  } catch (e) { console.error(e) } finally { activeLoaded.value = true }
}
const dutyActiveRows = computed(() => buildGridRows(activeCells.value))

// ==================== 值日模板 ====================
const masterCells = ref({})
const masterLoaded = ref(false)
const loadMaster = async (silent = false) => {
  if (!silent) masterLoaded.value = false
  try {
    const res = await axios.get(`${API_BASE}/duty/template?mode=${dutyMode.value}`)
    masterCells.value = res.data.cells || {}
    syncCellsNames(masterCells.value) // 加载后检测未收录姓名
  } catch (e) { console.error(e) } finally { masterLoaded.value = true }
}
const dutyMasterRows = computed(() => buildGridRows(masterCells.value))

// ==================== 网格编辑回写 ====================
// 值日 cells 是 {项目:{星期:[人名]}} 对象，无法按行/列坐标拆格，因此用整块快照撤销：
// 每次编辑记录前后整块 cells，并附第一条差异的可读文案作通知条详情。
function diffCellsLabel(prev, next) {
  const items = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const it of items) {
    const pd = prev[it] || {}, nd = next[it] || {}
    const days = new Set([...Object.keys(pd), ...Object.keys(nd)])
    for (const day of days) {
      const pa = pd[day] || [], na = nd[day] || []
      const len = Math.max(pa.length, na.length)
      for (let k = 0; k < len; k++) {
        const a = pa[k] || '', b = na[k] || ''
        if (a !== b) return `${it}·${day}：「${a}」→「${b}」`
      }
    }
  }
  return ''
}
// 值日表格中出现的人名，若不在学生管理中，自动新增到学生（复用共享工具）
function syncNewNamesFromRows(newRows) {
  syncStudentNamesFromRows(newRows, {
    getKnown: () => allStudents.value,
    refresh: fetchAllStudents,
    notify: notifySuccess
  })
}

// GridView 保存/编辑单元格后会 emit 新的多行子行表格，按「项目名」分组回写
function makeCellsUpdate(cellsRef, persist, table) {
  return (newRows) => {
    syncNewNamesFromRows(newRows) // 输入的人名自动同步到学生管理
    const prev = JSON.parse(JSON.stringify(cellsRef.value))
    cellsRef.value = reconstructCells(newRows, settingsDays.value)
    const label = diffCellsLabel(prev, cellsRef.value)
    if (label) recordGridSnapshotUndo('值日表', table, prev, JSON.parse(JSON.stringify(cellsRef.value)), label)
    persist()
  }
}
const onActiveCellsUpdate = makeCellsUpdate(activeCells, persistActive, 'duty_layout')
const onMasterCellsUpdate = makeCellsUpdate(masterCells, persistMaster, 'duty_template')

// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销/重做值日（当前页，含当前+模板两张表）
useUndoShortcut('值日表', {
  onAfterUndo: async (label) => { await loadActive(true); await loadMaster(true); notifySuccess(label ? `已撤销：${label}` : '已撤销') },
  onAfterRedo: async (label) => { await loadActive(true); await loadMaster(true); notifySuccess(label ? `已重做：${label}` : '已重做') }
})

async function persistActive() {
  try { await axios.put(`${API_BASE}/duty`, { cells: activeCells.value, mode: dutyMode.value }) }
  catch (e) { notifyError('保存失败'); console.error(e) }
}

// 智能排表确认：写回当前值日表（当前模式）
function onArrangeConfirm({ cells }) {
  if (!cells || !Object.keys(cells).length) { notifyError('请先点击「开始排表」生成结果'); return }
  activeCells.value = cells
  persistActive()
  arrangeVisible.value = false
  notifySuccess('已应用智能排表')
}
async function persistMaster() {
  try { await axios.put(`${API_BASE}/duty/template`, { cells: masterCells.value, mode: dutyMode.value }) }
  catch (e) { notifyError('保存失败'); console.error(e) }
}

// ==================== 行/列拖拽 & 删除（作用于设置） ====================
function persistSettings(extra) {
  const tasks = [axios.put(`${API_BASE}/duty/settings`, { days: settingsDays.value, items: settingsItems.value, mode: dutyMode.value })]
  if (extra && extra.active !== undefined) tasks.push(axios.put(`${API_BASE}/duty`, { cells: activeCells.value, mode: dutyMode.value }))
  if (extra && extra.master !== undefined) tasks.push(axios.put(`${API_BASE}/duty/template`, { cells: masterCells.value, mode: dutyMode.value }))
  return Promise.all(tasks)
}

function swapItems(oldIndex, newIndex) {
  const arr = [...settingsItems.value]
  const [moved] = arr.splice(oldIndex, 1)
  arr.splice(newIndex, 0, moved)
  settingsItems.value = arr
  persistSettings()
}

function swapDays(oldIndex, newIndex) {
  const arr = [...settingsDays.value]
  const [tmp] = [arr[oldIndex]]; arr[oldIndex] = arr[newIndex]; arr[newIndex] = tmp
  settingsDays.value = arr
  persistSettings()
}

function deleteItem(itemName) {
  if (!confirm(`确定删除劳动项目「${itemName}」及其值日安排吗？`)) return
  settingsItems.value = settingsItems.value.filter(it => it.name !== itemName)
  delete activeCells.value[itemName]
  delete masterCells.value[itemName]
  persistSettings({ active: true, master: true }).then(() => notifySuccess('已删除'))
}

// ==================== 保存设置 ====================
async function saveSettings({ days, items }) {
  settingsDays.value = days
  settingsItems.value = items
  pruneCells(activeCells.value)
  pruneCells(masterCells.value)
  try {
    await persistSettings({ active: true, master: true })
    settingsVisible.value = false
    notifySuccess('设置已保存')
  } catch (e) { notifyError('保存失败'); console.error(e) }
}

function pruneCells(cells) {
  const itemNameSet = new Set(settingsItems.value.map(it => it.name))
  for (const itemName of Object.keys(cells)) {
    if (!itemNameSet.has(itemName)) { delete cells[itemName]; continue }
    for (const day of Object.keys(cells[itemName])) {
      if (!settingsDays.value.includes(day)) delete cells[itemName][day]
    }
  }
}

// ==================== 刷新 / 从模板导入 ====================
async function refreshActive() { await loadActive(true); notifySuccess('已刷新值日表') }
async function refreshMaster() { await loadMaster(true); notifySuccess('已刷新值日表模板') }

async function applyMasterToActive() {
  if (!confirm('确定用模板覆盖当前值日表吗？')) return
  try {
    const before = JSON.parse(JSON.stringify(activeCells.value))
    await axios.post(`${API_BASE}/duty/apply-master?mode=${dutyMode.value}`)
    await loadActive()
    recordGridSnapshotUndo('值日表', 'duty_layout', before, JSON.parse(JSON.stringify(activeCells.value)), '从模板导入')
    notifySuccess('已应用模板')
  } catch (e) { notifyError('应用失败'); console.error(e) }
}

// ==================== 导出（列为劳动项目 + 各星期） ====================
const exportFields = computed(() => [
  { name: '项目', label: '劳动项目' },
  ...settingsDays.value.map(d => ({ name: 'd_' + d, label: d }))
])

function buildExportRows(cells) {
  return settingsItems.value.map(it => {
    const row = { 项目: it.name }
    settingsDays.value.forEach(d => {
      const names = cells[it.name]?.[d]
      row['d_' + d] = Array.isArray(names) ? names.filter(Boolean).join('、') : (names || '')
    })
    return row
  })
}
const activeExportRows = computed(() => buildExportRows(activeCells.value))
const masterExportRows = computed(() => buildExportRows(masterCells.value))

// ==================== 历史记录 ====================
const historyWeeks = ref([])
const historyCurrentWeek = ref('')
const historySnapshot = ref(null)
const historyLoading = ref(false)
const historyItems = ref([])
const historyDays = ref([])
const historyCells = ref({})

const historyRows = computed(() => buildGridRows(historyCells.value, historyItems.value, historyDays.value, true))

async function fetchHistoryWeeks() {
  try {
    const res = await axios.get(`${API_BASE}/duty/history`)
    historyWeeks.value = res.data || []
    if (historyCurrentWeek.value && !historyWeeks.value.some(w => w.week_start === historyCurrentWeek.value)) {
      historyCurrentWeek.value = ''
    }
    if (!historyCurrentWeek.value && historyWeeks.value.length > 0) {
      historyCurrentWeek.value = historyWeeks.value[0].week_start
    }
    if (historyCurrentWeek.value) await loadHistorySnapshot()
  } catch (e) { console.error(e) }
}

async function loadHistorySnapshot() {
  if (!historyCurrentWeek.value) return
  historyLoading.value = true
  try {
    const res = await axios.get(`${API_BASE}/duty/history/${historyCurrentWeek.value}`)
    historySnapshot.value = res.data
    if (res.data) {
      const s = (res.data.settings && res.data.settings) || {}
      historyItems.value = s.items || []
      historyDays.value = (s.days && s.days.length) ? s.days : ['周一', '周二', '周三', '周四', '周五']
      historyCells.value = res.data.cells || {}
    } else {
      historyItems.value = []
      historyDays.value = []
      historyCells.value = {}
    }
  } catch (e) { console.error(e) } finally { historyLoading.value = false }
}

function getMonday(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  return new Date(d.setDate(diff))
}

async function captureHistorySnapshot() {
  try {
    const weekStart = getMonday(new Date()).toISOString().slice(0, 10)
    await axios.post(`${API_BASE}/duty/snapshot`, {
      week_start: weekStart,
      cells: activeCells.value,
      settings: { items: settingsItems.value, days: settingsDays.value }
    })
    notifySuccess('本周快照已保存')
    await fetchHistoryWeeks()
  } catch (e) { notifyError('保存失败'); console.error(e) }
}

watch(activeTab, (newTab) => { if (newTab === 'history') fetchHistoryWeeks() })

onMounted(async () => {
  await fetchSettings()
  await Promise.all([loadActive(), loadMaster(), fetchAllStudents()])
})
</script>