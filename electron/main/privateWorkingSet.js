// =========================================================================
// privateWorkingSet.js —— Windows「专用工作集」口径（与任务管理器「进程」页一致）
//
// Electron 的 app.getAppMetrics() 与 Node 都不提供这个值：
//   - workingSetSize 是「工作集」，含可被多进程共享的页（如 DLL / 共享内存），数值偏高；
//   - privateBytes  是「提交大小」（私有虚拟内存），含已换出到页面文件的部分。
// 二者都与任务管理器对不上，只能走 Windows 性能计数器（PDH）。
//
// 这里用 koffi（预编译 FFI 绑定，纯 N-API，免 node-gyp / electron-rebuild）调 PDH：
//   \Process V2(*)\Working Set - Private —— 实例名为「进程名:pid」，可直接按 pid 取值。
// 非 Windows 或加载失败时一律返回 null，由调用方回退到 Electron 自带口径。
//
// 为什么改到 worker 线程里跑（2026-10-15）：
//   PdhAddEnglishCounterW 在「每个进程内」的首次调用会同步阻塞约 500ms —— 这是 Windows
//   性能计数器 provider 的一次性载入，与计数器路径无关（通配符与单实例路径首次都约 500ms，
//   第二次起降到 ~10ms），进程内无法规避。原先它在主进程启动路径上同步执行，把
//   「窗口创建 / 首屏加载 / 后端就绪」整体推迟了约 500~600ms。
//   故改为在 worker 线程内执行：主线程只做一次异步往返，启动不再被阻塞。
//   首次查询仍要约 750ms（worker 启动 + provider 载入），但全在后台线程。
// =========================================================================

const { Worker } = require('worker_threads')

// 计数器路径：实例名形如「进程名:pid」，按最后一个冒号后的数字取 pid
const COUNTER_PATH = '\\Process V2(*)\\Working Set - Private'

// worker 源码：与主线程同源的 PDH 读取逻辑，只是挪到独立线程执行。
// 计数器路径与 koffi 模块路径都由主线程经 workerData 注入，
// 避免在模板字符串里手写反斜杠转义（PDH 路径必须以 \ 开头）。
const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads')

const PDH_FMT_LARGE = 0x00000400
const COUNTER_PATH = workerData.counterPath

let api = null
function init() {
  if (api) return api
  const koffi = require(workerData.koffiPath)
  const pdh = koffi.load('pdh.dll')
  api = {
    koffi,
    openQuery: pdh.func('int PdhOpenQueryW(const char16_t *szDataSource, uint64 dwUserData, _Out_ void **phQuery)'),
    addEnglishCounter: pdh.func('int PdhAddEnglishCounterW(void *hQuery, const char16_t *szFullCounterPath, uint64 dwUserData, _Out_ void **phCounter)'),
    collectQueryData: pdh.func('int PdhCollectQueryData(void *hQuery)'),
    getCounterArray: pdh.func('int PdhGetFormattedCounterArrayW(void *hCounter, uint32 dwFormat, _Inout_ uint32 *lpdwBufferSize, _Out_ uint32 *lpdwItemCount, void *ItemBuffer)'),
    closeQuery: pdh.func('int PdhCloseQuery(void *hQuery)'),
    item: koffi.struct('PDH_FMT_COUNTERVALUE_ITEM_W', {
      szName: 'uint64', // 原始指针地址，解码位置见下
      CStatus: 'uint32',
      largeValue: 'int64',
    }),
  }
  return api
}

