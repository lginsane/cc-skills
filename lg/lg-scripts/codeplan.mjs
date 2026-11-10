#!/usr/bin/env node

/**
 * lg-scripts/codeplan.mjs — 单页 codeplan 生成(决策树 + 复用/继承标记 + 展开)
 *
 * 输入: page(blueprint 的 page 对象) + opts
 *   opts.logicBlocks[]      [{ name, evidence, path?, customReason? }]
 *   opts.requirementSignals [] 逻辑信号名
 *   opts.existing[]         已存在文件路径(项目扫描/组件映射表)
 *   opts.feature / layout / hookMode / pageDir
 * 输出: { codeplan } 或 { codeplan: null, reason: "dual-simple" } 或 { error }
 *
 * 决策树(§5.1):shared/side-effect→store;lifecycle→hook;pure→utils;private→不拆;
 *              associate→引用已有;uncertain→confirmRequired 不阻断。
 * 复用探测(§7):已存在→reuse;hook 存在 useBaseX→extend-base;layout 命中→inherit。
 */

import { loadConfig } from './codeplan-config.mjs';
import { judgePageComplexity } from './complexity.mjs';
import { pathToFileURL } from 'url';

export const KIND_MODES = {
  store: ['new', 'reuse'],
  utils: ['new', 'reuse'],
  component: ['new', 'reuse'],
  hook: ['new', 'reuse', 'extend-base', 'compose'],
  api: ['associate'],
  constants: ['associate'],
  layout: ['new', 'reuse', 'inherit'],
  page: ['thin-shell'],
};

export const EXECUTION_ORDER_PREFIX = ['constants', 'api'];
export const EXECUTION_ORDER_CORE = ['store', 'utils', 'hook', 'component', 'layout', 'page'];

/** 把一个"逻辑块"映射为 layer(decision tree) */
export function decideLayer(block) {
  switch (block.evidence) {
    case 'shared': return { kind: 'store', reason: '①跨页面共享状态' };
    case 'side-effect': return { kind: 'store', reason: '①任务级副作用(轮询/取消/并发)' };
    case 'lifecycle': return { kind: 'hook', reason: '②响应式状态+生命周期编排' };
    case 'pure': return { kind: 'utils', reason: '③纯函数' };
    case 'private': return null; // ④留在组件内不拆
    case 'associate': return { kind: block.associateKind || 'constants', mode: 'associate', reason: '⑤引用既有产物' };
    case 'uncertain': return { kind: 'hook', confirmRequired: true, reason: '判不定(需人工确认)' };
    default: return { kind: 'hook', confirmRequired: true, reason: '判不定(未知 evidence)' };
  }
}

export function sanitizePath(p) {
  return String(p || '').replace(/\s+/g, '-');
}

/** 默认路径推断 kind→path */
export function inferPath(page, feature, kind, block) {
  if (block?.path) return block.path;
  const f = sanitizePath(feature || page.feature || page.pageId || 'feature');
  const n = sanitizePath(block?.name || kind);
  switch (kind) {
    case 'store': return `src/store/modules/${f}/${f}.ts`;
    case 'utils': return `src/utils/${f}-utils.ts`;
    case 'hook': return `src/hooks/${f}/${n}.ts`;
    case 'component': return `src/components/business/${f}/${n}`;
    case 'api': return `src/api/business/${f}/${f}-api.ts`;
    case 'constants': return `src/constants/business/${f}.ts`;
    case 'layout': return `src/layout/${n}.vue`;
    case 'page': return `src/views/${page.pageDir || page.pageId}/index.vue`;
    default: return `src/${n}`;
  }
}

function pascal(name) {
  return String(name || '').replace(/[^a-zA-Z0-9]/g, ' ').split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('');
}

