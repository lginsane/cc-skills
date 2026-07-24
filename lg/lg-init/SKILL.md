---
name: lg-init
description: 初始化项目配置、墨刀连接、冒烟配置、组件映射、API配置、开发规范
---

# /lg-init

一键初始化前端工程化环境。

## 命令

```
/lg-init                  → 交互式提问选择类型
/lg-init --mode admin     → 管理后台（3份规范：vue-development-standards.md + constants-usage-standards.md + api-generator-from-swagger.md）
/lg-init --mode d2c       → D2C（3份文件：page-development.md + d2c-restoration.md + vision-style-map.d2c.json）
/lg-init update           → 增量更新，保持现有行为
```

## update 模式

已初始化过项目、但 lg-init 后续版本新增了配置字段时使用。

**规则：**

1. 读取已有配置文件，保留所有已有值
2. 对比完整字段清单，找出缺失字段
3. 只对缺失字段使用默认值写入
4. 已存在字段不做修改
5. 输出：「更新了 X 个新配置项：...」

---

## 管理的配置文件

| 文件                                    | 用途                        |
| --------------------------------------- | --------------------------- |
| `.claude/config/lg-config.json`         | 主配置（墨刀 + 目录 + API） |
| `.claude/config/lg-smoke.json`          | 冒烟测试配置                |
| `.claude/config/lg-components-map.json` | 组件映射表                  |

---

## 流程

### 1. 主配置 (`lg-config.json`)

合并了原 lg-schedule + lg-api。不存在则直接创建。update 时对比字段清单补全：

```json
{
  "version": "",
  "modao_url": "",
  "modao_password": "",
  "dashscope_api_key": "",
  "swagger_url": "",
  "api_dir": "./src/api/",
  "screenshots_dir": "./.lg-docs/screenshots/",
  "schedule_dir": "./.lg-docs/schedule/",
  "catalog_dir": "./.lg-docs/catalog/",
  "vision_dir": "./.lg-docs/vision/",
  "analysis_dir": "./.lg-docs/analysis/",
  "smoke_cases_dir": "./.lg-docs/smoke/"
}
```

创建后提示手动填写 4 个字段：`modao_url`、`modao_password`、`dashscope_api_key`、`swagger_url`。其余已用默认值。

### 1.5. 项目类型检测

当用户传入 `--mode` 参数时直接使用指定模式。不传时根据项目特征自动推断：

| 检测特征 | 判定 |
|---------|------|
| `CLAUDE.md` 包含 `ant-design-vue` 或 `SmartAdmin` | Admin |
| `CLAUDE.md` 包含 `@dcloudio/uni-app` 或 `uniapp` | D2C（uni-app） |
| `CLAUDE.md` 包含 `vue` 但无上述特征 | D2C（Web/H5） |
| `CLAUDE.md` 不存在 | 询问用户选择 |

推断结果输出提示：
"检测到项目类型：{类型}
 将生成：{文件列表}
 是否正确？"
用户确认后继续。

### 2. 冒烟配置 (`lg-smoke.json`)

默认使用云效。不存在则直接创建完整模板，提示用户填写云效 ID。

```json
{
  "version": "1.0.0",
  "platform": {
    "current": "管理端",
    "available": ["达人端", "商家端", "管理端", "公共"]
  },
  "sources": {
    "local": {
      "enabled": false,
      "paths": [".lg-docs/smoke/"],
      "formats": ["md", "json", "xlsx"]
    },
    "yunxiao": {
      "enabled": true,
      "organizationId": "",
      "spaceId": "",
      "versionId": "",
      "userId": "",
      "bugs": {
        "skipStatuses": ["已关闭", "无法复现", "重复", "延期处理", "不予修复"]
      },
      "testPlan": {
        "mode": "namePattern",
        "namePattern": "{version}版本前端冒烟用例",
        "fallbackToClassification": true
      },
      "skipStatuses": ["暂缓", "已废弃", "重复"],
      "displayFields": [
        "id",
        "title",
        "priority",
        "status",
        "platform",
        "precondition",
        "expected"
      ]
    }
  },
  "priority": {
    "P0": { "label": "核心流程", "passRate": 100 },
    "P1": { "label": "重要流程", "passRate": 80 },
    "P2": { "label": "边缘场景", "passRate": 50 }
  },
  "autoFix": {
    "enabled": true,
    "fixableChecks": [
      "missing-empty-state",
      "missing-error-message",
      "hardcoded-status-value",
      "missing-guard-clause",
      "missing-loading-state",
      "missing-permission-meta"
    ],
    "requireConfirmationFor": [
      "api-signature-change",
      "business-logic-change",
      "route-restructure"
    ]
  },
  "output": {
    "reportDir": ".claude/reports/smoke/",
    "format": "markdown",
    "keepHistory": true
  }
}
```

