// ============================================================
// admin/workEdit.js — 新增 / 编辑作品（封面、多图、标签、开关等）
// 漫画类型保存后跳转到“漫画页管理”进行批量上传与排序。
// ============================================================
import { h } from '../../../core/dom.js';
import { repo, auth, DATA_MODE } from '../../../data/services.js';
import { imgEl } from '../../components/media.js';
import { toast, clientError } from '../../components/primitives.js';
import { adminLayout } from './layout.js';
import { WORK_TYPES, STAGES } from '../../../data/types.js';
import { mediaUploadControl, adminPreviewSrc } from '../../components/mediaUpload.js';

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

  // FINAL16.1：新建态（!isEdit）媒体暂存于浏览器内存（pendingCoverFile / pendingImageFiles[]），
  // 仅 blob URL 本地预览，绝不提前写 Supabase；创建成功后再自动上传。
  const pendingImageFiles = []; // [{ file, url }]
  let pendingCoverFile = null;

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
  const coverMeta = { bucket: existing?.coverBucket || null, path: existing?.coverPath || null };
  const coverPrev = h('div', { class: 'thumb', style: { width: '120px' } });
  // 后台预览：private 草稿媒体用 signed URL，public 资产直接用公开 URL（F5 / 退出重登后仍能正常显示）。
  async function renderCover() {
    coverPrev.innerHTML = '';
    const src = await adminPreviewSrc(cover.value, coverMeta.bucket, coverMeta.path);
    if (src) coverPrev.appendChild(imgEl(src, null, '封面'));
  }
  if (cover.value) renderCover();

  // C3：封面上传控件。编辑态=替换封面（写 Supabase）；新建态=选择封面（仅存内存 + blob 预览）。
  const coverUpload = mediaUploadControl({
    label: isEdit ? '替换封面' : '选择封面图片',
    onUpload: async (file) => {
      if (isEdit) {
        // 两阶段创建：新作品尚未生成 id 前，严禁访问 existing.id，转中文提示
        if (!existing || !existing.id) {
          const msg = '作品尚未创建，请先保存基础信息后再上传图片。';
          toast(msg);
          throw new Error(msg);
        }
        try {
          toast('正在上传封面…'); // P0-8：长操作立即反馈
          const updated = await repo.uploadWorkCover(existing.id, file);
          cover.value = updated.cover;
          if (updated.coverBucket) coverMeta.bucket = updated.coverBucket;
          if (updated.coverPath) coverMeta.path = updated.coverPath;
          Object.assign(existing, updated);
          // 即时本地预览（blob）+ 后台 signed URL 兜底预览（F5 后仍能显示）
          if (file && globalThis.URL && URL.createObjectURL) coverUpload.setPreview(URL.createObjectURL(file));
          await renderCover();
        } catch (err) {
          throw new Error('封面上传失败，请检查网络后重试。');
        }
      } else {
        // 新建态：仅存入内存 + 组件自动 blob 预览，绝不提前写 Supabase
        pendingCoverFile = file;
      }
    },
    onError: () => {},
  });
  // 既有封面：用 signed URL（private）或公开 URL（public）回填上传控件预览。
  if (cover.value) {
    adminPreviewSrc(cover.value, coverMeta.bucket, coverMeta.path).then((src) => { if (src) coverUpload.setPreview(src); });
  }

  // 多图状态（携带 bucket/path 元信息，供后台 signed URL 预览 / 删除时定位资产）
  // P0-11：imagesMeta 携带稳定 id / assetId / sortOrder；图片身份绝不再用 URL。
  const _metaFromWork = (w) => (
    (w?.imagesMeta && w.imagesMeta.length)
      ? w.imagesMeta.map((m) => ({ id: m.id, assetId: m.assetId ?? null, sortOrder: m.sortOrder ?? 0, url: m.url, bucket: m.bucket ?? null, path: m.path ?? null }))
      : (w?.images || []).map((u, i) => ({ id: `img-${i}`, url: u, assetId: null, sortOrder: i, bucket: null, path: null }))
  );
  const imagesState = existing ? _metaFromWork(existing).slice() : [];
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

  // C3：作品多图管理（仅非漫画作品）。支持上传新图 + ↑/↓ 调整顺序 + 单张删除（P0-2）。
  const imgListWrap = h('div', { class: 'thumb-list' });
  // 图片删除状态（P0-5：删除中 / 删除成功 / 删除失败，仅中文提示）
  const imgDelStatus = h('div', { class: 'form-status', 'aria-live': 'polite' });
  const imgUpload = mediaUploadControl({
    label: '添加作品图片',
    showPreview: false, // 预览统一走下方 pendingImgListWrap / 编辑态 imgListWrap，避免控件内重复预览
    onUpload: async (file) => {
      if (isEdit) {
        // 两阶段创建：新作品尚未生成 id 前，严禁访问 existing.id，转中文提示
        if (!existing || !existing.id) {
          const msg = '作品尚未创建，请先保存基础信息后再上传图片。';
          toast(msg);
          throw new Error(msg);
        }
        try {
          toast('正在上传作品图片…'); // P0-8：长操作立即反馈
          const updated = await repo.addWorkImage(existing.id, file);
          // FINAL16.3-SIMPLE：本地追加新图（稳定 id 来自服务端返回，避免完整 getById）。
          if (updated && updated.image) {
            imagesState.push({
              id: updated.image.id,
              assetId: updated.image.assetId ?? null,
              sortOrder: imagesState.length + 1,
              url: updated.image.url,
              bucket: updated.image.bucket ?? null,
              path: updated.image.path ?? null,
            });
          }
          renderImages();
          Object.assign(existing, updated);
        } catch (err) {
          throw new Error('作品图片上传失败，请检查网络后重试。');
        }
      } else {
        // 新建态：仅存入内存 + blob 预览，绝不提前写 Supabase
        const url = (globalThis.URL && URL.createObjectURL) ? URL.createObjectURL(file) : null;
        pendingImageFiles.push({ file, url });
        renderPendingImages();
      }
    },
    onError: () => {},
  });
  // 新建态：待上传图片本地预览列表（内存态，不写 Supabase；可逐个移除）
  const pendingImgListWrap = h('div', { class: 'thumb-list' });
  function renderPendingImages() {
    pendingImgListWrap.innerHTML = '';
    pendingImageFiles.forEach((item, i) => {
      const thumb = h('div', { class: 'thumb' }, [
        item.url ? imgEl(item.url, null, `图${i + 1}`) : h('div', { class: 'thumb__fail' }, '预览失败'),
        h('button', { class: 'thumb__del', title: '移除这张待上传图片', type: 'button' }, '×'),
      ]);
      const del = thumb.querySelector('.thumb__del');
      if (del) del.addEventListener('click', () => {
        if (item.url && globalThis.URL && URL.revokeObjectURL) { try { URL.revokeObjectURL(item.url); } catch (_) { /* ignore */ } }
        const idx = pendingImageFiles.indexOf(item);
        if (idx >= 0) pendingImageFiles.splice(idx, 1);
        renderPendingImages();
      });
      pendingImgListWrap.appendChild(thumb);
    });
  }

  let imgBusy = false; // P0-28：图片区异步操作期间统一禁用交互，防双击/重复请求
  async function renderImages() {
    imgListWrap.innerHTML = '';
    // #8：并行取得所有预览 URL（signed URL 自身有内存缓存），最后严格按 imagesState 原顺序渲染（不再串行 await）。
    const srcs = await Promise.all(imagesState.map((m) => adminPreviewSrc(m.url, m.bucket, m.path)));
    imagesState.forEach((meta, i) => {
      const src = srcs[i];
      const ctrls = [];
      const setRowBusy = (on) => ctrls.forEach((c) => { if (c) c.disabled = on; });
      const move = async (from, to) => {
        if (imgBusy) return;
        if (to < 0 || to >= imagesState.length) return;
        // 两阶段创建：尚未创建 id 时绝不访问 existing.id
        if (!existing || !existing.id) { toast('作品尚未创建，请先保存基础信息后再调整顺序。'); return; }
        const order = imagesState.slice();
        [order[from], order[to]] = [order[to], order[from]];
        imgBusy = true; setRowBusy(true);
        try {
          // P0-11：以稳定 id 排序，不再用 URL；FINAL16.3-SIMPLE：本地重排（不回读）。
          const updated = await repo.adjustImageSort(existing.id, order.map((m) => m.id));
          imagesState.length = 0; order.forEach((m) => imagesState.push(m)); // 本地重排，保持相对顺序
          Object.assign(existing, updated);
          renderImages();
          imgBusy = false; // 操作完成释放忙锁（重建后的新控件本身已启用）
          toast('顺序已更新');
        } catch (err) {
          toast(`排序失败：${err.message || err}`);
          setRowBusy(false); imgBusy = false;
        }
      };
      // C3/FINAL16.3-SIMPLE：原位替换单图（repaint media_asset_id；保留位置，P0-12/13/14）；本地原位替换（不回读）。
      const replaceCtl = mediaUploadControl({
        label: '替换', showPreview: false,
        onUpload: async (file) => {
          if (imgBusy) return;
          if (!existing || !existing.id) { toast('作品尚未创建，请先保存基础信息后再替换图片。'); return; }
          imgBusy = true; setRowBusy(true);
          try {
            const updated = await repo.replaceWorkImage(meta.id, file);
            // 本地原位替换（稳定 id 不变，仅刷 URL/bucket/path）
            if (updated && updated.image) {
              const idx = imagesState.findIndex((m) => m.id === updated.image.id);
              if (idx >= 0) {
                imagesState[idx] = { ...imagesState[idx], url: updated.image.url, bucket: updated.image.bucket ?? null, path: updated.image.path ?? null, assetId: updated.image.assetId ?? null };
              }
            }
            Object.assign(existing, updated);
            renderImages();
            imgBusy = false; // 操作完成释放忙锁
            toast('已替换该图片');
          } catch (err) {
            toast(`替换失败：${err.message || err}`);
            setRowBusy(false); imgBusy = false;
          }
        },
        onError: () => {},
      });
      const delBtn = h('button', { class: 'thumb__del', title: '删除此图片（底层原图将保留备份）' }, '×');
      ctrls.push(delBtn);
      delBtn.addEventListener('click', async () => {
        if (imgBusy) return;
        if (!globalThis.confirm('确定删除这张作品图片吗？\n该操作不可撤销，底层原图将保留备份；若已发布到前台，A 端将同步消失。')) return;
        imgBusy = true; setRowBusy(true);
        imgDelStatus.textContent = '删除中…';
        imgDelStatus.className = 'form-status form-status--saving';
        try {
          // P0-11：以稳定 id 删除，不再用 URL；FINAL16.3-SIMPLE：本地删除该稳定 id + 重规范化本地 sortOrder（不回读）。
          const updated = await repo.removeWorkImage(existing.id, meta.id);
          const idx = imagesState.findIndex((m) => m.id === meta.id);
          if (idx >= 0) imagesState.splice(idx, 1);
          imagesState.forEach((m, k) => { m.sortOrder = k + 1; }); // 本地连续规范化
          Object.assign(existing, updated);
          imgDelStatus.textContent = '删除成功';
          imgDelStatus.className = 'form-status form-status--success';
          toast('已删除该图片');
          renderImages();
          imgBusy = false; // 操作完成释放忙锁
        } catch (err) {
          imgDelStatus.textContent = `删除失败：${err.message || err}`;
          imgDelStatus.className = 'form-status form-status--failure';
          toast(`删除失败：${err.message || err}`);
          setRowBusy(false); imgBusy = false;
        }
      });
      const upBtn = h('button', { title: '上移', on: { click: () => move(i, i - 1) } }, '↑');
      const downBtn = h('button', { title: '下移', on: { click: () => move(i, i + 1) } }, '↓');
      ctrls.push(upBtn, downBtn);
      imgListWrap.appendChild(h('div', { class: 'thumb' }, [
        src ? imgEl(src, null, `图${i + 1}`) : h('div', { class: 'thumb__fail' }, '图片加载失败'),
        h('div', { class: 'thumb__move' }, [upBtn, downBtn]),
        replaceCtl.el,
        delBtn,
      ]));
    });
  }
  renderImages();

  const imagesSection = h('div', { class: 'field' }, [
    h('label', { class: 'field__label' }, '作品图片（可先选择图片；创建后可继续排序 / 替换 / 删除）'),
    imgListWrap,
    imgDelStatus,
    // FINAL16.1：新建态也展示真实可点击上传入口 + 内存预览列表（不再用 notice 替代）
    imgUpload.el,
    pendingImgListWrap,
  ]);

  // —— 危险操作区（P0-3）：删除整个作品 ——
  // 仅管理员可触发；二次确认显示标题；若已公开先安全下架；删关联 + 删 works 记录；
  // 底层原媒体（Storage + media_assets）保留备份；删除后 A 立即消失，不留死链 / 幽灵记录。
  const delStatus = h('div', { class: 'form-status', 'aria-live': 'polite' });
  const delWorkBtn = isEdit ? h('button', { type: 'button', class: 'btn btn--danger' }, '删除作品') : null;
  if (delWorkBtn) {
    delWorkBtn.addEventListener('click', async () => {
      const title = existing?.title || '该作品';
      if (!globalThis.confirm(`确定删除作品《${title}》吗？\n此操作不可撤销：作品及其全部封面 / 图片 / 漫画页将从后台与前台一并移除（底层原图保留备份）。`)) return;
      try {
        delStatus.textContent = '删除中…';
        delStatus.className = 'form-status form-status--saving';
        delWorkBtn.disabled = true;
        await repo.remove(existing.id);
        toast('作品已删除');
        location.hash = '#/admin';
        return;
      } catch (err) {
        console.error('[workEdit] 删除失败', err);
        const msg = clientError(err);
        delStatus.textContent = `删除失败：${msg}`;
        delStatus.className = 'form-status form-status--failure';
        delWorkBtn.disabled = false;
        toast(`删除失败：${msg}`);
      }
    });
  }
  const dangerSection = (isEdit && delWorkBtn) ? h('div', { class: 'field danger-zone' }, [
    h('label', { class: 'field__label' }, '危险操作区'),
    h('p', { class: 'secondary' }, '删除作品将一并移除其全部封面 / 图片 / 漫画页（前台同步消失，底层原图保留备份）。此操作不可撤销。'),
    delStatus,
    delWorkBtn,
  ]) : null;

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
  // P1-15：插画/油画已选待上传图片后切到漫画 → 弹确认清空 pending，取消则恢复类型。
  function clearPendingImages() {
    for (const item of pendingImageFiles) {
      if (item.url && globalThis.URL && URL.revokeObjectURL) { try { URL.revokeObjectURL(item.url); } catch (_) { /* ignore */ } }
    }
    pendingImageFiles.length = 0;
    renderPendingImages();
  }
  typeSel.addEventListener('change', () => {
    if (typeSel.value === 'comic' && pendingImageFiles.length > 0) {
      const ok = globalThis.confirm('漫画正文图片需要在漫画页管理中上传。切换为漫画将清空当前待上传作品图片，是否继续？');
      if (!ok) { typeSel.value = (existing && existing.type === 'comic') ? 'comic' : 'illustration'; }
      else { clearPendingImages(); }
    }
    toggleTypeFields();
  });
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
    if (!isDirty) {
      isDirty = true;
      statusBar.textContent = '未保存修改';
      statusBar.className = 'form-status form-status--dirty';
      // P0-7：存在未保存修改时禁用「发布 / 下架」，避免把旧状态发布出去；提示先保存。
      if (publishBtn) { publishBtn.disabled = true; publishBtn.title = '请先保存修改后再发布'; }
    }
  };
  const setSaving = (on) => {
    isSaving = on;
    submitBtn.disabled = on;
    submitBtn.textContent = on ? '保存中…' : (isEdit ? '保存修改' : '创建作品');
    if (on) {
      statusBar.textContent = '保存中…';
      statusBar.className = 'form-status form-status--saving';
    } else if (publishBtn) {
      // 保存完成：是否禁用发布取决于是否仍有未保存修改
      publishBtn.disabled = isDirty;
      publishBtn.title = isDirty ? '请先保存修改后再发布' : '';
    }
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
      if (publishBtn.disabled) return; // P0-9：防双击（操作期间禁用）
      const wasPublic = pubState;
      publishBtn.disabled = true;
      publishBtn.textContent = wasPublic ? '下架中…' : '发布中…'; // P0-8：长操作立即反馈
      try {
        // P0-6：发布/下架使用返回值直接刷新本地状态，杜绝成功后再 getById 的重复读。
        const updated = wasPublic
          ? await repo.unpublishWork(existing.id)
          : await repo.publishWork(existing.id);
        if (updated) Object.assign(existing, updated);
        pubState = !wasPublic;
        publishBtn.textContent = pubState ? '下架（取消公开）' : '发布到前台';
        toast(pubState ? '已发布到前台' : '已下架（取消公开）');
      } catch (e) {
        console.error('[workEdit] 发布/下架失败', e);
        publishBtn.textContent = wasPublic ? '下架（取消公开）' : '发布到前台';
        toast(clientError(e)); // P0-13：技术错误不外泄
      } finally {
        publishBtn.disabled = isDirty;
        publishBtn.title = isDirty ? '请先保存修改后再发布' : '';
      }
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
      if (isEdit) {
        // P0-1：编辑态保存走快速路径——只执行 works UPDATE，成功即返回最小结果，禁止再读取全部媒体（省 N 次请求）。
        //       成功后保持编辑页（不跳 Dashboard），本地合并 payload 到 existing，重新启用「发布到前台」。
        saved = await repo.update(existing.id, payload, { hydrate: false });
      } else {
        // P0-2：新建只取 saved.id，绝不 hydrate（省 N 次请求）；后续编辑页首读即可拿到完整数据。
        //       autoPublish:false 复用「新作恒为草稿」已知状态，避免重复 _parentIsPublic 读。
        saved = await repo.create(payload, { hydrate: false });
        // ===== FINAL16.1：新建态自动上传 pending 媒体（不重复创建作品；失败保留已成功图片并进入编辑页）=====
        const isComicType = typeSel.value === 'comic';
        let mediaFailed = false;
        // 1) 封面（漫画 / 非漫画都先传封面）
        if (pendingCoverFile) {
          try { toast('正在上传封面…'); await repo.uploadWorkCover(saved.id, pendingCoverFile, { hydrate: false, autoPublish: false }); }
          catch (e) { mediaFailed = true; console.error('[new] 封面上传失败', e); }
        }
        // 2) 非漫画：按客户选择顺序逐张 await 上传，禁止 Promise.all（避免顺序被上传速度打乱）
        if (!isComicType) {
          for (let i = 0; i < pendingImageFiles.length; i++) {
            const item = pendingImageFiles[i];
            try { toast(`正在上传作品图片 ${i + 1}/${pendingImageFiles.length}…`); await repo.addWorkImage(saved.id, item.file, { hydrate: false, autoPublish: false }); }
            catch (e) { mediaFailed = true; console.error('[new] 图片上传失败', e); }
          }
        }
        isDirty = false;
        setStatus('success', '已新增作品');
        toast('已新增作品');
        if (mediaFailed) toast('作品已创建，但部分图片上传失败，请补传未完成图片');
        // 无论媒体是否部分失败，均进入已创建作品编辑页（已成功图片保留）；漫画进入漫画页管理
        if (isComicType) location.hash = `#/admin/comic/${saved.id}/pages`;
        else location.hash = `#/admin/work/${saved.id}/edit`;
        return;
      }
      // P0-1：编辑态保存成功——保持编辑页（不跳 Dashboard），本地合并、重新启用发布按钮（setSaving(false) 处理）。
      isDirty = false;
      setStatus('success', '已保存修改');
      toast('已保存修改');
      if (isEdit) {
        Object.assign(existing, payload);
      } else if (payload.type === 'comic') location.hash = `#/admin/comic/${saved.id}/pages`;
      else location.hash = `#/admin/work/${saved.id}/edit`;
    } catch (err) {
      // 失败：保留表单值、不跳页、显式提示（#6）；P0-13：技术错误不外泄。
      console.error('[workEdit] 保存失败', err);
      const msg = clientError(err);
      setStatus('failure', `保存失败：${msg}`);
      toast(`保存失败：${msg}`);
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
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, isEdit ? '封面（可替换）' : '封面（创建作品后上传）'), coverPrev, coverUpload.el]),
    imagesSection,
    dangerSection,
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '标签（关键词，回车添加）'), tagsInput.el]),
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field field--row' }, [featSw.el, h('span', {}, '是否精选')]),
    ]),
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '排序权重（数字越大越靠前）'), sortI]),
    // —— C2 双维度独立区 ——
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '首页精选排序权重（仅当开启「是否精选」时生效）'), homeFeaturedOrderI]),
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field field--row' }, [worksPickSw.el, h('span', {}, '作品库精选')]),
      h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '作品库精选排序权重'), worksPickOrderI]),
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
    isSupabase ? h('div', { class: 'notice' }, '已连接云端：封面 / 多图上传经 Storage + media_assets 写入，上传后作品保持「草稿」不自动公开；管理员点「发布到前台」才正式公开，可「下架」取消公开（可重新发布）。支持上传 / 替换 / 排序 / 删除（含整作品、单张图片、漫画页；底层原图保留备份）。') : null,
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
    field('首页精选', w.featured ? '是' : '—'),
    field('首页精选排序权重', w.homeFeaturedOrder != null && w.homeFeaturedOrder !== 0 ? String(w.homeFeaturedOrder) : '—'),
    field('作品库精选', w.worksPick ? '是' : '—'),
    field('作品库精选排序权重', w.worksPickOrder != null && w.worksPickOrder !== 0 ? String(w.worksPickOrder) : '—'),
    field('展示尺寸', ({ standard: '普通', 'large-portrait': '竖版大图', 'wide-feature': '横版通栏' })[w.displaySize] || '普通'),
    field('排序权重', String(w.sort || 0)),
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '媒体'), media]),
  ]);
}
