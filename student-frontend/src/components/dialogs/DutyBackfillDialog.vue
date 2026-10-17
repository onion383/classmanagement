<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="fixed inset-0 bg-black/40 z-[10004] flex items-center justify-center">
        <div class="bg-surface rounded-lg p-5 shadow-card dialog-card border border-border flex flex-col overflow-hidden" style="width: 760px; height: 660px; max-width: 92vw; max-height: 90vh;">
          <h3 class="text-lg font-bold mb-4 flex-shrink-0">补录记录</h3>

          <!-- 周切换：上一周 / 日期范围 / 下一周 / 周下拉框 -->
          <div class="flex-shrink-0">
            <WeekSwitcher
              :currentWeek="currentWeek"
              :weeks="weeks"
              @update:currentWeek="applyWeek"
            />
          </div>

          <!-- 一行：左侧当前第几周，右侧展开「增加周记录」表单的按钮 -->
          <div class="flex items-center justify-between mb-3 flex-shrink-0">
            <span class="font-semibold text-text">{{ weekLabel }}</span>
            <button @click="toggleForm" class="bg-primary text-text-inverse px-3 py-1.5 rounded text-sm">+ 增加周记录</button>
          </div>

          <!-- 增加周记录表单：周数与日期区间双向联动；提交后写库 -->
          <div v-if="formOpen" class="bg-surface-hover border border-border rounded p-3 mb-3 flex-shrink-0">
            <div class="flex items-center gap-3 mb-3">
              <span class="text-sm text-text w-20 shrink-0">选择周数</span>
              <input
                type="number"
                min="1"
                max="60"
                v-model.number="weekCount"
                @change="onWeekCountChange"
                class="border border-border bg-bg text-text px-3 py-2 rounded w-28"
              />
            </div>
            <div class="flex items-center gap-3 mb-3">
              <span class="text-sm text-text w-20 shrink-0">选择日期</span>
              <input
                type="date"
                v-model="startDate"
                @change="onDateChange"
                class="border border-border bg-bg text-text px-3 py-2 rounded"
              />
              <span class="text-text-muted">-</span>
              <input
                type="date"
                v-model="endDate"
                @change="onDateChange"
                class="border border-border bg-bg text-text px-3 py-2 rounded"
              />
            </div>
            <div class="flex justify-end gap-2">
              <button @click="formOpen = false" class="bg-surface px-4 py-2 rounded text-text border border-border">取消</button>
              <button @click="submitWeek" class="bg-primary text-text-inverse px-4 py-2 rounded">确定</button>
            </div>
          </div>

          <!-- 周明细表格：所选周 7 天，标注每天是否已有快照记录 -->
          <div class="flex-1 overflow-auto border border-border rounded min-h-0">
            <table class="w-full text-sm text-text">
              <thead>
                <tr class="bg-surface-hover text-text-muted sticky top-0">
                  <th class="px-3 py-2 text-left font-medium">日期</th>
                  <th class="px-3 py-2 text-left font-medium">星期</th>
                  <th class="px-3 py-2 text-left font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in dailyTableRows" :key="row.date" class="border-b border-border last:border-b-0">
                  <td class="px-3 py-2">{{ row.date }}</td>
                  <td class="px-3 py-2 text-text-muted">{{ row.weekday }}</td>
                  <td class="px-3 py-2" :class="row.recorded ? 'text-text' : 'text-text-muted'">
                    {{ row.recorded ? '已有记录' : '未记录' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex justify-end gap-2 flex-shrink-0 mt-4">
            <button @click="$emit('close')" class="bg-surface-hover px-4 py-2 rounded text-text border border-border">关闭</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script>
import '../../styles/dialog-transition.css'
import axios from 'axios'
import WeekSwitcher from '../base/WeekSwitcher.vue'
import { useNotification } from '../../composables/useNotification.js'
import { mondayOf, shiftDateStr, diffDays } from '../../utils/dateTime.js'

export default {
  name: 'DutyBackfillDialog',
  components: { WeekSwitcher },
  props: {
    visible: { type: Boolean, default: false },
    // 值日模式：daily 日常值日 / big 大扫除
    mode: { type: String, default: 'daily' }
  },
  emits: ['close', 'changed'],
  data() {
    return {
      // 周列表：元素含 week_start（该周周一）
      weeks: [],
      // 当前选中的周（该周周一，YYYY-MM-DD）
      currentWeek: '',
      // 「选择周数」输入值
      weekCount: null,
      // 日期区间输入值（始终被吸附为完整一周 周一~周日）
      startDate: '',
      endDate: '',
      // 增加周记录表单是否展开
      formOpen: false,
      // 当前周每天的记录（后端返回，元素含 snap_date）
      dailyRows: [],
      // 学期起始周的周一（用于周数换算）；学期未填日期时为空
      semesterMonday: ''
    }
  },
  computed: {
    weekLabel() {
      return this.weekCount ? `第${this.weekCount}周` : '第—周'
    },
    // 所选周的 7 天明细：日期 / 星期 / 是否已有记录
    dailyTableRows() {
      const base = this.currentWeek
      if (!base) return []
      const recorded = new Set((this.dailyRows || []).map(d => d && d.snap_date).filter(Boolean))
      const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
      const rows = []
      for (let i = 0; i < 7; i++) {
        const date = shiftDateStr(base, i)
        const day = new Date(`${date}T00:00:00`).getDay()
        rows.push({ date, weekday: WEEKDAYS[day] || '', recorded: recorded.has(date) })
      }
      return rows
    }
  },
  watch: {
    // 打开弹窗时才拉取数据
    visible(v) { if (v) this.onOpen() }
  },
  methods: {
    // 每次打开重置状态并加载周列表
    async onOpen() {
      this.formOpen = false
      this.dailyRows = []
      this.weekCount = null
      this.startDate = ''
      this.endDate = ''
      this.currentWeek = ''
      this.semesterMonday = ''
      await this.loadWeeks()
    },
    // 周列表：优先用当前学期的起止日期生成；学期没填日期则退化为历史快照的周列表
    async loadWeeks() {
      let list = []
      let semesterMonday = ''
      try {
        const res = await axios.get('/api/schedule/semesters')
        const cur = res.data && res.data.current
        const startDate = cur && cur.start_date
        const endDate = cur && cur.end_date
        if (startDate && endDate) {
          semesterMonday = mondayOf(startDate)
          const endMonday = mondayOf(endDate)
          let ws = semesterMonday
          let guard = 0
          // 从学期起始的周一算起，每周 +7 天，直到超过学期结束所在周（最多 60 周）
          while (ws && endMonday && ws <= endMonday && guard < 60) {
            list.push({ week_start: ws })
            ws = shiftDateStr(ws, 7)
            guard++
          }
        }
      } catch (e) { console.error(e) }

      if (!list.length) {
        // 学期未填日期：用历史快照的 week_start 列表（倒序返回，这里重排为升序）
        semesterMonday = ''
        try {
          const h = await axios.get(`/api/duty/history?mode=${this.mode}`)
          const arr = (h.data || []).map(w => w.week_start).filter(Boolean)
          arr.sort()
          list = Array.from(new Set(arr)).map(ws => ({ week_start: ws }))
        } catch (e) { console.error(e) }
      }

      this.semesterMonday = semesterMonday
      this.weeks = list

      // 默认选中「包含今天的周」，不在列表内则选第一项
      const d = new Date()
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const todayMonday = mondayOf(today)
      let def = ''
      if (this.weeks.some(w => w.week_start === todayMonday)) def = todayMonday
      else if (this.weeks.length) def = this.weeks[0].week_start

      this.applyWeek(def)
    },
    // 选中某一周：同步周数、日期区间，并拉取该周明细
    applyWeek(weekStart) {
      if (!weekStart) {
        this.currentWeek = ''
        this.startDate = ''
        this.endDate = ''
        this.dailyRows = []
        this.weekCount = null
        return
      }
      this.currentWeek = weekStart
      this.startDate = weekStart
      this.endDate = shiftDateStr(weekStart, 6)
      if (this.semesterMonday) {
        // 周数 = (该周周一 - 学期起始周一) / 7 + 1
        const n = Math.round(diffDays(this.semesterMonday, weekStart) / 7) + 1
        this.weekCount = n >= 1 ? n : null
      } else {
        const idx = this.weeks.findIndex(w => w.week_start === weekStart)
        this.weekCount = idx >= 0 ? idx + 1 : null
      }
      this.loadDaily()
    },
    // 拉取当前周每天的记录
    async loadDaily() {
      const from = this.currentWeek
      if (!from) { this.dailyRows = []; return }
      const to = shiftDateStr(from, 6)
      try {
        const res = await axios.get('/api/duty/daily', { params: { mode: this.mode, from, to } })
        this.dailyRows = Array.isArray(res.data) ? res.data : ((res.data && res.data.data) || [])
      } catch (e) {
        console.error(e)
        this.dailyRows = []
      }
    },
    toggleForm() { this.formOpen = !this.formOpen },
    // 周数 -> 日期：weekStart = 学期起始周一 + (N-1)*7，weekEnd = weekStart + 6
    onWeekCountChange() {
      let n = Math.round(Number(this.weekCount))
      if (!Number.isFinite(n)) n = 1
      const maxNo = this.weeks.length || 60
      n = Math.max(1, Math.min(maxNo, n))
      this.weekCount = n

      let weekStart = ''
      if (this.semesterMonday) weekStart = shiftDateStr(this.semesterMonday, (n - 1) * 7)
      else {
        const w = this.weeks[n - 1]
        weekStart = w ? w.week_start : ''
      }
      if (!weekStart) return

      this.currentWeek = weekStart
      this.startDate = weekStart
      this.endDate = shiftDateStr(weekStart, 6)
      this.loadDaily()
    },
    // 日期 -> 周数：以开始日期所在周的周一为准；结束日期跨到别的周时，默认改回「第一周」（即开始日期所在周）
    onDateChange() {
      let weekStart = mondayOf(this.startDate)
      if (!weekStart) {
        // 开始日期为空/非法时用结束日期兜底
        weekStart = mondayOf(this.endDate)
        if (!weekStart) return
      }
      this.startDate = weekStart
      this.endDate = shiftDateStr(weekStart, 6)
      this.currentWeek = weekStart
      // 学期已填开始日期时换算周数；未填则周数保持不变，只显示日期
      if (this.semesterMonday) {
        const n = Math.round(diffDays(this.semesterMonday, weekStart) / 7) + 1
        if (n >= 1) this.weekCount = n
      }
      this.loadDaily()
    },
    // 提交：把该周写入历史记录
    async submitWeek() {
      const weekStart = this.currentWeek || mondayOf(this.startDate)
      if (!weekStart) {
        useNotification().error('请先选择有效的周')
        return
      }
      try {
        const res = await axios.post('/api/duty/history/week', { week_start: weekStart, mode: this.mode })
        useNotification().success(res.data && res.data.message)
        this.formOpen = false
        await this.loadDaily()
        this.$emit('changed')
      } catch (err) {
        useNotification().error((err && err.response && err.response.data && err.response.data.error) || '增加周记录失败')
      }
    }
  }
}
</script>
