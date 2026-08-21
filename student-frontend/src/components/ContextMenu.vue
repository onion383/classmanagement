<template>
  <div
    v-if="visible"
    class="context-menu-popup fixed bg-surface border border-border shadow-md z-[9999] min-w-[120px] py-1 pointer-events-auto"
    :style="{ top: y + 'px', left: x + 'px' }"
  >
    <div
      v-for="item in items"
      :key="item.label"
      class="px-4 py-2 cursor-pointer hover:bg-surface-hover text-sm text-text"
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
};
</script>