// ============================================================
// services.js — 全局单例（数据仓储 / 鉴权 / 媒体存储）
// 前台、后台、数据访问共享同一实例，保证后台增删改即时反映到前台。
// 后续接入正式后端时，仅需替换这里的实现（实现相同接口即可）。
// ============================================================
import { MockWorkRepository } from './repository.js';
import { MockAuth } from './auth.js';
import { MockMediaStorage } from './storage.js';

export const repo = new MockWorkRepository();
export const auth = new MockAuth();
export const storage = new MockMediaStorage();
