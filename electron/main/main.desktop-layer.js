// =========================================================================
// desktop-layer.js —— Windows「桌面层」挂载（让窗口常驻所有应用窗口之下）
//
// 目标：窗口既永远在所有应用窗口之下（点击不会被抬到前台、Alt+Tab 不出现、
//       Win+D 不隐藏），又保留完整的鼠标交互（可点击、可拖动）。
//
// 实现：把 BrowserWindow 的 HWND 用 SetParent 挂到桌面壳 Progman 之下，成为「桌面层子窗口」。
//   这是 Rainmeter / Lively Wallpaper 一类桌面挂件的做法。
//
// 四条必须遵守的规则（踩过的坑都在这几条里）：
//   1) 必须把窗口改成真正的子窗口（WS_CHILD / 去掉 WS_POPUP）。只 SetParent 不改样式时，
//      窗口在系统眼里仍是顶层窗口，点击时会先走「激活窗口」流程；而挂在 Progman 下的窗口
//      永远无法成为前台窗口，这次激活会把点击吞掉 —— 表现为「组件看得见、PostMessage 能进页面，
//      但真实鼠标点不动、拖不动」。这是本项目实际踩过的坑，也是 Rainmeter 一类挂件都用子窗口的原因。
//   2) 挂载后必须 SetWindowPos(HWND_TOP) 提到桌面层内部 z 序顶端，否则会落在桌面图标层
//      （SHELLDLL_DefView / SysListView32）之下：窗口看得见，但点击全被图标层吃掉。
//   3) 挂载后 -webkit-app-region: drag 立即失效（系统把 SC_MOVE 转发给父窗 Progman），
//      拖动必须改由渲染层上报鼠标坐标 + 主进程 SetWindowPos 自实现（本模块 moveWindow）。
//   4) 子窗口的坐标是「父客户区坐标」且是物理像素，与 Electron setBounds 的
//      DIP 屏幕坐标是两套口径，不能混用：一律经本模块 getRect / moveWindow 读写。
//
// 已实测无效的两条旧路（别再重复踩）：
//   - focusable:false —— Electron 会加 WS_EX_NOACTIVATE，该状态下窗口收不到鼠标输入；
//   - SetWindowPos 到 HWND_BOTTOM —— 被压到桌面 shell 之下，窗口可见但点击全被 shell 吃掉。
//
// 非 Windows / koffi 缺失 / 任一系统调用失败：attach() 返回 false 并自动解挂，
// 窗口退回普通顶层窗口（仍可点击、可拖动），不影响可用性。
// =========================================================================

const isWin = process.platform === 'win32'

// 总开关：出问题（白屏、点不动、拖不动）时改 false，立刻退回「普通顶层窗口」的旧行为。
const DESKTOP_LAYER_ENABLED = true

const HWND_TOP = 0
const GA_PARENT = 1
const GWL_STYLE = -16
const GWL_EXSTYLE = -20
// 「真正的子窗口」样式：必须加，否则见 attach 里的说明（点击会被激活流程吞掉）
const WS_CHILD = 0x40000000
const WS_POPUP = 0x80000000
// 系统背景材质的窗口需要它自己算非客户区，改样式后重算一次边框
const SWP_FRAMECHANGED = 0x0020
const SWP_NOSIZE = 0x0001
const SWP_NOMOVE = 0x0002
const SWP_NOZORDER = 0x0004
const SWP_NOACTIVATE = 0x0010
const SWP_SHOWWINDOW = 0x0040

// 缓存的 FFI 绑定：首次调用时加载，失败后不再重试（避免每帧 try/catch 开销）
let api = null
let loadFailed = false
// 挂载前改过的原始样式：hwnd 字符串 -> { style, exStyle }，解挂时恢复
const savedStyle = new Map()

// 恢复挂载前的窗口样式（改样式失败或解挂时都要走这里，避免窗口残留 WS_CHILD）
function restoreStyle(a, self) {
  const key = String(self)
  const saved = savedStyle.get(key)
  if (!saved) return
  try {
    a.SetWindowLongW(self, GWL_STYLE, saved.style | 0)
    a.SetWindowLongW(self, GWL_EXSTYLE, saved.exStyle | 0)
  } catch (_) {
    /* 忽略 */
  }
  savedStyle.delete(key)
}

