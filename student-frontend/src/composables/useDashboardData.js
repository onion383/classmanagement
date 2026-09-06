import axios from 'axios'

// ===========================================================================
// 首屏数据预取：Dashboard 首页的 9 个接口并行拉取，并把请求发起时刻从「组件挂载后」
// 提前到「路由导航进入首页时」（见 router 守卫 ensureDashboardData()）。
// 这样数据拉取与 Dashboard 组件 bundle 的下载/挂载并行，减少首屏白屏等待。
//
// 共享设计：模块级缓存 + 进行中 Promise，避免 Dashboard 挂载时重复发同样的请求。
// force=true 强制刷新（供切回首页时用，见 onActivated）。
// ===========================================================================

let dataCache = null // 最近一次成功的数据快照
let pending = null   // 进行中的请求 Promise（共享）

function fetchAll() {
  pending = Promise.all([
    axios.get('/api/schedule').catch(() => ({ data: { cells: [], settings: {} } })),
    axios.get('/api/duty').catch(() => ({ data: { cells: {}, settings: {} } })),
    axios.get('/api/countdowns').catch(() => ({ data: { data: [] } })),
    axios.get('/api/leaves').catch(() => ({ data: { data: [] } })),
    axios.get('/api/students').catch(() => ({ data: { data: [] } })),
    axios.get('/api/scores').catch(() => ({ data: { data: [] } })),
    axios.get('/api/activities').catch(() => ({ data: { data: [] } })),
    axios.get('/api/fee-records').catch(() => ({ data: { data: [] } })),
    axios.get('/api/album').catch(() => ({ data: { data: [] } })),
  ]).then((res) => ({
    schedule: (res[0] && res[0].data) || { cells: [], settings: {} },
    duty: (res[1] && res[1].data) || { cells: {}, settings: {} },
    countdowns: (res[2] && res[2].data && res[2].data.data) || [],
    leaves: (res[3] && res[3].data && res[3].data.data) || [],
    students: (res[4] && res[4].data && res[4].data.data) || [],
    scores: (res[5] && res[5].data && res[5].data.data) || [],
    activities: (res[6] && res[6].data && res[6].data.data) || [],
    fees: (res[7] && res[7].data && res[7].data.data) || [],
    album: (res[8] && res[8].data && res[8].data.data) || [],
  }))
  pending.finally(() => { pending = null })
  return pending
}

// 取数据：force=true 时丢弃本地缓存走一次新的并行拉取
export function ensureDashboardData(force = false) {
  if (force) dataCache = null
  if (dataCache) return Promise.resolve(dataCache)
  if (pending) return pending
  return fetchAll().then((d) => {
    dataCache = d
    return d
  })
}