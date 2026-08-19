// ============================================================
// media.js — 图片解析与渲染（P0 性能专项：响应式衍生图）
//  原图完整保留（assets/ 下），网页展示改用 assets/optimized/ 衍生图：
//    - <picture>：webp <source> + <img>(jpg srcset + sizes) 做真正的响应式选择
//    - 未命中 OPTIM（dataURL / 未知路径）走原逻辑（单 src）
//  容错：瞬时网络/CDN 失败最多重试 2 次（watchdog 防挂起），重试时重新应用优化源，
//        绝不回退到原始高清大图；重试仍失败才显示中性占位。
//  视觉/版式/配色零改动；仅 Hero 走 eager+high，其余 native lazy。
// ============================================================

import { OPTIM } from '../../../assets/optimized/manifest.js';

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

// 默认 sizes：手机 92vw，桌面按 960 选择（约 480/960 档）。调用点可覆盖。
const SIZES_DEFAULT = '(max-width: 600px) 92vw, 960px';

/** 构造响应式衍生描述；未命中返回 null */
function buildResponsive(value) {
  const m = OPTIM && OPTIM[value];
  if (!m) return null;
  const webpSrcset = Object.keys(m.webp).map((w) => `${m.webp[w]} ${w}w`).join(', ');
  const jpgSrcset = Object.keys(m.jpg).map((w) => `${m.jpg[w]} ${w}w`).join(', ');
  const fallback = (m.jpg && Object.values(m.jpg)[0]) || (m.webp && Object.values(m.webp)[0]) || '';
  return { webpSrcset, jpgSrcset, fallback, w: m.w, h: m.h };
}

/**
 * 生成图片元素。
 * @param {string} value        图片来源（真实路径）
 * @param {string} [className]
 * @param {string} [alt]
 * @param {{eager?:boolean, w?:number, h?:number, sizes?:string, responsive?:boolean}} [opts]
 *        eager : true 时不懒加载且高优先级（仅首屏主视觉 Hero）
 *        w/h   : 已知原图像素尺寸，写入 width/height 减少 CLS
 *        sizes : 响应式选择依据（按真实展示宽度），不传用默认
 *        responsive: false 时强制走单 src 原逻辑（用于极少数特殊场景）
 */
export function imgEl(value, className, alt = '', opts = {}) {
  const src = toImageSrc(value);
  const desc = src ? buildResponsive(src) : null;
  if (desc && opts.responsive !== false) {
    return responsiveEl(desc, className, alt, opts);
  }
  return plainImg(value, className, alt, opts);
}

// —— 响应式 <picture> ——
function responsiveEl(desc, className, alt, opts) {
  const sizes = opts.sizes || SIZES_DEFAULT;

  const pic = document.createElement('picture');

  const source = document.createElement('source');
  source.type = 'image/webp';
  source.srcset = desc.webpSrcset;
  source.sizes = sizes;
  pic.appendChild(source);

  const e = document.createElement('img');
  if (className) e.className = className;
  e.alt = alt || '';
  e.decoding = 'async';
  // 写原图尺寸防 CLS（CSS 控制实际显示尺寸）
  e.width = desc.w;
  e.height = desc.h;
  if (opts.eager) {
    e.loading = 'eager';
    e.fetchPriority = 'high';
  } else {
    e.loading = 'lazy';
  }
  e.srcset = desc.jpgSrcset;
  e.sizes = sizes;
  e.src = desc.fallback;
  pic.appendChild(e);

  // 重试：重新应用优化源（带缓存击穿），绝不回退原始高清
  const restore = (n) => {
    const sfx = n ? `?_r=${n}` : '';
    source.srcset = desc.webpSrcset.split(',').map((s) => s.trim().split(' ')[0] + sfx + ' ' + s.trim().split(' ')[1]).join(', ');
    e.srcset = desc.jpgSrcset.split(',').map((s) => s.trim().split(' ')[0] + sfx + ' ' + s.trim().split(' ')[1]).join(', ');
    e.sizes = sizes;
    e.src = desc.fallback + sfx;
  };

  attachRetry(e, restore);
  return pic;
}

// —— 原始单 src 路径（未命中 OPTIM / responsive:false）——
function plainImg(value, className, alt, opts) {
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
    e.src = neutralFail(opts.w, opts.h);
    return e;
  }

  const MAX_RETRY = 2;
  const WATCH_MS = 10000;
  let attempts = 0;
  let done = false;

  const showFallback = () => {
    if (done) return;
    done = true;
    e.dataset.failed = '1';
    e.src = neutralFail(opts.w, opts.h);
  };

  const retry = (n) => {
    if (done) return;
    const sep = src.includes('?') ? '&' : '?';
    setTimeout(() => {
      if (done) return;
      setSrc(`${src}${sep}_r=${n}`);
    }, 250 * n);
  };

  const handleFail = () => {
    if (done) return;
    if (attempts >= MAX_RETRY) { showFallback(); return; }
    attempts++;
    const n = attempts;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    fetch(src, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal })
      .then((r) => { clearTimeout(timer); r.ok ? retry(n) : showFallback(); })
      .catch(() => { clearTimeout(timer); retry(n); });
  };

  let watch = null;
  const armWatch = () => {
    if (watch) clearTimeout(watch);
    watch = setTimeout(() => {
      if (done) return;
      if (attempts >= MAX_RETRY) showFallback();
      else handleFail();
    }, WATCH_MS);
  };
  const setSrc = (url) => { e.src = url; armWatch(); };

  e.addEventListener('error', handleFail);
  e.addEventListener('load', () => { done = true; if (watch) clearTimeout(watch); });

  setSrc(src);
  return e;
}

// —— 通用重试/ watchdog（用于响应式 <picture> 的 <img>）——
function attachRetry(img, restore) {
  const MAX_RETRY = 2;
  const WATCH_MS = 10000;
  let attempts = 0;
  let done = false;

  const showFallback = () => {
    if (done) return;
    done = true;
    img.dataset.failed = '1';
    // 兜底占位（用图片自身尺寸）
    const w = parseInt(img.getAttribute('width') || '600', 10);
    const h = parseInt(img.getAttribute('height') || '800', 10);
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.src = neutralFail(w, h);
  };

  const handleFail = () => {
    if (done) return;
    if (attempts >= MAX_RETRY) { showFallback(); return; }
    attempts++;
    const n = attempts;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    // 探测当前选中源是否可达（webp 或 jpg 都可能）；成功即重试，网络错误按瞬时重试
    const probe = img.currentSrc || img.src;
    fetch(probe, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal })
      .then((r) => { clearTimeout(timer); r.ok ? restore(n) : showFallback(); })
      .catch(() => { clearTimeout(timer); restore(n); });
  };

  let watch = null;
  const armWatch = () => {
    if (watch) clearTimeout(watch);
    watch = setTimeout(() => {
      if (done) return;
      if (attempts >= MAX_RETRY) showFallback();
      else handleFail();
    }, WATCH_MS);
  };

  img.addEventListener('error', handleFail);
  img.addEventListener('load', () => { done = true; if (watch) clearTimeout(watch); });
  // 初始挂起保护
  armWatch();
}
