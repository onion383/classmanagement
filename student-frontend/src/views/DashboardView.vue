<template>
  <div class="dashboard-page">
    <!-- 顶部信息行：左班级大字，右关键数据 -->
    <div class="welcome-card bg-surface shadow-md rounded-xl mb-6 px-6 py-5 border border-border">
      <div class="flex items-center justify-between gap-6">
        <div class="flex items-center gap-3 min-w-0">
          <IconGlyph name="home" :size="30" />
          <h1 class="text-2xl font-bold text-text truncate">
            <ClippedText :text="classInfo.name" :max="18" title="班级名称" />
          </h1>
          <button class="class-gear" title="设置班名/口号/班风/学风" @click="openClassModal">
            <IconGlyph name="settings" :size="20" tint="current" />
          </button>
        </div>
        <div class="flex items-center gap-4 shrink-0">
          <div class="flex items-baseline gap-1.5">
            <span class="text-lg font-bold text-text leading-none">{{ attendance.present }}</span>
            <span class="text-xs text-text-muted">在校</span>
          </div>
          <div class="w-px h-6 bg-border"></div>
          <div class="flex items-baseline gap-1.5">
            <span class="text-lg font-bold text-warning leading-none">{{ attendance.onLeave }}</span>
            <span class="text-xs text-text-muted">请假</span>
          </div>
          <div class="w-px h-6 bg-border"></div>
          <div class="flex items-baseline gap-1.5">
            <span class="text-lg font-bold text-primary leading-none">{{ todayCourseCount }}</span>
            <span class="text-xs text-text-muted">课程</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 班级信息大框：时间 / 班级班风 / 倒计时 三部分 -->
    <div class="class-info-card">
      <!-- 第一部分：时钟（汇总小组件逐字符动画） -->
      <div class="info-part clock-part">
        <AnimatedClock
          style="--ac-time-size:40px; --ac-date-size:14px; --ac-time-color:#111827;"
          date-format="星期{W} {Y}-{M}-{D}"
        />
      </div>
      <div class="info-divider"></div>

      <!-- 第二部分：班级信息（超长文本可点击查看完整） -->
      <div class="info-part class-part">
        <div class="class-name"><ClippedText :text="classInfo.name" :max="12" title="班级名称" /></div>
        <div class="class-lines">
          <div class="class-line"><span class="line-label">班级口号：</span><ClippedText :text="classInfo.motto" title="班级口号" /></div>
          <div class="class-line"><span class="line-label">班风：</span><ClippedText :text="classInfo.mottoStyle" title="班风" /></div>
          <div class="class-line"><span class="line-label">学风：</span><ClippedText :text="classInfo.xuefeng" title="学风" /></div>
        </div>
      </div>
      <div class="info-divider"></div>

      <!-- 第三部分：倒计时（大字排版，数字放大） -->
      <div class="info-part countdown-part">
        <template v-if="nearestCountdown">
          <div class="cd-top">距离 <span class="cd-item-name">{{ nearestCountdown.名称 }}</span></div>
          <div class="cd-bottom">还有 <span class="cd-num tabular-nums">{{ nearestCountdown.days }}</span> 天</div>
        </template>
        <div v-else class="countdown-empty">暂无倒计时</div>
      </div>
    </div>

    <!-- 数据看板：卡片按容器宽度自适应排列（auto-fit），不固定栏数 -->
    <div class="card-grid">
      <!-- 今日值日 -->
        <div class="bg-surface shadow rounded-xl p-5 border border-border card-link" @click="goTo('/duty')" title="跳转：今日值日">
          <h2 class="text-base font-semibold text-text mb-3 flex items-center gap-2">
            <IconGlyph name="duty" :size="20" /> 今日值日
          </h2>
          <div class="space-y-1.5">
            <div v-for="d in todayDuties" :key="d.task" class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-bg-secondary/60">
              <span class="text-text text-sm shrink-0">{{ d.task }}</span>
              <span class="text-text-muted text-sm truncate">
                {{ d.people && d.people.length ? d.people.map(p => getStudentName(p) || p).join('、') : '（未安排）' }}
              </span>
            </div>
            <div v-if="todayDuties.length === 0" class="text-center py-5 text-text-muted text-sm">今日暂无值日安排</div>
          </div>
        </div>

        <!-- 班费剩余 -->
        <div class="bg-surface shadow rounded-xl p-5 border border-border card-link" @click="goTo('/fee')" title="跳转：班费">
          <h2 class="text-base font-semibold text-text mb-3 flex items-center justify-between">
            <span class="flex items-center gap-2"><IconGlyph name="fee" :size="20" /> 班费剩余</span>
            <button class="text-text-muted hover:text-text transition-colors" title="显示/隐藏金额" @click.stop="toggleFee">
              {{ showFee ? '🙈' : '👁️' }}
            </button>
          </h2>
          <div class="text-3xl font-bold text-text tabular-nums">{{ showFee ? formatMoney(feeBalance) : '••••' }} 元</div>
          <div class="flex gap-5 mt-3 text-sm">
            <span class="text-text-muted">本月收入 <b class="text-success">{{ showFee ? formatMoney(monthIncome) : '••' }}</b></span>
            <span class="text-text-muted">本月支出 <b class="text-warning">{{ showFee ? formatMoney(monthExpense) : '••' }}</b></span>
          </div>
        </div>

        <!-- 今日课程 -->
        <div class="bg-surface shadow rounded-xl p-5 border border-border card-link" @click="goTo('/schedule')" title="跳转：课程表">
          <h2 class="text-base font-semibold text-text mb-3 flex items-center gap-2">
            <IconGlyph name="schedule" :size="20" /> 今日课程
          </h2>
          <div v-if="todayCourseList.length" class="space-y-1.5">
            <div v-for="c in todayCourseList" :key="c.no" class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg-secondary/60">
              <span class="w-6 text-center text-text-muted text-xs font-medium shrink-0">{{ c.no }}</span>
              <span class="text-text text-sm flex-1 truncate">{{ c.course }}</span>
              <span class="text-text-muted text-xs shrink-0">{{ c.time }}</span>
            </div>
          </div>
          <div v-else class="text-center py-5 text-text-muted text-sm">今日无课程</div>
        </div>
      <!-- 今日加分 Top4 -->
        <div class="bg-surface shadow rounded-xl p-5 border border-border card-link" @click="goTo('/scores')" title="跳转：加分管理">
          <h2 class="text-base font-semibold text-text mb-3 flex items-center gap-2">
            <IconGlyph name="score" :size="20" /> 今日加分
          </h2>
          <div v-if="topScores.length" class="space-y-1.5">
            <div v-for="(s, i) in topScores" :key="i" class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-bg-secondary/60">
              <span class="text-text text-sm flex-1 truncate">{{ i + 1 }}. {{ s.name }}</span>
              <span class="text-success font-semibold text-sm shrink-0">{{ s.score }} 分</span>
            </div>
          </div>
          <div v-else class="text-center py-5 text-text-muted text-sm">今日暂无加分</div>
        </div>

        <!-- 今日活动（时间轴） -->
        <div class="bg-surface shadow rounded-xl p-5 border border-border card-link" @click="goTo('/activities')" title="跳转：活动中心">
          <h2 class="text-base font-semibold text-text mb-3 flex items-center gap-2">
            <IconGlyph name="activity" :size="20" /> 今日活动
          </h2>
          <div v-if="todayActivities.length" class="relative pl-5">
            <div v-for="(a, i) in todayActivities" :key="i" class="relative pb-4 last:pb-0">
              <span class="absolute -left-5 top-1.5 w-2 h-2 rounded-full bg-primary"></span>
              <div class="text-text text-sm">{{ a.主题 }}</div>
              <div class="text-text-muted text-xs mt-0.5">{{ a.开始时间 || a.created_at }}</div>
            </div>
          </div>
          <div v-else class="text-center py-5 text-text-muted text-sm">今日暂无活动</div>
        </div>

        <!-- 今日请假 -->
        <div class="bg-surface shadow rounded-xl p-5 border border-border card-link" @click="goTo('/leaves')" title="跳转：请假管理">
          <h2 class="text-base font-semibold text-text mb-3 flex items-center gap-2">
            <IconGlyph name="leave" :size="20" /> 今日请假
            <span class="ml-auto text-sm text-text-muted font-normal">{{ currentLeaveList.length }} 人</span>
          </h2>
          <div v-if="currentLeaveList.length" class="space-y-1.5">
            <div v-for="l in currentLeaveList" :key="l.id" class="flex items-center gap-3 px-3 py-2 rounded-lg bg-bg-secondary/60">
              <span class="text-text text-sm flex-1 truncate">{{ l.姓名 }}</span>
              <span class="text-text-muted text-xs shrink-0">{{ formatLeaveTime(l) }}</span>
            </div>
          </div>
          <div v-else class="text-center py-5 text-text-muted text-sm">今日无请假</div>
        </div>

        <!-- 班级相册（随机一张） -->
        <div class="bg-surface shadow rounded-xl p-5 border border-border card-link" @click="goTo('/album')" title="跳转：班级相册">
          <h2 class="text-base font-semibold text-text mb-3 flex items-center gap-2">
            <IconGlyph name="album" :size="20" /> 班级相册
          </h2>
          <div v-if="albumPhoto" class="rounded-lg overflow-hidden">
            <img :src="albumPhoto" alt="随机班级照片" class="w-full h-44 object-cover">
          </div>
          <div v-else class="text-center py-8 text-text-muted text-sm">暂无照片</div>
        </div>
    </div>

    <!-- 班级信息设置弹窗 -->
    <ClassInfoDialog
      :visible="showClassModal"
      :class-data="classInfo"
      @confirm="saveClassInfo"
      @cancel="showClassModal = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import { ensureDashboardData } from '../composables/useDashboardData'
