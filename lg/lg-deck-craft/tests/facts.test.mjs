import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateFacts } from '../lib/facts.mjs';

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'facts-'));
  await mkdir(path.join(root, '资料/01-云效'), { recursive: true });
  await writeFile(path.join(root, '资料/01-云效/2026工作项统计.md'), '774', 'utf8');
  return root;
}

const base = {
  id: 'F-001', claim: '闭环 758 条', value: 758, unit: '条',
  period: '2026-01~2026-11', caliber: 'closed', formula: null,
  source: '资料/01-云效/2026工作项统计.md', owner: '梁傲',
  verified: true, verification_level: 'cross_checked',
  confidence: 'high', category: 'delivery', audience: ['leaders']
};

test('accepts a complete fact', async () => {
  const root = await fixtureRoot();
  assert.equal(validateFacts([base], { root }).ok, true);
});

test('rejects a fact without source', () => {
  const bad = { ...base, source: '' };
  const r = validateFacts([bad], { root: '.' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /source/);
});

test('rejects derived value without formula', async () => {
  const root = await fixtureRoot();
  const bad = { ...base, value: 97.9, unit: '%' };
  const r = validateFacts([bad], { root });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /formula/);
});

test('rejects unknown caliber', async () => {
  const root = await fixtureRoot();
  const bad = { ...base, caliber: 'annual' };
  assert.equal(validateFacts([bad], { root }).ok, false);
});

test('rejects missing source file', async () => {
  const root = await fixtureRoot();
  const bad = { ...base, source: '资料/不存在.md' };
  const r = validateFacts([bad], { root });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /不存在/);
});

test('rejects a formula that is not a formula', async () => {
  const root = await fixtureRoot();
  const bad = { ...base, value: 97.9, unit: '%', formula: '随便写写' };
  const r = validateFacts([bad], { root });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /formula/);
});
