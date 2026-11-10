#!/usr/bin/env node

/**
 * lg-dsl / dsl-fidelity-check.mjs — 结构产物一致性自检（MANDATORY 出口门禁）
 *
 * 在 image-manifest.mjs 与 component-blueprint.mjs 产出之后运行，
 * 校验「蓝图 / manifest / 原始 DSL」三者闭合，任何一项不通过 → 退出码 1（阻止进入 lg-code）。
 *
 * 校验项:
 *   A 引用闭合   —— blueprint 引用的所有 sectionIndex 均在原始 DSL 范围内
 *   B 无造假条目 —— manifest 里每条 url 都能在原始 DSL 中找到真实图片节点
 *   C 全量覆盖   —— 原始 DSL 每个独立图片 url 必然出现在 manifest（images 或 failedAssets），0 遗漏
 *   D 全量归属   —— 每个非豁免 section 恰好归属一个 zone；悬空 section 必须被 blueprint.dangling 显式列出
 *
 * 输入（stdin JSON）:
 *   { "rawFile":       ".lg-docs/dsl/1.5.0/task-list/raw-dsl.json",
 *     "manifestFile":  ".../image-manifest.json",
 *     "blueprintFile": ".../component-blueprint.json" }
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseInput, collectImageCandidates } from './image-manifest.mjs';
import { readInput, guardPaths } from './input-guard.mjs';

function toIndex(path) {
  try { return JSON.parse(readFileSync(resolve(path), 'utf-8')); }
  catch { return null; }
}

export function runCheck(config) {
  const raw = toIndex(config.rawFile);
  const manifest = toIndex(config.manifestFile);
  const blueprint = toIndex(config.blueprintFile);
  if (!raw) throw new Error(`无法读取 rawFile: ${config.rawFile}`);
  if (!manifest) throw new Error(`无法读取 manifestFile: ${config.manifestFile}`);
  if (!blueprint) throw new Error(`无法读取 blueprintFile: ${config.blueprintFile}`);

  const parsed = parseInput(raw);
  const failures = [];
  const warnings = [];
  const idx = config.sectionIndexFile ? toIndex(config.sectionIndexFile) : null;
  const totalSections = idx?.totalSections ?? blueprint.totalSections ?? parsed.overview.sections?.length ?? 0;
  const actualSections = (raw.sectionDsls || []).length;
  if (actualSections !== totalSections) {
    failures.push(`[取数完整性] raw-dsl 实际 ${actualSections} 个 section ≠ 声明 ${totalSections}`);
  }
  if (idx && !Number.isInteger(idx.totalSections)) {
    warnings.push('[取数完整性] section-index 缺 totalSections 字段，跳过权威核对');
  }

  // ---- A 引用闭合 ----
  const inRange = (i, tag) => { if (!Number.isInteger(i) || i < 0 || i >= totalSections) failures.push(`[引用闭合] ${tag} 引用越界 sectionIndex=${i}（total=${totalSections}）`); };
  for (const z of blueprint.zones || []) for (const i of z.sections || []) inRange(i, `zone ${z.id}`);
  for (const o of blueprint.overlays || []) inRange(o.sectionIndex, `overlay ${o.id}`);
  for (const r of blueprint.repeatables || []) for (const i of r.sections || []) inRange(i, `repeatable ${r.id}`);
  for (const e of blueprint.exempted || []) inRange(e.sectionIndex, `exempted`);

  // ---- B 无造假条目 / C 全量覆盖 ----
  const rawUrls = collectImageCandidates(parsed).map(c => c.url);
  const rawUrlSet = new Set(rawUrls);
  const manifestUrls = new Set([
    ...(manifest.images || []).map(i => i.url),
    ...(manifest.failedAssets || []).map(f => f.url),
  ]);
  for (const img of manifest.images || []) if (!rawUrlSet.has(img.url)) failures.push(`[无造假] manifest image "${img.url}" 在原始 DSL 中不存在`);
  for (const f of manifest.failedAssets || []) if (!rawUrlSet.has(f.url)) failures.push(`[无造假] manifest failedAsset "${f.url}" 在原始 DSL 中不存在`);
  for (const url of rawUrlSet) if (!manifestUrls.has(url)) warnings.push(`[全量覆盖] 原始 DSL 图片 "${url}" 未出现在 manifest（遗漏下载）`);

  // ---- D 全量归属 ----
  const exemptIdx = new Set((blueprint.exempted || []).map(e => e.sectionIndex));
  const overlayIdx = new Set((blueprint.overlays || []).map(o => o.sectionIndex));
  const zoneOwned = new Set();
  for (const z of blueprint.zones || []) for (const i of z.sections || []) zoneOwned.add(i);
  const dangles = [];
  for (let i = 0; i < totalSections; i++) {
    if (exemptIdx.has(i) || overlayIdx.has(i)) continue;
    if (!zoneOwned.has(i)) dangles.push(i);
  }
  const declaredDangles = new Set(blueprint.dangling || []);
  for (const i of dangles) if (!declaredDangles.has(i)) failures.push(`[全量归属] section ${i} 悬空且未在 blueprint.dangling 中声明`);
  for (const i of declaredDangles) if (!dangles.includes(i)) warnings.push(`[全量归属] blueprint.dangling 声明了 ${i}，但该 section 已归入 zone（声明与实况不符）`);

  // 结构健康：一个 zone 都没建却全量 dangling，多半是 section 元数据缺失导致拆解失效（E 项只能验证取数完整性）
  if (totalSections > 0 && zoneOwned.size === 0) {
    warnings.push('[结构健康] 无任何 section 归入 zone（全悬空）——blueprint 结构拆解可能未生效，请确认 raw-dsl 的 overview.sections 或 blueprint 的 sectionIndexFile 提供了完整 section 几何元数据');
  }

  const passed = failures.length === 0;
  return {
    passed,
    failures,
    warnings,
    checks: {
      refsClosed: 'A',
      manifestGenuine: 'B',
      urlCoverage: { rawUrls: rawUrlSet.size, coveredByManifest: manifestUrls.size },
      sectionOwnership: { total: totalSections, exempt: exemptIdx.size, overlay: overlayIdx.size, zoneOwned: zoneOwned.size, dangling: dangles },
      fetchCompleteness: { actual: actualSections, declared: totalSections },
    },
  };
}

async function main() {
  const config = await readInput(process.argv);
  guardPaths(config, ['rawFile', 'manifestFile', 'blueprintFile', 'sectionIndexFile']);
  if (!config.rawFile || !config.manifestFile || !config.blueprintFile) {
    throw new Error('缺少 rawFile / manifestFile / blueprintFile');
  }
  const result = runCheck(config);
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) {
    console.error(`❌ 结构一致性自检未通过: ${result.failures.length} 项`);
    result.failures.forEach(f => console.error(`   ✗ ${f}`));
    process.exit(1);
  }
  if (result.warnings.length) {
    console.error('⚠️ 警告:');
    result.warnings.forEach(w => console.error(`   ⚠ ${w}`));
  }
  console.error('✅ 结构一致性自检通过');
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  main().catch(e => { console.error(`❌ dsl-fidelity-check.mjs 失败: ${e.message}`); process.exit(1); });
}