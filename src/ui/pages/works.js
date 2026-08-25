// ============================================================
// works.js — 作品库（交付修复版）
//  三种明确章节，统一视觉体系：
//    01 COMICS          —— 五部漫画以项目形式展示（封面 / 代表内页 + 标题 + 年份 + 页数）
//    02 ILLUSTRATION    —— 18 件插画全部展示；前 6 件更突出（更大），但沿用同一 workCard 模板与真实比例
//    03 OIL PAINTING    —— 两幅油画大尺寸画廊
//  不再拆成 Selected + Archive 两套 UI；不随机切换模板；图片保持真实比例。
// ============================================================
import { h } from '../../core/dom.js';
import { repo } from '../../data/services.js';
import { renderFilterBar } from '../components/filterBar.js';
import { workCard } from '../components/workCard.js';
import { workLabel, natureSub } from '../components/label.js';
import { imgEl } from '../components/media.js';
import { emptyState } from '../components/primitives.js';
import { buildQuery } from '../../core/router.js';
import { typeName } from '../../data/types.js';

// 三种章节元数据（共享：编号 / 中文 / 英文 / 查看入口，层级 / 字号 / 边距 / 分割一致）
const CHAPTER_META = {
  comic:      { num: '01', zh: '漫画作品', en: 'COMICS', link: '#/works/comic' },
  illustration:{ num: '02', zh: '插画作品', en: 'ILLUSTRATION', link: '#/works/illustration' },
  oil:        { num: '03', zh: '油画作品', en: 'OIL PAINTING', link: '#/works/oil' },
};

// 插画编辑式尺寸层级（A3 桌面反馈）：由 seed.js 的 displaySize 字段驱动（A4 枚举预留），
//   large-portrait → 重点竖版两张并列大图；wide-feature → 重点横版独占整块宽区域；
//   standard      → 普通作品较小 Archive 多列自然流。
// 不在此处写死作品名单；放大对象沿用已确认精选，名单调整只改 seed.js 的 DISPLAY_SIZE。
// 插画章节注释同步更新：前段编辑式编排，其余 CSS 多列自然流。

// 响应式 sizes（按真实展示宽度；P0 性能专项加入，视觉/版式不变）
const SZ = {
  comicCover: '(max-width: 480px) 84px, (max-width: 1024px) 140px, 180px',
  comicPage: '(max-width: 480px) 70px, (max-width: 1024px) 90px, 110px',
  oil: '(max-width: 720px) 92vw, (max-width: 1024px) 46vw, 560px',
  full: '(max-width: 1024px) 92vw, 1180px',
  half: '(max-width: 720px) 92vw, (max-width: 1024px) 46vw, 560px',
  masonry: '(max-width: 720px) 92vw, (max-width: 1024px) 46vw, 370px',
};

/** 统一的章节标题（三种媒介共用，确保层级 / 编号 / 字号 / 边距 / 分割一致） */
function chapterHeader(key, count) {
  const m = CHAPTER_META[key];
  return h('div', { class: 'works-chapter' }, [
    h('div', { class: 'works-chapter__num' }, m.num),
    h('div', { class: 'works-chapter__head' }, [
      h('div', {}, [
        h('div', { class: 'works-chapter__en' }, m.en),
        h('h2', { class: 'works-chapter__title serif' }, m.zh),
      ]),
      h('div', { class: 'works-chapter__meta' }, [
        h('span', { class: 'works-chapter__count' }, `${count} 件`),
        h('a', { class: 'link works-chapter__link', href: m.link }, ['查看全部', h('span', { class: 'arrow' }, '→')]),
      ]),
    ]),
  ]);
}

