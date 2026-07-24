// catalog.mjs — 提取墨刀左侧目录结构
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const VIEWPORT = { width: 1440, height: 900 };
const TMP_DIR = '/tmp/modao-catalog';
const TMP_FILE = join(TMP_DIR, 'catalog-output.json');

let PROJECT_CATALOG_DIR = null;
let PROJECT_CATALOG_FILE = null;

function loadConfig() {
  const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
  try {
    const config = JSON.parse(readFileSync(join(cwd, '.claude', 'config', 'lg-config.json'), 'utf-8'));
    if (!config.modao_url) throw new Error('缺少 modao_url');
    // Setup project catalog output path
    const catalogDir = config.catalog_dir || './.lg-docs/catalog/';
    PROJECT_CATALOG_DIR = join(cwd, catalogDir);
    PROJECT_CATALOG_FILE = join(PROJECT_CATALOG_DIR, 'catalog-output.json');
    return config;
  } catch (err) {
    console.error(JSON.stringify({ success: false, error: `配置读取失败: ${err.message}` }));
    process.exit(1);
  }
}

async function autoLogin(page, password) {
  await page.waitForTimeout(3000);
  const pwdInput = page.locator('input[type="password"]').first();
  const pwdVisible = await pwdInput.isVisible({ timeout: 2000 }).catch(() => false);
  if (pwdVisible && password) {
    console.error('自动填写密码...');
    await pwdInput.fill(password);
    const btn = page.locator('button:has-text("确定"), button:has-text("进入"), button:has-text("登录"), button[type="submit"]').first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) await btn.click();
    else await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    console.error('密码已提交');
  } else {
    try {
      const cwd = process.env.MODOA_PROJECT_DIR || process.cwd();
      const cookies = JSON.parse(readFileSync(join(cwd, '.claude', 'config', 'lg-cookies.json'), 'utf-8'));
      if (Date.now() - cookies.savedAt < 30 * 24 * 60 * 60 * 1000) {
        await page.context().addCookies(cookies.cookies);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
      }
    } catch (_) {}
  }
}

async function expandAllNodes(page) {
  console.error('展开折叠节点...');
  for (let r = 0; r < 30; r++) {
    const n = await page.evaluate(() => {
      let c = 0;
      document.querySelectorAll('[class*="arrow"]:not([class*="open"]):not([class*="down"]), [class*="caret"]:not([class*="open"]), [class*="chevron"]:not([class*="open"]), [class*="toggle"]:not([class*="open"]):not([class*="expanded"]), [class*="switcher"]:not([class*="open"])').forEach(el => {
        if (el.getClientRects().length > 0 && typeof el.click === 'function') { el.click(); c++; }
      });
      return c;
    });
    if (n === 0) break;
    console.error(`  第${r + 1}轮: 展开${n}个节点`);
    await page.waitForTimeout(500);
  }
}

