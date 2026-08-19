// ============================================================
// workDetail.js — 作品详情（插画 / 油画 / 证书）
// 首屏大图优先，文字信息后置；多图形成自然图文节奏。
// 漫画类型自动跳转到阅读器。
// ============================================================
import { h } from '../../core/dom.js';
import { repo } from '../../data/services.js';
import { imgEl } from '../components/media.js';
import { emptyState } from '../components/primitives.js';
import { typeName } from '../../data/types.js';
import { natureSub } from '../components/label.js';

// 详情页：主封面展示宽 ~1180 / 多图 ~760；P0 性能专项加入 sizes，视觉不变
const SZ_DETAIL = '(max-width: 600px) 92vw, 1180px';
const SZ_SHOT = '(max-width: 600px) 92vw, 760px';

// 与全站展签 / 出版物语言一致（不虚构：类目与 ORIGINAL 标记均来自真实字段）
const EN = { illustration: 'ILLUSTRATION', comic: 'COMIC', oil: 'OIL PAINTING', certificate: 'CERTIFICATE' };

function metaRow(k, v) { return h('div', {}, [h('span', {}, k), h('span', {}, v)]); }

export async function workDetailView(params) {
  const notFound = (title, sub) => h('div', { class: 'container section' }, emptyState(title, sub, h('a', { class: 'btn', href: '#/works' }, '返回作品库')));
  const work = await repo.getById(params.id);
  if (!work) return notFound('作品不存在', '可能已被移除或链接有误。');
  // 隐藏作品（public:false）不能通过直接 URL 访问
  if (work.public === false) return notFound('作品未公开', '该作品当前未公开，暂不可访问。');
  if (work.type === 'comic') { location.hash = `#/comic/${work.id}`; return h('div', {}); }

  // 首屏：大尺寸封面（作品为绝对主角）
  // 首屏主封面属于首视口核心内容，eager + high priority
  const cover = h('div', { class: 'detail__cover' }, imgEl(work.cover, null, work.title, { eager: true, w: work.coverW, h: work.coverH, sizes: SZ_DETAIL }));

  // 文字信息后置（无值时整行不渲染，杜绝 '—' 占位与空行）
  const metaRows = [];
  const addMeta = (k, v) => { if (v != null && String(v).trim() !== '') metaRows.push(metaRow(k, v)); };
  addMeta('类型', typeName(work.type));
  addMeta('创作年份', work.year ? String(work.year) : '');
  addMeta('创作阶段', work.stage || '');
  if (work.type === 'certificate') {
    addMeta('颁发机构', work.issuer || '');
    addMeta('获得日期', work.certDate || '');
  }
  const meta = metaRows.length ? h('div', { class: 'detail__meta' }, metaRows) : null;
  // tags 为空时不生成空的 .detail__tags DOM
  const tags = (work.tags && work.tags.length)
    ? h('div', { class: 'detail__tags' }, (work.tags || []).map((t) => h('span', { class: 'tag' }, t)))
    : null;
  const en = EN[work.type] || typeName(work.type).toUpperCase();
  const info = h('div', { class: 'detail__info' }, [
    h('div', { class: 'detail__kicker' }, [
      h('span', { class: 'detail__kicker-cat' }, en),
      h('span', { class: 'detail__kicker-rule' }),
      h('span', { class: 'detail__kicker-sub' }, natureSub(work)),
    ]),
    h('h1', { class: 'detail__title' }, work.title),
    meta,
    work.intro ? h('p', { class: 'detail__intro' }, work.intro) : null,
    tags,
  ]);

  // 多图：仅渲染「封面之外」的额外图片，杜绝单图作品把同一张图展示两遍（封面已单独展示）
  // 每张加出版物式 FIG 编号图注（来自真实顺序，不虚构）
  const seriesImgs = (work.images || []).filter(Boolean).filter((v) => v !== work.cover);
  const series = seriesImgs.length
    ? h('div', { class: 'detail__series' },
        seriesImgs.map((v, i) => h('div', { class: 'detail__shot' }, [
          imgEl(v, null, `${work.title} 图 ${i + 2}`, { w: work.coverW, h: work.coverH, sizes: SZ_SHOT }),
          h('span', { class: 'detail__shot-cap' }, `FIG. ${String(i + 2).padStart(2, '0')}`),
        ])))
    : null;

  return h('div', { class: 'container' }, [
    h('div', { class: 'detail__top' }, h('a', { class: 'btn btn--ghost btn--sm', href: '#/works' }, '← 返回作品库')),
    h('div', { class: 'detail' }, [cover, info, series].filter(Boolean)),
  ]);
}
