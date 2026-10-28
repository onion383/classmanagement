// =========================================================================
// historyRoutes.js —— 「周历史快照」路由公共实现（课表）
//
// 历史快照已合并到 domain_history（按 domain 区分），读写统一走 services/slotStore.js。
// 本模块只服务课表（week-based）；值日/座位是按天的内联历史路由，各自实现。
// =========================================================================

const store = require('../services/slotStore');
const { isDateStr } = require('../utils/sql');

// domain：历史域（此处恒为 'schedule'）。
// toSnapshot(rec) -> 单周快照响应体；buildPayload(body) -> 待存 payload。
// listRow(rec) -> 周列表项。
function registerHistoryRoutes(router, { domain, toSnapshot, buildPayload, listRow }) {
  // 已保存快照的周列表
  router.get('/history', (req, res) => {
        const rows = store.histWeeks(domain);
    res.json(listRow ? rows.map(listRow) : rows);
  });

  // 特定周的快照
  router.get('/history/:weekStart', (req, res) => {
        const rec = store.histLatest(domain, req.params.weekStart, null);
    res.json(rec ? toSnapshot(rec) : null);
  });

  // 保存当前周快照（自动或手动）：按 week_start 幂等 upsert
  router.post('/snapshot', (req, res) => {
        const body = req.body || {};
    if (!body.week_start) return res.status(400).json({ error: '缺少周开始日期' });
    // 只校验「非空」时任意串都能入库，非法日期会被解析成 NaN 周，历史列表出现幽灵周
    if (!isDateStr(body.week_start)) return res.status(400).json({ error: '周开始日期格式不正确（应为 YYYY-MM-DD）' });
    store.histUpsert(domain, { weekStart: body.week_start, payload: buildPayload(body) });
    res.json({ message: '快照已保存' });
  });

  // 删除某一周的快照
  router.delete('/history/:weekStart', (req, res) => {
        const changes = store.histDeleteWeek(domain, req.params.weekStart, null);
    if (!changes) return res.status(404).json({ error: '该周快照不存在' });
    res.json({ message: '快照已删除' });
  });
}

module.exports = { registerHistoryRoutes };
