<template>
  <div>
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-5 py-3 border border-border min-h-[4.5rem] flex items-center">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="seat" /> 座位管理</h1>
    </div>

    <Tabs :tabs="tabItems" v-model="activeTab">
      <template #default="{ activeTab }">
        <div v-if="activeTab === 'seat'">
          <section class="mb-4">
            <!-- 子标题 + 视图切换：临时表（当前座位）/ 模板表（座位模板） -->
            <div class="mb-4 flex items-center gap-3">
              <h2 class="text-xl font-semibold text-text flex items-center gap-2 min-h-7"><IconGlyph name="seat" :size="20" /> 座位表</h2>
              <ViewSwitch v-model="seatView" :options="seatViewOptions" />
            </div>

            <!-- 工具栏：随切换段变化。两段均可「智能排表」「导入」，顺序与当前座位一致 -->
            <div class="mb-4 flex flex-wrap items-center gap-3 opbar">
              <button @click="openSettings(seatView)" v-preload="loadSettingsDialog" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="settings" :size="14" tint="current" /> 设置</button>
              <button @click="openArrangement(seatView)" v-preload="loadArrangementDialog" class="bg-primary text-text-inverse px-4 py-2 rounded">🧠 智能排表</button>
              <button @click="seatView === 'active' ? refreshActive() : refreshMaster()" class="bg-text-muted text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
              <button @click="openImport(seatView)" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="upload" :size="14" tint="current" /> {{ seatView === 'active' ? '从模板导入' : '从实行导入' }}</button>
              <button @click="seatView === 'active' ? openActiveExport() : openMasterExport()" class="bg-warning text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="download" :size="14" tint="current" /> 导出 Excel</button>
            </div>

            <!-- 临时表（当前座位） -->
            <template v-if="seatView === 'active'">
              <div v-if="!activeLoaded" class="skeleton-block"></div>
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
                candidateLabelField="姓名"
                candidatePlaceholder="输入姓名"
                :minTableHeight="200"
                @cell-dblclick="onActiveCellDblClick"
                @update:cells="onActiveCellsUpdate"
                @swapRows="onActiveSwapRows"
                @swapColumns="onActiveSwapColumns"
              />
              <ExportExcel v-if="activeExportMounted" :is-visible="activeExportVisible" :rows="activeExportRows" :fields="activeExportFields" defaultFilename="当前座位表" @update:is-visible="activeExportVisible = $event" />
            </template>

            <!-- 模板表（座位模板） -->
            <template v-else>
              <div v-if="!masterLoaded" class="skeleton-block"></div>
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
                candidateLabelField="姓名"
                candidatePlaceholder="输入姓名"
                :minTableHeight="200"
                @cell-dblclick="onMasterCellDblClick"
                @update:cells="onMasterCellsUpdate"
                @swapRows="onMasterSwapRows"
                @swapColumns="onMasterSwapColumns"
              />
              <ExportExcel v-if="masterExportMounted" :is-visible="masterExportVisible" :rows="masterExportRows" :fields="masterExportFields" defaultFilename="座位模板" @update:is-visible="masterExportVisible = $event" />
            </template>

            <!-- 座位位置权重表：与座位表同构，格内填数字权重（切换之外，只一张） -->
            <div class="mt-8 mb-4 flex items-center gap-3">
              <h2 class="text-xl font-semibold text-text flex items-center gap-2 min-h-7"><IconGlyph name="chart" :size="20" /> 座位位置权重表</h2>
            </div>

            <!-- 工具栏：权重表设置 / 刷新 / 导出 -->
            <div class="mb-4 flex flex-wrap items-center gap-3 opbar">
              <button @click="openWeightSettings()" v-preload="loadWeightAlgorithmDialog" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="settings" :size="14" tint="current" /> 设置</button>
              <button @click="refreshWeight()" class="bg-text-muted text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
              <button @click="openWeightExport()" class="bg-warning text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="download" :size="14" tint="current" /> 导出 Excel</button>
            </div>

            <div v-if="!weightLoaded" class="skeleton-block"></div>
            <GridView
              v-else
              :colHeaders="weightColHeaders"
              :rows="weightDisplayRows"
              :hideMetaColumns="true"
              :showRowNumber="true"
              :minTableHeight="200"
              candidatePlaceholder="输入权重"
              @update:cells="onWeightCellsUpdate"
              @swapRows="onWeightSwapRows"
              @swapColumns="onWeightSwapColumns"
            />
            <ExportExcel v-if="weightExportMounted" :is-visible="weightExportVisible" :rows="weightExportRows" :fields="weightExportFields" defaultFilename="座位位置权重表" @update:is-visible="weightExportVisible = $event" />
          </section>
        </div>

        <div v-else-if="activeTab === 'history'" class="relative">
          <!-- 座位指数（公平账本）：每人一根长条，按所坐位置权重逐天累加，截至所选周 -->
          <div v-if="historySnapshot" class="mb-8">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 class="text-xl font-semibold text-text flex items-center gap-2"><IconGlyph name="chart" :size="20" /> 座位指数</h2>
              <span class="text-xs text-text-muted">按每人所坐位置的权重逐天累加 · 截至 {{ historySnapDate || '—' }}</span>
            </div>
            <div class="bg-surface rounded-lg border border-border p-6">
              <div v-if="seatIndexRows.length" class="space-y-2.5">
                <div v-for="(row, idx) in seatIndexRows" :key="row.name" class="flex items-center gap-3">
                  <span class="w-20 text-sm text-text truncate text-right shrink-0">{{ row.name }}</span>
                  <div class="flex-1 h-5 bg-surface-hover rounded overflow-hidden">
                    <div class="h-full rounded bar-grow bg-primary" :style="{ width: seatIndexBarWidth(row) + '%', animationDelay: (idx * 90) + 'ms' }"></div>
                  </div>
                  <span class="w-14 text-sm font-bold text-right shrink-0 text-text">{{ row.value.toFixed(2) }}</span>
                </div>
              </div>
              <div v-else class="text-center text-text-muted py-8 text-sm">暂无座位指数数据</div>
            </div>
          </div>

          <!-- 座位记录：标题 + 菜单栏（设置 / 刷新 / 导出 Excel / 补录记录） -->
          <h2 class="text-xl font-semibold text-text flex items-center gap-2 min-h-7 mb-3"><IconGlyph name="calendar" :size="20" /> 座位记录</h2>
          <div class="mb-4 flex flex-wrap items-center gap-3 opbar">
            <button @click="openHistorySettings()" v-preload="loadSeatRecordSettingsDialog" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="settings" :size="14" tint="current" /> 设置</button>
            <button @click="refreshHistory()" class="bg-text-muted text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
            <button @click="openHistoryExport()" class="bg-warning text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="download" :size="14" tint="current" /> 导出 Excel</button>
            <button @click="openBackfill()" v-preload="loadSeatBackfillDialog" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="clock" :size="14" tint="current" /> 补录记录</button>
          </div>

          <Transition :name="slideDir">
            <div :key="historyCurrentWeek" class="history-content">
              <div v-if="historyLoading" class="skeleton-block"></div>
              <EmptySnapshot v-else-if="!historySnapshot" />
              <template v-else>
                <GridView :colHeaders="historyColHeaders" :rows="historyDisplayRows" :hideMetaColumns="true" :showRowNumber="true" />
                <p class="text-xs text-text-muted mt-2">代表日期：{{ historySnapDate || '—' }}</p>
              </template>
            </div>
          </Transition>
          <ExportExcel v-if="historyExportMounted" :is-visible="historyExportVisible" :rows="historyExportRows" :fields="historyExportFields" defaultFilename="座位记录" @update:is-visible="historyExportVisible = $event" />
          <!-- 快照菜单栏：周切换 + 下拉框 + 补存/删除按钮，同处一条毛玻璃栏 -->
          <WeekSwitcher
            v-model:currentWeek="historyCurrentWeek"
            :weeks="historyWeeks"
            @update:currentWeek="loadHistorySnapshot"
            @direction="onSwitchWeek"
          >
            <template #actions>
              <button
                @click="captureHistorySnapshot"
                class="bg-primary text-text-inverse px-3 py-1.5 rounded whitespace-nowrap cursor-pointer"
              >📸 补存已过日期</button>
              <button
                @click="requestDeleteHistorySnapshot"
                :disabled="!canDeleteHistorySnapshot"
                class="bg-danger text-text-inverse px-3 py-1.5 rounded whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >🗑 删除本周快照</button>
            </template>
          </WeekSwitcher>
        </div>
      </template>
    </Tabs>

    <!-- 当前座位设置弹窗 -->
    <SeatSettingsDialog
      v-if="activeSettingsMounted"
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
      v-if="masterSettingsMounted"
      :visible="masterSettingsVisible"
      :rows="masterRows"
      :cols="masterCols"
      :mode="masterMode"
      :showAisle="masterShowAisle"
      @save="saveMasterSettings"
      @cancel="masterSettingsVisible = false"
    />

    <!-- 座位范围缩小确认弹窗 -->
    <ConfirmDialog
      v-if="shrinkConfirmMounted"
      :visible="shrinkConfirmVisible"
      message="你设置了较小的座位范围，但是外部还有座位数据，需要舍弃吗"
      type="confirm"
      :showCancel="true"
      @confirm="confirmShrink"
      @cancel="shrinkConfirmVisible = false"
    />

    <!-- 删除历史快照确认弹窗 -->
    <ConfirmDialog
      v-if="deleteSnapshotMounted"
      :visible="deleteSnapshotVisible"
      title="删除历史快照"
      :message="deleteSnapshotMessage"
      type="confirm"
      :showCancel="true"
      confirmText="删除"
      @confirm="confirmDeleteHistorySnapshot"
      @cancel="deleteSnapshotVisible = false"
    />

    <!-- 导入确认弹窗（从模板导入 / 从实行导入，内置样式） -->
    <ConfirmDialog
      v-if="importConfirmMounted"
      :visible="importConfirmVisible"
      :title="importConfirmTitle"
      :message="importConfirmMessage"
      type="confirm"
      :showCancel="true"
      confirmText="确定导入"
      @confirm="confirmImport"
      @cancel="importConfirmVisible = false"
    />

    <!-- 智能排表弹窗（按 arrangeTarget 决定作用于当前座位或座位模板） -->
    <SmartArrangementDialog
      v-if="smartArrangementMounted"
      :visible="smartArrangementVisible"
      :rows="arrangeRows"
      :cols="arrangeCols"
      :mode="arrangeMode"
      :showAisle="arrangeShowAisle"
      :students="allStudents"
      :initial-seats="arrangeSeats"
      :weights="weightWeights"
      :ledger="seatLedger"
      @cancel="smartArrangementVisible = false"
      @confirm="applySmartArrangement"
    />

    <!-- 中心权重算法设置弹窗：生成权重矩阵并写回当前权重表 -->
    <WeightAlgorithmDialog
      v-if="weightAlgoMounted"
      :visible="weightAlgoVisible"
      :rows="weightRows"
      :cols="weightCols"
      @apply="onApplyWeightAlgorithm"
      @close="weightAlgoVisible = false"
    />

    <!-- 管理周座位记录弹窗：选择学期 + 周列表 + 删除 -->
    <SeatRecordSettingsDialog
      v-if="historySettingsMounted"
      :visible="historySettingsVisible"
      @close="historySettingsVisible = false"
    />

    <!-- 补录记录弹窗：周切换 + 增加周记录（周数与日期双向联动） -->
    <SeatBackfillDialog
      v-if="historyBackfillMounted"
      :visible="historyBackfillVisible"
      @close="historyBackfillVisible = false"
      @changed="onBackfillChanged"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, defineAsyncComponent } from 'vue'