/** hook reuse 探测:同 feature 下存在 useBase{X} 或对应 useBase */
function findBase(path, feature, existing) {
  const arr = existing instanceof Set ? [...existing] : existing || [];
  const f = sanitizePath(feature || 'feature');
  const re = new RegExp(`src/hooks/${f}/useBase[^/]*\\.ts$`);
  const base = arr.find(p => re.test(p));
  if (base) return base;
  const name = path.split('/').pop().replace(/\.ts$/, '');
  if (name.startsWith('use')) {
    const baseName = `useBase${name.slice(2)}`;
    const cand = `src/hooks/${f}/${baseName}.ts`;
    if (arr.includes(cand)) return cand;
  }
  return null;
}

/**
 * 生成单页 codeplan
 * @returns {{codeplan?: object, reason?: string, error?: string}}
 */
export function buildCodeplan(page, opts = {}) {
  const cfg = loadConfig(opts.config);
  const {
    logicBlocks = [], requirementSignals = [], existing = [], feature,
    layout = null, hookMode = 'factory-inject', pageDir,
  } = opts;

  // 双维判定(与 lg-code 共用同一模块)
  const complexity = judgePageComplexity(page, requirementSignals, opts.config);
  if (!complexity.complex) return { codeplan: null, reason: complexity.reason || 'dual-simple' };

  const existingSet = new Set(existing);
  const layers = [];
  let order = 0;
  const push = (l) => { layers.push({ order: ++order, ...l }); };

  for (const b of logicBlocks || []) {
    const d = decideLayer(b);
    if (!d) continue;
    const path = inferPath(page, feature, d.kind, b);
    const base = { reason: b.customReason || d.reason, path, kind: d.kind };
    if (existingSet.has(path)) {
      push({ ...base, mode: 'reuse', confirmRequired: d.confirmRequired });
      continue;
    }
    if (d.kind === 'hook') {
      const basePath = findBase(path, feature, existingSet);
      if (basePath) {
        push({ ...base, mode: 'extend-base', base: basePath, confirmRequired: d.confirmRequired });
        continue;
      }
    }
    const layer = { ...base, mode: d.mode || 'new' };
    if (d.confirmRequired) layer.confirmRequired = true;
    push(layer);
  }

  // layout
  if (layout) {
    if (layout.mode === 'inherit') push({ kind: 'layout', mode: 'inherit', path: layout.reuse, reason: 'layout-整体继承(零生成)' });
    else if (existingSet.has(layout.reuse)) push({ kind: 'layout', mode: 'reuse', path: layout.reuse, reason: 'layout-组件映射命中' });
    else push({ kind: 'layout', mode: 'new', path: layout.reuse, reason: 'layout-首建(layout-candidate)' });
  }

  // page 薄壳
  push({ kind: 'page', mode: 'thin-shell', path: `src/views/${pageDir || page.pageDir || page.pageId}/index.vue`, reason: '⑥薄壳组装(仅 template+computed)' });

  if (layers.length > (cfg.limits?.maxLayersPerPage ?? 20)) {
    return { error: 'LIMIT_EXCEEDED_MAX_LAYERS', reason: `layers=${layers.length} 超过上限 ${cfg.limits.maxLayersPerPage}` };
  }

  return {
    codeplan: {
      pageId: page.pageId,
      feature: feature || page.feature || page.pageName || '',
      schemaVersion: '1',
      complexity,
      layout,
      hookMode,
      layers,
      executionOrder: [...EXECUTION_ORDER_PREFIX, ...EXECUTION_ORDER_CORE],
    },
  };
}

// CLI: echo '{"page":{...},"opts":{...}}' | node codeplan.mjs
const readStdin = () => new Promise((res, rej) => { const c = []; process.stdin.setEncoding('utf8'); process.stdin.on('data', d => c.push(d)); process.stdin.on('end', () => res(JSON.parse(c.join('')))); process.stdin.on('error', rej); });
async function main() {
  const { page, opts = {} } = await readStdin();
  console.log(JSON.stringify(buildCodeplan(page, opts), null, 2));
}
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main().catch(e => { console.error(e.message); process.exit(1); });