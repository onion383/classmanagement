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
        <button v-preload="loadAddLeaveDialog" @click="openAddLeave" class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded">
          ＋ 添加请假
        </button>
        <button @click="refresh" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh">
          <IconGlyph name="refresh" :size="14" tint="current" /> 刷新
        </button>
        <button v-preload="loadExportExcel" @click="openExportToday" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1.5">
          <IconGlyph name="download" :size="14" tint="current" /> 导出今日表
        </button>
      </div>

      <!-- 当前请假中 -->
      <div class="bg-surface border border-border rounded-xl mb-4 overflow-hidden">
        <div class="px-5 py-3 border-b border-border font-bold text-text flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-danger inline-block"></span> 当前请假中（{{ activeLeaves.length }}人）
        </div>
        <table class="w-full border-collapse">
          <thead>
            <tr class="bg-primary text-text-inverse">
              <th class="px-3 py-2 text-center w-10">#</th>
              <th class="px-3 py-2 text-center">姓名</th>
              <th class="px-3 py-2 text-center">类型</th>
              <th class="px-3 py-2 text-center">请假时段</th>
              <th class="px-3 py-2 text-center">家长联系方式</th>
              <th class="px-3 py-2 text-center">学生联系方式</th>
              <th class="px-3 py-2 text-center">备注</th>
              <th class="px-3 py-2 text-center w-28">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(item, idx) in activeLeaves"
              :key="item.id"
              class="border-t border-border hover:bg-surface-hover content-visibility-auto"
            >
              <td class="px-3 py-2 text-center text-text-muted">{{ idx + 1 }}</td>
              <td class="px-3 py-2 text-center text-text">{{ item.姓名 }}</td>
              <td class="px-3 py-2 text-center"><span class="px-2 py-0.5 rounded text-xs bg-danger/10 text-danger">{{ item.类型 }}</span></td>
              <td class="px-3 py-2 text-center text-text whitespace-nowrap">{{ formatRange(item.开始时间, item.结束时间) }}</td>
              <td class="px-3 py-2 text-center text-text">{{ item.家长联系电话 || '—' }}</td>
              <td class="px-3 py-2 text-center text-text">{{ item.学生联系电话 || '—' }}</td>
              <td class="px-3 py-2 text-center text-text">{{ item.备注 || '—' }}</td>
              <td class="px-3 py-2 text-center whitespace-nowrap">
                <button @click="openEditLeave(item)" class="bg-info hover:bg-blue-700 text-text-inverse px-3 py-1 rounded text-xs mr-1">编辑</button>
                <button @click="returnLeave(item)" class="bg-success hover:bg-green-700 text-text-inverse px-3 py-1 rounded text-xs">销假</button>
              </td>
            </tr>
            <tr v-if="!activeLeaves.length" class="border-t border-border">
              <td colspan="8" class="px-3 py-8 text-center text-text-muted">当前无请假学生</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 今日已返校 -->
      <div class="bg-surface border border-border rounded-xl overflow-hidden">
        <div class="px-5 py-3 border-b border-border font-bold text-text flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-success inline-block"></span> 今日已返校（{{ todayReturned.length }}人）
        </div>
        <table class="w-full border-collapse">
          <thead>
            <tr class="bg-primary text-text-inverse">
              <th class="px-3 py-2 text-center w-10">#</th>
              <th class="px-3 py-2 text-center">姓名</th>
              <th class="px-3 py-2 text-center">请假时段</th>
              <th class="px-3 py-2 text-center">家长联系方式</th>
              <th class="px-3 py-2 text-center">学生联系方式</th>
              <th class="px-3 py-2 text-center">原因（类型）</th>
              <th class="px-3 py-2 text-center">返校时间</th>
              <th class="px-3 py-2 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(item, idx) in todayReturned"
              :key="item.id"
              class="border-t border-border hover:bg-surface-hover content-visibility-auto"
            >
              <td class="px-3 py-2 text-center text-text-muted">{{ idx + 1 }}</td>
              <td class="px-3 py-2 text-center text-text">{{ item.姓名 }}</td>
              <td class="px-3 py-2 text-center text-text whitespace-nowrap">{{ formatRange(item.开始时间, item.结束时间) }}</td>
              <td class="px-3 py-2 text-center text-text">{{ item.家长联系电话 || '—' }}</td>
              <td class="px-3 py-2 text-center text-text">{{ item.学生联系电话 || '—' }}</td>
              <td class="px-3 py-2 text-center"><span class="px-2 py-0.5 rounded text-xs bg-info/10 text-info">{{ item.类型 }}</span></td>
              <td class="px-3 py-2 text-center text-text">{{ item.返校时间 }}</td>
              <td class="px-3 py-2 text-center whitespace-nowrap">
                <button @click="openEditLeave(item)" class="bg-info hover:bg-blue-700 text-text-inverse px-3 py-1 rounded text-xs mr-1">编辑</button>
                <button @click="unreturnLeave(item)" class="bg-warning hover:bg-yellow-600 text-text-inverse px-3 py-1 rounded text-xs">撤销销假</button>
              </td>
            </tr>
            <tr v-if="!todayReturned.length" class="border-t border-border">
              <td colspan="8" class="px-3 py-8 text-center text-text-muted">今日暂无返校记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 请假记录 -->
    <div v-if="activeTab === 'records'">
      <div class="mb-4 flex items-center gap-3 opbar">
        <button v-preload="loadAddLeaveDialog" @click="openAddLeave" class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded">
          ＋ 添加请假
        </button>
        <button @click="refresh" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1.5 btn-refresh">
          <IconGlyph name="refresh" :size="14" tint="current" /> 刷新
        </button>
      </div>

      <div class="mb-5">
        <DynamicTable
          ref="dynamicTable"
          :fields="leaveFields"
          :rows="displayLeaves"
          :editingCell="editingCell"
          :hideMoveButtons="true"
          :hideSelectAll="true"
          :maxRows="10"
          @startEdit="startEdit"
          @saveCell="saveCell"
          @deleteRow="deleteLeave"
          @addNewRowAtBottom="() => {}"
          @contextmenu.prevent="() => {}"
          @selectionChange="() => {}"
        />
      </div>

      <!-- 时间轴 -->
      <LeaveTimeline :nodes="timelineNodes" :type-options="leaveTypeOptions" />
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
      :rows="todayExportRows"
      :fields="todayExportFields"
      :tableElement="todayTableEl"
      defaultFilename="今日请假表"
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

