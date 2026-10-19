// =========================================================================
// migration.js —— 数据目录搬迁引擎（带进度的校验 + 复制 / 复检）
//
// 由 main.js 调用：migrateDataDir(oldDir, target, send) 完成「校验源文件 → 复制（字节进度）→
// 复检（失败单拷 + 全局哈希）→ 写配置 → 删旧目录」。进度经注入的 send(payload) 出口推送
// （main.js 的 sendMigration）。迁移进度窗口的创建/关闭与各 IPC 通道注册仍保留在 main.js
// （便于与 preload 白名单对照），本模块只承载与结果无关的纯搬迁逻辑。
// 原实现内嵌于 main.js，此处为等价的纯搬运（仅把对 sendMigration 的引用改为注入参数）。
// =========================================================================

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const backend = require('./main.backend')
const { saveAppConfig } = require('./main.config')

// 异步 fs：主进程里凡是「可能慢」的磁盘操作（目录遍历、整目录复制/删除、大文件写盘）
// 一律走它，避免同步 IO 把事件循环堵住。
const fsp = fs.promises

// 路径是否存在（异步版 existsSync，语义一致：不区分文件/目录）
async function pathExists(p) {
  try { await fsp.access(p); return true } catch (_) { return false }
}

// 递归列出目录下所有文件（相对路径 + 绝对路径），顺序稳定。
// 【改为异步的原因】原来用 readdirSync 递归：搬迁时要把整个数据目录（含相册/缩略图，
// 动辄上千个文件）扫一遍，全部同步跑在主进程 —— 扫描期间窗口卡死、进度条不动。
// 异步版本把磁盘遍历交给 libuv 线程池，主进程只在每层目录之间让出事件循环。
async function listFilesRecursive(dir, prefix = '') {
  const out = []
  let entries
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch (_) { return out }
  for (const ent of entries) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...(await listFilesRecursive(full, rel)))
    else if (ent.isFile()) out.push({ rel, full })
  }
  return out
}

// 流式算文件 SHA-256，并按块回报已读字节（供进度条使用）
async function sha256FileAsync(file, onBytes) {
  const hash = crypto.createHash('sha256')
  const fh = await fsp.open(file, 'r')
  try {
    const buf = Buffer.allocUnsafe(1 << 20) // 1MB
    let pos = 0
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos)
      if (!bytesRead) break
      hash.update(buf.subarray(0, bytesRead))
      pos += bytesRead
      if (onBytes) onBytes(bytesRead)
    }
  } finally {
    await fh.close()
  }
  return hash.digest('hex')
}

// 复制单个文件，按块回报已写字节（供进度条使用）
async function copyFileAsync(src, dst, onBytes) {
  await fsp.mkdir(path.dirname(dst), { recursive: true })
  const rh = await fsp.open(src, 'r')
  const wh = await fsp.open(dst, 'w')
  try {
    const buf = Buffer.allocUnsafe(1 << 20)
    let pos = 0
    for (;;) {
      const { bytesRead } = await rh.read(buf, 0, buf.length, pos)
      if (!bytesRead) break
      await wh.write(buf, 0, bytesRead, pos)
      pos += bytesRead
      if (onBytes) onBytes(bytesRead)
    }
  } finally {
    await rh.close()
    await wh.close()
  }
}

// 建立目录清单：相对路径 → { size, hash }，并回报总文件数/总字节数（用于进度）
// 取大小也改成异步 + 分批并发（每批 32 个）：既不阻塞主进程，
// 也不会像 Promise.all(全部) 那样一次性把线程池队列灌满。
async function buildInventory(dir, onProgress) {
  const listed = await listFilesRecursive(dir)
  const files = []
  const STAT_CHUNK = 32
  for (let i = 0; i < listed.length; i += STAT_CHUNK) {
    const part = listed.slice(i, i + STAT_CHUNK)
    // 保持原语义：stat 失败直接抛出（与之前 statSync 抛错一致），不静默当 0 字节
    const stats = await Promise.all(part.map((f) => fsp.stat(f.full)))
    for (let j = 0; j < part.length; j++) files.push({ ...part[j], size: stats[j].size })
  }
  const totalFiles = files.length
  const totalBytes = files.reduce((s, f) => s + f.size, 0)
  const map = new Map()
  let doneFiles = 0
  let doneBytes = 0
  for (const f of files) {
    const hash = await sha256FileAsync(f.full, (n) => {
      doneBytes += n
      if (onProgress) onProgress(doneFiles, totalFiles, doneBytes, totalBytes)
    })
    map.set(f.rel, { size: f.size, hash })
    doneFiles += 1
    if (onProgress) onProgress(doneFiles, totalFiles, doneBytes, totalBytes)
  }
  return { map, totalFiles, totalBytes }
}

