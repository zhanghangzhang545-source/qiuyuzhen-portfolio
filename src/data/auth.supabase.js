// ============================================================
// auth.supabase.js — Phase 3-C1 真实管理员鉴权 + 授权
// ------------------------------------------------------------
// 安全要求（架构 Final-3.2a）：
//   ❌ 不能「只要登录了就算管理员」。必须经由 Supabase Auth 登录后，
//      再调用 is_admin()（SECURITY DEFINER，查 admin_users 白名单）做真实授权。
//   ✅ 登录：supabase.auth.signInWithPassword（邮箱 + 密码）。
//   ✅ 授权：登录成功后调用 rpc('is_admin')；仅当返回 true 才视为已授权管理员。
//   ❌ admin_users 的写仅经 SQL Editor / 迁移脚本 / 服务端；客户端无写入口。
//
// 状态语义（供后台显式展示，禁止静默失败）：
//   authed = 已登录 Supabase Auth
//   authorized = authed 且 is_admin()=true
//   isAuthed() 返回「已授权管理员」（后台所有写/读管理入口以此为准）
// ============================================================

import { AuthProvider } from './auth.js';
import { getSupabase } from './supabaseClient.js';

export class SupabaseAuth extends AuthProvider {
  constructor() {
    super();
    this._sb = null;
    this._user = null;       // { email }
    this._authorized = false;
    this._sessionChecked = false;
    this._authListener = null; // onAuthStateChange 退订函数
    // 授权世代/纪元计数器：每次 auth 事件递增。异步 is_admin() 结果只在它启动时所属的
    // 世代未失效时才可写回，防止「先 logout → 旧的延迟 is_admin 返回 true → 误重新授权」。
    this._authGen = 0;
    // ensureSession 短 TTL 缓存：避免每次后台路由渲染都重跑 getSession + is_admin 网络，
    // 但绝不永久缓存（白名单被吊销后最多 TTL 内仍未检出，过期后必然重新确认）。
    this._cacheTs = 0;
    this._CACHE_TTL_MS = 30_000; // 30s：足够覆盖单次会话内的多次路由切换，又不掩盖吊销
  }

  async _client() {
    if (!this._sb) this._sb = await getSupabase();
    return this._sb;
  }

  /**
   * 校验当前会话是否已授权管理员。
   * @param {boolean} [reconfirm=false] 是否强制忽略缓存重跑（白名单吊销检测用）。
   */
  async _refreshAuthState(reconfirm = false) {
    const sb = await this._client();
    const { data: { session } } = await sb.auth.getSession();
    this._sessionChecked = true;
    if (!session) {
      this._user = null;
      this._authorized = false;
      this._cacheTs = Date.now();
      return;
    }
    this._user = { email: session.user?.email || '' };
    // 真实授权：登录态 + is_admin() 白名单判定
    try {
      const { data, error } = await sb.rpc('is_admin');
      this._authorized = !error && data === true;
      if (!this._authorized) this._user = null; // 非管理员清空，避免悬挂
    } catch (_) {
      this._authorized = false;
      this._user = null;
    }
    this._cacheTs = Date.now();
  }

