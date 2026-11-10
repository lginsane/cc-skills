#!/usr/bin/env node

/**
 * lg-dsl / image-manifest.mjs
 *
 * 从 MasterGo raw DSL 提取图片资源，产出 image-manifest.json + 语义化下载。
 *
 * 解决三件事（契约见 docs/image-manifest-contract.md）:
 *   1. 语义命名 —— AST 邻近匹配命名（节点名 → 就近文本 → 祖先容器 → section 名 → image）
 *   2. 冗余去重  —— URL 级去重 + 下载后 sha256 指纹去重（同内容不同地址只落一份）
 *   3. 路径可知  —— manifest 记录 DSL 节点 → 本地文件的寻址链，lg-code 按 url 精确取路径
 *
 * 输入（stdin JSON）:
 *   { "rawFile": ".lg-docs/dsl/1.5.0/task-list/raw-dsl.json",
 *     "outDir":  ".lg-docs/dsl/1.5.0/task-list" }
 *
 * 产出:
 *   outDir/images/*.{png,jpg,webp}      —— 语义化命名 + sha256 指纹去重后的位图
 *   outDir/image-manifest.json          —— 寻址链（url → assetKey → localPath）+ failedAssets
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { get as httpGet } from 'http';
import { get as httpsGet } from 'https';
import { readInput, guardPaths } from './input-guard.mjs';

// ------------------------------------------------------------
// 基础工具
// ------------------------------------------------------------

const IMAGE_EXT_RE = /(?:\.png|\.jpe?g|\.webp)(?:[?#]|$)/i;
const GENERIC_NAME_RE = /^(矩形|组|容器|Frame|Group|Rectangle|IMAGE|椭圆|Ellipse|Component|组件)\s*[\d_-]*$/i;

export function isGenericName(name) {
  return !name || GENERIC_NAME_RE.test(String(name).trim());
}

export function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'image';
}

export function parseInput(raw) {
  if (!raw) {
    return { designName: '未命名页面', fileId: '', layerId: '', version: 'unknown', overview: {}, sectionDsls: [] };
  }
  return {
    designName: raw.designName || raw.overview?.rootMetadata?.name || '未命名页面',
    fileId: raw.fileId || '',
    layerId: raw.layerId || '',
    version: raw.version || 'unknown',
    overview: raw.overview || {},
    sectionDsls: Array.isArray(raw.sectionDsls) ? raw.sectionDsls : [],
  };
}

/** 递归收集 nodes 树所有节点（无副作用，不挂载临时字段，避免污染共享对象） */
export function collectAllNodes(nodes, result = []) {
  for (const node of nodes || []) {
    result.push(node);
    const children = node.children || node.nodes || [];
    if (children.length) collectAllNodes(children, result);
  }
  return result;
}

/** 带祖先路径的遍历：返回 [{ node, path }]（path 为祖先节点数组，不含自身；无副作用） */
export function collectWithPath(nodes, path = []) {
  const out = [];
  for (const node of nodes || []) {
    out.push({ node, path });
    const children = node.children || node.nodes || [];
    if (children.length) out.push(...collectWithPath(children, [...path, node]));
  }
  return out;
}

function resolvePaintUrl(paint, key) {
  if (!paint || !Array.isArray(paint.value)) return null;
  const urls = paint.value
    .filter(v => v && typeof v === 'object' && typeof v.url === 'string' && IMAGE_EXT_RE.test(v.url))
    .map(v => v.url);
  if (!urls.length) return null;
  // 同 paint 可能同时存颜色与图片；图片取首个（多图少见，取首个与旧实现一致，契约已声明）
  return urls[0];
}

function nearestDescendantText(node) {
  for (const sub of collectAllNodes(node.children || node.nodes || []) || []) {
    if (sub.type === 'TEXT' && Array.isArray(sub.text)) {
      for (const t of sub.text) {
        if (typeof t === 'string' && t.trim()) return t.trim();
        if (t && typeof t.text === 'string' && !t._placeholder && t.text.trim()) return t.text.trim();
      }
    }
  }
  return '';
}

function resolvePaint(node, dsl, overview) {
  const key = node.fill;
  if (!key || typeof key !== 'string') return null;
  return dsl?.styles?.[key] || overview?.rootMetadata?.styles?.[key] || null;
}

function classifyRole(label, node) {
  const text = `${label} ${node?.name || ''}`.toLowerCase();
  if (/icon|图标/.test(text)) return 'icon';
  if (/背景|装饰|bg-|background|decor|图案/.test(text)) return 'decor';
  return 'content';
}

