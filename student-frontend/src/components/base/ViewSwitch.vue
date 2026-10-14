<template>
  <div ref="root" class="view-switch" role="tablist">
    <button
      type="button"
      tabindex="-1"
      aria-hidden="true"
      class="view-switch-thumb"
      :class="thumbClass"
      :style="thumbStyle"
    ></button>
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      role="tab"
      class="view-switch-btn"
      :class="{ on: modelValue === opt.value }"
      :aria-selected="modelValue === opt.value"
      @click="$emit('update:modelValue', opt.value)"
    >{{ opt.label }}</button>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  // 分段项：[{ value, label }]
  options: { type: Array, default: () => [] },
  // 选中色块所套用的类，默认与工具栏彩色按钮一致（暖色主色），命中同一批主题按钮规则
  thumbClass: { type: String, default: 'bg-primary text-text-inverse' }
})
defineEmits(['update:modelValue'])

const root = ref(null)
const thumbStyle = ref({})

// 按当前选项按钮的实测位置/尺寸定位内嵌色块。
// 轨道带内边距时该公式同样成立：绝对定位包含块为轨道 padding box，
// 故只需减去边框宽度就能落到按钮左上角。
function syncThumb() {
  const box = root.value
  if (!box) return
  const idx = props.options.findIndex(o => o.value === props.modelValue)
  const btns = box.querySelectorAll('.view-switch-btn')
  const btn = btns[idx < 0 ? 0 : idx]
  if (!btn) return
  const boxRect = box.getBoundingClientRect()
  const btnRect = btn.getBoundingClientRect()
  const cs = getComputedStyle(box)
  const bl = parseFloat(cs.borderLeftWidth) || 0
  // 纵向尺寸/位置完全由 CSS 决定（top/bottom 内缩，与轨道内边距对齐），
  // 这里只负责横向：宽度 + 平移到当前选项按钮的左边，避免依赖纵向测量值。
  thumbStyle.value = {
    width: `${btnRect.width}px`,
    transform: `translateX(${btnRect.left - boxRect.left - bl}px)`
  }
}

watch(() => props.modelValue, () => nextTick(syncThumb))
watch(() => props.options, () => nextTick(syncThumb), { deep: true })

onMounted(() => {
  nextTick(syncThumb)
  // 侧边栏折叠、窗口缩放、字体加载等导致的尺寸变化都重新定位
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    new ResizeObserver(syncThumb).observe(root.value)
  }
})
</script>

<style scoped>
/* 视图切换：毛玻璃轨道 + 内嵌的暖色选中块（双层观感）
   外层尺寸与隔壁工具栏按钮同高；选中块嵌在轨道内、四周留出一圈细缝。 */
.view-switch {
  /* 选中块与轨道之间的缝隙（也是内嵌所需的内边距） */
  --vs-pad: 4px;
  position: relative;
  display: inline-flex;
  align-items: stretch;
  /* 防止被工具栏 flex 压窄，保证各段并排、不换行 */
  flex: none;
  padding: var(--vs-pad);
  border-radius: 8px;
  background: var(--color-surface, #ffffff);
  overflow: hidden;
}
/* glass/win11：轨道改用与自绘标题栏 .window-title-bar 相同的毛玻璃材质
   （同 blur/saturate 配方 + 同底色 + 同内高光），随 data-topbar-color 切深蓝/淡蓝。
   注意：glass/win11 下 12px 的轨道圆角由 theme-glass.css 统一给出（与隔壁玻璃按钮一致）。 */
:root:is([data-theme="glass"], [data-theme="win11"]) .view-switch {
  backdrop-filter: blur(24px) saturate(1.4);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    inset 0 -1px 0 rgba(255, 255, 255, 0.4);
}
:root[data-topbar-color="light"]:is([data-theme="glass"], [data-theme="win11"]) .view-switch {
  background-color: rgba(219, 234, 254, 0.55);
}
:root[data-topbar-color="blue"]:is([data-theme="glass"], [data-theme="win11"]) .view-switch {
  background-color: rgba(30, 64, 175, 0.55);
}
/* 内嵌选中块：纵向由 CSS 内缩 --vs-pad 对齐，横向宽度/位置由脚本实测当前按钮得到，
   始终落在当前选项段上（与按钮本体重合）。
   颜色/遮罩/阴影完全不在这里写死：模板上挂着与隔壁「添加职务」等按钮完全相同的类
   （bg-primary text-text-inverse），且它是真正的 <button>，因此命中同一批主题按钮规则，
   任意主题下颜色都与其逐像素一致。 */
.view-switch-thumb {
  /* !important 必需：glass/win11 主题有全局 `:root:is(...) button { position: relative }`（特异性 0,2,1），
     高于 scoped 的 .view-switch-thumb[data-v-*]（0,2,0）。若被改回 relative，滑块会留在文档流里、
     在最左侧占一个身位，把两个标签挤到右边（表现为「轨道很宽、左边空一片、滑块偏右」）。 */
  position: absolute !important;
  /* 纵向由 CSS 与轨道内边距对齐：上下内缩 --vs-pad，尺寸随轨道自适应，永远左右上下对称 */
  top: var(--vs-pad);
  bottom: var(--vs-pad);
  left: 0;
  padding: 0;
  border: none;
  pointer-events: none;
  /* 独立圆角（与外层同心：外层圆角 − 内边距）。glass 主题的全局规则会把
     .view-switch button 的圆角强制归零，故这里用 !important 保住内嵌块自身的圆角。 */
  border-radius: 4px !important;
  transition:
    transform 0.26s cubic-bezier(0.34, 1.35, 0.64, 1),
    width 0.26s cubic-bezier(0.34, 1.35, 0.64, 1);
}
:root:is([data-theme="glass"], [data-theme="win11"], [data-theme="glass2"]) .view-switch-thumb {
  border-radius: 8px !important;
}
.view-switch-btn {
  position: relative;
  z-index: 1;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 各段等宽：内嵌块尺寸恒定，切换时不会忽大忽小；
     宽度即文字与边框之间的留白，加大一点让文字不贴边 */
  width: 4.5rem;
  /* 与隔壁按钮同高：轨道内边距 4px×2 + 这里 4px×2 = 16px，等于隔壁的 py-2 */
  padding: 4px 0;
  white-space: nowrap;
  border: none;
  background: transparent;
  color: var(--color-text-secondary, #6b7280);
  cursor: pointer;
  transition: color 0.2s ease-out;
}
.view-switch-btn.on {
  /* 与隔壁按钮一致：选中文字用反白色 */
  color: var(--color-text-inverse, #ffffff);
}
/* glass/win11 下「添加职务」等按钮被主题规则改成淡底 + 深绿字（见 theme-glass.css），
   选中项文字同步为深绿，否则白字会与该底色糊在一起、与隔壁按钮观感不一致 */
:root:is([data-theme="glass"], [data-theme="win11"]) .view-switch-btn.on {
  color: #166534;
}
</style>
