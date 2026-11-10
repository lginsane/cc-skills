#!/usr/bin/env node

/**
 * lg-scripts/feature-groups.mjs — 跨稿相似组聚类(可选增强,带开关)
 *
 * 信号(v3 §8.1):designName 前缀 / 页面结构指纹(zone kinds+output types)/ 共享 shell / 规模比
 * 门限:≥autoThreshold 自动并组;[confirmThreshold, auto) → confirmRequired;<confirm 不并组。
 * 产出:featureGroups[] 含 evidence 逆向索引(§2.2/§8.3),供人工审核聚类依据。
 */

import { loadConfig } from './codeplan-config.mjs';
import { pathToFileURL } from 'url';

export function pageSignal(p) {
  return {
    pageId: p.pageId,
    // 聚类键:优先完整 feature 名(如 ai-shoot / 商单管理),避免被分隔符截断成过粗的组
    prefix: p.feature ? String(p.feature) : String(p.pageName || p.pageId || '').split(/[-_—]/)[0],
    shell: (p.zones || []).some(z => z.kind === 'shell'),
    zoneKinds: [...new Set((p.zones || []).map(z => z.kind))].sort(),
    outputTypes: [...new Set((p.outputs || []).map(o => o.outputType))].sort(),
    count: p.totalSections || 0,
  };
}

function jaccard(a, b) {
  const u = new Set([...a, ...b]);
  if (u.size === 0) return 0;
  return a.filter(v => b.includes(v)).length / u.size;
}

/** 页面相似度(带细分指标,供 evidence) */
export function pageSimilarity(a, b) {
  const shellMatch = a.shell === b.shell ? 1 : 0;
  const outputJaccard = jaccard(a.outputTypes, b.outputTypes);
  const prefixSame = a.prefix && a.prefix === b.prefix ? 1 : 0;
  const overlapRatio = a.count && b.count ? Math.min(a.count, b.count) / Math.max(a.count, b.count) : 0;
  return {
    structuralSimilarity: Number((0.4 * shellMatch + 0.3 * outputJaccard + 0.2 * prefixSame + 0.1 * overlapRatio).toFixed(3)),
    sharedShell: shellMatch === 1,
    outputJaccard: Number(outputJaccard.toFixed(3)),
    prefixSame: prefixSame === 1,
    overlapRatio: Number(overlapRatio.toFixed(3)),
  };
}

/**
 * 聚类所有 complex 页(全复杂页才参与,防 O(N²) 爆炸由 limits.maxPages 约束)。
 * @param pages 复杂页列表(其后 complexity.complex===true)
 * @returns featureGroups[]
 */
export function clusterPages(pages, override = {}) {
  const cfg = loadConfig(override);
  const { autoThreshold = 0.7, confirmThreshold = 0.35 } = cfg.similarity;
  const sigs = pages.map(pageSignal);
  const groups = [];

  for (let i = 0; i < sigs.length; i++) {
    if (sigs[i]._used) continue;
    const members = [i];
    let canonical = null;
    for (let j = i + 1; j < sigs.length; j++) {
      if (sigs[j]._used) continue;
      const sim = pageSimilarity(sigs[i], sigs[j]);
      if (sim.structuralSimilarity >= confirmThreshold) {
        members.push(j);
        if (!canonical) canonical = sim;
      }
    }
    if (members.length >= 2) {
      members.forEach(m => { sigs[m]._used = true; });
      const sim = canonical; // 首个配对作为 evidence 基准(足够审计;也可改为取组内最高配对)
      const simScore = sim ? sim.structuralSimilarity : confirmThreshold;
      const group = {
        groupId: `fg_${sigs[i].prefix || 'misc'}`,
        members: members.map(m => sigs[m].pageId),
        similarity: Number(simScore.toFixed(3)),
        confirmRequired: simScore < autoThreshold,
        evidence: {
          structuralSimilarity: Number(simScore.toFixed(3)),
          sharedShell: sim?.sharedShell ?? false,
          sharedComponents: [],
          overlapRatio: sim?.overlapRatio ?? 0,
        },
      };
      groups.push(group);
    }
  }
  return groups;
}

const readStdin = () => new Promise((res, rej) => { const c = []; process.stdin.setEncoding('utf8'); process.stdin.on('data', d => c.push(d)); process.stdin.on('end', () => res(JSON.parse(c.join('')))); process.stdin.on('error', rej); });
async function main() {
  const { pages, override } = await readStdin();
  console.log(JSON.stringify(clusterPages(pages, override), null, 2));
}
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) main().catch(e => { console.error(e.message); process.exit(1); });