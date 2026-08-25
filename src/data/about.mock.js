// ============================================================
// about.mock.js — Phase 3-C2 关于页 Mock 数据源（与 Supabase 结构对齐）
// ------------------------------------------------------------
// 与 about.js 原有硬编码数据完全一致，仅抽出为结构化对象，
// 供 Mock 模式（?mock=1 / 未配置 Supabase）下 about.js 读取，
// 保证 Mock 与 Supabase 两条路径输出的字段形状一致。
// C2：在内存中维护可编辑状态，支持与 Supabase 关于仓储完全对齐的写方法，
//     使 ?mock=1 回滚通道也能完整演示 About 编辑（增删排序）。
// ============================================================

export class MockAboutRepository {
  constructor(opts = {}) {
    // C2 写回滚通道：opts.writable 控制是否允许写（默认 false 保持 C1 只读语义）
    this._writable = !!opts.writable;
    // 内存态：首次 read() 时从默认数据初始化，之后写操作就地更新。
    this._data = null;
  }

  _guardWrite() {
    if (!this._writable) throw new Error('C1 只读：Mock About 数据源未以 writable 模式构造');
  }

  _ensure() {
    if (this._data) return this._data;
    this._data = {
      fullName: '邱钰真',
      pinyin: 'QIU YUZHEN',
      bio: '以插画与漫画为主要创作方向，关注角色、叙事与氛围表达。',
      creativeDirection: '插画创作 / 漫画创作 / 油画',
      avatarAssetId: null,
      education: [
        { id: 'edu-1', yr: '2017.9 – 2021.7', h: '中国传媒大学南广学院 · 漫画与插画｜本科', p: '本科阶段主修漫画叙事与插画创作，毕业设计为 42 页漫画。', sort_order: 1 },
        { id: 'edu-2', yr: '2024.4 – 2026.3', h: '日本代代木动画学院（代々木アニメーション学院）· 漫画（进修）｜专门学校', p: '漫画专业进修；毕业制作（2026 年 2 月）共 27 页。', sort_order: 2 },
      ],
      experience: [
        { id: 'exp-1', yr: '2026', h: '代代木动画学院 毕业制作', p: '27 页漫画毕业设计（日本 · 代代木动画学院）。', sort_order: 1 },
        { id: 'exp-2', yr: '2024', h: 'CP30 同人志《舞机》', p: '13 页同人志创作（Fan Work，不拥有原作 IP）。', sort_order: 2 },
        { id: 'exp-3', yr: '2021', h: '大学毕业设计', p: '42 页漫画（中国传媒大学南广学院）。', sort_order: 3 },
        { id: 'exp-4', yr: '2020', h: '24小时国际漫画马拉松', p: '8 页参赛漫画，获三等奖。', sort_order: 4 },
        { id: 'exp-5', yr: '2020', h: '大学漫画课程作业', p: '正文 20 页，另含封面与封底。', sort_order: 5 },
        { id: 'exp-6', yr: '2018.7 – 2018.9', h: '上海观池文化传播有限公司｜漫画助理', p: '', sort_order: 6 },
      ],
      skills: [
        { id: 'sk-1', name: 'CLIP STUDIO PAINT（CSP）', sort_order: 1 },
        { id: 'sk-2', name: 'SAI', sort_order: 2 },
        { id: 'sk-3', name: 'Photoshop', sort_order: 3 },
        { id: 'sk-4', name: '日语 JLPT N2', sort_order: 4 },
      ],
      directions: ['插画创作', '漫画创作', '油画'],
      // #6 修复：honors 数组含 ho1–ho6（标准荣誉）+ ho7（稳定 ID 叙述段）。
      // ho7 不进入前台「普通荣誉」集合，仅作为 honorParagraph 展示（与 Supabase 结构对齐）。
      honors: [
        { id: 'ho1', y: '2025', t: '米画师平台 商业插画师认证', sort_order: 1 },
        { id: 'ho2', y: '2024', t: 'JCLI 优秀赏', sort_order: 2 },
        { id: 'ho3', y: '2020', t: '第四届吉林动画学院 24小时国际漫画马拉松 三等奖', sort_order: 3 },
        { id: 'ho4', y: '2018', t: '学院作品永久收藏', sort_order: 4 },
        { id: 'ho5', y: '2014', t: '全国少年儿童绘画绘本创作大赛 中学绘本组 三等奖', sort_order: 5 },
        { id: 'ho6', y: '2013', t: '四川省中小学生优秀艺术人才大赛（资阳赛区）美术专业初中组 一等奖', sort_order: 6 },
        { id: 'ho7', y: '2004-2011', t: '2004年至2011年，连续8届获得当地“青少年艺术表演大赛”美术项目金奖。', sort_order: 7 },
      ],
      honorParagraph: '2004年至2011年，连续8届获得当地“青少年艺术表演大赛”美术项目金奖。',
      contacts: [{ id: 'ct-1', k: '邮箱', v: '2219528116@qq.com', sort_order: 1 }],
    };
    return this._data;
  }

