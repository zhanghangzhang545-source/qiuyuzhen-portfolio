export const PRIVATE = 'portfolio-private';
export const PUBLIC = 'portfolio-public';

let pass = 0, fail = 0;
const log = [];
function ok(cond, msg) { if (cond) { pass++; log.push(`  PASS ${msg}`); } else { fail++; log.push(`  FAIL ${msg}`); } }

// —— fake 存储 / 表引擎（沿用 final15 的 builder，但硬化 rpc）——
export function makeFake() {
  const store = {
    works: [], work_images: [], comic_pages: [], certificates: [],
    media_assets: [], media_variants: [], profile: [],
  };
  const storage = { [PRIVATE]: { files: {} }, [PUBLIC]: { files: {} } };
  const ops = [];
  const failRpc = {};                 // { publish_asset: true } 等
  let injectIsPublicError = false;
  let injectWorkImagesUpdateError = false;
  let injectWorksUpdateError = false;

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
      _pendingMut: null, _pendingRows: null, _pendingRow: null, _pendingFilters: null,
      // 真实 Supabase 中 select() 仅改变返回投影，并不阻断前置 mutation（insert/update/delete/upsert）的执行。
      // 记录被 select 覆盖前的待执行 mutation，使 insert().select().maybeSingle() 等链能正确执行并回退。
      select(cols) {
        if (['insert', 'update', 'delete', 'upsert'].includes(this._op)) {
          this._pendingMut = this._op;
          this._pendingRows = this._rows;
          this._pendingRow = this._row;
          this._pendingFilters = this._filters;
        }
        this._op = 'select'; this._cols = cols; return this;
      },
      insert(row) { this._op = 'insert'; this._rows = Array.isArray(row) ? row : [row]; for (const r of this._rows) store[table].push(r); return this; },
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
          if (this._op === 'select' && this._pendingMut === 'insert') {
            const data = this._single ? (this._pendingRows.length ? project([this._pendingRows[0]], this._cols)[0] : null) : project(this._pendingRows, this._cols);
            result = { data, error: null };
            rec({ type: 'table', op: 'insert', table, cols: this._cols, rows: this._pendingRows, filters: this._filters });
            resolve(result); return;
          } else if (this._op === 'select' && this._pendingMut === 'update') {
            const rows = matchRows(table, this._pendingFilters);
            for (const r of rows) Object.assign(r, this._pendingRow);
            const data = this._single ? (rows[0] ? project([rows[0]], this._cols)[0] : null) : project(rows, this._cols);
            result = { data, error: null };
            rec({ type: 'table', op: 'update', table, cols: this._cols, row: this._pendingRow, filters: this._pendingFilters });
            resolve(result); return;
          } else if (this._op === 'select' && this._pendingMut === 'delete') {
            const before = store[table].length;
            store[table] = store[table].filter((r) => !this._pendingFilters.every(([op, col, val]) => op === 'eq' ? r[col] === val : true));
            result = { data: null, error: null, __deleted: before - store[table].length };
            rec({ type: 'table', op: 'delete', table, cols: this._cols, filters: this._pendingFilters });
            resolve(result); return;
          } else if (this._op === 'select' && this._pendingMut === 'upsert') {
            for (const r of this._pendingRows) {
              const i = store[table].findIndex((x) => x.id === r.id);
              if (i >= 0) Object.assign(store[table][i], r); else store[table].push(r);
            }
            const data = this._single ? (this._pendingRows.length ? project([this._pendingRows[0]], this._cols)[0] : null) : project(this._pendingRows, this._cols);
            result = { data, error: null };
            rec({ type: 'table', op: 'upsert', table, cols: this._cols, rows: this._pendingRows, filters: this._filters });
            resolve(result); return;
          } else if (this._op === 'select') {
            let rows = matchRows(table, this._filters);
            if (this._order) rows = rows.slice().sort((a, b) => this._order[1] === 'asc' ? (a[this._order[0]] - b[this._order[0]]) : (b[this._order[0]] - a[this._order[0]]));
            if (this._limit) rows = rows.slice(0, this._limit);
            const data = this._single ? (rows[0] ? project([rows[0]], this._cols)[0] : null) : project(rows, this._cols);
            result = { data, error: null };
          } else if (this._op === 'insert') {
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
    upload(path, file, opts) { storage[bucket].files[path] = { file, opts }; rec({ type: 'storage', op: 'upload', bucket, path }); return Promise.resolve({ data: { path }, error: null }); },
    download(path) {
      const f = storage[bucket].files[path];
      if (!f) return Promise.resolve({ data: null, error: { message: `not found ${path}` } });
      rec({ type: 'storage', op: 'download', bucket, path });
      return Promise.resolve({ data: f.file, error: null });
    },
    remove(paths) { for (const p of paths) delete storage[bucket].files[p]; rec({ type: 'storage', op: 'remove', bucket, paths }); return Promise.resolve({ data: {}, error: null }); },
    list(dir) {
      const names = Object.keys(storage[bucket].files).filter((p) => !dir || p.startsWith(dir)).map((p) => ({ name: p.slice(dir ? dir.length : 0).replace(/^\//, '') }));
      rec({ type: 'storage', op: 'list', bucket, dir });
      return Promise.resolve({ data: names, error: null });
    },
    createSignedUrl(path) { rec({ type: 'storage', op: 'signed', bucket, path }); return Promise.resolve({ data: { signedUrl: `signed://${bucket}/${path}` }, error: null }); },
    getPublicUrl(path) { return { data: { publicUrl: `https://pub/${bucket}/${path}` }, error: null }; },
  });

  // —— 契约辅助：忠实复刻 003_rpc.sql 的 ownership / 前缀推导 ——
  function resolvePrefix(parentType, parentId, assetId) {
    if (parentType === 'work') {
      const w = store.works.find((x) => x.id === parentId);
      if (!w) return { err: `work ${parentId} not found` };
      const isComic = store.comic_pages.some((cp) => cp.work_id === parentId && cp.media_asset_id === assetId);
      const prefix = isComic ? 'works/comic/' : `works/${w.type || ''}/`;
      const stagePrefix = isComic ? 'staging/works/comic/' : `staging/works/${w.type || ''}/`;
      return { prefix, stagePrefix, isComic };
    } else if (parentType === 'certificate') {
      return { prefix: 'certificates/', stagePrefix: 'staging/certificates/' };
    } else if (parentType === 'avatar') {
      return { prefix: 'avatars/', stagePrefix: 'staging/avatars/' };
    }
    return { err: 'invalid p_parent_type' };
  }
  function assetReferenced(parentType, parentId, assetId) {
    if (parentType === 'work') {
      const w = store.works.find((x) => x.id === parentId);
      if (w && w.cover_asset_id === assetId) return true;
      if (store.work_images.some((r) => r.work_id === parentId && r.media_asset_id === assetId)) return true;
      if (store.comic_pages.some((r) => r.work_id === parentId && r.media_asset_id === assetId)) return true;
      return false;
    } else if (parentType === 'certificate') {
      const c = store.certificates.find((x) => x.id === parentId);
      return !!(c && c.media_asset_id === assetId);
    } else if (parentType === 'avatar') {
      return store.profile.some((p) => p.avatar_asset_id === assetId);
    }
    return false;
  }
  function checkVariantSet(assetId, variantPaths) {
    const arr = variantPaths || [];
    const inCnt = arr.length;
    const distinct = new Set(arr.map((v) => v.variant_id)).size;
    if (inCnt !== distinct) return 'duplicate variant_id in p_variant_paths';
    const dbCnt = store.media_variants.filter((v) => v.asset_id === assetId).length;
    if (inCnt !== dbCnt) return `variant set size mismatch: input=${inCnt} db=${dbCnt}`;
    for (const v of arr) {
      const mv = store.media_variants.find((x) => x.id === v.variant_id && x.asset_id === assetId);
      if (!mv) return `some variant_id does not belong to asset ${assetId}`;
    }
    return null;
  }
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

  // —— 硬化 RPC 处理器：忠实复刻 003 ownership guard + 005/006 语义 ——
  function rpc(name, params) {
    rec({ type: 'rpc', name, params });
    if (failRpc[name]) return Promise.resolve({ data: null, error: { message: `${name} injected failure`, code: 'XX' } });
    if (name === 'is_admin') return Promise.resolve({ data: true, error: null });

    if (name === 'publish_asset') {
      const { p_asset_id, p_parent_type, p_parent_id, p_public_original_path, p_variant_paths } = params;
      if (!['work', 'certificate', 'avatar'].includes(p_parent_type)) return Promise.resolve({ data: { ok: false, error: 'invalid p_parent_type' }, error: null });
      const a = store.media_assets.find((x) => x.id === p_asset_id);
      if (!a) return Promise.resolve({ data: { ok: false, error: 'media_assets id not found' }, error: null });
      // P0-二：ownership 守卫（与 003 一致）——未关联资产必须 FAIL
      if (!assetReferenced(p_parent_type, p_parent_id, p_asset_id)) {
        return Promise.resolve({ data: { ok: false, error: `asset ${p_asset_id} is not referenced by ${p_parent_type} ${p_parent_id} (cover/work_images/comic_pages)` }, error: null });
      }
      const { prefix } = resolvePrefix(p_parent_type, p_parent_id, p_asset_id);
      if (!p_public_original_path || p_public_original_path.startsWith('staging/') || !p_public_original_path.startsWith(prefix)) {
        return Promise.resolve({ data: { ok: false, error: `public original path must start with ${prefix}: ${p_public_original_path}` }, error: null });
      }
      const vErr = checkVariantSet(p_asset_id, p_variant_paths);
      if (vErr) return Promise.resolve({ data: { ok: false, error: vErr }, error: null });
      a.bucket = PUBLIC; a.original_path = p_public_original_path;
      for (const v of (p_variant_paths || [])) {
        const mv = store.media_variants.find((x) => x.id === v.variant_id);
        if (mv) { mv.bucket = PUBLIC; mv.variant_path = v.path; }
      }
      if (p_parent_type === 'work') {
        const w = store.works.find((x) => x.id === p_parent_id);
        if (w) w.is_public = allWorkAssetsPublic(p_parent_id);
      } else if (p_parent_type === 'certificate') {
        const c = store.certificates.find((x) => x.id === p_parent_id);
        if (c) c.is_public = true;
      }
      return Promise.resolve({ data: { ok: true, bucket: PUBLIC }, error: null });
    }

    if (name === 'unpublish_asset') {
      const { p_asset_id, p_parent_type, p_parent_id, p_private_original_path, p_variant_paths } = params;
      if (!['work', 'certificate', 'avatar'].includes(p_parent_type)) return Promise.resolve({ data: { ok: false, error: 'invalid p_parent_type' }, error: null });
      const a = store.media_assets.find((x) => x.id === p_asset_id);
      if (!a) return Promise.resolve({ data: { ok: false, error: 'media_assets id not found' }, error: null });
      if (!assetReferenced(p_parent_type, p_parent_id, p_asset_id)) {
        return Promise.resolve({ data: { ok: false, error: `asset ${p_asset_id} is not referenced by ${p_parent_type} ${p_parent_id} (cover/work_images/comic_pages)` }, error: null });
      }
      const { stagePrefix } = resolvePrefix(p_parent_type, p_parent_id, p_asset_id);
      if (!p_private_original_path || !p_private_original_path.startsWith(stagePrefix)) {
        return Promise.resolve({ data: { ok: false, error: `private original path must start with ${stagePrefix}: ${p_private_original_path}` }, error: null });
      }
      const vErr = checkVariantSet(p_asset_id, p_variant_paths);
      if (vErr) return Promise.resolve({ data: { ok: false, error: vErr }, error: null });
      a.bucket = PRIVATE; a.original_path = p_private_original_path;
      for (const v of (p_variant_paths || [])) {
        const mv = store.media_variants.find((x) => x.id === v.variant_id);
        if (mv) { mv.bucket = PRIVATE; mv.variant_path = v.path; }
      }
      if (p_parent_type === 'work') {
        const w = store.works.find((x) => x.id === p_parent_id);
        if (w) w.is_public = false;
      } else if (p_parent_type === 'certificate') {
        const c = store.certificates.find((x) => x.id === p_parent_id);
        if (c) c.is_public = false;
      }
      return Promise.resolve({ data: { ok: true, bucket: PRIVATE }, error: null });
    }

    // P0-一：prepare 系列——不校验 ownership，不碰父 FK / is_public，仅翻 asset + variants bucket
    if (name === 'prepare_asset_public') {
      const { p_asset_id, p_parent_type, p_parent_id, p_public_original_path, p_variant_paths } = params;
      if (!['work', 'certificate', 'avatar'].includes(p_parent_type)) return Promise.resolve({ data: { ok: false, error: 'invalid p_parent_type' }, error: null });
      const a = store.media_assets.find((x) => x.id === p_asset_id);
      if (!a) return Promise.resolve({ data: { ok: false, error: 'media_assets id not found' }, error: null });
      if (p_parent_type === 'work') { if (!store.works.find((w) => w.id === p_parent_id)) return Promise.resolve({ data: { ok: false, error: `work ${p_parent_id} not found` }, error: null }); }
      else if (p_parent_type === 'certificate') { if (!store.certificates.find((c) => c.id === p_parent_id)) return Promise.resolve({ data: { ok: false, error: `certificate ${p_parent_id} not found` }, error: null }); }
      const { prefix } = resolvePrefix(p_parent_type, p_parent_id, p_asset_id);
      if (!p_public_original_path || p_public_original_path.startsWith('staging/') || !p_public_original_path.startsWith(prefix)) {
        return Promise.resolve({ data: { ok: false, error: `public original path must start with ${prefix}: ${p_public_original_path}` }, error: null });
      }
      const vErr = checkVariantSet(p_asset_id, p_variant_paths);
      if (vErr) return Promise.resolve({ data: { ok: false, error: vErr }, error: null });
      a.bucket = PUBLIC; a.original_path = p_public_original_path;
      for (const v of (p_variant_paths || [])) { const mv = store.media_variants.find((x) => x.id === v.variant_id); if (mv) { mv.bucket = PUBLIC; mv.variant_path = v.path; } }
      return Promise.resolve({ data: { ok: true, bucket: PUBLIC }, error: null });
    }
    if (name === 'prepare_asset_private') {
      const { p_asset_id, p_parent_type, p_parent_id, p_private_original_path, p_variant_paths } = params;
      if (!['work', 'certificate', 'avatar'].includes(p_parent_type)) return Promise.resolve({ data: { ok: false, error: 'invalid p_parent_type' }, error: null });
      const a = store.media_assets.find((x) => x.id === p_asset_id);
      if (!a) return Promise.resolve({ data: { ok: false, error: 'media_assets id not found' }, error: null });
      if (p_parent_type === 'work') { if (!store.works.find((w) => w.id === p_parent_id)) return Promise.resolve({ data: { ok: false, error: `work ${p_parent_id} not found` }, error: null }); }
      else if (p_parent_type === 'certificate') { if (!store.certificates.find((c) => c.id === p_parent_id)) return Promise.resolve({ data: { ok: false, error: `certificate ${p_parent_id} not found` }, error: null }); }
      const { stagePrefix } = resolvePrefix(p_parent_type, p_parent_id, p_asset_id);
      if (!p_private_original_path || !p_private_original_path.startsWith(stagePrefix)) {
        return Promise.resolve({ data: { ok: false, error: `private original path must start with ${stagePrefix}: ${p_private_original_path}` }, error: null });
      }
      const vErr = checkVariantSet(p_asset_id, p_variant_paths);
      if (vErr) return Promise.resolve({ data: { ok: false, error: vErr }, error: null });
      a.bucket = PRIVATE; a.original_path = p_private_original_path;
      for (const v of (p_variant_paths || [])) { const mv = store.media_variants.find((x) => x.id === v.variant_id); if (mv) { mv.bucket = PRIVATE; mv.variant_path = v.path; } }
      return Promise.resolve({ data: { ok: true, bucket: PRIVATE }, error: null });
    }

    // P0-八：append 原子追加（单线程模拟；DB 层 FOR UPDATE 串行化）
    if (name === 'append_work_image') {
      const { p_work_id, p_media_asset_id } = params;
      const a = store.media_assets.find((x) => x.id === p_media_asset_id);
      if (!a) return Promise.resolve({ data: { ok: false, error: 'media_assets id not found' }, error: null });
      if (!store.works.find((w) => w.id === p_work_id)) return Promise.resolve({ data: { ok: false, error: `work ${p_work_id} not found` }, error: null });
      const max = store.work_images.filter((r) => r.work_id === p_work_id).reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
      const newId = 'wi-' + Math.random().toString(36).slice(2, 10);
      store.work_images.push({ id: newId, work_id: p_work_id, media_asset_id: p_media_asset_id, sort_order: max + 1, alt_text: null });
      return Promise.resolve({ data: { ok: true, work_id: p_work_id, image_id: newId }, error: null });
    }
    if (name === 'append_comic_page') {
      const { p_work_id, p_media_asset_id } = params;
      const a = store.media_assets.find((x) => x.id === p_media_asset_id);
      if (!a) return Promise.resolve({ data: { ok: false, error: 'media_assets id not found' }, error: null });
      if (!store.works.find((w) => w.id === p_work_id)) return Promise.resolve({ data: { ok: false, error: `work ${p_work_id} not found` }, error: null });
      const maxPn = store.comic_pages.filter((r) => r.work_id === p_work_id).reduce((m, r) => Math.max(m, r.page_number || 0), 0);
      const maxSo = store.comic_pages.filter((r) => r.work_id === p_work_id).reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
      const newId = 'cp-' + Math.random().toString(36).slice(2, 10);
      store.comic_pages.push({ id: newId, work_id: p_work_id, media_asset_id: p_media_asset_id, page_number: maxPn + 1, sort_order: maxSo + 1 });
      return Promise.resolve({ data: { ok: true, work_id: p_work_id, page_id: newId }, error: null });
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
      // P0-七：公开漫画最后 1 页保护
      const w = store.works.find((x) => x.id === params.p_work_id);
      if (w && w.is_public === true) {
        const cur = store.comic_pages.filter((r) => r.work_id === params.p_work_id).length;
        if (cur <= 1) return Promise.resolve({ data: { ok: false, error: '公开漫画至少需要保留1页。如需删除最后一页，请先下架漫画。' }, error: null });
      }
      store.comic_pages = store.comic_pages.filter((r) => r.id !== params.p_page_id);
      const rest = store.comic_pages.filter((r) => r.work_id === params.p_work_id).sort((a, b) => a.sort_order - b.sort_order);
      rest.forEach((r, i) => { r.sort_order = i + 1; });
      return Promise.resolve({ data: { ok: true, removed_page_id: params.p_page_id }, error: null });
    }

    return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
  }

  const origFrom = (table) => {
    const b = builder(table);
    const origSelect = b.select.bind(b);
    b.select = (cols) => {
      if (injectIsPublicError && table === 'works' && /is_public/.test(cols)) {
        b._op = 'select'; b._cols = cols; b._single = true;
        b.then = (resolve) => { rec({ type: 'table', op: 'select', table, cols }); resolve({ data: null, error: { message: 'injected is_public read error' } }); };
        return b;
      }
      return origSelect(cols);
    };
    return b;
  };
  const sb = { from: (t) => origFrom(t), storage: { from: (b) => storageApi(b) }, rpc };
  const realFrom = sb.from;
  sb.from = (t) => {
    const b = realFrom(t);
    const origUpdate = b.update.bind(b);
    b.update = (row) => {
      if (injectWorkImagesUpdateError && t === 'work_images' && 'media_asset_id' in row) {
        const b2 = builder(t); b2._op = 'update'; b2._row = row; b2._filters = b._filters;
        b2.then = (resolve) => { rec({ type: 'table', op: 'update', table: t, row }); resolve({ data: null, error: { message: 'injected work_images update failure' } }); };
        return b2;
      }
      if (injectWorksUpdateError && t === 'works' && row) {
        const b2 = builder(t); b2._op = 'update'; b2._row = row; b2._filters = b._filters;
        b2.then = (resolve) => { rec({ type: 'table', op: 'update', table: t, row }); resolve({ data: null, error: { message: 'injected works update failure' } }); };
        return b2;
      }
      return origUpdate(row);
    };
    return b;
  };

  return {
    sb, store, storage, ops, failRpc,
    setInjectIsPublicError: (v) => { injectIsPublicError = v; },
    setInjectWorkImagesUpdateError: (v) => { injectWorkImagesUpdateError = v; },
    setInjectWorksUpdateError: (v) => { injectWorksUpdateError = v; },
  };
}

export function seedWork(f, { id, type, isPublic, coverAssetId }) {
  f.store.works.push({ id, type, title: id, is_public: isPublic, cover_asset_id: coverAssetId, sort_order: 1, home_featured: false, home_featured_order: 0, works_pick: false, works_pick_order: 0, display_size: 'standard', work_nature: null, tags: [], stage: '', year: null, intro: '' });
}
export function seedAsset(f, { id, bucket, original, variants }) {
  f.store.media_assets.push({ id, bucket, original_path: original, original_width: 100, original_height: 100, format: 'jpeg' });
  (variants || []).forEach((v) => f.store.media_variants.push({ id: v.id, asset_id: id, bucket, variant_path: v.path, width: v.width || 100, height: v.height || 100 }));
  f.storage[bucket].files[original] = { file: { name: original, size: 10, type: 'image/jpeg' } };
  (variants || []).forEach((v) => { f.storage[bucket].files[v.path] = { file: { name: v.path, size: 10, type: 'image/jpeg' } }; });
}
