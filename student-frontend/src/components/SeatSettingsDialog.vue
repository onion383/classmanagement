<template>
  <div v-if="visible" class="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center">
    <div class="bg-white rounded-lg p-6 w-80">
      <h3 class="text-lg font-bold mb-4">座位设置</h3>
      <div class="mb-3">
        <label class="block text-sm font-medium">行数</label>
        <input v-model.number="localRows" type="number" min="1" class="w-full border px-3 py-2 rounded" />
      </div>
      <div class="mb-4">
        <label class="block text-sm font-medium">列数</label>
        <input v-model.number="localCols" type="number" min="1" class="w-full border px-3 py-2 rounded" />
      </div>
      <div class="flex justify-end gap-2">
        <button @click="$emit('cancel')" class="bg-gray-300 px-4 py-2 rounded">取消</button>
        <button @click="save" class="bg-blue-500 text-white px-4 py-2 rounded">保存</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SeatSettingsDialog',
  props: {
    visible: Boolean,
    rows: Number,
    cols: Number
  },
  emits: ['save', 'cancel'],
  data() {
    return {
      localRows: this.rows,
      localCols: this.cols
    };
  },
  watch: {
    visible(val) {
      if (val) {
        this.localRows = this.rows;
        this.localCols = this.cols;
      }
    }
  },
  methods: {
    save() {
      this.$emit('save', { rows: this.localRows, cols: this.localCols });
    }
  }
};
</script>