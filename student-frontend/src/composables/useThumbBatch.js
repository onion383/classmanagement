// =========================================================================
// useThumbBatch.js —— 缩略图批量预取（性能优化）
//
// 背景：相册网格一次要显示几十上百张缩略图。逐个 <img> 请求受浏览器同源并发
// 连接数限制（HTTP/1.1 通常 6 条），往返开销占比很高。实测（后端已上内存缓存后）：
//   逐个并发 6      2.43 ms/张
//   批量每批 100 张  0.19 ms/张   （约 10 倍）
//
// 做法：可视区变化时，把当前可见的照片 id 一次性批量取回来，转成 objectURL
// 交给 <img> 用；取不到的那些（服务端没缓存的）回落到单张 /thumb 接口，
// 由服务端现场生成 —— 功能完全不变，只是把「N 次往返」压成「1 次往返 + 少量回落」。
//
// 生命周期注意：
//   · objectURL 必须 revoke，否则 blob 内存一直占着（切相册/销毁组件时要清）。
//   · 批量请求要防抖：滚动时可见区变化频繁，节流后再发。
//   · 同一批 id 重复请求要合并（用 inflight 标记）。
// =========================================================================
import { ref, onBeforeUnmount, watch } from 'vue'
import { fetchThumbBatch } from '../utils/albumMedia'

// 可视区变化后多久发一次批量请求（毫秒）
const DEBOUNCE_MS = 120
// 一次批量请求最多带多少张
const CHUNK = 100

export function useThumbBatch(getVisibleIds, options = {}) {
  const enabled = options.enabled !== false
  // photoId → objectURL
  const urls = ref(new Map())
  // 正在请求中的 id 集合（避免重复请求同一批）
  const inflight = new Set()
  // 已尝试过批量但没拿到的 id（这类直接走单张回落，不再进批量）
  const miss = new Set()

  let timer = 0
  let destroyed = false
  // 已创建但尚未 revoke 的 objectURL
  const liveUrls = new Set()

  function revokeAll() {
    for (const u of liveUrls) {
      try { URL.revokeObjectURL(u) } catch (_) {}
    }
    liveUrls.clear()
    urls.value = new Map()
  }

  // 只保留当前还要用的，其余 revoke（避免 blob 无限增长）
  function prune(keepIds) {
    if (!liveUrls.size) return
    const next = new Map()
    for (const [id, u] of urls.value) {
      if (keepIds.has(id)) { next.set(id, u); continue }
      try { URL.revokeObjectURL(u) } catch (_) {}
      liveUrls.delete(u)
    }
    urls.value = next
  }

  async function load(ids) {
    if (!enabled || destroyed) return
    const want = []
    for (const id of ids) {
      if (id == null) continue
      if (urls.value.has(id)) continue
      if (miss.has(id)) continue
      if (inflight.has(id)) continue
      want.push(id)
    }
    if (!want.length) return

    for (let i = 0; i < want.length; i += CHUNK) {
      const chunk = want.slice(i, i + CHUNK)
      chunk.forEach(id => inflight.add(id))
      const map = await fetchThumbBatch(chunk)
      if (destroyed) {
        chunk.forEach(id => inflight.delete(id))
        return
      }
      const next = new Map(urls.value)
      for (const [id, blob] of map) {
        const u = URL.createObjectURL(blob)
        liveUrls.add(u)
        next.set(id, u)
      }
      urls.value = next
      // 这一批里没回来的 id 记为 miss，后续直接走单张回落（不再进批量）
      for (const id of chunk) {
        if (!map.has(id)) miss.add(id)
        inflight.delete(id)
      }
    }
  }

  function schedule() {
    if (!enabled || destroyed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      timer = 0
      const ids = getVisibleIds() || []
      if (!ids.length) return
      await load(ids)
      // 请求完再裁一次：把已经滚出可视区、且没有 objectURL 的旧记录清掉
      prune(new Set(getVisibleIds() || []))
    }, DEBOUNCE_MS)
  }

  // 可视区 id 列表变化 → 调度一次批量预取
  watch(() => {
    const ids = getVisibleIds() || []
    // 只用「长度 + 首尾 id」做依赖判断，避免大数组每次都触发深比较
    return ids.length ? `${ids.length}:${ids[0]}:${ids[ids.length - 1]}` : ''
  }, schedule)

  onBeforeUnmount(() => {
    destroyed = true
    if (timer) { clearTimeout(timer); timer = 0 }
    revokeAll()
  })

  return {
    // 取某张照片的 objectURL（没有则返回 ''，调用方回落到单张接口）
    thumbUrlFor: (photoId) => urls.value.get(photoId) || '',
    // 手动触发一次（切换相册后立即拉，不等滚动）
    refresh: schedule,
    // 清空所有缓存（切换相册时用）
    clear: () => { revokeAll(); miss.clear(); inflight.clear() },
  }
}
