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
import { PRIVATE_BUCKET } from '../../data/storage.supabase.js';

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
  let currentBlob = null;
  function setState(kind, msg) {
    stateEl.className = `upload-state upload-state--${kind}`;
    stateEl.textContent = msg || '';
  }
  function setPreview(src) {
    // revoke 旧 blob URL，避免内存泄漏 / 陈旧预览
    if (currentBlob && globalThis.URL && URL.revokeObjectURL) {
      try { URL.revokeObjectURL(currentBlob); } catch (_) { /* ignore */ }
    }
    currentBlob = null;
    currentSrc = src;
    previewEl.innerHTML = '';
    if (src) previewEl.appendChild(imgEl(src, null, '预览'));
  }
  function reset() {
    input.value = '';
    setState('waiting', '');
    previewEl.innerHTML = '';
    currentSrc = null;
    currentBlob = null;
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
      // 上传完成立即显示真实本地预览（blob URL），不依赖公开可读；F5 后由后台回读 signed URL 兜底。
      if (showPreview && file && globalThis.URL && URL.createObjectURL) {
        currentBlob = URL.createObjectURL(file);
        setPreview(currentBlob);
      }
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

/**
 * 后台私有媒体预览解析（AB 模型核心：B 后台必须能预览 private 草稿媒体）。
 * - private bucket（portfolio-private）且提供 path → 生成 Supabase Storage signed URL
 *   （仅用于 B 后台预览；A 公开前台绝对不得获取 signed URL）。
 * - public bucket 或未提供 path → 直接返回原 URL（public 资产公开可读）。
 * @param {string} value 公开 URL（public 资产）或任意可直接展示的 URL
 * @param {string|null} bucket 资产所在 bucket（来自 repo 返回的 meta：coverBucket / imagesMeta[].bucket / pages[].bucket / coverBucket）
 * @param {string|null} path 资产在 Storage 中的路径（用于生成 signed URL）
 * @returns {Promise<string|null>}
 */
export async function adminPreviewSrc(value, bucket, path) {
  if (bucket && bucket === PRIVATE_BUCKET && path) {
    try {
      return await storage.signedUrl(bucket, path);
    } catch (e) {
      // 开发期错误仅入 console，不向客户暴露；预览失败时返回 null，由调用方显示占位。
      console.error('[admin][preview] signedUrl 生成失败', e);
      return null;
    }
  }
  return value || null;
}
