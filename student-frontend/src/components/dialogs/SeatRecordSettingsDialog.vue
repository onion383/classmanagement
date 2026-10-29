<template>
  <DialogShell :visible="visible" :z-index="10004" overlay-class="bg-black/40">
        <div class="bg-surface rounded-lg p-5 shadow-card dialog-card border border-border flex flex-col overflow-hidden" style="width: 720px; height: 640px; max-width: 92vw; max-height: 90vh;">
          <h3 class="text-lg font-bold mb-4">管理周座位记录</h3>

          <!-- 第一行：学期选择 + 学期日期范围 -->
          <div class="flex items-center gap-3 mb-3">
            <label class="text-sm font-medium whitespace-nowrap">选择学期</label>
            <div style="width: 220px;">
              <AppSelect v-model="semesterId" :options="semesterOptions" placeholder="请选择学期" />
            </div>
            <span v-if="semesterRangeText" class="text-xs text-text-muted">{{ semesterRangeText }}</span>
          </div>

          <!-- 周列表（可滚动）：学期内一组 + 学期外单独归到「未归入学期」 -->
          <div class="flex-1 overflow-auto border border-border rounded">
            <div v-if="loadingWeeks || loadingSemesters" class="text-xs text-text-muted p-3">加载中...</div>
            <div v-else-if="!inSemesterWeeks.length && !orphanWeeks.length" class="text-xs text-text-muted p-3">该学期暂无周记录</div>
            <div v-else>
              <!-- 学期范围内的周 -->
              <div
                v-for="w in inSemesterWeeks"
                :key="w.week_start"
                class="flex items-center gap-3 px-3 py-2 border-b border-border last:border-b-0"
              >
                <span class="font-medium text-text w-20">{{ weekLabel(w.week_start) }}</span>
                <span class="text-text">{{ weekRangeText(w.week_start) }}</span>
                <span class="text-xs text-text-muted">{{ w.count }}天数据</span>
                <button
                  @click="openDeleteConfirm(w)"
                  :disabled="deletingWeek === w.week_start"
                  class="ml-auto bg-danger text-text-inverse px-3 py-1 rounded disabled:opacity-40"
                >删除</button>
              </div>

              <!-- 学期范围外的周：不因改学期起止日期而“消失”，单独分组仍可查看/删除 -->
              <template v-if="orphanWeeks.length">
                <div class="px-3 py-2 text-xs font-medium text-text-muted bg-surface-hover border-b border-border">
                  未归入学期（{{ orphanWeeks.length }}）
                </div>
                <div
                  v-for="w in orphanWeeks"
                  :key="w.week_start"
                  class="flex items-center gap-3 px-3 py-2 border-b border-border last:border-b-0"
                >
                  <span class="font-medium text-text-muted w-20">学期外</span>
                  <span class="text-text">{{ weekRangeText(w.week_start) }}</span>
                  <span class="text-xs text-text-muted">{{ w.count }}天数据</span>
                  <button
                    @click="openDeleteConfirm(w)"
                    :disabled="deletingWeek === w.week_start"
                    class="ml-auto bg-danger text-text-inverse px-3 py-1 rounded disabled:opacity-40"
                  >删除</button>
                </div>
              </template>
            </div>
          </div>

          <!-- 底部：关闭 -->
          <div class="flex justify-end gap-2 mt-4">
            <button @click="$emit('close')" class="bg-surface-hover px-4 py-2 rounded text-text border border-border">关闭</button>
          </div>

          <!-- 删除确认 -->
          <ConfirmDialog
            :visible="confirmVisible"
            title="删除周记录"
            :message="confirmMessage"
            confirm-text="删除"
            cancel-text="取消"
            :show-cancel="true"
            @confirm="confirmDelete"
            @cancel="cancelDelete"
          />
        </div>
  </DialogShell>
</template>

<script setup>
// 管理周座位记录弹窗：按学期查看/删除座位历史快照（每周一条记录）。
// 学期下拉用于在前端过滤周列表，不改变全局当前学期。
import axios from 'axios'
import { ref, computed, watch } from 'vue'
import '../../styles/dialog-transition.css'
import DialogShell from '../base/DialogShell.vue'
import AppSelect from '../base/AppSelect.vue'
import ConfirmDialog from '../base/ConfirmDialog.vue'
import { useNotification } from '../../composables/useNotification.js'
import { mondayOf, shiftDateStr, diffDays } from '../../utils/dateTime.js'

defineOptions({ name: 'SeatRecordSettingsDialog' })

const props = defineProps({
  visible: { type: Boolean, default: false }
})
defineEmits(['close'])

