// 入库前的数据清洗与业务校验层：所有写库路径（动态表写入 / AI 整块写入）共用同一套规则，
// 避免 AI 或外部传入了未规范化、含控制字符、超长、类型不符或不符合业务约束的值直接落库。
//
// 三层处理顺序（sanitizeField 统一入口）：
//   1) 列级业务规则 COLUMN_RULES（枚举白名单 / 数值范围 / 日期严格校验 / 路径 / JSON 形状 / 布尔等）；
//   2) 命中不到规则时，退回按列类型（table_meta 的 data_type）做归一；
//   3) 类型也未声明（默认「文字」）时，只做文本清洗。
//
// 设计原则：
//   - 文本一律 trim、去控制字符与零宽字符、换行归一（保留 \n），并设长度上限；
//   - 空串与 null/undefined 统一为 null（枚举等必填规则除外）；
//   - 日期：显式声明的日期列走严格校验（非法直接拒绝）；仅按「日期类型」识别的列保持宽松（不拒绝，避免误伤）。

// 单个文本字段长度上限（超长截断，防止 AI 塞入巨量文本）
const MAX_TEXT_LEN = 10000;
// 单个 JSON 列序列化后的长度上限（整块写入用）
const MAX_JSON_LEN = 200000;
// 零宽字符与行/段分隔符
const ZERO_WIDTH_RE = /[\u200b-\u200f\u2028\u2029\ufeff]/g;
// 控制字符（刻意保留 \t \n \r，见下方位移）
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
// 路径合法性：允许 Windows 盘符前缀（如 C:\ / C:/），其余部分禁止空字节、控制字符与非法字符，总长限 260
const PATH_RE = /^(?:[A-Za-z]:[\\/])?[^<>:"|?*\u0000-\u001f]{0,255}$/;
// 宽松日期（仅归一，不拒绝）：YYYY-M-D，可选带时间
const LOOSE_DATE_RE = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
// 年份合理区间：显式声明的日期列超出该区间视为不合理日期（拒 1900 / 2099 这类离谱年份）
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

// ============================ 基础清洗函数 ============================

// 文本清洗：统一换行 → 去零宽/控制字符 → trim → 长度截断
function cleanText(value) {
  let s = String(value);
  s = s.replace(/\r\n?/g, '\n'); // 统一换行（\r\n / \r → \n）
  s = s.replace(ZERO_WIDTH_RE, ''); // 去零宽字符
  s = s.replace(CONTROL_RE, ''); // 去控制字符（保留 \t \n）
  s = s.trim(); // 去首尾空白（含换行）
  if (s.length > MAX_TEXT_LEN) s = s.slice(0, MAX_TEXT_LEN);
  return s;
}

// 布尔归一：接受 true/false、1/0、'true'/'false'/'1'/'0'（含大小写与空白），统一为 1/0
function normBool(value, name) {
  if (value == null || value === '') return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value ? 1 : 0;
  const s = cleanText(value).toLowerCase();
  if (s === '' || s === 'true' || s === '1') return 1;
  if (s === 'false' || s === '0') return 0;
  throw new Error(`字段「${name}」需要是布尔值（true/false 或 1/0），收到：${value}`);
}

// 数字归一：空 → null；能转为有限数字则转，否则报错
function normNumber(value, name) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`字段「${name}」需要数字，收到：${value}`);
  return n;
}

// 整数归一：在 normNumber 之上强制整数。
// 曾经的写法 `Number.isInteger(v) ? v : normNumber(v)` 只是「转换」，1.5 会原样落进 INTEGER 列，
// SQLite 的类型亲和会把 REAL 值存进整数列（读出来还是 1.5），等于声明的「整数」形同虚设。
function normInt(value, name) {
  if (value === '' || value == null) return null;
  const n = normNumber(value, name);
  if (!Number.isInteger(n)) throw new Error(`字段「${name}」需要整数，收到：${value}`);
  return n;
}

