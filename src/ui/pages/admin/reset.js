// ============================================================
// admin/reset.js — 找回密码（②③）：应用恢复会话 + 设置新密码
// ------------------------------------------------------------
// 入口链路：登录页「忘记密码」→ Supabase 发重置邮件 → 点邮件链接
//   → Supabase verify → 302 回跳本站（URL 附恢复令牌）
//   → main.js 捕获令牌转存 sessionStorage → 路由到本页。
// 仅正式 Supabase 模式支持；Mock 模式显示不可用说明。
// ============================================================
import { h } from '../../../core/dom.js';
import { auth, DATA_MODE } from '../../../data/services.js';

function infoCard(title, msg) {
  return h('div', { class: 'login-wrap' }, h('div', { class: 'login-card' }, [
    h('h1', {}, title),
    h('div', { class: 'sub' }, msg),
    h('a', { class: 'btn btn--primary btn--block', href: '#/admin/login' }, '返回登录页'),
  ]));
}

export async function adminResetView() {
  if (DATA_MODE.value !== 'supabase') {
    return infoCard('找回密码', '本机预览（Mock 模式）不涉及真实账号密码，正式环境才支持找回密码。');
  }

  // 应用邮件链接带回的恢复会话；链接过期/已用 → 显式错误态
  let email = '';
  try {
    const res = await auth.applyRecoverySession();
    email = res.email;
  } catch (e) {
    return infoCard('链接已失效', (e && e.message) || '链接已过期或已被使用，请重新发送重置邮件。');
  }

  const pwd = h('input', { type: 'password', value: '', placeholder: '新密码（至少 8 位）' });
  const pwd2 = h('input', { type: 'password', value: '', placeholder: '再输入一次新密码' });
  const err = h('div', { class: 'field__error', hidden: true });
  const btn = h('button', { type: 'submit', class: 'btn btn--primary btn--block' }, '设置新密码');

  const form = h('form', {
    class: 'form',
    on: {
      submit: (e) => {
        e.preventDefault();
        err.hidden = true;
        const p1 = pwd.value;
        const p2 = pwd2.value;
        if (p1.length < 8) { err.textContent = '密码至少 8 位。'; err.hidden = false; return; }
        if (p1 !== p2) { err.textContent = '两次输入的密码不一致。'; err.hidden = false; return; }
        btn.disabled = true;
        btn.textContent = '正在设置…';
        auth.updatePassword(p1).then(
          () => {
            form.replaceChildren(h('div', { class: 'sub' },
              '密码已更新，请使用新密码重新登录。正在跳转到登录页…'));
            setTimeout(() => { location.hash = '#/admin/login'; }, 1500);
          },
          (m) => {
            btn.disabled = false;
            btn.textContent = '设置新密码';
            err.textContent = (m && m.message) || '设置失败，请重试';
            err.hidden = false;
          },
        );
      },
    },
  }, [
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '新密码'), pwd]),
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '确认新密码'), pwd2]),
    err,
    btn,
  ]);

  return h('div', { class: 'login-wrap' }, h('div', { class: 'login-card' }, [
    h('h1', {}, '设置新密码'),
    h('div', { class: 'sub' }, email ? `正在为 ${email} 重设密码` : '正在为管理员账号重设密码'),
    form,
  ]));
}