<script>
import axios from 'axios'
import { defineAsyncComponent, getCurrentInstance } from 'vue'
import Tabs from '../components/base/Tabs.vue'
import DynamicTable from '../components/tables/DynamicTable.vue'
import LeaveTimeline from '../components/base/LeaveTimeline.vue'
import { useNotification } from '../composables/useNotification.js'
import { recordCellUndo, useUndoShortcut } from '../composables/useUndo.js'

// 弹窗类组件懒加载：打开时才加载对应 chunk
const loadAddLeaveDialog = () => import('../components/dialogs/AddLeaveDialog.vue')
const AddLeaveDialog = defineAsyncComponent(loadAddLeaveDialog)
const loadExportExcel = () => import('../components/import-export/ExportExcel.vue')
const ExportExcel = defineAsyncComponent(loadExportExcel)
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'))
const OverdueLeaveDialog = defineAsyncComponent(() => import('../components/dialogs/OverdueLeaveDialog.vue'))

const API = '/api'

export default {
  name: 'LeaveManagement',
  components: {
    Tabs, DynamicTable, AddLeaveDialog, LeaveTimeline, ExportExcel, ConfirmDialog, OverdueLeaveDialog
  },
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销、重做请假表
  setup() {
    const inst = getCurrentInstance()
    const { success: n } = useNotification()
    useUndoShortcut('leave_records', {
      onAfterUndo: (label) => { inst.proxy.loadAll(); n(label ? `已撤销：${label}` : '已撤销') },
      onAfterRedo: (label) => { inst.proxy.loadAll(); n(label ? `已重做：${label}` : '已重做') }
    })
    // 暴露给模板：v-preload 的绑值在渲染函数里求值，模块作用域的加载器不挂实例会告警
    return { loadAddLeaveDialog, loadExportExcel }
  },
  // 懒加载弹窗保活：首次打开后保持挂载，关闭只降 visible，保留退出动画
  watch: {
    addDialogVisible(n) { if (n) this.addDialogMounted = true },
    exportVisible(n) { if (n) this.exportMounted = true },
    'confirm.visible'(n) { if (n) this.confirmMounted = true },
    overdueDialogVisible(n) { if (n) this.overdueDialogMounted = true }
  },
  data() {
    return {
      activeTab: 'today',
      loading: false,
      students: [],
      leaves: [],
      addDialogVisible: false,
      addDialogMounted: false,
      editingLeave: null,
      editingCell: null,
      exportVisible: false,
      exportMounted: false,
      confirm: { visible: false, message: '', ok: null },
      confirmMounted: false,
      leaveTypeOptions: ['病假', '事假', '其他'],
      // 假期已结束未销假的提示弹窗
      overdueDialogVisible: false,
      overdueDialogMounted: false,
      overdueList: [],
      // 本次会话内已提醒过（无论处理与否）的记录 id，避免重复弹窗
      promptedIds: new Set(),
      todayExportFields: [
        { name: '姓名' },
        { name: '类型' },
        { name: '开始时间' },
        { name: '结束时间' },
        { name: '家长联系电话' },
        { name: '学生联系电话' },
        { name: '状态' },
        { name: '返校时间' }
      ],
      leaveFields: [
        { name: '姓名', type: '文字' },
        { name: '类型', type: '文字', control: 'select', options: ['病假', '事假', '其他'] },
        { name: '开始时间', type: '文字' },
        { name: '结束时间', type: '文字' },
        { name: '家长联系电话', type: '文字' },
        { name: '学生联系电话', type: '文字' },
        { name: '状态', type: '文字', control: 'select', options: ['请假中', '已返校', '已取消'] },
        { name: '备注', type: '文字' }
      ],
      tabs: [
        { value: 'today', label: '今日到班' },
        { value: 'records', label: '请假记录' }
      ]
    }
  },
  computed: {
    totalStudents() {
      return this.students.length
    },
    activeLeaves() {
      return this.leaves.filter(l => l.状态 === '请假中')
    },
    todayReturned() {
      const today = new Date()
      const p = n => String(n).padStart(2, '0')
      const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
      return this.leaves.filter(l => l.状态 === '已返校' && l.返校时间 && l.返校时间.startsWith(todayStr))
    },
    inSchool() {
      return this.totalStudents - this.activeLeaves.length
    },
    displayLeaves() {
      return this.leaves.map((r, i) => ({ ...r, _rowKey: r.id, _displayIndex: i + 1, position: i + 1 }))
    },
    todayExportRows() {
      const all = [...this.activeLeaves, ...this.todayReturned]
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
    },
    todayTableEl() {
      return null
    },
    timelineNodes() {
      const arr = []
      this.leaves.forEach(l => {
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
    }
  },
  async created() {
    await this.loadAll()
    // 打开页面后检测一次超时未销假
    this.checkOverdue()
    // 每 10 分钟低频检测一次（纯前端比较时间，成本极低）
    this._overdueTimer = setInterval(() => this.checkOverdue(), 10 * 60 * 1000)
  },
  beforeUnmount() {
    if (this._overdueTimer) clearInterval(this._overdueTimer)
  },
  methods: {
    // 时间段展示：同日显示 "M-D H:mm~H:mm"，跨天显示完整起止
    formatRange(s, e) {
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
    },
    async loadAll() {
      this.loading = true
      try {
        const [stuRes, leavesRes] = await Promise.all([
          axios.get(`${API}/students`),
          axios.get(`${API}/leaves`)
        ])
        this.students = stuRes.data.data || []
        this.leaves = leavesRes.data.data || []
      } catch (err) {
        useNotification().error('加载失败')
      } finally {
        this.loading = false
      }
    },
    async refresh() {
      try {
        await this.loadAll()
        useNotification().success(this.activeTab === 'today' ? '已刷新 今日请假 数据' : '已刷新 请假记录 数据')
        this.checkOverdue()
      } catch (err) {
        useNotification().error('刷新失败')
      }
    },
    // 当前时间字符串，格式与结束时间保持一致（YYYY-MM-DD HH:mm）
    nowStr() {
      const d = new Date()
      const p = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    },
    // 检测「假期已结束但尚未销假」的记录并弹出提示
    checkOverdue() {
      const now = this.nowStr()
      // 状态为「请假中」且结束时间已到、且本会话未提醒过
      const overdue = this.activeLeaves.filter(
        (l) => l.结束时间 && l.结束时间 <= now && !this.promptedIds.has(l.id)
      )
      if (overdue.length === 0) return
      // 本次会话记录已提醒，避免该同学反复弹出
      overdue.forEach((l) => this.promptedIds.add(l.id))
      this.overdueList = overdue.map((l) => ({
        ...l,
        _range: this.formatRange(l.开始时间, l.结束时间)
      }))
      this.overdueDialogVisible = true
    },
    // 「未返校」：保持请假中，仅从本次弹窗列表移除
    handleOverdueNot(rec) {
      this.removeOverdue(rec.id)
    },
    // 「已经返校并销假」：调用销假接口后从列表移除
    async handleOverdueReturn(rec) {
      try {
        await axios.post(`${API}/leaves/${rec.id}/return`)
        useNotification().success(`${rec.姓名} 已返校并销假`)
        this.removeOverdue(rec.id)
        await this.loadAll()
      } catch (err) {
        useNotification().error(err.response?.data?.error || '销假失败')
      }
    },
    removeOverdue(id) {
      this.overdueList = this.overdueList.filter((l) => l.id !== id)
      if (this.overdueList.length === 0) this.overdueDialogVisible = false
    },
    async submitAdd(payload) {
      try {
        await axios.post(`${API}/leaves`, payload)
        this.addDialogVisible = false
        useNotification().success('已添加请假')
        await this.loadAll()
      } catch (err) {
        useNotification().error(err.response?.data?.error || '添加失败')
      }
    },
    openAddLeave() {
      this.editingLeave = null
      this.addDialogVisible = true
    },
    openEditLeave(item) {
      this.editingLeave = item
      this.addDialogVisible = true
    },
    async updateLeave(payload) {
      const { id, ...fields } = payload
      try {
        await axios.put(`${API}/leaves/${id}`, fields)
        this.addDialogVisible = false
        useNotification().success('已保存')
        await this.loadAll()
      } catch (err) {
        useNotification().error(err.response?.data?.error || '保存失败')
      }
    },
    unreturnLeave(item) {
      this.confirm = {
        visible: true,
        message: `确认撤销「${item.姓名}」的销假，恢复为请假中吗？`,
        ok: async () => {
          this.confirm.visible = false
          try {
            await axios.post(`${API}/leaves/${item.id}/unreturn`)
            useNotification().success('已撤销销假')
            await this.loadAll()
          } catch (err) {
            useNotification().error('撤销失败')
          }
        }
      }
    },
    returnLeave(item) {
      this.confirm = {
        visible: true,
        message: `确认 ${item.姓名} 已返校并销假吗？`,
        ok: async () => {
          this.confirm.visible = false
          try {
            await axios.post(`${API}/leaves/${item.id}/return`)
            useNotification().success('已销假')
            await this.loadAll()
          } catch (err) {
            useNotification().error('销假失败')
          }
        }
      }
    },
    // 修改了联系方式后，询问是否同步保存到学生档案
    askSavePhones(phoneUpdate) {
      const keys = Object.keys(phoneUpdate).filter(k => k !== 'studentId')
      const names = keys.join('、')
      this.confirm = {
        visible: true,
        message: `检测到你修改了「${names}」，是否将联系方式保存到班级管理的学生档案，方便之后使用？`,
        ok: async () => {
          this.confirm.visible = false
          try {
            const { studentId, ...fields } = phoneUpdate
            await axios.put(`${API}/students/${studentId}`, fields)
            useNotification().success('联系方式已保存')
            this.students = (await axios.get(`${API}/students`)).data.data || this.students
          } catch (err) {
            useNotification().error('联系方式保存失败')
          }
        }
      }
    },
    startEdit(row, field) {
      this.editingCell = { rowKey: row._rowKey, field: field.name }
    },
    async saveCell(row, field) {
      const val = row[field.name]
      // 旧值来源：编辑前的请假记录
      const oldLeave = this.leaves.find(l => l.id === row.id)
      const oldVal = oldLeave ? oldLeave[field.name] : undefined
      try {
        await axios.put(`${API}/leaves/${row.id}`, { [field.name]: val })
        if (oldVal !== val) recordCellUndo('leave_records', row.id, field.name, oldVal, val)
        useNotification().success('已保存')
      } catch (err) {
        useNotification().error('保存失败')
      }
      this.editingCell = null
      await this.loadAll()
    },
    deleteLeave(id) {
      this.confirm = {
        visible: true,
        message: '是否删除该条请假数据？',
        ok: async () => {
          this.confirm.visible = false
          this.addDialogVisible = false // 关闭编辑弹窗
          try {
            await axios.delete(`${API}/leaves/${id}`)
            useNotification().success('已删除')
            await this.loadAll()
          } catch (err) {
            useNotification().error('删除失败')
          }
        }
      }
    },
    openExportToday() {
      this.exportVisible = true
    }
  }
}
</script>