// ------------------------------------------------------------
// 收集（纯函数，可测）
// ------------------------------------------------------------

/**
 * 提取 DSL 中全部图片候选：
 *  - 递归遍历每个 section 的 nodes 树，命中带图片 fill 的节点
 *  - URL 级去重（同一图多处引用只留首个，其余记 duplicateOf）
 */
export function collectImageCandidates(parsed) {
  const candidates = [];
  const seenUrls = new Set();
  for (const sec of parsed.sectionDsls || []) {
    const sectionIndex = sec.sectionIndex;
    const sectionName = sec.section?.name || '';
    const dsl = sec.dsl || {};
    for (const { node, path } of collectWithPath(dsl.nodes || [])) {
      const paint = resolvePaint(node, dsl, parsed.overview);
      const url = resolvePaintUrl(paint, node.fill);
      if (!url) continue;
      const nodePath = path.map(n => n.name).filter(Boolean);
      let nearText = '';
      if (node.type === 'TEXT' && Array.isArray(node.text)) {
        for (const t of node.text) {
          if (typeof t === 'string' && t.trim()) nearText = t.trim();
          if (t && typeof t.text === 'string' && !t._placeholder && t.text.trim()) nearText = t.text.trim();
        }
      } else if (node.type === 'IMAGE') {
        nearText = nearestDescendantText(node);
      }
      const ancestorNames = [...nodePath].reverse().filter(n => !isGenericName(n));
      if (seenUrls.has(url)) {
        const first = candidates.find(c => c.url === url);
        if (first) first.duplicateUris.push({ sectionIndex, nodeId: node.id || null });
        continue;
      }
      seenUrls.add(url);
      candidates.push({
        sectionIndex,
        sectionName,
        nodeId: node.id || null,
        nodeName: node.name || '',
        nodePath,
        nearText,
        ancestorNames,
        url,
        width: node.layoutStyle?.width || 0,
        height: node.layoutStyle?.height || 0,
        duplicateUris: [],
      });
    }
  }
  return candidates;
}

/**
 * 语义命名降级链：节点名 → 就近文本 → 祖先容器 → section 名 → image
 */
export function resolveLabel(cand) {
  if (cand.nodeName && !isGenericName(cand.nodeName)) return cand.nodeName;
  if (cand.nearText) return cand.nearText;
  if (cand.ancestorNames.length) return cand.ancestorNames[0];
  if (cand.sectionName && !isGenericName(cand.sectionName)) return cand.sectionName;
  return 'image'; // 契约兜底：禁止把泛化名（"矩形 46"/"组 19700"）当成语义文件名落盘
}

/** 冲突加后缀：同语义名不同内容 → -2 -3 … */
export function assignSemanticNames(candidates) {
  const used = new Set();
  for (const cand of candidates) {
    const base = sanitizeFilename(resolveLabel(cand));
    let name = base;
    let n = 1;
    const keyGen = () => `${base}${n > 1 ? `-${n}` : ''}`;
    while (used.has(name)) { n += 1; name = keyGen(); }
    used.add(name);
    cand.assetKey = name;
    const extUrl = (() => { try { return extname(new URL(cand.url).pathname); } catch { return ''; } })();
    const ext = extUrl && /^\.[a-z0-9]+$/i.test(extUrl) ? extUrl.toLowerCase() : '.png';
    cand.semanticName = `${name}${ext}`;
    cand.role = classifyRole(cand.assetKey, cand);
  }
  return candidates;
}

// ------------------------------------------------------------
// 下载 + sha256 指纹去重
// ------------------------------------------------------------

export const defaultTransport = (url) => new Promise((res, rej) => {
  const get = url.startsWith('https:') ? httpsGet : httpGet;
  const req = get(url, (r) => {
    if (r.statusCode !== 200) {
      r.resume();
      return rej(new Error(`HTTP ${r.statusCode}`));
    }
    const chunks = [];
    r.on('data', c => chunks.push(c));
    r.on('end', () => res({ statusCode: 200, data: Buffer.concat(chunks) }));
  });
  req.on('error', rej);
});

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * 逐候选下载；下载失败 → failedAssets；下载成功 → 指纹去重（同内容只留首个）
 * @param transport 可注入下载函数（测试用），默认 defaultTransport
 */
