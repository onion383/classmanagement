const express = require('express');
const router = express.Router();
const { db, renumber } = require('../db');
const { now, cleanUp, maxPosition, buildInsert, buildUpdate } = require('../utils/sql');

// 允许前端更新的字段白名单
const EDITABLE = ['时间', '主题', '地点', '简介', '参与人员'];

// 全量列表（共用于 GET /api/activities 与 /api/dashboard）
function readAll() {
  return db.prepare('SELECT * FROM activities ORDER BY position, id').all();
}

// GET /api/activities 全量列表
router.get('/', (req, res) => {
    res.json({ data: readAll() });
});

// POST /api/activities 新增
router.post('/', (req, res) => {
    const body = req.body || {};
  const data = cleanUp(body, EDITABLE, 'activities');
  data.created_at = now();
  data.position = maxPosition('activities') + 1;
  const result = buildInsert('activities', data);
  renumber('activities');
  res.json({ id: result.lastInsertRowid, message: '添加活动成功' });
});

// PUT /api/activities/:id 编辑
router.put('/:id', (req, res) => {
    const row = cleanUp(req.body || {}, EDITABLE, 'activities');
  if (Object.keys(row).length === 0) return res.status(400).json({ error: '没有可更新的字段' });
  buildUpdate('activities', row, req.params.id);
  res.json({ message: '修改成功' });
});

// DELETE /api/activities/:id 删除
router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM activities WHERE id = ?').run(Number(req.params.id));
  renumber('activities');
  res.json({ message: '删除成功' });
});

module.exports = router;
// 供 /api/dashboard 聚合复用（挂在 router 函数对象上，不影响既有路由）
module.exports.readAll = readAll;