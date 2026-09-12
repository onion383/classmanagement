<template>
  <div class="animated-clock">
    <div class="ac-time">
      <span v-for="(c, i) in timeChars" :key="'t' + i" class="ac-char" :class="{ 'char-animate': c.anim }">{{ c.char }}</span>
    </div>
    <div class="ac-date">
      <span v-for="(c, i) in dateChars" :key="'d' + i" class="ac-char" :class="{ 'char-animate': c.anim }">{{ c.char }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  // 时间模板，占位符（大写补零、小写不补零）：{H}/{h}时 {M}/{m}分 {S}/{s}秒
  timeFormat: { type: String, default: '{H}:{M}:{S}' },
  // 日期模板，占位符：{Y}年 {M}/{M0}月 {D}/{d}日 {W}星期汉字
  dateFormat: { type: String, default: '星期{W} {Y}-{M}-{D}' },
})

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六']
const pad = n => String(n).padStart(2, '0')
// 普通空格在逐字符 span 渲染宽度不可靠/易被折叠，统一替换为不折叠的空格（&nbsp;），
// 保证日期与星期之间人为加的空格有稳定的视觉宽度。
const NBSP = '\u00A0'
function toChars(str, prev) {
  return str.split('').map((ch, i) => ({
    char: ch === ' ' ? NBSP : ch,
    anim: prev ? ch !== prev[i] : false,
  }))
}

// 注意：{M} 因模板不同有两个含义 —— 时间模板里是「分钟」，日期模板里是「月份」。
// 曾把两种 replaceAll 写在同一链里，日期里的 {M} 会被先到的分钟替换覆盖。
// 现在按 kind 分流，time 只处理分/时/秒，date 只处理年/月/日/星期，互不冲突。
function format(tpl, d, kind) {
  if (kind === 'time') {
    return tpl
      .replaceAll('{H}', pad(d.getHours()))
      .replaceAll('{h}', String(d.getHours()))
      .replaceAll('{M}', pad(d.getMinutes()))
      .replaceAll('{m}', String(d.getMinutes()))
      .replaceAll('{S}', pad(d.getSeconds()))
      .replaceAll('{s}', String(d.getSeconds()))
  }
  return tpl
    .replaceAll('{Y}', String(d.getFullYear()))
    .replaceAll('{M0}', pad(d.getMonth() + 1))
    .replaceAll('{M}', String(d.getMonth() + 1))
    .replaceAll('{D0}', pad(d.getDate()))
    .replaceAll('{D}', String(d.getDate()))
    .replaceAll('{W}', WEEK_CN[d.getDay()])
}

const timeChars = ref([])
const dateChars = ref([])
let prevTime = ''
let prevDate = ''
let timeAnimTimer = null
let dateAnimTimer = null
let timer = null

function applyTime(d) {
  const str = format(props.timeFormat, d, 'time')
  const arr = toChars(str, prevTime)
  prevTime = str
  timeChars.value = arr
  if (arr.some(c => c.anim)) {
    if (timeAnimTimer) clearTimeout(timeAnimTimer)
    timeAnimTimer = setTimeout(() => {
      timeChars.value = timeChars.value.map(c => ({ char: c.char, anim: false }))
    }, 400)
  }
}

function applyDate(d) {
  const str = format(props.dateFormat, d, 'date')
  const arr = toChars(str, prevDate)
  prevDate = str
  dateChars.value = arr
  if (arr.some(c => c.anim)) {
    if (dateAnimTimer) clearTimeout(dateAnimTimer)
    dateAnimTimer = setTimeout(() => {
      dateChars.value = dateChars.value.map(c => ({ char: c.char, anim: false }))
    }, 400)
  }
}

function tick() {
  const d = new Date()
  applyTime(d)
  applyDate(d)
}

onMounted(() => {
  tick()
  timer = setInterval(tick, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (timeAnimTimer) clearTimeout(timeAnimTimer)
  if (dateAnimTimer) clearTimeout(dateAnimTimer)
})
</script>

<style scoped>
.animated-clock {
  text-align: center;
  user-select: none;
  -webkit-user-select: none;
}

/* 字号/颜色通过 CSS 变量暴露，供调用方按容器尺寸覆盖 */
.ac-time {
  font-size: var(--ac-time-size, 40px);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 1px;
  color: var(--ac-time-color, #000000);
  font-variant-numeric: tabular-nums;
}

.ac-date {
  font-size: var(--ac-date-size, 15px);
  color: var(--ac-date-color, #4b5563);
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}

.ac-char {
  display: inline-block;
}

/* 字符变化动画：从下方模糊进入 */
.char-animate {
  animation: charFlipIn 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes charFlipIn {
  0% {
    filter: blur(4px);
    transform: translateY(10px);
    opacity: 0.2;
  }
  100% {
    filter: blur(0px);
    transform: translateY(0);
    opacity: 1;
  }
}
</style>