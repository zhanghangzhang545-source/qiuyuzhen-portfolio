// ============================================================
// admin/certificateEdit.js — 证书结构化字段编辑（Phase 3-C2）
// ------------------------------------------------------------
// 独立页面：证书不进入通用作品编辑器（避免 type 被误改为插画/漫画/油画）。
// C2 仅开放结构化字段：title / year / year_start / year_end / category / is_public / sort_order。
// C2 边界：图片替换 / 删除留 C3（本页不提供媒体上传，仅保存结构化字段）。
// ============================================================
import { h } from '../../../core/dom.js';
import { repo, auth, DATA_MODE } from '../../../data/services.js';
import { toast } from '../../components/primitives.js';
import { adminLayout } from './layout.js';
import { mediaUploadControl, adminPreviewSrc } from '../../components/mediaUpload.js';
import { imgEl } from '../../components/media.js';

export async function adminCertificateEditView(params) {
  if (DATA_MODE.value === 'supabase') {
    await auth.ensureSession();
  }
  if (!auth.isAuthed()) { location.hash = '#/admin/login'; return h('div', {}); }

  const isSupabase = DATA_MODE.value === 'supabase';
  const cert = params.id ? await repo.getById(params.id) : null;
  if (!cert || cert.type !== 'certificate') {
    return adminLayout('dashboard', h('div', {}, [
      h('div', { class: 'admin__head' }, [h('h1', {}, '证书不存在')]),
      h('div', { class: 'notice' }, '未找到该证书，或该 ID 不是证书类型。'),
      h('a', { class: 'btn', href: '#/admin' }, '返回仪表盘'),
    ]));
  }

  // C3：证书图片预览 + 替换（replaceCertificateImage：repaint media_asset_id；旧资产 + Storage 文件保留，不物理删除；不改动结构化字段）
  const certCoverPrev = h('div', { class: 'thumb', style: { width: '160px' } });
  const certMeta = { bucket: cert.coverBucket || null, path: cert.coverPath || null };
  // 后台预览：private 草稿媒体用 signed URL，public 资产直接用公开 URL（F5 / 退出重登后仍能正常显示）。
  async function renderCertCover() {
    certCoverPrev.innerHTML = '';
    const src = await adminPreviewSrc(cert.cover, certMeta.bucket, certMeta.path);
    if (src) certCoverPrev.appendChild(imgEl(src, null, cert.title));
  }
  if (cert.cover) renderCertCover();
  const certReplace = mediaUploadControl({
    label: '替换证书图片',
    onUpload: async (file) => {
      const updated = await repo.replaceCertificateImage(cert.id, file);
      Object.assign(cert, updated);
      if (updated.coverBucket) certMeta.bucket = updated.coverBucket;
      if (updated.coverPath) certMeta.path = updated.coverPath;
      renderCertCover();
    },
    onError: () => {},
  });
  if (cert.cover) {
    adminPreviewSrc(cert.cover, certMeta.bucket, certMeta.path).then((src) => { if (src) certReplace.setPreview(src); });
  }

  // —— 结构化字段输入 ——
  const titleI = h('input', { type: 'text', value: cert.title || '', placeholder: '证书名称' });
  const yearI = h('input', { type: 'number', value: cert.year ?? '', placeholder: '年份（可空）' });
  const yearStartI = h('input', { type: 'number', value: cert.yearStart ?? '', placeholder: '起始年份（可空）' });
  const yearEndI = h('input', { type: 'number', value: cert.yearEnd ?? '', placeholder: '结束年份（可空）' });
  const categoryI = h('input', { type: 'text', value: cert.category || '', placeholder: '类别（如：认证 / 奖项 / 展览）' });
  const sortI = h('input', { type: 'number', value: cert.sort ?? 0 });
  const pubSw = (() => {
    const input = h('input', { type: 'checkbox', checked: cert.public !== false });
    const sw = h('label', { class: 'switch' }, [input, h('span', { class: 'switch__track' }), h('span', { class: 'switch__thumb' })]);
    return { el: sw, input };
  })();

  // —— #6 写状态机：dirty / saving / success / failure / unauthorized ——
  const statusBar = h('div', { class: 'form-status', 'aria-live': 'polite' });
  let isDirty = false;
  let isSaving = false;
  const submitBtn = h('button', { type: 'submit', class: 'btn btn--primary' }, '保存证书字段');
  const markDirty = () => {
    if (isSaving) return;
    if (!isDirty) { isDirty = true; statusBar.textContent = '未保存修改'; statusBar.className = 'form-status form-status--dirty'; }
  };
  const setSaving = (on) => {
    isSaving = on;
    submitBtn.disabled = on;
    submitBtn.textContent = on ? '保存中…' : '保存证书字段';
    if (on) { statusBar.textContent = '保存中…'; statusBar.className = 'form-status form-status--saving'; }
  };
  const setStatus = (kind, msg) => {
    statusBar.textContent = msg;
    statusBar.className = `form-status form-status--${kind}`;
  };
  [titleI, yearI, yearStartI, yearEndI, categoryI, sortI, pubSw.input].forEach((el) => {
    if (!el) return;
    el.addEventListener('input', markDirty);
    el.addEventListener('change', markDirty);
  });

  const form = h('form', { class: 'form', on: { submit: async (e) => {
    e.preventDefault();
    const title = titleI.value.trim();
    if (!title) { toast('请填写证书名称'); titleI.focus(); return; }
    // 未授权 / 会话过期 → 撤权回 login（#6）
    if (!auth.isAuthed()) { auth.logout && auth.logout(); location.hash = '#/admin/login'; return; }
    const patch = {
      title,
      year: yearI.value.trim() === '' ? null : (Number(yearI.value) || null),
      yearStart: yearStartI.value.trim() === '' ? null : (Number(yearStartI.value) || null),
      yearEnd: yearEndI.value.trim() === '' ? null : (Number(yearEndI.value) || null),
      category: categoryI.value.trim(),
      sort: Number(sortI.value) || 0,
      public: pubSw.input.checked,
    };
    setSaving(true);
    try {
      await repo.updateCertificate(cert.id, patch);
      isDirty = false;
      setStatus('success', '已保存证书字段');
      toast('已保存证书字段');
      location.hash = '#/admin';
    } catch (err) {
      // #6：401 / RLS / 会话失效（is_admin 失败）→ 重确认会话并跳转 login
      if (/row-level security|is_admin|401|未授权|会话/.test(err.message || '')) {
        setStatus('unauthorized', '会话已失效或权限不足，请重新登录');
        toast('保存失败：权限不足，请重新登录');
        auth.logout && auth.logout();
        location.hash = '#/admin/login';
      } else {
        // 其它失败（含字段校验拒绝）：保留表单值、显式失败态，不跳页
        setStatus('failure', `保存失败：${err.message || err}`);
        toast(`保存失败：${err.message || err}`);
      }
    } finally {
      setSaving(false);
    }
  } } }, [
    h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '证书图片（可替换）'), certCoverPrev, certReplace.el]),
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '证书名称'), titleI]),
      h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '类别'), categoryI]),
    ]),
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '年份'), yearI]),
      h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '起始年份'), yearStartI]),
      h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '结束年份'), yearEndI]),
    ]),
    h('div', { class: 'form-grid' }, [
      h('div', { class: 'field' }, [h('label', { class: 'field__label' }, '排序权重'), sortI]),
      h('div', { class: 'field field--row' }, [pubSw.el, h('span', {}, '在「关于」页展示')]),
    ]),
    statusBar,
    h('div', { class: 'modal__actions', style: { justifyContent: 'flex-start', marginTop: '8px' } }, [
      submitBtn,
      h('a', { class: 'btn', href: '#/admin' }, '取消'),
    ]),
  ]);

  return adminLayout('dashboard', h('div', {}, [
    h('div', { class: 'admin__head' }, [
      h('h1', {}, `编辑证书 · ${cert.title}`),
      isSupabase ? h('span', { class: 'badge badge--live' }, '已连接云端') : h('span', { class: 'badge badge--readonly' }, '本地预览模式'),
    ]),
    isSupabase ? h('div', { class: 'notice' }, '已连接云端：仅保存结构化字段（名称 / 年份 / 类别 / 排序 / 展示）。证书图片支持替换（底层原图保留备份）。') : null,
    form,
  ]));
}
