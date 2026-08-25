// ============================================================
// admin/comicPages.js — 漫画页管理：批量上传多页 + 调整顺序
// 顺序即阅读顺序；支持 ↑/↓ 排序与删除单页。
// ============================================================
import { h } from '../../../core/dom.js';
import { repo, auth, DATA_MODE } from '../../../data/services.js';
import { imgEl } from '../../components/media.js';
import { toast } from '../../components/primitives.js';
import { adminLayout } from './layout.js';
import { mediaUploadControl } from '../../components/mediaUpload.js';

export async function adminComicPagesView(params) {
  // 后台刷新竞态修复：先 await ensureSession（Supabase 模式）再判断授权。
  if (DATA_MODE.value === 'supabase') {
    await auth.ensureSession();
  }
  if (!auth.isAuthed()) { location.hash = '#/admin/login'; return h('div', {}); }
  const work = await repo.getById(params.id);
  if (!work || work.type !== 'comic') { location.hash = '#/admin'; return h('div', {}); }

  // C3：新增漫画页上传控件（addComicPage → page_number 自动递增，sort_order 同步；重排仅改 sort_order）
  const pageUpload = mediaUploadControl({
    label: '上传新漫画页（自动追加到末尾）',
    onUpload: async (file) => {
      const updated = await repo.addComicPage(work.id, file);
      Object.assign(work, updated);
      render();
      toast('已新增漫画页');
    },
    onError: () => {},
  });

  // C2 解锁：真实可排序（reorderComicPages）；C3 新增上传 / 替换单页。
  const list = h('div', { class: 'thumb-list', style: { maxWidth: '560px' } });

  async function render() {
    list.innerHTML = '';
    const pages = (work.pages || []).slice().sort((a, b) => a.order - b.order);
    pages.forEach((p, idx) => {
      const move = async (from, to) => {
        if (to < 0 || to >= pages.length) return;
        const ids = pages.map((x) => x.id);
        [ids[from], ids[to]] = [ids[to], ids[from]];
        try {
          // #9 修复：先 await 服务端成功（repository 已改为单次批量 upsert，无半成功）；
          // 失败则重读 work 恢复真实顺序（不污染本地）。
          await repo.reorderComicPages(work.id, ids);
          Object.assign(work, await repo.getById(work.id));
          render();
        } catch (err) {
          toast(`排序失败：${err.message || err}`);
          Object.assign(work, await repo.getById(work.id));
          render();
        }
      };
      // C3 替换单页图片（replaceComicPageImage：repaint media_asset_id；旧资产 + Storage 文件保留，不物理删除）
      const replaceCtl = mediaUploadControl({
        label: '替换此页',
        showPreview: false,
        onUpload: async (file) => {
          const updated = await repo.replaceComicPageImage(p.id, file);
          Object.assign(work, updated);
          render();
          toast('已替换该页图片');
        },
        onError: () => {},
      });
      // 删除按钮：C3 仍谨慎 → disabled + 提示「后续阶段开放」
      const delBtn = h('button', {
        class: 'thumb__del', title: '漫画页删除将在后续阶段开放（C3 仅支持新增 / 替换 / 排序）', disabled: true,
      }, '×');
      const t = h('div', { class: 'thumb' }, [
        imgEl(p.image, null, `第${p.order}页`),
        h('span', { class: 'thumb__order' }, `第 ${p.order} 页`),
        h('div', { class: 'thumb__move' }, [
          h('button', { title: '上移', on: { click: () => move(idx, idx - 1) } }, '↑'),
          h('button', { title: '下移', on: { click: () => move(idx, idx + 1) } }, '↓'),
        ]),
        replaceCtl.el,
        delBtn,
      ]);
      list.appendChild(t);
    });
  }
  render();

  const content = h('div', {}, [
    h('div', { class: 'admin__head' }, [
      h('h1', {}, `漫画页管理 · 《${work.title}》`),
      h('div', { class: 'spacer' }),
      h('a', { class: 'btn btn--sm', href: `#/comic/${work.id}` }, '预览阅读'),
    ]),
    h('p', { class: 'secondary', style: { marginBottom: '16px' } },
      '可用 ↑/↓ 调整阅读顺序（顺序即阅读顺序，page_number 不变）。C3：支持上传新页与替换单页图片；删除留后续阶段。'),
    pageUpload.el,
    h('div', { style: { marginTop: '24px' } }, list),
  ]);
  return adminLayout('dashboard', content);
}
