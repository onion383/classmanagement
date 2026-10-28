const express = require('express');
const router = express.Router();
// jsonwebtoken 只在改用户名/改密码等「重新签发 Token」时用到，不需要在后端就绪前加载：
// 改为首次调用时才 require，避免把它（连带 semver / side-channel 等）的冷加载成本
// 压在启动关键路径上（行为完全不变）。
let _jwt = null;
const useJwt = () => (_jwt || (_jwt = require('jsonwebtoken')));
const { db } = require('../db');
const dbManager = require('../dbManager/dbManager');
// bcryptjs 只在改用户名/改密码/删除账号等「用户操作」里用到，不需要在后端就绪前加载：
// 改为首次调用时才 require，避免把它的冷加载成本压在启动关键路径上（行为完全不变）。
// 惰性加载逻辑已下沉到 services/bcryptAsync.js，本文件只引用它的异步接口。
const { hash: bcryptHash, compare: bcryptCompare } = require('../services/bcryptAsync');
const { SECRET, auth, TOKEN_SIGN_OPTS, TOKEN_COOKIE_MAX_AGE, signMediaToken } = require('../middleware/auth');
const secureChannel = require('../services/secureChannel');
const { pickPhrase, deriveRestoreHash, formatPhrase } = require('../services/recoveryKey');
const { normalizeUsername, usernameError } = require('../services/usernameRules');
const sessions = require('../services/sessions');
// 备份恢复会用备份包里的整库文件覆盖当前库，表结构可能与恢复前不同：
// 恢复后必须让 AI 的列名缓存失效（否则后续 AI 写入/查询仍按旧列集合校验）。
const aiHelpers = require('./ai/ai.helpers');

