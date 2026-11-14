import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOutline } from '../lib/outline.mjs';

const page = { id: 'P01', title: '一年做了 774 条', core: '交付量', facts: ['F-001'], visual: 'bar', seconds: 75 };

test('accepts 16 pages for 20 minutes', () => {
  const o = { audience: 'colleagues+leaders', weights: { colleagues: 6, leaders: 3, growth: 1 },
              pages: Array.from({ length: 16 }, (_, i) => ({ ...page, id: `P${i + 1}` })) };
  assert.equal(validateOutline(o, { durationMin: 20, factIds: new Set(['F-001']) }).ok, true);
});

test('rejects too many pages for 20 minutes', () => {
  const o = { audience: 'colleagues', weights: {}, pages: Array.from({ length: 30 }, (_, i) => ({ ...page, id: `P${i + 1}` })) };
  const r = validateOutline(o, { durationMin: 20, factIds: new Set(['F-001']) });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /页数/);
});

test('rejects unknown fact reference', () => {
  const o = { audience: 'colleagues', weights: {}, pages: [{ ...page, facts: ['F-999'] }] };
  assert.equal(validateOutline(o, { durationMin: 20, factIds: new Set(['F-001']) }).ok, false);
});

test('rejects 3-minute deck over 10 pages', () => {
  const o = { audience: 'company', weights: {}, pages: Array.from({ length: 12 }, (_, i) => ({ ...page, id: `P${i + 1}` })) };
  assert.equal(validateOutline(o, { durationMin: 3, factIds: new Set(['F-001']) }).ok, false);
});

test('rejects total seconds far from target', () => {
  const o = { audience: 'colleagues', weights: {}, pages: Array.from({ length: 16 }, (_, i) => ({ ...page, id: `P${i + 1}`, seconds: 10 })) };
  const r = validateOutline(o, { durationMin: 20, factIds: new Set(['F-001']) });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /时长/);
});

test('appendix pages do not count toward page or time limits', () => {
  const main = Array.from({ length: 18 }, (_, i) => ({ ...page, id: `P${i + 1}`, seconds: 65 }));
  const appendix = [{ ...page, id: 'A01', seconds: 0, appendix: true }];
  const o = { audience: 'colleagues', weights: {}, pages: [...main, ...appendix] };
  assert.equal(validateOutline(o, { durationMin: 20, factIds: new Set(['F-001']) }).ok, true);
});
