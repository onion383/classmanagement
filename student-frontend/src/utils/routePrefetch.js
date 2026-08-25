// 路由预取：悬停/命中侧边栏链接时，提前触发目标视图的懒加载 chunk，
// 让 Vite 的模块缓存与 V8 编译缓存生效，真实点击切换时近乎即时。
let lastKey = ''
let timer = null

export function prefetchRoute(router, rawPath) {
  // hash 路由下 href 形如 "#/fee"，解析出纯路径
  const path = (rawPath || '').split('#').pop() || rawPath || ''
  if (!path || path === lastKey) return
  lastKey = path
  clearTimeout(timer)
  // 轻微防抖：快速掠过多个链接时只预取最后停留的那个
  timer = setTimeout(() => {
    try {
      const { matched } = router.resolve(path)
      const record = matched[matched.length - 1]
      const loader = record && record.components && record.components.default
      if (typeof loader === 'function') {
        loader().catch(() => { /* 预取失败可忽略，点击时仍会正常加载 */ })
      }
    } catch (e) {
      /* 忽略解析异常 */
    }
  }, 80)
}