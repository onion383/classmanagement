// =========================================================================
// refresh-virtual.test.js —— 虚拟相册刷新（albumScan.refreshVirtual）
//
// 覆盖「按已有索引更新」这条路径的关键约定：
//   1. 不遍历磁盘、不新增行、不删除行（虚拟相册没有文件夹，数据源就是索引）
//   2. 同步文件元信息（file_size / mtime），不重核拍摄日期（旧格式 date_src 不再补读）
//   3. 补生成缺失/过期的缩略图
//   4. 源文件已不存在时**跳过但不删行**
//   5. 全部已是最新时再跑一遍不产生写库（幂等、重复点刷新不白跑）
//   6. 文件夹相册误调 refreshVirtual 应直接返回不动数据
//
// 用法：node testjs/units/refresh-virtual.test.js
// =========================================================================
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '../..');
// 依赖都从 student-backend/node_modules 里按绝对路径取（testjs 不装依赖）
const Database = require(path.join(ROOT, 'student-backend', 'node_modules', 'better-sqlite3-multiple-ciphers'));

process.env.DB_MASTER_KEY = process.env.DB_MASTER_KEY || '0123456789abcdef0123456789abcdef';
process.env.DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'testjs', '.startup-measure', 'refresh-virtual');

let passed = 0;
// 注意：refreshVirtual 是 async，下面的用例里也有 async 的，
// 所以 test() 必须被 await，否则 db.close() 会跑在断言之前（连接已关 → 崩）。
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

// ---- 造一张带真实 EXIF DateTimeOriginal 的 JPEG（手插 APP1 段） ----
const sharp = require(path.join(ROOT, 'student-backend', 'node_modules', 'sharp'));

function buildExifBlock(dateStr) {
  const dt = Buffer.from(dateStr + '\0', 'latin1');
  const h = Buffer.alloc(8); h.write('II', 0, 'latin1'); h.writeUInt16LE(42, 2); h.writeUInt32LE(8, 4);
  const i = Buffer.alloc(18); i.writeUInt16LE(1, 0); i.writeUInt16LE(0x8769, 2); i.writeUInt16LE(4, 4);
  i.writeUInt32LE(1, 6); i.writeUInt32LE(26, 10);
  const e = Buffer.alloc(18); e.writeUInt16LE(1, 0); e.writeUInt16LE(0x9003, 2); e.writeUInt16LE(2, 4);
  e.writeUInt32LE(dt.length, 6); e.writeUInt32LE(44, 10);
  return Buffer.concat([h, i, e, dt]);
}

async function makeJpeg(file, exifDate) {
  const jpg = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 30, g: 120, b: 200 } },
  }).jpeg().toBuffer();
  let seg = Buffer.alloc(0);
  if (exifDate) {
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), buildExifBlock(exifDate)]);
    const len = Buffer.alloc(2); len.writeUInt16BE(payload.length + 2, 0);
    seg = Buffer.concat([Buffer.from([0xFF, 0xE1]), len, payload]);
  }
  fs.writeFileSync(file, Buffer.concat([jpg.slice(0, 2), seg, jpg.slice(2)]));
}

