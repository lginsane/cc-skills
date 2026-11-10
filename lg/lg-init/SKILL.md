---
name: lg-init
description: 初始化项目配置、墨刀连接、冒烟配置、组件映射、API配置、开发规范
---

# /lg-init

一键初始化前端工程化环境。

## 命令

```
/lg-init                  → 交互式提问选择类型
/lg-init --mode admin     → 管理后台（5份规范：vue-development-standards.md + constants-usage-standards.md + api-doc-generator.md + commit-standard.md + version-standard.md，后两份按 docs/ 检测生成，见 5.2）
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
  "smoke_cases_dir": "./.lg-docs/smoke/",
  "dsl_dir": "./.lg-docs/dsl/",
  "img_dir": "./src/assets/"
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

#### 1.5.1 原子 CSS 库检测（MANDATORY）

项目类型确定后，检测项目是否使用了原子 CSS 库：

| 检测方法 | 判断标准 |
|---------|---------|
| `package.json` dependencies | 搜索 `unocss`、`tailwindcss`、`windicss`、`@unocss` |
| 配置文件 | 搜索根目录 `uno.config.*`、`tailwind.config.*`、`windi.config.*` |
| CLAUDE.md | 搜索 `UnoCSS`、`Tailwind`、`Windi CSS`、`原子`、`atomic` |

**检测到原子 CSS 库后：**

1. 记录库类型（如 `unocss`）和配置文件路径
2. 在所有后续生成的规范文件中**写入原子 CSS 优先规则**：

   ```
   ## 🔴 样式优先级（MANDATORY — 原子 CSS 优先）

   本项目使用 {库名}（{配置文件}）。编写样式时必须遵循：

   | 优先级 | 方式 | 适用场景 |
   |--------|------|---------|
   | 1️⃣ 原子类 | UnoCSS/Tailwind 原子类写在模板 class 属性 | 所有常规样式：flex、尺寸、间距、颜色、字体、边框、圆角 |
   | 2️⃣ scoped | `<style scoped>` + BEM | **仅**以下场景：<br>• 动态 class 名（运行时拼接，静态扫描不到）<br>• 伪类选择器（`:last-child`、`:nth-child`）<br>• `rgba()` 透明度背景<br>• 复杂动画 `@keyframes` |

   **禁止：** 能用原子类表达的样式写在 `<style scoped>` 中。
   ```

3. 如果 **未检测到** 原子 CSS 库 → 输出提示：
   ```
   ⚠️ 未检测到原子 CSS 库（UnoCSS / Tailwind / Windi）。
   样式将全部使用 scoped CSS + BEM。
   ```

4. 检测结果示例输出：
   ```
   ✅ 检测到原子 CSS 库：UnoCSS（uno.config.ts）
   📋 已将「原子 CSS 优先」规则写入所有规范文件
   ```

#### 1.5.2 Style 隔离方式检测（MANDATORY）

不同项目的样式隔离策略不同，**不能硬编码**。lg-init 必须扫描现有 `.vue` 文件，根据实际代码决定生成什么规范。

**检测方法：**

扫描 `src/` 下所有 `.vue` 文件（采样 ≥20 个，不足则全量），统计 `<style>` 标签写法：

```
对每个 .vue 文件：
  提取 <style ...> 标签的属性
  分类：
    scoped    → <style scoped> 或 <style lang="scss" scoped>
    unscoped  → <style> 或 <style lang="less">（无 scoped 属性）
    module    → <style module>
    none      → 该文件没有 <style> 标签

统计比例：
  scoped_ratio    = scoped / (scoped + unscoped)
  unscoped_ratio  = unscoped / (scoped + unscoped)
```

**判定规则：**

| 条件 | 判定 | 对应的规范 |
|------|------|-----------|
| `scoped_ratio ≥ 0.8` | **scoped 隔离** | `<style lang="xxx" scoped>` + `:deep()` 穿透 |
| `unscoped_ratio ≥ 0.8` | **BEM 根盒子隔离** | `<style lang="xxx">` + 唯一根元素 `.{page}-page` + BEM 命名自然隔离 |
| `0.4 < ratio < 0.6` | **混合项目** | 取多数，输出 ⚠️ 警告，建议统一 |
| `scoped = 0 && unscoped = 0` | **无样式文件** | 根据框架类型给默认值（uni-app → scoped，admin → 根盒子隔离） |

**写入规范文件：**

检测结果写入 `.claude/prompts/vue-development-standards.md`（admin 模式）或 `.claude/prompts/page-development.md`（D2C 模式）的样式章节：

```
## Style 隔离规范（lg-init 自动检测）

检测结果：{count} 个 .vue 文件中，scoped 占比 {percent}%

