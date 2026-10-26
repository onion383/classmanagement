<template>
  <div class="desktop-widget">
    <!-- 时钟区域（拖动手柄：顶层窗口用原生 app-region；桌面层子窗口改由自实现拖动） -->
    <div class="clock-area glass-panel drag-handle"
         :class="{ 'drag-handle-layer': isDesktopLayer }"
         @pointerdown="onWindowDragStart">
      <AnimatedClock date-format="{Y}-{M}-{D}  星期{W}" />
    </div>

    <!-- 倒计时区域 -->
    <div class="countdown-area glass-panel" v-if="nearestCountdown">
      <div class="countdown-item">距离 {{ nearestCountdown.名称 }} 还有 {{ nearestCountdown.days }} 天</div>
      <div class="next-class" v-if="nextClassInfo">距离下一节课还有 {{ nextClassInfo }} 分钟</div>
    </div>

    <!-- 左右两栏：左=课程，右=今日值日 + 人数情况 -->
    <div class="info-row">
      <!-- 课程面板（左栏） -->
      <div class="glass-panel col-panel col-course-panel">
        <div class="panel-title">课程</div>
        <div class="table-body">
          <template v-for="(g, gi) in courseGroups" :key="'g'+gi">
            <div class="panel-section">{{ g.name }}</div>
            <div
              v-for="(row, idx) in g.rows"
              :key="'c'+gi+'-'+idx"
              class="table-row"
              :class="{ 'row-empty': row.isEmpty, 'row-active': row.isActive }"
            >
              <span class="col-full">
                <span class="row-num">{{ row.num }}</span><span v-if="row.course" class="row-name">{{ row.course }}</span>
              </span>
            </div>
          </template>
        </div>
      </div>

      <!-- 右栏：今日值日 + 人数情况 堆叠 -->
      <div class="col-side">
        <!-- 今日值日面板 -->
        <div class="glass-panel col-panel col-duty-panel">
          <div class="panel-title">今日值日</div>
          <div class="table-body">
            <div
              v-for="(row, idx) in dutyRows"
              :key="'d'+idx"
              class="table-row"
              :class="{ 'row-empty': row.isEmpty }"
            >
              <span class="duty-task">{{ row.task }}</span>
              <span class="duty-names">{{ row.names }}</span>
            </div>
          </div>
        </div>

        <!-- 人数情况面板 -->
        <div class="glass-panel col-panel">
          <div class="panel-title">人数情况</div>
          <div class="table-body">
            <div v-for="(row, idx) in attendanceRows" :key="'a'+idx" class="table-row">
              <span class="col-full">{{ row.text }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 常用软件面板 -->
    <div class="glass-panel apps-panel">
      <div class="panel-title panel-title-flex">
        <span>常用软件</span>
        <button class="panel-btn" :class="{ 'panel-btn-active': editing }" @click="toggleEdit">
          {{ editing ? '完成' : '编辑' }}
        </button>
      </div>
      <div class="apps-grid">
        <div
          v-for="(app, idx) in apps"
          :key="app.id"
          class="app-item"
          :class="{ 'app-item-editing': editing, dragging: dragIndex === idx }"
          :title="app.name"
          :draggable="editing"
          @click="editing ? null : launchApp(app)"
          @dragstart="editing && onDragStart(idx, $event)"
          @dragend="onDragEnd"
          @dragover.prevent
          @drop.prevent="editing && onDrop(idx)"
        >
          <div v-if="editing" class="app-grip" title="拖拽排序" @mousedown.stop>
            <i class="grip-dot"></i><i class="grip-dot"></i><i class="grip-dot"></i><i class="grip-dot"></i><i class="grip-dot"></i><i class="grip-dot"></i>
          </div>
          <img v-if="app.icon" class="app-icon" :src="app.icon" alt="" draggable="false">
          <div v-else class="app-icon app-icon-fallback">{{ app.name[0] }}</div>
          <span class="app-name">{{ app.name }}</span>
          <button v-if="editing" class="app-op app-op-del" title="删除" @click.stop="removeApp(idx)">✕</button>
        </div>
        <div v-if="apps.length === 0 && !editing" class="apps-empty">暂无常用软件</div>
        <button v-if="editing" class="app-item app-add" title="添加常用软件" @click="addApp">
          <div class="app-icon app-icon-add">＋</div>
          <span class="app-name">添加</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'
import AnimatedClock from '../../components/AnimatedClock.vue'
import { INVOKE } from '../../electronChannels.js'
import { useThemeStore } from '../../stores/theme'

// ========== 主题 ==========
// 组件需要知道当前主题/日夜间，才能套用对应配色（文字颜色、卡片底色等）。
// 背景磨砂由主进程的系统亚克力材质提供（真实透出桌面被模糊），**不由渲染层绘制**。
// 触达 store 以确保主题状态已初始化（配色由 CSS 变量驱动，本组件不直接读 store 字段）
useThemeStore()

// ========== 窗口形态（决定拖动方式）============
// 两种形态（Windows 层面互斥，见 electron/desktop-widget-host.js 的说明）：
//   · 顶层窗口（默认）：系统亚克力生效，拖动用 Electron 原生 -webkit-app-region: drag。
//   · 桌面层子窗口（用户开启「常驻最底层」）：亚克力失效，app-region 也失效（系统把
//     SC_MOVE 转发给父窗 Progman），需由渲染层上报坐标、主进程 SetWindowPos 自实现拖动。
// 这里向主进程询问当前形态；问不到就按顶层窗口处理（原生拖动）。
const isDesktopLayer = ref(false)

// ========== 时钟：逐字符动画已抽取为 AnimatedClock 组件 ==========
const now = ref(new Date())

// 当前星期几（0=周一，1=周二，...，4=周五），-1=周末
const todayWeekIndex = computed(() => {
  const d = now.value.getDay()
  if (d === 0 || d === 6) return -1
  return d - 1
})

// ========== 数据 ==========
const schedule = ref({ cells: [], settings: { periods: [], days: ['周一', '周二', '周三', '周四', '周五'] } })
const duty = ref({ cells: {}, settings: { days: ['周一', '周二', '周三', '周四', '周五'], items: [] } })
const countdowns = ref([])
const leaves = ref([])
const students = ref([])

// 今天有课（课程名列表）
const todayCourses = computed(() => {
  if (todayWeekIndex.value < 0) return []
  const cells = schedule.value.cells
  if (!Array.isArray(cells) || cells.length === 0) return []
  return cells.map(row => {
    const cell = Array.isArray(row) ? row[todayWeekIndex.value] : null
    return cell && cell.course ? cell.course : ''
  })
})

// 今天值日任务列表（包含所有值日项目占位，无人时显示空）
const todayDuties = computed(() => {
  const cells = duty.value.cells
  const items = duty.value.settings.items || []
  if (!Array.isArray(items) || items.length === 0) return []
  let dayOfWeek = todayWeekIndex.value
  if (dayOfWeek < 0) return []
  // 值日 cells 的键是中文星期名（如 '周二'），优先用 settings.days 取星期名，缺失时回退数字索引（与主程序一致）
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
  return result
})

// 出勤统计
const attendance = computed(() => {
  const total = students.value.length
  const onLeave = leaves.value.filter(l => l.状态 === '请假中').length
  return { total, onLeave, present: total - onLeave }
})

// 最近倒计时
const nearestCountdown = computed(() => {
  if (countdowns.value.length === 0) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let nearest = null
  let nearestDays = Infinity
  for (const c of countdowns.value) {
    if (!c.截止日) continue
    const deadline = new Date(c.截止日)
    deadline.setHours(0, 0, 0, 0)
    const diff = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24))
    if (diff >= 0 && diff < nearestDays) {
      nearestDays = diff
      nearest = { ...c, days: c.包含这一天 ? diff + 1 : diff }
    }
  }
  return nearest
})

