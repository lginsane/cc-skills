---
name: lg-code
description: 基于需求文档编码，注入开发规范 + 常量规范，关联 lg-* 产出
---

# /lg-code — Code Generation

Generate production Vue 3 code from natural language requirements. Outputs code that is immediately compliant with project standards — no manual style/correction fixes needed.

## Mode Selection

通过 `--mode` 参数选择生成模式。

| 参数 | 模式 | 适用场景 | 规范文件 |
|------|------|---------|---------|
| `--mode admin` | 管理后台 | Ant Design Vue + SmartAdmin 项目 | vue-development-standards.md + constants-usage-standards.md + api-doc-generator.md |
| `--mode d2c` | 设计稿还原 | uni-app / H5 / Web 项目，需高还原度 | page-development.md + d2c-restoration.md |

不传 `--mode` 时默认 `admin`（向后兼容）。D2C 模式进入独立流程，详见下方 `## D2C Mode` 章节。

## When to Use

- "Generate a user list page with search and pagination"
- "Create a product detail page"
- "Build an order form with validation"
- "Add a confirmation modal for delete operations"

## Scene Detection

The skill auto-detects the scene type and loads the corresponding template:

| Keyword Triggers | Scene | Template |
|---|---|---|
| list, table, search, pagination, 列表 | List Page | `templates/scenes/list-page.vue` |
| detail, info, view, 详情 | Detail Page | `templates/scenes/detail-page.vue` |
| form, create, edit, submit, 表单 | Form Page | `templates/scenes/form-page.vue` |
| modal, dialog, drawer, confirm, 弹窗 | Modal | `templates/scenes/modal.vue` |
| (none matched) | Generic | Best-effort generation |

## Core Rules

### 0. 注释强制规则（MANDATORY — 编码前必读）

生成的所有 `.vue` 文件 `<script setup>` 内部必须包含规范区块注释：

| 页面类型 | 必须区块 |
|---------|---------|
| 列表页 (List Page) | `// -------- 默认参数 --------` `// -------- 查询参数 --------` `// -------- 分页配置 --------` `// -------- 表格列定义 --------` `// -------- 数据与加载 --------` `// -------- Ref 引用 --------` `// -------- 事件处理 --------` `// -------- 生命周期 --------` |
| 弹窗 (Modal) | `// -------- 默认表单 --------` `// -------- 弹窗状态 --------` `// -------- 表单校验 --------` `// -------- 核心方法 --------` `// -------- 暴露 --------` |
| 详情页 (Detail Page) | `// -------- 路由参数 --------` `// -------- 详情数据 --------` `// -------- Tab 状态 --------` `// -------- 数据加载 --------` `// -------- 事件处理 --------` `// -------- 生命周期 --------` |

**弹窗组件额外要求：** `open()` 函数必须带 JSDoc，描述 `@param` 入参和 `@emits` 事件。

**禁止：** 写"做什么"型注释（如 `// 设置 loading 为 true`），代码本身已自解释。

### 1. Load Context First (MANDATORY)

**编码前必须 Read 以下文件，缺一不可：**

| 文件 | 用途 | 必须 |
|------|------|------|
| `.claude/prompts/vue-development-standards.md` | 完整 Vue 开发规范（目录/组件/样式/校验/命名） | ✅ |
| `.claude/prompts/constants-usage-standards.md` | 枚举常量注册/引用规范 | ✅ |
| `.claude/prompts/api-doc-generator.md` | API 模块结构规范 | ✅ |
| `CLAUDE.md` | 项目技术栈、命令、架构约定 | ✅ |
| `.claude/config/lg-components-map.json` | 已有组件清单，先复用后新建 | ✅ |
| `src/constants/` | 已有枚举值，禁止硬编码 | ✅ |
| `src/api/` | API 模块结构，遵循已有模式 | ✅ |

**代码格式强制规则：**
- 禁止用 `;` 拼接多语句到一行
- 每个 `import` / `const` / `let` / `function` 独立一行
- 模板属性多时换行对齐（参照规范模板）
- 参考已有页面文件风格（如 `src/views/business/merchant/`）

### 2. Constant References (CRITICAL)

Scan `src/constants/` directory and extract all enum values. The generated code MUST reference constants, never use magic values.

```
❌ if (order.status === 0)
✅ if (order.status === ORDER_STATUS_ENUM.PENDING.value)

❌ <a-tag v-if="status === 1">Active</a-tag>
✅ <a-tag v-if="status === ORDER_STATUS_ENUM.ACTIVE.value">
     {{ ORDER_STATUS_ENUM.ACTIVE.desc }}
   </a-tag>
```

### 3. Component Reuse

Check `component-map.json` before generating any UI element. If a mapped component exists, use it. Never generate div-based reimplementations of existing components.

### 4. Mandatory 4-State Coverage

Every scene template must handle ALL four states:

| State | List | Detail | Form | Modal |
|---|---|---|---|---|
| Loading | ✅ Skeleton/skeleton-screen | ✅ Spin | ✅ Button loading | ✅ Button loading |
| Empty | ✅ Empty state + CTA | ✅ Empty data prompt | N/A | N/A |
| Error | ✅ Error + retry | ✅ Error + back | ✅ Validation errors | ✅ Submit failure |
| Success | N/A | N/A | ✅ Success + redirect | ✅ Success + close |

