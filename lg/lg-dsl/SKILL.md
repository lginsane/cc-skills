---
name: lg-dsl
description: 从 MasterGo 获取 UI 设计稿 DSL，生成结构化数据并建立原型→UI→代码的完整映射关系
---

# /lg-dsl

获取 MasterGo UI 设计稿 DSL，输出结构化 JSON + 页面映射配置，供 lg-vision 和 lg-code 消费。

## 前置

- MasterGo MCP 已连接（`.mcp.json` 中配置 `mastergo-magic-mcp`）
- 已运行 `/lg-extract` 提取原型截图（可选，用于关联）

## 命令

```bash
/lg-dsl                           → 交互式引导
/lg-dsl --version 1.4.6           → 指定迭代版本
/lg-dsl --req-version 1.4.8         → 指定关联的需求数据版本（vision/analyze/smoke）
/lg-dsl --url <mastergo-url>      → 指定单个 MasterGo 链接
/lg-dsl --urls <url1> <url2> ...  → 批量指定多个稿
```

不传 `--url` 时，交互式提示粘贴 MasterGo 链接，支持多行。

---

## 流程

### Step 0: 环境前置检查（MANDATORY）

进入任何取数步骤前，先运行环境预检；失败则终止，禁止带缺进入流程：

```bash
node ~/.claude/skills/lg-scripts/precheck.mjs
```

- 必需脚本缺失 / 不可读 / node < 18 → exit 1，输出缺失清单；先修复 lg-scripts 部署完整性再继续。
- L4 可选依赖（puppeteer/pixelmatch/pngjs）缺失 → 仅提示（L4 门前安装即可），不阻断 S1–S3。

### Step 1: 收集 MasterGo 链接

从每个链接解析 `fileId` + `layerId`：

```
输入: https://mastergo.com/file/195153017478708?layer_id=2%3A434653
解析: fileId="195153017478708", layerId="2:434653"
```

去重：按 `(fileId, layerId)` 去重，同一组合只获取一次，去重数量计入校验报告。

### Step 1.5 输入全量校验（MANDATORY）

解析完成后，**必须**对比「原始链接清单」与「成功解析的链接」，禁止在未校验的情况下直接进入 Step 2。

**校验逻辑：**

1. 收集阶段：记录用户提供的**全部**原始链接/参数（含无 `http` 前缀的裸参数，如 `fileOpenFrom=project&...&layer_id=35%3A6176`）
2. 解析后统计：
   - `N` = 用户提供的链接总数
   - `M` = 成功解析出 `(fileId, layerId)` 的数量
   - `D` = 因重复被去重的数量
   - `Z` = `N - M - D`（未解析 / 解析失败的数量）
3. **`Z > 0` 时必须逐条列出未解析的项并 ⚠️ 警告**，不得静默跳过
4. 请求用户确认：继续处理已解析的 `M` 个，还是先修复未解析的

**输出格式（MANDATORY）：**

```
📋 链接校验:
   共收到 N 个链接
   ✅ 成功解析 M 个
   🔁 去重 D 个
   ⚠️ 未解析 Z 个: <逐条列出原始参数或 URL>
```

**用户决策分支（用户选择「继续」或「终止」）：**
- 「终止」→ 立即停止全部后续步骤，不生成任何产物，输出退出说明与未处理项清单。
- 「继续」→ 仅处理已解析的 M 个；未解析项记录进最终报告。
- 批量上限：单次 `MAX_URLS = 50`；超限提示「已截断前 50 个，请分批处理」。

**解析归一化与能力边界：**
- `layerId` 先 `decodeURIComponent + trim` 归一（`2%3A434653` ≡ `2:434653`）再按 `(fileId, layerId)` 去重；dsl.mjs 内侧有兜底归一化去重（input-guard.dedupeDesigns）。
- 仅支持 mastergo.com 设计稿链接；解析到非 MasterGo 链接 → 明确提示「当前仅支持 MasterGo（mastergo.com）设计稿链接」，计入未解析清单但不得静默。

