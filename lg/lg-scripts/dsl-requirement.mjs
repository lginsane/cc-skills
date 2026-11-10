// dsl-requirement.mjs — DSL 页面 ↔ 需求数据（vision/analyze/smoke）关联
// 独立纯函数模块：dsl.mjs 生成 page-mapping.json 时调用，lg-code 消费 dataLinks 快照
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

// 匹配成功阈值 0.35；>= 0.6 自动确认，否则 requirementConfirmed=false 待人工确认
export const REQUIREMENT_MATCH_THRESHOLD = 0.35;
export const REQUIREMENT_CONFIRM_THRESHOLD = 0.6;

/**
 * 规范化需求页面名：去除首部序号与分隔符（"2_编辑本地商家" → "编辑本地商家"）
 */
export function normalizeRequirementName(name) {
  if (!name) return '';
  return name.trim().replace(/^\d+[\s_\-—–]*/, '');
}

/**
 * 从产物文件名提取模块名（"2_编辑本地商家.json" → "编辑本地商家"）
 */
export function extractModuleNameFromFile(filename) {
  return filename.replace(/\.json$/i, '').replace(/^\d+[\s_\-—–]*/, '');
}

/**
 * 简单相似度（与 dsl.mjs 算法一致）：字符 bigram 的 Jaccard
 */