// 四舍五入到指定小数位（金额等最多两位小数）。
// 不能用 Math.round(n * 10^d) / 10^d：二进制浮点会放大误差
//（1.005 * 100 = 100.49999999999999 → 舍成 1.00，金额/分值出现「分」级偏差）。
// 这里先把数字按十进制「移位」（`1.005e2` 会被解析成精确的 100.5），
// 再用 Math.round 舍入、最后移回，得到符合十进制直觉的结果。
// 极端值（如 1e21 的字符串形式本身带指数）解析失败时保持原值：
// 这类数没有有意义的「分」，强行乘 10^d 再除反而丢精度。
// 注：负数沿用 Math.round 的语义（-1.005 → -1），本项目的金额/分值均为非负。
function roundTo(n, digits) {
  const d = Math.max(0, Math.min(20, Number(digits) || 0));
  if (d === 0) return Math.round(n);
  const shifted = Number(`${n}e${d}`);
  if (!Number.isFinite(shifted)) return n;
  return Number(`${Math.round(shifted)}e-${d}`);
}

// 解析日期文本（宽松）：返回 { y, m, d, time } 或 null（识别不出）
function parseDateParts(s) {
  const m = s.match(LOOSE_DATE_RE);
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), time: m[4] ? { h: Number(m[4]), mi: Number(m[5]), s: m[6] ? Number(m[6]) : null } : null };
}

// 校验年月日/时分秒范围（用 Date 回环校验真实存在的日期，如 2 月 30 日不合法）
function assertDateValid(p, name, raw) {
  if (p.y < MIN_YEAR || p.y > MAX_YEAR) {
    throw new Error(`字段「${name}」的年份需在 ${MIN_YEAR}~${MAX_YEAR} 之间（收到：${raw}）`);
  }
  const dt = new Date(p.y, p.mo - 1, p.d);
  if (p.mo < 1 || p.mo > 12 || p.d < 1 || dt.getFullYear() !== p.y || dt.getMonth() !== p.mo - 1 || dt.getDate() !== p.d) {
    throw new Error(`字段「${name}」不是合法日期（收到：${raw}）`);
  }
  if (p.time && (p.time.h > 23 || p.time.mi > 59 || (p.time.s != null && p.time.s > 59))) {
    throw new Error(`字段「${name}」不是合法时间（收到：${raw}）`);
  }
}

// 拼装归一后的日期文本：YYYY-MM-DD（带时间则补 HH:mm(:ss)）
function formatDate(p) {
  const p2 = (n) => String(n).padStart(2, '0');
  let out = `${p.y}-${p2(p.mo)}-${p2(p.d)}`;
  if (p.time) out += ` ${p2(p.time.h)}:${p2(p.time.mi)}${p.time.s != null ? ':' + p2(p.time.s) : ''}`;
  return out;
}

// 宽松日期（按「日期类型」识别的列）：能解析就归一，解析不出则原样保留（不拒绝，避免误伤）
function normDate(value) {
  const s = cleanText(value);
  if (!s) return null;
  const p = parseDateParts(s);
  if (!p) return s;
  try {
    assertDateValid(p, '', s);
  } catch (_) {
    return s; // 宽松模式：范围不合法也原样保留
  }
  return formatDate(p);
}

// 严格日期（显式声明的日期列）：必须能解析为真实存在的日期，否则拒绝
function strictDate(value, name) {
  const s = cleanText(value);
  if (!s) return null;
  const p = parseDateParts(s);
  if (!p) throw new Error(`字段「${name}」需要日期（如 2026-10-17），收到：${value}`);
  assertDateValid(p, name, value);
  return formatDate(p);
}

