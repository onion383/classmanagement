// =========================================================================
// toplevel-bottom-probe.cjs —— 「顶层窗口 + 插到 Progman 之上」原型验证
//
// 目的：验证不做 SetParent 的情况下，能不能既有「常驻桌面」的层级、又能正常
// 显示圆角（透明 + CSS）和接收真实鼠标输入。
//
// 关键点：
//   · 窗口是**顶层**窗口（不经 SetParent）→ 移动/拖动是安全的；
//   · transparent:true + CSS border-radius → 圆角不依赖 SetWindowRgn；
//   · 用 SetWindowPos(hwnd, 当前紧挨在 Progman 上方的那个窗口) 把窗口插到
//     「桌面图标之上、所有普通窗口之下」。
//
// 验证项（都会写进日志）：
//   1) 插层是否成功（枚举 Progman 之上的 z 序邻居）；
//   2) 页面能否收到真实鼠标 pointerdown（说明点击没被桌面图标层吃掉）；
//   3) 截图看圆角/透明是否正常。
// =========================================================================

const { app, BrowserWindow, screen } = require('electron')
const fs = require('fs')
const path = require('path')
const koffi = require('koffi')

const LOG = path.join(__dirname, '..', 'tmp', 'toplevel-bottom-probe.log')
try { fs.mkdirSync(path.dirname(LOG), { recursive: true }) } catch (_) {}
function log(msg) {
  try { fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] ' + msg + '\n') } catch (_) {}
}
try { fs.writeFileSync(LOG, '') } catch (_) {}

const user32 = koffi.load('user32.dll')
// 结构体必须**先**注册，后面 func() 里用字符串引用类型名才不会抛 unknown type
const RECT = koffi.struct('TRECT', { left: 'int', top: 'int', right: 'int', bottom: 'int' })
const GetShellWindow = user32.func('void *GetShellWindow()')
const GetWindow = user32.func('void *GetWindow(void *h, uint32 cmd)')
const GetClassNameW = user32.func('int GetClassNameW(void *h, void *buf, int max)')
const GetWindowRect = user32.func('int GetWindowRect(void *h, _Out_ TRECT *r)')
const SetWindowPos = user32.func(
  'int SetWindowPos(void *h, void *after, int x, int y, int cx, int cy, uint32 flags)'
)
process.on('uncaughtException', (e) => log('uncaught: ' + (e && e.message)))

const GW_HWNDPREV = 3
const GW_HWNDNEXT = 2
const SWP_NOMOVE = 0x0002
const SWP_NOSIZE = 0x0001
const SWP_NOZORDER = 0x0004
const SWP_NOACTIVATE = 0x0010

function addr(p) {
  if (p === null || p === undefined) return 0n
  if (typeof p === 'bigint') return p
  if (typeof p === 'number') return BigInt(p)
  try {
    const v = koffi.address(p)
    return typeof v === 'bigint' ? v : BigInt(v)
  } catch (_) {
    return 0n
  }
}

function clsOf(h) {
  const buf = Buffer.alloc(512)
  GetClassNameW(h, buf, 256)
  return buf.toString('ucs2').replace(/\0.*$/, '')
}

function hwndOf(w) {
  const buf = w.getNativeWindowHandle()
  return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))
}

// 是否已经「紧贴在 Progman 之上」（= 桌面之上、所有普通窗口之下）—— 作为显示的门槛
function isJustAboveDesktop(self) {
  const shell = GetShellWindow()
  if (!addr(shell)) return false
  const above = GetWindow(shell, GW_HWNDPREV)
  return addr(above) === addr(self)
}

// 把窗口插到「Progman 之上、普通窗口之下」
function placeAboveDesktop(self) {
  const shell = GetShellWindow()
  if (!addr(shell)) return false
  const above = GetWindow(shell, GW_HWNDPREV)
  log('progman=' + String(shell) + ' windowJustAboveProgman=' + String(above) +
    ' class=' + (addr(above) ? clsOf(above) : '-'))
  // 没有邻居时退化为 HWND_BOTTOM（可能沉到桌面之下，仅作兜底）
  const after = addr(above) ? above : 1n // 1 = HWND_BOTTOM
  const ok = SetWindowPos(self, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
  return !!ok
}

function dumpNeighbours(self) {
  const p = self
  const prev = GetWindow(p, GW_HWNDPREV)
  const next = GetWindow(p, GW_HWNDNEXT)
  const r = { left: 0, top: 0, right: 0, bottom: 0 }
  GetWindowRect(p, r)
  log('self rect=' + r.left + ',' + r.top + ' ' + (r.right - r.left) + 'x' + (r.bottom - r.top))
  log('prev(above)=' + String(prev) + ' class=' + (addr(prev) ? clsOf(prev) : '-'))
  log('next(below)=' + String(next) + ' class=' + (addr(next) ? clsOf(next) : '-'))
}

const POS = (process.env.PROBE_POS || '600,420').split(',').map(Number)
const KEEP = Number(process.env.PROBE_KEEP || 25000)
const FOCUSABLE = process.env.PROBE_FOCUSABLE !== '0'

app.whenReady().then(async () => {
  log('whenReady called')
  const html = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:transparent;overflow:hidden">
  <div id="card" style="box-sizing:border-box;height:100vh;background:rgba(243,247,255,.94);
       border:1px solid rgba(255,255,255,.9);border-radius:14px;
       box-shadow:0 8px 30px rgba(20,40,80,.18);
       display:flex;flex-direction:column;align-items:center;justify-content:center;
       font:600 22px 'Segoe UI';color:#1f2937;gap:10px">
    <div>TOP-LEVEL PROBE</div>
    <div id="hits" style="font:14px monospace;color:#2b6cb0">hits: 0 / moves: 0</div>
  </div>
  <script>
    const { ipcRenderer } = require('electron')
    let hits = 0, moves = 0, dragging = false
    const out = () => { document.getElementById('hits').textContent = 'hits: ' + hits + ' / moves: ' + moves }
    document.getElementById('card').addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      hits++; dragging = true; out()
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) {}
      e.preventDefault()
      ipcRenderer.send('probe-hit', { x: e.screenX, y: e.screenY })
      ipcRenderer.send('probe-drag-start', { x: e.screenX, y: e.screenY })
    })
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return
      moves++; out()
      ipcRenderer.send('probe-drag-move', { x: e.screenX, y: e.screenY })
    })
    window.addEventListener('pointerup', () => {
      if (!dragging) return
      dragging = false
      ipcRenderer.send('probe-drag-end')
    })
    ipcRenderer.send('probe-ready')
  </script>