// 下一节课信息
const nextClassInfo = computed(() => {
  if (todayWeekIndex.value < 0) return null
  const periods = schedule.value.settings.periods
  if (!Array.isArray(periods) || periods.length === 0) return null
  const courses = todayCourses.value
  const nowMinutes = now.value.getHours() * 60 + now.value.getMinutes()
  for (let i = 0; i < periods.length; i++) {
    if (!courses[i]) continue
    const startParts = (periods[i].start || '00:00').split(':').map(Number)
    const startMinutes = startParts[0] * 60 + (startParts[1] || 0)
    if (startMinutes > nowMinutes) {
      return startMinutes - nowMinutes
    }
  }
  return null
})

// 固定显示 13 行（对应一天 13 节课）
const MAX_ROWS = 13

// 当前正在上的上课节次（now 落在该节 start~end 区间内，且为上课型时段）
// 注意：periods 含大课间/午休/休息等非上课时段，课程行只展示上课节次，
// 需按「上课节次」独立计数映射到课程行，非工作日返回 -1
const currentPeriodIndex = computed(() => {
  if (todayWeekIndex.value < 0) return -1
  const periods = schedule.value.settings.periods || []
  const d = now.value
  const curMin = d.getHours() * 60 + d.getMinutes()
  let lessonIdx = -1
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i]
    if (!p || !p.start || !p.end) continue
    const isLesson = !p.type || p.type === 'lesson'
    if (isLesson) lessonIdx++
    const [sh, sm] = String(p.start).split(':').map(Number)
    const [eh, em] = String(p.end).split(':').map(Number)
    const startMin = sh * 60 + (sm || 0)
    const endMin = eh * 60 + (em || 0)
    if (curMin >= startMin && curMin < endMin) {
      return isLesson ? lessonIdx : -1
    }
  }
  return -1
})

