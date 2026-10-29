// =========================================================================
// serialSaver.test.js —— 串行保存器行为（并发合并 / 失败语义）
//
// 运行：npm run test:behavior
// 被测：student-frontend/src/utils/serialSaver.js
// 这是页面「每次编辑就 PUT 整块」的保存基础设施，行为契约：
//   · 同一时刻最多一个保存请求在途；
//   · 在途期间追加的更新合并成一轮（用 saveFn 读最新状态再存）；
//   · request() 永不 reject（返回 boolean），失败后停止本批不自动重试。
// =========================================================================
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const loadSaver = async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/serialSaver.js')).href)
  return mod.createSerialSaver
}

test('serialSaver：保存成功返回 true、error 清空', async () => {
  const createSerialSaver = await loadSaver()
  let calls = 0
  const saver = createSerialSaver(async () => { calls++ })
  const ok = await saver.request()
  assert.equal(ok, true)
  assert.equal(calls, 1)
  assert.equal(saver.error, null)
})

test('serialSaver：保存失败返回 false 并保留 error（不 reject）', async () => {
  const createSerialSaver = await loadSaver()
  const boom = new Error('网络断了')
  const saver = createSerialSaver(async () => { throw boom })
  const ok = await saver.request()
  assert.equal(ok, false)
  assert.equal(saver.error, boom)
})

test('serialSaver：失败后不自动重试（本批只跑一次）', async () => {
  const createSerialSaver = await loadSaver()
  let calls = 0
  const saver = createSerialSaver(async () => { calls++; throw new Error('x') })
  await saver.request()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(calls, 1)
})

test('serialSaver：在途期间的追加请求合并成一轮，两个调用拿到同一结果', async () => {
  const createSerialSaver = await loadSaver()
  let calls = 0
  let release
  const gate = new Promise((r) => { release = r })
  const saver = createSerialSaver(async () => {
    calls++
    if (calls === 1) await gate // 第一轮挂起，制造并发窗口
  })
  const p1 = saver.request()
  const p2 = saver.request() // 在途期间追加：应合并，不并发发起
  release()
  const [ok1, ok2] = await Promise.all([p1, p2])
  assert.equal(ok1, true)
  assert.equal(ok2, true)
  assert.equal(calls, 2, '第一轮 + 合并后补存一轮，共 2 次（而不是 2 个并发请求各自跑）')
})

test('serialSaver：失败后不再补存合并轮（不把旧状态又写一遍）', async () => {
  const createSerialSaver = await loadSaver()
  let calls = 0
  let release
  const gate = new Promise((r) => { release = r })
  const saver = createSerialSaver(async () => {
    calls++
    if (calls === 1) await gate
    throw new Error('写库失败')
  })
  const p1 = saver.request()
  const p2 = saver.request() // 在途期间追加
  release()
  const [ok1, ok2] = await Promise.all([p1, p2])
  assert.equal(ok1, false)
  assert.equal(ok2, false)
  assert.equal(calls, 1, '失败即停，合并轮不再发起')
})

test('serialSaver：成功后合并轮用的是最新状态（saveFn 每轮现取）', async () => {
  const createSerialSaver = await loadSaver()
  let state = '旧'
  const saved = []
  let release
  const gate = new Promise((r) => { release = r })
  const saver = createSerialSaver(async () => {
    saved.push(state)
    if (saved.length === 1) await gate
  })
  const p1 = saver.request()
  state = '新' // 在途期间状态又变了（模拟连续编辑）
  const p2 = saver.request()
  release()
  await Promise.all([p1, p2])
  assert.deepEqual(saved, ['旧', '新'], '第二轮保存读到的是「新」状态')
})