  async read() {
    const d = this._ensure();
    return {
      fullName: d.fullName,
      pinyin: d.pinyin,
      bio: d.bio,
      creativeDirection: d.creativeDirection,
      avatarAssetId: d.avatarAssetId,
      // C1 冻结公共契约：skills 为 string[]（#2 恢复）
      education: d.education.slice().sort((a, b) => a.sort_order - b.sort_order).map((e) => ({ yr: e.yr, h: e.h, p: e.p, id: e.id })),
      experience: d.experience.slice().sort((a, b) => a.sort_order - b.sort_order).map((e) => ({ yr: e.yr, h: e.h, p: e.p, id: e.id })),
      skills: d.skills.slice().sort((a, b) => a.sort_order - b.sort_order).map((s) => s.name),
      directions: d.directions.slice(),
      // #6 修复：公共 read() 的 honors 排除 ho7（叙述段仅走 honorParagraph），与 Supabase _normalizeHonors 一致
      // #7 修复：honorParagraph 从 ho7 行实时派生（upsertHonor({id:'ho7'}) 改 ho7.t 后即时反映）
      honors: d.honors.slice().sort((a, b) => a.sort_order - b.sort_order).filter((h) => h.id !== 'ho7').map((h) => ({ y: h.y, t: h.t, id: h.id })),
      honorParagraph: (d.honors.find((h) => h.id === 'ho7') || {}).t || d.honorParagraph,
      contacts: d.contacts.slice().sort((a, b) => a.sort_order - b.sort_order).map((c) => ({ k: c.k, v: c.v, id: c.id })),
    };
  }

  // C2 admin 专属读形状：返回带 id + sort_order 的结构化对象（#2 新增 readAdmin）
  async readAdmin() {
    const d = this._ensure();
    return {
      fullName: d.fullName,
      pinyin: d.pinyin,
      bio: d.bio,
      creativeDirection: d.creativeDirection,
      avatarAssetId: d.avatarAssetId,
      education: d.education.slice().sort((a, b) => a.sort_order - b.sort_order).map((e) => ({ yr: e.yr, h: e.h, p: e.p, id: e.id, sort_order: e.sort_order })),
      experience: d.experience.slice().sort((a, b) => a.sort_order - b.sort_order).map((e) => ({ yr: e.yr, h: e.h, p: e.p, id: e.id, sort_order: e.sort_order })),
      skills: d.skills.slice().sort((a, b) => a.sort_order - b.sort_order).map((s) => ({ name: s.name, id: s.id, sort_order: s.sort_order })),
      directions: d.directions.slice(),
      // #6 修复：readAdmin() 的 honors 同样排除 ho7（叙述段仅走 honorParagraph）
      // #7 修复：honorParagraph 从 ho7 行实时派生
      honors: d.honors.slice().sort((a, b) => a.sort_order - b.sort_order).filter((h) => h.id !== 'ho7').map((h) => ({ y: h.y, t: h.t, id: h.id, sort_order: h.sort_order })),
      honorParagraph: (d.honors.find((h) => h.id === 'ho7') || {}).t || d.honorParagraph,
      contacts: d.contacts.slice().sort((a, b) => a.sort_order - b.sort_order).map((c) => ({ k: c.k, v: c.v, id: c.id, sort_order: c.sort_order })),
    };
  }

  // —— C2 About 写方法（内存态；与 Supabase 关于仓储接口完全对齐）——
  async updateProfile(patch) {
    this._guardWrite();
    const d = this._ensure();
    if ('fullName' in patch) d.fullName = (patch.fullName || '').trim();
    if ('pinyin' in patch) d.pinyin = (patch.pinyin || '').trim();
    if ('bio' in patch) d.bio = patch.bio || '';
    if ('creativeDirection' in patch) d.creativeDirection = patch.creativeDirection || '';
    return this.read();
  }

