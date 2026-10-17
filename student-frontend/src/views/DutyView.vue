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
          <section class="mb-4">
            <!-- 子标题 + 视图切换：当前值日 / 值日模板 -->
            <div class="mb-4 flex items-center gap-3">
              <h2 class="text-xl font-semibold text-text flex items-center gap-2 min-h-7"><IconGlyph name="clipboard" :size="20" /> 值日表</h2>
              <ViewSwitch v-model="dutyView" :options="dutyViewOptions" />
            </div>

            <!-- 工具栏：随切换段变化。「设置」是天数/劳动项目的全局设置，两段都保留；
                 智能排表/导入 两段均可用，顺序与当前值日一致 -->
            <div class="mb-4 flex flex-wrap items-center gap-3 opbar">
              <button @click="settingsVisible = true" v-preload="loadSettingsDialog" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="settings" :size="14" tint="current" /> 设置</button>
              <button @click="openArrange(dutyView)" v-preload="loadArrangementDialog" class="bg-primary text-text-inverse px-4 py-2 rounded">🧠 智能排表</button>
              <button @click="dutyView === 'active' ? refreshActive() : refreshMaster()" class="bg-text-muted text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
              <button @click="openImport(dutyView)" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="download" :size="14" tint="current" /> {{ dutyView === 'active' ? '从模板导入' : '从实行导入' }}</button>
              <button @click="dutyView === 'active' ? openActiveExport() : openMasterExport()" class="bg-warning text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="download" :size="14" tint="current" /> 导出值日表</button>
            </div>

            <!-- 当前值日 -->
            <template v-if="dutyView === 'active'">
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
            </template>

            <!-- 值日模板 -->
            <template v-else>
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
            </template>
          </section>

          <!-- 值日项目权重表：与值日表同构（项目×星期），格内填数字权重，热力图展示 -->
          <section class="mb-4">
            <div class="mb-4 flex items-center gap-3">
              <h2 class="text-xl font-semibold text-text flex items-center gap-2 min-h-7"><IconGlyph name="chart" :size="20" /> 值日项目权重表</h2>
            </div>
            <div class="mb-4 flex flex-wrap items-center gap-3 opbar">
              <button @click="openWeightAlgo" v-preload="loadWeightAlgoDialog" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="settings" :size="14" tint="current" /> 设置</button>
              <button @click="refreshWeight()" class="bg-text-muted text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
              <button @click="openWeightExport()" class="bg-warning text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="download" :size="14" tint="current" /> 导出 Excel</button>
            </div>
            <div v-if="!weightLoaded" class="skeleton-block"></div>
            <GridView
              v-else
              :col-headers="settingsDays"
              :rows="weightDisplayRows"
              :hide-meta-columns="true"
              :show-row-number="true"
              :disable-row-drag="true"
              row-header-label="劳动项目"
              :enable-candidate="false"
              :min-table-height="200"
              @update:cells="onWeightCellsUpdate"
              @swap-rows="onWeightSwapRows"
              @swap-columns="onWeightSwapColumns"
            />
            <ExportExcel v-if="weightExportMounted" :is-visible="weightExportVisible" :rows="weightExportRows" :fields="exportFields" defaultFilename="值日项目权重表" @update:is-visible="weightExportVisible = $event" />
          </section>
        </div>

        <div v-else-if="activeTab === 'history'" class="relative">
          <!-- 值日指数（公平账本）：每人一根长条，按所做值日项目的权重逐天累加，截至所选周 -->
          <div v-if="historySnapshot" class="mb-8">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 class="text-xl font-semibold text-text flex items-center gap-2"><IconGlyph name="chart" :size="20" /> 值日指数</h2>
              <span class="text-xs text-text-muted">按每人所做值日项目的权重逐天累加 · 截至 {{ historySnapDate || '—' }}</span>
            </div>
            <div class="bg-surface rounded-lg border border-border p-6">
              <div v-if="dutyIndexRows.length" class="space-y-2.5">
                <div v-for="(row, idx) in dutyIndexRows" :key="row.name" class="flex items-center gap-3">
                  <span class="w-20 text-sm text-text truncate text-right shrink-0">{{ row.name }}</span>
                  <div class="flex-1 h-5 bg-surface-hover rounded overflow-hidden">
                    <div class="h-full rounded bar-grow bg-primary" :style="{ width: dutyIndexBarWidth(row) + '%', animationDelay: (idx * 90) + 'ms' }"></div>
                  </div>
                  <span class="w-14 text-sm font-bold text-right shrink-0 text-text">{{ row.value.toFixed(2) }}</span>
                </div>
              </div>
              <div v-else class="text-center text-text-muted py-8 text-sm">暂无值日指数数据</div>
            </div>
          </div>

          <!-- 值日记录：标题 + 菜单栏（设置 / 刷新 / 导出 Excel / 补录记录） -->
          <h2 class="text-xl font-semibold text-text flex items-center gap-2 min-h-7 mb-3"><IconGlyph name="calendar" :size="20" /> 值日记录</h2>
          <div class="mb-4 flex flex-wrap items-center gap-3 opbar">
            <button @click="openHistorySettings()" v-preload="loadDutyRecordSettingsDialog" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="settings" :size="14" tint="current" /> 设置</button>
            <button @click="refreshHistory()" class="bg-text-muted text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
            <button @click="openHistoryExport()" class="bg-warning text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="download" :size="14" tint="current" /> 导出 Excel</button>
            <button @click="openBackfill()" v-preload="loadDutyBackfillDialog" class="bg-primary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5"><IconGlyph name="clock" :size="14" tint="current" /> 补录记录</button>
          </div>

          <!-- 表格过渡容器：用 grid 把新旧表叠放同一格 → 容器高度取两者较大值，
               切换时下方操作栏不会因高度塌陷而跳动；横向 clip 掉平移溢出，避免横向滚动条 -->
          <div class="history-swap">
            <Transition :name="slideDir">
              <div :key="historyCurrentWeek" class="history-content">
                <div v-if="historyLoading" class="skeleton-block"></div>
                <EmptySnapshot v-else-if="!historySnapshot" />
                <GridView v-else :col-headers="historyDays" :rows="historyRows" :hide-meta-columns="true" :show-row-number="true" row-header-label="劳动项目" :min-table-height="200" />
              </div>
            </Transition>
          </div>
          <ExportExcel v-if="historyExportMounted" :is-visible="historyExportVisible" :rows="historyExportRows" :fields="historyExportFields" defaultFilename="值日记录" @update:is-visible="historyExportVisible = $event" />
          <!-- 快照菜单栏：周切换 + 下拉框 + 保存/删除按钮，同处一条毛玻璃栏 -->
          <WeekSwitcher
            v-model:currentWeek="historyCurrentWeek"
            :weeks="historyWeeks"
            @update:currentWeek="onWeekChange"
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
      :weights="dutyWeights"
      :ledger="dutyLedger"
      :draft="arrangeDraft"
      @cancel="arrangeVisible = false"
      @confirm="onArrangeConfirm"
      @save-draft="onSaveArrangeDraft"
      @clear-draft="onClearArrangeDraft"
    />

    <!-- 值日项目权重算法弹窗 -->
    <DutyWeightAlgorithmDialog
      v-if="weightAlgoMounted"
      :visible="weightAlgoVisible"
      :days="settingsDays"
      :items="settingsItems"
      @cancel="weightAlgoVisible = false"
      @apply="onApplyWeightAlgorithm"
    />
    <!-- 管理周值日记录弹窗：选择学期 + 周列表 + 删除 -->
    <DutyRecordSettingsDialog
      v-if="historySettingsMounted"
      :visible="historySettingsVisible"
      :mode="dutyMode"
      @close="historySettingsVisible = false"
    />

    <!-- 补录记录弹窗：周切换 + 增加周记录（周数与日期双向联动） -->
    <DutyBackfillDialog
      v-if="historyBackfillMounted"
      :visible="historyBackfillVisible"
      :mode="dutyMode"
      @close="historyBackfillVisible = false"
      @changed="onBackfillChanged"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, defineAsyncComponent } from 'vue'
