// .claude/skills/modao-plan/open-browser.mjs
// 读项目配置 → 打开墨刀 → 自动登录 → 多轮提取产品图片 → 存入项目目录
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, unlinkSync, readFileSync, copyFileSync } from 'fs';
import { join, resolve, basename } from 'path';
import https from 'https';
import http from 'http';

const SIGNAL_FILE = '/tmp/modao-plan-extract';
const VIEWPORT = { width: 1440, height: 900 };
const OUTPUT_BASE = join('/tmp', 'modao-export');

function loadConfig() {
  const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
  const configPath = join(cwd, '.claude', 'config', 'lg-config.json');
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (!config.modao_url) throw new Error('缺少 modao_url');
    return config;
  } catch (err) {
    console.error(JSON.stringify({
      success: false,
      error: `项目配置读取失败: ${err.message}。请先运行 /modao-plan init`
    }));
    process.exit(1);
  }
}

function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, filePath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url.substring(0, 80)}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        writeFileSync(filePath, Buffer.concat(chunks));
        resolve(true);
      });
    }).on('error', reject);
  });
}

async function autoLogin(page, password) {
  await page.waitForTimeout(3000);

  const pwdInput = page.locator('input[type="password"]').first();
  const pwdVisible = await pwdInput.isVisible({ timeout: 2000 }).catch(() => false);

  if (pwdVisible && password) {
    console.error('检测到密码输入框，自动填写...');
    await pwdInput.fill(password);

    const submitBtn = page.locator('button:has-text("确定"), button:has-text("进入"), button:has-text("登录"), button[type="submit"], .login-btn, .submit-btn').first();
    const btnVisible = await submitBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (btnVisible) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(3000);
    console.error('密码已提交');

    const cookies = await page.context().cookies();
    const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
    writeFileSync(join(cwd, '.claude', 'config', 'lg-cookies.json'), JSON.stringify({ cookies, savedAt: Date.now() }));
  } else if (pwdVisible && !password) {
    console.error('需要密码但配置中未设置，请在浏览器中手动登录');
  } else {
    try {
      const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
      const cookieData = JSON.parse(readFileSync(join(cwd, '.claude', 'config', 'lg-cookies.json'), 'utf-8'));
      if (Date.now() - cookieData.savedAt < 30 * 24 * 60 * 60 * 1000) {
        await page.context().addCookies(cookieData.cookies);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        console.error('已恢复登录态');
      }
    } catch (_) {}
    console.error('无需密码或已登录');
  }
}

