// ===== AiComposer：AI 提问浮窗的选项状态判断 =====
// 纯代码搬运自 AiComposer.vue 的 methods，未改写逻辑；只依赖入参，无组件状态。

// 选项是否已选中（多选为数组包含，单选为相等）
export function isPicked(q, o) {
  return Array.isArray(q && q.picked) ? q.picked.includes(o) : !!(q && q.picked === o)
}

// 该题是否为「单选 + 有选项 + 尚未选择」：用于把按钮显示成「跳过」
export function _isSingleUnpicked(q) {
  return !!q && !q.multiple && q.options.length > 0 && (q.picked === undefined || q.picked === null)
}