// 按列类型清洗单个标量值（列类型来自 table_meta，默认「文字」）
// 整数/小数列无论入参是字符串还是数字，都走同一套归一，避免「字符串被归一、数字被放过」，
// 也避免小数落进 INTEGER 列（SQLite 类型亲和只保证存储类，不做整数约束）。
function cleanByType(value, type, name) {
  if (value == null) return null;
  if (type === '整数') return normInt(value, name);
  if (type === '小数') return normNumber(value, name);
  if (typeof value === 'string') {
    if (type === '日期') return normDate(value);
    const s = cleanText(value);
    return s === '' ? null : s;
  }
  // 非字符串且非数值列：保持原样，不改动既有存储行为
  return value;
}

// 整块写入的通用列值清洗：字符串走文本清洗；对象/数组校验可序列化并限长后原样返回（由写库处序列化）
function cleanDocValue(value, name) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const s = cleanText(value);
    return s === '' ? null : s;
  }
  if (typeof value === 'object') {
    let s;
    try {
      s = JSON.stringify(value);
    } catch (_) {
      throw new Error(`字段「${name}」无法序列化为 JSON`);
    }
    if (s.length > MAX_JSON_LEN) throw new Error(`字段「${name}」内容过大（超过 ${MAX_JSON_LEN} 字符）`);
    return value;
  }
  return value;
}

// 路径清洗：文本清洗 → 拒绝「..」上跳 → 校验路径字符合法与长度
function cleanPath(value, name) {
  const s = cleanText(value);
  if (!s) return null;
  if (s.split(/[\\/]/).some((seg) => seg === '..')) {
    throw new Error(`字段「${name}」不能包含「..」路径上跳（收到：${value}）`);
  }
  if (!PATH_RE.test(s)) throw new Error(`字段「${name}」不是合法的路径`);
  return s;
}

// ============================ 列级业务规则 ============================
// 结构：COLUMN_RULES[表名][列名] = 规则对象
//   kind: 'enum'     枚举白名单          { values: [...] }
//         'number'   数值范围            { min?, max?, integer? }
//         'date'     严格日期校验        {}
//         'bool'     布尔（落库 0/1）    {}
//         'path'     路径（禁 .. 与非法字符）
//         'json'     JSON 列形状         { shape: 'array' | 'object' }
//         'apps'     软件列表数组        {}
//         'classinfo' 班级信息对象       {}
// 未命中的列退回按列类型清洗（见 sanitizeField）。
const COLUMN_RULES = {
  // —— 学生 ——
  // 临时学生标记：0=正式 1=临时。它是「成员状态」，不是第二套身份（id 仍是 students.id）。
  students: {
    is_provisional: { kind: 'number', min: 0, max: 1, integer: true },
  },
  // —— 班费记录 ——
  fee_records: {
    收支类型: { kind: 'enum', values: ['收入', '支出'] },
    收支金额: { kind: 'number', min: 0, max: 100000000, decimals: 2 },
    收支时间: { kind: 'date' },
    收据: { kind: 'path' },
  },
  // —— 请假记录 ——
  leave_records: {
    类型: { kind: 'enum', values: ['病假', '事假', '其他'] },
    状态: { kind: 'enum', values: ['请假中', '已返校', '已取消'] },
    开始时间: { kind: 'date' },
    结束时间: { kind: 'date' },
  },
  // —— 加分/扣分记录（分值恒为正，加扣由「类型」区分）——
  score_records: {
    类型: { kind: 'enum', values: ['加分', '扣分'] },
    分值: { kind: 'number', min: 0, max: 100000 },
  },
  // —— 倒计时 ——
  countdowns: {
    截止日: { kind: 'date' },
    包含这一天: { kind: 'bool' },
  },
  // —— 系统设置 ——
  widget_settings: {
    toolbox_enabled: { kind: 'bool' },
    note_save_path: { kind: 'path' },
    screenshot_save_path: { kind: 'path' },
    desktop_apps: { kind: 'apps' },
    class_info: { kind: 'classinfo' },
  },
  // —— 课表（cells 必须是「元素合法」的数组，settings 必须是对象）——
  schedule: { cells: { kind: 'json', shape: 'array', each: 'slot' }, settings: { kind: 'json', shape: 'object' } },
  master_schedule: { cells: { kind: 'json', shape: 'array', each: 'slot' }, settings: { kind: 'json', shape: 'object' } },
  // —— 座位表 ——（seats 规范结构为二维数组：行 → 格；也兼容扁平对象数组，写入时规范化）
  seat_layout: {
    seats: { kind: 'seatgrid' },
    aisle_cols: { kind: 'json', shape: 'array', each: 'int' },
    groups_config: { kind: 'json', shape: 'array' },
    settings: { kind: 'json', shape: 'object' },
  },
  seat_template: {
    seats: { kind: 'seatgrid' },
    aisle_cols: { kind: 'json', shape: 'array', each: 'int' },
    groups_config: { kind: 'json', shape: 'array' },
    settings: { kind: 'json', shape: 'object' },
  },
  seat_weight: { weights: { kind: 'json', shape: 'array' }, settings: { kind: 'json', shape: 'object' } },
  // —— 值日表（cells 为 {项目:{星期:[人名]}} 对象，兼容 daily/big 打包）——
  duty_layout: { cells: { kind: 'dutycells' }, settings: { kind: 'json', shape: 'object' } },
  duty_template: { cells: { kind: 'dutycells' }, settings: { kind: 'json', shape: 'object' } },
  duty_weight: { weights: { kind: 'json', shape: 'object' }, settings: { kind: 'json', shape: 'object' } },
  duty_settings: { days: { kind: 'json', shape: 'array' }, items: { kind: 'json', shape: 'array' } },
};

