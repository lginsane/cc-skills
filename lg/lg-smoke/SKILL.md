---
name: lg-smoke
description: 运行冒烟测试，检查代码是否覆盖冒烟用例
---
# /lg-smoke — Smoke Testing (冒烟测试)

Validate business code against smoke test cases. Fetch test case documents, check code paths, auto-fix failures. Covers critical-path validation that unit tests may miss.

## Usage

When invoked, prompt the user with available parameters before executing:

```
/lg-smoke [scope] [options]

📁 SCOPE（代码检查范围，可选）：
  /lg-smoke <path>              检查指定目录或文件
  /lg-smoke <path1> <path2>     检查多个路径

🔍 DIFF（基于 commit 区分）：
  /lg-smoke --diff              未 commit 的变更
  /lg-smoke --diff HEAD~3       最近 3 个 commit
  /lg-smoke --diff main..HEAD   当前分支 vs main
  /lg-smoke --since <commit>    指定 commit 之后的所有提交
  /lg-smoke --since-last-build  上次 build/release tag 之后

📋 SOURCE（用例来源，可选，默认读 smoke-config.json）：
  /lg-smoke --local             仅使用本地用例文档
  /lg-smoke --yunxiao           仅从云效拉取用例
  /lg-smoke --source <path>     指定用例文件路径

🐛 BUGS（云效工作项修复 — 缺陷/线上故障/优化）：
  /lg-smoke --bugs              拉取全部工作项 + 匹配代码 + 修复
  /lg-smoke --bugs --type bug   仅拉取缺陷
  /lg-smoke --bugs --type fault 仅拉取线上故障
  /lg-smoke --bugs --type optimize 仅拉取优化
  /lg-smoke --bugs --dry-run    仅展示，不修复
  /lg-smoke --bugs --no-autofix 仅检查不修复

📊 ANALYZE（冒烟回溯分析 — 缺陷/线上故障/优化）：
  /lg-smoke --analyze --version <version>  分析冒烟+全部工作项(缺陷/故障/优化)
  /lg-smoke --analyze --version <version> --type bug    仅分析缺陷
  /lg-smoke --analyze --version <version> --type fault  仅分析线上故障
  /lg-smoke --analyze --version <version> --type optimize 仅分析优化
  /lg-smoke --analyze --version <version> --owner <userId>
  /lg-smoke --analyze --apply              审核后合入补充用例

⚙️ OPTIONS：
  /lg-smoke --no-autofix        仅检查不修复
  /lg-smoke --p0-only           仅检查 P0 核心用例
  /lg-smoke --dry-run           仅展示用例/缺陷，不检查代码

📖 OTHER：
  /lg-smoke --help              显示此帮助
  /lg-smoke --config            打开当前项目的 smoke-config.json

Examples:
  /lg-smoke src/views/order/             ← 检查订单模块
  /lg-smoke --diff HEAD~3 --p0-only      ← 最近3次commit，仅P0
  /lg-smoke --yunxiao --no-autofix       ← 从云效拉取，仅检查不修复
  /lg-smoke --since-last-build --local   ← 上次构建后，本地用例
  /lg-smoke --bugs                       ← 拉取迭代缺陷 + 修复
  /lg-smoke --analyze --version 1.4.6              ← 分析1.4.6版本回溯
  /lg-smoke --analyze --version 1.4.6 --owner me   ← 只分析我的Bug
```

**If invoked without arguments**: display this usage guide and ask the user to specify scope and options.

## When to Use

- "Run smoke tests for the order module"
- "Check this payment page against the smoke test doc"
- "Verify the user registration flow with test cases from 云效"
- "Auto-fix code to pass smoke test cases"

## Scope Definition (代码检查范围)

The skill determines which code to check using 4 strategies, resolved in priority order:

### Priority 1: Explicit Scope（显式指定）

User provides the scope directly in the command. This is the most precise and preferred method.

```
/lg-smoke src/views/order/              ← 检查整个目录
/lg-smoke src/views/order/create.vue    ← 检查单个文件
/lg-smoke src/views/order/ src/api/order.ts  ← 检查多个路径
```

### Priority 2: Document Declaration（用例文档声明）

The smoke test document contains a `模块` or `目标文件` column specifying which code files to check.

```markdown
| ID | 场景 | 模块 | 操作步骤 | 预期结果 | 优先级 |
|---|---|---|---|---|---|
| SMK-001 | 正常下单 | src/views/order/ | 提交订单 | ... | P0 |
```

If the module column exists, use those paths as the check scope.

### Priority 3: Keyword Matching（关键词匹配）

When no explicit scope or document declaration is found, derive scope from the test case scenario names:

- 订单创建 → search `src/views/order/`, `src/api/order*`, `src/constants/order*`, `src/stores/useOrder*`
- 支付流程 → search `src/views/pay/`, `src/api/pay*`, `src/constants/pay*`
- 用户登录 → search `src/views/login/`, `src/views/auth/`, `src/api/user*`, `src/stores/useUser*`

Scan the following directories for matching files:

- `src/views/` — page components
- `src/api/` or `src/services/` — API modules
- `src/constants/` or `src/enums/` — constants and enums
- `src/stores/` or `src/store/` — state management
- `src/components/` — related business components

### Priority 4: Git Diff（基于 Commit 区分）

```
/lg-smoke --diff                    ← 未 commit 的变更（工作区 + 暂存区）
/lg-smoke --diff HEAD~1             ← 最近 1 个 commit
/lg-smoke --diff HEAD~3             ← 最近 3 个 commit
/lg-smoke --diff main..HEAD          ← 当前分支 vs main 的全部差异
/lg-smoke --diff abc1234..def5678    ← 指定 commit 区间
/lg-smoke --since <commit>          ← 某个 commit 之后的所有提交（含该 commit）
/lg-smoke --since-last-build        ← 上次构建标记之后的所有提交
```

**`--since <commit>`**：

- 范围：`<commit>^..HEAD`（从该 commit 的父提交开始到 HEAD）
- 场景：已知某个稳定版本 commit，检查之后所有变更
- 示例：`/lg-smoke --since a1b2c3d` → 等价于 `git diff a1b2c3d^..HEAD`

**`--since-last-build`**：

- 自动查找最近的构建标记（优先级递减）：
  1. Git tag 匹配 `build/*`、`release/*`、`v*` → 取最新的 tag
  2. Commit message 匹配 `^build:`、`^chore\(release\):` → 取最新的
  3. 未找到 → 提示用户手动指定或创建 tag
