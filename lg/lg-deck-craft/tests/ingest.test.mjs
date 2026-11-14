import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ingest } from '../scripts/ingest.mjs';

test('ingest copies markdown and reports char count', async () => {
  const src = await mkdtemp(path.join(tmpdir(), 'src-'));
  const out = await mkdtemp(path.join(tmpdir(), 'out-'));
  await writeFile(path.join(src, 'a.md'), '# 标题\n\n正文 774 条', 'utf8');
  const result = await ingest(src, out);
  assert.equal(result.files.length, 1);
  const text = await readFile(path.join(out, 'a.md'), 'utf8');
  assert.match(text, /774/);
  assert.ok(result.files[0].chars > 0);
});

test('ingest flattens nested paths with double underscore', async () => {
  const src = await mkdtemp(path.join(tmpdir(), 'src-'));
  const out = await mkdtemp(path.join(tmpdir(), 'out-'));
  await writeFile(path.join(src, 'nested.md'), 'x', 'utf8');
  await (await import('node:fs/promises')).mkdir(path.join(src, 'sub'));
  await writeFile(path.join(src, 'sub', 'b.md'), 'y', 'utf8');
  const result = await ingest(src, out);
  assert.ok(result.files.some(f => f.output.endsWith('sub__b.md')));
});
