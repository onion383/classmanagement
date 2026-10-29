// =========================================================================
// desktop-layer.js —— Windows「桌面层」定位（让窗口常驻所有应用窗口之下）
//
// 目标：窗口既永远在所有应用窗口之下（点击不会被抬到前台、Alt+Tab 不出现、
//       Win+D 不隐藏），又保留完整的鼠标交互（可点击、可拖动、可圆角）。
//
// ===== 为什么不再用 SetParent（历史坑，别改回去）=====
// 旧实现把 BrowserWindow 的 HWND 用 SetParent 挂到桌面壳 Progman 之下，做成
// WS_CHILD 子窗口（Rainmeter / Lively 那套做法）。在 Electron 上这条路**不可用**：
//   · 只要这个子窗口被移动（真实鼠标拖动、外部程序 SetWindowPos 都算），宿主进程
//     就会以 0xC000041D 原生崩溃 —— 日志表现为「dragstart 后几十毫秒进程消失，
//     8~10 秒后自动重建」（WER 抓 dump 会把进程 hold 住几秒）。
//   · 试过且**都无效**的缓解手段：拖动前 ReleaseCapture 放掉鼠标捕获、去掉
//     SetWindowRgn 圆角区域、每次移动后重裁区域、用 SWP_NOSENDCHANGING 抑制
//     WM_WINDOWPOSCHANGING、主进程轮询光标搬窗口 —— 只能降低概率，无法根治。
//   · 同一套移动代码作用在**普通顶层窗口**上连续 200 帧完全稳定。
//   ⇒ 差异就在「跨进程父窗口」：Chromium 的窗口过程不支持被当成别人家窗口的
//     子窗口来搬动。
//
// ===== 现方案：顶层窗口 + z 序插到 Progman 之上 =====
// 不做 SetParent，窗口**始终是顶层窗口**，只用 SetWindowPos 把它放到
// 「Progman 之上、所有普通窗口之下」这个 z 序位置（桌面挂件的通行做法）：
//   · 它仍是普通顶层窗口 → 移动安全，拖动与主窗口同一套坐标口径（DIP）；
//   · 本窗口是 Progman 的**兄弟**且位于其上方，桌面图标层（SHELLDLL_DefView，
//     Progman 的子窗口）不会吃掉点击 —— 实测真实鼠标事件能到达本窗口；
//   · 圆角改由渲染层用 CSS border-radius + 透明窗口绘制，不再用 SetWindowRgn
//     （「非矩形窗口 + 移动」是 Windows 上另一条易崩路径）。
//
// ===== 必须遵守的两条 =====
//   1) **先成为底层窗口，再显示**：隐藏创建 → 等首帧 → attach() 插层并校验通过 →
//      才 show。反过来会先以普通顶层窗口浮到最前闪一下。
//   2) 用户点击会让 Windows 把窗口激活并抬到最前，所以 focus/blur、拖动结束后都要
//      调 reassert() 重新压回底层。
//
// 非 Windows / koffi 缺失 / 找不到 Progman：attach() 返回 false，窗口退回普通顶层
// 窗口（可用，只是不再常驻最底层）。
// =========================================================================

const isWin = process.platform === 'win32'

// 总开关：出问题（点不动、不显示）时改 false，立刻退回「普通顶层窗口」的行为。
const DESKTOP_LAYER_ENABLED = true

const GW_HWNDPREV = 3
const SWP_NOMOVE = 0x0002
const SWP_NOSIZE = 0x0001
const SWP_NOACTIVATE = 0x0010
const HWND_BOTTOM = 1

// 缓存的 FFI 绑定：首次调用时加载，失败后不再重试（避免每帧 try/catch 开销）
let api = null
let loadFailed = false

function init() {
  if (api || loadFailed) return api
  if (!isWin) {
    loadFailed = true
    return null
  }
  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')

    // 结构体必须先注册，后面 func() 里按名字引用才不会抛 unknown type
    /* eslint-disable-next-line no-unused-vars */
    const RECT = koffi.struct('RECT', {
      left: 'int',
      top: 'int',
      right: 'int',
      bottom: 'int',
    })

    api = {
      koffi,
      GetShellWindow: user32.func('void *GetShellWindow()'),
      GetWindow: user32.func('void *GetWindow(void *hWnd, uint32 uCmd)'),
      SetWindowPos: user32.func(
        'int SetWindowPos(void *hWnd, void *hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)'
      ),
      GetWindowRect: user32.func('int GetWindowRect(void *hWnd, _Out_ RECT *lpRect)'),
      IsWindowVisible: user32.func('int IsWindowVisible(void *hWnd)'),
    }
  } catch (e) {
    loadFailed = true
    // 非 Windows 打包、koffi 未 unpack 等情况：静默降级，组件仍按普通窗口工作
    console.warn('[desktop-layer] FFI 不可用，跳过桌面层定位：', e && e.message)
    return null
  }
  return api
}

