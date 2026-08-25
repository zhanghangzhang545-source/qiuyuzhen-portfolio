// ============================================================
// mediaUpload.js — Phase 3-C3 媒体上传控件（4 态：waiting / uploading / success / failed）
// ------------------------------------------------------------
// 复用：bindFileDrop（点击/拖拽统一走 onFiles）+ imgEl（预览）。
// 安全纪律（与 repository.supabase._validateUploadFile 一致）：
//   ❌ 拒绝空文件（size=0）、非 jpg/png/webp、超 10MB（客户端前置校验，服务端再校验）。
//   ✅ 上传经 services.storage（mock ↔ supabase）；写关联经 services.repo（含管理闸门与回滚）。
//   ❌ 不直接删除 Storage 对象；失败由 repository 内部回滚，UI 仅展示失败态。
// ============================================================
import { h } from '../../core/dom.js';
import { imgEl } from './media.js';
import { toast } from './primitives.js';
import { storage, repo, auth, DATA_MODE } from '../../data/services.js';

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/** 客户端前置校验：返回 { ok, error } */
export function validateFile(file) {
  if (!file) return { ok: false, error: '未选择文件' };
  if (!(file.size > 0)) return { ok: false, error: '文件为空，拒绝上传' };
  if (!ALLOWED_MIME.includes(file.type)) return { ok: false, error: `不支持的格式（${file.type || '未知'}），仅 jpg/png/webp` };
  if (file.size > MAX_FILE_SIZE) return { ok: false, error: `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），上限 10MB` };
  return { ok: true, error: null };
}

/**
 * 通用上传控件工厂。
 * @param {Object} opts
 * @param {string} opts.label                按钮/区域文案
 * @param {string} opts.accept               input accept（默认 image/jpeg,image/png,image/webp）
 * @param {(file:File)=>Promise<*>} opts.onUpload  上传成功回调（已通过 services.storage + repo 完成写入）
 * @param {(err:Error)=>void} [opts.onError]         失败回调（可选）
 * @param {boolean} [opts.showPreview]       是否显示上传后预览（默认 true）
 * @returns {{ el: HTMLElement, reset:()=>void, setPreview:(src:string)=>void }}
 */
export function mediaUploadControl(opts = {}) {
  const { label = '上传图片', onUpload, onError } = opts;
  const accept = opts.accept || 'image/jpeg,image/png,image/webp';
  const showPreview = opts.showPreview !== false;

  const input = h('input', { type: 'file', accept, style: { display: 'none' } });
  const drop = h('div', { class: 'file-drop' }, [
    h('div', { class: 'file-drop__hint' }, [
      h('span', { class: 'file-drop__icon' }, '⬆'),
      h('span', {}, label),
      h('span', { class: 'file-drop__sub' }, '支持 jpg / png / webp，单张 ≤ 10MB'),
    ]),
  ]);
  const stateEl = h('div', { class: 'upload-state', 'aria-live': 'polite' });
  const previewEl = h('div', { class: 'thumb', style: { width: '120px' } });

  const wrap = h('div', { class: 'media-upload' }, [drop, input, stateEl, showPreview ? previewEl : null]);

  let currentSrc = null;
  function setState(kind, msg) {
    stateEl.className = `upload-state upload-state--${kind}`;
    stateEl.textContent = msg || '';
  }
  function setPreview(src) {
    currentSrc = src;
    previewEl.innerHTML = '';
    if (src) previewEl.appendChild(imgEl(src, null, '预览'));
  }
  function reset() {
    input.value = '';
    setState('waiting', '');
    previewEl.innerHTML = '';
    currentSrc = null;
  }

  async function handleFiles(files) {
    const file = files && (files[0] || files);
    if (!file) return;
    // 未授权 → 撤权回 login（与后台其它写一致）
    if (!auth.isAuthed()) { auth.logout && auth.logout(); location.hash = '#/admin/login'; return; }
    const v = validateFile(file);
    if (!v.ok) { setState('failed', v.error); toast(v.error); return; }
    setState('uploading', '上传中…');
    try {
      await onUpload(file);
      setState('success', '上传成功');
      if (showPreview) setPreview(URL.createObjectURL ? '' : '');
      toast('上传成功');
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      setState('failed', `上传失败：${msg}`);
      toast(`上传失败：${msg}`);
      onError && onError(err);
    }
  }

  // 点击/拖拽统一入口
  drop.addEventListener('click', (e) => { if (e.target === input) return; input.click(); });
  input.addEventListener('change', () => handleFiles(input.files));
  // 复用既有 bindFileDrop（点击隐藏 input + 拖拽）
  // 注意：bindFileDrop 也会绑定 click，这里避免双触发 —— 仅用其拖拽部分；点击已上方处理。
  bindDragOnly(drop, input, handleFiles);

  return { el: wrap, reset, setPreview, getPreview: () => currentSrc };
}

// 仅绑定拖拽（点击由上方显式处理，避免 bindFileDrop 的 click → input.click 回环）
function bindDragOnly(dropEl, inputEl, onFiles) {
  let depth = 0;
  dropEl.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; dropEl.classList.add('is-drag'); });
  dropEl.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  dropEl.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (depth === 0) dropEl.classList.remove('is-drag'); });
  dropEl.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    dropEl.classList.remove('is-drag');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) onFiles(files);
  });
}
