// =========================================================================
// albumScan.js —— 相册扫描引擎（主进程与扫描子进程共用）
//
// 从 routes/album.js 抽出，让扫描逻辑不依赖 Express，因此可以在两个地方跑：
//   · 子进程 worker.scan.js —— 2026-10-22 起的默认路径，独立进程独占 CPU
//   · 主进程（routes/album.js 的请求路径）—— 只用来「现场补少量缺图」
//
// 为什么要拆进程（别改回去）：
//   扫描与 HTTP 接口跑在同一个进程时，sharp 会占满 libuv 线程池
//   （默认 4，与 MAX_CONCURRENT_THUMBS 同数），其他接口的异步 fs 只能排队。
//   注意 **worker_threads 解决不了**：libuv 线程池是进程级全局静态，
//   所有 Worker 共用同一个池子；Worker 只能隔离 V8 堆与 JS CPU，
//   而这里的重活全在原生线程池上。只有独立进程才有自己的 libuv/V8/GC。
//   隔离不了的是磁盘 IO（同一块盘共享），对 16 核桌面应用可感知度低。
//
// 本模块只依赖 dbManager / albumThumbs / ffmpeg / sharp，不 require express。
// 数据库连接一律通过参数传入（conn）或 dbManager.withDb 拿，
// 子进程与主进程各开各的连接（WAL 下读写不互斥）。
// =========================================================================

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const albumThumbs = require('./albumThumbs');
const { readExifDate } = require('./albumExif');
// 懒加载：ffmpeg 只为视频封面抓帧时使用，且可能触发按需下载
const { ensureFfmpeg } = require('./services/ffmpeg');
const { now } = require('./utils/sql');

// 缩略图尺寸 / 质量 / 缓存版本
// 尺寸回到 512（曾经提到 1024 是为了排查「模糊」，后来查明是全局遮罩 CSS 在照片上盖了
// backdrop-filter 导致的，与分辨率无关，故恢复 512；单张约 27~35KB）。
// 改尺寸/质量时把 THUMB_VERSION +1：album_photos.thumb_v 记录生成时的版本，
// 旧缩略图会在下次被请求时自动按新参数重建，不需要手动清缓存。
// 本次只把上限从 1024 降回 512、版本不变（3）：已经生成的 1024 图仍然可用且更清晰，
// 不强制重建，只有新照片会按 512 生成。
const THUMB_SIZE = 512;
const THUMB_QUALITY = 82;
// 本次 +1（4）：修复 ffmpeg 精简构建（x86asm 被关）导致的视频封面花屏，换用新构建的
// ffmpeg.exe 后重建所有旧视频封面；图片缩略图会顺带重建（sharp 输出不变，只是费一次 CPU）。
const THUMB_VERSION = 4;

const IMG_EXT = /\.(jpg|jpeg|png|gif|webp|bmp)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv|m4v|ogv)$/i;

// ------------------------------------------------------------------低干扰参数

// 长事务分批：全量扫描开头清理旧索引时，每批删这么多行，批间让出事件循环。
// 2000 行 ≈ 十几毫秒，够小到不会明显冻结后端，又大到不必频繁让出。
// 注意：WAL 下读写**不互斥**（这正是开 WAL 换来的收益），所以分批不是为了解锁读，
// 而是因为 better-sqlite3 是同步的 —— del.run() 执行期间整个进程不能响应任何请求。
// 典型场景 DELETE 只需几毫秒，分批收益小；极端情况（几十万行 / 慢盘）能钉死最坏停顿。
const DELETE_BATCH = 2000;
// 文件循环每处理多少个文件主动让出一次事件循环。
// 这个比 DELETE 分批更有价值：文件循环里有 await fsp.stat 与 await genThumb
//（sharp 单张约 20ms），攒 16 个就是 300ms+ 的连续计算，不让出后端会明显发闷。
const SCAN_YIELD_EVERY = 16;
// 缩略图写库攒批：攒够这么多条一起提交。
// better-sqlite3 每条语句自带事务（autocommit），1 万张图就是 1 万次事务提交。
// 攒批后提交次数降到 1/10。注意不能跨 await 显式 BEGIN/COMMIT（同步库在 await 期间
// 会被其他请求插进来打断，反而拉长锁持有），所以用「攒够就立刻提交」而非开长事务。
const THUMB_WRITE_BATCH = 10;
// 扫描断点的写库间隔：每 20 个文件写一次（1 万张不必写 1 万次库，崩溃时最多重扫一批）。
const PERSIST_EVERY = 20;

// 让出事件循环一次：把控制权交回 Node，让其他连接的回调先跑。
function yieldLoop() {
  return new Promise(resolve => setImmediate(resolve));
}

function mediaTypeOf(fileName) {
  return VIDEO_EXT.test(fileName) ? 'video' : 'image';
}

function dateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (!d || isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ------------------------------------------------------------------拍摄时间解析

 * 时间轴原先按文件修改时间（mtime）分组，但mtime 会被复制、解压、聊天软件
 * 转存、同步盘上传下载全部改写 —— 一批 2019 年拍的照片导出来就全变成「今天」。
 * 现在改为读图片自带的 EXIF 拍摄时间（DateTimeOriginal → DateTimeDigitized
 * → DateTime → XMP）。
 *
 * **读不到就是读不到，不拿 mtime 兜底**：文件时间不是拍摄时间，拿它冒充等于
 * 凭空造一个假日期，比「未知」更坏（用户会把它当真日期去认照片）。所以读不到时
 * photo_date 留空，由前端归到时间轴**最底部**的「未知时间」分组。
 *
 * 返回 { date, exif, src }：date 是写库的 photo_date（YYYY-MM-DD 日键，读不到为空串），
 * src 取 'exif' / 'none' —— 'none' 表示「已核过但没有 EXIF」，与老库的 ''
 * （还没核过）区分开，增量扫描据此决定要不要再读一次盘。*/
async function resolvePhotoDate(filePath, mtime, isVideo) {
  // 视频没有 EXIF：ffprobe 取拍摄时间要起子进程，扫描时每张都调不划算。
  // 视频一律归「未知时间」，不拿文件时间冒充。
  if (!isVideo) {
    try {
      const exif = await readExifDate(filePath);
      if (exif) return { date: dateKey(exif), exif, src: 'exif' };
    } catch (_) { /* 读不到就归未知，不让单张图的异常中断整个扫描 */ }
  }
  return { date: '', exif: '', src: 'none' };
}

// ------------------------------------------------------------------缩略图生成

// 缩略图生成共享并发信号量：多个相册可同时扫描，限制同时进行的 sharp/ffmpeg 数量，
// 避免大相册批量扫描瞬间把内存/CPU 打满。
// 实测（16 核机器，40 张 1.93MB 源图）：并发 1 → 单张 51.1ms；并发 2 → 29.8ms；
// 并发 4 → 20.2ms（最优）；并发 8 → 回退到 24.7ms。原设 2 偏保守，提到 4。
// 拆到子进程后，这个信号量是「子进程内」的 —— 主进程只剩请求路径的少量补图，
// 两边各自限流，互不干扰（这也是拆进程的附带收益：两边不再抢同一个池子）。
const MAX_CONCURRENT_THUMBS = 4;
let activeThumbs = 0;
const thumbWaiters = [];
function acquireThumbSlot() {
  if (activeThumbs < MAX_CONCURRENT_THUMBS) { activeThumbs++; return Promise.resolve(); }
  return new Promise(res => thumbWaiters.push(res));
}
function releaseThumbSlot() {
  activeThumbs--;
  const next = thumbWaiters.shift();
  if (next) { activeThumbs++; next(); }
}

// 生成 320px JPEG 小图：图片用 sharp 处理竖拍 EXIF 方向；视频用 ffmpeg 抓第 0.1 秒帧。
// 输出按库隔离到 {thumbsDir}/{slug}/{photoId}.jpg；成功返回路径，失败返回 ''（调用方退回占位）。
async function genThumb(photoId, filePath, isVideo, slug) {
  // 缩略图按库隔离：各库的 album_photos.id 都从 1 开始自增，若只按 {photoId}.jpg
  // 命名并共用一个目录，不同库的同号照片会互相覆盖（串图）。
  const s = slug || albumThumbs.safeSlug('');
  const out = albumThumbs.thumbPathFor(s, photoId);
  // 用唯一临时文件名落盘再改名：扫描后台生成与请求路径现场生成可能并发处理同一张照片，
  // 各写一个临时文件再改名为 {id}.jpg，避免同一路径并发写冲突；对调用方返回路径不变。
  // 临时名必须仍以 .jpg 结尾：ffmpeg 靠输出扩展名推断封装格式，形如 {id}.jpg.ab12cd
  // 会被判为「Unable to choose an output format」直接失败（视频封面全部 404 的根因）。
  const tmp = path.join(albumThumbs.thumbsDirFor(s), `${photoId}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.jpg`);
  await acquireThumbSlot();
  try {
    if (isVideo) {
      // 用 LGPL 版 ffmpeg 抓帧（独立二进制命令行调用，不链接进主程序）。
      const ffmpegPath = await ensureFfmpeg();
      if (!ffmpegPath) { return ''; }
      await new Promise((resolve, reject) => {
        execFile(ffmpegPath, ['-y', '-ss', '0.1', '-i', filePath, '-frames:v', '1', '-vf', `scale=${THUMB_SIZE}:-2`, '-q:v', '4', tmp],
          err => err ? reject(err) : resolve());
      });
    } else {
      const sharp = require('sharp') // 懒加载原生库：首次生成缩略图时才加载，启动不背 sharp 初始化成本
      await sharp(filePath)
        .rotate() // 处理竖拍 EXIF 方向
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: THUMB_QUALITY })
        .toFile(tmp);
    }
    await fsp.rename(tmp, out);
    // 记入内存索引（子进程与主进程各持一份，互不影响）：
    // 主进程靠它把缩略图读变成零磁盘 IO；子进程这边主要是回退兜底。
    albumThumbs.rememberThumb(s, photoId, out, THUMB_VERSION, null);
    return out;
  } catch (_) {
    try { await fsp.unlink(tmp); } catch (_) {}
    return '';
  } finally {
    releaseThumbSlot();
  }
}

// 查已生成的缩略图路径：命中内存索引且版本不落后则返回，否则返回 ''（需重建）。
// 不用 fs.existsSync —— 那是同步 IO，会阻塞事件循环（实测并发 16 张时
// 5ms 定时器延迟 p95 达 8.3ms、max 10.1ms，拖慢后端所有其他接口）。
function thumbOf(photo, slug) {
  const s = slug || albumThumbs.safeSlug('');
  const cached = albumThumbs.lookupThumb(s, photo.id, THUMB_VERSION);
  if (cached) return cached;
  // 内存未命中：退回到库里的 thumb_path 指针（可能是本次进程启动前生成的）。
  // 仍不 existsSync —— 交给后续异步读盘判定，失败即重建。
  const tp = photo.thumb_path;
  if (!tp) return '';
  if ((photo.thumb_v || 0) < THUMB_VERSION) return '';
  albumThumbs.rememberThumb(s, photo.id, tp, THUMB_VERSION, null);
  return tp;
}

// ------------------------------------------------------------------缩略图写库攒批

// 把「刚生成的缩略图 → 写回 album_photos.thumb_path/thumb_v」攒成批提交。
//
// 为什么攒：better-sqlite3 每条语句自带事务，1 万张图就是 1 万次事务提交
//（每次都要走一遍 WAL 帧追加）。攒够 THUMB_WRITE_BATCH 条再一次性提交，
// 提交次数降到 1/10，而每条的 UPDATE 成本不变。
//
// 为什么不用显式 BEGIN/COMMIT 开长事务：better-sqlite3 是同步库，
// 攒批的循环里如果有 await（genThumb 是异步的），开着的写事务会在 await 期间
// 被其他请求插进来的语句插队/撞锁，反而把锁持有时间拉长 —— 比不攒批更糟。
// 所以攒批的边界只在「纯同步的一瞬」：攒够 THUMB_WRITE_BATCH 条就用 conn.transaction
// 一次提交，事务里没有 await，持锁时间是微秒级，不会卡住别的连接。
//
// 跨进程注意：子进程与主进程各写各的连接，WAL 下写 vs 写会互斥。
// 攒批同时把「抢写锁的次数」降一个数量级，别的连接的写请求更容易抢到锁。
function createThumbWriter(conn) {
  const setThumb = conn.prepare('UPDATE album_photos SET thumb_path = ?, thumb_v = ? WHERE id = ?');
  let pending = [];   // 待提交的 [photoId, thumbPath]
  // 提交一批：用一个显式事务把攒的 N 条 UPDATE 一次提交掉（纯同步，无 await）
  const commit = () => {
    if (!pending.length) return;
    const rows = pending;
    pending = [];
    const run = conn.transaction(() => {
      for (const [photoId, thumbPath] of rows) setThumb.run(thumbPath, THUMB_VERSION, photoId);
    });
    try { run(); } catch (_) { /* 写失败不影响扫描本身，缩略图下次请求时会重建 */ }
  };
  return {
    // 记一条待写回的缩略图；攒够就提交
    add(photoId, thumbPath) {
      pending.push([photoId, thumbPath]);
      if (pending.length >= THUMB_WRITE_BATCH) commit();
    },
    // 把剩余的记一次（语义上与上面一致，单独留一个口子供收尾显式调用）
    flush() { commit(); },
    get pendingCount() { return pending.length; },
  };
}