function comicRow(work, i = 0, eager = false) {
  const rep = work.pages && work.pages[0];
  const opt = (w, h) => ({ w, h, ...(eager ? { eager: true } : {}) });
  const num = String(i + 1).padStart(2, '0');
  // 左侧辅助文字：年份 · 真实作品性质（来自 workNature，不硬编码）；页数移到右侧单独列
  const sub = [work.year ? String(work.year) : null, natureSub(work)].filter(Boolean).join(' · ');
  return h('a', { class: 'comic-row', href: `#/comic/${work.id}` }, [
    h('div', { class: 'comic-row__cover' }, imgEl(work.cover, null, work.title, { ...opt(work.coverW, work.coverH), sizes: SZ.comicCover })),
    rep ? h('div', { class: 'comic-row__page' }, imgEl(rep.image, null, `${work.title} 内页`, { ...opt(rep.w, rep.h), sizes: SZ.comicPage })) : null,
    h('div', { class: 'comic-row__body' }, [
      workLabel({ num, en: 'COMIC', title: work.title, sub }),
      work.intro ? h('p', { class: 'comic-row__intro' }, work.intro) : null,
    ]),
    h('div', { class: 'comic-row__pages' }, `${work.pages.length}P →`),
  ]);
}

function oilItem(work, i = 0, eager = false) {
  const num = String(i + 1).padStart(2, '0');
  return h('a', { class: 'oil-card', href: `#/work/${work.id}` }, [
    h('div', { class: 'oil-card__media' }, imgEl(work.cover, null, work.title, { w: work.coverW, h: work.coverH, sizes: SZ.oil, ...(eager ? { eager: true } : {}) })),
    workLabel({ num, en: 'OIL PAINTING', title: work.title, sub: 'ORIGINAL WORK' }),
  ]);
}

/* —— 插画：编辑式尺寸层级（displaySize 驱动，A3/A4）。
   结构：[竖大][竖大]（large-portrait 两张并列）→ [横大独占]（wide-feature 整块宽区域）
        → 普通流（standard，CSS 多列 Archive：桌面3 / 平板2 / 手机1）。
   均按真实比例呈现，无空洞、无 Grid 行孔，不强制统一方块、不裁重要画面。 —— */
function illuCard(work, num = '', eager = false, sizes = SZ.full) {
  if (!work) return null;
  return h('a', { class: 'illu-feat__cell feat-link', href: `#/work/${work.id}` }, [
    imgEl(work.cover, 'feat-img', work.title, { w: work.coverW, h: work.coverH, sizes, ...(eager ? { eager: true } : {}) }),
    workLabel({ num, en: 'ILLUSTRATION', title: work.title, sub: 'ORIGINAL WORK' }),
  ]);
}

function illustrationGrid(list, eagerFirst = false) {
  const feats = list.filter((w) => w.displaySize === 'large-portrait' || w.displaySize === 'wide-feature');
  const rest = list.filter((w) => !feats.includes(w));

  const portraits = feats.filter((w) => w.displaySize === 'large-portrait');
  const wides = feats.filter((w) => w.displaySize === 'wide-feature');

  const wrap = h('div', { class: 'illu-feat' });
  let n = 0;
  let eagerLeft = eagerFirst; // 仅本组第一张走 eager/high（首视口关键图）
  // 重点竖版：两张并列大图（真实比例；奇数张时最后一张仍半宽并排不拉伸）
  for (let i = 0; i < portraits.length; i += 2) {
    const pairItems = portraits.slice(i, i + 2);
    wrap.appendChild(h('div', { class: 'illu-feat__pair' }, pairItems.map((w) => {
      const c = illuCard(w, String(++n).padStart(2, '0'), eagerLeft, SZ.half);
      eagerLeft = false;
      return c;
    })));
  }
  // 重点横版：独占整块宽区域
  wides.forEach((w) => {
    wrap.appendChild(illuCard(w, String(++n).padStart(2, '0'), eagerLeft, SZ.full));
    eagerLeft = false;
  });

  // 普通作品：CSS 多列自然流（无纵向空洞）；首屏外一律 lazy 加载
  const restWrap = h('div', { class: 'works-masonry' });
  rest.forEach((w) => restWrap.appendChild(workCard(w, 0, { eager: false, noReveal: true, sizes: SZ.masonry })));
  wrap.appendChild(restWrap);
  return wrap;
}

// 「全部作品」默认页精选入口数量（客户反馈 C：漫画~1 / 插画~3 / 油画~1）。
// 桌面与手机统一采用此精选入口；入选名单 = seed.js 的 featured 数据（沿用已确认精选，不自选）；
// 客户给出正式名单后只改 seed.js 的 featured 集，本结构不改。各分类页（/works/comic 等）仍展示完整作品。
const PICKS = { comic: 1, illustration: 3, oil: 1 };

