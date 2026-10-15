// 「按记录定位」通用逻辑（第二阶段跨页定位）。
//
// 标题栏全局搜索点击「业务数据」结果后，会跳转 /xxx?focus=<id>。
// 目标页读到 query.focus 后：滚动到对应记录行并播放一次高亮闪动，随后清掉 query。
// 行元素需带 [data-row-id]：DynamicTable 已内置；自定义渲染的页面自行在行根元素上添加。
//
// 用法：
//   Options API：watch/activated/mounted 里调用 applyRouteRowFocus(this)
//   <script setup>：const inst = getCurrentInstance();
//                  watch/onActivated/onMounted 里调用 applyRouteRowFocus(inst.proxy)
// 需要先切页签/展开等预处理时，通过 options.parse(key) 返回定位 id
// （返回 null/undefined 表示时机未到，跳过本次，等待下次触发）。

const FLASH_MS = 1400

// 每个宿主组件已处理过的 focus 签名（去重，防 watch 与 activated 重复触发）。
// 用 WeakMap 挂在模块内，避免往组件实例上写额外属性。
const sigMap = new WeakMap()
// 每个宿主的「时机未到」内部重试状态：{ n, timer }
const retryMap = new WeakMap()

const RETRY_TRIES = 25
const RETRY_INTERVAL = 80

// CSS 属性选择器值转义：避免 id 内特殊字符破坏选择器
function cssQuote(v) {
  return String(v).replace(/["\\]/g, '\\$&')
}

// 在容器内按 [data-row-id] 找到目标行，滚动到可视区并播放一次高亮闪动。
// 命中返回 true；容器/元素缺失返回 false。
export function flashRowById(container, id) {
  if (!container || id == null || id === '') return false
  let el = null
  try {
    el = container.querySelector(`[data-row-id="${cssQuote(id)}"]`)
  } catch (_) {
    return false
  }
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // 用 WAAPI 播放一次性背景闪动，不改动行自身样式，动画结束自动复位
  if (typeof el.animate === 'function') {
    el.animate(
      [
        { backgroundColor: 'rgba(59,130,246,0.30)' },
        { backgroundColor: 'rgba(59,130,246,0.08)', offset: 0.55 },
        { backgroundColor: 'rgba(59,130,246,0)' },
      ],
      { duration: FLASH_MS, easing: 'ease-out' }
    )
  }
  return true
}

// 目标行可能因数据异步加载/页签切换而尚未渲染：按固定间隔重试，直到命中或超时。
export function focusRowWhenReady(containerGetter, id, { tries = 25, interval = 80 } = {}) {
  if (id == null || id === '') return
  let n = 0
  const attempt = () => {
    const c = typeof containerGetter === 'function' ? containerGetter() : containerGetter
    if (c && flashRowById(c, id)) return
    if (++n < tries) setTimeout(attempt, interval)
  }
  attempt()
}

// 读取路由 query.focus 并执行定位。
// host：组件公共实例（Options API 的 this / setup 里的 getCurrentInstance().proxy）。
// options.parse(key)：返回真正用于定位的 id，返回空值表示时机未到、跳过本次。
// options.container()：返回查询容器，默认 host.$el。
export function applyRouteRowFocus(host, options = {}) {
  const route = host && host.$route
  if (!route) return
  const raw = route.query ? route.query.focus : undefined
  if (raw == null || raw === '') {
    sigMap.set(host, '')
    clearRetry(host)
    return
  }
  const key = String(raw)
  if (key === sigMap.get(host)) return
  let id = key
  if (options.parse) {
    id = options.parse(key)
    // parse 返回空值 = 时机未到（数据/页签尚未就绪）：安排一次内部重试，等就绪后再定位
    if (id == null || id === '') { scheduleRetry(host, options); return }
  }
  sigMap.set(host, key)
  clearRetry(host)
  // 定位成功后清掉 query，避免回退/刷新时重复定位
  host.$router.replace({ path: route.path })
  const container = options.container ? options.container() : host.$el
  focusRowWhenReady(container, id)
}

// 内部重试：parse 依赖的数据/页签尚未就绪时，按固定间隔重跑 applyRouteRowFocus，直到命中或超时。
function scheduleRetry(host, options) {
  let st = retryMap.get(host)
  if (!st) { st = { n: 0, timer: null }; retryMap.set(host, st) }
  if (st.timer || st.n >= RETRY_TRIES) return
  st.timer = setTimeout(() => {
    st.timer = null
    st.n++
    applyRouteRowFocus(host, options)
  }, RETRY_INTERVAL)
}

function clearRetry(host) {
  const st = retryMap.get(host)
  if (st) {
    if (st.timer) clearTimeout(st.timer)
    retryMap.delete(host)
  }
}
