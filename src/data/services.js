// ============================================================
// services.js — 全局单例（数据仓储 / 鉴权 / 媒体存储）
// ------------------------------------------------------------
// Phase 3-C1：在 Mock 与真实 Supabase 之间切换，且严格遵循：
//   ✅ ?mock=1 强制走 Mock（回滚通道，永远可用）。
//   ✅ 正式模式（无 ?mock=1）：若已配置 SUPABASE_URL + PUBLISHABLE_KEY，则走 Supabase。
//   ✅ 未配置 Supabase（无 config.js 或占位值）→ 安全回退 Mock（非错误，便于本地预览）。
//   ❌ 已配置 Supabase 但网络/鉴权失败 → 不得静默回 Mock；
//      必须显式抛错/展示错误态（由调用方 UI 呈现）。
//
// 切换是「惰性」的：首次调用 repo/auth 方法时才解析实现，
// 这样浏览器端 Supabase JS（CDN ESM）的异步加载不会阻塞首屏脚本解析。
// ============================================================

import { MockWorkRepository } from './repository.js';
import { MockAuth } from './auth.js';
import { MockMediaStorage } from './storage.js';
import { hasSupabaseConfig } from './supabaseClient.js';
// C3：真实 Supabase 媒体存储（按需动态 import，未配置时不加载 Supabase JS）。
import { SupabaseMediaStorage } from './storage.supabase.js';

// —— 模式解析 ——
export const DATA_MODE = { value: 'mock' }; // 'mock' | 'supabase'（运行期由 initDataLayer 设置）

// —— 解析 query string ——
// 支持两种形式：
//   1) search query：  ?mock=1#/admin/login
//   2) hash 内 query： #/admin/login?mock=1   （hash SPA 常见写法）
function parseQueryString(str) {
  try {
    return new URLSearchParams(str);
  } catch (_) {
    return new URLSearchParams('');
  }
}

function forceMockViaQuery() {
  // 1) search query（location.search 不含 hash）
  try {
    if (parseQueryString(location.search).get('mock') === '1') return true;
  } catch (_) { /* ignore */ }

  // 2) hash 内 query：形如 #/path?mock=1 或 #/path?a=b&mock=1
  try {
    const hash = location.hash || '';
    const qi = hash.indexOf('?');
    if (qi >= 0) {
      // hash 中 ? 之后（若有 # 片段则截断，本 SPA 无二级 hash）
      const qs = hash.slice(qi + 1).split('#')[0];
      if (parseQueryString(qs).get('mock') === '1') return true;
    }
  } catch (_) { /* ignore */ }

  return false;
}

async function resolveMode() {
  if (forceMockViaQuery()) return 'mock';
  if (await hasSupabaseConfig()) return 'supabase';
  // 正式部署（构建产物注入了 __FORMAL_DEPLOY__ 标记）必须 fail-closed：
  // 期望 Supabase 却缺失配置 → 显式配置错误，绝不允许静默回退 Mock（避免「看起来上线实则假数据」）。
  // 本地预览（无标记）仍安全回退 Mock，便于无配置时查看界面。
  // 显式回滚通道永远是 ?mock=1（上面已优先拦截）。
  if (isFormalDeploy()) {
    throw new Error(
      'FORMAL DEPLOY 缺少 Supabase 配置：请在部署构件中注入 src/data/config.js（仅 SUPABASE_URL 与 ' +
      'SUPABASE_PUBLISHABLE_KEY 两个公开变量），或用 ?mock=1 显式走 Mock 回滚。'
    );
  }
  return 'mock';
}

/** 是否处于正式部署构件（构建管线注入 window.__FORMAL_DEPLOY__ = true） */
function isFormalDeploy() {
  try { return globalThis.window && globalThis.window.__FORMAL_DEPLOY__ === true; }
  catch (_) { return false; }
}

// —— 惰性代理：在首次调用方法时才解析底层实现 ——
function lazyProxy(factory, interfaceMethods) {
  const obj = { _impl: null, _init: null, _mode: null };
  obj._ensure = async () => {
    // 模式切换检测：若 DATA_MODE 与已缓存实现模式不一致，丢弃旧实现并按新模式重新解析。
    // 支持测试中 ?mock=1 ↔ 正式模式 反复切换（initDataLayer 每次重解析模式）。
    if (obj._impl && obj._mode && DATA_MODE.value && obj._mode !== DATA_MODE.value) {
      obj._impl = null; obj._init = null; obj._mode = null;
    }
    if (obj._impl) return obj._impl;
    if (!obj._init) {
      obj._init = (async () => {
        const mode = await resolveMode();
        DATA_MODE.value = mode;
        // factory 返回 Promise（动态 import().then(...)），必须 await，
        // 否则 _impl 会被存成未解析的 Promise，导致后续 .isAuthed is not a function。
        obj._impl = await factory(mode);
        obj._mode = mode;
        return obj._impl;
      })();
    }
    return obj._init;
  };
  for (const m of interfaceMethods) {
    obj[m] = (...args) => obj._ensure().then((impl) => impl[m](...args));
  }
  return obj;
}

