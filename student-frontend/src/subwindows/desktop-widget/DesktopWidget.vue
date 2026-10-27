<template>
  <div class="desktop-widget" :class="{ 'dw-night': systemDark }">
    <!-- 自绘磨砂背景：柔光渐变 + 奶白遮罩。
         两层都是 fixed + z-index:-1：不参与内容滚动、铺满整窗，内容仍照常滚动。 -->
    <div class="dw-wallpaper" aria-hidden="true"></div>
    <div class="dw-veil" aria-hidden="true"></div>

    <!-- 时钟区域（拖动手柄：顶层窗口用原生 app-region；桌面层子窗口改由自实现拖动） -->
    <div class="clock-area glass-panel drag-handle"
         :class="{ 'drag-handle-layer': isDesktopLayer }"
         @pointerdown="onWindowDragStart">
      <AnimatedClock date-format="{Y}-{M}-{D}  星期{W}" />
    </div>

    <!-- 倒计时区域 -->
    <div
      class="countdown-area glass-panel clickable-panel"
      v-if="nearestCountdown"
      title="在主窗口中查看倒计时"
      @click="openMainPage('/activities?tab=countdown')"
    >
      <div class="countdown-item">距离 {{ nearestCountdown.名称 }} 还有 {{ nearestCountdown.days }} 天</div>
      <div class="next-class" v-if="nextClassInfo">距离下一节课还有 {{ nextClassInfo }} 分钟</div>
    </div>

    <!-- 左右两栏：左=课程，右=今日值日 + 人数情况 -->
    <div class="info-row">
      <!-- 课程面板（左栏）：点击打开主窗口课表页 -->
      <div
        class="glass-panel col-panel col-course-panel clickable-panel"
        title="在主窗口中打开课程表"
        @click="openMainPage('/schedule')"
      >
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
        <!-- 今日值日面板：点击打开主窗口值日页 -->
        <div
          class="glass-panel col-panel col-duty-panel clickable-panel"
          title="在主窗口中查看值日安排"
          @click="openMainPage('/duty')"
        >
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

        <!-- 人数情况面板：点击打开主窗口请假/出勤页 -->
        <div
          class="glass-panel col-panel col-attendance-panel clickable-panel"
          title="在主窗口中查看请假与出勤"
          @click="openMainPage('/leaves')"
        >
          <div class="panel-title">人数情况</div>
          <div class="table-body">
            <div v-for="(row, idx) in attendanceRows" :key="'a'+idx" class="table-row">
              <span class="col-full">{{ row.text }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 常用软件面板：固定 8 个槽位（4 列 × 2 行）。
         空槽可直接点击添加，也可把桌面上的快捷方式 / 文件夹 / 文件拖进来；
         满 8 个后不再渲染空槽，无法继续增加（后端接口同样按 8 截断）。 -->
    <div
      class="glass-panel apps-panel"
      :class="{ 'apps-panel-drop': dragActive }"
      @dragover="onGridDragOver"
      @dragleave="onGridDragLeave"
      @drop="onGridDrop"
    >
      <div class="panel-title panel-title-flex">
        <span>常用软件</span>
        <button class="panel-btn" :class="{ 'panel-btn-active': editing }" @click="toggleEdit">
          {{ editing ? '完成' : '编辑' }}
        </button>
      </div>
      <div ref="gridRef" class="apps-grid">
        <template v-for="(slot, idx) in slots" :key="slot ? slot.id : 'empty-' + idx">
          <div
            v-if="slot"
            class="app-item"
            :class="{ 'app-item-editing': editing, dragging: dragMoving && dragIndex === idx }"
            :title="editing ? slot.name : `${slot.name}（点击打开，按住拖动排序）`"
            :data-app-index="idx"
            @pointerdown="onAppDragStart(idx, $event)"
            @click="onAppClick(slot, $event)"
          >
            <img v-if="slot.icon" class="app-icon" :src="slot.icon" alt="" draggable="false">
            <div v-else class="app-icon app-icon-fallback">{{ slot.name[0] }}</div>
            <span class="app-name">{{ slot.name }}</span>
            <button v-if="editing" class="app-op app-op-del" title="删除" @click.stop="removeApp(idx)">✕</button>
          </div>
          <button
            v-else
            class="app-item app-add"
            title="添加常用软件（也可直接拖入快捷方式、文件夹或文件）"
            @click="addApp"
          >
            <div class="app-icon app-icon-add">＋</div>
            <span class="app-name">添加</span>
          </button>
        </template>
      </div>
      <div v-if="dragActive" class="apps-drop-tip">松开即可添加到常用软件</div>
      <div v-if="limitHint || !appsLoaded" class="apps-hint">{{ limitHint || appsHintText }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import axios from 'axios'
import AnimatedClock from '../../components/AnimatedClock.vue'
import { INVOKE, SEND } from '../../electronChannels.js'
import { useThemeStore } from '../../stores/theme'

// ========== 主题 ==========
// 组件需要知道当前主题/日夜间，才能套用对应配色（文字颜色、卡片底色等）。
// 触达 store 以确保主题状态已初始化（配色由 CSS 变量驱动，本组件不直接读 store 字段）
useThemeStore()

// ========== 系统深浅色（跟随 Windows 的日间/夜间切换）============
// 组件是常驻桌面挂件，配色按**系统**明暗走（不是应用主题里手选的日/夜）：
// 用户在 Windows 里切「深色/浅色模式」时，组件与系统同步变化。
// 监听 prefers-color-scheme（Electron 会把系统主题变化实时的 change 事件推给渲染层）。
const systemDark = ref(false)
let darkMedia = null

function syncSystemDark() {
  systemDark.value = !!(darkMedia && darkMedia.matches)
}

// ========== 自绘磨砂背景（柔光渐变 + 奶白遮罩）============
// 为什么不用主进程的系统亚克力：DWM 的 backgroundMaterial 只采样壁纸亮度并强着色，
// 壁纸颜色会被洗成中性灰，观感还随 Windows build 变（预览版更透、正式版更实）。
// 自绘配方稳定、与引导窗口一致。
//
// 为什么不再读当前桌面壁纸贴进来：那张图经 26px 模糊 + 0.9 奶白遮罩之后，与下面的
// 渐变在观感上几乎无差别，却要付出每 10 分钟一次 300KB+ 的 dataURL 传输、
// 「壁纸图案与桌面对不齐」（贴图不跟屏幕位置走）、多显示器只取主屏壁纸等代价 —— 不值。

// ========== 窗口形态（仅用于日志/样式标记）============
// 组件固定“常驻最底层”：窗口是普通顶层窗口，z 序被插到「Progman 之上、所有可见窗口之下」
//（见 electron/main/main.desktop-layer.js）。attach 失败（非 Windows / koffi 缺失）时退回
// 普通顶层窗口，只影响层级、不影响可用性 —— 拖动路径两种情况下都一样（见下方 onWindowDragStart）。
// 这里向主进程询问真实状态；问不到就按已置底处理。
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
// 固定 8 个槽位（4 列 × 2 行）：默认就展示 8 个空位，逐个添加；
// 满 8 个后空位消失、添加入口不再出现，无法继续增加。
// 后端 PUT /apps 也按 8 截断，作为接口层兜底。
const MAX_APPS = 8

const apps = ref([])
// 列表是否已成功从后端读过：未成功前禁止写入，避免组件比后端/登录态先就绪时
// 用「空列表 + 本次新增项」覆盖数据库里的旧常用软件。
const appsLoaded = ref(false)
// 未登录（拿不到凭据，接口一律 401）：与「还在加载」区分开，否则用户看到的是
// 永远转圈的「正在加载常用软件…」，以为组件坏了。
const notLoggedIn = ref(false)
const appsHintText = computed(() => (
  notLoggedIn.value ? '未登录，请在主窗口登录' : '正在加载常用软件…'
))
let appsLoadTimer = null
// 首次失败已打日志的标记：避免 3 秒重试循环把渲染层 console 刷爆（host 侧另有 30s 去重）
let appsLoadLogged = false
// 首次成功读到数据的打点标记（只打一次）
let appsTimingLogged = false
const editing = ref(false)
// 从系统拖入文件时高亮整个面板
const dragActive = ref(false)
// 上限/去重提示：短暂浮在面板底部，不占布局
const limitHint = ref('')
let hintTimer = null
// 内部排序拖拽：无边框常驻窗口里原生 HTML5 draggable 不可靠，改用 Pointer Events 自实现
const gridRef = ref(null)
const dragIndex = ref(null) // 拖拽源索引
const dragOverIndex = ref(null) // 当前悬停目标索引
const dragMoving = ref(false) // 是否已越过 3px 启动阈值（轻点图标仍按点击处理）
let dragPointerId = null
let dragStartX = 0
let dragStartY = 0

// 拖拽期间的几何与浮动元素。全部使用视口坐标（clientX/Y + getBoundingClientRect），
// 拖动过程中不再读取布局，和表格拖拽同一套做法。
let dragItemEl = null
let dragGrab = { x: 0, y: 0 }
let dragLastPoint = { x: 0, y: 0 }
let dragSlotRects = []
let dragGhost = null
let dragSlotGhost = null
let dragDropBox = null
// 拖动结束后浏览器还会补发一次 click，短时间内忽略，避免「拖动排序」变成「启动软件」
let suppressAppClickUntil = 0

// 8 个槽位：前 apps.length 个是实际条目，其余为 null（渲染成「添加」空槽）
const slots = computed(() => {
  const list = apps.value.slice(0, MAX_APPS)
  const emptyCount = Math.max(0, MAX_APPS - list.length)
  return list.concat(Array.from({ length: emptyCount }, () => null))
})

function newAppId() {
  return `app-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function showHint(text) {
  limitHint.value = text
  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = setTimeout(() => { limitHint.value = '' }, 2200)
}

async function loadApps() {
  try {
    const res = await axios.get('/api/widget-settings/apps')
    const list = res.data?.data
    if (!Array.isArray(list)) return false
    apps.value = list.slice(0, MAX_APPS)
    appsLoaded.value = true
    appsLoadLogged = false
    notLoggedIn.value = false
    if (appsLoadTimer) { clearTimeout(appsLoadTimer); appsLoadTimer = null }
    // 首次成功读到数据时打一个耗时打点（仅开发模式：正式打包版不产出这些埋点，
    // 由 import.meta.env.DEV 在构建期直接摇掉，不留任何运行时代码）
    if (import.meta.env.DEV && !appsTimingLogged) {
      appsTimingLogged = true
      console.info('[dw-timing] 常用软件首次就绪 +' + Math.round(performance.now()) + 'ms')
    }
    return true
  } catch (err) {
    // 401 = 没有可用登录凭据（主窗口未登录 / 登录态被清）：此时再怎么重试也不会成功，
    // 但登录后组件会自动恢复（主应用每 10 秒把登录态快照交接过来）。
    // 提示必须写清楚「未登录」，否则用户看到的是永远转圈的「正在加载常用软件…」，
    // 会以为组件坏了。
    if (err?.response?.status === 401) notLoggedIn.value = true
    // host 进程 stdio 被丢弃、渲染层 console 由主进程侧收进 desktop-layer.log，
    // 这里把失败原因（HTTP 状态 / 网络错误码）打出来，否则卡加载在用户侧无从排查。
    // 仅开发模式输出：正式版不采集渲染层 console。
    if (import.meta.env.DEV && !appsLoadLogged) {
      appsLoadLogged = true
      console.warn('[desktop-widget] 常用软件读取失败：',
        'status=' + (err?.response?.status ?? '-') ,
        'code=' + (err?.code ?? '-'),
        'msg=' + (err?.message ?? '-'),
        'data=' + JSON.stringify(err?.response?.data ?? null).slice(0, 200))
    }
    return false
  }
}

// 通知主进程「内容已就绪」：host 收到后才把窗口显示出来。
// 窗口在内容就绪前是「有背景材质、没有内容」的灰色亚克力板（看着像毛玻璃坏了），
// 所以必须等这里发信号才 show。
// 现在改为「Vue 挂载后的首帧」就发信号：骨架（时钟/空面板）先上屏，课程/值日/人数/
// 常用软件都在后台继续加载。之前要等 loadApps 网络请求结束才显示，后端未就绪时会被
// 拖到 4 秒兜底，是打包版也明显慢的主要原因。
let contentReadySent = false
function notifyContentReady() {
  if (contentReadySent) return
  contentReadySent = true
  try {
    window.electron?.send?.(SEND.DESKTOP_WIDGET_CONTENT_READY)
  } catch (_) {
    /* 忽略 */
  }
}

// 组件常驻且会先于后端/登录态启动：首次读失败就退避重试，直到成功一次为止。
// 这样登录完成后（storage 里的 token 更新）无需重启组件也能自动恢复。
function scheduleAppsReload() {
  if (appsLoaded.value || appsLoadTimer) return
  appsLoadTimer = setTimeout(async () => {
    appsLoadTimer = null
    if (appsLoaded.value) return
    const ok = await loadApps()
    if (!ok) scheduleAppsReload()
  }, 3000)
}

async function ensureAppsLoaded() {
  if (appsLoaded.value) return true
  if (await loadApps()) return true
  scheduleAppsReload()
  return false
}

function launchApp(app) {
  if (!app || !app.path) return
  if (window.electron && window.electron.invoke) {
    window.electron.invoke(INVOKE.APPS_LAUNCH, app.path).catch(() => {})
  }
}

// 点击面板跳主窗口：组件跑在独立进程里，这里只发意图，由主进程负责
// 唤醒/重建主窗口并把路由推给主窗口渲染层（见 electron/main/main.widget.js 的 openMainPage）。
function openMainPage(page) {
  if (!page) return
  try { window.electron?.send?.(SEND.DESKTOP_WIDGET_OPEN_PAGE, page) } catch (_) {}
}

function toggleEdit() {
  editing.value = !editing.value
  // 退出编辑态时主动清掉可能残留的拖拽状态与浮动元素
  if (!editing.value) {
    destroyDragArtifacts()
    dragIndex.value = null
    dragOverIndex.value = null
    dragMoving.value = false
    dragPointerId = null
  }
}

async function addApp() {
  if (!(await ensureAppsLoaded())) {
    showHint('常用软件还在加载，请稍后再试')
    return
  }
  if (apps.value.length >= MAX_APPS) {
    showHint(`最多添加 ${MAX_APPS} 个常用软件`)
    return
  }
  try {
    if (!window.electron || !window.electron.invoke) return
    const result = await window.electron.invoke(INVOKE.APPS_SELECT_FILE)
    if (!result || result.canceled || !result.filePath) return
    // 对话框打开期间可能已拖入新项占满槽位，提交前再判一次
    if (apps.value.length >= MAX_APPS) {
      showHint(`最多添加 ${MAX_APPS} 个常用软件`)
      return
    }
    apps.value.push({
      id: newAppId(),
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

// ===== 拖入添加（快捷方式 / 文件夹 / 文件）=====
// Electron 32 起 File.path 已移除，真实路径必须经 preload 的 webUtils.getPathForFile 获取；
// 拿不到时回退旧字段，保证老版本 Electron 也能添加（只是名称/图标退化为本地推导）。
function pathOfFile(file) {
  try {
    const p = window.electron?.getPathForFile?.(file)
    if (p) return p
  } catch (_) {}
  return typeof file?.path === 'string' ? file.path : ''
}

// 主进程通道不可用时的兜底条目：名称取文件名并去掉可执行类扩展名
function fallbackEntry(p) {
  const base = String(p).split(/[\\/]/).pop() || String(p)
  return {
    name: base.replace(/\.(exe|lnk|bat|cmd)$/i, '').slice(0, 30),
    path: String(p),
    icon: '',
  }
}

function hasFiles(e) {
  const types = e.dataTransfer?.types
  return !!types && Array.from(types).includes('Files')
}

async function importDroppedFiles(fileList) {
  const files = Array.from(fileList || [])
  if (files.length === 0) return
  if (!(await ensureAppsLoaded())) {
    showHint('常用软件还在加载，请稍后再试')
    return
  }
  if (apps.value.length >= MAX_APPS) {
    showHint(`最多添加 ${MAX_APPS} 个常用软件`)
    return
  }
  const paths = files.map(pathOfFile).filter(Boolean)
  if (paths.length === 0) {
    showHint('无法读取拖入项目的路径')
    return
  }

  let entries = []
  try {
    // 由主进程统一取名称与系统图标（文件夹/普通文件/快捷方式都支持）
    const resolved = await window.electron.invoke(INVOKE.APPS_RESOLVE_PATHS, paths)
    if (Array.isArray(resolved)) entries = resolved
  } catch (_) { /* 通道不可用时退回本地解析 */ }
  if (entries.length === 0) entries = paths.map(fallbackEntry)

  // 去重：同一路径不重复占槽位
  const existing = new Set(apps.value.map((a) => String(a.path).toLowerCase()))
  const fresh = entries.filter((it) => {
    if (!it || !it.path) return false
    const key = String(it.path).toLowerCase()
    if (existing.has(key)) return false
    existing.add(key)
    return true
  })

  const room = MAX_APPS - apps.value.length
  const added = fresh.slice(0, room)
  for (const it of added) {
    apps.value.push({
      id: newAppId(),
      name: String(it.name || '未命名').slice(0, 30),
      path: String(it.path),
      icon: typeof it.icon === 'string' ? it.icon : '',
    })
  }
  if (added.length > 0) saveApps()

  if (fresh.length > room) showHint(`最多添加 ${MAX_APPS} 个常用软件`)
  else if (added.length === 0) showHint('这些项目已在常用软件中')
}

// 面板级拖放：只处理从系统拖入的文件/文件夹/快捷方式；内部排序走 Pointer Events
function onGridDragOver(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragActive.value = true
}

function onGridDragLeave(e) {
  // 子元素之间移动也会触发 dragleave，移到面板外才取消高亮
  if (e.currentTarget && e.currentTarget.contains(e.relatedTarget)) return
  dragActive.value = false
}

function onGridDrop(e) {
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  e.preventDefault()
  dragActive.value = false
  importDroppedFiles(files)
}

function moveApp(from, to) {
  if (from === null || from < 0 || from === to) return
  if (from >= apps.value.length || to < 0) return
  const arr = apps.value.slice()
  const [moved] = arr.splice(from, 1)
  arr.splice(Math.min(to, arr.length), 0, moved)
  apps.value = arr
  saveApps()
}

// ===== 常用软件排序（直接拖图标，Pointer Events + 表格同款让位动画）=====
// 常态和编辑态都能拖，不需要手柄；轻点仍是启动应用（拖动阈值 3px 后才会进入拖拽）。
// 为什么不用 HTML5 draggable：桌面组件是无边框常驻窗口，原生 dragstart 在部分窗口形态下
// 根本不触发，表现为「图标拖不动」。这里用 pointerdown + setPointerCapture 自实现。
//
// 动画结构参考 composables/tableDragFx.js 与 GridView.drag.js：
//   · 跟手虚影：半透明克隆，跟随指针（带抓取偏移，不跳位）
//   · 落点虚影 + 蓝框：贴在目标槽位原本的几何位置，提示最终落点
//   · 让位：被跨过的项用 transform 平滑挪到相邻槽位，腾出空位（180ms 缓动）
//   · 松手：先清让位再落位，最后让被拖项从虚影停住的位置滑入最终槽位（200ms）
const DRAG_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)'
const SHIFT_ATTR = 'data-app-shift'

function appItemEls() {
  return gridRef.value ? gridRef.value.querySelectorAll('[data-app-index]') : []
}

// 拖拽开始时一次性缓存所有已填充槽位的视口几何，拖动过程中不再读取布局
function cacheSlotRects() {
  const rects = []
  for (const el of appItemEls()) {
    const i = Number(el.dataset.appIndex)
    if (!Number.isInteger(i)) continue
    const r = el.getBoundingClientRect()
    rects[i] = { left: r.left, top: r.top, width: r.width, height: r.height }
  }
  dragSlotRects = rects
}

// 命中判定：指针在哪个槽位内就用哪个；都不在时取最近的已填充槽位
// （拖到空槽区域会自然落到最后一个已填充槽位，即移动到末尾）
function resolveDragTarget(x, y) {
  let best = null
  let min = Infinity
  for (let i = 0; i < dragSlotRects.length; i++) {
    const r = dragSlotRects[i]
    if (!r) continue
    if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) return i
    const dx = x - (r.left + r.width / 2)
    const dy = y - (r.top + r.height / 2)
    const d = dx * dx + dy * dy
    if (d < min) { min = d; best = i }
  }
  return best
}

// 让位：只写 transform，不动 DOM 顺序，避免与 Vue 的 v-for key 复用打架。
// 每项记录上次位移，值没变就不写样式（拖拽时每次移动都会遍历 8 个节点）。
function setShift(el, dx, dy) {
  if (!el) return
  if (el.__appDx === dx && el.__appDy === dy) return
  el.__appDx = dx
  el.__appDy = dy
  if (!el.hasAttribute(SHIFT_ATTR)) {
    el.setAttribute(SHIFT_ATTR, '1')
    el.style.transition = `transform 180ms ${DRAG_EASE}`
  }
  el.style.transform = (dx || dy) ? `translate(${dx}px, ${dy}px)` : ''
}

function applyAppShift(from, to) {
  const active = from !== null && to !== null && from !== to
  for (const el of appItemEls()) {
    const i = Number(el.dataset.appIndex)
    if (!active || !Number.isInteger(i) || i === from) {
      setShift(el, 0, 0)
      continue
    }
    let dx = 0
    let dy = 0
    if (to > from && i > from && i <= to) {
      // 向下/向后拖：这一段每项都挪到「前一个槽位」的位置，逐格补偿
      const a = dragSlotRects[i - 1]
      const b = dragSlotRects[i]
      if (a && b) { dx = a.left - b.left; dy = a.top - b.top }
    } else if (to < from && i >= to && i < from) {
      // 向上/向前拖：这一段每项都挪到「后一个槽位」的位置
      const a = dragSlotRects[i + 1]
      const b = dragSlotRects[i]
      if (a && b) { dx = a.left - b.left; dy = a.top - b.top }
    }
    setShift(el, dx, dy)
  }
}

function clearAppShifts() {
  for (const el of appItemEls()) {
    if (!el.hasAttribute(SHIFT_ATTR)) continue
    el.style.transform = ''
    el.style.transition = ''
    el.__appDx = 0
    el.__appDy = 0
    el.removeAttribute(SHIFT_ATTR)
  }
}

// 克隆一个「干净」的项：去掉删除按钮与编辑态类，只保留图标和名称
function cloneAppItem(src) {
  if (!src) return null
  const el = src.cloneNode(true)
  el.querySelectorAll('.app-op').forEach((node) => node.remove())
  el.classList.remove('dragging', 'app-item-editing')
  el.removeAttribute('data-app-index')
  el.removeAttribute('title')
  return el
}

function createDragGhost() {
  if (dragGhost || !dragItemEl) return
  const rect = dragItemEl.getBoundingClientRect()
  dragGhost = cloneAppItem(dragItemEl)
  if (!dragGhost) return
  dragGhost.classList.add('app-drag-ghost')
  Object.assign(dragGhost.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: '100000',
    opacity: '0.9',
    transform: 'translate(0, 0)',
    willChange: 'transform',
    transition: 'none',
  })
  document.body.appendChild(dragGhost)
}

function createDragSlotVisuals() {
  if (!dragDropBox) {
    dragDropBox = document.createElement('div')
    dragDropBox.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;pointer-events:none;display:none;box-sizing:border-box;will-change:transform;border:2px solid var(--color-info, #2563eb);border-radius:var(--radius-control,12px);'
    document.body.appendChild(dragDropBox)
  }
  if (!dragSlotGhost && dragItemEl) {
    const rect = dragItemEl.getBoundingClientRect()
    dragSlotGhost = cloneAppItem(dragItemEl)
    if (!dragSlotGhost) return
    dragSlotGhost.classList.add('app-drag-ghost')
    Object.assign(dragSlotGhost.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      pointerEvents: 'none',
      zIndex: '99997',
      opacity: '0.22',
      display: 'none',
      boxShadow: 'none',
      transition: 'none',
    })
    document.body.appendChild(dragSlotGhost)
  }
}

function placeDragGhost(x, y) {
  if (!dragGhost) return
  // 保持抓取偏移：虚影不会突然跳到指针中心
  dragGhost.style.transform = `translate(${x - dragGrab.x}px, ${y - dragGrab.y}px)`
}

function updateDragSlot() {
  if (!dragDropBox) return
  const to = dragOverIndex.value
  const from = dragIndex.value
  const rect = to !== null ? dragSlotRects[to] : null
  // 还停在源槽位时没有空位，不显示落点框/落点虚影，避免和源项叠影
  if (!dragMoving.value || !rect || to === from) {
    dragDropBox.style.display = 'none'
    if (dragSlotGhost) dragSlotGhost.style.display = 'none'
    return
  }
  dragDropBox.style.display = 'block'
  dragDropBox.style.transform = `translate(${rect.left}px, ${rect.top}px)`
  dragDropBox.style.width = `${rect.width}px`
  dragDropBox.style.height = `${rect.height}px`
  if (dragSlotGhost) {
    dragSlotGhost.style.display = 'block'
    dragSlotGhost.style.transform = `translate(${rect.left}px, ${rect.top}px)`
  }
}

// 清掉所有浮动元素与让位位移（拖拽结束/取消、退出编辑态、组件卸载时调用）
function destroyDragArtifacts() {
  clearAppShifts()
  if (dragGhost) { dragGhost.remove(); dragGhost = null }
  if (dragSlotGhost) { dragSlotGhost.remove(); dragSlotGhost = null }
  if (dragDropBox) { dragDropBox.remove(); dragDropBox = null }
  dragSlotRects = []
  dragItemEl = null
  dragGrab = { x: 0, y: 0 }
  dragLastPoint = { x: 0, y: 0 }
}

function onAppClick(slot) {
  // 刚拖完的点击直接吞掉；编辑态点击不启动，只用于拖动/删除
  if (performance.now() < suppressAppClickUntil) return
  if (editing.value) return
  launchApp(slot)
}

function onAppDragStart(idx, e) {
  if (e.button !== 0) return
  // 右上角删除按钮自己处理点击，不触发拖动
  if (e.target && e.target.closest && e.target.closest('button.app-op')) return
  const item = e.currentTarget && e.currentTarget.closest ? e.currentTarget.closest('.app-item') : null
  if (!item) return
  destroyDragArtifacts()
  dragItemEl = item
  const rect = item.getBoundingClientRect()
  dragGrab = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  dragLastPoint = { x: e.clientX, y: e.clientY }
  cacheSlotRects()
  dragIndex.value = idx
  dragOverIndex.value = idx
  dragMoving.value = false
  dragPointerId = e.pointerId
  dragStartX = e.clientX
  dragStartY = e.clientY
  // 捕获指针：拖出图标/槽位后仍能收到 pointermove/pointerup，不会中断
  // 注意不在这里 preventDefault：要保留 click，非编辑态轻点图标仍可启动应用
  try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) {}
}

function onAppDragMove(e) {
  if (dragIndex.value === null || e.pointerId !== dragPointerId) return
  dragLastPoint = { x: e.clientX, y: e.clientY }
  if (!dragMoving.value) {
    // 3px 阈值，避免只点一下图标就被当成一次排序
    if (Math.abs(e.clientX - dragStartX) < 3 && Math.abs(e.clientY - dragStartY) < 3) return
    dragMoving.value = true
    // 进入拖拽后阻止默认行为，避免触控板/触屏把移动当成页面滚动
    try { e.preventDefault() } catch (_) {}
    createDragGhost()
    createDragSlotVisuals()
    placeDragGhost(e.clientX, e.clientY)
    updateDragSlot()
  }
  placeDragGhost(e.clientX, e.clientY)
  const target = resolveDragTarget(e.clientX, e.clientY)
  if (target !== dragOverIndex.value) {
    dragOverIndex.value = target
    applyAppShift(dragIndex.value, target)
    updateDragSlot()
  }
}

function onAppDragEnd(e) {
  if (dragIndex.value === null) return
  if (e && e.pointerId !== dragPointerId) return
  const from = dragIndex.value
  const to = dragOverIndex.value
  const wasDragging = dragMoving.value
  // 优先用抬起时的坐标，虚影与落点动画衔接更准
  const release = e && typeof e.clientX === 'number'
    ? { x: e.clientX, y: e.clientY }
    : dragLastPoint
  const grab = dragGrab
  // 先清浮动元素与让位，保证「清位 + 重排」落在同一帧，不会看到先弹回原位
  destroyDragArtifacts()
  dragIndex.value = null
  dragOverIndex.value = null
  dragMoving.value = false
  dragPointerId = null
  // 真拖动过就吞掉随后补发的 click，避免松手瞬间启动应用
  if (wasDragging) suppressAppClickUntil = performance.now() + 400
  if (!wasDragging || from === null || to === null || from === to) return
  moveApp(from, to)
  // 等重排渲染完成后，让被移动项从松手位置滑入最终槽位
  nextTick(() => slideAppIntoSlot(to, release, grab))
}

// 松手滑入：从虚影最后停住的左上角滑到最终槽位，与 GridView._slideInRow 同款 200ms 缓动
function slideAppIntoSlot(idx, release, grab) {
  const el = gridRef.value ? gridRef.value.querySelector(`[data-app-index="${idx}"]`) : null
  if (!el || typeof el.animate !== 'function') return
  const r = el.getBoundingClientRect()
  const dx = Math.round(release.x - grab.x - r.left)
  const dy = Math.round(release.y - grab.y - r.top)
  if (!dx && !dy) return
  el.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
    { duration: 200, easing: DRAG_EASE }
  )
}

function saveApps(attempt = 0) {
  // 未成功读取过就绝不写入：否则会把数据库里有、但本次还没读到的旧列表覆盖掉
  if (!appsLoaded.value) return
  // 每次重试都读当前列表，用户中途又改了也不会写回旧快照
  axios.put('/api/widget-settings/apps', { desktopApps: apps.value.slice(0, MAX_APPS) }).catch(() => {
    if (attempt < 2) {
      setTimeout(() => saveApps(attempt + 1), 2000)
    } else {
      showHint('常用软件保存失败，请稍后重试')
    }
  })
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
    // 响应校验：只接受 { cells, settings } 形态。网络层偶发会把未解密的 { d } 信封
    // （或 Vite 代理的 HTML）当成 200 正常响应返回，直接赋值会让 settings.sections /
    // settings.items 抛错、整块白板——此时保留上一次的数据（默认值是空课表）。
    const pickDoc = (payload, prev) => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return prev
      if (!payload.settings || typeof payload.settings !== 'object') return prev
      return payload
    }
    schedule.value = pickDoc(scheduleRes.data, schedule.value)
    duty.value = pickDoc(dutyRes.data, duty.value)
    countdowns.value = Array.isArray(countdownsRes.data) ? countdownsRes.data : (countdownsRes.data.data || [])
    leaves.value = Array.isArray(leavesRes.data) ? leavesRes.data : (leavesRes.data.data || [])
    students.value = Array.isArray(studentsRes.data) ? studentsRes.data : (studentsRes.data.data || [])
  } catch (_) {
    // 静默失败，保留旧数据
  }
}

// ========== 窗口拖动 ==========
// 两种形态共用一条路径：窗口在本方案里**始终是普通顶层窗口**（置底模式只是把它的
// z 序插到「Progman 之上、所有普通窗口之下」，不再 SetParent 成桌面子窗口）。
// 因此不能用 -webkit-app-region（会走 Chromium 的原生移动循环），统一由渲染层上报
// screenX/screenY（CSS 像素 = DIP），host 用 setContentBounds 搬窗口。
// screenX/screenY 是屏幕绝对坐标，不随窗口自身移动变化，故拖动不会自我叠加。
let windowDragging = false
let dragMoveLogged = false

function onWindowDragStart(e) {
  if (import.meta.env.DEV) {
    console.info('[dw-timing] dragstart layer=' + isDesktopLayer.value +
      ' btn=' + e.button + ' type=' + e.pointerType)
  }
  dragMoveLogged = false
  if (e.button !== 0 || !window.electron || !window.electron.send) return
  windowDragging = true
  e.preventDefault()
  // 捕获指针：鼠标被甩出窗口时仍能收到 pointermove，否则快速拖动会中途断连
  try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) {}
  window.electron.send('desktop-widget-drag-start', { screenX: e.screenX, screenY: e.screenY })
}

function onWindowDragMove(e) {
  if (!windowDragging) return
  if (import.meta.env.DEV && !dragMoveLogged) {
    dragMoveLogged = true
    console.info('[dw-timing] dragmove first buttons=' + e.buttons)
  }
  window.electron.send('desktop-widget-drag-move', { screenX: e.screenX, screenY: e.screenY })
}

function onWindowDragEnd() {
  if (!windowDragging) return
  windowDragging = false
  if (import.meta.env.DEV) console.info('[dw-timing] dragend')
  window.electron.send('desktop-widget-drag-end')
}

// ========== 生命周期 ==========
let refreshClock = null

onMounted(() => {
  loadAll()
  // 读取失败（后端/登录态还没就绪）就自动退避重试，避免显示空列表后又把旧数据覆盖
  loadApps().then((ok) => { if (!ok) scheduleAppsReload() })
  // 挂载完成就通知 host show：此时骨架 DOM 已生成，数据继续在后台加载。
  // 不用 rAF 等待：窗口隐藏时 rAF 是否触发依赖节流策略，不能拿它当上屏前提。
  nextTick(() => notifyContentReady())
  // 系统深浅色：初始化 + 监听变化（Windows 切换深色/浅色时组件实时跟随）
  darkMedia = window.matchMedia('(prefers-color-scheme: dark)')
  syncSystemDark()
  darkMedia.addEventListener('change', syncSystemDark)
  // 兜底：请求长时间不返回（例如后端还没起来）时也要把窗口放出来，
  // 否则用户看到的是「什么都没有」——组件内已有骨架与时钟，先显示比一直空着好。
  setTimeout(() => notifyContentReady(), 4000)
  // 询问主进程当前是否已置底（只用于日志与手柄样式；拖动路径两种情况下都一样）
  Promise.resolve(window.electron?.invoke?.(INVOKE.GET_DESKTOP_LAYER_STATE))
    .then((st) => {
      if (st) isDesktopLayer.value = !!st.desktopLayerEnabled
      if (import.meta.env.DEV) console.info('[dw-timing] layerState=' + JSON.stringify(st || null) + ' isLayer=' + isDesktopLayer.value)
    })
    .catch(() => {})
  // 拖动/松手都在窗口级监听：指针可能被甩出窗口（捕获失败时），窗口级监听负责收尾
  window.addEventListener('pointermove', onWindowDragMove)
  window.addEventListener('pointerup', onWindowDragEnd)
  window.addEventListener('pointercancel', onWindowDragEnd)
  if (import.meta.env.DEV) {
    document.addEventListener('lostpointercapture', () => console.info('[dw-timing] lostcapture'), true)
    window.addEventListener('pointercancel', () => console.info('[dw-timing] pointercancel'), true)
    window.addEventListener('pointerup', (ev) => console.info('[dw-timing] pointerup buttons=' + ev.buttons), true)
  }
  // 常用软件排序：即使指针捕获失败/拖出窗口，窗口级监听也能兜底收尾
  window.addEventListener('pointermove', onAppDragMove)
  window.addEventListener('pointerup', onAppDragEnd)
  window.addEventListener('pointercancel', onAppDragEnd)
  // every 5 分钟刷新数据；now 仅驱动倒计时/课程等分钟级状态，秒级走 AnimatedClock
  refreshTimer = setInterval(loadAll, 5 * 60 * 1000)
  refreshClock = setInterval(() => { now.value = new Date() }, 60000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (refreshClock) clearInterval(refreshClock)
  if (hintTimer) clearTimeout(hintTimer)
  if (appsLoadTimer) clearTimeout(appsLoadTimer)
  if (darkMedia) darkMedia.removeEventListener('change', syncSystemDark)
  destroyDragArtifacts()
  window.removeEventListener('pointermove', onWindowDragMove)
  window.removeEventListener('pointerup', onWindowDragEnd)
  window.removeEventListener('pointercancel', onWindowDragEnd)
  window.removeEventListener('pointermove', onAppDragMove)
  window.removeEventListener('pointerup', onAppDragEnd)
  window.removeEventListener('pointercancel', onAppDragEnd)
})
</script>

<style scoped>
.desktop-widget {
  /* 宽度与主进程窗口 setContentSize(320,...) 完全一致，避免四周漏出窗口底色边缘 */
  width: 320px;
  min-height: 100vh;
  padding: 16px;
  box-sizing: border-box;
  /* 内容超高时（值日项目多/课程全满）纵向滚动，避免底部卡片被窗口裁掉 */
  max-height: 100vh;
  overflow-y: auto;
  /* 底色由 .dw-wallpaper + .dw-veil 两层提供，这里保持透明 */
  background: transparent;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  color: #1f2937;
}

/* ===== 自绘磨砂：Win11 Bloom 蓝光晕 + 蓝白雾面遮罩 =====
   配方照 Windows 11 默认壁纸（Bloom）的构成方式：**多个大面积同族色光斑**叠一层基础
   渐变，而不是单点 radial —— 这样才有多层玻璃纸叠在一起的层次感，也才有 Win11 那种
   「蓝紫偏青、边缘转深蓝」的调子。
   光斑顺序即层序（前面的压在上面），基础渐变放最后打底；每层色都带 alpha，
   叠起来整块仍是不透明（窗口 backgroundColor 是 #f6f8fc，不会透出桌面）。
   两层都是 fixed + z-index:-1，不参与内容滚动。
   纯渐变本身已是平滑过渡，不需要 blur（加 blur 只会多一层 GPU 合成）。 */
.dw-wallpaper {
  position: fixed;
  inset: 0;
  z-index: -1;
  background-image:
    /* 1. 左上主光斑：最亮的湖蓝，Win11 光源就在这一侧 */
    radial-gradient(90% 52% at 18% 4%, rgba(118, 176, 255, 0.80), rgba(118, 176, 255, 0) 62%),
    /* 2. 右上副光斑：蓝紫，和主光斑交界处形成淡紫过渡带 */
    radial-gradient(86% 50% at 92% 16%, rgba(146, 160, 255, 0.62), rgba(146, 160, 255, 0) 64%),
    /* 3. 中部青蓝柔光：把上下两半的色调接起来，避免中段发灰 */
    radial-gradient(104% 46% at 46% 46%, rgba(92, 194, 255, 0.40), rgba(92, 194, 255, 0) 72%),
    /* 4. 底部深蓝收边：贴近 Win11 Bloom 下缘的沉色，让卡片区看起来"压在玻璃上" */
    radial-gradient(124% 58% at 68% 106%, rgba(70, 110, 214, 0.60), rgba(70, 110, 214, 0) 70%),
    /* 5. 基础渐变：整体由浅到深的蓝，作为上面所有光斑的地 */
    linear-gradient(170deg, #d3e4ff 0%, #bcd3f8 38%, #a8c2f0 68%, #93b0e6 100%);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  pointer-events: none;
}

/* 四角圆角：窗口是逐像素透明的（transparent:true），这里给两层铺满的底色裁 12px 圆角，
   四角外侧就真的透出壁纸。12px 与原先 SetWindowRgn 的 12 DIP 半径一致，观感不变；
   区别是 CSS 圆角带抗锯齿，边缘比硬裁更细腻。
   注意：不要再改回 SetWindowRgn —— 「非矩形窗口 + 移动」会让 Electron 原生崩溃，
   详见 electron/main/main.desktop-layer.js 顶部的说明。 */
.dw-wallpaper,
.dw-veil {
  border-radius: 12px;
}

/* 遮罩：从原来的「0.9 奶白」降到 0.62~0.78 的蓝白雾面。
   原先是 90% 白，蓝色基本被洗掉，整窗看着像块灰白板；
   现在让底色透出约三成，观感是「冻住的蓝色玻璃」，正文 #1f2937 仍稳在可读对比度上。
   做成上浅下微深的竖向渐变，是因为深色压在底部能与第 4 层深蓝光斑叠出层次，
   比单色遮罩更有纵深。 */
.dw-veil {
  position: fixed;
  inset: 0;
  z-index: -1;
  background-image: linear-gradient(
    180deg,
    rgba(248, 251, 255, 0.62) 0%,
    rgba(243, 248, 255, 0.70) 52%,
    rgba(236, 243, 253, 0.78) 100%
  );
  pointer-events: none;
}

/* 拖动手柄：两种形态都**不用** -webkit-app-region 拖动。
   app-region 的拖动由 Chromium 发起原生窗口移动循环；窗口挂成 Progman 子窗口后，
   该移动循环会让 Electron 宿主进程原生崩溃（0xC000041D，实测）。改为渲染层上报
   screenX/screenY、host 进程 SetWindowPos 搬窗口，顶层/桌面层两种形态共用一条路径。 */
.drag-handle {
  cursor: move;
  -webkit-app-region: no-drag;
}
.drag-handle-layer {
  -webkit-app-region: no-drag;
}

/* 各区块共用毛玻璃面板：半透明白底 + 柔和边框/高光。
   背景由整窗的 .dw-wallpaper 渐变 + .dw-veil 遮罩提供，卡片只是压在其上的半透明层。
   蓝色背景透出来之后，卡片底从 0.42 抬到 0.52，避免蓝光直接咬到正文；
   阴影换成带蓝味的冷色（纯黑压在蓝底上会发脏），保留 Win11 那道 1px 顶部内高光。 */
.glass-panel {
  position: relative;
  background: rgba(255, 255, 255, 0.52);
  backdrop-filter: blur(20px) saturate(1.3);
  border: 1px solid rgba(255, 255, 255, 0.62);
  border-radius: var(--radius-card);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.7),
    0 2px 10px rgba(31, 58, 122, 0.08);
  padding: 10px 12px;
}

/* 可跳转的面板：整块可点，悬停时轻微提亮上浮，提示「这里能进主窗口」 */
.clickable-panel {
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.clickable-panel:hover {
  background: rgba(255, 255, 255, 0.68);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.8),
    0 4px 16px rgba(31, 58, 122, 0.16);
}

.clickable-panel:active {
  transform: translateY(1px);
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
  border-radius: var(--radius-control);
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

/* 常用软件面板：固定 8 槽（4×2），空槽与拖入高亮都落在这块面板内 */
.apps-panel {
  position: relative;
  margin-top: 8px;
  min-height: 132px;
  display: flex;
  flex-direction: column;
}

/* 从系统拖入文件时整块面板高亮，提示可放下 */
.apps-panel-drop {
  border-color: rgba(37, 99, 235, 0.6);
  box-shadow:
    inset 0 0 0 1px rgba(37, 99, 235, 0.35),
    0 0 0 3px rgba(37, 99, 235, 0.1);
}

.apps-drop-tip {
  position: absolute;
  left: 6px;
  right: 6px;
  top: 30px;
  bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(37, 99, 235, 0.7);
  border-radius: var(--radius-control);
  background: rgba(37, 99, 235, 0.08);
  color: #1d4ed8;
  font-size: 12px;
  pointer-events: none;
  z-index: 2;
}

/* 上限/去重提示：浮在面板底部，不改变 8 槽布局 */
.apps-hint {
  position: absolute;
  left: 50%;
  bottom: 8px;
  transform: translateX(-50%);
  max-width: 92%;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.78);
  color: #fff;
  font-size: 11px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  z-index: 3;
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
  border-radius: var(--radius-control);
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
  /* 8 槽固定两行；行高至少容纳「图标 + 名称 + 内边距」，避免被面板 min-height 压扁 */
  grid-auto-rows: minmax(78px, 1fr);
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
  /* 左右对称内边距，图标/名称始终居中；编辑态不再改变内边距，图标位置不会跳动 */
  padding: 10px;
  border-radius: var(--radius-control);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.app-item:hover {
  background-color: rgba(255, 255, 255, 0.55);
}

.app-item-editing {
  /* 内边距与常态一致（左右各 10px），仅切换光标；图标位置不会因进入编辑态而移动 */
  cursor: default;
}

.app-icon {
  width: 38px;
  height: 38px;
  object-fit: contain;
  border-radius: var(--radius-control);
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

/* 空槽本身是 <button>：压掉 glass / win11 主题给所有 button 套的 1px 描边
   （theme-glass 只设了 border-width/style，颜色会落到 currentColor，看起来像黑框）
   以及荧光环，让它与普通槽位观感一致，只留下虚线加号。
   主题样式在运行时晚于组件样式加载，这里用 !important + 去掉原生 appearance 兜底。 */
button.app-add {
  -webkit-appearance: none;
  appearance: none;
  font: inherit;
  color: inherit;
  border: none !important;
  border-radius: var(--radius-control) !important;
  background: transparent !important;
  box-shadow: none !important;
  outline: none;
}
button.app-add::before {
  display: none !important;
  content: none !important;
}
button.app-add:focus-visible {
  /* 键盘聚焦时给一个淡蓝描边，替代被去掉的默认焦点框 */
  outline: 2px solid rgba(37, 99, 235, 0.55);
  outline-offset: 1px;
}
button.app-add:hover .app-icon-add {
  color: #2563eb;
  border-color: #2563eb;
}

/* 拖拽源半透明（与表格拖行时一致），跟手虚影负责表现“拿起来了” */
.app-item.dragging {
  opacity: 0.3;
  cursor: grabbing;
}

/* 拖拽时挂到 body 上的克隆虚影。克隆节点保留了 data-v，所以这条作用域样式仍能命中。
   落点虚影复用同一类，透明度由内联样式压到 0.22。 */
.app-drag-ghost {
  background: var(--color-surface, rgba(255, 255, 255, 0.9));
  border-radius: var(--radius-control);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}

/* 删除按钮：必须用 button.app-op + !important。毛玻璃主题
   `:root:is([data-theme=...]) button { position: relative }` 的权重很高，
   会把普通 `.app-op` 的绝对定位覆盖掉，按钮掉回 flex 流、跑到图标下方。 */
button.app-op {
  -webkit-appearance: none;
  appearance: none;
  /* 主题的 :root:is(...) button 规则权重会与之打平，必须用 !important 锁定绝对定位 */
  position: absolute !important;
  /* 明确放到槽位右上角 */
  top: 2px !important;
  right: 2px !important;
  font-size: 9px;
  line-height: 1;
  width: 15px;
  height: 15px;
  padding: 0;
  border: none !important;
  border-radius: 50% !important;
  box-shadow: none !important;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
}

/* 同样压掉毛玻璃主题给 button 的荧光描边 */
button.app-op::before {
  display: none !important;
  content: none !important;
}

.app-op-del {
  background: #ef4444;
  color: #fff;
}

.app-op-del:hover {
  background: #dc2626;
}

/* ===== 夜间（跟随 Windows 的深色模式）=====
   .dw-night 由渲染层根据 prefers-color-scheme 打上（见 script 的 systemDark），
   Windows 切深色/浅色时实时生效。文字仍取 glass2 的夜色（#e7eaf6 / 次文字 #a8bcdf），
   但**底色明确走 Win11 深色那种冷蓝**（不是中性灰紫）：壁纸光斑亮到能看出蓝，
   遮罩只压 0.44~0.58，蓝能透出四成以上。 */
.desktop-widget.dw-night {
  /* 滚动条等原生控件跟随深色 */
  color-scheme: dark;
  /* 时钟（AnimatedClock 组件）通过这两个变量取色；
     日期色用蓝灰而非中性灰，跟整窗的蓝调统一 */
  --ac-time-color: #f2f6ff;
  --ac-date-color: #a8bce0;
  color: #e7eaf6;
}

/* 夜间遮罩：压到 .54~.66。上一版只遮 .44~.58 时蓝确实够亮，但整窗偏刺眼；
   这里把亮度收回一档，同时保持遮罩色带蓝（12,22,46）而不是近黑 ——
   「淡」要淡在明度上，不能连色相一起灰掉。 */
.desktop-widget.dw-night .dw-veil {
  background-image: linear-gradient(
    180deg,
    rgba(12, 22, 46, 0.54) 0%,
    rgba(10, 18, 38, 0.60) 52%,
    rgba(8, 14, 30, 0.66) 100%
  );
}

/* 夜间 Win11 Bloom：和白天同一套层结构，色相保持冷蓝，但光斑 alpha 整体收回一档
   （.88/.74/.60/.80 → .74/.62/.50/.70），让层次看得出、又不会一片发亮。
   基础渐变照旧是带蓝的 #1d3460 → #0c1730，不往黑压 —— 深色模式最容易踩的坑就是
   「一路 dim 到黑」，结果蓝全丢了、看着像灰板。 */
.desktop-widget.dw-night .dw-wallpaper {
  background-image:
    /* 1. 左上主光斑：白天同位置的湖蓝 */
    radial-gradient(92% 54% at 18% 3%, rgba(74, 138, 255, 0.74), rgba(74, 138, 255, 0) 64%),
    /* 2. 右上副光斑：蓝紫，与主光斑交界形成 Win11 那圈淡紫过渡 */
    radial-gradient(88% 52% at 92% 15%, rgba(124, 106, 255, 0.62), rgba(124, 106, 255, 0) 66%),
    /* 3. 中部青蓝柔光：接上下两半，避免中段塌成灰 */
    radial-gradient(106% 48% at 46% 46%, rgba(56, 138, 245, 0.50), rgba(56, 138, 245, 0) 74%),
    /* 4. 底部深蓝收边：压住卡片区的重心，但不压到发黑 */
    radial-gradient(126% 60% at 68% 106%, rgba(40, 88, 200, 0.70), rgba(40, 88, 200, 0) 72%),
    /* 5. 基础渐变：整体是「深蓝」而不是「深灰蓝」 */
    linear-gradient(170deg, #1d3460 0%, #172a51 38%, #122040 68%, #0c1730 100%);
}

/* 夜间卡片底也往蓝推一点（42,50,76 → 28,43,82）：卡片压在蓝光晕上时，
   底色若不偏蓝，会在亮蓝背景下显得发灰、像贴了张灰纸。
   不透明度 .60 让蓝能微微透进卡片，接近 Win11 深色 Mica 的观感。 */
.desktop-widget.dw-night .glass-panel {
  background: rgba(28, 43, 82, 0.60);
  border-color: rgba(255, 255, 255, 0.13);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    0 2px 10px rgba(0, 0, 0, 0.35);
}

.desktop-widget.dw-night .clickable-panel:hover {
  background: rgba(45, 62, 110, 0.72);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    0 4px 16px rgba(0, 0, 0, 0.4);
}

.desktop-widget.dw-night .countdown-item {
  color: #e7eaf6;
}

.desktop-widget.dw-night .next-class {
  color: #93a8ff;
}

.desktop-widget.dw-night .panel-title {
  color: #a8bcdf;
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

.desktop-widget.dw-night .panel-section {
  color: #a8bcdf;
  border-top-color: rgba(255, 255, 255, 0.08);
}

.desktop-widget.dw-night .col-full {
  color: #e7eaf6;
}

/* 节次号（课程面板左列的数字）与值日条目再亮一点 */
.desktop-widget.dw-night .row-num {
  color: #f2f4ff;
  font-weight: 500;
}

.desktop-widget.dw-night .col-duty-panel .duty-task {
  color: #e7eaf6;
}

.desktop-widget.dw-night .col-duty-panel .duty-names {
  color: #c9d0e4;
}

/* 当前正在上的课：夜间用 glass2 的蓝紫高亮，压暗一档避免刺眼 */
.desktop-widget.dw-night .table-row.row-active {
  background: #4a63d8;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
}

.desktop-widget.dw-night .panel-btn {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.16);
  color: #c9d0e4;
}

.desktop-widget.dw-night .panel-btn:hover {
  background: rgba(255, 255, 255, 0.14);
}

.desktop-widget.dw-night .panel-btn-active {
  background: #5b7cfa;
  border-color: #5b7cfa;
  color: #fff;
}

.desktop-widget.dw-night .panel-btn-active:hover {
  background: #6a82f5;
}

.desktop-widget.dw-night .app-item:hover {
  background-color: rgba(255, 255, 255, 0.08);
}

.desktop-widget.dw-night .app-drag-ghost {
  background: rgba(30, 36, 58, 0.94);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);
}

.desktop-widget.dw-night .app-icon-fallback {
  color: #dce1f2;
  background: rgba(255, 255, 255, 0.12);
}

.desktop-widget.dw-night .app-icon-add {
  color: #8f9ab8;
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.18);
}

.desktop-widget.dw-night .app-add:hover .app-icon-add {
  color: #93a8ff;
  border-color: #93a8ff;
}

.desktop-widget.dw-night .app-name {
  color: #c9d0e4;
}

.desktop-widget.dw-night .apps-drop-tip {
  border-color: rgba(124, 147, 255, 0.75);
  background: rgba(91, 124, 250, 0.16);
  color: #c7d2fe;
}
</style>