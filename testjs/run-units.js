#!/usr/bin/env node
// run-units.js —— 单元测试板块入口（testjs/units/ 全部 *.test.js）
// 零件级纯逻辑契约：毫秒级、无环境依赖，可直接接 CI。
//
// 用法：node testjs/run-units.js [--only=xx] [--skip=xx] [--bail] [--list]
// 等价 npm：npm run test:units
const { runSuite } = require('./_suite-run.cjs')

runSuite({ dir: 'units', label: '单元' })
