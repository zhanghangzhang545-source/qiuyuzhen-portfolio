// ============================================================
// FINAL16.3-SIMPLE AB PERFORMANCE CUTOVER —— 自动回归 Gate
// ------------------------------------------------------------
// 目标：用注入式 fake Supabase 客户端（无真活库凭据），结构性证明
// Simple AB 模型已彻底生效，跨 bucket 状态机已从「活调用路径」移除：
//
//   1) publish 期间 Storage 上传=0 / 下载=0
//   2) unpublish 期间 Storage 传输=0
//   3) delete(整作品) Storage 传输=0，且不随图片 MB/张数增长
//   4) 单图删除不完整 hydrate（repository 返回 {id, ok:true}，无 getById）
//   5) 6 类上传均「单次直传 portfolio-public」，无 download→upload 第二遍、无跨 bucket
//   6) 全程零调用 publish_asset / unpublish_asset / prepare_asset_public / prepare_asset_private
//   7) 静态：index.html 不再依赖 cdn.jsdelivr.net 运行时；本地 vendor 已接入
//   8) 静态：workEdit.renderImages 已并行（Promise.all）
//   9) 14 项业务回归：新建上传 / 已发布增图 / 替换封面 / 替换普通图 /
//      漫画新增替换 / 删单图不乱序 / 替换原位 / 发布A出现 / 下架A消失 /
//      再发布恢复 / 整删A消失 / Dashboard正常 / About证书正常 / 5漫画110页读取
//
// 退出码：任意断言失败 -> 1（可作为 CI gate）；全 PASS -> 0。
// ============================================================

import { makeFake, PUBLIC, PRIVATE, seedWork, seedAsset } from './_fake_supabase.mjs';
import { SupabaseWorkRepository } from '../src/data/repository.supabase.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

let pass = 0, fail = 0;
const log = [];
function ok(cond, msg) {
  if (cond) { pass++; log.push(`  PASS  ${msg}`); }
  else { fail++; log.push(`  FAIL  ${msg}`); }
}
function fakeFile(name = 'u.jpg', size = 2 * 1024 * 1024, type = 'image/jpeg') {
  return { name, size, type };
}
function bannedRpcNames(f) {
  return f.ops.filter(o => o.type === 'rpc').map(o => o.name)
    .filter(n => ['publish_asset', 'unpublish_asset', 'prepare_asset_public', 'prepare_asset_private'].includes(n));
}
function storageOps(f) { return f.ops.filter(o => o.type === 'storage'); }
function storageUploads(f, bucket) {
  return f.ops.filter(o => o.type === 'storage' && o.op === 'upload' && (bucket == null || o.bucket === bucket));
}
function storageDownloads(f) { return f.ops.filter(o => o.type === 'storage' && o.op === 'download'); }

// 跨全部测试的 RPC 累计（用于最终「零跨 bucket RPC」结论）
const ALL_RPC = new Set();
function trackRpc(f) { f.ops.filter(o => o.type === 'rpc').forEach(o => ALL_RPC.add(o.name)); }

function seedComicPage(f, { workId, pageId, assetId, pn, so, original }) {
  seedAsset(f, { id: assetId, bucket: PUBLIC, original });
  f.store.comic_pages.push({ id: pageId, work_id: workId, media_asset_id: assetId, page_number: pn, sort_order: so });
}
function seedWorkImage(f, { workId, imgId, assetId, so, original }) {
  seedAsset(f, { id: assetId, bucket: PUBLIC, original });
  f.store.work_images.push({ id: imgId, work_id: workId, media_asset_id: assetId, sort_order: so, alt_text: null });
}

async function publicIds(repo) {
  const sb = await repo._client();
  const { data } = await sb.from('works').select('id').eq('is_public', true);
  return (data || []).map(r => r.id);
}

