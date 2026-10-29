#!/usr/bin/env node
// run-behavior.js —— 行为测试板块入口（testjs/behavior/ 全部 *.test.js）
// 组件行为语义与架构契约：静态扫描 + 桩件 + mock timers，同样毫秒级无环境依赖。
//
// 用法：node testjs/run-behavior.js [--only=xx] [--skip=xx] [--bail] [--list]
// 等价 npm：npm run test:behavior
const { runSuite } = require('./_suite-run.cjs')

runSuite({ dir: 'behavior', label: '行为' })
