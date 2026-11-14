export function extractNumbers(text) {
  const cleaned = String(text)
    .replace(/20\d{2}[-/年]\d{1,2}([-/月]\d{1,2})?/g, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\bQ[1-4]\b/gi, ' ')
    .replace(/\b[A-Za-z]+\d+(?:\.\d+)*\b/g, ' ')
    .replace(/\bP\d+\b/g, ' ')
    .replace(/v?\d+(?:\.\d+){2,}/g, ' ');
  const out = [];
  for (const m of cleaned.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?%?/g)) {
    out.push(m[0].replace(/,/g, ''));
  }
  return out;
}

function cjkLength(text) {
  return (String(text).match(/[一-鿿]/g) || []).length;
}

function allowedToken(value) {
  const v = String(value);
  return /^(?:[1-9]|1[0-2])$/.test(v) || /^20\d{2}$/.test(v) || /^v?\d+(?:\.\d+)+$/.test(v);
}

function slideText(s) {
  const parts = [s.title || '', ...(s.bullets || []), s.notes || ''];
  if (s.items) parts.push(...s.items);
  for (const col of s.columns || []) {
    parts.push(col.title || '', ...(col.items || []));
  }
  if (s.table) {
    parts.push(...(s.table.headers || []), ...(s.table.rows || []).flat());
  }
  return parts.join(' ');
}

export function validateSlides(slides, { facts = [], factIds } = {}) {
  const errors = [];
  const map = new Map();
  for (const f of facts) map.set(f.id, f);
  if (factIds) for (const id of factIds) if (!map.has(id)) map.set(id, { id });

  const ids = new Set();
  for (const s of slides) {
    const tag = s.id || 'unknown';
    if (!s.id) errors.push('页面缺少 id');
    if (ids.has(s.id)) errors.push(`${tag}: duplicate id`);
    ids.add(s.id);
    if (!s.title) errors.push(`${tag}: missing title`);
    else if ([...s.title].length > 30) errors.push(`${tag}: title 超过 30 字`);
    const bullets = s.bullets || [];
    if (bullets.length > 5) errors.push(`${tag}: 要点超过 5 条`);
    if (cjkLength(slideText(s)) > 80 && cjkLength([s.title, ...bullets].join('')) > 80) {
      errors.push(`${tag}: 正文中文字符超过 80`);
    }
    if (!s.notes) errors.push(`${tag}: missing notes`);
    if (s.seconds === undefined || s.seconds === null) errors.push(`${tag}: missing seconds`);

    const covered = new Set();
    for (const fid of s.facts || []) {
      const f = map.get(fid);
      if (!f) {
        errors.push(`${tag}: unknown fact ${fid}`);
        continue;
      }
      for (const n of extractNumbers(`${f.claim || ''} ${f.value ?? ''}`)) covered.add(n);
    }

    const allowed = new Set();
    for (const raw of s.allowedNumbers || []) {
      if (!allowedToken(raw)) {
        errors.push(`${tag}: allowedNumbers 只允许月份/年份/版本，收到 ${raw}`);
        continue;
      }
      allowed.add(String(raw));
    }

    const numbers = [
      ...extractNumbers(slideText(s)),
      ...(s.chart?.values || []).map(String)
    ];
    for (const n of numbers) {
      if (covered.has(n) || allowed.has(n)) continue;
      errors.push(`${tag}: 数字 ${n} 无事实来源`);
    }
  }

  return { ok: errors.length === 0, errors };
}
