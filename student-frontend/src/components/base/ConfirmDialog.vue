<template>
  <Teleport to="body">
  <Transition name="dialog">
  <div v-if="visible" class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10006] pointer-events-auto" @click.self="handleOverlayClick">
    <div class="bg-surface p-5 rounded-lg min-w-[300px] max-w-[600px] text-center shadow-card dialog-card">
      <h3 v-if="title" class="text-lg font-bold mb-3">{{ title }}</h3>
      <!-- 添加列：显示列名输入 + 类型选择 -->
      <p v-if="message" class="mb-3 whitespace-pre-line break-words text-sm leading-relaxed" v-html="message"></p>
      <div v-if="type === 'columnAdd'" class="text-left">
        <label class="block mb-2">新列名：
          <input
            :value="columnName"
            @input="$emit('update:columnName', $event.target.value)"
            class="w-4/5 border border-border rounded px-2 py-1 mt-1"
          />
        </label>
        <label class="block mb-2">数据类型：
          <AppSelect
            :model-value="columnType"
            @change="$emit('update:columnType', $event)"
            class="w-4/5 mt-1"
            :options="[{ value: '文字', label: '文字' }, { value: '整数', label: '整数' }, { value: '小数', label: '小数' }, { value: '日期', label: '日期' }]"
          />
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
        <button v-if="showCancel" @click="$emit('cancel')" class="bg-surface-hover border-none px-4 py-1.5 rounded mr-2 cursor-pointer">{{ cancelText }}</button>
        <button @click="$emit('confirm')" class="bg-info text-text-inverse border-none px-4 py-1.5 rounded cursor-pointer">{{ confirmText }}</button>
      </div>
    </div>
  </div>
  </Transition>
  </Teleport>
</template>

<script>
import '../../styles/dialog-transition.css'
import AppSelect from './AppSelect.vue'

export default {
  name: 'ConfirmDialog',
  components: { AppSelect },
  props: {
    visible: Boolean,
    message: String,
    title: String,
    type: String,
    showCancel: Boolean,
    confirmText: { type: String, default: '确定' },
    cancelText: { type: String, default: '取消' },
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