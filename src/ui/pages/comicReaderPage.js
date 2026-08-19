// ============================================================
// comicReaderPage.js — 漫画详情 / 阅读页
//  第一屏：作品标题 + 封面；向下：纵向连续阅读（手机端连续滚动）
// ============================================================
import { h } from '../../core/dom.js';
import { repo } from '../../data/services.js';
import { renderComicReader } from '../components/comicReader.js';
import { imgEl } from '../components/media.js';
import { emptyState, catTag } from '../components/primitives.js';
import { natureSub } from '../components/label.js';

// 漫画详情封面：展示宽 ≤440px；P0 性能专项加入 sizes，视觉不变
const SZ_COVER = '(max-width: 600px) 92vw, 440px';

export async function comicReaderView(params, query) {
  const work = await repo.getById(params.id);
  if (!work || work.type !== 'comic') {
    return h('div', { class: 'container section' }, emptyState('漫画不存在', '可能已被移除。', h('a', { class: 'btn', href: '#/works/comic' }, '返回漫画')));
  }
  // 隐藏漫画（public:false）不能通过直接 URL 访问
  if (work.public === false) {
    return h('div', { class: 'container section' }, emptyState('漫画未公开', '该漫画当前未公开，暂不可访问。', h('a', { class: 'btn', href: '#/works/comic' }, '返回漫画')));
  }

  const hero = h('div', { class: 'comic-hero' }, [
    h('div', { class: 'comic-hero__meta' }, [
      h('div', { class: 'eyebrow' }, '漫画 · 连续阅读'),
      h('h1', { class: 'comic-hero__title' }, work.title),
      h('p', { class: 'comic-hero__intro' }, work.intro),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
        catTag('comic'),
        h('span', { class: 'comic-tag' }, natureSub(work)),
        h('span', { class: 'tag' }, `${work.year ? work.year + ' · ' : ''}${work.stage || ''}`),
        h('span', { class: 'tag tag--accent' }, `共 ${work.pages.length} 页`),
      ]),
    ]),
    h('div', { class: 'comic-hero__media' }, imgEl(work.cover, null, work.title, { eager: true, w: work.coverW, h: work.coverH, sizes: SZ_COVER })),
  ]);

  return h('div', { class: 'container section' }, [
    h('div', { style: { paddingBottom: '16px' } }, h('a', { class: 'btn btn--ghost btn--sm', href: '#/works/comic' }, '← 返回漫画列表')),
    hero,
    h('div', { class: 'comic-divider' }, '开始阅读'),
    renderComicReader(work),
  ]);
}
