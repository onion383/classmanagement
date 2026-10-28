/**
 * 日/夜模式切换耗时探针（真实开发版 + 真实账号）
 * ------------------------------------------------------------
 * 用途：在**真实页面**（表格多的地方）上量切换日/夜的耗时与成本构成，
 *       定位「表格越多越卡」到底卡在哪一段。
 *
 * 做法：
 *   1. 以 INP_DEBUG=1 启动 Electron（开 CDP 9222），自动探测/启动 Vite；
 *   2. 若落在登录页，用 CDP 真实键盘输入账号密码登录（默认 test1314 / test1234）；
 *   3. 逐个路由打开表格页，每页做 N 次日↔夜切换，记录：
 *        - 墙钟（raf2 之间的耗时）
 *        - longtask 条目（主线程长任务）
 *        - CDP Performance.getMetrics 差值：RecalcStyleDuration / LayoutDuration /
 *          TaskDuration / ScriptDuration —— 用来把耗时归到「样式重算 / 布局 / 绘制合成」
 *      另外做两组对照，用来分离两个嫌疑因素：
 *        samebg  —— 切换时不换背景图（仍切 data-mode 与全部夜间配色）
 *        noblur  —— 切之前临时关掉全部 backdrop-filter
 *      若 samebg 后耗时大降 → 主因是「换背景图导致所有毛玻璃图层重新采样」；
 *      若 noblur 后耗时大降 → 主因是毛玻璃图层本身的重采样。
 *
 * 用法：
 *   node testjs/mode-probe.mjs                 # 表格页逐页测量
 *   MODE_PROBE_USER=xx MODE_PROBE_PASS=yy node testjs/mode-probe.mjs
 *   MODE_PROBE_ROUTES=/students,/seats node testjs/mode-probe.mjs
 *   MODE_PROBE_ONESHOT=1 node testjs/mode-probe.mjs
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FRONTEND = path.join(ROOT, 'student-frontend')
// 端口与 electron/main/main.js 的 INP_DEBUG 分支一致（那里 appendSwitch 写死 9222）
const PORT = 9222
const BASE = 'http://127.0.0.1:5173'
const BACKEND = 'http://127.0.0.1:3000'
const CDP_HOST = `127.0.0.1:${PORT}`

const USER = process.env.MODE_PROBE_USER || 'test1314'
const PASS = process.env.MODE_PROBE_PASS || 'test1234'
const ROUTES = (process.env.MODE_PROBE_ROUTES || '/students,/seats,/schedule,/duty,/scores,/').split(',').map(s => s.trim()).filter(Boolean)
const REPEAT = Number(process.env.MODE_PROBE_REPEAT || 5)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- 极简 CDP 客户端
class CDP {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map() }
  _onMessage(raw) {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP ${method} 超时`)) }
      }, 20000)
    })
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error('页面求值异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result?.value
  }
  close() { try { this.ws.close() } catch {} }
}

function rawConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => reject(new Error('WebSocket 连接超时')), 8000)
    ws.onopen = () => {
      clearTimeout(timer)
      const cdp = new CDP(ws)
      ws.onmessage = (ev) => cdp._onMessage(ev.data)
      resolve(cdp)
    }
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error('WebSocket 错误: ' + (e?.message || ''))) }
  })
}

async function listTargets() {
  try {
    const res = await fetch(`http://${CDP_HOST}/json/list`, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}
function pickMainTarget(targets) {
  if (!Array.isArray(targets)) return null
  return targets.find((t) => t.type === 'page' && typeof t.url === 'string'
    && t.url.startsWith(BASE) && !t.url.includes('.html')) || null
}
async function waitForMainTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const t = pickMainTarget(await listTargets())
    if (t && t.webSocketDebuggerUrl) return t
    await sleep(300)
  }
  return null
}
function probe(url, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => { res.resume(); resolve(true) })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}
async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe(url)) return true
    await sleep(250)
  }
  return false
}
async function waitForExpr(cdp, expr, ok, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if (ok(await cdp.eval(expr))) return true } catch {}
    await sleep(200)
  }
  return false
}

// ---------------------------------------------------------------- 页面内注入
const INJECT = `
(() => {
  if (window.__modeProbe) return true;
  const raf2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const longTasks = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.entries()) longTasks.push(Math.round(e.duration)) })
      .observe({ type: 'longtask', buffered: true });
  } catch (_) {}

  // 页面概况：DOM 规模、表格数、毛玻璃图层数与总面积
  window.__mpInfo = () => {
    const glass = [...document.querySelectorAll('*')].filter((e) => {
      const v = getComputedStyle(e).backdropFilter;
      return v && v !== 'none';
    });
    let area = 0;
    for (const e of glass) { const r = e.getBoundingClientRect(); area += r.width * r.height; }
    return {
      path: location.pathname,
      theme: document.documentElement.dataset.theme,
      mode: document.documentElement.dataset.mode,
      dom: document.querySelectorAll('*').length,
      dtRows: document.querySelectorAll('.dynamic-table tbody tr').length,
      dtCells: document.querySelectorAll('.dynamic-table tbody td').length,
      gvCells: document.querySelectorAll('.grid-view-container tbody td').length,
      glassEls: glass.length,
      glassAreaPct: Math.round(100 * area / (innerWidth * innerHeight)),
      hasBg: document.documentElement.classList.contains('has-bg-image'),
    };
  };

  // 切一次模式。opts:
  //   samebg —— 不换背景图（只切 data-mode + bg-night-default 类）
  //   noblur —— 切之前把所有 backdrop-filter 关掉（用 important 覆盖，压过主题规则）
  window.__mpSwitch = async (to, opts = {}) => {
    const root = document.documentElement;
    if (opts.noblur && !document.getElementById('mp-noblur')) {
      const s = document.createElement('style');
      s.id = 'mp-noblur';
      s.textContent = '*{backdrop-filter:none !important;-webkit-backdrop-filter:none !important}';
      document.head.appendChild(s);
      await raf2();
    }
    const t0 = performance.now();
    root.dataset.mode = to;
    if (!opts.samebg) {
      const bg = to === 'night' ? 'glass-bg-night.webp' : 'glass-bg-opt.webp';
      root.style.setProperty('--bg-image', "url('" + new URL(bg, location.href).href + "')");
    }
    root.classList.toggle('bg-night-default', to === 'night');
    await raf2();
    return Math.round(performance.now() - t0);
  };

  window.__mpLongTasks = () => longTasks.slice();
  window.__mpResetLongTasks = () => { longTasks.length = 0 };
  window.__mpMode = () => document.documentElement.dataset.mode;
  window.__mpRestoreBlur = () => {
    const s = document.getElementById('mp-noblur');
    if (s) s.remove();
  };

  // 消融：把「夜间规则」按关键词整块禁用/恢复，用来定位到底是哪部分规则在吃时间。
  // dev 下主题 CSS 由 JS 动态 import 注入成 <style>，可直接找到并改 textContent。
  // mode: 'all' 禁用全部夜间规则 | 'tables' 只禁用涉及表格的 | 'none' 全部恢复
  const RULE_RE = /[^}]*\\{[^}]*\\}/g;
  window.__mpAblate = (mode) => {
    for (const st of document.querySelectorAll('style')) {
      const txt = st.textContent || '';
      if (!txt.includes('[data-mode="night"]')) continue;
      if (!st.dataset.mpOrig) st.dataset.mpOrig = txt;
      const orig = st.dataset.mpOrig;
      if (mode === 'none') { st.textContent = orig; continue; }
      if (mode === 'all') { st.textContent = ''; continue; }
      if (mode === 'tables') {
        st.textContent = orig.replace(RULE_RE, (rule) => (/table|grid-view|tbody|thead/.test(rule) ? '' : rule));
      }
    }
    return true;
  };
  window.__mpNightRuleCount = () => {
    let n = 0;
    for (const st of document.querySelectorAll('style')) {
      const txt = st.textContent || '';
      if (!txt.includes('[data-mode="night"]')) continue;
      n += (txt.match(RULE_RE) || []).length;
    }
    return n;
  };
  window.__modeProbe = true;
  return true;
})()
`

// ---------------------------------------------------------------- 登录
async function loginIfNeeded(cdp) {
  const onLogin = await cdp.eval(`!!document.querySelector('input[placeholder="账号"]')`).catch(() => false)
  if (!onLogin) return { loggedIn: false, reason: '已是登录态' }

  console.log(`[mode] 落在登录页，用 ${USER} 登录…`)
  // 用原生 setter 写值并派发 input，让 Vue 的 v-model 收到（直接改 .value 不触发）
  await cdp.eval(`(() => {
    const setV = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inputs = [...document.querySelectorAll('form input')];
    setV(inputs.find(i => i.placeholder === '账号'), ${JSON.stringify(USER)});
    setV(inputs.find(i => i.type === 'password'), ${JSON.stringify(PASS)});
    return true;
  })()`)
  await sleep(200)
  await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll('form button[type=submit]')][0];
    if (!btn) throw new Error('找不到登录按钮');
    btn.click();
    return true;
  })()`)
  const ok = await waitForExpr(cdp, `!!localStorage.getItem('token')`, (v) => v === true, 15000)
  if (!ok) throw new Error('登录失败：15s 内未拿到 token')
  await sleep(1500)
  return { loggedIn: true }
}

// ---------------------------------------------------------------- 指标抓取
const METRIC_KEYS = ['RecalcStyleDuration', 'LayoutDuration', 'TaskDuration', 'ScriptDuration']
async function metrics(cdp) {
  const r = await cdp.send('Performance.getMetrics')
  const m = {}
  for (const x of r.metrics || []) if (METRIC_KEYS.includes(x.name)) m[x.name] = x.value
  return m
}
function diff(a, b) {
  const d = {}
  for (const k of METRIC_KEYS) d[k] = Math.round(((b[k] || 0) - (a[k] || 0)) * 1000)
  return d
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0 }

// ---------------------------------------------------------------- 单页测量
async function measureOnPage(cdp, label, opts, repeat) {
  const wall = [], mt = []
  for (let i = 0; i < repeat; i++) {
    const to = (await cdp.eval(`window.__mpMode()`)) === 'night' ? 'day' : 'night'
    await cdp.eval(`window.__mpResetLongTasks()`)
    const before = await metrics(cdp)
    const w = await cdp.eval(`window.__mpSwitch(${JSON.stringify(to)}, ${JSON.stringify(opts)})`)
    await sleep(60)
    const after = await metrics(cdp)
    wall.push(w)
    mt.push(diff(before, after))
    await sleep(180)
  }
  const lt = await cdp.eval(`window.__mpLongTasks()`)
  return {
    label, opts,
    wallMedian: median(wall),
    wallAll: wall,
    styleMedian: median(mt.map((m) => m.RecalcStyleDuration)),
    layoutMedian: median(mt.map((m) => m.LayoutDuration)),
    taskMedian: median(mt.map((m) => m.TaskDuration)),
    longTasks: lt,
  }
}

async function runOnRoute(cdp, route, repeat) {
  console.log(`\n[mode] ==== ${route} ====`)
  await cdp.send('Page.navigate', { url: BASE + route })
  await waitForExpr(cdp, `document.readyState`, (v) => v === 'complete', 20000)
  // 等表格数据真正渲染出来：只等 2s 会测到空表（空表没有单元格，结论会失真）
  const gotData = await waitForExpr(cdp,
    `document.querySelectorAll('.dynamic-table tbody tr').length + document.querySelectorAll('.grid-view-container tbody td').length`,
    (v) => v > 0, 15000)
  if (!gotData) console.log('[mode] ⚠ 15s 内表格没有数据，按空表测量')
  // 诊断：为什么没数据（停在占位页？被重定向？没登录？）
  console.log('[mode] 诊断:', JSON.stringify(await cdp.eval(`(() => ({
    href: location.href,
    title: document.title,
    appChildren: document.querySelector('#app')?.children.length ?? -1,
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 120),
    hasToken: !!localStorage.getItem('token'),
    user: (localStorage.getItem('currentUser') || '').slice(0, 60),
    html: document.documentElement.outerHTML.length,
  }))()`).catch((e) => ({ err: String(e.message) }))))
  await sleep(1200)
  await cdp.eval(INJECT)
  const info = await cdp.eval('window.__mpInfo()')
  console.log('[mode] 页面概况:', JSON.stringify(info))
  if (!info.hasBg) console.log('[mode] ⚠ 当前主题没有背景图，本页测不出「换背景图」的影响')

  const base = await measureOnPage(cdp, '正常切换', {}, repeat)
  console.log('[mode] 正常切换:', JSON.stringify(base))

  const samebg = await measureOnPage(cdp, '不换背景图', { samebg: true }, repeat)
  console.log('[mode] 不换背景图:', JSON.stringify(samebg))

  await cdp.eval('window.__mpRestoreBlur()')
  await sleep(300)
  const noblur = await measureOnPage(cdp, '关掉毛玻璃', { noblur: true }, repeat)
  console.log('[mode] 关掉毛玻璃:', JSON.stringify(noblur))
  await cdp.eval('window.__mpRestoreBlur()')
  await sleep(300)

  // 消融：分别禁掉「表格相关夜间规则」和「全部夜间规则」，看样式重算下降多少
  const nightRules = await cdp.eval('window.__mpNightRuleCount()')
  await cdp.eval(`window.__mpAblate('tables')`)
  await sleep(500)
  const ablTables = await measureOnPage(cdp, '禁用表格夜间规则', {}, repeat)
  console.log('[mode] 禁用表格夜间规则:', JSON.stringify(ablTables))

  await cdp.eval(`window.__mpAblate('all')`)
  await sleep(500)
  const ablAll = await measureOnPage(cdp, '禁用全部夜间规则', {}, repeat)
  console.log('[mode] 禁用全部夜间规则:', JSON.stringify(ablAll))

  await cdp.eval(`window.__mpAblate('none')`)
  await sleep(500)

  return { route, info, base, samebg, noblur, nightRules, ablTables, ablAll }
}

// ---------------------------------------------------------------- 启动
// 本脚本可能自行拉起 Vite：保留句柄并在退出时清理，避免 dev server 残留占用端口。
let viteChild = null
function stopVite() {
  if (!viteChild || viteChild.killed) return
  const pid = viteChild.pid
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-pid, 'SIGTERM')
  } catch (_) {
    try { viteChild.kill() } catch (_) {}
  }
  viteChild = null
}
process.on('exit', stopVite)
process.on('SIGINT', () => { stopVite(); process.exit(130) })
process.on('SIGTERM', () => { stopVite(); process.exit(143) })

async function ensureRunner() {
  // 已有实例（调试口已开）就直接复用，不重复启动（单实例锁 + 僵尸进程问题）
  if (await waitForMainTarget(1500)) return { launched: false }
  if (!(await probe(`${BASE}/`))) {
    console.log('[mode] Vite 未就绪，启动开发服务器…')
    viteChild = spawn('npm', ['run', 'dev'], {
      cwd: FRONTEND,
      stdio: 'inherit',
      shell: true,
      detached: process.platform !== 'win32',
    })
    if (!(await waitForHttp(`${BASE}/`, 40000))) throw new Error('Vite 开发服务器 40s 内未就绪')
  } else console.log('[mode] Vite 已在运行')

  const electronPath = require('electron')
  const child = spawn(electronPath, ['.', '--no-sandbox', '--disable-gpu-sandbox', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'], {
    cwd: ROOT,
    env: { ...process.env, INP_DEBUG: '1', FORCE_SETUP: '0' },
    stdio: 'inherit',
  })
  child.on('exit', (code) => console.log(`[mode] Electron 退出（code=${code}）`))
  return { launched: true, child }
}

function report(rows) {
  console.log('\n================ 日/夜切换耗时汇总（真实页面）================')
  console.log('页面    元素  表格格  毛玻璃  | 正常  不换图  关毛玻璃 | 禁表格规则 禁全部规则 | 样式重算')
  for (const r of rows) {
    const i = r.info
    const cells = i.dtCells || i.gvCells
    console.log(
      `${(i.path || '/').padEnd(7)}${String(i.dom).padStart(5)}${String(cells).padStart(6)}${String(i.glassEls).padStart(7)}  |` +
      `${String(r.base.wallMedian).padStart(5)}ms${String(r.samebg.wallMedian).padStart(6)}ms${String(r.noblur.wallMedian).padStart(7)}ms |` +
      `${String(r.ablTables?.wallMedian ?? '-').padStart(8)}ms${String(r.ablAll?.wallMedian ?? '-').padStart(8)}ms |` +
      `${String(r.base.styleMedian).padStart(6)}ms`)
  }
  console.log('\n读法：')
  console.log('  · 「样式重算」高 → 切 data-mode 让浏览器重算了大量元素的样式（与表格元素数正相关）')
  console.log('  · 「禁表格规则」大幅下降 → 表格相关的夜间 CSS 规则是主因')
  console.log('  · 「禁全部规则」大幅下降 → 全部夜间规则都是主因（与表格无关的部分也很贵）')
}

async function main() {
  const { child } = await ensureRunner()
  const target = await Promise.race([
    waitForMainTarget(60000),
    new Promise((_, rej) => { if (child) child.once('exit', (c) => rej(new Error(`Electron 启动后立即退出（code=${c}）：可能已有实例占用单实例锁`))) }),
  ])
  if (!target) throw new Error('60s 内未发现主窗口调试目标')
  const cdp = await rawConnect(target.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Performance.enable')

  console.log('[mode] 等待后端就绪…')
  if (!(await waitForHttp(`${BACKEND}/`, 20000))) console.log('[mode] ⚠ 后端 20s 内未就绪')

  await cdp.send('Page.navigate', { url: BASE + '/' })
  await waitForExpr(cdp, `document.readyState`, (v) => v === 'complete', 20000)
  await sleep(2500)
  console.log('[mode] 登录:', JSON.stringify(await loginIfNeeded(cdp)))

  const rows = []
  for (const route of ROUTES) rows.push(await runOnRoute(cdp, route, REPEAT))
  report(rows)

  if (process.env.MODE_PROBE_ONESHOT) {
    cdp.close()
    if (child) child.kill()
    stopVite()
    process.exit(0)
  }
  console.log('\n[mode] 测量结束。窗口保持打开，可自行再操作；Ctrl+C 退出脚本。')
}

main().catch((e) => { console.error('[mode] 失败:', e.message); process.exit(1) })