import IconGlyph from '../components/base/IconGlyph.vue'
import AnimatedClock from '../components/AnimatedClock.vue'
import ClippedText from '../components/ClippedText.vue'
import ClassInfoDialog from '../components/dialogs/ClassInfoDialog.vue'

const router = useRouter()

// 返回当天的课表列索引（周一=0…周五=4），周末返回 -1；兼容传入 Date 或星期数字(0-6，周日=0)
function getWeekDayIndex(d) {
  const day = typeof d === 'number' ? d : d.getDay()
  if (day === 0 || day === 6) return -1
  return day - 1
}

// ========== 数据 ==========
const now = ref(new Date())
const today = computed(() => {
  const d = now.value
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})
const todayWeekIndex = computed(() => getWeekDayIndex(now.value))

const schedule = ref({ cells: [], settings: { periods: [], days: ['周一', '周二', '周三', '周四', '周五'] } })
const duty = ref({ cells: {}, settings: { days: [], items: [] } })
const countdowns = ref([])
const leaves = ref([])
const students = ref([])
const scores = ref([])
const activities = ref([])
const fees = ref([])
const albumPhoto = ref('')
const showFee = ref(localStorage.getItem('dashboard-fee-visible') === '1')

const loading = ref(false)

// ========== 计算属性 ==========