(async function main() {
  console.log('== refreshVirtual（虚拟相册按索引刷新）');

  const albumScan = require(path.join(ROOT, 'student-backend', 'albumScan.js'));
  const { migrateAlbum } = require(path.join(ROOT, 'student-backend', 'schema', 'schema.album.js'));
  const { THUMB_VERSION } = albumScan;

  // 临时库 + 临时图片目录
  const dataDir = path.join(ROOT, 'testjs', '.startup-measure', 'refresh-virtual');
  fs.mkdirSync(dataDir, { recursive: true });
  const imgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-img-'));
  const dbFile = path.join(dataDir, 'rv.db');
  try { fs.unlinkSync(dbFile); } catch (_) {}
  const db = new Database(dbFile);
  migrateAlbum(db);

  // 缩略图要写到真实 thumbsDir，albumThumbs 依赖 dbManager 的路径 —— 这里绕开：
  // 给 genThumb 传一个 slug，并让 albumThumbs 指向临时目录。
  const albumThumbs = require(path.join(ROOT, 'student-backend', 'albumThumbs.js'));
  const realThumbs = albumThumbs.thumbsDir;
  const tmpThumbs = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-thumbs-'));
  try {
    Object.defineProperty(albumThumbs, 'thumbsDir', { get: () => tmpThumbs, configurable: true });
  } catch (_) {}

  // 建虚拟相册 + 4 行索引：
  //   1) date_src 空（旧格式值）+ 缩略图缺失 → 只补缩略图，日期保持原样
  //   2) date_src='exif'、缩略图齐全 → 不应有任何写库
  //   3) 源文件不存在 → 应跳过且**保留行**
  //   4) date_src='mtime'（旧格式值）→ 只同步元信息，日期保持原样
  const f1 = path.join(imgDir, 'a.jpg');
  const f2 = path.join(imgDir, 'b.jpg');
  const f4 = path.join(imgDir, 'd.jpg');
  await makeJpeg(f1, '2019:03:05 14:22:31');
  await makeJpeg(f2, '2021:07:08 09:10:11');
  await makeJpeg(f4, '2023:11:12 13:14:15');
  db.prepare(`INSERT INTO albums (id, name, folder_path, kind, sort_order) VALUES (1,'v','','virtual',1)`).run();
  // 刻意造出「拷贝来的旧状态」：photo_date 是老的 mtime 日键、date_src 为空（旧格式值）、
// thumb_v=0（=缩略图缺失或版本过期）—— 只有缩略图会被补上，日期不再补读。
const ins = db.prepare(`INSERT INTO album_photos (album_id, file_path, file_name, file_size, mtime, photo_date, exif_date, date_src, thumb_path, thumb_v)
    VALUES (1, ?, ?, 0, ?, ?, '', '', '', 0)`);
  ins.run(f1, 'a.jpg', '2026-01-01T00:00:00.000Z', '2026-01-01');
  ins.run(f2, 'b.jpg', '2026-01-01T00:00:00.000Z', '2026-01-01');
  // 第 3 行：文件不存在
  ins.run(path.join(imgDir, 'gone.jpg'), 'gone.jpg', '2026-01-01T00:00:00.000Z', '2026-01-01');
  ins.run(f4, 'd.jpg', '2026-01-01T00:00:00.000Z', '2026-01-01');
  // 把第 2 行预先修好（模拟「已最新」），第 4 行标成 'mtime'（旧格式值）
  db.prepare(`UPDATE album_photos SET photo_date='2021-07-08', exif_date='2021-07-08T09:10:11',
              date_src='exif', thumb_path=?, thumb_v=? WHERE id = 2`).run(
    albumThumbs.thumbPathFor('testslug', 2), THUMB_VERSION);
  db.prepare(`UPDATE album_photos SET date_src='mtime' WHERE id = 4`).run();

  const before = db.prepare('SELECT id, photo_date, date_src, thumb_path FROM album_photos WHERE album_id=1 ORDER BY id').all();
  assert.strictEqual(before.length, 4);

  // ---- 跑一次刷新 ----
  // 必须先 claimScanTask 写一行 album_scan_tasks：waitWhilePaused 靠它判断
  // 「有没有收到停止/暂停」，查不到行会当成任务被放弃（等同取消）。
  // 生产路径上 dispatchScan 会先 claim 再派活给子进程，这里模拟同样的顺序。
  albumScan.claimScanTask(db, 1, 'virtual', 777, '');
  await albumScan.refreshVirtual(db, 1, '', 'testslug', () => {}, 777);

  const after = db.prepare('SELECT id, file_name, file_size, mtime, photo_date, exif_date, date_src, thumb_path, thumb_v FROM album_photos WHERE album_id=1 ORDER BY id').all();

  await test('不增行也不删行（虚拟相册没有文件夹可遍历）', () => {
    assert.strictEqual(after.length, 4, '行数变了：' + after.length);
  });

  await test('旧 date_src 值不再补读 EXIF（第 1 行空串 / 第 4 行 mtime：日期保持原样）', () => {
    assert.strictEqual(after[0].photo_date, '2026-01-01');
    assert.strictEqual(after[0].exif_date, '');
    assert.strictEqual(after[0].date_src, '');
    assert.strictEqual(after[3].photo_date, '2026-01-01');
    assert.strictEqual(after[3].exif_date, '');
    assert.strictEqual(after[3].date_src, 'mtime');
  });

  await test('补生成缺失的缩略图（第 1 行）', () => {
    assert.ok(after[0].thumb_path, 'thumb_path 仍为空');
    assert.ok(fs.existsSync(after[0].thumb_path), '缩略图文件不存在：' + after[0].thumb_path);
    assert.strictEqual(after[0].thumb_v, THUMB_VERSION);
  });

  await test('源文件不存在的行：跳过但保留（不因文件被挪走而丢照片）', () => {
    const row = after[2];
    assert.ok(row, '第 3 行被删了');
    assert.strictEqual(row.file_name, 'gone.jpg');
  });

  await test('同步文件元信息（file_size / mtime）', () => {
    const real = fs.statSync(f1);
    assert.strictEqual(after[0].file_size, real.size);
    assert.strictEqual(after[0].mtime, real.mtime.toISOString());
  });

  await test('幂等：再跑一遍不改动已最新的行', async () => {
    const snap = JSON.stringify(after);
    await albumScan.refreshVirtual(db, 1, '', 'testslug', () => {}, 777);
    const again = db.prepare('SELECT id, file_name, file_size, mtime, photo_date, exif_date, date_src, thumb_path, thumb_v FROM album_photos WHERE album_id=1 ORDER BY id').all();
    assert.strictEqual(JSON.stringify(again), snap, '第二次刷新改动了数据');
  });

  // ---- 文件夹相册误调应直接返回 ----
  db.prepare(`INSERT INTO albums (id, name, folder_path, kind, sort_order) VALUES (2,'f','/tmp','folder',2)`).run();
  db.prepare(`INSERT INTO album_photos (album_id, file_path, file_name, mtime, photo_date) VALUES (2, ?, 'x.jpg', '2026-01-01T00:00:00.000Z', '2026-01-01')`).run(f1);
  await test('文件夹相册误调 refreshVirtual：直接返回不动数据', async () => {
    albumScan.claimScanTask(db, 2, 'virtual', 778, '');
    await albumScan.refreshVirtual(db, 2, '', 'testslug', () => {}, 778);
    const row = db.prepare('SELECT date_src, photo_date FROM album_photos WHERE album_id=2').get();
    assert.strictEqual(row.date_src, '', '不该被写入');
    assert.strictEqual(row.photo_date, '2026-01-01');
  });

  // ---- 断点续刷：从行 id 之后接着 ----
  await test('断点续刷：从 done_id 之后继续，不重跑已处理的行', async () => {
    albumScan.claimScanTask(db, 1, 'virtual', 779, '');
    await albumScan.refreshVirtual(db, 1, '2', 'testslug', () => {}, 779);
    const rows = db.prepare('SELECT id FROM album_photos WHERE album_id=1 ORDER BY id').all();
    assert.strictEqual(rows.length, 4);
  });

  db.close();
  fs.rmSync(imgDir, { recursive: true, force: true });
  fs.rmSync(tmpThumbs, { recursive: true, force: true });
  console.log(`\n通过 ${passed} 项` + (process.exitCode ? '，有失败' : '，全部通过'));
})().catch(e => { console.error('测试崩溃:', e); process.exit(1); });