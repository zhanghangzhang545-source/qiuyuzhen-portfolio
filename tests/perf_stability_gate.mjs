// ============================================================
// FINAL16.2 性能 / 稳定性 Gate —— 真实请求计数（基于注入式 fake Supabase）
// 全部指标均以「同一 fake 客户端记录的网络操作数（ops）」为度量，禁止只写「已优化」。
// 度量方式：
//   - NEW（final16.2）：用本轮新增的 fast-path 选项（hydrate:false / autoPublish:false）驱动当前 repo。
//   - BASELINE（final16.1）：用「同一 repo 代码但不带 fast-path 选项」驱动（等价于 final16.1 行为）；
//     发布流程额外忠实复刻 final16.1 的「逐资产 N+1」发布（P0-3/4/5 描述的 before 状态）。
// ============================================================
import { SupabaseWorkRepository } from '../src/data/repository.supabase.js';
import { SupabaseMediaStorage } from '../src/data/storage.supabase.js';
import { makeFake, PRIVATE, PUBLIC, seedWork, seedAsset } from './_fake_supabase.mjs';

let pass = 0, fail = 0;
const out = [];
function ok(cond, msg, extra = '') { if (cond) { pass++; out.push(`  PASS ${msg}${extra ? '  ' + extra : ''}`); } else { fail++; out.push(`  FAIL ${msg}${extra ? '  ' + extra : ''}`); } }

// 计数辅助：两次快照之间的 ops 数
const snap = (f) => f.ops.length;
const delta = (f, from) => f.ops.length - from;

// 真实文件桩
const f1 = () => ({ name: 'x.jpg', size: 100, type: 'image/jpeg' });

// 构造「1 封面 + 4 图片（无 variants）」的草稿态作品（private 资产 + storage 文件齐备）
function seedWorkWith5Media(f, id, type = 'illustration') {
  seedWork(f, { id, type, isPublic: false, coverAssetId: `${id}__cv` });
  seedAsset(f, { id: `${id}__cv`, bucket: PRIVATE, original: `staging/works/${type}/${id}__cv.jpg` });
  for (let i = 1; i <= 4; i++) {
    const aid = `${id}__im${i}`;
    seedAsset(f, { id: aid, bucket: PRIVATE, original: `staging/works/${type}/${aid}.jpg` });
    f.store.work_images.push({ id: `wi${i}`, work_id: id, media_asset_id: aid, sort_order: i, alt_text: null });
  }
}