// ------------------------------------------------------------------扫描任务持久化

// 问题：软件被关掉/崩溃时，正在跑的相册扫描会丢，大相册要从头再来（缩略图全部重生成）。
// 做法：扫描过程中把「已处理到哪个文件」落到库表 album_scan_tasks；
//      重启后前端（启动完成、延迟 4 秒后）调 /tasks/pending 查询并触发续扫。
//
// 关键设计（勿改）：
// 1) 断点用**文件路径**而不是序号：重启后目录内容可能变化（文件被增删），
//    序号会错位，路径能稳定定位。续扫时重新收集清单，跳过 done_path 之前（含）的部分。
// 2) **不在后端启动时自动续扫**：那会跟软件启动抢 CPU/IO。
//    由前端在「完全启动后」主动触发（见 /tasks/pending 与 /tasks/resume）。
// 3) 只有「跑完」或「用户主动停止」才清记录；进程被杀/异常退出时记录留着，供下次续扫。
// 4) state 列（2026-10-22 加）：跨进程状态真源。子进程扫的时候把它写成 running，
//    主进程收到「暂停/停止」就改写成 paused/cancelled，子进程在检查点读表后收工。
//    这样 IPC 只承载「派活/报活」，状态本身落在库里 —— IPC 断了也不丢状态。
// 5) token 列（2026-10-22 加）：行的**归属标识**，解决「主进程与子进程同时写同一行」的串扰。
//    每次派活由主进程生成一个新 token 并经 IPC 交给子进程，
//    子进程所有写操作都带 `WHERE album_id = ? AND token = ?` 限定，
//    于是「旧的扫描收尾」不会误删「新的扫描刚写的行」，
//    「主进程写的停止指令」也不会被「子进程写的 running」覆盖。
//    token=0 表示历史遗留行（无归属概念），仍可正常续扫。

// 派活时由**主进程**调用：认领这一行（写 token、把 state 置为 running）。
//
// 为什么由主进程而不是子进程来写这一行：
//   子进程写的话，它启动得比主进程的「停止」指令晚（用户可能在扫描还没起来时就点了停止），
//   子进程一写就把 state 覆盖成 running，停止指令被抹掉 → 用户以为停了其实没停。
//   主进程在派活的同一瞬间就写好 state=running + token，
//   之后主进程再写 paused/cancelled 就不会被覆盖（因为 token 相同、且 state 由主进程独占写）。
//
// resumeFrom 非空表示续扫：保留已有的 done_path/scanned/total（不清空重来）。
function claimScanTask(conn, albumId, mode, token, resumeFrom) {
  try {
    if (resumeFrom) {
      // 续扫：保留断点，只更新归属与状态
      conn.prepare(`UPDATE album_scan_tasks SET mode = ?, phase = 'process', state = 'running', token = ?, updated_at = ?
        WHERE album_id = ?`)
        .run(mode, token, now(), albumId);
    } else {
      // 从头扫：清空断点（旧的进度对新的一轮没意义）
      conn.prepare(`INSERT INTO album_scan_tasks (album_id, mode, phase, done_path, scanned, total, state, token, started_at, updated_at)
        VALUES (?, ?, 'collect', '', 0, 0, 'running', ?, ?, ?)
        ON CONFLICT(album_id) DO UPDATE SET mode = excluded.mode, phase = 'collect', done_path = '', scanned = 0, total = 0,
          state = 'running', token = excluded.token, started_at = excluded.started_at, updated_at = excluded.updated_at`)
        .run(albumId, mode, token, now(), now());
    }
  } catch (_) { /* 持久化失败不影响扫描本身 */ }
}

// 推进断点：记录已处理完的文件路径与进度
// 批量写：每处理一个文件都写库太频繁（1 万张 = 1 万次写），按间隔写即可
// （崩溃时最多重扫一批，代价远小于从头重来）。
//
// 带 token 限定：只更新「属于本次扫描」的那一行。
// 否则上一次扫描的收尾（persistScanClear）会把本次刚写的行删掉。
// 每个扫描任务（albumId + token）各自计数，避免并发扫描互相把对方的计数清零
const persistCounters = new Map();
function persistScanProgress(conn, albumId, token, mode, phase, donePath, scanned, total, force) {
  const key = `${albumId}:${token || 0}`;
  const count = (persistCounters.get(key) || 0) + 1;
  if (!force && count % PERSIST_EVERY !== 0) {
    persistCounters.set(key, count);
    return;
  }
  persistCounters.delete(key);
  try {
    conn.prepare(`UPDATE album_scan_tasks SET mode = ?, phase = ?, done_path = ?, scanned = ?, total = ?, updated_at = ?
      WHERE album_id = ? AND token = ?`)
      .run(mode, phase, donePath || '', scanned || 0, total || 0, now(), albumId, token || 0);
  } catch (_) { /* 同上 */ }
}

// 清除记录：扫描正常跑完，或用户主动停止（这两种情况不需要续扫）
//
// 带 token 限定：只删「属于本次扫描」的那一行。
// 不带限定的话，本次扫描收尾时会把「另一次（新一轮）扫描刚写的行」一起删掉，
// 那边的扫描读到「行不见了」就误判成被放弃而中止。
function persistScanClear(conn, albumId, token) {
  persistCounters.delete(`${albumId}:${token || 0}`);
  try {
    conn.prepare('DELETE FROM album_scan_tasks WHERE album_id = ? AND token = ?').run(albumId, token || 0);
  } catch (_) {}
}

// 读取未完成的扫描任务（供 /tasks/pending 查询）
//
// 过滤掉 state='cancelled'：用户主动停止 = 明确放弃这次扫描，不该再被「续扫」复活。
// （停止时主进程会写 cancelled 标记；这里排除它，前端就不会再提示续扫。）
function readPendingScanTasks(conn) {
  try {
    return conn.prepare(`SELECT t.album_id, t.mode, t.phase, t.done_path, t.scanned, t.total, t.state, t.started_at, t.updated_at, a.name AS album_name
      FROM album_scan_tasks t LEFT JOIN albums a ON a.id = t.album_id
      WHERE t.state IS NULL OR t.state != 'cancelled'
      ORDER BY t.started_at ASC`).all();
  } catch (_) {
    return [];
  }
}

// 读某个相册的扫描状态（跨进程共享状态真源）。无记录返回 null。
function readScanTask(conn, albumId) {
  try {
    return conn.prepare('SELECT * FROM album_scan_tasks WHERE album_id = ?').get(albumId) || null;
  } catch (_) {
    return null;
  }
}