// 课程面板行：跟随主程序课表设置对课程分组。
// 直接读取 schedule.settings.sections（上午/中午/下午/傍晚/晚上）各段的课时配置，
// 只统计上课型(time 段)的节次，段名与课程数量完全来自主设置；
// 节次沿用全局 1-13 编号。无等价段数据时退化为按时段(12/18 点)三组平铺。
const courseGroups = computed(() => {
  const sections = schedule.value.settings.sections
  const courses = todayCourses.value
  const SECTION_NAMES = { morning: '上午', noon: '中午', afternoon: '下午', evening: '傍晚', night: '晚上' }
  const ORDER = ['morning', 'noon', 'afternoon', 'evening', 'night']

  // 主设置含上课段 → 按主设置分组
  const hasSections = !!sections && Array.isArray(sections.morning)
  if (hasSections) {
    const groups = []
    let lessonIdx = 0
    ORDER.forEach(key => {
      const items = (sections[key] || []).filter(it => !it.type || it.type === 'lesson')
      if (items.length === 0) return
      const rows = items.map(() => {
        const course = courses[lessonIdx] || ''
        const row = {
          num: lessonIdx + 1,
          course,
          isEmpty: !course,
          isActive: lessonIdx === currentPeriodIndex.value && !!course,
        }
        lessonIdx++
        return row
      })
      groups.push({ name: SECTION_NAMES[key] || key, rows })
    })
    if (groups.length > 0) return groups
  }

  // 无段数据 → 按时段(12/18 点)兜底分组
  const periods = schedule.value.settings.periods || []
  const sectionDefs = [
    { name: '上午', min: -Infinity, max: 12, rows: [] },
    { name: '下午', min: 12, max: 18, rows: [] },
    { name: '晚上', min: 18, max: Infinity, rows: [] },
  ]
  const hasPeriods = Array.isArray(periods) && periods.length > 0
  for (let i = 0; i < MAX_ROWS; i++) {
    const course = courses[i] || ''
    const row = {
      num: i + 1,
      course,
      isEmpty: !course,
      isActive: i === currentPeriodIndex.value && !!course,
    }
    if (hasPeriods) {
      const hour = Number(String((periods[i] && periods[i].start) || '12:00').split(':')[0])
      const group = sectionDefs.find(s => hour >= s.min && hour < s.max)
      if (group) group.rows.push(row)
      else sectionDefs[1].rows.push(row)
    } else {
      sectionDefs[1].rows.push(row)
    }
  }
  return sectionDefs.filter(g => g.rows.length > 0)
})

// 把值日人员解析成可读姓名（兼容：学生 id / 姓名字符串 / 含 id 或姓名的对象）
function resolveName(v) {
  if (v == null) return ''
  if (typeof v === 'object') {
    const s = students.value.find(st => st.id === v.id)
    if (s) return s.姓名
    return v.姓名 || v.name || ''
  }
  const s = students.value.find(st => st.id === Number(v) || st.id === v)
  return s ? s.姓名 : String(v)
}

