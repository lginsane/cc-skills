import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { parseInput, collectImageCandidates, assignSemanticNames } from './image-manifest.mjs';
import { buildBlueprint } from './component-blueprint.mjs';
import { runCheck } from './dsl-fidelity-check.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(__dirname, '__fixtures__');
const complexFile = resolve(FIX, 'raw-dsl-complex-sample.json');

function makeArtifacts() {
  const rawFile = complexFile;
  const outDir = resolve(FIX, 'out/fidelity');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // manifest：仅利用纯函数构造（不触发真实下载），url 必须与 DSL 一一对应
  const raw = JSON.parse(readFileSync(rawFile, 'utf-8'));
  const cands = collectImageCandidates(parseInput(raw));
  assignSemanticNames(cands);
  const manifest = {
    schemaVersion: '1', designName: raw.designName, fileId: raw.fileId, layerId: raw.layerId,
    version: raw.version, generatedAt: '2026-08-28T00:00:00.000Z',
    images: cands.map((c, i) => ({
      imageId: `img_${String(i + 1).padStart(3, '0')}`,
      sectionIndex: c.sectionIndex, nodeId: c.nodeId, nodeName: c.nodeName, nodePath: c.nodePath,
      url: c.url, assetKey: c.assetKey, semanticName: c.semanticName,
      localPath: `images/${c.semanticName}`, sha256: 'fake', role: c.role,
      width: c.width, height: c.height, duplicateOf: null,
    })),
    failedAssets: [], summary: {},
  };
  const manifestFile = resolve(outDir, 'image-manifest.json');
  writeFileSync(manifestFile, JSON.stringify(manifest));

  const bp = buildBlueprint({ rawFile, pageDir: 'p', outDir });
  const blueprintFile = resolve(outDir, 'component-blueprint.json');
  writeFileSync(blueprintFile, JSON.stringify(bp));

  return { rawFile, manifestFile, blueprintFile, bp };
}

test('自检通过：引用闭合 / 无造假 / 全量覆盖 / 全量归属 全绿', () => {
  const { rawFile, manifestFile, blueprintFile } = makeArtifacts();
  const result = runCheck({ rawFile, manifestFile, blueprintFile });
  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.checks.urlCoverage.rawUrls, 6);
  assert.equal(result.checks.urlCoverage.coveredByManifest, 6);
  assert.deepEqual(result.checks.sectionOwnership.dangling, []);
});

test('manifest 伪造条目 → fail', () => {
  const { rawFile, manifestFile, blueprintFile } = makeArtifacts();
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf-8'));
  manifest.images.push({
    imageId: 'img_999', sectionIndex: 0, nodeId: null, nodeName: '欺诈', nodePath: [],
    url: 'https://fake.example/hoax.png', assetKey: 'hoax', semanticName: 'hoax.png',
    localPath: 'images/hoax.png', sha256: 'x', role: 'content', width: 0, height: 0, duplicateOf: null,
  });
  writeFileSync(manifestFile, JSON.stringify(manifest));
  const result = runCheck({ rawFile, manifestFile, blueprintFile });
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.includes('[无造假]')), '应报造假条目');
});

test('blueprint 引用越界 → fail（引用闭合）', () => {
  const { rawFile, manifestFile, blueprintFile, bp } = makeArtifacts();
  bp.zones[1].sections.push(999);
  writeFileSync(blueprintFile, JSON.stringify(bp));
  const result = runCheck({ rawFile, manifestFile, blueprintFile });
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.includes('[引用闭合]')));
});

test('section 悬空且未声明 → fail（全量归属）', () => {
  const { rawFile, manifestFile, blueprintFile, bp } = makeArtifacts();
  bp.zones[1].sections = bp.zones[1].sections.filter(i => i !== 4); // 移除一张卡片且不声明 dangling
  bp.dangling = [];
  writeFileSync(blueprintFile, JSON.stringify(bp));
  const result = runCheck({ rawFile, manifestFile, blueprintFile });
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.includes('[全量归属]')));
});

test('缺失产物文件 → 抛错', () => {
  const { rawFile } = makeArtifacts();
  assert.throws(() => runCheck({ rawFile, manifestFile: resolve(FIX, 'out/no-such.json'), blueprintFile: resolve(FIX, 'out/no-such.json') }));
});

const rawN = sections => ({ designName: 'x', fileId: '1', layerId: '1:1', version: '1',
  overview: { sections: [] }, sectionDsls: Array.from({ length: sections }, (_, i) => ({ sectionIndex: i })) });

test('E 项：raw-dsl 实际 section 少于 totalSections → fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-e-'));
  const rawFile = join(dir, 'raw-dsl.json');
  const manifestFile = join(dir, 'manifest.json');
  const blueprintFile = join(dir, 'blueprint.json');
  writeFileSync(rawFile, JSON.stringify(rawN(3)));
  writeFileSync(manifestFile, JSON.stringify({ schemaVersion: '1', images: [], failedAssets: [], summary: {} }));
  writeFileSync(blueprintFile, JSON.stringify({ schemaVersion: '1', totalSections: 5, zones: [], overlays: [], repeatables: [], exempted: [], dangling: [] }));
  const result = runCheck({ rawFile, manifestFile, blueprintFile });
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.includes('[取数完整性]')), JSON.stringify(result.failures));
  assert.equal(result.checks.fetchCompleteness.actual, 3);
  assert.equal(result.checks.fetchCompleteness.declared, 5);
});

test('E 项：sectionIndexFile 权威核对，不一致 → fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fid-si-'));
  const rawFile = join(dir, 'raw-dsl.json');
  const manifestFile = join(dir, 'manifest.json');
  const blueprintFile = join(dir, 'blueprint.json');
  const si = join(dir, 'section-index.json');
  writeFileSync(rawFile, JSON.stringify(rawN(2)));
  writeFileSync(manifestFile, JSON.stringify({ schemaVersion: '1', images: [], failedAssets: [], summary: {} }));
  writeFileSync(blueprintFile, JSON.stringify({ schemaVersion: '1', totalSections: 2, zones: [], overlays: [], repeatables: [], exempted: [], dangling: [] }));
  writeFileSync(si, JSON.stringify({ totalSections: 4 }));
  const result = runCheck({ rawFile, manifestFile, blueprintFile, sectionIndexFile: si });
  assert.ok(result.failures.some(f => f.includes('[取数完整性]')), JSON.stringify(result.failures));
  assert.equal(result.checks.fetchCompleteness.actual, 2);
  assert.equal(result.checks.fetchCompleteness.declared, 4);
});