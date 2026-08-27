const express = require('express');
const router = express.Router();
const { db, renumber } = require('../db');

// 允许前端更新的字段白名单
const EDITABLE = ['时间', '主题', '地点', '简介', '参与人员'];

function now() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function cleanUp(data) {
  const row = {};
  EDITABLE.forEach(k => {
    if (data[k] !== undefined) row[k] = (data[k] === '' || data[k] === null) ? null : data[k];
  });
  return row;
}

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
    const data = cleanUp(body);
    data.created_at = now();
    const maxPos = db.prepare('SELECT MAX(position) AS maxPos FROM activities').get().maxPos || 0;
    data.position = maxPos + 1;

    const cols = Object.keys(data).map(c => `"${c}"`).join(',');
    const ph = Object.keys(data).map(() => '?').join(',');
    const result = db.prepare(`INSERT INTO activities (${cols}) VALUES (${ph})`).run(...Object.values(data));
    renumber('activities');
    res.json({ id: result.lastInsertRowid, message: '添加活动成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/activities/:id 编辑
router.put('/:id', (req, res) => {
  try {
    const row = cleanUp(req.body || {});
    if (Object.keys(row).length === 0) return res.status(400).json({ error: '没有可更新的字段' });
    const setClause = Object.keys(row).map(k => `"${k}" = ?`).join(', ');
    db.prepare(`UPDATE activities SET ${setClause} WHERE id = ?`).run(...Object.values(row), Number(req.params.id));
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