// 首页班级信息（班名/口号/班风/学风）：持久化于后端 widget_settings，缺省用占位
const classInfo = ref({
  name: '初三七班',
  motto: '插上理想的翅膀，扬起青春的风帆',
  mottoStyle: '自尊 自信 自强 自立',
  xuefeng: '勤学 好问 善思 笃行',
})

// 班级设置弹窗
const showClassModal = ref(false)
function openClassModal() {
  showClassModal.value = true
}
async function loadClassInfo() {
  try {
    const res = await axios.get('/api/widget-settings/class-info')
    const d = res.data?.data
    if (d) {
      classInfo.value.name = d.name || classInfo.value.name
      classInfo.value.motto = d.motto || classInfo.value.motto
      classInfo.value.mottoStyle = d.mottoStyle || classInfo.value.mottoStyle
      classInfo.value.xuefeng = d.xuefeng || classInfo.value.xuefeng
    }
  } catch (_) {}
}
async function saveClassInfo(data) {
  try {
    const res = await axios.put('/api/widget-settings/class-info', data || {})
    const d = res.data?.data
    if (d) classInfo.value = { ...d }
    showClassModal.value = false
  } catch (_) {}
}

// 出勤统计
const attendance = computed(() => {
  const total = students.value.length
  const onLeave = leaves.value.filter(l => l.状态 === '请假中').length
  return { total, onLeave, present: total - onLeave }
})

// 今日课程
const todayCourses = computed(() => {
  if (todayWeekIndex.value < 0) return []
  const cells = schedule.value.cells
  if (!Array.isArray(cells) || cells.length === 0) return []
  return cells.map(row => {
    const cell = Array.isArray(row) ? row[todayWeekIndex.value] : null
    return cell && cell.course ? cell.course : ''
  })
})
const todayCourseCount = computed(() => todayCourses.value.filter(Boolean).length)

// 今日值日
const todayDuties = computed(() => {
  const cells = duty.value.cells
  const items = duty.value.settings.items || []
  if (!Array.isArray(items) || items.length === 0) return []
  const dayOfWeek = getWeekDayIndex(now.value)
  // 值日 cells 的键是中文星期名（如 '周二'），优先用 settings.days 取星期名，缺失时回退数字索引
  const days = duty.value.settings.days || ['周一', '周二', '周三', '周四', '周五']
  const todayDayName = days[dayOfWeek]
  const result = []
  for (const item of items) {
    const task = typeof item === 'string' ? item : (item.名称 || item.name || item)
    let people = []
    if (cells && cells[task]) {
      const dayCell = todayDayName ? cells[task][todayDayName] : null
      people = (dayCell !== undefined && dayCell !== null) ? dayCell : (cells[task][dayOfWeek] || [])
    }
    result.push({ task, people })
  }
  return result.filter(r => (typeof r.task === 'string' && r.task) || r.people.length > 0)
})