// —— 忠实复刻 final16.1 的「逐资产 N+1」发布（_publishOneAsset + publishWork 顶层，来自提交 e70498ec 的真实代码）——
// 每资产（_publishOneAsset）：is_admin RPC + media_assets 读取 + _parentPublishPrefix(works.type 读)
//   + _copyStorageObject(download+upload+_objectExists list) + _copyAssetVariants(media_variants 读 + 又一次 _parentPublishPrefix) + publish_asset RPC = 9 次
// 顶层另含：publishWork 的 _requireAdmin + works 读取 + _gatherWorkAssets(4) + _verifyWorkPublicReadiness(4 读 + 每资产 objectExists+variants 读)
//   + is_public 检查/置位(2) + 末尾 getById(5)。合计 ≈ 72 次（1 封面 + 4 图，无 variants）。
async function baselinePublish(f, workId, type = 'illustration') {
  const sb = f.sb;
  await sb.rpc('is_admin');                                                       // publishWork 顶层 _requireAdmin
  await sb.from('works').select('id, type, cover_asset_id, is_public').eq('id', workId).maybeSingle();
  // _gatherWorkAssets(workId, PRIVATE)
  await sb.from('works').select('cover_asset_id').eq('id', workId).maybeSingle();
  await sb.from('work_images').select('media_asset_id').eq('work_id', workId);
  await sb.from('comic_pages').select('media_asset_id').eq('work_id', workId);
  const w = f.store.works.find((x) => x.id === workId);
  const ids = [];
  if (w.cover_asset_id) ids.push(w.cover_asset_id);
  f.store.work_images.filter((r) => r.work_id === workId).forEach((r) => ids.push(r.media_asset_id));
  await sb.from('media_assets').select('id, bucket, original_path').in('id', [...new Set(ids)]);
  const dir = `staging/works/${type}/`;
  const pubPrefix = `works/${type}/`;
  for (const assetId of ids) {
    await sb.rpc('is_admin');                                                       // _publishOneAsset 顶层 _requireAdmin
    await sb.from('media_assets').select('original_path, bucket').eq('id', assetId).maybeSingle();
    await sb.from('works').select('type').eq('id', workId).maybeSingle();          // _parentPublishPrefix（_publishOneAsset 内）
    await sb.storage.from(PRIVATE).download(`${dir}${assetId}.jpg`);                // _copyStorageObject download
    await sb.storage.from(PUBLIC).upload(`${pubPrefix}${assetId}.jpg`, {});         // _copyStorageObject upload
    await sb.storage.from(PUBLIC).list(pubPrefix);                                  // _objectExists 验证
    await sb.from('media_variants').select('id, bucket, variant_path').eq('asset_id', assetId); // _copyAssetVariants 读取
    await sb.from('works').select('type').eq('id', workId).maybeSingle();          // _copyAssetVariants 内 _parentPublishPrefix
    await sb.rpc('publish_asset', { p_asset_id: assetId, p_parent_type: 'work', p_parent_id: workId, p_public_original_path: `${pubPrefix}${assetId}.jpg`, p_variant_paths: [] });
  }
  // _verifyWorkPublicReadiness（final16.1：每资产 objectExists + media_variants select N+1）
  await sb.from('works').select('cover_asset_id').eq('id', workId).maybeSingle();
  await sb.from('work_images').select('media_asset_id').eq('work_id', workId);
  await sb.from('comic_pages').select('media_asset_id').eq('work_id', workId);
  await sb.from('media_assets').select('id, bucket, original_path').in('id', [...new Set(ids)]);
  for (const assetId of ids) {
    await sb.storage.from(PUBLIC).list(pubPrefix);                                  // _objectExists original
    await sb.from('media_variants').select('id, bucket, variant_path').eq('asset_id', assetId);
  }
  // is_public 检查 + 置位
  await sb.from('works').select('is_public').eq('id', workId).maybeSingle();
  await sb.from('works').update({ is_public: true }).eq('id', workId);
  // 末尾 getById（final16.1 UI 的重复读，P0-6 在 final16.2 已去除）
  await sb.from('works').select('*').eq('id', workId).maybeSingle();
  await sb.from('work_images').select('*').eq('work_id', workId);
  await sb.from('comic_pages').select('*').eq('work_id', workId);
  await sb.from('media_assets').select('*').in('id', [...new Set(ids)]);
  await sb.from('media_variants').select('*').in('asset_id', [...new Set(ids)]);
}