**执行后二次校验（Step 2 完成后）：**

对比「解析成功的 `M` 个」与「实际建立 section 索引的 design 数 `K`」（每个链接对应 `${pageId}/section-index.json` 已生成）：

- `K === M` → 输出 `✅ 全部 M 个链接已生成 section 索引`
- `K < M` → 输出 ⚠️ 缺失清单（layerId + 原因，如 MCP 调用失败），禁止直接报"完成"

**dsl.mjs 输出对比：**

运行 dsl.mjs 后，将其输出的 `处理 designs: K' 个` 与 `M` 对比；`K' < M` 时补充缺失报告，并在最终输出中说明「M 个解析中，成功建立索引 K 个 → dsl.mjs 处理 K' 个」。

### Step 2: 获取 DSL 并缓存 + 提取图片

> `raw-dsl.json` 为 **S2/S3 中间输入契约**（lg-dsl 阶段按全量取数门禁落盘）；lg-code 编码时经 MCP 实时获取 DSL，不依赖本地 raw 缓存。此处同时保存 section 列表索引，供 dsl.mjs 聚类与 E 项取数门禁用。

对每个 MasterGo 链接：

1. 调用 `mcp__getDesignSections`（不带 sectionIndex）→ 获取 section 列表 + rootMetadata
2. 从响应中提取每个 section 的索引信息：`sectionIndex`, `id`, `name`, `type`, `x`, `y`, `width`, `height`, `textPreview`, `nodeCount`, `structureSiblingCount`, `containerId`, `structureHash`
3. 保存 section 索引到 `.lg-docs/dsl/{version}/{pageId}/section-index.json`，**同时记录**：
   - `totalSections` / `totalNodes`（lg-code 全量取数门禁的基准数）
   - `rootMetadata.width/height`（设计稿画布宽度，lg-code 像素→项目单位换算的基数，如 720/750/1440）
4. 调用 dsl.mjs 处理并生成 page-mapping.json：

```bash
# 输入传递规则（F2 安全，MANDATORY）：把下方 JSON 写入 .lg-docs/dsl/{version}/_input/dsl.json（Write/heredoc，禁止拼 shell echo 管道），再以 --input 传入：
# {"version":"1.4.6","requirementVersion":"1.4.8","dslDir":".lg-docs/dsl/1.4.6","screenshotsDir":".lg-docs/screenshots/1.4.6",
#  "designs":[{"designId":"ds_001","mastergoFileId":"195153017478708","mastergoLayerId":"2:434653","designName":"商单管理-商单列表-折叠","pageDir":"task-list","sectionIndexFile":".lg-docs/dsl/1.4.6/task-list/section-index.json"}]}
MODOA_PROJECT_DIR="$PWD" node ~/.claude/skills/lg-scripts/dsl.mjs --input .lg-docs/dsl/{version}/_input/dsl.json
```

dsl.mjs 自动执行 Step 3-6：检测类型 → 聚类 → 匹配截图 → 生成 page-mapping.json。

**目录结构（简化后）：**
```
.lg-docs/dsl/{version}/
├── page-mapping.json                    ← 核心输出：设计稿→页面→代码的完整映射（含 mastergoFileId/layerId 坐标）
└── {pageId}/
    ├── section-index.json               ← section 列表概览（供 dsl.mjs 聚类 + 全量取数门禁基准；含 totalSections/totalNodes/画布宽）
    ├── raw-dsl.json                     ← S2/S3 输入契约：全量 section DSL dump（getDesignSections 响应原样拼装）
    ├── image-manifest.json              ← S2 产出：图片寻址链（url → assetKey → localPath）+ failedAssets
    ├── component-blueprint.json         ← S3 产出：复杂页拆解（zones/overlays/repeatables/outputs 文件计划）
    └── images/                          ← S2 位图下载（语义命名 + sha256 指纹去重）
```

