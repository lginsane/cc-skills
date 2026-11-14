import { existsSync } from 'node:fs';
import path from 'node:path';

const REQUIRED = ['id', 'claim', 'source', 'owner', 'category', 'caliber', 'verified', 'verification_level'];
const CALIBERS = new Set(['created', 'closed', 'snapshot']);
const LEVELS = new Set(['located', 'recomputed', 'cross_checked']);
const CONFIDENCE = new Set(['high', 'medium', 'low']);
const CATEGORIES = new Set(['delivery', 'quality', 'efficiency', 'growth', 'ai', 'risk']);

export function validateFacts(facts, opts = {}) {
  const errors = [];
  const root = opts.root || '.';
  const ids = new Set();

  for (const [i, f] of facts.entries()) {
    const tag = f.id || `#${i}`;
    for (const key of REQUIRED) {
      if (f[key] === undefined || f[key] === null || f[key] === '') {
        errors.push(`${tag}: missing ${key}`);
      }
    }
    if (f.id && ids.has(f.id)) errors.push(`${tag}: duplicate id`);
    if (f.id) ids.add(f.id);
    if (f.caliber && !CALIBERS.has(f.caliber)) errors.push(`${tag}: unknown caliber ${f.caliber}`);
    if (f.verification_level && !LEVELS.has(f.verification_level)) errors.push(`${tag}: unknown verification_level ${f.verification_level}`);
    if (f.confidence && !CONFIDENCE.has(f.confidence)) errors.push(`${tag}: unknown confidence ${f.confidence}`);
    if (f.category && !CATEGORIES.has(f.category)) errors.push(`${tag}: unknown category ${f.category}`);
    if (f.unit === '%' && !f.formula) errors.push(`${tag}: percent value requires formula`);
    if (f.formula) {
      const numbers = f.formula.match(/\d+/g) || [];
      const okFormula = (/[÷/+×\-]/.test(f.formula) && numbers.length >= 2)
        || /^(目标值|约)/.test(f.formula)
        || /≈|估算|样本/.test(f.formula);
      if (!okFormula) errors.push(`${tag}: formula 需为算式或明确标注估算`);
    }
    if (typeof f.source === 'string' && f.source) {
      const rel = f.source.split('#')[0];
      if (!existsSync(path.join(root, rel))) errors.push(`${tag}: source 文件不存在: ${rel}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
