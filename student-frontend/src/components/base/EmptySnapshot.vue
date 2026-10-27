<template>
  <!-- 空态占位：整行铺满（与表格/骨架屏同宽同高），底色走主题 surface（毛玻璃主题下即白色磨砂玻璃） -->
  <div class="snapshot-empty bg-surface">
    <span class="snapshot-empty-icon">🗓</span>
    <span class="snapshot-empty-text">暂未有历史快照</span>
  </div>
</template>

<script>
export default {
  name: 'EmptySnapshot'
}
</script>

<style scoped>
.snapshot-empty {
  box-sizing: border-box;
  width: 100%;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  /* 与同位置的表格容器保持同样的圆角与描边，避免切换时视觉跳变。
     故取 --radius-table（表格容器档），而不是另选一档。 */
  border-radius: var(--radius-table);
  border: 1px solid var(--color-border, #e5e7eb);
}
.snapshot-empty-icon {
  font-size: 44px;
  line-height: 1;
  opacity: 0.85;
}
.snapshot-empty-text {
  font-size: 18px;
  color: var(--color-text-muted, #94a3b8);
  letter-spacing: 1px;
}
</style>
