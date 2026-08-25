// ============================================================
// about.supabase.js — Phase 3-C2 真实「关于」仓储（Supabase）
// ------------------------------------------------------------
// 读取 6 张 About 表（C1 只读已实现，本文件保持 read() 不变）。
// C2 解锁真实 CRUD：profile / education / experience / skills / honors / contact
//   增（upsert）/ 改（upsert）/ 删（remove，如允许）/ 排序（reorder）。
// C2 边界：
//   ❌ 不写媒体（avatar_asset_id 不在此修改，留 C3）。
//   ✅ 增删排序真实写 Supabase，保持前台读取顺序（order asc）。
//   写方法经 RLS + is_admin() 守卫，失败显式抛错。
// ============================================================

import { getSupabase } from './supabaseClient.js';

// About 表的归一化结构（与 about.js 期望字段对齐）
export class SupabaseAboutRepository {
  constructor(injectedClient = null) {
    this._sb = injectedClient;
  }

  async _client() {
    if (!this._sb) this._sb = await getSupabase();
    return this._sb;
  }

  // C2 写边界守卫：未注入可写客户端（C1 无配置）时抛「C1 只读」
  _requireWritableClient() {
    if (!this._sb) throw new Error('C1 只读：未配置 Supabase 写客户端');
    return this._sb;
  }

  async read() {
    const sb = await this._client();
    const [pRes, eduRes, expRes, skRes, hoRes, ctRes] = await Promise.all([
      sb.from('profile').select('*').eq('id', 'singleton').maybeSingle(),
      sb.from('education_entries').select('*').order('sort_order', { ascending: true }),
      sb.from('experience_entries').select('*').order('sort_order', { ascending: true }),
      sb.from('skills').select('*').order('sort_order', { ascending: true }),
      sb.from('honors').select('*').order('sort_order', { ascending: true }),
      sb.from('contact_links').select('*').order('sort_order', { ascending: true }),
    ]);
    if (pRes.error) throw new Error(`profile 读取失败：${pRes.error.message}`);
    if (eduRes.error) throw new Error(`education_entries 读取失败：${eduRes.error.message}`);
    if (expRes.error) throw new Error(`experience_entries 读取失败：${expRes.error.message}`);
    if (skRes.error) throw new Error(`skills 读取失败：${skRes.error.message}`);
    if (hoRes.error) throw new Error(`honors 读取失败：${hoRes.error.message}`);
    if (ctRes.error) throw new Error(`contact_links 读取失败：${ctRes.error.message}`);

    const profile = pRes.data || {};
    return {
      fullName: profile.full_name || '邱钰真',
      pinyin: profile.pinyin || 'QIU YUZHEN',
      bio: profile.bio || '',
      creativeDirection: profile.creative_direction || '',
      avatarAssetId: profile.avatar_asset_id || null,
      education: (eduRes.data || []).map((r) => ({ id: r.id, yr: r.year_text || '', h: r.heading || '', p: r.detail || '' })),
      experience: (expRes.data || []).map((r) => ({ id: r.id, yr: r.year_text || '', h: r.heading || '', p: r.detail || '' })),
      // C1 冻结公共契约：skills 为 string[]（#2 恢复）
      skills: (skRes.data || []).map((r) => r.name).filter(Boolean),
      directions: this._parseDirections(profile.creative_direction),
      ...this._normalizeHonors(hoRes.data || []),
      contacts: (ctRes.data || []).map((r) => ({ id: r.id, k: r.label || '', v: r.url || '' })),
    };
  }

