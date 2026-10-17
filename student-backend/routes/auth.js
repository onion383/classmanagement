const express = require('express');
const router = express.Router();
const crypto = require('crypto');
// jsonwebtoken 只在登录/注册/重置密码等「签发 Token」时用到，不需要在后端就绪前加载：
// 改为首次调用时才 require，避免把它（连带 semver / side-channel 等）的冷加载成本
// 压在启动关键路径上（行为完全不变）。
let _jwt = null;
const useJwt = () => (_jwt || (_jwt = require('jsonwebtoken')));
// bcryptjs 只在登录/注册/重置密码等「用户操作」里用到，不需要在后端就绪前加载：
// 改为首次调用时才 require，避免把它的冷加载成本压在启动关键路径上（行为完全不变）。
let _bcrypt = null;
const useBcrypt = () => (_bcrypt || (_bcrypt = require('bcryptjs')));
const bcrypt = {
  compareSync: (...a) => useBcrypt().compareSync(...a),
  hashSync: (...a) => useBcrypt().hashSync(...a),
};
const { SECRET, auth, TOKEN_SIGN_OPTS, TOKEN_COOKIE_MAX_AGE } = require('../middleware/auth');
const sessions = require('../services/sessions');
const { pickPhrase, deriveRestoreHash, normalizePhrase, formatPhrase, safeEqualHash } = require('../services/recoveryKey');
const dbManager = require('../dbManager');

// 待确认注册草稿：有密码账号先生成恢复密钥，用户「抄写前 3 词」通过后才真正建库。
// 未确认的草稿不会占用账号，且在 TTL 后自动失效。
const PENDING_TTL_MS = 30 * 60 * 1000; // 30 分钟
const pendingRegs = new Map();
function newDraftId() { return crypto.randomBytes(16).toString('hex'); }
function putDraft(draft) {
  const id = newDraftId();
  pendingRegs.set(id, draft);
  setTimeout(() => { if (pendingRegs.get(id) === draft) pendingRegs.delete(id); }, PENDING_TTL_MS);
  return id;
}

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

// ---------------------------------------------------------------------------
// POST /logout  —— 主动退出登录
// 把当前 token 的会话（sid）从名单里移除，原 token 立即失效：即使旧 token 被留用也验不过。
// 只吊销本次登录的这一条会话，同账号在其它设备上的登录态不受影响。
router.post('/logout', auth(), (req, res) => {
  sessions.revoke(req.user && req.user.sid);
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true });
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
    return res.status(401).json({ error: '账号或密码错误' });
  }

  const user = resolved.conn.prepare('SELECT id, username, role, db_slug, password FROM users WHERE username = ?').get(username);
  if (!user) {
    console.warn('[login] 库内查无此账号:', username, 'slug:', resolved.slug);
    return res.status(401).json({ error: '账号或密码错误' });
  }
  // 无密码用户：直接放行；有密码用户：校验密码哈希
  if (user.password && !bcrypt.compareSync(password, user.password)) {
    console.warn('[login] 密码校验失败:', username);
    return res.status(401).json({ error: '账号或密码错误' });
  }

  const token = useJwt().sign(
    {
      userId: user.id, username: user.username, role: user.role,
      dbSlug: user.db_slug || resolved.slug,
      sid: sessions.create(user.id), // 会话名单：主动退出时吊销，原 token 立即失效
    },
    SECRET,
    TOKEN_SIGN_OPTS
  );
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TOKEN_COOKIE_MAX_AGE
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
  const { username, password, role, encrypted } = req.body || {};

  // 仅班主任开放
  if (role !== 'teacher') {
    console.warn('[register] 非班主任角色被拒绝: role=', role);
    return res.status(403).json({ error: '该角色正在开发中，请先使用「班主任」注册' });
  }

  // 保存方式：缺省加密（兼容现有调用）；显式 false/0/'0' 视为明文保存
  const wantEncrypted = !(encrypted === false || encrypted === 0 || encrypted === '0');

  const uname = String(username || '').trim();
  if (uname.length < 2 || uname.length > 30) {
    console.warn('[register] 账号长度非法:', uname);
    return res.status(400).json({ error: '账号长度需在 2-30 字符之间' });
  }
  if (!/^[\w\u4e00-\u9fa5@.-]+$/.test(uname)) {
    console.warn('[register] 账号含非法字符:', uname);
    return res.status(400).json({ error: '账号包含非法字符' });
  }

  // 明文保存不允许设置密码（明文库没有库钥匙，无法承载密码保护）
  if (!wantEncrypted && password) {
    console.warn('[register] 明文保存模式禁止设置密码:', uname);
    return res.status(400).json({ error: '明文保存模式下不允许设置密码' });
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

  const hasPassword = !!passwordHash;
  if (!hasPassword) {
    // 无密码账号无恢复密钥可抄写，直接创建（明文或密文均可）。
    // 注册即签发登录态，便于首次引导继续设置班级信息并进入首页。
    try {
      const { slug } = dbManager.createTeacher(uname, passwordHash, 'teacher', wantEncrypted);
      console.log('[register] 无密码注册成功:', uname, 'slug:', slug, 'encrypted:', wantEncrypted);
      const token = useJwt().sign(
        { userId: 1, username: uname, role: 'teacher', dbSlug: slug, sid: sessions.create(1) },
        SECRET,
        TOKEN_SIGN_OPTS
      );
      res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: TOKEN_COOKIE_MAX_AGE
      });
      return res.json({
        message: '注册成功',
        token,
        user: { id: 1, username: uname, role: 'teacher', dbSlug: slug, hasPassword: false },
      });
    } catch (err) {
      console.error('[register] 注册抛异常:', uname, err.stack || err.message);
      if (!res.headersSent) return res.status(500).json({ error: '注册失败：' + (err.message || '未知错误') });
      return;
    }
  }

  // 有密码账号（必然加密）：先生成恢复密钥，存草稿；抄写通过后由 /api/register/confirm 真正建库。
  const phrase = pickPhrase();
  const restoreHash = deriveRestoreHash(phrase);
  const draftId = putDraft({ username: uname, passwordHash, role: 'teacher', restoreHash });
  console.log('[register] 生成待确认草稿:', uname, 'draftId:', draftId);
  res.json({
    message: '注册进行中，请抄写前 3 个恢复词完成确认',
    draftId,
    recovery: { phrase: formatPhrase(phrase), hash: restoreHash },
    user: { username: uname, role: 'teacher', dbSlug: null },
  });
});

