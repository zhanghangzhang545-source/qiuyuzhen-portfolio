// ============================================================
// main.js — 应用入口：装配路由 + 站点框架（导航/页脚）
// ============================================================
import { Router } from './core/router.js';
import { renderNav, renderFooter, initSiteEffects } from './ui/components/site.js';
import { homeView } from './ui/pages/home.js';
import { worksView } from './ui/pages/works.js?v=20260826-final10';
import { workDetailView } from './ui/pages/workDetail.js';
import { comicReaderView } from './ui/pages/comicReaderPage.js';
import { aboutView } from './ui/pages/about.js';
import { adminLoginView } from './ui/pages/admin/login.js';
import { adminDashboardView } from './ui/pages/admin/dashboard.js';
import { adminWorkEditView } from './ui/pages/admin/workEdit.js';
import { adminComicPagesView } from './ui/pages/admin/comicPages.js';
import { adminAboutView } from './ui/pages/admin/about.js';
import { adminCertificateEditView } from './ui/pages/admin/certificateEdit.js';
import { initDataLayer } from './data/services.js';

const routes = {
  '/': homeView,
  '/works': worksView,
  '/works/:type': worksView,
  '/work/:id': workDetailView,
  '/comic/:id': comicReaderView,
  '/about': aboutView,
  '/admin': adminDashboardView,
  '/admin/login': adminLoginView,
  '/admin/about': adminAboutView,
  '/admin/work/new': adminWorkEditView,
  '/admin/work/:id/edit': adminWorkEditView,
  '/admin/comic/:id/pages': adminComicPagesView,
  '/admin/certificate/:id/edit': adminCertificateEditView,
};

const navRoot = document.getElementById('nav-root');
const footerRoot = document.getElementById('footer-root');

const router = new Router(routes, {
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
// 启动竞态修复：必须 await initDataLayer 完成后再 router.start()，
// 否则后台 ensureSession / isAuthed 同步闸门可能在 impl 未就绪时误判。
(async () => {
  try {
    await initDataLayer();
  } catch (e) {
    console.error('[data-layer] 初始化失败：', e);
  }
  router.start();
  initSiteEffects();
})();
