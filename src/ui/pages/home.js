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
import { repo } from '../../data/services.js';
import { imgEl } from '../components/media.js';
import { workLabel, natureSub } from '../components/label.js';
import { emptyState } from '../components/primitives.js';
import { WORK_TYPES, typeName } from '../../data/types.js';

const NEUTRAL_BIO = '以插画与漫画为主要创作方向，关注角色、叙事与氛围表达。';
const byId = (arr, id) => arr.find((w) => w.id === id) || null;

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
  const [all, featured, certs] = await Promise.all([
    repo.filter({ publicOnly: true }).then((ws) => ws.filter((w) => w.type !== 'certificate')),
    repo.filter({ featured: true, publicOnly: true }),
    // 证书单独从「公开完整数据」统计，避免被上面排除 certificate 的 all 影响导致数量为 0
    repo.filter({ publicOnly: true, type: 'certificate' }),
  ]);

  // 主视觉固定用《旅途》（i09）
  const heroArt = byId(all, 'i09') || featured.find((w) => w.type === 'illustration') || featured[0] || all[0];

  const counts = {};
  all.forEach((w) => (counts[w.type] = (counts[w.type] || 0) + 1));
  const comics = all.filter((w) => w.type === 'comic').sort((a, b) => (a.year || 0) - (b.year || 0));
  const yoyogi = byId(comics, 'comic-yoyogi2026');

  // 三大专题所需作品
  const i01 = byId(featured, 'i01');      // 接雨草树林2.0ver
  const i12 = byId(featured, 'i12');      // 梦里的风景
  const i10 = byId(all, 'i10');           // 无可磨灭的存在
  const i13 = byId(featured, 'i13');      // 献上战舞
  const oil1 = byId(featured, 'oil1');    // 拐弯处的光
  const oil2 = byId(all, 'oil2');         // 湖中的影

  // —— 第一屏：深色，《旅途》为视觉底层（方向保留） ——
  const hero = h('section', { class: 'hero' }, [
    h('div', { class: 'hero__media' }, imgEl(heroArt.cover, 'hero__img', heroArt.title, { eager: true, w: heroArt.coverW, h: heroArt.coverH })),
    h('div', { class: 'hero__scrim' }),
    h('div', { class: 'container hero__inner' }, [
      h('div', { class: 'hero__copy' }, [
        h('div', { class: 'hero__kicker' }, [
          h('span', {}, 'Illustration & Comic'),
        ]),
        h('h1', { class: 'hero__name' }, [h('span', {}, 'QIU'), h('span', {}, 'YUZHEN')]),
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
  const aBanner = (i01 && h('a', { class: 'feat-link', href: '#/work/i01' }, [
    imgEl(i01.cover, 'feat-img', i01.title, { w: i01.coverW, h: i01.coverH }),
    workLabel({ num: '01', en: 'ILLUSTRATION', title: i01.title, sub: 'ORIGINAL WORK' }),
  ])) || null;

  const aPair = (i12 && i10 && h('div', { class: 'feat-portrait' }, [
    h('div', { class: 'feat-portrait__pair' }, [
      h('a', { class: 'feat-link', href: '#/work/i12' }, [
        imgEl(i12.cover, 'feat-img', i12.title, { w: i12.coverW, h: i12.coverH }),
        workLabel({ num: '02', en: 'ILLUSTRATION', title: i12.title, sub: 'ORIGINAL WORK' }),
      ]),
      h('a', { class: 'feat-link', href: '#/work/i10' }, [
        imgEl(i10.cover, 'feat-img', i10.title, { w: i10.coverW, h: i10.coverH }),
        workLabel({ num: '03', en: 'ILLUSTRATION', title: i10.title, sub: 'ORIGINAL WORK' }),
      ]),
    ]),
  ])) || null;

  const topicA = h('section', { class: 'section--tight container', id: 'selected' }, [
    topicHead('01', 'ILLUSTRATION', '插画专题'),
    h('div', { class: 'feature' }, [aBanner, aPair].filter(Boolean)),
  ]);

  // —— 专题 B：核心漫画专题（2026 代代木毕业设计：封面 + 3 张真实内页 + 27P 项目说明） ——
  const topicB = (yoyogi && h('section', { class: 'section--dark section--tight' }, [
    h('div', { class: 'container' }, [
      topicHead('02', 'FEATURE COMIC', '核心漫画'),
      h('div', { class: 'comics__feature' }, [
        h('a', { class: 'comics__cover feat-link', href: `#/comic/${yoyogi.id}` },
          imgEl(yoyogi.cover, null, yoyogi.title, { w: yoyogi.coverW, h: yoyogi.coverH })),
        h('div', { class: 'comics__feature-body' }, [
          h('div', { class: 'comics__feature-meta' }, [
            h('span', { class: 'comics__feature-proj' }, '代代木动画学院 毕业作品'),
            workLabel({ num: '01', en: 'COMIC', title: yoyogi.title, sub: `${yoyogi.year} · ${natureSub(yoyogi)}` }),
            h('a', { class: 'link link--light', href: `#/comic/${yoyogi.id}` }, ['开始阅读', h('span', { class: 'arrow' }, '→')]),
          ]),
          h('div', { class: 'comics__pages' },
            yoyogi.pages.slice(0, 3).map((p) => imgEl(p.image, null, `${yoyogi.title} 内页`, { w: p.w, h: p.h }))),
        ]),
      ]),
    ]),
  ])) || null;

  // —— 专题 C：综合创作专题（献上战舞 + 两幅油画） ——
  const composite = h('div', { class: 'composite' }, [
    i13 ? h('a', { class: 'composite__main feat-link', href: '#/work/i13' }, [
      imgEl(i13.cover, 'feat-img', i13.title, { w: i13.coverW, h: i13.coverH }),
      workLabel({ num: '04', en: 'ILLUSTRATION', title: i13.title, sub: 'ORIGINAL WORK' }),
    ]) : null,
    h('div', { class: 'composite__oils' }, [
      (oil1 && h('a', { class: 'composite__oil feat-link', href: '#/work/oil1' }, [
        imgEl(oil1.cover, 'feat-img', oil1.title, { w: oil1.coverW, h: oil1.coverH }),
        workLabel({ num: '01', en: 'OIL PAINTING', title: oil1.title, sub: 'ORIGINAL WORK' }),
      ])) || null,
      (oil2 && h('a', { class: 'composite__oil feat-link', href: '#/work/oil2' }, [
        imgEl(oil2.cover, 'feat-img', oil2.title, { w: oil2.coverW, h: oil2.coverH }),
        workLabel({ num: '02', en: 'OIL PAINTING', title: oil2.title, sub: 'ORIGINAL WORK' }),
      ])) || null,
    ].filter(Boolean)),
  ].filter(Boolean));

  const topicC = h('section', { class: 'section--tight container' }, [
    topicHead('03', 'OTHER WORKS', '综合创作'),
    composite,
  ]);

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

  // —— 关于预告（暖白，纯文字 + 数据） ——
  const eduCount = 2;
  const comicCount = comics.length;
  const certCount = certs.length;
  const aboutSec = h('section', { class: 'section container section--tight' }, [
    h('div', { class: 'intro-teaser' }, [
      h('div', {}, [
        h('div', { class: 'eyebrow' }, 'ABOUT'),
        h('h2', { class: 'serif' }, '邱钰真'),
        h('p', { class: 'lead' }, '插画与漫画创作者。本科毕业于中国传媒大学南广学院漫画与插画专业，后于日本代代木动画学院进修漫画。'),
        h('div', { style: { marginTop: '24px' } }, h('a', { class: 'link', href: '#/about' }, ['阅读完整简历', h('span', { class: 'arrow' }, '→')])),
      ]),
      h('div', { class: 'intro-teaser__stats' }, [
        h('div', {}, [h('div', { class: 'intro-teaser__num serif' }, String(eduCount)), h('div', { class: 'intro-teaser__label' }, '所院校学习经历')]),
        h('div', {}, [h('div', { class: 'intro-teaser__num serif' }, String(comicCount)), h('div', { class: 'intro-teaser__label' }, '部漫画作品')]),
        h('div', {}, [h('div', { class: 'intro-teaser__num serif' }, String(certCount)), h('div', { class: 'intro-teaser__label' }, '份精选证书')]),
      ]),
    ]),
  ]);

  return h('div', {}, [hero, topicA, topicB, topicC, catSec, aboutSec].filter(Boolean));
}

// 标题可能带《》包裹，生成 alt 时去掉书名号更自然
function yoyigiTitle(w) {
  return (w.title || '').replace(/[《》]/g, '');
}
