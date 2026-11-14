import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { stripMarkdown } from '../lib/numbers.mjs';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

function slideNo(name) {
  return Number(name.match(/slide(\d+)\.xml$/)[1]);
}

async function pptxToMd(file) {
  const zip = await JSZip.loadAsync(await readFile(file));
  const slides = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNo(a) - slideNo(b));
  const parts = [];
  for (const s of slides) {
    const xml = await zip.file(s).async('string');
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]);
    parts.push(`## Slide ${slideNo(s)}\n\n${texts.join('\n')}`);
  }
  return parts.join('\n\n');
}

function xlsxToMd(file) {
  const wb = XLSX.readFile(file);
  const parts = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false });
    if (!rows.length) continue;
    const header = rows[0].map(String);
    const body = rows.slice(1);
    parts.push(
      `## ${name}\n\n| ${header.join(' | ')} |\n|${header.map(() => '---').join('|')}|\n` +
      body.map(r => `| ${r.map(String).join(' | ')} |`).join('\n')
    );
  }
  return parts.join('\n\n');
}

async function convert(file, rel) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.md' || ext === '.txt') return readFile(file, 'utf8');
  if (ext === '.docx') {
    const { value } = await mammoth.convertToMarkdown({ path: file });
    return value;
  }
  if (ext === '.pdf') {
    const data = await pdfParse(await readFile(file));
    return data.text;
  }
  if (ext === '.pptx') return pptxToMd(file);
  if (ext === '.xlsx' || ext === '.xls') return xlsxToMd(file);
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
    return `> 图片：${rel}\n>\n> 需要人工或视觉模型识别内容。`;
  }
  return `> 未支持的文件类型：${rel}`;
}

export async function ingest(sourceDir, outDir) {
  await mkdir(outDir, { recursive: true });
  const files = [];
  for (const file of await walk(sourceDir)) {
    const rel = path.relative(sourceDir, file);
    const text = await convert(file, rel);
    let name = rel.split(path.sep).join('__');
    if (!/\.(md|txt)$/i.test(name)) name += '.md';
    const output = path.join(outDir, name);
    await writeFile(output, text, 'utf8');
    files.push({ source: file, output, chars: stripMarkdown(text).length });
  }
  return { files };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const src = args[args.indexOf('--sources') + 1];
  const out = args[args.indexOf('--out') + 1];
  if (!src || !out) {
    console.error('usage: node scripts/ingest.mjs --sources <dir> --out <dir>');
    process.exit(2);
  }
  const result = await ingest(src, out);
  console.log(JSON.stringify({ files: result.files.length, out }, null, 2));
}
