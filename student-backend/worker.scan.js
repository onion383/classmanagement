// =========================================================================
// worker.scan.js —— 相册扫描子进程（2026-10-22）
//
// 为什么独立进程：扫描要跑 sharp（占满 libuv 线程池）+ 大量磁盘 IO。
// 与 HTTP 接口同进程时，其他接口的异步 fs 只能排队，表现为「一扫描全站变慢」。
// 独立进程有自己��� libuv 线程池 / V8 堆 / GC，主进程完全不受影响。
//
// 注意：这里**不用 worker_threads** —— libuv 线程池是进程级全局静态，
// 所有 Worker 共用同一个池子，Worker 只能隔离 V8 堆与 JS CPU，
// 而sharp 的解码/重采样全在原生线程池上。只有独立进程才能隔离它。
//
// 协议（主进程 ⇄ 子进程，全部经 process.send / process.on('message')）：
//   主 → 子  { cmd:'start',  slug, albumId, token, mode, resumeFrom }
//           { cmd:'stop',   slug, albumId, token }
//           { cmd:'resume', tasks:[{slug,albumId,token,mode,resumeFrom}] }
//           { cmd:'demand', slug, ids:[photoId,...] }  // 主进程配额闸放不下的补图需求
//           { cmd:'shutdown' }
//   子 → 主  { type:'ready' }
//           { type:'progress', slug, albumId, scanned, total }
//           { type:'thumbs',  slug, entries:[[photoId, thumbPath], ...] }  // 预热主进程缩略图索引
//           { type:'demand-done', slug, count }
//           { type:'done',    slug, albumId }
//           { type:'error',   slug, albumId, message }
//
// 状态真源在库表 album_scan_tasks（跨进程共享），IPC 只承载「派活/报活」，
// 这样即便 IPC 短暂不可用，暂停/停止/断点也不会丢（主进程改 state，子进程在检查点读表）。
//
// 启动：懒启动（第一个扫描请求才 fork），主进程跑完一段时间后会发 shutdown 让它退出。
// =========================================================================

const dbManager = require('./dbManager/dbManager');
const albumScan = require('./albumScan');

// slug → conn：每个库在本进程里各开一个独立连接。
// 不用 withDb —— 那是给「请求上下文 ALS」用的（靠 auth 中间件写入 slug），子进程没有请求。
// 直接 openFile 开自己的连接；WAL 下读写不互斥，与主进程各写各的。
const openConns = new Map();
// 超级隐私模式：主进程在派活消息里带上本次登录解锁的库钥匙（仅进程间 IPC，不落盘），
// 子进程没有请求上下文，只能靠它开库；未带钥匙且受保护时直接放弃本次扫描。
const keyCache = new Map();
function connFor(slug) {
  let conn = openConns.get(slug);
  if (conn) return conn;
  const reg = dbManager.registryFindBySlug(slug);
  if (!reg) return null;
  const encrypted = reg.encrypted !== 0;
  if (reg.protect === 1 && !keyCache.has(slug)) return null;
  const passphrase = encrypted
    ? (keyCache.get(slug) || dbManager.unwrapKey(reg.wrapped_key))
    : null;
  conn = dbManager.openFile(dbManager.dbFilePath(slug), passphrase, encrypted);
  openConns.set(slug, conn);
  return conn;
}

function send(msg) {
  try { if (process.send) process.send(msg); } catch (_) { /* 父进程已断开 */ }
}

// 已生成的缩略图攒一批就报给主进程（让它预热内存索引，避免首屏走磁盘读）
const THUMB_REPORT_BATCH = 50;
let thumbReport = [];
function reportThumb(slug, photoId, thumbPath) {
  thumbReport.push([photoId, thumbPath]);
  if (thumbReport.length >= THUMB_REPORT_BATCH) flushThumbs(slug);
}
function flushThumbs(slug) {
  if (!thumbReport.length) return;
  send({ type: 'thumbs', slug, entries: thumbReport });
  thumbReport = [];
}

// 正在跑的任务：albumId → task（本地标志，用于快速响应 stop 指令）
const running = new Map();

// 「已请求停止但任务还没注册」的 albumId 集合。
//
// 为什么需要：用户在扫描刚派出去、子进程还没跑起 runScan 的那一小段窗口里点了停止，
// 此时 running 里还没有这个任务，stop 指令会被「丢弃」——
// 而库表通路此时也已被主进程的 claimScanTask 写好（state=cancelled），子进程进 runScan
// 后第一次检查点读到 cancelled 会自行收工。
// 但主进程可能拿不到连接（未登录/上下文缺失）而只发了 IPC，所以这里仍记一份，双保险。
// 结果就是：用户以为停了，扫描其实继续跑完。
// 这里先记下来，runScan 开头检查一次，把「早到的停止」补上。
const pendingStops = new Set();

// ---- 补图需求队列（主进程配额闸放不下的那些 id 丢过来）----
//
// 为什么在子进程里补：主进程的一次批量请求可能缺几十上百张缩略图，
// 让主进程自己生成会占满它的 libuv 线程池，其他接口就慢了。
// 子进程有独立的线程池，生成这些图对主进程毫无影响。
//
// 需求串行处理：一次只处理一批（DEMAND_BATCH），别跟扫描主流程抢同一个进程的资源。
const DEMAND_BATCH = 8;
const demandQueue = [];
let demandBusy = false;