### 5. API Convention

- All API calls via the project's request wrapper (detected from CLAUDE.md)
- Use the module pattern: `{module}Api.methodName()`
- No try-catch in components unless special fallback logic is needed
- Request/response types if TypeScript project

### 6. Style Rules

**🔴 样式优先级（MANDATORY）：原子 CSS > scoped CSS**

> 若项目使用了原子 CSS 库（UnoCSS / Tailwind / Windi），编码时必须遵循以下优先级：

| 优先级 | 方式 | 适用范围 |
|--------|------|---------|
| 1️⃣ 原子类 | 直接写在模板 `class` 属性 | **所有常规样式**：`flex`、`items-center`、`w-*`、`h-*`、`p-*`、`m-*`、`text-*`、`bg-*`、`rounded-*`、`border-*`、`gap-*`、`overflow-hidden`、`text-ellipsis`、`whitespace-nowrap` 等 |
| 2️⃣ `<style>` + BEM | `<style>` 块（是否 scoped 取决于项目规范） | **仅**以下例外场景：<br>• 动态 `class` 名（运行时拼接，静态扫描无法生成）<br>• 伪类选择器（`:last-child`、`:nth-child`）<br>• `rgba()` 半透明背景<br>• `@keyframes` 动画 |

**自检规则**：生成代码后扫描 `<style scoped>` 中的每条规则，逐条问"这条能用原子类表达吗？"能 → 删除，移到模板 class。

- All colors/spacing/fonts use `var(--token-name)` CSS variables when available
- Precompiler matches project (SCSS for uniapp, Less for admin/web)
- `<style>` 是否 `scoped` 取决于项目规范（由 `lg-init` 自动检测并写入开发规范文件，不要硬编码）
- No global styles in component files
- **`<style>` 中所有自定义类名 MUST use BEM naming convention**（详见 `### 7. BEM CSS 命名规范`）

### 7. BEM CSS 命名规范（MANDATORY）

**所有自定义 CSS/LESS/SCSS 类名必须遵循 BEM（Block__Element--Modifier）命名规范。** 此规则适用于 admin 模式和 D2C 模式，也适用于组件开发。

#### 7.1 BEM 结构

```
Block（块）          — 独立、有意义的组件根，单词小写，多个单词用 - 连接
Block__Element（元素） — 块的组成部分，用 __ 连接块和元素
Block--Modifier（修饰符） — 块或元素的不同状态/变体，用 -- 连接
```

#### 7.2 命名格式

| 层级 | 格式 | 示例 |
|------|------|------|
| Block | `.block-name` | `.user-card` `.search-panel` `.order-table` |
| Element | `.block-name__element` | `.user-card__avatar` `.search-panel__input` `.order-table__header` |
| Modifier | `.block-name--modifier` | `.user-card--featured` `.search-panel--collapsed` `.order-table--empty` |
| Element Modifier | `.block-name__element--modifier` | `.user-card__title--large` `.order-table__row--selected` |

#### 7.3 正确示例 ✅

```scss
// Block: 搜索面板
.search-panel {
  display: flex;
  gap: 12px;

  // Element: 搜索面板内的输入框
  &__input {
    flex: 1;
    border-radius: 8px;
  }

  // Element: 搜索面板内的按钮组
  &__actions {
    display: flex;
    gap: 8px;
  }

  // Modifier: 搜索面板的紧凑模式
  &--compact {
    gap: 8px;
  }
}

// Block: 用户卡片
.user-card {
  padding: 16px;
  border: 1px solid var(--border-color);
  border-radius: 8px;

  // Element: 用户头像
  &__avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
  }

  // Element: 用户名
  &__name {
    font-size: 16px;
    font-weight: 600;
  }

  // Element Modifier: 名称字体大号
  &__name--large {
    font-size: 20px;
  }

  // Modifier: 精选卡片
  &--featured {
    border-color: var(--primary-color);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  // Modifier: 禁用状态
  &--disabled {
    opacity: 0.5;
    pointer-events: none;
  }
}
```

#### 7.4 错误示例 ❌

```scss
// ❌ 驼峰命名
.userCard { }
.userCardAvatar { }

// ❌ 下划线命名（不使用 BEM 语义）
.user_card { }
.user_card_avatar { }

// ❌ 过度嵌套（超过 2 层 BEM）
.user-card__header__title__icon { }  // 应拆分为独立 Block

// ❌ 混合命名风格
.UserCard { }
.user_card-item { }

// ❌ 无意义的缩写
.uc { }
.uc-avt { }

// ❌ 单下划线分隔（不是 BEM）
.user-card_title { }  // 应该是 .user-card__title
.user-card_active { } // 应该是 .user-card--active

// ❌ 深层选择器嵌套（破坏 BEM 扁平结构）
.user-card {
  .avatar {
    .image {
      .overlay { } // 禁止！应使用 BEM 扁平化
    }
  }
}
```

#### 7.5 BEM + Scoped 样式配合

在 Vue SFC 中，BEM 与 scoped 样式配合使用：

