<template>
  <div>
    <!-- 页面标题 + 加分对象下拉 -->
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-6 py-5 border border-border min-h-[4.5rem] flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold text-text">🏅 加分管理</h1>
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
      <div class="mb-4 flex items-center gap-3">
        <button @click="openAdd" class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded">＋ 添加{{ isGroup ? '小组' : '个人' }}加分</button>
        <button @click="refresh" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1">🔄 刷新</button>
        <button @click="exportVisible = true" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1">📥 导出{{ isGroup ? '小组' : '个人' }}加分</button>
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
            <button @click="openEdit(recordByKey(node.key))" class="bg-info hover:bg-blue-700 text-text-inverse px-2.5 py-0.5 rounded text-xs">编辑</button>
            <button @click="askDelete(recordByKey(node.key))" class="bg-danger hover:bg-red-700 text-text-inverse px-2.5 py-0.5 rounded text-xs">删除</button>
          </div>
        </template>
      </LeaveTimeline>
    </div>

    <!-- ==================== 加分统计 ==================== -->
    <div v-if="activeTab === 'stats'">
      <!-- 按个人 / 按小组统计 -->
      <div class="bg-surface border border-border rounded-xl p-5 mb-6">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
          <h3 class="text-base font-bold text-text">{{ isGroup ? '📊 按小组统计' : '📊 按个人统计' }}</h3>
          <AppSelect v-model="statMode" :options="statModeOptions" class="w-32" />
        </div>

        <div v-if="statRows.length" class="space-y-2.5">
          <div v-for="(row, idx) in statRows" :key="statMode + '-' + row.name" class="flex items-center gap-3">
            <span class="w-20 text-sm text-text truncate text-right shrink-0">{{ row.name }}</span>
            <div class="flex-1 h-5 bg-surface-hover rounded overflow-hidden">
              <div
                class="h-full rounded bar-grow"
                :class="barColor(row)"
                :style="{ width: barWidth(row) + '%', animationDelay: (idx * 90) + 'ms' }"
              ></div>
            </div>
            <span class="w-14 text-sm font-bold text-right shrink-0" :class="valueColor(row)">{{ valueText(row) }}</span>
          </div>
        </div>
        <div v-else class="text-center text-text-muted py-8 text-sm">暂无{{ isGroup ? '小组' : '个人' }}加分记录</div>
      </div>

      <!-- 加分记录 -->
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-base font-bold text-text">📋 {{ isGroup ? '小组' : '个人' }}加分记录</h3>
      </div>
      <div class="bg-surface border border-border rounded-xl overflow-hidden">
        <DynamicTable
          :fields="scoreFields"
          :rows="scoreRows"
          :editing-cell="editingCell"
          hide-select-all
          hide-move-buttons
          @start-edit="startEdit"
          @save-cell="saveCell"
          @delete-row="onDeleteRow"
          @swap-rows="onSwapRows"
          @swap-columns="onSwapColumns"
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
      :default-filename="isGroup ? '今日小组加分' : '今日个人加分'"
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
import DynamicTable from '../components/tables/DynamicTable.vue'
import { useNotification } from '../composables/useNotification.js'
import { recordCellUndo, recordRowInsert, recordRowDelete, recordRowUpdate, useUndoShortcut } from '../composables/useUndo.js'

// 弹窗类组件懒加载：打开时才加载对应 chunk
const AddScoreDialog = defineAsyncComponent(() => import('../components/dialogs/AddScoreDialog.vue'))
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'))
const ExportExcel = defineAsyncComponent(() => import('../components/import-export/ExportExcel.vue'))

const API = '/api'

export default {
  name: 'ScoreManagement',
  components: { AppSelect, Tabs, AddScoreDialog, LeaveTimeline, ConfirmDialog, ExportExcel, DynamicTable },
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销、重做加分表
  setup() {
    const inst = getCurrentInstance()
    const { success: n } = useNotification()
    useUndoShortcut('score_records', {
      onAfterUndo: (label) => { inst.proxy.loadAll(); n(label ? `已撤销：${label}` : '已撤销') },
      onAfterRedo: (label) => { inst.proxy.loadAll(); n(label ? `已重做：${label}` : '已重做') }
    })
  },
  // 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，保留退出动画
  watch: {
    addDialogVisible(n) { if (n) this.addDialogMounted = true },
    exportVisible(n) { if (n) this.exportMounted = true },
    'confirm.visible'(n) { if (n) this.confirmMounted = true }
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
      confirm: { visible: false, message: '', ok: null },
      confirmMounted: false,
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
      const d = new Date()
      const p = n => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
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
      return this.activeData.slice().sort((a, b) => String(b.加分时间).localeCompare(String(a.加分时间)))
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
      const base = r => ({ id: r.id, 项目: r.项目, 分值: r.分值, 加分时间: r.加分时间, 原因: r.原因 })
      if (this.isGroup) return this.todayRecords.map(r => ({ 小组: r.group_name, 成员数: r.成员数 ?? '', 类型: r.类型, ...base(r) }))
      return this.todayRecords.map(r => ({ 姓名: r.姓名, 学号: r.学号, 类型: r.类型, ...base(r) }))
    },
    exportFields() {
      if (this.isGroup) return [{ name: '小组' }, { name: '成员数' }, { name: '类型' }, { name: '项目' }, { name: '分值' }, { name: '加分时间' }, { name: '原因' }]
      return [{ name: '姓名' }, { name: '学号' }, { name: '类型' }, { name: '项目' }, { name: '分值' }, { name: '加分时间' }, { name: '原因' }]
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
  methods: {
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
      } catch (err) {
        useNotification().error('加载失败')
      } finally {
        this.loading = false
      }
    },
    async refresh() {
      try {
        await this.loadAll()
        useNotification().success('已刷新 加分管理 数据')
      } catch (err) {
        useNotification().error('刷新失败')
      }
    },
    openAdd() {
      this.editingRecord = null
      this.addDialogVisible = true
    },
    recordByKey(key) {
      return this.recordMap[key]
    },
    // ==================== 加分记录表（DynamicTable）====================
    // 由当前模式的记录构建行数据（含 _rowKey / id，供拖拽与删除）
    buildScoreRows() {
      const group = this.isGroup
      this.scoreCols = group
        ? ['小组', '成员数', '类型', '项目', '分值', '加分时间', '加分原因']
        : ['姓名', '学号', '类型', '项目', '分值', '加分时间', '加分原因']
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
      const name = this.isGroup ? (item.group_name || '该小组') : (item.姓名 || '该记录')
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

<style scoped>
/* 加分统计柱状图：从左往右非线性生长进场动画 */
.bar-grow {
  transform-origin: left center;
  animation: score-bar-grow 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes score-bar-grow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
</style>