// 更新某个任务的运行态（主进程收到用户的暂停/停止时调用；子进程只读不写这个）。
//
// 用 upsert 而不是纯 UPDATE：主进程可能在子进程还没认领这一行之前
// 就收到了用户的暂停/停止指令 —— 那时行还不存在，纯 UPDATE 影响 0 行，
// 指令就丢了（用户点了停止，扫描照跑）。upsert 保证指令一定能落库。
//
// token 传 0 表示「不限归属」（如对尚未派活的相册下指令）。
function setScanState(conn, albumId, state, token) {
  try {
    conn.prepare(`INSERT INTO album_scan_tasks (album_id, mode, phase, done_path, scanned, total, state, token, started_at, updated_at)
      VALUES (?, 'incremental', 'collect', '', 0, 0, ?, ?, ?, ?)
      ON CONFLICT(album_id) DO UPDATE SET state = excluded.state,
        -- token 传 0 表示「调用方不知道当前归属」（如主进程重启后收到停止指令）：
        -- 这时保留库里的原 token，别把它抹成 0 —— 抹掉的话，正在跑的扫描
        -- 后续按 token 推进断点就会「找不到自己的行」，进度/断点全部失效。
        token = CASE WHEN excluded.token = 0 THEN album_scan_tasks.token ELSE excluded.token END,
        updated_at = excluded.updated_at`)
      .run(albumId, state, token || 0, now(), now());
  } catch (_) { /* 状态写失败不致命，扫描本身照跑 */ }
}

// ------------------------------------------------------------------按 id 补图

// 按 album_photos.id 补生成缩略图（需求队列用）。
// 主进程只做「少量补齐」，超量的缺图 id 交给扫描子进程生成（见 worker.scan.js 的 demand 队列）。
// 之所以不直接用文件路径：id 是主进程手上唯一确定的信息（路径以库里的 album_photos.file_path 为真源）。
// 已有且版本不落后的缩略图直接跳过（避免与扫描自身重复生成）。
async function genThumbsByIds(conn, ids, slug, onThumb) {
  if (!conn || !ids || !ids.length) return 0;
  const pick = conn.prepare('SELECT id, file_path, file_name, thumb_path, thumb_v FROM album_photos WHERE id = ?');
  const writer = createThumbWriter(conn);
  let n = 0;
  for (const id of ids) {
    const row = pick.get(id);
    if (!row) continue;                                  // 还没被索引到（扫描还没走到），跳过
    if (row.thumb_path && (row.thumb_v || 0) >= THUMB_VERSION) continue;  // 已有，不用再生成
    const tp = await genThumb(row.id, row.file_path, VIDEO_EXT.test(row.file_name), slug);
    if (!tp) continue;
    writer.add(row.id, tp);
    n++;
    if (onThumb) onThumb(row.id, tp);
  }
  writer.flush();
  return n;
}

// ------------------------------------------------------------------目录遍历

// 跨进程状态轮询的节流间隔（毫秒）。
// 主进程的暂停/停止有两条通路：IPC（毫秒级，task 本地标志）与库表 album_scan_tasks.state
// （跨进程真源，兜底）。若每个文件都查一次库，1 万张图就是 1 万次同步读，纯浪费。
// 300ms 查一次足够及时：IPC 正常时本地标志会先命中，DB 只是兜底。
const STATE_CHECK_INTERVAL = 300;

// 暂停等待：返回 false 表示等待期间被「停止」了，调用方应直接跳出循环。
// 跨进程版的「暂停/停止」判断：先看内存 task 的本地标志（同一进程内最快），
// 再查库里的 state（跨进程时主进程改写库、子进程读到）。
// 两级判断的顺序：本地标志优先（毫秒级），只有本地没有指令时才查库（每检查点查一次，
// 不是每个文件，避免频繁读库）。
//
// 查库还要再节流：每个文件都查一次的话，1 万张图就是 1 万次同步读，纯浪费。
// STATE_CHECK_INTERVAL 毫秒查一次足够及时 —— IPC 正常时本地标志会先命中，
// 库表只是「IPC 断了也不丢状态」的兜底。
async function waitWhilePaused(conn, task, albumId) {
  for (;;) {
    if (task.cancelled) return false;
    // 跨进程：查一次库看主进程有没有下达暂停/停止（按间隔节流）
    if (conn && albumId != null) {
      const lastCheck = task.lastStateCheck || 0;
      const nowTs = Date.now();
      if (nowTs - lastCheck >= STATE_CHECK_INTERVAL) {
        task.lastStateCheck = nowTs;
        try {
          // 按 token 读：只看「属于我这一次扫描」的那一行的状态。
          // 不限定 token 的话，别的一次扫描的 state 会串进来。
          const row = conn.prepare('SELECT state FROM album_scan_tasks WHERE album_id = ? AND token = ?')
            .get(albumId, task.token || 0);
          if (row) {
            if (row.state === 'cancelled') { task.cancelled = true; return false; }
            if (row.state === 'paused') {
              // 暂停：挂短定时器原地等，恢复（state 回到 running）后接着走。
              //
              // 必须**同时置 task.paused**：查库是按 STATE_CHECK_INTERVAL 节流的，
              // 醒来后那一次调用会因为「距上次查库不足 300ms」而跳过查库，
              // 直接走到下面的 `if (task.paused)` —— 若本地标志还是 false，
              // 就会 return true 放行，把「暂停」变成每 200ms 漏放一个文件
              // （库表明明写着 paused，扫描却一直往前推）。
              // 这不是理论风险：用户点暂停时子进程可能还没注册 runScan，
              // 那条 IPC pause 会被丢弃，本地标志压根没被置上。
              task.paused = true;
              await new Promise(resolve => setTimeout(resolve, 200));
              continue;
            }
            // state 回到 running → 解除本地暂停标志（可能只是 IPC 那条路没送达，
            // 但库表是唯一真源，这里读到 running 就该继续跑）
            task.paused = false;
          } else {
            // 属于我这一次的记录不见了 = 任务被「放弃/停止」（主进程删了行），视为取消。
            // 注意：不能因为「行不见了」就放弃 —— 若上一轮扫描的收尾误删了本轮的行，
            // 那样本轮也会被误杀。token 限定已经杜绝了那种误删，这里只处理真正的放弃。
            task.cancelled = true;
            return false;
          }
        } catch (_) { /* 读库失败按「没指令」继续跑，不因状态同步失败而中断扫描 */ }
      }
    }
    if (task.paused) {
      await new Promise(resolve => setTimeout(resolve, 200));
      continue;
    }
    return true;
  }
}

