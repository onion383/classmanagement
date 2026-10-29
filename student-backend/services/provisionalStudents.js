// =========================================================================
// provisionalStudents.js —— 临时学生的「解析 / 建档」单源实现
//
// 背景：值日 / 座位 / 小组成员允许直接输入名字。为了让这些引用有稳定的身份，
// 名字第一次出现时落一条 is_provisional = 1 的 students 记录：
//   · 与正式学生共用 students.id，转正只是把状态位改回 0，引用不需要重指；
//   · 按姓名部分唯一索引兜底，同一个名字反复输入只可能命中同一条；
//   · 正式名单里已有唯一同名时直接复用正式学生，不建临时。
//
// 解析顺序（重要）：
//   1. 正式学生精确同名 1 个  → 用它
//   2. 正式学生同名 ≥2 个     → 返回候选，不建临时（重名是正式名单自己的问题，不能替用户选）
//   3. 已有同名临时学生       → 用它（唯一索引保证最多一条）
//   4. 都没有且 create=true   → 建临时
// =========================================================================
const { db } = require('../db');
const { insertRow } = require('./tableService');

function findByName(name) {
  return db.prepare(
    'SELECT id, 姓名, 学号, is_provisional FROM students WHERE 姓名 = ? ORDER BY is_provisional, id'
  ).all(name);
}

function resolveOne(rawName, { create = true } = {}) {
  const name = String(rawName == null ? '' : rawName).trim();
  if (!name) return { name: '', id: null, error: '姓名为空' };
  const rows = findByName(name);
  const formal = rows.filter((r) => !r.is_provisional);
  if (formal.length === 1) {
    return { name, id: Number(formal[0].id), created: false, is_provisional: false };
  }
  if (formal.length > 1) {
    return {
      name,
      id: null,
      created: false,
      ambiguous: true,
      candidates: formal.map((r) => ({ id: Number(r.id), 姓名: r.姓名, 学号: r.学号 || '' })),
    };
  }
  const provisional = rows.find((r) => r.is_provisional);
  if (provisional) {
    return { name, id: Number(provisional.id), created: false, is_provisional: true };
  }
  if (!create) return { name, id: null, created: false, missing: true };
  try {
    const info = insertRow('students', { 姓名: name, is_provisional: 1 });
    return { name, id: Number(info.id), created: true, is_provisional: true };
  } catch (err) {
    // 兜底：唯一索引冲突说明另一个请求刚建了同名临时学生（多进程/极端并发）。
    // 重新查一次拿它的 id，而不是把「已经存在」当失败抛给调用方。
    if (/UNIQUE/i.test(String(err && err.message))) {
      const again = findByName(name).find((r) => r.is_provisional);
      if (again) return { name, id: Number(again.id), created: false, is_provisional: true };
    }
    throw err;
  }
}

// 批量解析（去重、按传入顺序返回）。整批放在一个事务里：
// 后端是单进程同步执行，这样「查-插」不会被另一个请求插进来；唯一索引再兜一层。
function resolveNames(rawNames, { create = true } = {}) {
  const list = Array.isArray(rawNames) ? rawNames : [];
  const seen = new Set();
  const out = [];
  const run = db.transaction(() => {
    for (const raw of list) {
      const name = String(raw == null ? '' : raw).trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      try {
        out.push(resolveOne(name, { create }));
      } catch (err) {
        // 单个名字非法（超长等）不拖垮整批：把原因回给调用方，其它名字照常解析。
        out.push({ name, id: null, error: err.message });
      }
    }
  });
  run();
  return out;
}

// 单条写入接口（小组成员等）用：确保这个名字有学生记录，没有就建临时。
// 重名（正式名单 ≥2 个同名）返回 ambiguous，且不建临时 —— 名字本来就存在，不该再多一条。
function ensureProvisionalStudent(rawName) {
  try {
    return resolveOne(rawName, { create: true });
  } catch (err) {
    return { name: String(rawName == null ? '' : rawName).trim(), id: null, error: err.message };
  }
}

module.exports = { resolveOne, resolveNames, ensureProvisionalStudent };
