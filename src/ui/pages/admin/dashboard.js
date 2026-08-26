// ============================================================
// admin/dashboard.js — 仪表盘（Phase 3-C2：真实可写）
// ------------------------------------------------------------
// 正式模式：从真实 Supabase 读取 Works / Comics / Certificates 并展示统计。
// C2 解锁：编辑链接指向真实可写表单（作品 / 漫画页管理 / 证书结构化字段编辑）；
//   ❌ C2 禁止 destructive delete：删除按钮 disabled + 提示「媒体删除将在下一阶段（C3）开放」。
//   ❌ C2 禁止上传 / 替换 / 删除媒体。
// Mock 模式（?mock=1）：保留原有可写交互（便于本地演示回滚通道）。
// 状态：loading / empty / error / unauthorized 均显式呈现，禁止静默失败。
// ============================================================
import { h } from '../../../core/dom.js';
import { repo, auth, DATA_MODE } from '../../../data/services.js';
import { imgEl } from '../../components/media.js';
import { catTag, toast } from '../../components/primitives.js';
import { adminLayout } from './layout.js';

export async function adminDashboardView() {
  // 会话/授权闸门
  if (DATA_MODE.value === 'supabase') {
    await auth.ensureSession();
    if (!auth.isAuthed()) { location.hash = '#/admin/login'; return h('div', {}); }
  } else {
    if (!auth.isAuthed()) { location.hash = '#/admin/login'; return h('div', {}); }
  }

  const isSupabase = DATA_MODE.value === 'supabase';

  // 加载态
  const loading = h('div', { class: 'admin__loading' }, '读取中…');
  const content = h('div', { class: 'admin__main-inner' }, loading);

  // 异步加载真实数据（可重复调用以在发布/下架后刷新）
  async function loadAndRender() {
    content.replaceChildren(loading);
    try {
      // 消除重复全量请求：仅取一次 list，stats 由本地基于同一份 works 计算
      const works = await repo.list();
      const s = computeStatsFrom(works);
      content.replaceChildren(renderBody(works, s, isSupabase, togglePublish));
    } catch (e) {
      content.replaceChildren(h('div', { class: 'admin__error' }, [
        h('h2', {}, '数据读取失败'),
        h('p', {}, e.message || String(e)),
        h('p', { class: 'secondary' }, isSupabase
          ? '请检查网络连通性与云端配置。正式模式不会回退本地预览。'
          : '本地预览数据读取异常。'),
      ]));
    }
  }

  // 发布 / 下架（草稿↔发布）显式切换；操作后刷新列表（item 2：Works 发布生命周期）
  async function togglePublish(w, action) {
    try {
      if (action === 'publish') await repo.publishWork(w.id);
      else if (action === 'unpublish') await repo.unpublishWork(w.id);
      toast(action === 'publish' ? '已发布到前台' : '已下架（取消公开）');
      await loadAndRender();
    } catch (e) {
      toast(`操作失败：${e.message || e}`);
    }
  }

  await loadAndRender();

  return adminLayout('dashboard', h('div', {}, [content]));
}

