// ============================================================
// about.js — 个人介绍 / 编辑式履历页（邱钰真 真实简历 V4）
//  · 桌面：左 28% 章节索引（巨大 01–05 编号）+ 右 72% 内容
//  · Education / Experience 纵向时间线（巨大年份）；Skills 横向；Honors 要点 + 证书胶片式横排
//  · 手机：单列，左编号栏隐藏
// ============================================================
import { h } from '../../core/dom.js';
import { repo } from '../../data/services.js';
import { imgEl } from '../components/media.js';

const NEUTRAL_BIO = '以插画与漫画为主要创作方向，关注角色、叙事与氛围表达。';

// 响应式 sizes（按真实展示宽度；P0 性能专项加入，视觉/版式不变）
const SZ = {
  certMain: '(max-width: 600px) 92vw, (max-width: 1024px) 46vw, 560px',
  certAux: '(max-width: 600px) 30vw, (max-width: 1024px) 31vw, 330px',
  lightbox: '(max-width: 600px) 92vw, 800px',
};

const EDU = [
  { yr: '2017.9 – 2021.7', h: '中国传媒大学南广学院 · 漫画与插画｜本科', p: '本科阶段主修漫画叙事与插画创作，毕业设计为 42 页漫画。' },
  { yr: '2024.4 – 2026.3', h: '日本代代木动画学院（代々木アニメーション学院）· 漫画（进修）｜专门学校', p: '漫画专业进修；毕业制作（2026 年 2 月）共 27 页。' },
];

const EXP = [
  { yr: '2026', h: '代代木动画学院 毕业制作', p: '27 页漫画毕业设计（日本 · 代代木动画学院）。' },
  { yr: '2024', h: 'CP30 同人志《舞机》', p: '13 页同人志创作（Fan Work，不拥有原作 IP）。' },
  { yr: '2021', h: '大学毕业设计', p: '42 页漫画（中国传媒大学南广学院）。' },
  { yr: '2020', h: '24小时国际漫画马拉松', p: '8 页参赛漫画，获三等奖。' },
  { yr: '2020', h: '大学漫画课程作业', p: '正文 20 页，另含封面与封底。' },
  { yr: '2018.7 – 2018.9', h: '上海观池文化传播有限公司｜漫画助理', p: '' },
];

const SKILLS = ['CLIP STUDIO PAINT（CSP）', 'SAI', 'Photoshop', '日语 JLPT N2'];
const DIRECTIONS = ['插画创作', '漫画创作', '油画'];

// 05 重点荣誉（职业相关，依据真实证书；仅列重点）
const HONORS = [
  { y: '2025', t: '米画师平台 商业插画师认证' },
  { y: '2024', t: 'JCLI 优秀赏' },
  { y: '2020', t: '第四届吉林动画学院 24小时国际漫画马拉松 三等奖' },
  { y: '2018', t: '学院作品永久收藏' },
  { y: '2014', t: '全国少年儿童绘画绘本创作大赛 中学绘本组 三等奖' },
  { y: '2013', t: '四川省中小学生优秀艺术人才大赛（资阳赛区）美术专业初中组 一等奖' },
];

const CONTACT = [{ k: '邮箱', v: '2219528116@qq.com' }];

const RAIL = [
  { num: '01', title: 'INTRO', id: 'sec-intro' },
  { num: '02', title: 'EDUCATION', id: 'sec-edu' },
  { num: '03', title: 'EXPERIENCE', id: 'sec-exp' },
  { num: '04', title: 'SKILLS', id: 'sec-skills' },
  { num: '05', title: 'HONORS', id: 'sec-honors' },
];

