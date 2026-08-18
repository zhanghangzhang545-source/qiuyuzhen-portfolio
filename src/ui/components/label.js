// ============================================================
// label.js — 作品展签 / 编辑杂志 Caption 组件
//  统一“美术馆展签 / 编辑杂志”语言：
//    细线 + 编号 + 大标题 + 极小辅助文字
//  不使用卡片背景；不虚构任何客户信息（年份/地点/材质/项目性质/获奖均来自真实数据）。
// ============================================================
import { h } from '../../core/dom.js';

/**
 * 作品性质 → 展签辅助文字（单一来源，严禁通过标题硬编码判断）。
 *  原创漫画（workNature === 'original'） → 'ORIGINAL COMIC'
 *  同人 / Fan Work（workNature === 'fan'） → 'FAN WORK'
 *  性质缺失 / 未确认（undefined / null） → 'COMIC'（中性表述，严禁自动声明原创）
 *  插画 / 油画 / 证书 → 对应 ORIGINAL 标记
 * 依赖数据层真实字段 work.workNature（'original' | 'fan' | null）。
 */
export function natureSub(work) {
  if (work.type === 'comic') {
    if (work.workNature === 'original') return 'ORIGINAL COMIC';
    if (work.workNature === 'fan') return 'FAN WORK';
    // 未提供 / 未确认性质 → 中性表述，严禁自动声明原创
    return 'COMIC';
  }
  const MAP = { illustration: 'ORIGINAL WORK', oil: 'ORIGINAL WORK', certificate: 'CERTIFICATE' };
  return MAP[work.type] || 'ORIGINAL WORK';
}

/**
 * @param {{ num?:string, en:string, title:string, sub?:string, compact?:boolean }} o
 *   num      章节内序号，如 '01'（可选）
 *   en       英文大写字类目，如 'ILLUSTRATION' / 'COMIC' / 'OIL PAINTING'
 *   title    作品中文/英文标题（真实）
 *   sub      极小辅助文字（真实，如 'ORIGINAL WORK' / '2026 · ORIGINAL COMIC'）。
 *           无真实年份则不要传入年份。
 *   compact  两级系统 B 级（普通 Archive 作品）：仅 标题 + 类目，
 *            不显示编号 / 长细线 / ORIGINAL WORK / VIEW PROJECT。
 */
export function workLabel({ num, en, title, sub, compact }) {
  if (compact) {
    return h('div', { class: 'work-label work-label--compact' }, [
      h('h3', { class: 'work-label__title serif' }, title),
      h('span', { class: 'work-label__cat' }, en),
    ]);
  }
  const top = num
    ? h('div', { class: 'work-label__top' }, [
        h('span', { class: 'work-label__idx' }, num),
        h('span', { class: 'work-label__cat' }, en),
      ])
    : h('div', { class: 'work-label__top' }, [
        h('span', { class: 'work-label__cat' }, en),
      ]);
  return h('div', { class: 'work-label' }, [
    h('span', { class: 'work-label__rule' }),
    top,
    h('h3', { class: 'work-label__title serif' }, title),
    sub ? h('span', { class: 'work-label__sub' }, sub) : null,
    h('span', { class: 'work-label__view' }, ['VIEW PROJECT', h('span', {}, '→')]),
  ]);
}
