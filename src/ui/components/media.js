// ============================================================
// media.js — 图片解析与渲染（P0 性能专项：响应式衍生图 + LQIP 淡入）
//  原图完整保留（assets/ 下），网页展示改用 assets/optimized/ 衍生图：
//    - <picture>：webp <source> + <img>(jpg srcset + sizes) 做真正的响应式选择
//    - 未命中 OPTIM（dataURL / 未知路径）走原逻辑（单 src）
//  容错：瞬时网络/CDN 失败最多重试 2 次（watchdog 防挂起），重试时重新应用优化源，
//        绝不回退到原始高清大图；重试仍失败才显示中性占位。
//  视觉/版式/配色零改动；仅以下渲染策略调整（不改变任何 DOM 语义与可见样式）：
//    - LQIP / 中性占位放在 .media-frame 容器背景（始终可见，非网络依赖），高清 <img> 初始
//      opacity:0，decode()/load 成功以后 ~220ms 仅以 opacity 淡入到 1，淡入后覆盖 LQIP。
//    - Hero 唯一 fetchpriority=high；其余首视口 eager 但不 high；屏幕外统一 native lazy。
//    - IntersectionObserver 提前唤醒距离 800 → 1200px。
// ============================================================

import { OPTIM } from '../../../assets/optimized/manifest.js';

// 同源性：optimized 衍生图与页面同源，由各托管平台 CDN 直接供图（不变更）。
const cdn = (u) => u;

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
// 提前唤醒距离由 800px 提至 1200px，让下一批图更早开始加载，滚动更丝滑。
const NEAR_MARGIN = '1200px';
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

// —— 媒体帧容器：承载 LQIP/中性占位背景，包裹高清 <img>/<picture> ——
//   fill=true 时用于 Hero 等需要铺满父容器的场景（高度由 CSS 控制）。
function makeFrame(className, fill) {
  const frame = document.createElement('div');
  frame.className = 'media-frame' + (fill ? ' media-frame--fill' : '');
  return frame;
}

// 加载策略：eager 时同步加载但不强制 high；只有 high 才设 fetchpriority=high
// （全站唯一 high 仅 Home Hero）。lazy 为默认（native lazy）。
function setLoading(e, opts) {
  if (opts.eager) {
    e.loading = 'eager';
  } else {
    e.loading = 'lazy';
  }
  if (opts.high) {
    e.fetchPriority = 'high';
  }
}

// 高清淡入：<img> 初始 opacity:0，decode()/load 成功 ~220ms 后仅以 opacity 淡入（180–280ms 区间），
// 覆盖已可见的 LQIP/中性占位背景。仅 opacity 过渡，禁用 translate/scale，避免滚动发飘。
// lazy 图片不主动调用 decode()（避免强制提前拉取破坏懒加载），改监听 load 事件。
function attachFade(img) {
  img.style.opacity = '0';
  img.style.transition = 'opacity .24s ease';
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    img.style.opacity = '1';
  };
  const onReady = () => { setTimeout(reveal, 220); };
  if (img.loading === 'eager' && typeof img.decode === 'function') {
    img.decode().then(onReady).catch(onReady);
  } else if (img.complete && img.naturalWidth) {
    onReady();
  } else {
    img.addEventListener('load', onReady, { once: true });
    img.addEventListener('error', onReady, { once: true });
  }
  // 重试换源后若再次 load/error，仍确保淡入（idempotent）。
  img.addEventListener('load', onReady);
  img.addEventListener('error', onReady);
}

/**
 * 生成图片元素。
 * @param {string} value        图片来源（真实路径）
 * @param {string} [className]
 * @param {string} [alt]
 * @param {{eager?:boolean, high?:boolean, fill?:boolean, w?:number, h?:number, sizes?:string, responsive?:boolean}} [opts]
 *        eager : true 时不懒加载（首视口关键图），但默认不 high
 *        high  : true 时 fetchpriority=high（全站仅 Home Hero）
 *        fill  : true 时铺满父容器（.media-frame--fill；Hero 等 cover 场景）
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
  const frame = makeFrame(className, opts.fill);
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
  setLoading(e, opts);
  e.srcset = desc.jpgSrcset;
  e.sizes = sizes;
  e.src = desc.fallback;

  // LQIP 即时低清预览：放 .media-frame 容器背景（内联 data-URI，无网络依赖、立即可见），
  // 高清 <img> 始终以 opacity:0 起始，加载完成后由 attachFade 淡入覆盖。
  // 禁止把 LQIP 设在 <img> 自身（会导致背景随 opacity:0 一并不可见）。
  if (desc.lqip) {
    frame.style.backgroundImage = `url("${desc.lqip}")`;
  }

  pic.appendChild(e);
  frame.appendChild(pic);

  // 重试：重新应用优化源（带缓存击穿），绝不回退原始高清
  const restore = (n) => {
    const sfx = n ? `?_r=${n}` : '';
    source.srcset = desc.webpSrcset.split(',').map((s) => s.trim().split(' ')[0] + sfx + ' ' + s.trim().split(' ')[1]).join(', ');
    e.srcset = desc.jpgSrcset.split(',').map((s) => s.trim().split(' ')[0] + sfx + ' ' + s.trim().split(' ')[1]).join(', ');
    e.sizes = sizes;
    e.src = desc.fallback + sfx;
  };

  attachFade(e);
  attachRetry(e, restore);
  return frame;
}

// —— 原始单 src 路径（未命中 OPTIM / responsive:false）——
function plainImg(value, className, alt, opts) {
  const frame = makeFrame(className, opts.fill);
  const e = document.createElement('img');
  const src = toImageSrc(value);
  if (className) e.className = className;
  e.alt = alt || '';
  e.decoding = 'async';

  setLoading(e, opts);
  if (opts.w && opts.h) {
    e.width = opts.w;
    e.height = opts.h;
  }

  // 无 src：直接显示中性占位（容器背景已为中性色，这里也淡入兜底占位）
  if (!src) {
    e.src = neutralFail(opts.w, opts.h);
    attachFade(e);
    frame.appendChild(e);
    return frame;
  }

  const MAX_RETRY = 2;
  let attempts = 0;
  let done = false;

  const showFallback = () => {
    if (done) return;
    done = true;
    e.dataset.failed = '1';
    e.src = neutralFail(opts.w, opts.h); // 绝不回退原始高清大图
  };

  const retry = (n) => {
    if (done) return;
    const sep = src.includes('?') ? '&' : '?';
    setTimeout(() => {
      if (done) return;
      e.src = `${src}${sep}_r=${n}`;
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

  attachFade(e);
  setSrc(src);
  frame.appendChild(e);
  return frame;
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
  // 仅当图片进入视口附近（rootMargin 1200px）后才启动挂起计时；
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
