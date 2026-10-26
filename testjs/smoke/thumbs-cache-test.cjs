/**
 * 缩略图索引的字节上限回归
 *
 * albumThumbs 的 indexBySlug 原本无上限（每库 Map<photoId, {path, v}> 单调增长），
 * 现在按估算字节封顶 30MB，超限从最老条目淘汰。
 *
 * 要验证的是「淘汰不会破坏功能」：命中率下降可以接受，但
 *   · indexBytes 不能超上限
 *   · 淘汰后 lookup 未命中应返回 ''（调用方退回磁盘检查），不是抛错
 *   · 覆盖写入不能重复计数
 *   · forgetPhoto / forgetAlbum 必须把计数扣回去
 *
 * 跑法：node testjs/thumbs-cache-test.cjs
 */
const crypto = require('node:crypto')
const path = require('node:path')
const fs = require('node:fs')

const DATA_DIR = path.join(__dirname, '..', 'tmp', 'thumbs-cache')
fs.rmSync(DATA_DIR, { recursive: true, force: true })
fs.mkdirSync(DATA_DIR, { recursive: true })
process.env.DATA_DIR = DATA_DIR
process.env.DB_MASTER_KEY = crypto.randomBytes(32).toString('base64')

let albumThumbs
try {
  albumThumbs = require('../../student-backend/albumThumbs')
} catch (e) {
  console.log('模块加载失败（可能需要更多初始化）：', e.message.slice(0, 120))
  process.exit(2)
}

const MAX = 30 * 1024 * 1024
let failed = 0
const check = (name, ok, detail) => {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : '  → ' + JSON.stringify(detail)}`)
}

// 用真实形态的路径（{dir}/cls/12345.jpg ≈ 80 字符）
const SLUG = 'class_2026_01'
const mkPath = (id) => path.join(DATA_DIR, 'thumbs', SLUG, `${id}.jpg`)

// ① 插入到超过上限
const N = 200000
const t0 = Date.now()
for (let i = 1; i <= N; i++) albumThumbs.rememberThumb(SLUG, i, mkPath(i), 4)
const insertMs = Date.now() - t0

const s1 = albumThumbs.cacheStats()
check(`插入 ${N} 条后 index_bytes 不超上限`, s1.index_bytes <= MAX, s1)
check('index_count 与 index_bytes 同步收缩（说明真的淘汰了）', s1.index_count < N, s1)
console.log(`    插入耗时 ${insertMs}ms，index_count=${s1.index_count}，index_bytes=${(s1.index_bytes / 1048576).toFixed(1)}MB`)

// ② 最新的条目必须还在（淘汰的是最老的）
const newest = albumThumbs.lookupThumb(SLUG, N, 4)
check('最新一条仍在索引里', newest === mkPath(N), { newest, expect: mkPath(N) })

// ③ 最老的条目应该已被淘汰 → 返回空串（调用方退回磁盘）
const oldest = albumThumbs.lookupThumb(SLUG, 1, 4)
check('最老一条已被淘汰（返回空串）', oldest === '', { oldest })

// ④ 覆盖写入不重复计数
const before = albumThumbs.cacheStats().index_bytes
albumThumbs.rememberThumb(SLUG, N, mkPath(N), 5)
const after = albumThumbs.cacheStats().index_bytes
check('覆盖同一条不增加计数', after === before, { before, after })

// ⑤ forgetPhoto 扣减
albumThumbs.forgetPhoto(SLUG, N)
const afterForget = albumThumbs.cacheStats()
check('forgetPhoto 后该条消失', albumThumbs.lookupThumb(SLUG, N, 5) === '', {})
check('forgetPhoto 后计数下降', afterForget.index_bytes < after, { after: after.index_bytes, now: afterForget.index_bytes })

// ⑥ forgetAlbum 清零该库
albumThumbs.forgetAlbum(SLUG)
const final = albumThumbs.cacheStats()
check('forgetAlbum 后该库索引清空', final.index_count === 0, final)
check('forgetAlbum 后总计数归零', final.index_bytes === 0, final)

// ⑦ 多库各自独立：一个库被淘汰不应影响另一个库的最新条目
albumThumbs.rememberThumb('other_db', 999, mkPath(999), 4)
const multi = albumThumbs.cacheStats()
check('另一库条目可正常写入并查到', albumThumbs.lookupThumb('other_db', 999, 4) === mkPath(999), multi)

console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}`)
fs.rmSync(DATA_DIR, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
