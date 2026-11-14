import test from 'node:test';
import assert from 'node:assert/strict';
import { validateForwardPlan } from '../lib/forward-plan.mjs';

const d = { id: 'D1', title: '复制工具链到后端', type: 'continuation',
            basis: ['F-032'], confidence: 'high', action: '选 1 个场景做 MVP', status: 'proposed' };

test('accepts a grounded direction', () => {
  assert.equal(validateForwardPlan({ directions: [d] }).ok, true);
});

test('rejects direction without basis', () => {
  const r = validateForwardPlan({ directions: [{ ...d, basis: [] }] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /basis/);
});

test('rejects foresight without industry source marker', () => {
  const r = validateForwardPlan({ directions: [{ ...d, type: 'foresight', basis: ['F-001'] }] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /行业/);
});

test('accepts foresight with industry marker', () => {
  const ok = { ...d, type: 'foresight', basis: ['industry:互联网/AI Agent'] };
  assert.equal(validateForwardPlan({ directions: [ok] }).ok, true);
});

test('rejects unknown type', () => {
  assert.equal(validateForwardPlan({ directions: [{ ...d, type: 'annual' }] }).ok, false);
});
