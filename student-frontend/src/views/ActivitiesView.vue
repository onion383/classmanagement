<template>
  <div>
    <!-- 页面标题 -->
    <div class="w-full bg-surface shadow-md rounded-xl mb-6 px-5 py-3 border border-border min-h-[4.5rem] flex items-center">
      <h1 class="text-2xl font-bold text-text flex items-center gap-2"><IconGlyph name="activity" /> 班级活动</h1>
    </div>

    <!-- 双 tab -->
    <Tabs :tabs="tabs" v-model="activeTab" />

    <!-- ==================== 日常活动 ==================== -->
    <div v-if="activeTab === 'daily'">
      <!-- 工具栏 -->
      <div class="mb-4 flex items-center gap-3">
        <button @click="openAddActivity" class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded">＋ 新增活动</button>
        <button @click="refreshActivities" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
        <button @click="openActivityExport" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1">📥 导出活动</button>
      </div>

      <!-- 活动时间轴（带状态标签） -->
      <LeaveTimeline
        :nodes="activityTimelineNodes"
        :node-types="activityNodeTypes"
        :title="'🗓️ 活动时间轴'"
        :max-height="640"
        align-right
      >
        <template #content="{ node }">
          <div class="text-sm text-text">
            <span class="font-medium">{{ node.subject }}</span>
            <span v-if="node.location" class="text-text-secondary"> · {{ node.location }}</span>
            <span v-if="node.participants" class="text-text-secondary text-xs ml-1 inline-flex items-center">· <IconGlyph name="users" :size="13" tint="current" /> {{ node.participants }}</span>
          </div>
        </template>
        <template #ops="{ node }">
          <div class="flex items-center gap-1.5">
            <button @click="openEditActivity(activityByKey(node.key))" class="bg-info hover:bg-blue-700 text-text-inverse px-2.5 py-0.5 rounded text-xs">编辑</button>
            <button @click="goAlbum" class="bg-surface-hover hover:bg-border text-text-secondary px-2.5 py-0.5 rounded text-xs border border-border">查看相册</button>
            <button @click="askDeleteActivity(activityByKey(node.key))" class="bg-danger hover:bg-red-700 text-text-inverse px-2.5 py-0.5 rounded text-xs">删除</button>
          </div>
        </template>
      </LeaveTimeline>
    </div>

    <!-- ==================== 倒计时 ==================== -->
    <div v-if="activeTab === 'countdown'">
      <!-- 工具栏 -->
      <div class="mb-4 flex items-center gap-3">
        <button @click="openAddCountdown" class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded">＋ 添加倒计时</button>
        <button @click="refreshCountdowns" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1">🔄 刷新</button>
        <button @click="openCountdownExport" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1"><IconGlyph name="download" :size="14" tint="current" /> 导出 EXCEL 表格</button>
      </div>

      <!-- 数据看板（最近 3 个） -->
      <div v-if="topCountdowns.length" class="grid grid-cols-3 gap-4 mb-6">
        <div v-for="cd in topCountdowns" :key="cd.id" class="bg-surface shadow-md rounded-xl border border-border p-4 text-center" :class="{ 'opacity-70': cd.days < 0 }">
          <div class="text-sm text-text-secondary truncate">距离 {{ cd.名称 }}</div>
          <div class="text-4xl font-bold mt-1" :class="cd.days >= 0 ? 'text-info' : 'text-text-muted'">{{ Math.abs(cd.days) }}</div>
          <div class="text-sm text-text-secondary">{{ cd.days >= 0 ? '还有 X 天' : '天（已过去）' }}</div>
          <div class="text-xs text-text-muted mt-1">截止 {{ cd.截止日 }}</div>
        </div>
      </div>
      <div v-else class="bg-surface border border-border rounded-xl py-8 text-center text-text-muted text-sm mb-6">暂无倒计时，点击「添加倒计时」开始</div>

      <!-- 倒计时时间轴 -->
      <LeaveTimeline
        :nodes="countdownTimelineNodes"
        :node-types="countdownNodeTypes"
        :title="'⏳ 倒计时列表'"
        :max-height="640"
        align-right
      >
        <template #content="{ node }">
          <div class="text-sm text-text">
            <span class="font-medium">{{ node.name }}</span>
            <span class="text-text-muted text-xs ml-2">截止日 {{ node.deadline }}</span>
            <span class="ml-1" :class="node.days >= 0 ? 'text-info' : 'text-danger'">
              {{ node.days >= 0 ? `距离该事件还有 ${node.days} 天` : `已经过去了 ${Math.abs(node.days)} 天` }}
            </span>
          </div>
        </template>
        <template #ops="{ node }">
          <div class="flex items-center gap-1.5">
            <button @click="openEditCountdown(countdownByKey(node.key))" class="bg-info hover:bg-blue-700 text-text-inverse px-2.5 py-0.5 rounded text-xs">编辑</button>
            <button @click="askDeleteCountdown(countdownByKey(node.key))" class="bg-danger hover:bg-red-700 text-text-inverse px-2.5 py-0.5 rounded text-xs">删除</button>
          </div>
        </template>
      </LeaveTimeline>
    </div>

    <!-- 新增/编辑活动弹窗 -->
    <AddActivityDialog
      v-if="actDialogMounted"
      :visible="actDialogVisible"
      :editing-record="editingActivity"
      @confirm="submitActivity"
      @update="updateActivity"
      @delete="rec => deleteActivity(rec?.id)"
      @cancel="actDialogVisible = false"
    />

    <!-- 新增/编辑倒计时弹窗 -->
    <AddCountdownDialog
      v-if="cntDialogMounted"
      :visible="cntDialogVisible"
      :editing-record="editingCountdown"
      @confirm="submitCountdown"
      @update="updateCountdown"
      @delete="rec => deleteCountdown(rec?.id)"
      @cancel="cntDialogVisible = false"
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

    <!-- 导出活动 -->
    <ExportExcel
      v-if="actExportMounted"
      :is-visible="actExportVisible"
      :rows="activityExportRows"
      :fields="activityExportFields"
      :selectedRowKeys="[]"
      :default-filename="'班级活动'"
      @export-finish="() => {}"
      @update:is-visible="actExportVisible = $event"
    />

    <!-- 导出倒计时 -->
    <ExportExcel
      v-if="cntExportMounted"
      :is-visible="cntExportVisible"
      :rows="countdownExportRows"
      :fields="countdownExportFields"
      :selectedRowKeys="[]"
      :default-filename="'倒计时'"
      @export-finish="() => {}"
      @update:is-visible="cntExportVisible = $event"
    />
  </div>
