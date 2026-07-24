---
name: lg-review
description: 代码审查，对比需求文档和冒烟用例验证实现
---
# /lg-review — Code Review

全面代码审查，根据变更影响面自动选择审查深度，覆盖 15 个审查维度，自适应集成项目已有自动化工具。

## When to Use

- "Review my changes"
- "Review commits from the last 2 days"
- "Review PR #123"
- "Check this branch before pushing"

---

## Step 0: Determine Review Mode

根据变更规模和影响面自动匹配审查模式，也可手动指定。

| Mode | 触发条件 | 审查范围 | 适用场景 |
|---|---|---|---|
| ⚡ **快速审 (Quick)** | ≤3 文件变更 且 ≤50 行 diff | Error 级全维度 + 自动化检查 | 小改动 / Hotfix |
| 📋 **完整审 (Full)** | 默认模式 | 全部 14 维度 Error + Warn + Suggest + 自动化 | 常规 PR / 迭代上线 |
| 🔬 **深度审 (Deep)** | 核心模块 / 共享组件 / 类型定义变更 / ≥20 文件变更 | 完整审 + Step 5 跨文件影响分析 + 回归风险评估 | 核心变更 / 架构调整 |

**手动指定：**

```
/lg-review quick    — 强制快速审
/lg-review full     — 强制完整审
/lg-review deep     — 强制深度审
```

**核心模块判定规则：** 变更命中以下条件之一自动升级为深度审：
- `src/types/`、`src/constants/` 下的共享类型/常量
- `src/components/common/` 下的公共组件
- `src/api/` 中的 API 签名变更
- `src/router/` 路由配置变更
- `src/store/` 状态管理变更

---

## Step 1: Determine Review Boundary

```bash
# Single commit
git diff HEAD~1

# Multiple commits
git diff origin/main..HEAD

# Uncommitted changes
git diff + git status

# Specific commit range
git diff <base>..<head>
```

### Commit Listing（提交清单）

**当审查范围为 commit 区间时，必须在报告开头列出被检查的提交。**

```bash
# 获取区间内的 commit 列表
git log --oneline <base>..<head>
```

**输出规则：**

```
提交数 ≤ 10 → 逐条列出所有 commit
提交数 > 10 → 显示总数 + 第一条 + 最后一条

格式示例（≤ 10）：
  📜 检查提交 (3):
     abc1234 fix: 修复登录页样式
     def5678 feat: 新增用户列表筛选
     ghi9012 refactor: 重构权限校验

格式示例（> 10）：
  📜 检查提交 (15):
     首: abc1234 fix: 初始提交
     末: xyz9012 feat: 最新功能
     共 15 个提交，省略中间 13 个
```

**未提交工作区变更时的替代显示：**

```
📜 检查范围:
    工作区未提交变更 (working tree)
    + 暂存区变更 (staged)
```

Group changed files by type for targeted review:
- `.vue` / `.tsx` / `.jsx` — component structure, template, styles
- `.ts` / `.js` — logic, types, API calls
- `.less` / `.scss` / `.css` — styles, tokens
- `.json` / `.yaml` — config, i18n, dependencies
- Other — docs, scripts

### Scope-Based Analysis

| Change Type | Analysis Depth |
|---|---|
| New file | Full review |
| Modified file | Diff lines ± 5 context lines |
| Deleted file | Check for remaining references (router, imports, component map, barrel exports) |
| Cross-file | If file A changes API/type signature, check all consumers of file A |
| Data flow refactoring | 新增中间状态/延迟赋值/事件驱动的状态流转 → 检查**未变更的模板 v-if 条件**是否覆盖新状态 |
| Shared module | Trigger Deep mode — trace entire dependency graph |

---

## Step 2: Pre-Review Automation (Adaptive)

**仅检查项目实际配置的工具，没有则静默跳过。** 每个工具检查后输出结果摘要。

### 2.1 检测项目可用工具

```bash
# 检测包管理器和可用脚本
cat package.json 2>/dev/null | python3 -c "
import json,sys
try:
    pkg = json.load(sys.stdin)
    scripts = pkg.get('scripts', {})
    deps = {**pkg.get('dependencies',{}), **pkg.get('devDependencies',{})}
    
    checks = {
        'eslint': 'eslint' in scripts or 'eslint' in deps or '.eslintrc' in globals().get('files',''),
        'typescript': 'typescript' in deps or 'tsc' in scripts,
        'prettier': 'prettier' in scripts or 'prettier' in deps or '.prettierrc' in globals().get('files',''),
        'stylelint': 'stylelint' in scripts or 'stylelint' in deps or '.stylelintrc' in globals().get('files',''),
        'test': 'test' in scripts or 'jest' in deps or 'vitest' in deps or 'mocha' in deps,
        'oxlint': 'oxlint' in scripts or 'oxlint' in deps,
        'biome': '@biomejs/biome' in deps,
    }
    print(json.dumps(checks, indent=2))
except: print('{}')
"
```

