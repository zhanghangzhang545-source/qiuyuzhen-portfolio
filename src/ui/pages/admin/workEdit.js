// ============================================================
// admin/workEdit.js — 新增 / 编辑作品（封面、多图、标签、开关等）
// 漫画类型保存后跳转到“漫画页管理”进行批量上传与排序。
// ============================================================
import { h } from '../../../core/dom.js';
import { repo, auth, storage } from '../../../data/services.js';
import { imgEl } from '../../components/media.js';
import { toast, bindFileDrop } from '../../components/primitives.js';
import { adminLayout } from './layout.js';
import { WORK_TYPES, STAGES } from '../../../data/types.js';

function switchEl(checked, onChange) {
  const input = h('input', { type: 'checkbox', checked: !!checked });
  const sw = h('label', { class: 'switch' }, [input, h('span', { class: 'switch__track' }), h('span', { class: 'switch__thumb' })]);
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  return { el: sw, input };
}

function makeTagInput(initial) {
  const tags = initial.slice();
  const input = h('input', { type: 'text', placeholder: '输入后回车添加' });
  const wrap = h('div', { class: 'tag-input' }, [input]);
  const render = () => {
    [...wrap.querySelectorAll('.chip')].forEach((c) => c.remove());
    tags.forEach((t) => {
      const chip = h('span', { class: 'chip' }, [t, h('button', { type: 'button', on: { click: () => { const i = tags.indexOf(t); if (i >= 0) tags.splice(i, 1); render(); } } }, '×')]);
      wrap.insertBefore(chip, input);
    });
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = input.value.trim();
      if (v && !tags.includes(v)) { tags.push(v); input.value = ''; render(); }
    }
  });
  render();
  return { el: wrap, get: () => tags.slice() };
}