// 今日值日面板行：值日任务列表（任务名/人名单列，包含所有项目占位，无人时显示空）
const dutyRows = computed(() => {
  return todayDuties.value.map(d => ({
    task: d.task,
    names: d.people.map(resolveName).filter(Boolean).join(' '),
    isEmpty: d.people.length === 0,
  }))
})

// 人数情况面板行：应到/实到/请假
const attendanceRows = computed(() => {
  const att = attendance.value
  return [
    { text: `应到 ${att.total} 人` },
    { text: `实到 ${att.present} 人` },
    { text: `请假 ${att.onLeave} 人` },
  ]
})

// ========== 数据加载 ==========
let refreshTimer = null

// ========== 常用软件 ==========
const apps = ref([])
const editing = ref(false)

async function loadApps() {
  try {
    const res = await axios.get('/api/widget-settings/apps')
    const list = res.data?.data
    if (Array.isArray(list)) apps.value = list
  } catch (_) {}
}

function launchApp(app) {
  if (!app || !app.path) return
  if (window.electron && window.electron.invoke) {
    window.electron.invoke(INVOKE.APPS_LAUNCH, app.path).catch(() => {})
  }
}

function toggleEdit() {
  editing.value = !editing.value
}

async function addApp() {
  try {
    if (!window.electron || !window.electron.invoke) return
    const result = await window.electron.invoke(INVOKE.APPS_SELECT_FILE)
    if (!result || result.canceled || !result.filePath) return
    apps.value.push({
      id: `app-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: String(result.name || '未命名').slice(0, 30),
      path: String(result.filePath),
      icon: typeof result.icon === 'string' ? result.icon : '',
    })
    saveApps()
  } catch (_) {}
}

function removeApp(idx) {
  apps.value.splice(idx, 1)
  saveApps()
}

// 拖拽排序：记录被拖项索引，拖入目标项时交换位置
let dragIndex = null

function onDragStart(idx, e) {
  dragIndex = idx
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragEnd() {
  dragIndex = null
}

function onDrop(idx) {
  if (dragIndex === null || dragIndex === idx) return
  const from = dragIndex
  const to = idx
  const arr = apps.value.slice()
  const [moved] = arr.splice(from, 1)
  arr.splice(to, 0, moved)
  apps.value = arr
  dragIndex = null
  saveApps()
}

function saveApps() {
  axios.put('/api/widget-settings/apps', { desktopApps: apps.value }).catch(() => {})
}

async function loadAll() {
  try {
    const [scheduleRes, dutyRes, countdownsRes, leavesRes, studentsRes] = await Promise.all([
      axios.get('/api/schedule').catch(() => ({ data: { cells: [], settings: {} } })),
      axios.get('/api/duty').catch(() => ({ data: { cells: {}, settings: {} } })),
      axios.get('/api/countdowns').catch(() => ({ data: [] })),
      axios.get('/api/leaves').catch(() => ({ data: { data: [] } })),
      axios.get('/api/students').catch(() => ({ data: { data: [] } })),
    ])
    schedule.value = scheduleRes.data
    duty.value = dutyRes.data
    countdowns.value = Array.isArray(countdownsRes.data) ? countdownsRes.data : (countdownsRes.data.data || [])
    leaves.value = Array.isArray(leavesRes.data) ? leavesRes.data : (leavesRes.data.data || [])
    students.value = Array.isArray(studentsRes.data) ? studentsRes.data : (studentsRes.data.data || [])
  } catch (_) {
    // 静默失败，保留旧数据
  }
}

// ========== 窗口拖动（仅桌面层模式需要）============
// 顶层窗口走原生 -webkit-app-region: drag（见 .drag-handle 样式），无需 JS。
// 桌面层子窗口里 app-region 失效（SC_MOVE 被转发给父窗 Progman，表现为完全拖不动），
// 只能由渲染层上报鼠标屏幕坐标、主进程 SetWindowPos 搬窗口。
// screenX/screenY 是屏幕绝对坐标，不随窗口自身移动变化，故拖动不会自我叠加。
let windowDragging = false

function onWindowDragStart(e) {
  if (!isDesktopLayer.value) return
  if (e.button !== 0 || !window.electron || !window.electron.send) return
  windowDragging = true
  e.preventDefault()
  // 捕获指针：鼠标被甩出窗口时仍能收到 pointermove，否则快速拖动会中途断连
  try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) {}
  window.electron.send('desktop-widget-drag-start', { screenX: e.screenX, screenY: e.screenY })
}

function onWindowDragMove(e) {
  if (!windowDragging) return
  window.electron.send('desktop-widget-drag-move', { screenX: e.screenX, screenY: e.screenY })
}

function onWindowDragEnd() {
  if (!windowDragging) return
  windowDragging = false
  window.electron.send('desktop-widget-drag-end')
}

// ========== 生命周期 ==========
let refreshClock = null

onMounted(() => {
  loadAll()
  loadApps()
  // 询问主进程当前窗口形态（决定用原生 app-region 还是自实现拖动）
  Promise.resolve(window.electron?.invoke?.(INVOKE.GET_DESKTOP_LAYER_STATE))
    .then((st) => { if (st) isDesktopLayer.value = !!st.desktopLayerEnabled })
    .catch(() => {})
  // 桌面层模式下需要监听 pointermove/up（顶层模式不需要）
  window.addEventListener('pointermove', onWindowDragMove)
  window.addEventListener('pointerup', onWindowDragEnd)
  window.addEventListener('pointercancel', onWindowDragEnd)
  // every 5 分钟刷新数据；now 仅驱动倒计时/课程等分钟级状态，秒级走 AnimatedClock
  refreshTimer = setInterval(loadAll, 5 * 60 * 1000)
  refreshClock = setInterval(() => { now.value = new Date() }, 60000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (refreshClock) clearInterval(refreshClock)
  window.removeEventListener('pointermove', onWindowDragMove)
  window.removeEventListener('pointerup', onWindowDragEnd)
  window.removeEventListener('pointercancel', onWindowDragEnd)
})
</script>

<style scoped>
.desktop-widget {
  /* 宽度与主进程窗口 setContentSize(320,...) 完全一致，避免四周漏出窗口底色边缘 */
  width: 320px;
  padding: 16px;
  box-sizing: border-box;
  /* 内容超高时（值日项目多/课程全满）纵向滚动，避免底部卡片被窗口裁掉 */
  max-height: 100vh;
  overflow-y: auto;
  /* 整窗底色透明：由主进程的系统亚克力材质（backgroundMaterial:'acrylic'）绘制在窗口背景上，
     渲染层保持透明让真实的桌面内容透出被模糊 —— 与 Win11 主题的观感一致。
     若这里画底色，会把亚克力的模糊/着色整个盖住。 */
  background: transparent;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #1f2937;
}

/* 拖动手柄：默认交给 Electron 原生窗口拖动（app-region） */
.drag-handle {
  -webkit-app-region: drag;
  cursor: move;
}

/* 桌面层子窗口模式：app-region 在子窗口里失效（SC_MOVE 被转发给父窗 Progman，
   表现为完全拖不动），改由渲染层上报坐标 + 主进程 SetWindowPos 自实现拖动，
   故必须去掉 app-region，否则系统会把拖动交给父窗、组件纹丝不动。 */
.drag-handle-layer {
  -webkit-app-region: no-drag;
}

/* 各区块共用毛玻璃面板：半透明白底 + 背景模糊 + 柔和边框/高光。
   叠加在主进程整窗亚克力之上，形成「每一块独立磨砂卡片」的层次感。 */
.glass-panel {
  position: relative;
  background: rgba(255, 255, 255, 0.42);
  backdrop-filter: blur(20px) saturate(1.3);
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 12px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    0 2px 10px rgba(0, 0, 0, 0.05);
  padding: 10px 12px;
}

/* 时钟区域 */
.clock-area {
  text-align: center;
  user-select: none;
  -webkit-user-select: none;
}

/* 常用软件：编辑排序用 HTML5 拖拽，需覆盖全局 -webkit-user-drag:none。
   应用图标本身仍不可拖（详见 .app-icon）。 */
.app-item {
  -webkit-user-drag: auto;
}

/* 倒计时区域：面板已有毛玻璃底，不再画上下横线 */
.countdown-area {
  text-align: center;
  margin-top: 8px;
}

.countdown-item {
  font-size: 14px;
  color: #1f2937;
  line-height: 1.6;
}

.next-class {
  font-size: 14px;
  color: #1d4ed8;
  font-weight: 500;
  line-height: 1.6;
}

/* 两栏布局：左=课程，右=今日值日+人数情况 */
.info-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  /* 两侧拉伸等高，让今日值日能伸展占满右侧高度 */
  align-items: stretch;
}

/* 左侧课程面板：固定较宽，课程名有更多空间；右侧栏 flex 自动变窄。
   注意：下方 .info-row .col-panel:not(.col-duty-panel) 对课程面板也生效(flex:none)，
   故这里不能依赖 flex-basis，需显式 width 才有效。 */
.col-course-panel {
  flex: none;
  width: 100px;
}

/* 右侧栏：今日值日 + 人数情况 纵向堆叠，占满剩余宽度，整体拉伸等高 */
.col-side {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 今日值日面板：伸展占满右侧剩余高度（比内容多占行，与课程面板等高） */
.col-duty-panel {
  flex: 1;
}

/* 人数情况面板：靠底部，高度自适应内容 */
.info-row .col-panel:not(.col-duty-panel) {
  flex: none;
}

/* 今日值日面板内行距拉开，填补伸展后的空白 */
.col-duty-panel .table-row {
  line-height: 1.9;
  padding: 3px 0;
}

/* 表格 / 各内容面板 */
.table-wrapper {
  margin-top: 8px;
}

/* 面板标题 */
.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #4b5563;
  padding: 2px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  margin-bottom: 3px;
}

/* 课程面板分组标题（上午/下午/晚上） */
.panel-section {
  font-size: 12px;
  font-weight: 600;
  color: #4b5563;
  margin-top: 4px;
  padding-top: 2px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}

.panel-section:first-child {
  border-top: none;
  margin-top: 0;
  padding-top: 0;
}

.table-body {
  display: flex;
  flex-direction: column;
}

.table-row {
  display: flex;
  font-size: 15px;
  line-height: 1.7;
  padding: 2px 0;
}

.table-row.row-empty {
  /* 空行（没课的节次、没排人的值日）只压暗一点做区分，不要压得太狠导致看不清 */
  opacity: 0.7;
}

/* 当前正在上的课：蓝色底 + 白字。
   用负外边距向左右延伸到面板边缘(+12px=面板左右内边距)，并用内边距补偿，
   使文字位置与其它行完全对齐，同时蓝底始终覆盖整个可见字体。 */
.table-row.row-active {
  background: #2563eb;
  border-radius: 6px;
  margin-left: -12px;
  margin-right: -12px;
  padding-left: 12px;
  width: calc(100% + 24px);
  box-sizing: border-box;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}

.table-row.row-active .col-full,
.table-row.row-active .row-num,
.table-row.row-active .row-name {
  color: #ffffff;
}

.col-full {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #1f2937;
}

/* 今日值日：任务名定宽列 + 人名列，保证人名起点对齐 */
.col-duty-panel .duty-task {
  flex: 0 0 auto;
  min-width: 4.5em;
  max-width: 8em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 0.5em;
  color: #1f2937;
  font-weight: 500;
}
.col-duty-panel .duty-names {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #374151;
}

/* 节次号固定宽度 + 等宽数字，让个/十位数与课程名校对齐 */
.row-num {
  display: inline-block;
  width: 2ch;
  font-variant-numeric: tabular-nums;
  margin-right: 5px;
}

.row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 常用软件面板 */
.apps-panel {
  margin-top: 8px;
  min-height: 132px;
  display: flex;
  flex-direction: column;
}

.panel-title-flex {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
}

.panel-btn {
  font-size: 12px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(255, 255, 255, 0.5);
  color: #4b5563;
  cursor: pointer;
}

.panel-btn:hover {
  background: rgba(255, 255, 255, 0.8);
}

.panel-btn-active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

.panel-btn-active:hover {
  background: #1d4ed8;
}

.apps-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: 1fr;
  gap: 8px;
  margin-top: 6px;
  flex: 1;
  min-height: 0;
  align-content: stretch;
}

.app-item {
  position: relative;
  display: flex;
  height: 100%;
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  /* 固定左侧槽位留给拖拽手柄，编辑/非编辑切态时图标位置不变 */
  padding: 10px 4px 10px 18px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.app-item:hover {
  background-color: rgba(255, 255, 255, 0.55);
}

.app-item-editing {
  cursor: default;
}

.app-icon {
  width: 38px;
  height: 38px;
  object-fit: contain;
  border-radius: 8px;
}

.app-icon-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 600;
  color: #475569;
  background: rgba(255, 255, 255, 0.7);
}

.app-icon-add {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 400;
  color: #9ca3af;
  background: rgba(255, 255, 255, 0.35);
  border: 1px dashed rgba(0, 0, 0, 0.15);
}

.app-name {
  font-size: 12px;
  color: #374151;
  /* 名称宽度与图标一致，超长省略，避免撑乱网格 */
  width: 38px;
  height: 15px;
  line-height: 15px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-add {
  cursor: pointer;
}
.app-add:hover .app-icon-add {
  color: #2563eb;
  border-color: #2563eb;
}

/* 编辑模式：六点拖拽手柄，置于左侧预留槽位中间 */
.app-grip {
  position: absolute;
  top: 50%;
  left: 1px;
  transform: translateY(-50%);
  display: grid;
  grid-template-columns: repeat(2, 3px);
  grid-auto-rows: 3px;
  gap: 2px;
  padding: 3px 4px;
  border-radius: 5px;
  color: #9ca3af;
  cursor: grab;
  z-index: 2;
}

.app-grip:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #2563eb;
}

.grip-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
}

.app-item:active .app-grip {
  cursor: grabbing;
}

/* 编辑模式下整项可拖拽的视觉反馈 */
.app-item[aria-grabbed='true'],
.app-item.dragging {
  opacity: 0.5;
}

.app-op {
  position: absolute;
  font-size: 9px;
  line-height: 1;
  width: 15px;
  height: 15px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.app-op-del {
  top: 12px;
  right: 1px;
  background: #ef4444;
  color: #fff;
}

.app-op-del:hover {
  background: #dc2626;
}

.apps-empty {
  grid-column: 1 / -1;
  text-align: center;
  font-size: 12px;
  color: #9ca3af;
  padding: 10px 0;
}

/* Windows 深色主题（prefers-color-scheme 跟随系统主题）：文字转白，
   同时把毛玻璃面板/描边/悬浮底色一并转为深色半透明，否则白字落在浅色面板上看不清。 */
@media (prefers-color-scheme: dark) {
  .desktop-widget {
    /* 时钟（AnimatedClock 组件）通过这两个变量取色 */
    --ac-time-color: #f8fafc;
    --ac-date-color: #cbd5e1;
    color: #f8fafc;
    border-color: rgba(255, 255, 255, 0.14);
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.35),
      inset 0 1px 0 rgba(255, 255, 255, 0.12);
  }

  .glass-panel {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.14);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      0 2px 10px rgba(0, 0, 0, 0.25);
  }

  .countdown-item {
    color: #f8fafc;
  }

  .next-class {
    color: #93c5fd;
  }

  .panel-title {
    color: #cbd5e1;
    border-bottom-color: rgba(255, 255, 255, 0.14);
  }

  .panel-section {
    color: #cbd5e1;
    border-top-color: rgba(255, 255, 255, 0.12);
  }

  .col-full {
    color: #f8fafc;
  }

  /* 节次号（课程面板左列的数字）与值日条目再亮一点 */
  .row-num {
    color: #ffffff;
    font-weight: 500;
  }

  .col-duty-panel .duty-task {
    color: #ffffff;
  }

  .col-duty-panel .duty-names {
    color: #ffffff;
  }

  .panel-btn {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.2);
    color: #e2e8f0;
  }

  .panel-btn:hover {
    background: rgba(255, 255, 255, 0.22);
  }

  .app-item:hover {
    background-color: rgba(255, 255, 255, 0.12);
  }

  .app-icon-fallback {
    color: #e2e8f0;
    background: rgba(255, 255, 255, 0.14);
  }

  .app-icon-add {
    color: #94a3b8;
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .app-add:hover .app-icon-add {
    color: #93c5fd;
    border-color: #93c5fd;
  }

  .app-name {
    color: #e2e8f0;
  }

  .app-grip {
    color: #94a3b8;
  }

  .app-grip:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #93c5fd;
  }

  .apps-empty {
    color: #94a3b8;
  }
}
</style>