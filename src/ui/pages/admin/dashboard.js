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
import { adminPreviewSrc } from '../../components/mediaUpload.js';
import { catTag, toast, clientError } from '../../components/primitives.js';
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

  const loading = h('div', { class: 'admin__loading' }, '读取中…');
  const content = h('div', { class: 'admin__main-inner' }, loading);
  let currentWorks = []; // P0-6：本地缓存，发布/下架后仅就地更新，禁整站 repo.list 重载
  const busySet = new Set(); // P0-9：每行独立 busy，防并发双击

  function rerender() {
    const s = computeStatsFrom(currentWorks);
    content.replaceChildren(renderBody(currentWorks, s, isSupabase, togglePublish, busySet));
  }

  // 发布 / 下架（草稿↔发布）显式切换。
  // P0-6：成功后本地更新行状态，禁整站 reload（避免重读 110 页漫画）。
  // P0-9：每行独立 busy，防并发双击竞态。
  async function togglePublish(w, action, btn) {
    if (busySet.has(w.id)) return; // 已在进行，忽略重复触发
    busySet.add(w.id);
    if (btn) { btn.disabled = true; btn.textContent = action === 'publish' ? '发布中…' : '下架中…'; }
    try {
      if (action === 'publish') await repo.publishWork(w.id);
      else if (action === 'unpublish') await repo.unpublishWork(w.id);
      // 本地更新（无需重新请求全量列表）
      const row = currentWorks.find((x) => x.id === w.id);
      if (row) row.public = action === 'publish';
      toast(action === 'publish' ? '已发布到前台' : '已下架（取消公开）');
      rerender();
    } catch (e) {
      console.error('[dashboard] 发布/下架失败', e);
      toast(clientError(e)); // P0-13：技术错误不外泄
      rerender(); // 恢复按钮可用态
    } finally {
      busySet.delete(w.id);
    }
  }

  async function loadAndRender() {
    content.replaceChildren(loading);
    try {
      // P0-7：轻量摘要——只取 id/title/type/year/stage/public/featured/cover，绝不读取 work_images / comic_pages。
      const works = await repo.listAdminSummary();
      currentWorks = works;
      rerender();
    } catch (e) {
      console.error('[dashboard] 读取失败', e);
      content.replaceChildren(h('div', { class: 'admin__error' }, [
        h('h2', {}, '数据读取失败'),
        h('p', {}, clientError(e)),
        h('p', { class: 'secondary' }, isSupabase
          ? '请检查网络连通性与云端配置。正式模式不会回退本地预览。'
          : '本地预览数据读取异常。'),
      ]));
    }
  }

  await loadAndRender();

  return adminLayout('dashboard', h('div', {}, [content]));
}

function renderBody(works, s, isSupabase, onTogglePublish, busySet) {
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
    const isBusy = busySet.has(w.id);
    const actions = isSupabase
      ? h('div', { class: 'table__actions' }, [
          w.type === 'certificate'
            ? h('a', { class: 'icon-btn', href: `#/admin/certificate/${w.id}/edit`, title: '编辑证书字段' }, '✎')
            : h('a', { class: 'icon-btn', href: `#/admin/work/${w.id}/edit`, title: '编辑' }, '✎'),
          w.type === 'comic' ? h('a', { class: 'icon-btn', href: `#/admin/comic/${w.id}/pages`, title: '漫画页管理（排序）' }, '▦') : null,
          // 发布 / 下架 显式控制（item 2）；P0-9：进行中禁用防双击。
          w.public !== false
            ? h('button', { class: 'icon-btn', title: '下架（取消公开，前台不可见）', disabled: isBusy, on: { click: (e) => onTogglePublish(w, 'unpublish', e.currentTarget) } }, '下架')
            : h('button', { class: 'icon-btn', title: '发布（确认公开到前台）', disabled: isBusy, on: { click: (e) => onTogglePublish(w, 'publish', e.currentTarget) } }, '发布'),
        ])
      : h('div', { class: 'table__actions' }, [
          w.type !== 'certificate' ? h('a', { class: 'icon-btn', href: `#/admin/work/${w.id}/edit`, title: '编辑' }, '✎') : null,
          w.type === 'comic' ? h('a', { class: 'icon-btn', href: `#/admin/comic/${w.id}/pages`, title: '漫画页管理' }, '▦') : null,
          h('button', {
            class: 'icon-btn icon-btn--danger', title: '删除',
            on: { click: () => toast('本地预览模式：删除入口仅在本地演示可用') },
          }, '🗑'),
        ]);
    // 行封面：private 草稿媒体必须经 signed URL 预览（P0-10，全站一致），public 资产直接读公开 URL。
    const coverTd = h('td', {});
    if (w.cover) {
      adminPreviewSrc(w.cover, w.coverBucket || null, w.coverPath || null).then((src) => {
        if (src) coverTd.replaceChildren(imgEl(src, 'row-cover'));
        else coverTd.replaceChildren(h('span', { class: 'secondary' }, '—'));
      });
    } else {
      coverTd.replaceChildren(h('span', { class: 'secondary' }, '—'));
    }
    return h('tr', {}, [
      coverTd,
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
    h('a', { class: 'btn btn--primary', href: '#/admin/work/new' }, '新增作品'),
    isSupabase
      ? h('span', { class: 'badge badge--live' }, '已连接云端')
      : null,
  ]);

  const children = [head, stats];
  if (!isSupabase) {
    children.push(h('div', { style: { marginBottom: '16px' } }, h('button', { class: 'btn btn--sm' }, '重置为 Demo 数据（Mock）')));
  } else {
    children.push(h('div', { class: 'notice' }, '作品支持：编辑字段、上传 / 替换 / 排序 / 删除封面与图片、管理漫画页、编辑证书与关于页；上传媒体后作品保持草稿，须显式「发布」才公开到前台，可「下架」取消公开。删除为逻辑删除，底层原图保留备份。'));
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
