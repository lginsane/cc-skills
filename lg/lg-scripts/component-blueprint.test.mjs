import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildBlueprint, classifyExempt, detectOverlay } from './component-blueprint.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(__dirname, '__fixtures__');
const complexFile = resolve(FIX, 'raw-dsl-complex-sample.json');
const simpleFile = resolve(FIX, 'raw-dsl-sample.json');

test('复杂稿 → complex + zones + overlay + repeatable + 豁免', () => {
  const bp = buildBlueprint({ rawFile: complexFile, pageDir: 'task-manage/task-list', outDir: '.tmp' });
  assert.equal(bp.complexity, 'complex');
  assert.equal(bp.zones.length, 2);
  const z1 = bp.zones.find(z => z.name === '侧边容器');
  assert.deepEqual(z1.sections, [0]);
  assert.equal(z1.kind, 'shell');
  const z2 = bp.zones.find(z => z.name === '主内容容器');
  assert.deepEqual(z2.sections, [1, 2, 3, 4]);

  const overlay = bp.overlays.find(o => o.sectionIndex === 5);
  assert.ok(overlay, '新增商品弹窗 应命中覆盖层');
  assert.equal(overlay.confidence, 'keyword');

  const rep = bp.repeatables.find(r => r.count === 3);
  assert.ok(rep, '3 张相同结构商品卡片应聚为一组');
  assert.deepEqual([...rep.sections].sort(), [2, 3, 4]);
  assert.equal(rep.source, 'auto');

  assert.ok(bp.exempted.some(e => e.name === '滚动条'));
  assert.ok(bp.exempted.some(e => e.name === '矩形 1234' && e.reason === 'generic-decor-layer'));
  assert.deepEqual(bp.dangling, []);
});

test('复杂稿 → 多文件计划（page + shell + overlay + repeatable）', () => {
  const bp = buildBlueprint({ rawFile: complexFile, pageDir: 'task-manage/task-list', outDir: '.tmp' });
  const files = bp.outputs.map(o => o.file);
  assert.ok(files.includes('src/views/task-manage/task-list/index.vue'), '应有 index.vue');
  assert.ok(files.every(f => f.endsWith('.vue')));
  assert.ok(bp.outputs.some(o => o.role === 'overlay'));
  assert.ok(bp.outputs.some(o => o.role === 'repeatable'));
  const page = bp.outputs.find(o => o.role === 'page');
  assert.deepEqual(page.contentSections, [1, 2, 3, 4]);
  assert.ok(page.slots, 'page 应有 slots 注入 shell/overlay/repeatable 引用');
});

test('简单稿 → simple + 单 index.vue + 合成内容区承接', () => {
  const bp = buildBlueprint({ rawFile: simpleFile, pageDir: 'p', outDir: '.tmp' });
  assert.equal(bp.complexity, 'simple');
  assert.equal(bp.outputs.length, 1);
  assert.equal(bp.outputs[0].role, 'page');
  assert.deepEqual(bp.dangling, []);
  assert.ok(bp.zones.some(z => z.synthetic), 'split 之外的真实内容应被合成"内容区"承接');
  assert.ok(bp.outputs[0].contentSections.length >= 2, '内容 section 应落到 index 的 contentSections');
});

test('几何覆盖层：无关键词但悬浮于内容之上（条件B）', () => {
  const raw = {
    fileId: 'f', layerId: 'l', designName: '几何页', version: '1',
    overview: {
      rootMetadata: { width: 800, height: 900, name: '几何页', styles: {}, type: 'FRAME' },
      splitContainers: [{ id: 'sc1', name: '内容容器', type: 'GROUP', x: 30, y: 30, width: 500, height: 500 }],
      sections: [
        { id: 'a', name: '列表区', type: 'FRAME', x: 20, y: 20, width: 760, height: 860 },
        { id: 'b', name: '营销推广模块', type: 'FRAME', x: 300, y: 150, width: 320, height: 360 },
      ],
      rootContainer: {},
    },
    sectionDsls: [
      { sectionIndex: 0, section: { id: 'a', name: '列表区', type: 'FRAME' }, dsl: { styles: {}, nodes: [] } },
      { sectionIndex: 1, section: { id: 'b', name: '营销推广模块', type: 'FRAME' }, dsl: { styles: {}, nodes: [] } },
    ],
  };
  const tmp = resolve(FIX, 'out/geo');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const rawFile = resolve(tmp, 'raw.json');
  writeFileSync(rawFile, JSON.stringify(raw));
  const bp = buildBlueprint({ rawFile, pageDir: 'p', outDir: tmp });
  const ov = bp.overlays.find(o => o.sectionIndex === 1);
  assert.ok(ov, '几何悬浮 section 应命中覆盖层');
  assert.equal(ov.confidence, 'geometry');
});

test('overview.sections 为空 + sectionIndexFile 提供几何 → zones 正常聚合', () => {
  const tmp = resolve(FIX, 'out/si-fallback');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const idx = {
    totalSections: 2,
    sections: [
      { sectionIndex: 0, id: 's0', name: '侧边栏', type: 'FRAME', x: 20, y: 20, width: 200, height: 800, textPreview: '', nodeCount: 5 },
      { sectionIndex: 1, id: 's1', name: '主内容', type: 'FRAME', x: 240, y: 20, width: 1180, height: 800, textPreview: '', nodeCount: 20 },
    ],
  };
  const raw = {
    fileId: 'f', layerId: 'l', designName: '兜底稿', version: '1',
    overview: {
      rootMetadata: { width: 1440, height: 862, name: 'x', styles: {} },
      splitContainers: [{ id: 'sc', name: '容器', type: 'FRAME', x: 20, y: 20, width: 200, height: 800 }],
      sections: [],
      rootContainer: {},
    },
    sectionDsls: [
      { sectionIndex: 0, section: { id: 's0', name: '侧边栏', type: 'FRAME' }, dsl: { styles: {}, nodes: [] } },
      { sectionIndex: 1, section: { id: 's1', name: '主内容', type: 'FRAME' }, dsl: { styles: {}, nodes: [] } },
    ],
  };
  const rawFile = resolve(tmp, 'raw.json');
  const siFile = resolve(tmp, 'section-index.json');
  writeFileSync(rawFile, JSON.stringify(raw));
  writeFileSync(siFile, JSON.stringify(idx));
  const bp = buildBlueprint({ rawFile, pageDir: 'p', outDir: tmp, sectionIndexFile: siFile });
  assert.equal(bp.totalSections, 2);
  assert.ok(bp.zones.length > 0, 'overview.sections 为空时，sectionIndexFile 应撑起 zone 归属');
});

test('classifyExempt：滚动/分隔/泛化背景 豁免，正常名称不豁免', () => {
  assert.equal(classifyExempt({ name: '滚动条' }).exempt, true);
  assert.equal(classifyExempt({ name: '分割线 42' }).exempt, true);
  assert.equal(classifyExempt({ name: '矩形 1234' }).exempt, true);
  assert.equal(classifyExempt({ name: '侧边栏' }).exempt, false);
  assert.equal(classifyExempt({ name: '商品卡片列表' }).exempt, false);
});