  async upsertEducation(entry) {
    this._guardWrite();
    const d = this._ensure();
    const id = entry.id || `edu-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    const existing = d.education.find((e) => e.id === id);
    if (existing) {
      // 编辑现有记录：仅改内容字段，保留原始 sort_order（#3 修复）
      Object.assign(existing, { yr: entry.yr || '', h: entry.h || '', p: entry.p || '' });
    } else {
      d.education.push({ id, yr: entry.yr || '', h: entry.h || '', p: entry.p || '', sort_order: d.education.length + 1 });
    }
    return this.read();
  }

  async reorderEducation(orderedIds) {
    this._guardWrite();
    const d = this._ensure();
    orderedIds.forEach((id, i) => { const e = d.education.find((x) => x.id === id); if (e) e.sort_order = i + 1; });
    return this.read();
  }

  async removeEducation(id) {
    this._guardWrite();
    const d = this._ensure();
    d.education = d.education.filter((e) => e.id !== id);
    return this.read();
  }

  async upsertExperience(entry) {
    this._guardWrite();
    const d = this._ensure();
    const id = entry.id || `exp-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    const existing = d.experience.find((e) => e.id === id);
    if (existing) {
      Object.assign(existing, { yr: entry.yr || '', h: entry.h || '', p: entry.p || '' });
    } else {
      d.experience.push({ id, yr: entry.yr || '', h: entry.h || '', p: entry.p || '', sort_order: d.experience.length + 1 });
    }
    return this.read();
  }

  async reorderExperience(orderedIds) {
    this._guardWrite();
    const d = this._ensure();
    orderedIds.forEach((id, i) => { const e = d.experience.find((x) => x.id === id); if (e) e.sort_order = i + 1; });
    return this.read();
  }

  async removeExperience(id) {
    this._guardWrite();
    const d = this._ensure();
    d.experience = d.experience.filter((e) => e.id !== id);
    return this.read();
  }

  async upsertSkill(name, id = null, sortOrder = 0) {
    this._guardWrite();
    const d = this._ensure();
    const sid = id || `sk-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    const existing = d.skills.find((s) => s.id === sid);
    if (existing) existing.name = (name || '').trim();
    else d.skills.push({ id: sid, name: (name || '').trim(), sort_order: sortOrder || d.skills.length + 1 });
    return this.read();
  }

  async removeSkill(id) {
    this._guardWrite();
    const d = this._ensure();
    d.skills = d.skills.filter((s) => s.id !== id);
    return this.read();
  }

  async reorderSkill(orderedIds) {
    this._guardWrite();
    const d = this._ensure();
    orderedIds.forEach((id, i) => { const s = d.skills.find((x) => x.id === id); if (s) s.sort_order = i + 1; });
    return this.read();
  }

  async upsertHonor(entry) {
    this._guardWrite();
    const d = this._ensure();
    const id = entry.id || `ho-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    const existing = d.honors.find((h) => h.id === id);
    if (existing) {
      Object.assign(existing, { y: entry.y || '', t: entry.t || '' });
    } else {
      d.honors.push({ id, y: entry.y || '', t: entry.t || '', sort_order: d.honors.length + 1 });
    }
    return this.read();
  }

  async reorderHonor(orderedIds) {
    this._guardWrite();
    const d = this._ensure();
    orderedIds.forEach((id, i) => { const h = d.honors.find((x) => x.id === id); if (h) h.sort_order = i + 1; });
    return this.read();
  }

  async removeHonor(id) {
    this._guardWrite();
    const d = this._ensure();
    d.honors = d.honors.filter((h) => h.id !== id);
    return this.read();
  }

  async upsertContact(label, url, id = null, sortOrder = 0) {
    this._guardWrite();
    const d = this._ensure();
    const cid = id || `ct-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    const existing = d.contacts.find((c) => c.id === cid);
    if (existing) { existing.k = (label || '').trim(); existing.v = url || ''; }
    else d.contacts.push({ id: cid, k: (label || '').trim(), v: url || '', sort_order: sortOrder || d.contacts.length + 1 });
    return this.read();
  }

  async removeContact(id) {
    this._guardWrite();
    const d = this._ensure();
    d.contacts = d.contacts.filter((c) => c.id !== id);
    return this.read();
  }

  async reorderContact(orderedIds) {
    this._guardWrite();
    const d = this._ensure();
    orderedIds.forEach((id, i) => { const c = d.contacts.find((x) => x.id === id); if (c) c.sort_order = i + 1; });
    return this.read();
  }
}
