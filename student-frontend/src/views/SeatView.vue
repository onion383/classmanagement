<template>
  <div>
    <div class="w-full bg-gradient-to-r from-blue-80 to-blue-100 shadow-md rounded-xl mb-6 px-6 py-5">
      <h1 class="text-2xl font-bold text-gray-800">🪑 座位管理</h1>
    </div>

    <Tabs :tabs="tabItems" v-model="activeTab">
      <template #default="{ activeTab }">
        <div v-if="activeTab === 'seat'">
          <section class="mb-4">
            <h2 class="text-xl font-semibold mb-4">🪑 当前座位</h2>
            <div class="mb-4 flex flex-wrap items-center gap-3">
              <button @click="openSettings('active')" class="bg-purple-500 text-white px-4 py-2 rounded">⚙️ 设置</button>
              <button @click="loadActive" class="bg-gray-500 text-white px-4 py-2 rounded">🔄 刷新</button>
              <button @click="applyMasterToActive" class="bg-green-500 text-white px-4 py-2 rounded">📥 从模板导入</button>
              <button @click="$refs.activeExportDialog.open()" class="bg-yellow-500 text-white px-4 py-2 rounded">📥 导出 Excel</button>
            </div>

            <div v-if="!activeLoaded" class="text-center py-10 text-gray-500">加载中...</div>
            <GridView
              v-else
              ref="activeGridRef"
              :colHeaders="activeColHeaders"
              :rows="activeDisplayRows"
              :hideMetaColumns="true"
              :showRowNumber="true"
              :enableCandidate="true"
              :candidateItems="allStudents"
              :candidateExcludeIds="currentEditExcludeIds"
              :minTableHeight="200"
              @cell-dblclick="onActiveCellDblClick"
              @update:cells="onActiveCellsUpdate"
              @swapRows="onActiveSwapRows"
              @swapColumns="onActiveSwapColumns"
            />

            <ExportExcel ref="activeExportDialog" :rows="activeExportRows" :fields="activeExportFields" defaultFilename="当前座位表" />
          </section>

          <div class="mb-2"></div>

          <section>
            <h2 class="text-xl font-semibold mb-4">📋 座位模板</h2>
            <div class="mb-4 flex flex-wrap items-center gap-3">
              <button @click="openSettings('master')" class="bg-purple-500 text-white px-4 py-2 rounded">⚙️ 设置</button>
              <button @click="loadMaster" class="bg-gray-500 text-white px-4 py-2 rounded">🔄 刷新</button>
              <button @click="$refs.masterExportDialog.open()" class="bg-yellow-500 text-white px-4 py-2 rounded">📥 导出 Excel</button>
            </div>

            <div v-if="!masterLoaded" class="text-center py-10 text-gray-500">加载中...</div>
            <GridView
              v-else
              ref="masterGridRef"
              :colHeaders="masterColHeaders"
              :rows="masterDisplayRows"
              :hideMetaColumns="true"
              :showRowNumber="true"
              :enableCandidate="true"
              :candidateItems="allStudents"
              :candidateExcludeIds="currentMasterEditExcludeIds"
              :minTableHeight="200"
              @cell-dblclick="onMasterCellDblClick"
              @update:cells="onMasterCellsUpdate"
              @swapRows="onMasterSwapRows"
              @swapColumns="onMasterSwapColumns"
            />
            <ExportExcel ref="masterExportDialog" :rows="masterExportRows" :fields="masterExportFields" defaultFilename="座位模板" />
          </section>
        </div>

        <div v-else-if="activeTab === 'history'">
          <div v-if="historyLoading" class="text-center py-10">加载中...</div>
          <div v-else-if="!historySnapshot" class="text-center py-10 text-gray-500">该周暂无快照</div>
          <GridView v-else :colHeaders="historyColHeaders" :rows="historyDisplayRows" :hideMetaColumns="true" :showRowNumber="true" />
          <WeekSwitcher v-model:currentWeek="historyCurrentWeek" :weeks="historyWeeks" @update:currentWeek="loadHistorySnapshot" />
          <div class="text-center mt-4">
            <button @click="captureHistorySnapshot" class="bg-green-500 text-white px-4 py-2 rounded">📸 保存本周快照</button>
          </div>
        </div>
      </template>
    </Tabs>

    <!-- 当前座位设置弹窗 -->
    <SeatSettingsDialog
      :visible="activeSettingsVisible"
      :rows="activeRows"
      :cols="activeCols"
      :mode="activeMode"
      :showAisle="activeShowAisle"
      @save="saveActiveSettings"
      @cancel="activeSettingsVisible = false"
    />

    <!-- 座位模板设置弹窗 -->
    <SeatSettingsDialog
      :visible="masterSettingsVisible"
      :rows="masterRows"
      :cols="masterCols"
      :mode="masterMode"
      :showAisle="masterShowAisle"
      @save="saveMasterSettings"
      @cancel="masterSettingsVisible = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import axios from 'axios'
