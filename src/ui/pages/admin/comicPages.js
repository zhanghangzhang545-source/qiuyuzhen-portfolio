// ============================================================
// admin/comicPages.js — 漫画页管理：批量上传多页 + 调整顺序
// 顺序即阅读顺序；支持 ↑/↓ 排序与删除单页。
// ============================================================
import { h } from '../../../core/dom.js';
import { repo, auth, storage } from '../../../data/services.js';
import { imgEl } from '../../components/media.js';
import { toast, bindFileDrop } from '../../components/primitives.js';
import { adminLayout } from './layout.js';

export async function adminComicPagesView(params) {
  if (!auth.isAuthed()) { location.hash = '#/admin/login'; return h('div', {}); }
  const work = await repo.getById(params.id);
  if (!work || work.type !== 'comic') { location.hash = '#/admin'; return h('div', {}); }

  const list = h('div', { class: 'thumb-list', style: { maxWidth: '560px' } });

  async function render() {
    list.innerHTML = '';
    const pages = (work.pages || []).slice().sort((a, b) => a.order - b.order);
    pages.forEach((p, idx) => {
      const move = async (from, to) => {
        if (to < 0 || to >= pages.length) return;
        const ids = pages.map((x) => x.id);
        [ids[from], ids[to]] = [ids[to], ids[from]];
        await repo.reorderComicPages(work.id, ids);
        Object.assign(work, await repo.getById(work.id));
        render();
      };
      const t = h('div', { class: 'thumb' }, [
        imgEl(p.image, null, `第${p.order}页`),
        h('span', { class: 'thumb__order' }, `第 ${p.order} 页`),
        h('div', { class: 'thumb__move' }, [
          h('button', { title: '上移', on: { click: () => move(idx, idx - 1) } }, '↑'),
          h('button', { title: '下移', on: { click: () => move(idx, idx + 1) } }, '↓'),
        ]),
        h('button', { class: 'thumb__del', title: '删除该页', on: { click: async () => {
          await repo.removeComicPage(work.id, p.id);
          Object.assign(work, await repo.getById(work.id));
          render(); toast('已删除该页');
        } } }, '×'),
      ]);
      list.appendChild(t);
    });
  }
  render();

  const addPages = async (files) => {
    for (const f of files) { const r = await storage.upload(f); await repo.addComicPage(work.id, r.url); }
    Object.assign(work, await repo.getById(work.id));
    render(); toast('已添加漫画页（Demo）');
  };
  const addInput = h('input', { type: 'file', accept: 'image/*', multiple: true, on: { change: async (e) => { await addPages(e.target.files); e.target.value = ''; } } });
  const drop = h('div', { class: 'file-drop' }, [h('p', {}, '点击或拖拽上传漫画页（可多选）'), addInput]);
  bindFileDrop(drop, addInput, addPages);

  const content = h('div', {}, [
    h('div', { class: 'admin__head' }, [
      h('h1', {}, `漫画页管理 · 《${work.title}》`),
      h('div', { class: 'spacer' }),
      h('a', { class: 'btn btn--sm', href: `#/comic/${work.id}` }, '预览阅读'),
    ]),
    h('p', { class: 'secondary', style: { marginBottom: '16px' } }, '支持批量上传多页，并用 ↑/↓ 调整顺序（顺序即阅读顺序）。'),
    drop,
    h('div', { style: { marginTop: '24px' } }, list),
  ]);
  return adminLayout('dashboard', content);
}