import axios from 'axios'
import GridView from '../components/tables/GridView.vue'
import EmptySnapshot from '../components/base/EmptySnapshot.vue'
import Tabs from '../components/base/Tabs.vue'
import ViewSwitch from '../components/base/ViewSwitch.vue'
import WeekSwitcher from '../components/base/WeekSwitcher.vue'
import { useSeatGrid, buildSeatLikeRows, isAisleCol, getDisplayColCount } from '../composables/useSeatGrid.js'
import { useUndoShortcut, recordGridSnapshotUndo } from '../composables/useUndo.js'
import { useNotification } from '../composables/useNotification.js'
import { syncStudentNamesFromRows } from '../composables/useSyncStudentNames.js'

// 弹窗类组件懒加载：打开时才加载对应 chunk。loader 抽出为命名函数，
// 可用 v-preload="loadXxx" 在悬停按钮时预取，点击时即时弹出。
const ExportExcel = defineAsyncComponent(() => import('../components/import-export/ExportExcel.vue'))
const loadSettingsDialog = () => import('../components/dialogs/SeatSettingsDialog.vue')
const SeatSettingsDialog = defineAsyncComponent(loadSettingsDialog)
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'))
const loadArrangementDialog = () => import('../components/dialogs/SmartArrangementDialog.vue')
const SmartArrangementDialog = defineAsyncComponent(loadArrangementDialog)
const loadWeightAlgorithmDialog = () => import('../components/dialogs/WeightAlgorithmDialog.vue')
const WeightAlgorithmDialog = defineAsyncComponent(loadWeightAlgorithmDialog)
const loadSeatRecordSettingsDialog = () => import('../components/dialogs/SeatRecordSettingsDialog.vue')
const SeatRecordSettingsDialog = defineAsyncComponent(loadSeatRecordSettingsDialog)
const loadSeatBackfillDialog = () => import('../components/dialogs/SeatBackfillDialog.vue')
const SeatBackfillDialog = defineAsyncComponent(loadSeatBackfillDialog)

