// =========================================================================
// scanWorker.js —— 主进程侧的扫描子进程管理器（2026-10-22）
//
// 职责：懒启动 worker.scan.js、派活（start/pause/stop/resume）、收报活（progress/thumbs/done）、
//       转发补图需求（demand）、空闲退出、崩溃重建。主进程自身**不跑扫描**，
//       只跑 HTTP 接口与「少量补图」。
//
// 生命周期：
//   · 懒启动：第一个扫描请求才 fork（跟启动抢 CPU/IO 的事不做）
//   · 空闲退出：最后一次派活后 SCAN_WORKER_IDLE_MS 内没有新活 → 发 shutdown 让它退出
//   · 崩溃重建：worker 意外退出后，主进程延迟 SCAN_WORKER_RESTART_MS 重建（限流防抖动）
//
// 为什么不直接 exit()：worker 是异步执行扫描的，kill 掉会留下「半截事务」。
// 所以走 shutdown 消息，让它自己跑完当前这批再退出。
//
// 状态真源：库表 album_scan_tasks（跨进程共享，pause/stop 写表，子进程在检查点读表）。
// 本文件的 active 只是**主进程视角的「我派出去的活」**（含进度缓存），
// 用来回答 /status 与 /tasks；子进程崩了、或者主进程重启，active 都会清空，
// 所以不会把「上次残留的断点」误报成「正在扫描」。
// =========================================================================

const path = require('path');
const { fork } = require('child_process');
const dbManager = require('./dbManager/dbManager');
const albumThumbs = require('./albumThumbs');
const albumScan = require('./albumScan');

// worker 路径：本文件同级
const WORKER_PATH = path.join(__dirname, 'worker.scan.js');

// 空闲多久后让 worker 退出（毫秒）。扫描通常连续进行，不会在中途触发；
// 用户扫完就走的话，一分钟后自动回收这个进程。
const SCAN_WORKER_IDLE_MS = 60000;
// worker 崩溃后多久重建（毫秒）。给一点延迟，避免连续崩溃时疯狂 fork。
const SCAN_WORKER_RESTART_MS = 1200;
// 每分钟最多重建几次，防止 worker 反复崩溃把 CPU 全烧在重启上。
const RESTART_LIMIT_PER_MIN = 6;

let child = null;             // 当前 worker 进程
let idleTimer = null;         // 空闲退出定时器
let restartTimer = null;      // 崩溃重建定时器
// 「这个 worker 是我们主动叫它退的」标志。
// 为什么需要：主动 shutdown 走 child.kill() 时，Windows 上 exit 回调拿到的是
// code=null + signal=SIGTERM，与崩溃长得一模一样 → 被当成崩溃去 scheduleRestart。
// 而主进程正准备退出时，重建出来的 worker 没人管，就成了一个永不退出的孤儿进程
//（继续扫库写库、占磁盘 IO，而前端已显示「后端已关闭」）。
let expectExit = false;

// albumId → true：本进程已派活出去、正在跑的扫描。
// 只用于「同相册不重复起」（真正跨进程的状态真源在 album_scan_tasks 表）。
const dispatched = new Map();

// albumId → 任务视图（主进程视角）：进度缓存 + 暂停/取消标记。
// 由派活时创建、progress 消息更新、done/error/worker 退出时清除。
const active = new Map();

// 「子进程把这批缩略图生成好了」的回调（供 album.js 清掉自己的待生成集合）。
let thumbGeneratedListener = null;
function onThumbGenerated(fn) {
  thumbGeneratedListener = fn;
}

