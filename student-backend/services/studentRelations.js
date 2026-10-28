// 学生「关联数据」服务：为「删除学生」提供影响预览与关联清理。
//
// 背景：students 与 请假/加分/座位/值日 之间没有外键，关联是松耦合的——
//   请假/加分：优先用 student_id，老数据可能只有姓名（student_id 为 null）；
//   座位：seats JSON 里可能是纯数字 id、{student_id,name} 对象，或姓名字符串；
//   值日：cells 里只存了姓名。
// 因此删除学生时若不处理，就会留下指向不存在学生的孤儿数据。本模块集中解决两件事：
//   1) studentRelations(student)     统计该生被哪些记录引用（删除前预览）；
//   2) purgeStudentRelations(student) 按勾选清理这些引用（确认「一并删除」时调用）。
//
// db 为多库代理：本模块只读写当前请求绑定的班主任库。
const { db } = require('../db');
const store = require('./slotStore');
const { countDutyRefs, removeDutyName } = require('./dutyCells');

// ---------- 座位 seats 解析：兼容三种元素形态 ----------
// 返回 { ids: [学生id...], names: [姓名...] }，便于按 id 或姓名比对。
function collectSeatRefs(seats) {
  const ids = [];
  const names = [];
  if (!Array.isArray(seats)) return { ids, names };
  for (const row of seats) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      if (cell == null) continue;
      if (typeof cell === 'number') { ids.push(cell); continue; }
      if (typeof cell === 'string') { const s = cell.trim(); if (s) names.push(s); continue; }
      if (typeof cell === 'object') {
        if (Number.isInteger(cell.student_id)) ids.push(cell.student_id);
        const nm = typeof cell.name === 'string' ? cell.name : cell['姓名'];
        if (typeof nm === 'string' && nm.trim()) names.push(nm.trim());
      }
    }
  }
  return { ids, names };
}

function readSeats() {
  try {
    const rec = store.getDoc('seat_layout');
    return rec ? JSON.parse(rec.seats) : [];
  } catch (_) {
    return [];
  }
}

// ---------- 值日 cells 解析：{项目:{星期:[姓名,...]}} ----------
function readDutyCells() {
  try {
    const rec = store.getDoc('duty_layout');
    return rec ? JSON.parse(rec.cells) : {};
  } catch (_) {
    return {};
  }
}

// 统计某生被引用的位置：请假 / 加分 / 座位 / 值日 / 小组 / 班干部
function studentRelations(student) {
  const id = student.id;
  const name = student['姓名'];
  const leave = db.prepare('SELECT COUNT(*) AS c FROM leave_records WHERE student_id = ? OR (student_id IS NULL AND 姓名 = ?)').get(id, name).c;
  const score = db.prepare('SELECT COUNT(*) AS c FROM score_records WHERE student_id = ? OR (student_id IS NULL AND 姓名 = ?)').get(id, name).c;
  // 小组只存姓名（没有 student_id），班干部两者都有：
  // 这两处原先既不在统计里、也不在清理里，删完学生后小组和班干部里会留着已删除的人，
  // 而删除确认框也不提 —— 用户没有任何机会知道。
  const group = db.prepare('SELECT COUNT(*) AS c FROM group_members WHERE member_name = ?').get(name).c;
  const cadre = db.prepare('SELECT COUNT(*) AS c FROM cadre_members WHERE student_id = ? OR student_name = ?').get(id, name).c;

  const refs = collectSeatRefs(readSeats());
  const seat = refs.ids.filter((v) => v === id).length + refs.names.filter((v) => v === name).length;

  const cells = readDutyCells();
  // cells 可能是旧版整块，也可能是新版 {daily,big} 打包：统一交给 dutyCells 认结构，
  // 否则打包结构会被按旧版遍历而「一条都对不上」，统计恒为 0。
  const duty = countDutyRefs(cells, name);
  return { leave, score, seat, duty, group, cadre, total: leave + score + seat + duty + group + cadre };
}

// 清空座位里指向该生的格子（命中 id 或姓名），返回清理数量
function purgeSeatRelation(student) {
  const seats = readSeats();
  if (!Array.isArray(seats)) return 0;
  let removed = 0;
  for (const row of seats) {
    if (!Array.isArray(row)) continue;
    for (let i = 0; i < row.length; i++) {
      const cell = row[i];
      const hit = (typeof cell === 'number' && cell === student.id)
        || (typeof cell === 'string' && cell.trim() === student['姓名'])
        || (cell && typeof cell === 'object' && (cell.student_id === student.id || cell.name === student['姓名'] || cell['姓名'] === student['姓名']));
      if (hit) { row[i] = null; removed++; }
    }
  }
  if (removed) store.setDoc('seat_layout', { seats: JSON.stringify(seats) });
  return removed;
}

// 移除值日表里该生的姓名，返回清理数量
function purgeDutyRelation(student) {
  const cells = readDutyCells();
  // 同上：daily/big 打包结构与旧版整块都要清；只在真的清掉时才回写
  const removed = removeDutyName(cells, student['姓名']);
  if (removed) store.setDoc('duty_layout', { cells: JSON.stringify(cells) });
  return removed;
}

// 按勾选清理关联；返回 { leave, score, seat, duty, leaveRows, scoreRows }
// leaveRows/scoreRows 回传被删的整行，便于前端登记撤销。
function purgeStudentRelations(student, opts = {}) {
  const id = student.id;
  const name = student['姓名'];
  const out = { leave: 0, score: 0, seat: 0, duty: 0, group: 0, cadre: 0, leaveRows: [], scoreRows: [] };

  if (opts.leave) {
    out.leaveRows = db.prepare('SELECT * FROM leave_records WHERE student_id = ? OR (student_id IS NULL AND 姓名 = ?)').all(id, name);
    out.leave = db.prepare('DELETE FROM leave_records WHERE student_id = ? OR (student_id IS NULL AND 姓名 = ?)').run(id, name).changes;
  }
  if (opts.score) {
    out.scoreRows = db.prepare('SELECT * FROM score_records WHERE student_id = ? OR (student_id IS NULL AND 姓名 = ?)').all(id, name);
    out.score = db.prepare('DELETE FROM score_records WHERE student_id = ? OR (student_id IS NULL AND 姓名 = ?)').run(id, name).changes;
  }
  if (opts.seat) out.seat = purgeSeatRelation(student);
  if (opts.duty) out.duty = purgeDutyRelation(student);
  // 小组/班干部只是「名单」，不像请假/加分那样需要回传整行做撤销，计数即可
  if (opts.group) out.group = db.prepare('DELETE FROM group_members WHERE member_name = ?').run(name).changes;
  if (opts.cadre) out.cadre = db.prepare('DELETE FROM cadre_members WHERE student_id = ? OR student_name = ?').run(id, name).changes;

  return out;
}

module.exports = { studentRelations, purgeStudentRelations, collectSeatRefs };