// repo 接口方法（C2 解锁写：create/update/reorderComicPages/updateCertificate；remove 禁用）
// C3 新增媒体写方法（uploadWorkCover / addWorkImage / addComicPage[实化] / replaceComicPageImage /
// replaceCertificateImage / adjustImageSort）；remove 仍禁用，removeComicPage 保留禁用语义。
const REPO_METHODS = [
  'list', 'getById', 'getByType', 'filter', 'stats',
  'create', 'update', 'remove', 'addComicPage', 'removeComicPage', 'removeWorkImage',
  'reorderComicPages', 'resetDemo', 'updateCertificate',
  'uploadWorkCover', 'addWorkImage', 'replaceWorkImage',
  'replaceComicPageImage', 'replaceCertificateImage', 'adjustImageSort',
  // Works 发布生命周期（item 2：草稿 / 发布 / 下架）
  'publishWork', 'unpublishWork',
  // FINAL16.2-A：公开轻量读取（首页 / 作品库摘要，绝不 hydrate 全站媒体）
  'getHomePayload', 'listPublicSummary',
];
// 注意：isAuthed / user 必须「同步」返回（后台多处用 if(auth.isAuthed()) 同步判断），
// 因此不进入异步代理；改为同步委托到底层 impl（未就绪时返回 false/null）。
const AUTH_METHODS = ['login', 'logout', 'ensureSession'];

function buildRepo(mode) {
  if (mode === 'supabase') {
    // 动态 import 避免未配置时加载 Supabase JS
    return import('./repository.supabase.js').then((m) => new m.SupabaseWorkRepository());
  }
  // C2 写回滚通道（#4）：?mock=1 必须显式 writable（destructive delete 仍 disabled）
  return Promise.resolve(new MockWorkRepository({ writable: true }));
}

function buildAuth(mode) {
  if (mode === 'supabase') {
    return import('./auth.supabase.js').then((m) => new m.SupabaseAuth());
  }
  return Promise.resolve(new MockAuth());
}

// About 仓储（关于页数据源）：Mock 与 Supabase 双实现，结构对齐
function buildAbout(mode) {
  if (mode === 'supabase') {
    return import('./about.supabase.js').then((m) => new m.SupabaseAboutRepository());
  }
  // C2 写回滚通道：Mock About 也显式 writable（destructive delete 仍由各方法语义控制）
  return import('./about.mock.js').then((m) => new m.MockAboutRepository({ writable: true }));
}

// About 读写方法（C2 解锁写）：read + readAdmin + 6 表 CRUD/排序，Mock 与 Supabase 同接口。
// #1 修复：readAdmin 必须纳入代理方法列表，否则 aboutRepo.readAdmin 为 undefined（外部复审阻断）。
const ABOUT_METHODS = [
  'read', 'readAdmin', 'updateProfile', 'upsertEducation', 'reorderEducation', 'removeEducation',
  'upsertExperience', 'reorderExperience', 'removeExperience', 'upsertSkill', 'removeSkill', 'reorderSkill',
  'upsertHonor', 'reorderHonor', 'removeHonor', 'upsertContact', 'removeContact', 'reorderContact',
];
export const aboutRepo = lazyProxy(buildAbout, ABOUT_METHODS);

export const repo = lazyProxy(buildRepo, REPO_METHODS);
// C3：媒体存储也走惰性工厂（mock ↔ supabase）。
// C1/C2 阶段 storage 一直为 Mock；C3 起正式模式（已配置 Supabase）走 SupabaseMediaStorage，
// ?mock=1 仍走 Mock 回滚通道（保持可本地预览）。
const STORAGE_METHODS = ['upload', 'publicUrl', 'list', 'remove', 'signedUrl'];
function buildStorage(mode) {
  if (mode === 'supabase') {
    return Promise.resolve(new SupabaseMediaStorage());
  }
  return Promise.resolve(new MockMediaStorage());
}
export const storage = lazyProxy(buildStorage, STORAGE_METHODS);

// auth：异步方法走代理；isAuthed/user 同步委托（后台同步闸门依赖）。
const _authProxy = lazyProxy(buildAuth, AUTH_METHODS);
export const auth = _authProxy;
// 同步委托：未就绪时返回安全默认值（false / null），避免闸门误判。
auth.isAuthed = () => (_authProxy._impl ? _authProxy._impl.isAuthed() : false);
auth.user = () => (_authProxy._impl ? _authProxy._impl.user() : null);

// 后台 stat 辅助：Supabase 仓储 stats() 为异步，这里提供统一异步计算器
export async function computeStats() {
  const works = await repo.list();
  const by = (t) => works.filter((w) => w.type === t).length;
  return {
    total: works.filter((w) => w.type !== 'certificate').length,
    illustration: by('illustration'),
    comic: by('comic'),
    oil: by('oil'),
    certificate: by('certificate'),
    featured: works.filter((w) => w.featured).length,
    hidden: works.filter((w) => w.public === false && w.type !== 'certificate').length,
  };
}

/**
 * 显式初始化数据层（在 main.js 尽早调用）。
 * 解析模式并设置 DATA_MODE；若正式模式且配置异常，仍由后续调用显式抛错，
 * 不会在此静默回 Mock（除「未配置」这种安全回退）。
 *
 * FINAL16.2-A：公开访问（A 前台）只确保公开 repo（首页/作品/关于只读数据）就绪，
 * 不在此预先初始化后台 auth/storage —— 进入 #/admin/* 时由 router.before 按需加载，
 * 避免公开访客无谓下载 Supabase Auth / Storage 相关实现。
 * @returns {Promise<'mock'|'supabase'>}
 */
export async function initDataLayer() {
  // 仅准备公开 repo（repo._ensure 内部已解析并设定 DATA_MODE）
  await repo._ensure();
  return DATA_MODE.value;
}
