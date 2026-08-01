<template>
  <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10003] pointer-events-auto" @click.self="handleOverlayClick">
    <div class="bg-surface p-5 rounded-lg min-w-[300px] text-center shadow-card">
      <p v-if="message" class="mb-3">{{ message }}</p>

      <!-- 添加列：显示列名输入 + 类型选择 -->
      <div v-if="type === 'columnAdd'" class="text-left">
        <label class="block mb-2">新列名：
          <input
            :value="columnName"
            @input="$emit('update:columnName', $event.target.value)"
            class="w-4/5 border border-border rounded px-2 py-1 mt-1"
          />
        </label>
        <label class="block mb-2">数据类型：
          <select
            :value="columnType"
            @change="$emit('update:columnType', $event.target.value)"
            class="w-4/5 border border-border rounded px-2 py-1 mt-1"
          >
            <option value="文字">文字</option>
            <option value="整数">整数</option>
            <option value="小数">小数</option>
            <option value="日期">日期</option>
          </select>
        </label>
        <p v-if="errorMsg" class="text-danger text-sm mt-1">{{ errorMsg }}</p>
      </div>

      <!-- 重命名列：只显示列名输入框 -->
      <div v-if="type === 'columnRename'" class="text-left">
        <label class="block mb-2">新列名：
          <input
            :value="columnName"
            @input="$emit('update:columnName', $event.target.value)"
            class="w-4/5 border border-border rounded px-2 py-1 mt-1"
          />
        </label>
        <p v-if="errorMsg" class="text-danger text-sm mt-1">{{ errorMsg }}</p>
      </div>

      <div class="mt-4">
        <button @click="$emit('confirm')" class="bg-info text-text-inverse border-none px-4 py-1.5 rounded mr-2 cursor-pointer">确定</button>
        <button v-if="showCancel" @click="$emit('cancel')" class="bg-surface-hover border-none px-4 py-1.5 rounded cursor-pointer">取消</button>
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