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
      <div class="mb-4 flex items-center gap-3 opbar">
        <button v-preload="loadAddActivityDialog" @click="openAddActivity" class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded transition-theme">＋ 新增活动</button>
        <button @click="refreshActivities" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1 btn-refresh transition-theme"><IconGlyph name="refresh" :size="14" tint="current" /> 刷新</button>
        <button v-preload="loadExportExcel" @click="openActivityExport" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1 transition-theme">📥 导出活动</button>
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
            <button @click="openEditActivity(activityByKey(node.key))" class="bg-info hover:bg-blue-700 text-text-inverse px-2.5 py-0.5 rounded text-xs transition-theme">编辑</button>
            <button @click="goAlbum" class="bg-surface-hover hover:bg-border text-text-secondary px-2.5 py-0.5 rounded text-xs border border-border transition-theme">查看相册</button>
            <button @click="askDeleteActivity(activityByKey(node.key))" class="bg-danger hover:bg-red-700 text-text-inverse px-2.5 py-0.5 rounded text-xs transition-theme">删除</button>
          </div>
        </template>
      </LeaveTimeline>
    </div>

    <!-- ==================== 倒计时 ==================== -->
    <div v-if="activeTab === 'countdown'">
      <!-- 数据看板（最近 3 个） -->
      <div v-if="topCountdowns.length" class="grid grid-cols-3 gap-4 mb-6">
        <div v-for="cd in topCountdowns" :key="cd.id" class="bg-surface shadow-md rounded-xl border border-border p-4 text-center" :class="{ 'opacity-70': cd.days < 0 }">
          <div class="text-sm text-text-secondary truncate">距离 {{ cd.名称 }}</div>
          <div class="text-4xl font-bold mt-1" :class="cd.days >= 0 ? 'text-info' : 'text-text-muted'">{{ Math.abs(cd.days) }}</div>
          <div class="text-sm text-text-secondary">{{ cd.days >= 0 ? '还有 ' + cd.days + ' 天' : '天（已过去）' }}</div>
          <div class="text-xs text-text-muted mt-1">截止 {{ cd.截止日 }}</div>
        </div>
      </div>
      <div v-else class="bg-surface border border-border rounded-xl py-8 text-center text-text-muted text-sm mb-6">暂无倒计时，点击「添加倒计时」开始</div>

      <!-- 工具栏 -->
      <div class="mb-4 flex items-center gap-3 opbar">
        <button v-preload="loadAddCountdownDialog" @click="openAddCountdown" class="bg-primary hover:bg-primary-hover text-text-inverse px-5 py-2 rounded transition-theme">＋ 添加倒计时</button>
        <button @click="refreshCountdowns" class="bg-text-muted hover:bg-text-secondary text-text-inverse px-4 py-2 rounded flex items-center gap-1 btn-refresh transition-theme">🔄 刷新</button>
        <button v-preload="loadExportExcel" @click="openCountdownExport" class="bg-warning hover:bg-warning-hover text-text-inverse px-4 py-2 rounded flex items-center gap-1 transition-theme"><IconGlyph name="download" :size="14" tint="current" /> 导出 EXCEL 表格</button>
      </div>

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
            <button @click="openEditCountdown(countdownByKey(node.key))" class="bg-info hover:bg-blue-700 text-text-inverse px-2.5 py-0.5 rounded text-xs transition-theme">编辑</button>
            <button @click="askDeleteCountdown(countdownByKey(node.key))" class="bg-danger hover:bg-red-700 text-text-inverse px-2.5 py-0.5 rounded text-xs transition-theme">删除</button>
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

<script setup>
import axios from 'axios'
import { ref, computed, watch, onMounted, onActivated, defineAsyncComponent, getCurrentInstance } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Tabs from '../components/base/Tabs.vue'
import LeaveTimeline from '../components/base/LeaveTimeline.vue'
import { useNotification } from '../composables/useNotification.js'
import { reportError } from '../utils/reportError.js'
import { recordRowInsert, recordRowUpdate, recordRowDelete, useUndoShortcut } from '../composables/useUndo.js'
import { applyRouteRowFocus } from '../composables/useRowFocus.js'

defineOptions({ name: 'ActivitiesView' })

