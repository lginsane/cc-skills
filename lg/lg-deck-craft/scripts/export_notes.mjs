import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function exportNotes(workDir) {
  const outline = JSON.parse(await readFile(path.join(workDir, '03-outline.json'), 'utf8'));
  const lines = ['# 讲述稿', ''];
  let seconds = 0;
  for (const page of outline.pages || []) {
    const slide = JSON.parse(await readFile(path.join(workDir, '05-slides', `${page.id}.json`), 'utf8'));
    seconds += Number(page.seconds) || 0;
    lines.push(`## ${page.id} ${page.title}（${page.seconds} 秒）`, '', slide.notes || '', '');
  }
  lines.splice(2, 0, `总时长：${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`, '');
  await writeFile(path.join(workDir, '10-speaker-notes.md'), lines.join('\n'), 'utf8');
  return { pages: (outline.pages || []).length, seconds };
}

async function run() {
  const args = process.argv.slice(2);
  const work = args[args.indexOf('--work') + 1];
  if (!work) {
    console.error('usage: node scripts/export_notes.mjs --work <dir>');
    process.exit(2);
  }
  console.log(JSON.stringify(await exportNotes(work), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) run();