// 元素级校验（数组类 JSON 列，如课表 cells）：
// 应用里 cells 是「行 → 日」的二维数组，元素为 {course} 对象或历史遗留的字符串。
// 这里只做「元素类型」这一层校验——允许 空值 / 字符串 / 对象 / 数组，拒绝 数字 / 布尔 这类原始值。
// 目的：挡住 [1,2,3] 这种「是数组但元素类型不对」的载荷（渲染取 .course 时会出错），
//       同时不强制要求元素必须是对象，避免误伤存量的纯字符串元素。
// depth 只下探两层（行 → 日），更深层按对象处理，不再递归。
function assertSlotElements(arr, name, depth) {
  if (depth > 2) return;
  arr.forEach((el) => {
    if (el == null || typeof el === 'string' || typeof el === 'object') {
      if (Array.isArray(el)) assertSlotElements(el, name, depth + 1);
      return;
    }
    throw new Error(`字段「${name}」的元素只能是空值/文本/对象（不能是数字或布尔），收到：${JSON.stringify(el)}`);
  });
}

// 座位表 seats 校验。应用内的规范结构是「行 → 格」的二维数组
// （前端 useSeatGrid 与后端 seats.js 全按 seats[行][列] 处理），每格只能是
//   空值 / 数字（学生 id）/ 文本（未解析到 id 的姓名，长度 ≤ 20）。
//
// 为兼容历史/外部（如 AI）写入，若传入的是「扁平对象数组」
// （形如 [{row,col,student_id,name}, ...]），会先规范化为二维数组再落库，
// 保证库中数据始终是前端可渲染的二维形态。规范化过程中逐条校验，不合法则带
// 「位置 + 实际值」报错拒绝：row/col 为 ≥1 整数且坐标唯一、student_id 为正整数或空、
// name 为 ≤20 文本、每个元素至少有 student_id 或 name。
// 注意：越界（超 rows/cols）与 id 是否真实存在属于依赖既有数据的校验，由 businessRules 负责。
const SEAT_NAME_MAX = 20;
// 座位矩阵上限：本模块是这两个常量的**唯一来源**，routes/seats.js 与
// routes/undo/undo.executors.js 都从这里导入，不要再在别处写死 50/30。
// 扁平数组若按 row/col 直接分配矩阵，必须在此处设上限，否则超大坐标可造成 OOM。
const SEAT_MAX_ROWS = 50;
const SEAT_MAX_COLS = 30;

