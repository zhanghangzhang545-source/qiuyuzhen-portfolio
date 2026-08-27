// ============================================================
// FINAL15 自动代码 Gate —— 针对 P0-A..P0-J 共 12 项的失败注入测试
// 使用注入式 fake Supabase 客户端（无真活库凭据），覆盖：
//   1. _hydrateWorks work_images select 含 id
//   2. imagesMeta.id 非空且唯一
//   3. removeWorkImage 不存在残缺 upsert（改用原子 RPC）
//   4. removeComicPage 不存在残缺 upsert（改用原子 RPC）
//   5. reorderComicPages upsert 保留 media_asset_id
//   6. publish 实际 copy original + 全部 variants
//   7. unpublish 实际 copy original + 全部 variants
//   8. publish compensation 恢复 DB canonical
//   9. unpublish compensation 恢复 DB canonical
//  10. autoPublish 失败恢复父 FK/link（A B C 不变）
//  11. 公开作品修改不存在 public→private FK 暴露窗口（link 在 publish 之后）
//  12. _parentIsPublic error 不静默（抛错而非返回 false）
// ============================================================
import { SupabaseWorkRepository } from '../src/data/repository.supabase.js';

const PRIVATE = 'portfolio-private';
const PUBLIC = 'portfolio-public';

let pass = 0, fail = 0;
const log = [];
function ok(cond, msg) { if (cond) { pass++; log.push(`  PASS ${msg}`); } else { fail++; log.push(`  FAIL ${msg}`); } }