// 递归遍历目录树，产出 { name, full }（name 为文件名，full 为绝对路径）。
// 用显式栈而不是 fsp.readdir(..., { recursive: true })：不依赖各 Node 版本
// Dirent 的 parentPath/path 字段差异，行为完全可控。
//
// onUnreadable：某个目录 readdir 失败时回调一次（权限、临时不可访问、
// OneDrive 占位文件未落地、网络盘抖动等）。**不能静默吞掉**——
// 收集阶段若因吞掉的错误少了一批文件，后面拿这份不完整的清单去判断
// 「磁盘上已删除的文件」，会把那一整片目录的索引误删干净。
async function* walkMediaFiles(root, onUnreadable) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (onUnreadable) onUnreadable(dir, err);
      continue;
    }
    for (const ent of entries) {
      if (ent.isDirectory()) { stack.push(path.join(dir, ent.name)); continue; }
      if (!IMG_EXT.test(ent.name) && !VIDEO_EXT.test(ent.name)) continue;
      yield { name: ent.name, full: path.join(dir, ent.name) };
    }
  }
}

// 先收全目录树的媒体文件清单（边收集边累计 task.total 供进度条），再逐个处理。
// 收集阶段就把 total 报上去，前端「任务管理」能看到数字在涨，不会像卡死；
// 返回 null 表示等待期间被停止，调用方应当中断本轮扫描。
//
// 返回 { files, complete }：
//   files    —— 收集到的文件清单
//   complete —— false 表示有目录读不到（清单不完整，见 walkMediaFiles 的说明）
// 调用方据此**跳过「清理已删除文件」**，避免用残缺清单误删索引。
async function collectMediaFiles(root, task, conn, albumId) {
  const files = [];
  let complete = true;
  const onUnreadable = () => { complete = false; };
  for await (const f of walkMediaFiles(root, onUnreadable)) {
    if (!await waitWhilePaused(conn, task, albumId)) return null;
    files.push(f);
    task.total++;
  }
  return { files, complete };
}

// 分批删除「索引里有、但本次磁盘清单里没有」的行（即磁盘上已删除的文件）。
// 返回 false 表示中途被取消/暂停。见顶部 DELETE_BATCH 的说明：分批不是为了解锁读
// （WAL 下读写不互斥），而是把「同步 SQLite 执行导致的后端冻结」切成碎片。
//
// 为什么不用旧实现「开头把整表删光」：那样一旦收集阶段被停止/暂停/子进程被杀，
// 索引已经是空的而新索引一条没写 —— 相册变成 0 张，磁盘文件却一个没少。
// 改成「先收齐清单、只删清单外的行」，任何中断点上的索引都只是旧数据，不会凭空消失。
//
// trust=false（收集时有目录读不到）时一行都不删：清单不完整，
// 拿它判断「磁盘上已删除」会把读不到的那部分目录整个误删。宁可留旧记录，等下次扫描。
async function deletePhotosNotIn(conn, albumId, task, foundPaths, slug, trust = true) {
  if (!trust) return true;
  const pick = conn.prepare('SELECT id, file_path, thumb_path FROM album_photos WHERE album_id = ? AND id > ? ORDER BY id ASC LIMIT ?');
  const del = conn.prepare('DELETE FROM album_photos WHERE id = ?');
  let cursor = 0;
  for (;;) {
    if (!await waitWhilePaused(conn, task, albumId)) return false;
    const rows = pick.all(albumId, cursor, DELETE_BATCH);
    if (!rows.length) break;              // 删干净了
    for (const r of rows) {
      cursor = r.id;
      if (foundPaths.has(r.file_path)) continue;   // 文件还在，索引留着
      // 缩略图缓存：索引没了就没人引用，顺手清掉（含内存索引）
      albumThumbs.forgetPhoto(slug, r.id);
      const jobs = [fsp.unlink(albumThumbs.thumbPathFor(slug, r.id)).catch(() => {})];
      if (r.thumb_path) jobs.push(fsp.unlink(r.thumb_path).catch(() => {}));
      await Promise.all(jobs);
      del.run(r.id);
    }
    await yieldLoop();          // 批间让出，让其他请求有机会跑
  }
  return true;
}

// ------------------------------------------------------------------扫描主流程

// 一个 task 对象在扫描过程中的可变状态。放在内存里，同进程内最快；
// 跨进程（主进程暂停/停止）的指令通过 album_scan_tasks.state 传达，见 waitWhilePaused。
//
// token：本次扫描的归属标识（主进程派活时生成、经 IPC 传进来）。
// 库表的读写都以它为限定条件，避免与「另一次扫描」串扰。
function newTask(mode, token) {
  return { cancelled: false, paused: false, scanned: 0, total: 0, mode, token: token || 0, startedAt: now() };
}

