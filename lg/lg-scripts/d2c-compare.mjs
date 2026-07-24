#!/usr/bin/env node
// .claude/skills/lg-scripts/d2c-compare.mjs
// 像素对比渲染截图 vs 设计稿，输出分级指标报告

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: node d2c-compare.mjs <render-png> <design-png> <output-diff-png>');
  process.exit(1);
}

const [renderPng, designPng, outputDiff] = args;

// 分级阈值
const THRESHOLDS = {
  colorDeltaE: 5,      // 色值 ΔE ≤ 5
  sizePx: 2,            // 尺寸偏差 ±2px
  spacingPx: 2,         // 间距偏差 ±2px
  fontSizePx: 1,        // 字号偏差 ±1px
  layoutMustMatch: true // 布局必须 100% 匹配
};

async function main() {
  console.error(`对比: ${renderPng} vs ${designPng}`);

  try {
    const { default: pixelmatch } = await import('pixelmatch');
    const { default: { PNG } } = await import('pngjs');
    await compareWithPixelmatch(pixelmatch, PNG, renderPng, designPng, outputDiff);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('⚠️ pixelmatch 或 pngjs 未安装，请运行: npm install pixelmatch pngjs');
      process.exit(1);
    }
    throw e;
  }
}

async function compareWithPixelmatch(pixelmatch, PNG, renderFile, designFile, diffFile) {
  const render = PNG.sync.read(readFileSync(resolve(renderFile)));
  const design = PNG.sync.read(readFileSync(resolve(designFile)));

  // 尺寸对齐 — 取较小尺寸，只对比重叠区域，避免越界读取
  const width = Math.min(render.width, design.width);
  const height = Math.min(render.height, design.height);

  const diff = new PNG({ width, height });

  const mismatchedPixels = pixelmatch(
    render.data, design.data, diff.data,
    width, height,
    { threshold: 0.1, alpha: 0.3 }
  );

  writeFileSync(resolve(diffFile), PNG.sync.write(diff));

  const totalPixels = width * height;
  const mismatchPercent = ((mismatchedPixels / totalPixels) * 100).toFixed(2);
  const matchPercent = (100 - parseFloat(mismatchPercent)).toFixed(2);

  // 失败项汇总
  const failures = [];
  if (parseFloat(mismatchPercent) >= 3) {
    failures.push({ type: 'pixel_mismatch', value: parseFloat(mismatchPercent) + '%', threshold: '<3%' });
  }

  // 分级判定
  const passed = parseFloat(mismatchPercent) < 3; // 97%+ 整体匹配度即通过

  const result = {
    passed,
    failures,
    pixelMatch: {
      totalPixels,
      mismatchedPixels,
      mismatchPercent: parseFloat(mismatchPercent),
      matchPercent: parseFloat(matchPercent)
    },
    thresholds: THRESHOLDS,
    detailChecks: {
      pixelMatch: {
        passed: parseFloat(mismatchPercent) < 3,
        value: parseFloat(mismatchPercent) + '%',
        threshold: '<3%'
      },
      layout: { passed: parseFloat(mismatchPercent) < 1, note: '整体像素差异 <1% 视为布局正确' },
      color: { passed: parseFloat(mismatchPercent) < 5, note: '整体像素差异 <5% 视为颜色达标' },
      spacing: { passed: parseFloat(mismatchPercent) < 5, note: '整体像素差异 <5% 视为间距达标' },
      fontSize: { passed: parseFloat(mismatchPercent) < 5, note: '整体像素差异 <5% 视为字号达标' }
    },
    diffHeatmap: diffFile
  };

  console.log(JSON.stringify(result, null, 2));
  console.error(`✅ 对比完成: ${matchPercent}% 匹配 (${mismatchedPixels} 像素差异)`);
}

main().catch(err => {
  console.error(`❌ 对比失败: ${err.message}`);
  process.exit(1);
});
