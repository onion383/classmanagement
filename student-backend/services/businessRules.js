// 依赖既有数据的一致性校验层：入库前检查「引用了不存在的学生 / 项目 / 星期」、
// 座位越界、请假时间段倒置等——这些是单列 schema 校验（services/sanitize.js）覆盖不到的。
//
// 与 sanitize.js 的分工：
//   sanitize.js    管「单列自身的形状 / 类型 / 范围」（如 seats 必须是二维数组、金额范围）；
//   businessRules  管「这一列的内容与库里其他表是否对得上」（如座位里的学生 id 是否真实存在）。
// 所有写库路径（AI 整块写入 / 座位 / 值日 / 请假）共用同一入口 validateRow，避免逐处打补丁。

const { db } = require('../db');

// —— 通用工具 ——
function toObj(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) { return null; } }
  return null;
}
// 日期时间归一为可比较文本：仅日期补 00:00:00，到分钟补 :00（供前后比较）
function normDT(s) {
  const t = String(s);
  return t.length <= 10 ? `${t} 00:00:00` : (t.length === 16 ? `${t}:00` : t);
}

// 学生 id / 姓名集合（每次实时查询，避免缓存与学生增删不同步）
function studentIdSet() {
  return new Set(db.prepare('SELECT id FROM students').all().map((r) => Number(r.id)));
}
function studentNameSet() {
  return new Set(db.prepare('SELECT 姓名 FROM students').all().map((r) => String(r.姓名)));
}

// —— 座位：数字格子（即学生 id）必须真实存在，且「一人一座」不得重复 ——
function assertSeatRefs(seats, name) {
  if (!Array.isArray(seats)) return;
  const ids = studentIdSet();
  const seen = new Map(); // 学生 id -> 已占位置描述
  seats.forEach((row, r) => {
    if (!Array.isArray(row)) return;
    row.forEach((cell, c) => {
      if (typeof cell !== 'number') return;
      if (!ids.has(cell)) throw new Error(`字段「${name}」引用了不存在的学生（id=${cell}）`);
      // 一人一座：同一学生 id 不能出现在两个位置，否则必然有学生没座位
      if (seen.has(cell)) {
        throw new Error(`座位表一名学生只能占一个座位：id=${cell} 同时出现在 ${seen.get(cell)} 与 第${r + 1}行第${c + 1}列`);
      }
      seen.set(cell, `第${r + 1}行第${c + 1}列`);
    });
  });
}

// —— 值日：解析 duty_settings 里的劳动项目（按模式分键 { daily: [...], big: [...] }）——
// 返回 { names:Set<项目名>, maps:{ daily:Map<项目名,人数>, big:Map<项目名,人数> } }
function parseDutyItems(raw) {
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (_) { obj = null; } }
  const names = new Set();
  const maps = { daily: new Map(), big: new Map() };
  const add = (mode, arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((it) => {
      if (!it || typeof it !== 'object') return;
      const nm = it.name != null ? String(it.name) : null;
      if (!nm) return;
      names.add(nm);
      const cnt = Number(it.count);
      if (Number.isFinite(cnt) && cnt > 0) maps[mode].set(nm, cnt);
    });
  };
  if (obj && typeof obj === 'object') { add('daily', obj.daily); add('big', obj.big); }
  return { names, maps };
}