const loadAddActivityDialog = () => import('../components/dialogs/AddActivityDialog.vue')
const AddActivityDialog = defineAsyncComponent(loadAddActivityDialog)
const loadAddCountdownDialog = () => import('../components/dialogs/AddCountdownDialog.vue')
const AddCountdownDialog = defineAsyncComponent(loadAddCountdownDialog)
const ConfirmDialog = defineAsyncComponent(() => import('../components/base/ConfirmDialog.vue'))
const loadExportExcel = () => import('../components/import-export/ExportExcel/ExportExcel.vue')
const ExportExcel = defineAsyncComponent(loadExportExcel)

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

const route = useRoute()
const router = useRouter()
// applyRouteRowFocus 的 host 契约：需要 $route/$router/$el 且对象身份稳定（内部按 host 记签名）
const inst = getCurrentInstance()

const activeTab = ref('daily')
const loading = ref(false)
// 活动
const activities = ref([])
const editingActivity = ref(null)
const actDialogVisible = ref(false)
const actDialogMounted = ref(false)
const actExportVisible = ref(false)
const actExportMounted = ref(false)
// 倒计时
const countdowns = ref([])
const editingCountdown = ref(null)
const cntDialogVisible = ref(false)
const cntDialogMounted = ref(false)
const cntExportVisible = ref(false)
const cntExportMounted = ref(false)
// 通用确认
const confirm = ref({ visible: false, message: '', ok: null })
const confirmMounted = ref(false)

const tabs = computed(() => [
  { label: '日常活动', value: 'daily' },
  { label: '倒计时', value: 'countdown' }
])
// ---------- 活动 ----------
const activityMap = computed(() => {
  const m = {}
  activities.value.forEach(a => { m[a.id] = a })
  return m
})
const activityNodeTypes = computed(() => [
  { value: 'upcoming', label: '未开始', colorKey: 'info', color: '#3b82f6' },
  { value: 'ongoing', label: '进行中', colorKey: 'success', color: '#16a34a' },
  { value: 'ended', label: '已结束', colorKey: 'muted', color: '#9ca3af' }
])
const activityTimelineNodes = computed(() => activities.value.slice()
  .filter(a => a.时间)
  .map(a => ({
    key: a.id,
    type: activityStatus(a.时间),
    time: displayTime(a.时间),
    text: a.主题 || '',
    subject: a.主题 || '',
    location: a.地点,
    participants: a.参与人员
  })))
const activityExportRows = computed(() => activities.value.map(a => ({
  时间: displayTime(a.时间),
  主题: a.主题 || '',
  地点: a.地点 || '',
  参与人员: a.参与人员 || '',
  简介: a.简介 || '',
  状态: statusLabel(activityStatus(a.时间))
})))
const activityExportFields = computed(() => ['时间', '主题', '地点', '参与人员', '简介', '状态'].map(name => ({ name })))
// ---------- 倒计时 ----------
const daysMap = computed(() => {
  const m = {}
  countdowns.value.forEach(c => { m[c.id] = countdownDays(c.截止日, !!c.包含这一天) })
  return m
})
const sortedCountdowns = computed(() => countdowns.value.slice().sort((a, b) => asTs(a.截止日) - asTs(b.截止日)))
const topCountdowns = computed(() => sortedCountdowns.value.slice(0, 3).map(c => ({ ...c, days: daysMap.value[c.id] })))
const countdownMap = computed(() => {
  const m = {}
  countdowns.value.forEach(c => { m[c.id] = c })
  return m
})
const countdownNodeTypes = computed(() => [
  { value: 'future', label: '未到', colorKey: 'info', color: '#3b82f6' },
  { value: 'past', label: '已过', colorKey: 'muted', color: '#9ca3af' }
])
const countdownTimelineNodes = computed(() => sortedCountdowns.value.map(c => ({
  key: c.id,
  type: (daysMap.value[c.id] ?? 0) >= 0 ? 'future' : 'past',
  time: c.截止日,
  text: c.名称 || '',
  name: c.名称 || '',
  deadline: c.截止日,
  days: daysMap.value[c.id]
})))
const countdownExportRows = computed(() => countdowns.value.map(c => {
  const days = daysMap.value[c.id]
  return {
    名称: c.名称 || '',
    截止日: c.截止日 || '',
    剩余天数: days >= 0 ? days : -Math.abs(days),
    状态: days >= 0 ? `还有 ${days} 天` : `已经过去 ${Math.abs(days)} 天`,
    包含截止日当天: c.包含这一天 ? '是' : '否'
  }
}))
const countdownExportFields = computed(() => ['名称', '截止日', '剩余天数', '状态', '包含截止日当天'].map(name => ({ name })))

// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 撤销、重做：活动与倒计时各自独立，按当前 tab 切换对应历史栈
const { success } = useNotification()
const resolveKey = () => (activeTab.value === 'countdown' ? 'countdowns' : 'activities')
useUndoShortcut(resolveKey, {
  onAfterUndo: (label) => { loadAll(); success(label ? `已撤销：${label}` : '已撤销') },
  onAfterRedo: (label) => { loadAll(); success(label ? `已重做：${label}` : '已重做') }
})

watch(actDialogVisible, (n) => { if (n) actDialogMounted.value = true })
watch(cntDialogVisible, (n) => { if (n) cntDialogMounted.value = true })
watch(actExportVisible, (n) => { if (n) actExportMounted.value = true })
watch(cntExportVisible, (n) => { if (n) cntExportMounted.value = true })
watch(() => confirm.value.visible, (n) => { if (n) confirmMounted.value = true })
// 跨页定位：标题栏全局搜索点「班级活动 / 倒计时」结果跳转 /activities?focus=<id>
watch(() => route.query.focus, () => { _applyRowFocus() })
// 桌面小组件点倒计时：/activities?tab=countdown 直达倒计时页签
watch(() => route.query.tab, () => { _applyTabQuery() })
// 页签反向同步到 URL：用户手动切回「日常活动」后，组件再点倒计时仍能重新跳转
// （否则 URL 一直停在 ?tab=countdown，主窗口收到同路径导航时就无法区分当前页签）
watch(activeTab, (val) => {
  if (route.path !== '/activities') return
  const next = { ...route.query }
  if (val === 'countdown') next.tab = 'countdown'
  else delete next.tab
  if ((next.tab || '') === (route.query.tab || '')) return
  router.replace({ path: route.path, query: next }).catch(() => {})
})

// 与原 created() 等价：发起加载但不阻塞渲染（Vue 本就不等待 async created）
loadAll()

onMounted(() => { _applyRowFocus(); _applyTabQuery() })
onActivated(() => { _applyRowFocus(); _applyTabQuery() })

