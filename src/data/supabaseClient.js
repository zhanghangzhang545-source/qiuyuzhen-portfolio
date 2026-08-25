// ============================================================
// supabaseClient.js — 浏览器端 Supabase 客户端（Phase 3-C1）
// ------------------------------------------------------------
// 安全边界（架构 Final-3.2a）：
//   ✅ 前端只持有 SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY（anon public，可暴露）。
//   ❌ 绝不持有 service_role / DB 密码 / JWT secret —— 这些只在用户本机
//      终端（SUPABASE_DB_URL 等）或服务端使用，永不进源码/浏览器/Git/构建产物。
//   ✅ 真实写权限由 RLS + is_admin() 守卫；客户端即便拿到 publishable key，
//      非白名单用户的所有写请求都会被 RLS 拒绝。
//
// 本地 ESM 静态站点（无打包器）下，@supabase/supabase-js 经由浏览器原生 ESM CDN 引入；
// 锁定具体版本（固定 tag），避免 CDN 漂移导致行为变化。
// 若日后引入打包器，可改为 `import { createClient } from '@supabase/supabase-js';`
// ============================================================

// 固定版本，避免 CDN 漂移
const SUPABASE_JS_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm';

let _clientPromise = null;

/**
 * 取得浏览器端 Supabase 客户端单例。
 * 仅在「正式模式」（?mock=1 未开启 且 config.js 已配置）下调用。
 * @returns {Promise<import('@supabase/supabase-js').SupabaseClient>}
 */
export async function getSupabase() {
  if (_clientPromise) return _clientPromise;

  let config;
  try {
    config = await import('./config.js');
  } catch (e) {
    throw new Error(
      '前端未配置 Supabase：请将 src/data/config.js.example 复制为 src/data/config.js 并填入 ' +
      'SUPABASE_URL 与 SUPABASE_PUBLISHABLE_KEY（仅公开变量）。配置前可用 ?mock=1 走 Mock 通道。'
    );
  }

  const url = (config.SUPABASE_URL || '').trim();
  const key = (config.SUPABASE_PUBLISHABLE_KEY || '').trim();

  if (!url || !key || url.includes('YOUR-PROJECT') || key.includes('your-anon')) {
    throw new Error(
      '前端 Supabase 配置不完整：请在 src/data/config.js 填入真实的 SUPABASE_URL 与 SUPABASE_PUBLISHABLE_KEY。'
    );
  }

  const mod = await import(/* @vite-ignore */ SUPABASE_JS_CDN);
  const createClient = mod.createClient;
  if (typeof createClient !== 'function') {
    throw new Error('Supabase JS 加载异常：createClient 不可用（CDN 可达性？）。');
  }

  _clientPromise = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return _clientPromise;
}

/** 是否已显式配置了真实 Supabase（用于 services 层选择实现 / 显示错误态） */
export async function hasSupabaseConfig() {
  try {
    const config = await import('./config.js');
    const url = (config.SUPABASE_URL || '').trim();
    const key = (config.SUPABASE_PUBLISHABLE_KEY || '').trim();
    return !!url && !!key && !url.includes('YOUR-PROJECT') && !key.includes('your-anon');
  } catch (_) {
    return false;
  }
}
