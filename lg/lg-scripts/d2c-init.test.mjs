import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRestorationMd, buildConstantsUsageStandardsMd } from './d2c-init.mjs';

test('buildRestorationMd v2 含双模式数据源与资源引用', () => {
  const md = buildRestorationMd({ projectType: 'Vue3 H5' });
  assert.match(md, /数据源版本: v2/);
  assert.match(md, /mcp__getDesignSections/);
  assert.match(md, /raw-dsl\.json/);               // S2/S3 输入契约
  assert.match(md, /image-manifest\.json/);          // 图片 manifest 先行
  assert.match(md, /语义化命名/);
  assert.match(md, /theme-mapping\.json|主题/);
  assert.match(md, /回退通道/);
  assert.doesNotMatch(md, /d2c-mastergo-adapter\.mjs/); // v2 已废弃 adapter
});

test('buildConstantsUsageStandardsMd 按目录检测生成（与模式无关）', () => {
  const md = buildConstantsUsageStandardsMd();
  assert.match(md, /src\/constants\//);
  assert.match(md, /SmartEnum/);
  assert.match(md, /smartEnumPlugin/);
  assert.match(md, /getDescByValue/);
  assert.match(md, /与 admin\/d2c 模式无关/);
  assert.match(md, /禁止魔法值/);
});