/** 精选入口：每类一个块（标题 + 查看全部 + 精选作品），桌面与手机统一结构（CSS 控制布局） */
function buildPicks(comics, illus, oils) {
  // 「作品库精选入口」严格使用 works_pick / works_pick_order（与首页 home_featured 完全独立）。
  // 任何基于 featured（home_featured）的排序都不得影响 Works Pick，反之亦然。
  // B2 冻结排序语义：works_pick_order 越大越靠前（= 100 - index*2）。
  // 必须使用「降序」排序，否则会产生与真实数据相反的顺序（v4 ④ 修复）。
  const pick = (arr, n) => arr
    .filter((w) => w.worksPick)
    .sort((a, b) => (b.worksPickOrder || 0) - (a.worksPickOrder || 0))
    .slice(0, n);

  const catBlock = (key, works, all) => {
    const m = CHAPTER_META[key];
    const picked = pick(all, PICKS[key]);
    if (!picked.length) return null;
    return h('section', { class: 'picks__cat' }, [
      h('div', { class: 'picks__head' }, [
        h('h2', { class: 'serif picks__title' }, m.zh),
        h('a', { class: 'link', href: m.link }, [`查看全部 ${all.length} 件`, h('span', { class: 'arrow' }, '→')]),
      ]),
      h('div', { class: 'picks__list' }, works),
    ]);
  };

  return [
    catBlock('comic', pick(comics, PICKS.comic).map((w, i) => comicRow(w, i, i === 0)), comics),
    catBlock('illustration', pick(illus, PICKS.illustration).map((w, i) =>
      workCard(w, i, { eager: false, noReveal: true, sizes: SZ.masonry })), illus),
    catBlock('oil', pick(oils, PICKS.oil).map((w, i) =>
      workCard(w, i, { eager: false, noReveal: true, sizes: SZ.oil })), oils),
  ].filter(Boolean);
}

