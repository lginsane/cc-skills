import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportNotes } from '../scripts/export_notes.mjs';

test('exports per-page speaker notes with total time', async () => {
  const w = await mkdtemp(path.join(tmpdir(), 'notes-'));
  await mkdir(path.join(w, '05-slides'), { recursive: true });
  await writeFile(path.join(w, '03-outline.json'), JSON.stringify({ pages: [{ id: 'P01', title: '封面', seconds: 30 }] }));
  await writeFile(path.join(w, '05-slides/P01.json'), JSON.stringify({ id: 'P01', notes: '大家好' }));
  const result = await exportNotes(w);
  const md = await readFile(path.join(w, '10-speaker-notes.md'), 'utf8');
  assert.equal(result.pages, 1);
  assert.match(md, /大家好/);
  assert.match(md, /30 秒/);
});
