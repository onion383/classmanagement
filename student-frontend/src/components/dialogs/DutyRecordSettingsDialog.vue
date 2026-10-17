<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="fixed inset-0 bg-black/40 z-[10004] flex items-center justify-center">
        <div class="bg-surface rounded-lg p-5 shadow-card dialog-card border border-border flex flex-col overflow-hidden" style="width: 720px; height: 640px; max-width: 92vw; max-height: 90vh;">
          <h3 class="text-lg font-bold mb-4">管理周值日记录</h3>

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
      </div>
    </Transition>
  </Teleport>
</template>

<script>
// 管理周值日记录弹窗：按学期查看/删除值日历史快照（每周一条记录）。
// 学期下拉用于在前端过滤周列表，不改变全局当前学期。mode 区分日常值日 / 大扫除。
import axios from 'axios'
import '../../styles/dialog-transition.css'
import AppSelect from '../base/AppSelect.vue'
import ConfirmDialog from '../base/ConfirmDialog.vue'
import { useNotification } from '../../composables/useNotification.js'
import { mondayOf, shiftDateStr, diffDays } from '../../utils/dateTime.js'

export default {
  name: 'DutyRecordSettingsDialog',
  components: { AppSelect, ConfirmDialog },
  props: {
    visible: { type: Boolean, default: false },
    // 值日模式：daily 日常值日 / big 大扫除
    mode: { type: String, default: 'daily' }
  },
  emits: ['close'],
  data() {
    return {
      semesters: [],
      semesterId: '',
      weeks: [],
      loadingSemesters: false,
      loadingWeeks: false,
      // 正在删除的周（周一日期字符串），用于禁用对应行按钮
      deletingWeek: '',
      confirmVisible: false,
      pendingDeleteWeek: ''
    }
  },
  computed: {
    selectedSemester() {
      return this.semesters.find(s => s.id === this.semesterId) || null
    },
    semesterOptions() {
      return this.semesters.map(s => ({ value: s.id, label: s.name }))
    },
    // 学期日期范围，格式 2026.9.1-2027.1.31；无日期时为空
    semesterRangeText() {
      const s = this.selectedSemester
      if (!s || !s.start_date || !s.end_date) return ''
      return `${this.fmtDot(s.start_date)}-${this.fmtDot(s.end_date)}`
    },
    // 按所选学期过滤周列表：学期有起止日期时拆成「学期内」与「学期外（未归入学期）」两组，否则全部视为学期内
    inSemesterWeeks() {
      const s = this.selectedSemester
      if (!s || !s.start_date || !s.end_date) return this.weeks
      const startMon = mondayOf(s.start_date)
      const endMon = mondayOf(s.end_date)
      return this.weeks.filter(w => w.week_start >= startMon && w.week_start <= endMon)
    },
    // 学期范围之外的周记录：改学期起止日期后可能产生，单独分组展示，避免“记录凭空消失”
    orphanWeeks() {
      const s = this.selectedSemester
      if (!s || !s.start_date || !s.end_date) return []
      const startMon = mondayOf(s.start_date)
      const endMon = mondayOf(s.end_date)
      return this.weeks.filter(w => w.week_start < startMon || w.week_start > endMon)
    },
    confirmMessage() {
      const week = this.pendingDeleteWeek
      if (!week) return ''
      return `确定删除 <b>${this.weekRangeText(week)}</b> 这一周的值日记录吗？删除后不可恢复。`
    }
  },
  watch: {
    visible(val) {
      if (val) this.onOpen()
    }
  },
  methods: {
    // 打开弹窗：拉取学期列表 + 周列表
    async onOpen() {
      this.deletingWeek = ''
      this.confirmVisible = false
      this.pendingDeleteWeek = ''
      await this.loadSemesters()
      await this.loadWeeks()
    },
    // 学期列表：默认选中 current
    async loadSemesters() {
      this.loadingSemesters = true
      try {
        const { data } = await axios.get('/api/schedule/semesters')
        this.semesters = (data && data.semesters) || []
        const cur = (data && data.current) || this.semesters.find(s => s.is_current) || this.semesters[0] || null
        this.semesterId = cur ? cur.id : ''
      } catch (_) {
        this.semesters = []
        this.semesterId = ''
      } finally {
        this.loadingSemesters = false
      }
    },
    // 周列表：值日历史快照，每条含 week_start / count 等
    async loadWeeks() {
      this.loadingWeeks = true
      try {
        const res = await axios.get(`/api/duty/history?mode=${this.mode}`)
        this.weeks = res.data || []
      } catch (_) {
        this.weeks = []
      } finally {
        this.loadingWeeks = false
      }
    },
    // YYYY-MM-DD -> Y.M.D（点号分隔、不补零）
    fmtDot(dateStr) {
      const s = String(dateStr || '').slice(0, 10)
      const parts = s.split('-')
      if (parts.length !== 3) return s
      return `${Number(parts[0])}.${Number(parts[1])}.${Number(parts[2])}`
    },
    // 周序号：所选学期开始周的周一为第 1 周
    weekLabel(weekStart) {
      const s = this.selectedSemester
      if (!s || !s.start_date) return '学期外'
      const startMon = mondayOf(s.start_date)
      const diff = diffDays(startMon, weekStart)
      if (diff % 7 !== 0) return '学期外'
      const num = diff / 7 + 1
      if (num >= 1) return `第${num}周`
      return '学期前'
    },
    // 周日期范围：week_start ~ week_start+6 天
    weekRangeText(weekStart) {
      return `${this.fmtDot(weekStart)}-${this.fmtDot(shiftDateStr(weekStart, 6))}`
    },
    openDeleteConfirm(week) {
      this.pendingDeleteWeek = week.week_start
      this.confirmVisible = true
    },
    cancelDelete() {
      this.confirmVisible = false
      this.pendingDeleteWeek = ''
    },
    // 确认删除：调 DELETE 后重新拉取周列表
    async confirmDelete() {
      const week = this.pendingDeleteWeek
      if (!week) return
      this.deletingWeek = week
      this.confirmVisible = false
      try {
        await axios.delete(`/api/duty/history/${week}?mode=${this.mode}`)
        useNotification().success('已删除该周记录')
        await this.loadWeeks()
      } catch (err) {
        useNotification().error(err && err.response && err.response.data && err.response.data.error || '删除失败')
      } finally {
        this.deletingWeek = ''
        this.pendingDeleteWeek = ''
      }
    }
  }
}
</script>
