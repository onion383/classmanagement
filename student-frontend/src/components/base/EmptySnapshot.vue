<template>
  <div class="snapshot-empty">
    <div class="snapshot-empty-card">
      <span class="snapshot-empty-icon">🗓</span>
      <span class="snapshot-empty-text">暂未有历史快照</span>
    </div>
  </div>
</template>

<script>
export default {
  name: 'EmptySnapshot'
}
</script>

<style scoped>
.snapshot-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
}
.snapshot-empty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 64px;
  border-radius: 16px;
  background: rgba(148, 163, 184, 0.12);
  border: 1px solid rgba(148, 163, 184, 0.28);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.snapshot-empty-icon {
  font-size: 44px;
  line-height: 1;
  opacity: 0.85;
}
.snapshot-empty-text {
  font-size: 18px;
  color: var(--text-muted, #94a3b8);
  letter-spacing: 1px;
}
</style>