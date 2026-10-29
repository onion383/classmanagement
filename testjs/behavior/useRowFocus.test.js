// =========================================================================
// useRowFocus.test.js —— 跨页行定位行为（签名去重 / parse 改写 / 重试）
//
// 运行：npm run test:behavior
// 被测：student-frontend/src/composables/useRowFocus.js
// 行定位是「标题栏搜索跳转 → 目标页滚动高亮」的共享链路（10 个视图经
// rowFocusHost 使用），行为契约：
//   · query.focus 为空时不做事；同一 focus 不重复定位（watch 与 activated 可能双触发）；
//   · parse(key) 可把「行 key」改写成真正定位 id；返回空值表示时机未到 → 内部重试；
//   · 定位成功后清掉 query（避免回退/刷新重复定位）；
//   · container 缺省时退回显式传入的容器（host.container）。
// DOM 全部用桩（Node 无 window/document，模块也刻意不依赖组件实例）。
// =========================================================================
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const loadMod = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/composables/useRowFocus.js')).href)

// ---- 桩件 ----
function fakeWin() {
  return { addEventListener() {}, removeEventListener() {} }
}
function fakeEl(tag = 'TR') {
  return {
    tagName: tag,
    children: tag === 'TR' ? [{ animate() {} }, { animate() {} }] : [],
    scrollIntoView() {},
    animate() {},
    ownerDocument: { defaultView: fakeWin() },
  }
}
function fakeContainer(match) {
  const calls = []
  return {
    calls,
    querySelector(sel) {
      calls.push(sel)
      return match ? fakeEl() : null
    },
  }
}
function fakeHost({ focus = 'row-1', container = fakeContainer(true) } = {}) {
  const replaces = []
  return {
    replaces,
    container,
    host: {
      route: { query: focus != null ? { focus } : {}, path: '/duty' },
      router: { replace: (args) => replaces.push(args) },
      container,
    },
  }
}

test('useRowFocus：query.focus 为空时不定位、只清签名', async () => {
  const { applyRouteRowFocus } = await loadMod()
  const { host, replaces, container } = fakeHost({ focus: undefined })
  host.route.query = {}
  applyRouteRowFocus(host)
  assert.equal(replaces.length, 0)
  assert.equal(container.calls.length, 0)
})

test('useRowFocus：命中后滚动高亮并清掉 query（防回退重复定位）', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { applyRouteRowFocus } = await loadMod()
  const { host, replaces, container } = fakeHost({ focus: 'row-1' })
  applyRouteRowFocus(host)
  assert.equal(container.calls.length, 1)
  assert.equal(container.calls[0], '[data-row-id="row-1"]')
  assert.deepEqual(replaces, [{ path: '/duty' }], '定位成功后 router.replace 清 query')
  t.mock.timers.tick(1500) // 把 runAfterScroll 的兜底定时器跑完，避免挂起
})

test('useRowFocus：同一 host 同一 focus 不重复定位（watch/activated 双触发去重）', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { applyRouteRowFocus } = await loadMod()
  const { host, replaces, container } = fakeHost({ focus: 'row-1' })
  applyRouteRowFocus(host)
  applyRouteRowFocus(host) // 第二次：签名相同，应直接返回
  assert.equal(container.calls.length, 1)
  assert.equal(replaces.length, 1)
  t.mock.timers.tick(1500)
})

test('useRowFocus：focus 变化后重新定位', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { applyRouteRowFocus } = await loadMod()
  const { host, replaces, container } = fakeHost({ focus: 'row-1' })
  applyRouteRowFocus(host)
  host.route.query.focus = 'row-2'
  applyRouteRowFocus(host)
  assert.equal(container.calls.length, 2)
  assert.equal(container.calls[1], '[data-row-id="row-2"]')
  assert.equal(replaces.length, 2)
  t.mock.timers.tick(1500)
})

test('useRowFocus：parse 改写定位 id（页签切换后行 key 映射成真实 id）', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { applyRouteRowFocus } = await loadMod()
  const { host, container } = fakeHost({ focus: 'tab:row-9' })
  applyRouteRowFocus(host, { parse: (key) => 'mapped-' + key.split(':')[1] })
  assert.equal(container.calls[0], '[data-row-id="mapped-row-9"]')
  t.mock.timers.tick(1500)
})

test('useRowFocus：parse 返回空值 = 时机未到，内部重试直至就绪', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { applyRouteRowFocus } = await loadMod()
  const { host, replaces, container } = fakeHost({ focus: 'row-5' })
  let ready = false
  applyRouteRowFocus(host, {
    parse: (key) => (ready ? key : null), // 前两次"时机未到"
    container: () => container,
  })
  assert.equal(container.calls.length, 0, '时机未到不发起定位')
  ready = true
  t.mock.timers.tick(80) // 触发内部重试（RETRY_INTERVAL）
  assert.equal(container.calls.length, 1, '就绪后重试命中')
  assert.equal(replaces.length, 1)
  t.mock.timers.tick(1500)
})

test('useRowFocus：focusRowWhenReady 容器未就绪时按次数重试', async () => {
  const { focusRowWhenReady } = await loadMod()
  let n = 0
  const container = {
    querySelector() {
      n++
      return n >= 3 ? fakeEl() : null // 前两次未渲染
    },
  }
  const done = new Promise((resolve) => {
    focusRowWhenReady(() => container, 'row-x', { tries: 5, interval: 1, resolve })
    // focusRowWhenReady 无完成回调：用轮询确认命中
    const timer = setInterval(() => {
      if (n >= 3) { clearInterval(timer); resolve() }
    }, 5)
  })
  await done
  assert.ok(n >= 3)
})

test('useRowFocus：flashRowById 对缺失元素/容器返回 false', async () => {
  const { flashRowById } = await loadMod()
  assert.equal(flashRowById(null, 'x'), false)
  assert.equal(flashRowById(fakeContainer(false), 'x'), false)
  assert.equal(flashRowById(fakeContainer(true), ''), false)
})
