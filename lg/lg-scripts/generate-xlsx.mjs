// generate-xlsx.mjs — 生成排期表 xlsx
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import XLSX from 'xlsx';

function loadConfig() {
  const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
  try { return JSON.parse(readFileSync(join(cwd, '.claude', 'config', 'lg-config.json'), 'utf-8')); }
  catch { return null; }
}

function loadInput() {
  const chunks = [];
  return new Promise((resolve, reject) => {
    process.stdin.on('data', c => chunks.push(c));
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (e) { reject(e); }
    });
    process.stdin.on('error', reject);
  });
}

function buildScheduleSheet(tasks) {
  const headers = ['任务名称', '描述', '角色', '预估工时(h)', '依赖', '优先级', '来源页面'];
  const rows = [headers];
  for (const t of tasks) {
    rows.push([t.name || '', t.description || '', t.role || '', t.hours || 0, t.dependency || '-', t.priority || 'P1', t.sourcePage || '']);
  }
  const total = tasks.reduce((s, t) => s + (t.hours || 0), 0);
  rows.push([]);
  rows.push(['总计', '', '', total, '', '', '']);
  return XLSX.utils.aoa_to_sheet(rows);
}

function buildPagesSheet(pages, relations) {
  const headers = ['序号', '页面名称', '尺寸', '类型', '功能描述', '关联关系'];
  const rows = [headers];
  for (let i = 0; i < (pages || []).length; i++) {
    const p = pages[i];
    const rel = (relations || []).filter(r => r.from === i || r.to === i)
      .map(r => {
        const other = r.from === i ? pages[r.to]?.name : pages[r.from]?.name;
        const label = r.type === 'list-detail' ? '列表→详情' : r.type === 'reference' ? '引用' : r.type;
        return `${label}: ${other || ''}`;
      }).join('; ');
    rows.push([i + 1, p.name || '', p.width || '', p.type === 'flowchart' ? '流程图' : '设计稿', p.description || '', rel || '-']);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}

function buildVisionSheet(visionResults) {
  const headers = ['页面名称', '功能描述', 'UI元素', '交互说明', '置信度'];
  const rows = [headers];
  for (const v of (visionResults || [])) {
    rows.push([
      v.name || '', v.description || '',
      (v.ui_elements || []).join('\n'), (v.interactions || []).join('\n'),
      v.confidence || ''
    ]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}

async function main() {
  const input = await loadInput();
  const { version, tasks, pages, relations, visionResults, outputDir: cliOutputDir, manifest } = input;
  if (!tasks || tasks.length === 0) { console.error('{"success":false,"error":"无任务数据"}'); process.exit(1); }

  const config = loadConfig();
  const outputDir = cliOutputDir || config?.schedule_dir || './.lg-docs/docs/';
  mkdirSync(outputDir, { recursive: true });

  const versionStr = (manifest?.version || version || 'unknown').replace(/[/\\?%*:|"<>]/g, '-');
  const today = new Date().toISOString().slice(0, 10);
  const fileName = `${versionStr}-排期表-${today}.xlsx`;
  const filePath = resolve(outputDir, fileName);

  const wb = XLSX.utils.book_new();

  const ws1 = buildScheduleSheet(tasks);
  ws1['!cols'] = [{ wch: 20 }, { wch: 40 }, { wch: 8 }, { wch: 14 }, { wch: 15 }, { wch: 8 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws1, '排期表');

  if (pages && pages.length > 0) {
    const ws2 = buildPagesSheet(pages, relations);
    ws2['!cols'] = [{ wch: 6 }, { wch: 18 }, { wch: 20 }, { wch: 8 }, { wch: 40 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws2, '页面总览');
  }

  if (visionResults && visionResults.length > 0) {
    const ws3 = buildVisionSheet(visionResults);
    ws3['!cols'] = [{ wch: 18 }, { wch: 40 }, { wch: 30 }, { wch: 30 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws3, '识图结果');
  }

  try {
    XLSX.writeFile(wb, filePath);
    console.log(JSON.stringify({ success: true, filePath, fileName }));
  } catch (err) {
    const jsonPath = join(outputDir, `${versionStr}-排期表-${today}.json`);
    writeFileSync(jsonPath, JSON.stringify({ version, tasks, pages, relations, visionResults }, null, 2), 'utf-8');
    console.error(JSON.stringify({ success: false, error: `xlsx写入失败: ${err.message}`, fallbackPath: jsonPath }));
    process.exit(1);
  }
}

main();
