// ============================================================
// primitives.js — 复用原子：分类标签 / 空状态 / 确认弹窗 / Toast
// ============================================================
import { h, raw } from '../../core/dom.js';
import { typeName, typeColor } from '../../data/types.js';

export function catTag(type) {
  return h('span', { class: 'tag tag--cat', style: { background: typeColor(type) } }, typeName(type));
}

export function emptyState(title, desc, actionNode) {
  return h('div', { class: 'empty' }, [
    h('h3', { class: 'display' }, title),
    desc ? h('p', {}, desc) : null,
    actionNode ? h('div', { style: { marginTop: '20px' } }, actionNode) : null,
  ]);
}

/** 确认弹窗（非裸表单，带遮罩与操作） */
export function confirmModal({ title, message, okText = '确定', danger = false, onOk }) {
  const overlay = h('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  const ok = h('button', {
    class: danger ? 'btn btn--danger' : 'btn btn--primary',
    on: { click: () => { close(); onOk && onOk(); } },
  }, okText);
  const cancel = h('button', { class: 'btn', on: { click: close } }, '取消');
  overlay.appendChild(h('div', { class: 'modal' }, [
    h('div', { class: 'modal__title' }, title),
    h('p', { class: 'secondary' }, message),
    h('div', { class: 'modal__actions' }, [cancel, ok]),
  ]));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  return overlay;
}

let toastWrap = null;
export function toast(msg) {
  if (!toastWrap || !document.body.contains(toastWrap)) {
    toastWrap = h('div', { class: 'toast-wrap' });
    document.body.appendChild(toastWrap);
  }
  const t = h('div', { class: 'toast' }, msg);
  toastWrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 2400);
}

/**
 * P0-13：客户错误与开发错误彻底分离。
 * 完整技术错误（PGRST / SQL / RPC signature / code / details / hint / Cannot read properties）
 * 一律不得直接展示给客户——仅返回安全的中文提示；完整错误由调用方 `console.error` 记录。
 * 已知「客户友好中文」（如「请先上传封面再发布」）不含技术标识，原样返回。
 * @param {Error|string} err
 * @returns {string} 可安全展示给客户的提示
 */
const TECH_MARK = /PGRST|SQLSTATE|code:\s*\S|Cannot read|is not a function|undefined is not|RPC |violates|duplicate key|signature|详情：|提示：|hint:/i;
export function clientError(err) {
  const raw = err && err.message ? err.message : String(err == null ? '' : err);
  // 已是安全中文（不含技术标识） → 原样返回
  if (!TECH_MARK.test(raw)) return raw || '操作失败，请稍后重试';
  // 含技术标识 → 绝不外泄，返回通用安全提示
  return '操作失败，请检查网络或稍后重试；若持续失败请联系维护人员。';
}

/**
 * 让 .file-drop 容器同时支持「点击选择」与「拖拽上传」，且不改动 DOM 结构。
 * - 点击容器 → 触发调用方持有的隐藏 file input 打开系统选择框（保留原点击能力）
 * - 拖拽文件到容器 → 高亮 .is-drag，松手时把文件交给 onFiles（走与点击相同的上传逻辑）
 * @param {HTMLElement} dropEl   .file-drop 容器
 * @param {HTMLInputElement} inputEl 由调用方创建并持有的 <input type="file">
 * @param {(files: FileList|File[]) => void} onFiles  拿到文件后的处理回调
 */
export function bindFileDrop(dropEl, inputEl, onFiles) {
  dropEl.addEventListener('click', (e) => {
    if (e.target === inputEl) return; // 避免程序化 click 回环
    inputEl.click();
  });

  let depth = 0; // 处理子元素导致的 enter/leave 抖动
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
