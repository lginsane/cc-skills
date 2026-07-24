// extract.mjs — 按 manifest 自动遍历提取迭代图片
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import https from 'https';
import http from 'http';

const VIEWPORT = { width: 1440, height: 900 };
const TMP_BASE = '/tmp/modao-export';

function loadConfig() {
  const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
  return JSON.parse(readFileSync(join(cwd, '.claude', 'config', 'lg-config.json'), 'utf-8'));
}

function loadManifest() {
  const args = process.argv.slice(2);
  const mArg = args.find(a => a.startsWith('--manifest='));
  if (mArg) return JSON.parse(readFileSync(mArg.split('=')[1], 'utf-8'));
  return JSON.parse(readFileSync(0, 'utf-8'));
}

function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, filePath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { writeFileSync(filePath, Buffer.concat(chunks)); resolve(true); });
    }).on('error', reject);
  });
}

async function autoLogin(page, password) {
  await page.waitForTimeout(3000);
  const pwd = page.locator('input[type="password"]').first();
  if (await pwd.isVisible({ timeout: 2000 }).catch(() => false) && password) {
    console.error('登录...');
    await pwd.fill(password);
    const btn = page.locator('button:has-text("确定"), button:has-text("进入"), button:has-text("登录"), button[type="submit"]').first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) await btn.click();
    else await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
  } else {
    try {
      const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
      const ck = JSON.parse(readFileSync(join(cwd, '.claude', 'config', 'lg-cookies.json'), 'utf-8'));
      if (Date.now() - ck.savedAt < 30 * 24 * 60 * 60 * 1000) {
        await page.context().addCookies(ck.cookies);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
      }
    } catch (_) {}
  }
}

async function clickSidebarNode(page, pageName) {
  // Find matching text node in sidebar using Playwright locator
  const panel = page.locator('[class*="left-panel"]').first();
  const panelExists = await panel.count() > 0;
  if (!panelExists) return { success: false, error: 'no-sidebar' };

  // Try to find an element containing the page name text
  // Use Playwright's text matcher which handles React components properly
  const textLocator = panel.locator(`text="${pageName}"`).first();
  const textCount = await textLocator.count();

  if (textCount === 0) {
    // Fuzzy: try partial match
    const allTexts = await panel.locator('*').allTextContents();
    const matches = allTexts.filter(t => t.trim().includes(pageName) || pageName.includes(t.trim()));
    if (matches.length === 0) return { success: false, error: 'no-match', name: pageName };
    // Use first match that's close in length
    const best = matches.sort((a, b) =>
      Math.abs(a.trim().length - pageName.length) - Math.abs(b.trim().length - pageName.length)
    )[0].trim();
    const bestLocator = panel.locator(`text="${best}"`).first();
    if (await bestLocator.count() === 0) return { success: false, error: 'no-match', name: pageName };
    await bestLocator.click({ timeout: 3000 });
    return { success: true, text: best };
  }

  await textLocator.click({ timeout: 3000 });
  return { success: true, text: pageName };
}

