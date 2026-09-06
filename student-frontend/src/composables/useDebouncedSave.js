// 共享的防抖保存工具：供设置页/组件在路径输入等高频场景下延迟保存。
// 返回调度器，调用方需在组件卸载（beforeUnmount）时调用 teardown() 清理计时器。
export function createDebouncedSave(saveFn, delay = 500) {
  let timer = null
  return {
    // 触发一次防抖保存（重复调用会重置计时）
    schedule() {
      clearTimeout(timer)
      timer = setTimeout(saveFn, delay)
    },
    // 清理未触发的计时器（组件卸载时调用，避免内存泄漏/误保存）
    teardown() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}