  // C2 admin 专属读形状：返回带 id + sort_order 的结构化对象（#2 新增 readAdmin）
  async readAdmin() {
    const sb = await this._client();
    const [pRes, eduRes, expRes, skRes, hoRes, ctRes] = await Promise.all([
      sb.from('profile').select('*').eq('id', 'singleton').maybeSingle(),
      sb.from('education_entries').select('*').order('sort_order', { ascending: true }),
      sb.from('experience_entries').select('*').order('sort_order', { ascending: true }),
      sb.from('skills').select('*').order('sort_order', { ascending: true }),
      sb.from('honors').select('*').order('sort_order', { ascending: true }),
      sb.from('contact_links').select('*').order('sort_order', { ascending: true }),
    ]);
    // #2 修复：readAdmin 与公共 read() 一样 fail-closed —— 任意表读取错误必须显式抛错，
    // 不得静默用默认值掩盖（否则某表失败会显示误导性的空内容，而非 error state）。
    if (pRes.error) throw new Error(`profile 读取失败：${pRes.error.message}`);
    if (eduRes.error) throw new Error(`education_entries 读取失败：${eduRes.error.message}`);
    if (expRes.error) throw new Error(`experience_entries 读取失败：${expRes.error.message}`);
    if (skRes.error) throw new Error(`skills 读取失败：${skRes.error.message}`);
    if (hoRes.error) throw new Error(`honors 读取失败：${hoRes.error.message}`);
    if (ctRes.error) throw new Error(`contact_links 读取失败：${ctRes.error.message}`);
    const profile = pRes.data || {};
    return {
      fullName: profile.full_name || '邱钰真',
      pinyin: profile.pinyin || 'QIU YUZHEN',
      bio: profile.bio || '',
      creativeDirection: profile.creative_direction || '',
      avatarAssetId: profile.avatar_asset_id || null,
      education: (eduRes.data || []).map((r) => ({ id: r.id, yr: r.year_text || '', h: r.heading || '', p: r.detail || '', sort_order: Number(r.sort_order) || 0 })),
      experience: (expRes.data || []).map((r) => ({ id: r.id, yr: r.year_text || '', h: r.heading || '', p: r.detail || '', sort_order: Number(r.sort_order) || 0 })),
      skills: (skRes.data || []).map((r) => ({ name: r.name, id: r.id, sort_order: Number(r.sort_order) || 0 })).filter((s) => s.name),
      directions: this._parseDirections(profile.creative_direction),
      ...this._normalizeHonors(hoRes.data || []),
      contacts: (ctRes.data || []).map((r) => ({ id: r.id, k: r.label || '', v: r.url || '', sort_order: Number(r.sort_order) || 0 })),
    };
  }

  /**
   * 荣誉归一化（B2 真实结构对齐）：
   *   - honors：标准荣誉（不含 ho7 叙述段）。
   *   - honorParagraph：稳定 ID `ho7` 对应的连续叙述段落（仅展示一次，不参与普通荣誉 reorder/delete）。
   * @param {Array} rows About honors 表行（已按 sort_order 升序）
   * #6 修复：必须按稳定 ID `ho7` 识别叙述段，**绝不按数组最后一项**（否则新增普通荣誉会错误地把 ho7 挤进 honors）。
   */
  _normalizeHonors(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const all = list.map((r) => ({ y: r.detail || '', t: r.title || '', id: r.id }));
    // 按稳定 ID 识别 ho7 叙述段（B2 稳定记录：id='ho7'，title='2004年至2011年，连续8届获得...'）
    const ho7 = all.find((r) => r.id === 'ho7');
    const honors = all.filter((r) => r.id !== 'ho7');
    const honorParagraph = ho7 ? ho7.t : '';
    return { honors, honorParagraph };
  }

