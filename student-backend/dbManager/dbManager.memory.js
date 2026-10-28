// =========================================================================
// dbManager.memory.js —— 多库加密核心·AI 长期记忆（md 文档）
// ---------- AI 长期记忆（md 文档） ----------
// （原 dbManager.js 按职责拆分而来，纯代码搬运，行为不变）
// =========================================================================

const fs = require('fs');
const path = require('path');
const { dataDir, ensureDir } = require('./dbManager.base');
// 本地日期（不能引 utils/sql.js：它会 require ../db，而 db 又 require dbManager —— 成环）
const { todayStr } = require('../utils/date');

// 与数据库同层存放，按班主任 slug 隔离：dataDir/ai-memory/<slug>.md；
// 内容会注入 AI 系统提示，并随备份/恢复一起带走。
const memoryDir = ensureDir(path.join(dataDir, 'ai-memory'));
function memoryFilePath(slug) {
  // 仅允许内部 slug 字符，异常值兜底为 default，避免路径穿越
  const safe = /^[A-Za-z0-9_@-]+$/.test(String(slug || '')) ? String(slug) : 'default';
  return path.join(memoryDir, `${safe}.md`);
}
// 读取记忆 md 原文（不存在返回空串）
function readMemory(slug) {
  try { return fs.readFileSync(memoryFilePath(slug), 'utf8'); } catch (_) { return ''; }
}
// 覆盖写入；内容为空则删除文件（相当于清空）
function writeMemory(slug, content) {
  const p = memoryFilePath(slug);
  const text = String(content == null ? '' : content);
  if (!text.trim()) { try { fs.rmSync(p, { force: true }); } catch (_) { /* 忽略 */ } return; }
  fs.writeFileSync(p, text, 'utf8');
}
// 追加记忆条目：按日期分组，条目写为列表项
function appendMemory(slug, items) {
  const list = (Array.isArray(items) ? items : [])
    .map((s) => String(s == null ? '' : s).trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!list.length) return { error: '没有可记住的内容' };
  let cur = readMemory(slug).trimEnd();
  // 用本地日期：toISOString 是 UTC，东八区 00:00–08:00 之间会归到昨天的小标题下
  const today = todayStr();
  const heading = `## ${today}`;
  if (!cur) cur = `# 用户偏好记忆\n\n${heading}`;
  else if (!cur.includes(heading)) cur += `\n\n${heading}`;
  cur += '\n' + list.map((t) => `- ${t}`).join('\n') + '\n';
  writeMemory(slug, cur);
  return { ok: true, count: list.length };
}

module.exports = { readMemory, writeMemory, appendMemory };
