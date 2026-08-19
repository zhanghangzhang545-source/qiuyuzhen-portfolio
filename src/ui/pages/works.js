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

// 插画前 6 件固定编辑式编排（横幅 / 双联 / 横幅 / 双联），其余 12 件 CSS 多列自然流
const FEATURE_ILLU = ['i01', 'i12', 'i13', 'i14', 'i10', 'i17'];

// 响应式 sizes（按真实展示宽度；P0 性能专项加入，视觉/版式不变）
const SZ = {
  comicCover: '(max-width: 480px) 84px, (max-width: 1024px) 140px, 180px',
  comicPage: '(max-width: 480px) 70px, (max-width: 1024px) 90px, 110px',
  oil: '(max-width: 600px) 92vw, (max-width: 1024px) 46vw, 560px',
  full: '(max-width: 600px) 92vw, (max-width: 1024px) 62vw, 1180px',
  half: '(max-width: 600px) 46vw, (max-width: 1024px) 46vw, 560px',
  masonry: '(max-width: 600px) 92vw, (max-width: 1024px) 31vw, 370px',
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

/* —— 插画：统一视觉体系，两种层级相同。
   前 6 件固定编辑式编排：横幅(i01) / 双联(i12+i13) / 横幅(i14) / 双联(i10+i17)，
   均按真实比例呈现，无空洞、无 Grid 行孔。
   其余 12 件进入 CSS 多列自然流（桌面 3 / 平板 2 / 手机 1），稳定不参差。 —— */
function illuCard(work, num = '', eager = false, sizes = SZ.full) {
  if (!work) return null;
  return h('a', { class: 'illu-feat__cell feat-link', href: `#/work/${work.id}` }, [
    imgEl(work.cover, 'feat-img', work.title, { w: work.coverW, h: work.coverH, sizes, ...(eager ? { eager: true } : {}) }),
    workLabel({ num, en: 'ILLUSTRATION', title: work.title, sub: 'ORIGINAL WORK' }),
  ]);
}

function illustrationGrid(list, eagerFirst = false) {
  const byId = Object.fromEntries(list.map((w) => [w.id, w]));
  const feat = (id) => byId[id] || null;
  const rest = list.filter((w) => !FEATURE_ILLU.includes(w.id));

  const wrap = h('div', { class: 'illu-feat' });
  const banner1 = feat('i01');
  const pair1 = [feat('i12'), feat('i13')].filter(Boolean);
  const banner2 = feat('i14');
  const pair2 = [feat('i10'), feat('i17')].filter(Boolean);

  if (banner1) wrap.appendChild(illuCard(banner1, '01', eagerFirst, SZ.full));
  if (pair1.length) wrap.appendChild(h('div', { class: 'illu-feat__pair' }, pair1.map((w, i) => illuCard(w, String(i + 2).padStart(2, '0'), false, SZ.half))));
  if (banner2) wrap.appendChild(illuCard(banner2, '04', false, SZ.full));
  if (pair2.length) wrap.appendChild(h('div', { class: 'illu-feat__pair' }, pair2.map((w, i) => illuCard(w, String(i + 5).padStart(2, '0'), false, SZ.half))));

  // 其余 12 件：CSS 多列自然流（无纵向空洞）；首屏外一律 lazy 加载
  const restWrap = h('div', { class: 'works-masonry' });
  rest.forEach((w) => restWrap.appendChild(workCard(w, 0, { eager: false, noReveal: true, sizes: SZ.masonry })));
  wrap.appendChild(restWrap);
  return wrap;
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
    const criteria = { ...q, type: t || undefined, publicOnly: true };
    const data = await repo.filter(criteria);
    // 证书仅展示于「关于」，不进入公开作品库（按类型排除，与其 public 无关）
    for (let i = data.length - 1; i >= 0; i--) if (data[i].type === 'certificate') data.splice(i, 1);
    head.querySelector('.count').textContent = `共 ${data.length} 件`;
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
      // 全部作品页：仅首视口的第一组（漫画章）首图 eager/high；
      // 插画章与油画章位于较下方，一律 native lazy（仅单独进入 /works/illustration、/works/oil 时才 eager 首图）
      if (comics.length) addChapter('comic', comics.length, h('div', { class: 'comic-list' }, comics.map((w, i) => comicRow(w, i, i === 0))));
      if (illus.length) addChapter('illustration', illus.length, illustrationGrid(illus, false));
      if (oils.length) addChapter('oil', oils.length, h('div', { class: 'oil-gallery' }, oils.map((w, i) => oilItem(w, i, false))));
    }
    results.appendChild(wrap);
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
