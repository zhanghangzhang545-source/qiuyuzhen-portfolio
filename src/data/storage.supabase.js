// ============================================================
// storage.supabase.js — Phase 3-C3 真实媒体存储（Supabase Storage）
// ------------------------------------------------------------
// 实现 MediaStorage 接口（storage.js）：
//   - upload(file, opts) → 上传到 portfolio-private bucket（默认）；
//     返回 { key, url, name, size, bucket }。
//   - publicUrl(bucket, path) → 拼接公开 URL（纯客户端，不发请求）。
//   - signedUrl(bucket, path, expiresIn) → 生成带签名的临时访问 URL（只读预览，
//     仅用于 B 后台预览 private 草稿媒体；A 公开前台绝不使用 signed URL）。
//   - remove(bucket, path) → 删除 Storage 对象（仅用于上传失败回滚，UI 不直接调用）。
//   - list(bucket, prefix) → 列举对象（辅助）。
//
// C3 安全纪律（用户指令 + B1 RLS）：
//   ❌ Upload 仅发生在 portfolio-private（默认）；绝不向 portfolio-public 直接写未审核资产。
//   ❌ 不允许客户端绕过：非管理员由 storage_private_all RLS 在后端拒绝。
//   ✅ canonical 翻转（private → public）由 repository 调用 publish_asset RPC 完成
//      （单 PostgreSQL 事务，保证 media_assets + media_variants + 父记录一致）。
//   ❌ 不实现「不可逆删除」：remove 仅供上传失败回滚事务内部使用，C3 不向外部暴露删除入口。
// ============================================================

import { MediaStorage } from './storage.js';
import { getSupabase, hasSupabaseConfig } from './supabaseClient.js';

// B1 仅有两个 bucket（002_rls.sql）
export const PUBLIC_BUCKET = 'portfolio-public';
export const PRIVATE_BUCKET = 'portfolio-private';

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
   * 上传文件到 Storage（默认 portfolio-private）。
   * @param {File} file
   * @param {{bucket?:string, path?:string}} [opts] path 不传则自动生成
   * @returns {Promise<{key:string,url:string,name:string,size:number,bucket:string}>}
   */
  async upload(file, opts = {}) {
    const sb = await this._client();
    const bucket = opts.bucket || PRIVATE_BUCKET;
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
    const sb = await this._client();
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error) throw new Error(`签名 URL 生成失败：${error.message}`);
    if (!data || !data.signedUrl) throw new Error('签名 URL 生成失败：返回为空');
    return data.signedUrl;
  }
}
