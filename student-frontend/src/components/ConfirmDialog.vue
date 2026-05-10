<template>
  <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000] pointer-events-auto" @click.self="handleOverlayClick">
    <div class="bg-white p-5 rounded-lg min-w-[300px] text-center">
      <p v-if="message" class="mb-3">{{ message }}</p>

      <div v-if="type === 'columnAdd'" class="text-left">
        <label class="block mb-2">新列名：
          <input
            :value="columnName"
            @input="$emit('update:columnName', $event.target.value)"
            class="w-4/5 border border-gray-300 rounded px-2 py-1 mt-1"
          />
        </label>
        <label class="block mb-2">数据类型：
          <select
            :value="columnType"
            @change="$emit('update:columnType', $event.target.value)"
            class="w-4/5 border border-gray-300 rounded px-2 py-1 mt-1"
          >
            <option value="文字">文字</option>
            <option value="整数">整数</option>
            <option value="小数">小数</option>
            <option value="日期">日期</option>
          </select>
        </label>
        <p v-if="errorMsg" class="text-red-500 text-sm mt-1">{{ errorMsg }}</p>
      </div>

      <div class="mt-4">
        <button @click="$emit('confirm')" class="bg-blue-500 text-white border-none px-4 py-1.5 rounded mr-2 cursor-pointer">确定</button>
        <button v-if="showCancel" @click="$emit('cancel')" class="bg-gray-300 border-none px-4 py-1.5 rounded cursor-pointer">取消</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ConfirmDialog',
  props: {
    visible: Boolean,
    message: String,
    type: String,
    showCancel: Boolean,
    columnName: String,
    columnType: String,
    errorMsg: String,
  },
  emits: ['confirm', 'cancel', 'update:columnName', 'update:columnType'],
  methods: {
    handleOverlayClick() {
      if (this.showCancel) this.$emit('cancel');
    },
  },
};
</script>