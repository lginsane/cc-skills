#!/usr/bin/env node
// .claude/skills/lg-scripts/d2c-render.mjs
// 将 HTML/Vue 页面渲染为 PNG 截图，用于像素对比

import { existsSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

async function launchBrowser() {
  try {
    const puppeteer = await import('puppeteer');
    return { browser: await puppeteer.launch({ headless: true }), impl: 'puppeteer' };
  } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  }
  const core = await import('puppeteer-core').catch(() => null);
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  if (core) {
    for (const p of candidates) {
      if (existsSync(p)) return { browser: await core.launch({ headless: true, executablePath: p }), impl: 'puppeteer-core' };
    }
  }
  console.error(
    '⚠️ 未找到 puppeteer/puppeteer-core 或系统 Chrome。\n' +
    '   处置：npm i -g puppeteer（或项目内 npm i -D puppeteer；macOS 常见路径已探测）。\n' +
    '   或准备 dev server URL + 系统 Chrome 后重跑。'
  );
  process.exit(1);
}

async function renderWithBrowser(browser, source, output, isUrl) {
  const page = await browser.newPage();
  const target = isUrl ? source : `file://${resolve(source)}`;
  await page.goto(target, { waitUntil: 'networkidle0', timeout: 45000 });
  const bodyHandle = await page.$('body');
  if (!bodyHandle) {
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    await page.screenshot({ path: output, fullPage: true });
    return;
  }
  const { width, height } = await bodyHandle.boundingBox();
  await page.setViewport({ width: Math.ceil(width), height: Math.ceil(height), deviceScaleFactor: 2 });
  await page.screenshot({ path: output, fullPage: true });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node d2c-render.mjs <html-file|url> <output-png>');
    process.exit(1);
  }
  const [source, outputPng] = args;
  const isUrl = /^https?:\/\//i.test(source);
  console.error(`渲染: ${source} → ${outputPng}`);
  const { browser } = await launchBrowser();
  try {
    await renderWithBrowser(browser, source, outputPng, isUrl);
  } finally {
    await browser.close().catch(() => {});
  }
  console.error(`✅ 渲染完成: ${outputPng}`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch(err => {
    console.error(`❌ 渲染失败: ${err.message}`);
    process.exit(1);
  });
}