const API_BASE = '/api'

const activeTab = ref('seat')
const tabItems = [
  { label: '座位管理', value: 'seat' },
  { label: '历史记录', value: 'history' }
]

// 座位管理内部的视图切换：临时表（当前座位） / 模板表（座位模板）
const seatView = ref('active')
const seatViewOptions = [
  { value: 'active', label: '临时表' },
  { value: 'master', label: '模板表' }
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
const activeGrid = useSeatGrid(`${API_BASE}/seats`, {
  getStudentName, getStudentId,
  undo: { key: '座位表', table: 'seat_layout' },
  cellBase: `${API_BASE}/seats/cell`
})
const masterGrid = useSeatGrid(`${API_BASE}/seats/master`, {
  getStudentName, getStudentId,
  // 与当前座位共用同一撤销栈（页面只注册了 '座位表' 快捷键），使模板操作也可 Ctrl+Z 撤销
  undo: { key: '座位表', table: 'seat_template' },
  cellBase: `${API_BASE}/seats/master/cell`
})

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
const { success: notifySuccess, error: notifyError } = useNotification()

async function refreshActive() {
  try {
    await loadActive()
    notifySuccess('已刷新座位表')
  } catch (e) { /* 错误已在 load 内部处理 */ }
}

async function refreshMaster() {
  try {
    await loadMaster()
    notifySuccess('已刷新座位表模板')
  } catch (e) { /* 错误已在 load 内部处理 */ }
}
// ==================== 座位范围缩小确认 ====================
// 三张表（当前座位 / 座位模板 / 权重表）共用同一套「设置」（行列/模式/走廊）：
// 改任一处即同步套用到另一张座位表，并让权重表按新尺寸重整，保证权重对两表都可用。
// 当新的行数/列数比现状小，且被裁剪掉的区域里仍有座位数据（任一张表）时，弹确认框决定是否舍弃
const shrinkConfirmVisible = ref(false)
const shrinkPending = ref(null)
function hasTrimmedData(grid, { rows: nr, cols: nc }) {
  const cur = grid.seats.value
  const curRows = cur.length
  if (!curRows) return false
  const curCols = cur[0].length
  if (nr < curRows) {
    for (let r = nr; r < curRows; r++)
      for (let c = 0; c < curCols; c++)
        if (cur[r]?.[c] != null && cur[r][c] !== '') return true
  }
  if (nc < curCols) {
    for (let r = 0; r < curRows; r++)
      for (let c = nc; c < curCols; c++)
        if (cur[r]?.[c] != null && cur[r][c] !== '') return true
  }
  return false
}
// 把同一套设置套用到两张座位表，并让权重表按新尺寸重整后落库
async function applySharedSettings(settings) {
  await Promise.all([activeGrid.saveSettings(settings), masterGrid.saveSettings(settings)])
  resizeWeights()
  await saveWeight()
}
async function requestSaveSettings(settings) {
  if (hasTrimmedData(activeGrid, settings) || hasTrimmedData(masterGrid, settings)) {
    shrinkPending.value = settings
    shrinkConfirmVisible.value = true
  } else {
    await applySharedSettings(settings)
  }
}
function confirmShrink() {
  const s = shrinkPending.value
  shrinkConfirmVisible.value = false
  shrinkPending.value = null
  if (s) applySharedSettings(s)
}

const saveActiveSettings = (s) => requestSaveSettings(s)

const loadMaster = masterGrid.load
// 表格输入的人名同步到学生管理：包装 onCellsUpdate，先同步再转发给网格逻辑
const wrapCellsSync = (fn) => (newRows) => {
  syncStudentNamesFromRows(newRows, {
    getKnown: () => allStudents.value,
    refresh: fetchAllStudents,
    notify: notifySuccess
  })
  return fn(newRows)
}
const onMasterCellsUpdate = wrapCellsSync(masterGrid.onCellsUpdate)
const onMasterSwapRows = masterGrid.onSwapRows
const onMasterSwapColumns = masterGrid.onSwapColumns
const onMasterCellDblClick = masterGrid.onCellDblClick
const onActiveCellsUpdate = wrapCellsSync(activeGrid.onCellsUpdate)
const onActiveSwapRows = activeGrid.onSwapRows
const onActiveSwapColumns = activeGrid.onSwapColumns
const onActiveCellDblClick = activeGrid.onCellDblClick
const saveMasterSettings = (s) => requestSaveSettings(s)

function openSettings(target) {
  if (target === 'active') {
    activeSettingsVisible.value = true
  } else {
    masterSettingsVisible.value = true
  }
}

const smartArrangementVisible = ref(false)
// 智能排表目标：'active' 临时表（当前座位） / 'master' 模板表（座位模板）
const arrangeTarget = ref('active')
const arrangeRows = computed(() => (arrangeTarget.value === 'active' ? activeRows.value : masterRows.value))
const arrangeCols = computed(() => (arrangeTarget.value === 'active' ? activeCols.value : masterCols.value))
const arrangeMode = computed(() => (arrangeTarget.value === 'active' ? activeMode.value : masterMode.value))
const arrangeShowAisle = computed(() => (arrangeTarget.value === 'active' ? activeShowAisle.value : masterShowAisle.value))
const arrangeSeats = computed(() => (arrangeTarget.value === 'active' ? activeSeats.value : masterSeats.value))
function openArrangement(target) {
  arrangeTarget.value = target
  loadSeatLedger()
  smartArrangementVisible.value = true
}

// 导出弹窗可见状态（受控模式配合 v-if 实现懒加载）
const activeExportVisible = ref(false)
const masterExportVisible = ref(false)

// 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，保留退出动画
const activeSettingsMounted = ref(false)
const masterSettingsMounted = ref(false)
const shrinkConfirmMounted = ref(false)
const smartArrangementMounted = ref(false)
const activeExportMounted = ref(false)
const masterExportMounted = ref(false)
watch(() => activeSettingsVisible.value, v => { if (v) activeSettingsMounted.value = true })
watch(() => masterSettingsVisible.value, v => { if (v) masterSettingsMounted.value = true })
watch(() => shrinkConfirmVisible.value, v => { if (v) shrinkConfirmMounted.value = true })
watch(() => smartArrangementVisible.value, v => { if (v) smartArrangementMounted.value = true })
watch(() => activeExportVisible.value, v => { if (v) activeExportMounted.value = true })
watch(() => masterExportVisible.value, v => { if (v) masterExportMounted.value = true })

// 导出座位表：无座位数据时直接提示，不弹导出选项弹窗
function hasSeatData(seatRows) {
  return (seatRows || []).some(r => Array.isArray(r) && r.some(v => v !== null && v !== undefined && v !== ''))
}
function openActiveExport() {
  if (!hasSeatData(activeSeats.value)) return useNotification().info('暂无座位数据可导出')
  activeExportVisible.value = true
}
function openMasterExport() {
  if (!hasSeatData(masterSeats.value)) return useNotification().info('座位模板为空，无法导出')
  masterExportVisible.value = true
}

async function applySmartArrangement(result) {
  smartArrangementVisible.value = false
  const toMaster = arrangeTarget.value === 'master'
  const grid = toMaster ? masterGrid : activeGrid
  const undoTable = toMaster ? 'seat_template' : 'seat_layout'
  try {
    // 记录整块快照，撤销可一键恢复智能排表前的布局
    const before = (grid.seats.value || []).map(r => Array.isArray(r) ? [...r] : r)
    await grid.saveSeats(result.seats)
    recordGridSnapshotUndo('座位表', undoTable, before, result.seats, '智能排表')
    notifySuccess('已应用智能排表')
  } catch (e) {
    notifySuccess('应用失败')
  }
}

// 导入确认弹窗（从模板导入 / 从实行导入 共用内置样式）
const importConfirmVisible = ref(false)
const importConfirmMounted = ref(false)
const importConfirmAction = ref('active')
watch(() => importConfirmVisible.value, v => { if (v) importConfirmMounted.value = true })
const importConfirmTitle = computed(() => (importConfirmAction.value === 'master' ? '从实行导入' : '从模板导入'))
const importConfirmMessage = computed(() => (importConfirmAction.value === 'master'
  ? '确定用当前座位覆盖座位模板吗？覆盖后可用 Ctrl+Z 撤销。'
  : '确定用座位模板覆盖当前座位吗？覆盖后可用 Ctrl+Z 撤销。'))
function openImport(target) {
  importConfirmAction.value = target
  importConfirmVisible.value = true
}
function confirmImport() {
  importConfirmVisible.value = false
  if (importConfirmAction.value === 'master') doApplyActiveToMaster()
  else doApplyMasterToActive()
}

async function doApplyMasterToActive() {
  try {
    const before = (activeGrid.seats.value || []).map(r => Array.isArray(r) ? [...r] : r)
    await axios.post(`${API_BASE}/seats/apply-master`)
    await loadActive()
    const after = (activeGrid.seats.value || []).map(r => Array.isArray(r) ? [...r] : r)
    recordGridSnapshotUndo('座位表', 'seat_layout', before, after, '从模板导入')
    notifySuccess('已应用模板')
  } catch (e) { notifyError('应用失败'); console.error(e) }
}

// 反向：把当前座位（临时表）整块导入到座位模板（纯前端复制，无后端接口）
async function doApplyActiveToMaster() {
  try {
    const before = (masterGrid.seats.value || []).map(r => Array.isArray(r) ? [...r] : r)
    const src = (activeGrid.seats.value || []).map(r => Array.isArray(r) ? [...r] : r)
    // 同步尺寸与模式，使模板与当前座位完全一致
    masterGrid.rows.value = activeGrid.rows.value
    masterGrid.cols.value = activeGrid.cols.value
    masterGrid.mode.value = activeGrid.mode.value
    masterGrid.showAisle.value = activeGrid.showAisle.value
    await masterGrid.saveSeats(src)
    recordGridSnapshotUndo('座位表', 'seat_template', before, src, '从实行导入')
    notifySuccess('已从当前座位导入')
  } catch (e) { notifyError('导入失败'); console.error(e) }
}

// ==================== 座位位置权重表 ====================
// 外观与座位表同构（讲台行 + 走廊列），格内填数字权重，可编辑并持久化。
// 尺寸（行列/走廊）跟随当前显示段（临时表 / 模板表），权重单独存储为数字矩阵。
// 取值范围 0–1（小数），不可自定义。
const WEIGHT_MIN = 0
const WEIGHT_MAX = 1
const weightLoaded = ref(false)
const weightWeights = ref([]) // rows×cols 数字矩阵，null 表示空
// 座位指数账本：学生 id → 截至「今日之前」累计的座位权重（供「位置公平」排表使用）
const seatLedger = ref({})
const weightRows = computed(() => (seatView.value === 'active' ? activeRows.value : masterRows.value))
const weightCols = computed(() => (seatView.value === 'active' ? activeCols.value : masterCols.value))
const weightMode = computed(() => (seatView.value === 'active' ? activeMode.value : masterMode.value))
const weightShowAisle = computed(() => (seatView.value === 'active' ? activeShowAisle.value : masterShowAisle.value))
const weightColHeaders = computed(() => (seatView.value === 'active' ? activeColHeaders.value : masterColHeaders.value))
// 表内最大值：热力图按「当前表内最大值」做相对映射（表内最高值最深蓝）
const weightMax = computed(() => {
  let m = 0
  for (const row of weightWeights.value) {
    if (!Array.isArray(row)) continue
    for (const v of row) if (typeof v === 'number' && v > m) m = v
  }
  return m
})
// 蓝色热力：浅蓝(#EFF6FF) → 深蓝(#1E3A8A) 线性插值
function weightHeatRgb(t) {
  const k = Math.max(0, Math.min(1, t))
  const from = [239, 246, 255], to = [30, 58, 138]
  return from.map((f, i) => Math.round(f + (to[i] - f) * k))
}
// 依底色相对亮度自动切换文字色：深底白字、浅底深色字，保证可读性
function weightHeatFg(t) {
  const [r, g, b] = weightHeatRgb(t).map(v => v / 255)
  const lin = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L < 0.45 ? '#FFFFFF' : '#1E293B'
}
const weightDisplayRows = computed(() => buildSeatLikeRows(
  weightRows.value, weightCols.value, weightMode.value, weightShowAisle.value,
  (r, c) => {
    const w = weightWeights.value[r]?.[c]
    // 数字须以字符串传入，避免 0 被 GridView 的 `course || ''` 当空
    if (w == null || w === '') return { course: '' }
    const t = weightMax.value > 0 ? w / weightMax.value : 0
    return { course: String(w), extra: { _bg: `rgb(${weightHeatRgb(t).join(', ')})`, _fg: weightHeatFg(t) } }
  }
))

// 尺寸（当前显示段的行列）变化时，把权重矩阵规整到 rows×cols：保留重叠、超出截断、不足补 null
function resizeWeights() {
  const next = []
  for (let r = 0; r < weightRows.value; r++) {
    const row = []
    for (let c = 0; c < weightCols.value; c++) {
      const v = weightWeights.value[r]?.[c]
      row.push(v == null ? null : v)
    }
    next.push(row)
  }
  weightWeights.value = next
}
watch([weightRows, weightCols], resizeWeights)

async function loadWeight() {
  try {
    const res = await axios.get(`${API_BASE}/seats/weight`)
    weightWeights.value = res.data.weights || []
    weightLoaded.value = true
  } catch (e) { console.error(e) }
}

// 刷新权重表：重新从后端拉取权重矩阵（与其他两张表的「刷新」一致）
async function refreshWeight() {
  try {
    await loadWeight()
    notifySuccess('已刷新座位位置权重表')
  } catch (e) { /* 错误已在 load 内部处理 */ }
}

async function saveWeight() {
  try {
    await axios.put(`${API_BASE}/seats/weight`, {
      mode: weightMode.value,
      rows: weightRows.value,
      cols: weightCols.value,
      weights: weightWeights.value,
      settings: { showAisle: weightShowAisle.value }
    })
  } catch (e) { console.error(e) }
}

// 编辑/交换单元格：跳过讲台行与走廊列，空或非数字 → null，其余转数字存储
function onWeightCellsUpdate(newRows) {
  const prev = weightWeights.value.map(r => [...r])
  const next = []
  for (const row of newRows) {
    if (row._isPodium) continue
    const rowVals = []
    for (let d = 0; d < row.cells.length; d++) {
      if (isAisleCol(d, weightCols.value, weightMode.value, weightShowAisle.value)) continue
      const raw = row.cells[d]?.course
      const text = (raw == null ? '' : String(raw)).trim()
      const num = text === '' ? null : Number(text)
      // 限定 0–1：非数字记空，超范围收窄到边界
      rowVals.push(Number.isFinite(num) ? Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, num)) : null)
    }
    next.push(rowVals)
  }
  weightWeights.value = next
  recordGridSnapshotUndo('座位表', 'seat_weight', prev, next, '编辑权重')
  saveWeight()
}