> lg-code 通过 page-mapping.json 中的 `mastergoFileId` + `mastergoLayerId` 直接调用 MCP 实时获取完整 DSL，无需依赖本地 raw 缓存。

### Step 2.5: S2 图片资源提取 + 语义命名（image-manifest）

1. **组装 raw-dsl.json（输入契约）**：对每个 design 调 `mcp__getDesignSections`（不带 sectionIndex）拿 section 列表，再**全量取每 section DSL**（沿用既有全量取数门禁，缺 section 禁止继续），拼装为 `{designName, fileId, layerId, version, overview, sectionDsls}`，落盘 `{pageId}/raw-dsl.json`。
2. **运行提取脚本**：
```bash
# 输入 JSON 写入 .lg-docs/dsl/{version}/_input/image-manifest.json 后（--input 规则见 Step 2）：
node ~/.claude/skills/lg-scripts/image-manifest.mjs --input .lg-docs/dsl/{version}/_input/image-manifest.json
```
**MCP 取数纪律（MANDATORY）：**

| 分类 | 定义 | 处置 |
|---|---|---|
| 瞬时错误 | timeout / 网络 5xx / 空响应 | 重试 ≤2 次，间隔 5s→15s 退避 |
| 永久错误 | 4xx / 权限不足 / NOT_FOUND / layerId 不存在 / 非 MasterGo | 不重试，直接记录 |

- 单个 design 连续失败 ≥3 次（含重试）→ 记入 `failedDesigns`，**禁止落盘**该 design 的 raw-dsl.json。
- 落盘 raw-dsl.json 前必须 `sectionDsls.length === section-index.totalSections`；不等 → 不落盘，输出缺失清单，请用户选择「跳过失败项继续 / 终止本次」，禁止静默继续。
- 永久错误根因话术：`❌ 链接 {原文}：{无访问权限 / 文件已删除 / layerId 不存在}`。

3. 产出 `image-manifest.json` + `images/`：语义命名降级链（节点名→就近文本→祖先容器→section名→image）、URL级 + sha256 指纹双重去重、`failedAssets` 独立清单。字段/约束见 `docs/image-manifest-contract.md`。
4. **失败告警与修复指引**：`failedAssets` 非空 → 逐条列出（url + role + 所属 section），并给处置建议：
   - `icon` / `decor` 类：lg-code 用占位/SVG 替代即可；
   - `content`（业务图）：在 MasterGo 补资源后重跑本步，或手动替换 `images/` 对应文件；
   - 示例：`failedAssets: [{url:"…", role:"content"}]` → MasterGo 补图 → 重跑 image-manifest.mjs → 重跑出口自检。
   禁止静默。
- 真稿联调执行清单：见 `docs/2026-09-01-lg-dsl-real-draft-runbook.md`（须在配好 mastergo-magic-mcp 的项目环境执行）。

### Step 2.6: S3 组件拆解 + 文件计划（component-blueprint）

```bash
# 输入 JSON（rawFile/outDir/pageDir/manualRepeatables/sectionIndexFile[建议传入：真稿 overview.sections 可能为空，几何由 section-index 兜底]）写入 _input 后 --input 传入（规则见 Step 2）：
node ~/.claude/skills/lg-scripts/component-blueprint.mjs --input .lg-docs/dsl/{version}/_input/component-blueprint.json
```
- 拆分依据 = **DSL 结构**（splitContainers 分区 / 覆盖层 关键词∪几何 / 自研结构指纹去重 + `manualRepeatables` 人工兜底）；**禁止**用原型/接口语义反推组件。
- `complex` → 多文件计划（index.vue 组装 + shell/overlay/repeatable 独立组件）；`simple` → 单 index.vue，lg-code 退回 page-mapping outputs。字段/约束见 `docs/blueprint-contract.md`。

