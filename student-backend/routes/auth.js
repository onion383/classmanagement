const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { SECRET } = require('../middleware/auth');
const { pickPhrase, deriveRestoreHash, normalizePhrase, formatPhrase, safeEqualHash } = require('../services/recoveryKey');
const dbManager = require('../dbManager');

// 账号列表：登录页「从数据库注册」加载已登记的班主任账号（无需登录）
router.get('/accounts', (req, res) => {
  try {
    res.json({ accounts: dbManager.registryList() });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    return res.status(401).json({ error: '账号或密码错误' });
  }
  if (!resolved) return res.status(401).json({ error: '账号或密码错误' });

  const user = resolved.conn.prepare('SELECT id, username, role, db_slug, password FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: '账号或密码错误' });
  // 无密码用户：直接放行；有密码用户：校验密码哈希
  if (user.password && !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '账号或密码错误' });
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
    return res.status(403).json({ error: '该角色正在开发中，请先使用「班主任」注册' });
  }

  const uname = String(username || '').trim();
  if (uname.length < 2 || uname.length > 30) return res.status(400).json({ error: '账号长度需在 2-30 字符之间' });
  if (!/^[\w\u4e00-\u9fa5@.-]+$/.test(uname)) return res.status(400).json({ error: '账号包含非法字符' });

  // 密码为空视为无密码登录，不加密；有密码则校验长度并加密存储
  const passwordHash = !password ? '' : (
    String(password).length < 6
      ? res.status(400).json({ error: '密码长度至少 6 位' })
      : bcrypt.hashSync(String(password), 10)
  );
  if (res.headersSent) return; // 校验失败已返回错误

  // 检查账号唯一（跨所有库）
  if (dbManager.registryFindByUsername(uname)) {
    return res.status(409).json({ error: '该账号已被注册' });
  }

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

  res.json({
    message: '注册成功',
    recovery: hasPassword ? { phrase: formatPhrase(phrase), hash: restoreHash } : null,
    user: { username: uname, role: 'teacher', dbSlug: slug },
  });
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