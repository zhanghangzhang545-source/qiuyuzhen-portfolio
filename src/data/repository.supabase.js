// ============================================================
// repository.supabase.js — Phase 3-C2 真实仓储（Supabase）
// ------------------------------------------------------------
// 实现 WorkRepository 的全部方法：
//   只读（C1 已冻结）：list / getById / getByType / filter / _hydrateWorks / 媒体解析。
//   写（C2 解锁）：create / update / reorderComicPages / 证书写方法。
// C2 边界（严格禁止项，详见 PHASE3_REQUIREMENTS / 用户指令）：
//   ❌ 不调用任何 Storage 写入（不传/替换/删除图片，不调用 publish_asset/unpublish_asset）。
//   ❌ 不开放 destructive delete：remove() 保持「禁用」语义，返回明确 disabled 提示，
//      不执行任何真实删除；真实删除留 C3。
//   ❌ 不修改 B1 schema/RLS/RPC（本文件只「解锁」写方法，列已全部在 B1 中具备）。
//   字段映射（Work shape → DB 列）：
//     featured→home_featured / homeFeaturedOrder→home_featured_order
//     worksPick→works_pick / worksPickOrder→works_pick_order
//     sort→sort_order / workNature→work_nature / public→is_public
//     displaySize→display_size
//
// 数据映射（DB 行 → 前台 Work shape，保持前台视觉零改动）：
//   works.id              → Work.id
//   works.type            → Work.type（illustration / comic / oil）
//   works.title           → Work.title
//   works.intro           → Work.intro
//   works.year            → Work.year（null 保持 null，不补）
//   works.stage           → Work.stage
//   works.work_nature     → Work.workNature（null 保持 null，不默认 original）
//   works.tags            → Work.tags
//   works.is_public       → Work.public
//   works.sort_order      → Work.sort
//   works.home_featured   → Work.featured（前台「精选/首页 SELECTED」语义）
//   works.works_pick      → Work.worksPick（保留字段，供后续精选入口使用）
//   works.display_size    → Work.displaySize（standard / large-portrait / wide-feature）
//   works.cover_asset_id  → Work.cover（Storage 公开 URL）
//   work_images           → Work.images（有序 URL 数组）
//   comic_pages           → Work.pages（{id,order,image:URL} 按 page_number/sort_order）
//
// 证书（certificates 表）→ 以 type='certificate' 的 Work 返回（栏目规则排除出 Works，
//   与 Mock 行为一致）。封面取 media_assets + media_variants 的公开 URL。
//
// 媒体 URL：所有生产资产均在 portfolio-public bucket，canonical path 已就绪。
//   C1 取每个 asset 的「原图公开 URL」作为封面/图片值（前台 media.js 对 http(s)
//   走 plain <img> lazy+重试，视觉/版式与 Mock 的衍生图一致）。响应式多档 tiering
//   属展示增强，留待 C2；C1 仅保证真数据可读、视觉零回归。
// ============================================================

import { WorkRepository } from './repository.js';
import { getSupabase, hasSupabaseConfig } from './supabaseClient.js';
import { PUBLIC_BUCKET, PRIVATE_BUCKET } from './storage.supabase.js';

// 图片默认展示宽度档（用于选一个合理 variant；C1 单 URL 模式，取最接近该宽度者）
const COVER_PREF_WIDTH = 1280;
const PAGE_PREF_WIDTH = 1280;

export class SupabaseWorkRepository extends WorkRepository {
  constructor(injectedClient = null) {
    super();
    // _sb 可为外部注入（仅供自动化测试模拟 Supabase 客户端；
    // 生产路径传 null，由 getSupabase() 懒加载真实客户端）。
    this._sb = injectedClient;
  }

  async _client() {
    if (!this._sb) this._sb = await getSupabase();
    return this._sb;
  }

  /**
   * C1/C2 模式分流守卫（C2 边界纪律）：
   * - C1（未注入客户端且未配置真实 Supabase）：写操作一律抛「C1 只读」错误（冻结语义）。
   * - C2（已注入测试客户端，或真实环境已配置 SUPABASE_URL/KEY）：返回可写客户端。
   * 真实可写路径仍受 B1 RLS + is_admin() 约束（非管理员由 Supabase 后端拒绝）。
   */
  async _requireWritableClient() {
    if (this._sb) return this._sb;
    if (await hasSupabaseConfig()) return this._client();
    throw new Error('C1 只读：当前为只读接入模式，写操作被禁用（C2 阶段配置 Supabase 后解锁）');
  }

  // C2 禁止项（remove / addComicPage / removeComicPage / resetDemo）：C1 模式抛「C1 只读」；C2 模式放行执行禁用语义。
  async _c1OrThrow() {
    if (this._sb || await hasSupabaseConfig()) return;
    throw new Error('C1 只读：当前为只读接入模式，写操作被禁用');
  }

  // —— 媒体解析：批量取 asset + variants，构建 asset_id → 公开 URL 映射 ——
  async _resolveMedia(assetIds) {
    const ids = [...new Set(assetIds.filter(Boolean))];
    const map = new Map(); // asset_id → { bucket, originalPath, variants:[{width,path}] }
    if (ids.length === 0) return map;

    const sb = await this._client();
    const [{ data: assets, error: ea }, { data: variants, error: ev }] = await Promise.all([
      sb.from('media_assets').select('id, bucket, original_path, original_width, original_height').in('id', ids),
      sb.from('media_variants').select('asset_id, bucket, variant_path, width, height').in('asset_id', ids),
    ]);
    if (ea) throw new Error(`media_assets 读取失败：${ea.message}`);
    if (ev) throw new Error(`media_variants 读取失败：${ev.message}`);

    for (const a of (assets || [])) {
      map.set(a.id, {
        bucket: a.bucket,
        originalPath: a.original_path,
        originalWidth: a.original_width,
        originalHeight: a.original_height,
        variants: [],
      });
    }
    for (const v of (variants || [])) {
      const m = map.get(v.asset_id);
      if (m) m.variants.push({ width: v.width, height: v.height, path: v.variant_path, bucket: v.bucket });
    }
    return map;
  }

