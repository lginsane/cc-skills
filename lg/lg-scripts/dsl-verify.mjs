#!/usr/bin/env node

/**
 * lg-dsl / dsl-verify.mjs — 落盘一致性自检（MANDATORY）
 *
 * 在 lg-dsl 读取 MasterGo 链接、生成本地 raw DSL 之后，必须运行本脚本，
 * 将「MCP 重新抓取的数据」与「本地落盘的 raw 数据」逐字段对比，确保 100% 一致。
 *
 * 用法:
 *   echo '{
 *     "designs": [{
 *       "designId": "ds_007",
 *       "fileId": "200861505263011",
 *       "layerId": "6:06411",
 *       "rawFile": ".lg-docs/dsl/1.4.8/auto-delivery/raw/ds_007.json",
 *       "fetchedSections": [ ...MCP getDesignSections 原始响应数组... ]
 *     }]
 *   }' | node ~/.claude/skills/lg-scripts/dsl-verify.mjs
 *
 * fetchedSections 结构（每个元素 = 一次 mcp__getDesignSections 的 JSON 响应）:
 *   { "sectionIndex": N, "section": {...}, "structureSiblingCount": N,
 *     "dsl": {...}, "nodeCount": N, "svgNodeCount": N, ... }
 *
 * 对比字段:
 *   - sectionIndex（顺序一致）
 *   - section.id / section.name / section.type
 *   - nodeCount / svgNodeCount
 *   - dsl.nodes 数量
 *   - dsl.styles 数量
 *   - dsl.rowTexts 数量
 *
 * 退出码: 0 = 全部一致 ✅；1 = 存在差异 ❌（阻止继续）
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// ---------- 读取 stdin ----------
function readStdin() {
  const chunks = [];
  return new Promise((resolvePromise, reject) => {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      try { resolvePromise(JSON.parse(chunks.join(''))); }
      catch (e) { reject(new Error(`stdin JSON 解析失败: ${e.message}`)); }
    });
    process.stdin.on('error', reject);
  });
}

/**
 * 计算 DSL 指纹（用于深度对比）
 * 递归统计关键字段：节点数量、样式数量、rowTexts 数量、SVG 节点数量
 */
function computeDslFingerprint(section) {
  const dsl = section.dsl || {};
  const nodes = dsl.nodes || [];
  const styles = dsl.styles || {};

  // 统计 nodes 中的关键信息
  const nodeCount = section.nodeCount !== undefined ? section.nodeCount : countNodes(nodes);
  const styleCount = Object.keys(styles).length;
  const rowTextsCount = (dsl.rowTexts || []).length;
  const svgCount = section.svgNodeCount !== undefined
    ? section.svgNodeCount
    : countSvgNodes(nodes);

  return {
    sectionIndex: section.sectionIndex,
    id: section.section?.id,
    name: section.section?.name,
    type: section.section?.type,
    nodeCount,
    styleCount,
    rowTextsCount,
    svgCount,
  };
}

/**
 * 递归统计节点数
 */
function countNodes(nodes) {
  if (!Array.isArray(nodes)) return 0;
  let count = 0;
  for (const node of nodes) {
    count++;
    if (node.children) count += countNodes(node.children);
    if (node.nodes) count += countNodes(node.nodes);
  }
  return count;
}

/**
 * 统计 SVG 节点数（含 PATH / SVG_* 类型）
 */
function countSvgNodes(nodes) {
  if (!Array.isArray(nodes)) return 0;
  let count = 0;
  for (const node of nodes) {
    const type = node.type || '';
    if (type.startsWith('PATH') || type.startsWith('SVG_')) count++;
    if (node.children) count += countSvgNodes(node.children);
    if (node.nodes) count += countSvgNodes(node.nodes);
  }
  return count;
}

/**
 * 对比两个 section 的指纹
 */
