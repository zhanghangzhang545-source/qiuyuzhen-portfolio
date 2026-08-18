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
    return e;
  }

  // 容错策略：仅对「瞬时网络 / CDN 抖动」做有限重试；硬错误（404/403 等）直接兜底，绝不无限重试。
  // 设计依据：线上同时加载 142 张图时，少数请求会瞬时超时 / ERR_FAILED / SSL EOF，若首次 error 即永久
  // 占位，会出现「每次刷新坏不同的图」。这里先探测真实状态，确认可恢复才重试。
  // 额外 watchdog：若请求长时间挂起（既无 load 也无 error，极端拥塞下可能出现「永久空白」），
  // 超时后按失败路径处理，避免图片长期空白不显示。
  const MAX_RETRY = 2;
  const WATCH_MS = 10000;
  let attempts = 0;
  let done = false; // 已成功加载或已显示兜底占位

  const showFallback = () => {
    if (done) return;                         // 防止中性占位图再次触发 error 造成死循环
    done = true;
    e.dataset.failed = '1';
    e.src = neutralFail(opts.w, opts.h);      // 最终兜底占位（不含任何 DEMO 字样）
  };

  const retry = (n) => {
    if (done) return;
    const sep = src.includes('?') ? '&' : '?';
    // 退避 + 缓存击穿：绕过可能被缓存的失败响应；瞬时 CDN 抖动通常下一次即恢复
    setTimeout(() => {
      if (done) return;
      setSrc(`${src}${sep}_r=${n}`);   // 重新发起请求并重启 watchdog
    }, 250 * n);
  };

  const handleFail = () => {
    if (done) return;
    if (attempts >= MAX_RETRY) { showFallback(); return; }
    attempts++;
    const n = attempts;
    // 探测真实状态：2xx=资源可用（之前是瞬时抖动）→ 重试；4xx/5xx=资源确缺失 → 直接兜底；
    // 网络错误 / 超时（CDN 抖动）→ 视为瞬时，重试。
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    fetch(src, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal })
      .then((r) => { clearTimeout(timer); r.ok ? retry(n) : showFallback(); })
      .catch(() => { clearTimeout(timer); retry(n); }); // 网络/CDN/超时错误 → 按瞬时重试
  };

  // 统一入口：设置 src 并（重新）启动 watchdog，确保每次请求（含重试）都有挂起保护
  let watch = null;
  const armWatch = () => {
    if (watch) clearTimeout(watch);
    watch = setTimeout(() => {
      if (done) return;
      if (attempts >= MAX_RETRY) showFallback();
      else handleFail();           // 挂起超时 → 按失败路径（重试 / 兜底）
    }, WATCH_MS);
  };
  const setSrc = (url) => { e.src = url; armWatch(); };

  e.addEventListener('error', handleFail);
  e.addEventListener('load', () => { done = true; if (watch) clearTimeout(watch); });

  setSrc(src);                     // 首次发起请求并启动 watchdog
  return e;
}
