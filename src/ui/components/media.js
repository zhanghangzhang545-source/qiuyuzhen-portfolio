// ============================================================
// media.js — 图片解析与渲染
//  真实图片（string 路径 / dataURL / http(s)）直接透传。
//  渲染失败的图片使用中性「加载失败」占位，不出现任何 DEMO 字样。
// ============================================================

/** 中性「加载失败」占位（仅作异常兜底，不含营销/DEMO 文案） */
function neutralFail(w, h) {
  const W = w || 600, H = h || 800;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>` +
    `<rect width='${W}' height='${H}' fill='#EDE4D9'/>` +
    `<text x='50%' y='50%' fill='#8B8177' font-size='${Math.max(14, Math.round(W * 0.045))}' ` +
    `font-family='system-ui,-apple-system,sans-serif' text-anchor='middle' dominant-baseline='middle'>图片加载失败</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 将封面/图片值解析为可直接用于 <img src> 的字符串 */
export function toImageSrc(value) {
  if (typeof value === 'string' && value) return value; // 真实路径 / dataURL / http(s)
  return '';
}

/**
 * 生成 <img> 元素。
 * @param {string} value        图片来源（真实路径）
 * @param {string} [className]
 * @param {string} [alt]
 * @param {{eager?:boolean, w?:number, h?:number}} [opts]
 *        eager: true 时不懒加载且高优先级（用于首屏主视觉）
 *        w/h:   已知像素尺寸，写入 width/height 属性以减少加载时页面跳动（CLS）
 */
export function imgEl(value, className, alt = '', opts = {}) {
  const e = document.createElement('img');
  const src = toImageSrc(value);
  if (className) e.className = className;
  e.alt = alt || '';
  e.decoding = 'async';

  if (opts.eager) {
    e.loading = 'eager';
    e.fetchPriority = 'high';
  } else {
    e.loading = 'lazy';
  }
  if (opts.w && opts.h) {
    e.width = opts.w;
    e.height = opts.h;
  }

  if (!src) {
    e.src = neutralFail(opts.w, opts.h); // 无来源：直接给中性占位
  } else {
    e.src = src;
    e.addEventListener('error', () => {
      if (e.dataset.failed) return;       // 防止兜底图再次触发 error 造成死循环
      e.dataset.failed = '1';
      e.src = neutralFail(opts.w, opts.h);
    });
  }
  return e;
}