- 范围：从该标记到 HEAD 的所有 commit
- 场景：上一个版本 build 之后，当前新版本的所有提交，发版前做最后一轮冒烟验证

```bash
# /lg-smoke 内部等价执行
LAST_BUILD=$(git tag --list 'build/*' 'release/*' 'v*' --sort=-creatordate | head -1)
if [ -z "$LAST_BUILD" ]; then
  echo "未找到构建标记，请手动指定：/lg-smoke --since <commit>"
  exit 1
fi
git diff $LAST_BUILD..HEAD
```

**行为**：

- 仅检查 diff 中变更的文件（新增 + 修改，删除文件仅检查引用方）
- 按 `.vue` / `.ts` / `.js` / `.less` / `.scss` 分组
- 自动匹配相关用例：变更文件路径匹配用例文档的模块声明或关键词
- 若无相关用例覆盖变更范围 → 提示：`⚠️ 变更的文件没有对应的冒烟用例，建议补充`

**适用场景**：

- Pre-push 前快速检查本次变更是否影响核心流程
- 修复 Bug 后验证是否引入新的冒烟失败
- 重构后确认关键路径未受影响

**与 /review 的区别**：

| | /lg-smoke --diff | /review |
|---|---|---|
| 关注点 | 业务流程是否正确 | 代码规范/安全/性能 |
| 输入 | 冒烟用例文档 | 编码规范 + CLAUDE.md |
| 输出 | 用例通过/失败 + 自动修复 | Error/Warn/Suggest 分级报告 |
| 典型用法 | `/lg-smoke --diff HEAD~3` | `/review` |

### Scope Resolution Flow

```
/lg-smoke <args>
  ↓
--help or no args?             → YES → 展示参数面板 → STOP
  ↓ NO
args match explicit paths?     → YES → Use exact paths
  ↓ NO
Document has "模块" column?     → YES → Use declared paths
  ↓ NO
Match scenario keywords?       → YES → Search & confirm with user
  ↓ NO
--diff flag set?               → YES → Use git diff files
  ↓ NO
Ask user: "请指定要检查的代码范围" (Require explicit input)
```

**Rule**: The skill never checks the entire codebase unless the user explicitly requests it. Always confirm scope before proceeding to Step 2.

## Pipeline

### ⏩ `--help` / `--config` — 不进入流水线

If user invokes with `--help` or no arguments → **ONLY** display the Usage panel (parameter reference + examples), then STOP. Do NOT proceed to Step 0.

If user invokes with `--config` → read `.claude/config/lg-smoke-config.json` and display its current content, then STOP.

### Step 0: 加载配置文件 (Load Config)

**MUST** read `.claude/config/lg-smoke-config.json` before any smoke test operation.

Config structure:

```json
{
  "sources": {
    "local": { "enabled": true, "paths": ["docs/lg-smoke/"] },
    "yunxiao": {
      "enabled": false,
      "organizationId": "<org-id>",
      "apiBaseUrl": "<url>",
      "projectId": "<project-id>"
    }
  },
  "priority": { "P0": {...}, "P1": {...}, "P2": {...} },
  "autoFix": { "enabled": true, "fixableChecks": [...] }
}
```

**IMPORTANT**: If `sources.yunxiao.enabled` is true but `organizationId` is empty or not configured → immediately warn user to configure it. 云效 MCP requires organizationId, otherwise the API call will fail.

### Step 1: 获取冒烟用例文档 (Fetch Test Cases)

**Source A — 本地文档**（`sources.local.enabled: true`）：

- Scan paths in `sources.local.paths` for test case files
- Supported: `.md`, `.json`, `.xlsx`

**Source B — 云效**（`sources.yunxiao.enabled: true`）：

- Read `organizationId`, `projectId`, `repoId` from config
- Call 云效 MCP/API with organizationId → fetch test cases
- Auth: read token from `process.env[sources.yunxiao.tokenEnvVar]`
- If `organizationId` is empty → Error: "请在 .claude/config/lg-smoke-config.json 中配置 organizationId"

**测试计划模式（优先）**：

当 `sources.yunxiao.testPlan` 已配置时，优先通过测试计划拉取用例（云效已按前后端分好计划），替代从用例库全量拉取再手动分类。

```
testPlan.mode = "namePattern"
  → list_test_plans(organizationId)
  → 匹配 namePattern（{version} 替换为 versionId）
  → 多个匹配 → 取创建时间最新的
  → 找到 → get_test_result_list(testPlanIdentifier)
  → 0 个匹配 → fallbackToClassification? → Step 1.6 手动分类 : 报错终止

testPlan.mode = "planId"
  → get_test_result_list(planId)
  → 返回 0 条 → 提示"计划为空"，询问是否切换全量计划

testPlan 未配置
  → 走原逻辑: search_testcases → Step 1.6 手动分类
```

**`list_test_plans` 调用**：

```
mcp__yunxiao__list_test_plans({ organizationId })
  → 过滤: name 匹配 namePattern（{version} 替换为 versionId）
  → 取 gmtCreate 最新的 plan
```

**`get_test_result_list` 调用**：

```
mcp__yunxiao__get_test_result_list({
  organizationId,
  testPlanIdentifier: matchedPlanId,
  directoryIdentifier  // 按平台目录过滤，同端过滤规则
})
```

**解析规则**：从文档中提取结构化的测试用例列表。

**端过滤规则**（按 platform.filterRule 执行）：

**状态过滤规则**（按 yunxiao.skipStatuses 执行）：

```
用例拉取后，按 status 字段过滤：
  ├─ status == "暂缓"   → ⏭️ 跳过（不展示、不检查）
  ├─ status == "已废弃"  → ⏭️ 跳过
  ├─ status == "已通过"  → ⏭️ 跳过
  ├─ status == "重复"    → ⏭️ 跳过
  └─ 其他状态            → ✅ 保留
  ↓
保留的用例 → 进入端过滤 → 进入 Step 1.5 展示
```

```
读取 smoke-config.json → platform.current = "管理端"
  ↓
遍历所有拉取到的用例：
  ├─ 用例.端 == "管理端"   → ✅ 保留（匹配当前端）
  ├─ 用例.端 == "公共"     → ✅ 保留（所有端共用）
  ├─ 用例.端 == "达人端"   → ❌ 过滤（非当前端）
  └─ 用例.端 == "商家端"   → ❌ 过滤（非当前端）
  ↓
过滤后的用例 → 进入 Step 1.5 展示
```

**云效查询参数**（`sources.yunxiao`）：

- 按 `organizationId` + `projectId` + `versionId` 定位测试管理中的版本
- 在该版本下查询所有用例，再按 `platform.current` 过滤端
- 示例：V1.4.5.1 版本下有 达人端/商家端/管理端，当前项目配置为 "管理端" → 只拉取管理端用例