// —— fake 存储 / 表引擎 ——
function makeFake() {
  const store = {
    works: [], work_images: [], comic_pages: [], certificates: [],
    media_assets: [], media_variants: [], profile: [],
  };
  const storage = {
    [PRIVATE]: { files: {} },
    [PUBLIC]: { files: {} },
  };
  const ops = [];           // 有序操作日志（rpc / table / storage）
  const failRpc = {};       // { publish_asset: true } 注入 RPC 失败
  let injectIsPublicError = false;
  let injectWorkImagesUpdateError = false;

  function rec(o) { ops.push(o); }

  function matchRows(table, filters) {
    return store[table].filter((r) => filters.every(([op, col, val]) => {
      if (op === 'eq') return r[col] === val;
      if (op === 'in') return Array.isArray(val) && val.includes(r[col]);
      return true;
    }));
  }

  function project(rows, cols) {
    if (!cols || cols === '*') return rows;
    const colsArr = cols.split(',').map((c) => c.trim().split(' ')[0]);
    return rows.map((r) => { const o = {}; for (const c of colsArr) o[c] = r[c]; return o; });
  }

  function builder(table) {
    const b = {
      _op: null, _cols: null, _row: null, _rows: null, _filters: [], _single: false, _order: null, _limit: null,
      select(cols) { this._op = 'select'; this._cols = cols; return this; },
      insert(row) { this._op = 'insert'; this._rows = Array.isArray(row) ? row : [row]; return this; },
      update(row) { this._op = 'update'; this._row = row; return this; },
      delete() { this._op = 'delete'; return this; },
      upsert(rows) { this._op = 'upsert'; this._rows = Array.isArray(rows) ? rows : [rows]; return this; },
      eq(col, val) { this._filters.push(['eq', col, val]); return this; },
      in(col, arr) { this._filters.push(['in', col, arr]); return this; },
      order(col, opts) { this._order = [col, opts && opts.ascending === false ? 'desc' : 'asc']; return this; },
      limit(n) { this._limit = n; return this; },
      maybeSingle() { this._single = true; return this; },
      async then(resolve, reject) {
        try {
          let result;
          if (this._op === 'select') {
            let rows = matchRows(table, this._filters);
            if (this._order) rows = rows.slice().sort((a, b) => this._order[1] === 'asc' ? (a[this._order[0]] - b[this._order[0]]) : (b[this._order[0]] - a[this._order[0]]));
            if (this._limit) rows = rows.slice(0, this._limit);
            const data = this._single ? (rows[0] ? project([rows[0]], this._cols)[0] : null) : project(rows, this._cols);
            result = { data, error: null };
          } else if (this._op === 'insert') {
            for (const r of this._rows) store[table].push(r);
            const data = this._single && this._cols === '*' ? this._rows[0] : (this._rows.length === 1 ? this._rows[0] : this._rows);
            result = { data, error: null };
          } else if (this._op === 'update') {
            const rows = matchRows(table, this._filters);
            for (const r of rows) Object.assign(r, this._row);
            result = { data: this._single ? (rows[0] || null) : {}, error: null };
          } else if (this._op === 'upsert') {
            for (const r of this._rows) {
              const i = store[table].findIndex((x) => x.id === r.id);
              if (i >= 0) Object.assign(store[table][i], r); else store[table].push(r);
            }
            result = { data: {}, error: null };
          } else if (this._op === 'delete') {
            const before = store[table].length;
            store[table] = store[table].filter((r) => !this._filters.every(([op, col, val]) => op === 'eq' ? r[col] === val : true));
            result = { data: null, error: null, __deleted: before - store[table].length };
          } else {
            result = { data: null, error: null };
          }
          rec({ type: 'table', op: this._op, table, cols: this._cols, row: this._row, rows: this._rows, filters: this._filters });
          resolve(result);
        } catch (e) { reject(e); }
      },
    };
    return b;
  }

  const storageApi = (bucket) => ({
    upload(path, file, opts) {
      storage[bucket].files[path] = { file, opts };
      rec({ type: 'storage', op: 'upload', bucket, path });
      return Promise.resolve({ data: { path }, error: null });
    },
    download(path) {
      const f = storage[bucket].files[path];
      if (!f) return Promise.resolve({ data: null, error: { message: `not found ${path}` } });
      rec({ type: 'storage', op: 'download', bucket, path });
      return Promise.resolve({ data: f.file, error: null });
    },
    remove(paths) {
      for (const p of paths) delete storage[bucket].files[p];
      rec({ type: 'storage', op: 'remove', bucket, paths });
      return Promise.resolve({ data: {}, error: null });
    },
    list(dir) {
      const names = Object.keys(storage[bucket].files)
        .filter((p) => !dir || p.startsWith(dir))
        .map((p) => ({ name: p.slice(dir ? dir.length : 0).replace(/^\//, '') }));
      rec({ type: 'storage', op: 'list', bucket, dir });
      return Promise.resolve({ data: names, error: null });
    },
    createSignedUrl(path, exp) { rec({ type: 'storage', op: 'signed', bucket, path }); return Promise.resolve({ data: { signedUrl: `signed://${bucket}/${path}` }, error: null }); },
    getPublicUrl(path) { return { data: { publicUrl: `https://pub/${bucket}/${path}` }, error: null }; },
  });

  // RPC 处理器（模拟线上真实行为：publish_asset 翻转 bucket + works.is_public）
  function allWorkAssetsPublic(workId) {
    const w = store.works.find((x) => x.id === workId);
    if (!w) return false;
    const ids = new Set();
    if (w.cover_asset_id) ids.add(w.cover_asset_id);
    store.work_images.filter((r) => r.work_id === workId).forEach((r) => ids.add(r.media_asset_id));
    store.comic_pages.filter((r) => r.work_id === workId).forEach((r) => ids.add(r.media_asset_id));
    for (const id of ids) {
      const a = store.media_assets.find((x) => x.id === id);
      if (!a || a.bucket !== PUBLIC) return false;
      const vs = store.media_variants.filter((v) => v.asset_id === id);
      if (vs.some((v) => v.bucket !== PUBLIC)) return false;
    }
    return true;
  }

  function rpc(name, params) {
    rec({ type: 'rpc', name, params });
    if (failRpc[name]) return Promise.resolve({ data: null, error: { message: `${name} injected failure`, code: 'XX' } });
    if (name === 'is_admin') return Promise.resolve({ data: true, error: null });
    if (name === 'publish_asset') {
      const a = store.media_assets.find((x) => x.id === params.p_asset_id);
      if (!a) return Promise.resolve({ data: { ok: false, error: 'asset not found' }, error: null });
      a.bucket = PUBLIC; a.original_path = params.p_public_original_path;
      for (const v of (params.p_variant_paths || [])) {
        const mv = store.media_variants.find((x) => x.id === v.variant_id);
        if (mv) { mv.bucket = PUBLIC; mv.variant_path = v.path; }
      }
      if (params.p_parent_type === 'work') {
        const w = store.works.find((x) => x.id === params.p_parent_id);
        if (w) w.is_public = allWorkAssetsPublic(params.p_parent_id);
        return Promise.resolve({ data: { ok: true, bucket: PUBLIC }, error: null });
      }
      return Promise.resolve({ data: { ok: true, bucket: PUBLIC }, error: null });
    }
    if (name === 'unpublish_asset') {
      const a = store.media_assets.find((x) => x.id === params.p_asset_id);
      if (!a) return Promise.resolve({ data: { ok: false, error: 'asset not found' }, error: null });
      a.bucket = PRIVATE; a.original_path = params.p_private_original_path;
      for (const v of (params.p_variant_paths || [])) {
        const mv = store.media_variants.find((x) => x.id === v.variant_id);
        if (mv) { mv.bucket = PRIVATE; mv.variant_path = v.path; }
      }
      if (params.p_parent_type === 'work') {
        const w = store.works.find((x) => x.id === params.p_parent_id);
        if (w) w.is_public = false;
        return Promise.resolve({ data: { ok: true, bucket: PRIVATE }, error: null });
      }
      return Promise.resolve({ data: { ok: true, bucket: PRIVATE }, error: null });
    }
    if (name === 'remove_work_image_and_reorder') {
      const img = store.work_images.find((r) => r.id === params.p_image_id && r.work_id === params.p_work_id);
      if (!img) return Promise.resolve({ data: { ok: false, error: 'not found' }, error: null });
      store.work_images = store.work_images.filter((r) => r.id !== params.p_image_id);
      const rest = store.work_images.filter((r) => r.work_id === params.p_work_id).sort((a, b) => a.sort_order - b.sort_order);
      rest.forEach((r, i) => { r.sort_order = i + 1; });
      return Promise.resolve({ data: { ok: true, removed_image_id: params.p_image_id }, error: null });
    }
    if (name === 'remove_comic_page_and_reorder') {
      const pg = store.comic_pages.find((r) => r.id === params.p_page_id && r.work_id === params.p_work_id);
      if (!pg) return Promise.resolve({ data: { ok: false, error: 'not found' }, error: null });
      store.comic_pages = store.comic_pages.filter((r) => r.id !== params.p_page_id);
      const rest = store.comic_pages.filter((r) => r.work_id === params.p_work_id).sort((a, b) => a.sort_order - b.sort_order);
      rest.forEach((r, i) => { r.sort_order = i + 1; });
      return Promise.resolve({ data: { ok: true, removed_page_id: params.p_page_id }, error: null });
    }
    return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
  }

  // works.is_public 查询错误注入
  const origFrom = (table) => {
    const b = builder(table);
    const origSelect = b.select.bind(b);
    b.select = (cols) => {
      if (injectIsPublicError && table === 'works' && /is_public/.test(cols)) {
        // 直接让 then 返回 error
        b._op = 'select'; b._cols = cols; b._single = true;
        const origThen = b.then.bind(b);
        b.then = (resolve) => { rec({ type: 'table', op: 'select', table, cols }); resolve({ data: null, error: { message: 'injected is_public read error' } }); };
        return b;
      }
      return origSelect(cols);
    };
    return b;
  };

  const sb = {
    from: (t) => origFrom(t),
    storage: { from: (b) => storageApi(b) },
    rpc,
  };
  // 注入 work_images.update 失败（gate 10）
  const realFrom = sb.from;
  sb.from = (t) => {
    const b = realFrom(t);
    const origUpdate = b.update.bind(b);
    b.update = (row) => {
      if (injectWorkImagesUpdateError && t === 'work_images' && 'media_asset_id' in row) {
        const b2 = builder(t);
        b2._op = 'update'; b2._row = row; b2._filters = b._filters;
        const origThen = b2.then.bind(b2);
        b2.then = (resolve) => { rec({ type: 'table', op: 'update', table: t, row }); resolve({ data: null, error: { message: 'injected work_images update failure' } }); };
        return b2;
      }
      return origUpdate(row);
    };
    return b;
  };

  return { sb, store, storage, ops, failRpc, setInjectIsPublicError: (v) => { injectIsPublicError = v; }, setInjectWorkImagesUpdateError: (v) => { injectWorkImagesUpdateError = v; } };
}

// seed helpers
function seedWork(f, { id, type, isPublic, coverAssetId }) {
  f.store.works.push({ id, type, title: id, is_public: isPublic, cover_asset_id: coverAssetId, sort_order: 1, home_featured: false, home_featured_order: 0, works_pick: false, works_pick_order: 0, display_size: 'standard', work_nature: null, tags: [], stage: '', year: null, intro: '' });
}
function seedAsset(f, { id, bucket, original, variants }) {
  f.store.media_assets.push({ id, bucket, original_path: original, original_width: 100, original_height: 100, format: 'jpeg' });
  (variants || []).forEach((v) => f.store.media_variants.push({ id: v.id, asset_id: id, bucket, variant_path: v.path, width: v.width || 100, height: v.height || 100 }));
  // 在 private/public 存储里放一个占位文件，保证 _copyStorageObject 能 download 成功
  f.storage[bucket].files[original] = { file: { name: original, size: 10, type: 'image/jpeg' } };
  (variants || []).forEach((v) => { f.storage[bucket].files[v.path] = { file: { name: v.path, size: 10, type: 'image/jpeg' } }; });
}

async function main() {
  // —— Gate 1 & 2：_hydrateWorks select 含 id，imagesMeta.id 非空且唯一 ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wA', type: 'illustration', isPublic: true, coverAssetId: 'ca' });
    seedAsset(f, { id: 'ca', bucket: PUBLIC, original: 'works/illustration/ca.jpg', variants: [{ id: 'cv1', path: 'works/illustration/ca_v1.jpg' }] });
    f.store.work_images.push({ id: 'wiX', work_id: 'wA', media_asset_id: 'ia', sort_order: 1, alt_text: null });
    seedAsset(f, { id: 'ia', bucket: PUBLIC, original: 'works/illustration/ia.jpg' });
    const repo = new SupabaseWorkRepository(f.sb);
    const w = await repo.getById('wA');
    const selectHasId = f.ops.some((o) => o.type === 'table' && o.op === 'select' && o.table === 'work_images' && o.cols && o.cols.includes('id'));
    ok(selectHasId, 'Gate1: _hydrateWorks work_images select 含 id');
    const ids = (w.imagesMeta || []).map((m) => m.id);
    ok(ids.length > 0 && ids.every((i) => i && typeof i === 'string' && i.length > 0), 'Gate2: imagesMeta.id 全部非空');
    ok(new Set(ids).size === ids.length, 'Gate2: imagesMeta.id 唯一');
  }

  // —— Gate 3：removeWorkImage 改用原子 RPC，不存在 delete→select→upsert 残缺 upsert ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wB', type: 'illustration', isPublic: false, coverAssetId: 'cb' });
    f.store.work_images.push({ id: 'wi1', work_id: 'wB', media_asset_id: 'a1', sort_order: 1, alt_text: null });
    f.store.work_images.push({ id: 'wi2', work_id: 'wB', media_asset_id: 'a2', sort_order: 2, alt_text: null });
    const repo = new SupabaseWorkRepository(f.sb);
    await repo.removeWorkImage('wB', 'wi1');
    const calledRpc = f.ops.some((o) => o.type === 'rpc' && o.name === 'remove_work_image_and_reorder' && o.params.p_image_id === 'wi1' && o.params.p_work_id === 'wB');
    ok(calledRpc, 'Gate3: removeWorkImage 调用原子 RPC remove_work_image_and_reorder');
    const wiUpsert = f.ops.some((o) => o.type === 'table' && o.op === 'upsert' && o.table === 'work_images');
    ok(!wiUpsert, 'Gate3: removeWorkImage 不再做残缺 upsert（无 work_images upsert）');
    const remaining = f.store.work_images.filter((r) => r.work_id === 'wB').sort((a, b) => a.sort_order - b.sort_order);
    ok(remaining.length === 1 && remaining[0].id === 'wi2' && remaining[0].sort_order === 1, 'Gate3: 删除后剩余图连续重排（A B → B）');
  }

  // —— Gate 4：removeComicPage 改用原子 RPC，不存在残缺 upsert ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wC', type: 'comic', isPublic: false, coverAssetId: 'cc' });
    f.store.comic_pages.push({ id: 'cp1', work_id: 'wC', media_asset_id: 'a1', page_number: 1, sort_order: 1 });
    f.store.comic_pages.push({ id: 'cp2', work_id: 'wC', media_asset_id: 'a2', page_number: 2, sort_order: 2 });
    f.store.comic_pages.push({ id: 'cp3', work_id: 'wC', media_asset_id: 'a3', page_number: 3, sort_order: 3 });
    const repo = new SupabaseWorkRepository(f.sb);
    await repo.removeComicPage('wC', 'cp2');
    const calledRpc = f.ops.some((o) => o.type === 'rpc' && o.name === 'remove_comic_page_and_reorder' && o.params.p_page_id === 'cp2');
    ok(calledRpc, 'Gate4: removeComicPage 调用原子 RPC remove_comic_page_and_reorder');
    const cpUpsert = f.ops.some((o) => o.type === 'table' && o.op === 'upsert' && o.table === 'comic_pages');
    ok(!cpUpsert, 'Gate4: removeComicPage 不再做残缺 upsert');
    const rest = f.store.comic_pages.filter((r) => r.work_id === 'wC').sort((a, b) => a.sort_order - b.sort_order);
    ok(rest.map((r) => r.id).join(',') === 'cp1,cp3' && rest.every((r, i) => r.sort_order === i + 1) && rest.every((r) => r.page_number !== 2), 'Gate4: A B C D E 删 C → A B D E（page_number 不变、无错位）');
  }

  // —— Gate 5：reorderComicPages upsert 保留 media_asset_id ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wD', type: 'comic', isPublic: false, coverAssetId: 'cd' });
    f.store.comic_pages.push({ id: 'cp1', work_id: 'wD', media_asset_id: 'm1', page_number: 1, sort_order: 1 });
    f.store.comic_pages.push({ id: 'cp2', work_id: 'wD', media_asset_id: 'm2', page_number: 2, sort_order: 2 });
    f.store.comic_pages.push({ id: 'cp3', work_id: 'wD', media_asset_id: 'm3', page_number: 3, sort_order: 3 });
    const repo = new SupabaseWorkRepository(f.sb);
    await repo.reorderComicPages('wD', ['cp3', 'cp1', 'cp2']);
    const upOp = f.ops.find((o) => o.type === 'table' && o.op === 'upsert' && o.table === 'comic_pages');
    const rows = upOp ? upOp.rows : [];
    ok(rows.length === 3 && rows.every((r) => r.media_asset_id), 'Gate5: reorderComicPages upsert 每行保留 media_asset_id（无残缺行）');
    ok(rows.every((r) => r.page_number) && rows.find((r) => r.id === 'cp3').page_number === 3, 'Gate5: reorderComicPages 保留 page_number 原值');
  }

  // —— Gate 6：publish 实际 copy original + 全部 variants ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wE', type: 'illustration', isPublic: false, coverAssetId: 'ea' });
    seedAsset(f, { id: 'ea', bucket: PRIVATE, original: 'drafts/ea.jpg', variants: [{ id: 'ev1', path: 'drafts/ea_v1.jpg' }, { id: 'ev2', path: 'drafts/ea_v2.jpg' }] });
    const repo = new SupabaseWorkRepository(f.sb);
    await repo.publishWork('wE');
    const pubRpc = f.ops.find((o) => o.type === 'rpc' && o.name === 'publish_asset');
    const variantPaths = pubRpc ? pubRpc.params.p_variant_paths : [];
    ok(variantPaths.length === 2, 'Gate6: publish_asset 收到 2 个 variant path（真实搬运全部 variants）');
    ok(!!f.storage[PUBLIC].files['works/illustration/ea.jpg'], 'Gate6: publish 拷贝 original 到 public bucket');
    ok(!!f.storage[PUBLIC].files['works/illustration/ea_v1.jpg'] && !!f.storage[PUBLIC].files['works/illustration/ea_v2.jpg'], 'Gate6: publish 拷贝全部 variant 到 public bucket');
    ok(f.store.works.find((w) => w.id === 'wE').is_public === true, 'Gate6: publish 后 works.is_public=true');
  }

  // —— Gate 7：unpublish 实际 copy original + 全部 variants ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wF', type: 'illustration', isPublic: true, coverAssetId: 'fa' });
    seedAsset(f, { id: 'fa', bucket: PUBLIC, original: 'works/illustration/fa.jpg', variants: [{ id: 'fv1', path: 'works/illustration/fa_v1.jpg' }] });
    const repo = new SupabaseWorkRepository(f.sb);
    await repo.unpublishWork('wF');
    const unRpc = f.ops.find((o) => o.type === 'rpc' && o.name === 'unpublish_asset');
    ok(unRpc && unRpc.params.p_variant_paths.length === 1, 'Gate7: unpublish_asset 收到 1 个 variant path');
    ok(!!f.storage[PRIVATE].files['staging/works/illustration/fa.jpg'], 'Gate7: unpublish 拷贝 original 到 staging private');
    ok(!!f.storage[PRIVATE].files['staging/works/illustration/fa_v1.jpg'], 'Gate7: unpublish 拷贝 variant 到 staging private');
    ok(f.store.works.find((w) => w.id === 'wF').is_public === false, 'Gate7: unpublish 后 works.is_public=false');
  }

  // —— Gate 8：publish compensation 恢复 DB canonical ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wG', type: 'illustration', isPublic: false, coverAssetId: 'ga' });
    seedAsset(f, { id: 'ga', bucket: PRIVATE, original: 'drafts/ga.jpg', variants: [{ id: 'gv1', path: 'drafts/ga_v1.jpg' }] });
    seedAsset(f, { id: 'gb', bucket: PRIVATE, original: 'drafts/gb.jpg', variants: [{ id: 'gv2', path: 'drafts/gb_v1.jpg' }] });
    f.store.work_images.push({ id: 'wgi', work_id: 'wG', media_asset_id: 'gb', sort_order: 1, alt_text: null });
    f.failRpc['publish_asset'] = true; // 第 2 个资产 RPC 失败（failRpc 对所有都生效，但 asset1 先成功后 asset2 失败）
    // 为了让 asset1 成功、asset2 失败，用更精细注入：仅对 gb 失败
    f.failRpc['publish_asset'] = false;
    const origRpc = f.sb.rpc;
    f.sb.rpc = (name, params) => { if (name === 'publish_asset' && params.p_asset_id === 'gb') return Promise.resolve({ data: null, error: { message: 'injected asset2 publish failure', code: 'XX' } }); return origRpc(name, params); };
    const repo = new SupabaseWorkRepository(f.sb);
    let threw = false;
    try { await repo.publishWork('wG'); } catch (e) { threw = true; }
    ok(threw, 'Gate8: publishWork 在资产2失败时抛错');
    const ga = f.store.media_assets.find((a) => a.id === 'ga');
    ok(ga.bucket === PRIVATE, 'Gate8: 补偿后 asset1(ga) bucket 恢复为 private（DB canonical 恢复）');
    ok(!f.storage[PUBLIC].files['works/illustration/ga.jpg'], 'Gate8: 补偿后 asset1 的 public Storage 已清理');
    ok(f.store.works.find((w) => w.id === 'wG').is_public === false, 'Gate8: 补偿后 works.is_public 恢复发布前状态(false)');
  }

  // —— Gate 9：unpublish compensation 恢复 DB canonical ——
  {
    const f = makeFake();
    seedWork(f, { id: 'wH', type: 'illustration', isPublic: true, coverAssetId: 'ha' });
    seedAsset(f, { id: 'ha', bucket: PUBLIC, original: 'works/illustration/ha.jpg', variants: [{ id: 'hv1', path: 'works/illustration/ha_v1.jpg' }] });
    seedAsset(f, { id: 'hb', bucket: PUBLIC, original: 'works/illustration/hb.jpg', variants: [{ id: 'hv2', path: 'works/illustration/hb_v1.jpg' }] });
    f.store.work_images.push({ id: 'whi', work_id: 'wH', media_asset_id: 'hb', sort_order: 1, alt_text: null });
    const origRpc = f.sb.rpc;
    f.sb.rpc = (name, params) => { if (name === 'unpublish_asset' && params.p_asset_id === 'hb') return Promise.resolve({ data: null, error: { message: 'injected asset2 unpublish failure', code: 'XX' } }); return origRpc(name, params); };
    const repo = new SupabaseWorkRepository(f.sb);
    let threw = false;
    try { await repo.unpublishWork('wH'); } catch (e) { threw = true; }
    ok(threw, 'Gate9: unpublishWork 在资产2失败时抛错');
    const ha = f.store.media_assets.find((a) => a.id === 'ha');
    ok(ha.bucket === PUBLIC, 'Gate9: 补偿后 asset1(ha) bucket 恢复为 public（DB canonical 恢复）');
    ok(f.store.works.find((w) => w.id === 'wH').is_public === true, 'Gate9: 补偿后 works.is_public 恢复发布前状态(true)');
  }

  // —— Gate 10：autoPublish 失败恢复父 FK（替换 B 失败仍是 A B C）——
  {
    const f = makeFake();
    seedWork(f, { id: 'wI', type: 'illustration', isPublic: true, coverAssetId: 'ia_c' });
    f.store.work_images.push({ id: 'wi_old', work_id: 'wI', media_asset_id: 'oldImg', sort_order: 1, alt_text: null });
    seedAsset(f, { id: 'oldImg', bucket: PUBLIC, original: 'works/illustration/oldImg.jpg' });
    f.setInjectWorkImagesUpdateError(true);
    const repo = new SupabaseWorkRepository(f.sb);
    let threw = false;
    try { await repo.replaceWorkImage('wi_old', { name: 'new.jpg', size: 100, type: 'image/jpeg' }); } catch (e) { threw = true; }
    ok(threw, 'Gate10: replaceWorkImage 在 linkFn 失败时抛错');
    const img = f.store.work_images.find((r) => r.id === 'wi_old');
    ok(img.media_asset_id === 'oldImg', 'Gate10: 替换失败后仍指向旧 asset（A B C 不变，非 broken）');
    ok(!f.store.media_assets.some((a) => a.id && a.id.startsWith('wI__work')), 'Gate10: 失败补偿清理了本次新资产（无孤儿 media_assets）');
  }

  // —— Gate 11：公开作品修改不存在 public→private FK 暴露窗口（link 在 publish 之后）——
  {
    const f = makeFake();
    seedWork(f, { id: 'wJ', type: 'illustration', isPublic: true, coverAssetId: 'ja_c' });
    f.store.work_images.push({ id: 'wi_j', work_id: 'wJ', media_asset_id: 'oldJ', sort_order: 1, alt_text: null });
    seedAsset(f, { id: 'oldJ', bucket: PUBLIC, original: 'works/illustration/oldJ.jpg' });
    const repo = new SupabaseWorkRepository(f.sb);
    await repo.replaceWorkImage('wi_j', { name: 'newJ.jpg', size: 100, type: 'image/jpeg' });
    // 找到 publish_asset RPC（新资产）与 work_images.update（切换 FK 到新资产）的索引
    const idxPublish = f.ops.findIndex((o) => o.type === 'rpc' && o.name === 'publish_asset');
    const idxLink = f.ops.findIndex((o) => o.type === 'table' && o.op === 'update' && o.table === 'work_images' && o.row && o.row.media_asset_id && o.row.media_asset_id !== 'oldJ');
    ok(idxPublish >= 0 && idxLink >= 0 && idxPublish < idxLink, 'Gate11: 公开作品编辑——先 publish 新资产，后切换父 FK（无 public→private 暴露窗口）');
    const finalImg = f.store.work_images.find((r) => r.id === 'wi_j');
    const finalAsset = f.store.media_assets.find((a) => a.id === finalImg.media_asset_id);
    ok(finalAsset && finalAsset.bucket === PUBLIC, 'Gate11: 切换后 FK 指向的资产已是 public（A 无断图）');
  }

  // —— Gate 12：_parentIsPublic error 不静默（抛错而非返回 false）——
  {
    const f = makeFake();
    f.setInjectIsPublicError(true);
    const repo = new SupabaseWorkRepository(f.sb);
    let threw = false, returnedFalse = false;
    try { const r = await repo._parentIsPublic('work', 'wX'); if (r === false) returnedFalse = true; } catch (e) { threw = true; }
    ok(threw && !returnedFalse, 'Gate12: _parentIsPublic 查询失败时抛错（不静默返回 false）');
  }

  console.log(log.join('\n'));
  console.log(`\nFINAL15 code gate: pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('TEST CRASHED:', e); process.exit(2); });
