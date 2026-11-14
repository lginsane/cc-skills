import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreDeck, toMarkdown } from '../scripts/score_deck.mjs';

const judge = { dimensions: [
  { id: 'facts', score: 4 }, { id: 'audience', score: 4 }, { id: 'narrative', score: 4 },
  { id: 'evidence', score: 4 }, { id: 'density', score: 4 }, { id: 'speakability', score: 4 },
  { id: 'visual', score: 4 }, { id: 'distinct', score: 4 }, { id: 'plan', score: 4 }
] };

test('passes at 36 with no low dimension', () => {
  const r = scoreDeck({ ok: true, violations: [] }, judge);
  assert.equal(r.total, 36);
  assert.equal(r.passed, true);
});

test('fails when any dimension below 3', () => {
  const j = JSON.parse(JSON.stringify(judge));
  j.dimensions[2].score = 2;
  const r = scoreDeck({ ok: true, violations: [] }, j);
  assert.equal(r.passed, false);
});

test('fails when rule check has violations', () => {
  const r = scoreDeck({ ok: false, violations: [{ page: 'P02', rule: 'numbers', message: '50% 无来源' }] }, judge);
  assert.equal(r.passed, false);
});

test('lists the lowest dimensions as actions', () => {
  const j = JSON.parse(JSON.stringify(judge));
  j.dimensions[1].score = 3;
  const r = scoreDeck({ ok: true, violations: [] }, j);
  assert.ok(r.actions.some(a => a.includes('audience')));
});

test('no actions when all dimensions are equal', () => {
  const j = { dimensions: Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, score: 5 })) };
  const r = scoreDeck({ ok: true, violations: [] }, j);
  assert.deepEqual(r.actions, []);
});

test('scorecard keeps evidence and adversarial answers', () => {
  const j = { dimensions: [{ id: 'facts', score: 4, evidence: '每个数字有来源' }], adversarial: [{ question: '谁在用', answered: true, where: 'P13' }] };
  const md = toMarkdown(scoreDeck({ ok: true, violations: [] }, j), { ok: true, violations: [] });
  assert.match(md, /每个数字有来源/);
  assert.match(md, /谁在用/);
});