export async function adminWorkEditView(params) {
  if (!auth.isAuthed()) { location.hash = '#/admin/login'; return h('div', {}); }
  const existing = params.id ? await repo.getById(params.id) : null;
  const isEdit = !!existing;

  // 证书暂不支持在通用作品编辑器中修改：类型不在 WORK_TYPES 中，强行保存会把证书类型改坏为插画/漫画/油画。
  // 正式证书管理功能完成前，统一在通用编辑器内禁止修改证书。
  if (existing && existing.type === 'certificate') {
    return adminLayout('new', h('div', {}, [
      h('div', { class: 'admin__head' }, [h('h1', {}, `证书 · ${existing.title}`)]),
      h('div', { class: 'notice' }, [
        '证书当前不支持在通用作品编辑器中修改（避免类型被误改为插画 / 漫画 / 油画）。',
        h('br', {}),
        '如需调整其是否展示，请在数据中设置 public 字段（true = 在「关于」展示，false = 隐藏）。',
      ]),
      h('a', { class: 'btn', href: '#/admin' }, '返回仪表盘'),
    ]));
  }

  const cover = { value: existing?.cover || null };
  const imagesState = existing?.images ? existing.images.slice() : [];

  const coverPrev = h('div', { class: 'thumb', style: { width: '120px' } });
  const renderCover = () => { coverPrev.innerHTML = ''; if (cover.value) coverPrev.appendChild(imgEl(cover.value, null, '封面')); };
  renderCover();
  const setCover = async (files) => {
    const f = files[0]; if (!f) return;
    const r = await storage.upload(f); cover.value = r.url; renderCover(); toast('封面已上传（Demo）');
  };
  const coverInput = h('input', { type: 'file', accept: 'image/*', on: { change: async (e) => { await setCover(e.target.files); e.target.value = ''; } } });
  const coverDrop = h('div', { class: 'file-drop' }, [h('p', {}, '点击或拖拽上传封面'), coverInput]);
  bindFileDrop(coverDrop, coverInput, setCover);

  const titleI = h('input', { type: 'text', value: existing?.title || '', placeholder: '作品标题' });
  const introI = h('textarea', { placeholder: '作品简介' }, existing?.intro || '');
  const typeSel = h('select', {}, WORK_TYPES.map((t) => h('option', { value: t.id, selected: (existing?.type || 'illustration') === t.id }, t.name)));
  const yearI = h('input', { type: 'number', value: existing?.year ?? '' });
  const stageI = h('input', { type: 'text', value: existing?.stage || '', placeholder: '如：学校时期', list: 'stage-list' }, );
  const stageList = h('datalist', { id: 'stage-list' }, STAGES.map((s) => h('option', { value: s })));

  // 作品性质（仅漫画）：原创 / 同人 / Fan Work；未选择 → null，严禁默认原创
  const natureSel = h('select', {}, [
    h('option', { value: '', selected: !existing?.workNature }, '请选择'),
    h('option', { value: 'original', selected: existing?.workNature === 'original' }, '原创'),
    h('option', { value: 'fan', selected: existing?.workNature === 'fan' }, '同人 / Fan Work'),
  ]);
  const sortI = h('input', { type: 'number', value: existing?.sort || 0 });
  const pubSw = switchEl(existing ? existing.public !== false : true);
  const featSw = switchEl(existing ? !!existing.featured : false);
  const tagsInput = makeTagInput(existing?.tags || []);

  // 多图（非漫画）
  const imgList = h('div', { class: 'thumb-list' });
  const renderImages = () => {
    imgList.innerHTML = '';
    imagesState.forEach((src, i) => {
      imgList.appendChild(h('div', { class: 'thumb' }, [
        imgEl(src, null, '图'),
        h('button', { class: 'thumb__del', on: { click: () => { imagesState.splice(i, 1); renderImages(); } } }, '×'),
      ]));
    });
  };
  renderImages();
  const addImages = async (files) => {
    for (const f of files) { const r = await storage.upload(f); imagesState.push(r.url); }
    renderImages(); toast('已添加图片（Demo）');
  };
  const imgInput = h('input', { type: 'file', accept: 'image/*', multiple: true, on: { change: async (e) => { await addImages(e.target.files); e.target.value = ''; } } });
  const imgDrop = h('div', { class: 'file-drop' }, [h('p', {}, '点击或拖拽上传多张图片'), imgInput]);
  bindFileDrop(imgDrop, imgInput, addImages);

  const imagesSection = h('div', { class: 'field' }, [
    h('label', { class: 'field__label' }, '作品图片（可多张）'),
    imgDrop,
    imgList,
  ]);

  // 作品性质字段：仅漫画类型显示；非漫画隐藏且不参与保存
  const natureField = h('div', { class: 'field' }, [
    h('label', { class: 'field__label' }, '作品性质'),
    natureSel,
  ]);

  const toggleTypeFields = () => {
    const isComic = typeSel.value === 'comic';
    imagesSection.hidden = isComic;
    natureField.hidden = !isComic;
  };
  typeSel.addEventListener('change', toggleTypeFields);
  toggleTypeFields();

  const form = h('form', { class: 'form', on: { submit: async (e) => {
    e.preventDefault();
    const title = titleI.value.trim();
    if (!title) { toast('请填写标题'); titleI.focus(); return; }
    const payload = {
      title, intro: introI.value.trim(), type: typeSel.value,
      // 年份：留空（用户清空）保持 null，严禁自动推测/回填当前年份
      year: yearI.value.trim() === '' ? null : (Number(yearI.value) || null),
      stage: stageI.value.trim(), sort: Number(sortI.value) || 0,
      public: pubSw.input.checked, featured: featSw.input.checked,
      cover: cover.value, tags: tagsInput.get(),
    };
    if (payload.type === 'comic') {
      // 未选择（''） → null；严禁把未确认性质默认保存为 original
      payload.workNature = natureSel.value === '' ? null : natureSel.value;
    }
    if (payload.type !== 'comic') payload.images = imagesState.slice();
    let saved;
    if (isEdit) { saved = await repo.update(existing.id, payload); toast('已保存修改'); }
    else { saved = await repo.create(payload); toast('已新增作品'); }
    if (payload.type === 'comic' && !isEdit) location.hash = `#/admin/comic/${saved.id}/pages`;
    else location.hash = '#/admin';
  } } }, [
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '标题'), titleI]),
      h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '类型'), typeSel]),
    ]),
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '简介'), introI]),
    natureField,
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '创作年份'), yearI]),
      h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '创作阶段'), stageI, stageList]),
    ]),
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '封面'), coverDrop, coverPrev]),
    imagesSection,
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '标签（关键词，回车添加）'), tagsInput.el]),
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field field--row' }, [pubSw.el, h('span', {}, '是否公开')]),
      h('div', { class: 'field field--row' }, [featSw.el, h('span', {}, '是否精选')]),
    ]),
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '排序权重（数字越大越靠前）'), sortI]),
    h('div', { class: 'modal__actions', style: { justifyContent: 'flex-start', marginTop: '8px' } }, [
      h('button', { type: 'submit', class: 'btn btn--primary' }, isEdit ? '保存修改' : '创建作品'),
      h('a', { class: 'btn', href: '#/admin' }, '取消'),
    ]),
  ]);

  return adminLayout('new', h('div', {}, [
    h('div', { class: 'admin__head' }, [h('h1', {}, isEdit ? `编辑 · 《${existing.title}》` : '新增作品')]),
    form,
  ]));
}
