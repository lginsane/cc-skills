import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPageMapping,
  buildOutputRequirementLinks,  // 待 Task 2 实现
} from './dsl.mjs';
import { matchRequirementPage } from './dsl-requirement.mjs';

test('buildPageMapping 包含关联键字段', () => {
  const matched = matchRequirementPage(
    { pageName: '本地商家信息', designName: '本地商家信息-编辑弹窗' },
    { vision: new Map([['编辑本地商家', { file: 'v.json', pageName: '编辑本地商家' }]]), analyze: new Map(), smoke: new Map() }
  );
  const pages = [{ pageId: 'x', pageName: '本地商家信息', pageDir: 'x', screenshot: null, designs: [], outputs: [], ...matched }];
  const mapping = { pages: buildPageMapping(pages, '1.4.8') };
  const p = mapping.pages[0];
  assert.equal(p.requirementPage, '编辑本地商家');
  assert.equal(p.requirementVersion, '1.4.8');
  assert.equal(p.dataLinks.vision.file, 'v.json');
  assert.equal(p.requirementConfirmed, false); // 0.43 < 0.6 → 待确认
  assert.ok(Array.isArray(p.requirementCandidates));
});

test('buildPageMapping 无匹配时字段默认空', () => {
  const pages = [{ pageId: 'x', pageName: '无关', pageDir: 'x', screenshot: null, designs: [], outputs: [] }];
  const mapping = { pages: buildPageMapping(pages, '1.4.8') };
  assert.equal(mapping.pages[0].requirementPage, '');
  assert.deepEqual(mapping.pages[0].dataLinks, {});
  assert.deepEqual(mapping.pages[0].requirementCandidates, []);
});

test('buildPageMapping 含 designRequirement 与 output requirementLinks', () => {
  const designs = [{
    designId: 'ds_009', designName: 'x', pageDir: 'p', screenshot: null,
    componentType: 'detail', role: 'view', autoDetected: true, mastergoFileId: '', mastergoLayerId: '',
    designRequirement: {
      requirementPage: '计划管理 - 巡查中',
      vision: { file: 'v3.json', pageName: '计划管理 - 巡查中', matchBy: '巡查中' },
      coverage: { vision: true, analyze: false, smoke: false },
    },
    analyzeLinks: {},
  }];
  const page = {
    pageId: 'p', pageName: 'x', pageDir: 'p', screenshot: null, designs,
    outputs: [{ outputType: 'detail-drawer', sourceDesigns: ['ds_009'], outputPath: 'x.vue', template: 'detail-drawer', requirementLinks: { vision: { file: 'v3.json', pageName: '计划管理 - 巡查中', matchBy: '巡查中' } } }],
  };
  const mapping = { pages: buildPageMapping([page], '1.4.8') };
  assert.equal(mapping.pages[0].designs[0].designRequirement.requirementPage, '计划管理 - 巡查中');
  assert.equal(mapping.pages[0].outputs[0].requirementLinks.vision.file, 'v3.json');
});

test('buildOutputRequirementLinks 聚合 sourceDesigns 的关联', () => {
  const designs = [
    { designId: 'ds_007', designRequirement: { requirementPage: '投放规划管理', vision: { file: 'v0.json' }, coverage: { vision: true } }, analyzeLinks: { analyze: { file: 'a.json' } } },
    { designId: 'ds_009', designRequirement: { requirementPage: '计划管理 - 巡查中', vision: { file: 'v3.json' }, coverage: { vision: true } }, analyzeLinks: {} },
  ];
  const links = buildOutputRequirementLinks({ sourceDesigns: ['ds_007', 'ds_009'] }, designs);
  assert.equal(links.vision.file, 'v0.json');   // 取首个有 vision 的 design
  assert.equal(links.analyze.file, 'a.json');
});
