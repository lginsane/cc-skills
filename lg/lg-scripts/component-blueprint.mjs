#!/usr/bin/env node

/**
 * lg-dsl / component-blueprint.mjs
 *
 * 复杂页面拆解，产出 component-blueprint.json（文件计划），供 lg-code 消费。
 * 拆分依据 = DSL 结构（容器分区/覆盖层几何/结构指纹），天然排斥原型/接口语义参与。
 *
 * 机制（契约见 docs/blueprint-contract.md）:
 *   ① zone 区域分区    —— splitContainers / 包含关系
 *   ② 覆盖层识别       —— 条件A插件词 ? 条件B几何悬浮（A∪B）
 *   ③ 重复结构提取     —— 自研结构指纹（排除 x/y 偏移），支持 manual 人工兜底
 *   ④ 豁免              —— 滚动条/分隔线/泛化背景
 *   ⑤ 复杂度判定       —— 简单/复杂两档，复杂才出文件计划
 *
 * 输入（stdin JSON）:
 *   { "rawFile": ".lg-docs/dsl/1.5.0/task-list/raw-dsl.json",
 *     "outDir":  ".lg-docs/dsl/1.5.0/task-list",
 *     "pageDir": "task-manage/task-list",
 *     "manualRepeatables": [{ "templateName": "卡片", "sectionIndexes": [2,3,4] }] }
 *
 * 产出:
 *   outDir/component-blueprint.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseInput, collectAllNodes, isGenericName, sanitizeFilename } from './image-manifest.mjs';
import { readInput, guard, guardPaths, SCHEMAS } from './input-guard.mjs';

/**
 * 读取可选的 section-index.json（真稿组装时 raw-dsl 的 overview.sections 可能为空，
 * 几何元数据在 section-index 中完整提供）。
 * @returns {null | { totalSections?: number, sections?: Array }}
 */