import axios from 'axios'
import Tabs from '../components/base/Tabs.vue'
import ViewSwitch from '../components/base/ViewSwitch.vue'
import EmptySnapshot from '../components/base/EmptySnapshot.vue'
import GridView from '../components/tables/GridView.vue'
import WeekSwitcher from '../components/base/WeekSwitcher.vue'
import AppSelect from '../components/base/AppSelect.vue'
import { useNotification } from '../composables/useNotification.js'
import { useUndoShortcut, recordGridSnapshotUndo } from '../composables/useUndo.js'
import { syncStudentNamesFromRows, syncStudentNames } from '../composables/useSyncStudentNames.js'
import { createRowReuseCache } from '../utils/rowReuse.js'

// 弹窗类组件懒加载：打开时才加载对应 chunk。loader 抽出为命名函数，
// 可用 v-preload="loadXxx" 在悬停按钮时预取，点击时即时弹出。
const loadSettingsDialog = () => import('../components/dialogs/DutySettingsDialog.vue')
const DutySettingsDialog = defineAsyncComponent(loadSettingsDialog)
const loadArrangementDialog = () => import('../components/dialogs/DutyArrangementDialog.vue')
const DutyArrangementDialog = defineAsyncComponent(loadArrangementDialog)
const loadWeightAlgoDialog = () => import('../components/dialogs/DutyWeightAlgorithmDialog.vue')
const DutyWeightAlgorithmDialog = defineAsyncComponent(loadWeightAlgoDialog)
const ExportExcel = defineAsyncComponent(() => import('../components/import-export/ExportExcel.vue'))
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'))
const loadDutyRecordSettingsDialog = () => import('../components/dialogs/DutyRecordSettingsDialog.vue')
const DutyRecordSettingsDialog = defineAsyncComponent(loadDutyRecordSettingsDialog)
const loadDutyBackfillDialog = () => import('../components/dialogs/DutyBackfillDialog.vue')
const DutyBackfillDialog = defineAsyncComponent(loadDutyBackfillDialog)