function onWeightSwapRows(fromIdx, toIdx) {
  if (fromIdx === 0 || toIdx === 0) return
  const from = fromIdx - 1, to = toIdx - 1
  if (from < 0 || to < 0 || from >= weightWeights.value.length || to >= weightWeights.value.length) return
  const prev = weightWeights.value.map(r => [...r])
  const next = weightWeights.value.map(r => [...r])
  ;[next[from], next[to]] = [next[to], next[from]]
  weightWeights.value = next
  recordGridSnapshotUndo('座位表', 'seat_weight', prev, next, '交换行')
  saveWeight()
}

function onWeightSwapColumns(fromDisplayIdx, toDisplayIdx) {
  const cols = weightCols.value, mode = weightMode.value, showAisle = weightShowAisle.value
  const total = getDisplayColCount(cols, mode, showAisle)
  const map = []
  let real = 0
  for (let d = 0; d < total; d++) map[d] = isAisleCol(d, cols, mode, showAisle) ? -1 : real++
  const from = map[fromDisplayIdx], to = map[toDisplayIdx]
  if (from === -1 || to === -1 || from == null || to == null || from === to) return
  const prev = weightWeights.value.map(r => [...r])
  const next = weightWeights.value.map(r => {
    const nr = [...r]
    ;[nr[from], nr[to]] = [nr[to], nr[from]]
    return nr
  })
  weightWeights.value = next
  recordGridSnapshotUndo('座位表', 'seat_weight', prev, next, '交换列')
  saveWeight()
}

