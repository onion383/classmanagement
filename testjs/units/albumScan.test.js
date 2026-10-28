// 相册扫描的「索引被误删/清空」防护（albumScan.js 的 collectMediaFiles / deletePhotosNotIn）
//
// 回归的真实故障：文件夹里的照片一张没少，相册却是 0 张。
// 成因是全量扫描「先把索引删光、再收集磁盘清单」，收集阶段一被停止/暂停/进程被杀，
// 索引已经是空的而新索引一条没写；另一条路径是目录读不到被静默吞掉，
// 残缺清单让「清理已删除文件」把整片目录的索引误判成已删除。
//
// 运行：npm run test:units
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const fsp = fs.promises
const test = require('node:test')
const assert = require('node:assert/strict')

const tmpDir = path.join(os.tmpdir(), 'album-scan-unit-' + process.pid)
process.env.DB_MASTER_KEY = process.env.DB_MASTER_KEY || 'unit-test-master-key'
process.env.DATA_DIR = process.env.DATA_DIR || tmpDir

const {
  collectMediaFiles, deletePhotosNotIn, incrementalScan, fullScan,
} = require('../../student-backend/albumScan')
const { getDatabase } = require('../../student-backend/dbManager/dbManager.base')

function newTask(mode) {
  return { cancelled: false, paused: false, scanned: 0, total: 0, mode, token: 1, startedAt: '' }
}

// 等价的连接替身：只实现这几个函数用到的 prepare/all/get/run，
// 让测试不碰真实加密库（真实连接要主密钥 + 完整 schema）。
function makeConn() {
  const rows = []           // { id, album_id, file_path, thumb_path }
  let nextId = 1
  const log = { deleted: [] }
  const conn = {
    log,
    seed(albumId, paths) {
      for (const p of paths) rows.push({ id: nextId++, album_id: albumId, file_path: p, thumb_path: '' })
    },
    count(albumId) { return rows.filter(r => r.album_id === albumId).length },
    paths(albumId) { return rows.filter(r => r.album_id === albumId).map(r => r.file_path) },
    prepare(sql) {
      if (/FROM album_scan_tasks/.test(sql)) {
        // waitWhilePaused 每 300ms 读一次任务表；返回 running 才不会把扫描判成取消
        return { get: () => ({ state: 'running', token: 1, done_path: '', scanned: 0, total: 0 }) }
      }
      if (/SELECT id, file_path, thumb_path/.test(sql)) {
        return { all: (albumId, cursor, limit) => rows
          .filter(r => r.album_id === albumId && r.id > cursor)
          .sort((a, b) => a.id - b.id)
          .slice(0, limit)
          .map(r => ({ id: r.id, file_path: r.file_path, thumb_path: r.thumb_path })) }
      }
      if (/SELECT \* FROM albums/.test(sql)) {
        return { get: () => ({ id: 1, kind: 'folder', folder_path: '' }) }
      }
      if (/DELETE FROM album_photos WHERE id = \?$/.test(sql.trim())) {
        return { run: (id) => {
          const i = rows.findIndex(r => r.id === id)
          if (i >= 0) { log.deleted.push(rows[i].file_path); rows.splice(i, 1); return { changes: 1 } }
          return { changes: 0 }
        } }
      }
      if (/UPDATE albums SET updated_at/.test(sql)) return { run: () => ({ changes: 1 }) }
      return { all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }
    },
  }
  return conn
}

test('collectMediaFiles：根目录读不到时 complete=false（不再静默吞掉）', async () => {
  // 用「不存在的路径」触发 readdir 抛错：确定性地覆盖「目录读不到」这条分支。
  // 早先这里用 icacls 造 deny 规则，但在有管理员权限的环境下 deny 可能被绕过，
  // 导致 complete 仍为 true 而断言偶发失败 —— 故改为不依赖权限的写法。
  const missing = path.join(tmpDir, 'no-such-dir-' + Date.now())
  const r = await collectMediaFiles(missing, newTask('incremental'), null, 1)
  assert.ok(r, '收集不应返回 null（null 只表示被停止/暂停）')
  assert.deepEqual(r.files, [], '读不到目录时清单为空')
  assert.equal(r.complete, false, '有目录读不到时 complete 必须是 false')
})

test('collectMediaFiles：目录全部可读时 complete=true', async () => {
  const root = path.join(tmpDir, 'readable')
  await fsp.mkdir(path.join(root, 'sub'), { recursive: true })
  await fsp.writeFile(path.join(root, 'a.jpg'), 'x')
  await fsp.writeFile(path.join(root, 'sub', 'b.jpg'), 'x')
  await fsp.writeFile(path.join(root, 'note.txt'), 'x')   // 非媒体文件，应被跳过
  const r = await collectMediaFiles(root, newTask('incremental'), null, 1)
  assert.equal(r.complete, true)
  assert.deepEqual(r.files.map(f => f.name).sort(), ['a.jpg', 'b.jpg'])
  await fsp.rm(root, { recursive: true, force: true })
})

