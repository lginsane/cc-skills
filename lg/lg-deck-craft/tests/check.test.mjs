import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkDeck, writeReport } from '../scripts/check_deck.mjs';

function fact(id, claim, value, caliber, extra = {}) {
  return { id, claim, value, unit: '条', caliber, source: 'x.md', owner: '梁傲',
           verified: true, verification_level: 'cross_checked', confidence: 'high',
           category: 'delivery', audience: ['leaders'], ...extra };
}

async function workdir({ facts, pages, plan, slideOverride } = {}) {
  const w = await mkdtemp(path.join(tmpdir(), 'check-'));
  await mkdir(path.join(w, '05-slides'), { recursive: true });
  const baseFacts = facts || [fact('F-001', '创建 774 条', 774, 'created', { metric: 'workitems_total' }),
                              fact('F-029', '闭环 765 条', 765, 'closed', { metric: 'workitems_total' })];
  await writeFile(path.join(w, '01-facts.json'), JSON.stringify(baseFacts));
  const pgs = pages || Array.from({ length: 16 }, (_, i) => ({
    id: `P${String(i + 1).padStart(2, '0')}`, title: '页面', core: '核心', facts: ['F-001'], visual: 'content', seconds: 75
  }));
  await writeFile(path.join(w, '03-outline.json'), JSON.stringify({ audience: 'colleagues', durationMin: 20, weights: {}, pages: pgs }));
  if (plan) await writeFile(path.join(w, '04-forward-plan.json'), JSON.stringify(plan));
  for (const p of pgs) {
    const s = slideOverride?.(p) || { id: p.id, title: p.title, bullets: ['774 条'], notes: '讲述稿', seconds: p.seconds, facts: p.facts, allowedNumbers: [] };
    await writeFile(path.join(w, '05-slides', `${p.id}.json`), JSON.stringify(s));
  }
  return w;
}

test('rejects created and closed caliber on the same page', async () => {
  const w = await workdir({ slideOverride: p => ({ id: p.id, title: p.title, bullets: ['774 条创建，765 条闭环'], notes: '稿', seconds: 75, facts: ['F-001', 'F-029'], allowedNumbers: [] }) });
  const r = await checkDeck(w);
  assert.equal(r.ok, false);
  assert.match(r.violations.map(v => v.message).join('\n'), /口径/);
});

test('rejects proposed direction on a conclusion page without label', async () => {
  const plan = { directions: [{ id: 'D1', title: '复制到后端', type: 'continuation', basis: ['F-001'], confidence: 'high', action: 'a', status: 'proposed', keywords: ['复制到后端'] }] };
  const w = await workdir({ plan, slideOverride: p => ({ id: p.id, title: p.title, bullets: ['复制到后端'], notes: '稿', seconds: 75, facts: ['F-001'], allowedNumbers: [] }) });
  const r = await checkDeck(w);
  assert.equal(r.ok, false);
  assert.match(r.violations.map(v => v.message).join('\n'), /规划|建议|探索/);
});

test('rejects 30 pages for a 20 minute talk', async () => {
  const pages = Array.from({ length: 30 }, (_, i) => ({ id: `P${i + 1}`, title: '页面', core: '核心', facts: ['F-001'], visual: 'content', seconds: 40 }));
  const w = await workdir({ pages });
  const r = await checkDeck(w);
  assert.equal(r.ok, false);
  assert.match(r.violations.map(v => v.message).join('\n'), /页数/);
});

test('rejects mismatch between outline and slide facts', async () => {
  const w = await workdir({ slideOverride: p => ({ id: p.id, title: p.title, bullets: ['774 条'], notes: '稿', seconds: 75, facts: [], allowedNumbers: [] }) });
  const r = await checkDeck(w);
  assert.equal(r.ok, false);
  assert.match(r.violations.map(v => v.message).join('\n'), /facts/);
});

test('writes 07-check-report.json', async () => {
  const w = await workdir();
  const r = await checkDeck(w);
  await writeReport(w, r);
  const saved = JSON.parse(await readFile(path.join(w, '07-check-report.json'), 'utf8'));
  assert.equal(saved.ok, r.ok);
});

test('appendix slides do not count toward page or time limits', async () => {
  const pages = [
    ...Array.from({ length: 18 }, (_, i) => ({ id: `P${i + 1}`, title: '页面', core: '核心', facts: ['F-001'], visual: 'content', seconds: 65 })),
    { id: 'A01', title: '附录', core: '附录', facts: ['F-001'], visual: 'table', seconds: 0, appendix: true }
  ];
  const w = await workdir({ pages, slideOverride: p => ({ id: p.id, title: p.title, bullets: ['774 条'], notes: '稿', seconds: p.seconds, facts: ['F-001'], allowedNumbers: [], appendix: Boolean(p.appendix) }) });
  const r = await checkDeck(w);
  assert.equal(r.ok, true);
});
