// ============================================================
// types.js — 领域模型定义与常量（数据访问层，纯描述，不依赖 UI）
// ============================================================

/**
 * @typedef {Object} Work
 * @property {string} id
 * @property {'illustration'|'comic'|'oil'|'certificate'} type
 * @property {string} title
 * @property {string} intro
 * @property {number|null} year        创作年份（用于“创作时间”筛选）；未提供则为 null，严禁自动回填
 * @property {string} date            'YYYY-MM' 或 'YYYY-MM-DD' 展示用（仅月份时按客户真实月份，不补日）
 * @property {string} stage           创作阶段，如 '学校时期'
 * @property {string[]} tags
 * @property {'original'|'fan'|null} [workNature]  作品性质（仅漫画有）：'original'=原创 / 'fan'=同人；缺失为 null，严禁默认原创
 * @property {number} sort            自定义排序权重
 * @property {boolean} public         是否公开
 * @property {boolean} featured       是否精选
 * @property {string|DemoImage} cover 封面（dataURL / http(s) / Demo 描述符）
 * @property {string[]|DemoImage[]} [images]   插画/油画多图
 * @property {ComicPage[]} [pages]    漫画多页（一部漫画=一个作品）
 * @property {string} [issuer]        证书颁发机构
 * @property {string} [certDate]      证书获得日期
 */

/**
 * @typedef {Object} ComicPage
 * @property {string} id
 * @property {number} order
 * @property {string|DemoImage} image
 */

/** @typedef {{demo:true, seed:string, ratio:string, label:string}} DemoImage */

export const WORK_TYPES = [
  { id: 'illustration', name: '插画',   en: 'Illustration', color: 'var(--cat-illustration)' },
  { id: 'comic',        name: '漫画',   en: 'Comic',        color: 'var(--cat-comic)' },
  { id: 'oil',          name: '油画',   en: 'Oil Painting', color: 'var(--cat-oil)' },
];

// 阶段：依据客户真实教育/创作经历；无依据不填
export const STAGES = ['大学时期', '留学时期', '个人创作'];

// 公开端排序：仅向访客展示这三项。
// （sort-asc / sort-desc 为后台内部排序，仓储层仍支持，但不在此向公开访客暴露）
export const SORT_OPTIONS = [
  { id: 'manual',    name: '编辑精选' },
  { id: 'newest',    name: '最新创作' },
  { id: 'oldest',    name: '最早创作' },
];

// 证书类型仅在「后台 / 关于页」内部展示，不进入公开 Works 类型筛选（WORK_TYPES 不含 certificate）。
// 这里单独把 certificate 映射到中文名，避免 typeName/typeColor 回退成裸 id 'certificate'。
const CERT_NAME = '证书';
const CERT_COLOR = 'var(--cat-certificate)';

export function typeName(id) {
  if (id === 'certificate') return CERT_NAME;
  const t = WORK_TYPES.find((t) => t.id === id);
  return t ? t.name : id;
}

export function typeColor(id) {
  if (id === 'certificate') return CERT_COLOR;
  const t = WORK_TYPES.find((t) => t.id === id);
  return t ? t.color : 'var(--ink-3)';
}
