// ============================================================
// home.js — 首页（交付修复版）
//  第一屏：深色，《旅途》为视觉底层（方向保留，不再重做）
//  三大完整专题（每专题自成紧凑构图，无孤立缩略图、无大面积留白）：
//    A 插画专题：接雨草树林2.0ver / 梦里的风景 / 无可磨灭的存在
//    B 核心漫画专题：2026 代代木毕业设计（封面 + 3 张真实内页 + 27P 项目说明）
//    C 综合创作专题：献上战舞 + 两幅油画
//  收束：作品分类入口 + 关于预告
// ============================================================
import { h } from '../../core/dom.js';
import { repo, aboutRepo } from '../../data/services.js';
import { imgEl } from '../components/media.js';
import { workLabel, natureSub } from '../components/label.js';
import { emptyState } from '../components/primitives.js';
import { WORK_TYPES, typeName } from '../../data/types.js';

const NEUTRAL_BIO = '以插画与漫画为主要创作方向，关注角色、叙事与氛围表达。';
const byId = (arr, id) => arr.find((w) => w.id === id) || null;

// 响应式 sizes（按真实展示宽度；P0 性能专项加入，视觉/版式不变）
const SZ = {
  hero: '(max-width: 600px) 100vw, 1440px',
  // 横版大图（wide-feature 整行）：桌面外始终占满容器宽度（非 62vw，避免平板/手机单列时取图过小发虚）
  full: '(max-width: 1024px) 92vw, 1180px',
  // 竖版双联：桌面/平板（>720px）双列各 ~46vw；手机（≤720px 已单列全宽）取 92vw，避免 46vw 取图过小发虚
  half: '(max-width: 720px) 92vw, (max-width: 1024px) 46vw, 560px',
  compositeMain: '(max-width: 1024px) 90vw, 940px',
  oilSmall: '(max-width: 1024px) 42vw, 210px',
  comicFeatCover: '(max-width: 1024px) 92vw, 360px',
  comicFeatPages: '(max-width: 600px) 30vw, (max-width: 1024px) 31vw, 370px',
};

/** 专题标题（与 Works 章节系统视觉一致：编号 / 英文 / 中文 / 上分隔线） */
function topicHead(num, en, zh) {
  return h('div', { class: 'works-chapter' }, [
    h('div', { class: 'works-chapter__num' }, num),
    h('div', { class: 'works-chapter__head' }, [
      h('div', {}, [
        h('div', { class: 'works-chapter__en' }, en),
        h('h2', { class: 'works-chapter__title serif' }, zh),
      ]),
    ]),
  ]);
}