const semesters = ref([])
const semesterId = ref('')
const weeks = ref([])
const loadingSemesters = ref(false)
const loadingWeeks = ref(false)
// 正在删除的周（周一日期字符串），用于禁用对应行按钮
const deletingWeek = ref('')
const confirmVisible = ref(false)
const pendingDeleteWeek = ref('')

const selectedSemester = computed(() => semesters.value.find(s => s.id === semesterId.value) || null)
const semesterOptions = computed(() => semesters.value.map(s => ({ value: s.id, label: s.name })))
// 学期日期范围，格式 2026.9.1-2027.1.31；无日期时为空
const semesterRangeText = computed(() => {
  const s = selectedSemester.value
  if (!s || !s.start_date || !s.end_date) return ''
  return `${fmtDot(s.start_date)}-${fmtDot(s.end_date)}`
})
// 按所选学期过滤周列表：学期有起止日期时拆成「学期内」与「学期外（未归入学期）」两组，否则全部视为学期内
const inSemesterWeeks = computed(() => {
  const s = selectedSemester.value
  if (!s || !s.start_date || !s.end_date) return weeks.value
  const startMon = mondayOf(s.start_date)
  const endMon = mondayOf(s.end_date)
  return weeks.value.filter(w => w.week_start >= startMon && w.week_start <= endMon)
})
// 学期范围之外的周记录：改学期起止日期后可能产生，单独分组展示，避免“记录凭空消失”
const orphanWeeks = computed(() => {
  const s = selectedSemester.value
  if (!s || !s.start_date || !s.end_date) return []
  const startMon = mondayOf(s.start_date)
  const endMon = mondayOf(s.end_date)
  return weeks.value.filter(w => w.week_start < startMon || w.week_start > endMon)
})
const confirmMessage = computed(() => {
  const week = pendingDeleteWeek.value
  if (!week) return ''
  return `确定删除 ${weekRangeText(week)} 这一周的座位记录吗？删除后不可恢复。`
})

watch(() => props.visible, (val) => {
  if (val) onOpen()
})

// 打开弹窗：拉取学期列表 + 周列表
async function onOpen() {
  deletingWeek.value = ''
  confirmVisible.value = false
  pendingDeleteWeek.value = ''
  await loadSemesters()
  await loadWeeks()
}
// 学期列表：默认选中 current
async function loadSemesters() {
  loadingSemesters.value = true
  try {
    const { data } = await axios.get('/api/schedule/semesters')
    semesters.value = (data && data.semesters) || []
    const cur = (data && data.current) || semesters.value.find(s => s.is_current) || semesters.value[0] || null
    semesterId.value = cur ? cur.id : ''
  } catch (_) {
    semesters.value = []
    semesterId.value = ''
  } finally {
    loadingSemesters.value = false
  }
}
// 周列表：座位历史快照，每条含 week_start / count 等
async function loadWeeks() {
  loadingWeeks.value = true
  try {
    const res = await axios.get('/api/seats/history')
    weeks.value = res.data || []
  } catch (_) {
    weeks.value = []
  } finally {
    loadingWeeks.value = false
  }
}
// YYYY-MM-DD -> Y.M.D（点号分隔、不补零）
function fmtDot(dateStr) {
  const s = String(dateStr || '').slice(0, 10)
  const parts = s.split('-')
  if (parts.length !== 3) return s
  return `${Number(parts[0])}.${Number(parts[1])}.${Number(parts[2])}`
}
// 周序号：所选学期开始周的周一为第 1 周
function weekLabel(weekStart) {
  const s = selectedSemester.value
  if (!s || !s.start_date) return '学期外'
  const startMon = mondayOf(s.start_date)
  const diff = diffDays(startMon, weekStart)
  if (diff % 7 !== 0) return '学期外'
  const num = diff / 7 + 1
  if (num >= 1) return `第${num}周`
  return '学期前'
}
// 周日期范围：week_start ~ week_start+6 天
function weekRangeText(weekStart) {
  return `${fmtDot(weekStart)}-${fmtDot(shiftDateStr(weekStart, 6))}`
}
function openDeleteConfirm(week) {
  pendingDeleteWeek.value = week.week_start
  confirmVisible.value = true
}
function cancelDelete() {
  confirmVisible.value = false
  pendingDeleteWeek.value = ''
}
// 确认删除：调 DELETE 后重新拉取周列表
async function confirmDelete() {
  const week = pendingDeleteWeek.value
  if (!week) return
  deletingWeek.value = week
  confirmVisible.value = false
  try {
    await axios.delete(`/api/seats/history/${week}`)
    useNotification().success('已删除该周记录')
    await loadWeeks()
  } catch (err) {
    useNotification().error(err && err.response && err.response.data && err.response.data.error || '删除失败')
  } finally {
    deletingWeek.value = ''
    pendingDeleteWeek.value = ''
  }
}
</script>
