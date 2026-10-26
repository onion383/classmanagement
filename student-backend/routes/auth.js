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
// 惰性加载逻辑已下沉到 services/bcryptAsync.js，本文件只引用它的异步接口。
const { hash: bcryptHash, compare: bcryptCompare } = require('../services/bcryptAsync');
const { SECRET, auth, TOKEN_SIGN_OPTS, TOKEN_COOKIE_MAX_AGE, signMediaToken } = require('../middleware/auth');
const secureChannel = require('../services/secureChannel');
const sessions = require('../services/sessions');
const { pickPhrase, deriveRestoreHash, normalizePhrase, formatPhrase, safeEqualHash } = require('../services/recoveryKey');
const dbManager = require('../dbManager/dbManager');

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

// 签发登录态：登录 token + 媒体凭据，并把 token 绑定到本次加密信道会话。
// 绑定后前端后续请求只需发送不含 token 的信道凭据，登录 token 不再随每次请求上线；
// mediaToken 只用于 <img>/CSS 这类无法携带自定义头的静态资源，且不能调用业务 API。
function issueSession(req, user, extra = {}) {
  const sid = sessions.create(user.userId);
  const payload = { userId: user.userId, username: user.username, role: user.role, dbSlug: user.dbSlug, sid, ...extra };
  const token = useJwt().sign(payload, SECRET, TOKEN_SIGN_OPTS);
  if (req.sessionId) secureChannel.bindAuth(req.sessionId, token);
  return { token, mediaToken: signMediaToken(payload) };
}

function setAuthCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TOKEN_COOKIE_MAX_AGE
  });
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