function assertSeatCell(cell, name, r, c) {
  if (cell == null) return;
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) throw new Error(`字段「${name}」第 ${r + 1} 行第 ${c + 1} 列不是合法数字：${JSON.stringify(cell)}`);
    return;
  }
  if (typeof cell === 'string') {
    if (cell.length > SEAT_NAME_MAX) throw new Error(`字段「${name}」第 ${r + 1} 行第 ${c + 1} 列的姓名过长（${cell.length} > ${SEAT_NAME_MAX}）`);
    return;
  }
  throw new Error(`字段「${name}」第 ${r + 1} 行第 ${c + 1} 列只能是空值 / 学生id / 姓名，收到：${JSON.stringify(cell)}`);
}

// 把「扁平对象数组」规范化成二维数组，并在此过程中完成元素级校验
function flatSeatsToMatrix(arr, name) {
  const seen = new Set();
  const items = [];
  arr.forEach((el, i) => {
    if (!el || typeof el !== 'object' || Array.isArray(el)) {
      throw new Error(`字段「${name}」第 ${i + 1} 个元素应为 {row,col,student_id,name} 对象，收到：${JSON.stringify(el)}`);
    }
    const r = el.row, c = el.col;
    if (!Number.isInteger(r) || r < 1) throw new Error(`字段「${name}」第 ${i + 1} 个元素的 row 应为 ≥1 的整数，收到：${JSON.stringify(r)}`);
    if (!Number.isInteger(c) || c < 1) throw new Error(`字段「${name}」第 ${i + 1} 个元素的 col 应为 ≥1 的整数，收到：${JSON.stringify(c)}`);
    const key = `${r},${c}`;
    if (seen.has(key)) throw new Error(`字段「${name}」坐标重复：第 ${i + 1} 个元素 (row=${r},col=${c}) 与前面的元素重复`);
    seen.add(key);
    const sid = el.student_id;
    if (sid != null && !(Number.isInteger(sid) && sid > 0)) {
      throw new Error(`字段「${name}」第 ${i + 1} 个元素的 student_id 应为正整数或空，收到：${JSON.stringify(sid)}`);
    }
    const nm = el.name;
    if (nm != null && typeof nm !== 'string') throw new Error(`字段「${name}」第 ${i + 1} 个元素的 name 应为文本，收到：${JSON.stringify(nm)}`);
    if (typeof nm === 'string') {
      if (nm.length > SEAT_NAME_MAX) throw new Error(`字段「${name}」第 ${i + 1} 个元素的 name 过长（${nm.length} > ${SEAT_NAME_MAX}）`);
    }
    const val = sid != null ? sid : (nm && nm.trim() ? nm : null);
    if (val == null) throw new Error(`字段「${name}」第 ${i + 1} 个元素缺少 student_id 与 name`);
    items.push({ r, c, val });
  });
  const maxR = Math.max(...items.map((it) => it.r));
  const maxC = Math.max(...items.map((it) => it.c));
  if (maxR > SEAT_MAX_ROWS || maxC > SEAT_MAX_COLS) {
    throw new Error(`字段「${name}」座位坐标超出上限（最多 ${SEAT_MAX_ROWS} 行 × ${SEAT_MAX_COLS} 列），收到 row=${maxR}, col=${maxC}`);
  }
  const matrix = Array.from({ length: maxR }, () => Array(maxC).fill(null));
  items.forEach((it) => { matrix[it.r - 1][it.c - 1] = it.val; });
  return matrix;
}

