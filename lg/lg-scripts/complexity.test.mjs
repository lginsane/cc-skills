import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { judgeStructuralComplexity, judgeLogicalComplexity, judgePageComplexity } from './complexity.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { pages } = JSON.parse(readFileSync(resolve(__dirname, '__fixtures__/codeplan/pages.json'), 'utf-8'));
const simple = pages[0], complexPage = pages[1], pollPage = pages[2];

test('C1 简单页: 结构+逻辑均不复杂 → dual-simple', () => {
  const s = judgeStructuralComplexity(simple);
  assert.equal(s.complex, false);
  assert.deepEqual(s.signals, []);
  const l = judgeLogicalComplexity([]);
  assert.equal(l.complex, false);
  const all = judgePageComplexity(simple, []);
  assert.equal(all.complex, false);
  assert.equal(all.reason, 'dual-simple');
});

test('C2 结构复杂: 命中 zones>1/overlay/repeatable/shell', () => {
  const r = judgeStructuralComplexity(complexPage);
  assert.equal(r.complex, true);
  assert.ok(r.signals.includes('zones>1'));
  assert.ok(r.signals.includes('overlay'));
  assert.ok(r.signals.includes('repeatable'));
  assert.ok(r.signals.includes('shell-zone'));
});

test('C3 逻辑复杂/结构简单: 纯轮询触发 logical', () => {
  assert.equal(judgeStructuralComplexity(pollPage).complex, false);
  const r = judgeLogicalComplexity(['poll-task', 'load-more']);
  assert.equal(r.complex, true);
  assert.ok(r.signals.includes('poll-task'));
  assert.ok(r.degraded, '含未知信号应 degraded');
  assert.deepEqual(r.unknown, ['load-more']);
});

test('C4 信号缺失降级: 空数组 → signal-missing-degrade, 不影响结构维', () => {
  const r = judgeLogicalComplexity([]);
  assert.equal(r.degraded, true);
  assert.equal(r.reason, 'signal-missing-degrade');
  assert.equal(r.complex, false);
  const all = judgePageComplexity(complexPage, []);
  assert.equal(all.complex, true, '结构复杂页在逻辑信号缺失时仍为 complex');
});

test('judgeLogicalComplexity 未知信号组合', () => {
  const r = judgeLogicalComplexity(['??', 'shared-state']);
  assert.equal(r.complex, true);
  assert.equal(r.reason, 'signal-unknown-degrade');
});