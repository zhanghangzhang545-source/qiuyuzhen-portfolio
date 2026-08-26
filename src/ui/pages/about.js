// ============================================================
// about.js — 个人介绍 / 编辑式履历页（邱钰真 真实简历 V4）
//  · 桌面：左 28% 章节索引（巨大 01–05 编号）+ 右 72% 内容
//  · Education / Experience 纵向时间线（巨大年份）；Skills 横向；Honors 要点 + 证书胶片式横排
//  · 手机：单列，左编号栏隐藏
// ============================================================
import { h } from '../../core/dom.js';
import { repo, aboutRepo } from '../../data/services.js';
import { imgEl } from '../components/media.js';

// 响应式 sizes（按真实展示宽度；P0 性能专项加入，视觉/版式不变）
const SZ = {
  certPortrait: '(max-width: 600px) 92vw, (max-width: 1024px) 31vw, 330px',
  certLandscape: '(max-width: 600px) 92vw, (max-width: 1024px) 46vw, 560px',
  lightbox: '(max-width: 600px) 92vw, 800px',
};

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

/** 轻量灯箱：点击证书放大查看（P1-2：支持 Esc 关闭 + 关闭按钮 aria-label） */
function openLightbox(src, alt) {
  const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Esc') close(); };
  const overlay = h('div', { class: 'modal-overlay', on: { click: (e) => { if (e.target === overlay) close(); } } },
    h('div', { class: 'lightbox', onclick: (e) => e.stopPropagation() }, [
      imgEl(src, null, alt, { w: 800, h: 1100, sizes: SZ.lightbox }),
      h('button', { class: 'lightbox__close', type: 'button', 'aria-label': '关闭', on: { click: () => close() } }, '×'),
    ]));
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
}

export async function aboutView() {
  // C1 真实读取 About：从 aboutRepo 取数据（Mock / Supabase 自动切换），
  // DOM / CSS 结构完全不变，仅数据源由硬编码改为仓储读取。
  const A = await aboutRepo.read();
  const EDU = A.education;
  const EXP = A.experience;
  const SKILLS = A.skills;
  const DIRECTIONS = A.directions;
  const HONORS = A.honors;
  const CONTACT = A.contacts;
  const NEUTRAL_BIO = A.bio || '以插画与漫画为主要创作方向，关注角色、叙事与氛围表达。';

  const all = await repo.filter({ publicOnly: true });
  // 证书展示逻辑：仅展示「关于」荣誉区，且受 public 控制（public:false 的证书不在 About 出现）。
  // 证书不进入 Works 是由类型（栏目规则）决定，与其 public 无关。
  const certs = all.filter((w) => w.type === 'certificate' && w.public !== false);
  const comics = all.filter((w) => w.type === 'comic');
  const illustrations = all.filter((w) => w.type === 'illustration');
  const oils = all.filter((w) => w.type === 'oil');

  // 证书展示（客户反馈 B：奖状尽量全部附上，按版式展示）：
  //   全部保持原始比例、不裁切、不拉伸；点击可放大查看。仅展示真实收到的证书，不虚构缺失素材。
  //   c01 证书原图横拍，已生成正确朝向衍生图（c01_rot.jpg），正文正常阅读、完整不裁切。
  // —— 客户明确：桌面 / 手机第一眼看到的「第一张图片」必须是横向 c01_rot，不得仅靠分组自然排序。
  //    因此显式把 c01_rot 抽出排在第一位，其余证书按真实比例自然排列（竖并排 / 横宽展）。
  const CERT_FIRST_ID = 'cert-cert01'; // 对应 assets.gen.js cert01 → seed.js 拼接为 cert-cert01
  const firstCert = certs.find((c) => c.id === CERT_FIRST_ID) || null;
  const restCerts = certs.filter((c) => c.id !== CERT_FIRST_ID);

  const certItem = (c, sizes, solo = false) => h('button', { class: `cv-cert${solo ? ' cv-cert--solo' : ''}`, type: 'button', on: { click: () => openLightbox(c.cover, c.title) } }, [
    h('div', { class: 'cv-cert__media' }, imgEl(c.cover, null, c.title, { w: c.coverW, h: c.coverH, sizes })),
    h('div', { class: 'cv-cert__title' }, c.title),
  ]);

  // 显式首位：c01_rot 永远第一；其余证书按真实比例自然排列（横宽展 / 竖并排）。
  // rest 末尾若为奇数落单（当前 5 张→末张单独成行），标记 solo：整行居中、限宽半列，避免右半列大空洞。
  const restIsOdd = restCerts.length % 2 === 1;
  const certLayout = certs.length
    ? h('div', { class: 'cv-cert-layout' }, [
        firstCert ? h('div', { class: 'cv-cert-row cv-cert-row--first' }, [certItem(firstCert, SZ.certLandscape)]) : null,
        restCerts.length ? h('div', { class: 'cv-cert-row cv-cert-row--rest' }, restCerts.map((c, i) =>
          certItem(c, (c.coverW || 0) < (c.coverH || 0) ? SZ.certPortrait : SZ.certLandscape, restIsOdd && i === restCerts.length - 1))) : null,
      ].filter(Boolean))
    : null;

  return h('div', { class: 'container about-wrap' }, [
    h('section', { class: 'about' }, [
      h('div', { class: 'about__head' }, [
        h('div', { class: 'eyebrow' }, '个人介绍 · ABOUT'),
        h('h1', { class: 'about__name' }, A.fullName || '邱钰真'),
        h('div', { class: 'about__role' }, `${A.pinyin || 'QIU YU ZHEN'} · 插画 / 漫画 / 油画`),
        h('p', { class: 'about__lead' }, `${NEUTRAL_BIO} 创作涵盖插画、漫画与油画。`),
      ]),
      h('div', { class: 'about__stats' }, [
        h('div', {}, [h('div', { class: 'about__stat-num' }, String(EDU.length)), h('div', { class: 'about__stat-label' }, '所院校学习经历')]),
        h('div', {}, [h('div', { class: 'about__stat-num' }, String(comics.length)), h('div', { class: 'about__stat-label' }, '部漫画作品')]),
        h('div', {}, [h('div', { class: 'about__stat-num' }, String(illustrations.length + oils.length)), h('div', { class: 'about__stat-label' }, '件插画与油画')]),
        h('div', {}, [h('div', { class: 'about__stat-num' }, String(certs.length)), h('div', { class: 'about__stat-label' }, '份荣誉证书')]),
      ]),
      h('div', { class: 'about__body' }, [
        h('aside', { class: 'about__rail' }, RAIL.map((r) => railLink(r.num, r.title, r.id))),
        h('div', { class: 'about__content' }, [
          section('sec-intro', '01', 'INTRO', h('div', {}, [
            h('p', { class: 'serif-lead' }, '插画与漫画创作者'),
            // P0-4：INTRO 个人简介读取真实 About 数据（A.bio），后台改 bio 后此处同步更新；教育经历由 EDU 数据驱动（下方 sec-edu）。
            h('p', { class: 'secondary', style: { marginTop: 'var(--s4)', lineHeight: '1.8' } }, A.bio || NEUTRAL_BIO),
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
            A.honorParagraph && A.honorParagraph.length
              ? h('p', { class: 'secondary', style: { margin: 'var(--s4) 0 var(--s5)' } }, A.honorParagraph)
              : null,
            h('p', { class: 'secondary', style: { marginBottom: 'var(--s3)' } }, '以下为已附证书（全部展示，图片完整显示，不裁切；点击可放大查看）：'),
            certLayout,
          ])),
        ]),
      ]),
    ]),
  ]);
}
