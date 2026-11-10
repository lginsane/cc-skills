import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { computeScore } from './d2c-compare.mjs';

test('computeScore 三档判定边界（97% 通过阈值）', () => {
  // 差异 < 3% → 通过
  assert.deepEqual(computeScore(100, 10000), { mismatchPercent: 1, matchPercent: 99, passed: true });
  assert.deepEqual(computeScore(299, 10000), { mismatchPercent: 2.99, matchPercent: 97.01, passed: true });
  // 差异 ≥ 3% → 不通过
  assert.equal(computeScore(300, 10000).passed, false);
  assert.equal(computeScore(500, 10000).passed, false);
  assert.equal(computeScore(500, 10000).matchPercent, 95);
});

test('computeScore 空图/全同图边界', () => {
  assert.deepEqual(computeScore(0, 0), { mismatchPercent: 0, matchPercent: 100, passed: true });
  assert.deepEqual(computeScore(0, 64000), { mismatchPercent: 0, matchPercent: 100, passed: true });
});

test('computeScore 精确度保留两位', () => {
  const s = computeScore(1234, 99991);
  assert.equal(typeof s.mismatchPercent, 'number');
  assert.match(String(s.matchPercent), /^\d+(\.\d{1,2})?$/);
});

test('缺 design.png：阻断并提示', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmp-'));
  const rPng = join(dir, 'render.png');
  writeFileSync(rPng, 'x');
  const missingDesign = join(dir, 'no-such-design.png');
  const diff = join(dir, 'diff.png');
  const r = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'd2c-compare.mjs'), rPng, missingDesign, diff], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /design\.png/);
});