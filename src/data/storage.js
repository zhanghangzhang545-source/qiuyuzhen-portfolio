// ============================================================
// storage.js — 媒体存储接口（对象存储抽象）
// 当前为 Mock 实现（本地预览为 dataURL）。
// 后续接入正式环境时，仅需实现同一接口：
//   - 阿里云 OSS / 腾讯云 COS / AWS S3 / 七牛 Kodo 等
//   - 方法签名保持不变，UI 与数据层无需改动。
// ============================================================

/** 媒体存储统一接口 */
export class MediaStorage {
  /** @param {File} file @returns {Promise<{key:string,url:string,name:string,size:number}>} */
  async upload(/* file */) {
    throw new Error('MediaStorage.upload() 未实现');
  }
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** 本地模拟实现：读为 dataURL，模拟对象存储返回的可用 URL */
export class MockMediaStorage extends MediaStorage {
  /** @param {File} file */
  async upload(file) {
    const url = await readAsDataURL(file);
    return {
      key: `mock/${Date.now()}-${file.name}`,
      url,
      name: file.name,
      size: file.size,
    };
  }

  /**
   * Mock 无私有/公开之分：直接返回传入的 path（即本地 dataURL / 公开 URL），
   * 保持与 Supabase 实现的接口一致（后台预览逻辑统一走 adminPreviewSrc）。
   * @param {string} _bucket
   * @param {string} path
   */
  async signedUrl(_bucket, path) {
    return path;
  }
}