```vue
<template>
  <div class="product-list">
    <div
      v-for="item in list"
      :key="item.id"
      class="product-list__item"
      :class="{ 'product-list__item--selected': item.selected }"
    >
      <img class="product-list__image" :src="item.image" />
      <div class="product-list__info">
        <span class="product-list__name">{{ item.name }}</span>
        <span class="product-list__price product-list__price--promo">
          ¥{{ item.price }}
        </span>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.product-list {
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__item {
    display: flex;
    align-items: center;
    padding: 12px;
    border-radius: 8px;
    transition: background 0.2s;

    &--selected {
      background: var(--primary-1);
    }
  }

  &__image {
    width: 60px;
    height: 60px;
    border-radius: 6px;
    object-fit: cover;
  }

  &__info {
    flex: 1;
    margin-left: 12px;
  }

  &__name {
    font-size: 14px;
    color: var(--text-color);
  }

  &__price {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-color);

    &--promo {
      color: var(--error-color);
    }
  }
}
</style>
```

#### 7.6 与第三方组件库共存规则

当使用 Ant Design Vue / Element Plus 等组件库时：

- **组件库自带类名**（如 `.ant-table` `.el-button`）→ 保持不变，不做 BEM 改造
- **自定义覆盖样式** → 通过 `:deep()` 穿透，内部嵌套使用 BEM
- **页面/业务容器** → 必须使用 BEM 命名

```scss
// ✅ 正确：组件库类名不变，自定义容器用 BEM
.order-page {
  &__toolbar {
    display: flex;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  &__table-wrapper {
    // 穿透修改 ant-design 内部样式
    :deep(.ant-table) {
      font-size: 13px;
    }

    :deep(.ant-table-thead > tr > th) {
      background: var(--bg-color);
    }
  }
}

// ❌ 错误：试图改造组件库类名为 BEM
.ant-table__header__cell { } // 不要给第三方类名加 BEM
```

#### 7.7 图片样式强制规则（MANDATORY）

**所有 `<img>` 标签必须设置 `object-fit`，防止图片因宽高比不匹配而变形：**

```less
// ✅ 正确：图片裁剪填充（适用于列表缩略图、封面图等）
.product-list__image {
  width: 60px;
  height: 60px;
  border-radius: 6px;
  object-fit: cover;  // ← 必须！裁剪多余部分，保持比例
}

// ✅ 正确：图片完整展示（适用于头像、logo 等不能裁剪的场景）
.user-card__avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: contain;  // ← 完整展示，留白不裁剪
}

// ❌ 错误：未设置 object-fit → 图片会被拉伸/压缩变形
.product-list__image {
  width: 60px;
  height: 60px;
  border-radius: 6px;
  // ← 缺 object-fit: cover → 非正方形原图会变形！
}
```

| 场景 | object-fit 值 | 说明 |
|------|-------------|------|
| 列表缩略图、商品图、封面图、banner | `cover` | 裁剪填充，确保容器被填满 |
| 头像、logo、图标型图片 | `contain` | 完整展示，容器内留白 |
| 背景装饰图 | `cover` | 填充背景区域 |

**禁止出现固定宽高的 `<img>` 不设置 `object-fit`**，这是最常见的图片变形原因。

#### 7.8 嵌套深度限制

- BEM 命名层级：**最多 Block__Element--Modifier，禁止 Block__Element__SubElement**
- 如需更深层嵌套 → 拆分为新的独立 Block
- SCSS/LESS 嵌套：使用 `&__` / `&--` 语法糖，但最终生成的类名不超过 2 个 `__` 或 `--` 层级

```scss
// ✅ 正确：拆分独立 Block
.order-table {
  &__header { }
}

.order-table-header {  // 拆分为独立 Block
  &__title { }
  &__sort-icon { }
}

// ❌ 错误：深层 BEM
.order-table__header__title__icon { } // 4 层，禁止
```

#### 7.9 项目中已存在的命名风格

如果项目已有命名规范（如 camelCase、特定前缀约定），优先遵循项目现有风格。BEM 规则适用于**新增自定义样式**，不影响已有代码风格。

## Output Format

Report after generation:
```
✅ /gen Complete

Scene: List Page
Generated: src/views/product/list/index.vue (180 lines)

Constants referenced:  PRODUCT_STATUS_ENUM, PRODUCT_CATEGORY_ENUM (2)
Components reused:     a-table, a-button, a-input-search, a-pagination (4)
States covered:        Loading ✅, Empty ✅, Error ✅, Success ✅
Self-check:            ✅ All 10 rules passed
```

---

## 代码自检（MANDATORY — 生成后逐条核对）

**所有 .vue 文件生成完成后，必须逐条检查以下项，全部通过才可交付：**

