// ============================================================
// password_recovery_gate.mjs — 找回密码三步链路回归门（本地 fake，零真实网络）
// 覆盖：
//   ① requestPasswordReset：redirectTo 必须指向本站（防 localhost 回跳缺陷复发）
//   ② applyRecoverySession：implicit(hash 令牌) / PKCE(code) / 无令牌 / 已过期 四态
//   ③ updatePassword：updateUser 后必须 signOut（不留悬挂恢复会话）
//   ④ Mock / 基类显式抛「不支持」（不静默）
//   ⑤ 装配断言：main.js 有回跳捕获 + /admin/reset 路由；login.js 有找回入口；
//      services.js 代理转发三个新方法
// 运行：node tests/password_recovery_gate.mjs
// ============================================================

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log(`  PASS ${msg}`); } else { fail++; console.log(`  FAIL ${msg}`); } }

// —— polyfills（Node 环境无浏览器 API）——
globalThis.location = { origin: 'https://zhanghangzhang545-source.github.io', pathname: '/qiuyuzhen-portfolio/', search: '', hash: '' };
const _ss = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (_ss.has(k) ? _ss.get(k) : null),
  setItem: (k, v) => _ss.set(k, String(v)),
  removeItem: (k) => _ss.delete(k),
};

// —— fake supabase auth（记录调用，可控失败）——
const calls = [];
let failSetSession = false;
let failUpdateUser = false;
globalThis.supabase = {
  createClient: () => ({
    auth: {
      resetPasswordForEmail: async (email, opts) => { calls.push(['resetPasswordForEmail', email, opts]); return { error: null }; },
      setSession: async (t) => { calls.push(['setSession', t]); return failSetSession ? { error: { message: 'token expired' } } : { error: null }; },
      exchangeCodeForSession: async (code) => { calls.push(['exchangeCodeForSession', code]); return { error: null }; },
      updateUser: async ({ password }) => { calls.push(['updateUser', password]); return failUpdateUser ? { error: { message: 'weak password' } } : { error: null }; },
      signOut: async () => { calls.push(['signOut']); return { error: null }; },
      getSession: async () => ({ data: { session: { user: { email: '1353557432@qq.com' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: async () => ({ data: true, error: null }),
  }),
};

const { SupabaseAuth, RECOVERY_KEY } = await import('../src/data/auth.supabase.js');
const { AuthProvider, MockAuth } = await import('../src/data/auth.js');

// —— ① 发送重置邮件：redirectTo 指向本站 ——
{
  const a = new SupabaseAuth();
  await a.requestPasswordReset(' 1353557432@qq.com ');
  const c = calls.find((x) => x[0] === 'resetPasswordForEmail');
  ok(!!c, '① requestPasswordReset 调用了 resetPasswordForEmail');
  ok(c && c[1] === '1353557432@qq.com', '① 邮箱已 trim');
  ok(c && c[2] && c[2].redirectTo === 'https://zhanghangzhang545-source.github.io/qiuyuzhen-portfolio/',
    `① redirectTo 指向本站（防 localhost 回跳）实际=${c && c[2] && c[2].redirectTo}`);
}

// —— ②a implicit：hash 令牌换会话 ——
{
  const a = new SupabaseAuth();
  calls.length = 0;
  sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ access_token: 'AT', refresh_token: 'RT' }));
  const res = await a.applyRecoverySession();
  ok(res.email === '1353557432@qq.com', '②a implicit 换会话成功并返回邮箱');
  ok(calls.some((x) => x[0] === 'setSession' && x[1].access_token === 'AT' && x[1].refresh_token === 'RT'), '②a 调用了 setSession(AT,RT)');
  ok(sessionStorage.getItem(RECOVERY_KEY) === null, '②a 令牌一次性消费（stash 已清）');
}

// —— ②b PKCE：code 换会话 ——
{
  const a = new SupabaseAuth();
  calls.length = 0;
  sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ code: 'CODE123' }));
  await a.applyRecoverySession();
  ok(calls.some((x) => x[0] === 'exchangeCodeForSession' && x[1] === 'CODE123'), '②b PKCE 走了 exchangeCodeForSession');
}

