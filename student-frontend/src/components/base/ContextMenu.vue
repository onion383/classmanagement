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

<script>
export default {
  name: 'ContextMenu',
  emits: ['close'],
  props: {
    visible: Boolean,
    x: Number,
    y: Number,
    items: Array,
  },
  data() {
    // measured：是否已量到真实宽高。未量到之前用 visibility:hidden 渲染 ——
    // 菜单尺寸由文案决定（min-w-120px 只是下限），猜一个兜底值贴边时会溢出到视口外，
    // 量完再修正就是一帧跳位。隐藏量一次再显示，用户永远看不到位置错误的那一帧。
    return { menuW: 0, menuH: 0, measured: false };
  },
  computed: {
    // 右键坐标可能贴着屏幕右/下边缘：先按测量到的实际尺寸往回收，避免菜单被裁掉
    menuStyle() {
      const pad = 4;
      let left = Number(this.x) || 0;
      let top = Number(this.y) || 0;
      if (typeof window !== 'undefined' && this.measured) {
        const w = this.menuW;
        const h = this.menuH;
        if (left + w > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - w - pad);
        if (top + h > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - h - pad);
      }
      return {
        top: top + 'px',
        left: left + 'px',
        // visibility:hidden 仍参与布局，所以下面的量取能拿到真实尺寸
        visibility: this.measured ? 'visible' : 'hidden',
      };
    },
  },
  watch: {
    visible: {
      // immediate：万一调用方挂载时 visible 就是 true，也要走一次量取，否则菜单永远隐藏
      immediate: true,
      handler(v) {
        if (!v) {
          this.removeViewportListeners();
          // 下次打开必须重新量：items 变了宽度也会变
          this.measured = false;
          return;
        }
        // 菜单渲染后才能量到真实宽高
        this.$nextTick(() => {
          const el = this.$refs.menuEl;
          if (el) {
            this.menuW = el.offsetWidth;
            this.menuH = el.offsetHeight;
          }
          // 量不到（el 为空）也要放行，否则菜单永久不可见
          this.measured = true;
        });
        // 菜单是 fixed 坐标：滚动/缩放后原坐标不再对应触发位置，直接收起。
        // 与 AppSelect 的视口变化处理保持一致，避免菜单悬空或出视口。
        this.addViewportListeners();
      },
    },
  },
  beforeUnmount() {
    this.removeViewportListeners();
  },
  methods: {
    onViewportChange() {
      if (this.visible) this.$emit('close');
    },
    addViewportListeners() {
      if (typeof window === 'undefined') return;
      window.addEventListener('scroll', this.onViewportChange, true);
      window.addEventListener('resize', this.onViewportChange);
    },
    removeViewportListeners() {
      if (typeof window === 'undefined') return;
      window.removeEventListener('scroll', this.onViewportChange, true);
      window.removeEventListener('resize', this.onViewportChange);
    },
  },
};
</script>