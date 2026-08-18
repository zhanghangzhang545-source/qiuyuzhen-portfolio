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
}

// Phase 2 数据版本键；base-final-3 曾与当前共用同一历史键（且漫画数据尚不存在 workNature 字段），
// 必须切换为新键以强制重新播种，避免旧浏览器继续读取缺字段的错误 seed。
const STORE_KEY = 'portfolio.works.phase2.v1';
// 旧版本键：base-final-3 与 v2 均不含 workNature 字段（且 base-final-3 曾与当前共用同一 key），
// 升级时必须显式清除后按 Phase 2 seed 重新播种，禁止静默复用旧缓存。
const LEGACY_KEYS = ['portfolio.works.base-final.v1', 'portfolio.works.v2'];

export class MockWorkRepository extends WorkRepository {
  constructor() {
    super();
    this._works = this._load();
  }

  _load() {
    // 优先使用 Phase 2 新键
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* ignore */ }
    // 明确迁移：旧 base-final-3 / v2 缓存不含 workNature（甚至曾与当前共用同一 key），
    // 禁止静默复用——直接丢弃所有旧键，重新播种 Phase 2 数据（含 workNature）并写入新键。
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
          // 编辑精选：精选优先，其次按自定义排序（质量 + 年份综合）
          if (a.featured !== b.featured) return a.featured ? -1 : 1;
          return byCustom(a, b);
      }
    });
    return this._clone(list);
  }

  async create(work) {
    const id = `w${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    const record = { id, sort: this._works.length + 1, public: true, featured: false, tags: [], ...work };
    this._works.unshift(record);
    this._save();
    return this._clone(record);
  }

  async update(id, patch) {
    const w = this._works.find((x) => x.id === id);
    if (!w) throw new Error('作品不存在');
    Object.assign(w, patch);
    this._save();
    return this._clone(w);
  }

  async remove(id) {
    const i = this._works.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('作品不存在');
    this._works.splice(i, 1);
    this._save();
    return true;
  }

  async addComicPage(comicId, image) {
    const w = this._works.find((x) => x.id === comicId && x.type === 'comic');
    if (!w) throw new Error('漫画不存在');
    const order = (w.pages || []).length + 1;
    const page = { id: `p${Date.now().toString().slice(-6)}`, order, image };
    w.pages = w.pages || [];
    w.pages.push(page);
    this._save();
    return this._clone(w);
  }

  async removeComicPage(comicId, pageId) {
    const w = this._works.find((x) => x.id === comicId && x.type === 'comic');
    if (!w) throw new Error('漫画不存在');
    w.pages = (w.pages || []).filter((p) => p.id !== pageId);
    w.pages.forEach((p, i) => (p.order = i + 1));
    this._save();
    return this._clone(w);
  }

  async reorderComicPages(comicId, orderedIds) {
    const w = this._works.find((x) => x.id === comicId && x.type === 'comic');
    if (!w) throw new Error('漫画不存在');
    const map = new Map((w.pages || []).map((p) => [p.id, p]));
    w.pages = orderedIds.map((id, i) => ({ ...map.get(id), order: i + 1 })).filter(Boolean);
    this._save();
    return this._clone(w);
  }

  async resetDemo() {
    this._works = buildSeed();
    this._save();
    return this._clone(this._works);
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
