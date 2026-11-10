import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildCodeplan, decideLayer, KIND_MODES } from './codeplan.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { pages } = JSON.parse(readFileSync(resolve(__dirname, '__fixtures__/codeplan/pages.json'), 'utf-8'));
const simple = pages[0], cp = pages[1], pollPage = pages[2];
const EXISTING = [
  'src/store/modules/商单管理/商单管理.ts',
  'src/hooks/商单管理/useBaseGenerate.ts',
  'src/layout/index.vue',
];

test('C1 双维简单页 → codeplan:null + reason=dual-simple', () => {
  const r = buildCodeplan(simple, { logicBlocks: [{ name: '查询', evidence: 'pure' }], requirementSignals: [] });
  assert.equal(r.codeplan, null);
  assert.equal(r.reason, 'dual-simple');
});

test('C2 结构复杂: store 复用 / 新 hook / pure→utils / confirmRequired 标记', () => {
  const logicBlocks = [
    { name: '分页加载', evidence: 'side-effect' },
    { name: '查询表单', evidence: 'lifecycle' },
    { name: '状态枚举映射', evidence: 'pure' },
    { name: '模糊业务', evidence: 'uncertain', path: 'src/hooks/商单管理/useXxx.ts' },
  ];
  const r = buildCodeplan(cp, { logicBlocks, existing: EXISTING, feature: '商单管理', layout: { reuse: 'src/layout/index.vue', mode: 'inherit' } });
  assert.ok(r.codeplan, '复杂页应产出 codeplan');
  const layers = r.codeplan.layers;
  // store 已存在于 EXISTING → reuse
  const store = layers.find(l => l.kind === 'store');
  assert.equal(store.mode, 'reuse');
  // lifecycle hook → extend-base(useBaseGenerate 存在)
  const hook = layers.find(l => l.kind === 'hook' && !l.confirmRequired);
  assert.equal(hook.mode, 'extend-base');
  assert.ok(hook.base.endsWith('useBaseGenerate.ts'));
  // pure → utils new
  assert.ok(layers.some(l => l.kind === 'utils' && l.mode === 'new'));
  // uncertain → confirmRequired
  const uc = layers.find(l => l.confirmRequired);
  assert.ok(uc, '判不定应标 confirmRequired 不阻断');
  // layout inherit + page thin-shell
  assert.ok(layers.some(l => l.kind === 'layout' && l.mode === 'inherit'));
  const page = layers.find(l => l.kind === 'page');
  assert.equal(page.mode, 'thin-shell');
  assert.ok(page.path.endsWith('task-manage/task-list/index.vue'));
});

test('C3 逻辑复杂/结构简单: 纯轮询 → store/hook + page', () => {
  const logicBlocks = [
    { name: '任务轮询', evidence: 'shared' },
    { name: '生成编排', evidence: 'lifecycle' },
  ];
  const r = buildCodeplan(pollPage, { logicBlocks, requirementSignals: ['poll-task'], feature: 'poll' });
  assert.ok(r.codeplan);
  const kinds = r.codeplan.layers.map(l => l.kind);
  assert.ok(kinds.includes('store') && kinds.includes('hook') && kinds.includes('page'));
  assert.ok(!kinds.includes('layout'), '无 shell → 不应有 layout 层');
});

test('C5 判不定 evidence → confirmRequired 且不阻断', () => {
  const r = buildCodeplan(cp, { logicBlocks: [{ name: 'x', evidence: 'uncertain' }], requirementSignals: ['shared-state'] });
  assert.ok(r.codeplan);
  assert.ok(r.codeplan.layers.some(l => l.confirmRequired));
});

test('C10 hookMode 降级依赖存在性: 无 base → mode:new', () => {
  const r = buildCodeplan(cp, { logicBlocks: [{ name: '独立流程', evidence: 'lifecycle', path: 'src/hooks/商单管理/useStandalone.ts' }], existing: [], feature: '商单管理' });
  const h = r.codeplan.layers.find(l => l.kind === 'hook');
  assert.equal(h.mode, 'new');
  assert.equal(h.base, undefined);
});

test('limit 超限 → error', () => {
  const blocks = Array.from({ length: 25 }, (_, i) => ({ name: `b${i}`, evidence: 'lifecycle', path: `src/hooks/x/useB${i}.ts` }));
  const r = buildCodeplan(cp, { logicBlocks: blocks, existing: [], feature: 'x', config: { limits: { maxLayersPerPage: 20 } } });
  assert.equal(r.error, 'LIMIT_EXCEEDED_MAX_LAYERS');
});

test('decideLayer 决策树映射', () => {
  assert.deepEqual(decideLayer({ evidence: 'shared' }).kind, 'store');
  assert.deepEqual(decideLayer({ evidence: 'lifecycle' }).kind, 'hook');
  assert.deepEqual(decideLayer({ evidence: 'pure' }).kind, 'utils');
  assert.equal(decideLayer({ evidence: 'private' }), null);
  assert.deepEqual(decideLayer({ evidence: 'associate' }).mode, 'associate');
  assert.ok(decideLayer({ evidence: '???' }).confirmRequired);
});

test('KIND_MODES 契约矩阵', () => {
  assert.deepEqual(KIND_MODES.hook, ['new', 'reuse', 'extend-base', 'compose']);
  assert.deepEqual(KIND_MODES.page, ['thin-shell']);
});