export async function homeView() {
  // 消除 N+1：仅取一次 list（含全部公开数据：works + certificates），
  // 后续全部为本地内存过滤，不再重复发起全量请求。
  const full = await repo.filter({ publicOnly: true });
  // P0-3：关于预告所需的姓名/拼音/简介/教育数全部读 aboutRepo（Mock 与 Supabase 同形状），绝不硬编码。
  const about = await aboutRepo.read();
  const all = full.filter((w) => w.type !== 'certificate');
  const featured = full.filter((w) => w.featured && w.public !== false);
  // 证书单独从「公开完整数据」筛选，避免被上面排除 certificate 的 all 影响导致数量为 0
  const certs = full.filter((w) => w.type === 'certificate' && w.public !== false);

  // 主视觉固定用《旅途》（i09）—— Hero 维持独立 Hero 契约，不纳入首页 SELECTED 数据驱动选择。
  const heroArt = byId(all, 'i09') || featured.find((w) => w.type === 'illustration') || featured[0] || all[0];

  const counts = {};
  all.forEach((w) => (counts[w.type] = (counts[w.type] || 0) + 1));
  const comics = all.filter((w) => w.type === 'comic').sort((a, b) => (a.year || 0) - (b.year || 0));

  // —— 首页 SELECTED / Home Featured 改为数据驱动 ——
  // 不再硬编码具体业务 ID（i01/i12/i10/oil1/oil2）。所有「首页专题」作品由
  //   home_featured=true + home_featured_order（降序） + type + displaySize 决定。
  // 未来管理员在后台改这些字段即可调整首页，无需改源码。
  // 注意：仅决定「哪些作品进入首页各专题槽位」，不改变现有 DOM/CSS/视觉结构。
  const homeFeaturedSorted = featured
    .slice()
    .sort((a, b) => (b.homeFeaturedOrder || 0) - (a.homeFeaturedOrder || 0) || (b.sort || 0) - (a.sort || 0));

  // 专题 A 插画专题：仅允许来自 home_featured 且 type=illustration 的精选（按 homeFeaturedOrder 降序）。
  // 严禁用 home_featured=false 作品补位；数量不足则减少槽位，0 件则整个专题隐藏。
  // 消费式唯一选择：某作品进入一个槽位后立即从 remaining 移除，同一 ID 永不重复占两个槽位。
  const homeIllus = homeFeaturedSorted.filter((w) => w.type === 'illustration');
  const _illusRemaining = homeIllus.slice(); // 剩余可选池（消费式）
  const _takeIllus = (pred) => {
    const idx = pred ? _illusRemaining.findIndex(pred) : 0;
    if (idx < 0) return null;
    return _illusRemaining.splice(idx, 1)[0] || null;
  };
  const i01 = _takeIllus((w) => w.displaySize === 'wide-feature') || _takeIllus() || null;   // 横幅大图：优先 wide-feature，无则取剩余第一件
  const i12 = _takeIllus((w) => w.displaySize === 'large-portrait') || _takeIllus() || null;  // 竖版双联之一：优先 large-portrait，无则取剩余第一件
  const i10 = _takeIllus() || null;                                                        // 竖版双联之二：仅从 remaining 取

  // 专题 B 核心漫画专题：仅允许来自 home_featured 且 type=comic 的精选（取 homeFeaturedOrder 最小者作为 spotlight）。
  // 严禁用 comics[0]（可能 home_featured=false）补位；0 件则整个专题隐藏。
  // B2 基线：comic-grad2021(92) 与 comic-yoyogi2026(90) 均为 home_featured，yoyogi(90) 最小 → 选 yoyogi。
  const homeComics = homeFeaturedSorted.filter((w) => w.type === 'comic');
  const yoyogi = homeComics.slice().sort((a, b) => (a.homeFeaturedOrder || 0) - (b.homeFeaturedOrder || 0))[0] || null;

  // 专题 C 油画作品：仅允许来自 home_featured 且 type=oil 的精选（按 homeFeaturedOrder 降序）。
  // 严禁用 all.filter(...)[1]（可能 home_featured=false）补位；数量不足则减少槽位，0 件则整个专题隐藏。
  const homeOils = homeFeaturedSorted.filter((w) => w.type === 'oil');
  const oil1 = homeOils[0] || null;
  const oil2 = homeOils[1] || null;

  // —— 第一屏：深色，《旅途》为视觉底层（方向保留） ——
  const hero = h('section', { class: 'hero' }, [
    h('div', { class: 'hero__media' }, imgEl(heroArt.cover, 'hero__img', heroArt.title, { eager: true, w: heroArt.coverW, h: heroArt.coverH, sizes: SZ.hero })),
    h('div', { class: 'hero__scrim' }),
    h('div', { class: 'container hero__inner' }, [
      h('div', { class: 'hero__copy' }, [
        h('div', { class: 'hero__kicker' }, [
          h('span', {}, 'Illustration & Comic'),
        ]),
        // P0-2-A（最终修复）：大写英文 QIU / YUZHEN 两行作为主视觉身份（最大层级），
        //   中文姓名降为次级（小一号、不抢主视觉）；仅调行距/字距/字号/字重/左距与间距，不重做整站。
        h('h1', { class: 'hero__name' }, [
          h('span', { class: 'hero__line' }, 'QIU'),
          h('span', { class: 'hero__line' }, 'YUZHEN'),
        ]),
        h('div', { class: 'hero__cn' }, '邱钰真'),
        h('p', { class: 'hero__lead' }, NEUTRAL_BIO),
      ]),
      h('button', {
        class: 'hero__scroll', type: 'button',
        on: { click: (e) => { e.preventDefault(); document.getElementById('selected')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
      }, ['Selected Works', h('span', {}, '↓')]),
    ]),
  ]);

  // —— 专题 A：插画专题（接雨草树林2.0ver 整幅 + 梦里的风景 / 无可磨灭的存在 双联；取消右侧空信息列） ——
  const aBanner = (i01 && h('a', { class: 'feat-link', href: `#/work/${i01.id}` }, [
    imgEl(i01.cover, 'feat-img', i01.title, { w: i01.coverW, h: i01.coverH, sizes: SZ.full }),
    workLabel({ num: '01', en: 'ILLUSTRATION', title: i01.title, sub: 'ORIGINAL WORK' }),
  ])) || null;

  const aPair = (i12 && h('div', { class: 'feat-portrait' }, [
    h('div', { class: 'feat-portrait__pair' }, [
      h('a', { class: 'feat-link', href: `#/work/${i12.id}` }, [
        imgEl(i12.cover, 'feat-img', i12.title, { w: i12.coverW, h: i12.coverH, sizes: SZ.half }),
        workLabel({ num: '02', en: 'ILLUSTRATION', title: i12.title, sub: 'ORIGINAL WORK' }),
      ]),
      i10 && h('a', { class: 'feat-link', href: `#/work/${i10.id}` }, [
        imgEl(i10.cover, 'feat-img', i10.title, { w: i10.coverW, h: i10.coverH, sizes: SZ.half }),
        workLabel({ num: '03', en: 'ILLUSTRATION', title: i10.title, sub: 'ORIGINAL WORK' }),
      ]),
    ].filter(Boolean)),
  ])) || null;

  // (a) 修复：某分类 Home Featured 数量不足时，该专题整体隐藏（不渲染空标题/空槽位），
  //     绝不用 home_featured=false 的作品补位。仅当该分类确有精选作品时才展示专题。
  // 数量不足则减少槽位：i01 横幅、i12 竖版其一存在即可成专题；i10 可选（无则不渲染第三槽位）。
  const topicA = (i01 || i12) ? h('section', { class: 'section--tight container', id: 'selected' }, [
    topicHead('01', 'ILLUSTRATION', '插画专题'),
    h('div', { class: 'feature' }, [aBanner, aPair].filter(Boolean)),
  ]) : null;

  // —— 专题 B：核心漫画专题（2026 代代木毕业设计：封面 + 3 张真实内页 + 27P 项目说明） ——
  // P0-4（最终修复）：客户仅说「综合创作里有一张插画，看看排版」，未要求删内页；
  //   恢复「封面 + 3 张真实内页预览 + 项目信息 + 开始阅读」结构（内页取 yoyogi.pages 前 3）。
  const topicB = (yoyogi && h('section', { class: 'section--dark section--tight' }, [
    h('div', { class: 'container' }, [
      topicHead('02', 'FEATURE COMIC', '核心漫画'),
      h('div', { class: 'comics__feature' }, [
        h('a', { class: 'comics__cover feat-link', href: `#/comic/${yoyogi.id}` },
          imgEl(yoyogi.cover, null, yoyogi.title, { w: yoyogi.coverW, h: yoyogi.coverH, sizes: SZ.comicFeatCover })),
        h('div', { class: 'comics__feature-body' }, [
          h('div', { class: 'comics__feature-meta' }, [
            h('span', { class: 'comics__feature-proj' }, yoyogi.stage || natureSub(yoyogi) || '漫画作品'),
            workLabel({ num: '01', en: 'COMIC', title: yoyogi.title, sub: `${yoyogi.year} · ${natureSub(yoyogi)}` }),
          ]),
          // 3 张真实内页预览（数据驱动，取前 3 页）
          (yoyogi.pages && yoyogi.pages.length
            ? h('div', { class: 'comics__pages' },
                yoyogi.pages.slice(0, 3).map((p) =>
                  imgEl(p.image, null, yoyogi.title, { w: p.w, h: p.h, sizes: SZ.comicFeatPages })))
            : null),
          h('a', { class: 'link link--light', href: `#/comic/${yoyogi.id}` }, ['开始阅读', h('span', { class: 'arrow' }, '→')]),
        ]),
      ]),
    ]),
  ])) || null;

  // —— 专题 C：油画作品（A2 已定稿：OIL PAINTING，仅真实油画并排；不混入插画）——
  // (a) 修复：油画专题按 home_featured 且 type=oil 的精选全集渲染，数量不足则减少槽位，
  //     多于此数则全部渲染（不截断），绝不补位未精选作品。
  const owLabel = (work, num, en) => workLabel({ num, en, title: work.title, sub: 'ORIGINAL WORK' });
  const oilArts = homeOils;
  const oilCells = oilArts.map((o, k) => h('a', { class: 'feat-link ow-oil__cell', href: `#/work/${o.id}` }, [
    imgEl(o.cover, 'feat-img', o.title, { w: o.coverW, h: o.coverH, sizes: SZ.half }),
    owLabel(o, String(k + 1).padStart(2, '0'), 'OIL PAINTING'),
  ]));
  // (a) 修复：油画专题仅当确有油画精选（任一存在）时才展示，避免空标题。
  const topicC = (oil1 || oil2) ? h('section', { class: 'section--tight container' }, [
    topicHead('03', 'OIL PAINTING', '油画作品'),
    h('div', { class: 'ow-oil' }, oilCells),
  ]) : null;

  // —— 作品分类入口（极简文字，无缩略图） ——
  const catIndex = WORK_TYPES.map((t) =>
    h('a', { class: 'catindex__item', href: `#/works/${t.id}` }, [
      h('div', { class: 'catindex__name serif' }, t.name),
      h('div', { class: 'catindex__count' }, `${counts[t.id] || 0} 件`),
      h('div', { class: 'catindex__bar', style: { '--cat': t.color } }),
    ]));
  const catSec = h('section', { class: 'section container section--tight' }, [
    h('div', { class: 'home-head' }, [
      h('div', {}, [h('div', { class: 'eyebrow' }, 'INDEX'), h('h2', { class: 'serif' }, '作品分类')]),
      h('a', { class: 'link', href: '#/works' }, ['进入作品库', h('span', { class: 'arrow' }, '→')]),
    ]),
    h('div', { class: 'catindex' }, catIndex),
  ]);

  // —— 关于预告（暖白，纯文字 + 数据；P0-3：姓名/拼音/简介/教育数全部读 aboutRepo，绝不硬编码） ——
  const fullName = (about && about.fullName) || '邱钰真';
  const pinyin = (about && about.pinyin) || 'QIU YUZHEN';
  const bio = (about && about.bio) || '插画与漫画创作者。本科毕业于中国传媒大学南广学院漫画与插画专业，后于日本代代木动画学院进修漫画。';
  const eduCount = (about && about.education && about.education.length) || 2;
  const comicCount = comics.length;
  const certCount = certs.length;
  const aboutSec = h('section', { class: 'section container section--tight' }, [
    h('div', { class: 'intro-teaser' }, [
      h('div', {}, [
        h('div', { class: 'eyebrow' }, 'ABOUT'),
        // P0-2-B：中文姓名（宋体字标，已冻结方向）+ 大写拼音（加括号、更小一级，同排）
        h('div', { class: 'intro-teaser__name-row' }, [
          h('h2', { class: 'serif' }, fullName),
          h('span', { class: 'intro-teaser__pinyin' }, `(${pinyin})`),
        ]),
        h('p', { class: 'lead' }, bio),
        h('div', { style: { marginTop: '24px' } }, h('a', { class: 'link', href: '#/about' }, ['阅读完整简历', h('span', { class: 'arrow' }, '→')])),
      ]),
      h('div', { class: 'intro-teaser__stats' }, [
        h('div', {}, [h('div', { class: 'intro-teaser__num serif' }, String(eduCount)), h('div', { class: 'intro-teaser__label' }, '所院校学习经历')]),
        h('div', {}, [h('div', { class: 'intro-teaser__num serif' }, String(comicCount)), h('div', { class: 'intro-teaser__label' }, '部漫画作品')]),
        h('div', {}, [h('div', { class: 'intro-teaser__num serif' }, String(certCount)), h('div', { class: 'intro-teaser__label' }, '份证书')]),
      ]),
    ]),
  ]);

  return h('div', {}, [hero, topicA, topicB, topicC, catSec, aboutSec].filter(Boolean));
}

// 标题可能带《》包裹，生成 alt 时去掉书名号更自然
function yoyigiTitle(w) {
  return (w.title || '').replace(/[《》]/g, '');
}
