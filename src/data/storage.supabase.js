// ============================================================
// storage.supabase.js — Phase 3-C3 真实媒体存储（Supabase Storage）
// ------------------------------------------------------------
// 实现 MediaStorage 接口（storage.js）：
//   - upload(file, opts) → 上传到 portfolio-public bucket（默认，Simple AB 模型）；
//     返回 { key, url, name, size, bucket }。
//   - publicUrl(bucket, path) → 拼接公开 URL（纯客户端，不发请求）。
//   - signedUrl(bucket, path, expiresIn) → 生成带签名的临时访问 URL（只读预览，
//     仅用于 B 后台预览「历史遗留」portfolio-private 草稿媒体；新上传一律 public，
//     不再需要 signed URL；A 公开前台绝不使用 signed URL）。
//   - remove(bucket, path) → 删除 Storage 对象（仅用于上传失败回滚，UI 不直接调用）。
//   - list(bucket, prefix) → 列举对象（辅助）。
//
// FINAL16.3-SIMPLE（用户指令 + 外部审计结论）：
//   ✅ 新上传直接进入 portfolio-public（随机不可预测路径）；草稿仅通过 works/certificates
//      的 is_public 标志 + A 公开查询 + A 详情路由隐藏，不要求草稿媒体文件本身强 Storage
//      私密隔离。彻底停止 private↔public 跨 bucket 搬运（含 publish_asset/unpublish_asset/
//      prepare_asset_* RPC 与 browser download→upload）。
//   ✅ 历史遗留 portfolio-private 媒体只读兼容（repository 读取继续兼容两 bucket）。
//   ❌ 不实现「不可逆删除」：remove 仅供上传失败回滚事务内部使用，C3 不向外部暴露删除入口。
// ============================================================

import { MediaStorage } from './storage.js';
import { getSupabase, hasSupabaseConfig } from './supabaseClient.js';

// B1 仅有两个 bucket（002_rls.sql）
export const PUBLIC_BUCKET = 'portfolio-public';
export const PRIVATE_BUCKET = 'portfolio-private';

// P0-11：signed URL 内存缓存（不写 localStorage）。key = `${bucket}:${path}`；
// 同源重复请求在有效期内（≤50 分钟）直接复用，显著降低后台预览的签名请求数。
// path 变化 → miss（保证草稿替换后拿到新 URL）。
const _signedUrlCache = new Map();

export class SupabaseMediaStorage extends MediaStorage {
  constructor(injectedClient = null) {
    super();
    // 与 repository.supabase.js 一致：允许外部注入（仅供自动化测试模拟 Storage 客户端）。
    this._sb = injectedClient;
  }

  async _client() {
    if (!this._sb) this._sb = await getSupabase();
    return this._sb;
  }

  /**
   * 上传文件到 Storage（默认 portfolio-public，Simple AB 模型）。
   * 路径为随机不可预测串（时间戳 + 随机段），避免枚举。
   * @param {File} file
   * @param {{bucket?:string, path?:string}} [opts] path 不传则自动生成
   * @returns {Promise<{key:string,url:string,name:string,size:number,bucket:string}>}
   */
  async upload(file, opts = {}) {
    const sb = await this._client();
    const bucket = opts.bucket || PUBLIC_BUCKET;
    const safeName = String(file.name || 'file').replace(/[^\w.\-]+/g, '_');
    const path = opts.path || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
    const { data, error } = await sb.storage.from(bucket).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw new Error(`Storage 上传失败：${error.message}`);
    const key = (data && data.path) || path;
    return {
      key,
      url: this.publicUrl(bucket, key),
      name: file.name,
      size: file.size,
      bucket,
    };
  }

  /** 拼接公开访问 URL（getPublicUrl 纯客户端，不请求网络） */
  publicUrl(bucket, path) {
    const sb = this._sb;
    return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  /** 列举对象（辅助，用于测试/校验） */
  async list(bucket, prefix = '') {
    const sb = await this._client();
    const { data, error } = await sb.storage.from(bucket).list(prefix);
    if (error) throw new Error(`Storage 列举失败：${error.message}`);
    return data || [];
  }

  /**
   * 删除 Storage 对象（仅用于「上传失败回滚」：DB 写入失败时，把刚上传的
   * private 对象删除，确保不产生悬空 Storage 引用）。
   * C3 不向外部 UI 暴露删除入口；不可逆删除留后续阶段。
   * @param {string} bucket
   * @param {string} path
   */
  async remove(bucket, path) {
    const sb = await this._client();
    const { error } = await sb.storage.from(bucket).remove([path]);
    if (error) throw new Error(`Storage 回滚删除失败：${error.message}`);
    return true;
  }

  /**
   * 生成带签名的临时访问 URL（只读预览，不修改任何对象）。
   * 仅用于 B 后台预览 portfolio-private 中的草稿媒体；A 公开前台绝不使用本方法。
   * @param {string} bucket
   * @param {string} path
   * @param {number} [expiresIn] 有效期秒数（默认 3600）
   * @returns {Promise<string>} signed URL
   */
  async signedUrl(bucket, path, expiresIn = 3600) {
    const key = `${bucket}:${path}`;
    const cached = _signedUrlCache.get(key);
    const now = Date.now();
    // P0-11：命中且未过期（最多 50 分钟复用）→ 直接返回，不发签名请求
    if (cached && cached.exp > now) return cached.url;
    const sb = await this._client();
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error) throw new Error(`签名 URL 生成失败：${error.message}`);
    if (!data || !data.signedUrl) throw new Error('签名 URL 生成失败：返回为空');
    // 缓存：到期时间 = now + min(expiresIn, 3000)s；expiresIn 通常 3600 → 取 50 分钟上限，避免临近过期复用失效 URL
    const ttl = Math.min(expiresIn, 3000) * 1000;
    _signedUrlCache.set(key, { url: data.signedUrl, exp: now + ttl });
    return data.signedUrl;
  }
}
