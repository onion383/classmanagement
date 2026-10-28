// 连接缓存 LRU（P1-15 / B04-01）：正在被请求使用的连接不能被驱逐关闭
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

// dbManager.base 在加载时校验主密钥；这里只测内存 LRU，不打开真实库
process.env.DB_MASTER_KEY = process.env.DB_MASTER_KEY || 'unit-test-master-key'
process.env.DATA_DIR = process.env.DATA_DIR || path.join(os.tmpdir(), 'db-conn-cache-' + process.pid)

const base = require('../../student-backend/dbManager/dbManager.base')

// 连接缓存是进程级单例：每个用例前后显式归零，未来并发/多文件执行也不会互相污染（B14-N2）
test.beforeEach(() => base._resetConnCacheForTest())
test.afterEach(() => base._resetConnCacheForTest())

function makeConn(slug, closed) {
  return { slug, close: () => closed.push(slug) }
}

test('LRU 驱逐：跳过在用的连接，优先关闭空闲的最旧连接', () => {
  base.connCache.clear()
  const closed = []
  const max = base.CONN_CACHE_MAX

  for (let i = 0; i < max; i++) base.setCachedConn(`s${i}`, makeConn(`s${i}`, closed))
  assert.equal(base.connCache.size, max)

  // 最旧的 s0 正在被请求使用
  base.beginConnUse('s0')
  base.setCachedConn('s_new', makeConn('s_new', closed))

  assert.equal(closed.includes('s0'), false, '在用连接不能被 close')
  assert.ok(closed.includes('s1'), '应优先驱逐次旧的空闲连接')
  assert.equal(base.connCache.has('s0'), true)
  assert.equal(base.connCache.has('s1'), false)

  // 释放后：随着后续写入，s0 最终会变成最旧并被正常驱逐
  base.endConnUse('s0')
  let evictedS0 = false
  for (let i = 0; i < max + 4 && !evictedS0; i++) {
    base.setCachedConn(`extra${i}`, makeConn(`extra${i}`, closed))
    evictedS0 = closed.includes('s0')
  }
  assert.ok(evictedS0, '空闲后 s0 最终应被驱逐')

  // 清理，避免影响同进程内的其它用例
  for (const c of base.connCache.values()) { try { c.close() } catch (_) { /* 已关闭 */ } }
  base.connCache.clear()
})

test('LRU 驱逐：全部在用时可临时超限且不 close，释放后随写入收缩回上限', () => {
  base.connCache.clear()
  const closed = []
  const max = base.CONN_CACHE_MAX

  // 建满上限，并让每个连接都处于「请求使用中」
  for (let i = 0; i < max; i++) {
    const slug = `busy${i}`
    base.setCachedConn(slug, makeConn(slug, closed))
    base.beginConnUse(slug)
  }
  // 再插入一个（对应「11 个库同时都有请求在跑」）：没有空闲连接可驱逐 → 只能临时超限；
  // 刚插入的这条正要被当前请求使用，也不能被当成「空闲最旧」直接关掉
  base.setCachedConn('busy_extra', makeConn('busy_extra', closed))
  assert.deepEqual(closed, [], '不该 close 任何在用或刚插入的连接')
  assert.equal(base.connCache.has('busy_extra'), true, '刚插入的连接不能被立刻驱逐')
  assert.equal(base.connCache.size, max + 1, `全部在用时应临时超限，实际 ${base.connCache.size}`)

  // 全部释放后，后续写入应把缓存收缩回上限以内
  for (let i = 0; i < max; i++) base.endConnUse(`busy${i}`)
  for (let i = 1; i <= max + 2 && base.connCache.size > max; i++) {
    base.setCachedConn(`after${i}`, makeConn(`after${i}`, closed))
  }
  assert.ok(base.connCache.size <= max, `释放后缓存应回落至上限以内，实际 ${base.connCache.size}`)

  // 清理
  for (const c of base.connCache.values()) { try { c.close() } catch (_) { /* 已关闭 */ } }
  base.connCache.clear()
})

test('LRU 硬顶：全部在用且达到硬顶时拒绝新连接，不无限增长', () => {
  base.connCache.clear()
  const closed = []
  for (let i = 0; i < base.CONN_CACHE_HARD_MAX; i++) {
    const slug = `hard${i}`
    base.setCachedConn(slug, makeConn(slug, closed))
    base.beginConnUse(slug)
  }
  assert.equal(base.connCache.size, base.CONN_CACHE_HARD_MAX)
  assert.throws(
    () => base.setCachedConn('hard_extra', makeConn('hard_extra', closed)),
    /连接过多/
  )
  assert.equal(base.connCache.has('hard_extra'), false, '被拒绝的新连接不能留在缓存里')
  assert.equal(base.connCache.size, base.CONN_CACHE_HARD_MAX)
  assert.deepEqual(closed, [], '硬顶拒绝不能用 close 在途连接来腾位置')

  for (const c of base.connCache.values()) { try { c.close() } catch (_) { /* 已关闭 */ } }
  base.connCache.clear()
})
