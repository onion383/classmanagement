// =========================================================================
// dashboard.js —— 首屏聚合接口
//
// 把首页需要的 9 份数据合并成 1 次请求（1 次 HTTP + 1 次加解密），替代原来
// 前端并发拉 9 个接口（/api/schedule、/api/duty、/api/countdowns、/api/leaves、
// /api/students、/api/scores、/api/activities、/api/fee-records、/api/album）。
//
// 各读函数复用对应路由/服务的既有实现，返回值形状与前端 useDashboardData 期望一致：
//   { schedule:{cells,settings}, duty:{cells,settings},
//     countdowns:[], leaves:[], students:[], scores:[], activities:[], fees:[], album:[] }
// 9 个旧接口全部保留，本接口只服务首屏。
// =========================================================================

const express = require('express');
const router = express.Router();

// 单项读取：任一域出错只回退空值，保证聚合接口永不 500。
function safe(fn, fallback) {
  try { return fn(); } catch (_) { return fallback; }
}

// GET /api/dashboard
router.get('/', (req, res) => {
  // 读函数在 handler 内 require：此时各路由模块早已加载（本路由最后注册），
  // 取的是模块缓存，不会额外增加启动成本。
  const schedule = safe(() => require('./schedule').readSchedule(), { cells: [], settings: {} });
  const duty = safe(() => require('./duty').readDuty(), { cells: {}, settings: {} });
  const countdowns = safe(() => require('./countdowns').readAll(), []);
  const leaves = safe(() => require('./leaves').listOrders(), []);
  const scores = safe(() => require('./scores').readAll(), []);
  const activities = safe(() => require('./activities').readAll(), []);
  const album = safe(() => require('./album').readAlbums(), []);
  // students / fee_records 由动态表路由服务（在 app.js 内联创建），直接复用其查询实现取行数组。
  const { queryAll } = require('../services/tableService');
  const students = safe(() => queryAll('students').data, []);
  const fees = safe(() => queryAll('fee_records').data, []);

  res.json({ schedule, duty, countdowns, leaves, students, scores, activities, fees, album });
});

module.exports = router;
