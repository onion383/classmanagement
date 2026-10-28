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
  props: {
    visible: Boolean,
    x: Number,
    y: Number,
    items: Array,
  },
  data() {
    return { menuW: 0, menuH: 0 };
  },
  computed: {
    // 右键坐标可能贴着屏幕右/下边缘：先按测量到的实际尺寸往回收，避免菜单被裁掉
    menuStyle() {
      const pad = 4;
      let left = Number(this.x) || 0;
      let top = Number(this.y) || 0;
      if (typeof window !== 'undefined') {
        const w = this.menuW || 120;
        const h = this.menuH || 0;
        if (left + w > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - w - pad);
        if (top + h > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - h - pad);
      }
      return { top: top + 'px', left: left + 'px' };
    },
  },
  watch: {
    visible(v) {
      if (!v) return;
      // 菜单渲染后才能量到真实宽高
      this.$nextTick(() => {
        const el = this.$refs.menuEl;
        if (!el) return;
        this.menuW = el.offsetWidth;
        this.menuH = el.offsetHeight;
      });
    },
  },
};
</script>