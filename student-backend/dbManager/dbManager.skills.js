// =========================================================================
// dbManager.skills.js —— 多库加密核心·AI 技能（md 指令文件）
// ---------- AI 技能（md 指令文件） ----------
// （原 dbManager.js 按职责拆分而来，纯代码搬运，行为不变）
// =========================================================================

const fs = require('fs');
const path = require('path');
const { dataDir, ensureDir } = require('./dbManager.base');

// 与长期记忆同层，按班主任 slug 隔离：dataDir/ai-skills/<slug>/<技能名>.md；
// 技能是可编辑的 md 指令文件，聊天输入框打「/」按文件名匹配，选中后其内容随本轮注入系统提示。
// 技能 md 根目录：默认可随数据目录走；被用户单独配置为独立目录时读 AI_SKILLS_DIR
// （由 Electron 主进程按 app-config 注入）。目录内仍按班主任 slug 分子目录存放。
const skillsDirRoot = ensureDir(
  process.env.AI_SKILLS_DIR ? path.resolve(process.env.AI_SKILLS_DIR) : path.join(dataDir, 'ai-skills')
);
function skillsDir(slug) {
  const safe = /^[A-Za-z0-9_@-]+$/.test(String(slug || '')) ? String(slug) : 'default';
  return ensureDir(path.join(skillsDirRoot, safe));
}
// 技能名规范化：去扩展名、去首尾空白，禁止路径分隔/穿越与非法字符；非法返回 null
function normalizeSkillName(name) {
  const base = String(name == null ? '' : name).trim().replace(/\.md$/i, '').trim();
  if (!base || base === '.' || base === '..' || /[\\/:*?"<>|\u0000-\u001f]/.test(base)) return null;
  return base.slice(0, 60);
}
function skillFilePath(slug, name) {
  const n = normalizeSkillName(name);
  if (!n) return null;
  return path.join(skillsDir(slug), `${n}.md`);
}
// 列出技能（按名称排序）：[{ name, size, updatedAt }]
function listSkills(slug) {
  const dir = skillsDir(slug);
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isFile() || !/\.md$/i.test(e.name)) continue;
    let st = null;
    try { st = fs.statSync(path.join(dir, e.name)); } catch (_) { continue; }
    out.push({ name: e.name.replace(/\.md$/i, ''), size: st.size, updatedAt: st.mtime.toISOString() });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return out;
}
function skillExists(slug, name) {
  const p = skillFilePath(slug, name);
  if (!p) return false;
  try { return fs.existsSync(p); } catch (_) { return false; }
}
function readSkill(slug, name) {
  const p = skillFilePath(slug, name);
  if (!p) return '';
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; }
}
// 写入（新建或覆盖）：内容为空则删除文件（相当于清空）
function writeSkill(slug, name, content) {
  const p = skillFilePath(slug, name);
  if (!p) throw new Error('技能名不合法');
  const text = String(content == null ? '' : content);
  if (!text.trim()) { try { fs.rmSync(p, { force: true }); } catch (_) { /* 忽略 */ } return; }
  fs.writeFileSync(p, text, 'utf8');
}
function deleteSkill(slug, name) {
  const p = skillFilePath(slug, name);
  if (!p) return false;
  try { fs.rmSync(p, { force: true }); return true; } catch (_) { return false; }
}
// 批量读取技能内容（供注入本轮系统提示）：[{ name, content }]，跳过空内容
function readSkills(slug, names) {
  const list = (Array.isArray(names) ? names : []).slice(0, 20);
  const out = [];
  for (const n of list) {
    const content = readSkill(slug, n);
    if (content.trim()) out.push({ name: normalizeSkillName(n), content });
  }
  return out;
}

module.exports = { skillsDirRoot, normalizeSkillName, listSkills, skillExists, readSkill, writeSkill, deleteSkill, readSkills };
