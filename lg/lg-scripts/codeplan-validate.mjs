#!/usr/bin/env node

/**
 * lg-scripts/codeplan-validate.mjs — codeplan/featureGroups 契约校验(Skill 必做)
 *
 * 校验项(v3 §2.3/§2.1 条件必填/§10.1 路径白名单/§4.1 循环依赖/§2.5 错误码):
 *   1) kind×mode 合法矩阵
 *   2) 条件必填:extend-base→base;compose→deps;inherit→path;reuse→existing 存在
 *   3) 路径白名单:`src/**` 内;禁绝对/`..`
 *   4) hook 层循环依赖(base/deps 图)
 *   5) featureGroups:members 存在、evidence 齐备、confirmRequired 与门限一致
 *
 * 输出:errors[]/warnings[] + ok(阻断级 exit:ok?0:1)
 */

import { pathToFileURL } from 'url';
import { KIND_MODES, EXECUTION_ORDER_PREFIX, EXECUTION_ORDER_CORE } from './codeplan.mjs';
import { loadConfig } from './codeplan-config.mjs';

export const ERR = {
  CONTRACT_VIOLATION: 'CONTRACT_VIOLATION',
  CONTRACT_CYCLE_DEP: 'CONTRACT_CYCLE_DEP',
  CONTRACT_PATH_ILLEGAL: 'CONTRACT_PATH_ILLEGAL',
  DEP_REUSE_MISSING: 'DEP_REUSE_MISSING',
  CLUSTER_EVIDENCE_MISSING: 'CLUSTER_EVIDENCE_MISSING',
};

/** 检查 path 是否在白名单约束内 */
export function pathSafe(p) {
  if (!p) return true; // 缺 path 由必填校验管
  if (/^(\.\.|[/\\])/.test(p) || /^[a-zA-Z]:/.test(p)) return false; // 相对逃逸/绝对路径/盘符
  if (p.includes('..')) return false;
  return true;
}