Expected document format (Markdown):

```markdown
## 冒烟用例：订单创建流程

| ID | 场景 | 前置条件 | 操作步骤 | 预期结果 | 优先级 | 端 |
|---|---|---|---|---|---|---|
| SMK-001 | 正常下单 | 已登录，购物车有商品 | 点击提交订单 | 跳转支付页，订单状态=PENDING | P0 | common |
| SMK-002 | 库存不足 | 商品库存=0 | 点击提交订单 | 提示库存不足，不创建订单 | P0 | admin |
| SMK-003 | 未登录下单 | 未登录 | 点击提交订单 | 跳转登录页 | P1 | common |
| ID | 场景 | 优先级 | 状态 | 端 | 前置条件 | 预期结果 |
|---|---|---|---|---|---|---|
| IVUA-132 | 正常下单 | P0 | 有效 | 管理端 | 已登录，购物车有商品 | 跳转支付页 |
| IVUA-133 | 库存不足 | P0 | 有效 | 管理端 | 商品库存=0 | 提示库存不足 |
| IVUA-140 | 未登录下单 | P1 | 暂缓 | 公共 | 未登录 | ⏭️ 跳过 |

拉取 3 条 | 跳过 1 条（暂缓）| 有效用例 2 条

**展示格式**：

```

📋 拉取到 N 个冒烟用例

| ID | 场景 | 优先级 | 端 | 前置条件 | 预期结果 |
|---|---|---|---|---|---|

     1. 用例文档是否存在（本地路径 / 云效配置）
     2. 云效 organizationId/versionId 是否正确（.claude/config/lg-smoke-config.json）
     3. 文档格式是否可解析
     4. 是否所有用例都被 skipStatuses 过滤（暂缓/已废弃/重复）
P0: 2 个  |  P1: 1 个  |  P2: 0 个

```

**门禁规则**：

```

拉取到的用例数量 = 0？
  ↓ YES
  ❌ 终止：未拉取到任何冒烟用例，请检查：
     1. 用例文档是否存在（本地路径 / 云效配置）
     2. 云效 organizationId 是否正确（.claude/config/lg-smoke-config.json）
     3. 文档格式是否可解析
  → 停止，不进入 Step 2

  ↓ NO（用例数量 > 0）
  展示全部用例 → 询问用户："确认按以上用例进行冒烟检查？[Y/n]"
    ↓ Y
    继续 Step 2
    ↓ n
    ❌ 终止：用户取消

```

**Rule**: If no test cases are fetched (count = 0), STOP immediately. Never proceed to code checking with an empty case list.

### Step 1.6: 用例前后端分类 (Fallback — 仅当 testPlan 未配置或匹配失败时执行)

> **注意**：如果 Step 1 已通过测试计划拉取用例，跳过此步骤，直接进入 Step 1.7 二次校验。

**分类规则（按用例描述关键词自动判定）**：

| 分类 | 关键词模式 | 示例 |
|------|-----------|------|
| **前端** | 弹窗/提示/显示/隐藏/切换/按钮/输入框/下拉/列表展示/页面跳转/刷新页面/二次确认/防抖/排序/筛选/不弹提示/弹提示 | "切换分组不弹提示" |
| **后端** | 消息通知/爬虫/自动审核/定时任务/数据同步/服务端校验/微信消息/短信/发消息 | "爬虫阶段话题变蓝判断" |
| **全栈** | 提交后/保存后/状态流转/接口调用且前端有交互/审核通过\|拒绝/点击弹窗→调API | "审核拒绝点击弹窗→调API→提示操作成功" |

**争议处理**：

```
无法自动判定 → 分组展示给用户：
  "以下用例无法自动判定前后端归属，请确认分类："
  ├─ ABNP-XX: <描述> → [1.前端 / 2.后端 / 3.全栈]？
  └─ ...
用户未响应 → 默认按前端处理（宁可多查不可漏查）
```

**分类结果展示**：

```
📋 用例分类结果
  前端: N 条  |  后端: N 条  |  全栈: N 条
  ⏭️ 后端用例跳过代码检查
  🔍 前端 + 全栈 = N 条进入 Step 2
```

**代码映射表**（对每个前端/全栈用例，生成检查路径）：

```
ABNP-13: 外层关键词只显示开启的关键词组
  → 入口: punch-card-config-detail.vue (父级编排)
  → 子组件: keyword-group-panel.vue / keyword-detail-panel.vue
  → 检查点: 分组列表加载时是否过滤 enableStatus !== 1 的分组
```

### Step 1.7: 二次校验 — 前端计划中的后端用例检测（仅测试计划模式）

> **仅当 Step 1 通过测试计划拉取时执行。** 即使云效已分好"前端冒烟用例"计划，仍可能有测试人员误归类的后端用例。

**流程**：

```
Step 1 测试计划拉取的用例
  ↓
对每条用例执行 Step 1.6 关键词分类（轻量校验）
  ↓
  ├─ 分类 = 后端 的用例 → 收集，展示给用户确认
  │
  │   "以下 {N} 条用例在「前端冒烟用例」计划中，但关键词分析疑似后端用例："
  │   | 编号 | 用例 | 疑似原因 |
  │   |------|------|---------|
  │   | ABNP-XX | 爬虫阶段话题变蓝... | 含"爬虫" |
  │   | ABNP-YY | 审核通过发消息给... | 含"发消息给" |
  │
  │   → 询问："是否将这些用例标记为暂缓（后端用例）？[Y/n]"
  │
  │   ↓ Y（用户确认后逐条处理）
  │   → update_test_result(status=POSTPONE)
  │   → 记录到报告（标记 "⏭️ 已暂缓-后端用例"）
  │
  │   ↓ n → 保留，按前端用例正常检查
  │
  └─ 分类 = 前端/全栈 → 正常进入 Step 2
```

**`update_test_result` 调用**：

```
mcp__yunxiao__update_test_result({
  organizationId: config.organizationId,
  testplanId: matchedPlanId,
  testcaseId: caseId,
  executor: currentUserId,     // 从 get_current_user 获取
  status: "POSTPONE"           // 暂缓
})
```

**`get_current_user` 调用**（获取 executor）：

```
mcp__yunxiao__get_current_user()
  → 取返回值的 userId 作为 executor