// 目录整体指纹：对所有文件（按路径排序）的 路径+大小+内容哈希 再算一次 SHA-256。
// 用于搬迁后做「全局哈希」兜底校验，能一并发现文件缺失、内容变化与多出文件。
function globalHashOf(inventory) {
  const hash = crypto.createHash('sha256')
  for (const rel of [...inventory.keys()].sort()) {
    const e = inventory.get(rel)
    hash.update(`${rel}\u0000${e.size}\u0000${e.hash}\n`)
  }
  return hash.digest('hex')
}

// 清空目录内容但保留目录本身（用于回滚时优先保留用户选定的目录）。
// 递归删除改为异步：目录里可能有上千个文件，同步 rm 会把主进程卡住。
async function clearDir(dir) {
  let entries = []
  try { entries = await fsp.readdir(dir) } catch (_) { return }
  for (const name of entries) {
    try { await fsp.rm(path.join(dir, name), { recursive: true, force: true }) } catch (_) {}
  }
}

// 进度上报节流：高频字节回调合并为最多每 60ms 一次 IPC，避免刷爆渲染进程。
// send(payload) 为注入的出口（main.js 的 sendMigration）。
function createProgressReporter(send) {
  let lastSent = 0
  let pending = null
  let timer = null
  const flush = () => {
    timer = null
    if (!pending) return
    send(pending)
    pending = null
    lastSent = Date.now()
  }
  return (payload, force = false) => {
    pending = payload
    const now = Date.now()
    if (force || now - lastSent >= 60) {
      if (timer) { clearTimeout(timer); timer = null }
      flush()
    } else if (!timer) {
      timer = setTimeout(flush, 60 - (now - lastSent))
    }
  }
}

