#!/usr/bin/env node

/**
 * lg-scripts/codeplan-config.mjs — codeplan 配置加载(默认 + 深合并覆盖)
 * 阈值/开关/资源上限全部可配置化(v3 §3.2);配置文件缺失时用内置默认值并可通过 stdin 覆盖。
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_CONFIG = {
  structural: { sectionMax: 8 },
  logical: { enabled: true },
  similarity: { autoThreshold: 0.7, confirmThreshold: 0.35 },
  limits: { maxPages: 50, maxLayersPerPage: 20 },
  overwrite: 'skip',
  featureGroups: { enabled: true },
  codeplan: { enabled: true },
};

function deepMerge(base, override) {
  if (typeof override !== 'object' || override === null || Array.isArray(override)) return override === undefined ? base : override;
  const out = { ...(base || {}) };
  for (const k of Object.keys(override)) out[k] = deepMerge(base?.[k], override[k]);
  return out;
}

/** 返回配置:file 中的值优先于内置默认;override(测试/CLI)最优先 */
export function loadConfig(override = {}) {
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(readFileSync(resolve(__dirname, 'codeplan-config.json'), 'utf8'));
  } catch {
    /* 缺失用默认值,调用方决定是否告警 */
  }
  return deepMerge(deepMerge(structuredClone(DEFAULT_CONFIG), fileCfg), override);
}

// CLI 快速验视:开 codeplan 相关项
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  console.log(JSON.stringify(loadConfig(), null, 2));
}