| # | 检查项 | 标准 | ❌ 错误示例 |
|---|--------|------|------------|
| 1 | catch 块 | `catch (e) { console.error(e) }` | `catch {}` 空块 |
| 2 | 列定义 | 统一用 `dataIndex`，不混用 `key` | `key: 'status'` |
| 3 | bodyCell | 解构 `{ column, record }`，不漏 `record` | `#bodyCell="{ column }"` |
| 4 | 状态渲染 | status 列有对应的 `<a-tag>` 模板 | 只定义列不写模板 |
| 5 | 代码格式 | 每个 import/const/function 独立一行 | 分号连接多语句 |
| 6 | 表格属性 | TableCard/TableCard 属性换行对齐 | 所有属性挤一行 |
| 7 | 搜索表单 | 用 `SearchCard` 组件，不手写查询/重置按钮 | 手写 `<a-button>查询</a-button>` |
| 8 | 页面容器 | 列表用 `PageContainer` + `SearchCard` + `TableCard` | 裸 `<div>` + `<a-card>` |
| 9 | 组件复用 | 先查 `lg-components-map.json`，有则用 | 重复造轮子 |
| 10 | 无 sed 痕迹 | 代码中不含 `.replace(` 或 `sed` 副作用 | 列定义混入 `.replace(...)` |
| 11 | 注释规范 | 脚本分区注释完整（列表8区块/弹窗5区块/详情6区块），defineExpose有JSDoc | 无区块注释、open()无JSDoc |
| 12 | BEM CSS | 所有自定义 CSS 类名遵循 BEM（Block__Element--Modifier），无驼峰/单下划线/深层嵌套 | `.userCard` `.user_card` `.user-card__a__b__c` |
| 13 | 表单校验去重 | `required: true` 与自定义 `validator` 拆分到不同规则项；validator 空值时 resolve 不 reject，避免同字段双提示 | `{ required: true, validator: (_, v) => !v ? reject() : resolve() }` 同对象中 required 和 validator 都 reject |
| 14 | 校验清理 | 数据重置/重载后调用 `nextTick` + `clearValidate()`，无旧校验残留（弹窗打开、切换模板、动态 rules 变化等场景） | 切换禁用模板后仍显示"请输入价格" |
| 15 | 图片 object-fit | 所有 `<img>` 标签对应的 CSS 类必须设置 `object-fit: cover`，防止图片被拉伸变形；头像等需完全展示的场景可用 `object-fit: contain` | `<img>` 无 `object-fit` → 图片变形 |
| 16 | 🔴 DSL 逐项对照（D2C 专用） | **生成代码后，所有 DSL 中有精确值的 UI 元素必须逐项与 DSL 原文对照确认**——列头/列数/列宽、文案、状态标签文字+颜色、按钮文字、图标位置、间距、字号、圆角……**禁止凭 API 类型、常见模式或其他数据源推断任何 UI 属性**。DSL 是 UI 结构的唯一真相源 | 凭 `AutoDeliveryPlanDaySaveItem` 类型推断列只有"日期+任务数"，漏掉 DSL 中的"实际任务数量/实际差额/计划状态"；凭 `AutoDeliveryStrategyItem` 自创"序号"列，漏掉 DSL 中的"策略项"列 |

**检查方法：**
- 每生成一个文件，立即逐条比对
- 发现问题立即修复，不积累
- 全部通过后输出 `✅ Self-check passed` 才能继续下一个任务

### 8. Form Validation Rules（Ant Design Vue 表单校验强制规则）

**规则 8.1：`required` 与自定义 `validator` 必须拆分到不同规则对象中**

当同一个字段既有 `required: true` 又有自定义 `validator` 时，两者各自独立触发校验。若字段为空，`required` 和 `validator`（内部也对空值 reject）会同时报错 → **同一个字段显示两条错误提示**。

```js
// ❌ 错误：同字段空值时两条提示同时出现
rules = {
  password: [{
    required: true, message: '请输入密码',
    validator: (_, v) => !v ? Promise.reject('请输入密码') : Promise.resolve(),
  }],
};

// ✅ 正确：拆分为两条独立规则，validator 空值时 resolve
rules = {
  password: [
    { required: true, message: '请输入密码' },
    { validator: (_, v) => !v ? Promise.resolve() : customCheck(v) },
  ],
};
```

**规则 8.2：自定义 validator 首行必须处理空值**

```js
// ✅ 模式A：空值直接 resolve，由 required 规则处理空值提示
validator: (_: any, v: string) => {
  if (!v) return Promise.resolve();
  // ... 业务校验逻辑
}

// ✅ 模式B：独立 validator（无 required），自行处理空值提示
validator: (_: any, v: string) => {
  if (!v) return Promise.reject('请输入XXX');
  // ... 业务校验逻辑
}

// ❌ 错误：有 required 但 validator 也对空值 reject
validator: (_: any, v: string) => {
  if (!v) return Promise.reject('请输入XXX'); // 与 required 消息重复！
  // ...
}
```

**规则 8.3：`required: true` 必须有显式 `message`**

```js
// ❌ 错误：无 message，使用默认泛型提示
{ required: true }

// ✅ 正确：显式 message
{ required: true, message: '请输入手机号' }
```

**规则 8.4：表单数据重置/重载时必须初始化校验状态（MANDATORY）**

当表单数据重新加载（弹窗重新打开、切换数据源、动态 rules 变化等）时，必须调用 `clearValidate()` 清除上一次的校验状态。**这是项目中最常见的 Bug 来源之一，已多次出现。**

```js
// ✅ 正确：loadData 完成后清除校验
async function handleSelectTemplate(item) {
  selectedId.value = item.id;
  await loadPriceData(item.id);
  await nextTick();
  formRef.value?.clearValidate();
}

// ✅ 正确：弹窗 open() 中清除校验
function open(data) {
  if (data) {
    formData.value = { ...data };
  } else {
    formData.value = { ...defaultForm };
  }
  nextTick(() => formRef.value?.clearValidate());
  visible.value = true;
}

// ✅ 正确：finally 块中清除
async function loadData() {
  try {
    // ... 加载数据
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
    await nextTick();
    formRef.value?.clearValidate();
  }
}
```