// ---- worker 启动 ----
function spawnWorker() {
  if (child) return child;
  clearTimeout(restartTimer);
  restartTimer = null;
  expectExit = false;

  // fork 时继承主进程 env：DATA_DIR / DB_MASTER_KEY / ALBUM_THUMBS_DIR 等主进程已注入，
  // worker 需要它们来定位库文件与缩略图目录，所以不能另起 env。
  child = fork(WORKER_PATH, [], {
    env: { ...process.env },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const proc = child;

  child.on('message', onWorkerMessage);
  child.on('error', (err) => {
    console.error('[scanWorker] worker error:', err && err.message);
  });
  child.on('exit', (code, signal) => {
    // 可能已经有人接替它了（shutdown 之后又派活 → spawnWorker 建了新 child）：
    // 这时**不能**动 child/active，否则会把新 worker 的派活记录一起清掉。
    if (child !== proc) return;
    // 清掉派活记录：worker 挂了，正在跑的扫描自然也不跑了，
    // 主进程不能继续以为它们还活着（否则 /status 永远报 scanning:true）。
    dispatched.clear();
    active.clear();
    const wanted = expectExit;
    child = null;
    expectExit = false;
    // 主动叫退（空闲退出 / shutdown / 进程退出）不算崩溃，不重建。
    // 注意光看 code===0 不够：Windows 上 child.kill() 得到的是 code=null + signal='SIGTERM'。
    if (wanted || code === 0) return;
    // 非零退出 = 崩溃，延迟重建（限流）
    console.warn(`[scanWorker] worker 异常退出 code=${code} signal=${signal}，准备重建`);
    scheduleRestart();
  });

  return child;
}

function scheduleRestart() {
  const nowTs = Date.now();
  restartWindow = restartWindow.filter(t => nowTs - t < 60000);
  restartWindow.push(nowTs);
  if (restartWindow.length > RESTART_LIMIT_PER_MIN) {
    console.error('[scanWorker] worker 一分钟内崩溃超过 ' + RESTART_LIMIT_PER_MIN + ' 次，暂不重建（等下次业务请求再拉起）');
    return;
  }
  restartTimer = setTimeout(() => {
    if (child) return;         // 已经有人在跑就不重复起
    spawnWorker();
  }, SCAN_WORKER_RESTART_MS);
}
let restartWindow = [];

function onWorkerMessage(msg) {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'ready':
      break;
    case 'progress': {
      // 进度真源本来就是库表 album_scan_tasks（/status 读表），这里只更新一个内存计数
      // 供 /status 与 /tasks 快速展示用；不必每次都发事件到渲染进程（前端自己会轮询 /status）。
      const t = active.get(msg.albumId);
      if (t) {
        t.scanned = msg.scanned || 0;
        t.total = msg.total || 0;
      }
      break;
    }
    case 'thumbs':
      // worker 生成了一批缩略图 → 主进程预热内存索引，
      // 这样前端请求这些图时直接零磁盘 IO 命中（否则要走异步读盘，慢约 10 倍）。
      if (Array.isArray(msg.entries)) {
        for (const [photoId, thumbPath] of msg.entries) {
          albumThumbs.rememberThumb(msg.slug, photoId, thumbPath, albumScan.THUMB_VERSION, null);
        }
        // 通知调用方（album.js）：这批 id 不用再排��了
        if (thumbGeneratedListener) {
          try { thumbGeneratedListener(msg.entries.map(e => e[0])); } catch (_) {}
        }
      }
      break;
    case 'done':
      dispatched.delete(msg.albumId);
      active.delete(msg.albumId);
      scheduleIdleShutdown();
      break;
    case 'demand-done':
      // 补图需求处理完毕（可能还有下一批），重新开始计空闲
      scheduleIdleShutdown();
      break;
    case 'error':
      dispatched.delete(msg.albumId);
      active.delete(msg.albumId);
      console.error('[scanWorker] 扫描出错:', msg.message);
      scheduleIdleShutdown();
      break;
  }
}

function scheduleIdleShutdown() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    // 没活了就让 worker 自己收工退出
    if (dispatched.size === 0 && child) {
      expectExit = true;   // 别把这次主动退出当成崩溃去重建
      try { child.send({ cmd: 'shutdown' }); } catch (_) {}
    }
  }, SCAN_WORKER_IDLE_MS);
}

// ---- 对外接口 ----