  _parseDirections(text) {
    if (!text) return [];
    // 真实结构：'插画 / 漫画 / 油画；创作方向：插画创作 / 漫画创作 / 油画'
    // 必须先抽取「创作方向：」之后的部分，再按「 / 」拆分，得到冻结的 3 项。
    const MARKER = '创作方向：';
    const idx = String(text).indexOf(MARKER);
    const body = idx >= 0 ? String(text).slice(idx + MARKER.length) : String(text);
    return body
      .split(/[\/，、,，\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // —— C2 About 写方法（真实 Supabase CRUD）——
  // 所有写方法复用 _client()；保持 order asc 读取顺序不变。
  // id 生成沿用现有业务 ID 风格（避免 UUID，便于前台稳定引用）。

  async updateProfile(patch) {
    const sb = this._requireWritableClient();
    const row = {};
    if ('fullName' in patch) row.full_name = (patch.fullName || '').trim();
    if ('pinyin' in patch) row.pinyin = (patch.pinyin || '').trim();
    if ('bio' in patch) row.bio = patch.bio || '';
    if ('creativeDirection' in patch) row.creative_direction = patch.creativeDirection || '';
    if (Object.keys(row).length === 0) return this.read();
    const { error } = await sb.from('profile').update(row).eq('id', 'singleton');
    if (error) throw new Error(`profile 更新失败：${error.message}`);
    return this.read();
  }

  // 新条目排序权重：取该表当前最大 sort_order + 1（避免新增条目 sort_order=0 排到首位）
  async _nextSortOrder(sb, table) {
    const { data } = await sb.from(table).select('sort_order');
    const nums = (data || []).map((r) => Number(r.sort_order) || 0);
    return nums.length ? Math.max(...nums) + 1 : 1;
  }

  async upsertEducation(entry) {
    const sb = this._requireWritableClient();
    const id = entry.id || `edu-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    // #3 修复：编辑现有记录时保留原始 sort_order（先读原值），仅 reorder 改排序；新记录用 max+1
    let sortOrder = entry.sort_order != null ? Number(entry.sort_order) : await this._nextSortOrder(sb, 'education_entries');
    if (entry.id) {
      const { data } = await sb.from('education_entries').select('sort_order').eq('id', entry.id).maybeSingle();
      if (data && data.sort_order != null) sortOrder = Number(data.sort_order);
    }
    const row = { id, year_text: entry.yr || '', heading: entry.h || '', detail: entry.p || '', sort_order: sortOrder };
    const { error } = await sb.from('education_entries').upsert(row);
    if (error) throw new Error(`教育经历写入失败：${error.message}`);
    return this.read();
  }

  // #5 修复：单次批量 upsert（原子：要么整批成功，要么整批失败，不留部分 DB 状态）。
  // 先读全量行取其原始业务字段，仅改 sort_order 后整批提交。
  // 写失败则全部回滚（Supabase upsert 单请求语义），原 sort_order 保持不变。
  async _batchReorder(sb, table, selectCols, orderedIds) {
    const { data: rows, error: rerr } = await sb.from(table).select(selectCols);
    if (rerr) throw new Error(`${table} 读取失败：${rerr.message}`);
    const byId = new Map((rows || []).map((r) => [r.id, r]));
    const missing = orderedIds.filter((id) => !byId.has(id));
    if (missing.length) throw new Error(`${table} 重排失败：存在未知 ID（${missing.join(', ')}）`);
    // 仅对传入的 orderedIds 重排 sort_order（其余行保持原值，不强制要求覆盖全表——
    // 例如 honors 表的叙述段末行不进入前台 reorder 集合，但其 sort_order 不受影响）。
    const batch = orderedIds.map((id, i) => ({ ...byId.get(id), sort_order: i + 1 }));
    const { error } = await sb.from(table).upsert(batch);
    if (error) throw new Error(`${table} 排序失败：${error.message}`);
  }

  async reorderEducation(orderedIds) {
    const sb = this._requireWritableClient();
    await this._batchReorder(sb, 'education_entries', 'id, year_text, heading, detail, sort_order', orderedIds);
    return this.read();
  }

  async removeEducation(id) {
    const sb = this._requireWritableClient();
    const { error } = await sb.from('education_entries').delete().eq('id', id);
    if (error) throw new Error(`教育经历删除失败：${error.message}`);
    return this.read();
  }

  async upsertExperience(entry) {
    const sb = this._requireWritableClient();
    const id = entry.id || `exp-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    let sortOrder = entry.sort_order != null ? Number(entry.sort_order) : await this._nextSortOrder(sb, 'experience_entries');
    if (entry.id) {
      const { data } = await sb.from('experience_entries').select('sort_order').eq('id', entry.id).maybeSingle();
      if (data && data.sort_order != null) sortOrder = Number(data.sort_order);
    }
    const row = { id, year_text: entry.yr || '', heading: entry.h || '', detail: entry.p || '', sort_order: sortOrder };
    const { error } = await sb.from('experience_entries').upsert(row);
    if (error) throw new Error(`经历写入失败：${error.message}`);
    return this.read();
  }

  async reorderExperience(orderedIds) {
    const sb = this._requireWritableClient();
    await this._batchReorder(sb, 'experience_entries', 'id, year_text, heading, detail, sort_order', orderedIds);
    return this.read();
  }

  async removeExperience(id) {
    const sb = this._requireWritableClient();
    const { error } = await sb.from('experience_entries').delete().eq('id', id);
    if (error) throw new Error(`经历删除失败：${error.message}`);
    return this.read();
  }

  async upsertSkill(name, id = null, sortOrder = 0) {
    const sb = this._requireWritableClient();
    const sid = id || `sk-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    let so = id ? Number(sortOrder) : (sortOrder ? Number(sortOrder) : await this._nextSortOrder(sb, 'skills'));
    if (id) {
      const { data } = await sb.from('skills').select('sort_order').eq('id', sid).maybeSingle();
      if (data && data.sort_order != null) so = Number(data.sort_order);
    }
    const { error } = await sb.from('skills').upsert({ id: sid, name: (name || '').trim(), sort_order: so });
    if (error) throw new Error(`技能写入失败：${error.message}`);
    return this.read();
  }

  async removeSkill(id) {
    const sb = this._requireWritableClient();
    const { error } = await sb.from('skills').delete().eq('id', id);
    if (error) throw new Error(`技能删除失败：${error.message}`);
    return this.read();
  }

  async reorderSkill(orderedIds) {
    const sb = this._requireWritableClient();
    await this._batchReorder(sb, 'skills', 'id, name, sort_order', orderedIds);
    return this.read();
  }

  async upsertHonor(entry) {
    const sb = this._requireWritableClient();
    const id = entry.id || `ho-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    let sortOrder = entry.sort_order != null ? Number(entry.sort_order) : await this._nextSortOrder(sb, 'honors');
    if (entry.id) {
      const { data } = await sb.from('honors').select('sort_order').eq('id', entry.id).maybeSingle();
      if (data && data.sort_order != null) sortOrder = Number(data.sort_order);
    }
    const row = { id, title: entry.t || '', detail: entry.y || '', sort_order: sortOrder };
    const { error } = await sb.from('honors').upsert(row);
    if (error) throw new Error(`荣誉写入失败：${error.message}`);
    return this.read();
  }

  async reorderHonor(orderedIds) {
    const sb = this._requireWritableClient();
    await this._batchReorder(sb, 'honors', 'id, title, detail, sort_order', orderedIds);
    return this.read();
  }

  async removeHonor(id) {
    const sb = this._requireWritableClient();
    const { error } = await sb.from('honors').delete().eq('id', id);
    if (error) throw new Error(`荣誉删除失败：${error.message}`);
    return this.read();
  }

  async upsertContact(label, url, id = null, sortOrder = 0) {
    const sb = this._requireWritableClient();
    const cid = id || `ct-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    // #3 修复：新联系方式用 max+1；编辑现有记录保留原 sort_order
    let so = id ? Number(sortOrder) : (sortOrder ? Number(sortOrder) : await this._nextSortOrder(sb, 'contact_links'));
    if (id) {
      const { data } = await sb.from('contact_links').select('sort_order').eq('id', cid).maybeSingle();
      if (data && data.sort_order != null) so = Number(data.sort_order);
    }
    const { error } = await sb.from('contact_links').upsert({ id: cid, label: (label || '').trim(), url: url || '', sort_order: so });
    if (error) throw new Error(`联系方式写入失败：${error.message}`);
    return this.read();
  }

  async removeContact(id) {
    const sb = this._requireWritableClient();
    const { error } = await sb.from('contact_links').delete().eq('id', id);
    if (error) throw new Error(`联系方式删除失败：${error.message}`);
    return this.read();
  }

  async reorderContact(orderedIds) {
    const sb = this._requireWritableClient();
    await this._batchReorder(sb, 'contact_links', 'id, label, url, sort_order', orderedIds);
    return this.read();
  }
}
