// =========================================================================
// auth-smoke.js —— 认证链路冒烟（合并自 auth-e2e-probe.js / auth-privacy-probe.js）
//
// 两段用例依次跑在**自己起的**临时后端上：
//   1) 普通账号：注册 / 登录 / 改密码 / 改用户名（bcrypt 异步化后的整条链路）
//   2) 隐私模式：恢复词注册 → 确认 → 密码登录 → 改名后口令包裹与恢复词仍可用
//
// 为什么必须自己起后端（而不是连现成的）：
//   安全模式（注入 SECURE_MASTER）下，middleware/auth.js 的 resolveAuth 在
//   `secureChannel.hasMaster()` 为真时**直接返回 token: null**，根本不读
//   Authorization: Bearer —— 只有 X-Auth-Proof 信道凭据才认。本脚本是纯 HTTP 客户端，
//   不带信道凭据，所以对着安全模式后端跑必然从「改密码」这一步开始全红（401 未登录），
//   后面十几个用例全是它的连锁假失败。
//   而 Electron 主进程 fork 的后端**一定**注入 SECURE_MASTER，所以旧写法在真实环境
//   等于这条链路零覆盖。这里改为自起一个 PORT / DATA_DIR 隔离、**不注入 SECURE_MASTER**
//   的后端，结果才只反映认证逻辑本身。启动/清理的实现在 _isolated-backend.cjs，
//   后续需要真后端的冒烟脚本直接复用那个 helper，不要各自再写一套。
//
// 用法：
//   node testjs/smoke/auth-smoke.js                      自起后端（推荐）
//   AUTH_SMOKE_EXTERNAL=1 PORT=3999 node testjs/smoke/auth-smoke.js
//                                                        连一个手工起的「明文模式」后端
//   注意：AUTH_SMOKE_EXTERNAL 是独立开关，不能只看 PORT ——
//   run-smoke.cjs 会给所有子脚本传 PORT，若据此判断就会又连回安全模式后端。
//
// 退出码：0 = 全部通过；1 = 有用例失败
// =========================================================================
// 隔离后端启动器（详见 _isolated-backend.cjs 头部：为什么不能连现成后端）。
// 注意必须带 .cjs：Node 的 require 只自动补 .js/.json/.node，不会补 .cjs。
const { startIsolatedBackend } = require('./_isolated-backend.cjs')

const EXTERNAL = process.env.AUTH_SMOKE_EXTERNAL === '1'
let BASE = 'http://127.0.0.1:' + (Number(process.env.PORT) || 3000)
let backend = null

async function post(p, body) {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (_) {}
  return { status: r.status, json: j };
}

