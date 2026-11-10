import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCodeplan, validateGroups, pathSafe, detectHookCycle } from './codeplan-validate.mjs';

const validCp = () => ({
  pageId: 'task-list', schemaVersion: '1',
  layers: [
    { mode: 'new', kind: 'store', path: 'src/store/modules/x/x.ts', reason: 'r' },
    { mode: 'extend-base', kind: 'hook', path: 'src/hooks/x/useB.ts', base: 'src/hooks/x/useBaseB.ts', reason: 'r' },
    { mode: 'thin-shell', kind: 'page', path: 'src/views/x/index.vue', reason: 'r' },
    { mode: 'associate', kind: 'api', path: 'src/api/business/x/x-api.ts', reason: 'r' },
  ],
  executionOrder: ['store', 'utils', 'hook', 'component', 'layout', 'page'],
});

test('合法 codeplan → ok', () => {
  const r = validateCodeplan(validCp(), { existing: [] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('C7 kind×mode 非法(store+thin-shell) → CONTRACT_VIOLATION', () => {
  const cp = validCp(); cp.layers[0].mode = 'thin-shell';
  const r = validateCodeplan(cp);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('CONTRACT_VIOLATION')));
});

test('C12 路径逃逸(..) → CONTRACT_PATH_ILLEGAL', () => {
  assert.equal(pathSafe('src/x.ts'), true);
  assert.equal(pathSafe('../x.ts'), false);
  assert.equal(pathSafe('/etc/x'), false);
  assert.equal(pathSafe('C:/x'), false);
  const cp = validCp(); cp.layers[2].path = '../../escape.vue';
  const r = validateCodeplan(cp);
  assert.ok(r.errors.some(e => e.includes('CONTRACT_PATH_ILLEGAL')));
});

test('C6 reuse 路径不存在 → DEP_REUSE_MISSING', () => {
  const cp = validCp(); cp.layers[0].mode = 'reuse'; // store reuse 但 existing 空
  const r = validateCodeplan(cp, { existing: [] });
  assert.ok(r.errors.some(e => e.includes('DEP_REUSE_MISSING')));
});

test('extend-base 缺 base / compose 缺 deps → 条件必填', () => {
  const cp1 = validCp(); delete cp1.layers[1].base;
  assert.ok(validateCodeplan(cp1).errors.some(e => e.includes('extend-base 缺 base')));
  const cp2 = validCp(); cp2.layers[1] = { mode: 'compose', kind: 'hook', path: 'src/hooks/x/useC.ts', reason: 'r' };
  assert.ok(validateCodeplan(cp2).errors.some(e => e.includes('compose 缺 deps')));
});

test('C15 循环依赖 → CONTRACT_CYCLE_DEP', () => {
  const cp = validCp();
  cp.layers = [
    { kind: 'hook', mode: 'compose', path: 'src/hooks/x/useA.ts', deps: ['src/hooks/x/useB.ts'], reason: 'r' },
    { kind: 'hook', mode: 'compose', path: 'src/hooks/x/useB.ts', deps: ['src/hooks/x/useA.ts'], reason: 'r' },
  ];
  cp.executionOrder = ['store', 'utils', 'hook', 'component', 'layout', 'page'];
  const r = validateCodeplan(cp);
  assert.ok(r.errors.some(e => e.includes('CONTRACT_CYCLE_DEP')));
});

test('detectHookCycle 无环直接返回 null', () => {
  assert.equal(detectHookCycle([{ kind: 'hook', path: 'a', base: 'b' }, { kind: 'hook', path: 'b' }]), null);
});

test('validateGroups: members 不存在 / evidence 缺失', () => {
  const r = validateGroups([{ groupId: 'fg_x', members: ['a', 'gone'], evidence: { structuralSimilarity: 0.8 } }], [{ pageId: 'a' }]);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('member 不存在')));
  assert.ok(r.errors.some(e => e.includes('缺 evidence')) === false, 'evidence 存在应通过该项');
});