// ============================================================
// workCard.js — 作品卡片（无框、作品为绝对主角）
//  · 图片按素材自然比例呈现，不裁剪到统一尺寸（横图横跨、竖图单列）
//  · 图说常驻于图下（如美术馆展签：标题 + 年份·分类），不靠 hover 遮罩
//  · 在作品库网格中按真实比例赋予列宽；在精选杂志编排中可传 noSize 走自然流
// ============================================================
import { h } from '../../core/dom.js';
import { imgEl } from './media.js';
import { typeName } from '../../data/types.js';
import { workLabel, natureSub } from './label.js';

const EN = { illustration: 'ILLUSTRATION', comic: 'COMIC', oil: 'OIL PAINTING', certificate: 'CERTIFICATE' };

function aspectOf(work) {
  if (work.coverW && work.coverH) return work.coverW / work.coverH;
  const ratio = (work.cover && work.cover.ratio) || '4/5';
  const [w, ht] = String(ratio).split('/').map(Number);
  return w / ht;
}

/** 根据素材比例与精选标记，给出列宽 class（用于作品库网格） */
export function cardSizeClass(work) {
  const r = aspectOf(work);
  let cls = 'work-card--tall';
  if (r >= 1.4) cls = 'work-card--wide';
  else if (r <= 0.86) cls = 'work-card--tall';
  else cls = 'work-card--sq';
  if (work.featured && cls !== 'work-card--tall') cls = `work-card--feature ${cls}`;
  return cls;
}

/**
 * 作品卡片
 * @param {Work} work
 * @param {number} [i]
 * @param {{sizeClass?:string, noSize?:boolean, noReveal?:boolean, eager?:boolean, sizes?:string}} [opts]
 */
export function workCard(work, i = 0, opts = {}) {
  const href = work.type === 'comic' ? `#/comic/${work.id}` : `#/work/${work.id}`;
  const media = h('div', { class: 'work-card__media' }, imgEl(work.cover, null, work.title, { w: work.coverW, h: work.coverH, eager: opts.eager, sizes: opts.sizes }));
  if (work.type === 'comic') media.appendChild(h('span', { class: 'work-card__badge tag tag--cat', style: { '--dot': 'var(--cat-comic)' } }, '漫画'));
  if (work.featured) media.appendChild(h('span', { class: 'work-card__featured tag tag--featured' }, '精选'));

  // 图说：普通 Archive 作品使用 Compact 两级系统（仅 标题 + 类目，无编号/细线/ORIGINAL WORK/VIEW PROJECT）
  const cap = workLabel({ en: EN[work.type] || typeName(work.type), title: work.title, sub: natureSub(work), compact: true });

  const sizeCls = opts.noSize ? '' : (opts.sizeClass || cardSizeClass(work));
  const cls = ['work-card', sizeCls].filter(Boolean).join(' ');
  return h('a', { class: cls, href }, [media, cap]);
}