function init() {
  if (api || loadFailed) return api
  if (!isWin) {
    loadFailed = true
    return null
  }
  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')

    // 结构体必须在同一 koffi 实例里只注册一次，故放在 init 内（init 有 api 缓存）
    // 这两个赋值「看似未使用」，实际是**按名字注册 koffi 类型**：下面
    // user32.func('int GetWindowRect(void *hWnd, _Out_ RECT *lpRect)') 用字符串引用它们，
    // 删掉会让 func() 抛 unknown type。勿当死代码清理。
    /* eslint-disable-next-line no-unused-vars */
    const POINT = koffi.struct('POINT', { x: 'int', y: 'int' })
    /* eslint-disable-next-line no-unused-vars */
    const RECT = koffi.struct('RECT', {
      left: 'int',
      top: 'int',
      right: 'int',
      bottom: 'int',
    })

    api = {
      koffi,
      FindWindowW: user32.func(
        'void *FindWindowW(const char16_t *lpClassName, const char16_t *lpWindowName)'
      ),
      GetParent: user32.func('void *GetParent(void *hWnd)'),
      // 注意：GetParent 对「没有 WS_CHILD 的窗口」返回的是 owner（顶层窗口恒为 NULL），
      // 判断真正的父必须用 GetAncestor(GA_PARENT)。SetParent 不改样式，
      // 所以 BrowserWindow（WS_POPUP）挂载后 GetParent 仍是 NULL，只有 GetAncestor 看得到 Progman。
      GetAncestor: user32.func('void *GetAncestor(void *hWnd, uint32 gaFlags)'),
      SetParent: user32.func('void *SetParent(void *hWndChild, void *hWndNewParent)'),
      SetWindowPos: user32.func(
        'int SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)'
      ),
      GetWindowRect: user32.func('int GetWindowRect(void *hWnd, _Out_ RECT *lpRect)'),
      GetWindowLongW: user32.func('int GetWindowLongW(void *hWnd, int nIndex)'),
      SetWindowLongW: user32.func('int SetWindowLongW(void *hWnd, int nIndex, int dwNewLong)'),
      ScreenToClient: user32.func('int ScreenToClient(void *hWnd, _Inout_ POINT *lpPoint)'),
      SetLastError: kernel32.func('void SetLastError(uint32 dwErrCode)'),
      GetLastError: kernel32.func('uint32 GetLastError()'),
    }
  } catch (e) {
    loadFailed = true
    // 非 Windows 打包、koffi 未 unpack 等情况：静默降级，桌面组件仍按普通窗口工作
    console.warn('[desktop-layer] FFI 不可用，跳过桌面层挂载：', e && e.message)
    return null
  }
  return api
}

// 指针归一化：koffi 的指针返回值为 BigInt（实测 void* → 65904n），也可能给外部指针对象。
// 统一成 BigInt 后再比较/传参：既避免 Number 精度问题，也避免 Number/BigInt 混比时 === 永假。
function addr(a, p) {
  if (p === null || p === undefined) return 0n
  if (typeof p === 'bigint') return p
  if (typeof p === 'number') return BigInt(p)
  try {
    const v = a.koffi.address(p)
    return typeof v === 'bigint' ? v : BigInt(v)
  } catch (_) {
    return 0n
  }
}

// BrowserWindow -> HWND（BigInt）。Windows 上 getNativeWindowHandle() 返回 8 字节小端值
function hwndOf(win) {
  if (!win || win.isDestroyed()) return 0n
  try {
    const buf = win.getNativeWindowHandle()
    if (!buf || buf.length < 4) return 0n
    return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))
  } catch (_) {
    return 0n
  }
}

// 读取窗口当前矩形（屏幕物理像素；对子窗口 GetWindowRect 同样返回屏幕坐标）
function readRect(a, hwnd) {
  const r = { left: 0, top: 0, right: 0, bottom: 0 }
  if (!a.GetWindowRect(hwnd, r)) return null
  return r
}

// 把窗口挂到桌面层（Progman 子窗口）。成功返回 true，任一步失败自动解挂并返回 false。
function attach(win) {
  if (!DESKTOP_LAYER_ENABLED) return false
  const a = init()
  if (!a) return false
  const self = hwndOf(win)
  if (!self) return false

  try {
    const progman = addr(a, a.FindWindowW('Progman', null))
    if (!progman) {
      console.warn('[desktop-layer] 找不到 Progman，跳过挂载')
      return false
    }

    // 挂载前记下屏幕位置：SetParent 不会保留可视位置，挂载后要按原位置摆回去
    const rect = readRect(a, self)
    if (!rect) {
      console.warn('[desktop-layer] GetWindowRect 失败，跳过挂载')
      return false
    }

    // 规则 2（关键）：必须把窗口改成「真正的子窗口」（WS_CHILD）。
    // 只 SetParent 不改样式时，窗口在系统眼里仍是顶层窗口，点击时系统会走一遍「激活窗口」流程；
    // 而挂在 Progman 下的窗口永远无法成为前台窗口，这次激活会把点击吞掉 —— 表现就是
    // 「组件看得见、PostMessage 能进页面，但真实鼠标点不动、拖不动」。
    // 加了 WS_CHILD 后系统不再对它做激活，点击直接派发给窗口，Chromium 正常处理。
    // （试过 WS_EX_NOACTIVATE：Chromium 对 WM_MOUSEACTIVATE 仍返回 MA_ACTIVATE，无效。）
    const key = String(self)
    const oldStyle = Number(a.GetWindowLongW(self, GWL_STYLE))
    const oldExStyle = Number(a.GetWindowLongW(self, GWL_EXSTYLE))
    savedStyle.set(key, { style: oldStyle, exStyle: oldExStyle })
    a.SetWindowLongW(self, GWL_STYLE, ((oldStyle & ~WS_POPUP) | WS_CHILD) | 0)

    // SetParent 成功时返回「原父窗口」：顶层窗口的原父本来就是 NULL，
    // 因此不能靠返回值判断成败，必须用 SetLastError / GetLastError 区分
    a.SetLastError(0)
    a.SetParent(self, progman)
    const err = a.GetLastError()
    const parentNow = addr(a, a.GetAncestor(self, GA_PARENT))
    if (err !== 0 || parentNow !== progman) {
      console.warn(
        '[desktop-layer] SetParent 未生效：err=', String(err),
        'hwnd=', String(self), 'progman=', String(progman), 'parentNow=', String(parentNow)
      )
      try {
        a.SetParent(self, null)
      } catch (_) {
        /* 忽略 */
      }
      restoreStyle(a, self)
      return false
    }

    // 规则 1：提到桌面层内部 z 序顶端，否则被桌面图标层盖住、点击穿透不过去。
    // 样式刚改过，带 SWP_FRAMECHANGED 让系统重算一次非客户区。
    a.SetWindowPos(
      self,
      HWND_TOP,
      rect.left,
      rect.top,
      rect.right - rect.left,
      rect.bottom - rect.top,
      SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED
    )
    return true
  } catch (e) {
    console.warn('[desktop-layer] 挂载失败，退回普通窗口：', e && e.message)
    try {
      a.SetParent(self, null)
    } catch (_) {
      /* 忽略 */
    }
    restoreStyle(a, self)
    return false
  }
}

