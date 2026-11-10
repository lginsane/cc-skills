import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = ['dsl.mjs', 'image-manifest.mjs', 'component-blueprint.mjs', 'dsl-fidelity-check.mjs'];

for (const s of SCRIPTS) {
  test(`${s}: --input 指向不存在文件 → 明确报错且退出码非零`, () => {
    const r = spawnSync(process.execPath, [join(DIR, s), '--input', join(DIR, '__bogus_missing__.json')], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, `${s} 应非零退出`);
    assert.match(r.stderr + r.stdout, /文件不存在/, `${s} 应提示文件不存在`);
  });
}

test('dsl.mjs: 输入含 shell 元字符 version → 拒绝退出', () => {
  const cfg = JSON.stringify({ version: "1.4.6'; rm -rf /; echo '", dslDir: 'x', designs: [] });
  const r = spawnSync(process.execPath, [join(DIR, 'dsl.mjs')], { input: cfg, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /输入校验失败/);
});