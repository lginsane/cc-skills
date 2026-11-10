// dsl-placeholder-check.test.mjs — 占位符残留扫描脚本测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import {
  scanFile,
  collectFilesUnderDir,
  resolveScanPaths,
  scanAll,
} from './dsl-placeholder-check.mjs';

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'dsl-phcheck-'));
}

test('scanFile 命中 @@SVG 与 T{n}|{nodeId} 占位符并记录行号', () => {
  const dir = makeTempDir();
  const file = join(dir, 'page.vue');
  writeFileSync(file, [
    '<template>',
    '  <span class="icon">@@SVG:S0#0@@</span>',
    '  <p>T3|1:1234</p>',
    '  <div class="clean">普通内容</div>',
    '  <a-button>@@SVG:S1#7@@ 保存</a-button>',
    '</template>',
    '',
  ].join('\n'));

  const result = scanFile(file);
  assert.equal(result.unreadable, undefined, '文件应可读');
  assert.equal(result.matches.length, 3, '应命中 3 行');
  assert.deepEqual(result.matches.map(m => m.line), [2, 3, 5]);
  assert.ok(result.matches[0].snippets.includes('@@SVG:S0#0@@'));
  assert.ok(result.matches[1].snippets.includes('T3|1:1234'));
});

test('scanFile 匹配纯数字 nodeId 长文本占位 T3|1:2', () => {
  const dir = makeTempDir();
  const file = join(dir, 'a.vue');
  writeFileSync(file, '<div>{{ text }}</div>\n<span>T3|1:2</span>\n');
  const result = scanFile(file);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].snippets[0], 'T3|1:2');
});

test('scanFile 无占位符文件 passed', () => {
  const dir = makeTempDir();
  const file = join(dir, 'clean.vue');
  writeFileSync(file, [
    '<template>',
    '  <a-table :columns="columns" :data-source="list" />',
    '  <span>共 {{ total }} 条</span>',
    '</template>',
    '',
  ].join('\n'));
  const result = scanFile(file);
  assert.equal(result.matches.length, 0);
  assert.equal(result.unreadable, undefined);
});

test('collectFilesUnderDir 递归收集可扫描后缀', () => {
  const dir = makeTempDir();
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'index.vue'), '');
  writeFileSync(join(dir, 'sub', 'form.ts'), '');
  writeFileSync(join(dir, 'logo.png'), 'x'); // 二进制后缀应跳过
  writeFileSync(join(dir, 'app.css'), '');
  const files = collectFilesUnderDir(dir);
  assert.equal(files.length, 3);
  assert.ok(files.some(f => f.endsWith('index.vue')));
  assert.ok(files.some(f => f.endsWith('form.ts')));
  assert.ok(files.some(f => f.endsWith('app.css')));
  assert.ok(!files.some(f => f.endsWith('logo.png')));
});

test('resolveScanPaths 支持 stdin paths 数组与 CLI 参数形态', () => {
  const dir = makeTempDir();
  const file = join(dir, 'page.vue');
  writeFileSync(file, '<template></template>\n<p>@@SVG:S2#3@@</p>\n<h1>T1|2:3</h1>\n');

  const byPaths = resolveScanPaths({ paths: [file] }, process.cwd());
  assert.deepEqual(byPaths, [file]);

  const byDir = resolveScanPaths({ paths: [dir] }, process.cwd());
  assert.ok(byDir.includes(file));
});

test('scanAll 聚合汇总 passed=false 并给出总命中数', () => {
  const dir = makeTempDir();
  const dirty = join(dir, 'dirty.vue');
  writeFileSync(dirty, '<span>@@SVG:S0#0@@</span>\n');
  const clean = join(dir, 'clean.vue');
  writeFileSync(clean, '<span>干净</span>\n');

  const dirtyResult = scanAll([dirty, clean], dir);
  assert.equal(dirtyResult.passed, false);
  assert.equal(dirtyResult.total, 1);
  assert.equal(dirtyResult.files[0].relativeFile, 'dirty.vue');

  const cleanResult = scanAll([clean], dir);
  assert.equal(cleanResult.passed, true);
  assert.equal(cleanResult.total, 0);
});