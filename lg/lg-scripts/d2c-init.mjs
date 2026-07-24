#!/usr/bin/env node
// .claude/skills/lg-scripts/d2c-init.mjs
// D2C 项目初始化：生成 page-development.md + d2c-restoration.md + vision-style-map.d2c.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const CWD = process.env.MODOA_PROJECT_DIR || process.cwd();

function readIfExists(filePath) {
  const full = resolve(CWD, filePath);
  return existsSync(full) ? readFileSync(full, 'utf-8') : null;
}

function ensureDir(dirPath) {
  const full = resolve(CWD, dirPath);
  if (!existsSync(full)) mkdirSync(full, { recursive: true });
}

function detectProjectInfo(claudeMd) {
  const info = { projectType: 'web', framework: 'html', cssUnit: 'px' };

  if (claudeMd.includes('@dcloudio/uni-app') || claudeMd.includes('uniapp') || claudeMd.includes('uni-app')) {
    info.projectType = 'uni-app 小程序';
    info.framework = 'uni-app';
    info.cssUnit = 'rpx';
  } else if (claudeMd.includes('ant-design-vue') || claudeMd.includes('SmartAdmin')) {
    info.projectType = '管理后台（应使用 --mode admin）';
    info.framework = 'vue3-antd';
    info.cssUnit = 'px';
  } else if (claudeMd.includes('vue')) {
    info.projectType = 'Vue3 H5';
    info.framework = 'vue3';
    info.cssUnit = 'rem';
  }

  return info;
}

function buildRestorationMd(info) {
  return `# D2C 还原专用规则

> 自动生成于 lg-init --mode d2c · 项目类型: ${info.projectType}

## 1. 样式还原规则

- **颜色**：从 vision JSON 的 visual_style.color_palette + vision-style-map.d2c.json 精确映射
  - 色值偏差约束：ΔE ≤ 5（人眼不可感知）
  - 渐变：起止色 + 方向按 vision JSON 逐参数生成 CSS linear/radial-gradient
- **字体**：字号/字重/行高/字间距严格按 vision JSON 输出
  - 字号偏差：±1px
  - 字重：按 vision JSON 数值（300/400/500/600/700）
- **间距**：padding/margin/gap 按 vision JSON 像素值映射
  - 间距偏差：±2px
- **圆角**：四角独立识别，不统一写成单一 border-radius
- **阴影**：x偏移/y偏移/模糊半径/扩散半径/颜色，逐参数还原
- **边框**：粗细/实线虚线/颜色，逐项还原

## 2. 布局还原规则

- 从 vision JSON 的 layout_zones[] + component_tree{} 映射布局方向
  - 横向并排 → Flex Row
  - 上下垂直 → Flex Column
  - 多列网格 → CSS Grid
  - 居中弹窗 → Flex 居中定位
- 不允许全部 absolute 定位（保证自适应）
- 响应式单位按项目 page-development.md 规定
- z-index 层级关系按 vision JSON 的 component_tree 嵌套深度推导

## 3. 质量门禁（分级指标）

| 指标 | 阈值 | 判定 |
|------|------|------|
| 布局结构（flex方向、嵌套层级） | 100% 匹配 | 不通过则直接失败 |
| 尺寸（宽高） | ±2px | 超标标记 |
| 颜色（文字/背景/边框） | ΔE ≤ 5 | 超标标记 |
| 间距（padding/margin/gap） | ±2px | 超标标记 |
| 字体（字号/字重） | ±1px | 超标标记 |
| 图标/圆角/阴影 | 有则通过 | 缺失即超标 |

全绿 → ✅ 自动通过。有黄 → 自动修复。有红 → ⚠️ 差异报告转人工。

## 4. 迭代修复规则

最多 3 轮自动修复：
1. 差异热力图 + 超标指标 → Claude 分析差异
2. 调整对应样式参数 → 重新生成代码 → 重新渲染 → 重新对比
3. 3 轮后仍不达标 → 输出差异热力图 + 各维度得分 → 人工确认

## 5. 禁止事项

- ❌ 不允许使用管理后台组件库（SearchCard / TableCard / PageContainer / a-table / a-form 等 Ant Design 组件）
- ❌ 不允许简化设计稿的视觉效果（"差不多就行"）
- ❌ 不允许在未标注差异的情况下修改样式参数
- ❌ 跨框架代码不能混用框架特定语法（uni-app 页面不能用 HTML div，Web 页面不能用 wd-* 组件）
- ❌ 禁止 bash heredoc 批量生成 .vue 文件
- ❌ 禁止 sed 批量修改 .vue 文件
- ❌ 禁止用 ; 拼接多行 JavaScript 语句
`;
}

