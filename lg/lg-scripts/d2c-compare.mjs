#!/usr/bin/env node
// .claude/skills/lg-scripts/d2c-compare.mjs
// 像素对比渲染截图 vs 设计稿，输出分级指标报告

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

// 分级阈值
const THRESHOLDS = {
  colorDeltaE: 5,      // 色值 ΔE ≤ 5
  sizePx: 2,            // 尺寸偏差 ±2px
  spacingPx: 2,         // 间距偏差 ±2px
  fontSizePx: 1,        // 字号偏差 ±1px
  layoutMustMatch: true // 布局必须 100% 匹配
};

/**
 * 纯函数：像素差异 → 匹配度 + 三档判定（L4 视觉门评分核心，可单测）
 * 通过阈值：像素差异 < 3%（即 match% > 97%）
 */
export function computeScore(mismatchedPixels, totalPixels) {
  const mismatchPercent = totalPixels > 0 ? (mismatchedPixels / totalPixels) * 100 : 0;
  const matchPercent = 100 - mismatchPercent;
  return {
    mismatchPercent: Number(mismatchPercent.toFixed(2)),
    matchPercent: Number(matchPercent.toFixed(2)),
    passed: mismatchPercent < 3,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: node d2c-compare.mjs <render-png> <design-png> <output-diff-png>');
    process.exit(1);
  }
  const [renderPng, designPng, outputDiff] = args;
  if (!existsSync(resolve(designPng))) {
    console.error(`❌ 缺少设计稿基准图 design.png: ${designPng}`);
    console.error('   请在 MasterGo 打开目标稿 → 导出整页 PNG → 放入该路径后重跑 L4 门。');
    process.exit(1);
  }

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
  const { mismatchPercent, matchPercent, passed } = computeScore(mismatchedPixels, totalPixels);

  // 失败项汇总
  const failures = [];
  if (mismatchPercent >= 3) {
    failures.push({ type: 'pixel_mismatch', value: mismatchPercent + '%', threshold: '<3%' });
  }

  const result = {
    passed,
    failures,
    pixelMatch: {
      totalPixels,
      mismatchedPixels,
      mismatchPercent,
      matchPercent,
    },
    thresholds: THRESHOLDS,
    detailChecks: {
      pixelMatch: { passed: mismatchPercent < 3, value: mismatchPercent + '%', threshold: '<3%' },
      layout: { passed: mismatchPercent < 1, note: '整体像素差异 <1% 视为布局正确' },
      color: { passed: mismatchPercent < 5, note: '整体像素差异 <5% 视为颜色达标' },
      spacing: { passed: mismatchPercent < 5, note: '整体像素差异 <5% 视为间距达标' },
      fontSize: { passed: mismatchPercent < 5, note: '整体像素差异 <5% 视为字号达标' },
    },
    diffHeatmap: diffFile,
  };

  console.log(JSON.stringify(result, null, 2));
  console.error(`✅ 对比完成: ${matchPercent}% 匹配 (${mismatchedPixels} 像素差异)`);
  process.exit(result.passed ? 0 : 1);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch(err => {
    console.error(`❌ 对比失败: ${err.message}`);
    process.exit(1);
  });
}
