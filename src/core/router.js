// ============================================================
// router.js — 基于 hash 的前端路由（SPA，无构建依赖）
// 路由表在 index.html 中装配；页面模块返回 DOM 节点或 HTML 字符串。
// ============================================================
import { raw } from './dom.js';

export class Router {
  constructor(routes, opts = {}) {
    this.routes = routes;
    this.opts = opts;
    window.addEventListener('hashchange', () => this.resolve());
    // 历史前进/后退：pushState 创建的筛选态（关键词/阶段/年份/排序）在 Back/Forward
    // 时通过 popstate 触发重渲，恢复对应视图；router 仅读取当前 hash，无副作用、无回环。
    window.addEventListener('popstate', () => this.resolve());
  }

  start() {
    if (!location.hash) location.hash = '/';
    else this.resolve();
  }

  navigate(path) {
    if (location.hash.slice(1) === path) this.resolve();
    else location.hash = path;
  }

  resolve() {
    const full = location.hash.slice(1) || '/';
    const path = full.split('?')[0] || '/';
    const query = parseQuery(full);
    for (const [pattern, view] of Object.entries(this.routes)) {
      const params = matchPath(pattern, path);
      if (params) { this._render(view, params, query, pattern); return; }
    }
    const nf = this.opts.notFound || (() => raw('<div class="container section"><h1 class="display">页面未找到</h1></div>'));
    this._render(nf, {}, query, '*');
  }

  _render(view, params, query, pattern) {
    const app = document.getElementById('app');
    if (this.opts.before) this.opts.before(pattern, params, query);
    const out = typeof view === 'function' ? view(params, query) : view;
    Promise.resolve(out).then((node) => {
      const resolved = typeof node === 'string' ? raw(node) : node;
      app.innerHTML = '';
      app.appendChild(resolved);
      window.scrollTo(0, 0);
      if (this.opts.after) this.opts.after(pattern, params, query);
    }).catch((err) => {
      // 统一显式错误态：视图渲染/reject 不得导致白屏。
      // 正式模式（Supabase）下，真实读取失败必须显式呈现，禁止静默空白。
      console.error('[router] 视图渲染失败：', err);
      const msg = (err && err.message) ? err.message : String(err);
      app.innerHTML = '';
      app.appendChild(raw(
        '<div class="container section">' +
        '<div class="router-error">' +
        '<h1 class="display">页面加载出错</h1>' +
        '<p class="secondary">该页面在加载数据时出现问题。请检查网络后重试；若持续出现，请联系管理员。</p>' +
        '<p class="router-error__detail"></p>' +
        '</div></div>'
      ));
      const detail = app.querySelector('.router-error__detail');
      if (detail) detail.textContent = msg;
    });
  }
}

export function parseQuery(hash) {
  const i = hash.indexOf('?');
  const q = {};
  if (i >= 0) new URLSearchParams(hash.slice(i + 1)).forEach((v, k) => (q[k] = v));
  return q;
}

export function buildQuery(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v != null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

function matchPath(pattern, path) {
  const pp = pattern.split('/').filter(Boolean);
  const sp = path.split('/').filter(Boolean);
  if (pp.length !== sp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}