  _publicUrl(bucket, path) {
    // 同步取得公开 URL（getPublicUrl 是纯客户端拼接，不发请求）
    const sb = this._sb;
    return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  // 取某个 asset 的合适展示 URL：优先最接近首选宽度的 variant，否则用原图
  _assetDisplayUrl(media) {
    if (!media) return '';
    if (media.variants && media.variants.length) {
      const sorted = [...media.variants].sort((a, b) => Math.abs(a.width - COVER_PREF_WIDTH) - Math.abs(b.width - COVER_PREF_WIDTH));
      const pick = sorted[0];
      return this._publicUrl(pick.bucket || media.bucket, pick.path);
    }
    if (media.originalPath) return this._publicUrl(media.bucket, media.originalPath);
    return '';
  }

  async _mapWorkRow(row, mediaMap) {
    const coverMedia = mediaMap.get(row.cover_asset_id);
    const cover = this._assetDisplayUrl(coverMedia);
    const coverW = coverMedia?.originalWidth || null;
    const coverH = coverMedia?.originalHeight || null;

    const work = {
      type: row.type,
      id: row.id,
      title: row.title,
      intro: row.intro || '',
      year: row.year == null ? null : row.year,
      stage: row.stage || '',
      workNature: row.work_nature || null,
      tags: Array.isArray(row.tags) ? row.tags : [],
      date: '',
      sort: row.sort_order || 0,
      public: row.is_public !== false,
      featured: !!row.home_featured,
      homeFeaturedOrder: row.home_featured_order || 0,
      worksPick: !!row.works_pick,
      worksPickOrder: row.works_pick_order || 0,
      displaySize: row.display_size || 'standard',
      cover,
      coverW,
      coverH,
      images: [],
      pages: [],
    };
    return work;
  }

  // 填充 work.images / work.pages 已合并至 _hydrateWorks（批量取，禁用 N+1）。

  // 取一批 works（已按过滤条件），并批量解析其关联媒体，返回完整 Work[]
  // 关键：一次性批量取 work_images + comic_pages（禁用 N+1）；收集全部 media_asset_id
  // 后一次性 _resolveMedia，保证 images / pages 的 URL 全部非空。
  async _hydrateWorks(rows, { withImages = true } = {}) {
    const sb = await this._client();
    const ids = rows.map((r) => r.id);

    // 1) 批量取关联媒体行（work_images 与 comic_pages），一次查询取全部
    const [{ data: imgRows, error: ie }, { data: pageRows, error: pe }] = await Promise.all([
      sb.from('work_images').select('work_id, media_asset_id, sort_order, alt_text').in('work_id', ids),
      sb.from('comic_pages').select('id, work_id, media_asset_id, page_number, sort_order').in('work_id', ids),
    ]);
    if (ie) throw new Error(`work_images 读取失败：${ie.message}`);
    if (pe) throw new Error(`comic_pages 读取失败：${pe.message}`);

    // 2) 收集全部 asset id（封面 + 图 + 页）→ 一次性解析媒体 URL 映射
    const assetIds = [];
    for (const r of rows) if (r.cover_asset_id) assetIds.push(r.cover_asset_id);
    for (const r of (imgRows || [])) if (r.media_asset_id) assetIds.push(r.media_asset_id);
    for (const r of (pageRows || [])) if (r.media_asset_id) assetIds.push(r.media_asset_id);
    const mediaMap = await this._resolveMedia(assetIds);

    // 3) 按 work 聚合关联行，避免逐 work 再发查询（N+1 → 0）
    const imgsByWork = new Map();
    for (const r of (imgRows || [])) {
      if (!imgsByWork.has(r.work_id)) imgsByWork.set(r.work_id, []);
      imgsByWork.get(r.work_id).push(r);
    }
    const pagesByWork = new Map();
    for (const r of (pageRows || [])) {
      if (!pagesByWork.has(r.work_id)) pagesByWork.set(r.work_id, []);
      pagesByWork.get(r.work_id).push(r);
    }

    const works = [];
    for (const r of rows) {
      const w = await this._mapWorkRow(r, mediaMap);
      if (r.type === 'comic') {
        const pr = (pagesByWork.get(r.id) || []).sort((a, b) => (a.sort_order || a.page_number) - (b.sort_order || b.page_number));
        w.pages = pr.map((m, i) => ({
          id: m.id,
          order: m.sort_order || m.page_number || (i + 1),
          image: this._assetDisplayUrl(mediaMap.get(m.media_asset_id)),
          w: mediaMap.get(m.media_asset_id)?.originalWidth || null,
          h: mediaMap.get(m.media_asset_id)?.originalHeight || null,
        })).filter((p) => p.image);
      } else if (withImages) {
        const ir = (imgsByWork.get(r.id) || []).sort((a, b) => a.sort_order - b.sort_order);
        w.images = ir.map((m) => this._assetDisplayUrl(mediaMap.get(m.media_asset_id))).filter(Boolean);
      }
      works.push(w);
    }
    return works;
  }

  // 证书：certificates 表 → type='certificate' 的 Work
  async _readCertificates() {
    const sb = await this._client();
    const { data, error } = await sb
      .from('certificates')
      .select('id, title, year, year_start, year_end, category, media_asset_id, is_public, sort_order')
      .order('sort_order', { ascending: true });
    if (error) throw new Error(`certificates 读取失败：${error.message}`);
    const assetIds = (data || []).map((c) => c.media_asset_id).filter(Boolean);
    const mediaMap = await this._resolveMedia(assetIds);
    return (data || []).map((c) => {
      const m = mediaMap.get(c.media_asset_id);
      return {
        type: 'certificate',
        id: c.id,
        title: c.title,
        intro: '',
        year: c.year == null ? null : c.year,
        stage: '',
        tags: ['证书'],
        date: '',
        sort: c.sort_order || 0,
        public: c.is_public !== false,
        featured: false,
        cover: this._assetDisplayUrl(m),
        coverW: m?.originalWidth || null,
        coverH: m?.originalHeight || null,
        issuer: '',
        certDate: '',
      };
    });
  }

  async list() {
    const sb = await this._client();
    const { data, error } = await sb
      .from('works')
      .select('*')
      .order('sort_order', { ascending: false });
    if (error) throw new Error(`works 读取失败：${error.message}`);
    const works = await this._hydrateWorks(data || []);
    const certs = await this._readCertificates();
    return [...works, ...certs];
  }

  async getById(id) {
    const sb = await this._client();
    // 先查 works
    const { data: wrow, error: we } = await sb.from('works').select('*').eq('id', id).maybeSingle();
    if (we) throw new Error(`works 读取失败：${we.message}`);
    if (wrow) {
      const works = await this._hydrateWorks([wrow]);
      return works[0] || null;
    }
    // 再查 certificates
    const { data: crow, error: ce } = await sb.from('certificates').select('*').eq('id', id).maybeSingle();
    if (ce) throw new Error(`certificates 读取失败：${ce.message}`);
    if (crow) {
      const certs = await this._readCertificates();
      return certs.find((c) => c.id === id) || null;
    }
    return null;
  }

  async getByType(type) {
    if (type === 'certificate') {
      return this._readCertificates();
    }
    const sb = await this._client();
    const { data, error } = await sb
      .from('works')
      .select('*')
      .eq('type', type)
      .order('sort_order', { ascending: false });
    if (error) throw new Error(`works 读取失败：${error.message}`);
    return this._hydrateWorks(data || []);
  }

  /**
   * 统一筛选（与 Mock 语义一致）
   * @param {{type?:string,q?:string,stage?:string,year?:string|number,tag?:string,featured?:boolean,publicOnly?:boolean,sort?:string}} criteria
   */
  async filter(criteria = {}) {
    // 证书恒包含在完整列表中（栏目规则在消费端按 type 排除出 Works）
    const all = await this.list();
    let list = all.slice();

    // 与 Mock 语义严格一致：按 type 精确过滤。
    // 证书（type==='certificate'）也通过此路径过滤——不再被豁免。
    // 证书恒包含在完整列表 all 中（栏目规则在消费端按 type 排除出 Works）。
    if (criteria.type) {
      list = list.filter((w) => w.type === criteria.type);
    }
    if (criteria.publicOnly) list = list.filter((w) => w.public !== false);
    if (criteria.featured) list = list.filter((w) => w.featured);
    if (criteria.stage) list = list.filter((w) => w.stage === criteria.stage);
    if (criteria.year) list = list.filter((w) => String(w.year) === String(criteria.year));
    if (criteria.tag) list = list.filter((w) => (w.tags || []).includes(criteria.tag));
    if (criteria.q) {
      const q = criteria.q.trim().toLowerCase();
      if (q) list = list.filter((w) =>
        (w.title || '').toLowerCase().includes(q) ||
        (w.intro || '').toLowerCase().includes(q) ||
        (w.tags || []).some((t) => t.toLowerCase().includes(q)));
    }

    const sort = criteria.sort || 'manual';
    const yv = (w) => (w.year == null || w.year === '') ? null : Number(w.year);
    const byCustom = (a, b) => (b.sort || 0) - (a.sort || 0);
    const yearDesc = (a, b) => {
      const ya = yv(a), yb = yv(b);
      if (ya == null && yb == null) return byCustom(a, b);
      if (ya == null) return 1;
      if (yb == null) return -1;
      return (yb - ya) || byCustom(a, b);
    };
    const yearAsc = (a, b) => {
      const ya = yv(a), yb = yv(b);
      if (ya == null && yb == null) return byCustom(a, b);
      if (ya == null) return 1;
      if (yb == null) return -1;
      return (ya - yb) || byCustom(a, b);
    };
    list.sort((a, b) => {
      switch (sort) {
        case 'newest': return yearDesc(a, b);
        case 'oldest': return yearAsc(a, b);
        case 'sort-asc': return a.sort - b.sort;
        case 'sort-desc': return b.sort - a.sort;
      case 'manual':
      default:
        // Works 完整列表 manual 排序：仅按 sort_order（自定义权重），不受 home_featured / works_pick 维度污染。
        // 双维度独立：Home Featured 由 home_featured+homeFeaturedOrder 决定；Works Pick 由 worksPick+worksPickOrder 决定；
        // Works 完整列表仅由 sort_order 决定。三者互不影响。
        return byCustom(a, b);
      }
    });
    return list;
  }

  stats() {
    // stats() 在前台为同步辅助（Mock 实现为同步）。
    // Supabase 为异步仓储，stat 由调用方用 list() 结果计算；此处抛错迫使调用方改用异步。
    throw new Error('SupabaseWorkRepository.stats() 为异步上下文，请改用 await repo.list() 后本地统计。');
  }

  // —— C2 写方法（真实 Supabase 写入）——
  // 写方法均通过 RLS + is_admin() 守卫：非白名单管理员会被 RLS 拒绝（由 Supabase 返回 error），
  // 调用方捕获后显式呈现错误态，绝不静默回 Mock / 不污染本地 UI。

  /**
   * 创建作品（C2 开放：含无媒体 draft 作品）。
   * 规则：slug = id；type 必须为 illustration/comic/oil（证书不在此创建）；
   *       无媒体 draft：is_public 默认 false（草稿不公开），cover_asset_id 留空。
   * @param {Object} work 前台 Work 形状（字段可缺省）
   * @returns {Promise<Object>} 创建后的完整 Work（经 list 映射）
   */
  async create(work) {
    const sb = await this._requireWritableClient();
    // #2 严格字段校验（写前抛错，无回退、无静默改值；与 update() 语义一致）
    if (!work || typeof work !== 'object') throw new Error('create 参数必须为一个作品对象');
    if (!(work.title || '').trim()) throw new Error('title 不能为空');
    const type = work.type;
    if (!['illustration', 'comic', 'oil'].includes(type)) {
      throw new Error('作品 type 必须为 illustration / comic / oil（证书不通过通用创建）');
    }
    if (work.workNature != null && !['original', 'fan'].includes(work.workNature)) {
      throw new Error('workNature 必须为 original / fan / null');
    }
    if (work.displaySize != null && !['standard', 'large-portrait', 'wide-feature'].includes(work.displaySize)) {
      throw new Error('displaySize 必须为 standard / large-portrait / wide-feature');
    }
    if (work.tags != null && !Array.isArray(work.tags)) {
      throw new Error('tags 必须为数组');
    }
    if (work.year != null && (!Number.isInteger(work.year) || work.year < 1900 || work.year > 2100)) {
      throw new Error('year 必须为合理整数或 null');
    }
    if (!Number.isInteger(Number(work.sort || 0))) {
      throw new Error('sort 必须为整数');
    }
    if (!Number.isInteger(Number(work.homeFeaturedOrder || 0))) {
      throw new Error('homeFeaturedOrder 必须为整数');
    }
    if (!Number.isInteger(Number(work.worksPickOrder || 0))) {
      throw new Error('worksPickOrder 必须为整数');
    }
    // C2 发布边界（#5）：create 强制 is_public=false（不依赖草稿勾选，正式 publish 留 C3）
    // #3 修复：生成一次业务 ID，严格 slug = id（避免 id/slug 各自独立生成导致不一致）
    const id = `w${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    const row = {
      id,
      slug: id,
      type,
      title: (work.title || '').trim() || '未命名作品',
      intro: work.intro || '',
      year: work.year == null ? null : Number(work.year),
      stage: work.stage || '',
      work_nature: work.workNature || null,
      // #3 修复：真实写入 tags 列（合法数组，缺省为 []）
      tags: Array.isArray(work.tags) ? work.tags : [],
      cover_asset_id: null, // C2 禁媒体：封面留空
      is_public: false, // C2 新作恒不公开
      sort_order: Number(work.sort || 0),
      home_featured: !!work.featured,
      home_featured_order: Number(work.homeFeaturedOrder || 0),
      works_pick: !!work.worksPick,
      works_pick_order: Number(work.worksPickOrder || 0),
      display_size: ['standard', 'large-portrait', 'wide-feature'].includes(work.displaySize) ? work.displaySize : 'standard',
    };
    const { data, error } = await sb.from('works').insert(row).select('*').maybeSingle();
    if (error) throw new Error(`作品创建失败：${error.message}`);
    // 回读为完整 Work（含媒体映射，draft 无媒体则为空）
    const created = await this._hydrateWorks([data]);
    return created[0] || null;
  }

  /**
   * 更新作品（C2 开放）。
   * 仅更新显式传入的字段；Work shape → DB 列映射（featured→home_featured 等）。
   * 严禁写媒体字段（cover_asset_id 不在 patch 中构造，避免误改图片引用）。
   * @param {string} id
   * @param {Object} patch 前台 Work 形状补丁（仅含要改的字段）
   * @returns {Promise<Object>} 更新后的完整 Work
   */
  async update(id, patch) {
    const sb = await this._requireWritableClient();
    // C2 发布边界（#5）：现有作品 update 不接受 public/is_public/type（正式 publish/unpublish 留 C3；type 冻结）
    if ('public' in patch || 'is_public' in patch) {
      throw new Error('C2 禁止修改作品公开状态（正式 publish/unpublish 将在 C3 开放）');
    }
    if ('type' in patch) {
      throw new Error('C2 禁止修改作品 type（现有作品类型已冻结，仅创建时可选择）');
    }
    // #7 字段验证：先校验后请求，非法值抛错，不静默修正
    if ('workNature' in patch && patch.workNature != null && !['original', 'fan'].includes(patch.workNature)) {
      throw new Error('workNature 必须为 original / fan / null');
    }
    if ('displaySize' in patch && patch.displaySize != null && !['standard', 'large-portrait', 'wide-feature'].includes(patch.displaySize)) {
      throw new Error('displaySize 必须为 standard / large-portrait / wide-feature');
    }
    if ('tags' in patch && !Array.isArray(patch.tags)) {
      throw new Error('tags 必须为数组');
    }
    if ('year' in patch && patch.year != null && (!Number.isInteger(patch.year) || patch.year < 1900 || patch.year > 2100)) {
      throw new Error('year 必须为合理整数或 null');
    }
    if ('sort' in patch && !Number.isInteger(Number(patch.sort))) {
      throw new Error('sort 必须为整数');
    }
    if ('homeFeaturedOrder' in patch && !Number.isInteger(Number(patch.homeFeaturedOrder))) {
      throw new Error('homeFeaturedOrder 必须为整数');
    }
    if ('worksPickOrder' in patch && !Number.isInteger(Number(patch.worksPickOrder))) {
      throw new Error('worksPickOrder 必须为整数');
    }
    if ('title' in patch && !(patch.title || '').trim()) {
      throw new Error('title 不能为空');
    }

    const row = {};
    // 仅映射显式存在的字段（避免用 undefined 覆盖）
    if ('title' in patch) row.title = (patch.title || '').trim();
    if ('intro' in patch) row.intro = patch.intro || '';
    if ('year' in patch) row.year = patch.year == null ? null : Number(patch.year);
    if ('stage' in patch) row.stage = patch.stage || '';
    if ('workNature' in patch) row.work_nature = patch.workNature || null;
    if ('sort' in patch) row.sort_order = Number(patch.sort || 0);
    if ('featured' in patch) row.home_featured = !!patch.featured;
    if ('homeFeaturedOrder' in patch) row.home_featured_order = Number(patch.homeFeaturedOrder || 0);
    if ('worksPick' in patch) row.works_pick = !!patch.worksPick;
    if ('worksPickOrder' in patch) row.works_pick_order = Number(patch.worksPickOrder || 0);
    if ('displaySize' in patch) {
      row.display_size = ['standard', 'large-portrait', 'wide-feature'].includes(patch.displaySize) ? patch.displaySize : 'standard';
    }
    if ('tags' in patch) row.tags = Array.isArray(patch.tags) ? patch.tags : [];
    if (Object.keys(row).length === 0) {
      // 空补丁：直接回读当前作品，避免无意义写
      return this.getById(id);
    }
    const { data, error } = await sb.from('works').update(row).eq('id', id).select('*').maybeSingle();
    if (error) throw new Error(`作品更新失败：${error.message}`);
    if (!data) throw new Error('作品更新失败：未找到该作品（可能已被删除）');
    const updated = await this._hydrateWorks([data]);
    return updated[0] || null;
  }

  /**
   * 调整漫画页顺序（C2 开放：仅排序，不增删/不替换图片）。
   * 写入逻辑：按 orderedIds 顺序重排 comic_pages.sort_order（与 Mock 行为一致，order 由 1 起）。
   * 注意：B1 表中 comic_pages 同时有 page_number + sort_order 两列；此处仅改 sort_order，
   *       page_number 保持真实页码（C2 禁止删除/替换页，故不重排 page_number 以免图文错位）。
   * @param {string} comicId
   * @param {string[]} orderedIds 目标顺序的 page id 列表
   * @returns {Promise<Object>} 更新后的完整 Work
   */
  async reorderComicPages(comicId, orderedIds) {
    const sb = await this._requireWritableClient();
    // #9 修复：先读全量页行（含 page_number + 当前 sort_order），构建完整目标数组，
    // 再用单次 upsert(数组) 一次性提交（单个 HTTP 请求：要么整批成功，要么整批失败，避免半成功）。
    // page_number 绝对不变（仅调 sort_order，图文顺序不脱节）。
    const { data: rows, error: rerr } = await sb.from('comic_pages').select('id, page_number, sort_order').eq('work_id', comicId);
    if (rerr) throw new Error(`漫画页读取失败：${rerr.message}`);
    const byId = new Map((rows || []).map((r) => [r.id, r]));
    // 校验目标顺序集与现有集一致（防止传入非法 id 导致丢失页）
    const missing = orderedIds.filter((id) => !byId.has(id));
    if (missing.length) throw new Error(`漫画页重排失败：存在未知页 ID（${missing.join(', ')}）`);
    if (orderedIds.length !== byId.size) throw new Error('漫画页重排失败：顺序长度与现有页数不一致');
    const batch = orderedIds.map((id, i) => ({
      id,
      work_id: comicId,
      page_number: byId.get(id).page_number, // 绝对保留原页码
      sort_order: i + 1,
    }));
    const { error } = await sb.from('comic_pages').upsert(batch);
    if (error) throw new Error(`漫画页重排失败：${error.message}`);
    return this.getById(comicId);
  }

  /**
   * C2 证书写方法：更新证书结构化字段（title/year/year_start/year_end/category/is_public/sort_order）。
   * C2 边界：不替换/删除图片（media_asset_id 不在此修改），图片替换留 C3。
   * @param {string} id
   * @param {Object} patch 证书补丁
   * @returns {Promise<Object>} 更新后的证书 Work
   */
  async updateCertificate(id, patch) {
    const sb = await this._requireWritableClient();
    // #4 严格字段校验（写前抛错，无回退；证书真实字段拒绝）
    if ('title' in patch && !(patch.title || '').trim()) {
      throw new Error('证书 title 不能为空');
    }
    if ('year' in patch && patch.year != null && (!Number.isInteger(patch.year) || patch.year < 1900 || patch.year > 2100)) {
      throw new Error('证书 year 必须为合理整数或 null');
    }
    if ('yearStart' in patch && patch.yearStart != null && (!Number.isInteger(patch.yearStart) || patch.yearStart < 1900 || patch.yearStart > 2100)) {
      throw new Error('证书 yearStart 必须为合理整数或 null');
    }
    if ('yearEnd' in patch && patch.yearEnd != null && (!Number.isInteger(patch.yearEnd) || patch.yearEnd < 1900 || patch.yearEnd > 2100)) {
      throw new Error('证书 yearEnd 必须为合理整数或 null');
    }
    if ('yearStart' in patch && 'yearEnd' in patch && patch.yearStart != null && patch.yearEnd != null && patch.yearStart > patch.yearEnd) {
      throw new Error('证书 yearStart 不能晚于 yearEnd');
    }
    if ('sort' in patch && !Number.isInteger(Number(patch.sort || 0))) {
      throw new Error('证书 sort 必须为整数');
    }
    if ('category' in patch && (typeof patch.category !== 'string' || patch.category.trim() === '')) {
      throw new Error('证书 category 必须为非空字符串');
    }
    const row = {};
    if ('title' in patch) row.title = (patch.title || '').trim();
    if ('year' in patch) row.year = patch.year == null ? null : Number(patch.year);
    if ('yearStart' in patch) row.year_start = patch.yearStart == null ? null : Number(patch.yearStart);
    if ('yearEnd' in patch) row.year_end = patch.yearEnd == null ? null : Number(patch.yearEnd);
    if ('category' in patch) row.category = (patch.category || '').trim();
    if ('public' in patch) row.is_public = patch.public !== false;
    if ('sort' in patch) row.sort_order = Number(patch.sort || 0);
    if (Object.keys(row).length === 0) {
      return this.getById(id);
    }
    const { data, error } = await sb.from('certificates').update(row).eq('id', id).select('*').maybeSingle();
    if (error) throw new Error(`证书更新失败：${error.message}`);
    if (!data) throw new Error('证书更新失败：未找到该证书');
    const certs = await this._readCertificates();
    return certs.find((c) => c.id === id) || null;
  }

  // —— C3 媒体写入（Storage + media_assets + 关联 + 发布）——
  // 安全纪律（用户指令 + B1 RLS/RPC）：
  //   ❌ Upload 默认落 portfolio-private；绝不直接向 portfolio-public 写未审核资产。
  //   ✅ canonical 翻转（private→public）经 publish_asset RPC（单事务，保证资产+父记录一致）。
  //   ❌ 不产生孤儿：DB/链接/发布任一环节失败 → 回滚刚上传的 Storage 对象 + 已插入 media_assets 行。
  //   ❌ 不可逆删除：replace 仅改 FK 指向新资产，旧资产 + Storage 文件保留（C3 不物理删除）。
  //   文件校验：拒绝空文件、非 jpg/png/webp、超 10MB。

  static get C3_MAX_FILE_SIZE() { return 10 * 1024 * 1024; }
  static get C3_ALLOWED_MIME() { return ['image/jpeg', 'image/png', 'image/webp']; }

  _validateUploadFile(file) {
    if (!file) throw new Error('未提供文件');
    if (!(file.size > 0)) throw new Error('文件为空（size=0），拒绝上传');
    if (!SupabaseWorkRepository.C3_ALLOWED_MIME.includes(file.type)) {
      throw new Error(`不支持的文件类型（${file.type || 'unknown'}），仅支持 jpg/png/webp`);
    }
    if (file.size > SupabaseWorkRepository.C3_MAX_FILE_SIZE) {
      throw new Error(`文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），上限 10MB`);
    }
  }

  _formatFromMime(mime) {
    if (mime === 'image/png') return 'png';
    if (mime === 'image/jpeg') return 'jpeg';
    if (mime === 'image/webp') return 'webp';
    return 'webp';
  }

  _genAssetId(parentType, parentId) {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 8);
    return `${parentId}__${parentType}__${t}${r}`;
  }

  // —— 私有 Storage → 公开 Storage 可靠拷贝（item 1 核心修复）——
  // 在调用 publish_asset（canonical flip）之前，必须先把真实 Storage 对象从
  // portfolio-private 搬到 portfolio-public，并验证 public bucket 对象真实存在。
  // 失败（拷贝 / 校验 / 发布任一环节）→ 清理本尝试创建的 public 拷贝，绝不产生
  // public/private/DB 三方不一致；private 源对象始终保留（草稿资产不丢）。
  async _copyStoragePrivateToPublic(path) {
    const sb = await this._client();
    const { data: dl, error: dlErr } = await sb.storage.from(PRIVATE_BUCKET).download(path);
    if (dlErr || !dl) throw new Error(`读取 private 对象失败：${dlErr ? dlErr.message : 'empty'}`);
    const { error: upErr } = await sb.storage.from(PUBLIC_BUCKET).upload(path, dl, {
      cacheControl: '3600',
      upsert: true,
      contentType: (dl && dl.type) || 'application/octet-stream',
    });
    if (upErr) throw new Error(`拷贝到 public 失败：${upErr.message}`);
    // 验证 public bucket 对象真实存在（item 1：getPublicUrl 不能把不存在对象当成功）
    const ok = await this._publicObjectExists(path);
    if (!ok) throw new Error('public 对象校验失败：拷贝后不可读');
    return this._publicUrl(PUBLIC_BUCKET, path);
  }

  async _publicObjectExists(path) {
    const sb = await this._client();
    const { data, error } = await sb.storage.from(PUBLIC_BUCKET).list('', { limit: 1000 });
    if (error) throw new Error(`public 列举失败：${error.message}`);
    const name = path.includes('/') ? path.substring(path.lastIndexOf('/') + 1) : path;
    return (data || []).some((o) => o.name === name);
  }

  async _deletePublicStorage(path) {
    const sb = await this._client();
    const { error } = await sb.storage.from(PUBLIC_BUCKET).remove([path]);
    if (error) throw new Error(`public 对象清理失败：${error.message}`);
    return true;
  }

  // 发布单个资产：真实 Storage 拷贝（private→public）+ 校验 + publish_asset canonical flip。
  // 任一环节失败 → 回滚本尝试的 public 拷贝，抛错（DB canonical 不被翻转）。
  async _publishAsset(assetId, parentType, parentId) {
    const sb = await this._client();
    const isAdmin = await sb.rpc('is_admin');
    if (!isAdmin.data) throw new Error('非管理员，无发布权限');
    const { data: a, error: ae } = await sb.from('media_assets').select('original_path, bucket').eq('id', assetId).maybeSingle();
    if (ae) throw new Error(`读取资产失败：${ae.message}`);
    if (!a) throw new Error('发布资产失败：资产不存在');
    const path = a.original_path;
    // 仅当资产仍在 private 时才拷贝（已 public 则跳过，避免重复写）
    let publicPathCreated = false;
    if (a.bucket === PRIVATE_BUCKET) {
      await this._copyStoragePrivateToPublic(path);
      publicPathCreated = true;
    }
    try {
      const pub = await sb.rpc('publish_asset', { p_asset_id: assetId, p_parent_type: parentType, p_parent_id: parentId });
      if (!pub.data || pub.data.ok !== true) throw new Error(`发布资产失败：${(pub.data && pub.data.error) || 'unknown'}`);
    } catch (e) {
      if (publicPathCreated) { try { await this._deletePublicStorage(path); } catch (_) { /* 回滚尽力而为 */ } }
      throw e;
    }
  }

  /**
   * 通用上传+登记+回滚流程（C3 媒体写入原子骨架）。
   * 步骤：校验 → 管理员判定 → 上传 private → 插入 media_assets(private) → linkFn(关联父记录)
   *       → [autoPublish? 发布资产（真实 Storage 拷贝 + canonical flip） : 保持草稿 private]。
   * 任一失败 → 回滚刚上传 Storage 对象 + 删除 media_assets 行（无孤儿）。
   * 注意（item 2）：作品（Works）默认 autoPublish=false —— 上传媒体后作品【不】自动公开，
   *       须管理员在后台显式「发布」后才经 publishWork 正式公开；证书（certificate）autoPublish=true
   *       维持既有「替换即发布」语义，但同样补齐真实 Storage 拷贝（item 1）。
   * @returns {Promise<{assetId:string,key:string,url:string,bucket:string,format:string}>}
   */
  async _uploadAndLink(file, { parentType, parentId, linkFn, autoPublish = false }) {
    this._validateUploadFile(file);
    const sb = await this._requireWritableClient();
    // 管理员判定（真实 Supabase 由 Storage RLS + publish_asset 内部 is_admin 双重守卫；
    // 此处显式前置判定，便于在上传前即拒绝非管理员/会话失效）。
    const adminChk = await sb.rpc('is_admin');
    if (!adminChk.data) throw new Error('非管理员，无上传 / 媒体写入权限（会话失效或未授权）');

    const format = this._formatFromMime(file.type);
    const safeName = String(file.name || 'file').replace(/[^\w.\-]+/g, '_');
    const key = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
    const assetId = this._genAssetId(parentType, parentId);

    // 1) 上传到 portfolio-private（未审核资产不进 public）
    const up = await sb.storage.from(PRIVATE_BUCKET).upload(key, file, { cacheControl: '3600', upsert: false });
    if (up.error) throw new Error(`Storage 上传失败：${up.error.message}`);
    const path = (up.data && up.data.path) || key;

    try {
      // 2) 插入 media_assets（private）
      const { error: ae } = await sb.from('media_assets').insert({
        id: assetId, bucket: PRIVATE_BUCKET, original_path: path,
        original_width: null, original_height: null, format, created_at: new Date().toISOString(),
      });
      if (ae) throw new Error(`media_assets 写入失败：${ae.message}`);
      // 3) 关联父记录（封面 / 图 / 页 / 证书）：由 linkFn 完成
      if (linkFn) await linkFn(assetId);
      // 4) 是否自动发布（仅证书；作品保持草稿，由显式 publishWork 发布）
      if (autoPublish) {
        await this._publishAsset(assetId, parentType, parentId);
      }
    } catch (e) {
      // 回滚：删除刚上传的 Storage 对象（避免悬空引用）+ 已插入 media_assets 行（避免 DB 孤儿）
      try { await sb.storage.from(PRIVATE_BUCKET).remove([path]); } catch (_) { /* 回滚尽力而为 */ }
      try { await sb.from('media_assets').delete().eq('id', assetId); } catch (_) { /* 回滚尽力而为 */ }
      throw e;
    }

    const finalBucket = autoPublish ? PUBLIC_BUCKET : PRIVATE_BUCKET;
    const url = this._publicUrl(finalBucket, path);
    return { assetId, key: path, url, bucket: finalBucket, format };
  }

  /** C3：上传并替换作品封面（repaint works.cover_asset_id；旧资产 + Storage 文件保留） */
  async uploadWorkCover(workId, file) {
    const sb = await this._requireWritableClient();
    const res = await this._uploadAndLink(file, {
      parentType: 'work', parentId: workId,
      linkFn: async (assetId) => {
        const { error } = await sb.from('works').update({ cover_asset_id: assetId }).eq('id', workId);
        if (error) throw new Error(`作品封面关联失败：${error.message}`);
      },
    });
    return this.getById(workId);
  }

  /** C3：新增作品多图（追加到 work_images，sort_order = 当前最大 + 1） */
  async addWorkImage(workId, file) {
    const sb = await this._requireWritableClient();
    const res = await this._uploadAndLink(file, {
      parentType: 'work', parentId: workId,
      linkFn: async (assetId) => {
        const { data: imgs, error: qe } = await sb.from('work_images').select('sort_order').eq('work_id', workId);
        if (qe) throw new Error(`作品图片读取失败：${qe.message}`);
        const maxSo = (imgs || []).reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
        const { error } = await sb.from('work_images').insert({
          id: `wi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          work_id: workId, media_asset_id: assetId, sort_order: maxSo + 1, alt_text: null,
        });
        if (error) throw new Error(`作品图片关联失败：${error.message}`);
      },
    });
    return this.getById(workId);
  }

  /** C3：调整作品多图顺序（单次批量 upsert，原子；无半成功）。@param orderedSrcs 目标顺序的公开 URL 数组（与 Work.images 对齐） */
  async adjustImageSort(workId, orderedSrcs) {
    const sb = await this._requireWritableClient();
    // 读取当前 work_images + 关联媒体，构建 公开URL → work_images.id 映射
    const { data: rows, error: rerr } = await sb
      .from('work_images')
      .select('id, sort_order, media_asset_id')
      .eq('work_id', workId);
    if (rerr) throw new Error(`作品图片读取失败：${rerr.message}`);
    const assetIds = (rows || []).map((r) => r.media_asset_id).filter(Boolean);
    const mediaMap = await this._resolveMedia(assetIds);
    const urlToId = new Map();
    for (const r of (rows || [])) {
      const url = this._assetDisplayUrl(mediaMap.get(r.media_asset_id));
      if (url) urlToId.set(url, r.id);
    }
    const orderedIds = [];
    for (const src of orderedSrcs) {
      const id = urlToId.get(src);
      if (!id) throw new Error('作品图片重排失败：存在未知图片（URL 无匹配）');
      orderedIds.push(id);
    }
    if (orderedIds.length !== (rows || []).length) throw new Error('作品图片重排失败：顺序长度与现有图片数不一致');
    const batch = orderedIds.map((id, i) => ({ id, work_id: workId, sort_order: i + 1 }));
    const { error } = await sb.from('work_images').upsert(batch);
    if (error) throw new Error(`作品图片重排失败：${error.message}`);
    return this.getById(workId);
  }

  /**
   * C3：新增漫画页（实化，原 C2 为禁用 stub）。
   * page_number = 当前最大 + 1（真实页码），sort_order 同 page_number；
   * 二者均随新增单调递增，重排仅改 sort_order（见 reorderComicPages），page_number 永久不变。
   */
  async addComicPage(comicId, file) {
    const sb = await this._requireWritableClient();
    const res = await this._uploadAndLink(file, {
      parentType: 'work', parentId: comicId,
      linkFn: async (assetId) => {
        const { data: pages, error: qe } = await sb.from('comic_pages').select('page_number').eq('work_id', comicId);
        if (qe) throw new Error(`漫画页读取失败：${qe.message}`);
        const maxPn = (pages || []).reduce((m, p) => Math.max(m, p.page_number || 0), 0);
        const pageNumber = maxPn + 1;
        const { error } = await sb.from('comic_pages').insert({
          id: `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          work_id: comicId, media_asset_id: assetId, page_number: pageNumber, sort_order: pageNumber,
        });
        if (error) throw new Error(`漫画页新增失败：${error.message}`);
      },
    });
    return this.getById(comicId);
  }

  /** C3：替换单张漫画页图片（repaint comic_pages.media_asset_id；旧资产 + Storage 文件保留，不物理删除） */
  async replaceComicPageImage(pageId, file) {
    const sb = await this._requireWritableClient();
    // 先读取该页所属 work_id（parentType='work'，parentId 用 comicId 以便 publish 翻转 works 之外不受影响）
    const { data: pageRow, error: qe } = await sb.from('comic_pages').select('id, work_id').eq('id', pageId).maybeSingle();
    if (qe) throw new Error(`漫画页读取失败：${qe.message}`);
    if (!pageRow) throw new Error('漫画页不存在');
    const comicId = pageRow.work_id;
    const res = await this._uploadAndLink(file, {
      parentType: 'work', parentId: comicId,
      linkFn: async (assetId) => {
        const { error } = await sb.from('comic_pages').update({ media_asset_id: assetId }).eq('id', pageId);
        if (error) throw new Error(`漫画页图片替换失败：${error.message}`);
      },
    });
    return this.getById(comicId);
  }

  /** C3：替换证书图片（repaint certificates.media_asset_id；旧资产 + Storage 文件保留，不物理删除；不改动结构化字段）。证书维持「替换即发布」语义（autoPublish），但补齐真实 Storage 拷贝（item 1）。 */
  async replaceCertificateImage(certId, file) {
    const sb = await this._requireWritableClient();
    const res = await this._uploadAndLink(file, {
      parentType: 'certificate', parentId: certId, autoPublish: true,
      linkFn: async (assetId) => {
        const { error } = await sb.from('certificates').update({ media_asset_id: assetId }).eq('id', certId);
        if (error) throw new Error(`证书图片替换失败：${error.message}`);
      },
    });
    return this.getById(certId);
  }

  // —— Works 发布生命周期（item 2：草稿 / 发布 / 下架）——
  // 管理员在后台显式触发；发布前媒体始终为 private（草稿），发布才搬 public + 翻 is_public。
  // 下架仅翻 is_public=false 并清理 public 拷贝（private 源保留，可重新发布）；destructive physical delete 仍禁用。

  async _gatherWorkAssets(workId, bucket) {
    const sb = await this._client();
    const assetIds = [];
    const { data: w } = await sb.from('works').select('cover_asset_id').eq('id', workId).maybeSingle();
    if (w && w.cover_asset_id) assetIds.push(w.cover_asset_id);
    const { data: imgs } = await sb.from('work_images').select('media_asset_id').eq('work_id', workId);
    (imgs || []).forEach((r) => r.media_asset_id && assetIds.push(r.media_asset_id));
    const { data: pages } = await sb.from('comic_pages').select('media_asset_id').eq('work_id', workId);
    (pages || []).forEach((r) => r.media_asset_id && assetIds.push(r.media_asset_id));
    if (!assetIds.length) return [];
    const { data: assets } = await sb.from('media_assets').select('id, bucket, original_path').in('id', [...new Set(assetIds)]);
    return (assets || []).filter((a) => a.bucket === (bucket || a.bucket));
  }

  /** 发布作品：将其全部 private 媒体拷贝到 public + 翻 canonical + works.is_public=true。任一失败回滚本尝试的 public 拷贝。 */
  async publishWork(workId) {
    const sb = await this._requireWritableClient();
    const adminChk = await sb.rpc('is_admin');
    if (!adminChk.data) throw new Error('非管理员，无发布权限');
    const privateAssets = await this._gatherWorkAssets(workId, PRIVATE_BUCKET);
    const publishedPublicPaths = [];
    try {
      for (const a of privateAssets) {
        await this._copyStoragePrivateToPublic(a.original_path);
        publishedPublicPaths.push(a.original_path);
        const pub = await sb.rpc('publish_asset', { p_asset_id: a.id, p_parent_type: 'work', p_parent_id: workId });
        if (!pub.data || pub.data.ok !== true) throw new Error(`发布资产失败：${(pub.data && pub.data.error) || 'unknown'}`);
      }
      // 显式确保 works.is_public=true（最后一个资产的 publish_asset 已置位，再次确认稳妥）
      const { error } = await sb.from('works').update({ is_public: true }).eq('id', workId);
      if (error) throw new Error(`作品发布失败：${error.message}`);
    } catch (e) {
      // 回滚本尝试创建的 public 拷贝；private 源资产保留（草稿不丢）；DB canonical 未被翻转
      for (const p of publishedPublicPaths) { try { await this._deletePublicStorage(p); } catch (_) { /* 尽力而为 */ } }
      throw e;
    }
    return this.getById(workId);
  }

  /** 下架作品：翻 works.is_public=false；逐个 unpublish_asset（bucket→private）并清理 public 拷贝（private 源保留，可重新发布）。destructive delete 仍禁用。 */
  async unpublishWork(workId) {
    const sb = await this._requireWritableClient();
    const adminChk = await sb.rpc('is_admin');
    if (!adminChk.data) throw new Error('非管理员，无下架权限');
    const publicAssets = await this._gatherWorkAssets(workId, PUBLIC_BUCKET);
    for (const a of publicAssets) {
      const un = await sb.rpc('unpublish_asset', { p_asset_id: a.id, p_parent_type: 'work', p_parent_id: workId });
      if (!un.data || un.data.ok !== true) throw new Error(`下架资产失败：${(un.data && un.data.error) || 'unknown'}`);
      // 清理 public 拷贝（保留 private 源，可重新发布）；destructive delete 仍禁用
      try { await this._deletePublicStorage(a.original_path); } catch (_) { /* 尽力而为 */ }
    }
    const { error } = await sb.from('works').update({ is_public: false }).eq('id', workId);
    if (error) throw new Error(`作品下架失败：${error.message}`);
    return this.getById(workId);
  }

  // —— C2 禁止项：以下方法保持禁用语义（不执行真实删除）——
  async remove() {
    await this._c1OrThrow();
    // C2 不开放 destructive delete：返回明确 disabled 提示，供 UI 禁用按钮并提示「将在下一阶段开放」。
    return { disabled: true, reason: '媒体删除暂不开放' };
  }
  async removeComicPage() {
    await this._c1OrThrow();
    // C3 边界：删除仍谨慎 —— 本阶段仅支持新增/替换/排序，物理删除留后续阶段。
    return { disabled: true, reason: '漫画页删除暂不开放（支持新增 / 替换 / 排序）' };
  }
  async resetDemo() {
    await this._c1OrThrow();
    // Mock 专用：Supabase 真实模式不提供重置。
    throw new Error('Supabase 真实模式不提供重置 Demo（避免污染真实数据）');
  }
}