### 2.2 执行可用检查

| 工具 | 检测条件 | 执行方式 |
|---|---|---|
| ESLint | `.eslintrc.*` 或 `eslint` 在 package.json | `npx eslint <changed-files> --quiet 2>&1 \|\| true` |
| Oxlint | `oxlint` 在 devDependencies | `npx oxlint <changed-files> 2>&1 \|\| true` |
| TypeScript | `tsconfig.json` 存在 | `npx tsc --noEmit 2>&1 \|\| true` |
| Prettier | `.prettierrc*` 存在 | `npx prettier --check <changed-files> 2>&1 \|\| true` |
| Stylelint | `.stylelintrc*` 存在 | `npx stylelint <changed-files> 2>&1 \|\| true` |
| Biome | `@biomejs/biome` 在 devDependencies | `npx biome check <changed-files> 2>&1 \|\| true` |
| Unit Test | 定位变更文件对应的 `*.test.*` / `*.spec.*` / `__tests__/` | `npx jest --findRelatedTests <changed-files> --passWithNoTests 2>&1 \|\| true` |

### 2.3 汇总自动化结果

自动化检查结果作为审查报告的独立部分，在维度审查之前输出。标记方式：
- 🟢 通过 / 未检测到该工具
- 🔴 发现 Error/Warning（列出具体文件与行号）

---

## Step 3: 14-Dimension Review

### 📋 1. 正常业务场景 (Normal Business)

检查功能逻辑是否符合业务预期：

- 功能逻辑是否完整覆盖需求？是否存在遗漏的分支？
- 数据流是否正确：接口字段映射、状态传递、组件通信是否准确？
- 组件/模块拆分是否合理？是否遵循单一职责？
- 关键业务流程是否有对应的代码路径覆盖？
- 表单提交/保存逻辑：必填项校验、数据格式校验是否完整？

---

### ⚠️ 2. 异常场景 (Exception Scenarios)

#### 2.1 🌐 请求交互类异常

**网络异常 / 请求失败：**

- 是否有统一的请求错误拦截（axios/fetch interceptor）处理网络异常？ → Error
- 局部请求是否有独立的 catch 处理？不能仅依赖全局拦截，关键操作需局部兜底 → Warn
- 请求失败后是否有用户可感知的提示（Toast/Message/Notification）？ → Warn
- 请求失败后是否有重试机制（自动重试 / 手动重试按钮）？ → Suggest
- 请求超时是否设置了合理的 timeout？是否有超时提示？ → Warn
- 断网场景下页面是否可用（离线提示 / 缓存兜底）？ → Suggest

**高并发重复请求：**

- 提交按钮是否有防重复点击处理（loading 状态 / disabled / 防抖）？ → Error
- 同一接口短时间内是否可能被重复调用（如列表 + 筛选项变化同时触发）？需做请求锁或竞态处理 → Warn
- 搜索/筛选输入是否有防抖（debounce 300-500ms）？ → Warn
- 滚动加载是否有"加载中"状态防止重复触发？ → Warn
- 是否存在滥用 `Promise.all` 导致同一接口并发多次？ → Suggest

#### 2.2 📊 状态数据类异常

**详情数据不存在：**

- 详情页数据为空/null 时是否有处理？（如：显示"数据不存在"/"已删除"提示 + 返回上一页按钮） → Error
- 路由参数（如 id）无效或不存在时是否有校验和跳转？ → Error
- 列表跳转详情时，是否校验了数据存在性？ → Warn

**单个值/字段数据不存在：**

- 接口返回字段为 null/undefined 时是否有默认值兜底？ → Error
  - 文本类：默认 `-` 或 `''`
  - 数值类：默认 `0` 或 `-`
  - 数组类：默认 `[]`
  - 对象类：使用可选链 `?.` 或默认 `{}`
- 模板中展示数据是否使用了可选链或默认值（`data?.name ?? '-'`）？ → Error
- 枚举值未匹配时是否有 fallback 展示？ → Warn