  /**
   * 订阅 Supabase Auth 状态变化（登录 / 登出 / token 刷新 / 会话失效）。
   * 关键修复（v4 ②）：每次事件递增 _authGen；异步 is_admin() 结果只在它启动时的世代
   * 仍然有效时才写回。SIGNED_OUT / USER_DELETED 立即撤权并使所有更早的异步结果失效。
   * @returns {Promise<void>}
   */
  async _subscribeAuth() {
    const sb = await this._client();
    if (this._authListener) return; // 已订阅，避免重复
    try {
      const { data } = await sb.auth.onAuthStateChange((event, session) => {
        // 每个 auth 事件都开启新的授权世代
        this._authGen++;
        const myGen = this._authGen;
        // SIGNED_OUT / USER_DELETED → 立即撤权，并废掉所有更早的异步授权结果
        if (!session || event === 'SIGNED_OUT' || event === 'USER_DELETED') {
          this._user = null;
          this._authorized = false;
          this._sessionChecked = true;
          this._cacheTs = Date.now();
          return;
        }
        // TOKEN_REFRESHED / SIGNED_IN / INITIAL_SESSION：以最新会话重跑 is_admin 授权
        this._user = { email: session.user?.email || '' };
        // 异步重校验白名单（不阻塞事件回调）。仅当本世代未再被新事件推翻时才写回。
        sb.rpc('is_admin').then(({ data: ok, error }) => {
          if (myGen !== this._authGen) return; // 世代已失效（已登出/新事件）→ 丢弃旧结果
          const valid = !error && ok === true;
          this._authorized = valid;
          if (!valid) this._user = null;
          this._sessionChecked = true;
          this._cacheTs = Date.now();
        }).catch(() => {
          if (myGen !== this._authGen) return; // 同样受世代守卫
          // refresh 失败 / 会话被吊销 → 撤权（绝不允许保留旧授权）
          this._authorized = false;
          this._user = null;
          this._sessionChecked = true;
          this._cacheTs = Date.now();
        });
      });
      this._authListener = data?.subscription || data || null;
    } catch (_) {
      // 订阅不可用不阻断首次检查；一次性检查仍可作为兜底
    }
  }

  /**
   * 管理员登录：邮箱 + 密码（Supabase Auth），随后校验 is_admin()。
   * @param {string} email
   * @param {string} password
   */
  async login(email, password) {
    const sb = await this._client();
    const { data, error } = await sb.auth.signInWithPassword({
      email: (email || '').trim(),
      password: password || '',
    });
    if (error) {
      this._user = null;
      this._authorized = false;
      throw new Error(error.message || '登录失败');
    }
    this._user = { email: data.user?.email || '' };
    // 登录成功仍需白名单授权；非管理员拒绝进入后台
    const chk = await sb.rpc('is_admin');
    if (chk.error || chk.data !== true) {
      // 已登录但非管理员：立即登出，避免悬挂会话
      await sb.auth.signOut();
      this._user = null;
      this._authorized = false;
      throw new Error('该账号不是授权管理员（不在 admin_users 白名单）。');
    }
    this._authorized = true;
    this._sessionChecked = true;
    this._cacheTs = Date.now();
    // 登录即订阅状态变化（捕获后续过期/吊销）
    await this._subscribeAuth();
    return this._user;
  }

  async logout() {
    const sb = await this._client();
    await sb.auth.signOut();
    // 登出使授权世代失效：任何在途的异步 is_admin 结果都不得再写回授权态
    this._authGen++;
    this._user = null;
    this._authorized = false;
    this._sessionChecked = true;
    this._cacheTs = Date.now();
  }

  /** 是否已授权管理员（后台以此为闸门，非仅「已登录」） */
  isAuthed() { return this._authorized; }

  /** 当前用户（已登录即返回；授权态另见 isAuthed） */
  user() { return this._user; }

  /**
   * 仅供后台在渲染前确保会话态已加载（幂等）；并启动状态订阅。
   * v4 ③ 修复：不再永久信任首次 _sessionChecked。采用 30s 短 TTL 缓存：
   *   - 首次或缓存过期 → 重新跑 getSession + is_admin（检出白名单吊销）。
   *   - 缓存命中且会话校验过 → 直接返回（不重复网络请求），但仍保留 onAuthStateChange 实时撤权。
   *   - 任何 SIGNED_OUT / 世代失效都会清掉缓存（_cacheTs 刷新 + _sessionChecked 重算）。
   */
  async ensureSession() {
    const now = Date.now();
    const cacheHit = this._sessionChecked && (now - this._cacheTs) < this._CACHE_TTL_MS;
    if (!cacheHit) {
      await this._refreshAuthState(true);
    }
    // 启动 Auth 状态订阅：此后 token 过期/吊销/登出 都会实时撤权
    await this._subscribeAuth();
    return this._authorized;
  }
}
