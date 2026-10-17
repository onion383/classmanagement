const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dbManager = require('../dbManager');

// 有效登录会话名单（sid）：JWT 里只带一个随机 sid，服务端按这份名单校验。
// 「不主动退出就一直有效」+「退出后原 token 立即失效」都由此实现——
// 退出时把 sid 从名单里删掉，那个 token 下一次请求就验不过了。
// 名单持久化到 dataDir（随 userData 保留），重启后端不会把所有人登出。
const FILE = () => path.join(dbManager.dataDir, '.sessions.json');

let cache = null; // { [sid]: { userId, at } }

function load() {
  if (cache) return cache;
  try {
    const obj = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    cache = obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch (_) {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.writeFileSync(FILE(), JSON.stringify(cache), { encoding: 'utf8', mode: 0o600 });
  } catch (_) { /* 写入失败则退化为进程内名单，重启后需重新登录 */ }
}

// 登录时登记一个新会话，返回 sid（写进 JWT 的 sid 声明）
function create(userId) {
  const list = load();
  const sid = crypto.randomBytes(24).toString('hex');
  list[sid] = { userId: userId == null ? null : userId, at: Date.now() };
  save();
  return sid;
}

// 校验会话是否仍在名单里（每次请求走内存缓存，无文件 IO）
function has(sid) {
  if (!sid) return false;
  return Object.prototype.hasOwnProperty.call(load(), sid);
}

// 主动退出：吊销该会话，原 token 立即失效
function revoke(sid) {
  const list = load();
  if (!sid || !Object.prototype.hasOwnProperty.call(list, sid)) return false;
  delete list[sid];
  save();
  return true;
}

module.exports = { create, has, revoke };
