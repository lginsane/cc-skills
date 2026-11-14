import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNumbers, validateSlides } from '../lib/slides.mjs';

const fact = { id: 'F-001', claim: '2026 年创建工作项 774 条', value: 774 };
const s = { id: 'P01', title: '一年做了 774 条', bullets: ['覆盖 4 个项目'], notes: '讲述稿', seconds: 45, facts: ['F-001'], allowedNumbers: ['4'] };

test('extractNumbers finds Chinese and percent forms', () => {
  assert.deepEqual(extractNumbers('774条，97.9%，30%-40%'), ['774', '97.9%', '30%', '40%']);
});

test('extractNumbers ignores years and dates', () => {
  assert.deepEqual(extractNumbers('2026-01-01 共 758 条'), ['758']);
});

test('accepts a valid slide', () => {
  assert.equal(validateSlides([s], { facts: [fact] }).ok, true);
});

test('rejects more than 5 bullets', () => {
  const r = validateSlides([{ ...s, bullets: ['1','2','3','4','5','6'] }], { facts: [fact] });
  assert.equal(r.ok, false);
});

test('rejects a number not covered by facts', () => {
  const r = validateSlides([{ ...s, bullets: ['提升 50%'] }], { facts: [fact] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /50%/);
});

test('rejects missing notes', () => {
  const r = validateSlides([{ ...s, notes: '' }], { facts: [fact] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /notes/);
});

test('rejects a number covered only by another slide fact', () => {
  const other = { id: 'F-002', claim: '其他页才有 999 条', value: 999 };
  const r = validateSlides([{ ...s, facts: [], bullets: ['999 条'] }], { facts: [fact, other] });
  assert.equal(r.ok, false);
});

test('rejects a data-like allowedNumbers entry', () => {
  const r = validateSlides([{ ...s, bullets: ['提升 50%'], allowedNumbers: ['50%'] }], { facts: [fact] });
  assert.equal(r.ok, false);
});

test('rejects uncovered chart values', () => {
  const r = validateSlides([{ ...s, chart: { labels: ['x'], values: [9999] } }], { facts: [fact] });
  assert.equal(r.ok, false);
});

test('rejects uncovered numbers in notes', () => {
  const r = validateSlides([{ ...s, notes: '利润增长 999%' }], { facts: [fact] });
  assert.equal(r.ok, false);
});

test('rejects uncovered numbers in timeline items', () => {
  const r = validateSlides([{ ...s, items: ['完成 999 个'] }], { facts: [fact] });
  assert.equal(r.ok, false);
});
