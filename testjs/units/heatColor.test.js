// 热力配色：纯函数单元测试（权重表 / 座位指数共用）
// 运行：npm run test:units
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const load = () => import(pathToFileURL(path.join(__dirname, '../../student-frontend/src/utils/heatColor.js')).href)

test('weightHeatRgb 端点与钳制', async () => {
  const { weightHeatRgb } = await load()
  assert.deepEqual(weightHeatRgb(0), [239, 246, 255])   // 浅蓝
  assert.deepEqual(weightHeatRgb(1), [30, 58, 138])     // 深蓝
  assert.deepEqual(weightHeatRgb(-1), [239, 246, 255])  // 越界按 0 处理
  assert.deepEqual(weightHeatRgb(2), [30, 58, 138])     // 越界按 1 处理
})

test('weightHeatRgb 中间值单调变深', async () => {
  const { weightHeatRgb } = await load()
  const mid = weightHeatRgb(0.5)
  assert.ok(mid[0] < 239 && mid[0] > 30)
  assert.ok(mid[2] < 255 && mid[2] > 138)
})

test('weightHeatFg 浅底用深字、深底用白字', async () => {
  const { weightHeatFg } = await load()
  assert.equal(weightHeatFg(0), '#1E293B')
  assert.equal(weightHeatFg(1), '#FFFFFF')
})