</template>

<script>
import axios from 'axios'
import { defineAsyncComponent, getCurrentInstance } from 'vue'
import Tabs from '../components/base/Tabs.vue'
import LeaveTimeline from '../components/base/LeaveTimeline.vue'
import { useNotification } from '../composables/useNotification.js'
import { recordRowInsert, recordRowUpdate, recordRowDelete, useUndoShortcut } from '../composables/useUndo.js'

const AddActivityDialog = defineAsyncComponent(() => import('../components/dialogs/AddActivityDialog.vue'))
const AddCountdownDialog = defineAsyncComponent(() => import('../components/dialogs/AddCountdownDialog.vue'))
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'))
const ExportExcel = defineAsyncComponent(() => import('../components/import-export/ExportExcel.vue'))

const API = '/api'

// 把 YYYY-MM-DD 字符串解析为本地时区日期（避免时区偏移造成天数差 1）
function parseDate(str) {
  if (!str) return null
  const parts = String(str).slice(0, 10).split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => isNaN(n))) return null
  return new Date(parts[0], parts[1] - 1, parts[2])
}

function todayDate() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// 活动状态：按「日期」对比今天（当天=进行中，未来=未开始，过去=已结束）
function activityStatus(time) {
  const d = parseDate(time)
  if (!d) return 'ended'
  const t = todayDate()
  if (d.getTime() > t.getTime()) return 'upcoming'
  if (d.getTime() === t.getTime()) return 'ongoing'
  return 'ended'
}

// 倒计时：返回与今天的自然日差（含符号，正=未来/还有, 负=已过去）
function countdownDays(deadline, includeDay) {
  const d = parseDate(deadline)
  if (!d) return 0
  let diff = Math.round((d.getTime() - todayDate().getTime()) / 86400000)
  if (includeDay) diff += 1
  return diff
}