function _applyTabQuery() {
  const tab = route.query.tab
  if (tab === 'daily' || tab === 'countdown') activeTab.value = tab
}
// 跨页定位：活动/倒计时共用本页。倒计时结果带 countdown: 前缀，先切到倒计时页签再定位。
function _applyRowFocus() {
  applyRouteRowFocus(inst.proxy, {
    parse: (key) => {
      if (key.startsWith('countdown:')) {
        activeTab.value = 'countdown'
        return key.slice('countdown:'.length)
      }
      activeTab.value = 'daily'
      return key
    }
  })
}
async function loadAll() {
  loading.value = true
  try {
    // 两个接口互不依赖：用 allSettled，避免「倒计时失败」把已经拿到的
    // 「活动列表」一起丢掉（原来 Promise.all 一处 reject 整批作废）。
    const [actRes, cntRes] = await Promise.allSettled([
      axios.get(`${API}/activities`),
      axios.get(`${API}/countdowns`)
    ])
    if (actRes.status === 'fulfilled') activities.value = actRes.value.data.data || []
    if (cntRes.status === 'fulfilled') countdowns.value = cntRes.value.data.data || []

    const failed = []
    if (actRes.status === 'rejected') failed.push('活动')
    if (cntRes.status === 'rejected') failed.push('倒计时')
    if (!failed.length) return true
    // 两处都失败只弹一条，文案带上失败范围，避免刷两条提示
    const reason = (actRes.status === 'rejected' ? actRes : cntRes).reason
    reportError(reason, { action: `加载${failed.join('与')}` })
    return false
  } finally {
    loading.value = false
  }
}
async function refreshActivities() {
  // 按返回值判断：loadAll 内部吞错时无条件提示成功，会让用户以为数据已是最新
  if (await loadAll()) useNotification().success('已刷新 班级活动 数据')
}
async function refreshCountdowns() {
  if (await loadAll()) useNotification().success('已刷新 倒计时 数据')
}
// ---------- 活动 CRUD ----------
function openAddActivity() { editingActivity.value = null; actDialogVisible.value = true }
function openEditActivity(a) { editingActivity.value = a; actDialogVisible.value = true }
function activityByKey(key) { return activityMap.value[key] }
async function submitActivity(payload) {
  try {
    const res = await axios.post(`${API}/activities`, payload)
    recordRowInsert('activities', { id: res.data.id, ...payload })
    actDialogVisible.value = false
    useNotification().success('已新增活动')
    await loadAll()
  } catch (err) { reportError(err, { action: '保存' }) }
}
async function updateActivity(payload) {
  const { id, ...fields } = payload
  const oldRow = activityMap.value[id]
  try {
    await axios.put(`${API}/activities/${id}`, fields)
    recordRowUpdate('activities', oldRow, { ...oldRow, ...fields, id })
    actDialogVisible.value = false
    useNotification().success('已保存')
    await loadAll()
  } catch (err) { reportError(err, { action: '保存' }) }
}
function askDeleteActivity(a) {
  confirm.value = {
    visible: true,
    message: `确定删除活动「${a.主题 || '未命名活动'}」吗？`,
    ok: () => deleteActivity(a.id)
  }
}
async function deleteActivity(id) {
  const row = activityMap.value[id]
  try {
    await axios.delete(`${API}/activities/${id}`)
    recordRowDelete('activities', row)
    confirm.value.visible = false
    useNotification().success('已删除')
    await loadAll()
  } catch (err) { reportError(err, { action: '删除' }) }
}
// ---------- 倒计时 CRUD ----------
function openAddCountdown() { editingCountdown.value = null; cntDialogVisible.value = true }
function openEditCountdown(c) { editingCountdown.value = c; cntDialogVisible.value = true }
function countdownByKey(key) { return countdownMap.value[key] }
async function submitCountdown(payload) {
  try {
    const res = await axios.post(`${API}/countdowns`, payload)
    recordRowInsert('countdowns', { id: res.data.id, ...payload })
    cntDialogVisible.value = false
    useNotification().success('已添加倒计时')
    await loadAll()
  } catch (err) { reportError(err, { action: '保存' }) }
}
async function updateCountdown(payload) {
  const { id, ...fields } = payload
  const oldRow = countdownMap.value[id]
  try {
    await axios.put(`${API}/countdowns/${id}`, fields)
    recordRowUpdate('countdowns', oldRow, { ...oldRow, ...fields, id })
    cntDialogVisible.value = false
    useNotification().success('已保存')
    await loadAll()
  } catch (err) { reportError(err, { action: '保存' }) }
}
function askDeleteCountdown(c) {
  confirm.value = {
    visible: true,
    message: `确定删除倒计时「${c.名称 || '未命名'}」吗？`,
    ok: () => deleteCountdown(c.id)
  }
}
async function deleteCountdown(id) {
  const row = countdownMap.value[id]
  try {
    await axios.delete(`${API}/countdowns/${id}`)
    recordRowDelete('countdowns', row)
    confirm.value.visible = false
    useNotification().success('已删除')
    await loadAll()
  } catch (err) { reportError(err, { action: '删除' }) }
}
// ---------- 导出 ----------
// 导出活动/倒计时：无数据时直接提示，不弹导出选项弹窗
function openActivityExport() {
  if (activityExportRows.value.length === 0) return useNotification().info('暂无活动可导出')
  actExportVisible.value = true
}
function openCountdownExport() {
  if (countdownExportRows.value.length === 0) return useNotification().info('暂无倒计时可导出')
  cntExportVisible.value = true
}
// ---------- 跳转 ----------
function goAlbum() {
  // 活动相册未独立设计前，跳转到班级相册页
  router.push('/album')
}
// ---------- 工具 ----------
function asTs(str) {
  const parts = String(str || '').split(/[-T :]/).map(Number)
  if (parts.length < 3 || parts.slice(0, 3).some(n => isNaN(n))) return Infinity
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1, parts[3] || 0, parts[4] || 0).getTime()
}
function displayTime(time) {
  if (!time) return ''
  return String(time).replace('T', ' ')
}
function statusLabel(st) {
  return { upcoming: '未开始', ongoing: '进行中', ended: '已结束' }[st] || st
}
</script>