export async function downloadAndHash(candidates, destDir, transport = defaultTransport) {
  mkdirSync(destDir, { recursive: true });
  const images = [];
  const failedAssets = [];
  const hashToImage = new Map(); // sha256 → 首次出现的 file

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    try {
      const { data } = await transport(cand.url);
      const hash = sha256(data);
      if (hashToImage.has(hash)) {
        // 内容去重：与已有文件同指纹，不落盘，指向已落盘的
        images.push({
          imageId: `img_${String(i + 1).padStart(3, '0')}`,
          sectionIndex: cand.sectionIndex,
          nodeId: cand.nodeId,
          nodeName: cand.nodeName,
          nodePath: [...cand.nodePath, cand.nodeName].filter(Boolean),
          url: cand.url,
          assetKey: cand.assetKey,
          semanticName: hashToImage.get(hash).semanticName,
          localPath: hashToImage.get(hash).localPath,
          sha256: hash,
          role: cand.role,
          width: cand.width,
          height: cand.height,
          duplicateOf: hashToImage.get(hash).imageId,
        });
        continue;
      }
      const file = `${cand.assetKey}${extname(cand.semanticName)}`;
      const dest = resolve(destDir, file);
      writeFileSync(dest, data);
      const image = {
        imageId: `img_${String(i + 1).padStart(3, '0')}`,
        sectionIndex: cand.sectionIndex,
        nodeId: cand.nodeId,
        nodeName: cand.nodeName,
        nodePath: [...cand.nodePath, cand.nodeName].filter(Boolean),
        url: cand.url,
        assetKey: cand.assetKey,
        semanticName: file,
        localPath: `images/${file}`,
        sha256: hash,
        role: cand.role,
        width: cand.width,
        height: cand.height,
        duplicateOf: null,
      };
      hashToImage.set(hash, image);
      images.push(image);
    } catch (e) {
      failedAssets.push({
        url: cand.url,
        sectionIndex: cand.sectionIndex,
        nodeId: cand.nodeId,
        nodeName: cand.nodeName,
        error: e.message,
        reason: 'download_failed',
      });
    }
  }
  return { images, failedAssets };
}

// ------------------------------------------------------------
// CLI 主流程
// ------------------------------------------------------------

export async function runManifest(config) {
  const raw = JSON.parse(readFileSync(config.rawFile, 'utf-8'));
  const parsed = parseInput(raw);
  const candidates = collectImageCandidates(parsed);
  assignSemanticNames(candidates);

  const imageDir = resolve(config.outDir, 'images');
  const { images, failedAssets } = await downloadAndHash(candidates, imageDir, config.transport);

  const manifest = {
    schemaVersion: '1',
    designName: parsed.designName,
    fileId: parsed.fileId,
    layerId: parsed.layerId,
    version: parsed.version,
    generatedAt: new Date().toISOString(),
    images: images.map(i => ({ ...i, naming: 'structural' })),
    failedAssets,
    summary: {
      totalCandidates: candidates.length,
      urlDeduped: candidates.reduce((s, c) => s + c.duplicateUris.length, 0),
      downloaded: images.filter(i => !i.duplicateOf).length,
      contentDeduped: images.filter(i => i.duplicateOf).length,
      failed: failedAssets.length,
    },
  };
  writeFileSync(resolve(config.outDir, 'image-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  // 冻结输出摘要（含告警）
  const lines = [`✅ 图片提取完成: ${parsed.designName}`];
  lines.push(`   📦 候选 ${manifest.summary.totalCandidates} | 下载 ${manifest.summary.downloaded} | 指纹去重 ${manifest.summary.contentDeduped} | URL 去重 ${manifest.summary.urlDeduped} | 失败 ${manifest.summary.failed}`);
  if (failedAssets.length > 0) {
    lines.push('   ⚠️ 下载失败清单（见 manifest.failedAssets）:');
    for (const f of failedAssets.slice(0, 10)) lines.push(`      ${f.url} → ${f.error}`);
  }
  lines.push(`   📋 image-manifest.json → ${resolve(config.outDir, 'image-manifest.json')}`);
  return { manifest, summaryText: lines.join('\n') };
}

async function main() {
  const config = await readInput(process.argv);
  guardPaths(config, ['rawFile', 'outDir']);
  if (!config.rawFile) throw new Error('缺少 rawFile');
  if (!config.outDir) throw new Error('缺少 outDir');
  const { summaryText } = await runManifest(config);
  console.log(summaryText);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  main().catch(e => { console.error(`❌ image-manifest.mjs 失败: ${e.message}`); process.exit(1); });
}