// 座位校验入口：接受「二维数组」或「扁平对象数组」，统一返回校验后的二维数组
function cleanSeatGrid(value, name) {
  const arr = parseJsonShape(value, 'array', name);
  if (arr.length === 0) return arr;
  const allMatrix = arr.every((el) => Array.isArray(el));
  const allFlat = arr.every((el) => el && typeof el === 'object' && !Array.isArray(el));
  if (allFlat) return flatSeatsToMatrix(arr, name);
  if (allMatrix) {
    if (arr.length > SEAT_MAX_ROWS) throw new Error(`字段「${name}」行数超出上限（最多 ${SEAT_MAX_ROWS} 行），收到 ${arr.length} 行`);
    arr.forEach((row, r) => {
      if (row.length > SEAT_MAX_COLS) throw new Error(`字段「${name}」第 ${r + 1} 行列数超出上限（最多 ${SEAT_MAX_COLS} 列），收到 ${row.length} 列`);
      row.forEach((cell, c) => assertSeatCell(cell, name, r, c));
    });
    return arr;
  }
  const badIdx = arr.findIndex((el) => !Array.isArray(el) && !(el && typeof el === 'object'));
  throw new Error(`字段「${name}」只能是「行×列」二维数组（或 {row,col,student_id,name} 对象数组），第 ${badIdx + 1} 个元素非法：${JSON.stringify(arr[badIdx])}`);
}
// 供写库入口（seats.js）在裁剪前先规范化
function normalizeSeats(value, name = 'seats') { return cleanSeatGrid(value, name); }

// 整数数组元素校验（如 aisle_cols）
function assertIntElements(arr, name) {
  arr.forEach((el, i) => {
    if (!Number.isInteger(el)) throw new Error(`字段「${name}」第 ${i + 1} 个元素应为整数，收到：${JSON.stringify(el)}`);
  });
}

// 值日名单结构校验：{ 项目名: { 星期: [姓名,...] } }
// 项目值必须是对象、星期值必须是数组、数组元素必须是姓名文本（拒 null/数字/对象）
function assertDutyCellShape(cells, name) {
  if (!cells || typeof cells !== 'object' || Array.isArray(cells)) {
    throw new Error(`字段「${name}」必须是「项目 → 星期 → 名单」的对象`);
  }
  Object.keys(cells).forEach((item) => {
    const days = cells[item];
    if (!days || typeof days !== 'object' || Array.isArray(days)) {
      throw new Error(`字段「${name}」的项目「${item}」需要是「星期 → 名单」的对象`);
    }
    Object.keys(days).forEach((day) => {
      const list = days[day];
      if (!Array.isArray(list)) {
        throw new Error(`字段「${name}」的项目「${item}」的「${day}」需要是名单数组`);
      }
      list.forEach((el) => {
        if (typeof el !== 'string') {
          throw new Error(`字段「${name}」的项目「${item}」的「${day}」名单里只能放姓名文本，收到：${JSON.stringify(el)}`);
        }
      });
    });
  });
}

// 值日 cells 校验：统一存「按模式分键」结构 { daily: {...}, big: {...} }，逐模式校验。
// 单模式内容（{ 项目: { 星期: [...] } }）不再接受——读取侧只认打包结构，收下也读不回来。
function cleanDutyCells(value, name) {
  const obj = parseJsonShape(value, 'object', name);
  const keys = Object.keys(obj);
  if (keys.length && !keys.every((k) => k === 'daily' || k === 'big')) {
    throw new Error(`字段「${name}」需要是 { daily: {...}, big: {...} } 结构（按模式分键）`);
  }
  ['daily', 'big'].forEach((m) => { if (obj[m] !== undefined) assertDutyCellShape(obj[m], name); });
  return obj;
}

// JSON 列形状校验：字符串先按 JSON 解析；必须是指定形状；返回解析后的值（由写库处序列化）
function parseJsonShape(value, shape, name) {
  let v = value;
  if (typeof v === 'string') {
    const s = cleanText(v);
    if (!s) return shape === 'array' ? [] : {};
    try {
      v = JSON.parse(s);
    } catch (_) {
      throw new Error(`字段「${name}」需要是合法 JSON（${shape === 'array' ? '数组' : '对象'}）`);
    }
  }
  if (shape === 'array' && !Array.isArray(v)) throw new Error(`字段「${name}」必须是数组`);
  if (shape === 'object' && (!v || typeof v !== 'object' || Array.isArray(v))) throw new Error(`字段「${name}」必须是对象`);
  return cleanDocValue(v, name);
}