import GridView from '../components/GridView.vue'
import ExportExcel from '../components/ExportExcel.vue'
import Tabs from '../components/Tabs.vue'
import WeekSwitcher from '../components/WeekSwitcher.vue'
import SeatSettingsDialog from '../components/SeatSettingsDialog.vue'
import { useSeatGrid } from '../composables/useSeatGrid.js'

const API_BASE = '/api'

const activeTab = ref('seat')
const tabItems = [
  { label: '座位管理', value: 'seat' },
  { label: '历史记录', value: 'history' }
]

// ==================== 学生数据 ====================
const allStudents = ref([])
const studentMap = ref({})

function getStudentName(id) {
  return studentMap.value[id]?.姓名 || ''
}

function getStudentId(name) {
  if (!name) return null
  const student = allStudents.value.find(s => s.姓名 === name)
  return student ? student.id : null
}

async function fetchAllStudents() {
  try {
    const res = await axios.get(`${API_BASE}/students`)
    allStudents.value = res.data.data || res.data
    studentMap.value = {}
    allStudents.value.forEach(s => { studentMap.value[s.id] = s })
  } catch (e) { console.error(e) }
}

// ==================== 座位网格 ====================
const activeGrid = useSeatGrid(`${API_BASE}/seats`, { getStudentName, getStudentId })
const masterGrid = useSeatGrid(`${API_BASE}/seats/master`, { getStudentName, getStudentId })

// 保持模板兼容的别名
const activeLoaded = activeGrid.loaded
const activeRows = activeGrid.rows
const activeCols = activeGrid.cols
const activeSeats = activeGrid.seats
const activeMode = activeGrid.mode
const activeShowAisle = activeGrid.showAisle
const activeSettings = activeGrid.settings
const activeSettingsVisible = activeGrid.settingsVisible
const currentEditExcludeIds = activeGrid.currentEditExcludeIds
const activeColHeaders = activeGrid.colHeaders
const activeDisplayRows = activeGrid.displayRows
const activeExportFields = activeGrid.exportFields
const activeExportRows = activeGrid.exportRows

const masterLoaded = masterGrid.loaded
const masterRows = masterGrid.rows
const masterCols = masterGrid.cols
const masterSeats = masterGrid.seats
const masterMode = masterGrid.mode
const masterShowAisle = masterGrid.showAisle
const masterSettings = masterGrid.settings
const masterSettingsVisible = masterGrid.settingsVisible
const currentMasterEditExcludeIds = masterGrid.currentEditExcludeIds
const masterColHeaders = masterGrid.colHeaders
const masterDisplayRows = masterGrid.displayRows
const masterExportFields = masterGrid.exportFields
const masterExportRows = masterGrid.exportRows

// ==================== 方法别名 ====================
const loadActive = activeGrid.load
const onActiveCellsUpdate = activeGrid.onCellsUpdate
const onActiveSwapRows = activeGrid.onSwapRows
const onActiveSwapColumns = activeGrid.onSwapColumns
const onActiveCellDblClick = activeGrid.onCellDblClick
const saveActiveSettings = activeGrid.saveSettings