function renderBody(works, s, isSupabase, onTogglePublish) {
  const stat = (n, label) => h('div', { class: 'stat' }, [
    h('div', { class: 'stat__num' }, String(n)),
    h('div', { class: 'stat__label' }, label),
  ]);
  const stats = h('div', { class: 'stat-row' }, [
    stat(s.illustration + s.comic + s.oil, '作品总数'), stat(s.illustration, '插画'), stat(s.comic, '漫画'),
    stat(s.certificate, '证书'), stat(s.oil, '油画'), stat(s.featured, '精选'), stat(s.hidden, '未公开（草稿）'),
  ]);

  const th = (t) => h('th', {}, t);
  const tbody = h('tbody', {});

  function buildRow(w) {
    // C3 真实可写（Supabase 模式）：
    //   - 作品 / 漫画：解锁编辑（漫画额外解锁「漫画页管理」排序入口）。
    //   - 证书：指向独立的证书结构化字段编辑页（/admin/certificate/:id/edit）。
    //   - 发布生命周期（item 2）：草稿→发布 / 已发布→下架，显式切换，绝不自动公开。
    //   - 删除：禁止 destructive delete → 按钮 disabled + 提示。
    const actions = isSupabase
      ? h('div', { class: 'table__actions' }, [
          w.type === 'certificate'
            ? h('a', { class: 'icon-btn', href: `#/admin/certificate/${w.id}/edit`, title: '编辑证书字段' }, '✎')
            : h('a', { class: 'icon-btn', href: `#/admin/work/${w.id}/edit`, title: '编辑' }, '✎'),
          w.type === 'comic' ? h('a', { class: 'icon-btn', href: `#/admin/comic/${w.id}/pages`, title: '漫画页管理（排序）' }, '▦') : null,
          // 发布 / 下架 显式控制（item 2）
          w.public !== false
            ? h('button', { class: 'icon-btn', title: '下架（取消公开，前台不可见）', on: { click: () => onTogglePublish(w, 'unpublish') } }, '下架')
            : h('button', { class: 'icon-btn', title: '发布（确认公开到前台）', on: { click: () => onTogglePublish(w, 'publish') } }, '发布'),
          h('button', {
            class: 'icon-btn icon-btn--danger', title: '为避免误删，媒体删除暂不开放', disabled: true,
          }, '🗑'),
        ])
      : h('div', { class: 'table__actions' }, [
          w.type !== 'certificate' ? h('a', { class: 'icon-btn', href: `#/admin/work/${w.id}/edit`, title: '编辑' }, '✎') : null,
          w.type === 'comic' ? h('a', { class: 'icon-btn', href: `#/admin/comic/${w.id}/pages`, title: '漫画页管理' }, '▦') : null,
          h('button', {
            class: 'icon-btn icon-btn--danger', title: '删除',
            on: { click: () => toast('本地预览模式：删除入口仅在本地演示可用') },
          }, '🗑'),
        ]);
    return h('tr', {}, [
      h('td', {}, imgEl(w.cover, 'row-cover')),
      h('td', {}, w.title),
      h('td', {}, catTag(w.type)),
      h('td', {}, (w.year != null && w.year !== '') ? String(w.year) : '—'),
      h('td', {}, w.stage || '—'),
      h('td', {}, w.public === false ? '否（草稿）' : '是'),
      h('td', {}, w.featured ? '是' : '—'),
      h('td', {}, actions),
    ]);
  }

  works.forEach((w) => tbody.appendChild(buildRow(w)));

  const table = h('div', { class: 'table-scroll' }, h('table', { class: 'table' }, [
    h('thead', {}, h('tr', {}, [th('封面'), th('标题'), th('类型'), th('年份'), th('阶段'), th('公开'), th('精选'), th('操作')])),
    tbody,
  ]));

  const head = h('div', { class: 'admin__head' }, [
    h('h1', {}, '仪表盘'),
    h('div', { class: 'spacer' }),
    isSupabase
      ? h('span', { class: 'badge badge--live' }, '已连接云端')
      : h('a', { class: 'btn btn--primary', href: '#/admin/work/new' }, '新增作品'),
  ]);

  const children = [head, stats];
  if (!isSupabase) {
    children.push(h('div', { style: { marginBottom: '16px' } }, h('button', { class: 'btn btn--sm' }, '重置为 Demo 数据（Mock）')));
  } else {
    children.push(h('div', { class: 'notice' }, '已开放媒体写入与发布生命周期：作品字段 / 漫画页 / 证书 / 关于页皆可真实写入；上传媒体后作品保持草稿，须显式「发布」才公开到前台，可「下架」取消公开（可重新发布）。媒体物理删除暂不开放。'));
  }
  children.push(table);
  return h('div', {}, children);
}

// 本地统计：基于已获取的 works 计算（避免再调用 repo.list() 造成重复全量请求）。
// 与 services.js 的 computeStats 逻辑完全一致，但复用同一份数据。
function computeStatsFrom(works) {
  const by = (t) => works.filter((w) => w.type === t).length;
  return {
    total: works.filter((w) => w.type !== 'certificate').length,
    illustration: by('illustration'),
    comic: by('comic'),
    oil: by('oil'),
    certificate: by('certificate'),
    featured: works.filter((w) => w.featured).length,
    hidden: works.filter((w) => w.public === false && w.type !== 'certificate').length,
  };
}