// 生成一次扫描的**归属标识**（token）。
// 为什么要它：album_scan_tasks 一行只代表「当前这次扫描」，主进程与子进程都会写它。
//   · 主进程派活时写 state=running + token；
//   · 子进程只按 token 推进断点（不会被主进程后来写的 cancelled/paused 覆盖回去，
//     也不会把「新扫描刚写的行」当成自己的而删掉）。
// 取 Date.now() + 递增序号：同一毫秒内派两个任务也不会撞（毫秒值远小于 SQLite 64 位整数上限）。
let tokenSeq = 0;
function nextToken() {
  tokenSeq = (tokenSeq + 1) % 1000;
  return Date.now() * 1000 + tokenSeq;
}

// 在当前请求绑定的库上写好扫描任务行（拿不到连接就跳过 —— IPC 那条路仍然能跑，
// 只是失去跨进程真源，停止/暂停改回纯 IPC 通知）。
function claimTask(albumId, mode, token, resumeFrom) {
  const c = safeCurrentConn();
  if (!c) return false;
  try { albumScan.claimScanTask(c, albumId, mode, token, resumeFrom); return true; } catch (_) { return false; }
}

// 派一个扫描任务给 worker。返回 true 表示已派出。
function dispatchScan(slug, albumId, mode, resumeFrom) {
  // 同相册不重复起
  if (dispatched.has(albumId)) return false;
  if (!child) spawnWorker();
  // 取消空闲退出（又开始干活了）
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  dispatched.set(albumId, true);
  const token = nextToken();
  active.set(albumId, {
    albumId,
    slug,
    token,
    mode: mode || 'incremental',
    scanned: 0,
    total: 0,
    startedAt: new Date().toISOString(),
    paused: false,
    cancelled: false,
  });
  // 派活的**瞬间**就把这一行写好（含 token 与 state=running）。
  // 这一行是跨进程真源：子进程只按 token 推进断点，不会重写 state，
  // 因此用户随后点的暂停/停止不会被子进程顺手抹掉。
  claimTask(albumId, mode || 'incremental', token, resumeFrom || '');
  try {
    child.send({ cmd: 'start', slug, albumId, token, mode: mode || 'incremental', resumeFrom: resumeFrom || '', dbKey: dbManager.getUnlockedKey(slug) });
  } catch (_) {
    dispatched.delete(albumId);
    active.delete(albumId);
    return false;
  }
  return true;
}

// 派一批续扫任务（断点续扫）。
function dispatchResume(tasks) {
  if (!tasks || !tasks.length) return 0;
  const list = tasks.filter(t => !dispatched.has(t.albumId));
  if (!list.length) return 0;
  if (!child) spawnWorker();
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  for (const t of list) {
    dispatched.set(t.albumId, true);
    // 续扫同样换新 token：这是一次新的扫描归属，断点（done_path）保留。
    const token = nextToken();
    claimTask(t.albumId, t.mode || 'incremental', token, t.donePath || '');
    active.set(t.albumId, {
      albumId: t.albumId,
      slug: t.slug,
      token,
      mode: t.mode || 'incremental',
      scanned: t.scanned || 0,
      total: t.total || 0,
      startedAt: new Date().toISOString(),
      paused: false,
      cancelled: false,
    });
    t.token = token;
  }
  try {
    child.send({ cmd: 'resume', tasks: list.map(t => ({
      slug: t.slug, albumId: t.albumId, token: t.token, mode: t.mode || 'incremental', resumeFrom: t.donePath || '',
      dbKey: dbManager.getUnlockedKey(t.slug),
    })) });
    return list.length;
  } catch (_) {
    for (const t of list) { dispatched.delete(t.albumId); active.delete(t.albumId); }
    return 0;
  }
}