### Step 2.6.5: codeplan + featureGroups（复杂页代码计划，复杂页必出）

结构复杂 ∨ 逻辑复杂 的 page 生成 `codeplans[]`;complex 的 page 集合做跨稿聚类生成 `featureGroups[]`(可选增强,开关 `featureGroups.enabled` 默认开)。设计契约见 `docs/2026-09-01-lg-code-codeplan-complex-page-design.md`。

1. **双维判定 + 单页 codeplan**(Skill 确定性):
   - 逻辑块清单 `logicBlocks` 由需求数据(vision/analyze)抽出:`[{name, evidence: shared|side-effect|lifecycle|pure|private|associate|uncertain, customReason?}]`;信号清单 `requirementSignals` 同源(`poll-task|shared-state|lifecycle-orchestration|cancel-concurrent|multi-step`)。
   - `existing` = 项目 src 扫描既有文件 + `lg-components-map.json` 路径(复用/继承/首建判定依据)。
```bash
node ~/.claude/skills/lg-scripts/codeplan.mjs --input .lg-docs/dsl/{version}/_input/codeplan.json
```
   - 双维简单 → 返回 `codeplan:null, reason:"dual-simple"`,不产段。
2. **featureGroups 聚类**(complex 页之间):
```bash
node ~/.claude/skills/lg-scripts/feature-groups.mjs --input .lg-docs/dsl/{version}/_input/feature-groups.json
```
   - 置信度默认 ≥0.7 自动并组 / [0.35,0.7) confirmRequired / <0.35 不并组;每组带 `evidence` 逆向索引。
