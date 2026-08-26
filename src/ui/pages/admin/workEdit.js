// ============================================================
// admin/workEdit.js — 新增 / 编辑作品（封面、多图、标签、开关等）
// 漫画类型保存后跳转到“漫画页管理”进行批量上传与排序。
// ============================================================
import { h } from '../../../core/dom.js';
import { repo, auth, DATA_MODE } from '../../../data/services.js';
import { imgEl } from '../../components/media.js';
import { toast } from '../../components/primitives.js';
import { adminLayout } from './layout.js';
import { WORK_TYPES, STAGES } from '../../../data/types.js';
import { mediaUploadControl } from '../../components/mediaUpload.js';

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
  // 后台刷新竞态修复：先 await ensureSession 加载会话态（Supabase 模式），
  // 再判断 isAuthed()，避免同步闸门在 impl 未就绪 / 会话未校验时误判为未授权。
  if (DATA_MODE.value === 'supabase') {
    await auth.ensureSession();
  }
  if (!auth.isAuthed()) { location.hash = '#/admin/login'; return h('div', {}); }

  const isSupabase = DATA_MODE.value === 'supabase';

  const existing = params.id ? await repo.getById(params.id) : null;
  const isEdit = !!existing;

  // C3：封面 / 多图上传已在下方（coverUpload / imgUpload / imagesSection）真实开放，
  // 经 services.storage + repo 写入（含管理闸门与失败回滚）。两种模式均可用。

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

  // 封面预览两种模式都展示（只读展示 existing 封面，不可在 SBS 改）
  const cover = { value: existing?.cover || null };
  const coverPrev = h('div', { class: 'thumb', style: { width: '120px' } });
  const renderCover = () => { coverPrev.innerHTML = ''; if (cover.value) coverPrev.appendChild(imgEl(cover.value, null, '封面')); };
  renderCover();

  // C3：封面上传控件（替换封面）。上传走 services.storage + repo.uploadWorkCover（含管理闸门 + 回滚）。
  const coverUpload = mediaUploadControl({
    label: '替换封面',
    onUpload: async (file) => {
      const updated = await repo.uploadWorkCover(existing.id, file);
      cover.value = updated.cover;
      renderCover();
      Object.assign(existing, updated);
      // 草稿封面为 private URL，前台不可预览；用本地对象 URL 即时预览（不依赖公开可读）
      if (file && globalThis.URL && URL.createObjectURL) coverUpload.setPreview(URL.createObjectURL(file));
    },
    onError: () => {},
  });
  if (cover.value) coverUpload.setPreview(cover.value);

  // 多图状态
  const imagesState = existing?.images ? existing.images.slice() : [];
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
  // C2 发布边界（#5 / #4）：公开状态切换彻底禁用（publish/unpublish 留 C3）。
  // 两种模式都不创建公开开关；新作恒不公开由仓储层保证，UI 不暴露此控制。
  const featSw = switchEl(existing ? !!existing.featured : false);
  const tagsInput = makeTagInput(existing?.tags || []);

  // —— C2 双维度独立字段 ——
  // Home Featured（首页精选）：homeFeatured + homeFeaturedOrder（互不污染 Works Pick / Works 全列表排序）
  const homeFeaturedOrderI = h('input', { type: 'number', value: existing?.homeFeaturedOrder || 0 });
  const worksPickSw = switchEl(existing ? !!existing.worksPick : false);
  const worksPickOrderI = h('input', { type: 'number', value: existing?.worksPickOrder || 0 });
  // 展示尺寸（冻结枚举，但选项对客户可读：普通 / 竖版大图 / 横版通栏）
  const displaySizeSel = h('select', {}, [
    h('option', { value: 'standard', selected: (existing?.displaySize || 'standard') === 'standard' }, '普通（默认）'),
    h('option', { value: 'large-portrait', selected: existing?.displaySize === 'large-portrait' }, '竖版大图'),
    h('option', { value: 'wide-feature', selected: existing?.displaySize === 'wide-feature' }, '横版通栏'),
  ]);
  // draft（无媒体草稿）：仅 Mock 模式新增入口，创建时不传媒体；SBS 模式 create 强制 is_public=false，无需此开关
  const draftSw = isSupabase ? null : switchEl(false);

  // C3：作品多图管理（仅非漫画作品）。支持上传新图 + ↑/↓ 调整顺序；删除本阶段谨慎（禁用）。
  const imgListWrap = h('div', { class: 'thumb-list' });
  const imgUpload = mediaUploadControl({
    label: '添加作品图片',
    onUpload: async (file) => {
      const updated = await repo.addWorkImage(existing.id, file);
      imagesState.length = 0;
      (updated.images || []).forEach((s) => imagesState.push(s));
      renderImages();
      Object.assign(existing, updated);
    },
    onError: () => {},
  });

  async function renderImages() {
    imgListWrap.innerHTML = '';
    for (let i = 0; i < imagesState.length; i++) {
      const src = imagesState[i];
      const move = async (from, to) => {
        if (to < 0 || to >= imagesState.length) return;
        const order = imagesState.slice();
        [order[from], order[to]] = [order[to], order[from]];
        try {
          const updated = await repo.adjustImageSort(existing.id, order);
          imagesState.length = 0;
          (updated.images || []).forEach((s) => imagesState.push(s));
          renderImages();
        } catch (err) {
          toast(`排序失败：${err.message || err}`);
        }
      };
      imgListWrap.appendChild(h('div', { class: 'thumb' }, [
        imgEl(src, null, `图${i + 1}`),
        h('div', { class: 'thumb__move' }, [
          h('button', { title: '上移', on: { click: () => move(i, i - 1) } }, '↑'),
          h('button', { title: '下移', on: { click: () => move(i, i + 1) } }, '↓'),
        ]),
        h('button', { class: 'thumb__del', title: '为避免误删，删除暂不开放', disabled: true }, '×'),
      ]));
    }
  }
  renderImages();

  const imagesSection = h('div', { class: 'field' }, [
    h('label', { class: 'field__label' }, '作品图片（可上传 / 调整顺序；删除暂不开放）'),
    imgListWrap,
    imgUpload.el,
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
  // #1 修复：编辑现有作品时 type 已冻结（C2 禁止改 type），禁用下拉避免用户误改；
  // 新建作品才允许选择（payload 仅在 !isEdit 时含 type）。
  if (isEdit) typeSel.disabled = true;

  // —— #6 写状态机：dirty / saving / success / failure / unauthorized ——
  const statusBar = h('div', { class: 'form-status', 'aria-live': 'polite' });
  let isDirty = false;
  let isSaving = false;
  const markDirty = () => {
    if (isSaving) return;
    if (!isDirty) { isDirty = true; statusBar.textContent = '未保存修改'; statusBar.className = 'form-status form-status--dirty'; }
  };
  const setSaving = (on) => {
    isSaving = on;
    submitBtn.disabled = on;
    submitBtn.textContent = on ? '保存中…' : (isEdit ? '保存修改' : '创建作品');
    if (on) { statusBar.textContent = '保存中…'; statusBar.className = 'form-status form-status--saving'; }
  };
  const setStatus = (kind, msg) => {
    statusBar.textContent = msg;
    statusBar.className = `form-status form-status--${kind}`;
  };
  // 绑定输入变更 → 标记 dirty
  [titleI, introI, yearI, stageI, sortI, natureSel, homeFeaturedOrderI, worksPickOrderI, displaySizeSel, tagsInput.el].forEach((el) => {
    if (!el) return;
    el.addEventListener('input', markDirty);
    el.addEventListener('change', markDirty);
  });
  [featSw, worksPickSw, draftSw].forEach((sw) => { if (sw) sw.input.addEventListener('change', markDirty); });

  const submitBtn = h('button', { type: 'submit', class: 'btn btn--primary' }, isEdit ? '保存修改' : '创建作品');

  // 发布生命周期（item 2）：已存在作品在真实 Supabase 模式可显式「发布 / 下架」
  let pubState = existing ? existing.public !== false : false;
  const publishBtn = (isSupabase && isEdit)
    ? h('button', { type: 'button', class: 'btn' }, pubState ? '下架（取消公开）' : '发布到前台')
    : null;
  if (publishBtn) {
    publishBtn.addEventListener('click', async () => {
      try {
        if (pubState) { await repo.unpublishWork(existing.id); pubState = false; publishBtn.textContent = '发布到前台'; toast('已下架（取消公开）'); }
        else { await repo.publishWork(existing.id); pubState = true; publishBtn.textContent = '下架（取消公开）'; toast('已发布到前台'); }
        const refreshed = await repo.getById(existing.id);
        if (refreshed) Object.assign(existing, refreshed);
      } catch (e) { toast(`操作失败：${e.message || e}`); }
    });
  }

  const form = h('form', { class: 'form', on: { submit: async (e) => {
    e.preventDefault();
    if (isSaving) return;
    const title = titleI.value.trim();
    if (!title) { toast('请填写标题'); titleI.focus(); return; }
    // 未授权 / 会话过期 → 撤权回 login（#6）
    if (!auth.isAuthed()) { auth.logout && auth.logout(); location.hash = '#/admin/login'; return; }
    const payload = {
      title, intro: introI.value.trim(),
      // #1 修复：type 仅新建时传入。编辑现有作品时 type 已冻结，不得进入 update patch
      // （否则 repo.update 会因含 type 键而拒绝保存，导致现有作品永远无法保存）。
      ...(isEdit ? {} : { type: typeSel.value }),
      // 年份：留空（用户清空）保持 null，严禁自动推测/回填当前年份
      year: yearI.value.trim() === '' ? null : (Number(yearI.value) || null),
      stage: stageI.value.trim(), sort: Number(sortI.value) || 0,
      featured: featSw.input.checked,
      tags: tagsInput.get(),
      // C2 双维度独立字段
      homeFeaturedOrder: Number(homeFeaturedOrderI.value) || 0,
      worksPick: worksPickSw.input.checked,
      worksPickOrder: Number(worksPickOrderI.value) || 0,
      displaySize: displaySizeSel.value,
    };
    // #3 修复：判断漫画性质必须用「当前选择类型」或「现有作品类型」，不能用 payload.type
    // （编辑态 payload 不含 type，导致 existing comic 永不进入此分支、workNature 永不保存）。
    const isComicType = typeSel.value === 'comic' || (existing && existing.type === 'comic');
    if (isComicType) {
      // 未选择（''） → null；严禁把未确认性质默认保存为 original
      payload.workNature = natureSel.value === '' ? null : natureSel.value;
    }
    // C2 发布边界（#5 / #4 修复）：
    //   - 编辑态（isEdit）：两种模式都不传 public / is_public（Mock update 会拒绝 public 键 → 导致保存失败）。
    //   - 新建态（!isEdit）：两种模式都不传 public（Mock create 强制 public=false；Supabase create 强制 is_public=false）。
    //     即无论 Mock 还是 Supabase，新作恒不公开，由仓储层保证，UI 不自行决定公开状态。
    //   - 封面/多图：正式 Supabase 模式不接收（媒体留 C3）；仅 Mock 模式传 cover/images（本地回滚演示）。
    if (!isSupabase && !isEdit) {
      payload.cover = cover.value;
      if (payload.type !== 'comic') payload.images = imagesState.slice();
      if (draftSw && draftSw.input.checked) {
        payload.isDraft = true;
        payload.cover = null;
        payload.images = [];
      }
    } else if (!isSupabase && isEdit) {
      // 编辑态 Mock：仍传结构化媒体引用（仅 Demo，不触发 public），但不传 public 键
      payload.cover = cover.value;
      if (typeSel.value !== 'comic' && !(existing && existing.type === 'comic')) payload.images = imagesState.slice();
    }
    // 注意：Supabase 编辑态与新建态均不传 cover/images/public（C2 禁媒体写入 + 禁改公开状态）
    setSaving(true);
    try {
      let saved;
      if (isEdit) { saved = await repo.update(existing.id, payload); }
      else { saved = await repo.create(payload); }
      isDirty = false;
      setStatus('success', isEdit ? '已保存修改' : '已新增作品');
      toast(isEdit ? '已保存修改' : '已新增作品');
      if (payload.type === 'comic' && !isEdit) location.hash = `#/admin/comic/${saved.id}/pages`;
      else location.hash = '#/admin';
    } catch (err) {
      // 失败：保留表单值、不跳页、显式提示（#6）
      setStatus('failure', `保存失败：${err.message || err}`);
      toast(`保存失败：${err.message || err}`);
    } finally {
      setSaving(false);
    }
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
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '封面（可替换）'), coverPrev, coverUpload.el]),
    imagesSection,
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '标签（关键词，回车添加）'), tagsInput.el]),
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field field--row' }, [featSw.el, h('span', {}, '是否精选')]),
    ]),
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '排序权重（数字越大越靠前）'), sortI]),
    // —— C2 双维度独立区 ——
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, 'Home Featured Order（首页精选排序权重，仅当「是否精选」开启时生效）'), homeFeaturedOrderI]),
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field field--row' }, [worksPickSw.el, h('span', {}, 'Works Pick（作品库精选入口）')]),
      h('div', { class: 'field' }, [h('label', { class: 'field__label' }, 'Works Pick Order（作品库精选排序权重）'), worksPickOrderI]),
    ]),
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '展示尺寸（普通 / 竖版大图 / 横版通栏）'), displaySizeSel]),
    // C2 draft 创建开关（仅 Mock 新增时可用）
    (!isEdit && !isSupabase && draftSw) ? h('div', { class: 'field field--row' }, [draftSw.el, h('span', {}, '保存为无媒体草稿（不公开，封面/图片留空，可在后续补全）')]) : null,
    statusBar,
    h('div', { class: 'modal__actions', style: { justifyContent: 'flex-start', marginTop: '8px' } }, [
      submitBtn,
      // 发布生命周期（item 2）：已存在作品在真实 Supabase 模式可显式「发布 / 下架」
      (isSupabase && isEdit) ? publishBtn : null,
      h('a', { class: 'btn', href: '#/admin' }, '取消'),
    ]),
  ]);

  return adminLayout('new', h('div', {}, [
    h('div', { class: 'admin__head' }, [h('h1', {}, isEdit ? `编辑 · 《${existing.title}》` : '新增作品')]),
    isSupabase ? h('div', { class: 'notice' }, '已连接云端：封面 / 多图上传经 Storage + media_assets 写入，但上传后作品保持「草稿」不自动公开；管理员点「发布到前台」才正式公开，可「下架」取消公开（可重新发布）。媒体物理删除暂不开放。') : null,
    form,
  ]));
}