**典型场景：**

| 场景 | 触发时机 | 必须操作 |
|------|---------|---------|
| 弹窗重新打开 | `open()` 中 `formData` 重置后 | `nextTick` → `clearValidate()` |
| 切换模板/数据源 | 新数据加载完成后 | `nextTick` → `clearValidate()` |
| 动态 rules 从有→无 | `rules` 条件变化 | 条件变化后 `clearValidate()` |
| 切换 Tab 后数据重载 | Tab 切换触发新数据加载 | 数据加载后 `clearValidate()` |

### 9. Store 函数设计规范（Pinia persist 防污染规则）

**背景：** `persist: true` 的 Store 会被持久化到 localStorage，该 Store 被多个页面/流程共用时，A 页面写入的值可能在 B 页面被意外读取。

**规则 9.1 — 跨页面函数必须通过参数接收数据：**

```typescript
// ❌ 禁止：函数内部隐式读取 Store 状态
const checkLevel = async (platform: PlatformEnum) => {
    const showDays = planData.value.added.showDays;
};

// ✅ 正确：由调用方显式传入
const checkLevel = async (platform: PlatformEnum, currentShowDays?: number) => {
    const showDays = currentShowDays;
};
```

**规则 9.2 — `persist: true` 的 Store 被新页面调用时，必须在 onMounted/init 中重新初始化关键状态：**

```typescript
async function loadPlan(planId: string) {
    await planStore.loadPrepareData(platform);
    planStore.initPlanDataByPrepareData();
}
```

**规则 9.3 — 校验失败后的修复必须覆盖所有数据源：**

```typescript
// ❌ 禁止：只修了 form，Store 内部状态未同步 → 死循环
if (changeResult.showDaysChanged) {
    planBurstForm.value.showDays = default;
    return;
}

// ✅ 正确：同步所有数据源
if (changeResult.showDaysChanged) {
    planBurstForm.value.showDays = default;
    planData.value.added.showDays = default;
    return;
}
```

## 禁止事项

- ❌ 禁止用 `bash heredoc` 批量生成 .vue 文件
- ❌ 禁止用 `sed` 批量修改 .vue 文件内容
- ❌ 禁止用 `;` 拼接多行 JavaScript 语句
- ❌ 禁止在同一规则对象中同时使用 `required` 和自定义 `validator` 且都为空值报错
- ❌ **禁止能用原子类表达的样式写在 `<style scoped>` 中**
- ❌ **禁止 Store 函数内部隐式读取 ref 状态做业务判断**
- ❌ **禁止校验失败后只修复表单不修复 Store**
- ✅ 必须用 Write/Edit 工具逐文件生成

---

## 需求文档关联

编码前自动关联以下 lg-* 产出：
- `vision/{version}/` — UI元素/交互/文案
- `analyze/{version}/` — 边界/异常/校验规则
- `smoke/{version}/` — 冒烟用例作为验收标准

## 从增强 Vision Schema 消费（v2）

当 vision JSON 包含以下新字段时，lg-code 应按如下方式使用：

### 1. layout_zones → 页面布局

```
layout_zones 中有 sidebar + main_content → 使用 PageContainer + 侧边栏布局
layout_zones 中只有 main_content → 使用全宽 PageContainer
layout_zones 中有 dialog → 独立弹窗组件
```

### 2. component_tree → 组件嵌套

递归遍历 component_tree：
- `SearchCard` → `<SearchCard>` 包裹搜索表单
- `TableCard` → `<TableCard>` 包裹 a-table
- `a-input` + label → `<a-form-item :label="label"><a-input .../></a-form-item>`
- `a-button type=primary` → `<a-button type="primary">`
- `position: 表格上方左侧` → 放在 TableCard 的 actions 区域

**先查 `lg-components-map.json`**，有映射则用已有组件，无映射则用 Ant Design 原生组件。

### 3. visual_style + vision-style-map.json → 样式

读取 `~/.claude/skills/lg-scripts/vision-style-map.json`，将 VLM 的自然语言描述映射为 CSS 变量：

```
"主操作色：蓝色" → color_map["蓝色"] → var(--primary-color)
"表格内容：14px 常规" → typography_map["表格内容"] → font-size: 14px; font-weight: 400
```

### 4. component_details → 组件配置

**表格 (type=table)：**
```javascript
const columns = detail.columns.map(col => ({
  title: col.title,
  dataIndex: col.dataIndex,
  width: col.width ? parseInt(col.width) : undefined,
  sorter: col.sortable || false,
  fixed: col.fixed || false
}));
```

### 5. annotations → 校验规则和约束

### 6. states → 枚举和条件渲染

## 组件开发
# /component — Component Development

Develop Vue 3 components with automatic classification, documentation generation, and component map registration.

### Step 1: Check for Duplicates
Search `component-map.json` and `src/components/` for existing similar components.

### Step 2: Classify the Component