// 值日名单校验：项目名须属于已配置的劳动项目、星期须属于设置的星期、姓名须是班级学生，
// 且每个「项目 · 星期」的人数须与设置里的 count 严格相等。
// 仅在 settings 里确实配置了项目 / 人数时才校验（避免设置未初始化时误伤）。
// 兼容两种提交形态：PUT /api/duty 传来的「单模式内容」（{项目:{星期:[...]}}）、
// 整块写入（AI propose_json_write 等）传来的 {daily,big} 打包内容。
function assertDutyRefs(cells, name) {
  const obj = toObj(cells);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  const keys = Object.keys(obj);
  const isModeMap = keys.length > 0 && keys.every((k) => k === 'daily' || k === 'big');

  const s = db.prepare('SELECT days, items FROM duty_settings WHERE id = 1').get();
  const dayObj = toObj(s ? s.days : null);
  const dayList = Array.isArray(dayObj) ? dayObj.map(String) : [];
  const { names: itemNames, maps } = parseDutyItems(s ? s.items : null);
  // 单模式提交（看不出是哪个模式）时，人数取 daily 与 big 的并集（同名以 daily 优先）
  const unionMap = new Map([...maps.big, ...maps.daily]);
  const names = studentNameSet();

  const layers = isModeMap
    ? ['daily', 'big'].map((m) => ({ mode: m, layer: obj[m] })).filter((x) => x.layer && typeof x.layer === 'object')
    : [{ mode: null, layer: obj }];

  layers.forEach(({ mode, layer }) => {
    // 打包提交按模式取人数；单模式提交共用并集
    const countMap = mode != null ? maps[mode] : unionMap;
    Object.keys(layer).forEach((item) => {
      if (itemNames.size && !itemNames.has(item)) {
        throw new Error(`值日项目「${item}」不在设置的劳动项目里（字段「${name}」）`);
      }
      const daysObj = layer[item];
      if (!daysObj || typeof daysObj !== 'object' || Array.isArray(daysObj)) return;
      Object.keys(daysObj).forEach((day) => {
        if (dayList.length && !dayList.includes(day)) {
          throw new Error(`值日星期「${day}」不在设置的星期列表里（字段「${name}」）`);
        }
        const list = daysObj[day];
        if (!Array.isArray(list)) return;
        // 人数严格等于设置的 count（仅在确实配置了该项目人数时校验）
        const cnt = countMap.get(item);
        if (cnt != null && list.length !== cnt) {
          throw new Error(`值日的「${item} · ${day}」应排 ${cnt} 人，实际 ${list.length} 人（字段「${name}」）`);
        }
        list.forEach((n) => {
          if (typeof n === 'string' && n && !names.has(n)) {
            throw new Error(`值日名单里的「${n}」不是班级学生（字段「${name}」）`);
          }
        });
      });
    });
  });
}

// —— 请假：结束时间必须晚于开始时间（两者都提供时才校验）——
function assertLeaveWindow(start, end) {
  if (!start || !end) return;
  if (normDT(end) <= normDT(start)) {
    throw new Error(`请假的「结束时间」必须晚于「开始时间」（开始：${start}，结束：${end}）`);
  }
}

// —— 统一入口 ——
// table：目标表；values：本次要写入的列值（可只含部分列）；
// existing：该行旧值（更新时传入，用于补齐 values 里没出现的列）。
function validateRow(table, values, existing) {
  const pick = (k) => (values && values[k] !== undefined ? values[k] : (existing ? existing[k] : undefined));

  if (table === 'seat_layout' || table === 'seat_template') {
    const seats = toObj(pick('seats'));
    const rows = Number(pick('rows'));
    const cols = Number(pick('cols'));
    // 尺寸越界：座位行数 / 每行格数不得超过设定的行×列
    if (Array.isArray(seats) && Number.isInteger(rows) && Number.isInteger(cols)) {
      if (seats.length > rows) throw new Error(`座位行数（${seats.length}）超出设定的 ${rows} 行`);
      seats.forEach((r, i) => {
        if (Array.isArray(r) && r.length > cols) throw new Error(`座位第 ${i + 1} 行有 ${r.length} 格，超出设定的 ${cols} 列`);
      });
    }
    assertSeatRefs(seats, 'seats');
  } else if (table === 'duty_layout' || table === 'duty_template') {
    assertDutyRefs(pick('cells'), 'cells');
  } else if (table === 'leave_records') {
    assertLeaveWindow(pick('开始时间'), pick('结束时间'));
  }
}

module.exports = { validateRow, assertLeaveWindow, assertSeatRefs, assertDutyRefs };