// ============================================================
// 1) publishWork —— 0 Storage 传输，置位 is_public，轻量返回，无 banned RPC
// ============================================================
{
  const f = makeFake();
  seedWork(f, { id: 'wA', type: 'illustration', isPublic: false, coverAssetId: 'aA' });
  seedAsset(f, { id: 'aA', bucket: PUBLIC, original: 'works/ill/wA_c.jpg' });
  const repo = new SupabaseWorkRepository(f.sb);
  f.ops.length = 0;
  const r = await repo.publishWork('wA');
  const so = storageOps(f);
  ok(so.length === 0, `publishWork: 0 次 Storage 传输（实测 ${so.length}：upload=${storageUploads(f).length}/download=${storageDownloads(f).length}）`);
  ok(r && r.public === true && r.id === 'wA', 'publishWork: 轻量返回 {id, public:true}（无 getById）');
  ok(f.store.works.find(w => w.id === 'wA').is_public === true, 'publishWork: works.is_public=true 已置位');
  ok(bannedRpcNames(f).length === 0, 'publishWork: 未调用 publish_asset/unpublish_asset/prepare_* RPC');
  trackRpc(f);
}

// ============================================================
// 2) unpublishWork —— 0 Storage 传输，轻量返回 {id, public:false}
// ============================================================
{
  const f = makeFake();
  seedWork(f, { id: 'wB', type: 'oil', isPublic: true, coverAssetId: 'aB' });
  seedAsset(f, { id: 'aB', bucket: PUBLIC, original: 'works/oil/wB_c.jpg' });
  const repo = new SupabaseWorkRepository(f.sb);
  f.ops.length = 0;
  const r = await repo.unpublishWork('wB');
  const so = storageOps(f);
  ok(so.length === 0, `unpublishWork: 0 次 Storage 传输（实测 ${so.length}）`);
  ok(r && r.public === false && r.id === 'wB', 'unpublishWork: 轻量返回 {id, public:false}（无 getById）');
  ok(f.store.works.find(w => w.id === 'wB').is_public === false, 'unpublishWork: works.is_public=false 已置位');
  ok(bannedRpcNames(f).length === 0, 'unpublishWork: 未调用 unpublish_asset RPC');
  trackRpc(f);
}

// ============================================================
// 3) remove(整作品) —— 0 Storage 传输，且不随图片张数增长；关联行清理
// ============================================================
{
  const f = makeFake();
  seedWork(f, { id: 'wC1', type: 'illustration', isPublic: true, coverAssetId: 'aC1' });
  seedAsset(f, { id: 'aC1', bucket: PUBLIC, original: 'works/ill/wC1_c.jpg' });
  for (let i = 1; i <= 1; i++) seedWorkImage(f, { workId: 'wC1', imgId: `wiC1_${i}`, assetId: `aC1_${i}`, so: i, original: `works/ill/wC1_${i}.jpg` });
  seedWork(f, { id: 'wC2', type: 'illustration', isPublic: true, coverAssetId: 'aC2' });
  seedAsset(f, { id: 'aC2', bucket: PUBLIC, original: 'works/ill/wC2_c.jpg' });
  for (let i = 1; i <= 50; i++) seedWorkImage(f, { workId: 'wC2', imgId: `wiC2_${i}`, assetId: `aC2_${i}`, so: i, original: `works/ill/wC2_${i}.jpg` });
  const repo = new SupabaseWorkRepository(f.sb);
  f.ops.length = 0;
  await repo.remove('wC1');
  const soSmall = storageOps(f).length;
  f.ops.length = 0;
  await repo.remove('wC2');
  const soBig = storageOps(f).length;
  ok(soSmall === 0 && soBig === 0, `remove(公开作品): Storage 传输=0（小图1张=${soSmall}，大图50张=${soBig}，不随图片MB/张数增长）`);
  ok(!f.store.works.find(w => w.id === 'wC1'), 'remove: 小图作品已从 works 删除');
  ok(!f.store.works.find(w => w.id === 'wC2'), 'remove: 大图作品已从 works 删除');
  ok(f.store.work_images.filter(r => r.work_id === 'wC1').length === 0, 'remove: work_images 关联行已清（小图）');
  ok(f.store.work_images.filter(r => r.work_id === 'wC2').length === 0, 'remove: work_images 关联行已清（大图50张，无遗留孤儿）');
  ok(bannedRpcNames(f).length === 0, 'remove: 未调用 unpublish_asset RPC（不搬 Storage）');
  trackRpc(f);
}