const API_BASE = '/api'
const { success: notifySuccess, error: notifyError } = useNotification()

const activeTab = ref('manage')
const settingsVisible = ref(false)
const arrangeVisible = ref(false)
// 智能排表目标：'active' 当前值日 / 'master' 值日模板
const arrangeTarget = ref('active')
const arrangeDraft = ref({ exists: false })
async function openArrange(target) {
  arrangeTarget.value = target
  // 先加载账本（公平算法需要）和草稿
  await Promise.all([loadDutyLedger(), loadArrangeDraft()])
  arrangeVisible.value = true
}
async function loadArrangeDraft() {
  try {
    const res = await axios.get(`${API_BASE}/duty/draft?mode=${dutyMode.value}`)
    arrangeDraft.value = res.data || { exists: false }
  } catch (e) { arrangeDraft.value = { exists: false }; console.error(e) }
}
function onSaveArrangeDraft({ cells, conditions }) {
  axios.put(`${API_BASE}/duty/draft`, { cells, conditions, mode: dutyMode.value })
    .then(res => {
      arrangeDraft.value = { exists: true, cells, conditions, savedAt: res.data.savedAt }
      notifySuccess('草稿已保存')
    })
    .catch(e => { notifyError('保存草稿失败'); console.error(e) })
}
function onClearArrangeDraft() {
  axios.delete(`${API_BASE}/duty/draft`)
    .then(() => {
      arrangeDraft.value = { exists: false }
      notifySuccess('草稿已清除')
    })
    .catch(e => { notifyError('清除草稿失败'); console.error(e) })
}

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
const deleteSnapshotVisible = ref(false)
const deleteSnapshotMounted = ref(false)
watch(() => deleteSnapshotVisible.value, v => { if (v) deleteSnapshotMounted.value = true })
const tabItems = [
  { label: '值日管理', value: 'manage' },
  { label: '历史记录', value: 'history' }
]

