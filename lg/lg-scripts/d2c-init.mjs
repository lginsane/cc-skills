#!/usr/bin/env node
// .claude/skills/lg-scripts/d2c-init.mjs
// D2C 项目初始化：生成 page-development.md + d2c-restoration.md + vision-style-map.d2c.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

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

export function buildRestorationMd(info) {
  return `# D2C 还原专用规则

> 自动生成于 lg-init --mode d2c · 项目类型: ${info.projectType} · 数据源版本: v2 (MasterGo DSL)

## 0. 数据源

| 通道 | 数据源 | 精度 |
|------|--------|------|
| 主通道 | MasterGo DSL——lg-code 经 MCP \`mcp__getDesignSections\` 实时获取（全量 section）；lg-dsl 预组装 \`raw-dsl.json\` 供 S2 图片提取 / S3 组件拆解 | 精确值（0 偏差） |
| 回退通道 | lg-vision 识图 + vision-style-map.d2c.json | 模糊描述需映射 |

**取数纪律（MANDATORY，详见 lg-code/SKILL.md D2C Phase 1）：**
- **全量取数**：section 列表中每一个 section 均取 DSL（页头/侧栏/页脚/弹层均为 payload）
- **显式豁免**仅限：scrollbar/滚动条、分隔线、纯背景装饰层（无文本/图片/PATH 且 name 含"背景/装饰"）；豁免必须输出清单
- **取数门禁**：已取 section 数 = \`totalSections - 豁免数\`，缺 section 禁止编码
- **注入闭环**：SVG 走 \`applyDesign\` 的 \`@@SVG:shortKey@@\`、长文本走 \`T{sec}|{nodeId}\`；交付前跑 \`dsl-placeholder-check.mjs\` 扫描残留，命中即禁止交付

## 1. 单位换算规则（物理像素 → 项目单位）

DSL 所有精确值均为**物理像素**（设计稿画布宽度 \`designWidth\`，取自 section-index.json 的 \`rootMetadata.width\`）。换算规则：

| 项目 cssUnit | 换算公式 | 说明 |
|------|----------|------|
| \`rpx\`（uni-app 小程序） | \`rpx = DSLpx × 750 / designWidth\` | 以 750 设计稿为标准；designWidth 与 750 不一致时必须换算 |
| \`rem\`（Vue3 H5） | \`rem = DSLpx / designWidth × rootFontSize\` | rootFontSize 取项目根字号（默认 16px） |
| \`px\`（Web/管理后台） | 直接使用 DSLpx | 仅当设计稿已按目标视口宽度绘制 |

**换算执行细则：**
- 所有 DSL 精确值（字号/间距/圆角/宽高/坐标）**必须换算后落码**，禁止直接写物理像素
- 换算结果保留 2 位小数；整屏宽类（100% 布局）不换算，直接 100%
- \`0.5\` 边界：半像素按"四舍五入到偶数"处理，避免 0.5rpx 渲染模糊
- 设计稿宽度与运行视口宽度一致（1:1）时可免换算，但需在 HARD GATE 清单注明

## 2. 样式还原规则（主通道 DSL 精确值）

- **颜色**：直接取 DSL 精确 hex/渐变（\`paint_*\`）→ 偏差要求 0
- **字体**：直接取精确字号（换算后）/字重/行高
- **间距**：直接取精确 padding/margin/gap（换算后）
- **圆角**：四角独立取精确值
- **阴影/边框**：逐参数精确（❌ 禁止"常见模式"替代）
- **回退通道**：vision JSON + vision-style-map.d2c.json，沿用 ΔE≤5 / ±2px / ±1px

## 3. 布局还原规则

- 从 DSL 各 section 的坐标/容器（x/y/width/height、Auto Layout 关系）判断布局方向：
  - 横向并排 → Flex Row
  - 上下垂直 → Flex Column
  - 多列网格 → CSS Grid
  - 居中弹窗 → Flex 居中定位
- 不允许全部 absolute 定位（保证自适应）；坐标决定结构，禁止凭直觉挪动元素位置
- 布局结构（行/列/包含关系）**不因响应式而改变**

## 4. 资源引用规则

- **PNG**：由 lg-dsl 的 \`image-manifest.mjs\`（S2）**预先提取**——语义化命名（节点名→就近文本→祖先容器→section名→image，禁止裸用 hash）+ URL/sha256 双重去重，产出 \`image-manifest.json\` → lg-code 按 manifest 的 \`localPath\` 引用 \`src/assets/\`；**禁止直接 curl DSL 远端 URL**；\`failedAssets\` 编码前必须处理（占位 or 人工补图）
- **SVG 图标**：PATH 节点经 \`applyDesign\` 的 \`@@SVG:shortKey@@\` 注入 → 直接内联 \`<svg>\` 或封装图标组件；**禁止手写 \`<path>\`**
- **长文本**：经 \`applyDesign\` 的 \`T{sec}|{nodeId}\` 注入 → 使用注入后的完整文案，禁止截断/改写
- object-fit：缩略图 cover，头像 contain（禁止 <img> 不设 object-fit）

## 5. 主题 token 映射

- 颜色优先匹配项目 \`custom-variables.ts\` token：\`match=exact\` 用 token 引用；\`match=pending\` 硬编码 DSL 精确值并登记待新增
- 字号/间距/圆角换算后优先用项目 token/变量；无对应 token 时用换算后的精确值并登记
- 渐变优先用项目 token（如 colorPrimaryGradient），其次 DSL 精确 fill 值
- 后续 UI 标准调整 → 改 src/theme/custom-variables.ts 一处，重新生成跟随

## 6. 质量门禁（三档验收标准）

| 档位 | 字段 | 标准 |
|------|------|------|
| 🔴 硬约束（不可妥协） | 布局结构（行/列/包含关系）、表格列头列数、文案、状态标签文字+颜色、交互入口 | **结构一致**——错一个结构即还原失败 |
| 🟡 软约束（允许 ≤2px） | 间距、圆角、边距、图标位置（换算后） | 视觉一致，误差 ≤2px，可因响应式合理取舍 |
| 🟢 工程豁免（允许降级/替换） | 渐变/阴影/模糊精确值、DSL 无数据的设计意图 | 用项目 token/组件库等价表达，**记录降级清单**，禁止静默丢失 |

- 🔴 未过 → 不交付；🟡 超标 → 标记并修正；🟢 豁免项若未记录降级清单 → 视为未完成
- 交付前必须输出：逐 section 对照汇总 + 取数完整性 + 占位符扫描 + 降级清单

### 6.1 迭代修复规则

1. 对照《需求/还原实现清单》逐条核验（交互 ✓/✗、文案 ✓/✗、校验 ✓/✗、状态 ✓/✗、单位换算 ✓/✗、样式精确值 ✓/✗）
2. 存在 ✗ → 回到对应 section 修正后重新自检，最多 3 轮
3. 3 轮后仍不达标 → 输出差异清单 + 各维度得分 → 人工确认

> 若项目后续接入 d2c-render（渲染） + d2c-compare（像素对比），可在本文件补充像素 diff 阈值；当前未接入，以对照清单核验为主。

## 7. 组件使用与禁止事项

### 组件使用规则（允许复用，但必须还原精确）

- ✅ **允许复用项目已定制化的管理后台组件**（SearchCard / TableCard / PageContainer 等）——项目组件库已按设计稿定制过，其默认样式即符合设计稿时可直接使用
- ✅ **Ant Design Vue 组件（a-table / a-form / a-select / a-tag 等）可复用**；样式与设计稿不一致时，优先**二次封装或样式覆盖（:deep / less 变量 / token）**使其精确匹配设计稿（hover 菜单、自定义列、状态标签颜色等），禁止裸用导致还原度下降
- ✅ **组件样式与设计稿不符 → 修改 ant-design-vue 组件或基于组件库二次封装符合设计稿的组件**，而非弃用组件自写一套
- ❌ 禁止因使用封装组件而**丢失设计稿的精确交互/样式**：
  - 用 a-table 默认 hover/行样式替代设计稿的行尾"..."扩展菜单
  - 用 a-tag 默认色替代设计稿状态标签精确色（如 #1890FF / #FFA64D）
  - 用表单组件默认间距替代设计稿精确 padding/gap
  - 复用组件时掩盖了 MCP 实时 DSL 的精确值（坐标/圆角/字号/颜色）

### 禁止事项

- ❌ 不允许简化设计稿的视觉效果（"差不多就行"）
- ❌ DSL 数据存在时禁止伪造/猜测样式值（一切以 MCP 实时 DSL 精确值为准）
- ❌ 不允许在未标注差异的情况下修改样式参数
- ❌ 跨框架代码不能混用框架特定语法
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

// 常量使用规范（按 src/constants/ 目录存在与否决定是否生成，与 admin/d2c 模式无关）
export function buildConstantsUsageStandardsMd() {
  return `# 常量/枚举使用规范

> 本文件由 \`/lg-code\`、\`/lg-api-code\` 命令读取，定义项目常量与枚举的定义、注册、引用规范。
> 生成条件：项目存在 \`src/constants/\` 目录（由 lg-init 自动检测），与 admin/d2c 模式无关。
> 项目基于 SmartAdmin 3.0 的 SmartEnum 枚举系统 + smart-enums-plugin。

## 1. 体系总览

| 概念 | 位置 | 说明 |
|------|------|------|
| 基础枚举 | \`src/enums/*.ts\` | TypeScript \`enum\`，定义底层值（如 \`FlagEnum.YES = 1\`） |
| 常量映射 | \`src/constants/*.ts\` | \`SmartEnum<T>\` 对象，将枚举值映射为 \`{ value, desc }\`，**UI 实际消费** |
| 类型定义 | \`src/types/smart-enum.d.ts\` | \`SmartEnum<T> / SmartEnumItem<T> / SmartEnumPlugin\` 接口 |
| 插件 | \`src/plugins/smart-enums-plugin.ts\` | 注册到全局 \`$smartEnumPlugin\` |
| 常量入口 | \`src/constants/index.ts\` | 汇总所有常量并导出 |
| 枚举入口 | \`src/enums/index.ts\` | \`export *\` 汇总所有枚举 |

## 2. 目录规范

\`\`\`
src/
├── enums/                 # 基础 TypeScript enum（底层值定义）
│   ├── common-enum.ts     # 通用枚举（是否/性别/尺寸等）
│   └── file-folder-type-enum.ts
├── constants/             # SmartEnum 常量映射（UI 消费层）
│   ├── index.ts           # 统一入口，汇总导出
│   ├── common-const.ts    # 通用常量（分页、路径、GENDER_ENUM 等）
│   ├── layout-const.ts    # 布局枚举（LAYOUT_ENUM 等）
│   ├── business/          # 业务模块常量（如 merchant-const.ts）
│   ├── system/            # 系统常量（如 home-const.ts）
│   └── support/           # 支撑常量（file-const / support-const）
└── types/
    └── smart-enum.d.ts    # SmartEnum 类型声明
\`\`\`

## 3. 定义规范

### 3.1 基础枚举（\`src/enums/\`）

用 TypeScript \`enum\` 定义底层值，值可为 number 或 string：

\`\`\`ts
// src/enums/common-enum.ts
export enum FlagEnum {
  NO = 0, // 否
  YES = 1, // 是
}

export enum UploadTypeEnum {
  Material = 'material',
  Local = 'local',
}
\`\`\`

- 每个枚举项必须带 \`// 注释\` 描述含义
- 值：number 或 string 均可，同枚举内保持一致风格
- 汇总到 \`src/enums/index.ts\`：\`export * from './xxx-enum'\`

### 3.2 常量映射（\`src/constants/\`）

用 \`SmartEnum<T>\` 将枚举值映射为 \`{ value, desc }\`：

\`\`\`ts
// src/constants/common-const.ts
import { FlagEnum } from '../enums';
import { SmartEnum } from '/@/types/smart-enum';

export const FLAG_NUMBER_ENUM: SmartEnum<FlagEnum> = {
  TRUE: {
    value: FlagEnum.YES,
    desc: '是',
  },
  FALSE: {
    value: FlagEnum.NO,
    desc: '否',
  },
};
\`\`\`

**业务模块常量**（关联 API 生成的枚举，供 lg-api-code 使用）：

\`\`\`ts
// src/constants/business/merchant-const.ts
import { SmartEnum } from '/@/types/smart-enum';
import { MerchantRoleEnum } from '/@/api/business/merchant/enums';

/** 商家角色 */
export const MERCHANT_ROLE_ENUM: SmartEnum<MerchantRoleEnum> = {
  TALENT: { value: MerchantRoleEnum.TALENT, desc: '达人' },
  MERCHANT: { value: MerchantRoleEnum.MERCHANT, desc: '商家' },
};
\`\`\`

**命名规则（MANDATORY）：**

| 项 | 规则 | 示例 |
|----|------|------|
| 常量名 | 大写蛇形，\`枚举语义\` + \`_ENUM\` 后缀 | \`GENDER_ENUM\`、\`FLAG_NUMBER_ENUM\` |
| key | 枚举项语义全大写 | \`TRUE\`、\`FALSE\`、\`TALENT\` |
| value | 引用基础枚举值或 API 枚举值 | \`FlagEnum.YES\`、\`MerchantRoleEnum.TALENT\` |
| desc | 中文描述，**禁止英文占位** | \`'是'\`、\`'达人'\` |

## 4. 注册规范（MANDATORY）

新常量必须加入 \`src/constants/index.ts\`，否则 \`$smartEnumPlugin\` 无法访问：

\`\`\`ts
// src/constants/index.ts
import { FLAG_NUMBER_ENUM, GENDER_ENUM, USER_TYPE_ENUM } from './common-const';
import { LAYOUT_ENUM } from './layout-const';
import { MERCHANT_ROLE_ENUM, MERCHANT_SMS_TYPE_ENUM } from './business/merchant-const';

export default {
  FLAG_NUMBER_ENUM,
  GENDER_ENUM,
  USER_TYPE_ENUM,
  LAYOUT_ENUM,
  MERCHANT_ROLE_ENUM,
  MERCHANT_SMS_TYPE_ENUM,
};
\`\`\`

> 插件在 \`main.ts\` 以 \`app.use(smartEnumsPlugin, smartEnumWrapper)\` 注册，\`smartEnumWrapper\` 即此默认导出的对象。

## 5. 引用规范（CRITICAL）

**生成代码时：禁止魔法值（magic number/string），必须引用常量。**

### 5.1 模板中（显示描述 / 条件渲染）

\`\`\`html
<!-- ❌ 魔法值 -->
<a-tag v-if="status === 1">Active</a-tag>
<a-tag :color="status === 1 ? 'green' : 'gray'">{{ status === 1 ? '是' : '否' }}</a-tag>

<!-- ✅ 引用常量 -->
<a-tag v-if="status === FLAG_NUMBER_ENUM.TRUE.value">{{ FLAG_NUMBER_ENUM.TRUE.desc }}</a-tag>
\`\`\`

### 5.2 script 中（条件判断）

\`\`\`ts
// ❌
if (order.status === 0) { ... }

// ✅
if (order.status === FLAG_NUMBER_ENUM.TRUE.value) { ... }
\`\`\`

### 5.3 通过 \`$smartEnumPlugin\` 编程式访问

\`\`\`ts
// 值 → 描述
$smartEnumPlugin.getDescByValue('GENDER_ENUM', value); // → '男'

// 获取全部枚举项
$smartEnumPlugin.getValueDescList('GENDER_ENUM'); // → [{ value, desc }, ...]

// 获取 {value: desc} 键值对
$smartEnumPlugin.getValueDesc('GENDER_ENUM'); // → { '0': '不限', '1': '男', '2': '女' }

// 获取单个枚举项对象
$smartEnumPlugin.getObjectByValue('FLAG_NUMBER_ENUM', 1); // → { value: 1, desc: '是' }
\`\`\`

### 5.4 枚举下拉/单选/复选组件（推荐）

用框架组件绑定 \`enumName\`，无需手动遍历：

\`\`\`html
<smart-enum-select v-model:value="form.gender" enum-name="GENDER_ENUM" />
<smart-enum-radio v-model:value="form.flag" enum-name="FLAG_NUMBER_ENUM" />
<smart-enum-checkbox v-model:value="form.types" enum-name="DATA_TYPE_ENUM" />
\`\`\`

| 组件 | 用途 | 关键 props |
|------|------|-----------|
| \`smart-enum-select\` | 下拉框 | \`enum-name\`、\`disabled-option\`、\`hidden-option\` |
| \`smart-enum-radio\` | 单选组 | \`enum-name\`、\`hidden-option\` |
| \`smart-enum-checkbox\` | 多选组 | \`enum-name\`、\`hidden-option\` |

> 这些组件通过 \`$smartEnumPlugin.getValueDescList(enumName)\` 获取选项，**必须在 \`src/constants/index.ts\` 注册对应常量**。

## 6. 与 lg-api-code 的联动

lg-api-code 生成 API 代码时，若接口字段是枚举类型：

1. 在 \`src/api/{module}/enums.ts\` 定义基础枚举（与后端 Swagger 枚举对齐）
2. 在 \`src/constants/business/{module}-const.ts\` 定义 \`SmartEnum\` 映射
3. 注册到 \`src/constants/index.ts\`
4. 页面引用 \`{MODULE}_XXX_ENUM.{KEY}.value / .desc\`

示例（\`src/constants/business/merchant-const.ts\` 即 lg-api-code 生成产物）：

\`\`\`ts
/** 商家角色 */
export const MERCHANT_ROLE_ENUM: SmartEnum<MerchantRoleEnum> = {
  TALENT: { value: MerchantRoleEnum.TALENT, desc: '达人' },
  MERCHANT: { value: MerchantRoleEnum.MERCHANT, desc: '商家' },
};
\`\`\`

## 7. 质量自检清单（lg-code 编码后必查）

- [ ] 无魔法值：搜索代码中的 \`=== 1\`、\`=== 'xxx'\` 等裸值 → 改为常量引用
- [ ] 无重复定义：先在 \`src/constants/\` 搜索是否已有相同语义常量
- [ ] 已注册：新增常量已在 \`src/constants/index.ts\` 导出
- [ ] 描述为中文：所有 \`desc\` 为中文，无英文占位符
- [ ] 类型正确：\`SmartEnum<T>\` 的泛型 \`T\` 与基础枚举值类型一致
- [ ] 组件引用：下拉/单选/复选用 \`smart-enum-*\` 组件 + \`enum-name\`，不手写遍历
`;
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
  const args = process.argv.slice(2);
  const force = args.includes('--update') || args.includes('-u');
  const claudeMd = readIfExists('CLAUDE.md') || '';
  const info = detectProjectInfo(claudeMd);

  ensureDir('.claude/prompts');
  ensureDir('.claude/config');

  // 生成 d2c-restoration.md（v2；--update 强制覆盖）
  const restorationPath = resolve(CWD, '.claude/prompts/d2c-restoration.md');
  if (existsSync(restorationPath) && !force) {
    console.log('⏭️ d2c-restoration.md 已存在，跳过（用 --update 强制重生成）');
  } else {
    writeFileSync(restorationPath, buildRestorationMd(info), 'utf-8');
    console.log(force ? '   d2c-restoration.md ✅ 已更新为 v2' : '   .claude/prompts/d2c-restoration.md');
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

  // 生成 constants-usage-standards.md（按 src/constants/ 目录检测，与 admin/d2c 模式无关）
  const hasConstantsDir = existsSync(resolve(CWD, 'src/constants'));
  const constantsPath = resolve(CWD, '.claude/prompts/constants-usage-standards.md');
  if (!hasConstantsDir) {
    console.log('⏭️  constants-usage-standards.md 未生成（项目无 src/constants/ 目录）');
  } else if (existsSync(constantsPath)) {
    console.log('⏭️  constants-usage-standards.md 已存在，跳过');
  } else {
    writeFileSync(constantsPath, buildConstantsUsageStandardsMd(), 'utf-8');
    console.log('   .claude/prompts/constants-usage-standards.md  ✅ 检测到 src/constants/，已生成');
  }

  console.log('✅ D2C 规范文件已生成');
  console.log('   .claude/prompts/d2c-restoration.md');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
