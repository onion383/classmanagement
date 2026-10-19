<template>
  <!--
    弹窗公共外壳：Teleport + 遮罩 + 过渡动画
    各业务弹窗只负责面板内容（放在默认插槽里），遮罩点击是否关闭由使用方决定。
    外壳渲染的 DOM 与各弹窗原来手写的一致（同样的 overlay class），故视觉零变化。
  -->
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="visible"
        class="fixed inset-0 bg-black/50 flex items-center justify-center pointer-events-auto"
        :class="overlayClass"
        :style="{ zIndex }"
        @click.self="$emit('overlay')"
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import '../../styles/dialog-transition.css'

defineProps({
  visible: { type: Boolean, default: false },
  // 与各弹窗原来的 z-[xxxx] 保持一致，默认沿用确认框的层级
  zIndex: { type: Number, default: 10006 },
  // 面板对齐方式：默认居中；少数弹窗需要顶部对齐时传 top
  overlayClass: { type: String, default: '' },
})

defineEmits(['overlay'])
</script>