// 值日管理内部的视图切换：当前值日 / 值日模板
const dutyView = ref('active')
const dutyViewOptions = [
  { value: 'active', label: '当前值日' },
  { value: 'master', label: '值日模板' }
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
  // 静默加载：切换模式时不清空 loading 层，避免下方表格出现"加载中→内容"的闪动
  await Promise.all([loadActive(true), loadMaster(true), loadWeight()])
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
// 行对象复用缓存：编辑一格时只重建真正变化的那一行，避免整表重画
const reuseActiveRows = createRowReuseCache()
const reuseMasterRows = createRowReuseCache()
const dutyActiveRows = computed(() => reuseActiveRows(buildGridRows(activeCells.value)))

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
const dutyMasterRows = computed(() => reuseMasterRows(buildGridRows(masterCells.value)))

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
    // 旧值会被整体替换为新对象，无需深拷贝即可作为撤销快照（recordGridSnapshotUndo 同步序列化，不受后续就地修改影响）
    const prev = cellsRef.value
    const next = reconstructCells(newRows, settingsDays.value)
    cellsRef.value = next
    const label = diffCellsLabel(prev, next)
    if (label) recordGridSnapshotUndo('值日表', table, prev, next, label)
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

// 智能排表确认：按目标写回当前值日表或值日模板（当前模式）
function onArrangeConfirm({ cells }) {
  if (!cells || !Object.keys(cells).length) { notifyError('请先点击「开始排表」生成结果'); return }
  const toMaster = arrangeTarget.value === 'master'
  const target = toMaster ? masterCells : activeCells
  const table = toMaster ? 'duty_template' : 'duty_layout'
  const before = JSON.parse(JSON.stringify(target.value))
  const next = JSON.parse(JSON.stringify(cells))
  target.value = next
  recordGridSnapshotUndo('值日表', table, before, next, '智能排表')
  if (toMaster) persistMaster(); else persistActive()
  arrangeVisible.value = false
  notifySuccess('已应用智能排表')
}
async function persistMaster() {
  try { await axios.put(`${API_BASE}/duty/template`, { cells: masterCells.value, mode: dutyMode.value }) }
  catch (e) { notifyError('保存失败'); console.error(e) }
}

// ==================== 行/列拖拽 & 删除（作用于设置） ====================
function persistSettings(extra) {
  // 单请求：后端 /duty/save 用一个事务依次写 duty_settings / duty_layout / duty_template，
  // 省去原先 3 个并发请求的往返与重复提交；active/master 仅在需要时附加。
  const payload = { days: settingsDays.value, items: settingsItems.value, mode: dutyMode.value }
  if (extra && extra.active !== undefined) payload.active = activeCells.value
  if (extra && extra.master !== undefined) payload.master = masterCells.value
  return axios.put(`${API_BASE}/duty/save`, payload)
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

// 导入确认弹窗（从模板导入 / 从实行导入 共用内置样式）
const importConfirmVisible = ref(false)
const importConfirmMounted = ref(false)
const importConfirmAction = ref('active')
watch(() => importConfirmVisible.value, v => { if (v) importConfirmMounted.value = true })
const importConfirmTitle = computed(() => (importConfirmAction.value === 'master' ? '从实行导入' : '从模板导入'))
const importConfirmMessage = computed(() => (importConfirmAction.value === 'master'
  ? '确定用当前值日表覆盖值日模板吗？覆盖后可用 Ctrl+Z 撤销。'
  : '确定用值日模板覆盖当前值日表吗？覆盖后可用 Ctrl+Z 撤销。'))
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
    const before = JSON.parse(JSON.stringify(activeCells.value))
    await axios.post(`${API_BASE}/duty/apply-master?mode=${dutyMode.value}`)
    await loadActive()
    recordGridSnapshotUndo('值日表', 'duty_layout', before, JSON.parse(JSON.stringify(activeCells.value)), '从模板导入')
    notifySuccess('已应用模板')
  } catch (e) { notifyError('应用失败'); console.error(e) }
}

