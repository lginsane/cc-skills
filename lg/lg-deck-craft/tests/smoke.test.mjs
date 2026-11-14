import test from 'node:test';
import assert from 'node:assert/strict';
import { workDir, artifact } from '../lib/paths.mjs';

test('workDir joins root/work/name', () => {
  assert.equal(workDir('/tmp/project', '2026'), '/tmp/project/work/2026');
});

test('artifact joins workdir and file', () => {
  assert.equal(artifact('/tmp/work', '01-facts.json'), '/tmp/work/01-facts.json');
});