// 最近倒计时
const nearestCountdown = computed(() => {
  if (countdowns.value.length === 0) return null
  const todayDate = new Date(today.value)
  todayDate.setHours(0, 0, 0, 0)
  let nearest = null
  let nearestDays = Infinity
  for (const c of countdowns.value) {
    if (!c.截止日) continue
    const deadline = new Date(c.截止日)
    deadline.setHours(0, 0, 0, 0)
    const diff = Math.ceil((deadline - todayDate) / (1000 * 60 * 60 * 24))
    if (diff >= 0 && diff < nearestDays) {
      nearestDays = diff
      nearest = { ...c, days: c.包含这一天 ? diff + 1 : diff }
    }
  }
  return nearest
})

// 今日活动（时间轴）
const todayActivities = computed(() => {
  return activities.value.filter(a => {
    const dateStr = a.开始时间 || a.created_at
    return String(dateStr).startsWith(today.value)
  })
})

// 当前请假列表（今日请假中）
const currentLeaveList = computed(() => {
  return leaves.value.filter(l => l.状态 === '请假中' && l.开始时间 && l.开始时间.startsWith(today.value))
})

// 今日课程列表（带时间段）
const todayCourseList = computed(() => {
  if (todayWeekIndex.value < 0) return []
  const cells = schedule.value.cells
  const periods = schedule.value.settings.periods || []
  if (!Array.isArray(cells) || cells.length === 0) return []
  const result = []
  for (let i = 0; i < cells.length; i++) {
    const cell = Array.isArray(cells[i]) ? cells[i][todayWeekIndex.value] : null
    const course = cell && cell.course ? cell.course : ''
    if (!course) continue
    const p = periods[i] || {}
    const time = `${p.start || '00:00'}${p.end ? `~${p.end}` : ''}`
    result.push({ no: i + 1, course, time })
  }
  return result
})

// 加分排行榜：按加分排序，取前4名
const topScores = computed(() => {
  return scores.value
    .filter(s => s.加分时间 && s.加分时间.startsWith(today.value))
    .sort((a, b) => Number(b.分值 || 0) - Number(a.分值 || 0))
    .slice(0, 4)
    .map(s => {
      // 区分个人加分（学生）与小组加分（小组名）
      const name = s.姓名 || s.group_name || '未知'
      const score = Number(s.分值 || 0)
      return { name, score: s.类型 === '扣分' ? -score : score }
    })
})

// 班费计算：余额 + 本月收入/支出
const feeBalance = computed(() => {
  return fees.value.reduce((sum, r) => {
    const amount = Number(r['收支金额'] || 0)
    const type = String(r['收支类型'] || '').trim()
    return type === '支出' ? sum - Math.abs(amount) : sum + Math.abs(amount)
  }, 0)
})
const monthIncome = computed(() => {
  const year = now.value.getFullYear()
  const month = now.value.getMonth() + 1
  return fees.value.reduce((sum, r) => {
    const dateStr = String(r['收支时间'] || '')
    if (!dateStr.startsWith(`${year}-${String(month).padStart(2, '0')}`)) return sum
    const amount = Number(r['收支金额'] || 0)
    const type = String(r['收支类型'] || '').trim()
    return type !== '支出' ? sum + Math.abs(amount) : sum
  }, 0)
})
const monthExpense = computed(() => {
  const year = now.value.getFullYear()
  const month = now.value.getMonth() + 1
  return fees.value.reduce((sum, r) => {
    const dateStr = String(r['收支时间'] || '')
    if (!dateStr.startsWith(`${year}-${String(month).padStart(2, '0')}`)) return sum
    const amount = Number(r['收支金额'] || 0)
    const type = String(r['收支类型'] || '').trim()
    return type === '支出' ? sum + Math.abs(amount) : sum
  }, 0)
})

