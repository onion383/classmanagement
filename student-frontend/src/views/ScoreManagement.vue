<template>
  <div>
    <!-- 页面标题 + 加分对象下拉 -->
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-5 py-3 border border-border min-h-[4.5rem] flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="score" /> 加分管理</h1>
      <div class="flex items-center gap-2">
        <span class="text-sm text-text-secondary">加分对象</span>
        <AppSelect v-model="scoreMode" :options="scoreModeOptions" class="w-32" />
      </div>
    </div>

    <!-- 切换栏 -->
    <Tabs :tabs="tabs" v-model="activeTab" />

    <!-- ==================== 今日加分 ==================== -->
    <div v-if="activeTab === 'today'">
      <!-- 数据看板 -->
      <div class="grid grid-cols-4 gap-4 mb-6">
        <div class="bg-surface shadow-md rounded-xl border border-border p-4">
          <div class="flex items-center gap-1.5 text-sm text-text-secondary">
            <span class="w-2 h-2 rounded-full bg-success inline-block"></span> {{ addPeopleLabel }}
          </div>
          <div class="text-2xl font-bold text-success">{{ todayAddPeople }} 人</div>
        </div>
        <div class="bg-surface shadow-md rounded-xl border border-border p-4">
          <div class="flex items-center gap-1.5 text-sm text-text-secondary">
            <span class="w-2 h-2 rounded-full bg-success inline-block"></span> 加分项目
          </div>
          <div class="text-2xl font-bold text-success">{{ todayAddItems }} 项</div>
        </div>
        <div class="bg-surface shadow-md rounded-xl border border-border p-4">
          <div class="flex items-center gap-1.5 text-sm text-text-secondary">
            <span class="w-2 h-2 rounded-full bg-danger inline-block"></span> {{ subPeopleLabel }}
          </div>
          <div class="text-2xl font-bold text-danger">{{ todaySubPeople }} 人</div>
        </div>
        <div class="bg-surface shadow-md rounded-xl border border-border p-4">
          <div class="flex items-center gap-1.5 text-sm text-text-secondary">
            <span class="w-2 h-2 rounded-full bg-danger inline-block"></span> 扣分项目
          </div>
          <div class="text-2xl font-bold text-danger">{{ todaySubItems }} 项</div>
        </div>
      </div>

      <!-- 工具栏 -->
      <div class="mb-4 flex items-center gap-3 opbar">
        <button v-preload="loadAddScoreDialog" @click="openAdd" class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded transition-theme">＋ 添加{{ isGroup ? '小组' : '个人' }}加分</button>
        <button @click="refresh" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1 btn-refresh transition-theme"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
        <button v-preload="loadExportExcel" @click="openExport" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1 transition-theme">📥 导出{{ isGroup ? '小组' : '个人' }}加分</button>
      </div>

      <!-- 今日时间轴 -->
      <LeaveTimeline
        :nodes="timelineNodes"
        :node-types="timelineNodeTypes"
        :type-options="['加分', '扣分']"
        :title="isGroup ? '🗓️ 今日小组加减分时间轴' : '🗓️ 今日个人加减分时间轴'"
        align-right
      >
        <template #content="{ node }">
          <div class="text-sm text-text">
            <span class="font-medium">{{ node.person }}</span>
            <span class="text-text-secondary"> 因为 </span>
            <span>{{ node.reason }}</span>
            <span class="font-bold ml-1" :class="node.isSub ? 'text-danger' : 'text-success'">{{ node.sign }}</span>
          </div>
        </template>
        <template #ops="{ node }">
          <div class="flex items-center gap-1.5">
            <button @click="openEdit(recordByKey(node.key))" class="bg-info hover:bg-blue-700 text-text-inverse px-2.5 py-0.5 rounded text-xs transition-theme">编辑</button>
            <button @click="askDelete(recordByKey(node.key))" class="bg-danger hover:bg-red-700 text-text-inverse px-2.5 py-0.5 rounded text-xs transition-theme">删除</button>
          </div>
        </template>
      </LeaveTimeline>
    </div>

    <!-- ==================== 加分统计 ==================== -->
    <div v-if="activeTab === 'stats'">
      <!-- 子标题 + 工具栏（统计范围切换右对齐） -->
      <h3 class="text-xl font-semibold text-text mb-4 flex items-center gap-2 min-h-7"><IconGlyph name="chart" :size="20" /> 加分统计</h3>
      <div class="mb-4 flex flex-wrap items-center gap-3 opbar">
        <button @click="refreshStats" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh transition-theme">
          <IconGlyph name="refresh" :size="14" tint="current" /> 刷新
        </button>
        <button @click="openStatsExport" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 transition-theme">
          <IconGlyph name="download" :size="14" tint="current" /> 导出 Excel
        </button>
        <AppSelect v-model="statMode" :options="statModeOptions" class="w-32 ml-auto" />
      </div>

      <div class="bg-surface border border-border rounded-xl p-5 mb-6">
        <StatBarList
          :rows="statRows"
          :bar-width="barWidth"
          :bar-class="barColor"
          :value-text="valueText"
          :value-class="valueColor"
          :row-key="(row) => statMode + '-' + row.name"
          :empty-text="'暂无' + (isGroup ? '小组' : '个人') + '加分记录'"
        />
      </div>

      <!-- 加分记录 -->
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-base font-bold text-text flex items-center gap-2"><IconGlyph name="clipboard" :size="18" /> {{ isGroup ? '小组' : '个人' }}加分记录</h3>
      </div>
      <div class="bg-surface border border-border rounded-xl overflow-hidden">
        <DynamicTable
          :fields="scoreFields"
          :rows="scoreRows"
          :editing-cell="editingCell"
          hide-select-all
          hide-move-buttons
          hide-add-row
          :empty-label="isGroup ? '小组加分' : '个人加分'"
          :empty-action-text="isGroup ? '＋ 添加小组加分' : '＋ 添加个人加分'"
          @add-new-row-at-bottom="openAdd"
          @start-edit="startEdit"
          @save-cell="saveCell"
          @delete-row="onDeleteRow"
          @swap-rows="onSwapRows"
          @swap-columns="onSwapColumns"
          @edit-row="openEditRow"
        />
      </div>
    </div>

    <!-- 添加/编辑加分弹窗 -->
    <AddScoreDialog
      v-if="addDialogMounted"
      :visible="addDialogVisible"
      :students="students"
      :mode="scoreMode"
      :editing-record="editingRecord"
      @confirm="submitAdd"
      @update="updateScore"
      @delete="rec => deleteScore(rec?.id)"
      @cancel="addDialogVisible = false"
    />

    <!-- 确认删除弹窗 -->
    <ConfirmDialog
      v-if="confirmMounted"
      :visible="confirm.visible"
      :message="confirm.message"
      type="confirm"
      :showCancel="true"
      @confirm="confirm.ok"
      @cancel="confirm.visible = false"
    />

    <!-- 导出弹窗 -->
    <ExportExcel
      v-if="exportMounted"
      :is-visible="exportVisible"
      :rows="exportRows"
      :fields="exportFields"
      :selectedRowKeys="[]"
      :default-filename="exportFilename"
      @export-finish="() => {}"
      @update:is-visible="exportVisible = $event"
    />
  </div>
