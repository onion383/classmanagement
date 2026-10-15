<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="visible"
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10002] pointer-events-auto no-dialog-pulse"
        @click.self="$emit('close')"
      >
        <div class="bg-surface p-5 rounded-xl w-[340px] max-w-[92vw] shadow-lg dialog-card">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-bold text-text flex items-center gap-2"><User :size="18" /> 账户</h3>
            <button class="text-text-muted hover:text-text text-lg leading-none px-2 cursor-pointer" @click="$emit('close')">✕</button>
          </div>

          <div class="space-y-2 text-sm text-text-secondary">
            <p><span class="text-text-muted">用户名：</span>{{ user.username || '—' }}</p>
            <p><span class="text-text-muted">权限：</span>{{ roleText }}</p>
          </div>

          <button
            class="mt-5 w-full bg-danger hover:bg-danger-hover text-text-inverse px-4 py-2 rounded transition-theme cursor-pointer"
            @click="confirmOpen = true"
          >退出登录</button>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- 二次确认：确认后才退出 -->
  <ConfirmDialog
    :visible="confirmOpen"
    title="退出登录"
    message="确认退出登录？"
    :show-cancel="true"
    confirm-text="确认"
    cancel-text="取消"
    @confirm="doLogout"
    @cancel="confirmOpen = false"
  />
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { User } from '@lucide/vue'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps({ visible: { type: Boolean, default: false } })
const emit = defineEmits(['close'])

const router = useRouter()
const confirmOpen = ref(false)
const user = ref({})

// 每次打开时重新读取登录态（localStorage 非响应式，用 watch 保证用户名/权限是最新的）
watch(() => props.visible, (v) => {
  if (v) user.value = JSON.parse(localStorage.getItem('currentUser') || '{}')
}, { immediate: true })

const roleText = computed(() => (user.value.role === 'teacher' ? '班主任' : '科任老师'))

function doLogout() {
  localStorage.removeItem('token')
  localStorage.removeItem('currentUser')
  confirmOpen.value = false
  emit('close')
  router.push('/login')
}
</script>
