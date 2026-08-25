<template>
  <div v-if="searchField" class="mb-3 bg-surface-hover p-2 flex items-center gap-2">
    <label class="text-sm">搜索「{{ searchField }}」：</label>
    <input
      :value="keyword"
      @input="$emit('update:keyword', $event.target.value)"
      placeholder="输入关键字..."
      class="w-48 border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-info"
    />
    <button @click="$emit('close')" class="bg-surface-hover border border-border px-2 py-1 text-sm rounded cursor-pointer hover:bg-border text-text">关闭</button>
  </div>
</template>

<script>
export default {
  name: 'SearchBar',
  props: {
    searchField: String,
    keyword: String,
  },
  emits: ['update:keyword', 'close'],
};
</script>