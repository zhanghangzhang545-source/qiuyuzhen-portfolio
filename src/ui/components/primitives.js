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
