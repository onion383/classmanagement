// 专用工作集（Private Working Set）：任务管理器「进程」页「内存」列的口径——
// 该进程私有、且当前驻留在物理内存中的那部分。
//
// Electron 的 app.getAppMetrics() 与 Node 都不提供这个值：
//   - workingSetSize 是「工作集」，含可被多进程共享的页（如 DLL / 共享内存），数值偏高；
//   - privateBytes  是「提交大小」（私有虚拟内存），含已换出到页面文件的部分。
// 二者都与任务管理器对不上，只能走 Windows 性能计数器（PDH）。
//
// 这里用 koffi（预编译 FFI 绑定，纯 N-API，免 node-gyp / electron-rebuild）调 PDH：
//   \Process V2(*)\Working Set - Private —— 实例名为「进程名:pid」，可直接按 pid 取值。
// 非 Windows 或加载失败时一律返回 null，由调用方回退到 Electron 自带口径。

// 注意：PDH_FMT_LARGE = 0x400，0x200 是 PDH_FMT_DOUBLE（更早的代码曾写反导致读出乱码）
const PDH_FMT_LARGE = 0x00000400
const COUNTER_PATH = '\\Process V2(*)\\Working Set - Private'

let api = undefined // undefined=未初始化；null=不可用；对象=已就绪

function init() {
  if (api !== undefined) return api
  api = null
  if (process.platform !== 'win32') return api
  try {
    const koffi = require('koffi')
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
  } catch (e) {
    console.warn('[privateWorkingSet] 初始化失败，回退到 Electron 口径：' + e.message)
  }
  return api
}

// 返回 Map<pid, 专用工作集KB>；不可用或读取失败返回 null。
function getPrivateWorkingSetKB() {
  const a = init()
  if (!a) return null
  const query = [null]
  try {
    if (a.openQuery(null, 0n, query) !== 0) return null
    const counter = [null]
    if (a.addEnglishCounter(query[0], COUNTER_PATH, 0n, counter) !== 0) return null
    // 该计数器按「两次采样」口径求值，采两次才拿得到稳定结果
    a.collectQueryData(query[0])
    a.collectQueryData(query[0])
    const size = [0]
    const count = [0]
    // 首次调用只用于问出所需缓冲区大小，返回 PDH_MORE_DATA 属预期
    a.getCounterArray(counter[0], PDH_FMT_LARGE, size, count, null)
    if (!size[0]) return null
    const buf = Buffer.alloc(size[0])
    if (a.getCounterArray(counter[0], PDH_FMT_LARGE, size, count, buf) !== 0) return null
    const items = a.koffi.decode(buf, a.item, count[0])
    const map = new Map()
    for (const it of items) {
      if (it.CStatus !== 0) continue // 进程已退出等无效项跳过
      try {
        const name = a.koffi.decode(Number(it.szName), 'char16_t', -1)
        const m = /:(\d+)$/.exec(name)
        if (m) map.set(Number(m[1]), Number(it.largeValue) / 1024)
      } catch (_) { /* 单个条目解码失败不影响其它进程 */ }
    }
    return map.size ? map : null
  } catch (e) {
    console.warn('[privateWorkingSet] 读取失败，回退到 Electron 口径：' + e.message)
    return null
  } finally {
    try { a.closeQuery(query[0]) } catch (_) { /* 忽略 */ }
  }
}

module.exports = { getPrivateWorkingSetKB }