export function readSectionIndex(config) {
  if (!config.sectionIndexFile) return null;
  try {
    return JSON.parse(readFileSync(resolve(config.sectionIndexFile), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 解析 section 元数据列表（几何/命名），三源降级：
 *   1. raw-dsl.overview.sections（完整契约）
 *   2. section-index.json 的 sections（含 x/y/width/height —— 真稿组装时 overview.sections 可能为空，本源兜底）
 *   3. sectionDsls[].section（仅 id/name/type，无几何，最弱兜底）
 */
export function resolveSections(parsed, idx) {
  if (parsed.overview?.sections?.length) return parsed.overview.sections;
  const idxSections = idx?.sections;
  if (Array.isArray(idxSections) && idxSections.length) {
    return idxSections.slice().sort((a, b) => (a.sectionIndex ?? 0) - (b.sectionIndex ?? 0));
  }
  return (parsed.sectionDsls || []).map(s => ({
    sectionIndex: s.sectionIndex,
    ...(s.section && typeof s.section === 'object' ? s.section : {}),
  }));
}

// ------------------------------------------------------------
// 豁免 / 覆盖层判定
// ------------------------------------------------------------

const EXEMPT_RE = /滚动|scrollbar|滚动条|分隔|分割线|divider/i;
// 仅"形状/装饰"类才视为泛化背景豁免；组/Frame/容器 是内容容器，禁止按名豁免（避免误踩真实内容）
const GENERIC_DECOR_RE = /^(矩形|椭圆|Ellipse|Rectangle|背景|装饰|Plate|板块)\s*[\d_-]*$/i;
const OVERLAY_KEYWORD_RE = /弹窗|抽屉|浮层|模态|dialog|modal|drawer|popover|toast/i;
const CREATE_EDIT_RE = /新增|编辑|创建|添加|新建|create|edit|add/i;
const FORM_CONTROL_RE = /input|select|picker|date|form|button|checkbox|radio|textarea/i;
const SHELL_KEYWORD_RE = /侧栏|侧边|sidebar|导航|nav|顶栏|header|页脚|footer|面包屑|tabs|tab|标签页/i;

export function classifyExempt(section) {
  const name = section?.name || '';
  if (EXEMPT_RE.test(name)) return { exempt: true, reason: 'scrollbar/divider' };
  if (GENERIC_DECOR_RE.test(name.trim())) return { exempt: true, reason: 'generic-decor-layer' };
  return { exempt: false };
}

function sectionHasFormControls(sec) {
  const nodes = collectAllNodes(sec?.dsl?.nodes || []);
  return nodes.some(node => FORM_CONTROL_RE.test(String(node.name || '')));
}

/**
 * 覆盖层双条件判定：
 *   条件A：名称含弹窗类关键词（编辑器动词仅在与表单结构并存时算）
 *   条件B：几何悬浮 —— 不被任何 splitContainer 完整包含、非整页、非泛化背景，
 *          且与某非背景 section 的单向重叠占自身面积 > 30%
 */
export function detectOverlay(parsed, splitBBoxes) {
  const sections = parsed.overview.sections || [];
  const byIndex = new Map(parsed.sectionDsls.map((s, i) => [s.sectionIndex, s]));
  const canvasW = parsed.overview?.rootMetadata?.width || 0;
  const canvasH = parsed.overview?.rootMetadata?.height || 0;
  const overlays = [];

  const isGeneric = (s) => GENERIC_DECOR_RE.test(String(s?.name || '').trim());
  const isFullPage = (s) => (s?.width || 0) >= canvasW * 0.8 && (s?.height || 0) >= canvasH * 0.8;
  const inSplit = (s, z) =>
    s.x >= z.x && s.x + (s.width || 0) <= z.x + (z.width || 0) &&
    s.y >= z.y && s.y + (s.height || 0) <= z.y + (z.height || 0);

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (!s || !Number.isFinite(s.x)) continue;
    const name = String(s.name || '');
    const condA = OVERLAY_KEYWORD_RE.test(name);
    const condA2 = CREATE_EDIT_RE.test(name) && sectionHasFormControls(byIndex.get(i));

    // 条件B：几何悬浮
    let condB = false;
    const area = (s.width || 0) * (s.height || 0);
    if (area > 0 && splitBBoxes.length > 0 && !isFullPage(s) && !isGeneric(s)) {
      const inAnySplit = splitBBoxes.some(z => inSplit(s, z));
      if (!inAnySplit) {
        condB = sections.some(o => {
          if (o.id === s.id) return false;
          // 只屏蔽泛化背景（矩形/装饰层）；全画布内容区是合法重叠对象
          if (!o || isGeneric(o)) return false;
          const ix = Math.max(0, Math.min(s.x + s.width, o.x + o.width) - Math.max(s.x, o.x));
          const iy = Math.max(0, Math.min(s.y + s.height, o.y + o.height) - Math.max(s.y, o.y));
          return (ix * iy) / area > 0.3;
        });
      }
    }

    if (condA || condA2 || condB) {
      overlays.push({
        id: `o${overlays.length + 1}`,
        name,
        sectionIndex: i,
        confidence: (condA || condA2) && condB ? 'both' : (condA ? 'keyword' : 'geometry'),
        keyword: condA || condA2,
        geometry: condB,
      });
    }
  }
  return overlays;
}

// ------------------------------------------------------------
// 区域分区
// ------------------------------------------------------------

export function classifyZoneKind(name) {
  return SHELL_KEYWORD_RE.test(String(name || '')) ? 'shell' : 'content';
}

function centers(s) {
  return { cx: s.x + (s.width || 0) / 2, cy: s.y + (s.height || 0) / 2 };
}

function inBBox(b, z) {
  return b.cx >= (z.x ?? 0) && b.cx <= (z.x ?? 0) + (z.width ?? 0) &&
         b.cy >= (z.y ?? 0) && b.cy <= (z.y ?? 0) + (z.height ?? 0);
}

/**
 * 构建 zones（区域分区）
 * @returns {{zones: [], orphans: [], dangling: []}}
 */
export function buildZones(parsed, overlayIdx, exemptIdx) {
  const sections = parsed.overview.sections || [];
  const splits = parsed.overview.splitContainers || [];
  const bits = sections.map((s, i) => ({ i, s, ...centers(s) }));
  const isSkip = (i) => overlayIdx.has(i) || exemptIdx.has(i);

  let zones;
  if (splits.length > 0) {
    zones = splits.map((z, zi) => ({
      id: `z${zi + 1}`,
      name: z.name || `区域${zi + 1}`,
      kind: classifyZoneKind(z.name || ''),
      x: z.x || 0, y: z.y || 0, width: z.width || 0, height: z.height || 0,
      sections: [],
    }));
  } else {
    zones = [];
  }

  const covered = new Set();
  for (let i = 0; i < sections.length; i++) {
    if (isSkip(i)) continue;
    const zone = zones.find(z => inBBox(bits[i], z));
    if (zone) { zone.sections.push(i); covered.add(i); }
  }

  const orphans = [];
  for (let i = 0; i < sections.length; i++) {
    if (isSkip(i) || covered.has(i)) continue;
    orphans.push(i);
  }

  // 无 split 场景：顶层区块各成 zone
  if (zones.length === 0 && orphans.length > 0) {
    const topBits = orphans.filter(i =>
      !orphans.some(o => o !== i &&
        bits[i].cx > bits[o].s.x && bits[i].cx < bits[o].s.x + bits[o].s.width &&
        bits[i].cy > bits[o].s.y && bits[o].s.y < bits[i].cy && bits[i].cy < bits[o].s.y + bits[o].s.height)
    );
    for (const i of topBits) {
      zones.push({
        id: `z${zones.length + 1}`,
        name: sections[i].name || `区域${zones.length + 1}`,
        kind: classifyZoneKind(sections[i].name || ''),
        x: sections[i].x || 0, y: sections[i].y || 0,
        width: sections[i].width || 0, height: sections[i].height || 0,
        sections: [i],
      });
    }
    covered.clear();
    for (const z of zones) z.sections.forEach(i => covered.add(i));
    for (let i = 0; i < sections.length; i++) {
      if (isSkip(i) || covered.has(i)) continue;
      const zone = zones.find(z => inBBox(bits[i], z));
      if (zone) { zone.sections.push(i); covered.add(i); }
    }
  }

  // 余量区兜底：有 split 但仍未落入任何 zone 的非豁免 section（真实内容常落在小 split 之外）
  // → 合成"内容区" zone 承接，避免误判为悬空；dangling 只留给画布外的不可归属孤岛
  if (zones.length > 0) {
    const orphan = [];
    for (let i = 0; i < sections.length; i++) {
      if (isSkip(i) || covered.has(i)) continue;
      if (!zones.some(z => z.sections.includes(i))) orphan.push(i);
    }
    if (orphan.length > 0) {
      const xs = orphan.map(i => sections[i].x || 0);
      const ys = orphan.map(i => sections[i].y || 0);
      const x2s = orphan.map(i => (sections[i].x || 0) + (sections[i].width || 0));
      const y2s = orphan.map(i => (sections[i].y || 0) + (sections[i].height || 0));
      const zx = Math.min(...xs), zy = Math.min(...ys);
      zones.push({
        id: `z${zones.length + 1}`,
        name: '内容区',
        kind: 'content',
        x: zx, y: zy,
        width: Math.max(...x2s) - zx,
        height: Math.max(...y2s) - zy,
        synthetic: true,
        sections: orphan,
      });
      orphan.forEach(i => covered.add(i));
    }
  }

  // dangling：仍未能归入任何 zone 的非豁免 section
  const dangling = [];
  for (let i = 0; i < sections.length; i++) {
    if (isSkip(i) || covered.has(i)) continue;
    if (!zones.some(z => z.sections.includes(i))) dangling.push(i);
  }
  return { zones, dangling };
}

// ------------------------------------------------------------
// 重复结构提取（自研指纹，排除坐标偏移）
// ------------------------------------------------------------

function nodeFingerprint(node) {
  const children = node.children || node.nodes || [];
  const textPart = (node.text || [])
    .map(t => (typeof t === 'string' ? t : t?.text))
    .filter(Boolean)
    .join('|');
  return [
    node.type, node.name || '',
    node.fill || '',
    node.layoutStyle?.width || 0, node.layoutStyle?.height || 0,
    String(node.svgShortKey || ''),
    textPart,
    children.map(nodeFingerprint).join(','),
  ].join('§');
}

export function buildRepeatables(parsed, skipIdx) {
  const groups = new Map(); // fingerprint → indexes
  for (let i = 0; i < parsed.sectionDsls.length; i++) {
    if (skipIdx.has(i)) continue;
    const dsl = parsed.sectionDsls[i].dsl || {};
    const fp = (dsl.nodes || []).map(nodeFingerprint).sort().join('\n');
    if (!fp) continue;
    if (!groups.has(fp)) groups.set(fp, []);
    groups.get(fp).push(i);
  }
  const repeatables = [];
  let n = 0;
  for (const [fp, indexes] of groups) {
    if (indexes.length < 2) continue;
    n += 1;
    const first = parsed.sectionDsls[indexes[0]].section;
    repeatables.push({
      id: `r${n}`,
      templateName: first?.name || `重复组${n}`,
      structureFingerprint: fp.slice(0, 64),
      count: indexes.length,
      sections: indexes,
      source: 'auto',
    });
  }
  return repeatables;
}

// ------------------------------------------------------------
// 文件计划 + 复杂度
// ------------------------------------------------------------

function toPascalCase(str) {
  return sanitizeFilename(str)
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Component';
}

export function buildOutputs(blueprint, pageDir) {
  const dir = `src/views/${pageDir || 'unknown'}`;
  const outputs = [];
  const slots = {};

  for (const z of blueprint.zones) {
    const name = toPascalCase(z.name);
    if (z.kind === 'shell') {
      outputs.push({ file: `${dir}/components/${name}.vue`, role: 'shell', fromZone: z.id });
      slots[z.id] = `${name}.vue`;
    }
  }
  for (const o of blueprint.overlays) {
    const name = toPascalCase(o.name);
    outputs.push({ file: `${dir}/components/${name}.vue`, role: 'overlay', fromOverlay: o.id });
    slots[o.id] = `${name}.vue`;
  }
  for (const r of blueprint.repeatables) {
    const name = toPascalCase(r.templateName);
    outputs.push({ file: `${dir}/components/${name}.vue`, role: 'repeatable', fromRepeatable: r.id });
    slots[r.id] = `${name}.vue`;
  }

  const contentZones = blueprint.zones.filter(z => z.kind === 'content');
  outputs.unshift({
    file: `${dir}/index.vue`,
    role: 'page',
    assembles: contentZones.map(z => z.id),
    contentSections: contentZones.flatMap(z => z.sections),
    slots: Object.keys(slots).length ? slots : undefined,
  });
  return outputs;
}

export function buildBlueprint(config) {
  const raw = JSON.parse(readFileSync(config.rawFile, 'utf-8'));
  const parsed = parseInput(raw);
  const idx = readSectionIndex(config);
  const sections = resolveSections(parsed, idx);
  const view = sections === parsed.overview.sections
    ? parsed
    : { ...parsed, overview: { ...(parsed.overview || {}), sections } };
  const sectionCount = idx?.totalSections ?? sections.length;

  // 豁免
  const exemptIdx = new Set();
  const exempted = [];
  for (let i = 0; i < sectionCount; i++) {
    const r = classifyExempt(sections[i]);
    if (r.exempt) { exemptIdx.add(i); exempted.push({ sectionIndex: i, name: sections[i]?.name, reason: r.reason }); }
  }

  // 覆盖层
  const splitBBoxes = (view.overview.splitContainers || []).map(z => ({ x: z.x, y: z.y, width: z.width, height: z.height }));
  const overlays = detectOverlay(view, splitBBoxes);
  const overlayIdx = new Set(overlays.map(o => o.sectionIndex));

  // zones
  const skipRadius = new Set([...exemptIdx, ...overlayIdx]);
  const { zones, dangling } = buildZones(view, overlayIdx, exemptIdx);

  // repeatables（自动 + manual 兜底）
  const auto = buildRepeatables(view, skipRadius);
  const repeatables = [...auto];
  for (const m of (config.manualRepeatables || [])) {
    repeatables.push({
      id: `r${repeatables.length + 1}`,
      templateName: m.templateName || `人工重复组${repeatables.length + 1}`,
      structureFingerprint: '',
      count: (m.sectionIndexes || []).length,
      sections: m.sectionIndexes || [],
      source: 'manual',
    });
  }

  // 复杂度：出现 覆盖层/重复结构/壳层(shell) / 超大规模 才判 complex；纯内容单区页维持 simple
  const complex = overlays.length > 0 || repeatables.length > 0 || sectionCount > 8 || zones.some(z => z.kind === 'shell');

  const blueprint = {
    schemaVersion: '1',
    designName: parsed.designName,
    fileId: parsed.fileId,
    layerId: parsed.layerId,
    version: parsed.version,
    complexity: complex ? 'complex' : 'simple',
    totalSections: sectionCount,
    zones,
    overlays,
    repeatables,
    exempted,
    dangling,
    outputs: [],
  };
  blueprint.outputs = complex ? buildOutputs(blueprint, config.pageDir) : [
    { file: `src/views/${config.pageDir || 'unknown'}/index.vue`, role: 'page', contentSections: zones.flatMap(z => z.sections) },
  ];
  return blueprint;
}

// ------------------------------------------------------------
// CLI
// ------------------------------------------------------------

export function runBlueprint(config) {
  const blueprint = buildBlueprint(config);
  const outPath = resolve(config.outDir, 'component-blueprint.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(blueprint, null, 2), 'utf-8');

  const lines = [`✅ 页面拆解完成: ${blueprint.designName} (${blueprint.complexity})`];
  lines.push(`   📐 sections ${blueprint.totalSections} | zones ${blueprint.zones.length} | overlays ${blueprint.overlays.length} | repeatables ${blueprint.repeatables.length} | 豁免 ${blueprint.exempted.length}`);
  for (const z of blueprint.zones) lines.push(`   ├─ zone ${z.id} ${z.name} (${z.kind}) sections=[${z.sections.join(',')}]`);
  for (const o of blueprint.overlays) lines.push(`   ├─ overlay ${o.id} ${o.name} [${o.confidence}] section=${o.sectionIndex}`);
  for (const r of blueprint.repeatables) lines.push(`   ├─ repeatable ${r.id} ${r.templateName} x${r.count} [${r.source}] sections=[${r.sections.join(',')}]`);
  if (blueprint.exempted.length) lines.push(`   ⚠️ 豁免: ${blueprint.exempted.map(e => `${e.sectionIndex}#${e.name}(${e.reason})`).join('; ')}`);
  if (blueprint.dangling.length) lines.push(`   ⚠️ 悬空 section（未归任何 zone）: [${blueprint.dangling.join(',')}]`);
  lines.push(`   📋 component-blueprint.json → ${outPath}`);
  return { blueprint, summaryText: lines.join('\n') };
}

async function main() {
  const config = await readInput(process.argv);
  guardPaths(config, ['rawFile', 'outDir', 'sectionIndexFile']);
  if (config.pageDir !== undefined && config.pageDir !== null) {
    guard(config, { pageDir: SCHEMAS.kebab });
  }
  if (!config.rawFile) throw new Error('缺少 rawFile');
  if (!config.outDir) throw new Error('缺少 outDir');
  const { summaryText } = runBlueprint(config);
  console.log(summaryText);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  main().catch(e => { console.error(`❌ component-blueprint.mjs 失败: ${e.message}`); process.exit(1); });
}