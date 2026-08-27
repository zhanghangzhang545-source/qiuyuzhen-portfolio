// ============================================================
// repository.js — 作品数据仓储接口（当前为 Mock 实现）
// 后续接入正式数据库（PostgreSQL / Supabase / 自建 API 等）时，
// 仅需实现同一 WorkRepository 接口，UI 层无需改动。
// 所有方法返回 Promise，以模拟真实网络请求语义。
// ============================================================

import { buildSeed } from './seed.js';

/** 作品仓储统一接口 */
export class WorkRepository {
  async list() { throw new Error('not implemented'); }
  async getById(/* id */) { throw new Error('not implemented'); }
  async filter(/* criteria */) { throw new Error('not implemented'); }
  async create(/* work */) { throw new Error('not implemented'); }
  async update(/* id, patch */) { throw new Error('not implemented'); }
  async remove(/* id */) { throw new Error('not implemented'); }
  async addComicPage(/* comicId, image */) { throw new Error('not implemented'); }
  async removeComicPage(/* comicId, pageId */) { throw new Error('not implemented'); }
  async reorderComicPages(/* comicId, orderedIds */) { throw new Error('not implemented'); }
  async resetDemo() { throw new Error('not implemented'); }
  async uploadWorkCover(/* workId, file */) { throw new Error('not implemented'); }
  async addWorkImage(/* workId, file */) { throw new Error('not implemented'); }
  async adjustImageSort(/* workId, orderedIds */) { throw new Error('not implemented'); }
  async replaceComicPageImage(/* pageId, file */) { throw new Error('not implemented'); }
  async replaceCertificateImage(/* certId, file */) { throw new Error('not implemented'); }
}

// C1 FINAL 数据版本键：Phase 3-C1 在 Mock seed 中新增了 worksPick / worksPickOrder /
// homeFeaturedOrder 等字段。bump 到 phase3c1 以强制旧浏览器重新播种最新完整 seed，
// 避免旧缓存（phase2.v1 缺 worksPick / worksPickOrder）污染 ?mock=1 回滚模式。
const STORE_KEY = 'portfolio.works.phase3c1.v1';
// 旧版本键：base-final-3 / v2 缺 workNature 字段；phase2.v1 缺 worksPick / worksPickOrder 字段。
// 升级时必须显式清除后按最新 seed 重新播种，禁止静默复用旧缓存对象。
const LEGACY_KEYS = [
  'portfolio.works.base-final.v1',
  'portfolio.works.v2',
  'portfolio.works.phase2.v1',
];

export class MockWorkRepository extends WorkRepository {
  constructor(opts = {}) {
    super();
    // C1 冻结语义：默认 Mock 仓库为只读回滚模式，任何写操作抛「C1 只读」错误。
    // C2 通过 { writable: true } 显式解锁结构化写能力（destructive delete 仍 disabled）。
    this._writable = !!opts.writable;
    this._works = this._load();
  }

  _guardWrite() {
    if (!this._writable) throw new Error('C1 只读：当前为只读回滚模式，写操作被禁用');
  }