async function extractImages(page, roundIndex, projectImagesDir) {
  const timestamp = Date.now();
  const tmpDir = join(OUTPUT_BASE, String(timestamp));
  mkdirSync(tmpDir, { recursive: true });

  // Ensure project images dir exists
  try {
    mkdirSync(projectImagesDir, { recursive: true });
  } catch (_) {}

  const imageInfos = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    // Strategy 1: Large img elements (main design images)
    document.querySelectorAll('img').forEach(img => {
      const src = img.src || img.getAttribute('data-src') || '';
      const cls = (img.className || '').toLowerCase();
      // Skip loading spinners, logos, and small icons
      if (!src || src.startsWith('data:') || seen.has(src)) return;
      if (cls.includes('loading') || cls.includes('noName') || /loading.*\.(gif|svg)/i.test(src)) return;
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w > 300 && h > 300) {
        seen.add(src);
        results.push({ src, width: w, height: h, type: 'img', className: img.className || '' });
      }
    });

    // Strategy 2: Canvas elements
    document.querySelectorAll('canvas').forEach(canvas => {
      if (canvas.width > 100 && canvas.height > 100) {
        try {
          results.push({ src: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, type: 'canvas', className: '' });
        } catch (_) {}
      }
    });

    // Strategy 3: CSS background images on large containers
    document.querySelectorAll('div, section, article').forEach(el => {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || !bg.startsWith('url(')) return;
      const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (!m || !m[1] || seen.has(m[1])) return;
      if (el.offsetWidth > 200 && el.offsetHeight > 200) {
        seen.add(m[1]);
        results.push({ src: m[1], width: el.offsetWidth, height: el.offsetHeight, type: 'bg', className: '' });
      }
    });

    return results;
  });

  // Filter: only keep images where width >= 300 or height >= 300 (real design pages)
  const designImages = imageInfos.filter(img => img.width >= 300 || img.height >= 300);
  const smallImages = imageInfos.filter(img => img.width < 300 && img.height < 300);

  const downloaded = [];
  for (let i = 0; i < designImages.length; i++) {
    const info = designImages[i];
    try {
      const ext = info.type === 'canvas' ? 'png' : 'png';
      const dims = `${info.width}x${info.height}`;
      const tmpPath = join(tmpDir, `page_${i + 1}.${ext}`);
      const projectFileName = `round${roundIndex}_${i + 1}_${dims}.${ext}`;
      const projectPath = join(projectImagesDir, projectFileName);

      if (info.src.startsWith('data:')) {
        const base64 = info.src.split(',')[1];
        writeFileSync(tmpPath, Buffer.from(base64, 'base64'));
      } else {
        await downloadFile(info.src, tmpPath);
      }

      // Copy to project directory
      try {
        copyFileSync(tmpPath, projectPath);
      } catch (copyErr) {
        console.error(`复制到项目目录失败: ${copyErr.message}`);
      }

      downloaded.push({
        tmpPath,
        projectPath,
        fileName: projectFileName,
        width: info.width,
        height: info.height,
        source: info.type,
        className: info.className
      });
    } catch (err) {
      downloaded.push({ error: err.message, src: (info.src || '').substring(0, 80), source: info.type });
    }
  }

  return {
    roundIndex,
    downloaded,
    tmpDir,
    projectImagesDir,
    totalFound: designImages.length,
    smallIgnored: smallImages.length
  };
}

async function main() {
  if (existsSync(SIGNAL_FILE)) unlinkSync(SIGNAL_FILE);

  const config = loadConfig();
  const url = config.modao_url;
  const password = config.modao_password || '';
  const projectImagesDir = config.screenshots_dir
    ? resolve(process.env.MODOA_PROJECT_DIR || process.cwd(), config.screenshots_dir)
    : resolve(process.env.MODOA_PROJECT_DIR || process.cwd(), './.lg-docs/images/');

  console.error(`打开: ${url}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Auto login
  await autoLogin(page, password);

  console.log(JSON.stringify({
    status: 'ready',
    message: '浏览器已打开并自动登录。请在浏览器中选择版本和页面，完成后回复"已打开"。',
    imagesDir: projectImagesDir
  }));

  // Multi-round extraction loop
  let roundIndex = 1;
  let running = true;

  console.error('等待用户选择页面...');

  while (running) {
    // Wait for signal
    let cmd = '';
    while (!cmd) {
      await new Promise(r => setTimeout(r, 1000));
      if (existsSync(SIGNAL_FILE)) {
        cmd = readFileSync(SIGNAL_FILE, 'utf-8').trim();
        unlinkSync(SIGNAL_FILE);
      }
    }

    if (cmd === 'extract') {
      console.error(`第 ${roundIndex} 轮提取产品图片...`);
      try {
        const result = await extractImages(page, roundIndex, projectImagesDir);
        console.log(JSON.stringify({ success: true, ...result }));
        roundIndex++;
      } catch (err) {
        console.error(JSON.stringify({ success: false, error: `提取失败: ${err.message}` }));
      }
    } else if (cmd === 'done') {
      console.log(JSON.stringify({ status: 'done', rounds: roundIndex - 1 }));
      running = false;
    } else if (cmd === 'close') {
      console.log(JSON.stringify({ status: 'closed' }));
      running = false;
    }
  }

  await browser.close();
}

main();
