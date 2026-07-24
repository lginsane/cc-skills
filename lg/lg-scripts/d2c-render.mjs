#!/usr/bin/env node
// .claude/skills/lg-scripts/d2c-render.mjs
// 将 HTML/Vue 页面渲染为 PNG 截图，用于像素对比

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node d2c-render.mjs <html-file> <output-png>');
  process.exit(1);
}

const [htmlFile, outputPng] = args;

async function main() {
  console.error(`渲染: ${htmlFile} → ${outputPng}`);

  // 方案：使用 Puppeteer 渲染
  // puppeteer 作为可选依赖，运行时检查
  try {
    const puppeteer = await import('puppeteer');
    await renderWithPuppeteer(puppeteer, htmlFile, outputPng);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') {
      // Puppeteer 未安装，尝试 frameshot-mcp 或其他备选
      console.error('⚠️ Puppeteer 未安装，尝试备选方案...');
      await renderWithAlternative(htmlFile, outputPng);
    } else {
      throw e;
    }
  }
}

async function renderWithPuppeteer(puppeteer, htmlFile, output) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  const filePath = resolve(htmlFile);
  await page.goto(`file://${filePath}`, { waitUntil: 'networkidle0' });

  // 获取页面实际尺寸
  const bodyHandle = await page.$('body');
  if (!bodyHandle) {
    console.error('⚠️ 未找到 body 元素，使用默认视口 1920x1080');
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
    await page.screenshot({ path: output, fullPage: true });
    await browser.close();
    console.error(`✅ 渲染完成: ${output}`);
    return;
  }
  const { width, height } = await bodyHandle.boundingBox();

  await page.setViewport({
    width: Math.ceil(width),
    height: Math.ceil(height),
    deviceScaleFactor: 2  // 2x 高清截图
  });

  await page.screenshot({ path: output, fullPage: true });
  await browser.close();

  console.error(`✅ 渲染完成: ${output}`);
}

async function renderWithAlternative(htmlFile, output) {
  // 备选：使用系统截图工具
  // macOS: screencapture 无法精确截取渲染页面
  // 此处预留给 frameshot-mcp 集成
  console.error('⚠️ 备选方案暂未实现，请安装 puppeteer: npm install puppeteer');
  process.exit(1);
}

main().catch(err => {
  console.error(`❌ 渲染失败: ${err.message}`);
  process.exit(1);
});
