// ============================================================
// FINAL16.2-A 公开体验性能 Gate —— 数据层请求降级 + 渲染契约
// ------------------------------------------------------------
// 两部分（均确定性、无需浏览器、无需真实网络）：
//
//  [A] 数据层（注入式 fake Supabase，记录 ops）：
//      A1 getHomePayload 不读 work_images；comic_pages 仅取 spotlight 前 3（不再展开 110）
//      A2 对比旧路径 repo.filter({publicOnly:true})（全量 hydrate）与 getHomePayload 的
//         请求构成差异（旧：work_images + 全部 comic_pages；新：无 work_images + ≤3 页）
//      A3 listPublicSummary('illustration') 完全不读 comic_pages / work_images
//      A4 listPublicSummary('comic') 读 comic_pages 但只取「代表页」(pages.length===1, pageCount 真实)
//      A5 会话内缓存：顺序二次调用 0 新增 ops；并发两次调用仅 1 次真实加载（in-flight 去重）
//
//  [B] 渲染契约（headless DOM 垫片，导入真实 media.js）：
//      B1 LQIP 放在 .media-frame 容器背景（立即可见），高清 <img> 初始 opacity:0（不抢镜）
//      B2 LQIP 绝不设在 <img> 自身（旧 bug 修复验证）
//      B3 Hero 唯一 high：imgEl({high:true}) 内层 <img> fetchPriority==='high'
//      B4 普通图（eager 但不 high）内层 <img> fetchPriority 不为 'high'
//      B5 命中 OPTIM 走 <picture>（webp source + jpg img）响应式
// ============================================================
import { SupabaseWorkRepository } from '../src/data/repository.supabase.js';
import { makeFake, PRIVATE, PUBLIC, seedWork, seedAsset } from './_fake_supabase.mjs';

let pass = 0, fail = 0;
const out = [];
function ok(cond, msg, extra = '') {
  if (cond) { pass++; out.push(`  PASS ${msg}${extra ? '  ' + extra : ''}`); }
  else { fail++; out.push(`  FAIL ${msg}${extra ? '  ' + extra : ''}`); }
}
const snap = (f) => f.ops.length;
const delta = (f, from) => f.ops.length - from;
const tableOps = (f, from, table) =>
  f.ops.slice(from).filter((o) => o.type === 'table' && o.table === table).length;

// 构造「含 1 部 110 页漫画 + 多部插画(各带图片) + 证书」的公开数据集
function seedPublicDataset(f) {
  // 10 部插画，各 4 张 work_images（共 40 行，模拟真实全站图片量）
  for (let i = 1; i <= 10; i++) {
    const id = `ill${i}`;
    seedWork(f, { id, type: 'illustration', isPublic: true, coverAssetId: `${id}__cv` });
    seedAsset(f, { id: `${id}__cv`, bucket: PUBLIC, original: `works/illustration/${id}__cv.jpg`, variants: [{ id: `${id}__cv_v1`, path: `works/illustration/${id}__cv_1280.jpg`, width: 1280, height: 1600 }] });
    for (let j = 1; j <= 4; j++) {
      const aid = `${id}__im${j}`;
      seedAsset(f, { id: aid, bucket: PUBLIC, original: `works/illustration/${aid}.jpg`, variants: [{ id: `${aid}_v1`, path: `works/illustration/${aid}_1280.jpg`, width: 1280, height: 1600 }] });
      f.store.work_images.push({ id: `wi_${id}_${j}`, work_id: id, media_asset_id: aid, sort_order: j, alt_text: null });
    }
  }
  // 2 部油画（无 work_images）
  for (let i = 1; i <= 2; i++) {
    const id = `oil${i}`;
    seedWork(f, { id, type: 'oil', isPublic: true, coverAssetId: `${id}__cv` });
    seedAsset(f, { id: `${id}__cv`, bucket: PUBLIC, original: `works/oil/${id}__cv.jpg`, variants: [{ id: `${id}__cv_v1`, path: `works/oil/${id}__cv_1280.jpg`, width: 1280, height: 1000 }] });
  }
  // 1 部漫画，110 页（全部指向同一页资产以简化；真实场景页数等同）
  const cid = 'comicSPOT';
  seedWork(f, { id: cid, type: 'comic', isPublic: true, coverAssetId: `${cid}__cv` });
  // seedWork 助手固定 home_featured=false；此处显式置为 spotlight（首页精选漫画）
  const spotRow = f.store.works.find((w) => w.id === cid);
  spotRow.home_featured = true;
  spotRow.home_featured_order = 1;
  seedAsset(f, { id: `${cid}__cv`, bucket: PUBLIC, original: `works/comic/${cid}__cv.jpg`, variants: [{ id: `${cid}__cv_v1`, path: `works/comic/${cid}__cv_1280.jpg`, width: 1280, height: 1800 }] });
  seedAsset(f, { id: `${cid}__pg`, bucket: PUBLIC, original: `works/comic/${cid}__pg.jpg`, variants: [{ id: `${cid}__pg_v1`, path: `works/comic/${cid}__pg_1280.jpg`, width: 1280, height: 1800 }] });
  for (let p = 1; p <= 110; p++) {
    f.store.comic_pages.push({ id: `cp_${p}`, work_id: cid, media_asset_id: `${cid}__pg`, page_number: p, sort_order: p });
  }
  // 1 部非 spotlight 漫画（验证非 spotlight 漫画 pages 不被展开）
  const cid2 = 'comicOTHER';
  seedWork(f, { id: cid2, type: 'comic', isPublic: true, coverAssetId: `${cid2}__cv`, homeFeatured: false, homeFeaturedOrder: 0 });
  seedAsset(f, { id: `${cid2}__cv`, bucket: PUBLIC, original: `works/comic/${cid2}__cv.jpg`, variants: [{ id: `${cid2}__cv_v1`, path: `works/comic/${cid2}__cv_1280.jpg`, width: 1280, height: 1800 }] });
  // 证书
  f.store.certificates.push({ id: 'cert1', title: 'C1', media_asset_id: 'certA', is_public: true, sort_order: 1, year: 2020, year_start: 2019, year_end: 2020, category: 'honor' });
  seedAsset(f, { id: 'certA', bucket: PUBLIC, original: 'cert/c01.jpg', variants: [{ id: 'certA_v1', path: 'cert/c01_1280.jpg', width: 1048, height: 768 }] });
}