创建后提示手动填写：`yunxiao.organizationId`、`yunxiao.spaceId`、`yunxiao.versionId`、`yunxiao.userId`。
可通过 `get_current_user()` 获取当前用户的 userId。
其余已用合理默认值。

### 3. 组件映射 (`lg-components-map.json`)

**init 模式：** 先创建空模板，然后自动扫描 `src/components/` 目录，读取每个组件的 index.vue，提取 props/emits/description，按路径自动归类。

扫描规则：

- `src/components/common/` 或根级组件 → `public.通用组件`
- `src/components/framework/` → `public.Framework组件`
- `src/components/page/` → `public.页面布局组件`
- `src/components/support/` → `public.Support支撑组件`
- `src/components/system/` → `business.系统管理模块`
- `src/components/business/{module}/` → `business` 下对应模块（如无则新建分类）
- `src/components/business/oa/` → `business.OA业务模块`
- `src/components/business/plan/` → `business.Plan方案模块`
- `src/components/business/platform-workorder/` → `business.工单模块`

每个组件注册格式：

```json
{
  "ComponentName": {
    "path": "@/components/xxx/index.vue",
    "description": "从组件注释或 name 推断",
    "module": "所属模块名",
    "lastVerified": "<today>"
  }
}
```

扫描后更新 `stats.total`、`stats.public`、`stats.business` 计数。

**update 模式：** 对比 `src/components/` 目录，增量添加新组件，标记已删除组件为 `"removed": true`。

### 4. README 更新

检查 `README.md`。如果缺少 lg-\* 工具说明章节，补充完整的命令列表和配置文件说明。update 模式下增量更新新增命令。

### 4. CLAUDE.md 项目文档

检查项目 `CLAUDE.md`，不存在则创建，存在则在 update 模式下增量更新。

**内容（纯项目技术文档，不含 lg-\* skill 使用方法）：**

- 项目概述、技术栈、开发命令
- 路径别名 `/@/` → `src/`
- 目录结构（自动扫描 `src/api/`、`src/views/`、`src/components/`）
- HTTP 请求规范（axios 封装、SM4 加密）
- 枚举系统（smart-enums-plugin）
- 权限系统（v-privilege）
- 路由（hash mode + 动态注册）

**update 模式：** 重新扫描 `src/`，更新 API 模块列表和组件列表，保留手动添加的章节。

### 5. 开发规范

确认以下文件存在：

- `.claude/prompts/vue-development-standards.md`
- `.claude/prompts/constants-usage-standards.md`
- `.claude/prompts/api-generator-from-swagger.md`

### 5.5. D2C 开发规范（--mode d2c 时执行）

当项目类型为 D2C 时，执行以下初始化：

1. 运行 d2c-init.mjs 生成规范文件：
   ```bash
   node ~/.claude/skills/lg-scripts/d2c-init.mjs
   ```

2. 生成的文件：
   - `.claude/prompts/page-development.md` — 项目页面开发规范
     - 如项目已有则跳过
     - 如不存在则创建模板，提示用户填写项目特定内容
   - `.claude/prompts/d2c-restoration.md` — 还原专用规则（自动生成，无需手动填写）
   - `.claude/config/vision-style-map.d2c.json` — 样式映射表（自动从 CLAUDE.md 提取，提示用户补全）

3. 检测 page-development.md 是否已存在：
   - 存在 → 跳过生成
   - 不存在 → 创建模板文件

4. 输出确认信息：
   ```
   ✅ D2C 规范文件就绪

   📋 生成文件:
     .claude/prompts/page-development.md        ← 请手动填写项目代码规范
     .claude/prompts/d2c-restoration.md         ✅ 已自动生成
     .claude/config/vision-style-map.d2c.json  ⚠️ 已从 CLAUDE.md 提取，请检查补全
   ```

### 6. 开发环境检查

- `src/constants/` — 常量模块
- `src/api/` — API 模块
- `src/router/` — 路由配置
- `npm run new` — Plop 脚手架

### 7. 输出清单

```
✅ lg-* 工程化环境就绪

📋 配置:
  lg-config.json           ✅ (手动填写鉴权字段 + swagger_url)
  lg-smoke.json            ✅
  lg-components-map.json   ✅

🔧 命令:
  /lg-catalog     /lg-extract     /lg-vision     /lg-analyze
  /lg-create-smoke  /lg-smoke     /lg-code       /lg-review
  /lg-api-code
```