async function runDemand() {
  if (demandBusy) return;
  demandBusy = true;
  try {
    while (demandQueue.length) {
      // 按 slug 分组：不同库的 id 不能混在一批里查（album_photos.id 各库独立自增）
      const slug = demandQueue[0].slug;
      const batch = [];
      while (demandQueue.length && demandQueue[0].slug === slug && batch.length < DEMAND_BATCH) {
        batch.push(demandQueue.shift().id);
      }
      const conn = connFor(slug);
      if (conn) {
        // 生成 + 写库都在子进程做（主进程不碰这些行的写）
        await albumScan.genThumbsByIds(conn, batch, slug, (photoId, thumbPath) => {
          reportThumb(slug, photoId, thumbPath);
        });
      }
      flushThumbs(slug);
      send({ type: 'demand-done', slug, count: batch.length });
    }
  } catch (err) {
    send({ type: 'error', slug: '', albumId: 0, message: err && err.message });
  } finally {
    demandBusy = false;
  }
}

async function runScan(slug, albumId, mode, resumeFrom, token) {
  const conn = connFor(slug);
  if (!conn) {
    send({ type: 'error', slug, albumId, message: '库不存在或无法打开' });
    return;
  }
  // 同一相册已在跑就不再重复起（主进程已防，这里再兜一层）
  if (running.has(albumId)) return;
  // token = 本次扫描的归属标识（主进程派活时生成并已写库）。
  // 所有推进断点的写操作都带它，就不会误改/误删「别的那一次扫描」的行。
  const task = albumScan.newTask(mode, token);
  running.set(albumId, task);

  // 补上「早到的停止」：用户在任务注册前就点了停止，这里直接收工。
  if (pendingStops.has(albumId)) {
    pendingStops.delete(albumId);
    task.cancelled = true;
  }

  const onProgress = (t) => {
    flushThumbs(slug);
    send({ type: 'progress', slug, albumId, scanned: t.scanned, total: t.total });
  };

  try {
    // 三种模式：full=清空重建、incremental=按文件夹增量、virtual=只按已有索引刷新。
    // 虚拟相册没有文件夹，走第三条路（不遍历磁盘、不增删行，只更新字段与缩略图）。
    if (mode === 'virtual') await albumScan.refreshVirtual(conn, albumId, resumeFrom, slug, onProgress, token);
    else if (mode === 'full') await albumScan.fullScan(conn, albumId, resumeFrom, slug, onProgress, token);
    else await albumScan.incrementalScan(conn, albumId, resumeFrom, slug, onProgress, token);
    flushThumbs(slug);
    send({ type: 'done', slug, albumId });
  } catch (err) {
    flushThumbs(slug);
    send({ type: 'error', slug, albumId, message: err && err.message });
  } finally {
    running.delete(albumId);
  }
}

process.on('message', async (msg) => {
  if (!msg || !msg.cmd) return;
  // 任何派活消息携带的库钥匙都先记下（同一库钥匙在会话内恒定）
  if (msg.dbKey && msg.slug) keyCache.set(msg.slug, msg.dbKey);
  if (Array.isArray(msg.tasks)) {
    for (const t of msg.tasks) if (t && t.dbKey && t.slug) keyCache.set(t.slug, t.dbKey);
  }
  switch (msg.cmd) {
    case 'start':
      await runScan(msg.slug, msg.albumId, msg.mode || 'incremental', msg.resumeFrom || '', msg.token || 0);
      break;
    case 'resume':
      for (const t of (msg.tasks || [])) {
        await runScan(t.slug, t.albumId, t.mode || 'incremental', t.resumeFrom || '', t.token || 0);
      }
      break;
    case 'demand': {
      // 主进程配额闸放不下的补图需求：排队到子进程生成
      const ids = Array.isArray(msg.ids) ? msg.ids : [];
      for (const id of ids) {
        if (Number.isInteger(id) && id > 0) demandQueue.push({ slug: msg.slug, id });
      }
      await runDemand();
      break;
    }
    case 'stop': {
      // 快速路径：先改本地标志让扫描尽快在检查点收工。
      const t = running.get(msg.albumId);
      if (t) { t.cancelled = true; t.paused = false; }
      // 任务还没注册（用户抢在扫描启动前点了停止）：记下来，runScan 开头补上。
      // 否则这次停止会被「丢弃」——用户以为停了，扫描照跑。
      else pendingStops.add(msg.albumId);
      // 注意：**这里不写库**。state 由主进程独占写（只有它知道 token），
      // 子进程再写一遍只会带来「谁后写谁赢」的竞态
      //（比如用户刚点停止、主进程写了 cancelled，子进程随后写 running 就把指令抹了）。
      break;
    }
    case 'pause': {
      const t = running.get(msg.albumId);
      if (t) t.paused = !!msg.paused;
      // 同上：暂停/继续只改本地标志（快速路径），跨进程真源交给主进程写。
      // 「任务还没注册时来的 pause」不用另记 —— waitWhilePaused 会按 token
      // 读到主进程写的 state='paused' 并自己置上本地标志（那里已做同样处理）。
      break;
    }
    case 'lock': {
      // 主进程登出：关闭该库连接并丢掉钥匙，之后本进程不再持有可读句柄
      const conn = openConns.get(msg.slug);
      if (conn) { try { conn.close(); } catch (_) { /* 忽略 */ } openConns.delete(msg.slug); }
      keyCache.delete(msg.slug);
      break;
    }
    case 'shutdown':
      process.exit(0);
      break;
  }
});

// 告诉主进程我起来了
send({ type: 'ready' });
