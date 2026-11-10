import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runRename } from './semantic-rename.mjs';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sr-'));
  const imagesDir = join(dir, 'images');
  mkdirSync(imagesDir, { recursive: true });
  const mf = join(dir, 'image-manifest.json');
  const manifest = {
    schemaVersion: '1', designName: 'x', fileId: '1', layerId: '1:1', version: '1',
    generatedAt: '2026-09-02T00:00:00.000Z',
    images: [
      { imageId: 'img_001', url: 'https://x/a.png', semanticName: 'image.png', localPath: 'images/image.png', assetKey: 'image', role: 'content', sha256: 's', duplicateOf: null, width: 1, height: 1 },
      { imageId: 'img_002', url: 'https://x/b.png', semanticName: '上传区.png', localPath: 'images/上传区.png', assetKey: '上传区', role: 'content', sha256: 't', duplicateOf: null, width: 1, height: 1 },
    ],
    failedAssets: [], summary: {},
  };
  writeFileSync(mf, JSON.stringify(manifest));
  for (const im of manifest.images) writeFileSync(join(imagesDir, im.semanticName), 'fake');
  return { dir, mf, imagesDir };
}

test('命中重命名 + 未命中保留 + manifest 回写(naming)', () => {
  const { mf, imagesDir } = setup();
  const r = runRename({ manifestFile: mf, nameMap: { 'https://x/a.png': 'topbar-avatar' } });
  assert.equal(r.renamed.length, 1);
  assert.equal(r.summary.kept, 1);
  assert.equal(r.renamed[0].to, 'topbar-avatar.png');
  const m = JSON.parse(readFileSync(mf, 'utf8'));
  assert.equal(m.images[0].semanticName, 'topbar-avatar.png');
  assert.equal(m.images[0].localPath, 'images/topbar-avatar.png');
  assert.equal(m.images[0].assetKey, 'topbar-avatar');
  assert.equal(m.images[0].naming, 'business');
  assert.equal(m.images[1].naming, 'structural');
  assert.ok(!existsSync(join(imagesDir, 'image.png')));
  assert.ok(existsSync(join(imagesDir, 'topbar-avatar.png')));
});

test('幂等：第二次运行不产生额外重命名', () => {
  const { mf } = setup();
  runRename({ manifestFile: mf, nameMap: { 'https://x/a.png': 'topbar-avatar' } });
  const second = runRename({ manifestFile: mf, nameMap: { 'https://x/a.png': 'topbar-avatar' } });
  assert.equal(second.renamed.length, 0, '同名即跳过，不应重复 -2');
  assert.equal(second.summary.kept, 1);
});

test('冲突：同业务名 → -2 后缀', () => {
  const { mf } = setup();
  const r = runRename({ manifestFile: mf, nameMap: { 'https://x/a.png': 'avatar', 'https://x/b.png': 'avatar' } });
  assert.equal(r.renamed.length, 2);
  assert.ok(r.renamed.some(x => x.to === 'avatar.png'));
  assert.ok(r.renamed.some(x => x.to === 'avatar-2.png'));
});

test('nameMapFile：外部映射文件同样生效', () => {
  const { mf } = setup();
  const mapFile = join(mf, '..', 'semantic-name-map.json');
  writeFileSync(mapFile, JSON.stringify({ 'https://x/a.png': 'topbar-avatar' }));
  const r = runRename({ manifestFile: mf, nameMapFile: mapFile });
  assert.equal(r.renamed.length, 1);
  assert.equal(r.renamed[0].to, 'topbar-avatar.png');
  const m = JSON.parse(readFileSync(mf, 'utf8'));
  assert.equal(m.images[0].naming, 'business');
});