// ---------- 权重表导出 ----------
const weightExportVisible = ref(false)
const weightExportMounted = ref(false)
watch(() => weightExportVisible.value, v => { if (v) weightExportMounted.value = true })
const weightExportFields = computed(() => {
  const fields = [{ name: '行号' }]
  weightColHeaders.value.forEach(h => fields.push({ name: h }))
  return fields
})
const weightExportRows = computed(() => {
  const headers = weightColHeaders.value
  return weightDisplayRows.value.map(row => {
    if (row._isPodium) return { '行号': '讲台', _isPodium: true, label: '讲  台' }
    const obj = { '行号': row.label }
    row.cells.forEach((cell, idx) => {
      const headerName = headers[idx] || `列${idx + 1}`
      if (cell._isAisle || cell._isAisleHidden) { obj[headerName] = '走廊'; obj._aisleCell = true }
      else obj[headerName] = cell.course || ''
    })
    return obj
  })
})
function openWeightExport() {
  const hasData = weightWeights.value.some(r => Array.isArray(r) && r.some(v => v != null && v !== ''))
  if (!hasData) return useNotification().info('暂无权重数据可导出')
  weightExportVisible.value = true
}

// ---------- 中心权重算法设置弹窗 ----------
const weightAlgoVisible = ref(false)
const weightAlgoMounted = ref(false)
watch(() => weightAlgoVisible.value, v => { if (v) weightAlgoMounted.value = true })
function openWeightSettings() { weightAlgoVisible.value = true }

