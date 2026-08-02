// extract.mjs — 按 manifest 自动遍历提取迭代图片
// 兼容 wImage（图片型，下载URL）和 wRichText（Widget型，演示模式截图）
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import https from 'https';
import http from 'http';

const VIEWPORT = { width: 1920, height: 1080 };
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
  const panel = page.locator('[class*="left-panel"]').first();
  const panelExists = await panel.count() > 0;
  if (!panelExists) return { success: false, error: 'no-sidebar' };

  const textLocator = panel.locator(`text="${pageName}"`).first();
  const textCount = await textLocator.count();

  if (textCount === 0) {
    const allTexts = await panel.locator('*').allTextContents();
    const matches = allTexts.filter(t => t.trim().includes(pageName) || pageName.includes(t.trim()));
    if (matches.length === 0) return { success: false, error: 'no-match', name: pageName };
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

async function waitForContent(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const content = await page.evaluate(() => {
      for (const img of document.querySelectorAll('img')) {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (w > 500 && h > 500) {
          if (/loading/i.test(img.className || '') || /loading\.(gif|svg)/i.test(img.src)) continue;
          return { type: 'image', width: w, height: h };
        }
      }
      const canvases = document.querySelectorAll('[class*="rResCanvas"]');
      for (const c of canvases) {
        if (c.offsetWidth > 300 && c.offsetHeight > 300) {
          const wrap = c.querySelector('[class*="StyledChildrenWrap"]');
          if (wrap && wrap.children.length > 0) {
            return { type: 'canvas', width: c.offsetWidth, height: c.offsetHeight };
          }
        }
      }
      return null;
    });
    if (content && Date.now() - start > 3000) return content;
    await new Promise(r => setTimeout(r, 500));
  }
  return { type: 'timeout' };
}

// 隐藏所有墨刀自身 UI（顶部工具栏、底部页数、欢迎横幅等）
async function hideMoDaoChrome(page) {
  try {
    await page.addStyleTag({ content: `
      [class*="StyledPreviewToolbar"] { display: none !important; }
      [class*="StyledPaging"] { display: none !important; }
      [class*="StyledSignUpPrompt"] { display: none !important; }
      [class*="toggle-button"] { display: none !important; }
    `});
  } catch (_) {}
}

// 进入演示模式 + 关闭左右面板
async function enterCleanView(page) {
  try {
    // 点击 "演示"
    const demoBtn = page.locator('.preview-switch-btn:not(.active)').first();
    if (await demoBtn.count() > 0) {
      await demoBtn.click();
      await page.waitForTimeout(1500);
    }

    // 关闭左右面板（JS click 跳过可见性检查）
    await page.evaluate(() => {
      document.querySelectorAll('.toggle-button').forEach(b => {
        const cls = b.className || '';
        if ((cls.includes('left') || cls.includes('right')) && cls.includes('pane-visible')) {
          b.click();
        }
      });
    });
    // 等待 2 秒让顶部/底部工具栏自动隐藏
    await page.waitForTimeout(2000);
  } catch (_) {}
}

