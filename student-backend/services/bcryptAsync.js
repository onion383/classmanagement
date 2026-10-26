// =========================================================================
// services/bcryptAsync.js —— bcrypt 异步封装
//
// 为什么需要这个模块：
//   bcrypt 是**故意设计得慢**的密码哈希算法（cost=10 即为抵抗暴力破解），
//   实测单次 hash 约 65ms、compare 约 56ms（cost=12 达 226ms）。
//   用同步版（hashSync / compareSync）调用时，**整个后端的事件循环会被独占**：
//   期间所有并发请求（前端轮询、桌面小组件 IPC、缩略图批量请求）全部排队等待。
//   登录 / 注册 / 改密码这些用户高频且在意的操作，每次都会造成一次可见的卡顿。
//
// 为什么用 bcryptjs 而不是 bcrypt 原生包：
//   bcryptjs 是纯 JS 实现，无需原生编译。bcryptjs 的**异步版**内部按
//   MAX_EXECUTION_TIME = 100ms 分片计算，每片结束就 break 让出事件循环
//   （见 node_modules/bcryptjs/index.js 的 _hash 循环）。
//   也就是说：总耗时不变（仍是 CPU 计算），但**不再独占事件循环**，
//   其它请求可以在分片间隙得到处理机会。
//
// 用法：
//   const { hash, compare } = require('../services/bcryptAsync');
//   const h = await hash(password, 10);      // 等价 bcrypt.hashSync(password, 10)
//   const ok = await compare(password, h);   // 等价 bcrypt.compareSync(password, h)
//
// 兼容性说明：
//   本模块只提供异步接口。**同步版请勿再直接使用** —— 若确有同步场景
//   （如必须在非 async 上下文中调用），请在调用处注明理由。
// =========================================================================

// bcryptjs 只在用户操作（登录/注册/改密码）时用到，不需要在后端就绪前加载：
// 改为首次调用时才 require，避免把它的冷加载成本压在启动关键路径上（行为完全不变）。
let _bcrypt = null;
const useBcrypt = () => (_bcrypt || (_bcrypt = require('bcryptjs')));

// 密码哈希强度（cost）。与原同步实现保持一致：10。
const DEFAULT_ROUNDS = 10;

// 异步计算密码哈希：等价于 bcrypt.hashSync(password, rounds)
function hash(password, rounds = DEFAULT_ROUNDS) {
  return new Promise((resolve, reject) => {
    useBcrypt().hash(password, rounds, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

// 异步比对密码：等价于 bcrypt.compareSync(password, hashValue)
//   · 密码正确 → resolve(true)
//   · 密码错误 → resolve(false)（不是 reject）
//   · hashValue 格式非法 → bcryptjs 直接判 false（与同步版行为一致）
function compare(password, hashValue) {
  return new Promise((resolve, reject) => {
    useBcrypt().compare(password, hashValue, (err, result) => {
      if (err) return reject(err);
      resolve(!!result);
    });
  });
}

module.exports = { hash, compare, DEFAULT_ROUNDS };