**状态流程变更异常：**

- 变更状态前是否校验了当前状态是否允许变更？（如：只有"待审核"状态才能审核通过） → Error
- 后端返回状态变更失败时前端是否正确提示并刷新？ → Warn
- 状态流转是否有完整的枚举覆盖？遗漏的状态是否有兜底展示？ → Warn
- 乐观更新后接口失败是否回滚了前端状态？ → Warn

#### 2.3 🔄 操作流程类异常

**重复操作（防重复提交）：**

- 新增/创建操作：是否有唯一键约束提示处理？（如：名称已存在、重复数据 → 后端返回 409/duplicate 时的前端提示） → Error
- 网络波动场景：提交后未响应，用户再次点击。是否有提交锁/loading 防止生成重复数据？ → Error
- 编辑操作：并发编辑是否有乐观锁/版本号校验（如 `version` 字段）？ → Warn
- 删除操作：是否有二次确认弹窗防止误删？ → Warn

**版本更新 / 历史版本兼容：**

- 新增字段是否兼容旧数据（旧数据该字段为空时的表现）？ → Error
- 字段类型变更是否兼容历史数据（如 string→number, 单值→数组）？ → Error
- 页面路由/参数格式变更是否有重定向兼容旧链接？ → Warn
- 本地缓存/Storage 数据结构变更是否有版本号和迁移逻辑？ → Warn
- API 版本升级是否向后兼容？不兼容时是否有版本隔离？ → Warn

#### 2.4 🎨 界面渲染类异常

**图片空白/加载失败：**

- `<img>` 标签是否有 `alt` 属性？ → Warn
- 图片加载失败是否有占位图/错误图（`@error` 事件处理）？ → Error
- 用户头像等关键图片是否有默认头像兜底？ → Warn
- 图片 URL 为空/null 时是否显示占位图而非裂图？ → Error

**空数据状态：**

- 列表/表格无数据时是否有 empty state（空状态插图 + 提示文案）？ → Error
- 搜索无结果时是否有区别于初始空态的提示（如"未找到相关结果"）？ → Suggest
- 筛选条件过严导致空结果时是否有"重置筛选"入口？ → Suggest

**大数据量 / 性能：**

- 列表数据超过 100 条是否使用了虚拟滚动/分页？ → Warn
- 图片列表是否有懒加载（lazy loading / Intersection Observer）？ → Warn
- 是否有骨架屏/loading 动画在数据加载期间展示，避免白屏？ → Warn
- 大量 DOM 节点是否会导致页面卡顿？是否有性能监控？ → Suggest
- 大文件/大图上传是否有压缩或分片处理？ → Suggest

#### 2.5 🔐 业务异常

**未登录 / 登录失效：**

- 是否有统一的登录态校验（路由守卫 / 请求拦截）？ → Error
- Token 过期/失效时，是否有统一的 401 拦截 + 跳转登录页？ → Error
- 登录失效后是否能恢复到之前的操作状态（redirect 参数）？ → Warn
- 登录页是否有"记住我"/自动续期逻辑？ → Suggest
- 多 Tab 登录态同步问题：一个 Tab 退出登录，其他 Tab 是否感知？ → Suggest

**角色权限：**

- 页面/路由级别是否有权限控制（router meta.permission / 路由守卫）？ → Error
- 按钮/操作级别是否有权限控制（v-if/v-show 权限判断）？ → Error
- 前端权限控制是否与后端一致？仅前端控制不够，后端必须校验 → Error
- 无权限访问时的提示是否友好（而非直接报错或白屏）？ → Warn
- 不同角色看到的数据范围是否正确（如：普通用户只看自己的数据）？ → Warn

---

### 🔲 3. 边缘场景 (Edge Cases)

**字数限制：**

- 输入框/文本域是否有 `maxlength` 限制（前端 + 后端双重校验）？ → Error
- 超出字数上限时是否有计数器提示（如 `50/200`）？ → Warn
- 字数下限不足时是否有校验提示？（如：密码至少 6 位、评论不能为空） → Error
- 截断展示的文本是否有 Tooltip/展开收起查看完整内容？ → Suggest
- 中英文混合时的字数计算方式是否明确（按字符/按字节）？ → Suggest

**特殊字符限制：**

