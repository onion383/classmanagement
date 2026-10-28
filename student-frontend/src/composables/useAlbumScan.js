// =========================================================================
// useAlbumScan.js —— 相册扫描任务的轮询
//
// 相册的「更新文件夹照片」是后端后台任务：POST /api/album/:id/rescan 后立刻返回，
// 前端需要按固定间隔轮询 /status 直到 scanning 变 false。
// 页面顶部刷新（单相册、不显示进度）与管理弹窗（多相册、显示进度）共用这份逻辑，
// 避免两处各写一份 setInterval 且都要记得清理定时器。
// =========================================================================
import axios from 'axios'

const authHeaders = () => ({ Authorization: 'Bearer ' + (localStorage.getItem('token') || '') })

// 未结束的轮询定时器：**每个调用方一份**（不是模块级单例）。
// 页面级刷新与管理弹窗各自持有实例，任一方卸载只清理自己的定时器，
// 否则一方 stopAll() 会把另一方正在进行的轮询一起清掉，waitScan 的 Promise 永远不 resolve。
const POLL_INTERVAL = 800

export function useAlbumScan() {
  // 本实例发起的轮询定时器（每个调用方一份，互不影响）
  const timers = new Set()

  /**
   * 等待某个相册的扫描结束
   * @param {number} id 相册 id
   * @param {Object} [opts]
   * @param {(p:{scanned:number,total:number})=>void} [opts.onProgress] 每次轮询回填进度
   * @param {()=>void|Promise<void>} [opts.onTick] 每次轮询的额外回调（如渐进刷新照片列表）
   * @returns {Promise<void>} 扫描结束（或请求失败）后 resolve
   */
  function waitScan(id, opts = {}) {
    const { onProgress, onTick } = opts
    return new Promise((resolve) => {
      const done = () => {
        clearInterval(timer)
        timers.delete(timer)
        resolve()
      }
      const timer = setInterval(async () => {
        try {
          const res = await axios.get(`/api/album/${id}/status`, { headers: authHeaders() })
          if (res.data.scanning) {
            if (onProgress) onProgress({ scanned: res.data.scanned || 0, total: res.data.total || 0 })
            if (onTick) await onTick()
          } else {
            done()
          }
        } catch (_) {
          // 相册被删/请求失败：不再轮询，直接结束
          done()
        }
      }, POLL_INTERVAL)
      timers.add(timer)
    })
  }

  // 停止并清空本实例发起的轮询（组件卸载时调用；不会影响其它调用方）
  function stopAll() {
    for (const t of timers) clearInterval(t)
    timers.clear()
  }

  return { waitScan, stopAll }
}
