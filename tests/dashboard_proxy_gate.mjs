// ============================================================
// tests/dashboard_proxy_gate.mjs
// FINAL16.2.1 — 后台仪表盘确定性回归 Gate（P0，最小修复）
// ------------------------------------------------------------
// 修复根因：admin/dashboard.js 调用 repo.listAdminSummary()，但 services.js 的
// REPO_METHODS 未注册该方法 → lazyProxy 生成的 repo 根本无此方法 →
// 进入仪表盘抛 TypeError: repo.listAdminSummary is not a function → 显示「数据读取失败」。
//
// 最小修复：
//   1) services.js 的 REPO_METHODS 增加 'listAdminSummary'（与其它读取方法并列）。
//   2) dashboard.js：正式 Supabase 用 repo.listAdminSummary()；Mock 回滚通道用 repo.list()。
//
// 本 Gate 覆盖用户指定的全部断言：
//   - 正式 Supabase proxy 中 typeof repo.listAdminSummary === 'function'
//   - Dashboard Supabase 模式能够正常获得数组（impl 行为，proxy 仅委托无额外逻辑）
//   - Mock Dashboard 仍能正常加载（经真实 proxy.repo.list() 返回数组）
//   - 不出现 repo.listAdminSummary is not a function
//   - 不重新读取 comic_pages / work_images（含 110 页漫画也不展开）
// ============================================================
import { makeFake, seedWork, seedAsset, PUBLIC } from './_fake_supabase.mjs';
import { SupabaseWorkRepository } from '../src/data/repository.supabase.js';
import { MockWorkRepository } from '../src/data/repository.js';
import { repo } from '../src/data/services.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, info = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}${info ? '  [' + info + ']' : ''}`); }
  else { fail++; fails.push(name); console.log(`  FAIL  ${name}${info ? '  [' + info + ']' : ''}`); }
}

async function main() {
  // ===================== [A] 正式 Supabase proxy：listAdminSummary 已注册 =====================
  // lazyProxy 在构造期就为每个 REPO_METHODS 项生成 obj[m] = (...args) => obj._ensure().then(...)，
  // 因此无需 await 初始化即可断言。修复前 repo.listAdminSummary 为 undefined →
  // 调用即抛 "repo.listAdminSummary is not a function"。此断言直接在 proxy 上证明 bug 已修复。
  ok(typeof repo.listAdminSummary === 'function',
    'A 正式 Supabase proxy 暴露 listAdminSummary (typeof === function)');
  ok(repo.listAdminSummary !== undefined,
    'A repo.listAdminSummary 非 undefined（修复前为 undefined → is not a function）');
  ok(typeof repo.list === 'function',
    'A repo.list 已注册（mock 回滚分支依赖）');

  // ===================== [B] Mock Dashboard：经真实 proxy.repo.list() 返回数组 =====================
  // 强制 mock 模式（forceMockViaQuery 读 location.search；Node 下无 location，显式注入）。
  globalThis.location = { search: '?mock=1', hash: '' };
  // 重置单例 proxy，确保按 mock 模式重新解析（避免其它分支残留实现）。
  repo._impl = null; repo._init = null; repo._mode = null;
  const mockArr = await repo.list(); // 与 dashboard.js 的 mock 分支一致
  ok(Array.isArray(mockArr),
    'B Mock Dashboard 经真实 proxy.repo.list() 正常返回数组', `len=${mockArr.length}`);

  // ===================== [C] Supabase Dashboard：impl 行为（proxy 委托等价） =====================
  // services.js 的 lazyProxy 仅做 obj[m] = (...args) => obj._ensure().then(impl => impl[m](...args))，
  // 不添加任何逻辑，故 impl 行为即 proxy 委托行为。直接以 fake Supabase 客户端验证：
  const f = makeFake();
  for (let i = 1; i <= 3; i++) {
    const id = 'ill' + i;
    seedWork(f, { id, type: 'illustration', isPublic: true, coverAssetId: id + '__cv' });
    seedAsset(f, { id: id + '__cv', bucket: PUBLIC, original: 'x.jpg', variants: [{ id: id + '__cv_v1', path: 'x_1280.jpg', width: 1280, height: 1600 }] });
  }
  const cid = 'comicSPOT';
  seedWork(f, { id: cid, type: 'comic', isPublic: true, coverAssetId: cid + '__cv' });
  seedAsset(f, { id: cid + '__cv', bucket: PUBLIC, original: 'c.jpg', variants: [{ id: cid + '__cv_v1', path: 'c_1280.jpg', width: 1280, height: 1800 }] });
  // 110 页漫画：验证 listAdminSummary 绝不展开（不读 comic_pages）。
  for (let p = 1; p <= 110; p++) {
    f.store.comic_pages.push({ id: 'cp_' + p, work_id: cid, media_asset_id: cid + '__cv', page_number: p, sort_order: p });
  }
  // 证书：验证 listAdminSummary 仍读取 certificates 摘要。
  f.store.certificates.push({
    id: 'cert1', title: '证书A', year: 2024, year_start: 2024, year_end: 2025,
    category: 'honor', is_public: true, media_asset_id: 'cert1__cv', sort_order: 1,
  });
  seedAsset(f, { id: 'cert1__cv', bucket: PUBLIC, original: 'ct.jpg', variants: [{ id: 'cert1__cv_v1', path: 'ct_1280.jpg', width: 1280, height: 1600 }] });

  const r = new SupabaseWorkRepository(f.sb);
  const supArr = await r.listAdminSummary();
  ok(Array.isArray(supArr) && supArr.length >= 1,
    'C Supabase listAdminSummary 返回数组（Dashboard Supabase 模式可得数组）', `len=${supArr.length}`);

  const tables = new Set(f.ops.filter((o) => o.type === 'table').map((o) => o.table));
  ok(!tables.has('comic_pages'),
    'C listAdminSummary 不读取 comic_pages（含 110 页漫画也不展开）', `tables=${[...tables].join(',')}`);
  ok(!tables.has('work_images'),
    'C listAdminSummary 不读取 work_images', `tables=${[...tables].join(',')}`);
  ok(tables.has('works') && tables.has('certificates'),
    'C listAdminSummary 仅读 works + certificates 轻量摘要', `tables=${[...tables].join(',')}`);

  // ===================== [D] 综合：调用点不再 is not a function =====================
  // dashboard.js 的 isSupabase ? repo.listAdminSummary() : repo.list() 依赖两方法均注册。
  ok(typeof repo.listAdminSummary === 'function' && typeof repo.list === 'function',
    'D 调用点依赖的两个方法均已注册（不会出现 repo.listAdminSummary is not a function）');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
}

main().catch((e) => { console.error('GATE CRASHED:', e); process.exit(2); });