// 反向：把当前值日表整块导入到值日模板（纯前端复制，无后端接口）
async function doApplyActiveToMaster() {
  try {
    const before = JSON.parse(JSON.stringify(masterCells.value))
    const next = JSON.parse(JSON.stringify(activeCells.value))
    masterCells.value = next
    recordGridSnapshotUndo('值日表', 'duty_template', before, next, '从实行导入')
    await persistMaster()
    notifySuccess('已从当前值日表导入')
  } catch (e) { notifyError('导入失败'); console.error(e) }
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

// 值日单元格里是否有实际安排（项目行始终存在，不能用行数判空）
function hasDutyData(cells) {
  return Object.values(cells || {}).some(byDay =>
    byDay && Object.values(byDay).some(v =>
      Array.isArray(v) ? v.some(Boolean) : String(v ?? '').trim() !== ''))
}
// 导出值日表：无数据时直接提示，不弹导出选项弹窗
function openActiveExport() {
  if (!hasDutyData(activeCells.value)) return useNotification().info('暂无值日数据可导出')
  activeExportVisible.value = true
}
function openMasterExport() {
  if (!hasDutyData(masterCells.value)) return useNotification().info('值日模板为空，无法导出')
  masterExportVisible.value = true
}

// ==================== 历史记录 ====================
const historyWeeks = ref([])
const historyCurrentWeek = ref('')
const historySnapshot = ref(null)
const historyLoading = ref(false)
// 周切换滑动方向：上一周="prev" 从右滑入，下一周="next" 从左滑入（应用于历史表格）
const slideDir = ref('next')
function onSwitchWeek(dir) { slideDir.value = dir }
const historyItems = ref([])
const historyDays = ref([])
const historyCells = ref({})
// 所选周代表日期（该周最后一天的快照日期），用于值日指数的"截至"日期显示
const historySnapDate = computed(() => {
  if (!historySnapshot.value) return ''
  return historySnapshot.value.snap_date || historyCurrentWeek.value
})

const historyRows = computed(() => buildGridRows(historyCells.value, historyItems.value, historyDays.value, true))

// ==================== 值日项目权重表 ====================
// 结构：{ 项目名: { 星期几: 权重值 } }。与值日表同构，供指数与权重公平算法使用。
const dutyWeights = ref({})
const weightLoaded = ref(false)
const WEIGHT_MIN = 0
const WEIGHT_MAX = 1
async function loadWeight() {
  weightLoaded.value = false
  try {
    const res = await axios.get(`${API_BASE}/duty/weight?mode=${dutyMode.value}`)
    const w = (res.data && res.data.weights) || {}
    if (Object.keys(w).length > 0) {
      dutyWeights.value = w
    } else {
      // 首次加载：用 items[].difficulty 铺出初始权重矩阵（整行同权重，按 difficulty）
      const init = {}
      settingsItems.value.forEach(it => {
        init[it.name] = {}
        const d = Number(it.difficulty)
        settingsDays.value.forEach(day => { init[it.name][day] = isNaN(d) ? 0.5 : d })
      })
      dutyWeights.value = init
    }
  } catch (e) { console.error(e) } finally { weightLoaded.value = true }
}
async function refreshWeight() {
  try { await loadWeight(); notifySuccess('已刷新值日项目权重表') } catch (_) { /* 已在 load 内处理 */ }
}
async function saveWeight() {
  try {
    await axios.put(`${API_BASE}/duty/weight`, { weights: dutyWeights.value, mode: dutyMode.value })
  } catch (e) { console.error(e) }
}
// 表内最大值：热力图按「当前表内最大值」做相对映射（表内最高值最深蓝）
const weightMax = computed(() => {
  let m = 0
  for (const item of Object.keys(dutyWeights.value)) {
    const days = dutyWeights.value[item] || {}
    for (const day of Object.keys(days)) {
      const v = days[day]
      if (typeof v === 'number' && v > m) m = v
    }
  }
  return m
})
// 蓝色热力：浅蓝(#EFF6FF) → 深蓝(#1E3A8A) 线性插值
function weightHeatRgb(t) {
  const k = Math.max(0, Math.min(1, t))
  const from = [239, 246, 255], to = [30, 58, 138]
  return from.map((f, i) => Math.round(f + (to[i] - f) * k))
}
function weightHeatFg(t) {
  const [r, g, b] = weightHeatRgb(t).map(v => v / 255)
  const lin = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L < 0.45 ? '#FFFFFF' : '#1E293B'
}
// 权重表的 GridView 行：与值日表同构（项目按 count 拆多子行），首子行跨行合并，
// 同一项目的所有子行共用相同权重值（count>1 时视觉上是一行大单元格）
const weightDisplayRows = computed(() => {
  const items = settingsItems.value
  const days = settingsDays.value
  const w = dutyWeights.value
  const rows = []
  items.forEach(it => {
    const n = Math.max(1, Number(it.count) || 1)
    for (let k = 0; k < n; k++) {
      const cells = days.map(day => {
        const raw = w[it.name]?.[day]
        const val = (raw == null || raw === '') ? '' : String(raw)
        const num = val === '' ? null : Number(val)
        if (num == null || !Number.isFinite(num)) return { course: val }
        const t = weightMax.value > 0 ? num / weightMax.value : 0
        return { course: val, extra: { _bg: `rgb(${weightHeatRgb(t).join(', ')})`, _fg: weightHeatFg(t) } }
      })
      rows.push({
        _rowKey: `w_${it.name}_${k}`,
        label: it.name,
        _isReadonly: false,
        _rowHeaderRowSpan: k === 0 ? n : 0,
        cells
      })
    }
  })
  return rows
})
// 编辑权重：把 GridView 的行还原回 {项目:{星期:数值}}，非数字/超范围做容错
function onWeightCellsUpdate(newRows) {
  const prev = JSON.parse(JSON.stringify(dutyWeights.value))
  const days = settingsDays.value
  const groups = {}
  newRows.forEach(row => {
    if (row.label && !row._isSeparator) {
      if (!groups[row.label]) groups[row.label] = []
      groups[row.label].push(row.cells)
    }
  })
  const next = {}
  Object.keys(groups).forEach(name => {
    next[name] = {}
    const arr = groups[name]
    days.forEach((day, i) => {
      // 取首子行的值（多子行共享同一权重）
      const raw = arr[0]?.[i]?.course
      const text = (raw == null ? '' : String(raw)).trim()
      const num = text === '' ? null : Number(text)
      next[name][day] = Number.isFinite(num) ? Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, num)) : 0
    })
  })
  dutyWeights.value = next
  recordGridSnapshotUndo('值日表', 'duty_weight', prev, next, '编辑权重')
  saveWeight()
}
function onWeightSwapRows(oldIndex, newIndex) {
  const arr = [...settingsItems.value]
  const [moved] = arr.splice(oldIndex, 1)
  arr.splice(newIndex, 0, moved)
  settingsItems.value = arr
  // 同时重排权重表中的项目顺序（用项目名映射，保持原有权重值）
  const prev = JSON.parse(JSON.stringify(dutyWeights.value))
  const next = {}
  arr.forEach(it => { next[it.name] = prev[it.name] || {} })
  dutyWeights.value = next
  persistSettings({ active: true, master: true })
  saveWeight()
}
function onWeightSwapColumns(oldIndex, newIndex) {
  const arr = [...settingsDays.value]
  const [tmp] = [arr[oldIndex]]; arr[oldIndex] = arr[newIndex]; arr[newIndex] = tmp
  settingsDays.value = arr
  // 同步交换所有权重项中的列
  const prev = JSON.parse(JSON.stringify(dutyWeights.value))
  const next = {}
  for (const item of Object.keys(prev)) {
    next[item] = {}
    for (let i = 0; i < arr.length; i++) {
      next[item][arr[i]] = prev[item][arr[i]]
    }
  }
  dutyWeights.value = next
  persistSettings({ active: true, master: true })
  saveWeight()
}

