#!/usr/bin/env node
// lg-scripts/semantic-rename.mjs — 后置业务语义重命名 v1（两阶段命名的阶段 2）
//
// 背景：DSL 原始数据只有结构名（矩形 46 / 图片 w-full h-full object-cover），
// 业务语义名（topbar-avatar / model-thumb）只在 lg-code 生成页面 DOM 时出现。
// 本脚本在 lg-code 生成后运行：按「图片 url → 业务组件名」映射，把 images/ 文件
// 与 image-manifest.json 的 semanticName/localPath/assetKey 回写为业务名。
//
// 输入（stdin JSON 或 --input <file>）:
//   { "manifestFile": ".lg-docs/dsl/1.0.1/product-outfit/image-manifest.json",
//     "imagesDir": "images",                          // 可选，默认 manifest 同目录下 images/
//     "nameMap": { "<image url>": "<业务语义名>" },     // url 为精确 join 键（内联）
//     "nameMapFile": "./semantic-name-map.json" }      // 或指向 { url: 业务名 } 文件（lg-code 编码阶段产出）
//
// 行为：
//   - 命中的：磁盘重命名 + manifest 回写（naming: "business"），冲突加 -N 后缀
//   - 未命中：保留原结构名（naming: "structural"）
//   - 幂等：重复运行不产生额外 -N（同名即跳过）
import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { sanitizeFilename } from './image-manifest.mjs';
import { readInput, guardPaths } from './input-guard.mjs';

export function runRename(config) {
  const mf = resolve(config.manifestFile);
  const manifest = JSON.parse(readFileSync(mf, 'utf-8'));
  const imageDir = resolve(dirname(mf), config.imagesDir || 'images');
  const nameMap = { ...(config.nameMap || {}), ...(config.nameMapFile ? JSON.parse(readFileSync(resolve(config.nameMapFile), 'utf-8')) : {}) };

  const used = new Set();
  const renamed = [];
  const kept = [];
  const skipped = [];

  for (const img of manifest.images || []) {
    const biz = nameMap[img.url];
    if (!biz) {
      img.naming = img.naming || 'structural';
      kept.push(img.url);
      continue;
    }

    const base = sanitizeFilename(String(biz));
    const ext = extname(img.localPath) || '.png';
    let name = base + ext;
    let n = 1;
    const keyGen = () => `${base}${n > 1 ? `-${n}` : ''}${ext}`;
    while (used.has(name)) { n += 1; name = keyGen(); }
    used.add(name);

    const oldPath = resolve(dirname(mf), img.localPath);
    const newPath = resolve(imageDir, name);
    if (img.semanticName !== name) {
      if (existsSync(newPath) && oldPath !== newPath) {
        skipped.push({ url: img.url, reason: 'target-exists', target: name });
        continue;
      }
      if (existsSync(oldPath)) {
        renameSync(oldPath, newPath);
        renamed.push({ url: img.url, from: img.semanticName, to: name });
      }
    }
    img.semanticName = name;
    img.localPath = `images/${name}`;
    img.assetKey = base;
    img.naming = 'business';
  }

  writeFileSync(mf, JSON.stringify(manifest, null, 2), 'utf-8');
  const summary = { renamed: renamed.length, kept: kept.length, skipped: skipped.length };
  const lines = [`✅ 业务语义重命名完成: 重命名 ${summary.renamed} / 保留 ${summary.kept} / 跳过 ${summary.skipped}`];
  for (const r of renamed) lines.push(`   ${r.from} → ${r.to}`);
  for (const s of skipped) lines.push(`   ⚠️ 跳过 ${s.url}（${s.reason}: ${s.target}）`);
  return { summary, renamed, lines };
}

async function main() {
  const config = await readInput(process.argv);
  guardPaths(config, ['manifestFile', 'nameMapFile']);
  const r = runRename(config);
  console.log(r.lines.join('\n'));
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  main().catch(e => { console.error(`❌ semantic-rename.mjs 失败: ${e.message}`); process.exit(1); });
}