// 算法产出的权重矩阵写回权重表（并记录撤销）
function onApplyWeightAlgorithm(matrix) {
  const prev = weightWeights.value.map(r => [...r])
  weightWeights.value = matrix
  recordGridSnapshotUndo('座位表', 'seat_weight', prev, matrix, '生成中心权重')
  saveWeight()
  weightAlgoVisible.value = false
  notifySuccess('已生成并应用中心权重')
}

// ==================== 历史记录 ====================
const historyWeeks = ref([])
const historyCurrentWeek = ref('')
const historySnapshot = ref(null)
const historyData = ref({ mode: 'single', rows: 0, cols: 0, seats: [], showAisle: true })
const historyLoading = ref(false)
// 当前回看快照的代表日期（该周最后一天），以及座位指数所需的按天快照序列
const historySnapDate = ref('')
const seatIndexDaily = ref([])
// 周切换滑动方向：上一周="prev" 从右滑入，下一周="next" 从左滑入（应用于历史表格）
const slideDir = ref('next')
function onSwitchWeek(dir) { slideDir.value = dir }

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
      historySnapDate.value = res.data.snap_date || ''
      historyData.value = {
        mode: res.data.mode || 'single',
        rows: res.data.rows,
        cols: res.data.cols,
        seats: res.data.seats,
        showAisle: (res.data.settings && res.data.settings.showAisle) || false
      }
    } else {
      historySnapDate.value = ''
      historyData.value = { mode: 'single', rows: 0, cols: 0, seats: [], showAisle: false }
    }
  } catch (e) { console.error(e) } finally { historyLoading.value = false }
  await loadSeatIndex()
}