```

**二次校验规则**（精简版，仅检测明显后端信号）：

| 后端信号 | 说明 |
|---------|------|
| 含"爬虫" | 爬虫巡检逻辑 |
| 含"发消息给" / "消息通知" / "微信消息" / "短信" | 消息推送 |
| 含"自动审核" / "定时任务" | 自动化后端任务 |
| 含"老功能" / "老逻辑" / "老代码逻辑" 且无前端交互关键词 | 后端代码回归 |
| 含"同步" 且主语为系统/服务 | 数据同步 |

**注意**：
- 云效 MCP 暂不提供测试结果评论 API，变更记录写入 smoke 报告
- 报告中输出云效计划链接供人工复查

### Step 2: 检查业务代码 (Check Code)

For each test case, trace the business code path and verify.

**组件树追踪规则（前端/全栈用例必须执行）**：

对每个前端用例，按以下顺序逐层阅读，不可跳过中间层：

1. **定位入口页面** — 从路由路径或目录名找到顶层 page 组件（通常在 `src/views/` 下）
2. **读父级编排页** — 必须读。这是数据加载+过滤+分发给子组件的枢纽，是最容易漏检的层级
3. **读直接子组件** — 父级模板中引用了哪些子组件（面板/表格/弹窗等），逐个读
4. **读孙级子组件** — 子组件内部再引用的更深层组件

**停止条件**：
- 读到的代码完整覆盖用例描述的功能路径 → 可停止
- 到达无子组件的叶子节点（纯展示组件、第三方组件） → 可停止
- 用例仅涉及后端逻辑 → 跳过

**反例（禁止）**：
- ❌ 只读 `keyword-detail-panel.vue` 就判断"外层关键词"逻辑 → 漏检父级过滤
- ✅ 先读 `punch-card-config-detail.vue`（父级编排）→ 再读子组件 → 完整覆盖

**通用检查方法**：

For each test case, trace the business code path and verify:

**P0 用例（核心流程，必须全部通过）**：
1. 功能路径是否存在（页面/组件/API 是否实现）
2. 状态流转是否正确（如 PENDING→PAID→SHIPPED）
3. 边界条件是否处理（库存=0、金额=0、未登录）
4. 错误提示是否符合预期

**P1 用例（重要流程，至少 80% 通过）**：
1. 异常路径覆盖
2. 权限校验
3. 数据校验

**检查方法**：
- 搜索相关 Vue 组件/页面文件
- 跟踪 API 调用链（组件 → API 模块 → request wrapper）
- 检查常量/枚举使用（状态值是否正确）
- 检查条件分支（if/switch 是否覆盖所有用例场景）

### Step 3: 修改代码 (Fix Issues)

**⚠️ 修复前必须先检查全局错误处理机制。**

在判断"catch 块缺少错误提示"之前，必须先读取项目的 HTTP 请求封装文件（常见路径：`src/lib/axios.js`、`src/utils/request.js`、`src/api/http.js`），检查响应拦截器中是否已有全局 `message.error()` 处理。

```
判断流程：
  catch 块没有 message.error()？
    ↓ YES
  读取 axios/request 拦截器
    ↓
  响应拦截器的非0 code 分支是否已有 message.error(res.msg)？
    ├─ YES → ✅ 不需要加，全局拦截器已处理。catch 块只需 console.error(e) 用于调试
    └─ NO  → ❌ 需要加 message.error()
```

**常见全局拦截器特征（不需要额外添加 catch 错误提示）：**
- `message.error(res.msg)` 在 `res.code !== 0` 分支中
- `message.error(error.message)` 在网络错误分支中
- `Modal.error({ content: res.msg })` 等错误弹窗

For failing cases, auto-fix where possible:

| 失败类型 | 自动修复能力 |
|---|---|
| 缺少空状态处理 | ✅ 添加 `<a-empty>` + 引导按钮 |
| 缺少错误提示 | ⚠️ **先检查全局拦截器**，确认无全局处理后才能添加 `message.error()` |
| 状态值硬编码 | ✅ 替换为常量引用 |
| 缺少边界条件判断 | ✅ 添加 if 守卫（库存、金额、权限） |
| 缺少权限校验 | ✅ 添加路由 `meta.permission` |
| 缺少完整流程页面 | ⚠️ 生成骨架页面，标注需要手动补充的逻辑 |
| 缺少 dirty state 检测 | ⚠️ 标注切换/离开前需判断是否有未保存修改，需理解业务字段后手动实现 |
| 缺少数据过滤条件 | ⚠️ 标注缺失的过滤条件（如只显示开启状态的），手动补充 |
| 业务规则复杂 | ⚠️ 标注需要人工确认的位置 |

### Step 4: 生成报告 (Report)

```

🔥 Smoke Test Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Source: docs/lg-smoke/order-flow.md (5 cases)
Module: src/views/order/

📋 用例分类
  前端: 3 条  |  后端: 1 条  |  全栈: 1 条
  ⏭️ 后端用例（1 条，跳过代码检查）：SMK-006 自动审核逻辑

P0 Cases:  2/2 passed ✅
P1 Cases:  2/3 passed ⚠️

Details:
  ✅ SMK-001 正常下单 — all paths verified
  ✅ SMK-002 库存不足 — guard clause present, message correct
  ⚠️ SMK-003 未登录下单 — login redirect exists but missing return URL
  ✅ SMK-004 金额校验 — validation in place
  ❌ SMK-005 重复提交 — no debounce/throttle on submit button (auto-fixed)

Auto-fixes applied:
  🔧 src/views/order/create.vue:45 — added :loading to submit button (debounce)
  ⚠️ src/router/index.ts — SMK-003: login redirect needs returnUrl param (manual)

Modified files: 2
Manual TODOs:    1

```

## Key Principles

- **P0 用例不通过 = 不可发布** — 核心流程必须 100% 覆盖
- **先读代码再动手** — 理解现有实现后再修复，不大规模重写
- **修复标注来源** — 自动修复的代码带注释 `// SMK-XXX: auto-fixed by /lg-smoke`
- **不可自动修复的不强行改** — 标注 `⚠️ MANUAL_REQUIRED` 让开发者处理

## Integration with Other Skills

```

/lg-smoke 检查 → 发现规范问题 → 触发 /review
/lg-smoke 检查 → 发现缺少组件 → 触发 /component
/lg-smoke 检查 → 发现缺少测试 → 触发 /test

```

---

## 🐛 Bugs Pipeline (--bugs)

Triggered when user passes `--bugs` flag. Fetches 云效 bugs, displays them, fixes code, and updates bug status.

### Step B0: 加载配置 + 校验

Read `smoke-config.json` → `sources.yunxiao` + `bugs` section.

