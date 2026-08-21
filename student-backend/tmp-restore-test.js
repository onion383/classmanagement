const BASE = 'http://localhost:3000';
async function j(method, url, body, token) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + url, opts);
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}
(async () => {
  const uname = 'ttest_' + Date.now();
  const pwd = 'pass123';
  // 1) 注册
  let r = await j('POST', '/api/register', { username: uname, password: pwd, role: 'teacher' });
  console.log('注册:', r.status, r.data.user ? 'OK slug=' + r.data.user.dbSlug : JSON.stringify(r.data));
  const mnemonic = r.data.recovery.phrase; // 带序号格式（用户实际拿到并抄写/保存的形态）
  // 2) 登录
  r = await j('POST', '/api/login', { username: uname, password: pwd });
  console.log('登录:', r.status, r.data.token ? 'OK' : JSON.stringify(r.data));
  const token = r.data.token;
  // 3) 导出(密码+助记词)
  r = await j('GET', '/api/account/export?password=' + encodeURIComponent(pwd) + '&mnemonic=' + encodeURIComponent(mnemonic), null, token);
  console.log('导出(v2):', r.status, r.data.version, 'hasPwWrap=' + !!r.data.wrappedByPassword, 'hasMnWrap=' + !!r.data.wrappedByMnemonic);
  const bundle = r.data;
  // 4) 用密码离线恢复
  r = await j('POST', '/api/account/restore-offline', { ...bundle, password: pwd }, null);
  console.log('离线恢复(密码):', r.status, r.data.message || JSON.stringify(r.data));
  // 5) 用助记词离线恢复（同样带序号格式）
  r = await j('POST', '/api/account/restore-offline', { ...bundle, mnemonic }, null);
  console.log('离线恢复(助记词带序号格式):', r.status, r.data.message || JSON.stringify(r.data));
  // 6) 错误钥匙
  r = await j('POST', '/api/account/restore-offline', { ...bundle, mnemonic: '错误的助记词' }, null);
  console.log('离线恢复(错误钥匙,应拒绝):', r.status, r.data.error || JSON.stringify(r.data));
  // 7) 恢复后能登录(原密码)
  r = await j('POST', '/api/login', { username: uname, password: pwd });
  console.log('恢复后原密码登录:', r.status, r.data.token ? 'OK' : JSON.stringify(r.data));
})().catch(e => { console.error('ERR', e); process.exit(1); });