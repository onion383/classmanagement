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
        </div>

        <div v-else-if="activeTab === 'history'" class="relative">
          <Transition :name="slideDir">
            <div :key="historyCurrentWeek" class="history-content">
              <div v-if="historyLoading" class="skeleton-block"></div>
              <EmptySnapshot v-else-if="!historySnapshot" />
              <GridView v-else :col-headers="historyDays" :rows="historyRows" :hide-meta-columns="true" :show-row-number="true" row-header-label="劳动项目" :min-table-height="200" />
            </div>
          </Transition>
          <!-- 快照菜单栏：周切换 + 下拉框 + 保存/删除按钮，同处一条毛玻璃栏 -->
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
              >📸 保存本周快照</button>
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
      @cancel="arrangeVisible = false"
      @confirm="onArrangeConfirm"
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
const ExportExcel = defineAsyncComponent(() => import('../components/import-export/ExportExcel.vue'))
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'))

const API_BASE = '/api'
const { success: notifySuccess, error: notifyError } = useNotification()

const activeTab = ref('manage')
const settingsVisible = ref(false)
const arrangeVisible = ref(false)
// 智能排表目标：'active' 当前值日 / 'master' 值日模板
const arrangeTarget = ref('active')
function openArrange(target) {
  arrangeTarget.value = target
  arrangeVisible.value = true
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
    await axios.delete(`${API_BASE}/duty/history/${week}`)
    notifySuccess('该周快照已删除')
    if (historyCurrentWeek.value === week) historySnapshot.value = null
    await fetchHistoryWeeks()
  } catch (e) {
    notifyError('删除快照失败，请重试'); console.error(e)
  }
}

watch(activeTab, (newTab) => { if (newTab === 'history') fetchHistoryWeeks() })

onMounted(async () => {
  await fetchSettings()
  await Promise.all([loadActive(), loadMaster(), fetchAllStudents()])
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
</style>