function buildStyleMap(info, claudeMd) {
  const map = {
    description: `${info.projectType} 项目 — vision 自然语言样式 → 精确值映射`,
    color_map: {},
    typography_map: {},
    spacing_map: {},
    component_map: {}
  };

  // 从 CLAUDE.md 提取主题色
  const colorPatterns = [
    // 色值在前，关键词在后: "#1890ff 背景"
    ...claudeMd.matchAll(/((?:#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})\b).*?(?:色|color|主题|primary|背景|background)/gi),
    // 关键词在前，色值在后: "主色: #1890ff" / "主题色 #FF6684"
    ...claudeMd.matchAll(/(?:色|color|主题|primary|背景|background).*?((?:#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3})\b)/gi)
  ];
  for (const match of colorPatterns) {
    const color = match[1];
    if (color) map.color_map[color] = color;
  }

  // 从 CLAUDE.md 提取字号
  const fontSizePatterns = [
    // 值在前，关键词在后: "14px 字号"
    ...claudeMd.matchAll(/(\d+(?:rpx|px)).*?(?:字号|字体|font|标题|正文|辅助)/gi),
    // 关键词在前，值在后: "字号: 14px"
    ...claudeMd.matchAll(/(?:字号|字体|font|标题|正文|辅助).*?(\d+(?:rpx|px))/gi)
  ];
  for (const match of fontSizePatterns) {
    const size = match[1];
    if (size) map.typography_map[size] = { fontSize: size };
  }

  // 默认填充（项目 CLAUDE.md 中无法提取时使用）
  if (Object.keys(map.color_map).length === 0) {
    map.color_map = {
      "主色": "从 CLAUDE.md 未检测到，请手动填写",
      "背景色": "从 CLAUDE.md 未检测到，请手动填写"
    };
  }

  return map;
}

function buildPageDevelopmentMd(info, claudeMd) {
  const frameworks = {
    'uni-app': `# ${info.projectType} — 页面开发规范

> 基于 uni-app 框架的跨平台项目，Vue 3 + TypeScript + Pinia + UnoCSS。
> 开发规范以项目 CLAUDE.md 和已有页面为参考基准。

## 一、项目架构总览

### 技术栈
| 类别 | 技术选型 |
|------|---------|
| 框架 | uni-app v3 (Vue 3 Composition API) |
| 语言 | TypeScript |
| CSS 方案 | UnoCSS 原子类 + SCSS（scoped），单位优先 rpx |
| 构建工具 | Vite |

### 目录约定
\`\`\`
src/
├── api/            # API 模块
├── components/     # 公共组件
├── constants/      # SmartEnum 常量
├── pages/          # 主包页面
├── pages-sub/      # 分包页面
├── store/          # Pinia stores
├── style/          # 全局 SCSS
├── types/          # 类型声明
└── utils/          # 工具函数
\`\`\`

## 二、页面文件结构

\`\`\`vue
<route lang="json5" type="page">
{
  layout: 'default',
  style: {
    navigationBarTitleText: '页面标题',
  },
}
</route>

<template>
  <Page v-bind="pageConfig">
    <!-- 页面内容 -->
  </Page>
</template>

<script lang="ts" setup>
// imports...
</script>

<style lang="scss" scoped>
// scoped SCSS...
</style>
\`\`\`

## 三、CSS / 样式规范

### 原子类优先
优先使用 UnoCSS 原子类。

### BEM 命名规范
自定义 CSS 类名遵循 BEM (Block Element Modifier)：
- Block: 独立 UI 实体，如 \`.step-card\`
- Element: Block 的子部分，用 \`__\`，如 \`.step-card__header\`
- Modifier: 变体/状态，用 \`--\`，如 \`.step-card--active\`

### 单位
优先 rpx。

---

> ⚠️ 此文件为模板，请根据项目实际情况补充：组件速查表、工具函数列表、列表页/表单页标准模式等。
> 参考: gce-app 项目的 .claude/prompts/page-development.md`,

    'vue3': `# ${info.projectType} — 页面开发规范

> Vue 3 Composition API + scoped CSS。
> 请根据项目实际情况补充完整规范。

## 页面文件结构

\`\`\`vue
<template>
  <div class="page-container">
    <!-- 页面内容 -->
  </div>
</template>

<script setup>
// imports...
</script>

<style scoped>
/* scoped styles */
</style>
\`\`\`

> ⚠️ 此文件为模板，请补充项目特定规范。`,

    'html': `# ${info.projectType} — 页面开发规范

> 纯 HTML/CSS/JS 项目。
> 请根据项目实际情况补充完整规范。

## 文件结构

\`\`\`
project/
├── index.html
├── css/
├── js/
└── assets/
\`\`\`

> ⚠️ 此文件为模板，请补充项目特定规范。`
  };

  return frameworks[info.framework] || frameworks['html'];
}

function main() {
  const claudeMd = readIfExists('CLAUDE.md') || '';

  // 提取项目技术栈
  const info = detectProjectInfo(claudeMd);

  ensureDir('.claude/prompts');
  ensureDir('.claude/config');

  // 生成 d2c-restoration.md（跳过已存在）
  const restorationPath = resolve(CWD, '.claude/prompts/d2c-restoration.md');
  if (existsSync(restorationPath)) {
    console.log('⏭️ d2c-restoration.md 已存在，跳过');
  } else {
    writeFileSync(restorationPath, buildRestorationMd(info), 'utf-8');
  }

  // 生成 vision-style-map.d2c.json（跳过已存在）
  const styleMapPath = resolve(CWD, '.claude/config/vision-style-map.d2c.json');
  if (existsSync(styleMapPath)) {
    console.log('⏭️  vision-style-map.d2c.json 已存在，跳过');
  } else {
    writeFileSync(
      styleMapPath,
      JSON.stringify(buildStyleMap(info, claudeMd), null, 2),
      'utf-8'
    );
    console.log('   .claude/config/vision-style-map.d2c.json');
  }

  // 生成 page-development.md（如不存在）
  const pageDevPath = resolve(CWD, '.claude/prompts/page-development.md');
  if (!existsSync(pageDevPath)) {
    writeFileSync(pageDevPath, buildPageDevelopmentMd(info, claudeMd), 'utf-8');
    console.log('   .claude/prompts/page-development.md  ⚠️ 请手动补充项目代码规范');
  } else {
    console.log('⏭️  page-development.md 已存在，跳过');
  }

  console.log('✅ D2C 规范文件已生成');
  console.log('   .claude/prompts/d2c-restoration.md');
}

main();