// 退出演示模式回到总览
async function exitCleanView(page) {
  try {
    // 点击 "总览"
    const overviewBtn = page.locator('.preview-switch-btn.active').first();
    if (await overviewBtn.count() > 0) {
      await overviewBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch (_) {}
}

// 核心提取逻辑
async function extractCurrentPage(page, pageInfo, outputDir) {
  const result = { pageIndex: pageInfo.index, pageName: pageInfo.name, items: [] };

  // Step 1: 分析 rResCanvas 结构（在总览模式下）
  const canvasAnalysis = await page.evaluate(() => {
    const allCanvases = [];
    const groupLists = document.querySelectorAll('.group-list');
    groupLists.forEach(gl => {
      const canvases = gl.querySelectorAll(':scope > [class*="rResCanvas"]');
      canvases.forEach(c => {
        const images = Array.from(c.querySelectorAll('img'))
          .filter(img => {
            const cls = (img.className || '').toLowerCase();
            if (cls.includes('loading') || /loading\.(gif|svg)/i.test(img.src)) return false;
            return true;
          })
          .map(img => ({
            src: img.src,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            displayWidth: img.offsetWidth,
            displayHeight: img.offsetHeight,
          }));
        allCanvases.push({
          offsetWidth: c.offsetWidth,
          offsetHeight: c.offsetHeight,
          images,
        });
      });
    });
    return allCanvases;
  });

  if (canvasAnalysis.length === 0) {
    result.error = 'no-rResCanvas';
    return result;
  }

  const totalCanvases = canvasAnalysis.length;

  // Step 2: 判断模式
  const hasQualifyingImages = canvasAnalysis.some(c =>
    c.images.some(img => img.displayWidth >= c.offsetWidth * 0.8 && img.src && !img.src.startsWith('data:'))
  );

  if (hasQualifyingImages) {
    // --- 图片模式：直接下载 ---
    for (let ci = 0; ci < totalCanvases; ci++) {
      const canvas = canvasAnalysis[ci];
      const qualifying = canvas.images.filter(
        img => img.displayWidth >= canvas.offsetWidth * 0.8 && img.src && !img.src.startsWith('data:')
      );
      for (let ii = 0; ii < qualifying.length; ii++) {
        try {
          const img = qualifying[ii];
          const dims = `${img.naturalWidth}x${img.naturalHeight}`;
          const safe = pageInfo.name.replace(/[/\\?%*:|"<>"]/g, '-');
          const canvasTag = totalCanvases > 1 ? `_c${ci + 1}` : '';
          const imgTag = qualifying.length > 1 ? `_${ii + 1}` : '';
          const fn = `${pageInfo.index}_${safe}${canvasTag}${imgTag}_${dims}.png`;
          const proj = join(outputDir, fn);

          const tmpDir = join(TMP_BASE, String(Date.now()));
          mkdirSync(tmpDir, { recursive: true });
          const tmp = join(tmpDir, `img_c${ci}_${ii}.png`);
          await downloadFile(img.src, tmp);
          try { copyFileSync(tmp, proj); } catch (_) {}

          result.items.push({
            fileName: fn, projectPath: proj,
            width: img.naturalWidth, height: img.naturalHeight,
            mode: 'image',
          });
        } catch (e) {
          result.items.push({ error: e.message, mode: 'image' });
        }
      }
    }
  } else {
    // --- Widget模式：演示模式截图 ---
    await enterCleanView(page);

    for (let ci = 0; ci < totalCanvases; ci++) {
      try {
        // 非首个 canvas，用方向键切换
        if (ci > 0) {
          await page.keyboard.press('ArrowRight');
          // 等待 2 秒让工具栏自动隐藏
          await page.waitForTimeout(2000);
        }

        const canvas = canvasAnalysis[ci];
        const safe = pageInfo.name.replace(/[/\\?%*:|"<>"]/g, '-');
        const canvasTag = totalCanvases > 1 ? `_c${ci + 1}` : '';
        const dims = `${canvas.offsetWidth}x${canvas.offsetHeight}`;
        const fn = `${pageInfo.index}_${safe}${canvasTag}_${dims}.png`;
        const proj = join(outputDir, fn);

        await page.screenshot({ path: proj, type: 'png' });

        result.items.push({
          fileName: fn, projectPath: proj,
          width: canvas.offsetWidth, height: canvas.offsetHeight,
          mode: 'screenshot',
        });
      } catch (e) {
        result.items.push({ error: e.message, mode: 'screenshot' });
      }
    }

    // 回到总览模式
    await exitCleanView(page);
  }

  return result;
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
  await hideMoDaoChrome(page);

  const results = [], failed = [], skipped = [];
  const total = manifest.pages.length;

  for (let i = 0; i < total; i++) {
    const pg = manifest.pages[i];
    console.error(`[${i + 1}/${total}] ${pg.name}`);

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
    const content = await waitForContent(page);
    if (content.type === 'timeout') {
      console.error(`  跳过: 内容加载超时`);
      failed.push({ ...pg, error: '加载超时' });
      continue;
    }
    console.error(`  加载: ${content.type} ${content.width}x${content.height}`);

    const r = await extractCurrentPage(page, pg, versionDir);
    results.push(r);
    const imgCount = r.items ? r.items.length : 0;
    const modes = r.items ? [...new Set(r.items.map(it => it.mode))].join(',') : '';
    console.error(`  提取: ${imgCount} 张 [${modes}]`);
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
    versionDir,
  }, null, 2));
  console.error(`\n完成: ${results.length}/${total}, 跳过: ${skipped.length}, 失败: ${failed.length}`);
  await browser.close();
}
main();
