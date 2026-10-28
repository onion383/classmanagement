// =========================================================================
// pendingRegs.js —— 待确认注册草稿（超级隐私模式）
//
// 注册时先生成恢复词，用户抄写前 3 词通过后才真正建库；草稿只存在内存里，
// 未确认不占用账号，TTL 到期自动失效。
//
// 为什么单独成模块：草稿只有 TTL 到期才释放，反复 POST /register（privacy=true）
// 可以在 30 分钟内无限堆积草稿（每条约含密码哈希与恢复词哈希），是典型的
// 「慢速内存消耗」。此时需要容量上限，逻辑独立出来也便于单测。
// =========================================================================

const crypto = require('crypto');

const PENDING_TTL_MS = 30 * 60 * 1000; // 30 分钟
// 同时存在的草稿上限：正常用户同时最多一两个，留 20 个余量；
// 超过说明是脚本在刷，按「最旧先淘汰」把内存压住。
const PENDING_MAX = 20;

const drafts = new Map(); // Map 保持插入顺序，keys().next() 即最旧一条

function newDraftId() {
  return crypto.randomBytes(16).toString('hex');
}

// 存草稿并返回 draftId；写入前先按容量淘汰最旧的草稿
function put(draft) {
  while (drafts.size >= PENDING_MAX) {
    const oldest = drafts.keys().next().value;
    if (oldest === undefined) break;
    drafts.delete(oldest);
  }
  const id = newDraftId();
  drafts.set(id, draft);
  const timer = setTimeout(() => {
    // 同一 id 上若已换成别的草稿（理论上不会），不误删
    if (drafts.get(id) === draft) drafts.delete(id);
  }, PENDING_TTL_MS);
  // 定时器不拖住进程退出（主进程与测试进程都适用）
  if (timer && typeof timer.unref === 'function') timer.unref();
  return id;
}

const get = (id) => drafts.get(id);
const remove = (id) => drafts.delete(id);
const size = () => drafts.size;
// 仅测试使用：清空草稿
function _reset() { drafts.clear(); }

module.exports = { PENDING_TTL_MS, PENDING_MAX, put, get, remove, size, _reset };
