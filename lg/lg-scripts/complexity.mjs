#!/usr/bin/env node

/**
 * lg-scripts/complexity.mjs — 双维复杂页判定(Skill 必做,确定性逻辑)
 *
 * 结构复杂(DSL):sections>8 / zones>1 / overlays / repeatables / shell-zone
 * 逻辑复杂(需求信号):poll-task / shared-state / lifecycle-orchestration / cancel-concurrent / multi-step
 *
 * 判定结果沉淀为 codeplan.complexity,供 lg-dsl/lg-code 共用(防止两处不一致)。
 * 与 lg-code 消费方共用同一模块:lg-code 运行时不再重判,只读 blueprint.complexity。
 */

import { loadConfig } from './codeplan-config.mjs';
import { fileURLToPath, pathToFileURL } from 'url';
import { resolve } from 'path';

export const LOGICAL_SIGNAL_ENUM = [
  'poll-task', 'shared-state', 'lifecycle-orchestration', 'cancel-concurrent', 'multi-step',
];

/**
 * 结构复杂判定(输入:blueprint 的单个 page 对象)
 * @returns {{complex: boolean, signals: string[]}}
 */
export function judgeStructuralComplexity(page, cfg = {}) {
  const sectionMax = Number(cfg.sectionMax) || 8;
  const signals = [];
  if ((page?.totalSections ?? 0) > sectionMax) signals.push(`sections>${sectionMax}`);
  if ((page?.zones ?? []).length > 1) signals.push('zones>1');
  if ((page?.overlays ?? []).length > 0) signals.push('overlay');
  if ((page?.repeatables ?? []).length > 0) signals.push('repeatable');
  if ((page?.zones ?? []).some(z => z.kind === 'shell')) signals.push('shell-zone');
  return { complex: signals.length > 0, signals };
}

/**
 * 逻辑复杂判定(输入:需求数据抽出的信号名数组)
 * - 空数组 / 含未知信号 → degraded(降级),complex 由已知信号决定
 * @returns {{complex, signals, degraded, unknown, reason}}
 */
export function judgeLogicalComplexity(signalList) {
  const list = Array.isArray(signalList) ? signalList : [];
  const signals = list.filter(s => LOGICAL_SIGNAL_ENUM.includes(s));
  const unknown = list.filter(s => !LOGICAL_SIGNAL_ENUM.includes(s));
  const degraded = list.length === 0 || unknown.length > 0;
  const reason = list.length === 0
    ? 'signal-missing-degrade'
    : (unknown.length > 0 ? 'signal-unknown-degrade' : null);
  return { complex: signals.length > 0, signals, degraded, unknown, reason };
}

/**
 * 双维判定的总入口:返回 page 的复杂度结论(codeplan 是否产出)
 * @returns {{complex, structural, logical}}
 */
export function judgePageComplexity(page, requirementSignals, override = {}) {
  const cfg = loadConfig(override);
  const structural = judgeStructuralComplexity(page, cfg.structural);
  const logical = judgeLogicalComplexity(requirementSignals);
  return {
    complex: structural.complex || logical.complex,
    structural,
    logical,
    reason: structural.complex || logical.complex ? null : 'dual-simple',
  };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  // 用法: echo '{"page":{...},"signals":[...]}' | node complexity.mjs（待实现；库函数供测试与 lg-dsl 调用）
  const readStdin = () => new Promise((res, rej) => { const c = []; process.stdin.setEncoding('utf8'); process.stdin.on('data', d => c.push(d)); process.stdin.on('end', () => res(JSON.parse(c.join('')))); process.stdin.on('error', rej); });
  readStdin().then(i => { const r = judgePageComplexity(i.page, i.signals); console.log(JSON.stringify(r, null, 2)); }).catch(e => { console.error(e.message); process.exit(1); });
}