/** hook 层循环依赖检测:返回环路径(如 ['a -> b -> a']),无环返回 null */
export function detectHookCycle(layers) {
  const hooks = layers.filter(l => l.kind === 'hook');
  const name = (p) => String(p || '').split('/').pop().replace(/\.ts$/, '');
  const depsOf = (l) => {
    const d = [];
    if (l.base) d.push(l.base);
    (l.deps || []).forEach(x => d.push(x));
    return d;
  };
  const graph = new Map();
  hooks.forEach(h => graph.set(h.path, depsOf(h)));
  const state = new Map(); // 0=未访问,1=栈中,2=完成
  const stack = [];
  const visit = (p) => {
    state.set(p, 1);
    stack.push(name(p));
    for (const dep of graph.get(p) || []) {
      if (!graph.has(dep)) continue;
      if (state.get(dep) === 1) {
        const idx = stack.indexOf(name(dep));
        const cycle = [...stack.slice(idx), name(dep)];
        stack.pop();
        state.set(p, 2);
        return cycle;
      }
      if (!state.get(dep)) {
        const c = visit(dep);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(p, 2);
    return null;
  };
  for (const p of graph.keys()) {
    if (!state.get(p)) {
      const c = visit(p);
      if (c) return c;
    }
  }
  return null;
}

/** 校验单个 codeplan;existing 为路径列表(项目现状) */
export function validateCodeplan(codeplan, { existing = [], override = {} } = {}) {
  const cfg = loadConfig(override);
  const errors = [];
  const warnings = [];
  if (!codeplan || typeof codeplan !== 'object') return { ok: false, code: 'CONTRACT_VIOLATION', errors: ['codeplan 为空/非对象'], warnings };
  if (codeplan.schemaVersion !== '1') errors.push(`${ERR.CONTRACT_VIOLATION} schemaVersion=${codeplan.schemaVersion} 不支持`);

  const existingSet = new Set(existing);
  for (const l of codeplan.layers || []) {
    const allowed = KIND_MODES[l.kind];
    if (!allowed) { errors.push(`${ERR.CONTRACT_VIOLATION} kind 非法:${l.kind}`); continue; }
    if (!allowed.includes(l.mode)) { errors.push(`${ERR.CONTRACT_VIOLATION} kind×mode 非法:${l.kind}+${l.mode}`); continue; }
    // 条件必填
    if (l.mode === 'extend-base' && !l.base) errors.push(`${ERR.CONTRACT_VIOLATION} extend-base 缺 base:${l.path}`);
    if (l.mode === 'compose' && !Array.isArray(l.deps)) errors.push(`${ERR.CONTRACT_VIOLATION} compose 缺 deps:${l.path}`);
    if (l.mode === 'reuse' && !existingSet.has(l.path)) errors.push(`${ERR.DEP_REUSE_MISSING} reuse 路径不存在:${l.path}`);
    if (l.mode === 'inherit' && !l.path) errors.push(`${ERR.CONTRACT_VIOLATION} inherit 缺复用路径`);
    // 路径白名单
    if (!pathSafe(l.path)) errors.push(`${ERR.CONTRACT_PATH_ILLEGAL} 路径逃逸:${l.path}`);
    else if (!String(l.path || '').startsWith('src/')) warnings.push(`PATH 非 src/ 前缀:${l.path}(${l.kind})`);
    if (!l.reason) errors.push(`${ERR.CONTRACT_VIOLATION} 缺 reason:${l.path}`);
    if (l.kind !== 'page' && l.kind !== 'constants' && l.kind !== 'api' && !cfg.limits?.exportsDisabled && String(l.path || '').length > 0 && !/\.(?:ts|vue)$/.test(l.path)) {
      warnings.push(`PATH 疑缺扩展名:${l.path}(${l.kind})`);
    }
  }
  // 执行顺序:应包含核心生成全集(前序依赖可缺,associate 不生成)
  const corePresent = (codeplan.executionOrder || []).filter(k => EXECUTION_ORDER_CORE.includes(k));
  if (!EXECUTION_ORDER_CORE.every(k => corePresent.includes(k))) {
    errors.push(`${ERR.CONTRACT_VIOLATION} executionOrder 缺核心生成类全集`);
  }
  // 循环依赖
  const cycle = detectHookCycle(codeplan.layers || []);
  if (cycle) errors.push(`${ERR.CONTRACT_CYCLE_DEP} 循环依赖:${cycle.join(' -> ')}`);

  return { ok: errors.length === 0, errors, warnings };
}

/** 校验 featureGroups(与 codeplans 关系、evidence、members 存在性) */
export function validateGroups(groups, pages = [], override = {}) {
  const errors = [];
  const warnings = [];
  const cfg = loadConfig(override);
  const pageIds = new Set(pages.map(p => p.pageId));
  for (const g of groups || []) {
    if (!g.groupId || !Array.isArray(g.members) || g.members.length < 2) errors.push(`${ERR.CONTRACT_VIOLATION} group 结构非法:${g.groupId}`);
    for (const m of g.members || []) if (!pageIds.has(m)) errors.push(`CLUSTER member 不存在:${m}`);
    if (!g.evidence || typeof g.evidence.structuralSimilarity !== 'number') errors.push(`${ERR.CLUSTER_EVIDENCE_MISSING} 缺 evidence:${g.groupId}`);
    const auto = cfg.similarity?.autoThreshold ?? 0.7;
    if (g.confirmRequired === (g.similarity >= auto)) warnings.push(`CLUSTER confirmRequired 与门限不一致:${g.groupId} sim=${g.similarity} auto=${auto}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

const readStdin = () => new Promise((res, rej) => { const c = []; process.stdin.setEncoding('utf8'); process.stdin.on('data', d => c.push(d)); process.stdin.on('end', () => res(JSON.parse(c.join('')))); process.stdin.on('error', rej); });
async function main() {
  const { codeplan, groups, pages, existing, override } = await readStdin();
  const out = [];
  if (codeplan) out.push(validateCodeplan(codeplan, { existing, override }));
  if (groups) out.push(validateGroups(groups, pages, override));
  const first = out[0];
  console.log(JSON.stringify(out, null, 2));
  process.exit(first?.ok ? 0 : 1);
}
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main().catch(e => { console.error(e.message); process.exit(1); });