**前置校验**：
```
organizationId 为空？ → ❌ 终止：请先配置 organizationId
spaceId 为空？      → ❌ 终止：请先配置 spaceId
  ↓ 都 OK
继续
```

### Step B1: 选择迭代版本

Call `list_sprints(organizationId, projectId=spaceId)` to fetch all sprints.

**展示迭代列表**：

```
📋 项目 "群创引擎-管理端" 的迭代列表

| # | 迭代名称      | 状态   | 时间范围                    |
|---|---------------|--------|-----------------------------|
| 1 | V1.4.5.1      | 进行中 | 2026-05-01 ~ 2026-06-15     |
| 2 | V1.4.5.0      | 已关闭 | 2026-04-01 ~ 2026-04-30     |
| 3 | V1.4.4.0      | 已关闭 | 2026-03-01 ~ 2026-03-31     |

请选择迭代 [1-3，默认=1，输入编号]：
```

**Note**: If smoke-config.json already has `versionId` set, skip selection and use it directly.

### Step B2: 拉取缺陷列表

Call `search_workitems`:
```
category=Bug
spaceId=<spaceId>
sprint=<selected sprint id>
```

**展示格式**（状态过滤前展示全部，然后标注跳过）：

```
🐛 V1.4.5.1 迭代缺陷：拉取 12 条 | 跳过 4 条 | 待处理 8 条

| ID       | 标题                  | 优先级  | 状态   | 严重程度 | 处理人 |
|----------|-----------------------|--------|--------|---------|--------|
| BUG-001  | 支付金额计算错误        | P0     | 待处理  | 严重    | 张三   |
| BUG-002  | 列表页筛选后数据不刷新   | P1     | 处理中  | 一般    | 李四   |
| BUG-003  | 图片上传偶发失败        | P1     | 待处理  | 一般    | —      |
| BUG-008  | 样式兼容性问题          | P2     | 已关闭  | 轻微    | ⏭️ 跳过 |
| BUG-010  | 安全漏洞-已修复         | P0     | 无法复现 | 严重   | ⏭️ 跳过 |

P0: 1 个（有效）| P1: 2 个 | P2: 0 个 | 已跳过: 4 个
```

**状态过滤规则**（`bugs.skipStatuses`）：已关闭、无法复现、重复、延期处理、不予修复 → 跳过，不进入修复流程。

### Step B3: 匹配代码范围

Each bug's title + description is analyzed to determine code scope:

| 缺陷关键词 | 匹配代码范围 |
|---|---|
| 支付、金额、订单 | `src/views/order/`, `src/api/order*`, `src/constants/order*` |
| 列表、表格、筛选 | `src/views/*/list*`, `src/components/*/table*` |
| 上传、图片、文件 | `src/components/upload*`, `src/api/upload*` |
| 登录、权限、认证 | `src/views/auth/`, `src/stores/useUser*`, `src/router/` |
| 未匹配到 | 搜索 bug 标题中的业务名词，尝试匹配 views/api 目录 |

**Rule**: If scope can't be determined, ask user to specify.

### Step B4: 逐条检查 + 修复

For each ACTIVE bug (not skipped):

1. **读缺陷详情** — `get_work_item(bugId)` → 获取描述、重现步骤
2. **定位代码** — 在匹配的范围内搜索相关逻辑
3. **诊断根因** — 对比代码逻辑与缺陷描述
4. **自动修复**（同 Step 3 的修复能力表）
5. **等待验证**：修复完成后不自动更新云效缺陷状态，添加评论记录修复信息：
   - `create_work_item_comment(bugId, "🔧 /lg-smoke 自动修复：{修复摘要}。请在本地验证后手动更新缺陷状态。")`
   - 缺陷状态保持原样，由开发者在验证通过后手动流转

### Step B5: 生成报告

```
🐛 Bug Fix Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Sprint: V1.4.5.1 (4d073eb633...)
Bugs: 8 active / 12 total

✅ Fixed (3):
  🔧 BUG-001 支付金额计算错误 → src/api/order.ts:45 (decimal precision)
  🔧 BUG-002 列表页筛选不刷新 → src/views/order/list.vue:78 (missing watch)
  🔧 BUG-005 空状态文案错误 → src/views/product/list.vue:30 (text update)

⚠️ Partial Fix (1):
  BUG-003 图片上传偶发失败 → added loading state + retry (root cause unclear)

🔍 Needs Manual (4):
  BUG-006 复杂业务逻辑 — requires product owner input
  BUG-007 第三方SDK兼容性问题 — cannot fix in project code
  BUG-009 性能优化 — needs profiling data
  BUG-012 架构层面问题 — needs team discussion

  云效评论已添加: 3 条修复备注（缺陷状态未变更，等待人工验证）
```

### --bugs Flow Summary

```
/lg-smoke --bugs
  ↓
B0: 校验 organizationId + spaceId
  ↓
B1: 展示迭代列表 → 用户选择
  ↓
B2: 拉取缺陷 → 状态过滤 → 展示列表 → ⛔ 用户确认
  ↓
B3: 匹配代码范围（关键词 + 用户指定）
  ↓
B4: 逐条检查 + 修复 + 更新云效状态
  ↓
B5: 生成报告
```

---

## 📊 Analyze Pipeline (--analyze)

Triggered when user passes `--analyze` flag. Performs retrospective analysis: why do bugs still occur when smoke tests all pass? Identifies development blind spots and product documentation gaps.

### 流程总览

```
前置: 解析 owner → 拉取冒烟用例 + Bug 列表 → 过滤负责人
  │
  ▼
Phase 1: 规则分类 (Claude 推理)
  6 维度关键词匹配 → Bug 打标签 + 置信度
  │
  ▼
Phase 2: AI 深度分析 (调用 analyze-bugs.mjs)
  Qwen-Max 逐 Bug 分析 → 根因 + 开发盲区 + 文档缺口
  │
  ▼
Phase 3: 报告生成 (Claude 推理 + xlsx 脚本)
  report.md + smoke-supplement.xlsx + doc-supplement.md
  │
  ▼ (用户审核后 --apply)
可选: 合入冒烟用例库
```

### Step A0: 加载配置 + 参数解析

**读取配置**：
1. 读取 `.claude/config/lg-config.json` → `dashscope_api_key`、`analysis_dir`
2. 读取 `.claude/config/lg-smoke.json` → `sources.yunxiao`、`bugs`

**解析 --owner**（三级优先级）：
1. CLI 参数 `--owner <userId>` → 直接使用
2. 配置文件 `lg-smoke.json` → `yunxiao.userId` → 若不为空则使用
3. 默认 `me` → 调用 `mcp__yunxiao__get_current_user()` 获取当前用户 ID