// —— ②c 无令牌 → 显式报错 ——
{
  const a = new SupabaseAuth();
  let msg = '';
  try { await a.applyRecoverySession(); } catch (e) { msg = e.message; }
  ok(msg.includes('重新发送重置邮件'), `②c 无令牌显式报错（"${msg}"）`);
}

// —— ②d 令牌过期 → 显式报错且 stash 已清（不会卡死态）——
{
  const a = new SupabaseAuth();
  failSetSession = true;
  sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ access_token: 'OLD', refresh_token: '' }));
  let msg = '';
  try { await a.applyRecoverySession(); } catch (e) { msg = e.message; }
  failSetSession = false;
  ok(msg.includes('已过期'), `②d 过期链接显式报错（"${msg}"）`);
  ok(sessionStorage.getItem(RECOVERY_KEY) === null, '②d 失败也清 stash（令牌一次性）');
}

// —— ③ 设置新密码：updateUser 后必须 signOut ——
{
  const a = new SupabaseAuth();
  calls.length = 0;
  a._authorized = true; a._user = { email: 'x' }; // 模拟在恢复会话里
  await a.updatePassword('newPassw0rd!');
  const iu = calls.findIndex((x) => x[0] === 'updateUser');
  const io = calls.findIndex((x) => x[0] === 'signOut');
  ok(iu >= 0 && calls[iu][1] === 'newPassw0rd!', '③ 调用了 updateUser 设置新密码');
  ok(io > iu, '③ updateUser 之后 signOut（不留悬挂恢复会话）');
  ok(a.isAuthed() === false && a.user() === null, '③ 授权态已清空（必须用新密码重新登录）');
}

// —— ③b updateUser 失败 → 显式抛错 ——
{
  const a = new SupabaseAuth();
  failUpdateUser = true;
  let msg = '';
  try { await a.updatePassword('x'); } catch (e) { msg = e.message; }
  failUpdateUser = false;
  ok(msg === 'weak password', `③b updateUser 失败显式抛错（"${msg}"）`);
}

// —— ④ Mock / 基类显式抛「不支持」——
{
  const m = new MockAuth();
  let msg = '';
  try { await m.requestPasswordReset('a@b.c'); } catch (e) { msg = e.message; }
  ok(msg.includes('不支持找回密码'), `④ Mock 显式抛不支持（"${msg}"）`);
  const base = new AuthProvider();
  let msg2 = '';
  try { await base.applyRecoverySession(); } catch (e) { msg2 = e.message; }
  ok(msg2.includes('不支持找回密码'), `④ 基类显式抛不支持（"${msg2}"）`);
}

// —— ⑤ 装配断言（防漏接）——
{
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const login = readFileSync(new URL('../src/ui/pages/admin/login.js', import.meta.url), 'utf8');
  const services = readFileSync(new URL('../src/data/services.js', import.meta.url), 'utf8');
  const reset = readFileSync(new URL('../src/ui/pages/admin/reset.js', import.meta.url), 'utf8');

  ok(main.includes("'/admin/reset'"), '⑤ main.js 注册了 /admin/reset 路由');
  ok(main.includes('type=recovery') && main.includes('RECOVERY_KEY'), '⑤ main.js 有回跳捕获（implicit）');
  ok(main.includes('code=') && main.includes('exchangeCodeForSession') === false, '⑤ main.js 有 PKCE ?code 兜底捕获');
  ok(main.includes('replaceState'), '⑤ main.js 用 replaceState 静默切换（防双渲染二次消费令牌）');
  ok(login.includes('忘记密码') && login.includes('requestPasswordReset'), '⑤ login.js 有「忘记密码」入口');
  ok(login.includes('isSupabase'), '⑤ login.js 找回入口仅正式模式显示');
  ok(services.includes('requestPasswordReset') && services.includes('applyRecoverySession') && services.includes('updatePassword'),
    '⑤ services.js 代理转发三个新方法');
  ok(reset.includes('applyRecoverySession') && reset.includes('updatePassword'), '⑤ reset.js 串起 ②③ 两步');
  ok(reset.includes('#/admin/login'), '⑤ reset.js 完成后回登录页');
}

console.log('============================================================');
console.log(`总计: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