// 指针归一化：koffi 的指针返回值为 BigInt（实测 void* → 65904n），也可能是外部指针对象。
// 统一成 BigInt 再比较，避免 Number/BigInt 混比时 === 永假。
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

// 读取窗口矩形（屏幕物理像素）
function readRect(a, hwnd) {
  const r = { left: 0, top: 0, right: 0, bottom: 0 }
  if (!a.GetWindowRect(hwnd, r)) return null
  return r
}

// 把窗口插到「Progman 之上、所有普通窗口之下」。
// 做法：取当前紧挨在 Progman 上方的那个兄弟窗口，把本窗口插到它下面 —— 结果就是
// 本窗口成为 Progman 的直接上方邻居。只动 z 序（NOMOVE|NOSIZE|NOACTIVATE），
// 不碰位置、尺寸与焦点。
function placeAboveDesktop(win) {
  if (!DESKTOP_LAYER_ENABLED) return false
  const a = init()
  if (!a) return false
  const self = hwndOf(win)
  if (!self) return false
  try {
    const shell = addr(a, a.GetShellWindow())
    if (!shell) {
      console.warn('[desktop-layer] 找不到 Progman/桌面窗口，跳过定位')
      return false
    }
    // 从 Progman 往上找第一个**可见**窗口，把本窗口插在它下面。
    // 跳过 Default IME / MSCTFIME UI 这类不可见的系统窗口，避免它们插在我们和桌面之间
    //（它们不影响观感，但会让"是否已在底层"的判断变得不稳定）。
    let above = addr(a, a.GetWindow(shell, GW_HWNDPREV))
    for (let i = 0; i < 64 && above && !a.IsWindowVisible(above); i++) {
      const up = addr(a, a.GetWindow(above, GW_HWNDPREV))
      if (!up) break
      above = up
    }
    // 没有可见邻居时退化为 HWND_BOTTOM 兜底
    const after = above || BigInt(HWND_BOTTOM)
    return !!a.SetWindowPos(self, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
  } catch (e) {
    console.warn('[desktop-layer] 插层失败：', e && e.message)
    return false
  }
}

// 是否已处在「桌面之上、所有可见窗口之下」。
// 不能简单判「自己就是紧贴 Progman 的那个兄弟」：Progman 上方经常夹着**不可见**的
// 系统窗口（Default IME / MSCTFIME UI / 控制台宿主等），它们不影响观感与点击，
// 却会让"严格相邻"这种判定随机失败。这里从 Progman 往上走，遇到自己即合格；
// 途中若先遇到**可见**窗口，说明自己压在它上面，不合格。
function isJustAboveDesktop(win) {
  if (!DESKTOP_LAYER_ENABLED) return false
  const a = init()
  if (!a) return false
  const self = hwndOf(win)
  if (!self) return false
  try {
    const shell = addr(a, a.GetShellWindow())
    if (!shell) return false
    let h = addr(a, a.GetWindow(shell, GW_HWNDPREV))
    for (let i = 0; i < 64 && h; i++) {
      if (h === self) return true
      if (a.IsWindowVisible(h)) return false
      h = addr(a, a.GetWindow(h, GW_HWNDPREV))
    }
    return false
  } catch (_) {
    return false
  }
}

// 进入桌面层：插到 Progman 之上并校验（校验通过才算成功）。
// 本函数只调 z 序、不移动窗口、不改样式，因此可以在显示之前调用。
function attach(win) {
  if (!DESKTOP_LAYER_ENABLED) return false
  if (!init()) return false
  if (!hwndOf(win)) return false
  if (!placeAboveDesktop(win)) return false
  return isJustAboveDesktop(win)
}

// 用户点击会让窗口被激活并抬到最前，focus/blur、拖动结束后都要再压回去
function reassert(win) {
  if (!DESKTOP_LAYER_ENABLED) return false
  if (!win || win.isDestroyed()) return false
  if (isJustAboveDesktop(win)) return true
  return placeAboveDesktop(win)
}

// 解挂：现方案下窗口本来就是顶层窗口，没有父窗口/样式需要恢复，保留接口给调用方
function detach() {
  return true
}

// 取窗口矩形（屏幕物理像素），仅诊断用；位置读写请用 Electron 的 get/setContentBounds
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

module.exports = {
  attach,
  detach,
  reassert,
  placeAboveDesktop,
  isJustAboveDesktop,
  getRect,
  isAvailable: () => !!init(),
}
