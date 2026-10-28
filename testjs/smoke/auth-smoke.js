// =========================================================================
// auth-smoke.js —— 认证链路冒烟（合并自 auth-e2e-probe.js / auth-privacy-probe.js）
//
// 两段用例依次跑在同一个后端上（默认 3000，与 run-smoke.cjs 的探测端口一致；PORT 可覆盖）：
//   1) 普通账号：注册 / 登录 / 改密码 / 改用户名（bcrypt 异步化后的整条链路）
//   2) 隐私模式：恢复词注册 → 确认 → 密码登录 → 改名后口令包裹与恢复词仍可用
//
// 用法：
//   node testjs/smoke/auth-smoke.js
//   PORT=3999 node testjs/smoke/auth-smoke.js      # 指向其它端口
//
// 退出码：0 = 全部通过；1 = 有用例失败
// =========================================================================
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 3000);

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
  let pass = 0, fail = 0;

  console.log('########## 普通账号认证链路 ##########');
  const e2e = await runE2E();
  pass += e2e.pass; fail += e2e.fail;

  console.log('\n########## 超级隐私模式 ##########');
  const privacy = await runPrivacy();
  pass += privacy.pass; fail += privacy.fail;

  console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('执行异常:', e);
  process.exit(1);
});
