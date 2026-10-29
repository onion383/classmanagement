<template>
  <DialogShell :visible="visible" :z-index="10006" @overlay="handleOverlayClick">
    <div class="bg-surface p-5 rounded-lg min-w-[300px] max-w-[600px] text-center shadow-card dialog-card">
      <h3 v-if="title" class="text-lg font-bold mb-3">{{ title }}</h3>
      <!-- 添加列：显示列名输入 + 类型选择 -->
      <p v-if="message" class="mb-3 whitespace-pre-line break-words text-sm leading-relaxed">{{ message }}</p>
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
        <button v-if="extraText" @click="$emit('extra')" class="bg-surface-hover border-none px-4 py-1.5 rounded mr-2 cursor-pointer">{{ extraText }}</button>
        <button @click="$emit('confirm')" :disabled="confirmDisabled" class="bg-info text-text-inverse border-none px-4 py-1.5 rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">{{ confirmText }}</button>
      </div>
    </div>
  </DialogShell>
</template>

<script setup>
import '../../styles/dialog-transition.css'
import { defineAsyncComponent, onMounted } from 'vue'
import DialogShell from './DialogShell.vue'

// 下拉组件只在「添加列」弹窗（type === 'columnAdd'）里用到，属业务页操作触发，
// 与启动时的确认弹窗主路径无关。改为懒加载后不再计入首屏同步入口 chunk；
// ConfirmDialog 在 App 挂载时就会实例化，这里 mounted 里直接触发一次加载，
// chunk 与首屏并行下载，用户真打开该弹窗时早已就绪，观感不变。
const loadAppSelect = () => import('./AppSelect.vue')
const AppSelect = defineAsyncComponent(loadAppSelect)

defineOptions({ name: 'ConfirmDialog' })
const props = defineProps({
  visible: Boolean,
  message: String,
  title: String,
  type: String,
  showCancel: Boolean,
  // 确定按钮禁用（如倒计时未结束时置灰不可点）
  confirmDisabled: Boolean,
  confirmText: { type: String, default: '确定' },
  cancelText: { type: String, default: '取消' },
  // 可选的第三个按钮（如「仅删学生/保留记录」）；为空则不显示
  extraText: { type: String, default: '' },
  columnName: String,
  columnType: String,
  errorMsg: String,
})
const emit = defineEmits(['confirm', 'cancel', 'extra', 'update:columnName', 'update:columnType'])

function handleOverlayClick() {
  if (props.showCancel) emit('cancel');
}

onMounted(() => { loadAppSelect().catch(() => {}) })
</script>