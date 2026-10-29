// 弹窗懒加载预取：鼠标悬停到「设置/新建」等触发按钮附近时，
// 提前触发对应弹窗组件的懒加载 chunk，让 Vite 模块缓存与 V8 编译缓存生效，
// 真实点击打开弹窗时近乎即时，无需再等一次 chunk 下载/解析。
//
// 用法：把 defineAsyncComponent 的 loader 抽成命名函数，模板上写
//   @mouseenter="prefetch(loadSettingsDialog)"
// 需要做额外处理时（如 App.vue 的 preloadXxx 包装），在方法里调用 prefetch 即可。
//
// 为什么不用自定义指令：本模块原本导出 v-preload 指令（mounted 里 addEventListener 挂 mouseenter）。
// 2026-10-30 全量迁到模板 @mouseenter，原因有两个：
//   1. Vapor 模式的自定义指令接口与 VDOM 完全不同（VaporDirective 的签名与生命周期不同，
//      同一份实现无法两模式复用），而这里只需要一个 mouseenter —— 模板绑定两种模式都原生可用；
//   2. 指令要在 unmounted 里手动摘监听，模板绑定由 Vue 托管，少一处泄漏面。
//
// 预取失败可忽略：点击时 defineAsyncComponent 仍会正常加载。

let lastLoader = null
let timer = null

export function prefetch(loader) {
  // 同一 loader 不重复触发，且做轻微防抖避免快速掠过
  if (loader === lastLoader) return
  lastLoader = loader
  clearTimeout(timer)
  timer = setTimeout(() => {
    try {
      if (typeof loader === 'function') loader().catch(() => {})
    } catch (e) { /* 忽略 */ }
  }, 32)
}
