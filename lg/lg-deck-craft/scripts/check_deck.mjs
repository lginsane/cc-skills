import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pageRange } from '../lib/outline.mjs';
import { extractNumbers, validateSlides } from '../lib/slides.mjs';

const VAGUE = ['显著提升', '大幅优化', '全面提升', '极大提升', '质的飞跃'];
const CORE_VISUALS = new Set(['cover', 'chart']);

function slideText(s) {
  const parts = [s.title || '', ...(s.bullets || []), s.notes || ''];
  if (s.items) parts.push(...s.items);
  for (const col of s.columns || []) parts.push(col.title || '', ...(col.items || []));
  return parts.join(' ');
}

export async function checkDeck(workDir) {
  const outline = JSON.parse(await readFile(path.join(workDir, '03-outline.json'), 'utf8'));
  const facts = JSON.parse(await readFile(path.join(workDir, '01-facts.json'), 'utf8'));
  const factById = new Map(facts.map(f => [f.id, f]));

  let plan = null;
  try {
    plan = JSON.parse(await readFile(path.join(workDir, '04-forward-plan.json'), 'utf8'));
  } catch {}

  const slideDir = path.join(workDir, '05-slides');
  const files = (await readdir(slideDir)).filter(f => f.endsWith('.json')).sort();
  const slides = [];
  for (const f of files) slides.push(JSON.parse(await readFile(path.join(slideDir, f), 'utf8')));

  const violations = [];
  const durationMin = outline.durationMin || 20;
  const [min, max] = pageRange(durationMin);
  const mainSlides = slides.filter(s => !s.appendix);
  if (mainSlides.length < min || mainSlides.length > max) {
    const over = mainSlides.slice(max).map(s => s.id).join(', ');
    violations.push({ page: '-', rule: 'pages', message: `页数 ${mainSlides.length} 不在 ${min}-${max}${over ? `；超限页：${over}` : ''}` });
  }

  const result = validateSlides(slides, { facts });
  for (const e of result.errors) {
    const page = (e.match(/^(P\d+)/) || [])[1] || '-';
    violations.push({ page, rule: 'slide', message: e });
  }

  const numIndex = new Map();
  for (const f of facts) {
    for (const n of extractNumbers(`${f.claim || ''} ${f.value ?? ''}`)) {
      if (!numIndex.has(n)) numIndex.set(n, []);
      numIndex.get(n).push(f);
    }
  }

  const outlinePages = new Map((outline.pages || []).map(p => [p.id, p]));
  let seconds = 0;

  for (const s of slides) {
    if (!s.appendix) seconds += Number(s.seconds) || 0;
    const text = slideText(s);
    const numbers = [...extractNumbers(text), ...(s.chart?.values || []).map(String)];

    if (numbers.includes('774') && numbers.includes('765')) {
      violations.push({ page: s.id, rule: 'caliber', message: '同一页出现创建口径 774 与闭环口径 765' });
    }

    const matched = new Map();
    for (const n of numbers) for (const f of numIndex.get(n) || []) matched.set(f.id, f);
    const metrics = new Map();
    for (const f of matched.values()) {
      if (!f.metric) continue;
      if (!metrics.has(f.metric)) metrics.set(f.metric, new Set());
      metrics.get(f.metric).add(f.caliber);
    }
    for (const [metric, calibers] of metrics) {
      if (calibers.size > 1) {
        const ids = [...matched.values()].filter(f => f.metric === metric).map(f => f.id).join(', ');
        violations.push({ page: s.id, rule: 'caliber', message: `口径混用：${metric} 同时出现 ${[...calibers].join('/')}（${ids}）` });
      }
    }

    for (const d of plan?.directions || []) {
      if (d.status !== 'proposed') continue;
      const hit = (d.keywords || [d.title]).some(k => text.includes(k));
      if (hit && !/规划|建议|探索/.test(text)) {
        violations.push({ page: s.id, rule: 'forward-plan', message: `未确认方向「${d.title}」进入结论页，缺少「规划/建议/探索」标注` });
      }
    }

    const page = outlinePages.get(s.id);
    if (page && CORE_VISUALS.has(page.visual)) {
      for (const fid of s.facts || []) {
        const f = factById.get(fid);
        if (f && f.verification_level === 'located') {
          violations.push({ page: s.id, rule: 'verification', message: `核心页引用仅 located 的事实 ${fid}，需 recomputed/cross_checked` });
        }
      }
    }

    if (page) {
      const a = [...(page.facts || [])].sort().join(',');
      const b = [...(s.facts || [])].sort().join(',');
      if (a !== b) violations.push({ page: s.id, rule: 'facts-match', message: `大纲与页面 facts 不一致：outline=[${a}] slide=[${b}]` });
    }

    const covered = new Set();
    for (const fid of s.facts || []) {
      const f = factById.get(fid);
      if (f) for (const n of extractNumbers(`${f.claim || ''} ${f.value ?? ''}`)) covered.add(n);
    }
    const hasEvidenceNumber = numbers.some(n => covered.has(n));
    for (const word of VAGUE) {
      if (text.includes(word) && !hasEvidenceNumber) {
        violations.push({ page: s.id, rule: 'vague', message: `「${word}」缺少同页数字证据` });
      }
    }
  }

  const target = durationMin * 60;
  if (Math.abs(seconds - target) > target * 0.15) {
    violations.push({ page: '-', rule: 'duration', message: `总时长 ${seconds}s 与目标 ${target}s 偏差超过 15%` });
  }

  return { ok: violations.length === 0, violations, stats: { pages: slides.length, seconds } };
}

export async function writeReport(workDir, report) {
  await writeFile(path.join(workDir, '07-check-report.json'), JSON.stringify(report, null, 2), 'utf8');
}

async function run() {
  const args = process.argv.slice(2);
  const work = args[args.indexOf('--work') + 1];
  if (!work) {
    console.error('usage: node scripts/check_deck.mjs --work <dir>');
    process.exit(2);
  }
  const report = await checkDeck(work);
  await writeReport(work, report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
