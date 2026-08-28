// ============================================================
// FINAL16 自动代码 Gate —— 针对 P0-一..P0-十二 共 16 项的失败注入 / 契约一致测试
// 使用注入式 fake Supabase 客户端（无真活库凭据）。
//
// 关键硬化（P0-二）：fake 的 publish_asset / unpublish_asset 必须忠实复刻
//   supabase/migrations/003_rpc.sql 的契约——含 asset→parent ownership 守卫、
//   canonical 前缀校验、variant set 完整性 / 归属校验、work_ready 判定、comic 前缀。
//   （final15 的 fake 不校验 ownership，会制造错误 PASS —— 本轮修复。）
//
// 本轮新增 fake RPC（与 005 / 006 一致）：
//   prepare_asset_public / prepare_asset_private（不校验 ownership，不碰父 FK / is_public）
//   append_work_image / append_comic_page（max+1 原子追加；此处单线程模拟，DB 层 FOR UPDATE 串行化）
// 并硬化 fake remove_comic_page_and_reorder 的「公开漫画最后 1 页保护」（P0-七）。
//
// 覆盖清单（P0-十一 16 项，禁止只做字符串断言）：
//   G1  production publish_asset ownership guard 与 fake 一致（fake 拒绝未关联资产）
//   G2  未关联新 asset 直接 publish_asset 必须 FAIL
//   G3  prepare_asset_public 成功后父 FK 仍旧
//   G4  prepare 完成后 link 成功→父 FK 指向 public 资产
//   G5  link 失败→旧 FK 恢复且新 asset 完整回滚（无 public 孤儿）
//   G6  original copy 后 RPC 失败→无 public 孤儿
//   G7  prepare RPC 失败→本轮 original + 全部 variant public 拷贝均清理
//   G8  reverse RPC 失败时不得删除 DB 仍引用对象（_reversePublish / _rollbackPreparedAsset）
//   G9  publishWork 最终 readiness 验证（缺存储对象→阻塞 is_public=true）
//   G10 unpublishWork 混合 bucket 检测（original private 但 variant 仍 public → 阻塞）
//   G11 删除公开漫画最后 1 页被拒绝（中文错误）
//   G12 草稿漫画最后 1 页可删（允许删成 0 页）
//   G13 并发 append 顺序唯一稳定（repo 走 append_ RPC，无 JS max+1 insert）
//   G14 work images F5 顺序稳定（相同 sort_order 以 id 兜底）
//   G15 comic pages F5 顺序稳定
//   G16 所有 RPC error 保留 code/message/details/hint
// ============================================================
import { SupabaseWorkRepository } from '../src/data/repository.supabase.js';

import { makeFake, PRIVATE, PUBLIC, seedWork, seedAsset } from './_fake_supabase.mjs';

let pass = 0, fail = 0;
const log = [];
function ok(cond, msg) { if (cond) { pass++; log.push(`  PASS ${msg}`); } else { fail++; log.push(`  FAIL ${msg}`); } }

