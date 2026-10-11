const express = require('express');
const router = express.Router();
const { db, renumber } = require('../db');
const { now, cleanUp, maxPosition, buildInsert, buildUpdate } = require('../utils/sql');

// 允许前端更新的字段白名单
const EDITABLE = ['时间', '主题', '地点', '简介', '参与人员'];

// GET /api/activities 全量列表
router.get('/', (req, res) => {
  try {
    res.json({ data: db.prepare('SELECT * FROM activities ORDER BY position, id').all() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/activities 新增
router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const data = cleanUp(body, EDITABLE);
    data.created_at = now();
    data.position = maxPosition('activities') + 1;
    const result = buildInsert('activities', data);
    renumber('activities');
    res.json({ id: result.lastInsertRowid, message: '添加活动成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/activities/:id 编辑
router.put('/:id', (req, res) => {
  try {
    const row = cleanUp(req.body || {}, EDITABLE);
    if (Object.keys(row).length === 0) return res.status(400).json({ error: '没有可更新的字段' });
    buildUpdate('activities', row, req.params.id);
    res.json({ message: '修改成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/activities/:id 删除
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM activities WHERE id = ?').run(Number(req.params.id));
    renumber('activities');
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;