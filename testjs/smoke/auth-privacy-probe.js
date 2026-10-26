// =========================================================================
// testjs/auth-privacy-probe.js —— 超级隐私模式回归（改用户名同步 registry 后）
//
// 用途：验证「改用户名同步 registry」这项修复没有破坏隐私模式链路。
// 隐私模式的账号名同样登记在 index.db 的 registry 表里，且 registry 还带着
// 两份口令包裹（wrapped_by_password / wrapped_by_mnemonic）——
// 改名字时**绝不能碰到这些列**，否则该账号将永远解不开库。
//
// 用法：
//   PORT=3994 node testjs/auth-privacy-probe.js
//   （需先起一个后端在对应 PORT 上）
//
// 退出码：0 = 全部通过；1 = 有用例失败
// =========================================================================

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 3994);

async function post(p, body) {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
  });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch (_) {}
  return { status: r.status, json: j };
}

(async () => {
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
    console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
    process.exit(1);
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

  console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('执行异常:', e);
  process.exit(1);
});