function section(id, num, title, body) {
  return h('section', { class: 'about__sec', id }, [
    h('div', { class: 'about__sec-head' }, [h('span', { class: 'about__sec-num' }, num), h('span', { class: 'about__sec-title' }, title)]),
    body,
  ]);
}
function cvItem(yr, head, p) {
  return h('div', { class: 'cv-item' }, [
    h('div', { class: 'cv-item__yr' }, yr),
    h('div', { class: 'cv-item__body' }, [h('h4', {}, head), p ? h('p', {}, p) : null]),
  ]);
}
function railLink(num, title, targetId) {
  return h('button', {
    class: 'about__rail-link', type: 'button',
    on: { click: () => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
  }, [h('span', { class: 'about__rail-num' }, num), h('span', { class: 'about__rail-title' }, title)]);
}

/** 轻量灯箱：点击证书放大查看 */
function openLightbox(src, alt) {
  const overlay = h('div', { class: 'modal-overlay', on: { click: (e) => { if (e.target === overlay) overlay.remove(); } } },
    h('div', { class: 'lightbox', onclick: (e) => e.stopPropagation() }, [
      imgEl(src, null, alt, { w: 800, h: 1100, sizes: SZ.lightbox }),
      h('button', { class: 'lightbox__close', on: { click: () => overlay.remove() } }, '×'),
    ]));
  document.body.appendChild(overlay);
}

export async function aboutView() {
  const all = await repo.filter({ publicOnly: true });
  // 证书展示逻辑：仅展示「关于」荣誉区，且受 public 控制（public:false 的证书不在 About 出现）。
  // 证书不进入 Works 是由类型（栏目规则）决定，与其 public 无关。
  const certs = all.filter((w) => w.type === 'certificate' && w.public !== false);
  const comics = all.filter((w) => w.type === 'comic');
  const illustrations = all.filter((w) => w.type === 'illustration');
  const oils = all.filter((w) => w.type === 'oil');

  // 证书：1 张主证书（最大、最具职业价值）+ 3 张辅助证书（有主次构图，不散落于大空白）；其余以文字记录
  const MAIN_CERT = 'cert-cert01'; // 一等奖，最具代表性
  const AUX_CERTS = ['cert-cert03', 'cert-cert06', 'cert-cert07'];
  const mainCert = certs.find((c) => c.id === MAIN_CERT) || null;
  const auxCerts = AUX_CERTS.map((id) => certs.find((c) => c.id === id)).filter(Boolean);
  const restCerts = certs.filter((c) => c.id !== MAIN_CERT && !AUX_CERTS.includes(c.id));
  const certLayout = (mainCert || auxCerts.length)
    ? h('div', { class: 'cv-cert-layout' }, [
        mainCert ? h('div', { class: 'cv-cert-main' }, [
          h('button', { class: 'cv-cert', type: 'button', on: { click: () => openLightbox(mainCert.cover, mainCert.title) } }, [
            h('div', { class: 'cv-cert__media' }, imgEl(mainCert.cover, null, mainCert.title, { w: mainCert.coverW, h: mainCert.coverH, sizes: SZ.certMain })),
            h('div', { class: 'cv-cert__title' }, mainCert.title),
          ]),
        ]) : null,
        auxCerts.length ? h('div', { class: 'cv-cert-aux' }, auxCerts.map((c) =>
          h('button', { class: 'cv-cert', type: 'button', on: { click: () => openLightbox(c.cover, c.title) } }, [
            h('div', { class: 'cv-cert__media' }, imgEl(c.cover, null, c.title, { w: c.coverW, h: c.coverH, sizes: SZ.certAux })),
            h('div', { class: 'cv-cert__title' }, c.title),
          ]))) : null,
      ])
    : null;
  const restCertText = restCerts.length
    ? h('div', { class: 'cv-cert-text' }, restCerts.map((c) =>
        h('div', { class: 'cv-cert-text__row' }, [h('span', { class: 'cv-cert-text__t' }, c.title)])))
    : null;

  return h('div', { class: 'container about-wrap' }, [
    h('section', { class: 'about' }, [
      h('div', { class: 'about__head' }, [
        h('div', { class: 'eyebrow' }, '个人介绍 · ABOUT'),
        h('h1', { class: 'about__name' }, '邱钰真'),
        h('div', { class: 'about__role' }, 'QIU YUZHEN · 插画 / 漫画 / 油画'),
        h('p', { class: 'about__lead' }, `${NEUTRAL_BIO} 创作涵盖插画、漫画与油画。`),
      ]),
      h('div', { class: 'about__stats' }, [
        h('div', {}, [h('div', { class: 'about__stat-num' }, String(EDU.length)), h('div', { class: 'about__stat-label' }, '所院校学习经历')]),
        h('div', {}, [h('div', { class: 'about__stat-num' }, String(comics.length)), h('div', { class: 'about__stat-label' }, '部漫画作品')]),
        h('div', {}, [h('div', { class: 'about__stat-num' }, String(illustrations.length + oils.length)), h('div', { class: 'about__stat-label' }, '件插画与油画')]),
        h('div', {}, [h('div', { class: 'about__stat-num' }, String(certs.length)), h('div', { class: 'about__stat-label' }, '份精选证书')]),
      ]),
      h('div', { class: 'about__body' }, [
        h('aside', { class: 'about__rail' }, RAIL.map((r) => railLink(r.num, r.title, r.id))),
        h('div', { class: 'about__content' }, [
          section('sec-intro', '01', 'INTRO', h('div', {}, [
            h('p', { class: 'serif-lead' }, '插画与漫画创作者'),
            h('p', { class: 'secondary', style: { marginTop: 'var(--s4)', lineHeight: '1.8' } }, '本科毕业于中国传媒大学南广学院漫画与插画专业，后于日本代代木动画学院进修漫画。创作涵盖插画、漫画与油画，持续探索角色、叙事与氛围表达。'),
            h('div', { class: 'about__contact', style: { marginTop: 'var(--s5)' } }, CONTACT.map((c) =>
              h('div', { class: 'about__contact-row' }, [h('span', { class: 'k' }, c.k), h('span', {}, c.v)]))),
          ])),
          section('sec-edu', '02', 'EDUCATION', h('div', {}, EDU.map((e) => cvItem(e.yr, e.h, e.p)))),
          section('sec-exp', '03', 'EXPERIENCE', h('div', {}, EXP.map((p) => cvItem(p.yr, p.h, p.p)))),
          section('sec-skills', '04', 'SKILLS', h('div', {}, [
            h('div', { class: 'skill-list', style: { marginBottom: 'var(--s5)' } }, SKILLS.map((s) => h('span', { class: 'tag' }, s))),
            h('ul', { class: 'direction-list' }, DIRECTIONS.map((d) => h('li', {}, d))),
          ])),
          section('sec-honors', '05', 'HONORS', h('div', {}, [
            h('div', {}, HONORS.map((a) => h('div', { class: 'cv-honor' }, [
              h('span', { class: 'cv-honor__yr' }, a.y), h('span', { class: 'cv-honor__t' }, a.t),
            ]))),
            h('p', { class: 'secondary', style: { margin: 'var(--s4) 0 var(--s5)' } }, '2004年至2011年，连续8届获得当地“青少年艺术表演大赛”美术项目金奖。'),
            h('p', { class: 'secondary', style: { marginBottom: 'var(--s3)' } }, '以下为部分已附证书（图片完整显示，不裁切；点击可放大查看）：'),
            certLayout,
            restCertText
              ? h('p', { class: 'secondary cv-cert-text__note' }, ['其余荣誉（文字记录）：', restCerts.map((c, i) => h('span', {}, [c.title, i < restCerts.length - 1 ? '；' : '。'])).flat()])
              : null,
          ])),
        ]),
      ]),
    ]),
  ]);
}