function similarity(a, b) {
  const s1 = a.toLowerCase().replace(/[^a-z0-9\p{Script=Han}]/gu, '');
  const s2 = b.toLowerCase().replace(/[^a-z0-9\p{Script=Han}]/gu, '');
  if (!s1 || !s2) return 0;
  const bigrams1 = new Set();
  const bigrams2 = new Set();
  for (let i = 0; i < s1.length - 1; i++) bigrams1.add(s1.substring(i, i + 2));
  for (let i = 0; i < s2.length - 1; i++) bigrams2.add(s2.substring(i, i + 2));
  const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
  const union = new Set([...bigrams1, ...bigrams2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * 收集需求页面名索引。
 * vision：读 JSON 内容 pages[].name；analyze/smoke：从文件名提取模块名。
 * 返回 { vision: Map<页面名,{file,pageName}>, analyze: Map<模块名,{file}>, smoke: Map<模块名,{file}> }
 */
export function collectRequirementIndex(cwd, config, reqVersion) {
  const index = { vision: new Map(), analyze: new Map(), smoke: new Map() };

  const visionDir = join(cwd, config.vision_dir || './.lg-docs/vision/', reqVersion);
  if (existsSync(visionDir)) {
    for (const f of readdirSync(visionDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(readFileSync(join(visionDir, f), 'utf8'));
        for (const p of raw.pages || []) {
          const name = normalizeRequirementName(p.name);
          if (name && !index.vision.has(name)) index.vision.set(name, { file: f, pageName: p.name });
        }
      } catch { /* 单个文件解析失败跳过 */ }
    }
  }

  const dirMap = {
    analyze: config.analysis_dir || './.lg-docs/analysis/',
    smoke: config.smoke_cases_dir || './.lg-docs/smoke/',
  };
  for (const [key, rel] of Object.entries(dirMap)) {
    const dir = join(cwd, rel, reqVersion);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const name = normalizeRequirementName(extractModuleNameFromFile(f));
      if (!name || name.startsWith('_')) continue; // 过滤 _all_cases 等聚合文件
      if (!index[key].has(name)) index[key].set(name, { file: f });
    }
  }

  return index;
}

/**
 * 为单个 page 匹配需求数据，返回关联结果（dataLinks 为固化快照，供 lg-code 精确读取）
 */
export function matchRequirementPage(page, index) {
  const queries = [page.pageName, page.designName].filter(Boolean);
  if (queries.length === 0) {
    return { requirementPage: '', requirementConfirmed: false, requirementCandidates: [], dataLinks: {} };
  }

  const allEntries = [
    ...index.vision.entries(),
    ...index.analyze.entries(),
    ...index.smoke.entries(),
  ];

  // 1. 综合三源找最匹配的需求页面名
  let bestName = '';
  let bestScore = 0;
  for (const [name] of allEntries) {
    const score = Math.max(...queries.map(q => similarity(q, name)));
    if (score > bestScore) { bestScore = score; bestName = name; }
  }

  const matched = bestScore >= REQUIREMENT_MATCH_THRESHOLD;
  const result = {
    requirementPage: matched ? bestName : '',
    requirementConfirmed: matched && bestScore >= REQUIREMENT_CONFIRM_THRESHOLD,
    requirementCandidates: [],
    dataLinks: {},
  };

  // 2. 主匹配成立时才填 dataLinks（对每源取与 bestName 最相似者）
  if (matched) {
    for (const key of ['vision', 'analyze', 'smoke']) {
      let link = null;
      let linkScore = 0;
      for (const [name, l] of index[key].entries()) {
        const score = similarity(bestName, name);
        if (score > linkScore) { linkScore = score; link = l; }
      }
      if (link && linkScore >= REQUIREMENT_MATCH_THRESHOLD) result.dataLinks[key] = link;
    }
  }

  // 3. 候选列表（Top 5，去重）
  const seen = new Set();
  const candidates = [];
  for (const [name] of allEntries) {
    if (seen.has(name)) continue;
    seen.add(name);
    const score = Math.max(...queries.map(q => similarity(q, name)));
    if (score > 0) candidates.push({ name, score });
  }
  result.requirementCandidates = candidates.sort((a, b) => b.score - a.score).slice(0, 5).map(c => c.name);

  return result;
}

/**
 * 统计关联结果（design 级）：linked=有关联；partial=vision 有但 analyze/smoke 缺；missing=无关联
 */
export function summarizeRequirement(pages) {
  let linked = 0, partial = 0, missing = 0;
  for (const p of pages) {
    for (const d of p.designs || []) {
      const req = d.designRequirement;
      if (req && req.requirementPage) {
        linked++;
        const cov = req.coverage || {};
        if (!(cov.analyze && cov.smoke)) partial++;
      } else {
        missing++;
      }
    }
  }
  return { linked, partial, missing };
}

// ============================================================
// 迭代 2：design 级关联
// ============================================================

// 强关键词：状态词 + 具体动作/名词（区分度高，命中即信）
export const DESIGN_STRONG_KEYWORDS = [
  '未提交', '巡查中', '已完成', '审核中', '进行中', '待审核', '暂停',
  '查看明细', '查看图片', '查看详情', '查看记录',
  '新增', '创建', '编辑', '修改',
];
// 弱关键词：通用动词/名词（区分度低，不单独构成匹配，仅作 similarity 微调）
export const DESIGN_WEAK_KEYWORDS = ['查看', '列表', '详情', '预览', '图片', '弹窗', '日志'];

/**
 * 从 designName 提取强/弱关键词：{ strong: string[], weak: string[] }
 */
export function extractKeywords(designName) {
  if (!designName) return { strong: [], weak: [] };
  return {
    strong: DESIGN_STRONG_KEYWORDS.filter(kw => designName.includes(kw)),
    weak: DESIGN_WEAK_KEYWORDS.filter(kw => designName.includes(kw)),
  };
}

/**
 * design 级匹配：
 * 1. 强关键词（状态词→具体动作词）命中即锁定；
 * 2. 无强命中时：若存在强意图（strong 非空）→ 诚实降级不匹配（数据缺失，不降级弱词错配）；
 *    若只有弱词 → similarity 达标才匹配（弱词仅 +0.1 微调）。
 * 3. 匹配不到返回 coverage.vision=false，由 dsl.mjs 回退 page 主关联。
 */
export function matchDesignRequirement(design, visionIndex) {
  const name = design.designName || '';
  const { strong, weak } = extractKeywords(name);
  let bestName = '';
  let bestScore = 0;
  let matchBy = '';

  // 1. 强关键词命中（状态词在前）
  for (const kw of strong) {
    for (const [vName] of visionIndex.entries()) {
      if (!vName.includes(kw)) continue;
      const score = 1.0 + similarity(name, vName);
      if (score > bestScore) { bestScore = score; bestName = vName; matchBy = kw; }
    }
    if (bestName) break;
  }

  // 2a. 有强意图但无命中 → 诚实降级（不降级弱词）
  if (!bestName && strong.length > 0) {
    return {
      requirementPage: '', matchBy: '', vision: null,
      coverage: { vision: false, analyze: false, smoke: false },
    };
  }

  // 2b. 只有弱词 → similarity 达标才匹配
  if (!bestName) {
    for (const [vName] of visionIndex.entries()) {
      const sim = similarity(name, vName);
      const weakHit = weak.some(kw => vName.includes(kw));
      const score = sim + (weakHit ? 0.1 : 0);
      if (score >= REQUIREMENT_MATCH_THRESHOLD && score > bestScore) {
        bestScore = score; bestName = vName; matchBy = weakHit ? 'similarity+weak' : 'similarity';
      }
    }
  }

  const matched = bestName !== '';
  return {
    requirementPage: bestName, matchBy,
    vision: matched ? { ...visionIndex.get(bestName), matchBy } : null,
    coverage: { vision: matched, analyze: false, smoke: false },
  };
}

/**
 * analyze/smoke 尽力提取（不改 lg-analyze）：按 design 关键词或 requirementPage
 * 匹配 analyze/smoke 文件名；匹配不到 coverage=false，lg-code 降级不编造。
 */
export function matchDesignAnalyzeSmoke(design, reqIndex, requirementPage) {
  const { strong, weak } = extractKeywords(design.designName || '');
  const allKw = [...strong, ...weak];
  const coverage = { analyze: false, smoke: false };
  const links = {};

  for (const key of ['analyze', 'smoke']) {
    let bestLink = null;
    let bestScore = 0;
    for (const [name, link] of reqIndex[key].entries()) {
      const kwHit = allKw.some(kw => name.includes(kw));
      const pageSim = requirementPage ? similarity(requirementPage, name) : 0;
      const score = kwHit ? Math.max(pageSim, 0.5) : pageSim;
      if (score >= REQUIREMENT_MATCH_THRESHOLD && score > bestScore) {
        bestScore = score; bestLink = link;
      }
    }
    if (bestLink) { links[key] = bestLink; coverage[key] = true; }
  }
  return { coverage, links };
}