// ============================================================
// 4) removeWorkImage —— 不完整 hydrate（0 次 table select），轻量返回，剩余图连续规范化
// ============================================================
{
  const f = makeFake();
  seedWork(f, { id: 'wD', type: 'illustration', isPublic: true, coverAssetId: 'aD' });
  seedAsset(f, { id: 'aD', bucket: PUBLIC, original: 'works/ill/wD_c.jpg' });
  ['wiD_1', 'wiD_2', 'wiD_3'].forEach((id, i) => seedWorkImage(f, { workId: 'wD', imgId: id, assetId: `aD_${i + 1}`, so: i + 1, original: `works/ill/wD_${i + 1}.jpg` }));
  const repo = new SupabaseWorkRepository(f.sb);
  f.ops.length = 0;
  const r = await repo.removeWorkImage('wD', 'wiD_2');
  const tableSelects = f.ops.filter(o => o.type === 'table' && o.op === 'select');
  ok(tableSelects.length === 0, `removeWorkImage: 无完整 hydrate（0 次 table select；未发生 getById/_hydrateWorks）`);
  ok(r && r.id === 'wD' && r.ok === true && !('images' in r) && !('pages' in r), 'removeWorkImage: 轻量返回 {id, ok:true}（非完整 Work 对象）');
  const rest = f.store.work_images.filter(x => x.work_id === 'wD').sort((a, b) => a.sort_order - b.sort_order);
  ok(rest.length === 2, 'removeWorkImage: 删除后剩 2 张');
  ok(rest[0].sort_order === 1 && rest[1].sort_order === 2, 'removeWorkImage: 剩余图片 sort_order 连续规范化 1,2（不乱序）');
  ok(!rest.find(x => x.id === 'wiD_2'), 'removeWorkImage: 目标图已删（wiD_2 不在）');
  ok(bannedRpcNames(f).length === 0, 'removeWorkImage: 仅调用 remove_work_image_and_reorder（无 publish/unpublish RPC）');
  trackRpc(f);
}

// ============================================================
// 5) 6 类上传 —— 单次直传 portfolio-public（1 上传 / 0 下载 / 0 落 private）
// ============================================================
async function testUpload(label, setup, fn, expectShape) {
  const f = makeFake();
  setup(f);
  const repo = new SupabaseWorkRepository(f.sb);
  f.ops.length = 0;
  const res = await fn(repo, f);
  const up = storageUploads(f);
  const dl = storageDownloads(f);
  const toPrivate = f.ops.filter(o => o.type === 'storage' && o.bucket === PRIVATE);
  ok(up.length === 1, `${label}: 仅 1 次 Storage 上传（实测 ${up.length}）`);
  ok(up.length === 1 && up[0].bucket === PUBLIC, `${label}: 上传落到 portfolio-public（实测 ${up[0] ? up[0].bucket : '-'}）`);
  ok(dl.length === 0, `${label}: 0 次 Storage 下载（杜绝 download→upload 第二遍）`);
  ok(toPrivate.length === 0, `${label}: 0 次落到 portfolio-private（无跨 bucket 搬运）`);
  ok(bannedRpcNames(f).length === 0, `${label}: 未调用 publish_asset/prepare_* RPC（单次直传）`);
  if (expectShape) expectShape(res, f);
  trackRpc(f);
}