3. **契约校验(HARD GATE,kind×mode / 条件必填 / 路径白名单 src/** / 循环依赖)**:
```bash
node ~/.claude/skills/lg-scripts/codeplan-validate.mjs --input .lg-docs/dsl/{version}/_input/codeplan-validate.json
```
   - 任一 errors 非空 → 修正后重跑,**禁止带错误写盘进入 lg-code**。
4. **写盘**:blueprint 增补 `codeplans[]` 与 `featureGroups[]` 段。

### Step 2.7: 出口自检 HARD GATE（dsl-fidelity-check）

```bash
node ~/.claude/skills/lg-scripts/dsl-fidelity-check.mjs --input .lg-docs/dsl/{version}/_input/dsl-fidelity-check.json
```
五项全过（exit 0）才允许进入 lg-code：
- **A 引用闭合** / **B 无造假条目** / **C 图片全量覆盖**（遗漏→warning）/ **D section 全量归属**（悬空未声明→fail）/ **E 取数完整性**（raw-dsl 实际 section 数 ≠ totalSections → fail）
- **任一 fail → 修正后重跑，禁止带缺进入 lg-code**。

### Step 3: 自动检测 componentType + role

**componentType 检测：**

| DSL 特征 | 判定 |
|----------|------|
| 含 `<a-table>` 或表头 GROUP（多列 TEXT 整齐排列） | `"list"` |
| 含表单输入控件（Select / Input / DatePicker） | `"form"` |
| 纯文本展示 + 无输入控件 | `"detail"` |
| 以上都不匹配 | `"unknown"`（需人工判定） |

**role 启发式推断（designName 关键词）：**

| 关键词 | role |
|--------|------|
| "新增"\|"添加"\|"新建"\|"创建" | `"create"` |
| "编辑"\|"修改"\|"变更" | `"edit"` |
| "查看"\|"详情"\|"预览" | `"view"` |
| 无匹配 | `null` |

检测结果写入 `autoDetected` 字段。role 永远标记为需人工确认。

### Step 4: 按 designName 聚类 pages

1. 提取每个 design 的 designName **前缀**（去掉末尾角色关键词）
   - `"商单管理-商单列表-折叠"` → prefix = `"商单管理"`
   - `"商单管理-新增商单"`      → prefix = `"商单管理"`
2. 相同前缀的 designs 归入同一个 page
3. `pageId` = 前缀转 kebab-case；`pageDir` 从 lg-config 或手动指定

### Step 5: 匹配 screenshots → 生成 page-mapping.json

1. 读取 `screenshots/{version}/` 下所有图片文件名
2. 对每个 page，计算 `pageName` 与截图名的**模糊匹配相似度**
3. 匹配成功 → 填入 page-mapping.json 的 `screenshot` 字段
4. 未匹配的截图 → 输出 ⚠️ 警告（有图无稿）
5. 未匹配的 design → 输出 ⚠️ 警告（有稿无图）

### Step 6: 合并规则（outputs 生成）

> v2：精确样式/图标/文案**不落 DSL 产物**——lg-code 编码时经 MCP 实时获取 DSL，SVG 走 `applyDesign` 注入、长文本走 `T{sec}|{nodeId}` 注入；`page-mapping.json` 保留 `mastergoFileId` + `mastergoLayerId` 作为取数入口。section-index.json 中不保存各 section 的完整 DSL。

**合并规则（outputs 生成）：**

- 同一 page 内：`componentType` 相同 + `role` 为 `create`+`edit` → 合并为 1 个 FormModal
- `componentType` 不同 → 各自独立 output
- 合并后 outputs 结构见 page-mapping.json

### Step 7: 需求关联确认（可选，需 --req-version）

1. dsl.mjs 自动为每个 page 匹配需求页面名，写入 page-mapping.json：
   - `requirementPage` — 关联的需求中文页面名（跨 vision/analyze/smoke 统一键）
   - `requirementConfirmed` — `true` 自动确认 / `false` 需人工确认
   - `requirementCandidates` — 匹配候选（Top 5）
   - `dataLinks` — 固化文件快照（lg-code 按此精确读取）
2. 输出待确认清单：
   ```
   📋 需求关联 (reqVersion 1.4.8):
      ✅ 已关联: 3 个 page
      ⚠️ 待确认: 1 个 page 置信度低（请检查 page-mapping.json 的 requirementPage）
      ⚠️ 未匹配: 1 个 page 无对应需求数据
   ```
3. 对 `requirementConfirmed: false` 的 page，核对 `requirementCandidates` 后修改示例——
   ```json
   { "pageId": "task-list", "requirementPage": "商单管理", "requirementConfirmed": true,
     "dataLinks": { "vision": { "file": "3_商单管理.json" } } }
   ```
4. **关联口径**：匹配阈值 ≥0.35 视为匹配、≥0.6 自动确认（`requirementConfirmed=true`）；强意图关键词无命中时诚实降级不匹配；无需求数据的 page 关联留空，lg-code 降级为仅 DSL（不影响视觉还原，仅少注入交互/校验）。机制实现见 `lg-scripts/dsl-requirement.mjs`。
5. 未匹配的 page：可补填 `requirementPage` 与对应 vision/analyze/smoke 文件名；确无需求数据则保留为空（lg-code 降级为仅 DSL）。

---

## 输出

### page-mapping.json

```json
{
  "version": "1.4.6",
  "generatedAt": "2026-07-31T10:00:00Z",
  "pages": [
    {
      "pageId": "task-list",
      "pageName": "商单管理",
      "pageDir": "task-manage/task-list",
      "screenshot": "screenshots/1.4.6/商单管理.png",
      "requirementPage": "商单管理",
      "requirementConfirmed": true,
      "requirementCandidates": ["商单管理", "商单列表"],
      "requirementVersion": "1.4.8",
      "dataLinks": {
        "vision": { "file": "3_商单管理_1_2047x833.json", "pageName": "商单管理" },
        "analyze": { "file": "1_商单管理.json" },
        "smoke": { "file": "1_商单管理.json" }
      },
      "designs": [
        {
          "designId": "ds_001",
          "mastergoFileId": "195153017478708",
          "mastergoLayerId": "2:434653",
          "designName": "商单管理-商单列表-折叠",
          "componentType": "list",
          "role": null,
          "autoDetected": true
        },
        {
          "designId": "ds_002",
          "mastergoFileId": "195153017478708",
          "mastergoLayerId": "2:xxxxxx",
          "designName": "商单管理-新增商单",
          "componentType": "form",
          "role": "create",
          "autoDetected": true
        },
        {
          "designId": "ds_003",
          "mastergoFileId": "195153017478708",
          "mastergoLayerId": "2:yyyyyy",
          "designName": "商单管理-编辑商单",
          "componentType": "form",
          "role": "edit",
          "autoDetected": true
        },
        {
          "designId": "ds_004",
          "mastergoFileId": "195153017478708",
          "mastergoLayerId": "2:zzzzzz",
          "designName": "商单管理-查看商单",
          "componentType": "detail",
          "role": "view",
          "autoDetected": true
        }
      ],
      "outputs": [
        {
          "outputType": "list-page",
          "sourceDesigns": ["ds_001"],
          "outputPath": "src/views/task-manage/task-list/index.vue",
          "template": "list-page"
        },
        {
          "outputType": "form-modal",
          "sourceDesigns": ["ds_002", "ds_003"],
          "modes": ["create", "edit"],
          "outputPath": "src/views/task-manage/task-list/components/FormModal.vue",
          "template": "form-modal"
        },
        {
          "outputType": "detail-drawer",
          "sourceDesigns": ["ds_004"],
          "outputPath": "src/views/task-manage/task-list/components/DetailDrawer.vue",
          "template": "detail-drawer"
        }
      ]
    }
  ]
}
```

### 字段说明

| 字段 | 层级 | 说明 |
|------|------|------|
| `pageId` | page | 唯一标识，原型截图名转 kebab-case |
| `pageName` | page | 中文名，从 designName 前缀提取 |
| `pageDir` | page | Vue 文件目录，自动推断 + 人工修正 |
| `screenshot` | page | lg-extract 产出路径 |
| `requirementPage` | page | 需求中文页面名（跨产物统一关联键） |
| `requirementConfirmed` | page | 是否自动确认（false 需人工核对） |
| `requirementCandidates` | page | 匹配候选列表（Top 5） |
| `dataLinks` | page | 关联文件固化快照（lg-code 按此读取） |
| `designId` | design | 唯一标识，格式 `ds_NNN` |
| `mastergoFileId` | design | MasterGo 文件 ID |
| `mastergoLayerId` | design | MasterGo 图层 ID |
| `componentType` | design | `"list"` \| `"form"` \| `"detail"` \| `"unknown"` |
| `role` | design | `"create"` \| `"edit"` \| `"view"` \| `null`，需人工确认 |
| `autoDetected` | design | 是否自动检测（false 表示人工修正过） |
| `outputType` | output | `"list-page"` \| `"form-modal"` \| `"detail-drawer"` |
| `sourceDesigns` | output | 引用的 designId 列表（合并时多个） |
| `modes` | output | 合并时的模式列表 |
| `outputPath` | output | 生成文件的相对路径 |
| `template` | output | lg-code 使用的场景模板名 |

---

## 与下游工具的关系

```
/lg-extract → screenshots/{version}/*.png
      ↓
/lg-dsl → .lg-docs/dsl/{version}/
      │     └── page-mapping.json        → 映射配置（含 mastergoFileId/mastergoLayerId，lg-code 按此实时抓 DSL）
      ↓
/lg-code → 读取 page-mapping.json → MCP 实时抓 DSL → 生成 Vue 代码
           ↑ 同步读取 vision/analyze/smoke 需求数据注入交互/校验/状态
```

**关键融合点（lg-code D2C 模式内部）：**

| 数据源 | 用途 | 获取方式 |
|--------|------|---------|
| MCP DSL（实时） | 精确颜色/字号/圆角/间距/渐变/坐标/布局 | `mcp__getDesignSections` 按 design 的 mastergoFileId + layerId 实时抓取 |
| `page-mapping.json` | design→page 映射、componentType、output 路径 | lg-dsl 产出，lg-code 读取 |
| `vision/{version}/` | 交互方式、提示文案、状态变体、校验规则 | page-mapping 的 dataLinks/requirementLinks 指向 |
| `analyze/{version}/` | 边界条件、异常分支、状态依赖 | 同上 |
| `smoke/{version}/` | 冒烟用例验收清单 | 同上 |
| `image-manifest.json` | 图片寻址链：DSL fill url → assetKey → localPath | lg-dsl S2 产出，lg-code 编码时按 url 精确查路径 |
| `component-blueprint.json` | 复杂页文件计划（zones/overlays/repeatables/outputs） | lg-dsl S3 产出，lg-code 按 outputs 逐文件生成 |
| 图片下载 | 由 lg-dsl `image-manifest.mjs` 一次性下载 + 语义命名 + 指纹去重 | lg-code 引用 manifest localPath；**禁止直接 curl 远端 URL** |

---

## 边界情况

| 场景 | 处理方式 |
|------|---------|
| 没有 MasterGo 稿的页面 | lg-dsl 跳过，lg-vision 独立工作 |
| 只有 create 没有 edit | FormModal 仅 1 个 mode，后续补 edit 时再合并 |
| add 和 edit 字段不同 | 输出 diff 差异字段清单，生成时用 `v-if="mode === 'edit'"` |
| 没有 detail 设计稿 | 不生成 DetailDrawer，查看走 readOnly FormModal |
| 原型 1 图对应多组 designs（如 tab 页） | 每个 tab 一个 page entry，共用 pageDir |
| MasterGo MCP 不可用 | 输出错误提示，不生成任何文件 |

## 输出示例

```
✅ /lg-dsl 完成

📐 迭代版本: 1.4.6
📋 解析 MasterGo 链接: 4 个
   链接→索引对比: 成功解析 M=4 / 建立索引 K=4 / dsl.mjs 处理 K'=4（K<M 或 K'<K 时禁止报完成，须输出缺失清单）
📂 聚类 pages: 1 个

📄 商单管理 (task-list)
   ├── ds_001  列表 ✅ autoDetected   → index.vue
   ├── ds_002  表单 create ⚠️ 待确认  → FormModal.vue (合并)
   ├── ds_003  表单 edit   ⚠️ 待确认  → FormModal.vue (合并)
   └── ds_004  详情 view  ⚠️ 待确认  → DetailDrawer.vue

⚠️ 待确认: 3 个 design 的 role 需人工验证
   → 请检查 .lg-docs/dsl/1.4.6/page-mapping.json 并修正 role 字段

📋 生成文件:
   .lg-docs/dsl/1.4.6/page-mapping.json               ← 核心产出（含 MCP 坐标，lg-code 按此还原）
   .lg-docs/dsl/1.4.6/task-list/section-index.json    ← section 概览 + 取数门禁基准
   .lg-docs/dsl/1.4.6/task-list/raw-dsl.json          ← S2/S3 输入契约（全量 section DSL dump）
   .lg-docs/dsl/1.4.6/task-list/image-manifest.json   ← S2 图片寻址链（url→assetKey→localPath）+ failedAssets
   .lg-docs/dsl/1.4.6/task-list/component-blueprint.json ← S3 复杂页文件计划（zones/overlays/repeatables）
   .lg-docs/dsl/1.4.6/task-list/images/*              ← 语义命名 + sha256 指纹去重位图
   ✅ 结构一致性自检通过（dsl-fidelity-check: A引用闭合/B无造假/C全量覆盖/D全量归属/E取数完整性）
```
