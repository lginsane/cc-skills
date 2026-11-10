import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  normalizeRequirementName,
  extractModuleNameFromFile,
  collectRequirementIndex,
  matchRequirementPage,
  summarizeRequirement,
  extractKeywords,
  matchDesignRequirement,
  matchDesignAnalyzeSmoke,
} from './dsl-requirement.mjs';

test('normalizeRequirementName 去除首部序号与空白', () => {
  assert.equal(normalizeRequirementName('2_编辑本地商家'), '编辑本地商家');
  assert.equal(normalizeRequirementName('12-计划管理-巡查中'), '计划管理-巡查中');
  assert.equal(normalizeRequirementName('  编辑本地商家 '), '编辑本地商家');
  assert.equal(normalizeRequirementName(''), '');
});

test('extractModuleNameFromFile 从文件名提取模块名', () => {
  assert.equal(extractModuleNameFromFile('2_编辑本地商家.json'), '编辑本地商家');
  assert.equal(extractModuleNameFromFile('10_素材库-缩略.json'), '素材库-缩略');
  assert.equal(extractModuleNameFromFile('_all_cases.json'), '_all_cases');
});

// 构造 {cwd}/.lg-docs/{vision|analysis|smoke}/1.4.8/ 临时目录
function buildFixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'lg-req-'));
  const visionDir = join(dir, '.lg-docs/vision/1.4.8');
  const analysisDir = join(dir, '.lg-docs/analysis/1.4.8');
  const smokeDir = join(dir, '.lg-docs/smoke/1.4.8');
  mkdirSync(visionDir, { recursive: true });
  mkdirSync(analysisDir, { recursive: true });
  mkdirSync(smokeDir, { recursive: true });

  writeFileSync(join(visionDir, '2_智能投放-卖点设置_1_1736x864.json'), JSON.stringify({
    pages: [{ name: '编辑本地商家' }, { name: '基本信息' }],
  }));
  writeFileSync(join(analysisDir, '2_编辑本地商家.json'), JSON.stringify({ page: '编辑本地商家' }));
  writeFileSync(join(analysisDir, '3_计划管理-巡查中.json'), JSON.stringify({ page: '计划管理-巡查中' }));
  writeFileSync(join(smokeDir, '2_编辑本地商家.json'), JSON.stringify({ module: '编辑本地商家' }));
  writeFileSync(join(smokeDir, '_all_cases.json'), JSON.stringify({ cases: [] }));

  return dir;
}

const CONFIG = {
  vision_dir: './.lg-docs/vision/',
  analysis_dir: './.lg-docs/analysis/',
  smoke_cases_dir: './.lg-docs/smoke/',
};