- 输入框是否对特殊字符做了过滤或转义？（防 XSS） → Error
- 特殊字符输入后的提示是否清晰？（如"不支持特殊字符：<>\"'&"） → Warn
- Emoji/特殊 Unicode 字符是否会导致存储异常或展示乱码？ → Warn
- 空格处理：前后空格是否 trim？中间多个空格是否保留？ → Warn
- URL 参数中的特殊字符是否做了 `encodeURIComponent` 处理？ → Error
- 富文本内容中的 HTML 标签是否做了安全过滤（XSS 防护）？ → Error
- SQL 注入风险：用户输入是否通过参数化查询传递给后端？（后端审查时关注） → Error

**数值边界：**

- 数值输入是否有 min/max 范围限制？ → Warn
- 金额/价格等敏感数值是否有精度处理（避免浮点误差）？ → Error
- 除数为 0 的分支是否有保护？ → Error
- 分页参数异常值（page=0, page=-1, pageSize=99999）是否有防御？ → Warn
- 数组索引越界是否有保护？ → Warn

**状态机转换覆盖：**

- 多步骤状态机（如 `null → pending → confirmed`）的所有转换路径是否可达？ → Error
  - 特别检查初始状态到第一个状态的冷启动路径
- 异步状态流转中是否有路径会"卡住"？（如组件未挂载导致事件无法发出） → Error
- 是否存在循环依赖：A 依赖 B 的状态，B 依赖 A 的事件通知？ → Error

---

### 🎨 4. 样式规范 (Style Conformance)

- Any hardcoded `#xxx`/`rgb()`/`rgba()` in styles? → Error
- Any hardcoded `font-size: Npx` without `var(--font-size-*)`? → Error
- Any hardcoded `padding`/`margin`/`gap` with px values outside tokens? → Warn
- `<style scoped>` missing? → Error
- `/deep/` or `>>>` used instead of `:deep()`? → Error
- Precompiler syntax matches project? → Warn

### 🧩 5. 组件复用 (Component Reuse)

- Does a similar component already exist in `component-map.json`? → Warn if yes
- Using divs where existing components would work? → Warn
- Component in correct directory (common vs business)? → Warn

### 📐 6. 代码规范 (Code Standards)

- Magic numbers/strings in business logic? → Error
- Constants not referenced? → Error
- API call directly in component (not via module)? → Error
- Lifecycle order correct? → Warn
- Route: meta.title and meta.permission defined? → Error (admin)
- Store: state modified directly (not via action)? → Error

### 🔒 7. 安全性 (Security)

- User input not validated/sanitized? → Error
- Sensitive data exposed to client? → Error
- API endpoint missing permission check? → Error
- XSS risk (v-html with user content)? → Error
- Token/session handling issues? → Error

### ⚡ 8. 性能 (Performance)

- Large list without virtual scrolling? → Warn (>100 items)
- Duplicate API requests in same component? → Warn
- Missing `:key` in v-for? → Error
- Unnecessary reactive data (should be const)? → Warn
- Expensive computation without `computed`/`useMemo`? → Warn
- Unoptimized image loading? → Warn

### 🔗 9. 兼容性 (Compatibility)

- Mini program: using `window`/`document`/web API? → Error
- Mini program: using px instead of rpx? → Error
- Mini program: `:hover` used? → Error
- Web: missing responsive breakpoints for mobile? → Warn
- CSS feature with limited browser support? → Warn

### ♿ 10. 无障碍 (Accessibility)

- 交互元素（按钮/链接/输入框）是否有可访问的 label（`aria-label` / `aria-labelledby` / 可见文本）？ → Warn
- 图片是否有有意义的 `alt` 描述（装饰性图片可用空 alt）？ → Warn
- 表单控件是否有关联的 `<label>` 或 `aria-label`？ → Warn
- 颜色是否不是传达信息的唯一方式？（如：错误状态不仅靠红色，还需图标/文字） → Warn
- 键盘导航：`Tab` 键是否能正常遍历所有可交互元素？自定义组件是否实现了键盘事件？ → Warn
- `role` 属性是否正确使用？自定义组件是否有合适的 ARIA role？ → Suggest
- 焦点管理：弹窗/抽屉打开时焦点是否移入？关闭后焦点是否回到触发元素？ → Suggest
- 文本色彩对比度是否满足 WCAG AA（正常文本 4.5:1，大文本 3:1）？ → Suggest

### 🌍 11. 国际化 (Internationalization)