| Type | Directory | Reuse Scope | Prefix | Doc Required |
|---|---|---|---|---|
| **Public** | `components/common/` | Global | `Base` / `App` | ✅ README.md |
| **Business** | `components/business/{module}/` | Same module | Business abbreviation | Suggested |

### Step 3: Design the API
Define before coding: Props, Emits, Slots, Expose

### Step 4: Implement with Mandatory States
Empty Props / Invalid Props / Loading / Error / Empty Data

### Step 5: Style Rules (ENFORCED)
✅ BEM naming / ✅ object-fit: cover / ❌ /deep/ or >>>

### Step 6: Generate README.md

### Step 7: Register in Component Map

## D2C Mode

当 `--mode d2c` 时走此流程。与 admin 模式完全独立，不共享规范文件和自检规则。

### Phase 1: 数据提取（实时 MCP 主通道 + 识图回退）

1. **检查 MasterGo MCP 可用性**

2. **从 page-mapping.json 定位 design**

3. **全量实时获取 DSL（无需本地缓存，MANDATORY）**：
   - 调用 `mcp__getDesignSections`（不带 sectionIndex）→ section 列表 + rootMetadata，记录 `totalSections` 与每个 section 的 `{sectionIndex, name, type, textPreview, containerId, nodeCount}`，并记录 `rootMetadata.width` / `height`（设计稿画布宽度 → 像素换算基数）
   - **全量取数（🔴 MANDATORY）**：对 section 列表中**每一个** section 依次调用 `mcp__getDesignSections(sectionIndex=N)`。**页头/侧栏/页脚/弹层均属于 payload，不可跳过**
   - **显式豁免（仅以下类型，且编码前必须输出豁免清单）**：
     - `scrollbar` / 滚动条
     - 分隔线 / 分割线（divider）
     - 纯背景装饰层（判定：无文本、无图片 fill、无 PATH 节点，且 name 含"背景/装饰/背景图"）
     - 豁免项必须记录 `{sectionIndex, name, 原因}`，不得静默
   - 🔴 **取数门禁（HARD GATE — 缺 section 禁止编码）**：编码前比对「已取 DSL 的 section 数 `N_fetched`」vs「`totalSections - 豁免数`」；`N_fetched < 应取数` → 输出 ⚠️ 缺失清单 → 补取或显式豁免，**禁止带缺直接编码**
   - 🔴 **表格 section 必须取 DSL**：表格列头/列宽/列数/数据样例/状态标签样式 只在详细 DSL 中有。任何含表格的区域 → 必须先取表头 section + 至少一行数据 section 的 DSL，才能写列定义代码。凭 API 类型推断列结构必出错

4. **DSL 精确值直接用于代码生成**

5. **图片按需引用（经 lg-dsl `image-manifest.json` 寻址，🔴 禁止直接 curl 远端 URL）**：
   - 读取 `.lg-docs/dsl/{version}/{pageId}/image-manifest.json`（lg-dsl S2 产出，契约见 `docs/image-manifest-contract.md`）
   - 编码遇 DSL 节点 `fill → url` 时：
     - **命中 `images[]`** → 拷贝 `{pageId}/images/{semanticName}` 到项目 `src/assets/{designName}/{semanticName}`（一次性）→ `<img>` 引用 `@/assets/{designName}/{semanticName}`（与 manifest `localPath` 一一对应）
     - **命中 `failedAssets[]`** → 编码前输出告警清单，按 `role/所属节点` 决定 占位 or 人工补图，**禁止静默**
     - **未命中任何条目** → 报错停止（fidelity 门应已拦截，此处兜底）
     - **业务语义映射（两阶段命名·阶段 2，🔴）**：编码时按需求还原纪律命名的组件/区块/类名，记录每张图 `fill url → 所在组件/区块业务名`（如 `topbar-avatar`、`model-thumb`；DSL 结构名如 `矩形 46` 只作占位，不作最终名）到 `.lg-docs/dsl/{version}/{pageId}/semantic-name-map.json`（`{ "<image url>": "<业务语义名>" }`）
     - **语义化回写先行（🔴 MANDATORY）**：assets 拷贝与 `<img>` src 落定**之前**，组装 `_input/semantic-rename.json = {"manifestFile":"{pageId}/image-manifest.json","nameMapFile":"{pageId}/semantic-name-map.json"}` 并运行 `node ~/.claude/skills/lg-scripts/semantic-rename.mjs --input <该文件>`；随后拷贝 `images/{最终 semanticName}` 到项目 `src/assets/`、`<img>` 引用 `@/assets/{最终语义名}`（与回写后 manifest 一致，杜绝"先结构名后业务名"两套名字分叉）

6. **（回退通道）lg-vision 识图**

### Phase 2: 代码生成

1. **加载 D2C 规范文件 + 需求数据 + 结构产物（MANDATORY）**：
   - 读取 `.lg-docs/dsl/{version}/{pageId}/component-blueprint.json`（lg-dsl S3 产出，契约见 `docs/blueprint-contract.md`）
   - **读取 blueprint.codeplans[] / featureGroups[]**（复杂页专用，契约见 `docs/2026-09-01-lg-code-codeplan-complex-page-design.md`）：
     - `complex` 页 → 按 codeplan.layers **逐层生成**（executionOrder:核心生成 store/utils/hook/component/layout/page;constants/api 为 associate 只校验引用）
     - **featureGroup 成员页** → 先处理组共享物(`build-once`,首个成员建,其余成员 `mode:reuse` + `origin:"fg_{groupId}"`);非共享层常规生成
     - `codeplan.layers[]` 全为 reuse/associate/inherit(无生成类)→ **跳过 CodeGen,直接 Phase3.5**,过即完成
   - `simple` → 单 index.vue（现有流程，退回 page-mapping outputs）

