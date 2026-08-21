<!-- 视频封面：直接显示服务端生成的 /thumb 首帧小图，叠加小播放图标。
     服务端没生成封面时（占位），退回仅显示播放图标。 -->
<template>
  <div class="relative w-full h-full bg-black flex items-center justify-center">
    <img v-if="ok" :src="src" alt="视频封面" class="w-full h-full object-cover" loading="lazy" @error="ok = false" />
    <!-- 小播放图标 -->
    <span class="absolute inset-0 flex items-center justify-center pointer-events-none">
      <span class="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center shadow">
        <svg class="w-4 h-4 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </span>
    </span>
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  src: { type: String, required: true },
})

const ok = ref(true)
</script>