// ---------- 权重表导出 ----------
const weightExportVisible = ref(false)
const weightExportMounted = ref(false)
watch(() => weightExportVisible.value, v => { if (v) weightExportMounted.value = true })
const weightExportRows = computed(() => {
  return settingsItems.value.map(it => {
    const row = { 项目: it.name }
    settingsDays.value.forEach(d => {
      const v = dutyWeights.value[it.name]?.[d]
      row['d_' + d] = (v == null || v === '') ? '' : String(v)
    })
    return row
  })
})
function openWeightExport() {
  const hasData = Object.values(dutyWeights.value || {}).some(days =>
    days && Object.values(days).some(v => v != null && v !== ''))
  if (!hasData) return useNotification().info('暂无权重数据可导出')
  weightExportVisible.value = true
}

// ---------- 权重算法设置弹窗 ----------
const weightAlgoVisible = ref(false)
const weightAlgoMounted = ref(false)
watch(() => weightAlgoVisible.value, v => { if (v) weightAlgoMounted.value = true })
function openWeightAlgo() { weightAlgoVisible.value = true }
function onApplyWeightAlgorithm(weights) {
  const prev = JSON.parse(JSON.stringify(dutyWeights.value))
  dutyWeights.value = weights
  recordGridSnapshotUndo('值日表', 'duty_weight', prev, weights, '生成中心权重')
  saveWeight()
  weightAlgoVisible.value = false
  notifySuccess('已生成并应用权重')
}