function query() {
  const a = init()
  const hQuery = [null]
  const hCounter = [null]
  try {
    if (a.openQuery(null, 0n, hQuery) !== 0) return null
    if (a.addEnglishCounter(hQuery[0], COUNTER_PATH, 0n, hCounter) !== 0) return null
    // 该计数器按「两次采样」口径求值，采两次才拿得到稳定结果
    a.collectQueryData(hQuery[0])
    a.collectQueryData(hQuery[0])
    const size = [0]
    const count = [0]
    // 首次调用只用于问出所需缓冲区大小，返回 PDH_MORE_DATA 属预期
    a.getCounterArray(hCounter[0], PDH_FMT_LARGE, size, count, null)
    if (!size[0]) return null
    const buf = Buffer.alloc(size[0])
    if (a.getCounterArray(hCounter[0], PDH_FMT_LARGE, size, count, buf) !== 0) return null
    const items = a.koffi.decode(buf, a.item, count[0])
    const entries = []
    for (const it of items) {
      if (it.CStatus !== 0) continue // 进程已退出等无效项跳过
      let name = ''
      try { name = a.koffi.decode(Number(it.szName), 'char16_t', -1) } catch (_) { continue }
      const cut = name.lastIndexOf(':')
      if (cut <= 0) continue
      const pid = Number(name.slice(cut + 1))
      if (!pid) continue
      entries.push([pid, Math.round(Number(it.largeValue) / 1024)])
    }
    return entries
  } catch (_) {
    return null
  } finally {
    try { a.closeQuery(hQuery[0]) } catch (_) { /* 忽略 */ }
  }
}

parentPort.on('message', (id) => {
  let entries = null
  try { entries = query() } catch (_) { /* 失败即回传 null，由调用方回退口径 */ }
  parentPort.postMessage({ id, entries })
})
`

let worker = null
let seq = 0
// id -> { resolve, timer }：一次查询一个 id，避免并发时串号
const pending = new Map()

function failAll() {
  for (const { resolve, timer } of pending.values()) {
    clearTimeout(timer)
    resolve(null)
  }
  pending.clear()
}

// 懒创建并复用 worker：首次需等线程启动 + provider 载入（约 0.7s，全在后台线程），
// 之后每次查询只花约 10ms 的线程往返。
function ensureWorker() {
  if (worker) return worker
  let koffiPath = ''
  try {
    koffiPath = require.resolve('koffi')
    // 打包后 node_modules 在 asarUnpack 名单里（磁盘上的真实文件），而 worker 是纯 Node
    // 线程、不走主进程的 asar 补丁，故把逻辑路径改写到 app.asar.unpacked 下的实际位置。
    if (koffiPath.includes('app.asar')) koffiPath = koffiPath.replace('app.asar', 'app.asar.unpacked')
  } catch (_) {
    return null // koffi 缺失（非 Windows 安装等）：直接回退 Electron 口径
  }
  try {
    worker = new Worker(WORKER_SRC, { eval: true, workerData: { koffiPath, counterPath: COUNTER_PATH } })
  } catch (_) {
    worker = null
    return null
  }
  // 不让这个后台线程拖住主进程退出
  worker.unref()
  worker.on('message', (msg) => {
    const p = msg && pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    clearTimeout(p.timer)
    p.resolve(msg.entries ? new Map(msg.entries) : null)
  })
  worker.on('error', (err) => {
    console.warn('[privateWorkingSet] worker 异常，回退到 Electron 口径：' + (err?.message || err))
    worker = null
    failAll()
  })
  worker.on('exit', () => { worker = null; failAll() })
  return worker
}

// 返回 Promise<Map<pid, 专用工作集KB> | null>；不可用或读取失败 resolve(null)。
// 注意：首次调用要等 worker 完成 provider 载入（约 0.7s），调用方须 await，不要同步等待。
function getPrivateWorkingSetKB(timeout = 8000) {
  const w = ensureWorker()
  if (!w) return Promise.resolve(null)
  return new Promise((resolve) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); resolve(null) }, timeout)
    pending.set(id, { resolve, timer })
    try {
      w.postMessage(id)
    } catch (_) {
      pending.delete(id)
      clearTimeout(timer)
      resolve(null)
    }
  })
}

module.exports = { getPrivateWorkingSetKB }
