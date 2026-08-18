// ============================================================
// auth.js — 管理员鉴权接口（当前为单管理员 Mock 实现）
// 后续可替换为 OAuth / 后端会话 / JWT 等，保持接口不变。
// ============================================================

const DEMO_ADMIN = { username: 'admin', password: 'demo1234' }; // Demo 单管理员，上线前务必替换

/** 鉴权统一接口 */
export class AuthProvider {
  async login(/* username, password */) { throw new Error('not implemented'); }
  async logout() {}
  isAuthed() { return false; }
  user() { return null; }
}

export class MockAuth extends AuthProvider {
  constructor() {
    super();
    this._key = 'portfolio.admin.session.v1';
    this._user = null;
    try {
      const s = localStorage.getItem(this._key);
      if (s) this._user = JSON.parse(s);
    } catch (_) { /* ignore */ }
  }

  /** @param {string} username @param {string} password */
  async login(username, password) {
    if (username === DEMO_ADMIN.username && password === DEMO_ADMIN.password) {
      this._user = { username };
      localStorage.setItem(this._key, JSON.stringify(this._user));
      return this._user;
    }
    throw new Error('用户名或密码错误（Demo 账号：admin / demo1234）');
  }

  async logout() {
    this._user = null;
    localStorage.removeItem(this._key);
  }

  isAuthed() { return !!this._user; }
  user() { return this._user; }
}
