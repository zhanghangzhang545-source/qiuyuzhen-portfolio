// ============================================================
// admin/comicPages.js — 漫画页管理：批量上传多页 + 调整顺序
// 顺序即阅读顺序；支持 ↑/↓ 排序与删除单页。
// ============================================================
import { h } from '../../../core/dom.js';
import { repo, auth, DATA_MODE } from '../../../data/services.js';
import { imgEl } from '../../components/media.js';
import { toast, clientError } from '../../components/primitives.js';
import { adminLayout } from './layout.js';
import { mediaUploadControl, adminPreviewSrc } from '../../components/mediaUpload.js';

export async function adminComicPagesView(params) {
  // 后台刷新竞态修复：先 await ensureSession（Supabase 模式）再判断授权。
  if (DATA_MODE.value === 'supabase') {
    await auth.ensureSession();
  }
  if (!auth.isAuthed()) { location.hash = '#/admin/login'; return h('div', {}); }
  const work = await repo.getById(params.id);
  if (!work || work.type !== 'comic') { location.hash = '#/admin'; return h('div', {}); }

  let comicBusy = false; // P0-9：全局忙锁，防上移/下移/删除/替换/新增页并发竞态
  const guard = () => { if (comicBusy) return true; comicBusy = true; return false; };
  const release = () => { comicBusy = false; };

  // C3：新增漫画页上传控件（addComicPage → page_number 自动递增，sort_order 同步；重排仅改 sort_order）
  const pageUpload = mediaUploadControl({
    label: '上传新漫画页（自动追加到末尾）',
    onUpload: async (file) => {
      if (guard()) return;
      try {
        toast('正在上传漫画页…'); // P0-8：长操作立即反馈
        const updated = await repo.addComicPage(work.id, file);
        Object.assign(work, updated);
        render();
        toast('已新增漫画页');
      } catch (e) {
        console.error('[comic] 新增页失败', e);
        toast(clientError(e)); // P0-13
      } finally { release(); }
    },
    onError: () => {},
  });

  // C2 解锁：真实可排序（reorderComicPages）；C3 新增上传 / 替换单页。
  const list = h('div', { class: 'thumb-list', style: { maxWidth: '560px' } });

  async function render() {
    list.innerHTML = '';
    const pages = (work.pages || []).slice().sort((a, b) => a.order - b.order);
    // P0-11：并行生成所有 signed URL（signedUrl 自身有内存缓存），顺序严格保持不变。
    const srcs = await Promise.all(pages.map((p) => adminPreviewSrc(p.image, p.bucket, p.path)));
    pages.forEach((p, idx) => {
      const src = srcs[idx];
      const move = async (from, to, btnUp, btnDown) => {
        if (to < 0 || to >= pages.length) return;
        if (guard()) return; // P0-9：防并发双击
        if (btnUp) btnUp.disabled = true;
        if (btnDown) btnDown.disabled = true;
        const ids = pages.map((x) => x.id);
        [ids[from], ids[to]] = [ids[to], ids[from]];
        try {
          // P0-10：用返回值直接刷新本地页序，杜绝成功后再 getById 的重复读。
          const res = await repo.reorderComicPages(work.id, ids);
          work.pages = res.pages;
          toast('顺序已更新');
          render();
        } catch (err) {
          console.error('[comic] 排序失败', err);
          toast(clientError(err)); // P0-13
          Object.assign(work, await repo.getById(work.id)); // 失败恢复允许一次额外 getById
          render();
        } finally { release(); }
      };
      // C3 替换单页图片（replaceComicPageImage：repaint media_asset_id；旧资产 + Storage 文件保留，不物理删除）
      const replaceCtl = mediaUploadControl({
        label: '替换此页',
        showPreview: false,
        onUpload: async (file) => {
          if (guard()) return; // P0-9
          try {
            toast('正在替换该页…'); // P0-8
            const updated = await repo.replaceComicPageImage(p.id, file);
            Object.assign(work, updated);
            render();
            toast('已替换该页图片');
          } catch (e) {
            console.error('[comic] 替换页失败', e);
            toast(clientError(e)); // P0-13
          } finally { release(); }
        },
        onError: () => {},
      });
      // P0-4：漫画页删除（二次确认 + 删 comic_pages 关联 + 剩余 sort_order 连续重排 + 底层原图保留）
      const delBtn = h('button', {
        class: 'thumb__del', title: '删除此漫画页（底层原图保留备份）',
      }, '×');
      delBtn.addEventListener('click', async () => {
        if (guard()) return; // P0-9
        if (!globalThis.confirm(`确定删除第 ${p.order} 页吗？\n该操作不可撤销，底层原图保留备份；若已发布到前台，A 阅读器将同步减少该页。`)) { release(); return; }
        delBtn.disabled = true;
        try {
          // P0-10：用返回值直接刷新本地页序，杜绝成功后再 getById 的重复读。
          const res = await repo.removeComicPage(work.id, p.id);
          work.pages = res.pages;
          render();
          toast('已删除该漫画页');
        } catch (err) {
          console.error('[comic] 删除页失败', err);
          toast(clientError(err)); // P0-13
          Object.assign(work, await repo.getById(work.id)); // 失败恢复允许一次额外 getById
          render();
        } finally { release(); }
      });
      const upBtn = h('button', { title: '上移', on: { click: (e) => move(idx, idx - 1, e.currentTarget, null) } }, '↑');
      const downBtn = h('button', { title: '下移', on: { click: (e) => move(idx, idx + 1, null, e.currentTarget) } }, '↓');
      const t = h('div', { class: 'thumb' }, [
        src ? imgEl(src, null, `第${p.order}页`) : h('div', { class: 'thumb__fail' }, '图片加载失败'),
        h('span', { class: 'thumb__order' }, `第 ${p.order} 页`),
        h('div', { class: 'thumb__move' }, [upBtn, downBtn]),
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
      '可用 ↑/↓ 调整阅读顺序（顺序即阅读顺序，page_number 不变）。支持上传新页、替换单页图片与删除单页（底层原图保留备份）。'),
    pageUpload.el,
    h('div', { style: { marginTop: '24px' } }, list),
  ]);
  return adminLayout('dashboard', content);
}
