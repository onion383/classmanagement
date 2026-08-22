const express = require('express');
const router = express.Router();
const { db } = require('../db');

// ============ 上限常量（与前端一致） ============
const MAX_MEMBERS_PER_GROUP = 99; // 每组最大人数
const MAX_GROUP_COUNT = 50;       // 单个维度最大小组数
const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));

// ============ 维度级 ============

// 确保存在内置的「宿舍组」默认维度（不可删除/不可改名，作为首页第一个 tab）
function ensureDefaultDim() {
  const existing = db.prepare('SELECT * FROM group_dimensions WHERE is_default = 1').get();
  if (existing) return;
  const existsByName = db.prepare('SELECT * FROM group_dimensions WHERE name = ?').get('宿舍组');
  const tx = db.transaction(() => {
    // 若已有同名普通维度，直接升级为默认；否则新建
    if (existsByName) {
      db.prepare('UPDATE group_dimensions SET is_default = 1, sort_order = 1 WHERE id = ?').run(existsByName.id);
    } else {
      db.prepare(
        `INSERT INTO group_dimensions (name, leader_title, members_per_group, group_count, is_default, sort_order) VALUES (?, '宿舍长', 6, 0, 1, 1)`
      ).run('宿舍组');
    }
  });
  tx();
}

// 列出所有分组维度（先确保内置默认维度存在）
function listDimensions() {
  ensureDefaultDim();
  return db.prepare('SELECT * FROM group_dimensions ORDER BY sort_order, id').all();
}

// 读取某个维度及全部组/成员
function loadDimension(dimId) {
  const dim = db.prepare('SELECT * FROM group_dimensions WHERE id = ?').get(dimId);
  if (!dim) return null;
  const groups = db.prepare('SELECT id, name, gender, sort_order FROM groups WHERE dimension_id = ? ORDER BY sort_order, id').all(dimId);
  const membersStmt = db.prepare('SELECT id, group_id, member_name, remark FROM group_members WHERE group_id = ? ORDER BY sort_order, id');
  const data = groups.map(g => ({ ...g, members: membersStmt.all(g.id) }));
  return { dimension: dim, groups: data };
}

// 在维度下追加 count 个空小组（组名留空，由用户填写）
function insertGroups(dimId, baseName = '', count) {
  const maxSort = db.prepare('SELECT MAX(sort_order) AS max FROM groups WHERE dimension_id = ?').get(dimId).max || 0;
  const stmt = db.prepare('INSERT INTO groups (dimension_id, name, sort_order) VALUES (?, ?, ?)');
  for (let i = 0; i < count; i++) {
    stmt.run(dimId, baseName, maxSort + i + 1);
  }
}

// 将维度下的小组数量同步到 newCount：少了补、多了删（连同成员）
function syncGroups(dimId, newCount) {
  const existing = db.prepare('SELECT id FROM groups WHERE dimension_id = ? ORDER BY sort_order, id').all(dimId);
  if (existing.length < newCount) {
    insertGroups(dimId, '', newCount - existing.length);
  } else if (existing.length > newCount) {
    const removeList = existing.slice(newCount);
    const delMembers = db.prepare('DELETE FROM group_members WHERE group_id = ?');
    const delGroup = db.prepare('DELETE FROM groups WHERE id = ?');
    for (const g of removeList) {
      delMembers.run(g.id);
      delGroup.run(g.id);
    }
    const rest = db.prepare('SELECT id FROM groups WHERE dimension_id = ? ORDER BY sort_order, id').all(dimId);
    const upd = db.prepare('UPDATE groups SET sort_order = ? WHERE id = ?');
    rest.forEach((r, i) => upd.run(i + 1, r.id));
  }
}

// 宿舍（内置）维度：按 男生宿舍数 + 女生宿舍数 重建组，组名带编号并标记性别
function syncGenderGroups(dimId, maleCount, femaleCount) {
  // 先清空旧组及成员
  const oldGroups = db.prepare('SELECT id FROM groups WHERE dimension_id = ?').all(dimId);
  const delMembers = db.prepare('DELETE FROM group_members WHERE group_id = ?');
  const delGroup = db.prepare('DELETE FROM groups WHERE id = ?');
  for (const g of oldGroups) { delMembers.run(g.id); delGroup.run(g.id); }

  const insert = db.prepare('INSERT INTO groups (dimension_id, name, gender, sort_order) VALUES (?, ?, ?, ?)');
  let sort = 1;
  for (let i = 1; i <= maleCount; i++) insert.run(dimId, `男生宿舍${i}`, 0, sort++);
  for (let i = 1; i <= femaleCount; i++) insert.run(dimId, `女生宿舍${i}`, 1, sort++);
}

