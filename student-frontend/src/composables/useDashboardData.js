import axios from 'axios'

// ===========================================================================
// 首屏数据预取：Dashboard 首页所需的 9 份数据，改由后端聚合接口 /api/dashboard
// 一次请求返回（1 次 HTTP + 1 次加解密），请求发起时刻仍在「路由导航进入首页时」
// （见 router 守卫 ensureDashboardData()），与 Dashboard 组件 bundle 并行加载。
//
// 共享设计：模块级缓存 + 进行中 Promise，避免 Dashboard 挂载时重复发同样的请求。
// force=true 强制刷新（供切回首页时用，见 onActivated）。
// ===========================================================================

let dataCache = null // 最近一次成功的数据快照
let pending = null   // 进行中的请求 Promise（共享）

// 兜底归一：聚合接口已按约定返回各键，这里只补缺省值，保证调用方拿到的形状稳定。
function normalize(d) {
  return {
    schedule: (d && d.schedule) || { cells: [], settings: {} },
    duty: (d && d.duty) || { cells: {}, settings: {} },
    countdowns: (d && d.countdowns) || [],
    leaves: (d && d.leaves) || [],
    students: (d && d.students) || [],
    scores: (d && d.scores) || [],
    activities: (d && d.activities) || [],
    fees: (d && d.fees) || [],
    album: (d && d.album) || [],
  }
}

function fetchAll() {
  // 失败**不能**伪装成「空数据」：早先这里写的是 `.catch(() => normalize(null))`，
  // 于是后端一旦不可达，首页就显示「全班 0 人、0 条记录」，老师第一反应是数据丢了。
  // 现在让失败如实冒泡（dataCache 不会被写入，下次进首页会重新拉），由调用方显示错误态。
  const req = axios.get('/api/dashboard').then((res) => normalize(res && res.data))
  pending = req
  // 成功/失败都要清掉 pending；用 then 的双回调而不是 .finally()，
  // 否则 finally 返回的新 Promise 在失败时没人接，会变成 unhandledrejection。
  req.then(() => { pending = null }, () => { pending = null })
  return req
}

// 取数据：force=true 时丢弃本地缓存重新拉取一次
export function ensureDashboardData(force = false) {
  if (force) dataCache = null
  if (dataCache) return Promise.resolve(dataCache)
  if (pending) return pending
  return fetchAll().then((d) => {
    dataCache = d
    return d
  })
}