</template>

<script>
import axios from 'axios'
import { defineAsyncComponent, getCurrentInstance } from 'vue'
import AppSelect from '../components/base/AppSelect.vue'
import Tabs from '../components/base/Tabs.vue'
import LeaveTimeline from '../components/base/LeaveTimeline.vue'
import StatBarList from '../components/base/StatBarList.vue'
import DynamicTable from '../components/tables/DynamicTable/DynamicTable.vue'
import { zhCollator } from '../utils/collator.js'
import { useNotification } from '../composables/useNotification.js'
import { recordCellUndo, recordRowInsert, recordRowDelete, recordRowUpdate, useUndoShortcut } from '../composables/useUndo.js'
import { formatDate } from '../utils/dateTime.js'
import { applyRouteRowFocus } from '../composables/useRowFocus.js'

// 弹窗类组件懒加载：打开时才加载对应 chunk
const loadAddScoreDialog = () => import('../components/dialogs/AddScoreDialog.vue')
const AddScoreDialog = defineAsyncComponent(loadAddScoreDialog)
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'))
const loadExportExcel = () => import('../components/import-export/ExportExcel/ExportExcel.vue')
const ExportExcel = defineAsyncComponent(loadExportExcel)

const API = '/api'

export default {
  name: 'ScoreManagement',
  components: { AppSelect, Tabs, AddScoreDialog, LeaveTimeline, StatBarList, ConfirmDialog, ExportExcel, DynamicTable },
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销、重做加分表
  setup() {
    const inst = getCurrentInstance()
    const { success: n } = useNotification()
    useUndoShortcut('score_records', {
      onAfterUndo: (label) => { inst.proxy.loadAll(); n(label ? `已撤销：${label}` : '已撤销') },
      onAfterRedo: (label) => { inst.proxy.loadAll(); n(label ? `已重做：${label}` : '已重做') }
    })
    // 暴露给模板：v-preload 的绑值在渲染函数里求值，模块作用域的加载器不挂实例会告警
    return { loadAddScoreDialog, loadExportExcel }
  },
  // 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，保留退出动画
  watch: {
    addDialogVisible(n) { if (n) this.addDialogMounted = true },
    exportVisible(n) { if (n) this.exportMounted = true },
    'confirm.visible'(n) { if (n) this.confirmMounted = true },
    // 跨页定位：标题栏全局搜索点「加扣分记录」结果跳转 /scores?focus=<id>
    '$route.query.focus'() { this._applyRowFocus() }
  },
  data() {
    return {
      activeTab: 'today',
      loading: false,
      students: [],
      // 加分对象：personal 个人加分 / group 小组加分（完全独立，各自有记录与统计）
      scoreMode: 'personal',
      scores: [],       // 个人加分记录（source !== 'group'）
      groupScores: [],  // 小组加分记录（source === 'group'）
      statMode: 'add',
      addDialogVisible: false,
      addDialogMounted: false,
      editingRecord: null,
      exportVisible: false,
      exportMounted: false,
      exportKind: 'today',   // today 今日加分记录 / stats 加分统计
      confirm: { visible: false, message: '', ok: null },
      confirmMounted: false,
      // 「今天」的日期串（YYYY-MM-DD）：定时器每分钟对一次，跨午夜后触发「今日加分」重算
      todayKey: formatDate(new Date()),
      // 加分记录表（DynamicTable）：行数据 / 列顺序 / 当前编辑单元格
      scoreRows: [],
      scoreCols: [],
      editingCell: null
    }
  },
  computed: {
    // 加分对象下拉选项
    scoreModeOptions() {
      return [
        { value: 'personal', label: '个人加分' },
        { value: 'group', label: '小组加分' }
      ]
    },
    statModeOptions() {
      return [
        { value: 'add', label: '按加分' },
        { value: 'sub', label: '按扣分' },
        { value: 'net', label: '净分（加-扣）' }
      ]
    },
    isGroup() {
      return this.scoreMode === 'group'
    },
    activeData() {
      return this.isGroup ? this.groupScores : this.scores
    },
    tabs() {
      return [
        { label: '今日加分', value: 'today' },
        { label: '加分统计', value: 'stats' }
      ]
    },
    todayStart() {
      // 依赖 todayKey（由定时器推进），否则无响应式依赖的 computed 会被永久缓存，
      // KeepAlive 缓存期间跨午夜后「今日加分」仍按昨天的日期过滤
      return this.todayKey
    },
    timelineNodeTypes() {
      return [
        { value: 'add', label: '加分', colorKey: 'success', color: '#16a34a' },
        { value: 'sub', label: '扣分', colorKey: 'danger', color: '#dc2626' }
      ]
    },
    timelineNodes() {
      return this.todayRecords.map(r => {
        const isSub = r.类型 === '扣分'
        const person = r.姓名 || r.group_name || '—'
        return {
          key: r.id,
          type: isSub ? 'sub' : 'add',
          time: r.加分时间,
          category: isSub ? '扣分' : '加分',
          text: `${person} 因为 ${r.原因 || r.项目 || '—'} ${isSub ? '扣' : '加'} ${r.分值} 分`,
          person,
          reason: r.原因 || r.项目 || '—',
          sign: `${isSub ? '扣' : '加'} ${r.分值} 分`,
          isSub
        }
      })
    },
    recordMap() {
      const m = {}
      this.todayRecords.forEach(r => { m[r.id] = r })
      return m
    },
    todayRecords() {
      return this.activeData.filter(r => String(r.加分时间 || '').startsWith(this.todayStart))
    },
    todayAddRecords() {
      return this.todayRecords.filter(r => r.类型 !== '扣分')
    },
    todaySubRecords() {
      return this.todayRecords.filter(r => r.类型 === '扣分')
    },
    todayAddItems() { return new Set(this.todayAddRecords.map(r => r.项目).filter(Boolean)).size },
    todaySubItems() { return new Set(this.todaySubRecords.map(r => r.项目).filter(Boolean)).size },
    todayAddPeople() { return new Set(this.todayAddRecords.map(r => this.isGroup ? r.group_name : r.姓名)).size },
    todaySubPeople() { return new Set(this.todaySubRecords.map(r => this.isGroup ? r.group_name : r.姓名)).size },
    addPeopleLabel() { return this.isGroup ? '加分小组' : '加分人数' },
    subPeopleLabel() { return this.isGroup ? '扣分小组' : '扣分人数' },
    allRecords() {
      return this.activeData.slice().sort((a, b) => zhCollator.compare(String(b.加分时间), String(a.加分时间)))
    },
    statRows() {
      // 小组模式：按小组名聚合
      if (this.isGroup) {
        const byGroup = {}
        for (const r of this.groupScores) {
          const name = r.group_name || '未命名小组'
          if (!byGroup[name]) byGroup[name] = { name, add: 0, sub: 0 }
          if (r.类型 === '扣分') byGroup[name].sub += Number(r.分值) || 0
          else byGroup[name].add += Number(r.分值) || 0
        }
        const rows = Object.values(byGroup)
          .map(o => ({ name: o.name, value: this.statMode === 'sub' ? o.sub : this.statMode === 'net' ? o.add - o.sub : o.add }))
          .filter(o => o.value !== 0)
          .sort((a, b) => b.value - a.value)
        const max = Math.max(...rows.map(r => Math.abs(r.value)))
        rows.forEach(r => { r._max = max || 1 })
        return rows
      }
      // 个人模式：按个人聚合
      const byId = {}
      for (const r of this.scores) {
        const name = r.姓名 || '未命名'
        if (!byId[name]) byId[name] = { name, add: 0, sub: 0 }
        if (r.类型 === '扣分') byId[name].sub += Number(r.分值) || 0
        else byId[name].add += Number(r.分值) || 0
      }
      const rows = Object.values(byId)
        .map(o => ({ name: o.name, value: this.statMode === 'sub' ? o.sub : this.statMode === 'net' ? o.add - o.sub : o.add }))
        .filter(o => o.value !== 0)
        .sort((a, b) => b.value - a.value)
      const max = Math.max(...rows.map(r => Math.abs(r.value)))
      rows.forEach(r => { r._max = max || 1 })
      return rows
    },
    exportRows() {
      if (this.exportKind === 'stats') {
        const col = this.statMode === 'add' ? '加分' : this.statMode === 'sub' ? '扣分' : '净分'
        return this.statRows.map(r => ({ [this.isGroup ? '小组' : '姓名']: r.name, [col]: r.value }))
      }
      const base = r => ({ id: r.id, 项目: r.项目, 分值: r.分值, 加分时间: r.加分时间, 原因: r.原因 })
      if (this.isGroup) return this.todayRecords.map(r => ({ 小组: r.group_name, 成员数: r.成员数 ?? '', 类型: r.类型, ...base(r) }))
      return this.todayRecords.map(r => ({ 姓名: r.姓名, 学号: r.学号, 类型: r.类型, ...base(r) }))
    },
    exportFields() {
      if (this.exportKind === 'stats') {
        const col = this.statMode === 'add' ? '加分' : this.statMode === 'sub' ? '扣分' : '净分'
        return [{ name: this.isGroup ? '小组' : '姓名' }, { name: col }]
      }
      if (this.isGroup) return [{ name: '小组' }, { name: '成员数' }, { name: '类型' }, { name: '项目' }, { name: '分值' }, { name: '加分时间' }, { name: '原因' }]
      return [{ name: '姓名' }, { name: '学号' }, { name: '类型' }, { name: '项目' }, { name: '分值' }, { name: '加分时间' }, { name: '原因' }]
    },
    exportFilename() {
      if (this.exportKind === 'stats') return this.isGroup ? '小组加分统计' : '个人加分统计'
      return this.isGroup ? '今日小组加分' : '今日个人加分'
    },
    // 加分记录表的列定义（列顺序可从表头拖拽调整）
    scoreFields() {
      return this.scoreCols.map(name => ({
        name,
        control: name === '类型' ? 'select' : undefined,
        options: name === '类型' ? ['加分', '扣分'] : undefined
      }))
    }
  },
  async created() {
    await this.loadAll()
  },
  mounted() { this._applyRowFocus(); this._startDayWatch() },
  activated() { this._applyRowFocus(); this._startDayWatch() },
  deactivated() { this._stopDayWatch() },
  beforeUnmount() { this._stopDayWatch() },
  methods: {
    // 「今日」口径的跨天刷新：每分钟对一次日期即可（不必精确卡 00:00），
    // 组件被 KeepAlive 缓存时 deactivated 停掉定时器，回到页面再启动
    _startDayWatch() {
      if (this._dayTimer) return
      this.todayKey = formatDate(new Date())
      this._dayTimer = setInterval(() => { this.todayKey = formatDate(new Date()) }, 60000)
    },
    _stopDayWatch() {
      if (this._dayTimer) { clearInterval(this._dayTimer); this._dayTimer = null }
    },
    // 跨页定位：命中记录在个人/小组哪一份数据里，就切到对应加分对象与「加分统计」页签，
    // 再滚动到目标行并高亮闪动。数据尚未加载时返回 null，由 helper 安排重试。
    _applyRowFocus() {
      applyRouteRowFocus(this, {
        parse: (key) => {
          const id = Number(key)
          const mode = this.scores.some(r => r.id === id) ? 'personal'
            : this.groupScores.some(r => r.id === id) ? 'group' : null
          if (!mode) return null
          if (this.scoreMode !== mode) {
            this.scoreMode = mode
            this.buildScoreRows()
          }
          this.activeTab = 'stats'
          return key
        }
      })
    },
    async loadAll() {
      this.loading = true
      try {
        const [stuRes, scoreRes] = await Promise.all([
          axios.get(`${API}/students`),
          axios.get(`${API}/scores`)
        ])
        const all = scoreRes.data.data || []
        this.students = stuRes.data.data || []
        this.scores = all.filter(r => r.source !== 'group')
        this.groupScores = all.filter(r => r.source === 'group')
        this.buildScoreRows()
        return true
      } catch (err) {
        useNotification().error('加载失败')
        return false
      } finally {
        this.loading = false
      }
    },
    async refresh() {
      // 失败时 loadAll 已弹「加载失败」，这里不再重复提示，更不会误报「已刷新」
      if (await this.loadAll()) useNotification().success('已刷新 加分管理 数据')
    },
    async refreshStats() {
      if (await this.loadAll()) useNotification().success('已刷新 加分统计 数据')
    },
    openAdd() {
      this.editingRecord = null
      this.addDialogVisible = true
    },
    // 导出今日加分：无数据时直接提示，不弹导出选项弹窗
    openExport() {
      this.exportKind = 'today'
      if (this.exportRows.length === 0) return useNotification().info('暂无数据可导出')
      this.exportVisible = true
    },
    // 导出加分统计（当前统计范围）
    openStatsExport() {
      this.exportKind = 'stats'
      if (this.exportRows.length === 0) return useNotification().info('暂无加分统计可导出')
      this.exportVisible = true
    },
    // 记录行编辑：从原始记录中取完整对象交给弹窗
    openEditRow(row) {
      const rec = this.activeData.find(r => r.id === row.id)
      if (rec) this.openEdit(rec)
    },
    recordByKey(key) {
      return this.recordMap[key]
    },
    // ==================== 加分记录表（DynamicTable）====================
    // 由当前模式的记录构建行数据（含 _rowKey / id，供拖拽与删除）
    buildScoreRows() {
      const group = this.isGroup
      // 列顺序只在切换个人/小组时重置，保留用户拖拽后的顺序
      if (this._colsMode !== this.scoreMode || this.scoreCols.length === 0) {
        this.scoreCols = group
          ? ['小组', '成员数', '类型', '项目', '分值', '加分时间', '加分原因']
          : ['姓名', '学号', '类型', '项目', '分值', '加分时间', '加分原因']
        this._colsMode = this.scoreMode
      }
      this.scoreRows = this.allRecords.map(r => ({
        id: r.id,
        _rowKey: 'sr' + r.id,
        ...(group ? { 小组: r.group_name || '-', 成员数: r.成员数 ?? 0 } : { 姓名: r.姓名, 学号: r.学号 || '' }),
        类型: r.类型,
        项目: r.项目 || '',
        分值: r.分值,
        加分时间: r.加分时间 || '',
        加分原因: r.原因 || ''
      }))
    },
    // 双击单元格开始编辑
    startEdit(row, field) {
      this.editingCell = { rowKey: row._rowKey, field: field.name }
    },
    // 行内编辑完成：整条写回（后端更新），成功后重建行
    async saveCell(row) {
      const group = this.isGroup
      const orig = this.activeData.find(s => s.id === row.id)
      const payload = {
        类型: row.类型,
        项目: row.项目,
        分值: row.分值,
        加分时间: row.加分时间,
        原因: row.加分原因,
        ...(group ? { group_name: row.小组, 成员数: Number(row.成员数) || 0 } : { 姓名: row.姓名, 学号: row.学号 })
      }
      // 逐个字段记录撤销（旧值来源：activeData 原始记录）
      if (orig) {
        for (const f of Object.keys(payload)) {
          const ov = orig[f], nv = payload[f]
          if (String(ov ?? '') !== String(nv ?? '')) recordCellUndo('score_records', row.id, f, ov, nv)
        }
      }
      try {
        await axios.put(`${API}/scores/${row.id}`, payload)
        if (orig) Object.assign(orig, payload)
        this.editingCell = null
        useNotification().success('已保存')
        this.buildScoreRows()
      } catch (err) {
        useNotification().error(err.response?.data?.error || '保存失败')
        this.buildScoreRows() // 失败回滚
      }
    },
    // 行拖拽排序（仅调整展示顺序）
    onSwapRows(from, to) {
      this.scoreRows.splice(to, 0, this.scoreRows.splice(from, 1)[0])
    },
    // 列拖拽排序
    onSwapColumns(from, to) {
      const moved = this.scoreCols.splice(from, 1)[0]
      this.scoreCols.splice(to, 0, moved)
    },
    onDeleteRow(id) {
      const r = this.scoreRows.find(x => x.id === id)
      if (r) this.askDelete(r)
    },
    openEdit(item) {
      this.editingRecord = item
      this.addDialogVisible = true
    },
    async submitAdd(payload) {
      try {
        const res = await axios.post(`${API}/scores`, payload)
        this.addDialogVisible = false
        if (payload.source === 'group') {
          useNotification().success(`已给「${payload.group_name}」添加${payload.类型 === '扣分' ? '扣分' : '加分'}`)
        } else {
          useNotification().success('已保存加分')
        }
        await this.loadAll()
        // 记录撤销：新增后取回完整记录，撤销即删除该行
        const added = this.activeData.find(s => s.id === res.data.id)
        if (added) recordRowInsert('score_records', added)
      } catch (err) {
        useNotification().error(err.response?.data?.error || '保存失败')
      }
    },
    async updateScore(payload) {
      const { id, ...fields } = payload
      try {
        const oldRow = this.activeData.find(s => s.id === id)
        await axios.put(`${API}/scores/${id}`, fields)
        this.addDialogVisible = false
        useNotification().success('已保存')
        await this.loadAll()
        const newRow = this.activeData.find(s => s.id === id)
        if (oldRow && newRow) recordRowUpdate('score_records', oldRow, newRow)
      } catch (err) {
        useNotification().error(err.response?.data?.error || '保存失败')
      }
    },
    askDelete(item) {
      // 统计表行用「小组」字段，records 用 group_name：两种来源都要兼容，避免文案退化成「该小组」
      const groupName = item.group_name || item.小组
      const name = this.isGroup ? (groupName || '该小组') : (item.姓名 || '该记录')
      this.confirm = {
        visible: true,
        message: `确定删除「${name}」的这条${item.类型 || ''}记录吗？`,
        ok: () => this.deleteScore(item.id)
      }
    },
    async deleteScore(id) {
      try {
        const row = this.activeData.find(s => s.id === id)
        await axios.delete(`${API}/scores/${id}`)
        this.confirm.visible = false
        useNotification().success('已删除')
        await this.loadAll()
        // 记录撤销：删除前保存完整记录，撤销即恢复该行
        if (row) recordRowDelete('score_records', row)
      } catch (err) {
        useNotification().error(err.response?.data?.error || '删除失败')
      }
    },
    barWidth(row) {
      return Math.round((Math.abs(row.value) / row._max) * 100)
    },
    barColor(row) {
      if (this.statMode === 'net') return row.value >= 0 ? 'bg-success' : 'bg-danger'
      return this.statMode === 'sub' ? 'bg-danger' : 'bg-success'
    },
    valueColor(row) {
      if (this.statMode === 'net') return row.value >= 0 ? 'text-success' : 'text-danger'
      return this.statMode === 'sub' ? 'text-danger' : 'text-success'
    },
    valueText(row) {
      const sign = row.value > 0 ? '+' : (row.value < 0 ? '-' : '')
      return `${sign}${row.value} 分`
    }
  }
}
</script>