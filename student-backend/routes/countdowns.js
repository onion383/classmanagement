const express = require('express');
const router = express.Router();
const { db, renumber } = require('../db');

// 允许前端更新的字段白名单
const EDITABLE = ['名称', '截止日', '包含这一天'];

function cleanUp(data) {
  const row = {};
  EDITABLE.forEach(k => {
    if (data[k] !== undefined) row[k] = (data[k] === '' || data[k] === null) ? null : data[k];
  });
  return row;
}

// GET /api/countdowns 全量列表
router.get('/', (req, res) => {
  try {
    res.json({ data: db.prepare('SELECT * FROM countdowns ORDER BY position, id').all() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/countdowns 新增
router.post('/', (req, res) => {
  try {
    const data = cleanUp(req.body || {});
    const maxPos = db.prepare('SELECT MAX(position) AS maxPos FROM countdowns').get().maxPos || 0;
    data.position = maxPos + 1;

    const cols = Object.keys(data).map(c => `"${c}"`).join(',');
    const ph = Object.keys(data).map(() => '?').join(',');
    const result = db.prepare(`INSERT INTO countdowns (${cols}) VALUES (${ph})`).run(...Object.values(data));
    renumber('countdowns');
    res.json({ id: result.lastInsertRowid, message: '添加倒计时成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/countdowns/:id 编辑
router.put('/:id', (req, res) => {
  try {
    const row = cleanUp(req.body || {});
    if (Object.keys(row).length === 0) return res.status(400).json({ error: '没有可更新的字段' });
    const setClause = Object.keys(row).map(k => `"${k}" = ?`).join(', ');
    db.prepare(`UPDATE countdowns SET ${setClause} WHERE id = ?`).run(...Object.values(row), Number(req.params.id));
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