**前置校验**：
```
organizationId 为空？ → ❌ 终止：请先 lg-init 配置 organizationId
spaceId 为空？      → ❌ 终止：请先 lg-init 配置 spaceId
--version 未传？    → ❌ 终止：请指定 --version <版本号>
  ↓ 都 OK
继续
```

### Step A1: 拉取冒烟用例

**1. 匹配测试计划**：
Call `mcp__yunxiao__list_test_plans({ organizationId })`。

按 `lg-smoke.json` 中 `testPlan.namePattern` 匹配测试计划（将 `{version}` 替换为实际版本号）。

**展示**：
```
📋 版本 {version} 测试计划
匹配到: "{version}版本前端冒烟用例" (planId: xxx)
```

**2. 拉取用例列表**：
Call `mcp__yunxiao__get_test_result_list({ organizationId, testPlanIdentifier })` 获取所有用例。

**3. 过滤用例**：
- 按 `lg-smoke.json` → `platform.current` 过滤平台
- 按 `yunxiao.skipStatuses` 跳过暂缓/已废弃/重复状态
- 提取：标题、模块、步骤、预期结果

**4. 展示用例摘要**：
```
📝 冒烟用例: 共 {N} 条
模块分布: 订单(5) | 支付(3) | 用户(2) | ...
```

### Step A2: 拉取工作项列表

**1. 选择迭代**：
Call `mcp__yunxiao__list_sprints({ organizationId, projectId: spaceId })`。

如果 `lg-smoke.json` 中 `versionId` 已配置，跳过选择直接使用。否则展示迭代列表让用户选择：

```
📋 项目迭代列表
| # | 迭代名称  | 状态   | 时间范围                |
|---|-----------|--------|-------------------------|
| 1 | V1.4.6    | 进行中 | 2026-06-01 ~ 2026-06-30 |
| 2 | V1.4.5    | 已关闭 | 2026-05-01 ~ 2026-05-31 |

请选择迭代 [1-2]:
```

**2. 拉取工作项**：
Call `mcp__yunxiao__search_workitems({ category: "Bug", spaceId, sprint: selectedSprintId, assignedTo: ownerId })`。

云效中三种工作项类型（**缺陷** / **线上故障** / **优化**）同属 `category=Bug`，一次查询全部返回。按返回结果的 `workitemType.name` 字段区分类型：
- `workitemType.name = "缺陷"` → 🐛 缺陷 (Bug)
- `workitemType.name = "线上故障"` → 🔥 线上故障 (Fault)
- `workitemType.name = "优化"` → ⚡ 优化 (Optimize)

**3. `--type` 参数过滤**（在拉取后按类型筛选）：
- `--type bug` → 仅分析 `workitemType.name = "缺陷"`
- `--type fault` → 仅分析 `workitemType.name = "线上故障"`
- `--type optimize` → 仅分析 `workitemType.name = "优化"`
- 不传 `--type` → 分析全部三种类型

**4. 按类型分组展示**：
```
📋 版本 {version} 工作项: 拉取 {total} 条 | 跳过 {skipped} 条 | 待分析 {active} 条

🐛 缺陷 ({bugCount}条):
| ID       | 标题                | 优先级 | 状态   | 严重程度 |
|----------|---------------------|--------|--------|---------|
| QCNI-918 | 图文商单显示...      | 中     | 已关闭  | 一般    |

🔥 线上故障 ({faultCount}条):
| ID       | 标题                | 优先级 | 状态   | 严重程度 |
|----------|---------------------|--------|--------|---------|
| —        | —                   | —      | —      | —       |

⚡ 优化 ({optCount}条):
| ID       | 标题                | 优先级 | 状态   | 严重程度 |
|----------|---------------------|--------|--------|---------|
| —        | —                   | —      | —      | —       |
```

**5. 状态过滤**：
按 `lg-smoke.json` → `bugs.skipStatuses` 跳过。三种类型共用同一套跳过规则。

**边界处理**：
- 过滤后工作项总数为 0 → 提示 "✅ 该版本你名下无有效工作项，无需分析"，正常退出
- `--owner` 指定的 userId 无效 → 提示 "未找到该负责人"，中断
- `--type` 指定类型无匹配 → 提示 "该版本下无 {type} 类型工作项"

### Step A3: 拉取工作项详情

对每个待分析工作项，调用 `mcp__yunxiao__get_work_item({ organizationId, workItemId })` 获取完整信息：

- 详细描述（description）
- 复现步骤（从 description 中提取或 customFields）
- 关联模块/版本
- **工作项类型** (`workitemType.name`) — 用于后续分类分析

**进度展示**：
```
📥 拉取工作项详情: [3/8] 🐛 QCNI-903 图片上传偶发失败
```

### Phase 1: 规则分类引擎 (Claude 推理)

对每个工作项，按**类型**应用不同维度规则，打标签 + 计算置信度。

#### 通用维度（全部类型）

**1. COVERAGE_GAP — 冒烟覆盖盲区**
- 从工作项标题/描述中提取业务关键词（分词 → 去停用词 → 取名词）
- 在冒烟用例标题集合中逐一搜索
- 相似度 < 30% → 标记为覆盖盲区（置信度 0.7-0.9）
- 或冒烟用例总数 < 5 且工作项数 > 10 → 标记为覆盖盲区（置信度 0.5）

**2. BOUNDARY — 边界条件遗漏**
- 工作项描述含任一关键词：超过、超出、极限、为空、0、负数、最大值、最小值、超长、特殊字符、空值、null、undefined
- → 标记为边界遗漏（置信度 0.8-1.0，精确命中高；0.5-0.7，模糊关联中）

**3. STATE_DEP — 状态依赖遗漏**
- 工作项描述含任一关键词：先后、前提、并发、同时、切换、跳转后、返回后、回调、异步、轮询、定时
- 或工作项复现步骤 ≥ 3 步且冒烟用例均 ≤ 2 步
- → 标记为状态依赖（置信度 0.7-0.9）

**4. MULTI_MODULE — 多模块联动**
- 工作项涉及 ≥ 2 个不同模块（从标题/描述提取模块名，比对冒烟用例的模块分布）
- 或工作项标题含两个以上业务领域名词
- → 标记为多模块联动（置信度 0.7-0.9）

**5. ENV_DIFF — 环境/数据差异**
- 工作项描述含任一关键词：线上、生产、正式环境、数据不一致、权限不同、配置不同、量级
- → 标记为环境差异（置信度 0.8-1.0）