// ==================== 值日指数（公平账本） ====================
// 逐天累加：对每一天的每个值日槽位，取 dutyWeights[项目][星期] 累加到该学生名下
const dutyIndexDaily = ref([])
async function loadDutyIndex() {
  if (!historyCurrentWeek.value) return
  try {
    const s = await axios.get(`${API_BASE}/schedule/settings`)
    const from = (s.data && s.data.semester_start) || ''
    const to = historySnapDate.value || ''
    const params = { mode: dutyMode.value }
    if (from) params.from = from
    if (to) params.to = to
    const res = await axios.get(`${API_BASE}/duty/daily`, { params })
    dutyIndexDaily.value = res.data || []
  } catch (e) { console.error(e) }
}
const dutyIndexRows = computed(() => {
  const weights = dutyWeights.value
  if (!weights || !dutyIndexDaily.value.length) return []
  const acc = {}
  for (const day of dutyIndexDaily.value) {
    const cells = day.cells || {}
    for (const item of Object.keys(cells)) {
      const days = cells[item] || {}
      for (const dayName of Object.keys(days)) {
        const names = days[dayName] || []
        const w = weights[item]?.[dayName]
        if (typeof w !== 'number') continue
        names.forEach(name => {
          if (!name) return
          acc[name] = (acc[name] || 0) + w
        })
      }
    }
  }
  const rows = Object.keys(acc).map(name => ({ name, value: acc[name] })).filter(r => r.value !== 0)
  rows.sort((a, b) => b.value - a.value)
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 0)
  rows.forEach(r => { r._max = max || 1 })
  return rows
})
function dutyIndexBarWidth(row) {
  return Math.round((Math.abs(row.value) / row._max) * 100)
}

