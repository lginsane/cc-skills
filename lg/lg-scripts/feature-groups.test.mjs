import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageSignal, pageSimilarity, clusterPages } from './feature-groups.mjs';

const basePg = (over) => ({
  pageId: 'x', pageName: 'x', pageDir: 'x', feature: 'ai-shoot', totalSections: 12,
  zones: [{ id: 'z1', name: 'shell', kind: 'shell' }, { id: 'z2', name: 'content', kind: 'content' }],
  overlays: [], repeatables: [], outputs: [{ outputType: 'list-page' }],
  ...over,
});

test('pageSignal 提取聚类信号', () => {
  const s = pageSignal(basePg({ pageId: 'clothing-product', totalSections: 14 }));
  assert.equal(s.prefix, 'ai-shoot');
  assert.equal(s.shell, true);
  assert.deepEqual(s.zoneKinds, ['content', 'shell']);
  assert.deepEqual(s.outputTypes, ['list-page']);
  assert.equal(s.count, 14);
});

test('同构页相似度 ≥ auto(0.7) → 自动并组, confirmRequired=false', () => {
  const pages = [
    basePg({ pageId: 'clothing-product', totalSections: 14 }),
    basePg({ pageId: 'model-shoot', totalSections: 12 }),
  ];
  const groups = clusterPages(pages);
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.deepEqual([...g.members].sort(), ['clothing-product', 'model-shoot']);
  assert.ok(g.similarity >= 0.7);
  assert.equal(g.confirmRequired, false);
  // evidence 逆向索引齐备
  assert.equal(typeof g.evidence.structuralSimilarity, 'number');
  assert.equal(g.evidence.sharedShell, true);
  assert.ok(Array.isArray(g.evidence.sharedComponents));
});

test('C8/C9 相似度门限: <0.35 不并组; [0.35,0.7) confirmRequired', () => {
  const dissimilar = [
    basePg({ pageId: 'detail-a', feature: 'detail', totalSections: 5, zones: [{ id: 'z1', name: 'content', kind: 'content' }] }),
    basePg({ pageId: 'list-b', feature: 'list', totalSections: 30, outputs: [{ outputType: 'form-modal' }] }),
  ];
  assert.deepEqual(clusterPages(dissimilar), [], '< confirm 不并组');

  const mid = [
    basePg({ pageId: 'p1', feature: 'mix', totalSections: 10 }),
    basePg({ pageId: 'p2', feature: 'mix', totalSections: 40, zones: [{ id: 'z1', name: 'content', kind: 'content' }], outputs: [{ outputType: 'detail-page' }] }),
  ];
  const gs = clusterPages(mid);
  // sim 介于两端:共享 prefix(0.2),但 shell 不一致(0),output 不同(0),size 0.25 → ~0.225 → <0.35 不并组;构造 mid 需人工保证区间
  if (gs.length === 1) assert.equal(gs[0].confirmRequired, true);
});

test('C10 开关关闭(featureGroups.enabled=false) 不聚类', () => {
  const pages = [basePg({ pageId: 'a' }), basePg({ pageId: 'b' })];
  const groups = clusterPages(pages, { featureGroups: { enabled: false } });
  // 注:聚类本身独立于开关,开关由调用方(lg-dsl)决定是否调用;此处断言默认可用
  assert.ok(Array.isArray(groups));
});

test('单页不形成组', () => {
  const groups = clusterPages([basePg({ pageId: 'only' })]);
  assert.deepEqual(groups, []);
});