// ---- 全量扫描：清空旧索引后重新扫描（前端会逐步显示新索引的数据） ----
//
// conn：本进程自己开的连接（主进程或子进程各开各的，WAL 下不互斥）。
// onProgress：进度回调，用于子进程通过 IPC 回报主进程。
// token：本次扫描的归属标识（见 newTask 的说明）。
async function fullScan(conn, albumId, resumeFrom, slug, onProgress, token) {
  const album = conn.prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
  if (!album) return;
  // 虚拟相册不绑定文件夹，没有可扫描的东西（正常入口已被拦住，这里兜底）
  if (album.kind === 'virtual') return;

  // 续扫：resumeFrom 是上次处理到的文件路径，从它的下一个继续。
  // 续扫与从头扫同样**不删旧索引**（见下面 try 块里的说明）：
  // 中途中断时索引保持原样，下次续扫从断点接着走，不会把相册清空。
  const resuming = !!resumeFrom;
  const task = newTask('full', token);

  // 落一条「进行中」的记录：进程被杀时能据此续扫。
  // 注意：这一行由**主进程**在派活时就写好（claimScanTask，含 token 与 state=running），
  // 子进程只负责推进断点（persistScanProgress，带 token 限定）。
  // 若这里再写一次 state，会把主进程写的「停止」指令抹掉（用户以为停了其实没停）。
  if (resuming) persistScanProgress(conn, albumId, task.token, 'full', 'process', resumeFrom, 0, 0, true);

  try {
    const insert = conn.prepare('INSERT OR IGNORE INTO album_photos (album_id, file_path, file_name, file_size, mtime, photo_date, exif_date, date_src) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const updateMeta = conn.prepare('UPDATE album_photos SET file_name = ?, file_size = ?, mtime = ?, photo_date = ?, exif_date = ?, date_src = ? WHERE id = ?');
    const pickRow = conn.prepare('SELECT id FROM album_photos WHERE album_id = ? AND file_path = ?');
    const thumbWriter = createThumbWriter(conn);

    // 递归扫整个目录树（含子文件夹）：整个树的媒体文件都进这一个相册的索引。
    // 先收集清单再处理，收集期间 task.total 由 collectMediaFiles 边收边累计。
    // null = 收集期间被停止 → 直接放弃本轮（不能兜成空清单：
    // 空清单在续扫时会让断点定位失效、从头重来，白扫一遍）。
    // 关键：这里**不再**先把旧索引删光。收集阶段被中断时直接 return，
    // 旧索引原封不动 —— 之前「先删光再收集」会让中断后的相册变成 0 张，
    // 而磁盘文件一个没少（用户看到的就是「文件夹里照片还在、相册却空了」）。
    const collected = await collectMediaFiles(album.folder_path, task, conn, albumId);
    if (collected === null) return;
    const { files, complete } = collected;
    // 断点定位：找到 resumeFrom 在清单中的位置，从它的**下一个**开始处理。
    // 找不到（文件被删了）则从头开始（稳妥：INSERT OR IGNORE 会跳过已存在的）。
    let startIdx = 0;
    if (resuming) {
      const at = files.findIndex(f => f.full === resumeFrom);
      startIdx = at >= 0 ? at + 1 : 0;
      // 补缺：断点之前（含）的文件里，可能有「索引已建但缩略图没生成成功」的
      // （genThumb 失败时只写索引、不写 thumb_path）。续扫跳过它们就会永远缺图，
      // 所以这里回头把缺缩略图的补上。只补缺的那些，正常的一律跳过。
      if (startIdx > 0) {
        const pick = conn.prepare('SELECT id, thumb_path, thumb_v FROM album_photos WHERE album_id = ? AND file_path = ?');
        for (let i = 0; i < startIdx; i++) {
          const f = files[i];
          const row = pick.get(albumId, f.full);
          if (!row) continue;
          if (row.thumb_path && (row.thumb_v || 0) >= THUMB_VERSION) continue;
          const tp = await genThumb(row.id, f.full, VIDEO_EXT.test(f.name), slug);
          if (tp) thumbWriter.add(row.id, tp);
        }
      }
    }
    // 续扫时把已跳过的部分计入 scanned，进度条不会倒退
    task.scanned = startIdx;
    for (let i = startIdx; i < files.length; i++) {
      const { name, full } = files[i];
      if (!await waitWhilePaused(conn, task, albumId)) break;
      try {
        const st = await fsp.stat(full);
        const mtime = st.mtime.toISOString();
        const isVideo = VIDEO_EXT.test(name);
        const when = await resolvePhotoDate(full, mtime, isVideo);
        // 已有索引行：原实现在开头删光，所以这里必然是插入；
        // 现在保留旧行，就要在这里把元数据刷新一遍 —— 否则「全量更新」会退化成增量更新
        // （缩略图版本升级、文件名/大小变化、EXIF 补读都不会生效）。
        const existingRow = pickRow.get(albumId, full);
        let photoId;
        if (existingRow) {
          photoId = existingRow.id;
          updateMeta.run(name, st.size, mtime, when.date, when.exif, when.src, photoId);
        } else {
          const ri = insert.run(albumId, full, name, st.size, mtime, when.date, when.exif, when.src);
          // INSERT OR IGNORE 冲突时 changes=0，此时 lastInsertRowid 是**上一次**插入的残留值，
          // 直接拿它写缩略图会写到别的行上。冲突时改为回查真实 id。
          photoId = ri.lastInsertRowid;
          if (ri.changes === 0) {
            const row = pickRow.get(albumId, full);
            if (!row) continue;
            photoId = row.id;
          }
        }
        task.scanned++;
        // 全量更新：无条件重建缩略图（这正是「全量」与「增量」的区别 —— 用户用它来刷新缓存）
        const tp = await genThumb(photoId, full, isVideo, slug);
        if (tp) thumbWriter.add(photoId, tp);
        // 处理完这个文件才推进断点（中途崩溃时这个文件会重扫，代价很小）
        persistScanProgress(conn, albumId, task.token, 'full', 'process', full, task.scanned, task.total, false);
      } catch (_) {}
      // 每 SCAN_YIELD_EVERY 个文件主动让出一次事件循环：
      // 文件循环里有 await stat 与 await genThumb（sharp 单张约 20ms），
      // 攒 16 个就是 300ms+ 连续计算，不让出后端会明显发闷。
      if (task.scanned % SCAN_YIELD_EVERY === 0) {
        await yieldLoop();
        if (onProgress) onProgress(task);
      }
    }
    thumbWriter.flush();

    // 文件循环被停止/暂停而提前 break 时**不能**做清理：清单只处理了一部分，
    // 拿它判断「磁盘上已删除」会把后半段还没扫的索引全删了（续扫时尤其致命）。
    // 只有完整跑完、清单可信时才清理「磁盘上确实没有了的文件」。
    // （旧实现在开头就把整表删光，收集阶段一被中断相册就变成 0 张，
    //   而磁盘文件一个没少 —— 这就是「文件夹里照片还在、相册却空了」的成因。）
    if (task.scanned >= files.length) {
      const foundPaths = new Set(files.map(f => f.full));
      await deletePhotosNotIn(conn, albumId, task, foundPaths, slug, complete);
    }

    conn.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now(), albumId);
    // 跑完了：清掉持久化记录（下次不需要续扫）
    persistScanClear(conn, albumId, task.token);
  } finally {
    // 扫描中途抛错时走不到 persistScanClear，节流计数会留在 Map 里。
    // 每次失败积一条、key 里带 token 不复用 —— 只清计数不影响续扫所需的库记录。
    persistCounters.delete(`${albumId}:${task.token || 0}`);
    if (onProgress) onProgress(task);
  }
}

