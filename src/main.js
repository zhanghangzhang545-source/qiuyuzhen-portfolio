// ============================================================
// main.js — 应用入口：装配路由 + 站点框架（导航/页脚）
// ============================================================
import { Router } from './core/router.js';
import { renderNav, renderFooter, initSiteEffects } from './ui/components/site.js';
import { homeView } from './ui/pages/home.js';
import { worksView } from './ui/pages/works.js?v=20260828-final16.3-simple';
import { workDetailView } from './ui/pages/workDetail.js';
import { comicReaderView } from './ui/pages/comicReaderPage.js';
import { aboutView } from './ui/pages/about.js';
import { adminLoginView } from './ui/pages/admin/login.js';
import { adminResetView } from './ui/pages/admin/reset.js';
import { adminDashboardView } from './ui/pages/admin/dashboard.js';
import { adminWorkEditView } from './ui/pages/admin/workEdit.js';
import { adminComicPagesView } from './ui/pages/admin/comicPages.js';
import { adminAboutView } from './ui/pages/admin/about.js';
import { adminCertificateEditView } from './ui/pages/admin/certificateEdit.js';
import { initDataLayer, auth, storage } from './data/services.js';
import { RECOVERY_KEY } from './data/auth.supabase.js';

// ============================================================
// 找回密码回跳捕获：邮件重置链接 → Supabase verify → 302 回跳本站，
// 恢复令牌附在 URL 上（implicit 流程在 hash：#access_token=...&type=recovery；
// PKCE 兜底在 search：?code=...）。这里在路由启动前把令牌转存 sessionStorage，
// 并用 replaceState 静默切到 #/admin/reset（不触发 hashchange，避免
// 路由双渲染导致恢复令牌被消费两次 → 第二次报「链接已失效」）。
// ============================================================
function captureRecoveryRedirect() {
  try {
    const hash = location.hash || '';
    const search = location.search || '';
    if (hash.includes('type=recovery') && hash.includes('access_token=')) {
      const p = new URLSearchParams(hash.slice(1));
      sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({
        access_token: p.get('access_token'),
        refresh_token: p.get('refresh_token') || '',
      }));
      history.replaceState(null, '', location.pathname + location.search + '#/admin/reset');
    } else if (/[?&]code=/.test(search)) {
      const code = new URLSearchParams(search).get('code');
      sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ code }));
      history.replaceState(null, '', location.pathname + '#/admin/reset');
    }
  } catch (_) { /* 捕获失败不影响正常启动 */ }
}
captureRecoveryRedirect();

const routes = {
  '/': homeView,
  '/works': worksView,
  '/works/:type': worksView,
  '/work/:id': workDetailView,
  '/comic/:id': comicReaderView,
  '/about': aboutView,
  '/admin': adminDashboardView,
  '/admin/login': adminLoginView,
  '/admin/reset': adminResetView,
  '/admin/about': adminAboutView,
  '/admin/work/new': adminWorkEditView,
  '/admin/work/:id/edit': adminWorkEditView,
  '/admin/comic/:id/pages': adminComicPagesView,
  '/admin/certificate/:id/edit': adminCertificateEditView,
};

const navRoot = document.getElementById('nav-root');
const footerRoot = document.getElementById('footer-root');

// —— 路由骨架：同步占位，禁止白屏（背景 + hero 占位），数据回来后原位替换 ——
// 仅用中性纸色块与极简占位条，无 shimmer / 飞入动画（不制造花哨过渡）。
function skeletonFor() {
  const wrap = document.createElement('div');
  wrap.className = 'route-skeleton';
  const hero = document.createElement('div');
  hero.className = 'route-skeleton__hero';
  wrap.appendChild(hero);
  const body = document.createElement('div');
  body.className = 'route-skeleton__body';
  const bar1 = document.createElement('div');
  bar1.className = 'route-skeleton__bar';
  const bar2 = document.createElement('div');
  bar2.className = 'route-skeleton__bar route-skeleton__bar--short';
  body.appendChild(bar1);
  body.appendChild(bar2);
  wrap.appendChild(body);
  return wrap;
}

const router = new Router(routes, {
  // 后台路由按需初始化 auth/storage（公开访问不提前加载后台能力）
  before: async (pattern) => {
    if (pattern.startsWith('/admin')) {
      await auth._ensure();
      await storage._ensure();
    }
  },
  // 同步先渲染骨架（router 内部会在挂载真实内容前先显示骨架）
  skeleton: skeletonFor,
  after: (pattern) => {
    const isAdmin = pattern.startsWith('/admin');
    navRoot.hidden = isAdmin;
    footerRoot.hidden = isAdmin;
    if (!isAdmin) {
      navRoot.replaceChildren(renderNav());
      footerRoot.replaceChildren(renderFooter());
      // 重新评估导航主题
      setTimeout(() => window.dispatchEvent(new Event('scroll')), 0);
    }
  },
});

// Phase 3-C1：尽早解析数据层模式（mock / supabase），后台会话态随之就绪。
// 解析失败（如正式模式配置异常）不会静默回 Mock（除「未配置」安全回退），
// 后续真实调用会显式抛错 → UI 呈现错误态。
// FINAL16.2-A：同步先渲染站点框架（导航/页脚），避免首屏空白；公开访问仅确保 repo，
// 后台 auth/storage 进入 #/admin/* 时由 router.before 按需加载。
(async () => {
  // 同步先渲染导航/页脚（即使数据层尚未就绪，框架也先稳定出现，禁止白屏）
  try {
    navRoot.replaceChildren(renderNav());
    footerRoot.replaceChildren(renderFooter());
  } catch (e) {
    console.error('[site] 框架渲染失败：', e);
  }
  try {
    await initDataLayer();
  } catch (e) {
    console.error('[data-layer] 初始化失败：', e);
  }
  router.start();
  initSiteEffects();
})();