2. **需求数据注入（MANDATORY）**

3. **HARD GATE：需求/还原实现清单（MANDATORY — 未生成禁止写代码）**

   实现目标 output 前，必须先生成《需求/还原实现清单》，逐条列出（标注来源）：

   | 项 | 内容 | 来源 |
   |----|------|------|
   | 交互方式 | hover/click/弹窗/下拉菜单 | `vision.interactions[]` |
   | 提示文案 | 校验 message/空态/确认弹窗 | `vision.text_content[]` |
   | 🔴 DSL 精确值对照 | 列头/列宽/列数、按钮文字、状态标签文字+颜色、图标、间距、字号、圆角…所有 DSL 中有精确值的 UI 属性逐一对照 | DSL 各 section 原文 |
   | 🖌️ 单位换算 | 每个 DSL 物理像素值 → 项目单位（rpx/rem/px）的换算结果 | `d2c-restoration.md` 换算规则（按设计稿画布宽） |
   | 校验规则 | required/max/pattern/枚举 | `annotations[].rules` |
   | 状态变体 | 未提交/巡查中/已完成… | `vision.states[]` |
   | 降级标注 | coverage=false 的源 | `designRequirement.coverage` |
   | 图片引用 | 每张图的 manifest localPath / failedAssets 处理结论 | `image-manifest.json` |
   | 组件归属 | 每个 output 对应的 blueprint zone/overlay/repeatable | `component-blueprint.json` |
   | 逻辑归属 | 每个逻辑块 → store/hook/utils/associate + mode(reuse/extend-base/compose/new),理由可回溯 | `codeplans[].layers[].reason` |

### 🔴 D2C 编码铁律：逐 section 编码，逐个击破（MANDATORY）

**DSL 原文是唯一真相源。不提取、不摘要、不凭记忆。编码时 DSL 必须在上下文窗口中。**

每个 UI 区域按以下循环执行，一个 section 完成才进入下一个：

```
┌─ 循环开始 ─────────────────────────────────────┐
│ 1. Read DSL section 原文（mcp__getDesignSections）│
│ 2. 对着这一段 DSL，写对应的代码                     │
│ 3. 输出验证行：S{N} {元素} → code: {实际值} ✅/❌  │
│ 4. ✅ → 下一个 section  │  ❌ → 修正后回到步骤 3   │
└─────────────────────────────────────────────────┘
```

**验证行示例：**
```
S78 列头"关键要素" #999 14px → code: { title: '关键要素' } ✅
S79 关键要素 input 160×32 border #DDD → code: a-input ✅
S84 去关联 plus icon + "去关联" #1890FF → code: PlusCircleOutlined + 去关联 ✅
S87 新增 80×28 bg rgba(24,144,255,0.1) border-radius 4px → code: 80×28 ✅
S88 注 #FFA64D → code: #ffa64d ✅
```

**禁止：**
- ❌ 一次 Read 多个 section 然后凭记忆批量写代码
- ❌ 代码写完再回头找 DSL 对照（事后检查 = 漏检）
- ❌ 创建中间提取表/摘要替代 DSL 原文
- ❌ 用 API 类型、常见模式或任何非 DSL 数据源推断 UI 属性

全部 section 编码 + 逐 section 验证完成后，输出汇总：

```
🔍 逐 section 对照完成: {组件名}
S{N}-S{M}: {通过数}/{总数} ✅
```

4. **主题 token 映射**

5. **场景检测**

6. **按项目框架生成代码**

7. **代码格式强制规则**

### Phase 3: 像素对比校验（L4 视觉门）

**目标**：S4 完成后、S5 注入行为前，用「渲染结果 vs 设计稿整页截图」得出客观还原度 %。这是"百分百还原"的**唯一客观量化裁决**（L1–L3 只能证明输入完整、引用闭合）。

**前置（缺任一则按下方"禁止静默跳过"处理）**：
- 设计稿整页截图 `.lg-docs/dsl/{version}/{pageId}/design.png`（用户在 MasterGo 导出后放入；d2c-compare 前置检查缺失则阻断）
- 渲染依赖 `puppeteer`（`npm i -g puppeteer`，或项目内 `npm i -D puppeteer`；d2c-render 会在缺失时探测 puppeteer-core + 系统 Chrome 并给出安装指引）
- 对比依赖 `pixelmatch` + `pngjs`
- 目标页可打开：纯 HTML 用文件路径；Vue 工程先起 dev server 用 URL

**执行**：
```bash
# 1) 渲染目标页（HTML 文件 或 dev server URL）
node ~/.claude/skills/lg-scripts/d2c-render.mjs  <page.html|http://localhost:5173/xxx>  /tmp/page.png
# 2) 像素对比（exit 0=通过 / 1=未过，可直接做门禁）
node ~/.claude/skills/lg-scripts/d2c-compare.mjs /tmp/page.png .lg-docs/dsl/{version}/{pageId}/design.png /tmp/diff.png
```