- 模板/JSX 中是否有硬编码的中文/英文文本未使用 `$t()` / `i18n.t()` / `<t>` 包裹？ → Error
- 新增的 i18n key 是否在所有语言的翻译文件中都添加了？（检查 `zh-CN` / `en` 等 locale 文件） → Error
- 日期/货币/数字格式化是否使用了 locale-aware 的格式化函数而非硬编码格式？ → Warn
- 动态拼接的文本是否正确使用了 i18n 的参数插值而非字符串拼接？ → Warn
- `placeholder` / `title` / `aria-label` 等属性中的文本是否也做了国际化？ → Warn
- 图片中包含文字的是否有对应语言版本的替换方案？ → Suggest

### 🧹 12. 代码清理 (Code Cleanup)

- 是否有遗留的 `console.log` / `console.warn` / `debugger` 语句？ → Error
- 是否有被注释掉的代码块（而非删除）？ → Warn
- 是否有未使用的 import / 变量 / 函数？ → Warn
- 是否有空的或占位的 `try-catch` 块（吞掉异常无任何处理）？ → Error
- 是否有 `TODO` / `FIXME` / `HACK` 标记未关联 issue/ticket？ → Warn
- 是否有硬编码的临时 mock 数据未标记移除计划？ → Error
- 是否有废弃的函数/组件未添加 `@deprecated` 标记和迁移指引？ → Suggest

### 💣 13. 内存与资源管理 (Memory & Resources)

- `setInterval` / `setTimeout` 是否在组件销毁时清理（`clearInterval` / `clearTimeout`）？ → Error
- 事件监听器 `addEventListener` 是否在销毁时解绑（`removeEventListener`）？ → Error
- 全局事件总线（EventBus / mitt）的 `$on` / `on` 是否在销毁时 `$off` / `off`？ → Error
- WebSocket / SSE 连接是否在页面/组件卸载时关闭？ → Error
- 观察者（IntersectionObserver / MutationObserver / ResizeObserver）是否在销毁时 `disconnect()`？ → Error
- 异步请求在组件销毁后是否取消了回调（AbortController / cancel token）？避免对已卸载组件的 setState → Warn
- 大对象/数组是否在不再使用时置为 null 或释放引用？大数据缓存是否有容量上限？ → Warn
- 第三方 SDK 实例（地图/视频/图表）是否在销毁时调用 destroy 方法？ → Warn

### 📦 14. 依赖与环境配置 (Dependencies & Config)

- 是否引入了新的第三方依赖？新依赖的体积和维护状态是否经过评估？ → Warn
- 是否硬编码了环境相关的 URL/Key/Secret？（应使用环境变量 `.env.*`） → Error
- 环境变量的变更是否在所有 `.env.*` 文件（`.env.development` / `.env.production` 等）中同步？ → Warn
- `package.json` 中的依赖版本是否从 `*` 或 `latest` 锁定为具体版本？ → Warn
- 是否在 `dependencies` 和 `devDependencies` 之间正确分类？ → Warn
- CI/CD 配置文件（`.github/workflows/` / `Dockerfile` 等）的变更是否与代码变更匹配？ → Suggest
- 是否意外提交了 `.env` / `.env.local` 等敏感配置文件？ → Error

### 🔄 15. Vue/响应式专用 (Framework-Specific)

> **适用项目：Vue / React（检测到 `.vue` / `.tsx` 文件变更时自动启用）**
> 对于非前端项目，此维度静默跳过。

#### 15.1 组件挂载门控 (Component Mount Gate)

**问题场景：** 数据流重构时引入中间状态（如 `pendingGroup`），但模板的 `v-if` / `v-show` 条件未同步更新，导致组件永远无法挂载。

- **`v-if` / `v-show` 条件是否覆盖了所有需要组件渲染的状态？** → Error
  - 检查方法：找出组件所有可能被赋值/使用的场景，逐一确认条件是否为 `true`
  - 特别是新增的中间状态（pending、loading、confirming 等），`v-if` 必须包含它们
- **延迟赋值链路中，组件挂载条件是否在整个链路的最上游就满足？** → Error
  - 例如：`pendingGroup` → `switchConfirmed` → `selectedGroup`，但 `v-if="selectedGroup"` → 死锁
  - 所有模式中只要有一个不满足，从该入口开始的所有逻辑都不会执行
- **条件渲染的组件是否在需要响应事件/emit 时已经挂载？** → Error
  - 如果事件发出方在组件内部（watch、onMounted），但组件未被挂载 → 事件永远不会发出

#### 15.2 Vue Watcher 触发时机 (Watch Timing)