// ---- 增量扫描：只扫描变动/新增文件，清理已删除文件 ----
async function incrementalScan(conn, albumId, resumeFrom, slug, onProgress, token) {
  const album = conn.prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
  if (!album) return;
  if (album.kind === 'virtual') return;

  const resuming = !!resumeFrom;
  const task = newTask('incremental', token);
  // 与 fullScan 同理：这一行由主进程在派活时写好（claimScanTask），
  // 子进程只推进断点，不重写 state（否则会抹掉主进程写的停止/暂停指令）。
  if (resuming) persistScanProgress(conn, albumId, task.token, 'incremental', 'process', resumeFrom, 0, 0, true);

  try {
    const insert = conn.prepare('INSERT OR IGNORE INTO album_photos (album_id, file_path, file_name, file_size, mtime, photo_date, exif_date, date_src) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const updateMeta = conn.prepare('UPDATE album_photos SET file_name = ?, file_size = ?, mtime = ?, photo_date = ?, exif_date = ?, date_src = ? WHERE id = ?');
    const deletePhoto = conn.prepare('DELETE FROM album_photos WHERE id = ?');
    const thumbWriter = createThumbWriter(conn);

    // 1. 建立现有索引映射：file_path → 记录
    // thumb_path / thumb_v 也要取出来：清理已删文件时要删缩略图缓存，续扫补缺时要看缩略图在不在
    const existing = new Map();
    for (const r of conn.prepare('SELECT id, file_path, file_name, file_size, mtime, thumb_path, thumb_v, date_src FROM album_photos WHERE album_id = ?').all(albumId)) {
      existing.set(r.file_path, r);
    }

    const foundPaths = new Set();

    // 递归扫整个目录树（含子文件夹），与全量扫描同一套遍历
    //
    // collectMediaFiles 返回 null 表示「收集阶段被停止/暂停中断」。
    // 这里必须**立刻放弃本轮**，不能把它兜成空数组继续往下走 ——
    // 空清单会让末尾的「清理已删除文件」把索引里所有行都判为「磁盘上已不存在」，
    // 于是把整个相册的索引删光（数据丢失）。这是空清单兜底最危险的地方。
    const collected = await collectMediaFiles(album.folder_path, task, conn, albumId);
    if (collected === null) {
      // 被中断：不改索引（保留原有记录与断点），等用户续扫
      return;
    }
    const { files, complete } = collected;
    // 断点定位：从 resumeFrom 的**下一个**开始处理；找不到则从头开始。
    let startIdx = 0;
    if (resuming) {
      const at = files.findIndex(f => f.full === resumeFrom);
      startIdx = at >= 0 ? at + 1 : 0;
      // 补缺：断点之前的文件里可能有「索引已建但缩略图没生成成功」的，续扫回头补上
      if (startIdx > 0) {
        for (let i = 0; i < startIdx; i++) {
          const f = files[i];
          const old = existing.get(f.full);
          if (!old) continue;
          if (old.thumb_path && (old.thumb_v || 0) >= THUMB_VERSION) continue;
          const tp = await genThumb(old.id, f.full, VIDEO_EXT.test(f.name), slug);
          if (tp) thumbWriter.add(old.id, tp);
        }
      }
    }
    // 关键：foundPaths 必须是**全部**清单文件的路径，不能只含处理过的那部分。
    // 它用于末尾的「清理已删除文件」判断（索引里有、磁盘上没有 → 删索引）。
    // 若续扫时只填后半段，前半段已存在的文件会被误判为「已删除」而被清掉索引。
    for (const f of files) foundPaths.add(f.full);
    // 续扫时把已跳过的部分计入 scanned，进度条不会倒退
    task.scanned = startIdx;
    for (let i = startIdx; i < files.length; i++) {
      const { name, full } = files[i];
      if (!await waitWhilePaused(conn, task, albumId)) break;
      try {
        const st = await fsp.stat(full);
        const mtime = st.mtime.toISOString();
        const old = existing.get(full);

        if (old) {
          // 文件已存在：mtime 变了要重算日期；mtime 没变但还没按 EXIF 核过
          // （老库在改用 EXIF 之前建的索引，date_src 为空串）也补读一次，把日期纠正回来。
          // date_src 是 'exif' / 'none' 的行不再重复读盘 —— 每张图一次 metadata() 不便宜。
          // 'mtime' 是早期版本用文件时间兜底时写的值，现在不再采用，也要重新核一遍。
          if (old.mtime !== mtime || !old.date_src || old.date_src === 'mtime') {
            const isVideo = VIDEO_EXT.test(name);
            const when = await resolvePhotoDate(full, mtime, isVideo);
            updateMeta.run(name, st.size, mtime, when.date, when.exif, when.src, old.id);
            // 缩略图只在 mtime 真的变了才重建：仅补日期时图没变，重建是白费 CPU
            if (old.mtime !== mtime) {
              const tp = await genThumb(old.id, full, isVideo, slug);
              if (tp) thumbWriter.add(old.id, tp);
            }
          }
          // mtime 相同且已核过 EXIF 则跳过
        } else {
          // 新文件：插入索引 + 生成缩略图
          const isVideo = VIDEO_EXT.test(name);
          const when = await resolvePhotoDate(full, mtime, isVideo);
          const ri = insert.run(albumId, full, name, st.size, mtime, when.date, when.exif, when.src);
          // 同 fullScan：OR IGNORE 冲突时 lastInsertRowid 不可靠，回查真实 id
          let photoId = ri.lastInsertRowid;
          if (ri.changes === 0) {
            const row = conn.prepare('SELECT id FROM album_photos WHERE album_id = ? AND file_path = ?').get(albumId, full);
            if (!row) continue;
            photoId = row.id;
          }
          const tp = await genThumb(photoId, full, VIDEO_EXT.test(name), slug);
          if (tp) thumbWriter.add(photoId, tp);
        }
        // 「已遍历」计数必须覆盖跳过的未变文件：清理阶段用 scanned >= files.length 判断
        // 文件循环是否完整跑完。只在 mtime 变化/新插入时自增，会让一次「什么都没变」的
        // 增量扫描永远不触发「索引有、磁盘无」清理，用户删掉的照片索引行永久残留。
        task.scanned++;
        // 处理完这个文件才推进断点（中途崩溃时这个文件会重扫，代价很小）
        persistScanProgress(conn, albumId, task.token, 'incremental', 'process', full, task.scanned, task.total, false);
      } catch (_) {}
      if (task.scanned % SCAN_YIELD_EVERY === 0) {
        await yieldLoop();
        if (onProgress) onProgress(task);
      }
    }

    // 2. 清理已删除文件（索引存在但磁盘已不存在）
    //
    // 两个前提缺一不可，缺了就跳过清理（宁可索引里留几条陈旧记录，也不能凭空清空相册）：
    //   · 文件循环完整跑完 —— 被停止/暂停时只处理了清单的一部分，
    //     拿部分清单判断「已删除」会把还没扫到的那半片索引全删掉；
    //   · 收集阶段没读不到任何目录（complete）—— 有目录读不到时清单是残缺的
    //     （权限、OneDrive 占位未落地、网络盘抖动），读不到的那片会被误判成「已删除」。
    if (task.scanned >= files.length && complete) {
      for (const [filePath, record] of existing) {
        if (!foundPaths.has(filePath)) {
          // 缩略图缓存：按库隔离路径删除，并清掉内存索引
          albumThumbs.forgetPhoto(slug, record.id);
          await Promise.all([
            fsp.unlink(albumThumbs.thumbPathFor(slug, record.id)).catch(() => {}),
            record.thumb_path ? fsp.unlink(record.thumb_path).catch(() => {}) : null,
          ]);
          deletePhoto.run(record.id);
          // 清理循环也可能一次删掉很多行，同样分批让出。
          if (record.id % SCAN_YIELD_EVERY === 0) await yieldLoop();
        }
      }
    }
    thumbWriter.flush();

    conn.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now(), albumId);
    // 跑完了：清掉持久化记录（下次不需要续扫）
    persistScanClear(conn, albumId, task.token);
  } finally {
    // 扫描中途抛错时走不到 persistScanClear，节流计数会留在 Map 里。
    // 每次失败积一条、key 里带 token 不复用 —— 只清计数不影响续扫所需的库记录。
    persistCounters.delete(`${albumId}:${task.token || 0}`);
    if (onProgress) onProgress(task);
  }
}

