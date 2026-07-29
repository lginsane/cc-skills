# cc-skills

一套基于 Claude Code 的 AI 辅助开发工具链，专为 **墨刀原型 + 云效项目** 场景设计，覆盖从需求到上线的全流程。

## 适用场景

你的团队如果满足以下条件，这套工具链开箱即用：

- 🎨 用 **墨刀** 出原型、管理迭代版本
- 📋 用 **云效** 管理需求、缺陷、迭代
- 🔧 前端技术栈为 **Vue 3 + TypeScript**（uni-app 或 admin 后台均支持）
- 📡 后端提供 **Swagger** 接口文档

典型协作流程：产品在墨刀画原型 → 开发在云效领需求 → 对着原型写代码 → 提测。这套工具链把中间「对着原型写代码」这一步自动化了。

> 💡 **不适合你的技术栈？** 这套工具链的核心是「工作流程」而非具体实现。如果你的团队用 Figma 代替墨刀、Jira 代替云效、React 代替 Vue，完全可以参考这个工作流，把对应的 skill 替换成适合自己工具的版本。每个 skill 都是独立的，按需取用、自由组合。

## 工作流总览

```
墨刀原型 ──→ lg-extract ──→ lg-catalog ──→ lg-vision ──→ lg-analyze ──→ lg-create-smoke
              │                │              │              │                │
              │  提取产品图    提取目录结构   识图转需求    全维度分析      生成冒烟用例
              │                │              │              │          （指导编码）
              └────────────────┴──────────────┴──────────────┴──────────────┘
                                              │
                                              ▼
                                      需求文档 + 冒烟用例
                                              │
                                    ┌─────────┼─────────┐
                                    ▼                   ▼
                              lg-api-code            lg-code
                              (Swagger→API)        (需求→代码)
                                    │                   │
                                    └─────────┬─────────┘
                                              ▼
                                    lg-smoke / lg-review
                                   (冒烟测试 / 代码审查)
```

## Skill 详解

### 初始化

| Skill | 说明 |
|-------|------|
| `lg-init` | 一键初始化项目配置：连接墨刀空间、配置云效项目 ID、检测项目技术栈（Vue/uniapp/admin）、检测原子 CSS 库（UnoCSS/Tailwind）、检测样式隔离策略（scoped/BEM）、扫描类型契约并生成复用规则。跑完这一步，后续所有 skill 就有了完整的项目上下文。 |

### 需求阶段

| Skill | 说明 |
|-------|------|
| `lg-extract` | 从墨刀指定迭代自动提取所有页面的产品图片，按版本号分类存储到本地。不用手动一张张截图了。 |
| `lg-catalog` | 提取墨刀原型的左侧目录结构，输出 JSON + Markdown，让你一眼看清页面层级和数量。 |
| `lg-vision` | 用 Qwen-VL-Max 识图，将产品图片转为结构化需求信息：页面元素、交互逻辑、字段列表。相当于 AI 帮你「看原型写 PRD」。 |
| `lg-analyze` | 基于识图结果，用 Qwen-Max 做全维度分析：边界条件、异常路径、状态流转、非预期输入，输出结构化测试清单。产品没写到的边界，AI 帮你补上。 |
| `lg-create-smoke` | 基于 `lg-analyze` 的分析结果生成全维度冒烟测试用例（主流程 + 边界 + 状态 + 异常 + 非预期路径），输出 xlsx 文件。**冒烟用例的核心作用是指导编码**——开发对着用例写代码，确保不遗漏场景。真正的冒烟测试由 QA/测试团队提供。 |

### 编码阶段

| Skill | 说明 |
|-------|------|
| `lg-api-code` | 从 Swagger 文档生成前端 API 定义代码（`api.ts` + `types.ts` + `enums.ts`），自动处理枚举复用检测、Params/Response 混用检测、类型契约继承（BasePageParams/PageResponse），增量生成不覆盖已有代码。 |
| `lg-code` | 基于需求文档 + 冒烟用例编码，自动注入项目开发规范（由 `lg-init` 生成）：原子 CSS 优先、BEM 命名、表单校验规则、状态处理模板。编码时会关联 `lg-vision`、`lg-analyze`、`lg-api-code`、`lg-create-smoke` 的产出，对着冒烟用例逐条实现。 |

### 测试 & 审查阶段

| Skill | 说明 |
|-------|------|
| `lg-smoke` | 运行冒烟测试，检查代码是否覆盖了冒烟用例中的所有场景。 |
| `lg-review` | 代码审查，对比需求文档和冒烟用例逐项验证实现是否完整。 |

## 快速开始

### 前置条件

1. 安装 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
2. 配置 Claude Code 的 MCP 连接：
   - **墨刀 MCP**（用于原型读取）
   - **云效 MCP**（用于项目管理）

### 第一步：初始化

```bash
# 在项目根目录执行
claude "帮我用 lg-init 初始化项目"
```

`lg-init` 会交互式引导你完成：

- 墨刀空间 URL 配置
- 云效项目 ID 配置
- 技术栈自动检测（Vue 版本、原子 CSS 库、样式隔离策略）
- 开发规范文件生成

### 第二步：提取需求

```bash
# [1.4.6]对应目录中版本的名称
# 提取墨刀迭代中的产品图片
claude "/lg-extract 1.4.6"

# 生成目录结构
claude "/lg-catalog"

# AI 识图转需求
claude "/lg-vision 1.4.6"
```

### 第三步：编码

```bash
#[机构管理] 表示Swagger 文档对应的菜单
#[1.4.6] 对应目录中版本的名称
# 生成 API 代码
claude "/lg-api-code 机构管理"

# 基于需求编码
claude "/lg-code 1.4.6"
```

### 第四步：测试 & 审查

```bash
# 生成冒烟用例
claude "/lg-create-smoke 1.4.6"

# 代码审查 
claude "/lg-review commit[1dbd5b3d71708f5a3d4e52f6d42b5176e57d4eeb]之后提交的代码，包含当前commit"
```

## 目录结构

```
cc-skills/
└── lg/
    ├── lg-init/          # 项目初始化
    ├── lg-extract/       # 产品图片提取
    ├── lg-catalog/       # 原型目录提取
    ├── lg-vision/        # 识图转需求
    ├── lg-analyze/       # 全维度需求分析
    ├── lg-api-code/      # Swagger → API 代码
    ├── lg-code/          # 需求 → 业务代码
    ├── lg-create-smoke/  # 生成冒烟测试用例
    ├── lg-smoke/         # 运行冒烟测试
    ├── lg-review/        # 代码审查
    └── lg-scripts/       # 辅助脚本
```

## License

MIT