- **新增 `watch(xxx)` 时，是否评估了 `{ immediate: true }` 的必要性？** → Error
  - 判断标准：被监听的值是否在**组件挂载前**就已经被赋值为非默认值？
  - 典型场景：`v-if` 条件满足后组件挂载，此时 prop 已有值 → watch 不触发初始回调
  - 修正：添加 `{ immediate: true }` 并在回调中处理初始值/空值分支
- **`watch` 的 `deep: true` 是否会导致非预期的重复触发？** → Warn
  - 特别是在数据加载（API 返回赋值）后，`deep` watch 可能将刚重置的脏标志重新置回
  - 建议在加载阶段使用 `loading` 标志位跳过 watch，或改为手动标记变更点
- **`watch` 的回调中是否有 emit/状态变更，与所在组件的挂载条件形成循环依赖？** → Error
  - 例如：组件挂载依赖 `selectedGroup`，但只有组件的 watch 能改变 `selectedGroup`

#### 15.3 状态机冷启动 (State Machine Cold Start)

- **多步骤状态机的所有转换路径是否可到达？** → Error
  - 列出所有状态节点和转换条件，验证每个转换都可达
  - 特别是 **初始状态 → 第一个状态** 的冷启动路径
- **异步状态流转中，是否有路径导致状态"卡住"？** → Error
  - 例如：`null → pending → confirmed → selected`，但 `null → pending` 需要组件已挂载
- **是否存在"先有鸡还是先有蛋"的初始化依赖？** → Error
  - 组件 A 依赖状态 X 渲染，但状态 X 只能由组件 A 内部逻辑设置
  - 解法：外部初始化 或 拆分渲染条件

#### 15.4 Props/Emits 契约变更 (Props/Emits Contract)

- **新增 emit 事件是否在父组件中声明了对应的 handler？** → Error
  - 搜索父组件的模板，确认 `@new-event-name="handler"` 存在
- **新增 prop 是否传递了值？** → Error
  - 搜索父组件模板中该子组件的使用处，确认 `:new-prop="value"` 存在
- **prop 的默认值是否与冷启动场景兼容？** → Warn
  - 例如：`default: null`，但首次渲染时期望有值 → 需 `default` 或 `v-if` 守卫

#### 15.5 数据刷新后的 UI 副作用重置 (UI Side-Effect Reset)

**问题场景：** 数据重新加载（切换分组/刷新列表/重新 open）后，表单校验、错误提示、选中状态等 UI 副作用未同步清除，残留旧状态的错误提示。

- **数据重新加载后，表单校验状态是否清除？** → Error
  - `formRef.value?.clearValidate()` / `resetFields()` 是否在数据赋值后调用？
  - 检查方法：在 `loadData()` / `loadDetail()` / `watch(selectedXxx)` 的数据加载完成处，确认有校验清除
- **数据替换后，旧的 error/success/warning 提示状态是否重置？** → Warn
  - 例如：上次保存失败的 `message.error` 在刷新后是否仍在展示？
- **列表刷新后，选中态/展开态/高亮是否与新数据一致？** → Warn
  - 选中 ID 是否对应新数据中的有效条目？
- **loading 状态是否在所有代码路径（成功/失败/取消）都正确重置？** → Error
  - 检查每个 `loading.value = true` 是否有对应的 `finally { loading.value = false }`

#### 15.6 平行变体/跨路径一致性 (Parallel Variant Consistency)

**问题场景：** 同一功能存在多套组件变体（如 everyday/非everyday、v1/v2），共享的 handler/logic 对不同变体路径使用了不同的字段名或接口签名。

- **共享函数中对不同变体路径的 key 名是否一致？** → Error
  - 例如：`group.keywordGroupId` vs `group.punchCategoryKeyWordsId` — 相等判断会静默失败
  - 检查方法：搜索所有变体组件的 emit/select 调用，对比传入字段名
- **新增 emit/prop 链路是否在所有变体路径都完整传递？** → Error
  - 例如：everyday 组件新增了 `switchConfirmed` emit，但非 everyday 组件未同步
- **代码重构是否影响了同一函数的所有调用方？** → Error
  - 当修改共享 handler（如 `handleGroupSelect`）时，确认对所有 `@select` 路径都兼容
  - 特别是通过 `if (punchType === 11)` 等条件分叉的路径

#### 15.7 弹窗/组件重开的状态残留 (Reopen State Reset)

**问题场景：** Modal/Drawer 的 `open()` 方法未完整重置所有内部状态，上次操作的数据/校验/临时标记残留到本次打开。

