#!/usr/bin/env node
// lg-scripts/input-guard.mjs — 输入安全 + 通用入口守卫（F2/F4）
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// 白名单规则：版本/编号/kebab/路径字段，禁 shell 元字符
export const SCHEMAS = {
  version: /^[A-Za-z0-9._-]+$/,
  fileId: /^\d+$/,
  layerId: /^\d+:\d+$/,
  kebab: /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/,
  pathSafe: /^[A-Za-z0-9._\-\/ ]+$/,
};

export function normalizeLayerId(s) {
  if (s == null) return '';
  try { return decodeURIComponent(String(s)).trim(); } catch { return String(s).trim(); }
}

export function readStdin() {
  const chunks = [];
  return new Promise((res, rej) => {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => {
      try { res(JSON.parse(chunks.join(''))); } catch (e) { rej(new Error(`stdin JSON 解析失败: ${e.message}`)); }
    });
    process.stdin.on('error', rej);
  });
}

export function fileArg(argv) {
  const i = argv.indexOf('--input');
  if (i === -1) return null;
  if (i + 1 >= argv.length) throw new Error('--input 需要文件路径参数');
  return argv[i + 1];
}

export async function readInput(argv) {
  const f = fileArg(argv);
  if (f) {
    const p = resolve(f);
    if (!existsSync(p)) throw new Error(`--input 文件不存在: ${p}`);
    return JSON.parse(readFileSync(p, 'utf8'));
  }
  return readStdin();
}

export function guard(config, rules) {
  for (const [field, re] of Object.entries(rules || {})) {
    const v = config[field];
    if (v === undefined || v === null) continue;
    if (!re.test(String(v))) {
      throw new Error(`输入校验失败 ${field}="${String(v)}" 非法（期望 ${re.source}）`);
    }
  }
  return config;
}

export function guardDesigns(designs) {
  for (const d of designs || []) {
    if (!d || typeof d !== 'object') throw new Error('designs 必须为对象数组');
    guard(d, { designId: SCHEMAS.kebab, mastergoFileId: SCHEMAS.fileId });
    const layer = normalizeLayerId(d.mastergoLayerId);
    if (layer && !SCHEMAS.layerId.test(layer)) throw new Error(`输入校验失败 mastergoLayerId="${layer}" 非法`);
    if (d.pageDir !== undefined && d.pageDir !== null && !SCHEMAS.kebab.test(d.pageDir)) {
      throw new Error(`输入校验失败 pageDir="${d.pageDir}" 非法`);
    }
  }
  return designs;
}

export function guardPaths(config, fields) {
  for (const f of fields || []) {
    const v = config[f];
    if (v === undefined || v === null) continue;
    const s = String(v);
    if (s.includes('..') || !SCHEMAS.pathSafe.test(s)) {
      throw new Error(`输入校验失败 ${f} 含非法字符或路径穿越`);
    }
  }
  return config;
}

export function dedupeDesigns(designs) {
  const seen = new Set();
  const out = [];
  for (const d of designs || []) {
    const key = d.mastergoFileId + ':' + normalizeLayerId(d.mastergoLayerId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...d, mastergoLayerId: normalizeLayerId(d.mastergoLayerId) });
  }
  return out;
}
