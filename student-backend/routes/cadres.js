const express = require('express');
const router = express.Router();
const { db } = require('../db');

// ======================== 数据读写 ========================
// cadres: { id, name, parent_id, max_count, sort_order, children: [], members: [] }

// 读取全部职务节点
function allCadres() {
  return db.prepare('SELECT * FROM cadres ORDER BY sort_order, id').all();
}

// 读取某职务的担任学生
function membersOf(cadreId) {
  return db.prepare('SELECT id, cadre_id, student_id, student_name FROM cadre_members WHERE cadre_id = ? ORDER BY sort_order, id').all(cadreId);
}

// 组装成树并附上担任学生
function buildTree() {
  const all = allCadres();
  const membersStmt = db.prepare('SELECT id, cadre_id, student_id, student_name FROM cadre_members WHERE cadre_id = ? ORDER BY sort_order, id');
  const byId = new Map();
  all.forEach(c => byId.set(c.id, { ...c, children: [], members: membersStmt.all(c.id) }));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// ======================== 职务 CRUD ========================
// 获取完整职务树（含担任学生）
router.get('/', (req, res) => {
  try {
    res.json({ tree: buildTree() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 新增职务
router.post('/', (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: '职务名不能为空' });
    const parentId = Number(req.body.parent_id) || 0;
    const maxCount = Math.max(1, Number(req.body.max_count) || 1);
    // 校验父职务存在（若指定）
    if (parentId && !db.prepare('SELECT id FROM cadres WHERE id=?').get(parentId)) {
      return res.status(400).json({ error: '上级职务不存在' });
    }
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS max FROM cadres').get().max;
    const info = db.prepare('INSERT INTO cadres (name, parent_id, max_count, sort_order) VALUES (?,?,?,?)')
      .run(name, parentId, maxCount, maxSort + 1);
    res.json({ id: info.lastInsertRowid, tree: buildTree() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 更新职务
router.put('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const node = db.prepare('SELECT * FROM cadres WHERE id=?').get(id);
    if (!node) return res.status(404).json({ error: '职务不存在' });
    const name = req.body.name !== undefined ? String(req.body.name).trim() : node.name;
    if (!name) return res.status(400).json({ error: '职务名不能为空' });
    const parentId = req.body.parent_id !== undefined ? (Number(req.body.parent_id) || 0) : node.parent_id;
    const maxCount = req.body.max_count !== undefined ? Math.max(1, Number(req.body.max_count) || 1) : node.max_count;
    // 防循环：新父级不能是自身或其子孙
    if (parentId === id) return res.status(400).json({ error: '上级不能是自身' });
    if (parentId) {
      let cur = parentId;
      const visited = new Set();
      while (cur) {
        if (cur === id) return res.status(400).json({ error: '不能把职务挂到自己的下级' });
        if (visited.has(cur)) break;
        visited.add(cur);
        const p = db.prepare('SELECT parent_id FROM cadres WHERE id=?').get(cur);
        cur = p ? p.parent_id : 0;
      }
    }
    db.prepare('UPDATE cadres SET name=?, parent_id=?, max_count=? WHERE id=?').run(name, parentId, maxCount, id);
    res.json({ tree: buildTree() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 删除职务：级联删除其担任学生，其直接子职务上移挂到被删职务的上级
router.delete('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const node = db.prepare('SELECT * FROM cadres WHERE id=?').get(id);
    if (!node) return res.status(404).json({ error: '职务不存在' });
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM cadre_members WHERE cadre_id=?').run(id);
      db.prepare('UPDATE cadres SET parent_id=? WHERE parent_id=?').run(node.parent_id, id);
      db.prepare('DELETE FROM cadres WHERE id=?').run(id);
    });
    tx();
    res.json({ tree: buildTree() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ======================== 担任学生 ========================
// 为职务添加担任学生（student_id 可空，用于值日输入产生的"仅姓名"学生）
router.post('/:id/members', (req, res) => {
  try {
    const cadreId = Number(req.params.id);
    if (!db.prepare('SELECT id FROM cadres WHERE id=?').get(cadreId)) {
      return res.status(404).json({ error: '职务不存在' });
    }
    const studentId = req.body.student_id ? Number(req.body.student_id) || null : null;
    const studentName = String(req.body.student_name || '').trim();
    if (!studentName) return res.status(400).json({ error: '请选择担任学生' });
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS max FROM cadre_members WHERE cadre_id=?').get(cadreId).max;
    const info = db.prepare('INSERT INTO cadre_members (cadre_id, student_id, student_name, sort_order) VALUES (?,?,?,?)')
      .run(cadreId, studentId, studentName, maxSort + 1);
    res.json({ id: info.lastInsertRowid, tree: buildTree() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 移除担任学生
router.delete('/members/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM cadre_members WHERE id=?').run(id);
    res.json({ tree: buildTree() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 移动职务：挂到 parentId(0=顶级) 下第 index 位（排序），index 为去掉自身后目标位置，可为 null 表示放在末尾
router.post('/:id/move', (req, res) => {
  try {
    const id = Number(req.params.id);
    const node = db.prepare('SELECT * FROM cadres WHERE id=?').get(id);
    if (!node) return res.status(404).json({ error: '职务不存在' });
    const parentId = Number(req.body.parent_id) || 0;
    let index = Number.isFinite(req.body.index) ? Number(req.body.index) : null;
    if (parentId === id) return res.status(400).json({ error: '上级不能是自身' });
    if (parentId) {
      let cur = parentId;
      const visited = new Set();
      while (cur) {
        if (cur === id) return res.status(400).json({ error: '不能把职务挂到自己的下级' });
        if (visited.has(cur)) break;
        visited.add(cur);
        const p = db.prepare('SELECT parent_id FROM cadres WHERE id=?').get(cur);
        cur = p ? p.parent_id : 0;
      }
    }
    const tx = db.transaction(() => {
      const children = db.prepare('SELECT id FROM cadres WHERE parent_id=? ORDER BY sort_order, id')
        .all(parentId).map(r => r.id).filter(x => x !== id);
      if (index == null || index < 0) index = children.length;
      if (index > children.length) index = children.length;
      children.splice(index, 0, id);
      const stmt = db.prepare('UPDATE cadres SET sort_order=? WHERE id=?');
      children.forEach((cid, i) => stmt.run(i, cid));
      db.prepare('UPDATE cadres SET parent_id=? WHERE id=?').run(parentId, id);
    });
    tx();
    res.json({ tree: buildTree() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 移动担任学生：挂到 cadreId 下第 index 位（index 为去掉自身后的目标位置，null 表示末尾）
router.post('/members/:id/move', (req, res) => {
  try {
    const id = Number(req.params.id);
    const mem = db.prepare('SELECT * FROM cadre_members WHERE id=?').get(id);
    if (!mem) return res.status(404).json({ error: '担任学生不存在' });
    const cadreId = Number(req.body.cadre_id) || 0;
    if (!db.prepare('SELECT id FROM cadres WHERE id=?').get(cadreId)) {
      return res.status(400).json({ error: '职务不存在' });
    }
    let index = Number.isFinite(req.body.index) ? Number(req.body.index) : null;
    const tx = db.transaction(() => {
      const list = db.prepare('SELECT id FROM cadre_members WHERE cadre_id=? ORDER BY sort_order, id')
        .all(cadreId).map(r => r.id).filter(x => x !== id);
      if (index == null || index < 0) index = list.length;
      if (index > list.length) index = list.length;
      list.splice(index, 0, id);
      const stmt = db.prepare('UPDATE cadre_members SET sort_order=? WHERE id=?');
      list.forEach((mid, i) => stmt.run(i, mid));
      db.prepare('UPDATE cadre_members SET cadre_id=? WHERE id=?').run(cadreId, id);
    });
    tx();
    res.json({ tree: buildTree() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


module.exports = router;