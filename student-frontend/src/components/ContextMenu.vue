<template>
  <div
    v-if="visible"
    class="fixed bg-white border border-gray-300 shadow-md z-[9999] min-w-[120px] py-1 pointer-events-auto"
    :style="{ top: y + 'px', left: x + 'px' }"
  >
    <div
      v-for="item in items"
      :key="item.label"
      class="px-4 py-2 cursor-pointer hover:bg-gray-100 text-sm"
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