// GET /api/group-manage/bootstrap —— 维度列表 + 第一个维度详情（供前端初始加载）
router.get('/bootstrap', (req, res) => {
  try {
    const dimensions = listDimensions();
    let active = null;
    if (dimensions.length > 0) {
      active = loadDimension(dimensions[0].id);
    }
    res.json({ dimensions, active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/group-manage/:dimId —— 读取指定维度详情
router.get('/:dimId', (req, res) => {
  try {
    const data = loadDimension(Number(req.params.dimId));
    if (!data) return res.status(404).json({ error: '维度不存在' });
    res.json({ dimensions: listDimensions(), ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/group-manage/dimensions —— 新增维度（按组数自动初始化小组）
router.post('/dimensions', (req, res) => {
  try {
    const { name, leader_title = '', members_per_group = 0, group_count = 0 } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请输入维度名称' });
    const maxSort = db.prepare('SELECT MAX(sort_order) AS max FROM group_dimensions').get().max || 0;
    const count = clamp(group_count, 0, MAX_GROUP_COUNT);
    const mpg = clamp(members_per_group, 0, MAX_MEMBERS_PER_GROUP);

    const tx = db.transaction(() => {
      const result = db.prepare(
        `INSERT INTO group_dimensions (name, leader_title, members_per_group, group_count, sort_order) VALUES (?, ?, ?, ?, ?)`
      ).run(String(name).trim(), String(leader_title).trim(), mpg, count, maxSort + 1);
      const dimId = result.lastInsertRowid;
      insertGroups(dimId, '', count);
      return dimId;
    });

    const dimId = tx();
    res.json({ id: dimId, message: '添加成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/group-manage/dimensions/:id —— 修改维度设置（维度级：组名/组长称呼/每组人数/组数；内置宿舍组用男/女生宿舍数）
router.put('/dimensions/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, leader_title, members_per_group, group_count } = req.body;
    const dim = db.prepare('SELECT * FROM group_dimensions WHERE id = ?').get(id);
    if (!dim) return res.status(404).json({ error: '维度不存在' });

    // ===== 内置宿舍组（特殊表单）：组名不可改，用 男/女生宿舍数 管理组 =====
    if (dim.is_default) {
      const male = req.body.male_group_count !== undefined ? clamp(req.body.male_group_count, 0, MAX_GROUP_COUNT) : dim.male_group_count;
      const female = req.body.female_group_count !== undefined ? clamp(req.body.female_group_count, 0, MAX_GROUP_COUNT) : dim.female_group_count;
      const mpg = members_per_group !== undefined ? clamp(members_per_group, 0, MAX_MEMBERS_PER_GROUP) : dim.members_per_group;
      const tx = db.transaction(() => {
        db.prepare(
          `UPDATE group_dimensions SET leader_title = ?, members_per_group = ?, male_group_count = ?, female_group_count = ? WHERE id = ?`
        ).run(
          leader_title !== undefined ? String(leader_title).trim() : dim.leader_title,
          mpg,
          male,
          female,
          id
        );
        syncGenderGroups(id, male, female);
      });
      tx();
      return res.json({ message: '保存成功' });
    }

    // ===== 普通维度 =====
    const newCount = group_count !== undefined ? clamp(group_count, 0, MAX_GROUP_COUNT) : dim.group_count;
    const newMpg = members_per_group !== undefined ? clamp(members_per_group, 0, MAX_MEMBERS_PER_GROUP) : dim.members_per_group;
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE group_dimensions SET name = ?, leader_title = ?, members_per_group = ?, group_count = ? WHERE id = ?`
      ).run(
        name !== undefined ? String(name).trim() : dim.name,
        leader_title !== undefined ? String(leader_title).trim() : dim.leader_title,
        newMpg,
        newCount,
        id
      );
      syncGroups(id, newCount);
    });
    tx();
    res.json({ message: '保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/group-manage/dimensions/:id —— 删除维度（级联删除组与成员；内置宿舍组不可删除）
router.delete('/dimensions/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const dim = db.prepare('SELECT * FROM group_dimensions WHERE id = ?').get(id);
    if (!dim) return res.status(404).json({ error: '维度不存在' });
    if (dim.is_default) return res.status(400).json({ error: '内置宿舍组不可删除' });
    const groups = db.prepare('SELECT id FROM groups WHERE dimension_id = ?').all(id);
    const delMembers = db.prepare('DELETE FROM group_members WHERE group_id = ?');
    const tx = db.transaction(() => {
      for (const g of groups) delMembers.run(g.id);
      db.prepare('DELETE FROM groups WHERE dimension_id = ?').run(id);
      db.prepare('DELETE FROM group_dimensions WHERE id = ?').run(id);
      // 维度内部排序重排
      const rest = db.prepare('SELECT id FROM group_dimensions ORDER BY sort_order, id').all();
      const upd = db.prepare('UPDATE group_dimensions SET sort_order = ? WHERE id = ?');
      rest.forEach((r, i) => upd.run(i + 1, r.id));
    });
    tx();
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 移动维度
router.post('/dimensions/move', (req, res) => {
  try {
    const { id, direction } = req.body;
    const dims = listDimensions();
    const idx = dims.findIndex(d => d.id === id);
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || target < 0 || target >= dims.length) return res.status(400).json({ error: '已到边界' });
    const tmp = dims[idx]; dims[idx] = dims[target]; dims[target] = tmp;
    const upd = db.prepare('UPDATE group_dimensions SET sort_order = ? WHERE id = ?');
    dims.forEach((d, i) => upd.run(i + 1, d.id));
    res.json({ message: '排序已更新' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 组 ============

// POST /api/group-manage/dimensions/:dimId/groups —— 新增组
router.post('/dimensions/:dimId/groups', (req, res) => {
  try {
    const dimId = Number(req.params.dimId);
    const dim = db.prepare('SELECT * FROM group_dimensions WHERE id = ?').get(dimId);
    if (!dim) return res.status(404).json({ error: '维度不存在' });
    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请输入小组名字' });
    const total = db.prepare('SELECT COUNT(*) AS c FROM groups WHERE dimension_id = ?').get(dimId).c;
    if (total >= MAX_GROUP_COUNT) return res.status(400).json({ error: `小组数量不能超过 ${MAX_GROUP_COUNT} 个` });
    const maxSort = db.prepare('SELECT MAX(sort_order) AS max FROM groups WHERE dimension_id = ?').get(dimId).max || 0;
    const result = db.prepare(
      `INSERT INTO groups (dimension_id, name, sort_order) VALUES (?, ?, ?)`
    ).run(dimId, String(name).trim(), maxSort + 1);
    res.json({ id: result.lastInsertRowid, message: '添加成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/group-manage/groups/:id —— 修改小组名字
router.put('/groups/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请输入小组名字' });
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
    if (!g) return res.status(404).json({ error: '小组不存在' });
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(String(name).trim(), id);
    res.json({ message: '保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/group-manage/groups/:id —— 删除组（级联删除成员）
router.delete('/groups/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
    if (!g) return res.status(404).json({ error: '小组不存在' });
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(id);
      db.prepare('DELETE FROM groups WHERE id = ?').run(id);
      const rest = db.prepare('SELECT id FROM groups WHERE dimension_id = ? ORDER BY sort_order, id').all(g.dimension_id);
      const upd = db.prepare('UPDATE groups SET sort_order = ? WHERE id = ?');
      rest.forEach((r, i) => upd.run(i + 1, r.id));
    });
    tx();
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 组成员 ============

// POST /api/group-manage/groups/:groupId/members —— 新增成员
router.post('/groups/:groupId/members', (req, res) => {
  try {
    const groupId = Number(req.params.groupId);
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!g) return res.status(404).json({ error: '小组不存在' });
    const { member_name = '', remark = '' } = req.body;
    const dim = db.prepare('SELECT * FROM group_dimensions WHERE id = ?').get(g.dimension_id);
    const count = db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(groupId).c;
    const perGroupLimit = dim && dim.members_per_group > 0 ? dim.members_per_group : MAX_MEMBERS_PER_GROUP;
    const effectiveLimit = Math.min(perGroupLimit, MAX_MEMBERS_PER_GROUP);
    if (count >= effectiveLimit) return res.status(400).json({ error: `该组人数已达上限 ${effectiveLimit} 人` });
    const maxSort = db.prepare('SELECT MAX(sort_order) AS max FROM group_members WHERE group_id = ?').get(groupId).max || 0;
    const result = db.prepare(
      `INSERT INTO group_members (group_id, member_name, remark, sort_order) VALUES (?, ?, ?, ?)`
    ).run(groupId, String(member_name).trim(), String(remark).trim(), maxSort + 1);
    res.json({ id: result.lastInsertRowid, message: '添加成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/group-manage/group-members/:id —— 修改成员
router.put('/group-members/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const { member_name, remark } = req.body;
    const m = db.prepare('SELECT * FROM group_members WHERE id = ?').get(id);
    if (!m) return res.status(404).json({ error: '成员不存在' });
    db.prepare('UPDATE group_members SET member_name = ?, remark = ? WHERE id = ?').run(
      member_name !== undefined ? String(member_name).trim() : m.member_name,
      remark !== undefined ? String(remark).trim() : m.remark,
      id
    );
    res.json({ message: '保存成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/group-manage/group-members/:id —— 删除成员
router.delete('/group-members/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const m = db.prepare('SELECT * FROM group_members WHERE id = ?').get(id);
    if (!m) return res.status(404).json({ error: '成员不存在' });
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM group_members WHERE id = ?').run(id);
      const rest = db.prepare('SELECT id FROM group_members WHERE group_id = ? ORDER BY sort_order, id').all(m.group_id);
      const upd = db.prepare('UPDATE group_members SET sort_order = ? WHERE id = ?');
      rest.forEach((r, i) => upd.run(i + 1, r.id));
    });
    tx();
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/group-manage/group-members/move —— 移动成员（同组排序 / 跨组移动）
// body: { memberId, targetGroupId, targetIndex }  targetIndex 为成员在目标组移动后的最终位置（0 起）
router.post('/group-members/move', (req, res) => {
  try {
    const memberId = Number(req.body.memberId);
    const targetGroupId = Number(req.body.targetGroupId);
    const targetIndex = Math.max(0, Number(req.body.targetIndex) || 0);
    const m = db.prepare('SELECT * FROM group_members WHERE id = ?').get(memberId);
    if (!m) return res.status(404).json({ error: '成员不存在' });
    const tgt = db.prepare('SELECT * FROM groups WHERE id = ?').get(targetGroupId);
    if (!tgt) return res.status(404).json({ error: '目标小组不存在' });

    const getIds = (gid) => db.prepare('SELECT id FROM group_members WHERE group_id = ? ORDER BY sort_order, id').all(gid).map(r => r.id);
    const upd = db.prepare('UPDATE group_members SET sort_order = ? WHERE id = ?');

    const sourceGroupId = m.group_id;
    // 跨组移入：目标组满员则拒绝，避免超出人数上限
    if (sourceGroupId !== targetGroupId) {
      const dim = db.prepare('SELECT * FROM group_dimensions WHERE id = ?').get(tgt.dimension_id);
      const targetCount = db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(targetGroupId).c;
      const perGroupLimit = dim && dim.members_per_group > 0 ? dim.members_per_group : MAX_MEMBERS_PER_GROUP;
      if (targetCount >= Math.min(perGroupLimit, MAX_MEMBERS_PER_GROUP)) {
        return res.status(400).json({ error: `该组人数已达上限 ${Math.min(perGroupLimit, MAX_MEMBERS_PER_GROUP)} 人，无法移入` });
      }
    }
    const tx = db.transaction(() => {
      if (sourceGroupId === targetGroupId) {
        const ids = getIds(sourceGroupId).filter(id => id !== memberId);
        const idx = Math.min(targetIndex, ids.length);
        ids.splice(idx, 0, memberId);
        ids.forEach((id, i) => upd.run(i + 1, id));
      } else {
        // 从源组移除并重排
        const srcIds = getIds(sourceGroupId).filter(id => id !== memberId);
        srcIds.forEach((id, i) => upd.run(i + 1, id));
        // 改到目标组
        db.prepare('UPDATE group_members SET group_id = ? WHERE id = ?').run(targetGroupId, memberId);
        // 插入目标组并重排
        const ids = getIds(targetGroupId).filter(id => id !== memberId);
        const idx = Math.min(targetIndex, ids.length);
        ids.splice(idx, 0, memberId);
        ids.forEach((id, i) => upd.run(i + 1, id));
      }
    });
    tx();

    const dimData = loadDimension(tgt.dimension_id);
    if (!dimData) return res.status(404).json({ error: '维度不存在' });
    res.json({ dimensions: listDimensions(), ...dimData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/group-manage/dimensions/:dimId/apply-grouping —— 智能分组写回
// body: { groups: [ [姓名, ...], ... ] }；每组第一个姓名为组长。
// 清空该维度下所有小组成员，再按顺序把姓名写回对应（第 i 组 → groups[i]）。
router.post('/dimensions/:dimId/apply-grouping', (req, res) => {
  try {
    const dimId = Number(req.params.dimId);
    const dim = db.prepare('SELECT * FROM group_dimensions WHERE id = ?').get(dimId);
    if (!dim) return res.status(404).json({ error: '维度不存在' });
    const input = Array.isArray(req.body.groups) ? req.body.groups : [];
    const groups = db.prepare('SELECT id FROM groups WHERE dimension_id = ? ORDER BY sort_order, id').all(dimId);

    const tx = db.transaction(() => {
      const delMembers = db.prepare('DELETE FROM group_members WHERE group_id = ?');
      const insert = db.prepare('INSERT INTO group_members (group_id, member_name, remark, sort_order) VALUES (?, ?, ?, ?)');
      groups.forEach((g, gi) => {
        delMembers.run(g.id);
        const names = input[gi] || [];
        names.forEach((name, i) => {
          const n = String(name || '').trim();
          if (!n) return;
          insert.run(g.id, n, '', i + 1);
        });
      });
    });
    tx();

    const data = loadDimension(dimId);
    res.json({ dimensions: listDimensions(), ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;