// 载入「权重公平」所需账本：统计学期范围内、截至昨日每人累计的值日权重
const dutyLedger = ref({})
async function loadDutyLedger() {
  try {
    const y = new Date(); y.setDate(y.getDate() - 1)
    const pad = n => String(n).padStart(2, '0')
    const to = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`
    let from = ''
    try {
      const s = await axios.get(`${API_BASE}/schedule/settings`)
      from = s.data.semester_start || ''
    } catch (_) { /* 后端未就绪时忽略 */ }
    const params = { mode: dutyMode.value, to }
    if (from) params.from = from
    const res = await axios.get(`${API_BASE}/duty/daily`, { params })
    const weights = dutyWeights.value
    const led = {}
    for (const day of res.data || []) {
      const cells = day.cells || {}
      for (const item of Object.keys(cells)) {
        const days = cells[item] || {}
        for (const dayName of Object.keys(days)) {
          const names = days[dayName] || []
          const w = weights[item]?.[dayName]
          if (typeof w !== 'number') continue
          names.forEach(name => { if (name) led[name] = (led[name] || 0) + w })
        }
      }
    }
    dutyLedger.value = led
  } catch (e) { console.error(e) }
}

async function fetchHistoryWeeks(options = {}) {
  try {
    const res = await axios.get(`${API_BASE}/duty/history?mode=${dutyMode.value}`)
    historyWeeks.value = res.data || []
    if (historyCurrentWeek.value && !historyWeeks.value.some(w => w.week_start === historyCurrentWeek.value)) {
      historyCurrentWeek.value = ''
    }
    if (!historyCurrentWeek.value && historyWeeks.value.length > 0) {
      historyCurrentWeek.value = historyWeeks.value[0].week_start
    }
    if (historyCurrentWeek.value) await loadHistorySnapshot(options)
  } catch (e) { console.error(e) }
}

async function loadHistorySnapshot(options = {}) {
  if (!historyCurrentWeek.value) return
  // 静默刷新：跳过骨架屏切换，避免表格重建触发进场/生长动画，仅替换数据
  const silent = !!(options && options.silent)
  if (!silent) historyLoading.value = true
  try {
    const res = await axios.get(`${API_BASE}/duty/history/${historyCurrentWeek.value}?mode=${dutyMode.value}`)
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
    // 切换周后重新结算值日指数
    await loadDutyIndex()
  } catch (e) { console.error(e) } finally { if (!silent) historyLoading.value = false }
}

// 周切换：静默加载（不显示固定高度骨架屏），避免表格区高度先被 320px 占位撑高、
// 数据返回后又回弹，导致下方操作栏出现“往下闪一下”。滑动过渡动画照常由 key 变化触发。
function onWeekChange(week) {
  if (week) historyCurrentWeek.value = week
  loadHistorySnapshot({ silent: true })
}

function getMonday(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  return new Date(d.setDate(diff))
}

// 补存已过日期：仅补齐「今天之前」缺失的历史快照（今天由启动时的静默补存负责）
async function captureHistorySnapshot() {
  try {
    const res = await axios.post(`${API_BASE}/duty/snapshot/backfill`, { includeToday: false, mode: dutyMode.value })
    const n = res.data && res.data.inserted
    if (n > 0) notifySuccess(`已补存 ${n} 天的历史快照`)
    else useNotification().info((res.data && res.data.message) || '暂无需要补存的日期')
    await fetchHistoryWeeks()
  } catch (e) { notifyError('补存失败'); console.error(e) }
}

// 删除的是当前下拉框选中的那一周（也就是正在看的那份快照）
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
    await axios.delete(`${API_BASE}/duty/history/${week}?mode=${dutyMode.value}`)
    notifySuccess('该周快照已删除')
    if (historyCurrentWeek.value === week) historySnapshot.value = null
    await fetchHistoryWeeks()
  } catch (e) {
    notifyError('删除快照失败，请重试'); console.error(e)
  }
}

// ==================== 值日记录：设置 / 补录 / 导出 / 刷新 ====================
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
    // 静默刷新：只重取数据，不触发骨架屏/表格重建，避免重绘动画
    await fetchHistoryWeeks({ silent: true })
    notifySuccess('已刷新值日记录')
  } catch (e) { /* 错误已在 fetchHistoryWeeks 内部处理 */ }
}
// 补录完成后重新拉取周列表（保持当前选中周不变）
function onBackfillChanged() { fetchHistoryWeeks() }

// ---------- 值日记录导出（列为劳动项目 + 各星期，取当前所选周快照） ----------
const historyExportVisible = ref(false)
const historyExportMounted = ref(false)
watch(() => historyExportVisible.value, v => { if (v) historyExportMounted.value = true })
const historyExportFields = computed(() => [
  { name: '项目', label: '劳动项目' },
  ...historyDays.value.map(d => ({ name: 'd_' + d, label: d }))
])
const historyExportRows = computed(() => historyItems.value.map(it => {
  const row = { 项目: it.name }
  historyDays.value.forEach(d => {
    const names = historyCells.value[it.name]?.[d]
    row['d_' + d] = Array.isArray(names) ? names.filter(Boolean).join('、') : (names || '')
  })
  return row
}))
function openHistoryExport() {
  if (!historySnapshot.value || !historyExportRows.value.length) return useNotification().info('暂无值日记录可导出')
  historyExportVisible.value = true
}

watch(activeTab, (newTab) => { if (newTab === 'history') fetchHistoryWeeks() })

// 启动时静默补存：把今天及之前的快照补齐（失败静默，不影响正常使用）
async function silentBackfill() {
  try { await axios.post(`${API_BASE}/duty/snapshot/backfill`, { includeToday: true, mode: dutyMode.value }) }
  catch (_) { /* 静默失败 */ }
}

onMounted(async () => {
  await fetchSettings()
  await Promise.all([loadActive(), loadMaster(), fetchAllStudents(), loadWeight()])
  silentBackfill()
})
</script>

<style scoped>
/* 值日指数柱状图：从左往右非线性生长进场动画（与座位指数一致） */
.bar-grow {
  transform-origin: left center;
  animation: score-bar-grow 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes score-bar-grow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

/* 历史表格周切换滑动动画：新旧表同向并行滑动（推拉感），不影响 WeekSwitcher */
.history-content { width: 100%; }
/* 过渡容器：grid 叠放新旧表（同一格），容器高度取两者较大值，切换时高度不塌陷、下方操作栏不跳动；
   横向 clip 掉 translateX(±60px) 的溢出，避免出现横向滚动条；overflow-y 保持 visible 不误伤浮层 */
.history-swap { display: grid; grid-template-columns: minmax(0, 1fr); overflow-x: clip; overflow-y: visible; }
.history-swap > * { grid-area: 1 / 1; min-width: 0; }
.next-enter-active, .next-leave-active,
.prev-enter-active, .prev-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
/* 进场表置于上层：滑动时新表压在前，退场表在其下层 */
.next-enter-active, .prev-enter-active {
  position: relative;
  z-index: 1;
}
/* 下一周：向右推进（新表从左侧跟进向右移动，旧表向右滑出，同方向） */
.next-enter-from { transform: translateX(-60px); opacity: 0; }
.next-leave-to   { transform: translateX(60px); opacity: 0; }
/* 上一周：向左推进（新表从右侧跟进向左移动，旧表向左滑出，同方向） */
.prev-enter-from { transform: translateX(60px); opacity: 0; }
.prev-leave-to   { transform: translateX(-60px); opacity: 0; }
</style>