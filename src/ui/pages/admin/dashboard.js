// ============================================================
// admin/dashboard.js — 仪表盘（统计 + 列表 + 模拟增删改）
// ============================================================
import { h } from '../../../core/dom.js';
import { repo, auth } from '../../../data/services.js';
import { imgEl } from '../../components/media.js';
import { catTag, confirmModal, toast } from '../../components/primitives.js';
import { adminLayout } from './layout.js';

export async function adminDashboardView() {
  if (!auth.isAuthed()) { location.hash = '#/admin/login'; return h('div', {}); }

  const works = await repo.list();
  const s = repo.stats();

  const stat = (n, label) => h('div', { class: 'stat' }, [
    h('div', { class: 'stat__num' }, String(n)),
    h('div', { class: 'stat__label' }, label),
  ]);
  const stats = h('div', { class: 'stat-row' }, [
    stat(s.illustration + s.comic + s.oil, '作品总数'), stat(s.illustration, '插画'), stat(s.comic, '漫画'),
    stat(s.certificate, '证书'), stat(s.oil, '油画'), stat(s.featured, '精选'), stat(s.hidden, '未公开'),
  ]);

  const th = (t) => h('th', {}, t);
  const tbody = h('tbody', {});

  const table = h('div', { class: 'table-scroll' }, h('table', { class: 'table' }, [
    h('thead', {}, h('tr', {}, [th('封面'), th('标题'), th('类型'), th('年份'), th('阶段'), th('公开'), th('精选'), th('操作')])),
    tbody,
  ]));

  function buildRow(w) {
    const actions = h('div', { class: 'table__actions' }, [
      // 证书不在 WORK_TYPES 中，禁止从通用编辑器修改（避免类型被改坏）；正式证书管理功能完成前不提供入口
      w.type !== 'certificate' ? h('a', { class: 'icon-btn', href: `#/admin/work/${w.id}/edit`, title: '编辑' }, '✎') : null,
      w.type === 'comic' ? h('a', { class: 'icon-btn', href: `#/admin/comic/${w.id}/pages`, title: '漫画页管理' }, '▦') : null,
      h('button', {
        class: 'icon-btn icon-btn--danger', title: '删除',
        on: { click: () => confirmModal({
          title: '删除作品', message: `确定删除《${w.title}》？此操作不可撤销。`, danger: true, okText: '删除',
          onOk: async () => { await repo.remove(w.id); toast('已删除'); tr.remove(); },
        }) },
      }, '🗑'),
    ]);
    const tr = h('tr', {}, [
      h('td', {}, imgEl(w.cover, 'row-cover')),
      h('td', {}, w.title),
      h('td', {}, catTag(w.type)),
      h('td', {}, (w.year != null && w.year !== '') ? String(w.year) : '—'),
      h('td', {}, w.stage || '—'),
      h('td', {}, w.public === false ? '否' : '是'),
      h('td', {}, w.featured ? '是' : '—'),
      h('td', {}, actions),
    ]);
    return tr;
  }

  works.forEach((w) => tbody.appendChild(buildRow(w)));

  const head = h('div', { class: 'admin__head' }, [
    h('h1', {}, '仪表盘'),
    h('div', { class: 'spacer' }),
    h('a', { class: 'btn btn--primary', href: '#/admin/work/new' }, '新增作品'),
  ]);

  const reset = h('button', {
    class: 'btn btn--sm',
    on: { click: () => confirmModal({
      title: '重置为 Demo 数据', message: '将清空当前所有改动并恢复初始演示数据，确定继续？', danger: true, okText: '重置',
      onOk: async () => { await repo.resetDemo(); toast('已恢复 Demo 数据'); location.reload(); },
    }) },
  }, '重置为 Demo 数据');

  return adminLayout('dashboard', h('div', {}, [head, stats, h('div', { style: { marginBottom: '16px' } }, reset), table]));
}