// ---- 虚拟相册刷新：只按**已有索引**更新照片信息与缩略图 ----
//
// 为什么虚拟相册要单独一套：它不绑定文件夹（folder_path 为空），没有目录可遍历，
// 所以 fullScan / incrementalScan 都在入口直接 return。但它的索引行同样是「过期」的：
//   · 建虚拟相册时是从别的相册**拷贝**索引，拷来的是拷贝那一刻的 photo_date；
//     之后源相册补读了 EXIF、或 THUMB_VERSION 升了要重建缩略图，虚拟相册这边都不会自动跟上。
//   · 用户手动把照片移入虚拟相册时同理。
// 于是给它一条「按索引刷新」的路径：**不碰磁盘结构、不新增不删除行**，
// 只逐行把该更新的字段（拍摄时间 / 文件名 / 大小 / mtime / 缩略图）补齐。
//
// 与文件夹相册扫描的关键差异（别混）：
//   · 不遍历文件夹、不收集清单 —— 数据源就是 album_photos 现有的行；
//   · **不删任何行**：磁盘上文件是否还在不归它管（有别的相册负责索引），
//     这里只「刷新」；真删了文件由源相册那边删自己的索引，虚拟相册下次刷新会跳过读不到的行；
//   · 源文件已不存在时只跳过该行（不删行），否则虚拟相册会因为别的相册挪了文件而丢照片；
//   · 断点用**行 id**（`done_id`）而非文件路径：索引行是稳定的，路径可能变。
async function refreshVirtual(conn, albumId, resumeFrom, slug, onProgress, token) {
  const album = conn.prepare('SELECT * FROM albums WHERE id = ?').get(albumId);
  if (!album) return;
  // 只处理虚拟相册；文件夹相册请走 fullScan / incrementalScan
  if (album.kind !== 'virtual') return;

  const task = newTask('virtual', token);
  // 虚拟相册的断点是「已处理到的最后一个行 id」，从它的下一个接着走。
  // 用 id 而非文件路径：索引行的主键稳定，路径可能因文件被移动而变。
  let cursor = Number(resumeFrom) || 0;
  const pick = conn.prepare(`
    SELECT id, file_path, file_name, file_size, mtime, photo_date, exif_date, date_src, thumb_path, thumb_v
    FROM album_photos WHERE album_id = ? AND id > ? ORDER BY id ASC LIMIT ?
  `);
  const updateMeta = conn.prepare('UPDATE album_photos SET file_name = ?, file_size = ?, mtime = ?, photo_date = ?, exif_date = ?, date_src = ? WHERE id = ?');
  const thumbWriter = createThumbWriter(conn);

  try {
    // 先数一遍总数，进度条才有分母（表不大，但比逐轮 LIMIT 计数稳）
    task.total = conn.prepare('SELECT COUNT(*) AS c FROM album_photos WHERE album_id = ?').get(albumId).c;
    // 续扫时把已跳过的部分计入 scanned，进度条不会倒退
    task.scanned = cursor;
    for (;;) {
      if (!await waitWhilePaused(conn, task, albumId)) break;
      const rows = pick.all(albumId, cursor, DELETE_BATCH);
      if (!rows.length) break;
      let progressed = 0;
      for (const r of rows) {
        cursor = r.id;
        progressed++;
        // 续扫时只处理 id 大于断点的行；cursor 已推进，断点之外的不会被重复处理
        let st = null;
        try {
          st = await fsp.stat(r.file_path);
        } catch (_) {
          // 源文件已不存在：跳过这一行，**不删索引** ——
          // 虚拟相册的索引是拷贝来的，文件是否还在由源相册的扫描负责判断，
          // 在这里删行会导致「源相册挪走文件 = 虚拟相册丢照片」。
          task.scanned++;
          continue;
        }
        const isVideo = VIDEO_EXT.test(r.file_name || '');
        const mtime = st.mtime.toISOString();
        const metaChanged = r.mtime !== mtime || r.file_size !== st.size || r.file_name !== path.basename(r.file_path);
        const needDate = !r.date_src || r.date_src === 'mtime'; // 没核过 / 早期 mtime 兜底值
        const needThumb = !r.thumb_path || (r.thumb_v || 0) < THUMB_VERSION;
        // 三样都没差就别读盘也别写库（这一步决定了重复点刷新会不会白跑一遍全表）
        if (metaChanged || needDate || needThumb) {
          const when = needDate ? await resolvePhotoDate(r.file_path, mtime, isVideo) : { date: r.photo_date, exif: r.exif_date, src: r.date_src };
          if (metaChanged || needDate) {
            updateMeta.run(path.basename(r.file_path), st.size, mtime, when.date, when.exif, when.src, r.id);
          }
          // 缩略图按**当前行 id** 生成（路径是 {slug}/{id}.jpg），与源相册各自一份，互不覆盖
          if (needThumb) {
            const tp = await genThumb(r.id, r.file_path, isVideo, slug);
            if (tp) thumbWriter.add(r.id, tp);
          }
        }
        task.scanned++;
        persistScanProgress(conn, albumId, task.token, 'virtual', 'process', String(cursor), task.scanned, task.total, false);
      }
      await yieldLoop();
      if (onProgress) onProgress(task);
      if (!progressed) break;
    }
    thumbWriter.flush();
    conn.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now(), albumId);
    persistScanClear(conn, albumId, task.token);
  } finally {
    // 扫描中途抛错时走不到 persistScanClear，节流计数会留在 Map 里。
    // 每次失败积一条、key 里带 token 不复用 —— 只清计数不影响续扫所需的库记录。
    persistCounters.delete(`${albumId}:${task.token || 0}`);
    if (onProgress) onProgress(task);
  }
}

module.exports = {
  THUMB_SIZE, THUMB_QUALITY, THUMB_VERSION,
  IMG_EXT, VIDEO_EXT, DELETE_BATCH, SCAN_YIELD_EVERY, THUMB_WRITE_BATCH, PERSIST_EVERY,
  yieldLoop, mediaTypeOf, dateKey, resolvePhotoDate,
  genThumb, thumbOf, createThumbWriter, genThumbsByIds,
  claimScanTask, persistScanProgress, persistScanClear,
  readPendingScanTasks, readScanTask, setScanState,
  waitWhilePaused, walkMediaFiles, collectMediaFiles, deletePhotosNotIn,
  newTask, fullScan, incrementalScan, refreshVirtual,
};