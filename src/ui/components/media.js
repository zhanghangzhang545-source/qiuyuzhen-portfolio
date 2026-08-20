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

// —— P0-C：optimized 衍生图经 jsDelivr CDN 供图（绑定 commit SHA，避免 CDN 缓存旧素材）——
//  画质/档位/Retina/LQIP 全部不变，仅替换资源基址；HTML/JS 仍由 GitHub Pages 提供。
//  原图（assets/ 原始目录）完整保留在 GitHub，不删除、不改压缩参数。
//  ?img=gh → 临时回退 GitHub Pages 供图（仅用于 A/B 对照测量，同代码同画质同布局）。
const CDN_BASE =
  'https://cdn.jsdelivr.net/gh/zhanghangzhang545-source/qiuyuzhen-portfolio@7920154fb60bc5238a37abbd8790ea409f7f3db5/';
const IMG_CDN = (() => {
  try {
    return new URLSearchParams(window.location.search).get('img') !== 'gh';
  } catch (e) {
    return true;
  }
})();
function cdn(u) {
  return IMG_CDN && typeof u === 'string' && u.indexOf('assets/optimized/') === 0 ? CDN_BASE + u : u;
}

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

// 懒加载挂起检测：仅当图片进入视口附近（rootMargin）后才启动计时，
// 避免对"尚未开始 lazy 加载"的屏幕外资源误判为挂起、产生多余 HEAD/重试/主动请求。
const NEAR_MARGIN = '800px';
const WATCH_MS = 10000;

/** 构造响应式衍生描述；未命中返回 null */
function buildResponsive(value) {
  const m = OPTIM && OPTIM[value];
  if (!m) return null;
  const webpSrcset = Object.keys(m.webp).map((w) => `${cdn(m.webp[w])} ${w}w`).join(', ');
  const jpgSrcset = Object.keys(m.jpg).map((w) => `${cdn(m.jpg[w])} ${w}w`).join(', ');
  const fallback = cdn((m.jpg && Object.values(m.jpg)[0]) || (m.webp && Object.values(m.webp)[0]) || '');
  const lqip = m.lqip || '';
  return { webpSrcset, jpgSrcset, fallback, w: m.w, h: m.h, lqip };
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

  // LQIP 即时低清预览：用真实 Hero/作品缩略（内联 data-URI，无网络）作瞬时背景，
  // 高清图加载完成后淡入覆盖。禁止灰块/空白块/假图片；最终看到的是正常高清作品。
  if (desc.lqip) {
    e.style.backgroundImage = `url("${desc.lqip}")`;
    e.style.backgroundSize = 'cover';
    e.style.backgroundPosition = 'center';
    e.style.backgroundRepeat = 'no-repeat';
    e.style.opacity = '0';
    e.style.transition = 'opacity .45s ease';
    const reveal = () => { e.style.opacity = '1'; };
    if (e.complete && e.naturalWidth) {
      reveal();
    } else {
      e.addEventListener('load', reveal, { once: true });
      // 失败兜底（中性占位）也会触发 load → 同样淡入显示，不会卡在透明
      e.addEventListener('error', () => { e.style.opacity = '1'; }, { once: true });
    }
  }

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
  const cancelWatch = () => { if (watch) { clearTimeout(watch); watch = null; } };
  // 仅设置地址；不在此处启动 watchdog（懒加载图片创建时不得主动请求/重试）
  const setSrc = (url) => { e.src = url; };

  e.addEventListener('error', handleFail);
  e.addEventListener('load', () => { done = true; cancelWatch(); });

  // 懒加载挂起检测：仅当图片进入视口附近（rootMargin）后才启动计时；
  // 屏幕外资源不 HEAD、不重试、不主动请求。进入附近后若仍未 load 才算"挂起"。
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) { if (!done) armWatch(); io.disconnect(); }
      }
    }, { rootMargin: NEAR_MARGIN });
    io.observe(e);
  } else if (e.loading === 'eager') {
    armWatch();
  }

  setSrc(src);
  return e;
}

// —— 通用重试/ watchdog（用于响应式 <picture> 的 <img>）——
function attachRetry(img, restore) {
  const MAX_RETRY = 2;
  let attempts = 0;
  let done = false;
  let watch = null;

  const showFallback = () => {
    if (done) return;
    done = true;
    img.dataset.failed = '1';
    // 兜底占位（用图片自身尺寸）；绝不回退原始高清大图
    const w = parseInt(img.getAttribute('width') || '600', 10);
    const h = parseInt(img.getAttribute('height') || '800', 10);
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.src = neutralFail(w, h);
  };

  // 有限重试：仅在真实 error 事件触发
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

  const armWatch = () => {
    if (watch) clearTimeout(watch);
    watch = setTimeout(() => {
      if (done) return;
      if (attempts >= MAX_RETRY) showFallback();
      else handleFail();   // 仅进入视口附近后才启动 → 此时仍未 load 才算"挂起"
    }, WATCH_MS);
  };
  const cancelWatch = () => { if (watch) { clearTimeout(watch); watch = null; } };

  img.addEventListener('error', handleFail);
  img.addEventListener('load', () => { done = true; cancelWatch(); });

  // 关键：lazy 图片创建时不立即 watchdog。
  // 仅当图片进入视口附近（rootMargin 800px）后才启动挂起计时；
  // 屏幕外资源不 HEAD、不重试、不主动请求。
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) { if (!done) armWatch(); io.disconnect(); }
      }
    }, { rootMargin: NEAR_MARGIN });
    io.observe(img);
  } else if (img.loading === 'eager') {
    armWatch();
  }
}
