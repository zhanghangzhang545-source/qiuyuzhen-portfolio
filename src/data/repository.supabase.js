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
   * 提取 RPC 真实错误（P0-2：绝不把真错误吞成 unknown / 不静默回 Mock）。
   * Supabase rpc 错误结构：{ code, message, details, hint }；尽力附加以便管理员定位。
   * @returns {string} 中文前缀 + 服务端原始错误（UI 仅作提示，管理员据此排查）。
   */
  _rpcFail(rpcResult, fallbackMsg) {
    const e = rpcResult && rpcResult.error;
    if (e) {
      const parts = [];
      if (e.message) parts.push(e.message);
      if (e.details) parts.push(`详情：${e.details}`);
      if (e.hint) parts.push(`提示：${e.hint}`);
      if (e.code) parts.push(`(code: ${e.code})`);
      const msg = parts.join('；').trim();
      return msg || fallbackMsg;
    }
    return fallbackMsg;
  }

  /**
   * 管理员判定（P0-2：优先处理 rpc.error 真实错误，绝不把「权限校验失败」吞成「非管理员」）。
   * @throws 非管理员 / 会话失效 / 真实 RPC 错误
   * @returns {object} Supabase 客户端
   */
  async _requireAdmin() {
    const sb = await this._client();
    const chk = await sb.rpc('is_admin');
    if (chk.error) throw new Error(`权限校验失败：${this._rpcFail(chk, '未知权限错误')}`);
    if (!chk.data) throw new Error('非管理员，无操作权限（会话可能已失效，请重新登录）');
    return sb;
  }

  /**
   * 查询父记录当前公开状态（P0-6 / P0-21 核心）：
   * 已公开作品的媒体编辑必须继承「公开」意图（新图也发布，避免 A 端断图）；
   * 隐藏（草稿 / 未公开）作品的媒体编辑必须继承「隐藏」意图（保持 private，且不改变原公开意图）。
   * @param {'work'|'certificate'} parentType
   * @param {string} parentId
   * @returns {Promise<boolean>}
   */
  async _parentIsPublic(parentType, parentId) {
    const sb = await this._client();
    // P0-I：查询失败必须显式抛错，绝不静默返回 false（否则会把「数据库读取失败」误判成「作品未公开」）。
    let res;
    if (parentType === 'certificate') {
      res = await sb.from('certificates').select('is_public').eq('id', parentId).maybeSingle();
    } else {
      res = await sb.from('works').select('is_public').eq('id', parentId).maybeSingle();
    }
    if (res.error) throw new Error(`读取父记录公开状态失败：${res.error.message}`);
    if (!res.data) throw new Error('读取父记录公开状态失败：记录不存在（可能已被删除）');
    return !!res.data.is_public;
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
      // 后台预览专用元信息：private 草稿媒体用 signed URL 预览；public 直接走 cover。
      coverBucket: coverMedia?.bucket || null,
      coverPath: coverMedia?.originalPath || null,
      coverW,
      coverH,
      images: [],
      imagesMeta: [],
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
      sb.from('work_images').select('id, work_id, media_asset_id, sort_order, alt_text').in('work_id', ids),
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
        const pr = (pagesByWork.get(r.id) || []).sort((a, b) => ((a.sort_order || a.page_number) - (b.sort_order || b.page_number)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        w.pages = pr.map((m, i) => {
          const media = mediaMap.get(m.media_asset_id);
          return {
            id: m.id,
            order: m.sort_order || m.page_number || (i + 1),
            image: this._assetDisplayUrl(media),
            bucket: media?.bucket || null,
            path: media?.originalPath || null,
            w: media?.originalWidth || null,
            h: media?.originalHeight || null,
          };
        }).filter((p) => p.image);
      } else if (withImages) {
        const ir = (imgsByWork.get(r.id) || []).sort((a, b) => (a.sort_order - b.sort_order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        // P0-A：断言每个 work_images.id 非空且唯一（图片身份绝不再用 URL；稳定 id 是删除/排序/替换的钥匙）。
        const seenIds = new Set();
        for (const m of ir) {
          if (!m.id) throw new Error('work_images.id 缺失（hydrate 断言失败：图片身份不能为空）');
          if (seenIds.has(m.id)) throw new Error(`work_images.id 重复（hydrate 断言失败）：${m.id}`);
          seenIds.add(m.id);
        }
        const imgs = ir.map((m) => {
          const media = mediaMap.get(m.media_asset_id);
          return {
            id: m.id, // 稳定身份（work_images.id），P0-11：图片身份绝不再用 URL
            assetId: m.media_asset_id || null,
            sortOrder: m.sort_order || 0,
            url: this._assetDisplayUrl(media),
            bucket: media?.bucket || null,
            path: media?.originalPath || null,
          };
        }).filter((x) => x.url);
        w.images = imgs.map((x) => x.url);
        w.imagesMeta = imgs;
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
        // P0-20：证书结构化字段完整映射（year_start/year_end/category → yearStart/yearEnd/category）
        yearStart: c.year_start == null ? null : c.year_start,
        yearEnd: c.year_end == null ? null : c.year_end,
        category: c.category || '',
        stage: '',
        tags: ['证书'],
        date: '',
        sort: c.sort_order || 0,
        public: c.is_public !== false,
        featured: false,
        cover: this._assetDisplayUrl(m),
        coverBucket: m?.bucket || null,
        coverPath: m?.originalPath || null,
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
    // P0-B：upsert 必须保留完整字段（id / work_id / media_asset_id / page_number / sort_order），
    //        仅 sort_order 改变，media_asset_id / page_number 绝不变、绝不缺字段。
    //        单次 upsert(数组) 一次性提交（单个 HTTP 请求：要么整批成功，要么整批失败，避免半成功）。
    const { data: rows, error: rerr } = await sb
      .from('comic_pages')
      .select('id, media_asset_id, page_number, sort_order')
      .eq('work_id', comicId);
    if (rerr) throw new Error(`漫画页读取失败：${rerr.message}`);
    const byId = new Map((rows || []).map((r) => [r.id, r]));
    // 校验目标顺序集与现有集一致（防止传入非法 id 导致丢失页）
    const missing = orderedIds.filter((id) => !byId.has(id));
    if (missing.length) throw new Error(`漫画页重排失败：存在未知页 ID（${missing.join(', ')}）`);
    if (orderedIds.length !== byId.size) throw new Error('漫画页重排失败：顺序长度与现有页数不一致');
    const batch = orderedIds.map((id, i) => ({
      id,
      work_id: comicId,
      media_asset_id: byId.get(id).media_asset_id, // P0-B：保留 NOT NULL 字段，绝不残缺
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

  // —— Storage canonical copy（private ↔ public），严格遵循线上 RPC 契约的路径前缀 ——
  // 线上 publish_asset / unpublish_asset 强制校验路径前缀：
  //   公开路径必须以 works/<type>/ | works/comic/ | certificates/ | avatars/ 开头；
  //   staging（草稿）路径必须以 staging/works/<type>/ | staging/comic/ | staging/certificates/ | staging/avatars/ 开头。
  // 因此拷贝时必须显式把「当前位置」映射到「目标 canonical 前缀路径」（basename 保持不变），
  // 绝不沿用 flat key 直接穿堂，否则 RPC 会 RAISE 前缀校验错误（PGRST / 自定义 EXCEPTION）。
  _baseName(p) {
    if (!p) return '';
    const i = p.lastIndexOf('/');
    return i >= 0 ? p.slice(i + 1) : p;
  }

  // 根据父记录类型推导公开 canonical 前缀（与 RPC 内部 v_prefix 完全一致）
  async _parentPublishPrefix(parentType, parentId) {
    if (parentType === 'certificate') return 'certificates/';
    if (parentType === 'avatar') return 'avatars/';
    const sb = await this._client();
    const { data, error } = await sb.from('works').select('type').eq('id', parentId).maybeSingle();
    if (error) throw new Error(`读取作品类型失败：${error.message}`);
    const type = (data && data.type) || '';
    if (type === 'comic') return 'works/comic/';
    return `works/${type}/`;
  }

  // P0-D：发布/下架时必须真实搬运每个 variant 的 Storage 对象（不只 original）。
  // 读取资产全部真实 variants，按其当前 bucket/path 逐个拷贝到目标 canonical 前缀路径，
  // 并校验目标真实存在；返回 RPC 所需的 variant_paths（[{variant_id, path}]）。
  // staging=false → 目标 portfolio-public（canonical 前缀）；staging=true → 目标 portfolio-private（staging/ 前缀）。
  // 若某个 variant 当前已在目标 bucket，则跳过拷贝（幂等），但路径仍如实回传（绝不伪造/省略）。
  // 任一 variant 文件不存在 → 拷贝抛错，绝不让 RPC 把 DB 指向不存在的文件。
  async _copyAssetVariants(assetId, parentType, parentId, { staging = false, createdPaths = null } = {}) {
    const sb = await this._client();
    const { data: variants, error } = await sb.from('media_variants').select('id, bucket, variant_path').eq('asset_id', assetId);
    if (error) throw new Error(`读取 variants 失败：${error.message}`);
    const prefix = await this._parentPublishPrefix(parentType, parentId);
    const dstBucket = staging ? PRIVATE_BUCKET : PUBLIC_BUCKET;
    const dstBase = staging ? `staging/${prefix}` : prefix;
    const out = [];
    for (const v of (variants || [])) {
      const dstPath = `${dstBase}${this._baseName(v.variant_path)}`;
      if (v.bucket !== dstBucket) {
        // 真实下载 src → 上传 dst，并校验目标对象真实存在（P0-D 硬性要求）
        await this._copyStorageObject(v.bucket, v.variant_path, dstBucket, dstPath);
        // P0-三：记录本轮真实新建的 Storage 路径，供自身失败清理
        if (createdPaths) createdPaths.push(dstPath);
      }
      out.push({ variant_id: v.id, path: dstPath });
    }
    return out;
  }

  // 通用 Storage 对象拷贝（下载 src → 上传 dst，upsert 覆盖），并校验目标真实存在
  async _copyStorageObject(srcBucket, srcPath, dstBucket, dstPath) {
    const sb = await this._client();
    const { data: dl, error: dlErr } = await sb.storage.from(srcBucket).download(srcPath);
    if (dlErr || !dl) throw new Error(`读取对象失败（${srcBucket}/${srcPath}）：${dlErr ? dlErr.message : 'empty'}`);
    const { error: upErr } = await sb.storage.from(dstBucket).upload(dstPath, dl, {
      cacheControl: '3600',
      upsert: true,
      contentType: (dl && dl.type) || 'application/octet-stream',
    });
    if (upErr) throw new Error(`拷贝对象失败（${srcBucket}/${srcPath} → ${dstBucket}/${dstPath}）：${upErr.message}`);
    const ok = await this._objectExists(dstBucket, dstPath);
    if (!ok) throw new Error(`对象校验失败：拷贝后不可读（${dstBucket}/${dstPath}）`);
    return this._publicUrl(dstBucket, dstPath);
  }

  // 列举某个 bucket 下的对象（支持嵌套目录前缀），校验目标对象真实存在
  async _objectExists(bucket, path) {
    const sb = await this._client();
    const i = path.lastIndexOf('/');
    const dir = i >= 0 ? path.slice(0, i) : '';
    const name = i >= 0 ? path.slice(i + 1) : path;
    const { data, error } = await sb.storage.from(bucket).list(dir || '', { limit: 1000 });
    if (error) throw new Error(`对象列举失败（${bucket}/${dir || ''}）：${error.message}`);
    return (data || []).some((o) => o.name === name);
  }

  async _deleteStorage(bucket, path) {
    const sb = await this._client();
    const { error } = await sb.storage.from(bucket).remove([path]);
    if (error) throw new Error(`对象清理失败（${bucket}/${path}）：${error.message}`);
    return true;
  }

  // 兼容旧引用：删除公开对象
  async _deletePublicStorage(path) {
    return this._deleteStorage(PUBLIC_BUCKET, path);
  }

  // —— 单资产发布/下架核心（P0-D：copy original + 全部 variants；P0-E/F：返回可补偿信息）——
  // 发布单个资产：真实 Storage 拷贝（private→public 到 canonical 前缀路径）+ 全部 variant 拷贝
  // + publish_asset canonical flip。按线上 RPC 真实签名传齐 5 参数；路径全部来源于真实数据。
  // 返回本轮使用的 public 路径（供失败补偿反向恢复 DB canonical + Storage）。
  async _publishOneAsset(assetId, parentType, parentId) {
    const sb = await this._requireAdmin();
    const { data: a, error: ae } = await sb.from('media_assets').select('original_path, bucket').eq('id', assetId).maybeSingle();
    if (ae) throw new Error(`读取资产失败：${ae.message}`);
    if (!a) throw new Error('发布资产失败：资产不存在');
    const prefix = await this._parentPublishPrefix(parentType, parentId);
    // 1) original：private → public canonical 前缀路径（已 public 则跳过拷贝，沿用其 public path）
    let publicOriginalPath = a.original_path;
    const createdPublic = []; // P0-三：本轮刚在 PUBLIC 创建的 Storage 路径
    try {
      if (a.bucket === PRIVATE_BUCKET) {
        publicOriginalPath = `${prefix}${this._baseName(a.original_path)}`;
        await this._copyStorageObject(PRIVATE_BUCKET, a.original_path, PUBLIC_BUCKET, publicOriginalPath);
        createdPublic.push(publicOriginalPath);
      } else if (a.bucket !== PUBLIC_BUCKET) {
        throw new Error(`发布资产失败：未知 bucket（${a.bucket}）`);
      }
      // 2) variants：private → public（P0-D 真实搬运，不止 original）
      const publicVariantPaths = await this._copyAssetVariants(assetId, parentType, parentId, { staging: false, createdPaths: createdPublic });
      // 3) RPC canonical flip（error-first）
      const pub = await sb.rpc('publish_asset', {
        p_asset_id: assetId,
        p_parent_type: parentType,
        p_parent_id: parentId,
        p_public_original_path: publicOriginalPath,
        p_variant_paths: publicVariantPaths,
      });
      if (pub.error) throw new Error(`发布资产失败（服务端）：${this._rpcFail(pub, '发布资产失败（服务端未返回明细）')}`);
      if (!pub.data || pub.data.ok !== true) throw new Error(`发布资产失败：${(pub.data && pub.data.error) || '发布资产失败（服务端未返回明细）'}`);
      return { assetId, parentType, parentId, publicOriginalPath, publicVariantPaths };
    } catch (e) {
      // P0-三：自身失败必须清理本轮刚创建的 PUBLIC Storage（DB canonical 仍 private，未被切走，不得外留孤儿）
      for (const p of createdPublic) { try { await this._deleteStorage(PUBLIC_BUCKET, p); } catch (_) { /* 清理尽力 */ } }
      throw e;
    }
  }

  // 下架单个资产（public → private staging）：真实拷贝 original + 全部 variants 到 staging，
  // 再 unpublish_asset canonical flip。返回 public / staging 路径供补偿反向恢复。
  async _unpublishOneAsset(assetId, parentType, parentId) {
    const sb = await this._requireAdmin();
    const { data: a, error: ae } = await sb.from('media_assets').select('original_path, bucket').eq('id', assetId).maybeSingle();
    if (ae) throw new Error(`读取资产失败：${ae.message}`);
    if (!a) throw new Error('下架资产失败：资产不存在');
    const prefix = await this._parentPublishPrefix(parentType, parentId);
    const stagingOriginalPath = (a.bucket === PUBLIC_BUCKET) ? `staging/${prefix}${this._baseName(a.original_path)}` : a.original_path;
    const publicOriginalPath = (a.bucket === PUBLIC_BUCKET) ? a.original_path : null;
    const createdStaging = []; // P0-三：本轮刚在 PRIVATE staging 创建的 Storage 路径
    try {
      if (a.bucket === PUBLIC_BUCKET) {
        await this._copyStorageObject(PUBLIC_BUCKET, a.original_path, PRIVATE_BUCKET, stagingOriginalPath);
        createdStaging.push(stagingOriginalPath);
      } else if (a.bucket !== PRIVATE_BUCKET) {
        throw new Error(`下架资产失败：未知 bucket（${a.bucket}）`);
      }
      // variants：public → staging private（P0-D）
      const { data: variants, error: ve } = await sb.from('media_variants').select('id, bucket, variant_path').eq('asset_id', assetId);
      if (ve) throw new Error(`读取 variants 失败：${ve.message}`);
      const stagingVariantPaths = [];
      const publicVariantPaths = [];
      for (const v of (variants || [])) {
        const sp = `staging/${prefix}${this._baseName(v.variant_path)}`;
        if (v.bucket !== PRIVATE_BUCKET) {
          await this._copyStorageObject(v.bucket, v.variant_path, PRIVATE_BUCKET, sp);
          createdStaging.push(sp);
        }
        stagingVariantPaths.push({ variant_id: v.id, path: sp });
        publicVariantPaths.push({ variant_id: v.id, path: v.variant_path });
      }
      const un = await sb.rpc('unpublish_asset', {
        p_asset_id: assetId,
        p_parent_type: parentType,
        p_parent_id: parentId,
        p_private_original_path: stagingOriginalPath,
        p_variant_paths: stagingVariantPaths,
      });
      if (un.error) throw new Error(`下架资产失败（服务端）：${this._rpcFail(un, '下架资产失败（服务端未返回明细）')}`);
      if (!un.data || un.data.ok !== true) throw new Error(`下架资产失败：${(un.data && un.data.error) || '下架资产失败（服务端未返回明细）'}`);
      return { assetId, parentType, parentId, publicOriginalPath, publicVariantPaths, stagingOriginalPath, stagingVariantPaths };
    } catch (e) {
      // P0-三：自身失败必须清理本轮刚创建的 staging Storage（DB canonical 仍 public，未被切走，不得外留孤儿）
      for (const p of createdStaging) { try { await this._deleteStorage(PRIVATE_BUCKET, p); } catch (_) { /* 清理尽力 */ } }
      throw e;
    }
  }

  // P0-四：安全反向补偿——将一个已成功发布的资产恢复为 private staging。
  // 硬规则：DB canonical 未被确认成功切走前，绝不删除当前仍被 DB 引用的 Storage 对象。
  //   1) 先拷贝 public→staging（创建 staging 副本，逆向 RPC 成功前不引用）
  //   2) 调用 unpublish_asset（ownership 合法，资产已关联）；成功→DB canonical 切回 staging→safe 删 public
  //   3) 逆向 RPC 失败→保留 public 对象不删、清理本次 orphan staging、返回明确 {ok:false, errors}
  // 返回 {ok, errors, restoredAssets}；绝不假装恢复成功。
  async _reversePublish(one) {
    const errors = [];
    const restoredAssets = [];
    const sb = await this._client();
    try {
      const stagingOriginalPath = `staging/${one.publicOriginalPath}`;
      const stagingVariantPaths = (one.publicVariantPaths || []).map((vp) => ({ variant_id: vp.variant_id, path: `staging/${vp.path}` }));
      let copiesOk = true;
      try { await this._copyStorageObject(PUBLIC_BUCKET, one.publicOriginalPath, PRIVATE_BUCKET, stagingOriginalPath); }
      catch (e) { errors.push(`staging original 拷贝失败：${e.message}`); copiesOk = false; }
      for (const vp of (one.publicVariantPaths || [])) {
        try { await this._copyStorageObject(PUBLIC_BUCKET, vp.path, PRIVATE_BUCKET, `staging/${vp.path}`); }
        catch (e) { errors.push(`staging variant 拷贝失败：${e.message}`); copiesOk = false; }
      }
      if (!copiesOk) {
        // 无法创建 staging 副本 → 不能安全翻转；保留 public（仍被引用），不删任何对象
        return { ok: false, errors, restoredAssets };
      }
      const res = await sb.rpc('unpublish_asset', {
        p_asset_id: one.assetId, p_parent_type: one.parentType, p_parent_id: one.parentId,
        p_private_original_path: stagingOriginalPath, p_variant_paths: stagingVariantPaths,
      });
      if (res.error || !res.data || res.data.ok !== true) {
        errors.push(`unpublish_asset 逆向失败：${this._rpcFail(res, '逆向发布失败（服务端未返回明细）')}`);
        // DB canonical 仍 public → 保留 public；仅清理本次刚创建的 orphan staging 副本
        try { await this._deleteStorage(PRIVATE_BUCKET, stagingOriginalPath); } catch (_) { /* 尽力 */ }
        for (const vp of stagingVariantPaths) try { await this._deleteStorage(PRIVATE_BUCKET, vp.path); } catch (_) { /* 尽力 */ }
        return { ok: false, errors, restoredAssets };
      }
      // RPC 成功 → DB canonical 已 staging → public 不再被引用，安全删除
      restoredAssets.push(one.assetId);
      try { await this._deleteStorage(PUBLIC_BUCKET, one.publicOriginalPath); } catch (e) { errors.push(`清理 public original 失败：${e.message}`); }
      for (const vp of (one.publicVariantPaths || [])) {
        try { await this._deleteStorage(PUBLIC_BUCKET, vp.path); } catch (e) { errors.push(`清理 public variant 失败：${e.message}`); }
      }
      return { ok: true, errors, restoredAssets };
    } catch (e) {
      errors.push(`_reversePublish 异常：${e.message}`);
      return { ok: false, errors, restoredAssets };
    }
  }

  // P0-四：安全反向补偿——将一个已成功下架的资产恢复为 public。
  //   1) 拷贝 staging→public（创建 public 副本）
  //   2) 调用 publish_asset（ownership 合法）；成功→DB canonical 切 public→safe 删 staging
  //   3) 逆向 RPC 失败→保留 private staging（仍被引用）、不删 staging、不制造 DB→不存在对象；返回 {ok:false}
  // 返回 {ok, errors, restoredAssets}；绝不假装恢复成功。
  async _reverseUnpublish(one) {
    const errors = [];
    const restoredAssets = [];
    const sb = await this._client();
    try {
      const publicOriginalPath = one.publicOriginalPath || `${await this._parentPublishPrefix(one.parentType, one.parentId)}${this._baseName(one.stagingOriginalPath)}`;
      const publicVariantPaths = (one.stagingVariantPaths || []).map((sv) => ({
        variant_id: sv.variant_id,
        path: sv.path.startsWith('staging/') ? sv.path.slice('staging/'.length) : sv.path,
      }));
      let copiesOk = true;
      try { await this._copyStorageObject(PRIVATE_BUCKET, one.stagingOriginalPath, PUBLIC_BUCKET, publicOriginalPath); }
      catch (e) { errors.push(`public original 拷贝失败：${e.message}`); copiesOk = false; }
      for (const sv of (one.stagingVariantPaths || [])) {
        const pp = sv.path.startsWith('staging/') ? sv.path.slice('staging/'.length) : sv.path;
        try { await this._copyStorageObject(PRIVATE_BUCKET, sv.path, PUBLIC_BUCKET, pp); }
        catch (e) { errors.push(`public variant 拷贝失败：${e.message}`); copiesOk = false; }
      }
      if (!copiesOk) {
        return { ok: false, errors, restoredAssets };
      }
      const res = await sb.rpc('publish_asset', {
        p_asset_id: one.assetId, p_parent_type: one.parentType, p_parent_id: one.parentId,
        p_public_original_path: publicOriginalPath, p_variant_paths: publicVariantPaths,
      });
      if (res.error || !res.data || res.data.ok !== true) {
        errors.push(`publish_asset 逆向失败：${this._rpcFail(res, '逆向下架失败（服务端未返回明细）')}`);
        // DB canonical 仍 private staging → 保留 staging，不删；仅清理本次 orphan public 副本
        try { await this._deleteStorage(PUBLIC_BUCKET, publicOriginalPath); } catch (_) { /* 尽力 */ }
        for (const pp of publicVariantPaths) try { await this._deleteStorage(PUBLIC_BUCKET, pp.path); } catch (_) { /* 尽力 */ }
        return { ok: false, errors, restoredAssets };
      }
      restoredAssets.push(one.assetId);
      try { await this._deleteStorage(PRIVATE_BUCKET, one.stagingOriginalPath); } catch (e) { errors.push(`清理 staging original 失败：${e.message}`); }
      for (const sv of (one.stagingVariantPaths || [])) {
        try { await this._deleteStorage(PRIVATE_BUCKET, sv.path); } catch (e) { errors.push(`清理 staging variant 失败：${e.message}`); }
      }
      return { ok: true, errors, restoredAssets };
    } catch (e) {
      errors.push(`_reverseUnpublish 异常：${e.message}`);
      return { ok: false, errors, restoredAssets };
    }
  }

  /**
   * 通用上传+登记+回滚流程（C3 媒体写入原子骨架，FINAL15 硬化）。
   * 步骤：校验 → 管理员判定 → 上传 private → 插入 media_assets(private)
   *   → [autoPublish? 先「预发布」新媒体自身（prepare_asset_public：真实 Storage 拷贝 original+全部 variants + 翻 asset 自身 bucket；不要求已被 parent 引用，规避与正式 publish_asset 的 ownership 契约冲突），再 linkFn 切换父 FK]
   *   → [否则先 linkFn 关联父记录（草稿 private，A 不可见，无断图窗口）]
   * P0-H（公开作品编辑安全状态机）：autoPublish 时「先完整发布新媒体、最后才切换父 FK」，
   *   杜绝 is_public=true 但 FK 指向 private 资产的瞬时断图窗口；A 端任何时刻读到的都是已 public 资产。
   * P0-G（替换失败恢复父引用）：linkFn(assetId, ctx) 在改变父记录前把「修改前旧引用」注册进
   *   ctx.rollbacks；任一环节（含 autoPublish 后 linkFn）失败 → 先回放 rollbacks 恢复旧 FK，
   *   再清理本次新资产（回滚 public orphan → 删 Storage + media_assets 行）。替换 B 失败必须仍是 A B C。
   * @returns {Promise<{assetId:string,key:string,url:string,bucket:string,format:string}>}
   */
  // P0-一：未关联资产「预发布」——上传后、切换父 FK 前，先把新媒体自身翻成 public（不要求已被 parent 引用）。
  // 与 _publishOneAsset 同形但调用 prepare_asset_public（无 ownership 守卫），供 _uploadAndLink(autoPublish) 使用，
  // 彻底解决「先 publish 后 link」与正式 publish_asset ownership 契约冲突（禁止删 ownership 校验来省事）。
  // 返回本轮使用的 public canonical 路径（供失败回滚 / 返回真实 URL）。
  async _prepareOneAssetPublic(assetId, parentType, parentId) {
    const sb = await this._requireAdmin();
    const { data: a, error: ae } = await sb.from('media_assets').select('original_path, bucket').eq('id', assetId).maybeSingle();
    if (ae) throw new Error(`读取资产失败：${ae.message}`);
    if (!a) throw new Error('预发布资产失败：资产不存在');
    const prefix = await this._parentPublishPrefix(parentType, parentId);
    let publicOriginalPath = a.original_path;
    const createdPublic = []; // P0-三：本轮刚在 PUBLIC 创建的 Storage 路径
    try {
      if (a.bucket === PRIVATE_BUCKET) {
        publicOriginalPath = `${prefix}${this._baseName(a.original_path)}`;
        await this._copyStorageObject(PRIVATE_BUCKET, a.original_path, PUBLIC_BUCKET, publicOriginalPath);
        createdPublic.push(publicOriginalPath);
      } else if (a.bucket !== PUBLIC_BUCKET) {
        throw new Error(`预发布资产失败：未知 bucket（${a.bucket}）`);
      }
      const publicVariantPaths = await this._copyAssetVariants(assetId, parentType, parentId, { staging: false, createdPaths: createdPublic });
      const prep = await sb.rpc('prepare_asset_public', {
        p_asset_id: assetId,
        p_parent_type: parentType,
        p_parent_id: parentId,
        p_public_original_path: publicOriginalPath,
        p_variant_paths: publicVariantPaths,
      });
      if (prep.error) throw new Error(`预发布资产失败（服务端）：${this._rpcFail(prep, '预发布资产失败（服务端未返回明细）')}`);
      if (!prep.data || prep.data.ok !== true) throw new Error(`预发布资产失败：${(prep.data && prep.data.error) || '预发布资产失败（服务端未返回明细）'}`);
      return { assetId, parentType, parentId, publicOriginalPath, publicVariantPaths };
    } catch (e) {
      // P0-三：自身失败清理本轮 public Storage（DB canonical 仍 private，未切走）
      for (const p of createdPublic) { try { await this._deleteStorage(PUBLIC_BUCKET, p); } catch (_) { /* 清理尽力 */ } }
      throw e;
    }
  }

  // P0-一 / P0-四：回滚一个已「预发布」的资产（_uploadAndLink 的 linkFn 失败时使用）。
  // 调用 prepare_asset_private 把资产自身翻回 private staging，再删除其 public Storage 副本；
  // 硬规则：prepare_asset_private 成功（DB canonical 已切回 private）前，绝不删 public（仍被引用）。
  // 返回 {ok, errors}（restoredAssets 在此语义下为被翻回 private 的资产）。
  async _rollbackPreparedAsset(one) {
    const errors = [];
    const restoredAssets = [];
    const sb = await this._client();
    try {
      const stagingOriginalPath = `staging/${one.publicOriginalPath}`;
      const stagingVariantPaths = (one.publicVariantPaths || []).map((vp) => ({ variant_id: vp.variant_id, path: `staging/${vp.path}` }));
      let copiesOk = true;
      try { await this._copyStorageObject(PUBLIC_BUCKET, one.publicOriginalPath, PRIVATE_BUCKET, stagingOriginalPath); }
      catch (e) { errors.push(`staging original 拷贝失败：${e.message}`); copiesOk = false; }
      for (const vp of (one.publicVariantPaths || [])) {
        try { await this._copyStorageObject(PUBLIC_BUCKET, vp.path, PRIVATE_BUCKET, `staging/${vp.path}`); }
        catch (e) { errors.push(`staging variant 拷贝失败：${e.message}`); copiesOk = false; }
      }
      if (!copiesOk) return { ok: false, errors, restoredAssets };
      const res = await sb.rpc('prepare_asset_private', {
        p_asset_id: one.assetId, p_parent_type: one.parentType, p_parent_id: one.parentId,
        p_private_original_path: stagingOriginalPath, p_variant_paths: stagingVariantPaths,
      });
      if (res.error || !res.data || res.data.ok !== true) {
        errors.push(`prepare_asset_private 回滚失败：${this._rpcFail(res, '预发布回滚失败（服务端未返回明细）')}`);
        // DB canonical 仍 public → 保留 public；清理本次 orphan staging
        try { await this._deleteStorage(PRIVATE_BUCKET, stagingOriginalPath); } catch (_) { /* 尽力 */ }
        for (const vp of stagingVariantPaths) try { await this._deleteStorage(PRIVATE_BUCKET, vp.path); } catch (_) { /* 尽力 */ }
        return { ok: false, errors, restoredAssets };
      }
      // RPC 成功 → DB canonical 已 private staging → public 不再被引用，安全删除
      restoredAssets.push(one.assetId);
      try { await this._deleteStorage(PUBLIC_BUCKET, one.publicOriginalPath); } catch (e) { errors.push(`清理 public original 失败：${e.message}`); }
      for (const vp of (one.publicVariantPaths || [])) {
        try { await this._deleteStorage(PUBLIC_BUCKET, vp.path); } catch (e) { errors.push(`清理 public variant 失败：${e.message}`); }
      }
      return { ok: true, errors, restoredAssets };
    } catch (e) {
      errors.push(`_rollbackPreparedAsset 异常：${e.message}`);
      return { ok: false, errors, restoredAssets };
    }
  }

  async _uploadAndLink(file, { parentType, parentId, linkFn, autoPublish = false }) {
    this._validateUploadFile(file);
    const sb = await this._requireWritableClient();
    await this._requireAdmin();

    const format = this._formatFromMime(file.type);
    const safeName = String(file.name || 'file').replace(/[^\w.\-]+/g, '_');
    const key = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
    const assetId = this._genAssetId(parentType, parentId);

    // 1) 上传到 portfolio-private（未审核资产不进 public）
    const up = await sb.storage.from(PRIVATE_BUCKET).upload(key, file, { cacheControl: '3600', upsert: false });
    if (up.error) throw new Error(`Storage 上传失败：${up.error.message}`);
    const path = (up.data && up.data.path) || key;

    const ctx = { rollbacks: [] };
    let prepared = false;
    let preparedOne = null;
    try {
      // 2) 插入 media_assets（private）
      const { error: ae } = await sb.from('media_assets').insert({
        id: assetId, bucket: PRIVATE_BUCKET, original_path: path,
        original_width: null, original_height: null, format, created_at: new Date().toISOString(),
      });
      if (ae) throw new Error(`media_assets 写入失败：${ae.message}`);
      // 3) P0-一：公开作品编辑——先「预发布」新媒体（public Storage + canonical，不要求已关联），再切换父 FK。
      //    草稿作品（autoPublish=false）A 不可见，直接 link 即可，无窗口问题。
      if (autoPublish) {
        preparedOne = await this._prepareOneAssetPublic(assetId, parentType, parentId);
        prepared = true;
      }
      // 4) 关联/切换父记录：linkFn 在改动前把旧引用注册进 ctx.rollbacks（P0-G）
      if (linkFn) await linkFn(assetId, ctx);
      // P0-一 recommended step 4：验证资产已真正公开（DB canonical + Storage 均正常）
      if (autoPublish && preparedOne) {
        const { data: va, error: vae } = await sb.from('media_assets').select('bucket, original_path').eq('id', assetId).maybeSingle();
        if (vae) throw new Error(`预发布校验失败：${vae.message}`);
        if (!va || va.bucket !== PUBLIC_BUCKET) throw new Error('预发布校验失败：资产未进入 public bucket');
        const okPub = await this._objectExists(PUBLIC_BUCKET, preparedOne.publicOriginalPath);
        if (!okPub) throw new Error('预发布校验失败：public Storage 对象不存在');
      }
    } catch (e) {
      // P0-G：先回放 rollbacks 恢复「修改前父引用状态」（A B C 不变），再清理本次新资产。
      for (const rb of (ctx.rollbacks || []).reverse()) { try { await rb(); } catch (_) { /* 尽力 */ } }
      let preserveForManual = false;
      if (prepared && preparedOne) {
        // 已预发布的 orphan 资产：回滚为 private + 清理 public 副本（DB 仍引用则保留，绝不假装成功）
        const rbRes = await this._rollbackPreparedAsset(preparedOne);
        if (rbRes.ok) {
          // 清理 staging 副本（media_assets 行随后删除，副本失引用）
          try { await this._deleteStorage(PRIVATE_BUCKET, `staging/${preparedOne.publicOriginalPath}`); } catch (_) { /* 尽力 */ }
          for (const vp of (preparedOne.publicVariantPaths || [])) try { await this._deleteStorage(PRIVATE_BUCKET, `staging/${vp.path}`); } catch (_) { /* 尽力 */ }
        } else {
          // 回滚失败：资产可能仍 public orphan → 保留 media_assets 行（及 public 副本）供人工恢复
          preserveForManual = true;
        }
      }
      // 原始 private 上传始终已失引用 → 清理
      try { await sb.storage.from(PRIVATE_BUCKET).remove([path]); } catch (_) { /* 回滚尽力而为 */ }
      if (!preserveForManual) {
        try { await sb.from('media_assets').delete().eq('id', assetId); } catch (_) { /* 回滚尽力而为 */ }
      }
      if (preserveForManual) {
        throw new Error(`操作未完成，系统已保留数据，请停止继续操作并联系维护人员。（预发布回滚未完成：${(preparedOne && preparedOne.publicOriginalPath) || ''}）原始错误：${e.message}`);
      }
      throw e;
    }

    // P0-十：autoPublish 返回真实 canonical public path（非 private key）
    const finalBucket = autoPublish ? PUBLIC_BUCKET : PRIVATE_BUCKET;
    const finalPath = autoPublish && preparedOne ? preparedOne.publicOriginalPath : path;
    const url = this._publicUrl(finalBucket, finalPath);
    return { assetId, key: path, url, bucket: finalBucket, format };
  }

  /** C3：上传并替换作品封面（repaint works.cover_asset_id；旧资产 + Storage 文件保留） */
  async uploadWorkCover(workId, file) {
    const sb = await this._requireWritableClient();
    // P0-6：若作品已公开，新封面也一并发布（避免 A 端断图）；草稿则保持 private。
    const autoPublish = await this._parentIsPublic('work', workId);
    const res = await this._uploadAndLink(file, {
      parentType: 'work', parentId: workId, autoPublish,
      linkFn: async (assetId, ctx) => {
        // P0-G：切换前捕获旧封面引用，失败可完整恢复（替换失败仍是 A B C）
        const { data: old } = await sb.from('works').select('cover_asset_id').eq('id', workId).maybeSingle();
        const oldCover = (old && old.cover_asset_id) || null;
        ctx.rollbacks.push(async () => {
          await sb.from('works').update({ cover_asset_id: oldCover }).eq('id', workId);
        });
        const { error } = await sb.from('works').update({ cover_asset_id: assetId }).eq('id', workId);
        if (error) throw new Error(`作品封面关联失败：${error.message}`);
      },
    });
    return this.getById(workId);
  }

  /** C3：新增作品多图（追加到 work_images，sort_order = 当前最大 + 1） */
  async addWorkImage(workId, file) {
    const sb = await this._requireWritableClient();
    // P0-6：继承作品公开意图。
    const autoPublish = await this._parentIsPublic('work', workId);
    const res = await this._uploadAndLink(file, {
      parentType: 'work', parentId: workId, autoPublish,
      linkFn: async (assetId, ctx) => {
        // P0-八：数据库级原子追加（append_work_image 在事务内 FOR UPDATE 锁定 work，计算 max+1 插入），
        //   杜绝 JS 端 SELECT max → +1 → INSERT 的并发相同 sort_order。
        const { data: r, error } = await sb.rpc('append_work_image', { p_work_id: workId, p_media_asset_id: assetId });
        if (error) throw new Error(`作品图片关联失败（服务端）：${this._rpcFail({ error }, '作品图片关联失败（服务端未返回明细）')}`);
        if (!r || r.ok !== true) throw new Error(`作品图片关联失败：${(r && r.error) || '作品图片关联失败（未知）'}`);
        // P0-G：新增行——失败时删除本行（恢复「未新增」状态）
        ctx.rollbacks.push(async () => {
          await sb.from('work_images').delete().eq('id', r.image_id);
        });
      },
    });
    return this.getById(workId);
  }

  /** C3：调整作品多图顺序（单次批量 upsert，原子；无半成功）。@param orderedSrcs 目标顺序的公开 URL 数组（与 Work.images 对齐） */
  async adjustImageSort(workId, orderedImageIds) {
    const sb = await this._requireWritableClient();
    // P0-11：以稳定 work_images.id 为身份（不再用 URL 匹配）。
    // P0-15：upsert 保留完整字段（id / work_id / media_asset_id / alt_text / sort_order），
    //        仅 sort_order 改变，绝不丢字段、绝不影响其它图。
    const { data: rows, error: rerr } = await sb
      .from('work_images')
      .select('id, sort_order, media_asset_id, alt_text')
      .eq('work_id', workId);
    if (rerr) throw new Error(`作品图片读取失败：${rerr.message}`);
    const byId = new Map((rows || []).map((r) => [r.id, r]));
    const missing = orderedImageIds.filter((id) => !byId.has(id));
    if (missing.length) throw new Error(`作品图片重排失败：存在未知图片 ID（${missing.join(', ')}）`);
    if (orderedImageIds.length !== byId.size) throw new Error('作品图片重排失败：顺序长度与现有图片数不一致');
    const batch = orderedImageIds.map((id, i) => ({
      id,
      work_id: workId,
      media_asset_id: byId.get(id).media_asset_id,
      alt_text: byId.get(id).alt_text,
      sort_order: i + 1,
    }));
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
    // P0-6：继承漫画公开意图（已发布漫画新增页也发布，避免阅读器断图）。
    const autoPublish = await this._parentIsPublic('work', comicId);
    const res = await this._uploadAndLink(file, {
      parentType: 'work', parentId: comicId, autoPublish,
      linkFn: async (assetId, ctx) => {
        // P0-八：数据库级原子追加（append_comic_page 在事务内 FOR UPDATE 锁定 work，计算 max+1 插入）
        const { data: r, error } = await sb.rpc('append_comic_page', { p_work_id: comicId, p_media_asset_id: assetId });
        if (error) throw new Error(`漫画页新增失败（服务端）：${this._rpcFail({ error }, '漫画页新增失败（服务端未返回明细）')}`);
        if (!r || r.ok !== true) throw new Error(`漫画页新增失败：${(r && r.error) || '漫画页新增失败（未知）'}`);
        // P0-G：新增页行——失败时删除本行，恢复「未新增」状态
        ctx.rollbacks.push(async () => {
          await sb.from('comic_pages').delete().eq('id', r.page_id);
        });
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
    // P0-6：继承漫画公开意图（已发布漫画替换页也发布，避免阅读器断图）。
    const autoPublish = await this._parentIsPublic('work', comicId);
    const res = await this._uploadAndLink(file, {
      parentType: 'work', parentId: comicId, autoPublish,
      linkFn: async (assetId, ctx) => {
        // P0-G：替换前捕获旧 media_asset_id，失败恢复原位（A B C 不变）
        const { data: old } = await sb.from('comic_pages').select('media_asset_id').eq('id', pageId).maybeSingle();
        const oldAsset = (old && old.media_asset_id) || null;
        ctx.rollbacks.push(async () => {
          await sb.from('comic_pages').update({ media_asset_id: oldAsset }).eq('id', pageId);
        });
        const { error } = await sb.from('comic_pages').update({ media_asset_id: assetId }).eq('id', pageId);
        if (error) throw new Error(`漫画页图片替换失败：${error.message}`);
      },
    });
    return this.getById(comicId);
  }

  /**
   * C3：替换单张作品多图（repaint work_images.media_asset_id；旧资产 + Storage 文件保留，不物理删除）。
   * 原位替换：保留 work_images.id 与 sort_order，仅改 media_asset_id（P0-12/13/14 位置稳定）。
   * 继承作品公开意图（P0-6 / P0-21）：已公开作品替换也发布新图，草稿保持 private。
   * @param {string} imageId work_images.id（稳定身份，非 URL；P0-11）
   * @param {File} file
   */
  async replaceWorkImage(imageId, file) {
    const sb = await this._requireWritableClient();
    // 先读该图所属 work_id 与当前公开状态
    const { data: row, error: qe } = await sb.from('work_images').select('id, work_id').eq('id', imageId).maybeSingle();
    if (qe) throw new Error(`作品图片读取失败：${qe.message}`);
    if (!row) throw new Error('作品图片不存在');
    const workId = row.work_id;
    const autoPublish = await this._parentIsPublic('work', workId);
    const res = await this._uploadAndLink(file, {
      parentType: 'work', parentId: workId, autoPublish,
      linkFn: async (assetId, ctx) => {
        // P0-G：替换前捕获旧 media_asset_id，失败恢复原位（原位替换、A B C 不变）
        const { data: old } = await sb.from('work_images').select('media_asset_id').eq('id', imageId).maybeSingle();
        const oldAsset = (old && old.media_asset_id) || null;
        ctx.rollbacks.push(async () => {
          await sb.from('work_images').update({ media_asset_id: oldAsset }).eq('id', imageId);
        });
        // 仅改 media_asset_id，保留 id / sort_order（原位替换，不动其它图顺序）
        const { error } = await sb.from('work_images').update({ media_asset_id: assetId }).eq('id', imageId);
        if (error) throw new Error(`作品图片替换失败：${error.message}`);
      },
    });
    return this.getById(workId);
  }

  /** C3：替换证书图片（repaint certificates.media_asset_id；旧资产 + Storage 文件保留，不物理删除；不改动结构化字段）。
   *  P0-21 修正：证书维持「替换即发布」语义，但必须继承证书原公开意图——已公开证书替换才发布；
   *  隐藏证书（is_public=false）替换后绝不自行公开（autoPublish = 证书当前 is_public）。 */
  async replaceCertificateImage(certId, file) {
    const sb = await this._requireWritableClient();
    const autoPublish = await this._parentIsPublic('certificate', certId);
    const res = await this._uploadAndLink(file, {
      parentType: 'certificate', parentId: certId, autoPublish,
      linkFn: async (assetId, ctx) => {
        // P0-G：替换前捕获旧 media_asset_id，失败恢复原位（证书图片不变）
        const { data: old } = await sb.from('certificates').select('media_asset_id').eq('id', certId).maybeSingle();
        const oldAsset = (old && old.media_asset_id) || null;
        ctx.rollbacks.push(async () => {
          await sb.from('certificates').update({ media_asset_id: oldAsset }).eq('id', certId);
        });
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
    const { data: w, error: we } = await sb.from('works').select('cover_asset_id').eq('id', workId).maybeSingle();
    if (we) throw new Error(`works 读取失败：${we.message}`);
    if (w && w.cover_asset_id) assetIds.push(w.cover_asset_id);
    const { data: imgs, error: ie } = await sb.from('work_images').select('media_asset_id').eq('work_id', workId);
    if (ie) throw new Error(`work_images 读取失败：${ie.message}`);
    (imgs || []).forEach((r) => r.media_asset_id && assetIds.push(r.media_asset_id));
    const { data: pages, error: pe } = await sb.from('comic_pages').select('media_asset_id').eq('work_id', workId);
    if (pe) throw new Error(`comic_pages 读取失败：${pe.message}`);
    (pages || []).forEach((r) => r.media_asset_id && assetIds.push(r.media_asset_id));
    if (!assetIds.length) return [];
    const { data: assets, error: ae } = await sb.from('media_assets').select('id, bucket, original_path').in('id', [...new Set(assetIds)]);
    if (ae) throw new Error(`media_assets 读取失败：${ae.message}`);
    return (assets || []).filter((a) => a.bucket === (bucket || a.bucket));
  }

  // P0-五：发布前最终就绪校验——所有当前引用资产均存在、original bucket=public、所有 variants bucket=public、
  //   当前 canonical Storage 对象真实存在、漫画页要求仍满足。全部通过才允许 works.is_public=true。
  async _verifyWorkPublicReadiness(workId) {
    const sb = await this._client();
    const ids = [];
    const { data: w, error: we } = await sb.from('works').select('cover_asset_id').eq('id', workId).maybeSingle();
    if (we) return { ok: false, error: `works 读取失败：${we.message}` };
    if (w && w.cover_asset_id) ids.push(w.cover_asset_id);
    const { data: imgs, error: ie } = await sb.from('work_images').select('media_asset_id').eq('work_id', workId);
    if (ie) return { ok: false, error: `work_images 读取失败：${ie.message}` };
    (imgs || []).forEach((r) => r.media_asset_id && ids.push(r.media_asset_id));
    const { data: pages, error: pe } = await sb.from('comic_pages').select('media_asset_id').eq('work_id', workId);
    if (pe) return { ok: false, error: `comic_pages 读取失败：${pe.message}` };
    (pages || []).forEach((r) => r.media_asset_id && ids.push(r.media_asset_id));
    if (!ids.length) return { ok: false, error: '作品无任何媒体资产' };
    const uniq = [...new Set(ids)];
    const { data: assets, error: ae } = await sb.from('media_assets').select('id, bucket, original_path').in('id', uniq);
    if (ae) return { ok: false, error: `media_assets 读取失败：${ae.message}` };
    for (const a of (assets || [])) {
      if (a.bucket !== PUBLIC_BUCKET) return { ok: false, error: `资产 ${a.id} 未全部公开（bucket=${a.bucket}）` };
      const exists = await this._objectExists(PUBLIC_BUCKET, a.original_path);
      if (!exists) return { ok: false, error: `资产 ${a.id} 的 public original 对象不存在（${a.original_path}）` };
      const { data: vs, error: ve } = await sb.from('media_variants').select('id, bucket, variant_path').eq('asset_id', a.id);
      if (ve) return { ok: false, error: `variants 读取失败：${ve.message}` };
      for (const v of (vs || [])) {
        if (v.bucket !== PUBLIC_BUCKET) return { ok: false, error: `资产 ${a.id} 的 variant ${v.id} 未公开（bucket=${v.bucket}）` };
        const vex = await this._objectExists(PUBLIC_BUCKET, v.variant_path);
        if (!vex) return { ok: false, error: `资产 ${a.id} 的 variant ${v.id} 的 public 对象不存在（${v.variant_path}）` };
      }
    }
    return { ok: true };
  }

  // P0-五：下架后混合 bucket 检测——防止 original private 但 variant 仍 public 的残留。
  async _verifyWorkNoMixedBucket(workId) {
    const sb = await this._client();
    const ids = [];
    const { data: w, error: we } = await sb.from('works').select('cover_asset_id').eq('id', workId).maybeSingle();
    if (we) return { ok: false, error: `works 读取失败：${we.message}` };
    if (w && w.cover_asset_id) ids.push(w.cover_asset_id);
    const { data: imgs, error: ie } = await sb.from('work_images').select('media_asset_id').eq('work_id', workId);
    if (ie) return { ok: false, error: `work_images 读取失败：${ie.message}` };
    (imgs || []).forEach((r) => r.media_asset_id && ids.push(r.media_asset_id));
    const { data: pages, error: pe } = await sb.from('comic_pages').select('media_asset_id').eq('work_id', workId);
    if (pe) return { ok: false, error: `comic_pages 读取失败：${pe.message}` };
    (pages || []).forEach((r) => r.media_asset_id && ids.push(r.media_asset_id));
    if (!ids.length) return { ok: true };
    const { data: assets, error: ae } = await sb.from('media_assets').select('id, bucket, original_path').in('id', [...new Set(ids)]);
    if (ae) return { ok: false, error: `media_assets 读取失败：${ae.message}` };
    for (const a of (assets || [])) {
      if (a.bucket !== PRIVATE_BUCKET) return { ok: false, error: `资产 ${a.id} 下架后仍非 private（bucket=${a.bucket}）` };
      const { data: vs, error: ve } = await sb.from('media_variants').select('id, bucket').eq('asset_id', a.id);
      if (ve) return { ok: false, error: `variants 读取失败：${ve.message}` };
      for (const v of (vs || [])) {
        if (v.bucket !== PRIVATE_BUCKET) return { ok: false, error: `资产 ${a.id} 的 variant ${v.id} 下架后仍 public（混合残留）` };
      }
    }
    return { ok: true };
  }

  /** 发布作品：将其全部 private 媒体拷贝到 public（original + 全部 variants）+ 翻 canonical + works.is_public=true。
   *  P0-E：多资产补偿——若任一资产发布失败，已成功的资产逐个反向恢复 DB canonical（unpublish）+ 删 public Storage，
   *        并恢复 works.is_public 到发布前状态，确保绝不出现「DB 半 public / public Storage 已删」不一致。 */
  async publishWork(workId) {
    await this._requireAdmin();
    const sb = await this._client();
    // P0-8：发布完整性检查（插画/油画至少有效封面；漫画至少封面 + 1 页，避免发布半成品导致 A 端断图/空专题）。
    const { data: wrow, error: we } = await sb.from('works').select('id, type, cover_asset_id, is_public').eq('id', workId).maybeSingle();
    if (we) throw new Error(`works 读取失败：${we.message}`);
    if (!wrow) throw new Error('发布失败：作品不存在');
    if (!wrow.cover_asset_id) throw new Error('发布失败：作品缺少封面图，请先上传封面再发布');
    if (wrow.type === 'comic') {
      const { data: pages, error: pe } = await sb.from('comic_pages').select('id').eq('work_id', workId).limit(1);
      if (pe) throw new Error(`漫画页读取失败：${pe.message}`);
      if (!pages || pages.length === 0) throw new Error('发布失败：漫画至少需要 1 页，请先添加漫画页再发布');
    }
    const wasPublic = !!wrow.is_public;
    const privateAssets = await this._gatherWorkAssets(workId, PRIVATE_BUCKET);
    const done = [];
    try {
      for (const a of privateAssets) {
        const one = await this._publishOneAsset(a.id, 'work', workId);
        done.push(one);
      }
      // P0-五：最终就绪校验（禁止无条件 works.update is_public 覆盖 RPC 真实 readiness 判断）
      const readiness = await this._verifyWorkPublicReadiness(workId);
      if (!readiness.ok) throw new Error(`发布就绪校验未通过：${readiness.error}`);
      // 仅当确为全部公开且尚未置位时稳妥置位（RPC 通常已置位，避免强覆盖 false）
      const { data: cur, error: ce } = await sb.from('works').select('is_public').eq('id', workId).maybeSingle();
      if (ce) throw new Error(`works 读取失败：${ce.message}`);
      if (cur && cur.is_public !== true) {
        const { error } = await sb.from('works').update({ is_public: true }).eq('id', workId);
        if (error) throw new Error(`作品发布失败：${error.message}`);
      }
    } catch (e) {
      // P0-四：补偿——逐个反向恢复；收集补偿结果，不完整则明确提示停止操作
      const comp = { ok: true, errors: [] };
      for (const one of done) {
        const r = await this._reversePublish(one);
        if (!r.ok) { comp.ok = false; comp.errors.push(...r.errors); }
      }
      try { await sb.from('works').update({ is_public: wasPublic }).eq('id', workId); }
      catch (err) { comp.errors.push(`恢复 is_public 失败：${err.message}`); comp.ok = false; }
      if (!comp.ok) {
        throw new Error(`发布操作未完成，系统已保留数据，请停止继续操作并联系维护人员。（补偿：${comp.errors.join('; ')}）原始错误：${e.message}`);
      }
      throw e;
    }
    return this.getById(workId);
  }

  /** 下架作品：翻 works.is_public=false；逐个 unpublish_asset（public canonical → private staging，original + 全部 variants）+ 清 public 拷贝。
   *  P0-五：下架后混合 bucket 检测（防止 original private 但 variant 仍 public 残留）。
   *  P0-四：多资产补偿——若任一资产下架失败，已成功的资产逐个反向恢复 public canonical + Storage，恢复 works.is_public 原态，
   *        绝不出现「DB 指向刚被清掉的 staging 对象」。destructive physical delete 仍禁用。 */
  async unpublishWork(workId) {
    await this._requireAdmin();
    const sb = await this._client();
    const { data: wrow, error: we } = await sb.from('works').select('id, is_public').eq('id', workId).maybeSingle();
    if (we) throw new Error(`works 读取失败：${we.message}`);
    if (!wrow) throw new Error('下架失败：作品不存在');
    const wasPublic = !!wrow.is_public;
    const publicAssets = await this._gatherWorkAssets(workId, PUBLIC_BUCKET);
    const done = [];
    try {
      for (const a of publicAssets) {
        const one = await this._unpublishOneAsset(a.id, 'work', workId);
        done.push(one);
        // 清理 public 拷贝（源已回到 staging private，public 不再引用）；含 variant 防 orphan
        try { await this._deleteStorage(PUBLIC_BUCKET, a.original_path); } catch (_) { /* 尽力而为 */ }
        for (const vp of (one.publicVariantPaths || [])) try { await this._deleteStorage(PUBLIC_BUCKET, vp.path); } catch (_) { /* 尽力而为 */ }
      }
      // P0-五：混合 bucket 检测（防止 original private 但 variant 仍 public 残留）
      const mix = await this._verifyWorkNoMixedBucket(workId);
      if (!mix.ok) throw new Error(`下架混合状态检测未通过：${mix.error}`);
      const { data: cur, error: ce } = await sb.from('works').select('is_public').eq('id', workId).maybeSingle();
      if (ce) throw new Error(`works 读取失败：${ce.message}`);
      if (cur && cur.is_public !== false) {
        const { error } = await sb.from('works').update({ is_public: false }).eq('id', workId);
        if (error) throw new Error(`作品下架失败：${error.message}`);
      }
    } catch (e) {
      const comp = { ok: true, errors: [] };
      for (const one of done) {
        const r = await this._reverseUnpublish(one);
        if (!r.ok) { comp.ok = false; comp.errors.push(...r.errors); }
      }
      try { await sb.from('works').update({ is_public: wasPublic }).eq('id', workId); }
      catch (err) { comp.errors.push(`恢复 is_public 失败：${err.message}`); comp.ok = false; }
      if (!comp.ok) {
        throw new Error(`下架操作未完成，系统已保留数据，请停止继续操作并联系维护人员。（补偿：${comp.errors.join('; ')}）原始错误：${e.message}`);
      }
      throw e;
    }
    return this.getById(workId);
  }

  // —— 真实删除（AB 模型：B 后台必须真正支持删）——
  // 安全纪律：仅删除「逻辑记录」（works / work_images / comic_pages / certificates 行），
  // 底层 Storage 文件与 media_assets 行一律保留（private + public 双份备份不物理销毁），
  // 保证：A 前台该作品立即消失（无死链/幽灵记录），但源媒体可后续手动找回。
  // 所有删除均经 is_admin() 守卫（非管理员由 Supabase 后端拒绝）。

  async remove(id) {
    const sb = await this._requireWritableClient();
    await this._requireAdmin();
    // 先查 works
    const { data: wrow, error: we } = await sb.from('works').select('id, type, is_public').eq('id', id).maybeSingle();
    if (we) throw new Error(`works 读取失败：${we.message}`);
    if (wrow) {
      // P0-4：若已公开，必须先安全下架；下架失败则 ABORT（绝不吞错后继续删除，
      // 否则公开端会残留孤儿引用 / 断图 / 仍可访问的不一致状态）。
      if (wrow.is_public) {
        await this.unpublishWork(id);
      }
      // 删关联行（work_images / comic_pages），再删 works 主记录。
      const { error: de1 } = await sb.from('work_images').delete().eq('work_id', id);
      if (de1) throw new Error(`作品图片关联删除失败：${de1.message}`);
      const { error: de2 } = await sb.from('comic_pages').delete().eq('work_id', id);
      if (de2) throw new Error(`漫画页关联删除失败：${de2.message}`);
      const { error: de3 } = await sb.from('works').delete().eq('id', id);
      if (de3) throw new Error(`作品删除失败：${de3.message}`);
      return { ok: true, id };
    }
    // 证书
    const { data: crow, error: ce } = await sb.from('certificates').select('id').eq('id', id).maybeSingle();
    if (ce) throw new Error(`certificates 读取失败：${ce.message}`);
    if (crow) {
      const { error: de } = await sb.from('certificates').delete().eq('id', id);
      if (de) throw new Error(`证书删除失败：${de.message}`);
      return { ok: true, id };
    }
    throw new Error('删除失败：未找到该作品或证书');
  }

  async removeComicPage(comicId, pageId) {
    const sb = await this._requireWritableClient();
    await this._requireAdmin();
    // P0-C：调用原子 RPC（同一事务内：校验管理员 → 校验归属 → 删除目标页 → 按删除前相对顺序
    //   连续规范化 sort_order，page_number 保持原值不变）。绝不出现其它页错位（A B C D E 删 C → A B D E）。
    const { data, error } = await sb.rpc('remove_comic_page_and_reorder', { p_work_id: comicId, p_page_id: pageId });
    if (error) throw new Error(`漫画页删除失败（服务端）：${this._rpcFail({ error }, '漫画页删除失败（服务端未返回明细）')}`);
    if (!data || !data.ok) throw new Error(`漫画页删除失败：${(data && data.error) || '漫画页删除失败（未知）'}`);
    return this.getById(comicId);
  }

  async removeWorkImage(workId, imageId) {
    const sb = await this._requireWritableClient();
    await this._requireAdmin();
    // P0-11：以稳定 work_images.id 为身份删除（不再用 URL 匹配）。
    // P0-C：调用原子 RPC（同一事务内：校验管理员 → 校验归属 → 删除目标关联 → 按删除前相对顺序
    //   连续规范化 sort_order，media_asset_id / alt_text 保持原值不变）。绝不完整 upsert、绝不其它图错位。
    const { data, error } = await sb.rpc('remove_work_image_and_reorder', { p_work_id: workId, p_image_id: imageId });
    if (error) throw new Error(`作品图片删除失败（服务端）：${this._rpcFail({ error }, '作品图片删除失败（服务端未返回明细）')}`);
    if (!data || !data.ok) throw new Error(`作品图片删除失败：${(data && data.error) || '作品图片删除失败（未知）'}`);
    return this.getById(workId);
  }

  async resetDemo() {
    await this._c1OrThrow();
    // Mock 专用：Supabase 真实模式不提供重置。
    throw new Error('Supabase 真实模式不提供重置 Demo（避免污染真实数据）');
  }
}
