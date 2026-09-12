const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { SECRET, auth } = require('../middleware/auth');
const { pickPhrase, deriveRestoreHash, normalizePhrase, formatPhrase, safeEqualHash } = require('../services/recoveryKey');
const dbManager = require('../dbManager');

// 账号列表：登录页「从数据库注册」加载已登记的班主任账号（无需登录）。
// 仅返回数据库有效的账号——解不开/打不开/账号行缺失的无效库直接隐藏。
router.get('/accounts', (req, res) => {
  try {
    res.json({ accounts: dbManager.registryListValid() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 轻量登录态校验：前端在进入内部页前调用，确认本地 token 仍被后端接受。
// 无效即返回 401，前端据此直接回登录页，避免「先渲染内部页再被踢回」的闪烁。
router.get('/me', auth(), (req, res) => {
  res.json({ username: req.user.username, role: req.user.role, dbSlug: req.user.dbSlug });
});

// 「从数据库文件登录」：前端用文件选择器选中一个 .db 文件后把文件名传上来，
// 后端定位本机登记库、解包钥匙并返回该库内的账号。解不开(外来/无登记)时返回 400，
// 前端据此引导到「从备份恢复」。
router.post('/db-login', (req, res) => {
  const file = req.body && typeof req.body.file === 'string' ? req.body.file.split(/[\\/]/).pop() : '';
  if (!file) return res.status(400).json({ error: '缺少数据库文件' });
  try {
    const r = dbManager.resolveByDbFile(file);
    res.json({ slug: r.slug, username: r.username });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username) return res.status(400).json({ error: '请输入账号' });

  // 用 index.db 定位账号对应的班主任库，打开它并校验密码（账号存于各库内的 users）
  let resolved;
  try {
    resolved = dbManager.resolveByUsername(String(username));
  } catch (err) {
    console.warn('[login] 打开账号库失败:', err.message);
    return res.status(401).json({ error: '账号或密码错误' });
  }
  if (!resolved) {
    console.warn('[login] 账号不在登记表:', username);
    return res.status(401).json({ error: '账号不存在' });
  }

  const user = resolved.conn.prepare('SELECT id, username, role, db_slug, password FROM users WHERE username = ?').get(username);
  if (!user) {
    console.warn('[login] 库内查无此账号:', username, 'slug:', resolved.slug);
    return res.status(401).json({ error: '账号不存在' });
  }
  // 无密码用户：直接放行；有密码用户：校验密码哈希
  if (user.password && !bcrypt.compareSync(password, user.password)) {
    console.warn('[login] 密码校验失败:', username);
    return res.status(401).json({ error: '密码错误' });
  }

  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role, dbSlug: user.db_slug || resolved.slug },
    SECRET,
    { expiresIn: '7d' }
  );
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, dbSlug: user.db_slug || resolved.slug, hasPassword: !!user.password }
  });
});

// ---------------------------------------------------------------------------
// POST /register  —— 班主任注册
// 仅班主任可用；科任老师 / 学生 返回「正在开发中」。
// 注册即新建一个独立的加密班主任库，并返回 12 词恢复密钥。
// ---------------------------------------------------------------------------
router.post('/register', (req, res) => {
  const { username, password, role } = req.body || {};

  // 仅班主任开放
  if (role !== 'teacher') {
    console.warn('[register] 非班主任角色被拒绝: role=', role);
    return res.status(403).json({ error: '该角色正在开发中，请先使用「班主任」注册' });
  }

  const uname = String(username || '').trim();
  if (uname.length < 2 || uname.length > 30) {
    console.warn('[register] 账号长度非法:', uname);
    return res.status(400).json({ error: '账号长度需在 2-30 字符之间' });
  }
  if (!/^[\w\u4e00-\u9fa5@.-]+$/.test(uname)) {
    console.warn('[register] 账号含非法字符:', uname);
    return res.status(400).json({ error: '账号包含非法字符' });
  }

  // 密码为空视为无密码登录，不加密；有密码则校验长度并加密存储
  const passwordHash = !password ? '' : (
    String(password).length < 6
      ? res.status(400).json({ error: '密码长度至少 6 位' })
      : bcrypt.hashSync(String(password), 10)
  );
  if (res.headersSent) return; // 校验失败已返回错误

  // 检查账号唯一（跨所有库）
  if (dbManager.registryFindByUsername(uname)) {
    console.warn('[register] 账号重复:', uname);
    return res.status(409).json({ error: '该账号已被注册' });
  }

  try {
    // 无密码注册无需恢复密钥（恢复密钥仅用于「忘记密码」重置，无密码不存在该场景）
    const hasPassword = !!passwordHash;
    const phrase = hasPassword ? pickPhrase() : null;
    const restoreHash = hasPassword ? deriveRestoreHash(phrase) : null;

    const { slug } = dbManager.createTeacher(uname, passwordHash, 'teacher');
    // 有密码才把恢复密钥哈希写入新库的账号
    const resolved = dbManager.resolveByUsername(uname);
    if (resolved && restoreHash) {
      resolved.conn.prepare('UPDATE users SET recovery_hash = ? WHERE username = ?').run(restoreHash, uname);
    }

    console.log('[register] 注册成功:', uname, 'slug:', slug, 'hasPassword:', hasPassword);
    res.json({
      message: '注册成功',
      recovery: hasPassword ? { phrase: formatPhrase(phrase), hash: restoreHash } : null,
      user: { username: uname, role: 'teacher', dbSlug: slug },
    });
  } catch (err) {
    console.error('[register] 注册抛异常:', uname, err.stack || err.message);
    if (!res.headersSent) res.status(500).json({ error: '注册失败：' + (err.message || '未知错误') });
  }
});

// ---------------------------------------------------------------------------
// POST /recover-password  —— 用恢复密钥重置密码
// ---------------------------------------------------------------------------
router.post('/recover-password', (req, res) => {
  const { username, phrase, newPassword } = req.body || {};
  if (!username || !phrase || !newPassword) {
    return res.status(400).json({ error: '请提供账号、恢复密钥和新密码' });
  }
  if (String(newPassword).length < 6) return res.status(400).json({ error: '新密码长度至少 6 位' });

  const resolved = dbManager.resolveByUsername(String(username).trim());
  if (!resolved) return res.status(404).json({ error: '账号不存在' });

  const user = resolved.conn.prepare('SELECT username, recovery_hash FROM users WHERE username = ?').get(String(username).trim());
  if (!user || !user.recovery_hash) return res.status(404).json({ error: '该账号未设置恢复密钥' });

  // 归一化输入：仅保留汉字，兼容用户粘贴带序号（1.水 …）或带空格的格式
  const inputHash = deriveRestoreHash(normalizePhrase(phrase));
  if (!safeEqualHash(inputHash, user.recovery_hash)) {
    return res.status(403).json({ error: '恢复密钥错误' });
  }

  const passwordHash = bcrypt.hashSync(String(newPassword), 10);
  resolved.conn.prepare('UPDATE users SET password = ? WHERE username = ?').run(passwordHash, user.username);
  res.json({ message: '密码已重置，请重新登录' });
});

module.exports = router;