function compareSection(local, fetched) {
  const differences = [];
  if (local.sectionIndex !== fetched.sectionIndex) {
    differences.push(`sectionIndex: 本地=${local.sectionIndex} vs 抓取=${fetched.sectionIndex}`);
  }
  if (local.id !== fetched.id) {
    differences.push(`id: 本地=${local.id} vs 抓取=${fetched.id}`);
  }
  if (local.name !== fetched.name) {
    differences.push(`name: 本地=${local.name} vs 抓取=${fetched.name}`);
  }
  if (local.type !== fetched.type) {
    differences.push(`type: 本地=${local.type} vs 抓取=${fetched.type}`);
  }
  if (local.nodeCount !== fetched.nodeCount) {
    differences.push(`nodeCount: 本地=${local.nodeCount} vs 抓取=${fetched.nodeCount}`);
  }
  if (local.styleCount !== fetched.styleCount) {
    differences.push(`styleCount: 本地=${local.styleCount} vs 抓取=${fetched.styleCount}`);
  }
  if (local.rowTextsCount !== fetched.rowTextsCount) {
    differences.push(`rowTextsCount: 本地=${local.rowTextsCount} vs 抓取=${fetched.rowTextsCount}`);
  }
  if (local.svgCount !== fetched.svgCount) {
    differences.push(`svgCount: 本地=${local.svgCount} vs 抓取=${fetched.svgCount}`);
  }
  return differences;
}

/**
 * 对比设计稿的抓取数据与本地 raw
 */
function verifyDesign(design, fetchedSections) {
  const rawPath = resolve(process.env.MODOA_PROJECT_DIR || process.cwd(), design.rawFile);
  let raw;
  try {
    raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  } catch (e) {
    return {
      designId: design.designId,
      passed: false,
      error: `无法读取本地 raw: ${rawPath} (${e.message})`,
      differences: [],
    };
  }

  const localSections = raw.sections || [];

  // 1. section 总数对比
  const localCount = localSections.length;
  const fetchedCount = fetchedSections.length;
  const differences = [];

  if (localCount !== fetchedCount) {
    differences.push(`section 总数: 本地=${localCount} vs 抓取=${fetchedCount}`);
  }

  // 2. 逐 section 对比
  const compareCount = Math.min(localCount, fetchedCount);
  for (let i = 0; i < compareCount; i++) {
    const localFp = computeDslFingerprint(localSections[i]);
    const fetchedFp = computeDslFingerprint(fetchedSections[i]);
    const sectionDiffs = compareSection(localFp, fetchedFp);
    if (sectionDiffs.length > 0) {
      differences.push(`[section ${i}] ${sectionDiffs.join('; ')}`);
    }
  }

  return {
    designId: design.designId,
    layerId: design.layerId,
    localCount,
    fetchedCount,
    passed: differences.length === 0,
    differences,
  };
}

// ---------- 主流程 ----------
async function main() {
  const input = await readStdin();
  const designs = input.designs || [];

  if (designs.length === 0) {
    console.error('❌ 未提供 designs，请传入 {designs: [...]}');
    process.exit(1);
  }

  console.log('🔍 lg-dsl 落盘一致性自检（MANDATORY）');
  console.log('='.repeat(60));

  let allPassed = true;
  const report = [];

  for (const design of designs) {
    const fetchedSections = design.fetchedSections || [];
    if (fetchedSections.length === 0) {
      console.error(`⚠️ ${design.designId}: 未提供 fetchedSections（MCP 抓取数据），无法自检`);
      allPassed = false;
      continue;
    }
    const result = verifyDesign(design, fetchedSections);
    report.push(result);

    if (result.passed) {
      console.log(`✅ ${design.designId} (${design.layerId}): ${result.localCount} 个 section 与 MCP 抓取 100% 一致`);
    } else {
      allPassed = false;
      console.log(`❌ ${design.designId} (${design.layerId}): 存在 ${result.differences.length} 处差异`);
      if (result.error) {
        console.log(`   ${result.error}`);
      }
      for (const diff of result.differences.slice(0, 10)) {
        console.log(`   - ${diff}`);
      }
      if (result.differences.length > 10) {
        console.log(`   ... 还有 ${result.differences.length - 10} 处`);
      }
    }
  }

  console.log('='.repeat(60));
  if (allPassed) {
    console.log('✅ 自检通过：所有 design 的本地 DSL 与 MCP 抓取数据 100% 一致');
    process.exit(0);
  } else {
    console.log('❌ 自检失败：存在数据不一致，禁止继续后续流程（请重新抓取并落盘）');
    process.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e) => {
    console.error(`❌ dsl-verify.mjs 执行失败: ${e.message}`);
    process.exit(1);
  });
}