  _load() {
    // 优先使用 Phase 3-C1 新键
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* ignore */ }
    // 明确迁移：任何旧键（base-final-3 / v2 / phase2.v1）缓存缺新字段（workNature /
    // worksPick / worksPickOrder），禁止静默复用——直接丢弃所有旧键，重新播种最新
    // seed（含完整字段）并写入新键。
    for (const k of LEGACY_KEYS) {
      try { localStorage.removeItem(k); } catch (_) { /* ignore */ }
    }
    const seed = buildSeed();
    this._save(seed);
    return seed;
  }

  _save(works = this._works) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(works)); } catch (_) { /* ignore quota */ }
  }

  async list() { return this._clone(this._works); }

  async getById(id) {
    const w = this._works.find((x) => x.id === id);
    return w ? this._clone(w) : null;
  }

  async getByType(type) {
    return this._clone(this._works.filter((w) => w.type === type));
  }

  /**
   * 统一筛选：支持 类型 / 关键词 / 创作阶段 / 创作时间(年份) / 标签 / 精选 / 仅公开 + 排序
   * @param {{type?:string,q?:string,stage?:string,year?:string|number,tag?:string,featured?:boolean,publicOnly?:boolean,sort?:string}} criteria
   */
  async filter(criteria = {}) {
    let list = this._works.slice();
    if (criteria.type) list = list.filter((w) => w.type === criteria.type);
    if (criteria.publicOnly) list = list.filter((w) => w.public !== false);
    if (criteria.featured) list = list.filter((w) => w.featured);
    if (criteria.stage) list = list.filter((w) => w.stage === criteria.stage);
    if (criteria.year) list = list.filter((w) => String(w.year) === String(criteria.year));
    if (criteria.tag) list = list.filter((w) => (w.tags || []).includes(criteria.tag));
    if (criteria.q) {
      const q = criteria.q.trim().toLowerCase();
      if (q) list = list.filter((w) =>
        w.title.toLowerCase().includes(q) ||
        (w.intro || '').toLowerCase().includes(q) ||
        (w.tags || []).some((t) => t.toLowerCase().includes(q)));
    }
    const sort = criteria.sort || 'manual';
    const yv = (w) => (w.year == null || w.year === '') ? null : Number(w.year);
    // 自定义排序：数值越大越靠前（与 seed 权重、界面说明一致）
    const byCustom = (a, b) => (b.sort || 0) - (a.sort || 0);
    // 年份排序：有年份按年份，未知年份（null/''）统一置后；同年份按自定义排序做稳定次排序
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
    return this._clone(list);
  }

  async create(work) {
    this._guardWrite();
    // #2 严格字段校验（写前抛错，无回退；与 Supabase 语义一致）
    if (!work || typeof work !== 'object') throw new Error('create 参数必须为一个作品对象');
    if (!(work.title || '').trim()) throw new Error('title 不能为空');
    if (!['illustration', 'comic', 'oil'].includes(work.type)) {
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
    // #3 修复：生成一次业务 ID，严格不覆盖（避免 spread 后再覆盖 id 造成不一致）；
    // 真实写入 tags 数组（缺省为 []，不被 ...work 非数组覆盖）。
    const id = `w${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    // C2 发布边界（#5）：Mock 创建也强制 is_public=false（不依赖草稿勾选）
    const record = {
      id, sort: this._works.length + 1, public: false, featured: false,
      // #3 真实 tags（合法数组）
      tags: Array.isArray(work.tags) ? work.tags : [],
      // C2 字段默认（仅当 work 未显式提供时）
      homeFeaturedOrder: 0, worksPick: false, worksPickOrder: 0, displaySize: 'standard',
      workNature: work.workNature || null,
      ...work,
      // 强制覆盖：C2 新作恒不公开；type 以 work.type 为准（仅创建时可选）；id 严格锁定
      id, public: false,
    };
    if (work.isDraft === true) { record.cover = null; record.images = []; }
    this._works.unshift(record);
    this._save();
    return this._clone(record);
  }

  async update(id, patch) {
    this._guardWrite();
    // C2 发布边界（#5）：现有作品 update 不接受 public/is_public/type
    if ('public' in patch || 'is_public' in patch) {
      throw new Error('C2 禁止修改作品公开状态（正式 publish/unpublish 将在 C3 开放）');
    }
    if ('type' in patch) {
      throw new Error('C2 禁止修改作品 type（现有作品类型已冻结，仅创建时可选择）');
    }
    // #7 字段验证
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

    const w = this._works.find((x) => x.id === id);
    if (!w) throw new Error('作品不存在');
    // 仅透传合法字段（不 Object.assign 全量，避免污染不可改字段）
    if ('title' in patch) w.title = (patch.title || '').trim();
    if ('intro' in patch) w.intro = patch.intro || '';
    if ('year' in patch) w.year = patch.year == null ? null : Number(patch.year);
    if ('stage' in patch) w.stage = patch.stage || '';
    if ('workNature' in patch) w.workNature = patch.workNature || null;
    if ('sort' in patch) w.sort = Number(patch.sort || 0);
    if ('featured' in patch) w.featured = !!patch.featured;
    if ('homeFeaturedOrder' in patch) w.homeFeaturedOrder = patch.homeFeaturedOrder || 0;
    if ('worksPick' in patch) w.worksPick = !!patch.worksPick;
    if ('worksPickOrder' in patch) w.worksPickOrder = patch.worksPickOrder || 0;
    if ('displaySize' in patch) w.displaySize = patch.displaySize || 'standard';
    if ('tags' in patch) w.tags = Array.isArray(patch.tags) ? patch.tags : [];
    this._save();
    return this._clone(w);
  }

  // AB 模型：B 后台必须真正支持删除（Mock 回滚通道同样开放，便于本地完整维护）。
  // 仅删逻辑记录（_works 内的作品/页/图条目），底层媒体（Mock 内联 dataURL）随之移除；
  // 真实 Supabase 模式由 SupabaseWorkRepository 负责保留 Storage 备份。
  async remove(id) {
    this._guardWrite();
    const i = this._works.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('作品不存在');
    this._works.splice(i, 1);
    this._save();
    return { ok: true, id };
  }

  async addComicPage(/* comicId, image */) {
    this._guardWrite();
    throw new Error('C2 禁止上传漫画页：媒体写入将在 C3 开放');
  }

  async removeComicPage(comicId, pageId) {
    this._guardWrite();
    const w = this._works.find((x) => x.id === comicId && x.type === 'comic');
    if (!w) throw new Error('漫画不存在');
    const before = (w.pages || []).length;
    w.pages = (w.pages || []).filter((p) => p.id !== pageId);
    if (w.pages.length === before) throw new Error('漫画页不存在');
    // 剩余页 order 连续重排（page_number 语义在 Mock 以 order 表达，一并顺延）。
    w.pages = w.pages.map((p, i) => ({ ...p, order: i + 1 }));
    this._save();
    return this._clone(w);
  }

  async removeWorkImage(workId, url) {
    this._guardWrite();
    const w = this._works.find((x) => x.id === workId);
    if (!w) throw new Error('作品不存在');
    if (!Array.isArray(w.images)) throw new Error('该作品无图片');
    const before = w.images.length;
    w.images = w.images.filter((u) => u !== url);
    if (w.images.length === before) throw new Error('未找到匹配的作品图片');
    this._save();
    return this._clone(w);
  }

  async reorderComicPages(comicId, orderedIds) {
    this._guardWrite();
    const w = this._works.find((x) => x.id === comicId && x.type === 'comic');
    if (!w) throw new Error('漫画不存在');
    const map = new Map((w.pages || []).map((p) => [p.id, p]));
    w.pages = orderedIds.map((id, i) => ({ ...map.get(id), order: i + 1 })).filter(Boolean);
    this._save();
    return this._clone(w);
  }

  // C2：证书写（Mock 回滚通道补齐）。仅结构化字段；不替换图片（cover 保持）。
  async updateCertificate(id, patch) {
    this._guardWrite();
    const c = this._works.find((x) => x.id === id && x.type === 'certificate');
    if (!c) throw new Error('证书不存在');
    // #4 严格字段校验（与 Supabase 一致；写前抛错，无回退）
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
    if ('title' in patch) c.title = (patch.title || '').trim();
    if ('year' in patch) c.year = patch.year == null ? null : Number(patch.year);
    if ('yearStart' in patch) c.yearStart = patch.yearStart == null ? null : Number(patch.yearStart);
    if ('yearEnd' in patch) c.yearEnd = patch.yearEnd == null ? null : Number(patch.yearEnd);
    if ('category' in patch) c.category = (patch.category || '').trim();
    if ('public' in patch) c.public = patch.public !== false;
    if ('sort' in patch) c.sort = Number(patch.sort || 0);
    this._save();
    return this._clone(c);
  }

  async resetDemo() {
    this._guardWrite();
    this._works = buildSeed();
    this._save();
    return this._clone(this._works);
  }

  // —— C3 媒体写入（Mock 回滚通道：本地 dataURL 模拟上传，复用 MockMediaStorage）——
  static get C3_MAX_FILE_SIZE() { return 10 * 1024 * 1024; }
  static get C3_ALLOWED_MIME() { return ['image/jpeg', 'image/png', 'image/webp']; }

  _validateUploadFile(file) {
    if (!file) throw new Error('未提供文件');
    if (!(file.size > 0)) throw new Error('文件为空（size=0），拒绝上传');
    if (!MockWorkRepository.C3_ALLOWED_MIME.includes(file.type)) {
      throw new Error(`不支持的文件类型（${file.type || 'unknown'}），仅支持 jpg/png/webp`);
    }
    if (file.size > MockWorkRepository.C3_MAX_FILE_SIZE) {
      throw new Error(`文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），上限 10MB`);
    }
  }

  async _mockUpload(file) {
    this._validateUploadFile(file);
    const { MockMediaStorage } = await import('./storage.js');
    const st = new MockMediaStorage();
    const r = await st.upload(file);
    return r; // { key, url(dataURL), name, size }
  }

  async uploadWorkCover(workId, file) {
    this._guardWrite();
    const w = this._works.find((x) => x.id === workId);
    if (!w) throw new Error('作品不存在');
    const r = await this._mockUpload(file);
    w.cover = r.url;
    this._save();
    return this._clone(w);
  }

  async addWorkImage(workId, file) {
    this._guardWrite();
    const w = this._works.find((x) => x.id === workId);
    if (!w) throw new Error('作品不存在');
    if (w.type === 'comic') throw new Error('漫画作品图片由漫画页管理，不进入多图列表');
    const r = await this._mockUpload(file);
    if (!Array.isArray(w.images)) w.images = [];
    w.images.push(r.url);
    this._save();
    return this._clone(w);
  }

  async adjustImageSort(workId, orderedIds) {
    this._guardWrite();
    const w = this._works.find((x) => x.id === workId);
    if (!w) throw new Error('作品不存在');
    if (!Array.isArray(w.images)) throw new Error('该作品无图片');
    if (orderedIds.length !== w.images.length) throw new Error('顺序长度与现有图片数不一致');
    // Mock 以数组顺序即展示顺序：按 orderedIds 索引重排（orderedIds 为「原图 URL 的新顺序索引」或「按 URL 标识」
    // 简化：orderedIds 为图片 URL 的目标顺序（与 Supabase 按 id 不同，Mock 用 URL 直接映射）。
    const byUrl = new Map(w.images.map((u, i) => [u, i]));
    const reordered = orderedIds.map((u) => {
      const idx = byUrl.get(u);
      if (idx == null) throw new Error(`作品图片重排失败：存在未知图片（${u}）`);
      return w.images[idx];
    });
    w.images = reordered;
    this._save();
    return this._clone(w);
  }

  async addComicPage(comicId, file) {
    this._guardWrite();
    const w = this._works.find((x) => x.id === comicId && x.type === 'comic');
    if (!w) throw new Error('漫画不存在');
    const r = await this._mockUpload(file);
    if (!Array.isArray(w.pages)) w.pages = [];
    const nextOrder = w.pages.length + 1;
    w.pages.push({ id: `cp-mock-${Date.now().toString(36)}-${w.pages.length}`, order: nextOrder, image: r.url });
    this._save();
    return this._clone(w);
  }

  async replaceComicPageImage(pageId, file) {
    this._guardWrite();
    let target = null;
    for (const w of this._works) {
      if (w.type !== 'comic') continue;
      const p = (w.pages || []).find((pp) => pp.id === pageId);
      if (p) { target = p; break; }
    }
    if (!target) throw new Error('漫画页不存在');
    const r = await this._mockUpload(file);
    target.image = r.url; // 旧图以 dataURL 形式被直接覆盖（Mock 无物理文件，等价保留语义）
    this._save();
    // 返回所属漫画（依据页面找到的父作品）
    const parent = this._works.find((w) => (w.pages || []).some((pp) => pp.id === pageId));
    return this._clone(parent);
  }

  async replaceCertificateImage(certId, file) {
    this._guardWrite();
    const c = this._works.find((x) => x.id === certId && x.type === 'certificate');
    if (!c) throw new Error('证书不存在');
    const r = await this._mockUpload(file);
    c.cover = r.url;
    this._save();
    return this._clone(c);
  }


  // —— 后台统计辅助 ——
  stats() {
    const by = (t) => this._works.filter((w) => w.type === t).length;
    return {
      // 作品总数 = 插画 + 漫画 + 油画（排除证书；证书通过 certificate 字段独立返回）
      total: this._works.filter((w) => w.type !== 'certificate').length,
      illustration: by('illustration'),
      comic: by('comic'),
      oil: by('oil'),
      certificate: by('certificate'),
      featured: this._works.filter((w) => w.featured).length,
      // 证书不进入 Works 属“栏目规则”（按类型排除），不应被统计为网站“未公开”
      hidden: this._works.filter((w) => w.public === false && w.type !== 'certificate').length,
    };
  }

  _clone(v) { return JSON.parse(JSON.stringify(v)); }
}
