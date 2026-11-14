import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function scoreDeck(checkReport, judge) {
  const dims = judge.dimensions || [];
  const scores = dims.map(d => Number(d.score) || 0);
  const total = scores.reduce((a, b) => a + b, 0);
  const passed = total >= 36 && scores.every(s => s >= 3) && Boolean(checkReport.ok);
  const lowest = scores.length ? Math.min(...scores) : 0;
  const highest = scores.length ? Math.max(...scores) : 0;
  const actions = lowest === highest
    ? []
    : dims.filter(d => Number(d.score) === lowest)
        .map(d => `提升 ${d.id}（当前 ${d.score} 分）`);
  return { total, passed, breakdown: dims, actions, adversarial: judge.adversarial || [] };
}

export function toMarkdown(result, checkReport) {
  const lines = [
    '# 评分卡',
    '',
    `- 总分：**${result.total}/45**`,
    `- 结论：**${result.passed ? '达标' : '未达标'}**`,
    `- 规则检查：${checkReport.ok ? '通过' : `未通过（${checkReport.violations.length} 项）`}`,
    '',
    '## 维度得分',
    '',
    '| 维度 | 得分 | 依据 |',
    '|---|---:|---|'
  ];
  for (const d of result.breakdown) lines.push(`| ${d.id} | ${d.score} | ${d.evidence || '-'} |`);
  if (result.actions.length) {
    lines.push('', '## 优先改进', '');
    for (const a of result.actions) lines.push(`- ${a}`);
  }
  if (result.adversarial.length) {
    lines.push('', '## 对抗审稿', '');
    for (const a of result.adversarial) lines.push(`- ${a.question} → ${a.answered ? '答得上' : '答不上'}${a.where ? `（${a.where}）` : ''}`);
  }
  if (!checkReport.ok) {
    lines.push('', '## 规则违规', '');
    for (const v of checkReport.violations) lines.push(`- ${v.page} / ${v.rule}：${v.message}`);
  }
  return lines.join('\n') + '\n';
}

async function run() {
  const args = process.argv.slice(2);
  const work = args[args.indexOf('--work') + 1];
  if (!work) {
    console.error('usage: node scripts/score_deck.mjs --work <dir>');
    process.exit(2);
  }
  const checkReport = JSON.parse(await readFile(path.join(work, '07-check-report.json'), 'utf8'));
  const judge = JSON.parse(await readFile(path.join(work, '08-judge.json'), 'utf8'));
  const result = scoreDeck(checkReport, judge);
  await writeFile(path.join(work, '09-scorecard.md'), toMarkdown(result, checkReport), 'utf8');
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