test('collectRequirementIndex 收集三源索引并过滤聚合文件', () => {
  const dir = buildFixtureDir();
  try {
    const index = collectRequirementIndex(dir, CONFIG, '1.4.8');
    assert.deepEqual([...index.vision.keys()], ['编辑本地商家', '基本信息']);
    assert.deepEqual([...index.analyze.keys()].sort(), ['编辑本地商家', '计划管理-巡查中'].sort());
    assert.deepEqual([...index.smoke.keys()], ['编辑本地商家']);
    assert.equal(index.vision.get('编辑本地商家').file, '2_智能投放-卖点设置_1_1736x864.json');
    assert.equal(index.vision.get('编辑本地商家').pageName, '编辑本地商家');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matchRequirementPage 完全匹配 → 自动确认', () => {
  const dir = buildFixtureDir();
  try {
    const index = collectRequirementIndex(dir, CONFIG, '1.4.8');
    const result = matchRequirementPage({ pageName: '编辑本地商家', designName: '' }, index);
    assert.equal(result.requirementPage, '编辑本地商家');
    assert.equal(result.requirementConfirmed, true);
    assert.ok(result.requirementCandidates.includes('编辑本地商家'));
    assert.equal(result.dataLinks.analyze.file, '2_编辑本地商家.json');
    assert.equal(result.dataLinks.smoke.file, '2_编辑本地商家.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matchRequirementPage 语义匹配但低置信度 → 待确认且 dataLinks 已填', () => {
  const dir = buildFixtureDir();
  try {
    const index = collectRequirementIndex(dir, CONFIG, '1.4.8');
    const result = matchRequirementPage({ pageName: '本地商家信息', designName: '本地商家信息-编辑弹窗' }, index);
    assert.equal(result.requirementPage, '编辑本地商家');
    assert.equal(result.requirementConfirmed, false);
    assert.ok(result.requirementCandidates.includes('编辑本地商家'));
    assert.equal(result.dataLinks.vision.file, '2_智能投放-卖点设置_1_1736x864.json');
    assert.equal(result.dataLinks.analyze.file, '2_编辑本地商家.json');
    assert.equal(result.dataLinks.smoke.file, '2_编辑本地商家.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matchRequirementPage 无匹配 → 空关联', () => {
  const dir = buildFixtureDir();
  try {
    const index = collectRequirementIndex(dir, CONFIG, '1.4.8');
    const result = matchRequirementPage({ pageName: '完全不相关页面', designName: '' }, index);
    assert.equal(result.requirementPage, '');
    assert.equal(result.requirementConfirmed, false);
    assert.deepEqual(result.dataLinks, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('summarizeRequirement 统计（design 级）', () => {
  const summary = summarizeRequirement([
    { designs: [{ designRequirement: { requirementPage: 'a', coverage: { vision: true, analyze: true, smoke: true } } }] },
    { designs: [{ designRequirement: { requirementPage: 'b', coverage: { vision: true, analyze: false, smoke: false } } }] },
    { designs: [{ designRequirement: null }] },
  ]);
  assert.deepEqual(summary, { linked: 2, partial: 1, missing: 1 });
});

test('similarity 支持扩展区汉字（\p{Script=Han}，非仅基础区 [一-龥]）', () => {
  // U+20000 为 CJK 扩展B区汉字：旧正则 [一-龥](U+4E00-U+9FA5) 会过滤它，
  // 使 "管理"vs"管理系统" score≈0.33<0.35 匹配失败；新正则 score=0.5 匹配成功
  const query = '\u{20000}管理';
  const target = '\u{20000}管理系统';
  const index = {
    vision: new Map([[target, { file: 'rare.json', pageName: target }]]),
    analyze: new Map(),
    smoke: new Map(),
  };
  const result = matchRequirementPage({ pageName: query, designName: '' }, index);
  assert.equal(result.requirementPage, target);
});

// ===== 迭代 2：design 级匹配 =====

test('extractKeywords 分级返回 strong/weak', () => {
  assert.deepEqual(extractKeywords('智能投放规划-查看明细-巡查中'),
    { strong: ['巡查中', '查看明细'], weak: ['查看'] });
  assert.deepEqual(extractKeywords('智能投放规划-查看图片'),
    { strong: ['查看图片'], weak: ['查看', '图片'] });
  assert.deepEqual(extractKeywords(''), { strong: [], weak: [] });
});

function buildVisionIndex(names) {
  const m = new Map();
  names.forEach((n, i) => m.set(n, { file: `v${i}.json`, pageName: n }));
  return m;
}

test('matchDesignRequirement 状态关键词优先（巡查中 → 计划管理-巡查中）', () => {
  const vision = buildVisionIndex(['投放规划管理', '群创引擎 - 查看明细', '计划管理 - 巡查中', '图片预览']);
  const r = matchDesignRequirement({ designName: '智能投放规划-查看明细-巡查中' }, vision);
  assert.equal(r.requirementPage, '计划管理 - 巡查中');
  assert.equal(r.matchBy, '巡查中');
  assert.equal(r.coverage.vision, true);
});

test('matchDesignRequirement 动作关键词兜底（查看明细-未提交 → 群创引擎-查看明细）', () => {
  const vision = buildVisionIndex(['投放规划管理', '群创引擎 - 查看明细', '计划管理 - 巡查中']);
  const r = matchDesignRequirement({ designName: '智能投放规划-查看明细-未提交' }, vision);
  assert.equal(r.requirementPage, '群创引擎 - 查看明细');
  assert.equal(r.matchBy, '查看明细');
});

test('matchDesignRequirement 有强意图但数据缺失 → 诚实降级', () => {
  const vision = buildVisionIndex(['投放规划管理', '群创引擎 - 查看明细']);
  const r = matchDesignRequirement({ designName: '智能投放规划-查看图片' }, vision);
  assert.equal(r.requirementPage, '');          // 不再错配"查看明细"
  assert.equal(r.coverage.vision, false);
});

test('matchDesignRequirement 仅弱词且 similarity 不达标 → 不匹配（回退由 dsl.mjs 处理）', () => {
  const vision = buildVisionIndex(['素材库-列表', '投放规划管理']);
  const r = matchDesignRequirement({ designName: '智能投放规划-列表' }, vision);
  assert.equal(r.requirementPage, '');
});

test('matchDesignRequirement 强关键词命中（状态词优先）', () => {
  const vision = buildVisionIndex(['投放规划管理', '群创引擎 - 查看明细', '计划管理 - 巡查中', '图片预览']);
  const r = matchDesignRequirement({ designName: '智能投放规划-查看明细-巡查中' }, vision);
  assert.equal(r.requirementPage, '计划管理 - 巡查中');
  assert.equal(r.matchBy, '巡查中');
});

test('matchDesignRequirement 无匹配 → 空关联', () => {
  const vision = buildVisionIndex(['投放规划管理']);
  const r = matchDesignRequirement({ designName: '完全无关页面' }, vision);
  assert.equal(r.requirementPage, '');
  assert.equal(r.coverage.vision, false);
  assert.equal(r.vision, null);
});

test('matchDesignAnalyzeSmoke 按关键词/requirementPage 匹配 analyze/smoke', () => {
  const reqIndex = {
    analyze: new Map([['投放规划管理', { file: 'a.json' }]]),
    smoke: new Map([['投放规划管理', { file: 's.json' }]]),
  };
  // ds_007 列表 → requirementPage=投放规划管理 → analyze/smoke 命中
  const r = matchDesignAnalyzeSmoke({ designName: '智能投放规划-列表' }, reqIndex, '投放规划管理');
  assert.equal(r.coverage.analyze, true);
  assert.equal(r.coverage.smoke, true);
  assert.equal(r.links.analyze.file, 'a.json');
  // ds_009 巡查中 → requirementPage=计划管理-巡查中，analyze 无 → coverage false
  const r2 = matchDesignAnalyzeSmoke({ designName: '智能投放规划-查看明细-巡查中' }, reqIndex, '计划管理 - 巡查中');
  assert.equal(r2.coverage.analyze, false);
});