async function waitForImage(page, timeoutMs = 15000) {
  const start = Date.now();
  let best = { found: false, w: 0, h: 0 };

  while (Date.now() - start < timeoutMs) {
    const cur = await page.evaluate(() => {
      let best = { found: false, w: 0, h: 0 };
      for (const img of document.querySelectorAll('img')) {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (w > 300 && h > 300) {
          if (/loading/i.test(img.className || '') || /loading\.(gif|svg)/i.test(img.src)) continue;
          const area = w * h;
          if (area > best.w * best.h) {
            best = { found: true, w, h, area };
          }
        }
      }
      return best;
    });
    if (cur.w > best.w) best = cur;

    // If we found an image > 500x500 and been stable for 2s, return it
    if (best.found && best.w > 500 && Date.now() - start > 3000) {
      return best;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return best.found ? best : { found: false, error: 'timeout' };
}

async function extractCurrentPage(page, pageInfo, outputDir) {
  const ts = Date.now();
  const tmpDir = join(TMP_BASE, String(ts));
  mkdirSync(tmpDir, { recursive: true });

  const infos = await page.evaluate(() => {
    const r = []; const seen = new Set();
    const imgs = Array.from(document.querySelectorAll('img'))
      .filter(img => {
        const cls = (img.className || '').toLowerCase();
        if (cls.includes('loading') || /loading\.(gif|svg)/i.test(img.src)) return false;
        return img.naturalWidth > 300 && img.naturalHeight > 300;
      })
      .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));

    // Keep ALL unique images per page (cap 20), dedup by src
    for (const img of imgs) {
      if (r.length >= 20) break;
      const src = img.src;
      if (!src || src.startsWith('data:') || seen.has(src)) continue;
      const area = img.naturalWidth * img.naturalHeight;
      seen.add(src);
      r.push({ src, width: img.naturalWidth, height: img.naturalHeight });
    }
    return r;
  });

  const downloaded = [];
  for (let i = 0; i < infos.length; i++) {
    try {
      const dims = `${infos[i].width}x${infos[i].height}`;
      const safe = pageInfo.name.replace(/[/\\?%*:|"<>]/g, '-');
      const fn = `${pageInfo.index}_${safe}_${dims}.png`;
      const tmp = join(tmpDir, `img_${i + 1}.png`);
      const proj = join(outputDir, fn);
      await downloadFile(infos[i].src, tmp);
      try { copyFileSync(tmp, proj); } catch (_) {}
      downloaded.push({ fileName: fn, projectPath: proj, width: infos[i].width, height: infos[i].height });
    } catch (e) {
      downloaded.push({ error: e.message });
    }
  }
  return { pageIndex: pageInfo.index, pageName: pageInfo.name, downloaded, totalFound: infos.length };
}

async function main() {
  const config = loadConfig();
  const manifest = loadManifest();
  if (!manifest.pages || manifest.pages.length === 0) {
    console.error(JSON.stringify({ success: false, error: 'manifest 无页面' }));
    process.exit(1);
  }

  const baseImagesDir = config.screenshots_dir
    ? resolve(process.env.MODOA_PROJECT_DIR || process.cwd(), config.screenshots_dir)
    : resolve(process.env.MODOA_PROJECT_DIR || process.cwd(), './.lg-docs/images/');
  const versionDir = join(baseImagesDir, manifest.version || 'unknown');
  mkdirSync(versionDir, { recursive: true });

  console.error(`打开: ${config.modao_url}`);
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.goto(config.modao_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await autoLogin(page, config.modao_password || '');
  await page.waitForTimeout(5000);

  const results = [], failed = [], skipped = [];
  const total = manifest.pages.length;

  for (let i = 0; i < total; i++) {
    const pg = manifest.pages[i];
    console.error(`[${i + 1}/${total}] ${pg.name}`);

    // Check if images already exist for this page
    const existingFiles = existsSync(versionDir)
      ? readdirSync(versionDir).filter(f => f.startsWith(`${pg.index}_`))
      : [];
    if (existingFiles.length > 0) {
      console.error(`  跳过: 已有 ${existingFiles.length} 张图片`);
      skipped.push({ ...pg, existingFiles });
      results.push({ pageIndex: pg.index, pageName: pg.name, skipped: true, existingFiles });
      continue;
    }

    const clickR = await clickSidebarNode(page, pg.name);
    if (!clickR.success) {
      console.error(`  跳过: ${clickR.error}`);
      failed.push({ ...pg, error: `侧边栏匹配: ${clickR.error}` });
      continue;
    }
    console.error(`  点击: ${clickR.text}`);

    await page.waitForTimeout(1500);
    const img = await waitForImage(page);
    if (!img.found) {
      console.error(`  跳过: 图片加载超时`);
      failed.push({ ...pg, error: '加载超时' });
      continue;
    }
    console.error(`  加载: ${img.w}x${img.h}`);

    const r = await extractCurrentPage(page, pg, versionDir);
    results.push(r);
    console.error(`  提取: ${r.totalFound} 张`);
  }

  console.log(JSON.stringify({
    success: results.length > 0,
    version: manifest.version,
    totalPages: total,
    extracted: results.filter(r => !r.skipped).length,
    skipped: results.filter(r => r.skipped).length,
    failed: failed.length,
    results,
    failed,
    versionDir
  }, null, 2));
  console.error(`\n完成: ${results.length}/${total}, 跳过: ${skipped.length}, 失败: ${failed.length}`);
  await browser.close();
}
main();