**6. UNEXPECTED_PATH — 用户非预期路径**
- 工作项描述含任一关键词：返回键、浏览器后退、刷新、直接输入URL、跳过、双击、快速点击、前进、F5
- → 标记为非预期路径（置信度 0.7-1.0）

#### 🐛 缺陷专属维度

缺陷类型使用以上全部 6 个通用维度，无额外专属维度。

#### 🔥 线上故障专属维度

对 `workitemType.name = "线上故障"` 的工作项，额外检查以下维度：

**7. MONITOR_GAP — 监控告警盲区**
- 故障描述含任一关键词：未告警、未监控、无报警、未发现、日志缺失、未上报
- 或故障发生到发现时间 > 30 分钟
- → 标记为监控盲区（置信度 0.8-1.0）

**8. ROLLBACK_MISSING — 回滚/兜底缺失**
- 故障描述含任一关键词：无法回滚、回滚失败、无兜底、无降级、无熔断、全量发布
- → 标记为回滚缺失（置信度 0.8-1.0）

**9. ESCALATION_GAP — 升级机制缺失**
- 故障描述含任一关键词：未通知、未上报、无人知晓、处理不及时、响应慢
- → 标记为升级机制缺失（置信度 0.7-0.9）

#### ⚡ 优化专属维度

对 `workitemType.name = "优化"` 的工作项，额外检查以下维度：

**10. UX_GAP — 用户体验差距**
- 优化描述含任一关键词：体验差、操作繁琐、步骤多、不直观、难找、看不清、加载慢、卡顿
- → 标记为UX差距（置信度 0.8-1.0）

**11. TECH_DEBT — 技术债积累**
- 优化描述含任一关键词：重构、优化性能、代码质量、架构、扩展性、维护困难
- → 标记为技术债（置信度 0.7-0.9）

**12. EFFICIENCY_GAP — 效率提升空间**
- 优化描述含任一关键词：自动化、批量操作、导入导出、模板、快捷操作
- → 标记为效率提升（置信度 0.7-0.9）

#### 展示分类摘要

分类完成后按类型分组展示：
```
🏷️  规则分类完成

🐛 缺陷 ({bugCount}个) 命中维度:
| 维度           | 命中数 | 涉及工作项 ID        |
|----------------|--------|---------------------|
| 覆盖盲区        | 2      | QCNI-904, QCNI-907  |
| 边界遗漏        | 4      | QCNI-901, ...       |
...

🔥 线上故障 ({faultCount}个) 命中维度:
| 维度           | 命中数 | 涉及工作项 ID        |
|----------------|--------|---------------------|
| 监控盲区        | 1      | FAULT-001           |
| 回滚缺失        | 1      | FAULT-001           |
...

⚡ 优化 ({optCount}个) 命中维度:
| 维度           | 命中数 | 涉及工作项 ID        |
|----------------|--------|---------------------|
| UX差距          | 2      | OPT-001, OPT-002    |
| 技术债          | 1      | OPT-003             |
...
```

### Phase 2: AI 深度分析

**输入准备**：将 Phase 1 产出的 taggedBugs + 冒烟用例摘要组装为 JSON，通过 stdin 传给 `analyze-bugs.mjs` 脚本。

构建 input JSON（每个工作项标注 `workItemType` 和 `serialNumber`）：
```json
{
  "version": "{version}",
  "bugs": [
    {
      "bugId": "QCNI-901",
      "serialNumber": "QCNI-901",
      "workItemType": "缺陷",
      "title": "订单支付后状态未更新",
      "description": "...",
      "steps": "1.发起支付 2.支付成功 3.返回订单页",
      "tags": [
        { "dimension": "STATE_DEP", "confidence": 0.85, "trigger": "支付回调时序问题" }
      ]
    },
    {
      "bugId": "FAULT-001",
      "serialNumber": "FAULT-001",
      "workItemType": "线上故障",
      "title": "订单服务不可用30分钟",
      "description": "...",
      "steps": "...",
      "tags": [
        { "dimension": "MONITOR_GAP", "confidence": 0.9, "trigger": "未配置服务可用性监控" }
      ]
    }
  ],
  "smokeCases": { "total": 25, "modules": [...], "cases": [...] },
  "dashscopeApiKey": "{从 lg-config.json 读取}",
  "outputDir": "{analysis_dir}/{version}/bug-analysis/ai-results/"
}
```

**调用脚本**：

使用 Bash 工具执行：
```bash
echo '<input_json>' | node .claude/skills/lg-scripts/analyze-bugs.mjs
```

**并发处理**：脚本内部逐 Bug 串行调用（避免 API 限流），每个 Bug 分析结果独立存为 JSON 文件。

**进度展示**：
```
🤖 AI 深度分析中...
[1/8] 分析 Bug: 支付金额计算错误 → 根因: 折扣叠加计算未考虑优先级
[2/8] 分析 Bug: 列表页筛选不刷新 → 根因: watch 未监听筛选参数变化
...
[8/8] ✅ AI 分析完成: 8/8 成功
```

**异常处理**：
- 脚本返回 `error` 字段的 Bug → 在报告中标注 "AI 分析不可用，使用规则分类结果"
- 脚本完全失败 → 降级为纯规则报告

### Phase 3: 报告生成

从脚本输出和 Phase 1 结果中汇总数据，生成 3 个产出文件。

#### 产出目录

```
{analysis_dir}/{version}/workitem-analysis/
├── report.md               # 主分析报告（按类型分组）
├── smoke-supplement.csv    # 补充冒烟用例
└── doc-supplement.md       # 产品文档补充建议
```

其中 `analysis_dir` 来自 `lg-config.json`，默认为 `./..lg-docs/analysis/`。

#### 3.1 生成 report.md

按照以下模板，用分析结果填充，使用 Write 工具写入文件。**报告按工作项类型分组展示**：

