<template>
  <button
    ref="trigger"
    type="button"
    class="app-help"
    :aria-label="ariaLabel || '说明'"
    :aria-describedby="open ? tooltipId : undefined"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focus="onFocus"
    @blur="onBlur"
    @keydown.esc="hideNow"
  >
    <Info :size="size" :stroke-width="2" />
  </button>

  <!-- Teleport + 行内 fixed：气泡要能超出设置卡片边界，挂到 body 才是安全的。 -->
  <Teleport to="body">
    <Transition name="help-pop">
      <div
        v-if="open"
        ref="popover"
        class="help-pop-wrap"
        :class="placement === 'above' ? 'is-above' : 'is-below'"
        :style="wrapStyle"
      >
        <div
          :id="tooltipId"
          role="tooltip"
          class="help-pop"
        >
          <span class="help-pop-sheen" aria-hidden="true"></span>
          <span class="help-pop-text">{{ text }}</span>
        </div>
        <!-- 真正的三角形尾巴：fill 闭合成面，stroke 只画两条斜边，底边不留线 -->
        <svg class="help-pop-arrow" viewBox="0 0 16 9" aria-hidden="true">
          <path d="M1 8 L8 1 L15 8" />
        </svg>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, nextTick, onBeforeUnmount, useId } from 'vue'
import { Info } from '@lucide/vue'

const props = defineProps({
  // 气泡里的说明文字（支持 \n 换行）
  text: { type: String, required: true },
  // 读屏器念的按钮名称；缺省时用「说明」
  ariaLabel: { type: String, default: '' },
  // 图标尺寸
  size: { type: Number, default: 14 },
  // 悬浮多久后出现，避免鼠标扫过时闪一串气泡
  delay: { type: Number, default: 60 },
  // 气泡层级：弹窗内的 ⓘ 需要高于弹窗本身的 z-index（如 AI 设置弹窗是 10005）
  zIndex: { type: Number, default: 10000 },
})

const tooltipId = useId()
const trigger = ref(null)
const popover = ref(null)
const open = ref(false)
// 气泡相对图标的方向：下方放不下时翻到上方，尖角跟着换方向
const placement = ref('below')
const wrapStyle = ref({
  position: 'fixed',
  left: '0px',
  top: '0px',
  zIndex: props.zIndex,
  maxWidth: 'min(280px, calc(100vw - 16px))',
})

let hovering = false
let focused = false
let showTimer = null
let hideTimer = null

function onEnter() {
  hovering = true
  scheduleShow()
}
function onLeave() {
  hovering = false
  scheduleHide()
}
function onFocus() {
  focused = true
  showNow()
}
function onBlur() {
  focused = false
  scheduleHide()
}

function scheduleShow() {
  clearTimeout(hideTimer)
  clearTimeout(showTimer)
  showTimer = setTimeout(showNow, props.delay)
}
function scheduleHide() {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    if (hovering || focused) return
    hideNow()
  }, 40)
}

function showNow() {
  clearTimeout(showTimer)
  if (open.value) return
  open.value = true
  // 先挂载再量尺寸，定位写进下一次渲染，浏览器首帧就是最终位置，不会从左上角跳过来
  nextTick(() => {
    positionBubble()
    window.addEventListener('scroll', hideNow, true)
    window.addEventListener('resize', hideNow)
  })
}

function hideNow() {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  if (!open.value) return
  open.value = false
  removeListeners()
}

function removeListeners() {
  window.removeEventListener('scroll', hideNow, true)
  window.removeEventListener('resize', hideNow)
}

function positionBubble() {
  const el = trigger.value
  const box = popover.value
  if (!el || !box) return

  const gap = 10
  const margin = 8
  const rect = el.getBoundingClientRect()
  const width = box.offsetWidth
  const height = box.offsetHeight

  // 默认在图标下方居中；下方放不下就翻到上方，水平方向夹在视口内
  let left = rect.left + rect.width / 2 - width / 2
  left = Math.min(Math.max(left, margin), window.innerWidth - width - margin)

  let top = rect.bottom + gap
  let nextPlacement = 'below'
  if (top + height > window.innerHeight - margin) {
    nextPlacement = 'above'
    top = rect.top - height - gap
  }
  top = Math.max(margin, Math.min(top, window.innerHeight - height - margin))

  // 气泡被视口夹住后中心会偏离图标，尖角必须单独对准图标中心（并收在圆角内）
  const arrowX = Math.min(Math.max(rect.left + rect.width / 2 - left, 14), width - 14)

  placement.value = nextPlacement
  wrapStyle.value = {
    position: 'fixed',
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    zIndex: props.zIndex,
    maxWidth: 'min(280px, calc(100vw - 16px))',
    '--arrow-x': `${Math.round(arrowX)}px`,
  }
}