// 刷新媒体凭据：媒体凭据过期或换号后，前端用普通 API 调用取一份新的，
// 不必让用户重新登录（登录 token 仍有效即可）。
router.get('/media-token', auth(), (req, res) => {
  try {
    res.json({ mediaToken: signMediaToken(req.user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /logout  —— 主动退出登录
// 把当前 token 的会话（sid）从名单里移除，原 token 立即失效：即使旧 token 被留用也验不过。
// 只吊销本次登录的这一条会话，同账号在其它设备上的登录态不受影响。
router.post('/logout', auth(), (req, res) => {
  sessions.revoke(req.user && req.user.sid);
  // 解绑信道会话：换号登录后同一信道不会继续沿用上一个账号的 token
  secureChannel.unbindAuth(req.sessionId);
  // 超级隐私模式：登出即关闭库连接并丢弃内存里的库钥匙，下次使用必须重新输入密码/恢复词
  dbManager.lockDb(req.user && req.user.dbSlug);
  // 扫描子进程也可能持有该库连接，一并关闭
  try { require('../scanWorker').lockDb(req.user && req.user.dbSlug); } catch (_) { /* 子进程未启动 */ }
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

// 「本机信息恢复」：忘记密码时选中本机 .db 文件，凭本机登记表 + 主密钥直接签发登录态，
// 但 token 带 recover 标记，只能先改密码（见 PUT /account/password）。
// 超级隐私库没有主密钥包裹，本接口不适用（会抛错，引导改用恢复词）。
router.post('/db-recover', (req, res) => {
  const file = req.body && typeof req.body.file === 'string' ? req.body.file.split(/[\\/]/).pop() : '';
  if (!file) return res.status(400).json({ error: '缺少数据库文件' });
  try {
    const r = dbManager.resolveByDbFile(file);
    const resolved = dbManager.resolveByUsername(r.username);
    if (!resolved) return res.status(400).json({ error: '数据库内没有可用账号' });
    const user = resolved.conn.prepare('SELECT id, username, role FROM users WHERE username = ?').get(r.username);
    if (!user) return res.status(400).json({ error: '数据库内没有可用账号' });
    const { token, mediaToken } = issueSession(req, {
      userId: user.id, username: user.username, role: user.role, dbSlug: r.slug,
    }, { recover: true });
    setAuthCookie(res, token);
    res.json({
      mustChangePassword: true,
      token,
      mediaToken,
      user: { id: user.id, username: user.username, role: user.role, dbSlug: r.slug, hasPassword: true },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------
router.post('/login', async (req, res) => {
  const { username, password, mnemonic } = req.body;
  if (!username) return res.status(400).json({ error: '请输入账号' });

  // 用 index.db 定位账号对应的班主任库，打开它并校验密码（账号存于各库内的 users）
  let resolved;
  try {
    resolved = dbManager.resolveByUsername(String(username), { password, mnemonic });
  } catch (err) {
    if (err.code === 'PRIVACY_UNLOCK') {
      // 超级隐私模式：库钥匙解不开就到此为止，不泄露账号是否存在
      return res.status(401).json({ error: err.message, code: 'PRIVACY_UNLOCK' });
    }
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
  // 恢复词解锁本身就是所有者证明：不再校验登录密码（可用于忘记密码时登录后重设）
  const unlockedByMnemonic = resolved.unlockedBy === 'mnemonic';
  // 无密码用户：直接放行；有密码用户：校验密码哈希
  // 保持原短路语义：前两个条件不成立时完全不做密码比对（省一次 bcrypt 计算）。
  if (!unlockedByMnemonic && user.password) {
    const pwOk = await bcryptCompare(password, user.password);
    if (!pwOk) {
      console.warn('[login] 密码校验失败:', username);
      return res.status(401).json({ error: '账号或密码错误' });
    }
  }

  const dbSlug = user.db_slug || resolved.slug;
  const { token, mediaToken } = issueSession(req, {
    userId: user.id, username: user.username, role: user.role, dbSlug,
  });
  setAuthCookie(res, token);
  res.json({
    token,
    mediaToken,
    protect: resolved.protect === true,
    unlockedBy: resolved.unlockedBy || 'password',
    user: { id: user.id, username: user.username, role: user.role, dbSlug, hasPassword: !!user.password }
  });
});

// ---------------------------------------------------------------------------
// POST /register  —— 班主任注册
// 仅班主任可用；科任老师 / 学生 返回「正在开发中」。
// 注册即新建一个独立的班主任库；仅超级隐私模式会先生成 12 词恢复词并要求抄写确认。
// ---------------------------------------------------------------------------
router.post('/register', async (req, res) => {
  const { username, password, role, encrypted, privacy, level } = req.body || {};

  // 仅班主任开放
  if (role !== 'teacher') {
    console.warn('[register] 非班主任角色被拒绝: role=', role);
    return res.status(403).json({ error: '该角色正在开发中，请先使用「班主任」注册' });
  }

  // 安全等级（新）：plain / nopass / password / privacy；未传时回退旧的 encrypted / privacy 参数
  const lvl = ['plain', 'nopass', 'password', 'privacy'].includes(level) ? level : '';
  // 保存方式：缺省加密（兼容现有调用）；显式 false/0/'0' 视为明文保存
  const wantEncrypted = lvl ? lvl !== 'plain' : !(encrypted === false || encrypted === 0 || encrypted === '0');

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
  // 超级隐私模式：必须加密且必须设置登录密码（密码参与库钥匙派生）
  const wantPrivacy = privacy === true || privacy === 1 || privacy === '1' || lvl === 'privacy';
  if (wantPrivacy) {
    if (!wantEncrypted) return res.status(400).json({ error: '明文模式无法开启超级隐私模式' });
    if (!password) return res.status(400).json({ error: '超级隐私模式需要设置登录密码' });
  }

  // 密码为空视为无密码登录，不加密；有密码则校验长度并加密存储
  // （原实现用三元表达式把 res.json(...) 塞进变量、再靠 res.headersSent 判断，
  //   改异步后 await 会打断连续执行，故改为显式提前返回，行为一致。）
  let passwordHash = '';
  if (password) {
    if (String(password).length < 6) {
      res.status(400).json({ error: '密码长度至少 6 位' });
      return;
    }
    passwordHash = await bcryptHash(String(password), 10);
  }

  // 检查账号唯一（跨所有库）
  if (dbManager.registryFindByUsername(uname)) {
    console.warn('[register] 账号重复:', uname);
    return res.status(409).json({ error: '该账号已被注册' });
  }

  // 只有超级隐私模式需要恢复词：它是库钥匙的第二把钥匙。
  // 其余等级（明文 / 无密码 / 普通密码）不再生成恢复词草稿，直接建库并签发登录态。
  if (!wantPrivacy) {
    try {
      const { slug } = dbManager.createTeacher(uname, passwordHash, 'teacher', wantEncrypted);
      console.log('[register] 注册成功:', uname, 'slug:', slug, 'encrypted:', wantEncrypted, 'hasPassword:', !!passwordHash);
      const { token, mediaToken } = issueSession(req, {
        userId: 1, username: uname, role: 'teacher', dbSlug: slug,
      });
      setAuthCookie(res, token);
      return res.json({
        message: '注册成功',
        token,
        mediaToken,
        user: { id: 1, username: uname, role: 'teacher', dbSlug: slug, hasPassword: !!passwordHash },
      });
    } catch (err) {
      console.error('[register] 注册抛异常:', uname, err.stack || err.message);
      if (!res.headersSent) return res.status(500).json({ error: '注册失败：' + (err.message || '未知错误') });
      return;
    }
  }

  // 超级隐私模式：先生成恢复密钥，存草稿；抄写通过后由 /api/register/confirm 真正建库。
  const phrase = pickPhrase();
  const restoreHash = deriveRestoreHash(phrase);
  const draftId = putDraft({ username: uname, passwordHash, role: 'teacher', restoreHash, privacy: wantPrivacy });
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
router.post('/register/confirm', async (req, res) => {
  const { draftId, password, phrase } = req.body || {};
  const draft = draftId && pendingRegs.get(draftId);
  if (!draft) {
    return res.status(400).json({ error: '确认已过期，请重新注册' });
  }

  // 超级隐私模式：复用注册时展示的恢复词作为隐私恢复词。
  // 确认时必须提交同一密码与恢复词，否则账号建出来却解不开。
  if (draft.privacy) {
    // 保持原短路语义：密码为空时不做比对，直接判失败
    let pwOk = false;
    if (password) {
      pwOk = await bcryptCompare(String(password), draft.passwordHash);
    }
    if (!pwOk) {
      return res.status(400).json({ error: '密码不正确' });
    }
    if (!phrase || !safeEqualHash(deriveRestoreHash(normalizePhrase(phrase)), draft.restoreHash)) {
      return res.status(400).json({ error: '恢复词不正确' });
    }
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
    // 建库后立刻开启超级隐私模式：主密钥包裹被抹掉，钥匙只留给密码与恢复词
    if (draft.privacy) {
      try {
        dbManager.enablePrivacy(draft.username, { password: String(password), mnemonic: normalizePhrase(phrase) });
      } catch (err) {
        // 开启失败则回滚这次建库，避免留下一个“半隐私”的账号
        dbManager.deleteTeacher(slug);
        throw err;
      }
    }
    pendingRegs.delete(draftId);
    console.log('[register/confirm] 确认注册成功:', draft.username, 'slug:', slug, 'privacy:', !!draft.privacy);
    // 签发登录态，注册成功即自动进入系统，无需再回登录页手动登录
    const userRow = resolved.conn.prepare('SELECT id, username, role FROM users WHERE username = ?').get(draft.username);
    const { token, mediaToken } = issueSession(req, {
      userId: userRow.id, username: userRow.username, role: userRow.role, dbSlug: slug,
    });
    setAuthCookie(res, token);
    res.json({
      message: '注册成功',
      token,
      mediaToken,
      protect: !!draft.privacy,
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
// 按恢复词在本机已登记账号中定位：恢复词本身就是凭证，所以忘记账号时可以只凭恢复词恢复。
// 隐私库用恢复词直接试解锁（词不对会抛错）；非隐私库打开后比对 users.recovery_hash。
function findAccountsByPhrase(phrase) {
  const inputHash = deriveRestoreHash(normalizePhrase(phrase));
  const hits = [];
  for (const rec of dbManager.registryList()) {
    try {
      if (rec.protect === 1) {
        if (dbManager.resolveByUsername(rec.username, { mnemonic: phrase })) hits.push(rec.username);
        continue;
      }
      const resolved = dbManager.resolveByUsername(rec.username);
      if (!resolved) continue;
      const row = resolved.conn.prepare('SELECT recovery_hash FROM users WHERE username = ?').get(rec.username);
      if (row && row.recovery_hash && safeEqualHash(inputHash, row.recovery_hash)) hits.push(rec.username);
    } catch (_) { /* 打不开 / 词不匹配：跳过 */ }
  }
  return hits;
}

router.post('/recover-password', async (req, res) => {
  const { username, phrase, newPassword } = req.body || {};
  if (!phrase || !newPassword) {
    return res.status(400).json({ error: '请提供恢复密钥和新密码' });
  }
  if (String(newPassword).length < 6) return res.status(400).json({ error: '新密码长度至少 6 位' });

  let name = username ? String(username).trim() : '';
  if (!name) {
    const hits = findAccountsByPhrase(phrase);
    if (hits.length === 0) return res.status(404).json({ error: '本机没有与该恢复词匹配的账号，请填写账号后重试' });
    if (hits.length > 1) return res.status(400).json({ error: '恢复词匹配到多个账号，请填写账号' });
    name = hits[0];
  }

  // 超级隐私模式：恢复词就是第二把解锁钥匙。用它解出库钥匙 → 换密码包裹 → 更新密码哈希。
  if (dbManager.isProtected(name)) {
    let resolved;
    try {
      resolved = dbManager.resolveByUsername(name, { mnemonic: phrase });
    } catch (_) {
      return res.status(403).json({ error: '恢复词不正确' });
    }
    if (!resolved) return res.status(404).json({ error: '账号不存在' });
    try {
      // 先换密码包裹，再改 users 里的密码；顺序反了会出现新旧密码都解不开库
      dbManager.rewrapPassword(name, { newPassword: String(newPassword), useMemoryKey: true });
      // 哈希是异步的：先算完再写库，避免把 Promise 对象写进 password 列
      const newHash = await bcryptHash(String(newPassword), 10);
      resolved.conn.prepare('UPDATE users SET password = ? WHERE username = ?')
        .run(newHash, name);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    return res.json({ message: '密码已重置，可用新密码登录', username: name });
  }

  let resolved;
  try {
    resolved = dbManager.resolveByUsername(name);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  if (!resolved) return res.status(404).json({ error: '账号不存在' });

  const user = resolved.conn.prepare('SELECT username, recovery_hash FROM users WHERE username = ?').get(name);
  if (!user || !user.recovery_hash) return res.status(404).json({ error: '该账号未设置恢复密钥' });

  // 归一化输入：仅保留汉字，兼容用户粘贴带序号（1.水 …）或带空格的格式
  const inputHash = deriveRestoreHash(normalizePhrase(phrase));
  if (!safeEqualHash(inputHash, user.recovery_hash)) {
    return res.status(403).json({ error: '恢复密钥错误' });
  }

  const passwordHash = await bcryptHash(String(newPassword), 10);
  resolved.conn.prepare('UPDATE users SET password = ? WHERE username = ?').run(passwordHash, user.username);
  res.json({ message: '密码已重置，请重新登录', username: user.username });
});

module.exports = router;