// 本地日期工具（**零依赖**，供 dbManager 这类底层模块使用）。
//
// 为什么单独一个文件、不放进 utils/sql.js：
//   sql.js 虽然是"工具"，但它 require('../db')，而 db.js 又 require('./dbManager/dbManager')。
//   底层模块（如 dbManager.memory.js）去引 sql.js 就成环了（db 可能拿到 undefined）。
//   这里只放不碰数据库的纯函数，谁都能安全引用。
//
// 为什么不能用 new Date().toISOString().slice(0, 10)：
//   toISOString 是 UTC 口径。东八区在本地 00:00–08:00 之间它给出的还是「昨天」——
//   记忆条目会被写进昨天的小标题下，周键/文件名也会错一天。

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 取「本地时区」的 YYYY-MM-DD；非法日期返回空串（调用方按「没有日期」处理）
function localDateStr(d = new Date()) {
  const date = d instanceof Date ? d : new Date(d);
  if (!date || isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

const todayStr = () => localDateStr(new Date());

module.exports = { pad2, localDateStr, todayStr };