- **`open()` 方法是否完整重置了所有状态？** → Error
  - 检查清单：`formData`、校验状态、`loading`、`error`、选中项、临时标志（`isEdit`、`isHidden` 等）
  - 方法：在 `open()` 入口处统一 `Object.assign(formData, defaultForm) + formRef?.resetFields()`
- **上次异步请求的回调是否会污染本次打开？** → Warn
  - 例如：上次提交的 `.then()` 回调修改了本次的表单数据
- **弹窗关闭时是否清理了副作用？** → Error
  - `@cancel` / `handleCancel` 中是否清理了定时器、订阅、观察器？
  - `v-if` 控制弹窗时，销毁是否完整清理（`:destroyOnClose`）？

#### 15.8 异步操作的 UI 状态一致性 (Async UI State Consistency)

**问题场景：** 快速连续操作（快速切换/连续点击）导致旧的异步回调覆盖新状态，或 emit 事件链因组件卸载而断裂。

- **快速连续操作时，旧的异步回调是否会覆盖新状态？** → Warn
  - 例如：快速切换两个分组，第一个的 API 响应晚于第二个，覆盖了新数据
  - 解法：请求锁、AbortController、或对比请求参数是否仍匹配当前状态
- **同一数据有多处展示时，一处修改后其他位置是否同步刷新？** → Warn
  - 例如：详情面板修改了数据，列表/侧边栏是否需要 `emit('refresh')` + `loadData()`？
- **emit 事件链中，是否有环节可能因组件未挂载而断裂？** → Error
  - 例如：`A emit → B watch → C emit`，但 B 在 emit 时已被 v-if 卸载
  - 检查方法：追踪整个 emit 链，确认每个中间组件的挂载条件在 emit 时仍满足

---

## Step 4: Output Report

### 报告结构

```
🔍 Code Review Report — ⚡ 快速审 / 📋 完整审 / 🔬 深度审
Commit range: abc1234..def5678 (3 commits)
Changed files: 12 (+285, -67)

📜 检查提交 (3):
   abc1234 fix: 修复登录页样式
   def5678 feat: 新增用户列表筛选
   ghi9012 refactor: 重构权限校验

━━━ 🤖 Automated Checks ━━━
🟢 ESLint — passed (no errors)
🔴 TypeScript — 2 errors:
  - src/views/user/list.vue:45 — Type 'string' is not assignable to type 'number'
  - src/api/user.ts:18 — Property 'userName' does not exist on type 'User'
🟢 Prettier — passed
⚪ Stylelint — not configured (skipped)
🟢 Unit Test — 3 passed, 0 failed
  - src/views/user/__tests__/list.test.ts ✅
  - src/api/__tests__/user.test.ts ✅
  - src/components/__tests__/UserCard.test.ts ✅

━━━ 📋 Dimension Review ━━━

Commit abc1234 "Add user list page"

  📋 正常业务 (2):
    - src/views/user/list.vue:30 — Missing filter logic for status field [Warn]

  ⚠️ 异常场景 (5):
    🌐 请求交互:
      - src/views/user/list.vue:45 — Search input missing debounce [Warn]
      - src/api/user.ts:12 — No error handling in fetchUserList [Error]
    📊 状态数据:
      - src/views/user/list.vue:78 — user.name may be null, missing default '-' [Error]
    🎨 界面渲染:
      - src/views/user/list.vue:90 — Empty list has no empty-state component [Error]
    🔐 业务异常:
      - src/views/user/detail.vue:12 — Edit button missing permission check [Error]

  🔲 边缘场景 (2):
    - src/views/user/form.vue:56 — Input missing maxlength [Error]
    - src/views/user/form.vue:58 — Name field missing special char validation [Warn]

  🎨 样式规范 (1):
    - src/views/user/list.vue:102 — Hardcoded color "#f5f5f5" [Error]

  🧹 代码清理 (1):
    - src/views/user/list.vue:15 — console.log left in code [Error]

  ♿ 无障碍 (1):
    - src/views/user/list.vue:22 — Search input missing aria-label [Warn]

  💣 内存 (1):
    - src/views/user/list.vue:88 — setInterval not cleared on unmount [Error]

  ... (other dimensions if applicable)

Commit def5678 "Add user form"
  ...

━━━ 🔬 Deep Analysis (only for 🔬 deep mode) ━━━

  跨文件影响:
    - src/types/user.ts: UserRole enum 新增 'GUEST' —
      影响 4 个文件:
        ✅ src/views/user/list.vue:67 — 已处理新枚举值
        ✅ src/views/user/detail.vue:34 — 已处理
        ❌ src/components/UserRoleTag.vue:12 — 未处理 GUEST，会显示空白
        ❌ src/store/user.ts:45 — switch 未覆盖 GUEST，建议加 default 分支

    - src/api/user.ts: fetchUserList 新增参数 `includeDeleted: boolean` —
      调用方 3 处:
        ✅ src/views/user/list.vue — 已传新参数
        ✅ src/views/dashboard/index.vue — 已传新参数
        ⚠️  src/views/report/index.vue — 未传参数 (该页面使用默认值，需确认是否需要过滤已删除用户)

  回归风险:
    - 共享组件 UserCard 变更 — 被 8 个页面引用，建议回归测试以下页面：
      - 用户列表页 (src/views/user/list.vue)
      - 仪表盘 (src/views/dashboard/index.vue)
      - 报告页 (src/views/report/index.vue)
      - 搜索结果页 (src/views/search/index.vue)
      - ... (共 8 处)

━━━ 📊 Summary ━━━━━━━━━━━━━━
🔴 Errors:   8 (must fix before merge)
🟡 Warnings: 6 (should discuss)
💡 Suggests: 3 (optional improvements)

By dimension:
  📋 正常业务: 2  ⚠️ 异常: 5  🔲 边缘: 2  🎨 样式: 1
  🧹 清理: 1  ♿ 无障碍: 1  💣 内存: 1  🔬 影响分析: 2
```