// 解挂：恢复成普通顶层窗口（按解挂前的屏幕位置放回原位）
function detach(win) {
  const a = init()
  if (!a) return false
  const self = hwndOf(win)
  if (!self) return false

  try {
    if (!addr(a, a.GetAncestor(self, GA_PARENT))) {
      // 本来就是顶层窗口：把可能残留的样式还原回来
      restoreStyle(a, self)
      return true
    }
    const rect = readRect(a, self)
    a.SetLastError(0)
    a.SetParent(self, null)
    if (a.GetLastError() !== 0) return false
    // 解挂后要恢复原样式（去掉 WS_CHILD），否则窗口仍是「子窗口语义」，层级/激活都会怪
    restoreStyle(a, self)
    // 解挂后坐标口径回到「屏幕坐标」，直接按原矩形放回，避免跳位
    if (rect) {
      a.SetWindowPos(
        self,
        null,
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top,
        SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED
      )
    }
    return true
  } catch (_) {
    return false
  }
}

// 取窗口矩形（屏幕物理像素）。供拖动结算用，与 Electron getBounds 的 DIP 口径无关。
function getRect(win) {
  const a = init()
  if (!a) return null
  const self = hwndOf(win)
  if (!self) return null
  try {
    return readRect(a, self)
  } catch (_) {
    return null
  }
}

// 移动窗口到指定「屏幕物理像素」位置。
// 子窗口的 SetWindowPos 用的是父客户区坐标，故先 ScreenToClient 换算；
// 未挂载（普通顶层窗口）时直接就是屏幕坐标。
function moveWindow(win, x, y, width, height) {
  const a = init()
  if (!a) return false
  const self = hwndOf(win)
  if (!self) return false

  try {
    const parent = addr(a, a.GetAncestor(self, GA_PARENT))
    let px = Math.round(x)
    let py = Math.round(y)
    if (parent) {
      const progman = addr(a, a.FindWindowW('Progman', null))
      if (progman && parent === progman) {
        const pt = { x: px, y: py }
        if (a.ScreenToClient(parent, pt)) {
          px = pt.x
          py = pt.y
        }
      }
    }
    // SWP_NOZORDER：拖动过程中保持 z 序不变，否则可能被桌面图标层重新压下去
    return !!a.SetWindowPos(
      self,
      null,
      px,
      py,
      Math.round(width),
      Math.round(height),
      SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW
    )
  } catch (_) {
    return false
  }
}

// 重新提到桌面层 z 序顶端（拖动结束后调用，防止 z 序被系统重置后点不动）
function raiseToTop(win) {
  const a = init()
  if (!a) return false
  const self = hwndOf(win)
  if (!self) return false
  try {
    return !!a.SetWindowPos(
      self,
      HWND_TOP,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
    )
  } catch (_) {
    return false
  }
}

// 是否已挂在桌面层（Progman 是否仍是直接父窗口）
function isAttached(win) {
  const a = init()
  if (!a) return false
  const self = hwndOf(win)
  if (!self) return false
  try {
    const parent = addr(a, a.GetAncestor(self, GA_PARENT))
    const progman = addr(a, a.FindWindowW('Progman', null))
    return !!parent && parent === progman
  } catch (_) {
    return false
  }
}

module.exports = {
  attach,
  detach,
  getRect,
  moveWindow,
  raiseToTop,
  isAttached,
  isAvailable: () => !!init(),
}