// 执行数据目录整体搬迁：预检 → 校验源文件 → 复制（字节进度）→ 复检（失败文件单拷 + 全局哈希）→ 写配置。
// 任一步失败都抛错，由调用方清理目标目录、保留旧目录与旧配置并恢复后端。返回 { oldDirRemoved }。
// send：进度出口，由 main.js 注入（sendMigration）。
async function migrateDataDir(oldDir, target, send) {
  const report = createProgressReporter(send)
  const emit = (phase, filesDone, filesTotal, percent, detail) => {
    report({
      type: 'migration-progress',
      phase,
      filesDone,
      filesTotal,
      percent: Math.max(0, Math.min(100, Math.round(percent || 0))),
      detail,
    })
  }

  // ---- 阶段「校验文件」：建立源目录清单（有效性预检已在进入迁移前完成） ----
  if (!(await pathExists(oldDir))) throw new Error('当前数据目录不存在')

  // 停止后端，确保没有任何进程再读写这些数据库文件
  emit('校验文件', 0, 0, 0, '正在停止数据读写')
  await backend.stopBackendProcess()

  const source = await buildInventory(oldDir, (doneFiles, totalFiles, doneBytes, totalBytes) => {
    emit('校验文件', doneFiles, totalFiles, totalBytes ? (doneBytes / totalBytes) * 100 : (totalFiles ? 100 : 0), '正在校验现有数据完整性')
  })
  const sourceGlobal = globalHashOf(source.map)
  emit('校验文件', source.totalFiles, source.totalFiles, 100, '校验完成')
  await new Promise((r) => setImmediate(r))

  // ---- 阶段「复制文件」：按字节进度整体复制（文件级并发，最多 COPY_CONCURRENCY 个同时进行） ----
  // 并发上限写死为 3：小文件多时能明显提速；再往上会让并发文件互相抢磁盘、反而更慢。
  const COPY_CONCURRENCY = 3
  emit('复制文件', 0, source.totalFiles, 0, '正在复制文件')
  let copiedFiles = 0
  let copiedBytes = 0
  const rels = [...source.map.keys()]
  let nextIdx = 0
  // 每个 worker 从队列里不断取下一个文件复制，直到取空。
  // copiedBytes / copiedFiles 只增不减，且 emit 内部已把百分比钳制到 0~100，多文件同时回报也保持单调推进。
  const copyWorker = async () => {
    while (nextIdx < rels.length) {
      const rel = rels[nextIdx++]
      const src = path.join(oldDir, rel)
      const dst = path.join(target, rel)
      try {
        await copyFileAsync(src, dst, (n) => {
          copiedBytes += n
          emit('复制文件', copiedFiles, source.totalFiles, source.totalBytes ? (copiedBytes / source.totalBytes) * 100 : 100, `正在复制文件 ${Math.min(copiedFiles + 1, source.totalFiles)}/${source.totalFiles}`)
        })
      } catch (err) {
        console.warn('[main] 复制文件失败，稍后单独重试:', rel, err?.message || err)
      }
      copiedFiles += 1
      emit('复制文件', copiedFiles, source.totalFiles, source.totalBytes ? (copiedBytes / source.totalBytes) * 100 : 100)
      await new Promise((r) => setImmediate(r))
    }
  }
  await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, rels.length) }, () => copyWorker()))

  // ---- 阶段「校验文件」：复检复制结果 ----
  const verify = async () => {
    const targetInv = await buildInventory(target, (doneFiles, totalFiles, doneBytes, totalBytes) => {
      emit('校验文件', doneFiles, totalFiles, totalBytes ? (doneBytes / totalBytes) * 100 : (totalFiles ? 100 : 0), '正在校验复制后的文件')
    })
    const mismatched = []
    for (const [rel, info] of source.map) {
      const t = targetInv.map.get(rel)
      if (!t || t.size !== info.size || t.hash !== info.hash) mismatched.push(rel)
    }
    // 目标多出源没有的文件同样视为不一致（防止复制到别处/脏数据）
    for (const rel of targetInv.map.keys()) {
      if (!source.map.has(rel)) mismatched.push(rel)
    }
    return { mismatched, targetInv }
  }

  emit('校验文件', 0, source.totalFiles, 0, '正在校验复制结果')
  let result = await verify()

  // 若发现部分文件失败：单独再复制一次这些文件（多出的则删除），随后再复检
  if (result.mismatched.length > 0) {
    const total = result.mismatched.length
    emit('校验文件', 0, total, 0, `发现 ${total} 个文件不一致，正在单独重新复制`)
    let redone = 0
    for (const rel of result.mismatched) {
      const src = path.join(oldDir, rel)
      const dst = path.join(target, rel)
      try {
        if (await pathExists(src)) await copyFileAsync(src, dst)
        else await fsp.rm(dst, { recursive: true, force: true }) // 源不存在 → 多余文件，删掉
      } catch (err) {
        console.warn('[main] 重拷失败:', rel, err?.message || err)
      }
      redone += 1
      emit('校验文件', redone, total, (redone / total) * 100, '正在单独重新复制失败文件')
      await new Promise((r) => setImmediate(r))
    }
    result = await verify()
  }

  // 全局哈希兜底：源目录与目标目录的整体指纹必须完全一致
  if (result.mismatched.length > 0 || globalHashOf(result.targetInv.map) !== sourceGlobal) {
    throw new Error(`新目录校验不一致（${result.mismatched.length} 个文件），已保留旧目录`)
  }
  emit('校验文件', source.totalFiles, source.totalFiles, 100, '校验完成')

  // ---- 写配置：只有前面全部通过才切换；写失败则中止且不删旧目录 ----
  try {
    saveAppConfig({ dataDir: target })
  } catch (err) {
    throw new Error('配置文件写入失败，已中止搬迁并保留旧目录：' + (err?.message || err))
  }

  // ---- 删除旧目录：删不掉仅记为残留，不算搬迁失败 ----
  let oldDirRemoved = true
  try {
    // 异步递归删除：旧数据目录可能上千个文件，同步删会让界面在最后一步僵住
    await fsp.rm(oldDir, { recursive: true, force: true })
  } catch (err) {
    oldDirRemoved = false
    console.warn('[main] 旧数据目录删除失败（搬迁已完成，新目录可用，可手动清理）:', err?.message || err)
  }
  return { oldDirRemoved }
}

module.exports = {
  pathExists,
  listFilesRecursive,
  sha256FileAsync,
  copyFileAsync,
  buildInventory,
  globalHashOf,
  clearDir,
  createProgressReporter,
  migrateDataDir,
}