async function extractCatalog(page) {
  console.error('提取目录...');
  return await page.evaluate(() => {
    const debug = { sidebar_found: false, sidebar_selector: 'none', sidebar_rect: null, extraction_method: 'none' };

    // Find the root <ul> inside #screen_list
    const rootUl = document.querySelector('#screen_list ul, #screen-scroll-list ul');
    if (!rootUl) {
      // Fallback: find sidebar panel first
      let panel = document.querySelector('[class*="left-panel"]');
      if (!panel) {
        for (const el of document.querySelectorAll('div, nav, aside')) {
          const r = el.getBoundingClientRect();
          if (r.width > 100 && r.height > 300 && r.x < 400) { panel = el; break; }
        }
      }
      if (!panel) return { success: false, debug, versions: [], error: '未找到侧边栏' };

      const panelRect = panel.getBoundingClientRect();
      debug.sidebar_found = true;
      debug.sidebar_selector = (panel.className || panel.tagName).substring(0, 120);
      debug.sidebar_rect = { x: Math.round(panelRect.x), y: Math.round(panelRect.y), w: Math.round(panelRect.width), h: Math.round(panelRect.height) };
      return { success: false, debug, versions: [], error: '未找到 #screen_list ul' };
    }

    // Record sidebar info
    const leftPanel = rootUl.closest('[class*="left-panel"]');
    if (leftPanel) {
      const r = leftPanel.getBoundingClientRect();
      debug.sidebar_found = true;
      debug.sidebar_selector = leftPanel.className.substring(0, 120);
      debug.sidebar_rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }

    // ── DOM-walk: use Modao's actual <li>/<ul> nesting ──
    function walk(ul) {
      const items = [];
      for (const li of ul.children) {
        if (li.tagName !== 'LI') continue;

        // Extract name from span.editable-span
        const nameSpan = li.querySelector('span.editable-span');
        const name = nameSpan?.textContent?.trim();
        if (!name || name.length < 2) continue;

        // Check if this is a folder (has child screens)
        const isFolder = !!li.querySelector('.rn-list-item.folder, .folder');
        const childUl = li.querySelector('ul.child-screens');

        items.push({
          name,
          type: isFolder && childUl ? 'group' : 'page',
          hasChildren: !!(childUl && childUl.children.length > 0),
          children: childUl ? walk(childUl) : []
        });
      }
      return items;
    }

    const versions = walk(rootUl);
    debug.extraction_method = 'dom-walk';
    debug.total_items = versions.reduce((s, v) => s + 1 + (v.children ? v.children.length : 0), 0);

    return {
      success: true, debug, versions,
      version_count: versions.length,
      total_menu_count: versions.reduce((s, v) => s + 1 + (v.children ? v.children.length : 0), 0)
    };
  });
}

function buildMdCatalog(output) {
  const lines = ['# 墨刀原型目录', '', `> 提取时间: ${output.timestamp}`, `> 提取方式: ${output.debug.extraction_method}`, `> 节点数: ${output.debug.total_items || '?'}`, ''];

  function render(items, depth = 0) {
    for (const item of items) {
      const prefix = '  '.repeat(depth) + (item.hasChildren ? '- 📁 ' : '- 📄 ');
      lines.push(prefix + '**' + item.name + '**');
      if (item.children) render(item.children, depth + 1);
    }
  }

  render(output.versions);
  return lines.join('\n');
}

async function main() {
  const config = loadConfig();
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(PROJECT_CATALOG_DIR, { recursive: true });

  // Check if recent catalog exists (skip re-extraction)
  const catalogMdFile = join(PROJECT_CATALOG_DIR, 'catalog.md');
  if (existsSync(PROJECT_CATALOG_FILE)) {
    try {
      const cached = JSON.parse(readFileSync(PROJECT_CATALOG_FILE, 'utf-8'));
      const age = Date.now() - new Date(cached.timestamp).getTime();
      if (age < 24 * 60 * 60 * 1000 && cached.success) {
        console.error(`目录已存在 (${Math.round(age / 3600000)}h 前)，跳过重新提取`);
        console.error(`  JSON: ${PROJECT_CATALOG_FILE}`);
        console.error(`  MD:   ${catalogMdFile}`);
        console.log(JSON.stringify(cached));
        process.exit(0);
      }
    } catch (_) { /* re-extract if corrupt */ }
  }

  console.error(`打开: ${config.modao_url}`);
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  await page.goto(config.modao_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await autoLogin(page, config.modao_password || '');

  console.error('等待加载...');
  await page.waitForTimeout(5000);
  await expandAllNodes(page);
  await page.waitForTimeout(2000);

  const catalog = await extractCatalog(page);
  const output = { ...catalog, url: config.modao_url, timestamp: new Date().toISOString() };

  const json = JSON.stringify(output, null, 2);
  writeFileSync(TMP_FILE, json, 'utf-8');
  writeFileSync(PROJECT_CATALOG_FILE, json, 'utf-8');

  // Write MD
  const md = buildMdCatalog(output);
  writeFileSync(catalogMdFile, md, 'utf-8');

  console.error(`已保存: ${TMP_FILE}`);
  console.error(`已保存: ${PROJECT_CATALOG_FILE}`);
  console.error(`已保存: ${catalogMdFile}`);
  console.log(json);
  console.error('\n浏览器保持打开。');
}

main();
