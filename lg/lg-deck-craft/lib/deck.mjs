import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pptxgen from 'pptxgenjs';
import { readTheme } from './theme.mjs';

export { readTheme };

const c = hex => String(hex || '').replace('#', '');

function titleBox(slide, text, theme, opts = {}) {
  slide.addText(text, {
    x: 0.6, y: 0.45, w: 12.1, h: 0.9,
    fontSize: 26, bold: true, color: c(theme.colors.primary),
    fontFace: theme.fonts.title, ...opts
  });
}

function bulletsBox(slide, bullets, theme) {
  if (!bullets?.length) return;
  slide.addText(bullets.map(t => ({ text: t, options: { bullet: true } })), {
    x: 0.8, y: 1.55, w: 11.6, h: 4.9,
    fontSize: 16, color: c(theme.colors.text), fontFace: theme.fonts.body,
    breakLine: true, valign: 'top'
  });
}


const SWISS = {
  width: 13.333,
  height: 7.5,
  colors: { primary: '002FA7', background: 'FFFFFF', text: '141414', accent: '002FA7' },
  fonts: { title: 'Microsoft YaHei', body: 'Microsoft YaHei' },
  degraded: false
};

function swissChrome(slide, s, page, theme, pptx, index, total, isAppendix) {
  slide.background = { color: 'FFFFFF' };
  slide.addShape(pptx.ShapeType.line, { x: 0.6, y: 0.62, w: 12.1, h: 0, line: { color: '141414', width: 1.2 } });
  const kicker = s.kicker || (page.visual === 'cover' ? 'ANNUAL REPORT / 2026' : '2026 ANNUAL REVIEW');
  slide.addText(kicker, { x: 0.6, y: 0.3, w: 9, h: 0.3, fontSize: 9, bold: true, color: '002FA7', charSpacing: 2, fontFace: theme.fonts.body });
  const pageLabel = isAppendix ? '附录' : `${String(index).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  slide.addText(pageLabel, {
    x: 11.4, y: 0.3, w: 1.3, h: 0.3, fontSize: 9, color: '6B6B6B', align: 'right', fontFace: theme.fonts.body
  });
}

function renderSwiss(slide, s, page, theme, pptx, index, total, isAppendix) {
  const visual = page.visual || 'content';
  swissChrome(slide, s, page, theme, pptx, index, total, isAppendix);
  const body = { fontFace: theme.fonts.body };

  if (visual === 'cover') {
    slide.addText(s.title, { x: 0.6, y: 1.55, w: 12.1, h: 1.8, fontSize: 40, bold: true, color: '141414', fontFace: theme.fonts.title, breakLine: true });
    slide.addText(s.core || page.core || '', { x: 0.6, y: 3.55, w: 10, h: 0.5, fontSize: 16, color: '4A4A4A', ...body });
    if (s.bullets?.length) slide.addText(s.bullets.join(' / '), { x: 0.6, y: 4.15, w: 11, h: 0.5, fontSize: 13, color: '6B6B6B', ...body });
    slide.addShape(pptx.ShapeType.line, { x: 0.6, y: 6.55, w: 12.1, h: 0, line: { color: 'D8D8D8', width: 0.8 } });
    slide.addText('前端 / AI 工程化', { x: 0.6, y: 6.7, w: 6, h: 0.3, fontSize: 9, color: '6B6B6B', ...body });
    slide.addText('2026.12', { x: 11.4, y: 6.7, w: 1.3, h: 0.3, fontSize: 9, color: '6B6B6B', align: 'right', ...body });
    return;
  }
  if (visual === 'section') {
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 2.5, w: 0.08, h: 1.55, fill: { color: '002FA7' }, line: { color: '002FA7' } });
    slide.addText(s.title, { x: 0.9, y: 2.55, w: 11.8, h: 1.1, fontSize: 34, bold: true, color: '141414', fontFace: theme.fonts.title });
    if (s.bullets?.length) slide.addText(s.bullets.join(' / '), { x: 0.9, y: 3.75, w: 11.5, h: 0.6, fontSize: 15, color: '6B6B6B', ...body });
    return;
  }
  if (visual === 'end') {
    slide.addText(s.title, { x: 0.6, y: 2.8, w: 12.1, h: 1.2, fontSize: 34, bold: true, color: '141414', fontFace: theme.fonts.title, align: 'center' });
    if (s.bullets?.length) slide.addText(s.bullets.join(' / '), { x: 0.6, y: 4.1, w: 12.1, h: 0.6, fontSize: 14, color: '6B6B6B', align: 'center', ...body });
    return;
  }
  if (visual === 'quote') {
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.6, w: 0.08, h: 2.6, fill: { color: '002FA7' }, line: { color: '002FA7' } });
    slide.addText(s.title, { x: 0.95, y: 1.6, w: 11.5, h: 2.4, fontSize: 30, bold: true, color: '141414', fontFace: theme.fonts.title, valign: 'middle' });
    return;
  }

  slide.addText(s.title, { x: 0.6, y: 1.1, w: 12.1, h: 0.8, fontSize: 24, bold: true, color: '141414', fontFace: theme.fonts.title });
  if (visual === 'table' && s.table) {
    const headers = s.table.headers || [];
    const rows = s.table.rows || [];
    const colW = 12.1 / Math.max(headers.length, 1);
    const data = [
      headers.map(h => ({ text: String(h), options: { bold: true, color: '002FA7', fill: 'F2F4F8', fontSize: headers.length > 8 ? 8.5 : 10 } })),
      ...rows.map(r => r.map(cell => ({ text: String(cell), options: { color: '141414', fontSize: headers.length > 8 ? 8.5 : 10 } })))
    ];
    slide.addTable(data, {
      x: 0.6, y: 1.95, w: 12.1, colW: Array(headers.length).fill(colW),
      border: { pt: 0.5, color: 'D8DDE6' }, fontFace: theme.fonts.body, valign: 'middle', align: 'center'
    });
  } else if (visual === 'chart' && s.chart) {
    slide.addChart(pptx.ChartType.bar, [{ name: s.chart.name || '数据', labels: s.chart.labels, values: s.chart.values }], {
      x: 0.6, y: 1.95, w: 12.1, h: 4.6, showLegend: false, showValue: true,
      chartColors: ['002FA7'], catAxisLabelColor: '141414', valAxisLabelColor: '141414'
    });
  } else if (visual === 'timeline' && s.items) {
    s.items.forEach((item, i) => {
      slide.addText(String(i + 1).padStart(2, '0'), { x: 0.6, y: 1.75 + i * 0.95, w: 0.9, h: 0.5, fontSize: 18, bold: true, color: '002FA7', fontFace: theme.fonts.body });
      slide.addText(item, { x: 1.55, y: 1.75 + i * 0.95, w: 11.1, h: 0.5, fontSize: 16, color: '141414', ...body });
    });
  } else if (visual === 'compare' && s.columns) {
    s.columns.forEach((col, i) => {
      slide.addText(col.title, { x: 0.6 + i * 6.2, y: 1.7, w: 5.8, h: 0.5, fontSize: 18, bold: true, color: '002FA7', fontFace: theme.fonts.title });
      slide.addText(col.items.map(t => ({ text: t, options: { bullet: true } })), { x: 0.6 + i * 6.2, y: 2.25, w: 5.6, h: 4.0, fontSize: 14, color: '141414', ...body });
    });
  } else {
    if (s.bullets?.length) {
      slide.addText(s.bullets.map(t => ({ text: t, options: { bullet: { indent: 15 } } })), {
        x: 0.8, y: 1.95, w: 11.6, h: 4.5, fontSize: 15, color: '141414', breakLine: true, valign: 'top', ...body
      });
    }
  }
}

function render(slide, s, page, theme, pptx) {
  const visual = page.visual || 'content';
  if (visual === 'cover') {
    slide.background = { color: c(theme.colors.primary) };
    slide.addText(s.title, { x: 0.8, y: 2.1, w: 11.7, h: 1.5, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: theme.fonts.title });
    slide.addText(s.core || page.core || '', { x: 0.8, y: 3.7, w: 11.7, h: 0.8, fontSize: 18, color: 'DCE6F1', fontFace: theme.fonts.body });
    if (s.bullets?.length) {
      slide.addText(s.bullets.join(' / '), { x: 0.8, y: 4.6, w: 11.7, h: 0.8, fontSize: 14, color: 'DCE6F1', fontFace: theme.fonts.body });
    }
    return;
  }
  if (visual === 'section') {
    slide.background = { color: c(theme.colors.primary) };
    slide.addText(s.title, { x: 0.8, y: 2.8, w: 11.7, h: 1.2, fontSize: 36, bold: true, color: 'FFFFFF', fontFace: theme.fonts.title });
    if (s.bullets?.length) {
      slide.addText(s.bullets.join(' / '), { x: 0.8, y: 4.2, w: 11.7, h: 1.0, fontSize: 18, color: 'DCE6F1', fontFace: theme.fonts.body });
    }
    return;
  }
  if (visual === 'end') {
    slide.background = { color: c(theme.colors.primary) };
    slide.addText(s.title, { x: 0.8, y: 2.9, w: 11.7, h: 1.0, fontSize: 34, bold: true, color: 'FFFFFF', fontFace: theme.fonts.title, align: 'center' });
    return;
  }
  if (visual === 'quote') {
    slide.addText(s.title, { x: 1.2, y: 2.4, w: 10.9, h: 2.2, fontSize: 30, bold: true, color: c(theme.colors.primary), fontFace: theme.fonts.title, align: 'center', valign: 'middle' });
    return;
  }

  titleBox(slide, s.title, theme);
  if (visual === 'table' && s.table) {
    const headers = s.table.headers || [];
    const rows = s.table.rows || [];
    const colW = 12.1 / Math.max(headers.length, 1);
    slide.addTable([headers, ...rows], {
      x: 0.6, y: 1.45, w: 12.1,
      colW: Array(headers.length).fill(colW),
      fontSize: headers.length > 8 ? 8.5 : 11,
      border: { pt: 0.5, color: 'C9D3E0' },
      fill: { color: 'FFFFFF' },
      color: c(theme.colors.text),
      fontFace: theme.fonts.body,
      valign: 'middle',
      align: 'center'
    });
  } else if (visual === 'chart' && s.chart) {
    slide.addChart(pptx.ChartType.bar, [{ name: s.chart.name || '数据', labels: s.chart.labels, values: s.chart.values }], {
      x: 0.8, y: 1.55, w: 11.6, h: 4.9,
      showLegend: false, showValue: true, chartColors: [c(theme.colors.accent)],
      catAxisLabelColor: c(theme.colors.text), valAxisLabelColor: c(theme.colors.text)
    });
  } else if (visual === 'timeline' && s.items) {
    s.items.forEach((item, i) => {
      slide.addText(`${i + 1}. ${item}`, { x: 0.8, y: 1.5 + i * 1.1, w: 11.6, h: 0.9, fontSize: 16, color: c(theme.colors.text), fontFace: theme.fonts.body });
    });
  } else if (visual === 'compare' && s.columns) {
    s.columns.forEach((col, i) => {
      slide.addText(col.title, { x: 0.6 + i * 6.2, y: 1.5, w: 5.8, h: 0.6, fontSize: 18, bold: true, color: c(theme.colors.primary), fontFace: theme.fonts.title });
      slide.addText(col.items.map(t => ({ text: t, options: { bullet: true } })), { x: 0.8 + i * 6.2, y: 2.2, w: 5.6, h: 4.0, fontSize: 14, color: c(theme.colors.text), fontFace: theme.fonts.body });
    });
  } else {
    bulletsBox(slide, s.bullets, theme);
  }
}

export async function buildDeck({ workDir, outPath, templatePath, style }) {
  const theme = style === 'swiss' ? SWISS : await readTheme(templatePath);
  const outline = JSON.parse(await readFile(path.join(workDir, '03-outline.json'), 'utf8'));
  const pptx = new pptxgen();
  if (theme.width !== 13.333 || theme.height !== 7.5) {
    pptx.defineLayout({ name: 'CUSTOM', width: theme.width, height: theme.height });
    pptx.layout = 'CUSTOM';
  } else {
    pptx.layout = 'LAYOUT_WIDE';
  }
  pptx.author = 'lg-deck-craft';
  pptx.title = outline.title || 'lg-deck-craft';

  const mainTotal = outline.pages.filter(p => !p.appendix).length;
  let notes = 0;
  for (const [index, page] of outline.pages.entries()) {
    const s = JSON.parse(await readFile(path.join(workDir, '05-slides', `${page.id}.json`), 'utf8'));
    const slide = pptx.addSlide();
    if (style === 'swiss') renderSwiss(slide, s, page, theme, pptx, index + 1, mainTotal, Boolean(page.appendix));
    else render(slide, s, page, theme, pptx);
    if (s.notes) {
      slide.addNotes(s.notes);
      notes += 1;
    }
  }

  await pptx.writeFile({ fileName: outPath });
  const result = { slides: outline.pages.length, notes, degraded: theme.degraded, style: style || 'default' };
  await writeFile(path.join(workDir, '06-build-report.json'), JSON.stringify(result, null, 2), 'utf8');
  return result;
}
