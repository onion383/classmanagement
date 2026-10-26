// =========================================================================
// testjs/auth-e2e-probe.js —— 认证链路端到端回归（bcrypt 异步化后）
//
// 用途：验证「注册 / 登录 / 改密码 / 改用户名」四条链路的密码哈希逻辑
// 在从同步版（hashSync/compareSync）改为异步版（services/bcryptAsync.js）后
// 行为完全一致——尤其是「密码写库前哈希必须已算完」这一点。
//
// 用法：
//   DATA_DIR=/tmp/e2e PORT=3999 node testjs/auth-e2e-probe.js
//   （需先起一个后端在对应 PORT 上）
//
// 退出码：0 = 全部通过；1 = 有用例失败
// =========================================================================

const BASE = 'http://127.0.0.1:' + (process.env.PORT || 3999);

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
  if (!token) { console.error('登录失败，终止后续用例'); process.exit(1); }

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
  // 改名前旧名仍在 registry 里，那时注册会被 409 拒绝——由用例 13 覆盖改名后的新名场景。
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

  console.log('\n=== 结果：通过 ' + pass + ' / 失败 ' + fail + ' ===');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('执行异常:', e);
  process.exit(1);
});
