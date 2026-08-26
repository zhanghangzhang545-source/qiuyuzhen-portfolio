// ============================================================
// admin/login.js — 管理员登录（Phase 3-C1：真实 Supabase Auth + 授权）
// ------------------------------------------------------------
// 正式模式：邮箱 + 密码 经 Supabase Auth 登录，随后校验 is_admin() 白名单授权。
//          非白名单账号即使登录成功也被拒绝进入后台（杜绝「登录即管理员」）。
// Mock 模式（?mock=1 或未配置 Supabase）：沿用 admin / demo1234 演示账号。
// ============================================================
import { h } from '../../../core/dom.js';
import { auth, DATA_MODE } from '../../../data/services.js';
import { toast } from '../../components/primitives.js';

export async function adminLoginView() {
  // Mock 模式：沿用既有本地会话判断
  if (DATA_MODE.value !== 'supabase') {
    if (auth.isAuthed()) { location.hash = '#/admin'; return h('div', {}); }
  } else {
    // Supabase 模式：确保会话态已加载（自动刷新 token / 已登录直达）
    await auth.ensureSession();
    if (auth.isAuthed()) { location.hash = '#/admin'; return h('div', {}); }
  }

  const isSupabase = DATA_MODE.value === 'supabase';
  const email = h('input', { type: 'email', value: '', placeholder: '管理员邮箱' });
  const password = h('input', { type: 'password', value: '', placeholder: '密码' });
  const err = h('div', { class: 'field__error', hidden: true });

  const form = h('form', {
    class: 'form',
    on: {
      submit: (e) => {
        e.preventDefault();
        err.hidden = true;
        auth.login(email.value.trim(), password.value).then(
          () => { location.hash = '#/admin'; },
          (m) => { err.textContent = m.message; err.hidden = false; },
        );
      },
    },
  }, [
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '邮箱'), email]),
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '密码'), password]),
    err,
    h('button', { type: 'submit', class: 'btn btn--primary btn--block' }, '登录'),
  ]);

  return h('div', { class: 'login-wrap' }, h('div', { class: 'login-card' }, [
    h('h1', {}, '管理后台'),
    h('div', { class: 'sub' }, isSupabase
      ? '云端管理员登录 · 需管理员白名单授权'
      : '本机预览登录 · Demo 账号 admin / demo1234（?mock=1 或未连接云端）'),
    form,
  ]));
}