// 请求停止：既发 IPC（快速），也改库里的 state（跨进程真源，双保险）。
// conn 可选：调用方能给出当前请求的连接就给出（避免依赖 ALS 上下文）；
// 拿不到就退回 dbManager.current()，再拿不到就跳过（IPC 那条路仍然有效）。
function requestStop(slug, albumId, conn) {
  const token = (active.get(albumId) || {}).token || 0;
  if (child) { try { child.send({ cmd: 'stop', slug, albumId, token }); } catch (_) {} }
  const c = conn || safeCurrentConn();
  if (c) {
    try {
      // 写库 state=cancelled（带 token 限定，别把别的那次扫描的状态搅乱）
      albumScan.setScanState(c, albumId, 'cancelled', token);
      // 用户主动停止 = 放弃，不再续扫。
      // 这里**必须**带 token：上一次扫描的收尾也会删这行，
      // 不限定归属就会把「刚派出去的新扫描」的行一起删掉。
      albumScan.persistScanClear(c, albumId, token);
    } catch (_) { /* 未登录/连接不可用等场景忽略，IPC 那条路仍然有效 */ }
  }
  dispatched.delete(albumId);
  const t = active.get(albumId);
  if (t) t.cancelled = true;
}

// 设置暂停/继续。
function requestPause(slug, albumId, paused, conn) {
  const token = (active.get(albumId) || {}).token || 0;
  if (child) { try { child.send({ cmd: 'pause', slug, albumId, token, paused: !!paused }); } catch (_) {} }
  const c = conn || safeCurrentConn();
  if (c) {
    try { albumScan.setScanState(c, albumId, paused ? 'paused' : 'running', token); } catch (_) {}
  }
  const t = active.get(albumId);
  if (t) t.paused = !!paused;
}

// 取当前请求绑定的库连接；没有绑定就返回 null（不抛，避免影响主流程）。
function safeCurrentConn() {
  try { return dbManager.current(); } catch (_) { return null; }
}

// 把「缺缩略图」的需求转给子进程生成。
//
// 分工（用户拍板）：主进程只做**少量**补齐（配额闸 ON_DEMAND_LIMIT），
// 超过一定数量就丢给子进程 —— 免得主进程被批量请求拖慢。
// 子进程有独立的 libuv 线程池，生成这些图不影响主进程的其他接口。
function forwardDemand(slug, ids) {
  if (!ids || !ids.length) return 0;
  if (!child) spawnWorker();
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  try {
    child.send({ cmd: 'demand', slug, ids: ids.slice(0, 500), dbKey: dbManager.getUnlockedKey(slug) });
    return ids.length;
  } catch (_) {
    return 0;
  }
}

// 是否真的在跑这个相册（内存记录，仅主进程视角）。
function isDispatched(albumId) {
  return dispatched.has(albumId);
}

// 主进程视角的任务列表（给 /status 与 /tasks 用）。
function listActive() {
  return Array.from(active.values());
}

function getActive(albumId) {
  return active.get(albumId) || null;
}

// 主动关闭 worker（软件退出时用）。
function shutdown() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (child) {
    expectExit = true;   // 主动退出，别触发崩溃重建
    try { child.send({ cmd: 'shutdown' }); } catch (_) {}
    // 兜底：给 2 秒还不走就强杀
    const dying = child;
    setTimeout(() => {
      try { dying.kill(); } catch (_) {}
    }, 2000).unref?.();
    child = null;
  }
  dispatched.clear();
  active.clear();
}

// 立刻杀掉 worker（不给它收工的机会），走崩溃重建路径。
// 用于「模拟进程被杀」的测试与紧急止损（用户点了停止但子进程不响应时）。
// 与 shutdown 的区别：不发 shutdown、不置 expectExit —— 就是当作崩溃处理，
// 库表里的断点记录会留下来，可供 /tasks/resume 续扫（这正是「被杀」应有的结果）。
function killNow() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (child) {
    try { child.kill(); } catch (_) {}
    child = null;
  }
  dispatched.clear();
  active.clear();
}

// 登出时通知子进程关闭该库的连接并丢弃钥匙（隐私模式下钥匙不能留驻）
function lockDb(slug) {
  if (!slug || !child) return;
  try { child.send({ cmd: 'lock', slug }); } catch (_) { /* 子进程已退出 */ }
}

module.exports = {
  dispatchScan, dispatchResume, requestStop, requestPause,
  forwardDemand, onThumbGenerated, lockDb,
  isDispatched, listActive, getActive, shutdown, killNow,
};
