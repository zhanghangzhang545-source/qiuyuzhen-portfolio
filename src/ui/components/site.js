// ============================================================
// site.js — 站点框架：导航 + 页脚（邱钰真 正式版）
// ============================================================
import { h } from '../../core/dom.js';

let effectsInited = false;

export function renderNav() {
  const hash = location.hash.slice(1) || '/';
  const is = (p) => (p === '/' ? hash === '/' : hash.startsWith(p));
  const isHome = hash === '/';
  const links = [
    { href: '#/works', label: '作品' },
    { href: '#/about', label: '关于' },
  ];
  const navLinks = h('nav', { class: 'nav-links', id: 'navLinks' },
    links.map((l) => h('a', {
      href: l.href, class: is(l.href.slice(1)) ? 'is-active' : '',
      on: { click: () => navLinks.classList.remove('is-open') },
    }, l.label)));
  const toggle = h('button', {
    class: 'nav-toggle', 'aria-label': '菜单',
    on: { click: () => navLinks.classList.toggle('is-open') },
  }, '☰');
  const cls = ['site-nav', isHome ? 'site-nav--hero' : ''].filter(Boolean).join(' ');
  return h('header', { class: cls },
    h('div', { class: 'container site-nav__inner' }, [
      h('a', { class: 'brand', href: '#/' }, [
        h('span', { class: 'brand__mark' }, 'QIU YU ZHEN'),
        h('span', { class: 'brand__sub' }, '插画 · 漫画 · 油画'),
      ]),
      navLinks, toggle,
    ]));
}

function updateNavScroll() {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;
  const isHome = (location.hash.slice(1) || '/') === '/';
  const threshold = window.innerHeight * 0.72;
  nav.classList.toggle('site-nav--scrolled', isHome && window.scrollY > threshold);
}

export function initSiteEffects() {
  if (effectsInited) return;
  effectsInited = true;
  window.addEventListener('scroll', updateNavScroll, { passive: true });
  window.addEventListener('resize', updateNavScroll, { passive: true });
  updateNavScroll();
}

export function renderFooter() {
  return h('footer', { class: 'site-footer' },
    h('div', { class: 'container site-footer__inner' }, [
      h('div', { class: 'site-footer__brand' }, [
        h('div', {}, 'QIU YU ZHEN'),
        h('span', { class: 'qy-colophon' }, '邱钰真 · 插画 / 漫画 / 油画作品集'),
        h('span', { class: 'qy-colophon' }, 'ART PORTFOLIO · EDITION 2026'),
      ]),
      h('nav', { class: 'site-footer__links' }, [
        h('a', { href: '#/works' }, '作品库'),
        h('a', { href: '#/about' }, '关于艺术家'),
        h('a', { href: 'mailto:2219528116@qq.com' }, '联系'),
      ]),
      h('div', { class: 'site-footer__note' }, [
        h('span', { class: 'edi-reg' }),
        h('span', {}, '© 2026 QIU YU ZHEN · PORTFOLIO'),
      ]),
    ]));
}