→ 采用 **{scoped 隔离 / BEM 根盒子隔离}**

规则：
  ✅ <style lang="{less/scss}" {scoped / }>  ← 根据检测结果决定是否有 scoped
  {scoped 模式：✅ :deep() 穿透覆盖组件库样式}
  {根盒子模式：✅ 唯一根元素盒子（如 .{page}-page）+ BEM 自然隔离}
  ❌ {scoped 模式：不使用无 scoped 的 <style>}
  ❌ {根盒子模式：不使用 <style scoped>，BEM 命名自然隔离不污染}
```

**检测结果示例输出：**

```
🔍 Style 隔离方式检测完成

扫描 45 个 .vue 文件：
  scoped:     43 (95.6%)  ← 采用
  unscoped:    2 (4.4%)
  
→ 采用 scoped 隔离 + :deep() 穿透
📋 已写入 .claude/prompts/page-development.md
```

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

> ⚠️ **为什么必须有关联章节**：`CLAUDE.md` 是 harness 每个会话自动注入的唯一文件；`.claude/prompts/*.md` 和 `.claude/config/lg-components-map.json` **不会自动加载**，此前只有 `/lg-code` 的 "Load Context First" 强制读取它们。导致用户用普通文案直接描述开发任务（不走 /lg-code）时，agent 看不到任何规范入口，开发规范被完全绕过。本节把「规范指针 + 编码前必读义务」写进 CLAUDE.md，使规范对**所有入口**（含纯文案指令）生效。

**内容（项目技术文档 + 开发规范关联章节；不含 lg-\* 命令使用教程，但必须含规范文件指针）：**

- 项目概述、技术栈、开发命令
- 路径别名 `/@/` → `src/`
- 目录结构（自动扫描 `src/api/`、`src/views/`、`src/components/`）
- HTTP 请求规范（axios 封装、SM4 加密）
- 枚举系统（smart-enums-plugin）
- 权限系统（v-privilege）
- 路由（hash mode + 动态注册）
- **开发规范关联章节（MANDATORY，见 4.1，缺失即本步骤未完成）**

#### 4.1 开发规范关联章节（MANDATORY — 生成 CLAUDE.md 时必做）

在 CLAUDE.md 中生成如下章节，用 AUTO 标记包裹以便 update 重写：

````markdown
<!-- AUTO_START:dev-standards-pointers -->
## 📐 开发规范（MANDATORY — 编码前必读）

以下规范文件由 `/lg-init` 维护，是本项目默认开发约定。**任何前端编码任务——无论是否显式调用 `/lg-code`——动手写代码前必须先 Read 下表对应文件**；`/lg-code` 不是规范的唯一注入入口。

| 触发场景 | 必读文件 | 内容 |
|---------|---------|------|
| 编写/修改任何 `.vue` 页面或组件 | `.claude/prompts/vue-development-standards.md` | 目录/组件/样式/校验/命名规范 |
| 涉及业务代码中的状态值、魔法数字/字符串 | `.claude/prompts/constants-usage-standards.md` | 枚举常量注册/引用规范 |
| 新增或修改 API 模块 / types | `.claude/prompts/api-doc-generator.md` | API 模块结构与类型复用规范 |
| 新建任何 UI 元素前（先复用后新建） | `.claude/config/lg-components-map.json` | 已有组件清单 |
| 生成 commit message / 分支 / 发版操作 | `.claude/prompts/commit-standard.md`、`.claude/prompts/version-standard.md` | 提交/版本规范（docs/ 同步版） |

**禁止：** 未读上述规范就直接产出代码；禁止绕过 `lg-components-map.json` 重复造已有组件。
<!-- AUTO_END:dev-standards-pointers -->
````

**生成规则：**

0. **生成时机**：本区块初版随 CLAUDE.md 一起创建；因步骤 5/5.2/5.5 会在其后才生成规范文件，**在流程末尾（步骤 7 输出清单前）必须复核一次**——重新扫描 `.claude/prompts/` + `.claude/config/`，把新生成的规范文件补进表格、删掉未生成的行。update 模式同样执行此复核。
1. **按实际存在的文件动态列行**——扫描 `.claude/prompts/` 与 `.claude/config/`，表中**只保留真实存在的文件行**；不存在的规范（如项目无 `src/constants/` 未生成 constants 规范、docs/ 无提交规范、d2c 模式）对应行**删除**，不得引用不存在的路径。
2. **D2C 模式**（`--mode d2c`）下表替换为：

   | 触发场景 | 必读文件 | 内容 |
   |---------|---------|------|
   | 编写/修改任何页面或组件 | `.claude/prompts/page-development.md` | 页面开发规范（layout/技术栈/样式） |
   | 设计稿还原 / DSL→代码任务 | `.claude/prompts/d2c-restoration.md` | 还原专用规则 |
   | 样式 token 映射 | `.claude/config/vision-style-map.d2c.json` | 样式映射表 |
   | 涉及状态值/魔法值（若有） | `.claude/prompts/constants-usage-standards.md` | 常量规范 |
   | 新建任何 UI 元素前 | `.claude/config/lg-components-map.json` | 已有组件清单 |

3. 若 1.5.1 检测到原子 CSS 库 → 表格下追加一行说明：「样式写法以规范文件中的『原子 CSS 优先』规则为准」。
4. 若某规范文件本应存在但缺失（如 update 时发现 prompts 被误删）→ 输出 `⚠️ CLAUDE.md 引用了 {file}，但该文件不存在，请重跑 /lg-init` 并保留该行（提醒修复），不静默删除。

**update 模式：** 重新扫描 `src/`，更新 API 模块列表和组件列表；同时**重新扫描 `.claude/prompts/` + `.claude/config/` 重建 4.1 表格**（在 AUTO 标记内整体重写该区块，标记外手动添加的章节保留）。若旧版 CLAUDE.md 无此区块（历史生成文件），直接插入后视为 update 的正常产出并输出「已补充开发规范关联章节」。

### 5. 开发规范

> 本节及 5.1/5.2/5.5 产出的所有 prompts 文件，最终都会被 4.1「开发规范关联章节」按实际存在情况登记进 CLAUDE.md——确保纯文案开发指令也强制读规范，不依赖 /lg-code 入口。

确认以下文件存在：

- `.claude/prompts/vue-development-standards.md`
- `.claude/prompts/api-doc-generator.md`

> **constants-usage-standards.md 按目录检测创建（与 admin/d2c 模式无关）：**
> - 检测项目是否存在 `src/constants/` 目录
> - 存在 → 生成 `.claude/prompts/constants-usage-standards.md`（SmartEnum 常量注册/引用规范）
> - 不存在 → 不生成（项目未使用常量系统）
> - admin 与 d2c 模式均可触发，d2c 项目的 `d2c-init.mjs` 同样执行此检测

### 5.1. 类型契约扫描与 API 文档生成（MANDATORY）

> 在 `lg-init` 时扫描项目现有代码，**自动发现并固化类型复用模式**，写入 `api-doc-generator.md`，确保后续所有 `/lg-api-code` 调用自动遵循。

#### 5.1.1 扫描基类池

扫描 `src/types/` 下所有 `.d.ts` / `.ts` 文件，提取所有 `export interface` 和 `export type`：

```
对每个发现的基类：
  记录：名称、字段列表（字段名 + 类型 + 是否可选）、文件路径
```

#### 5.1.2 扫描引用关系

扫描 `src/api/` 下所有 `type.ts` / `types.ts`，提取所有 `extends` / `type X = Y` / `import type` 语句：

```
对每个 import from '@/types/request' 的模块：
  记录：模块路径、引用了哪些基类、引用方式（extends / type alias / 直接作为泛型参数）

统计：每个基类被几个模块引用
```

#### 5.1.3 验证契约有效性

对被 ≥2 个模块引用的基类，与 Swagger 交叉验证：

```
对基类 BasePageParams:
  字段: { pageNum: number, pageSize: number, searchCount?: boolean, sortItemList?: {...}[] }
  
  在 Swagger 中搜索包含这些字段的 requestBody schema：
    AppDispatchRecordReq: { pageNum, pageSize, searchCount, sortItemList } → 字段完全匹配 ✅
    XxxPageReq:           { pageNum, pageSize }                              → 字段子集匹配 ✅
    YyyReq:               { page, size }                                     → 字段名不匹配 ⚠️
  
  验证结果：
    ✅ 精确匹配 ≥2 个 Swagger schema → 确认为"通用契约"，写入规范，强制复用
    ⚠️ 部分匹配 → 标记为"待确认"，生成带条件的复用规则（仅字段匹配时可复用）
    ❌ 不匹配 → 不生成复用规则
```

#### 5.1.4 验证规则

| 条件 | 结果 |
|------|------|
| 基类字段 ⊆ Swagger schema 字段（字段名、类型、可选性一致） | ✅ 可复用 |
| 基类字段名相同但类型不同（如 `pageNum: number` vs `pageNum: string`） | ❌ 不可复用，报告类型冲突 |
| 基类缺少 Swagger 定义的字段 | ⚠️ 可复用但需 extends 补充 |
| 基类多了 Swagger 未定义的字段 | ⚠️ 可复用（多余字段可选/不影响） |

#### 5.1.5 写入 api-doc-generator.md

在 `api-doc-generator.md` 的 `types.ts 模板` 后追加自动生成的复用规则块：

```markdown
## 🔴 类型复用强制规则（自动生成于 lg-init，禁止手动删除）

> 以下规则基于项目现有代码 + Swagger 交叉验证自动提取。生成 types.ts 时必须遵循。

### 分页入参

**基类：** `BasePageParams`（`@/types/request`）
**已验证匹配 ≥2 个 Swagger schema：** AppDispatchRecordReq, …

| 场景 | 写法 |
|------|------|
| 无额外字段 | `type XxxParams = BasePageParams` |
| 有额外字段 | `interface XxxParams extends BasePageParams { ... }` |

### 分页出参

**基类：** `PageResponse<T>`（`@/types/request`）
**已验证匹配 ≥2 个 Swagger schema：** PageResultAppDispatchRecordVo, …

| 场景 | 写法 |
|------|------|
| 标准分页 | `type XxxResponse = PageResponse<XxxVo>` |
| 有额外字段 | `interface XxxResponse extends PageResponse<XxxVo> { pages, emptyFlag?, statistics? }` |

### 检查清单

- [ ] 搜索 types.ts 中是否有 `pageNum: number` + `pageSize: number` → 改为继承 BasePageParams
- [ ] 搜索 types.ts 中是否有 `list: T[]` + `total: number` → 改为继承 PageResponse<T>
- [ ] import 添加 `import type { BasePageParams, PageResponse } from '@/types/request'`
```

> 如果有其他被 ≥2 模块引用的基类（如 `BaseResponse`、业务级共享 Vo），同样按此模板自动追加相应的复用规则块。

#### 5.1.6 init 完成后输出

```
🔍 类型契约扫描完成

发现 2 个通用基类：
  BasePageParams   ← 3 个模块引用（complaint, task, message），✅ Swagger 验证通过
  PageResponse<T>  ← 3 个模块引用（complaint, task, message），✅ Swagger 验证通过

📋 已将复用规则写入 .claude/prompts/api-doc-generator.md
```

### 5.2 提交/版本规范同步（按 docs/ 检测生成，与 admin/d2c 模式无关）

> 团队权威规范通常维护在仓库 `docs/`（面向人，且与 `commitlint.config.cjs` 等工程文件逐字对应）。lg-init 将其同步为 `.claude/prompts/` 下的 AI 注入版，使 `/lg-code`、辅助提交、发版操作时自动遵循。

**检测与同步规则：**

| 源文件（`docs/`） | 同步目标（`.claude/prompts/`） | 注入时机 |
|-------------------|-------------------------------|---------|
| `commit-standard.md`（type/scope 枚举、header 限制、钩子机制） | `commit-standard.md` | 生成 commit message、拆分/整理提交、执行提交操作 |
| `version-standard.md`（分支模型、SemVer 推导、发版 SOP、CHANGELOG） | `version-standard.md` | 分支/MR 操作、版本号与 tag、`pnpm release*` 发版 |

1. **源存在** → 同步生成：文件头部加注入头（声明 docs 为唯一权威源 + 同步日期 + 手改会被覆盖），正文与 docs **逐字一致**，禁止删减或改写内容
2. **源不存在** → 跳过该项，输出 `⏭️ 未检测到 docs/xxx.md，不生成对应注入版`（不凭空创建空规范）
3. **update 模式** → 剥离注入头后对比正文与 docs 内容：不一致 → 重新同步并输出「已同步 N 份规范文件」；一致 → 跳过
4. **禁止反向修改**：需更新规范时改 `docs/` 版再跑 `/lg-init update`；prompts 下的副本是衍生物，不直接编辑

**注入头模板（正文之前）：**

```markdown
> 🤖 **本文件为 `/lg-init` AI 注入版**，正文与 `docs/{name}.md` 逐字同步（同步于 {date}）。
> **注入时机**：{注入时机}。
> ⚠️ **docs 是唯一权威源**：修改规范请改 `docs/{name}.md`，再运行 `/lg-init update` 重新同步；手动修改本文件会被下次同步覆盖。

---
```

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
   - `.claude/prompts/constants-usage-standards.md` — **按目录检测**：存在 `src/constants/` 目录则生成（与 admin/d2c 模式无关）

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
     .claude/prompts/constants-usage-standards.md  ✅/⏭️ 检测到 src/constants/ 则生成，否则跳过
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

📐 规范关联:
  CLAUDE.md「开发规范」章节  ✅ 已关联 {N} 份规范文件（普通文案指令同样生效）

🔧 命令:
  /lg-catalog     /lg-extract     /lg-vision     /lg-analyze
  /lg-create-smoke  /lg-smoke     /lg-code       /lg-review
  /lg-api-code
```
