// =========================================================================
// serialSaver.js —— 串行保存器（防并发覆盖 + 失败可感知）
//
// 课表这类「每次编辑就 PUT 整块数据」的页面，连续操作会并发发出多个 PUT：
// 后端按到达顺序写库，先发的请求可能后到，最终库里留下的是**更旧**的状态。
// 同时调用处不 await，请求失败时静默，用户以为已保存，刷新后改动消失。
//
// 本工具保证：
//   · 同一时刻最多一个保存请求在途；
//   · 在途期间再来的更新只记一次「脏」，结束后用 saveFn 读取**最新状态**再存一次；
//   · 失败后停止本批（不自动重试，避免网络抖动时无限重试），request() 返回 false，
//     由调用方决定是否提示。
// =========================================================================

export function createSerialSaver(saveFn) {
  let inFlight = false
  let dirty = false
  let lastError = null
  // 在途期间追加的请求：统一等在途保存结束后拿同一个结果（合并成一轮）
  let waiters = []

  const settle = (ok) => {
    const ws = waiters
    waiters = []
    ws.forEach((resolve) => resolve(ok))
  }

  async function drain() {
    if (inFlight) return new Promise((resolve) => waiters.push(resolve))
    inFlight = true
    let ok = true
    try {
      do {
        dirty = false
        try {
          await saveFn()
          lastError = null
        } catch (e) {
          lastError = e
          ok = false
          dirty = false // 失败后不再继续合并轮次（避免把旧状态又写一遍）
        }
      } while (dirty && ok)
    } finally {
      inFlight = false
      settle(ok)
    }
    return ok
  }

  return {
    // 请求一次保存；返回 boolean（不 reject，调用方漏写 catch 也不会产生未处理拒绝）
    request() {
      dirty = true
      return drain()
    },
    get busy() { return inFlight },
    get error() { return lastError }
  }
}