export default {
  name: 'ActivitiesView',
  components: { Tabs, LeaveTimeline, AddActivityDialog, AddCountdownDialog, ConfirmDialog, ExportExcel },
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销、重做：活动与倒计时各自独立，按当前 tab 切换对应历史栈
  setup() {
    const inst = getCurrentInstance()
    const { success } = useNotification()
    const resolveKey = () => (inst.proxy.activeTab === 'countdown' ? 'countdowns' : 'activities')
    useUndoShortcut(resolveKey, {
      onAfterUndo: (label) => { inst.proxy.loadAll(); success(label ? `已撤销：${label}` : '已撤销') },
      onAfterRedo: (label) => { inst.proxy.loadAll(); success(label ? `已重做：${label}` : '已重做') }
    })
  },
  data() {
    return {
      activeTab: 'daily',
      loading: false,
      // 活动
      activities: [],
      editingActivity: null,
      actDialogVisible: false,
      actDialogMounted: false,
      actExportVisible: false,
      actExportMounted: false,
      // 倒计时
      countdowns: [],
      editingCountdown: null,
      cntDialogVisible: false,
      cntDialogMounted: false,
      cntExportVisible: false,
      cntExportMounted: false,
      // 通用确认
      confirm: { visible: false, message: '', ok: null },
      confirmMounted: false
    }
  },
  computed: {
    tabs() {
      return [
        { label: '日常活动', value: 'daily' },
        { label: '倒计时', value: 'countdown' }
      ]
    },
    // ---------- 活动 ----------
    activityMap() {
      const m = {}
      this.activities.forEach(a => { m[a.id] = a })
      return m
    },
    activityNodeTypes() {
      return [
        { value: 'upcoming', label: '未开始', colorKey: 'info', color: '#3b82f6' },
        { value: 'ongoing', label: '进行中', colorKey: 'success', color: '#16a34a' },
        { value: 'ended', label: '已结束', colorKey: 'muted', color: '#9ca3af' }
      ]
    },
    activityTimelineNodes() {
      return this.activities.slice()
        .filter(a => a.时间)
        .map(a => ({
          key: a.id,
          type: activityStatus(a.时间),
          time: this.displayTime(a.时间),
          text: a.主题 || '',
          subject: a.主题 || '',
          location: a.地点,
          participants: a.参与人员
        }))
    },
    activityExportRows() {
      return this.activities.map(a => ({
        时间: this.displayTime(a.时间),
        主题: a.主题 || '',
        地点: a.地点 || '',
        参与人员: a.参与人员 || '',
        简介: a.简介 || '',
        状态: this.statusLabel(activityStatus(a.时间))
      }))
    },
    activityExportFields() {
      return ['时间', '主题', '地点', '参与人员', '简介', '状态'].map(name => ({ name }))
    },
    // ---------- 倒计时 ----------
    daysMap() {
      const m = {}
      this.countdowns.forEach(c => { m[c.id] = countdownDays(c.截止日, !!c.包含这一天) })
      return m
    },
    sortedCountdowns() {
      return this.countdowns.slice().sort((a, b) => this.asTs(a.截止日) - this.asTs(b.截止日))
    },
    topCountdowns() {
      return this.sortedCountdowns.slice(0, 3).map(c => ({ ...c, days: this.daysMap[c.id] }))
    },
    countdownMap() {
      const m = {}
      this.countdowns.forEach(c => { m[c.id] = c })
      return m
    },
    countdownNodeTypes() {
      return [
        { value: 'future', label: '未到', colorKey: 'info', color: '#3b82f6' },
        { value: 'past', label: '已过', colorKey: 'muted', color: '#9ca3af' }
      ]
    },
    countdownTimelineNodes() {
      return this.sortedCountdowns.map(c => ({
        key: c.id,
        type: (this.daysMap[c.id] ?? 0) >= 0 ? 'future' : 'past',
        time: c.截止日,
        text: c.名称 || '',
        name: c.名称 || '',
        deadline: c.截止日,
        days: this.daysMap[c.id]
      }))
    },
    countdownExportRows() {
      return this.countdowns.map(c => {
        const days = this.daysMap[c.id]
        return {
          名称: c.名称 || '',
          截止日: c.截止日 || '',
          剩余天数: days >= 0 ? days : -Math.abs(days),
          状态: days >= 0 ? `还有 ${days} 天` : `已经过去 ${Math.abs(days)} 天`,
          包含截止日当天: c.包含这一天 ? '是' : '否'
        }
      })
    },
    countdownExportFields() {
      return ['名称', '截止日', '剩余天数', '状态', '包含截止日当天'].map(name => ({ name }))
    }
  },
  watch: {
    actDialogVisible(n) { if (n) this.actDialogMounted = true },
    cntDialogVisible(n) { if (n) this.cntDialogMounted = true },
    actExportVisible(n) { if (n) this.actExportMounted = true },
    cntExportVisible(n) { if (n) this.cntExportMounted = true },
    'confirm.visible'(n) { if (n) this.confirmMounted = true }
  },
  async created() {
    await this.loadAll()
  },
  methods: {
    async loadAll() {
      this.loading = true
      try {
        const [actRes, cntRes] = await Promise.all([
          axios.get(`${API}/activities`),
          axios.get(`${API}/countdowns`)
        ])
        this.activities = actRes.data.data || []
        this.countdowns = cntRes.data.data || []
      } catch (err) {
        useNotification().error('加载失败')
      } finally {
        this.loading = false
      }
    },
    async refreshActivities() {
      try { await this.loadAll(); useNotification().success('已刷新 班级活动 数据') } catch (err) { useNotification().error('刷新失败') }
    },
    async refreshCountdowns() {
      try { await this.loadAll(); useNotification().success('已刷新 倒计时 数据') } catch (err) { useNotification().error('刷新失败') }
    },
    // ---------- 活动 CRUD ----------
    openAddActivity() { this.editingActivity = null; this.actDialogVisible = true },
    openEditActivity(a) { this.editingActivity = a; this.actDialogVisible = true },
    activityByKey(key) { return this.activityMap[key] },
    async submitActivity(payload) {
      try {
        const res = await axios.post(`${API}/activities`, payload)
        recordRowInsert('activities', { id: res.data.id, ...payload })
        this.actDialogVisible = false
        useNotification().success('已新增活动')
        await this.loadAll()
      } catch (err) { useNotification().error(err.response?.data?.error || '保存失败') }
    },
    async updateActivity(payload) {
      const { id, ...fields } = payload
      const oldRow = this.activityMap[id]
      try {
        await axios.put(`${API}/activities/${id}`, fields)
        recordRowUpdate('activities', oldRow, { ...oldRow, ...fields, id })
        this.actDialogVisible = false
        useNotification().success('已保存')
        await this.loadAll()
      } catch (err) { useNotification().error(err.response?.data?.error || '保存失败') }
    },
    askDeleteActivity(a) {
      this.confirm = {
        visible: true,
        message: `确定删除活动「${a.主题 || '未命名活动'}」吗？`,
        ok: () => this.deleteActivity(a.id)
      }
    },
    async deleteActivity(id) {
      const row = this.activityMap[id]
      try {
        await axios.delete(`${API}/activities/${id}`)
        recordRowDelete('activities', row)
        this.confirm.visible = false
        useNotification().success('已删除')
        await this.loadAll()
      } catch (err) { useNotification().error(err.response?.data?.error || '删除失败') }
    },
    // ---------- 倒计时 CRUD ----------
    openAddCountdown() { this.editingCountdown = null; this.cntDialogVisible = true },
    openEditCountdown(c) { this.editingCountdown = c; this.cntDialogVisible = true },
    countdownByKey(key) { return this.countdownMap[key] },
    async submitCountdown(payload) {
      try {
        const res = await axios.post(`${API}/countdowns`, payload)
        recordRowInsert('countdowns', { id: res.data.id, ...payload })
        this.cntDialogVisible = false
        useNotification().success('已添加倒计时')
        await this.loadAll()
      } catch (err) { useNotification().error(err.response?.data?.error || '保存失败') }
    },
    async updateCountdown(payload) {
      const { id, ...fields } = payload
      const oldRow = this.countdownMap[id]
      try {
        await axios.put(`${API}/countdowns/${id}`, fields)
        recordRowUpdate('countdowns', oldRow, { ...oldRow, ...fields, id })
        this.cntDialogVisible = false
        useNotification().success('已保存')
        await this.loadAll()
      } catch (err) { useNotification().error(err.response?.data?.error || '保存失败') }
    },
    askDeleteCountdown(c) {
      this.confirm = {
        visible: true,
        message: `确定删除倒计时「${c.名称 || '未命名'}」吗？`,
        ok: () => this.deleteCountdown(c.id)
      }
    },
    async deleteCountdown(id) {
      const row = this.countdownMap[id]
      try {
        await axios.delete(`${API}/countdowns/${id}`)
        recordRowDelete('countdowns', row)
        this.confirm.visible = false
        useNotification().success('已删除')
        await this.loadAll()
      } catch (err) { useNotification().error(err.response?.data?.error || '删除失败') }
    },
    // ---------- 导出 ----------
    openActivityExport() { this.actExportVisible = true },
    openCountdownExport() { this.cntExportVisible = true },
    // ---------- 跳转 ----------
    goAlbum() {
      // 活动相册未独立设计前，跳转到学生相册页
      this.$router.push('/album')
    },
    // ---------- 工具 ----------
    asTs(str) {
      const parts = String(str || '').split(/[-T :]/).map(Number)
      if (parts.length < 3 || parts.slice(0, 3).some(n => isNaN(n))) return Infinity
      return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1, parts[3] || 0, parts[4] || 0).getTime()
    },
    displayTime(time) {
      if (!time) return ''
      return String(time).replace('T', ' ')
    },
    statusLabel(st) {
      return { upcoming: '未开始', ongoing: '进行中', ended: '已结束' }[st] || st
    }
  }
}
</script>