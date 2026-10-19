const express = require('express');
const router = express.Router();
const { db, renumber } = require('../db');
const { cleanUp, maxPosition, buildInsert, buildUpdate } = require('../utils/sql');

// 允许前端更新的字段白名单
const EDITABLE = ['名称', '截止日', '包含这一天'];

// 全量列表（共用于 GET /api/countdowns 与 /api/dashboard）
function readAll() {
  return db.prepare('SELECT * FROM countdowns ORDER BY position, id').all();
}

// GET /api/countdowns 全量列表
router.get('/', (req, res) => {
  try {
    res.json({ data: readAll() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/countdowns 新增
router.post('/', (req, res) => {
  try {
    const data = cleanUp(req.body || {}, EDITABLE, 'countdowns');
    data.position = maxPosition('countdowns') + 1;
    const result = buildInsert('countdowns', data);
    renumber('countdowns');
    res.json({ id: result.lastInsertRowid, message: '添加倒计时成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/countdowns/:id 编辑
router.put('/:id', (req, res) => {
  try {
    const row = cleanUp(req.body || {}, EDITABLE, 'countdowns');
    if (Object.keys(row).length === 0) return res.status(400).json({ error: '没有可更新的字段' });
    buildUpdate('countdowns', row, req.params.id);
    res.json({ message: '修改成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/countdowns/:id 删除
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM countdowns WHERE id = ?').run(Number(req.params.id));
    renumber('countdowns');
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
// 供 /api/dashboard 聚合复用（挂在 router 函数对象上，不影响既有路由）
module.exports.readAll = readAll;