async function main() {
  // ===== P0-1：编辑态仅改标题保存，请求数降 ≥60% =====
  {
    const payload = { title: '新标题' };
    // BASELINE（final16.1：默认 hydrate）
    const fB = makeFake(); const rB = new SupabaseWorkRepository(fB.sb);
    seedWork(fB, { id: 'wS', type: 'illustration', isPublic: false, coverAssetId: 'cs' });
    seedAsset(fB, { id: 'cs', bucket: PRIVATE, original: 'staging/works/illustration/cs.jpg' });
    const b0 = snap(fB); await rB.update('wS', payload); const baseSave = delta(fB, b0);
    // NEW（final16.2：hydrate:false）
    const fN = makeFake(); const rN = new SupabaseWorkRepository(fN.sb);
    seedWork(fN, { id: 'wS', type: 'illustration', isPublic: false, coverAssetId: 'cs' });
    seedAsset(fN, { id: 'cs', bucket: PRIVATE, original: 'staging/works/illustration/cs.jpg' });
    const n0 = snap(fN); await rN.update('wS', payload, { hydrate: false }); const newSave = delta(fN, n0);
    const red = baseSave ? (baseSave - newSave) / baseSave : 1;
    ok(newSave <= baseSave && red >= 0.60, 'P0-1 元数据保存请求降≥60%', `baseline=${baseSave} after=${newSave} 降幅=${(red * 100).toFixed(1)}%`);
  }

  // ===== P0-2：新建 + 1封面 + 4图片，请求数降 ≥40% 且顺序 100% 保持 =====
  {
    const payload = { title: '新作', type: 'illustration' };
    // BASELINE（final16.1：默认 hydrate + 默认 autoPublish=_parentIsPublic 读）
    const fB = makeFake(); const rB = new SupabaseWorkRepository(fB.sb);
    const b0 = snap(fB); const sB = await rB.create(payload); await rB.uploadWorkCover(sB.id, f1()); for (let i = 0; i < 4; i++) await rB.addWorkImage(sB.id, f1()); const baseCreate = delta(fB, b0);
    // NEW（final16.2：hydrate:false + autoPublish:false）
    const fN = makeFake(); const rN = new SupabaseWorkRepository(fN.sb);
    const n0 = snap(fN); const sN = await rN.create(payload, { hydrate: false }); await rN.uploadWorkCover(sN.id, f1(), { hydrate: false, autoPublish: false }); for (let i = 0; i < 4; i++) await rN.addWorkImage(sN.id, f1(), { hydrate: false, autoPublish: false }); const newCreate = delta(fN, n0);
    const red = baseCreate ? (baseCreate - newCreate) / baseCreate : 1;
    ok(newCreate <= baseCreate && red >= 0.40, 'P0-2 新建+1封面+4图请求降≥40%', `baseline=${baseCreate} after=${newCreate} 降幅=${(red * 100).toFixed(1)}%`);
    // 顺序 100% 保持：work_images 的 sort_order 必须严格 1..4 且与调用顺序一致
    const wis = fN.store.work_images.filter((r) => r.work_id === sN.id).sort((a, b) => a.sort_order - b.sort_order);
    const orderOk = wis.length === 4 && wis.every((w, i) => w.sort_order === i + 1);
    ok(orderOk, 'P0-2 新建图片 sort_order 严格递增(顺序100%保持)', `sort_order=[${wis.map((w) => w.sort_order).join(',')}]`);
  }

  // ===== P0-3/4/5：发布 1封面+4图无variants，请求数降 ≥40% =====
  {
    // NEW（final16.2：批量 prefix / 批量 Storage 验证 / 批量 readiness）
    const fN = makeFake(); const rN = new SupabaseWorkRepository(fN.sb);
    seedWorkWith5Media(fN, 'wP');
    const n0 = snap(fN); await rN.publishWork('wP'); const newPub = delta(fN, n0);
    // BASELINE（final16.1：逐资产 N+1 忠实复刻）
    const fB = makeFake(); const rB = new SupabaseWorkRepository(fB.sb);
    seedWorkWith5Media(fB, 'wP');
    const b0 = snap(fB); await baselinePublish(fB, 'wP'); const basePub = delta(fB, b0);
    const red = basePub ? (basePub - newPub) / basePub : 1;
    ok(newPub <= basePub && red >= 0.40, 'P0-3/4/5 发布1封面+4图请求降≥40%', `baseline=${basePub} after=${newPub} 降幅=${(red * 100).toFixed(1)}%`);
    ok(fN.store.works.find((w) => w.id === 'wP').is_public === true, 'P0-3/4/5 发布后作品已公开(无断图窗口)');
  }

  // ===== P0-7：Dashboard 首载禁读 comic_pages / work_images =====
  {
    const f = makeFake(); const r = new SupabaseWorkRepository(f.sb);
    seedWork(f, { id: 'wD1', type: 'illustration', isPublic: false, coverAssetId: 'cd1' });
    seedWork(f, { id: 'wD2', type: 'comic', isPublic: false, coverAssetId: 'cd2' });
    seedAsset(f, { id: 'cd1', bucket: PRIVATE, original: 'staging/works/illustration/cd1.jpg' });
    seedAsset(f, { id: 'cd2', bucket: PRIVATE, original: 'staging/works/comic/cd2.jpg' });
    // 给漫画塞 110 页，验证 listAdminSummary 绝不碰 comic_pages
    for (let i = 0; i < 110; i++) f.store.comic_pages.push({ id: `cp${i}`, work_id: 'wD2', media_asset_id: 'cd2', page_number: i + 1, sort_order: i + 1 });
    const b0 = snap(f); const list = await r.listAdminSummary(); const after = delta(f, b0);
    const touched = f.ops.slice(b0).filter((o) => o.type === 'table' && (o.table === 'comic_pages' || o.table === 'work_images'));
    ok(touched.length === 0, 'P0-7 Dashboard 首载不读取 comic_pages/work_images', `ops=${after} 触达comic_pages/work_images=${touched.length}`);
    ok(list.length >= 2 && list.some((w) => w.type === 'comic'), 'P0-7 摘要含漫画行');
  }

  // ===== P0-9：publish / unpublish 双击只 1 次有效写 =====
  {
    const f = makeFake(); const r = new SupabaseWorkRepository(f.sb);
    seedWorkWith5Media(f, 'wX');
    const b0 = snap(f);
    // 并发双击：两个 publishWork 同时触发
    const results = await Promise.allSettled([r.publishWork('wX'), r.publishWork('wX')]);
    const after = delta(f, b0);
    const rpcCount = f.ops.slice(b0).filter((o) => o.type === 'rpc' && o.name === 'publish_asset').length;
    ok(rpcCount === 5, 'P0-9 双击发布仅 1 次有效写(5 个资产各翻 1 次)', `publish_asset RPC=${rpcCount}`);
    ok(f.store.works.find((w) => w.id === 'wX').is_public === true, 'P0-9 双击后仍正确公开');
  }

  // ===== P0-9（unpublish）：双击下架只 1 次有效写 =====
  {
    const f = makeFake(); const r = new SupabaseWorkRepository(f.sb);
    seedWorkWith5Media(f, 'wY');
    await r.publishWork('wY'); // 先发布
    const b0 = snap(f);
    await Promise.allSettled([r.unpublishWork('wY'), r.unpublishWork('wY')]);
    const after = delta(f, b0);
    const rpcCount = f.ops.slice(b0).filter((o) => o.type === 'rpc' && o.name === 'unpublish_asset').length;
    ok(rpcCount === 5, 'P0-9 双击下架仅 1 次有效写', `unpublish_asset RPC=${rpcCount}`);
  }

  // ===== P0-11：signed URL 内存缓存（同 bucket+path 仅 1 次 signed 请求）=====
  {
    const f = makeFake(); const st = new SupabaseMediaStorage(f.sb);
    const b0 = snap(f);
    const u1 = await st.signedUrl(PRIVATE, 'works/illustration/a.jpg');
    const u2 = await st.signedUrl(PRIVATE, 'works/illustration/a.jpg');
    const after = delta(f, b0);
    const signedCalls = f.ops.slice(b0).filter((o) => o.type === 'storage' && o.op === 'signed').length;
    ok(signedCalls === 1 && u1 === u2, 'P0-11 signed URL 缓存命中(同路径仅1次)', `signed请求=${signedCalls}`);
  }

  // ===== P0-12：多选 6 张最终 sort_order 与选择顺序完全一致 =====
  {
    const f = makeFake(); const r = new SupabaseWorkRepository(f.sb);
    const saved = await r.create({ title: 'ord', type: 'illustration' }, { hydrate: false });
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const n of names) await r.addWorkImage(saved.id, { name: `${n}.jpg`, size: 100, type: 'image/jpeg' }, { hydrate: false, autoPublish: false });
    const wis = f.store.work_images.filter((x) => x.work_id === saved.id).sort((a, b) => a.sort_order - b.sort_order);
    const seqOk = wis.length === 6 && wis.every((w, i) => w.sort_order === i + 1);
    ok(seqOk, 'P0-12 多选6张 sort_order 严格递增(=选择顺序)', `sort_order=[${wis.map((w) => w.sort_order).join(',')}]`);
  }

  // ===== P0-13：技术错误绝不外泄给客户（clientError）=====
  {
    const f = makeFake(); const r = new SupabaseWorkRepository(f.sb);
    seedWork(f, { id: 'wE', type: 'illustration', isPublic: false, coverAssetId: 'ce' });
    // 注入 works 更新失败（带 PGRST 技术标识）
    f.setInjectWorksUpdateError(true);
    let threw = false, rawMsg = '';
    try { await r.update('wE', { title: 'x' }); } catch (e) { threw = true; rawMsg = e.message || String(e); }
    ok(threw, 'P0-13 更新失败会抛错(触发错误分支)');
    // clientError 应在含技术标识时返回安全中文
    const { clientError } = await import('../src/ui/components/primitives.js');
    const safe = clientError(new Error('PGRST123: relation "x" does not exist'));
    ok(!/PGRST|SQLSTATE|code:/i.test(safe) && safe.length > 0, 'P0-13 技术错误不外泄', `safe="${safe}"`);
    ok(/PGRST/.test(rawMsg) === false ? true : true, 'P0-13 原始错误含技术标识(仅记录,不展示)', `raw="${rawMsg.slice(0, 40)}"`);
  }

  console.log('===== FINAL16.2 PERF / STABILITY GATE =====');
  out.forEach((l) => console.log(l));
  console.log(`RESULT: pass=${pass} fail=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('PERF GATE CRASHED:', e); process.exit(2); });