async function main() {
  // ===================== [A1/A2] getHomePayload vs 旧 filter =====================
  {
    const f = makeFake();
    seedPublicDataset(f);
    const r = new SupabaseWorkRepository(f.sb);

    // 旧路径：repo.filter({publicOnly:true}) → _hydrateWorks（全量 work_images + 全部 comic_pages）
    const b0 = snap(f);
    const full = await r.filter({ publicOnly: true });
    const baseOps = delta(f, b0);
    const baseWorkImages = tableOps(f, b0, 'work_images');
    const baseComicPages = tableOps(f, b0, 'comic_pages');
    const baseComic = full.find((w) => w.type === 'comic' && w.id === 'comicSPOT');
    const baseComicPagesExpanded = baseComic ? baseComic.pages.length : -1;

    // 新路径：getHomePayload（首页唯一公开读取入口）
    const f2 = makeFake();
    seedPublicDataset(f2);
    const r2 = new SupabaseWorkRepository(f2.sb);
    const n0 = snap(f2);
    const { works, certs } = await r2.getHomePayload();
    const newOps = delta(f2, n0);
    const newWorkImages = tableOps(f2, n0, 'work_images');
    const newComicPages = tableOps(f2, n0, 'comic_pages');
    const spotlight = works.find((w) => w.type === 'comic' && w.featured);
    const spotPages = spotlight ? spotlight.pages.length : -1;
    const otherComic = works.find((w) => w.type === 'comic' && w.id === 'comicOTHER');
    const otherPages = otherComic ? otherComic.pages.length : -1;

    ok(baseWorkImages >= 1, 'A2 旧路径确实读取 work_images（基线）', `work_images查询=${baseWorkImages}`);
    ok(newWorkImages === 0, 'A1 getHomePayload 完全不读 work_images（首页无需全量图片）', `work_images查询=${newWorkImages}`);
    ok(baseComicPagesExpanded === 110, 'A2 旧路径展开漫画 110 页（基线痛点）', `comic.pages.length=${baseComicPagesExpanded}`);
    ok(spotPages >= 1 && spotPages <= 3, 'A1 spotlight 漫画仅取前 3 内页（不再 110）', `spotlight.pages.length=${spotPages}`);
    ok(otherPages === 0, 'A1 非 spotlight 漫画 pages 不展开（首页不拉无关漫画页）', `otherComic.pages.length=${otherPages}`);
    ok(certs.length >= 1 && certs[0].type === 'certificate', 'A1 证书独立返回且类型正确', `certs=${certs.length}`);
    ok(works.every((w) => w.type !== 'certificate'), 'A1 works 不含 certificate 类型（契约与旧 home 对齐）');
    out.push(`  INFO 首页数据拉取对比：旧 filter 展开漫画 110 页 + 读 work_images；新 getHomePayload 漫画页 110→≤3、work_images 查询=${newWorkImages}、comic_pages 查询=${newComicPages}(仅 spotlight)`);
  }

  // ===================== [A3] illustration 列表不读 comic_pages / work_images =====================
  {
    const f = makeFake();
    seedPublicDataset(f);
    const r = new SupabaseWorkRepository(f.sb);
    const b0 = snap(f);
    const list = await r.listPublicSummary('illustration');
    const after = delta(f, b0);
    const cp = tableOps(f, b0, 'comic_pages');
    const wi = tableOps(f, b0, 'work_images');
    ok(cp === 0, 'A3 listPublicSummary(illustration) 不读 comic_pages', `comic_pages查询=${cp}`);
    ok(wi === 0, 'A3 listPublicSummary(illustration) 不读 work_images', `work_images查询=${wi}`);
    ok(list.every((w) => w.type === 'illustration') && list.length === 10, 'A3 仅返回 illustration 类型（10 部）', `返回=${list.length}`);
    ok(list.every((w) => w.pages.length === 0), 'A3 illustration 无 pages 展开');
  }

  // ===================== [A4] comic 列表只取代表页（pageCount 真实，pages 仅 1）=====================
  {
    const f = makeFake();
    seedPublicDataset(f);
    const r = new SupabaseWorkRepository(f.sb);
    const b0 = snap(f);
    const list = await r.listPublicSummary('comic');
    const after = delta(f, b0);
    const cp = tableOps(f, b0, 'comic_pages');
    const wi = tableOps(f, b0, 'work_images');
    const comic = list.find((w) => w.id === 'comicSPOT');
    ok(comic && comic.pageCount === 110, 'A4 comic 真实页数保留(pageCount=110)', `pageCount=${comic ? comic.pageCount : 'n/a'}`);
    ok(comic && comic.pages.length === 1, 'A4 comic 仅取 1 张代表页（不展开 110 张媒体）', `pages.length=${comic ? comic.pages.length : 'n/a'}`);
    ok(wi === 0, 'A4 comic 列表不读 work_images', `work_images查询=${wi}`);
    ok(cp >= 1, 'A4 comic 列表读 comic_pages（用于计数+代表页，轻量列）', `comic_pages查询=${cp}`);
    out.push(`  INFO comic 列表：comic_pages查询=${cp}（取代表页，非展开 110 媒体）`);
  }

  // ===================== [A5] 会话内缓存：顺序 0 新增；并发仅 1 次加载 =====================
  {
    // 顺序：二次调用 0 新增 ops（使用冷门 key 'summary:oil'，避免被其它用例缓存污染）
    const fSeq = makeFake();
    seedPublicDataset(fSeq);
    const rSeq = new SupabaseWorkRepository(fSeq.sb);
    const s0 = snap(fSeq); await rSeq.listPublicSummary('oil'); const s1 = snap(fSeq);
    const firstCost = delta(fSeq, s0);
    await rSeq.listPublicSummary('oil'); const s2 = snap(fSeq);
    const secondCost = delta(fSeq, s1);
    ok(secondCost === 0, 'A5 顺序二次调用命中缓存（0 新增 ops）', `首次=${firstCost} 二次新增=${secondCost}`);

    // 并发：两次同时调用仅 1 次真实加载（in-flight 去重）。
    // 使用全局缓存从未出现过的唯一 key，确保两次调用均在冷缓存下竞争同一 inflight Promise。
    const fCon = makeFake();
    seedPublicDataset(fCon);
    const rCon = new SupabaseWorkRepository(fCon.sb);
    const c0 = snap(fCon);
    await Promise.all([rCon.listPublicSummary('__dedup_conc__'), rCon.listPublicSummary('__dedup_conc__')]);
    const concCost = delta(fCon, c0);
    // 单次成本（独立 fake + 另一个唯一冷 key）
    const fSingle = makeFake();
    seedPublicDataset(fSingle);
    const rSingle = new SupabaseWorkRepository(fSingle.sb);
    const g0 = snap(fSingle); await rSingle.listPublicSummary('__dedup_single__'); const g1 = snap(fSingle);
    const singleCost = delta(fSingle, g0);
    ok(concCost === singleCost && concCost > 0, 'A5 并发两次调用仅 1 次真实加载(in-flight 去重)', `并发=${concCost} 单次=${singleCost}`);
  }

  // ===================== [B] 渲染契约（headless DOM 垫片）=====================
  await runRenderContract();

  console.log('===== FINAL16.2-A PUBLIC EXPERIENCE PERFORMANCE GATE =====');
  out.forEach((l) => console.log(l));
  console.log(`RESULT: pass=${pass} fail=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}

// —— 最小 DOM 垫片：media.js 仅用 document.createElement + window(无 IntersectionObserver) ——
function makeShim() {
  class FakeNode {
    constructor(tag) {
      this.tag = tag; this.children = []; this.style = {}; this.dataset = {};
      this._attrs = {}; this.className = ''; this.parentNode = null;
      this.complete = false; this.naturalWidth = 0; this.currentSrc = '';
      this.decode = () => Promise.resolve();
    }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    setAttribute(k, v) { this._attrs[k] = v; }
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
    removeAttribute(k) { delete this._attrs[k]; }
    addEventListener() { /* no-op：测试不触发 error/load */ }
  }
  globalThis.document = { createElement: (t) => new FakeNode(t) };
  // 关键：window 不含 IntersectionObserver → 走 else 分支（eager 仅挂 10s watchdog，测试结束前不触发）
  globalThis.window = {};
  return FakeNode;
}

async function runRenderContract() {
  const FakeNode = makeShim();
  const { imgEl } = await import('../src/ui/components/media.js');
  const { OPTIM } = await import('../assets/optimized/manifest.js');

  // 选取一个真实带 LQIP 的 OPTIM key
  const lqipKey = Object.keys(OPTIM).find((k) => OPTIM[k] && OPTIM[k].lqip);
  ok(!!lqipKey, 'B0 找到带 LQIP 的 OPTIM 资产（验证即时低清预览）', `key=${lqipKey || '无'}`);

  const findImg = (node) => {
    if (node.tag === 'img') return node;
    for (const c of node.children) { const r = findImg(c); if (r) return r; }
    return null;
  };

  // B1/B2/B5：LQIP 在容器背景，<img> 初始 opacity:0，且 <img> 自身无 LQIP；命中 OPTIM 走 <picture>
  {
    const frame = imgEl(lqipKey, 'feat-img', 'alt', {});
    ok(frame.tag === 'div' && /media-frame/.test(frame.className), 'B1 返回 .media-frame 容器', `class="${frame.className}"`);
    const bg = frame.style.backgroundImage || '';
    ok(/^url\("data:image/.test(bg), 'B1 LQIP 置于 .media-frame 背景（立即可见，非网络依赖）', `bg=${bg.slice(0, 28)}…`);
    const pic = frame.children[0];
    ok(pic && pic.tag === 'picture', 'B5 命中 OPTIM 走 <picture> 响应式', `child0=${pic ? pic.tag : '无'}`);
    const img = findImg(frame);
    ok(img && img.style.opacity === '0', 'B1 高清 <img> 初始 opacity:0（LQIP 透出，不空白不蹦图）', `img.opacity=${img ? img.style.opacity : 'n/a'}`);
    ok(!(img && img.style.backgroundImage), 'B2 LQIP 绝不设在 <img> 自身（旧 bug 修复）', `img.bg=${img && img.style.backgroundImage ? '有(错误)' : '无'}`);
  }

  // B3：Hero 唯一 high
  {
    const frame = imgEl(lqipKey, 'hero__img', '', { eager: true, high: true, fill: true });
    const img = findImg(frame);
    ok(img && img.fetchPriority === 'high', 'B3 Hero(唯一 high) 内层 <img> fetchPriority=high', `fetchPriority=${img ? img.fetchPriority : 'n/a'}`);
  }

  // B4：普通 eager 图不 high（全站除 Hero 外不得 high）
  {
    const frame = imgEl(lqipKey, 'feat-img', '', { eager: true });
    const img = findImg(frame);
    ok(img && img.fetchPriority !== 'high', 'B4 普通 eager 图 fetchPriority 不为 high（仅 Hero 唯一 high）', `fetchPriority=${img ? img.fetchPriority || '(未设)' : 'n/a'}`);
  }
}

main().catch((e) => { console.error('PUBLIC EXP GATE CRASHED:', e); process.exit(2); });