// 重置恢复密钥：为当前登录账号生成一组新的 12 词恢复密钥并保存哈希。
// 生成的密钥只在本次响应返回一次（前端提示先保存再确认）。
router.get('/recovery-key', auth(), (req, res) => {
  try {
    const phrase = pickPhrase();
    const hash = deriveRestoreHash(phrase);
    db.prepare('UPDATE users SET recovery_hash = ? WHERE id = ?').run(hash, req.user.userId);
    res.json({ phrase: formatPhrase(phrase), recoveryKey: phrase });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 备份导出：一次导出当前班主任库（业务数据 + 应用设置 + 账号 全带走）。
// v2 便携包：仅在「输入正确登录密码」时放行导出，防止他人偷导。
// 库钥匙用该登录密码派生钥匙包裹进包，换机后仍可用同一登录密码解包恢复。
router.post('/export', auth(), async (req, res) => {
  try {
    const slug = req.user && req.user.dbSlug ? req.user.dbSlug : 'default';
    // 密码走请求体而非 URL query：配合加密通道，避免 GET 明文 URL 泄露密码
    const { password, encrypt = '1', dbPassword } = req.body || {};
    // 校验必须是当前账号的登录密码，未通过直接拒绝，保证只有本人能导出
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(401).json({ error: '账号不存在' });

    const hasPassword = !!user.password;
    // 有密码账号：必须提供并校验正确的登录密码
    if (hasPassword) {
      if (!password) return res.status(400).json({ error: '请输入登录密码以导出数据库' });
      if (!await bcryptCompare(password, user.password)) {
        return res.status(401).json({ error: '密码错误，只有本人能导出数据库' });
      }
    }
    // 无密码账号：无需密码校验。

    // 解析用于包裹库钥匙的「导出密码」：
    //   - 勾选加密且源库本身是加密库：
    //       有密码账号：dbPassword 留空则默认用账号密码；填了则以输入框为准。
    //       无密码账号：必须提供 dbPassword（否则没有口令可供派生包裹钥匙）。
    //   - 不勾选加密、或源库是明文库：库钥匙明文随包带回（明文库无钥匙，无需任何口令）。
    const bundle = dbManager.exportBundle(slug);
    const wantEncrypt = encrypt === '1';

    let wrapPwd = null;
    if (bundle.encrypted && wantEncrypt) {
      if (hasPassword) {
        wrapPwd = dbPassword && dbPassword.length ? dbPassword : password;
      } else {
        if (!dbPassword || !dbPassword.length) {
          return res.status(400).json({ error: '该账号未设置密码，请设置一个导出密码以加密备份' });
        }
        wrapPwd = dbPassword;
      }
    }

    const data = require('fs').readFileSync(bundle.filePath).toString('base64');
    const out = {
      version: 2,
      slug: bundle.slug,
      username: bundle.username,
      data,
      // 备份包是否来自加密库：明文库恢复时无需任何密钥
      encrypted: bundle.encrypted,
      // AI 长期记忆（md 原文）：随包一起带走，换机后可原样恢复
      memory: dbManager.readMemory(slug) || '',
    };
    if (!bundle.encrypted) {
      // 明文库数据本身不加密，「用导出密码加密」对该库无意义，包内不携带库钥匙
      out.key = null;
    } else if (wantEncrypt) {
      // 库钥匙用导出密码派生钥匙包裹，换机后可用该密码解包恢复
      out.wrappedByPassword = dbManager.wrapKeyBySecret(bundle.key, wrapPwd);
    } else {
      // 未加密：库钥匙明文随包带回，换机免密恢复
      out.key = bundle.key;
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 备份恢复：上传一个备份包，覆盖当前登录班主任的库并重建缓存连接。
// 校验库身份：仅允许与当前登录账号一致的备份包。
router.post('/restore', auth(), (req, res) => {
  try {
    // 超级隐私模式：恢复会用主密钥重新包裹库钥匙，等于绕过隐私保护，必须先关闭
    if (dbManager.isProtected(req.user.username)) {
      return res.status(400).json({ error: '请先在系统设置中关闭超级隐私模式，再恢复备份' });
    }
    const { data, wrappedByPassword, wrappedByMnemonic, password, mnemonic, key, encrypted, memory } = req.body || {};
    const curSlug = req.user && req.user.dbSlug ? req.user.dbSlug : 'default';
    // 备份包未标注 encrypted 时按旧格式（加密库）处理，保证兼容
    const isEncrypted = !(encrypted === false || encrypted === 0 || encrypted === '0');
    const dbKey = isEncrypted
      ? dbManager.decryptBundleKey({ key, wrappedByPassword, wrappedByMnemonic, password, mnemonic })
      : null;
    const result = dbManager.restoreBundle({ slug: curSlug, username: req.user.username, data, dbKey, encrypted: isEncrypted });
    // 整库被覆盖：表结构可能变了，AI 列缓存必须失效
    aiHelpers.clearTableColumnsCache();
    // 一并恢复 AI 长期记忆（旧包无该字段则跳过，不影响恢复）
    if (typeof memory === 'string') dbManager.writeMemory(curSlug, memory);
    res.json({ message: '恢复成功', slug: result.slug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 当前登录账号数据库的落盘加密状态（供设置页展示）。
router.get('/db-encryption', auth(), (req, res) => {
  try {
    const slug = req.user && req.user.dbSlug ? req.user.dbSlug : 'default';
    const rec = dbManager.registryFindBySlug(slug);
    res.json({ encrypted: !rec || rec.encrypted !== 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 就地切换当前登录账号数据库的加密方式（加密 <-> 明文）。
// 安全约束：slug 只从 JWT 取，绝不接受客户端传入的 slug，保证只改本人库、绝不波及其它账号。
// 以 NDJSON 流逐步上报进度（校验文件 / 转换数据库 / 校验文件），最后一行为最终结果。
router.post('/db-encryption', auth(), async (req, res) => {
  const slug = req.user && req.user.dbSlug ? req.user.dbSlug : 'default';
  const e = (req.body || {}).encrypt;
  const targetEncrypted = e === true || e === 1 || e === '1';
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  const write = (obj) => { try { res.write(JSON.stringify(obj) + '\n'); } catch (_) { /* 连接已断，忽略 */ } };
  try {
    // 超级隐私模式：明文/加密转换会重写 wrapped_key（主密钥包裹），等于关闭保护
    if (dbManager.isProtected(req.user.username)) {
      write({ type: 'done', ok: false, message: '超级隐私模式下不支持切换落盘加密，请先关闭超级隐私模式' });
      return res.end();
    }
    const result = await dbManager.convertDbEncryption(slug, targetEncrypted, (p) => {
      write({ type: 'progress', phase: p.phase, detail: p.detail, percent: p.percent });
    });
    write({ type: 'done', ok: true, changed: result.changed, encrypted: result.encrypted });
  } catch (err) {
    write({ type: 'done', ok: false, message: err.message || String(err) });
  } finally {
    res.end();
  }
});

// 备份恢复（离线引导，无需登录）：用于「新电脑只装了全新软件、无任何数据」时，
// 上传 v2 备份包 + 输入密码或助记词之一，解出库钥匙还原账号与数据。
// 若本机 registry 中已存在「同一 slug」的账号（即同一用户），覆盖前需二次确认，
// 以免误恢复盖掉本机已有数据。前端确认后带 confirm:true 才会真正落盘。
router.post('/restore-offline', (req, res) => {
  try {
    const { data, slug, wrappedByPassword, wrappedByMnemonic, password, mnemonic, key, encrypted, memory } = req.body || {};
    // 备份包未标注 encrypted 时按旧格式（加密库）处理，保证兼容
    const isEncrypted = !(encrypted === false || encrypted === 0 || encrypted === '0');
    const dbKey = isEncrypted
      ? dbManager.decryptBundleKey({ key, wrappedByPassword, wrappedByMnemonic, password, mnemonic })
      : null;
    // 用备份包自带的账号名登记（index 中该账号才可登录）
    const username = req.body && req.body.username;

    // 已存在同一 slug 的库，且尚未确认覆盖 -> 先拒绝并让前端弹确认
    const existing = dbManager.registryFindBySlug(slug);
    // 超级隐私模式：离线恢复会用主密钥重新包裹库钥匙，必须先在原机登录并关闭保护
    if (existing && existing.protect === 1) {
      return res.status(400).json({ error: '该账号已开启超级隐私模式，请先登录并在系统设置中关闭后再恢复备份' });
    }
    if (existing && !req.body.confirm) {
      return res.status(409).json({
        needConfirm: true,
        message: `本机已存在账号「${existing.username}」，恢复将覆盖其现有数据，是否确认？`,
      });
    }

    const result = dbManager.restoreBundle({ slug, username, data, dbKey, encrypted: isEncrypted });
    // 整库被覆盖：表结构可能变了，AI 列缓存必须失效
    aiHelpers.clearTableColumnsCache();
    // 一并恢复 AI 长期记忆（旧包无该字段则跳过，不影响恢复）
    if (typeof memory === 'string') dbManager.writeMemory(result.slug || slug, memory);
    // 恢复成功后直接签发登录态，前端据此跳转首页，无需再次手动登录
    const sid = sessions.create(1);
    const payload = { userId: 1, username, role: 'teacher', dbSlug: result.slug || slug, sid };
    const token = useJwt().sign(payload, SECRET, TOKEN_SIGN_OPTS);
    // 绑定到本次加密信道会话：之后前端只需发不含 token 的信道凭据
    secureChannel.bindAuth(req.sessionId, token);
    const mediaToken = signMediaToken(payload);
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: TOKEN_COOKIE_MAX_AGE
    });
    res.json({
      message: '恢复成功',
      slug: result.slug,
      username: result.username || username,
      token,
      mediaToken,
      user: { id: 1, username, role: 'teacher', dbSlug: result.slug || slug },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 修改用户名
//
// 账号名存在**两处**：业务库（<班主任>.db）的 users 表、以及 index.db 的 registry 登记表。
// registry.username 才是登录的唯一定位依据（见 dbManager.resolveByUsername），
// 两处必须同步改，否则会出现「改完名字登不进去 / 旧名字仍能登」的错乱。
router.put('/username', auth(), async (req, res) => {
  try {
    const { newUsername, password } = req.body;
    if (!newUsername || !password) {
      return res.status(400).json({ error: '请输入新用户名和当前密码' });
    }
    // 与注册共用同一套账号名规则：原实现只 trim，空白/超长/带路径分隔符的名字都能改成，
    // registry 与 users 表会一起变脏；这里补上长度与字符白名单校验。
    const newName = normalizeUsername(newUsername);
    const nameErr = usernameError(newName);
    if (nameErr) {
      return res.status(400).json({ error: nameErr });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    if (!await bcryptCompare(password, user.password)) {
      return res.status(400).json({ error: '密码错误' });
    }

    // 重名检查要跨全部账号：registry 是跨库的账号登记表，只查本库 users 会漏掉别的库。
    const occupied = dbManager.registryFindByUsername(newName);
    if (occupied && occupied.slug !== req.user.dbSlug) {
      return res.status(400).json({ error: '该用户名已被占用' });
    }
    // 同库内另有同名用户（registry 与业务库不同步的兜底）
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(newName);
    if (existing && existing.id !== req.user.userId) {
      return res.status(400).json({ error: '该用户名已被占用' });
    }

    // 先更新 registry（登录定位的真源），再更新业务库 users。
    // 顺序理由：registry 决定「能不能用这个名字登录」，是权威侧；
    // 万一业务库更新失败，registry 已改而 users 未改的状态下一致性由下次改名修正，
    // 反过来（先改 users）则会出现「库里是新名、登记表是旧名」→ 新名永远登不进去。
    const changed = dbManager.registryRename(req.user.dbSlug, newName);
    if (!changed) {
      return res.status(500).json({ error: '账号登记表更新失败，请重试' });
    }
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newName, req.user.userId);

    // 登录态里带的是旧用户名：重新签发一份含新用户名的 token，并同步换发媒体凭据。
    // （sid 沿用原会话，登出/会话名单机制不受影响）
    const payload = {
      userId: req.user.userId, username: newName, role: req.user.role,
      dbSlug: req.user.dbSlug, sid: req.user.sid,
    };
    const token = useJwt().sign(payload, SECRET, TOKEN_SIGN_OPTS);
    if (req.sessionId) secureChannel.bindAuth(req.sessionId, token);
    res.cookie('token', token, {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: TOKEN_COOKIE_MAX_AGE,
    });
    res.json({ message: '用户名修改成功', username: newName, token, mediaToken: signMediaToken(payload) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 修改密码
router.put('/password', auth(), async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!newPassword) {
      return res.status(400).json({ error: '请输入新密码' });
    }
    // 与注册（auth.js）、切换安全等级（account.js 下方）、本机恢复改密保持一致：
    // 少于 6 位直接拒。原先这条路径漏了这一句，等于从这里可以设一个 1 位密码。
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: '新密码长度至少 6 位' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(401).json({ error: '账号不存在' });

    // 本次是用恢复词登录的隐私库：旧密码已忘记，内存里的库钥匙就是所有者证明，免输旧密码
    const isPrivacy = dbManager.isProtected(req.user.username);
    const byMnemonic = isPrivacy && dbManager.getUnlockSource(req.user.dbSlug) === 'mnemonic';
    // 「本机信息恢复」签发的 token 带 recover 标记：本机文件即凭证，允许免旧密码直接设置新密码
    const byLocalRecover = req.user.recover === true && !isPrivacy;
    // 只有「既不是恢复词解锁、也不是本机恢复」时才需要校验旧密码。
    // 保持原短路语义：这两种情况下完全不比对密码（既省一次 bcrypt 计算，行为也与原来一致）。
    if (!byMnemonic && !byLocalRecover) {
      // 免密账号（user.password 为空）没有旧密码可比对，直接允许设置首个密码；
      // 隐私库即使 password 为空也必须校验，避免绕过库钥匙包裹。
      if (isPrivacy || user.password) {
        const oldOk = oldPassword ? await bcryptCompare(oldPassword, user.password) : false;
        if (!oldOk) {
          return res.status(400).json({ error: '原密码错误' });
        }
      }
    }

    // 先换密码包裹：包裹更新失败就不改 users 里的密码，避免新旧密码都解不开库
    if (isPrivacy) {
      dbManager.rewrapPassword(req.user.username, {
        oldPassword,
        newPassword,
        useMemoryKey: byMnemonic,
      });
    }

    const hashed = await bcryptHash(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.userId);
    // 「本机信息恢复」的 token 只授权这一次改密码：改完立即换发不含 recover 的常规 token。
    // 注意：JWT 是无状态的，只换发新 token 并不能让旧 recover token 失效 ——
    // 它仍带着 recover 标记、仍命中「PUT /api/account/password」白名单，
    // 于是泄露的旧 token 可以在 30 天内反复免旧密码改密。
    // 因此这里吊销旧会话并新建 sid：旧 token 的 sid 不在名单里，立即失效；
    // 新 token 必须使用新 sid（沿用旧 sid 会把自己也一起吊销）。
    if (byLocalRecover) {
      sessions.revoke(req.user.sid);
      const sid = sessions.create(req.user.userId);
      const payload = {
        userId: req.user.userId, username: req.user.username, role: req.user.role,
        dbSlug: req.user.dbSlug, sid,
      };
      const token = useJwt().sign(payload, SECRET, TOKEN_SIGN_OPTS);
      if (req.sessionId) secureChannel.bindAuth(req.sessionId, token);
      res.cookie('token', token, {
        httpOnly: true, sameSite: 'lax', path: '/', maxAge: TOKEN_COOKIE_MAX_AGE,
      });
      return res.json({ message: '密码修改成功', token, mediaToken: signMediaToken(payload) });
    }
    res.json({ message: '密码修改成功' });
  } catch (err) {
    res.status(err.code === 'PRIVACY_UNLOCK' ? 400 : 500).json({ error: err.message });
  }
});

// 删除当前登录账号：关闭并删除该账号的库文件、清除 index 登记，不可恢复。
// 仅删本账号自身的数据；uploads 等为多账号共享资源，不做清理。
router.delete('/', auth(), (req, res) => {
  try {
    const slug = (req.user && req.user.dbSlug) || 'default';
    const rec = dbManager.registryFindBySlug(slug);
    if (!rec) return res.status(404).json({ error: '账号不存在或已被删除' });
    dbManager.deleteTeacher(slug);
    sessions.revoke(req.user && req.user.sid);
    res.clearCookie('token');
    res.json({ message: '账号已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 当前账号的安全等级：plain 明文 / nopass 免密加密 / password 普通密码 / privacy 超级隐私
function currentSecurityLevel(req) {
  const rec = dbManager.registryFindBySlug(req.user.dbSlug);
  if (rec && rec.encrypted === 0) return 'plain';
  if (dbManager.isProtected(req.user.username)) return 'privacy';
  const u = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.userId);
  return u && u.password ? 'password' : 'nopass';
}

router.get('/security-level', auth(), (req, res) => {
  try {
    res.json({ level: currentSecurityLevel(req) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 切换安全等级：明文 / 免密 / 普通密码 / 超级隐私。
// 只动当前登录账号；明文可再升级为任意加密等级。
router.post('/security-level', auth(), async (req, res) => {
  try {
    const target = ['plain', 'nopass', 'password', 'privacy'].includes((req.body || {}).level)
      ? req.body.level
      : '';
    if (!target) return res.status(400).json({ error: '未知的安全等级' });

    const from = currentSecurityLevel(req);
    if (from === target) return res.json({ level: from, changed: false });

    const { password = '', newPassword = '' } = req.body || {};
    const username = req.user.username;
    const user = db.prepare('SELECT id, password FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(401).json({ error: '账号不存在' });

    // 当前有登录密码（含隐私模式）时，任何变更都要先验证当前密码
    const needsCurrent = from === 'password' || from === 'privacy';
    if (needsCurrent) {
      if (!password) return res.status(400).json({ error: '请输入当前登录密码' });
      if (!await bcryptCompare(password, user.password)) return res.status(400).json({ error: '密码错误' });
    }

    // 目标需要登录密码但当前没有：先写入新密码（必须在库连接还可用时改）
    let effectivePwd = password;
    if (!needsCurrent && (target === 'password' || target === 'privacy')) {
      if (String(newPassword).length < 6) return res.status(400).json({ error: '新密码长度至少 6 位' });
      effectivePwd = String(newPassword);
      // 先算出哈希再写库：哈希是异步的，必须 await 拿到结果才能入库
      const newHash = await bcryptHash(effectivePwd, 10);
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, user.id);
    } else if (target === 'plain' || target === 'nopass') {
      // 明文库与免密登录都不能保留密码
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run('', user.id);
    }

    // 退出隐私：先把库钥匙改回主密钥包裹，再处理免密/明文
    if (from === 'privacy' && target !== 'privacy') {
      dbManager.disablePrivacy(username, { password });
    }

    // 加密 -> 明文：转换会驱逐本次请求的连接，必须放在所有库读写之后
    if (target === 'plain') {
      await dbManager.convertDbEncryption(req.user.dbSlug, false);
    }
    // 明文 -> 加密：先转成加密库，下面开启隐私才有库钥匙可包裹
    if (from === 'plain') {
      await dbManager.convertDbEncryption(req.user.dbSlug, true);
    }

    // 开启隐私：库钥匙只由登录密码 + 恢复词包裹
    let phrase = '';
    if (target === 'privacy') {
      phrase = pickPhrase();
      dbManager.enablePrivacy(username, { password: effectivePwd, mnemonic: phrase });
    }

    res.json({
      level: target,
      changed: true,
      phrase: phrase ? formatPhrase(phrase) : '',
      recoveryKey: phrase,
    });
  } catch (err) {
    res.status(err.code === 'PRIVACY_UNLOCK' ? 400 : 500).json({ error: err.message });
  }
});

// 超级隐私模式状态（供系统设置展示）
router.get('/privacy', auth(), (req, res) => {
  try {
    res.json({ enabled: dbManager.isProtected(req.user.username) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 开启超级隐私模式：用当前登录密码确认身份，并生成一份 12 词恢复词（仅此次返回）。
// 开启后库钥匙只由「登录密码 / 恢复词」包裹，主密钥再也解不开；忘记两者即不可恢复。
router.post('/privacy/enable', auth(), async (req, res) => {
  try {
    const { password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);
    if (!user) return res.status(401).json({ error: '账号不存在' });
    if (!user.password) return res.status(400).json({ error: '当前账号未设置登录密码，请先设置密码' });
    if (!password || !await bcryptCompare(password, user.password)) {
      return res.status(400).json({ error: '密码错误' });
    }

    const phrase = pickPhrase();
    dbManager.enablePrivacy(req.user.username, { password, mnemonic: phrase });
    res.json({
      enabled: true,
      recoveryKey: phrase,
      phrase: formatPhrase(phrase),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 关闭超级隐私模式：需要再次输入登录密码解出库钥匙，改回主密钥自动解锁。
router.post('/privacy/disable', auth(), (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: '请输入登录密码' });
    dbManager.disablePrivacy(req.user.username, { password });
    res.json({ enabled: false });
  } catch (err) {
    res.status(err.code === 'PRIVACY_UNLOCK' ? 400 : 500).json({ error: err.message });
  }
});

module.exports = router;