---

## Step 5: Cross-File Impact Analysis (Deep Mode Only)

仅深度审模式执行，分析变更的涟漪效应。

### 5.1 符号依赖追踪

| 变更类型 | 分析方法 | 关注点 |
|---|---|---|
| 共享类型/接口变更 (types/*.ts) | 搜索所有 import 该类型的文件 | 新增/删除字段是否所有消费者已处理 |
| 枚举值新增/删除 | 搜索所有 switch/if-else 对该枚举的处理 | 是否有遗漏的 case 分支 |
| 共享常量变更 | 搜索所有引用处 | 常量语义变更是否影响业务逻辑 |
| 公共组件 Props/Events 变更 | 搜索所有 `<ComponentName` 使用处 | 调用方是否传递了新 required prop |
| API 函数签名变更 | 搜索所有调用 import 该函数的文件 | 参数顺序/类型/返回值变更的影响面 |
| Store/状态管理变更 | 搜索所有 `useXxxStore` / `mapState` / `mapActions` | state 结构变更的消费者适配 |
| 路由配置变更 | 搜索 router.push/navigate/路由 name | 删除/重命名路由的残留引用 |
| 工具函数变更 | 搜索所有 import 该函数的文件 | 行为变更是否在所有调用方都合理 |

### 5.2 回归风险评估

- 列出受影响的页面/组件清单
- 标记高风险点（核心流程 / 支付 / 权限相关）
- 给出建议的回归测试页面列表

### 5.3 架构合理性评估（可选）

- 新增模块是否符合项目现有分层架构？
- 是否引入了与现有技术栈不兼容的模式？
- 是否存在循环依赖风险？（A import B, B import A）

---

## Severity Definitions

| Level | Meaning | Action |
|---|---|---|
| 🔴 Error | Must fix — 会导致功能异常、数据错误、安全漏洞或严重体验问题 | Blocks merge |
| 🟡 Warn | Should fix — 存在潜在风险或不符最佳实践 | Discuss in review |
| 💡 Suggest | Could improve — 优化建议，提升代码质量或用户体验 | Optional |

---

## Post-Review Checklist

审查完成后，根据模式输出行动清单：

**⚡ 快速审：**
- [ ] 所有 Error 已修复
- [ ] 自动化检查全部通过

**📋 完整审：**
- [ ] 所有 Error 已修复
- [ ] 所有 Warn 已讨论并决策（修复 / 记录 issue 跟踪 / 说明理由放弃）
- [ ] 自动化检查全部通过

**🔬 深度审：**
- [ ] 所有 Error 已修复
- [ ] 所有 Warn 已讨论并决策
- [ ] 跨文件影响的所有 ⚠️/❌ 点已处理
- [ ] 回归风险页面已纳入测试计划
- [ ] （如适用）架构问题已记录或解决
- [ ] 自动化检查全部通过
