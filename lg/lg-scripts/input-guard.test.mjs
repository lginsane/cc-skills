import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMAS, normalizeLayerId, fileArg, guard, guardDesigns, guardPaths, dedupeDesigns,
} from './input-guard.mjs';

test('normalizeLayerId：URL 编码变体归一', () => {
  assert.equal(normalizeLayerId('2%3A434653'), '2:434653');
  assert.equal(normalizeLayerId('  2:434653  '), '2:434653');
});

test('guard：白名单放行，shell 元字符拒绝', () => {
  assert.doesNotThrow(() => guard({ version: '1.4.6' }, { version: SCHEMAS.version }));
  for (const p of ["'; rm -rf /; echo '", '$(id)', '1.4.6\n2', '1.x`whoami`']) {
    assert.throws(() => guard({ version: p }, { version: SCHEMAS.version }), `应拒绝: ${p}`);
  }
});

test('guardDesigns：fileId 仅数字 / layerId 数字冒号数字 / pageDir kebab', () => {
  assert.throws(() => guardDesigns([{ designId: 'x', mastergoFileId: 'abc', mastergoLayerId: '1:1' }]));
  assert.throws(() => guardDesigns([{ designId: 'x', mastergoFileId: '1', mastergoLayerId: '3:%4026' }]));
  assert.throws(() => guardDesigns([{ designId: 'x', mastergoFileId: '1', mastergoLayerId: '1:1', pageDir: 'BAD_NAME' }]));
  assert.doesNotThrow(() => guardDesigns([{ designId: 'task-list', mastergoFileId: '200861125675636', mastergoLayerId: '3:4026', pageDir: 'task-manage/task-list' }]));
});

test('guardPaths：禁 .. 与控制字符', () => {
  assert.throws(() => guardPaths({ rawFile: '../evil.json' }, ['rawFile']));
  assert.throws(() => guardPaths({ rawFile: 'a\nb' }, ['rawFile']));
  assert.doesNotThrow(() => guardPaths({ rawFile: '.lg-docs/dsl/1.5.0/x/raw-dsl.json' }, ['rawFile']));
});

test('fileArg：--input 解析', () => {
  assert.equal(fileArg(['node', 'x.mjs', '--input', 'a.json']), 'a.json');
  assert.equal(fileArg(['node', 'x.mjs']), null);
  assert.throws(() => fileArg(['node', 'x.mjs', '--input']));
});

test('dedupeDesigns：编码变体合并且 layerId 归一化', () => {
  const out = dedupeDesigns([
    { designId: 'a', mastergoFileId: '1', mastergoLayerId: '2:1' },
    { designId: 'b', mastergoFileId: '1', mastergoLayerId: '2%3A1' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].mastergoLayerId, '2:1');
});