test('deletePhotosNotIn：只删磁盘清单外的行，文件还在的一律保留', async () => {
  const conn = makeConn()
  conn.seed(1, ['D:/p/a.jpg', 'D:/p/b.jpg', 'D:/p/gone.jpg'])
  const found = new Set(['D:/p/a.jpg', 'D:/p/b.jpg'])
  await deletePhotosNotIn(conn, 1, newTask('full'), found, 'testslug', true)
  assert.deepEqual(conn.paths(1).sort(), ['D:/p/a.jpg', 'D:/p/b.jpg'])
  assert.deepEqual(conn.log.deleted, ['D:/p/gone.jpg'])
})

test('deletePhotosNotIn：清单不可信（trust=false）时一行都不删', async () => {
  const conn = makeConn()
  conn.seed(1, ['D:/p/a.jpg', 'D:/p/b.jpg'])
  await deletePhotosNotIn(conn, 1, newTask('full'), new Set(['D:/p/a.jpg']), 'testslug', false)
  assert.equal(conn.count(1), 2, '残缺清单下必须保留全部索引，不能误删')
  assert.equal(conn.log.deleted.length, 0)
})

test('deletePhotosNotIn：清单为空且可信 → 全删（用户确实清空了文件夹）', async () => {
  const conn = makeConn()
  conn.seed(1, ['D:/p/a.jpg', 'D:/p/b.jpg'])
  await deletePhotosNotIn(conn, 1, newTask('full'), new Set(), 'testslug', true)
  assert.equal(conn.count(1), 0)
})

// 注：原先这里有两段「恒真断言」用例（收集返回 null 时不删索引 / scanned 不足时不清理），
// 它们只是把产品代码里的判断条件抄了一遍，从不调用被测函数，等于没有回归价值。
// 已替换为下面真正驱动 incrementalScan 的用例：用临时目录 + 连接替身验证
// 「未变文件也计入 scanned，磁盘已删文件的索引会被清理」。

test('incrementalScan：未变文件也计入遍历数，磁盘已删的照片索引会被清理', async () => {
  // 回归 B04-11：task.scanned 原先只在「mtime 变化 / 新插入」时自增，
  // 一次「什么都没变」的增量扫描永远满足不了 scanned >= files.length，
  // 于是「索引有、磁盘无」的行永远不会被清理。
  const dir = await fsp.mkdtemp(path.join(tmpDir, 'incremental-'))
  const keep = path.join(dir, 'keep.jpg')
  await fsp.writeFile(keep, 'x')
  const st = await fsp.stat(keep)
  const keptRow = {
    id: 1, file_path: keep, file_name: 'keep.jpg', file_size: st.size,
    mtime: st.mtime.toISOString(), thumb_path: '', thumb_v: 0, date_src: 'exif',
  }
  const goneRow = {
    id: 2, file_path: path.join(dir, 'gone.jpg'), file_name: 'gone.jpg', file_size: 1,
    mtime: '2000-01-01T00:00:00.000Z', thumb_path: '', thumb_v: 0, date_src: 'exif',
  }
  const rows = [keptRow, goneRow]

  const conn = {
    prepare(sql) {
      const s = sql.trim()
      if (/FROM album_scan_tasks/.test(s)) {
        return { get: () => ({ state: 'running', token: 1, done_path: '', scanned: 0, total: 0 }) }
      }
      if (/FROM albums/.test(s)) return { get: () => ({ id: 1, kind: 'folder', folder_path: dir }) }
      if (/FROM album_photos WHERE album_id = \?$/.test(s)) return { all: () => rows.map((r) => ({ ...r })) }
      if (/DELETE FROM album_photos WHERE id = \?/.test(s)) {
        return { run: (id) => {
          const i = rows.findIndex((r) => r.id === id)
          if (i < 0) return { changes: 0 }
          rows.splice(i, 1)
          return { changes: 1 }
        } }
      }
      return { all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }
    },
    // 本用例不会产生缩略图写入（mtime 未变、date_src 已是 exif），事务兜底即可
    transaction(fn) { return fn },
  }

  await incrementalScan(conn, 1, '', 'testslug', null, 1)

  assert.equal(rows.length, 1, '磁盘上已不存在的照片索引必须被清理')
  assert.equal(rows[0].id, 1, '仍在磁盘上的照片索引必须保留')
  await fsp.rm(dir, { recursive: true, force: true })
})

test.after(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
})