async function put(p, body, token) {
  const r = await fetch(BASE + p, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (_) {}
  return { status: r.status, json: j };
}

// -------------------------------------------------------------------------
// 1. 普通账号端到端：bcrypt 异步化后「注册 / 登录 / 改密码 / 改用户名」
// -------------------------------------------------------------------------
async function runE2E() {
  const uname = 'tester' + Date.now().toString().slice(-6);
  const pwd = 'pass123456';
  let pass = 0, fail = 0;

  const chk = (ok, label, extra) => {
    if (ok) { pass++; console.log('  ✓', label, extra || ''); }
    else { fail++; console.log('  ✗', label, extra || ''); }
  };

  console.log('=== 1. 注册（异步 hash 路径）===');
  let r = await post('/api/register', { username: uname, password: pwd, role: 'teacher', level: 'password' });
  chk(r.status === 200, '注册成功', 'status=' + r.status + ' ' + (r.json && (r.json.message || r.json.error)));

  console.log('=== 2. 登录（正确密码，异步 compare）===');
  r = await post('/api/login', { username: uname, password: pwd });
  chk(r.status === 200 && r.json && r.json.token, '登录成功并签发 token', 'status=' + r.status);
  const token = r.json && r.json.token;
  if (!token) { console.error('登录失败，终止普通账号用例'); return { pass, fail: fail + 1 }; }

  console.log('=== 3. 登录（错误密码应被拒）===');
  r = await post('/api/login', { username: uname, password: 'wrongpass' });
  chk(r.status === 401, '错误密码被拒', 'status=' + r.status);

  console.log('=== 4. 改密码 ===');
  const r4 = await put('/api/account/password', { oldPassword: pwd, newPassword: 'newpass456' }, token);
  chk(r4.status === 200, '改密成功', 'status=' + r4.status + ' ' + (r4.json && (r4.json.message || r4.json.error)));

  console.log('=== 5. 旧密码应失效 ===');
  r = await post('/api/login', { username: uname, password: pwd });
  chk(r.status === 401, '旧密码已失效', 'status=' + r.status);

  console.log('=== 6. 新密码应可登录 ===');
  r = await post('/api/login', { username: uname, password: 'newpass456' });
  chk(r.status === 200 && r.json && r.json.token, '新密码登录成功', 'status=' + r.status);

  console.log('=== 7. 改用户名（正确密码）===');
  const newName = uname + 'x';
  const r7 = await put('/api/account/username', { newUsername: newName, password: 'newpass456' }, token);
  chk(r7.status === 200, '改用户名成功', 'status=' + r7.status + ' ' + (r7.json && (r7.json.message || r7.json.error)));
  chk(r7.json && r7.json.token, '改名后重新签发 token', r7.json && r7.json.token ? '✓' : '✗');

  console.log('=== 8. 改用户名（错误密码应被拒）===');
  const r8 = await put('/api/account/username', { newUsername: uname + 'y', password: 'badpass' }, token);
  chk(r8.status === 400, '错误密码被拒', 'status=' + r8.status);

  console.log('=== 9. 注册密码过短（应被拒）===');
  r = await post('/api/register', { username: 'x' + Date.now().toString().slice(-6), password: '123', role: 'teacher', level: 'password' });
  chk(r.status === 400, '短密码被拒', 'status=' + r.status + ' ' + (r.json && r.json.error));

  console.log('=== 10. 改名后用旧名注册（应成功：旧名已从 registry 移除，不再被占用）===');
  // 说明：改用户名会把 registry.username 一起改掉，旧名因此变成「未被占用的名字」，
  // 重新注册它理应成功（这正是 registry 同步后的正确表现）。
  r = await post('/api/register', { username: uname, password: pwd, role: 'teacher', level: 'password' });
  chk(r.status === 200, '旧名可被重新注册（registry 已同步）', 'status=' + r.status + ' ' + (r.json && (r.json.message || r.json.error)));

  console.log('=== 11. 改用户名后用新名登录（registry 已同步，应成功）===');
  r = await post('/api/login', { username: newName, password: 'newpass456' });
  chk(r.status === 200 && r.json && r.json.token, '新用户名可登录', 'status=' + r.status + ' ' + (r.json && (r.json.error || 'ok')));

  console.log('=== 12. 改用户名后用旧名登录（registry 已同步，应失败）===');
  r = await post('/api/login', { username: uname, password: 'newpass456' });
  chk(r.status === 401, '旧用户名已失效', 'status=' + r.status);

  console.log('=== 13. 改名后注册同名账号（应被拒，验证跨库重名检查）===');
  r = await post('/api/register', { username: newName, password: pwd, role: 'teacher', level: 'password' });
  chk(r.status === 409, '改名后同名注册被拒', 'status=' + r.status + ' ' + (r.json && r.json.error));

  console.log('=== 14. 密码哈希确实已落库（非 Promise 对象）===');
  // 异步改造最危险的翻车点：hash 未 await 就写库 → password 列存进 Promise 对象。
  // 表现是「注册成功但永远登不上」。这里用「改密后仍能登录」间接验证落库内容正确。
  r = await post('/api/login', { username: newName, password: 'newpass456' });
  chk(r.status === 200, '落库哈希可正常校验', 'status=' + r.status);

  return { pass, fail };
}

// -------------------------------------------------------------------------
// 2. 超级隐私模式：改用户名同步 registry 后，口令包裹与恢复词仍然可用
// -------------------------------------------------------------------------
async function runPrivacy() {
  const uname = 'priv' + Date.now().toString().slice(-6);
  const pwd = 'pass123456';
  let pass = 0, fail = 0;

  const chk = (ok, label, extra) => {
    if (ok) { pass++; console.log('  ✓', label, extra || ''); }
    else { fail++; console.log('  ✗', label, extra || ''); }
  };

  console.log('=== 1. 隐私模式注册（先生成恢复词草稿）===');
  const r1 = await post('/api/register', { username: uname, password: pwd, role: 'teacher', level: 'privacy' });
  const j1 = r1.json || {};
  console.log('  状态:', r1.status, '|', j1.message || j1.error);
  const draftId = j1.draftId;
  // 注意：注册接口返回的是 recovery.phrase（展示格式「1.水 2.山 …」），
  // 不是 recoveryKey。服务端用 normalizePhrase 归一化后比对，展示格式可直接提交。
  const recoveryPhrase = j1.recovery && j1.recovery.phrase;

  if (draftId && recoveryPhrase) {
    console.log('=== 2. 确认注册（提交同一密码 + 恢复词）===');
    const r2 = await post('/api/register/confirm', { draftId, password: pwd, phrase: recoveryPhrase });
    const j2 = r2.json || {};
    chk(r2.status === 200, '确认注册成功', 'status=' + r2.status + ' ' + (j2.message || j2.error));
  } else {
    console.log('  （未拿到草稿或恢复词，跳过确认）');
  }

  console.log('=== 3. 隐私账号用密码登录 ===');
  const r3 = await post('/api/login', { username: uname, password: pwd });
  const j3 = r3.json || {};
  chk(r3.status === 200 && j3.token, '密码登录成功', 'status=' + r3.status + ' ' + (j3.error || 'ok'));
  const token = j3.token;
  if (!token) {
    console.log('  登录失败，后续用例跳过');
    return { pass, fail: fail + 1 };
  }

  console.log('=== 4. 隐私账号改用户名 ===');
  const newName = uname + 'p';
  const r4 = await put('/api/account/username', { newUsername: newName, password: pwd }, token);
  const j4 = r4.json || {};
  chk(r4.status === 200, '改用户名成功', 'status=' + r4.status + ' ' + (j4.message || j4.error));

  console.log('=== 5. 改名后用新名 + 原密码登录（验证口令包裹未被破坏）===');
  const r5 = await post('/api/login', { username: newName, password: pwd });
  const j5 = r5.json || {};
  chk(r5.status === 200 && j5.token, '改名后仍可用密码解锁', 'status=' + r5.status + ' ' + (j5.error || 'ok'));

  console.log('=== 6. 改名后用恢复词解锁（验证 mnemonic 包裹未被破坏）===');
  if (recoveryPhrase) {
    const r6 = await post('/api/login', { username: newName, mnemonic: recoveryPhrase });
    const j6 = r6.json || {};
    chk(r6.status === 200 && j6.token, '恢复词仍可解锁', 'status=' + r6.status + ' ' + (j6.error || 'ok'));
  } else {
    console.log('  （无恢复词，跳过）');
  }

  console.log('=== 7. 改名后旧名不可登录 ===');
  const r7 = await post('/api/login', { username: uname, password: pwd });
  chk(r7.status === 401, '旧名已失效', 'status=' + r7.status);

  return { pass, fail };
}

;(async () => {
  if (EXTERNAL) {
    console.log('（连外部后端：' + BASE + '，须为明文模式）\n')
  } else {
    backend = await startIsolatedBackend({ prefix: 'auth-smoke' })
    BASE = backend.base
    console.log('（自起隔离后端：' + BASE + '，明文模式，数据目录 ' + backend.dataDir + '）\n')
  }

  let pass = 0, fail = 0;

  console.log('########## 普通账号认证链路 ##########');
  const e2e = await runE2E();
  pass += e2e.pass; fail += e2e.fail;

  console.log('\n########## 超级隐私模式 ##########');
  const privacy = await runPrivacy();
  pass += privacy.pass; fail += privacy.fail;

  console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
  // 必须先等后端退出再删数据目录，否则临时目录删不掉（Windows 句柄延迟）
  if (backend) await backend.stop();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('执行异常:', e.message || e);
  if (backend) await backend.stop().catch(() => {});
  process.exit(1);
});
