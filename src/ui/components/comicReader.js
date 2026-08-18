// ============================================================
// comicReader.js — 漫画阅读器组件
// 真正的连续纵向阅读：所有漫画页按 order 一次性顺序渲染，
// 页间距统一 16px，向下滚动即可完整阅读。
// 不含任何「上一页 / 下一页」或「第 X / X 页」分页逻辑；
// 末页之后提供「返回漫画列表」入口，任何导航都不覆盖原作。
// ============================================================
import { h } from '../../core/dom.js';
import { imgEl } from './media.js';

export function renderComicReader(work) {
  const pages = (work.pages || []).slice().sort((a, b) => a.order - b.order);

  const pageNodes = pages.map((p) =>
    h('div', { class: 'reader__page' }, [
      imgEl(p.image, null, `${work.title} 第 ${p.order} 页`, { w: p.w, h: p.h }),
      h('span', { class: 'reader__pageno' }, `P. ${String(p.order).padStart(2, '0')}`),
    ]));

  const backToList = h('div', { class: 'reader__end' },
    h('a', { class: 'btn btn--ghost btn--sm', href: '#/works/comic' }, '← 返回漫画列表'));

  return h('div', { class: 'reader' }, [...pageNodes, backToList]);
}