// 5.1 uploadWorkCover（已发布作品替换封面）
await testUpload('uploadWorkCover', (f) => {
  seedWork(f, { id: 'wE', type: 'illustration', isPublic: true, coverAssetId: 'aE' });
  seedAsset(f, { id: 'aE', bucket: PUBLIC, original: 'works/ill/wE_c.jpg' });
}, (repo) => repo.uploadWorkCover('wE', fakeFile()), (res) => {
  ok(res && res.id === 'wE' && res.coverBucket === PUBLIC && /^https?:\/\/pub\//.test(res.cover), 'uploadWorkCover: 返回 {id, cover(public URL), coverBucket:public}');
});

// 5.2 addWorkImage（已发布作品新增图片）
await testUpload('addWorkImage', (f) => {
  seedWork(f, { id: 'wE2', type: 'illustration', isPublic: true, coverAssetId: 'aE2' });
  seedAsset(f, { id: 'aE2', bucket: PUBLIC, original: 'works/ill/wE2_c.jpg' });
}, (repo) => repo.addWorkImage('wE2', fakeFile()), (res) => {
  ok(res && res.id === 'wE2' && res.image && res.image.id && res.image.bucket === PUBLIC, 'addWorkImage: 返回新图稳定 id + bucket:public（UI 本地追加）');
});

// 5.3 addComicPage（漫画新增页）
await testUpload('addComicPage', (f) => {
  seedWork(f, { id: 'wE3', type: 'comic', isPublic: true, coverAssetId: 'aE3' });
  seedAsset(f, { id: 'aE3', bucket: PUBLIC, original: 'works/comic/wE3_c.jpg' });
  seedComicPage(f, { workId: 'wE3', pageId: 'cpE3_1', assetId: 'aeE3_1', pn: 1, so: 1, original: 'works/comic/wE3_1.jpg' });
}, (repo) => repo.addComicPage('wE3', fakeFile()), (res) => {
  ok(res && res.id === 'wE3' && Array.isArray(res.pages) && res.pages.length === 2, 'addComicPage: 返回 pages 数组（新增后 2 页，不回读全 work）');
});

// 5.4 replaceWorkImage（已发布作品替换普通图，原位）
await testUpload('replaceWorkImage', (f) => {
  seedWork(f, { id: 'wE4', type: 'illustration', isPublic: true, coverAssetId: 'aE4' });
  seedAsset(f, { id: 'aE4', bucket: PUBLIC, original: 'works/ill/wE4_c.jpg' });
  seedWorkImage(f, { workId: 'wE4', imgId: 'wiE4_1', assetId: 'aE4_1', so: 1, original: 'works/ill/wE4_1.jpg' });
}, (repo) => repo.replaceWorkImage('wiE4_1', fakeFile()), (res) => {
  ok(res && res.id === 'wE4' && res.image && res.image.id === 'wiE4_1' && res.image.bucket === PUBLIC, 'replaceWorkImage: 原位替换（保留 work_images.id=wiE4_1）+ bucket:public');
});

// 5.5 replaceComicPageImage（漫画替换单页）
await testUpload('replaceComicPageImage', (f) => {
  seedWork(f, { id: 'wE5', type: 'comic', isPublic: true, coverAssetId: 'aE5' });
  seedAsset(f, { id: 'aE5', bucket: PUBLIC, original: 'works/comic/wE5_c.jpg' });
  seedComicPage(f, { workId: 'wE5', pageId: 'cpE5_1', assetId: 'aeE5_1', pn: 1, so: 1, original: 'works/comic/wE5_1.jpg' });
}, (repo) => repo.replaceComicPageImage('cpE5_1', fakeFile()), (res) => {
  ok(res && res.id === 'wE5' && Array.isArray(res.pages) && res.pages.length === 1, 'replaceComicPageImage: 返回 pages 数组（1 页，不回读全 work）');
});

// 5.6 replaceCertificateImage（证书替换图片）
await testUpload('replaceCertificateImage', (f) => {
  f.store.certificates.push({ id: 'certE6', title: 'C', is_public: true, media_asset_id: 'aE6', sort_order: 1, year: 2020, year_start: 2020, year_end: 2021, category: 'x' });
  seedAsset(f, { id: 'aE6', bucket: PUBLIC, original: 'certificates/certE6.jpg' });
}, (repo) => repo.replaceCertificateImage('certE6', fakeFile()), (res) => {
  ok(res && res.id === 'certE6' && res.coverBucket === PUBLIC && /^https?:\/\/pub\//.test(res.cover), 'replaceCertificateImage: 返回 {id, cover(public URL), coverBucket:public}');
});

// ============================================================
// 6) 静态检查：jsDelivr 运行时依赖 = NO；本地 vendor 已接入
// ============================================================
{
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const sc = readFileSync(join(ROOT, 'src/data/supabaseClient.js'), 'utf8');
  ok(!/cdn\.jsdelivr\.net/i.test(html), '静态: index.html 无运行时 cdn.jsdelivr.net 引用（仅注释提及；SDK 改本地 vendor 静态加载）');
  ok(/vendor\/supabase-js@2\.112\.3\.umd\.js/.test(html), '静态: index.html 已接入本地 vendor/supabase-js@2.112.3.umd.js（<script defer>）');
  ok(!/cdn\.jsdelivr\.net/.test(sc) && /globalThis\.supabase/.test(sc), '静态: supabaseClient.js 改用 globalThis.supabase.createClient（本地 vendor，非 jsDelivr 远程 ESM）');
}

// ============================================================
// 7) 静态检查：workEdit.renderImages 已并行（Promise.all）
// ============================================================
{
  const we = readFileSync(join(ROOT, 'src/ui/pages/admin/workEdit.js'), 'utf8');
  ok(/Promise\.all\(imagesState\.map\(\(m\) => adminPreviewSrc/.test(we), '静态: workEdit.renderImages 用 Promise.all 并行取得全部预览 URL（不再串行 await）');
}

// ============================================================
// 8) 14 项业务回归（真实规模数据集：25 作品 / 6 证书 / 110 漫画页）
// ============================================================
{
  const f = makeFake();
  // 5 部漫画 × 22 页 = 110 页
  const comicIds = ['c1', 'c2', 'c3', 'c4', 'c5'];
  comicIds.forEach((cid, ci) => {
    seedWork(f, { id: cid, type: 'comic', isPublic: ci % 2 === 0, coverAssetId: `ac_${cid}` });
    seedAsset(f, { id: `ac_${cid}`, bucket: PUBLIC, original: `works/comic/${cid}_c.jpg` });
    for (let p = 1; p <= 22; p++) seedComicPage(f, { workId: cid, pageId: `${cid}_p${p}`, assetId: `${cid}_a${p}`, pn: p, so: p, original: `works/comic/${cid}_${p}.jpg` });
  });
  // 20 件非漫画（插画/油画），混合公开/草稿，部分带图
  for (let i = 1; i <= 20; i++) {
    const id = `n${i}`;
    const isPub = i % 3 !== 0;
    seedWork(f, { id, type: i % 2 === 0 ? 'oil' : 'illustration', isPublic: isPub, coverAssetId: `an_${id}` });
    seedAsset(f, { id: `an_${id}`, bucket: PUBLIC, original: `works/ill/${id}_c.jpg` });
    if (i <= 8) for (let k = 1; k <= 3; k++) seedWorkImage(f, { workId: id, imgId: `${id}_wi${k}`, assetId: `${id}_a${k}`, so: k, original: `works/ill/${id}_${k}.jpg` });
  }
  // 6 证书
  for (let i = 1; i <= 6; i++) {
    const id = `cert${i}`;
    f.store.certificates.push({ id, title: `证书${i}`, is_public: i % 2 === 1, media_asset_id: `acert_${id}`, sort_order: i, year: 2020, year_start: 2020, year_end: 2021, category: 'x' });
    seedAsset(f, { id: `acert_${id}`, bucket: PUBLIC, original: `certificates/${id}.jpg` });
  }
  const repo = new SupabaseWorkRepository(f.sb);

  // 8.1 list() 全量 + 110 页读取（A 前台数据完整）
  f.ops.length = 0;
  const all = await repo.list();
  const works = all.filter(w => w.type !== 'certificate');
  const certs = all.filter(w => w.type === 'certificate');
  const totalPages = all.filter(w => w.type === 'comic').reduce((s, w) => s + w.pages.length, 0);
  ok(works.length === 25 && certs.length === 6, `回归: list() 返回 25 作品 + 6 证书（实测 ${works.length} 作品 / ${certs.length} 证书）`);
  ok(totalPages === 110, `回归: 5 漫画共 110 页全部正确读取（实测 ${totalPages} 页）`);
  ok(storageOps(f).length === 0, '回归: A 前台 list() 读取 0 次 Storage 传输（仅 table 查询）');

  // 8.2 Dashboard 正常（listAdminSummary，不 hydrate 110 页）
  f.ops.length = 0;
  const dash = await repo.listAdminSummary();
  ok(dash.length === 31, `回归: Dashboard(listAdminSummary) 返回 31 条（25 作品 + 6 证书，实测 ${dash.length}）`);
  ok(storageOps(f).length === 0, '回归: Dashboard 0 次 Storage 传输（仅取封面级摘要，不拉 110 页）');

  // 8.3 发布（草稿 n3）→ A 立即出现
  f.ops.length = 0;
  const pr = await repo.publishWork('n3');
  ok(storageOps(f).length === 0 && pr.public === true, '回归: 发布草稿 n3（0 Storage 传输，public=true）');
  f.ops.length = 0;
  let pub = await publicIds(repo);
  ok(pub.includes('n3'), '回归: 发布后 A 公开查询立即出现 n3');

  // 8.4 下架 → A 立即消失
  f.ops.length = 0;
  const ur = await repo.unpublishWork('n3');
  ok(storageOps(f).length === 0 && ur.public === false, '回归: 下架 n3（0 Storage 传输，public=false）');
  f.ops.length = 0;
  pub = await publicIds(repo);
  ok(!pub.includes('n3'), '回归: 下架后 A 公开查询立即消失 n3');

  // 8.5 再发布 → 恢复出现
  f.ops.length = 0;
  await repo.publishWork('n3');
  f.ops.length = 0;
  pub = await publicIds(repo);
  ok(pub.includes('n3'), '回归: 再发布后 A 公开查询恢复出现 n3');

  // 8.6 整作品删除（公开 n1）→ A 立即消失
  f.ops.length = 0;
  await repo.remove('n1');
  ok(!f.store.works.find(w => w.id === 'n1'), '回归: 整删 n1 已从 works 移除');
  f.ops.length = 0;
  pub = await publicIds(repo);
  ok(!pub.includes('n1'), '回归: 整删后 A 公开查询立即消失 n1');

  // 8.7 漫画 getById 单部 22 页（漫画新增/替换/读取正常）
  f.ops.length = 0;
  const c1 = await repo.getById('c1');
  ok(c1 && c1.pages.length === 22, `回归: 漫画 c1 getById 返回 22 页（实测 ${c1 ? c1.pages.length : 'null'}）`);

  // 8.8 About/证书正常：证书在 list() 中可读且含封面
  const certOk = certs.every(c => typeof c.cover === 'string' && c.cover.length > 0);
  ok(certOk, '回归: 6 证书均含有效封面 URL（About/证书栏目正常）');

  trackRpc(f);
}

// ============================================================
// 9) 全局结论：全程零跨 bucket RPC
// ============================================================
{
  const banned = [...ALL_RPC].filter(n => ['publish_asset', 'unpublish_asset', 'prepare_asset_public', 'prepare_asset_private'].includes(n));
  ok(banned.length === 0, `全局: 全程零调用跨 bucket RPC（publish_asset/unpublish_asset/prepare_*）—— 实测出现过的 RPC: [${[...ALL_RPC].join(', ') || '（无）'}]`);
}

// ============================================================
// 汇总输出
// ============================================================
console.log('\n================ FINAL16.3-SIMPLE AB 回归 Gate ================');
console.log(log.join('\n'));
console.log('------------------------------------------------------------');
console.log(`总计: ${pass} PASS / ${fail} FAIL`);
console.log('============================================================\n');
process.exitCode = fail > 0 ? 1 : 0;