export async function worksView(params, query) {
  const type = params.type || query.type || '';
  const list = await repo.list();
  const years = [...new Set(list.map((w) => w.year).filter((y) => y != null && y !== ''))].sort((a, b) => b - a);

  const page = h('div', { class: 'container about-wrap section works-page' });
  const head = h('div', { class: 'page-head' }, [
    h('h1', {}, type ? typeName(type) : '全部作品'),
    h('span', { class: 'count' }, ''),
  ]);
  const results = h('div', {});
  const stages = [...new Set(list.map((w) => w.stage).filter(Boolean))].sort();

  async function renderResults(q) {
    const t = q.type || '';
    // 消除重复全量请求：直接对初始已加载的 list 做内存过滤，
    // 不再调用 repo.filter（其内部会再发一次 repo.list()）。
    let data = list.filter((w) => w.type !== 'certificate' && w.public !== false);
    if (t) data = data.filter((w) => w.type === t);
    if (q.stage) data = data.filter((w) => w.stage === q.stage);
    if (q.year) data = data.filter((w) => String(w.year) === String(q.year));
    if (q.q) {
      const kw = q.q.trim().toLowerCase();
      if (kw) data = data.filter((w) =>
        (w.title || '').toLowerCase().includes(kw) ||
        (w.intro || '').toLowerCase().includes(kw) ||
        (w.tags || []).some((tag) => tag.toLowerCase().includes(kw)));
    }
    // 排序（与 repository filter 一致）
    const sort = q.sort || 'manual';
    const yv = (w) => (w.year == null || w.year === '') ? null : Number(w.year);
    const byCustom = (a, b) => (b.sort || 0) - (a.sort || 0);
    const yearDesc = (a, b) => { const ya = yv(a), yb = yv(b); if (ya == null && yb == null) return byCustom(a, b); if (ya == null) return 1; if (yb == null) return -1; return (yb - ya) || byCustom(a, b); };
    const yearAsc = (a, b) => { const ya = yv(a), yb = yv(b); if (ya == null && yb == null) return byCustom(a, b); if (ya == null) return 1; if (yb == null) return -1; return (ya - yb) || byCustom(a, b); };
    data.sort((a, b) => {
      switch (sort) {
        case 'newest': return yearDesc(a, b);
        case 'oldest': return yearAsc(a, b);
        case 'sort-asc': return a.sort - b.sort;
        case 'sort-desc': return b.sort - a.sort;
      case 'manual':
      default:
        // Works 完整列表 manual 排序：仅按 sort_order（自定义权重），不受 home_featured / works_pick 维度污染。
        // 双维度独立：Home Featured 由 home_featured+homeFeaturedOrder 决定；Works Pick 由 worksPick+worksPickOrder 决定。
        return byCustom(a, b);
      }
    });
    // P0-5：默认「全部作品」页显示精选数与总数（精选 5 件 · 全部 25 件）；分类页保持「共 X 件」。
    const countEl = head.querySelector('.count');
    if (!t) {
      const picksCount = list.filter((w) => w.worksPick && w.type !== 'certificate' && w.public !== false).length;
      countEl.textContent = `精选 ${picksCount} 件 · 全部 ${data.length} 件`;
    } else {
      countEl.textContent = `共 ${data.length} 件`;
    }
    results.innerHTML = '';
    if (!data.length) {
      results.appendChild(emptyState('没有匹配的作品', '试试调整筛选条件，或点击“重置”。'));
      return;
    }

    const comics = data.filter((w) => w.type === 'comic');
    const illus = data.filter((w) => w.type === 'illustration');
    const oils = data.filter((w) => w.type === 'oil');

    const wrap = h('div', { class: 'works-groups' });
    const addChapter = (key, count, body) => {
      wrap.appendChild(chapterHeader(key, count));
      wrap.appendChild(body);
    };

    // 仅每章首图 eager（首视口关键图），其余一律 native lazy，继续写真实尺寸防 CLS
    if (t === 'comic') {
      if (comics.length) addChapter('comic', comics.length, h('div', { class: 'comic-list' }, comics.map((w, i) => comicRow(w, i, i === 0))));
    } else if (t === 'oil') {
      if (oils.length) addChapter('oil', oils.length, h('div', { class: 'oil-gallery' }, oils.map((w, i) => oilItem(w, i, i === 0))));
    } else if (t === 'illustration') {
      if (illus.length) addChapter('illustration', illus.length, illustrationGrid(illus, true));
    } else {
      // 默认「全部作品」页：仅展示精选入口（Works Pick 1/3/1 = 5 件代表，baseline：
      // comic-yoyogi2026 / i01 / i12 / i13 / oil1），不把 25 件全部铺出；
      // 各分类完整页（/works/comic、/works/illustration、/works/oil）仍展示全部作品。
      // 精选入口由下方 isDefaultView 分支统一追加（buildPicks）。
    }
    results.appendChild(wrap);

    // —— 「全部作品」默认页精选入口（桌面 + 手机统一；仅默认无筛选视图）——
    // 进入具体分类页（/works/comic、/works/illustration、/works/oil）或筛选后回完整章节结构。
    const isDefaultView = !t && !q.q && !q.stage && !q.year && (!q.sort || q.sort === 'manual');
    page.classList.toggle('has-picks', isDefaultView);
    if (isDefaultView) {
      results.appendChild(h('div', { class: 'works-picks' }, buildPicks(comics, illus, oils)));
    }
  }

  // 类型切换：写入路由（入历史栈，支持返回/前进），整页重渲，URL 与标题同步更新。
  // 排序/阶段/年份/关键词：原地 replaceState（不新增历史），仅更新 URL 与结果。
  const filter = renderFilterBar({ ...query, type }, years, stages, (newQ) => {
    const base = newQ.type ? `#/works/${newQ.type}` : '#/works';
    const qs = buildQuery({ sort: newQ.sort, stage: newQ.stage, year: newQ.year, q: newQ.q });
    if (newQ.type !== type) {
      location.hash = base + qs;
    } else {
      history.replaceState(null, '', base + qs);
      renderResults(newQ);
    }
  });

  await renderResults({ ...query, type });
  page.append(head, filter, results);
  return page;
}
