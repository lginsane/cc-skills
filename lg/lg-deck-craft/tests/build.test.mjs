import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { buildDeck, readTheme } from '../lib/deck.mjs';

test('builds a 3-slide deck with notes', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'deck-'));
  await mkdir(path.join(work, '05-slides'), { recursive: true });
  await writeFile(path.join(work, '03-outline.json'), JSON.stringify({
    audience: 'colleagues', weights: {}, pages: [
      { id: 'P01', title: '封面', core: '封面', facts: [], visual: 'cover', seconds: 10 },
      { id: 'P02', title: '一年 774 条', core: '交付', facts: [], visual: 'content', seconds: 30 },
      { id: 'P03', title: '谢谢', core: '结束', facts: [], visual: 'end', seconds: 5 }
    ]
  }));
  for (const id of ['P01', 'P02', 'P03']) {
    await writeFile(path.join(work, `05-slides/${id}.json`), JSON.stringify({
      id, title: id, bullets: ['要点'], notes: '讲述稿', seconds: 10, facts: [], allowedNumbers: []
    }));
  }
  const out = path.join(work, '06-deck.pptx');
  const result = await buildDeck({ workDir: work, outPath: out });
  assert.equal(result.slides, 3);
  const zip = await JSZip.loadAsync(await readFile(out));
  assert.ok(zip.file('ppt/slides/slide1.xml'));
  assert.ok(zip.file('ppt/notesSlides/notesSlide1.xml'));
});

test('degrades when template is missing', async () => {
  const theme = await readTheme('/tmp/does-not-exist.pptx');
  assert.equal(theme.degraded, true);
});

test('section slides keep their bullets and cover keeps core', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'deck-'));
  await mkdir(path.join(work, '05-slides'), { recursive: true });
  await writeFile(path.join(work, '03-outline.json'), JSON.stringify({
    audience: 'colleagues', weights: {}, pages: [
      { id: 'P01', title: '封面标题', core: '封面副标题', facts: [], visual: 'cover', seconds: 10 },
      { id: 'P02', title: '章节标题', core: '章节核心', facts: [], visual: 'section', seconds: 10 }
    ]
  }));
  await writeFile(path.join(work, '05-slides/P01.json'), JSON.stringify({ id: 'P01', title: '封面标题', bullets: [], notes: 'n', seconds: 10, facts: [], allowedNumbers: [] }));
  await writeFile(path.join(work, '05-slides/P02.json'), JSON.stringify({ id: 'P02', title: '章节标题', bullets: ['前端 1 人，后端 3 人'], notes: 'n', seconds: 10, facts: [], allowedNumbers: [] }));
  const out = path.join(work, 'deck.pptx');
  await buildDeck({ workDir: work, outPath: out });
  const zip = await JSZip.loadAsync(await readFile(out));
  const cover = await zip.file('ppt/slides/slide1.xml').async('string');
  const section = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(cover, /封面副标题/);
  assert.match(section, /前端 1 人/);
});

test('readTheme maps clrScheme roles and slide size', async () => {
  const zip = new JSZip();
  zip.file('ppt/theme/theme1.xml', `<a:theme><a:clrScheme name="Office">
    <a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
    <a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
    <a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme></a:theme>`);
  zip.file('ppt/presentation.xml', `<p:presentation><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`);
  const dir = await mkdtemp(path.join(tmpdir(), 'theme-'));
  const file = path.join(dir, 't.pptx');
  await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
  const theme = await readTheme(file);
  assert.equal(theme.colors.primary, '44546A');
  assert.equal(theme.colors.background, 'FFFFFF');
  assert.equal(theme.colors.text, '000000');
  assert.equal(theme.colors.accent, '4472C4');
  assert.equal(theme.width, 10);
  assert.equal(theme.height, 7.5);
});

test('table slides render headers and rows', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'deck-'));
  await mkdir(path.join(work, '05-slides'), { recursive: true });
  await writeFile(path.join(work, '03-outline.json'), JSON.stringify({
    audience: 'colleagues', weights: {}, pages: [{ id: 'P01', title: '月度表', core: '数据', facts: [], visual: 'table', seconds: 10 }]
  }));
  await writeFile(path.join(work, '05-slides/P01.json'), JSON.stringify({
    id: 'P01', title: '月度表', bullets: [], notes: 'n', seconds: 10, facts: [], allowedNumbers: [],
    table: { headers: ['月份', '管理缺陷'], rows: [['1月', '15']] }
  }));
  const out = path.join(work, 'deck.pptx');
  await buildDeck({ workDir: work, outPath: out });
  const zip = await JSZip.loadAsync(await readFile(out));
  const xml = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(xml, /管理缺陷/);
  assert.match(xml, /15/);
});
