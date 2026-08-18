// ============================================================
// main.js — 应用入口：装配路由 + 站点框架（导航/页脚）
// ============================================================
import { Router } from './core/router.js';
import { renderNav, renderFooter, initSiteEffects } from './ui/components/site.js';
import { homeView } from './ui/pages/home.js';
import { worksView } from './ui/pages/works.js';
import { workDetailView } from './ui/pages/workDetail.js';
import { comicReaderView } from './ui/pages/comicReaderPage.js';
import { aboutView } from './ui/pages/about.js';
import { adminLoginView } from './ui/pages/admin/login.js';
import { adminDashboardView } from './ui/pages/admin/dashboard.js';
import { adminWorkEditView } from './ui/pages/admin/workEdit.js';
import { adminComicPagesView } from './ui/pages/admin/comicPages.js';

const routes = {
  '/': homeView,
  '/works': worksView,
  '/works/:type': worksView,
  '/work/:id': workDetailView,
  '/comic/:id': comicReaderView,
  '/about': aboutView,
  '/admin': adminDashboardView,
  '/admin/login': adminLoginView,
  '/admin/work/new': adminWorkEditView,
  '/admin/work/:id/edit': adminWorkEditView,
  '/admin/comic/:id/pages': adminComicPagesView,
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

router.start();
initSiteEffects();