const loadMaster = masterGrid.load
const onMasterCellsUpdate = masterGrid.onCellsUpdate
const onMasterSwapRows = masterGrid.onSwapRows
const onMasterSwapColumns = masterGrid.onSwapColumns
const onMasterCellDblClick = masterGrid.onCellDblClick
const saveMasterSettings = masterGrid.saveSettings

function openSettings(target) {
  if (target === 'active') {
    activeSettingsVisible.value = true
  } else {
    masterSettingsVisible.value = true
  }
}

async function applyMasterToActive() {
  if (!confirm('确定用模板覆盖当前座位吗？')) return
  try {
    await axios.post(`${API_BASE}/seats/apply-master`)
    await loadActive()
  } catch (e) { alert('应用失败') }
}

// ==================== 历史记录 ====================
const historyWeeks = ref([])
const historyCurrentWeek = ref('')
const historySnapshot = ref(null)
const historyData = ref({ mode: 'single', rows: 0, cols: 0, seats: [], showAisle: true })
const historyLoading = ref(false)

const historyColHeaders = computed(() => {
  const { cols: c, mode: m, showAisle: sa } = historyData.value
  return activeGrid.generateColHeaders(c, m, sa)
})

const historyDisplayRows = computed(() => {
  const { seats: hSeats, rows: r, cols: c, mode: m, showAisle: sa } = historyData.value
  const displayCols = activeGrid.getDisplayColCount(c, m, sa)
  const result = []
  for (let row = 0; row < r; row++) {
    const rowCells = []
    let realCol = 0
    for (let d = 0; d < displayCols; d++) {
      if (activeGrid.isAisleCol(d, c, m, sa)) {
        if (row === 0) {
          rowCells.push({ course: '走廊', _isAisle: true, _aisleRowSpan: r, _isAisleHidden: false })
        } else {
          rowCells.push({ course: '', _isAisle: false, _isAisleHidden: true })
        }
      } else {
        const seatVal = hSeats[row]?.[realCol]
        let displayName = ''
        if (seatVal === null || seatVal === undefined) {
          displayName = ''
        } else if (typeof seatVal === 'number') {
          displayName = getStudentName(seatVal) || ''
        } else {
          displayName = seatVal
        }
        rowCells.push({ course: displayName, _isAisle: false, _isAisleHidden: false, _studentId: seatVal })
        realCol++
      }
    }
    result.push({ _rowKey: `row_${row}`, label: `第${row + 1}行`, cells: rowCells, _isReadonly: true, _lessonIdx: row, _periodRowSpan: 0, periodLabel: '' })
  }
  return result
})

async function fetchHistoryWeeks() {
  try {
    const res = await axios.get(`${API_BASE}/seats/history`)
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
    const res = await axios.get(`${API_BASE}/seats/history/${historyCurrentWeek.value}`)
    historySnapshot.value = res.data
    if (res.data) {
      historyData.value = {
        mode: res.data.mode || 'single',
        rows: res.data.rows,
        cols: res.data.cols,
        seats: res.data.seats,
        showAisle: (res.data.settings && res.data.settings.showAisle) || false
      }
    } else {
      historyData.value = { mode: 'single', rows: 0, cols: 0, seats: [], showAisle: false }
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
    await axios.post(`${API_BASE}/seats/snapshot`, {
      week_start: weekStart,
      mode: activeMode.value,
      rows: activeRows.value,
      cols: activeCols.value,
      seats: activeSeats.value,
      settings: { showAisle: activeShowAisle.value }
    })
    alert('本周快照已保存')
    await fetchHistoryWeeks()
  } catch (e) { alert('保存失败') }
}

watch(activeTab, (newTab) => { if (newTab === 'history') fetchHistoryWeeks() })

onMounted(() => {
  loadActive()
  loadMaster()
  fetchAllStudents()
})
</script>
