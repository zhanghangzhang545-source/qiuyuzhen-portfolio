// ============================================================
// filterBar.js — 作品检索与筛选栏
// 支持：作品类型 / 关键词 / 创作阶段 / 创作时间(年份) / 排序
// 任意变更回调 onChange(newQuery)，由列表页负责更新 URL 与重渲。
// ============================================================
import { h } from '../../core/dom.js';
import { WORK_TYPES, SORT_OPTIONS } from '../../data/types.js';

/**
 * 渲染筛选栏。
 * @param {object} query        当前查询（type/q/stage/year/sort）
 * @param {number[]} years      可选年份（由列表实际数据推导）
 * @param {string[]} stages     可选阶段（由列表实际数据推导，可扩展，不再硬编码）
 * @param {(q:object)=>void} onChange
 */
export function renderFilterBar(query, years, stages, onChange) {
  const state = {
    type: query.type || '',
    q: query.q || '',
    stage: query.stage || '',
    year: query.year || '',
    sort: query.sort || 'manual',
  };

  const emit = () => onChange({ ...state });

  // 类型标签
  const tabs = [{ id: '', name: '全部' }, ...WORK_TYPES];
  const tabEls = tabs.map((t) =>
    h('button', {
      class: state.type === t.id ? 'is-active' : '',
      on: { click: () => { state.type = t.id; syncTabs(); emit(); } },
    }, t.name));
  function syncTabs() { tabEls.forEach((el, i) => el.classList.toggle('is-active', state.type === tabs[i].id)); }

  // 搜索（防抖）
  let timer = null;
  const search = h('input', {
    type: 'search', placeholder: '搜索标题 / 关键词…', value: state.q,
    on: {
      input: (e) => { state.q = e.target.value; clearTimeout(timer); timer = setTimeout(emit, 220); },
    },
  });

  const stageSel = h('select', {
    on: { change: (e) => { state.stage = e.target.value; emit(); } },
  }, [h('option', { value: '' }, '全部阶段'), ...stages.map((s) => h('option', { value: s, selected: state.stage === s }, s))]);

  const yearSel = h('select', {
    on: { change: (e) => { state.year = e.target.value; emit(); } },
  }, [h('option', { value: '' }, '全部年份'), ...years.map((y) => h('option', { value: y, selected: String(state.year) === String(y) }, String(y)))]);

  const sortSel = h('select', {
    on: { change: (e) => { state.sort = e.target.value; emit(); } },
  }, SORT_OPTIONS.map((s) => h('option', { value: s.id, selected: state.sort === s.id }, s.name)));

  const reset = h('button', { class: 'btn btn--sm', on: { click: () => {
    Object.assign(state, { type: '', q: '', stage: '', year: '', sort: 'manual' });
    search.value = ''; stageSel.value = ''; yearSel.value = ''; sortSel.value = 'manual';
    syncTabs(); emit();
  } } }, '重置');

  // 手机端折叠按钮：默认收起高级筛选（关键词/阶段/时间/排序/重置），点击展开；桌面不显示
  const toggle = h('button', {
    class: 'filter-toggle', type: 'button', 'aria-expanded': 'false',
    on: { click: (e) => {
      const bar = e.currentTarget.closest('.filter-bar');
      const open = bar.classList.toggle('is-open');
      e.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false');
    } },
  }, ['筛选', ' / ', 'FILTER', h('span', { class: 'filter-toggle__chev' }, '▾')]);

  return h('div', { class: 'filter-bar' }, [
    h('div', { class: 'filter-tabs' }, tabEls),
    toggle,
    h('div', { class: 'filter-field filter-search filter-adv' }, [h('label', {}, '关键词'), search]),
    h('div', { class: 'filter-field filter-adv' }, [h('label', {}, '创作阶段'), stageSel]),
    h('div', { class: 'filter-field filter-adv' }, [h('label', {}, '创作时间'), yearSel]),
    h('div', { class: 'filter-field filter-adv' }, [h('label', {}, '排序'), sortSel]),
    h('div', { class: 'filter-bar__actions filter-adv' }, [reset]),
  ]);
}
