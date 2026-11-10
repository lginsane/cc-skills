import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runPrecheck, REQUIRED_SCRIPTS } from './precheck.mjs';

test('precheck：空目录 → ok=false 且列出全部缺失', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'precheck-'));
  const r = await runPrecheck(dir);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, REQUIRED_SCRIPTS);
});

test('precheck：补齐必需脚本后 ok=true（可选依赖缺失不阻断）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'precheck-'));
  for (const f of REQUIRED_SCRIPTS) writeFileSync(join(dir, f), '');
  const r = await runPrecheck(dir);
  assert.equal(r.ok, true);
  assert.equal(r.missing.length, 0);
  assert.equal(r.unreadable.length, 0);
});