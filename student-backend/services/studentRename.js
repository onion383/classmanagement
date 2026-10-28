// =========================================================================
// studentRename.js —— 学生改名时的关联姓名同步
//
// 本项目的人际关联是「id 优先 / 姓名兜底」的松耦合结构，其中**只存姓名**的几处
// 不会随 students 表改名自动更新：
//   · duty_layout.cells        值日表（只存姓名）
//   · seat_layout.seats        座位（可能是字符串，也可能是 {student_id,name} 对象）
//   · score_records.姓名       加减分（老数据 student_id 为 null，靠姓名认人）
//   · leave_records.姓名       请假（同上）
//   · group_members.member_name 小组成员
//   · cadre_members.student_name 班干部担任学生
//
// 后果最重的是值日指数：账本按姓名归集（DutyView 的 acc[name]），
// 改名后历史值日全挂在旧名下、新名字从 0 开始算，而界面不会报任何错。
//
// **歧义保护**：姓名在这些表里不是唯一键。如果旧名还有另一个学生（同名），
// 逐处改名会连那个人的数据一起改掉。所以只在「旧名已不再被其他学生使用」时才级联，
// 否则跳过并把原因回给调用方 —— 宁可不同步，也不能改错人。
// =========================================================================
const { db } = require('../db');
const store = require('./slotStore');
const { safeJson } = require('../utils/json');
const { renameDutyName } = require('./dutyCells');

function nameStillUsedByOthers(oldName) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM students WHERE 姓名 = ?').get(oldName);
  return (row ? row.c : 0) > 0;
}

// 座位里可能是 "姓名"、"123"（id）、{student_id,name}、{姓名}：四种都认
function renameSeatCells(seats, oldName, newName) {
  let changed = 0;
  if (!Array.isArray(seats)) return changed;
  for (const row of seats) {
    if (!Array.isArray(row)) continue;
    for (let i = 0; i < row.length; i++) {
      const cell = row[i];
      if (typeof cell === 'string' && cell.trim() === oldName) {
        row[i] = newName; changed++; continue;
      }
      if (cell && typeof cell === 'object') {
        if (cell.name === oldName) { cell.name = newName; changed++; }
        if (cell['姓名'] === oldName) { cell['姓名'] = newName; changed++; }
      }
    }
  }
  return changed;
}

// 返回 { changed, skipped, counts }；skipped 为 'duplicate-name' 时调用方应提示用户
function renameStudentRefs(oldName, newName) {
  const from = String(oldName || '').trim();
  const to = String(newName || '').trim();
  if (!from || !to || from === to) return { changed: false, counts: {} };
  // 调用点约定：students 行**已经**改成新名字后再调用，所以这里查到的就是「其余同名者」
  if (nameStillUsedByOthers(from)) return { changed: false, skipped: 'duplicate-name', counts: {} };

  const counts = { duty: 0, seat: 0, score: 0, leave: 0, group: 0, cadre: 0 };

  const duty = store.getDoc('duty_layout');
  if (duty) {
    const cells = safeJson(duty.cells, {});
    counts.duty = renameDutyName(cells, from, to);
    if (counts.duty) store.setDoc('duty_layout', { cells: JSON.stringify(cells) });
  }

  const seat = store.getDoc('seat_layout');
  if (seat) {
    const seats = safeJson(seat.seats, []);
    counts.seat = renameSeatCells(seats, from, to);
    if (counts.seat) store.setDoc('seat_layout', { seats: JSON.stringify(seats) });
  }

  counts.score = db.prepare('UPDATE score_records SET 姓名 = ? WHERE 姓名 = ?').run(to, from).changes;
  counts.leave = db.prepare('UPDATE leave_records SET 姓名 = ? WHERE 姓名 = ?').run(to, from).changes;
  counts.group = db.prepare('UPDATE group_members SET member_name = ? WHERE member_name = ?').run(to, from).changes;
  counts.cadre = db.prepare('UPDATE cadre_members SET student_name = ? WHERE student_name = ?').run(to, from).changes;

  const changed = Object.values(counts).some((n) => n > 0);
  return { changed, counts };
}

module.exports = { renameStudentRefs };
