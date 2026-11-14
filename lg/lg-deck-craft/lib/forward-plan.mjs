const TYPES = new Set(['continuation', 'gap_fix', 'foresight']);
const STATUS = new Set(['proposed', 'confirmed', 'rejected']);
const CONFIDENCE = new Set(['high', 'medium', 'low']);

export function validateForwardPlan(plan) {
  const errors = [];
  const directions = plan.directions || [];
  if (!directions.length) errors.push('directions 为空');
  const ids = new Set();

  for (const d of directions) {
    const tag = d.id || 'unknown';
    if (!d.id) errors.push('方向缺少 id');
    if (ids.has(d.id)) errors.push(`${tag}: duplicate id`);
    ids.add(d.id);
    if (!d.title) errors.push(`${tag}: missing title`);
    if (!TYPES.has(d.type)) errors.push(`${tag}: unknown type ${d.type}`);
    if (!STATUS.has(d.status)) errors.push(`${tag}: unknown status ${d.status}`);
    if (!CONFIDENCE.has(d.confidence)) errors.push(`${tag}: unknown confidence ${d.confidence}`);
    if (!Array.isArray(d.basis) || d.basis.length === 0) errors.push(`${tag}: basis 至少 1 条`);
    if (!d.action) errors.push(`${tag}: missing action`);
    if (d.type === 'foresight' && !(d.basis || []).some(b => String(b).startsWith('industry:'))) {
      errors.push(`${tag}: foresight 需要行业来源（industry:）`);
    }
  }

  return { ok: errors.length === 0, errors };
}
