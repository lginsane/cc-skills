export function pageRange(durationMin) {
  if (durationMin < 10) return [6, 10];
  const target = Math.round(durationMin * 0.8);
  return [target - 2, target + 2];
}

export function validateOutline(outline, { durationMin, factIds }) {
  const errors = [];
  const pages = outline.pages || [];
  const mainPages = pages.filter(p => !p.appendix);
  const [min, max] = pageRange(durationMin);

  if (mainPages.length < min || mainPages.length > max) {
    errors.push(`页数 ${mainPages.length} 不在 ${min}-${max} 范围（${durationMin} 分钟）`);
  }

  const ids = new Set();
  let totalSeconds = 0;
  for (const p of pages) {
    const tag = p.id || 'unknown';
    if (!p.id) errors.push('页面缺少 id');
    if (ids.has(p.id)) errors.push(`${tag}: duplicate id`);
    ids.add(p.id);
    if (!p.title) errors.push(`${tag}: missing title`);
    else if ([...p.title].length > 30) errors.push(`${tag}: title 超过 30 字`);
    if (!p.core) errors.push(`${tag}: missing core`);
    for (const fid of p.facts || []) {
      if (!factIds.has(fid)) errors.push(`${tag}: unknown fact ${fid}`);
    }
    if (!p.appendix) totalSeconds += Number(p.seconds) || 0;
  }

  const target = durationMin * 60;
  if (Math.abs(totalSeconds - target) > target * 0.15) {
    errors.push(`总时长 ${totalSeconds}s 与目标 ${target}s 偏差超过 15%`);
  }

  if (String(outline.audience || '').includes('+')) {
    const sum = Object.values(outline.weights || {}).reduce((a, b) => a + Number(b), 0);
    if (sum !== 10) errors.push(`混合场权重总和应为 10，实际 ${sum}`);
  }

  return { ok: errors.length === 0, errors };
}