// ---------------------------------------------------------------------------
// 完成确认注册：前端在「抄写前 3 词」校验通过后调用，此时才真正创建账号库。
// ---------------------------------------------------------------------------
router.post('/register/confirm', (req, res) => {
  const { draftId } = req.body || {};
  const draft = draftId && pendingRegs.get(draftId);
  if (!draft) {
    return res.status(400).json({ error: '确认已过期，请重新注册' });
  }

  // 确认前再次校验唯一（防止等待期间被他人注册占用）
  if (dbManager.registryFindByUsername(draft.username)) {
    pendingRegs.delete(draftId);
    console.warn('[register/confirm] 确认时账号已被注册:', draft.username);
    return res.status(409).json({ error: '该账号已被注册' });
  }

  try {
    const { slug } = dbManager.createTeacher(draft.username, draft.passwordHash, draft.role);
    const resolved = dbManager.resolveByUsername(draft.username);
    if (resolved && draft.restoreHash) {
      resolved.conn.prepare('UPDATE users SET recovery_hash = ? WHERE username = ?').run(draft.restoreHash, draft.username);
    }
    pendingRegs.delete(draftId);
    console.log('[register/confirm] 确认注册成功:', draft.username, 'slug:', slug);
    // 签发登录态，注册成功即自动进入系统，无需再回登录页手动登录
    const userRow = resolved.conn.prepare('SELECT id, username, role FROM users WHERE username = ?').get(draft.username);
    const token = useJwt().sign(
      {
        userId: userRow.id, username: userRow.username, role: userRow.role,
        dbSlug: slug,
        sid: sessions.create(userRow.id),
      },
      SECRET,
      TOKEN_SIGN_OPTS
    );
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: TOKEN_COOKIE_MAX_AGE
    });
    res.json({
      message: '注册成功',
      token,
      user: { id: userRow.id, username: draft.username, role: draft.role, dbSlug: slug, hasPassword: true },
    });
  } catch (err) {
    console.error('[register/confirm] 注册抛异常:', draft.username, err.stack || err.message);
    if (!res.headersSent) {
      pendingRegs.delete(draftId);
      res.status(500).json({ error: '注册失败：' + (err.message || '未知错误') });
    }
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