// ==================== 座位指数（公平账本） ====================
// 结算口径：一天一个座位权重，把「截至所选周」之间每人坐过的位置权重逐天相加。
// 不做乘法：临时调换座位只需按当天快照结算，累加即可。
async function loadSeatIndex() {
  try {
    // 结算区间：从学期开始日到所选周代表日期（尊重「从开学日算起」的口径）
    let from = ''
    try {
      const s = await axios.get(`${API_BASE}/schedule/settings`)
      from = s.data.semester_start || ''
    } catch (_) { /* 后端未就绪时忽略 */ }
    const params = {}
    if (from) params.from = from
    if (historySnapDate.value) params.to = historySnapDate.value
    const res = await axios.get(`${API_BASE}/seats/daily`, { params })
    seatIndexDaily.value = res.data || []
  } catch (e) { console.error(e) }
}

// 载入「位置公平」所需账本：统计学期范围内、截至昨日每人累计的座位权重
async function loadSeatLedger() {
  try {
    const y = new Date(); y.setDate(y.getDate() - 1)
    const pad = n => String(n).padStart(2, '0')
    const to = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`
    let from = ''
    try {
      const s = await axios.get(`${API_BASE}/schedule/settings`)
      from = s.data.semester_start || ''
    } catch (_) { /* 后端未就绪时忽略 */ }
    const params = { to }
    if (from) params.from = from
    const res = await axios.get(`${API_BASE}/seats/daily`, { params })
    const led = {}
    for (const day of res.data || []) {
      const seats = day.seats || []
      for (let r = 0; r < seats.length; r++) {
        const wRow = weightWeights.value[r]
        if (!Array.isArray(wRow)) continue
        const sRow = seats[r] || []
        for (let c = 0; c < sRow.length; c++) {
          const val = sRow[c]
          if (typeof val !== 'number') continue
          const w = wRow[c]
          if (typeof w !== 'number') continue
          led[val] = (led[val] || 0) + w
        }
      }
    }
    seatLedger.value = led
  } catch (e) { console.error(e) }
}

// 逐天累加：对每一天的每个座位，取 weightWeights[r][c] 累加到该学生名下
const seatIndexRows = computed(() => {
  const weights = weightWeights.value
  if (!Array.isArray(weights) || !seatIndexDaily.value.length) return []
  const acc = {}
  for (const day of seatIndexDaily.value) {
    const seats = day.seats || []
    for (let r = 0; r < seats.length; r++) {
      const wRow = weights[r]
      const sRow = seats[r]
      if (!Array.isArray(wRow) || !Array.isArray(sRow)) continue
      for (let c = 0; c < sRow.length; c++) {
        const val = sRow[c]
        if (val === null || val === undefined || val === '') continue
        const w = wRow[c]
        if (typeof w !== 'number') continue
        const name = typeof val === 'number' ? getStudentName(val) : val
        if (!name) continue
        acc[name] = (acc[name] || 0) + w
      }
    }
  }
  const rows = Object.keys(acc).map(name => ({ name, value: acc[name] })).filter(r => r.value !== 0)
  rows.sort((a, b) => b.value - a.value)
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 0)
  rows.forEach(r => { r._max = max || 1 })
  return rows
})

function seatIndexBarWidth(row) {
  return Math.round((Math.abs(row.value) / row._max) * 100)
}

// 补存已过日期：仅补齐「今天之前」缺失的历史快照（今天由启动时的静默补存负责）
async function captureHistorySnapshot() {
  try {
    const res = await axios.post(`${API_BASE}/seats/snapshot/backfill`, { includeToday: false })
    const n = res.data && res.data.inserted
    if (n > 0) notifySuccess(`已补存 ${n} 天的历史快照`)
    else useNotification().info((res.data && res.data.message) || '暂无需要补存的日期')
    await fetchHistoryWeeks()
  } catch (e) { notifyError('补存失败'); console.error(e) }
}

// ==================== 删除历史快照 ====================
// 删除的是当前下拉框选中的那一周（也就是正在看的那份快照）
const deleteSnapshotVisible = ref(false)
const deleteSnapshotMounted = ref(false)
// 首次打开才挂载弹窗（保持与其它懒加载弹窗一致的保活方式）
watch(() => deleteSnapshotVisible.value, v => { if (v) deleteSnapshotMounted.value = true })
const canDeleteHistorySnapshot = computed(() =>
  !!historyCurrentWeek.value && historyWeeks.value.some(w => w.week_start === historyCurrentWeek.value)
)
const deleteSnapshotMessage = computed(() => {
  const w = historyCurrentWeek.value
  if (!w) return ''
  const start = new Date(w)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return `确定删除 ${start.toISOString().slice(0, 10)} ~ ${end.toISOString().slice(0, 10)} 的历史快照吗？删除后不可恢复。`
})
function requestDeleteHistorySnapshot() {
  if (!canDeleteHistorySnapshot.value) return
  deleteSnapshotVisible.value = true
}
async function confirmDeleteHistorySnapshot() {
  deleteSnapshotVisible.value = false
  const week = historyCurrentWeek.value
  if (!week) return
  try {
    await axios.delete(`${API_BASE}/seats/history/${week}`)
    notifySuccess('该周快照已删除')
    if (historyCurrentWeek.value === week) historySnapshot.value = null
    await fetchHistoryWeeks()
  } catch (e) {
    notifyError('删除快照失败，请重试')
  }
}

// ==================== 座位记录：设置 / 补录 / 导出 / 刷新 ====================
const historySettingsVisible = ref(false)
const historySettingsMounted = ref(false)
watch(() => historySettingsVisible.value, v => { if (v) historySettingsMounted.value = true })
const historyBackfillVisible = ref(false)
const historyBackfillMounted = ref(false)
watch(() => historyBackfillVisible.value, v => { if (v) historyBackfillMounted.value = true })

function openHistorySettings() { historySettingsVisible.value = true }
function openBackfill() { historyBackfillVisible.value = true }
async function refreshHistory() {
  try {
    await fetchHistoryWeeks()
    notifySuccess('已刷新座位记录')
  } catch (e) { /* 错误已在 load 内部处理 */ }
}
// 补录完成后重新拉取周列表（保持当前选中周不变）
function onBackfillChanged() { fetchHistoryWeeks() }

// ---------- 座位记录导出 ----------
const historyExportVisible = ref(false)
const historyExportMounted = ref(false)
watch(() => historyExportVisible.value, v => { if (v) historyExportMounted.value = true })
const historyExportFields = computed(() => {
  const fields = [{ name: '行号' }]
  historyColHeaders.value.forEach(h => fields.push({ name: h }))
  return fields
})
const historyExportRows = computed(() => {
  const headers = historyColHeaders.value
  return historyDisplayRows.value.map(row => {
    const obj = { '行号': row.label }
    row.cells.forEach((cell, idx) => {
      const headerName = headers[idx] || `列${idx + 1}`
      if (cell._isAisle || cell._isAisleHidden) { obj[headerName] = '走廊'; obj._aisleCell = true }
      else obj[headerName] = cell.course || ''
    })
    return obj
  })
})
function openHistoryExport() {
  if (!historySnapshot.value || !historyDisplayRows.value.length) return useNotification().info('暂无座位记录可导出')
  historyExportVisible.value = true
}

watch(activeTab, (newTab) => { if (newTab === 'history') fetchHistoryWeeks() })

// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销/重做座位（当前页）
useUndoShortcut('座位表', {
  onAfterUndo: async (label) => { await Promise.all([loadActive(), loadMaster(), loadWeight()]); notifySuccess(label ? `已撤销：${label}` : '已撤销') },
  onAfterRedo: async (label) => { await Promise.all([loadActive(), loadMaster(), loadWeight()]); notifySuccess(label ? `已重做：${label}` : '已重做') }
})

onMounted(async () => {
  await Promise.all([loadActive(), loadMaster(), loadWeight()])
  // 统一三张表设置：以当前座位（临时表）为准。若座位模板存在超出该范围的座位数据，
  // 暂不同步，交由用户通过「设置」确认后再统一（避免静默丢弃模板数据）。
  const s = { rows: activeRows.value, cols: activeCols.value, mode: activeMode.value, showAisle: activeShowAisle.value }
  const differ = masterRows.value !== s.rows || masterCols.value !== s.cols || masterMode.value !== s.mode || masterShowAisle.value !== s.showAisle
  if (differ && !hasTrimmedData(masterGrid, s)) await applySharedSettings(s)
  fetchAllStudents()
  // 启动时静默补全历史快照（今天及之前），失败不打扰用户
  axios.post(`${API_BASE}/seats/snapshot/backfill`, { includeToday: true }).catch(() => {})
})
</script>

<style scoped>
/* 历史表格周切换滑动动画：新旧表同向并行滑动（推拉感），不影响 WeekSwitcher */
.history-content { width: 100%; }
.next-enter-active, .next-leave-active,
.prev-enter-active, .prev-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
/* 退场表绝对定位到容器顶部，与进场表重叠实现并行滑动 */
.next-leave-active, .prev-leave-active {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}
/* 下一周：向右推进（新表从左侧跟进向右移动，旧表向右滑出，同方向） */
.next-enter-from { transform: translateX(-60px); opacity: 0; }
.next-leave-to   { transform: translateX(60px); opacity: 0; }
/* 上一周：向左推进（新表从右侧跟进向左移动，旧表向左滑出，同方向） */
.prev-enter-from { transform: translateX(60px); opacity: 0; }
.prev-leave-to   { transform: translateX(-60px); opacity: 0; }

/* 座位指数柱状图：从左往右非线性生长进场动画（与加分统计一致） */
.bar-grow {
  transform-origin: left center;
  animation: score-bar-grow 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes score-bar-grow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
</style>