async function main() {
  // —— G1 & G2：production publish_asset ownership guard 与 fake 一致；未关联新 asset 直接 publish_asset 必须 FAIL ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wA', type: 'illustration', isPublic: false, coverAssetId: 'ca' });
    seedAsset(f, { id: 'ca', bucket: PUBLIC, original: 'works/illustration/ca.jpg' });
    seedAsset(f, { id: 'orphan', bucket: PRIVATE, original: 'drafts/orphan.jpg' });
    // 未关联资产 → 必须 FAIL（与 003 一致）
    const r1 = await f.sb.rpc('publish_asset', { p_asset_id: 'orphan', p_parent_type: 'work', p_parent_id: 'wA', p_public_original_path: 'works/illustration/orphan.jpg', p_variant_paths: [] });
    ok(r1.data && r1.data.ok === false && /is not referenced/.test(r1.data.error), 'G1/G2: 未关联 asset 直接 publish_asset 被 ownership guard 拒绝（与 003 一致）');
    // 已关联资产（封面）→ 必须 ok:true
    const r2 = await f.sb.rpc('publish_asset', { p_asset_id: 'ca', p_parent_type: 'work', p_parent_id: 'wA', p_public_original_path: 'works/illustration/ca.jpg', p_variant_paths: [] });
    ok(r2.data && r2.data.ok === true, 'G1: 已关联 asset（封面）publish_asset 成功（guard 一致）');
  }

  // —— G3：prepare_asset_public 成功后父 FK 仍旧 ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wB', type: 'illustration', isPublic: false, coverAssetId: 'cb' });
    seedAsset(f, { id: 'cb', bucket: PUBLIC, original: 'works/illustration/cb.jpg' });
    seedAsset(f, { id: 'newB', bucket: PRIVATE, original: 'drafts/newB.jpg', variants: [{ id: 'newB_v1', path: 'drafts/newB_v1.jpg' }] });
    const before = f.store.works.find((w) => w.id === 'wB').cover_asset_id;
    const rp = await f.sb.rpc('prepare_asset_public', { p_asset_id: 'newB', p_parent_type: 'work', p_parent_id: 'wB', p_public_original_path: 'works/illustration/newB.jpg', p_variant_paths: [{ variant_id: 'newB_v1', path: 'works/illustration/newB_v1.jpg' }] });
    ok(rp.data && rp.data.ok === true, 'G3: prepare_asset_public 成功');
    const after = f.store.works.find((w) => w.id === 'wB').cover_asset_id;
    ok(after === before && after === 'cb', 'G3: prepare 后父 FK（cover_asset_id）保持不变');
    ok(f.store.works.find((w) => w.id === 'wB').is_public === false, 'G3: prepare 后父 is_public 不变（仍 false）');
    ok(f.store.media_assets.find((a) => a.id === 'newB').bucket === PUBLIC, 'G3: prepare 后新 asset 自身翻为 public');
  }

  // —— G4：prepare 完成后 link 成功 → 父 FK 指向 public 资产（P0-一 推荐状态机：先 prepare 后 link）——
  {
    const f = makeFake();
    seedWork(f, { id: 'wC', type: 'illustration', isPublic: true, coverAssetId: 'cc' });
    seedAsset(f, { id: 'cc', bucket: PUBLIC, original: 'works/illustration/cc.jpg' });
    const repo = new SupabaseWorkRepository(f.sb);
    // 直接调用 _uploadAndLink（autoPublish）以校验其返回的 url 为真实 canonical public path（P0-十）
    const res = await repo._uploadAndLink({ name: 'newC.jpg', size: 100, type: 'image/jpeg' }, {
      parentType: 'work', parentId: 'wC', autoPublish: true,
      linkFn: async (assetId, ctx) => {
        const { data: old } = await f.sb.from('works').select('cover_asset_id').eq('id', 'wC').maybeSingle();
        ctx.rollbacks.push(async () => { await f.sb.from('works').update({ cover_asset_id: old && old.cover_asset_id }).eq('id', 'wC'); });
        await f.sb.from('works').update({ cover_asset_id: assetId }).eq('id', 'wC');
      },
    });
    const newAssetId = res.assetId;
    ok(f.store.works.find((w) => w.id === 'wC').cover_asset_id === newAssetId, 'G4: link 成功后父 FK 指向新 public 资产');
    ok(f.store.media_assets.find((a) => a.id === newAssetId).bucket === PUBLIC, 'G4: 新资产已是 public（A 无断图窗口）');
    // P0-十：返回 URL 为真实 canonical public path
    ok(res.url && res.url.includes('portfolio-public/works/illustration/') && !res.url.includes('portfolio-private'), 'G4(P0-十): 返回 URL 为真实 canonical public path（非 private key）');
    // 关键：_uploadAndLink 对未关联新资产走 prepare_asset_public，而非 publish_asset（避免 ownership guard 误杀）
    const usedPrepare = f.ops.some((o) => o.type === 'rpc' && o.name === 'prepare_asset_public');
    const usedPublishOnNew = f.ops.some((o) => o.type === 'rpc' && o.name === 'publish_asset' && o.params.p_asset_id === newAssetId);
    ok(usedPrepare && !usedPublishOnNew, 'G4: 新资产走 prepare_asset_public（非 publish_asset），规避 ownership 契约冲突');
  }

  // —— G5：link 失败 → 旧 FK 恢复且新 asset 完整回滚（无 public 孤儿）——
  {
    const f = makeFake();
    seedWork(f, { id: 'wD', type: 'illustration', isPublic: true, coverAssetId: 'cd' });
    seedAsset(f, { id: 'cd', bucket: PUBLIC, original: 'works/illustration/cd.jpg' });
    f.setInjectWorksUpdateError(true);
    const repo = new SupabaseWorkRepository(f.sb);
    let threw = false;
    try { await repo.uploadWorkCover('wD', { name: 'newD.jpg', size: 100, type: 'image/jpeg' }); } catch (e) { threw = true; }
    ok(threw, 'G5: linkFn（works.update cover）失败抛错');
    ok(f.store.works.find((w) => w.id === 'wD').cover_asset_id === 'cd', 'G5: 失败后旧 FK 恢复（cover 仍指向旧资产，A B C 不变）');
    ok(!f.store.media_assets.some((a) => a.id && a.id.startsWith('wD__work')), 'G5: 新资产已完整回滚（无孤儿 media_assets）');
  }

  // —— G6：original copy 后 RPC 失败 → 无 public 孤儿 ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wE', type: 'illustration', isPublic: true, coverAssetId: 'ce' });
    seedAsset(f, { id: 'ce', bucket: PUBLIC, original: 'works/illustration/ce.jpg' });
    const repo = new SupabaseWorkRepository(f.sb);
    f.failRpc['prepare_asset_public'] = true; // prepare RPC 失败（发生在 original+variants copy 之后）
    let threw = false;
    try { await repo.uploadWorkCover('wE', { name: 'newE.jpg', size: 100, type: 'image/jpeg' }); } catch (e) { threw = true; }
    ok(threw, 'G6: prepare RPC 失败抛错');
    const newAsset = f.store.media_assets.find((a) => a.id !== 'ce');
    const pubPath = newAsset ? `works/illustration/${String(newAsset.original_path).split('/').pop()}` : null;
    // 注意：prepare_asset_public 在 RPC 失败前已把 original copy 到 public；helper 必须清理
    ok(!f.storage[PUBLIC].files['works/illustration/newE.jpg'], 'G6: original copy 后 RPC 失败 → 本轮 public original 已清理（无孤儿）');
    ok(!f.store.media_assets.some((a) => a.id !== 'ce' && a.bucket === PUBLIC), 'G6: 无残留 public 孤儿资产（新资产已完整回滚/清理）');
  }

  // —— G7：prepare RPC 失败 → 本轮 original + 全部 variant public 拷贝均清理 ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wF', type: 'illustration', isPublic: true, coverAssetId: 'cf' });
    seedAsset(f, { id: 'cf', bucket: PUBLIC, original: 'works/illustration/cf.jpg' });
    const repo = new SupabaseWorkRepository(f.sb);
    f.failRpc['prepare_asset_public'] = true;
    try { await repo.uploadWorkCover('wF', { name: 'newF.jpg', size: 100, type: 'image/jpeg' }); } catch (e) { /* expect throw */ }
    ok(!f.storage[PUBLIC].files['works/illustration/newF.jpg'], 'G7: 本轮 public original 拷贝清理');
    ok(!Object.keys(f.storage[PUBLIC].files).some((p) => p.startsWith('works/illustration/newF_')), 'G7: 本轮 public variant 拷贝清理（无孤儿变种）');
  }

  // —— G8：reverse RPC 失败时不得删除 DB 仍引用对象 ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wG', type: 'illustration', isPublic: true, coverAssetId: 'ga' });
    seedAsset(f, { id: 'ga', bucket: PUBLIC, original: 'works/illustration/ga.jpg', variants: [{ id: 'ga_v1', path: 'works/illustration/ga_v1.jpg' }] });
    const repo = new SupabaseWorkRepository(f.sb);
    // _reversePublish：逆向 unpublish_asset 失败 → public 对象必须保留
    f.failRpc['unpublish_asset'] = true;
    const one = { assetId: 'ga', parentType: 'work', parentId: 'wG', publicOriginalPath: 'works/illustration/ga.jpg', publicVariantPaths: [{ variant_id: 'ga_v1', path: 'works/illustration/ga_v1.jpg' }] };
    const r = await repo._reversePublish(one);
    ok(r.ok === false, 'G8: _reversePublish 在逆向 RPC 失败时返回 ok:false');
    ok(f.store.media_assets.find((a) => a.id === 'ga').bucket === PUBLIC, 'G8: DB canonical 仍 public（未被误切）');
    ok(!!f.storage[PUBLIC].files['works/illustration/ga.jpg'], 'G8: public Storage 对象未被删除（DB 仍引用）');
    ok(!f.storage[PRIVATE].files['staging/works/illustration/ga.jpg'], 'G8: 仅清理了本次 orphan staging 副本');

    // _rollbackPreparedAsset：逆向 prepare_asset_private 失败 → public 对象保留
    const f2 = makeFake();
    seedWork(f2, { id: 'wG2', type: 'illustration', isPublic: true, coverAssetId: 'gb' });
    seedAsset(f2, { id: 'gb', bucket: PUBLIC, original: 'works/illustration/gb.jpg', variants: [{ id: 'gb_v1', path: 'works/illustration/gb_v1.jpg' }] });
    const repo2 = new SupabaseWorkRepository(f2.sb);
    f2.failRpc['prepare_asset_private'] = true;
    const one2 = { assetId: 'gb', parentType: 'work', parentId: 'wG2', publicOriginalPath: 'works/illustration/gb.jpg', publicVariantPaths: [{ variant_id: 'gb_v1', path: 'works/illustration/gb_v1.jpg' }] };
    const r2 = await repo2._rollbackPreparedAsset(one2);
    ok(r2.ok === false, 'G8: _rollbackPreparedAsset 在逆向 RPC 失败时返回 ok:false（不假装成功）');
    ok(f2.store.media_assets.find((a) => a.id === 'gb').bucket === PUBLIC, 'G8: 回滚失败时 public 资产保留（不删 DB 仍引用对象）');
    ok(!!f2.storage[PUBLIC].files['works/illustration/gb.jpg'], 'G8: public Storage 对象未被删除');
  }

  // —— G9：publishWork 最终 readiness 验证（缺存储对象 → 阻塞 is_public=true）——
  {
    const f = makeFake();
    seedWork(f, { id: 'wH', type: 'illustration', isPublic: false, coverAssetId: 'ha' });
    seedAsset(f, { id: 'ha', bucket: PRIVATE, original: 'drafts/ha.jpg', variants: [{ id: 'ha_v1', path: 'drafts/ha_v1.jpg' }] });
    const repo = new SupabaseWorkRepository(f.sb);
    await repo.publishWork('wH');
    ok(f.store.works.find((w) => w.id === 'wH').is_public === true, 'G9: 正常 publishWork → is_public=true（readiness 通过）');
    const rd = await repo._verifyWorkPublicReadiness('wH');
    ok(rd.ok === true, 'G9: _verifyWorkPublicReadiness 正常返回 ok:true');

    // 缺存储对象的 readiness 检测
    const f2 = makeFake();
    seedWork(f2, { id: 'wH2', type: 'illustration', isPublic: true, coverAssetId: 'hb' });
    seedAsset(f2, { id: 'hb', bucket: PUBLIC, original: 'works/illustration/hb.jpg', variants: [{ id: 'hb_v1', path: 'works/illustration/hb_v1.jpg' }] });
    // 故意删除 variant 的 public Storage 对象 → _objectExists 应失败
    delete f2.storage[PUBLIC].files['works/illustration/hb_v1.jpg'];
    const repo2 = new SupabaseWorkRepository(f2.sb);
    const rd2 = await repo2._verifyWorkPublicReadiness('wH2');
    ok(rd2.ok === false && /对象不存在/.test(rd2.error), 'G9: variant public 存储对象缺失 → readiness 返回 ok:false（阻止 is_public 误置）');
  }

  // —— G10：unpublishWork 混合 bucket 检测（original private 但 variant 仍 public）——
  {
    const f = makeFake();
    seedWork(f, { id: 'wI', type: 'illustration', isPublic: true, coverAssetId: 'ia' });
    seedAsset(f, { id: 'ia', bucket: PRIVATE, original: 'staging/works/illustration/ia.jpg', variants: [{ id: 'ia_v1', path: 'works/illustration/ia_v1.jpg' }] });
    f.store.media_variants.find((v) => v.id === 'ia_v1').bucket = PUBLIC; // 制造混合残留：original private 但 variant 仍 public
    const repo = new SupabaseWorkRepository(f.sb);
    const mix = await repo._verifyWorkNoMixedBucket('wI');
    ok(mix.ok === false && /混合残留/.test(mix.error), 'G10: original private 但 variant 仍 public → 混合残留检测 ok:false');

    const f2 = makeFake();
    seedWork(f2, { id: 'wI2', type: 'illustration', isPublic: true, coverAssetId: 'ib' });
    seedAsset(f2, { id: 'ib', bucket: PRIVATE, original: 'staging/works/illustration/ib.jpg', variants: [{ id: 'ib_v1', path: 'staging/works/illustration/ib_v1.jpg' }] });
    const repo2 = new SupabaseWorkRepository(f2.sb);
    const mix2 = await repo2._verifyWorkNoMixedBucket('wI2');
    ok(mix2.ok === true, 'G10: 全部 private → 混合检测 ok:true');
  }

  // —— G11：删除公开漫画最后 1 页被拒绝（中文错误）——
  {
    const f = makeFake();
    seedWork(f, { id: 'wJ', type: 'comic', isPublic: true, coverAssetId: 'jc' });
    seedAsset(f, { id: 'jc', bucket: PUBLIC, original: 'works/comic/jc.jpg' });
    f.store.comic_pages.push({ id: 'cpJ', work_id: 'wJ', media_asset_id: 'jc', page_number: 1, sort_order: 1 });
    const repo = new SupabaseWorkRepository(f.sb);
    let threw = false, msg = '';
    try { await repo.removeComicPage('wJ', 'cpJ'); } catch (e) { threw = true; msg = e.message; }
    ok(threw && /公开漫画至少需要保留1页/.test(msg), 'G11: 删除公开漫画最后 1 页被拒绝（中文错误）');
    ok(f.store.comic_pages.filter((r) => r.work_id === 'wJ').length === 1, 'G11: 最后一页未被删除');
  }

  // —— G12：草稿漫画最后 1 页可删（允许删成 0 页）——
  {
    const f = makeFake();
    seedWork(f, { id: 'wK', type: 'comic', isPublic: false, coverAssetId: 'kc' });
    seedAsset(f, { id: 'kc', bucket: PRIVATE, original: 'staging/works/comic/kc.jpg' });
    f.store.comic_pages.push({ id: 'cpK', work_id: 'wK', media_asset_id: 'kc', page_number: 1, sort_order: 1 });
    const repo = new SupabaseWorkRepository(f.sb);
    let threw = false;
    try { await repo.removeComicPage('wK', 'cpK'); } catch (e) { threw = true; }
    ok(!threw, 'G12: 草稿漫画最后 1 页可删除（不抛错）');
    ok(f.store.comic_pages.filter((r) => r.work_id === 'wK').length === 0, 'G12: 草稿漫画可删成 0 页');
  }

  // —— G13：并发 append 顺序唯一稳定（repo 走 append_ RPC，无 JS max+1 insert）——
  {
    const f = makeFake();
    seedWork(f, { id: 'wL', type: 'illustration', isPublic: true, coverAssetId: 'lc' });
    seedAsset(f, { id: 'lc', bucket: PUBLIC, original: 'works/illustration/lc.jpg' });
    const repo = new SupabaseWorkRepository(f.sb);
    await repo.addWorkImage('wL', { name: 'i1.jpg', size: 100, type: 'image/jpeg' });
    await repo.addWorkImage('wL', { name: 'i2.jpg', size: 100, type: 'image/jpeg' });
    const imgs = f.store.work_images.filter((r) => r.work_id === 'wL').sort((a, b) => a.sort_order - b.sort_order);
    ok(imgs.length === 2 && imgs[0].sort_order === 1 && imgs[1].sort_order === 2, 'G13: 两次追加 sort_order = 1, 2（唯一稳定）');
    ok(imgs[0].id !== imgs[1].id, 'G13: 两次追加 id 唯一');
    ok(f.ops.some((o) => o.type === 'rpc' && o.name === 'append_work_image'), 'G13: 追加走 append_work_image RPC');
    ok(!f.ops.some((o) => o.type === 'table' && o.op === 'insert' && o.table === 'work_images'), 'G13: 无 JS 端 work_images insert（杜绝并发相同 max+1）');
  }

  // —— G14：work images F5 顺序稳定（相同 sort_order 以 id 兜底）——
  {
    const f = makeFake();
    seedWork(f, { id: 'wM', type: 'illustration', isPublic: true, coverAssetId: 'mc' });
    seedAsset(f, { id: 'mc', bucket: PUBLIC, original: 'works/illustration/mc.jpg' });
    seedAsset(f, { id: 'ma', bucket: PUBLIC, original: 'works/illustration/ma.jpg' });
    seedAsset(f, { id: 'mb', bucket: PUBLIC, original: 'works/illustration/mb.jpg' });
    // 两张图相同 sort_order，靠 id 兜底排序
    f.store.work_images.push({ id: 'wiAA', work_id: 'wM', media_asset_id: 'ma', sort_order: 1, alt_text: null });
    f.store.work_images.push({ id: 'wiBB', work_id: 'wM', media_asset_id: 'mb', sort_order: 1, alt_text: null });
    const repo = new SupabaseWorkRepository(f.sb);
    const w1 = await repo.getById('wM');
    const w2 = await repo.getById('wM');
    const ids1 = (w1.imagesMeta || []).map((m) => m.id);
    const ids2 = (w2.imagesMeta || []).map((m) => m.id);
    ok(JSON.stringify(ids1) === JSON.stringify(ids2), 'G14: work images 连续两次 hydrate 顺序一致（F5 稳定）');
    ok(ids1.join(',') === 'wiAA,wiBB', 'G14: 相同 sort_order 以 id 字典序兜底（wiAA < wiBB）');
  }

  // —— G15：comic pages F5 顺序稳定 ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wN', type: 'comic', isPublic: true, coverAssetId: 'nc' });
    seedAsset(f, { id: 'nc', bucket: PUBLIC, original: 'works/comic/nc.jpg' });
    seedAsset(f, { id: 'na', bucket: PUBLIC, original: 'works/comic/na.jpg' });
    seedAsset(f, { id: 'nb', bucket: PUBLIC, original: 'works/comic/nb.jpg' });
    f.store.comic_pages.push({ id: 'cpAA', work_id: 'wN', media_asset_id: 'na', page_number: 1, sort_order: 1 });
    f.store.comic_pages.push({ id: 'cpBB', work_id: 'wN', media_asset_id: 'nb', page_number: 1, sort_order: 1 });
    const repo = new SupabaseWorkRepository(f.sb);
    const w1 = await repo.getById('wN');
    const w2 = await repo.getById('wN');
    const ids1 = (w1.pages || []).map((p) => p.id);
    const ids2 = (w2.pages || []).map((p) => p.id);
    ok(JSON.stringify(ids1) === JSON.stringify(ids2), 'G15: comic pages 连续两次 hydrate 顺序一致（F5 稳定）');
    ok(ids1.join(',') === 'cpAA,cpBB', 'G15: 相同 sort_order 以 id 字典序兜底（cpAA < cpBB）');
  }

  // —— G16：所有 RPC error 保留 code/message/details/hint ——
  {
    // (a) _publishOneAsset 遇到 publish_asset 带全字段 error → 抛出 message 含全部字段
    const f = makeFake();
    seedWork(f, { id: 'wO', type: 'illustration', isPublic: false, coverAssetId: 'oa' });
    seedAsset(f, { id: 'oa', bucket: PRIVATE, original: 'drafts/oa.jpg' });
    const origRpc = f.sb.rpc;
    f.sb.rpc = (name, params) => {
      if (name === 'publish_asset') return Promise.resolve({ data: null, error: { message: 'boom-publish', code: 'PGRST_001', details: 'det-publish', hint: 'hint-publish' } });
      return origRpc(name, params);
    };
    const repo = new SupabaseWorkRepository(f.sb);
    let msg = '';
    try { await repo._publishOneAsset('oa', 'work', 'wO'); } catch (e) { msg = e.message; }
    ok(/boom-publish/.test(msg) && /PGRST_001/.test(msg) && /det-publish/.test(msg) && /hint-publish/.test(msg), 'G16(a): publish_asset error 保留 code/message/details/hint');

    // (b) removeWorkImage 遇到 rpc error 全字段 → _rpcFail 保留全部
    const f2 = makeFake();
    seedWork(f2, { id: 'wO2', type: 'illustration', isPublic: false, coverAssetId: 'ob' });
    seedAsset(f2, { id: 'ob', bucket: PUBLIC, original: 'works/illustration/ob.jpg' });
    f2.store.work_images.push({ id: 'wiO2', work_id: 'wO2', media_asset_id: 'obx', sort_order: 1, alt_text: null });
    const origRpc2 = f2.sb.rpc;
    f2.sb.rpc = (name, params) => {
      if (name === 'remove_work_image_and_reorder') return Promise.resolve({ data: null, error: { message: 'boom-rm', code: 'PGRST_002', details: 'det-rm', hint: 'hint-rm' } });
      return origRpc2(name, params);
    };
    const repo2 = new SupabaseWorkRepository(f2.sb);
    let msg2 = '';
    try { await repo2.removeWorkImage('wO2', 'wiO2'); } catch (e) { msg2 = e.message; }
    ok(/boom-rm/.test(msg2) && /PGRST_002/.test(msg2) && /det-rm/.test(msg2) && /hint-rm/.test(msg2), 'G16(b): removeWorkImage rpc error 保留 code/message/details/hint');
  }

  console.log(log.join('\n'));
  console.log(`\nFINAL16 code gate: pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('TEST CRASHED:', e); process.exit(2); });
