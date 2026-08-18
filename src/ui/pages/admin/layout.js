// ============================================================
// admin/layout.js — 后台框架（侧边导航 + 主区），简洁专业
// ============================================================
import { h } from '../../../core/dom.js';
import { auth } from '../../../data/services.js';

export function adminLayout(active, content) {
  const nav = h('nav', { class: 'admin__nav' });
  const add = (href, label, key, onClick) => {
    const a = onClick
      ? h('a', { href, class: key === active ? 'is-active' : '', on: { click: (e) => { e.preventDefault(); onClick(); } } }, label)
      : h('a', { href, class: key === active ? 'is-active' : '' }, label);
    nav.appendChild(a);
  };
  add('#/admin', '仪表盘', 'dashboard');
  add('#/admin/work/new', '新增作品', 'new');
  add('#/', '返回前台', 'site');
  add('#/admin/login', '退出登录', 'logout', () => { auth.logout(); location.hash = '#/admin/login'; });

  const side = h('aside', { class: 'admin__side' }, [
    h('div', { class: 'admin__brand' }, '管理后台'),
    nav,
  ]);
  return h('div', { class: 'admin' }, [side, h('div', { class: 'admin__main' }, content)]);
}