onBeforeUnmount(() => {
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  removeListeners()
})
</script>

<style scoped>
/* 小号 ⓘ：玻璃主题的全局 button 皮肤（边框/外发光/::before 描边）在这里全部剥掉，
   只留一个可聚焦的圆形热区。 */
.app-help {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  margin: 0;
  vertical-align: middle;
  border: none !important;
  /* glass/win11 的全局 button 规则会把圆角改成 --radius-control（0,2,1 特异性压过 scoped），
     这里用 !important 保住圆形热区 */
  border-radius: var(--radius-full) !important;
  background-color: transparent;
  box-shadow: none !important;
  color: var(--color-text-muted);
  cursor: help;
  transition:
    color 160ms ease,
    background-color 160ms ease;
}
.app-help::before {
  display: none !important;
}
.app-help:hover,
.app-help:focus-visible {
  outline: none;
  color: var(--color-primary);
  background-color: var(--color-primary-light);
}
:root[data-theme="glass2"] .app-help:active {
  transform: none;
}

/* 定位容器：本身透明、不接收指针，气泡和尖角都挂在它下面。
   --help-bg 用主题的 surface（玻璃主题是 .92 白），尖角叠在气泡上也不会叠出亮斑。 */
.help-pop-wrap {
  --help-bg: var(--color-surface);
  --help-border: var(--color-border);
  z-index: 10000;
  width: max-content;
  max-width: min(280px, calc(100vw - 16px));
  pointer-events: none;
}
:root:is([data-theme="glass"], [data-theme="win11"]) .help-pop-wrap {
  --help-border: var(--alpha-white-35);
}
:root[data-mode="night"][data-theme="glass"] .help-pop-wrap {
  --help-border: transparent;
}
/* 新毛玻璃的 surface 本身太透，气泡改用实色底，文字更稳 */
:root[data-theme="glass2"] .help-pop-wrap {
  --help-bg: var(--color-bg);
  --help-border: var(--g2-line);
}

.help-pop {
  position: relative;
  z-index: 0;
  width: 100%;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  white-space: pre-line;
  overflow: hidden;
  background-color: var(--help-bg);
  border: 1px solid var(--help-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
:root:is([data-theme="glass"], [data-theme="win11"]) .help-pop {
  backdrop-filter: blur(20px) saturate(1.1);
}

.help-pop-sheen {
  position: absolute;
  inset: -40% -10%;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(
    115deg,
    transparent 20%,
    var(--color-primary-light) 45%,
    transparent 70%
  );
  animation: helpSheen 360ms ease-out both;
}

.help-pop-text {
  position: relative;
  z-index: 1;
}

/* 尾巴：16×9 的实心三角形，压在气泡边缘 1px 盖住接缝；
   朝下时整体旋转 180°。 */
.help-pop-arrow {
  position: absolute;
  z-index: 1;
  left: var(--arrow-x, 50%);
  width: 16px;
  height: 9px;
  margin-left: -8px;
  pointer-events: none;
  fill: var(--help-bg);
  stroke: var(--help-border);
  stroke-width: 1;
  overflow: visible;
}
.help-pop-wrap.is-below .help-pop-arrow {
  top: -7px;
}
.help-pop-wrap.is-above .help-pop-arrow {
  bottom: -7px;
  transform: rotate(180deg);
}

@keyframes helpSheen {
  from {
    opacity: 0.32;
    transform: translateX(-35%);
  }
  to {
    opacity: 0;
    transform: translateX(35%);
  }
}

.help-pop-enter-active {
  transition:
    opacity 100ms ease-out,
    transform 100ms ease-out;
}
.help-pop-leave-active {
  transition:
    opacity 80ms ease-in,
    transform 80ms ease-in;
}
.help-pop-enter-from,
.help-pop-leave-to {
  opacity: 0;
  transform: translateY(-3px) scale(0.98);
}

@media (prefers-reduced-motion: reduce) {
  .help-pop-sheen {
    animation: none;
  }
  .help-pop-enter-active,
  .help-pop-leave-active {
    transition: none;
  }
}
</style>
