<template>
  <div
    v-if="visible"
    ref="menuEl"
    class="context-menu-popup fixed bg-surface border border-border shadow-md z-[9999] min-w-[120px] py-1 pointer-events-auto"
    :style="menuStyle"
  >
    <div
      v-for="item in items"
      :key="item.label"
      class="px-4 py-2 cursor-pointer hover:bg-surface-hover text-sm text-text transition-theme"
      @click="item.action"
    >
      {{ item.label }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'

defineOptions({ name: 'ContextMenu' })

const emit = defineEmits(['close'])
const props = defineProps({
  visible: Boolean,
  x: Number,
  y: Number,
  items: Array,
})

// measured：是否已量到真实宽高。未量到之前用 visibility:hidden 渲染 ——
// 菜单尺寸由文案决定（min-w-120px 只是下限），猜一个兜底值贴边时会溢出到视口外，
// 量完再修正就是一帧跳位。隐藏量一次再显示，用户永远看不到位置错误的那一帧。
const menuW = ref(0);
const menuH = ref(0);
const measured = ref(false);
const menuEl = ref(null);

// 右键坐标可能贴着屏幕右/下边缘：先按测量到的实际尺寸往回收，避免菜单被裁掉
const menuStyle = computed(() => {
  const pad = 4;
  let left = Number(props.x) || 0;
  let top = Number(props.y) || 0;
  if (measured.value) {
    const w = menuW.value;
    const h = menuH.value;
    if (left + w > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - w - pad);
    if (top + h > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - h - pad);
  }
  return {
    top: top + 'px',
    left: left + 'px',
    // visibility:hidden 仍参与布局，所以下面的量取能拿到真实尺寸
    visibility: measured.value ? 'visible' : 'hidden',
  };
});

watch(() => props.visible, (v) => {
  if (!v) {
    removeViewportListeners();
    // 下次打开必须重新量：items 变了宽度也会变
    measured.value = false;
    return;
  }
  // 菜单渲染后才能量到真实宽高
  nextTick(() => {
    const el = menuEl.value;
    if (el) {
      menuW.value = el.offsetWidth;
      menuH.value = el.offsetHeight;
    }
    // 量不到（el 为空）也要放行，否则菜单永久不可见
    measured.value = true;
  });
  // 菜单是 fixed 坐标：滚动/缩放后原坐标不再对应触发位置，直接收起。
  // 与 AppSelect 的视口变化处理保持一致，避免菜单悬空或出视口。
  addViewportListeners();
}, {
  // immediate：万一调用方挂载时 visible 就是 true，也要走一次量取，否则菜单永远隐藏
  immediate: true,
});

onBeforeUnmount(() => {
  removeViewportListeners();
});

function onViewportChange() {
  if (props.visible) emit('close');
}
function addViewportListeners() {
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);
}
function removeViewportListeners() {
  window.removeEventListener('scroll', onViewportChange, true);
  window.removeEventListener('resize', onViewportChange);
}
</script>