// 软件列表（desktop_apps）：必须是数组，元素为 {id,name,path,icon}
function cleanDesktopApps(value, name) {
  const arr = parseJsonShape(value, 'array', name);
  return arr.map((it) => {
    if (!it || typeof it !== 'object') throw new Error(`字段「${name}」的元素需要是对象`);
    const rawPath = cleanText(it.path ?? '').slice(0, 260);
    return {
      id: cleanText(it.id ?? '').slice(0, 40),
      name: cleanText(it.name ?? '').slice(0, 30),
      // 软件路径同样禁止「..」上跳并校验字符，避免写入后被 IPC 直接启动异常路径
      path: rawPath ? cleanPath(rawPath, `${name}.path`) : '',
      // icon 可能来自前端/粘贴内容：与其他文本字段一样去控制字符、截断；
      // 若以后允许 data URL，应在这里单独校验前缀与长度，而不是放开 string 就放行。
      icon: cleanText(it.icon ?? '').slice(0, 200),
    };
  });
}

// 班级信息（class_info）：必须是对象，仅保留约定字段
function cleanClassInfo(value, name) {
  const obj = parseJsonShape(value, 'object', name);
  const out = {};
  ['name', 'motto', 'mottoStyle', 'xuefeng'].forEach((k) => {
    if (obj[k] !== undefined) out[k] = cleanText(obj[k]);
  });
  return out;
}

// 套用单条列级规则
function applyRule(value, rule, name) {
  switch (rule.kind) {
    case 'enum': {
      const s = value == null ? '' : cleanText(value);
      if (!rule.values.includes(s)) {
        throw new Error(`字段「${name}」只能是：${rule.values.join(' / ')}（收到：${value == null ? '' : value}）`);
      }
      return s;
    }
    case 'number': {
      const n = normNumber(value, name);
      if (n == null) return null;
      if (rule.min != null && n < rule.min) throw new Error(`字段「${name}」不能小于 ${rule.min}（收到：${n}）`);
      if (rule.max != null && n > rule.max) throw new Error(`字段「${name}」不能大于 ${rule.max}（收到：${n}）`);
      if (rule.integer && !Number.isInteger(n)) throw new Error(`字段「${name}」需要整数（收到：${n}）`);
      return rule.decimals != null ? roundTo(n, rule.decimals) : n;
    }
    case 'date':
      return strictDate(value, name);
    case 'bool':
      return normBool(value, name);
    case 'path':
      return cleanPath(value, name);
    case 'json': {
      const v = parseJsonShape(value, rule.shape, name);
      if (Array.isArray(v)) {
        if (rule.each === 'slot') assertSlotElements(v, name, 1);
        else if (rule.each === 'int') assertIntElements(v, name);
      }
      return v;
    }
    case 'seatgrid':
      return cleanSeatGrid(value, name);
    case 'dutycells':
      return cleanDutyCells(value, name);
    case 'apps':
      return cleanDesktopApps(value, name);
    case 'classinfo':
      return cleanClassInfo(value, name);
    default:
      return cleanByType(value, '文字', name);
  }
}

// 统一入口：清洗「某表某列」的值。
// 优先套用列级业务规则；没有规则时按列类型（type，缺省「文字」）归一。
function sanitizeField(value, table, column, type) {
  const rule = (COLUMN_RULES[table] || {})[column];
  if (rule) return applyRule(value, rule, column);
  return cleanByType(value, type || '文字', column);
}

module.exports = {
  MAX_TEXT_LEN,
  MAX_JSON_LEN,
  SEAT_MAX_ROWS,
  SEAT_MAX_COLS,
  COLUMN_RULES,
  cleanText,
  cleanByType,
  cleanDocValue,
  cleanPath,
  normBool,
  normNumber,
  normInt,
  normDate,
  strictDate,
  roundTo,
  normalizeSeats,
  assertSeatCell,
  sanitizeField,
};
