#!/usr/bin/env node
// .claude/skills/lg-scripts/dsl-placeholder-check.mjs
// D2C 交付前占位符残留扫描（MANDATORY，lg-code D2C Phase 3.5 调用）
//
// 背景：MasterGo DSL 还原时，SVG 图标走 `@@SVG:{shortKey}@@`、长文本走 `T{sec}|{nodeId}`
// 占位符经 mcp__applyDesign 注入。若注入环节未完成/占位符失效，代码中会残留占位符，
// 且不报错——本脚本在交付前拦截，命中即禁止交付。
//
// 用法:
//   # 1. stdin 传入路径清单
//   echo '{"paths":["./src/views/task-list/","./src/views/form.vue"]}' \
//     | node ~/.claude/skills/lg-scripts/dsl-placeholder-check.mjs
//   # 2. CLI 参数（文件或目录，递归）
//   node ~/.claude/skills/lg-scripts/dsl-placeholder-check.mjs src/views
//
// 扫描模式:
//   - @@SVG:<shortKey>@@      （SVG 图标占位，shortKey 形如 S0#0）
//   - T<sec>|<nodeId>         （长文本占位，形如 T3|1:1234 / T3|1:2；nodeId 可为纯数字或 数字:数字）
//
// 输出（stdout JSON）:
//   { passed, total, files: [{ file, relativeFile, matches: [{ line, content, snippets }] }] }
// 退出码: 0 = 全部文件无残留（passed:true）；1 = 存在残留（passed:false）

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';

// ---------- 匹配规则 ----------
const SVG_PLACEHOLDER_RE = /@@SVG:[^@\s]+@@/g;
const TEXT_PLACEHOLDER_RE = /\bT\d+\|\d+(?::\d+)*\b/g;

// 要扫描的候选文本文件后缀（跳过图片/二进制）
const SCAN_EXTS = new Set([
  '.vue', '.html', '.htm', '.js', '.jsx', '.ts', '.tsx',
  '.dart', '.json', '.md', '.css', '.less', '.scss',
]);

function extname(name) {
  const m = name.match(/\.[^./\\]+$/);
  return m ? m[0].toLowerCase() : '';
}

/**
 * 扫描单文件，返回 { file, matches, unreadable }
 * 注：String.prototype.match 以 global 正则匹配时会从 index 0 完整扫描，无 lastIndex 污染
 */
export function scanFile(filePath) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return { file: filePath, matches: [], unreadable: true };
  }

  const lines = content.split('\n');
  const matches = [];

  for (let i = 0; i < lines.length; i++) {
    const svgHits = lines[i].match(SVG_PLACEHOLDER_RE) || [];
    const textHits = lines[i].match(TEXT_PLACEHOLDER_RE) || [];
    const snippets = [...svgHits, ...textHits];
    if (snippets.length === 0) continue;

    matches.push({
      line: i + 1,
      content: snippets.join(' '),
      snippets,
    });
  }

  return { file: filePath, matches };
}

/**
 * 递归收集目录下所有可扫描文件
 */
export function collectFilesUnderDir(dirPath) {
  const result = [];
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(current, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (SCAN_EXTS.has(extname(name))) {
        result.push(full);
      }
    }
  }
  return result;
}

/**
 * 解析待扫描路径：{ paths: [] } → 文件绝对路径数组（文件或目录）
 */
export function resolveScanPaths(input, baseDir = process.cwd()) {
  const rawPaths = Array.isArray(input && input.paths) ? input.paths : [];
  const files = [];
  for (const p of rawPaths) {
    const full = resolve(baseDir, p);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) files.push(...collectFilesUnderDir(full));
      else if (SCAN_EXTS.has(extname(full))) files.push(full);
    } catch {
      // 文件不存在/不可读：记录后继续（不报错，交给调用侧判断）
    }
  }
  return [...new Set(files)];
}

/**
 * 主流程：扫描并汇总
 */
export function scanAll(files, baseDir = process.cwd()) {
  const results = [];
  let total = 0;
  for (const file of files) {
    const r = scanFile(file);
    if (r.unreadable) continue;
    r.relativeFile = relative(baseDir, file);
    results.push(r);
    total += r.matches.length;
  }
  return {
    passed: total === 0,
    total,
    files: results,
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function main() {
  const baseDir = process.env.MODOA_PROJECT_DIR || process.cwd();
  let paths = [];

  const hasCliPaths = process.argv.slice(2).length > 0;
  if (!hasCliPaths && !process.stdin.isTTY) {
    try {
      const input = await readStdin();
      paths = resolveScanPaths(input, baseDir);
    } catch (e) {
      console.error(JSON.stringify({ passed: false, error: `stdin JSON 解析失败: ${e.message}`, note: '用法: echo \'{"paths":[...]}\' | node dsl-placeholder-check.mjs' }));
      process.exit(1);
    }
  } else {
    paths = resolveScanPaths({ paths: process.argv.slice(2) }, baseDir);
  }

  if (paths.length === 0) {
    console.log(JSON.stringify({ passed: true, total: 0, files: [], note: '未扫描到候选文件（路径不存在或无可扫描后缀）' }, null, 2));
    process.exit(0);
  }

  const result = scanAll(paths, baseDir);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(JSON.stringify({ passed: false, error: e.message }));
    process.exit(1);
  });
}