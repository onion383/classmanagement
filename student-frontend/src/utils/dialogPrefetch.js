// 弹窗懒加载预取：鼠标悬停到「设置/新建」等触发按钮附近时，
// 提前触发对应弹窗组件的懒加载 chunk，让 Vite 模块缓存与 V8 编译缓存生效，
// 真实点击打开弹窗时近乎即时，无需再等一次 chunk 下载/解析。
//
// 用法：把 defineAsyncComponent 的 loader 抽成命名函数，
// 然后模板按钮上写 v-preload="loader"。例如：
//   const loadSettingsDialog = () => import('../components/dialogs/SettingsDialog.vue')
//   const SettingsDialog = defineAsyncComponent(loadSettingsDialog)
//   <button v-preload="loadSettingsDialog" @click="settingsVisible = true">设置</button>
//
// 预取失败可忽略：点击时 defineAsyncComponent 仍会正常加载。

let lastLoader = null
let timer = null

function prefetch(loader) {
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

export const vPreload = {
  mounted(el, binding) {
    el._preloadHandler = () => prefetch(binding.value)
    el.addEventListener('mouseenter', el._preloadHandler)
  },
  unmounted(el) {
    if (el._preloadHandler) {
      el.removeEventListener('mouseenter', el._preloadHandler)
      delete el._preloadHandler
    }
  },
}