// ========== 方法 ==========
function goTo(to) {
  router.push(to)
}
function toggleFee() {
  showFee.value = !showFee.value
  localStorage.setItem('dashboard-fee-visible', showFee.value ? '1' : '0')
}
function formatMoney(n) {
  return Number(n).toFixed(2)
}
// 随机相册照片：找第一个有照片的相册，随机取一张，用 thumb 接口（走鉴权）转 dataURL 展示
async function loadRandomPhoto(albums) {
  albumPhoto.value = ''
  const list = Array.isArray(albums) ? albums : []
  for (const album of list) {
    try {
      const photosRes = await axios.get(`/api/album/${album.id}/photos`)
      const groups = (photosRes.data && photosRes.data.data) || []
      const photos = (Array.isArray(groups) ? groups : []).flatMap(g => (g.photos || []))
      if (photos.length === 0) continue
      const pick = photos[Math.floor(Math.random() * photos.length)]
      const thumbRes = await axios.get(`/api/album/photo/${pick.id}/thumb`, { responseType: 'blob' })
      albumPhoto.value = URL.createObjectURL(thumbRes.data)
      return
    } catch (_) { /* 试下一个相册 */ }
  }
}
function getStudentName(id) {
  const s = students.value.find(st => st.id === Number(id) || st.id === id)
  return s ? s.姓名 : null
}

function formatLeaveTime(leave) {
  if (!leave.开始时间) return ''
  const dt = new Date(leave.开始时间)
  return `${dt.getHours()}:${String(dt.getMinutes()).padStart(2, '0')}`
}

// ========== 加载数据 ==========
// 复用首屏预取缓存（请求已在路由导航进入首页时并发发起，见 useDashboardData）
async function loadData(force = false) {
  loading.value = true
  try {
    const d = await ensureDashboardData(force)
    schedule.value = d.schedule
    duty.value = d.duty
    countdowns.value = d.countdowns
    leaves.value = d.leaves
    students.value = d.students
    scores.value = d.scores
    activities.value = d.activities
    fees.value = d.fees
    // 相册：挑一个含照片的相册，随机取一张
    loadRandomPhoto(d.album)
  } catch (err) {
    console.error('[dashboard] 加载数据失败:', err)
  } finally {
    loading.value = false
  }
}

let timer = null
// 首帧标记：onActivated 首次随挂载触发，跳过避免与 onMounted 重复加载
let firstActivate = true

onMounted(() => {
  loadData()
  loadClassInfo()
  // 每分钟刷新当前时间，让今日名单、窗口时间等随时间变化
  timer = setInterval(() => { now.value = new Date() }, 60000)
})

// 每次从其他页面切回首页时重新拉取，保证「修改过数据回来自动更新」
onActivated(() => {
  if (firstActivate) { firstActivate = false; return }
  loadData(true)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
/* ======================== 班级信息大框 ======================== */
.class-info-card {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 20px;
  padding: 22px 28px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.42);
  backdrop-filter: blur(20px) saturate(1.3);
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
}
.info-part {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.info-divider {
  width: 1px;
  align-self: stretch;
  background: rgba(0, 0, 0, 0.12);
  margin: 4px 0;
}
/* 第二部分：班级信息 */
.class-name {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
  margin-bottom: 8px;
}
.class-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.class-line {
  font-size: 13px;
  color: #374151;
}
.line-label {
  color: #6b7280;
}
/* 第三部分：倒计时（大字排版） */
.countdown-part {
  gap: 4px;
}
.cd-top {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  line-height: 1.4;
}
.cd-item-name {
  color: #2563eb;
}
.cd-bottom {
  /* 数字大字、单位跟随基线对齐 */
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 16px;
  color: #4b5563;
}
.cd-num {
  font-size: 58px;
  font-weight: 800;
  line-height: 1;
  color: #2563eb;
}
.countdown-empty {
  font-size: 14px;
  color: #9ca3af;
}

/* 看板卡片瀑布流排列：用 CSS 多列实现"砌墙"效果——
   矮卡片后面的内容自动顶上来填空隙，而不是逐行等高对齐；
   列数随容器宽度自适应（每列约 280px）。 */
.card-grid {
  column-width: 280px;
  column-gap: 20px;
}
.card-grid > * {
  break-inside: avoid; /* 卡片不跨列断开 */
  margin-bottom: 20px;
  width: 100%;
  display: inline-block; /* 保持卡片内块级尺寸稳定 */
  vertical-align: top;
}

.dashboard-page ::v-deep(.icon-glyph) {
  flex-shrink: 0;
}

/* 可点击卡片：指针 + 悬停高亮 */
.card-link {
  cursor: pointer;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.card-link:hover {
  border-color: rgba(59, 130, 246, 0.35);
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.10);
}

/* 班级名旁的齿轮按钮 */
.class-gear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.class-gear:hover {
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
}
</style>