**判定与纪律**：

| 还原度（match%） | 判定 | 动作 |
|---|---|---|
| **≥ 97%** | ✅ 通过 | 进入 S5 |
| **90% ~ <97%** | ⚠️ 人工裁决 | 打开 diff.png 定位偏差，逐处确认后可放行 |
| **< 90%** | ❌ 回修 | 回到 Phase 2 对应 section 修正，**禁止进入 S5** |

**禁止**：
- ❌ 无 `design.png` 时静默跳过——必须输出 `⚠️ 未提供 design.png，跳过 L4 视觉门` 并以人工走查代替
- ❌ 截图缺失/渲染失败时静默跳过
- ❌ 匹配度 ≥90% 区间内存在结构错位（整块缺失/错位/变形）仍放行——用 diff.png 确认偏差是"像素级"而非"结构级"

### Phase 3.5: 交付前最终核对（D2C MANDATORY）

编码过程已逐 section 验证，此处做汇总确认：

```
🔍 逐 section 对照汇总: {组件名}
DSL sections: S{N}-S{M}
编码中验证: {N}/{N} ✅
遗留 ❌: 0
交付 ✅
```

**图片引用核对（🔴 MANDATORY）：**
- **两阶段命名核对**：semantic-rename 应在 Phase2 assets 落盘 **前**已回写；若发现 `semantic-name-map.json` 存在但未回写 → 先补执行 rename 再核对，禁止带旧结构名交付
- 扫描本次生成的 `<img>`：`src` 必须为 `@/assets/{designName}/{语义名}` 且语义名 ∈ `manifest.images[].semanticName`，且**项目 `assets/` 副本文件名与 `manifest.images[].semanticName` 一一对应**（business 名为准，杜绝结构名残留）
- 出现远端 `https://` 图片 URL → 未走 manifest → 修正后重交付
- `failedAssets` 处理结论齐备（每条有 占位/补图 结论），0 悬空

**blueprint 覆盖率核对（complex 专用，🔴 MANDATORY）：**
- `blueprint.outputs` 中每个 `file` 均已生成
- `index.vue` 已按 `slots` 组装 shell/overlay/repeatable 组件，0 遗漏

**codeplan 核对（complex/featureGroup 专用，🔴 MANDATORY）：**
- **闭合**:`layers` 中 `new/extend-base/compose/page` 文件均已生成;`reuse/associate/inherit` 路径已存在;0 悬空
- **薄壳核对(软检查,白名单 §7.3)**:index.vue 只含 template/简单 computed/静态常量/事件透传;含业务校验/请求/轮询/复杂状态 → **warning**(人工 override 可放行,不自动回写)
- **layout 与 build-once**:`mode:inherit` 时不生成 layout 组件;组内共享物仅首建一次(origin:fg_* 一致性核对)
- **confirmRequired 清单**:输出全部待确认项(产物注释 `<!-- @TODO 人工确认 -->` 已标注)
- **结构化结果**:校验输出 `warnings[]/errors[]`(含 code/path/reason),供上层消费与日志建模

**取数完整性核对（🔴 MANDATORY）：**
- 已取 DSL section 数 = `totalSections − 豁免数`，且缺失清单为空 → ✅
- 任一缺项未补取、未豁免 → 禁止交付（回到 Phase 1 补取）

**占位符残留扫描（🔴 MANDATORY — 任一命中即禁止交付）：**

对本次生成（或修改）的每个文件运行扫描，确认 `applyDesign` 注入已完成：

```bash
echo '{"paths":["./src/views/{pageDir}/"]}' | node ~/.claude/skills/lg-scripts/dsl-placeholder-check.mjs
```

- 命中 `@@SVG:` 或 `T{n}|{nodeId}` 残留 → 注入未完成 → 补 `applyDesign` 后重新扫描
- 全部文件无残留 → 输出 `✅ 占位符扫描通过`

存在 ❌ → 回到对应 section 修正，不得交付。

### Phase 4: 输出

### D2C 组件使用与禁止事项

### D2C 禁止事项
- ❌ 禁止用"常见 UI 模式"推断设计稿样式
- ❌ 禁止自创提示文案
- ❌ 禁止臆断交互
- ❌ 禁止主观简化：DSL 中存在的样式字段必须逐字段还原
- ❌ 禁止跳过 section：除「显式豁免清单」列明项外，页头/侧栏/页脚/弹层等**全部 section 必须取数还原**
- ❌ 禁止交付含占位符残留的代码（`@@SVG:xxx@@` / `T{n}|{nodeId}`）：必须经 `applyDesign` 注入完整，并通过 `dsl-placeholder-check.mjs` 扫描
- ❌ 禁止直接落 DSL 物理像素值而不做项目单位换算（按 `d2c-restoration.md` 换算规则转 rpx/rem，0.5 边界按规则取整）
- ❌ 禁止在代码里直接引用 DSL 远端图片 URL；所有 `<img>` 必须经 `image-manifest.json` localPath 落盘引用
- ❌ 禁止忽略 `manifest.failedAssets`（静默缺图）；每条失败必须给出 占位/补图 结论
