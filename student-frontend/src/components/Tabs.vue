
<template>
  <!-- 表头切换组件 -->
  <div>
    <!-- 标签头 -->
    <div class="flex gap-2 mb-6">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        @click="$emit('update:modelValue', tab.value)"
        :class="[
          'px-5 py-2.5 rounded-xl font-medium text-sm transition-all duration-300 ease-in-out',
          'hover:shadow-md hover:scale-105',
          modelValue === tab.value
            ? 'bg-info text-text-inverse shadow-lg shadow-info/30'
            : 'bg-surface-hover text-text-secondary hover:bg-border hover:text-text'
        ]"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 内容区 -->
    <slot :activeTab="modelValue" />
  </div>
</template>

<script>
export default {
  name: 'Tabs',
  props: {
    tabs: { type: Array, required: true },
    modelValue: { type: String, required: true }
  },
  emits: ['update:modelValue']
};
</script>