import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseInput, collectImageCandidates, assignSemanticNames, resolveLabel,
  sanitizeFilename, isGenericName, downloadAndHash, runManifest,
} from './image-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const complex = JSON.parse(readFileSync(resolve(__dirname, '__fixtures__/raw-dsl-complex-sample.json'), 'utf-8'));
const parsedComplex = parseInput(complex);

test('collectImageCandidates 复杂稿：URL 级去重产出 6 个候选、4 处重复引用', () => {
  const cands = collectImageCandidates(parsedComplex);
  assert.equal(cands.length, 6);
  assert.equal(cands.reduce((s, c) => s + c.duplicateUris.length, 0), 4);
});

test('assignSemanticNames 命名降级链 + 冲突后缀 + 角色分类', () => {
  const cands = collectImageCandidates(parsedComplex);
  assignSemanticNames(cands);
  const by = (tail) => cands.find(c => c.url.endsWith(tail));
  assert.equal(by('logo-brand.png').assetKey, 'logo-品牌');            // 节点名（非泛化）优先
  assert.equal(by('goods-cover.png').assetKey, '商品卡片');            // 泛化节点名 → section 名兜底
  assert.equal(by('bg-left.png').assetKey, '背景-装饰');                // decor
  assert.equal(by('bg-right.png').assetKey, '背景-装饰-2');             // 同名不同内容 → -2 后缀
  assert.equal(by('bg-right.png').role, 'decor');
  assert.equal(by('bg-left.png').role, 'decor');
  assert.equal(by('avatar-zhang.png').role, 'content');
});

test('resolveLabel 就近文本优先于 section 兜底', () => {
  assert.equal(resolveLabel({ nodeName: '矩形 88', nearText: '', ancestorNames: [], sectionName: '商品卡片' }), '商品卡片');
  assert.equal(resolveLabel({ nodeName: '矩形 88', nearText: '活动主图', ancestorNames: [], sectionName: '商品卡片' }), '活动主图');
  assert.equal(resolveLabel({ nodeName: 'logo 品牌', nearText: '', ancestorNames: [], sectionName: '侧边栏' }), 'logo 品牌');
  assert.equal(resolveLabel({ nodeName: '', nearText: '', ancestorNames: [], sectionName: '' }), 'image');
});

test('resolveLabel 契约兜底：全程泛化名 → image，禁止泛化名落盘', () => {
  assert.equal(resolveLabel({ nodeName: '矩形 46', nearText: '', ancestorNames: [], sectionName: '组 19698' }), 'image');
  assert.equal(resolveLabel({ nodeName: 'Group 12', nearText: '', ancestorNames: [], sectionName: 'Frame 3' }), 'image');
  assert.equal(resolveLabel({ nodeName: '矩形 46', nearText: '', ancestorNames: ['上传区'], sectionName: '组 19698' }), '上传区');
});

test('isGenericName / sanitizeFilename 边界', () => {
  assert.ok(isGenericName('矩形 88'));
  assert.ok(isGenericName('Group 12'));
  assert.ok(!isGenericName('生成前'));
  assert.ok(!isGenericName('logo 品牌'));
  assert.equal(sanitizeFilename('a/b\\c:d?e'), 'a-b-c-d-e');
  assert.equal(sanitizeFilename('   '), 'image');
  assert.equal(sanitizeFilename('生成前'), '生成前');
});

test('下载 + sha256 指纹去重 + 失败清单（可注入 transport，不发真实网络）', async () => {
  const PNG = Buffer.from('fakepngbytes-fakepngbytes', 'utf-8');
  const transport = async (url) => {
    if (url.includes('404')) throw new Error('HTTP 404');
    return { statusCode: 200, data: PNG };
  };
  const cands = [
    { url: 'https://x.example/a.png', sectionIndex: 0, nodeId: 'n1', nodeName: '甲', sectionName: 's', nodePath: [], nearText: '', ancestorNames: [], width: 10, height: 10 },
    { url: 'https://x.example/b.png', sectionIndex: 0, nodeId: 'n2', nodeName: '乙', sectionName: 's', nodePath: [], nearText: '', ancestorNames: [], width: 10, height: 10 },
    { url: 'https://x.example/404.png', sectionIndex: 1, nodeId: 'n3', nodeName: '丙', sectionName: 's', nodePath: [], nearText: '', ancestorNames: [], width: 10, height: 10 },
  ];
  assignSemanticNames(cands);
  const dir = resolve(__dirname, '__fixtures__/out/dl-test');
  rmSync(dir, { recursive: true, force: true });
  const { images, failedAssets } = await downloadAndHash(cands, dir, transport);
  assert.equal(images.length, 2);                                          // a/b 内容指纹相同
  assert.equal(images.filter(i => i.duplicateOf).length, 1, '同指纹图片其一 duplicateOf');
  assert.equal(images.find(i => i.duplicateOf).duplicateOf, images.find(i => !i.duplicateOf).imageId);
  assert.equal(failedAssets.length, 1);
  assert.equal(failedAssets[0].reason, 'download_failed');
  assert.match(failedAssets[0].url, /404/);
});

test('runManifest 端到端：manifest + 文件落盘 + 摘要（注入 transport）', async () => {
  const outDir = resolve(__dirname, '__fixtures__/out/manifest-e2e');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const rawFile = resolve(outDir, 'raw-dsl.json');
  writeFileSync(rawFile, JSON.stringify(complex));
  const out = resolve(outDir, 'out');
  const transport = async () => ({ statusCode: 200, data: Buffer.from('same-bytes', 'utf-8') });
  const { summaryText } = await runManifest({ rawFile, outDir: out, transport });
  const manifest = JSON.parse(readFileSync(resolve(out, 'image-manifest.json'), 'utf-8'));
  assert.equal(manifest.images.length, 6);                                 // 6 个独立 url 候选全部入 manifest
  assert.equal(manifest.failedAssets.length, 0);
  // 注入的字节全部相同 → 内容指纹归并为 1 个实体文件
  assert.equal(manifest.summary.downloaded, 1);
  assert.equal(manifest.summary.contentDeduped, 5);
  assert.match(summaryText, /图片提取完成/);
  assert.equal(manifest.designName, '商品管理-商品列表');
  assert.equal(manifest.images[0].naming, 'structural', 'lg-dsl 侧命名应为 structural');
});