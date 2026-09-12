<template>
  <Teleport to="body">
  <Transition name="dialog">
    <div v-if="visible" class="fixed inset-0 bg-black/30 z-[70] flex items-center justify-center">
      <div class="bg-surface rounded-lg p-5 shadow-card dialog-card flex flex-col" style="width: 460px; max-width: 90vw;">
        <h4 class="text-base font-bold mb-1">⏰ 发现假期已结束</h4>
        <p class="text-sm text-text-secondary mb-4">以下同学假期已经结束但尚未销假，请确认返校情况：</p>
        <div class="flex-1 overflow-auto space-y-3 mb-1" style="max-height: 340px;">
          <div
            v-for="rec in records"
            :key="rec.id"
            class="flex flex-wrap items-center justify-between gap-2 border border-border rounded p-2"
          >
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-text">{{ rec.姓名 }}</div>
              <div class="text-xs text-text-secondary">{{ rec._range }}</div>
            </div>
            <div class="flex gap-2 shrink-0">
              <button @click="$emit('not', rec)" class="bg-surface-hover border border-border px-3 py-1 rounded text-xs text-text cursor-pointer hover:bg-border">未返校</button>
              <button @click="$emit('ret', rec)" class="bg-success hover:bg-green-700 text-text-inverse px-3 py-1 rounded text-xs border-none cursor-pointer">已经返校并销假</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
  </Teleport>
</template>

<script>
import '../../styles/dialog-transition.css'

export default {
  name: 'OverdueLeaveDialog',
  props: {
    visible: Boolean,
    records: { type: Array, default: () => [] }
  },
  emits: ['not', 'ret']
}
</script>