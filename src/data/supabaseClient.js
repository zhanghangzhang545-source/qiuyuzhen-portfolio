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
// FINAL16.3-SIMPLE：@supabase/supabase-js 已本地 vendor 化（见 index.html 的
// vendor/supabase-js@2.112.3.umd.js defer 脚本，浏览器全局 window.supabase）。
// 不再运行时从 jsDelivr 动态 import，彻底消除中国大陆/移动网络 CDN 波动对后台的影响。
// 固定版本 2.112.3（UMD 自包含，语义不变）。若日后引入打包器可改回 ESM import。
// ============================================================

// 固定版本，与 vendor 文件一致（仅供诊断/日志显示，不再用于运行时加载）
const SUPABASE_JS_VERSION = '2.112.3';

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

  // 本地 vendor 全局（index.html 中的 defer 脚本应在本模块执行前已就绪）
  let createClient = globalThis.supabase && globalThis.supabase.createClient;
  if (typeof createClient !== 'function') {
    // 兜底：极少数情况下 defer 脚本尚未就绪，短暂等待后再探测一次
    for (let i = 0; i < 10 && typeof createClient !== 'function'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      createClient = globalThis.supabase && globalThis.supabase.createClient;
    }
  }
  if (typeof createClient !== 'function') {
    throw new Error(
      'Supabase JS 尚未就绪：本地 vendor/supabase-js@' + SUPABASE_JS_VERSION +
      '.umd.js 未能提供 window.supabase.createClient（文件缺失或被拦截？）。'
    );
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