```markdown
# 版本 {version} 冒烟回溯分析报告

> 分析时间: {YYYY-MM-DD} | 分析范围: {ownerName} | 冒烟用例总数: {m}
> 工作项: 🐛缺陷 {bugCount} | 🔥线上故障 {faultCount} | ⚡优化 {optCount}

## 📊 概览

### 🐛 缺陷维度分布
| 维度 | 命中数 | 占比 |
|------|--------|------|
| 冒烟覆盖盲区 | {count} | {percent}% |
| 边界条件遗漏 | {count} | {percent}% |
| 状态依赖遗漏 | {count} | {percent}% |
| 多模块联动 | {count} | {percent}% |
| 环境数据差异 | {count} | {percent}% |
| 非预期路径 | {count} | {percent}% |

### 🔥 线上故障维度分布
| 维度 | 命中数 | 占比 |
|------|--------|------|
| 监控告警盲区 | {count} | {percent}% |
| 回滚/兜底缺失 | {count} | {percent}% |
| 升级机制缺失 | {count} | {percent}% |

### ⚡ 优化维度分布
| 维度 | 命中数 | 占比 |
|------|--------|------|
| 用户体验差距 | {count} | {percent}% |
| 技术债积累 | {count} | {percent}% |
| 效率提升空间 | {count} | {percent}% |

> 注：一个工作项可能属于多个维度。无数据的类型不展示。

## 🔍 按维度汇总

### 🐛 缺陷维度
（每个有 Bug 的维度一节，归纳 Top 模式）

### 🔥 线上故障维度
（每个有故障的维度一节，含监控/回滚/升级建议）

### ⚡ 优化维度
（每个有优化的维度一节，含效率提升建议）

## 📋 逐工作项深度分析

### 🐛 缺陷
### #{bugId}: {title}
- **类型**: 缺陷
- **根本原因**: {root_cause}
- **为什么冒烟没测出来**: {why_smoke_missed}
- **开发思维盲区**: {dev_blind_spot}
- **产品文档缺失**: {doc_gap}
- **建议补充冒烟用例**: {smoke_supplement.scenario}

---

### 🔥 线上故障
### #{faultId}: {title}
- **类型**: 线上故障
- **故障影响范围**: {impact}
- **监控覆盖情况**: {monitor_status}
- **回滚方案**: {rollback_plan}
- **建议补充冒烟用例**: {smoke_supplement.scenario}
- **建议补充监控告警**: {monitor_supplement}

---

### ⚡ 优化
### #{optId}: {title}
- **类型**: 优化
- **优化方向**: {optimize_direction}
- **预期收益**: {expected_benefit}
- **建议补充冒烟用例**: {smoke_supplement.scenario}

---
（每个工作项一节）
```

#### 3.2 生成 smoke-supplement.xlsx

从每个 Bug 的 `smoke_supplement` 字段提取数据，生成 xlsx 文件。

用 Write 工具创建 CSV 文件（xlsx 兼容），包含以下列：
ID | 模块 | 场景 | 优先级 | 前置条件 | 步骤 | 预期 | 来源 | 关联Bug

ID 格式：`S-ANALYZE-{序号}`（从 001 开始），来源统一填 `bug-analysis`。

如果有 `lg-scripts/generate-xlsx.mjs` 脚本可用，可尝试用脚本生成 xlsx；否则用 CSV 作为降级方案。

**Sheet "模块统计"**: 按模块和优先级汇总数量。

#### 3.3 生成 doc-supplement.md

按照以下模板，用分析结果填充，使用 Write 工具写入文件：

```markdown
# 版本 {version} 产品文档补充建议

> 基于 {n} 个 Bug 的深度分析，建议在以下方面补充产品文档。

## 功能规则类
（汇总 doc_gap 中关于功能规则、业务逻辑的内容）
### {章节名}
- **缺失规则**: ...
- **建议补充内容**: ...
- **关联 Bug**: #XXX

## 边界约束类
（汇总关于输入限制、数值范围、字符长度的内容）
...

## 交互路径类
（汇总关于操作流程、页面跳转、用户路径的内容）
...

## 状态说明类
（汇总关于状态转换、状态依赖、状态展示的内容）
...

## 异常处理类
（汇总关于错误处理、异常情况、降级策略的内容）
...
```

对 AI 分析返回的 `doc_supplement_suggestion` 按 5 个类别进行分类汇总：
- 功能规则类：关于业务规则、计算逻辑、校验规则
- 边界约束类：关于输入限制、数值范围、字符长度
- 交互路径类：关于操作流程、页面跳转、非预期操作
- 状态说明类：关于状态转换、状态依赖、状态展示
- 异常处理类：关于错误处理、超时、降级策略

#### 3.4 展示完成摘要

```
✅ 冒烟回溯分析完成

📄 产出文件:
  report.md             → {analysis_dir}/{version}/workitem-analysis/report.md
  smoke-supplement.csv  → {analysis_dir}/{version}/workitem-analysis/smoke-supplement.csv
  doc-supplement.md     → {analysis_dir}/{version}/workitem-analysis/doc-supplement.md

📊 分析摘要:
  🐛缺陷: {bugCount} | 🔥线上故障: {faultCount} | ⚡优化: {optCount}
  命中维度: {dims} | AI 深度分析: {aiCount}/{total} 成功

💡 下一步:
  1. 审核 report.md，确认分析质量
  2. 如需将补充用例合入正式冒烟用例库，执行:
     /lg-smoke --analyze --apply
```

### --apply: 合入补充冒烟用例

用户审核报告后，执行 `/lg-smoke --analyze --apply`。

**前提**：Phase 3 已经执行过，`smoke-supplement.xlsx` 文件存在。
如果文件不存在 → 提示 "请先运行 /lg-smoke --analyze 生成分析报告"。

**合入步骤**：

1. 读取 `smoke-supplement.xlsx`（或 CSV 降级文件）中的"冒烟用例" Sheet
2. 读取 `smoke_cases_dir/{version}/` 目录（来自 lg-config.json）中的现有冒烟用例文件
3. 按 场景+模块 去重合并：
   - 场景和模块完全相同的 → 跳过
   - 新增的 → 追加
4. 写回文件
5. 输出结果：

```
📥 合入结果:
  新增: {added} 条冒烟用例
  跳过: {skipped} 条（已存在）
  来源标注: bug-analysis

  补充用例已合入 {smoke_cases_dir}/{version}/冒烟用例.xlsx
  ⚠️ 云效测试计划未自动同步，请手动上传
```

### --analyze Flow Summary

```
/lg-smoke --analyze --version <version> [--type bug|fault|optimize]
  ↓
A0: 解析 owner (CLI > config > me) + --type 参数 + 校验配置
  ↓
A1: 拉取冒烟用例 → 过滤平台 + 状态
  ↓
A2: 选择迭代 → 拉取工作项(缺陷+故障+优化) → 按类型分组 → ⛔ 用户确认
  ↓
A3: 逐条拉取工作项详情（含 workitemType 标记）
  ↓
Phase 1: 规则分类 (通用6维度 + 故障3维度 + 优化3维度)
  ↓
Phase 2: AI 深度分析 (每个工作项标注 workItemType)
  ↓
Phase 3: 生成 report.md + smoke-supplement.csv + doc-supplement.md
  ↓ (用户审核后)
--apply: 合入补充用例到冒烟用例库
```