</body></html>`

  const tmp = path.join(app.getPath('temp'), 'toplevel-bottom-probe.html')
  fs.writeFileSync(tmp, html, 'utf8')

  const win = new BrowserWindow({
    width: 360,
    height: 320,
    x: POS[0],
    y: POS[1],
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    focusable: FOCUSABLE,
    alwaysOnTop: false,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
  })

  require('electron').ipcMain.on('probe-ready', () => log('page-ready'))
  require('electron').ipcMain.on('probe-hit', (e, pos) => log('HIT pointerdown at ' + JSON.stringify(pos)))

  // 拖动：照抄工具箱浮窗的做法 —— 起点缓存**内容矩形**，每帧 setContentBounds 把
  // 宽高一起传回去（只改位置时 Electron 会因帧尺寸重算让窗口越拖越大），松手再补一次
  // setContentSize 兜底。
  let dragOrigin = null // { bx, by, w, h, sx, sy }
  require('electron').ipcMain.on('probe-drag-start', (e, pos) => {
    const b = win.getContentBounds()
    dragOrigin = { bx: b.x, by: b.y, w: b.width, h: b.height, sx: pos.x, sy: pos.y }
    log('drag-start content=' + b.x + ',' + b.y + ' ' + b.width + 'x' + b.height +
      ' mouse=' + Math.round(pos.x) + ',' + Math.round(pos.y))
  })
  require('electron').ipcMain.on('probe-drag-move', (e, pos) => {
    if (!dragOrigin) return
    win.setContentBounds({
      x: Math.round(dragOrigin.bx + (pos.x - dragOrigin.sx)),
      y: Math.round(dragOrigin.by + (pos.y - dragOrigin.sy)),
      width: dragOrigin.w,
      height: dragOrigin.h,
    })
  })
  require('electron').ipcMain.on('probe-drag-end', () => {
    if (!dragOrigin) return
    const b = win.getContentBounds()
    win.setContentSize(dragOrigin.w, dragOrigin.h)
    log('drag-end content=' + b.x + ',' + b.y + ' ' + b.width + 'x' + b.height)
    dragOrigin = null
    // 松手后重新压回「桌面之上、普通窗口之下」
    if (win && !win.isDestroyed()) placeAboveDesktop(hwndOf(win))
  })

  win.webContents.on('console-message', (e) => {
    if (e && e.message) log('[page] ' + String(e.message).slice(0, 200))
  })

  log('window created, loading page')
  const firstPaint = new Promise((resolve) => win.once('ready-to-show', resolve))
  await win.loadFile(tmp)
  log('page loaded')
  await firstPaint
  log('first paint ready')

  const self = hwndOf(win)
  log('self=' + String(self) + ' focusable=' + FOCUSABLE)
  // 顺序很重要：**先成为底层窗口，再显示**。反过来会先以普通顶层窗口浮到最前面闪一下。
  // 不写死等待时间：以「自己是否紧贴 Progman 之上」为准，成立才上屏。
  let placed = false
  for (let i = 0; i < 30; i++) {
    placeAboveDesktop(self)
    if (isJustAboveDesktop(self)) { placed = true; break }
    await new Promise((r) => setTimeout(r, 8))
  }
  log('placedAboveDesktop=' + placed + ' isJustAbove=' + isJustAboveDesktop(self))

  win.showInactive()
  if (!isJustAboveDesktop(self)) {
    // 显示动作可能动过 z 序：再压一次，仍以判定结果为准
    placeAboveDesktop(self)
    log('replaced after show, ok=' + isJustAboveDesktop(self))
  }
  dumpNeighbours(self)

  log('SIT TIGHT for ' + KEEP + 'ms')
  await new Promise((r) => setTimeout(r, KEEP))
  log('done')
  app.exit(0)
})
