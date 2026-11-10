#!/usr/bin/env node
// lg-scripts/precheck.mjs — 环境前置检查（F3）
import { existsSync, accessSync, constants } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const REQUIRED_SCRIPTS = [
  'dsl.mjs', 'image-manifest.mjs', 'component-blueprint.mjs',
  'dsl-fidelity-check.mjs', 'dsl-requirement.mjs',
  'codeplan.mjs', 'complexity.mjs', 'feature-groups.mjs', 'codeplan-validate.mjs',
  'input-guard.mjs',
];

const OPTIONAL_DEPS = ['puppeteer', 'pixelmatch', 'pngjs'];
const MIN_NODE = 18;

function nodeVersionOK() {
  const [maj] = process.versions.node.split('.').map(Number);
  return maj >= MIN_NODE;
}

export async function runPrecheck(dir = HERE) {
  const missing = [];
  const unreadable = [];
  for (const f of REQUIRED_SCRIPTS) {
    const p = join(dir, f);
    if (!existsSync(p)) { missing.push(f); continue; }
    try { accessSync(p, constants.R_OK); } catch { unreadable.push(f); }
  }

  const optMissing = [];
  for (const d of OPTIONAL_DEPS) {
    try { await import(d); } catch { optMissing.push(d); }
  }

  const lines = [
    `node ${process.versions.node}（要求 ≥${MIN_NODE}）：${nodeVersionOK() ? '✅' : '❌'}`,
  ];
  for (const f of REQUIRED_SCRIPTS) {
    lines.push(`${(!missing.includes(f) && !unreadable.includes(f)) ? '✅' : '❌'} ${f}`);
  }
  lines.push(`L4 可选依赖（${OPTIONAL_DEPS.join('/')}）：${optMissing.length ? `⚠️ 缺失 ${optMissing.join(',')}（L4 门需安装；全局安装可能检测不到，以 L4 运行时为准）` : '✅'}`);

  const ok = missing.length === 0 && unreadable.length === 0 && nodeVersionOK();
  return { ok, missing, unreadable, optMissing, lines };
}

const aIdx = process.argv.indexOf('--dir');
const dir = aIdx > -1 ? resolve(process.argv[aIdx + 1] || HERE) : HERE;

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  runPrecheck(dir).then(r => {
    console.log(r.lines.join('\n'));
    if (!r.ok) {
      const bad = [...r.missing.map(m => `缺失:${m}`), ...r.unreadable.map(m => `不可读:${m}`)];
      console.error(`❌ 环境前置检查未通过: ${bad.join('，')}`);
      process.exit(1);
    }
    console.error('✅ 环境前置检查通过');
  }).catch(e => { console.error(`❌ precheck 失败: ${e.message}`); process.exit(1); });
}