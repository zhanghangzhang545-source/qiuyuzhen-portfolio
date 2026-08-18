// ============================================================
// admin/login.js — 管理员登录（单管理员 Mock）
// ============================================================
import { h } from '../../../core/dom.js';
import { auth } from '../../../data/services.js';
import { toast } from '../../components/primitives.js';

export async function adminLoginView() {
  if (auth.isAuthed()) { location.hash = '#/admin'; return h('div', {}); }

  const username = h('input', { type: 'text', value: 'admin', placeholder: '用户名' });
  const password = h('input', { type: 'password', value: '', placeholder: '密码' });
  const err = h('div', { class: 'field__error', hidden: true });

  const form = h('form', {
    class: 'form',
    on: {
      submit: (e) => {
        e.preventDefault();
        err.hidden = true;
        auth.login(username.value.trim(), password.value).then(
          () => { location.hash = '#/admin'; },
          (m) => { err.textContent = m.message; err.hidden = false; },
        );
      },
    },
  }, [
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '用户名'), username]),
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '密码'), password]),
    err,
    h('button', { type: 'submit', class: 'btn btn--primary btn--block' }, '登录'),
  ]);

  return h('div', { class: 'login-wrap' }, h('div', { class: 'login-card' }, [
    h('h1', {}, '管理后台'),
    h('div', { class: 'sub' }, '单管理员登录 · Demo 账号 admin / demo1234'),
    form,
  ]));
}