// C1 只读详情视图（Supabase 模式）：完整展示字段与媒体，无任何写入口
function renderReadOnly(w) {
  const field = (label, value) => h('div', { class: 'field' }, [
    h('label', { class: 'field__label' }, label),
    h('div', { class: 'readonly-value' }, value || '—'),
  ]);

  const media = h('div', { class: 'thumb-list' }, []);
  if (w.cover) media.appendChild(h('div', { class: 'thumb' }, [imgEl(w.cover, null, '封面')]));
  (w.images || []).forEach((src, i) => media.appendChild(h('div', { class: 'thumb' }, [imgEl(src, null, `图${i + 1}`)])));
  (w.pages || []).forEach((p) => media.appendChild(h('div', { class: 'thumb' }, [imgEl(p.image, null, `第${p.order}页`)])));

  return h('div', { class: 'form' }, [
    field('标题', w.title),
    field('类型', w.type),
    field('简介', w.intro),
    field('创作年份', (w.year != null && w.year !== '') ? String(w.year) : '—'),
    field('创作阶段', w.stage),
    field('作品性质', w.workNature || '—'),
    field('标签', (w.tags || []).join('、') || '—'),
    field('是否公开', w.public === false ? '否' : '是'),
    field('Home Featured（首页精选）', w.featured ? '是' : '—'),
    field('Home Featured Order（首页精选排序权重）', w.homeFeaturedOrder != null && w.homeFeaturedOrder !== 0 ? String(w.homeFeaturedOrder) : '—'),
    field('Works Pick（作品库精选入口）', w.worksPick ? '是' : '—'),
    field('Works Pick Order（作品库精选排序权重）', w.worksPickOrder != null && w.worksPickOrder !== 0 ? String(w.worksPickOrder) : '—'),
    field('展示尺寸', ({ standard: '普通', 'large-portrait': '竖版大图', 'wide-feature': '横版通栏' })[w.displaySize] || '普通'),
    field('排序权重', String(w.sort || 0)),
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '媒体'), media]),
  ]);
}
