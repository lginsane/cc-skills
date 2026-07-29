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
| `--mode admin` | 管理后台 | Ant Design Vue + SmartAdmin 项目 | vue-development-standards.md + constants-usage-standards.md + api-generator-from-swagger.md |
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
| `.claude/prompts/api-generator-from-swagger.md` | API 模块结构规范 | ✅ |
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

#### 7.7 嵌套深度限制

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

#### 7.8 项目中已存在的命名风格

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

**所有 .vue 文件生成完成后，必须逐条检查以下 10 项，全部通过才可交付：**

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
  // 切换模板后初始化校验状态，避免旧校验残留（如禁用模板仍显示"请输入价格"）
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
  // 清除上次关闭残留的校验状态
  nextTick(() => formRef.value?.clearValidate());
  visible.value = true;
}

// ✅ 正确：finally 块中清除（数据加载后统一处理）
async function loadData() {
  try {
    // ... 加载数据
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
    // 数据回填完成后清除可能残留的旧校验状态
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
| 动态 rules 从有→无 | `rules` 条件变化（如启用→禁用） | 条件变化后 `clearValidate()` |
| 切换 Tab 后数据重载 | Tab 切换触发新数据加载 | 数据加载后 `clearValidate()` |

## 禁止事项

- ❌ 禁止用 `bash heredoc` 批量生成 .vue 文件
- ❌ 禁止用 `sed` 批量修改 .vue 文件内容
- ❌ 禁止用 `;` 拼接多行 JavaScript 语句
- ❌ 禁止在同一规则对象中同时使用 `required` 和自定义 `validator` 且都为空值报错（见规则 8.1）
- ❌ **禁止能用原子类表达的样式写在 `<style scoped>` 中**（如 `display: flex` → `class="flex"`、`font-size: 28rpx` → `class="text-28rpx"`）
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

**映射规则：**
- color_palette 中每条描述 → 逐一匹配 color_map，匹配成功的输出 CSS 变量注释
- typography 中每条描述 → 匹配 typography_map
- spacing 中每条描述 → 匹配 spacing_map
- 匹配失败则使用 Ant Design 默认值

### 4. component_details → 组件配置

**表格 (type=table)：**
```javascript
// 从 component_details[].columns 生成 a-table 列定义
const columns = detail.columns.map(col => ({
  title: col.title,
  dataIndex: col.dataIndex,
  width: col.width ? parseInt(col.width) : undefined,
  sorter: col.sortable || false,
  fixed: col.fixed || false
}));
```

**弹窗 (type=dialog)：**
- `width` → `<a-modal :width="600">`
- `fields` → 遍历生成 `<a-form-item>`
- `sections` → 如有多 section，用分割标题分组

### 5. annotations → 校验规则和约束

**annotation_type=validation 或 constraint：**
```javascript
// 遍历 annotations[]，为对应字段生成 rules
const formRules = {};
for (const anno of annotations.filter(a => a.target && (a.annotation_type === 'validation' || a.annotation_type === 'constraint'))) {
  const fieldName = inferFieldName(anno.target); // 推断字段名
  formRules[fieldName] = [
    ...(anno.rules?.required ? [{ required: true, message: `请输入${anno.target}` }] : []),
    ...(anno.rules?.max ? [{ max: anno.rules.max, message: `最大值为${anno.rules.max}` }] : []),
    ...(anno.rules?.maxlength ? [{ max: anno.rules.maxlength, message: `最多${anno.rules.maxlength}个字符` }] : []),
    ...(anno.rules?.pattern ? [{ pattern: new RegExp(anno.rules.pattern), message: '格式不正确' }] : []),
  ];
}
```

**annotation_type=business_logic：**
- 生成注释和条件判断逻辑
- 如 "停用后机构不能登录" → 生成 `v-if` 或 `disabled` 逻辑

**annotation_type=interaction：**
- 补充到 interactions[] 的处理逻辑中

### 6. states → 枚举和条件渲染

**生成 SmartEnum 常量：**
```javascript
// 从 states[].variants 生成枚举值
// states: [{element: "认证状态", variants: [{state: "通过", color: "green"}, ...]}]
// → 在 src/constants/ 中新建或更新对应枚举
// → 在表格中使用 $smartEnumPlugin.getDescByValue('CERT_STATUS_ENUM', value)
```

**生成条件渲染：**
```html
<!-- states 中的 color 映射为 a-tag color 属性 -->
<a-tag v-if="record.status === '通过'" color="green">通过</a-tag>
<a-tag v-else-if="record.status === '未通过'" color="red">未通过</a-tag>
<a-tag v-else color="orange">认证中</a-tag>
```

## 组件开发
# /component — Component Development

Develop Vue 3 components with automatic classification, documentation generation, and component map registration.

## When to Use

- "Create a BaseCard component"
- "Build a UserAvatar component for the user module"
- "Extract this repeated pattern into a reusable component"

## Pipeline

### Step 1: Check for Duplicates

Search `component-map.json` and `src/components/` for existing similar components before creating a new one. If a component already covers this use case, suggest reusing or extending it.

### Step 2: Classify the Component

| Type | Directory | Reuse Scope | Prefix | Doc Required |
|---|---|---|---|---|
| **Public** | `components/common/` | Global | `Base` / `App` | ✅ README.md |
| **Business** | `components/business/{module}/` | Same module | Business abbreviation | Suggested |

**Public component checklist** (at least 2 of 3):
1. Used in ≥ 3 different pages
2. Not dependent on business data models
3. Pure display or generic interaction (no business rules)

### Step 3: Design the API

Define before coding:
- **Props**: Name, Type, Default, Required, Validator
- **Emits**: Event name, Parameters
- **Slots**: Name, Purpose, Fallback content
- **Expose**: Methods/properties exposed to parent (if needed)

```vue
<script setup>
const props = defineProps({
  title: { type: String, default: '' },
  type: { type: String, default: 'default', validator: v => ['default', 'primary', 'danger'].includes(v) },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'submit', 'change']);

defineSlots({
  header: 'Custom header content',
  default: 'Main content area',
  footer: 'Action buttons area',
});
</script>
```

### Step 4: Implement with Mandatory States

Every component must handle these edge cases:

| State | Trigger | Implementation |
|---|---|---|
| Empty Props | Props not provided or empty | Default values + empty state slot fallback |
| Invalid Props | Props value out of range | Validator warning + graceful degradation |
| Loading | `loading` prop = true | Skeleton / Spin / Semi-transparent overlay |
| Error | Data fetch failure | Error display + retry emit |
| Empty Data | Data array is empty | a-empty + action guidance |

### Step 5: Style Rules (ENFORCED)

```
✅ <style lang="less">           ← 是否 scoped 遵循项目规范（由 lg-init 检测决定）
✅ :deep(.ant-table) { ... }     ← For style penetration (scoped 模式时)
✅ BEM naming for all custom CSS classes  ← Block__Element--Modifier
❌ /deep/ or >>>                  ← Deprecated
❌ body { }, html { }, * { }     ← NO global styles in components
❌ camelCase or snake_case in class names ← e.g. .userCard .user_card
```

### Step 6: Generate README.md

Auto-generate documentation for public components:

```markdown
# ComponentName

Brief description.

## Props
| Name | Type | Default | Required | Description |
|---|---|---|---|---|
| title | String | '' | No | Card title |

## Events
| Name | Parameters | Description |
|---|---|---|
| close | - | Emitted when card is closed |

## Slots
| Name | Description |
|---|---|
| header | Custom header |
| default | Main content |

## Usage
\`\`\`vue
<ComponentName type="primary" @close="handleClose">
  Content
</ComponentName>
\`\`\`
```

### Step 7: Register in Component Map

Add entry to `.claude/config/component-map.json`:

```json
{
  "CustomComponent/Primary": {
    "codeComponent": "BaseCard",
    "codePath": "@/components/common/BaseCard.vue",
    "lastVerified": "2026-06-09"
  }
}
```

If a Figma component mapping exists, link `figmaComponentId`.

## Output Format

```
✅ /component Complete

Type: Public Component
Generated:
  📄 src/components/common/BaseCard.vue (85 lines)
  📄 src/components/common/BaseCard.README.md
  📋 component-map.json (+1 entry)

States: Empty Props ✅, Invalid Props ✅, Loading ✅, Error ✅, Empty Data ✅
```

## D2C Mode

当 `--mode d2c` 时走此流程。与 admin 模式完全独立，不共享规范文件和自检规则。

### Phase 1: 识图提取

1. 检查 MasterGo MCP 是否可用（`mcp__getDesignSections` 工具是否存在且可调用）
   - 可用 → 调用 MasterGo DSL 工作流（预留，当前跳过）
   - 不可用 → 走 lg-vision 识图
2. 调用 lg-vision 识图，传递增强精度参数：
   ```bash
   echo '{"version":"X.X.X","screenshots":["..."],"pageMapping":{...},"mode":"d2c"}' | node ~/.claude/skills/lg-scripts/vision.mjs
   ```
   注意 `"mode":"d2c"` 字段，触发 vision.mjs 的精度增强 prompt。
3. 读取 vision 输出 JSON，提取：
   - `layout_zones[]` → 整体布局方向
   - `component_tree{}` → 组件嵌套层级
   - `visual_style{}` → 通过 vision-style-map.d2c.json 映射样式值
   - `component_details[]` → 表格列/表单字段配置
   - `annotations[]` → 表单校验规则
   - `states[]` → 条件渲染
   - `text_content[]` → 页面文案

### Phase 2: 代码生成

1. **加载 D2C 规范文件（MANDATORY）**：

| 文件 | 用途 | 必须 |
|------|------|------|
| `.claude/prompts/page-development.md` | 项目页面开发规范（技术栈/组件/代码模式） | ✅ |
| `.claude/prompts/d2c-restoration.md` | 还原专用规则（样式还原/质量门禁/禁止事项） | ✅ |
| `.claude/config/vision-style-map.d2c.json` | 样式描述→项目精确值映射 | ✅ |
| `CLAUDE.md` | 项目技术栈、目录结构 | ✅ |
| `.claude/config/lg-components-map.json` | 项目组件清单 | ✅ |
| `src/api/` | API 模块结构 | ✅ |

2. **场景检测**（与 admin 共享检测逻辑）：
   - list/table/search → 列表页
   - detail/info/view → 详情页
   - form/create/edit → 表单页
   - modal/dialog/drawer → 弹窗

3. **按项目框架生成代码**：
   - uni-app: Page 组件包裹 + MeScroll 列表 + BEM 命名 + rpx 单位
   - Vue3 H5: Composition API + scoped SCSS/Less + BEM 命名 + rem/vw 单位
   - 纯 Web: HTML + CSS + BEM 命名
   - **所有框架的自定义 CSS/LESS/SCSS 类名统一使用 BEM 命名规范**

4. **代码格式强制规则**：
   - 禁止用 `;` 拼接多语句到一行
   - 每个 import/const/let/function 独立一行
   - 模板属性多时换行对齐
   - **所有自定义 CSS 类名必须使用 BEM 命名（详见 Core Rules §7）**

### Phase 3: 像素对比校验

#### 3.1 渲染截图

```bash
node ~/.claude/skills/lg-scripts/d2c-render.mjs <generated-html> .lg-docs/diff/<page-name>-render.png
```

备选：如果 d2c-render.mjs 因缺少依赖无法运行，手动在浏览器打开生成的 HTML 并截图保存到相同路径。

#### 3.2 像素对比

```bash
node ~/.claude/skills/lg-scripts/d2c-compare.mjs \
  .lg-docs/diff/<page-name>-render.png \
  <design-original-png> \
  .lg-docs/diff/<page-name>-diff.png
```

解析输出 JSON：
- `passed: true` + `pixelMatch.matchPercent >= 97` → 进入 Phase 4 输出
- `passed: false` 或 `matchPercent < 97` → 进入自动修复

#### 3.3 自动修复

读取 `diffHeatmap` 差异热力图，使用 Claude 视觉能力分析：
1. 辨别差异区域对应的 UI 元素
2. 检查 `d2c-compare.mjs` 输出的 `detailChecks` 各指标
3. 调整对应 CSS 样式参数
4. 用 Edit 工具修改代码 → 返回 Step 3.1 重新渲染
5. 计数器 +1，超过 3 轮 → 终止循环 → 输出差异报告

#### 3.4 依赖检测

在首次进入 Phase 3 时检测：
```bash
node -e "import('pixelmatch').catch(()=>process.exit(1))" 2>/dev/null && echo "pixelmatch: ✅" || echo "pixelmatch: ❌ npm install pixelmatch pngjs"
node -e "import('puppeteer').catch(()=>process.exit(1))" 2>/dev/null && echo "puppeteer: ✅" || echo "puppeteer: ❌ npm install puppeteer"
```

缺少依赖时提示安装，Phase 3 降级为手动验收模式。

### Phase 4: 输出

输出格式：
```
✅ /lg-code --mode d2c 完成

📐 页面: {page-name}
📱 框架: {framework}
📄 生成文件:
   {file-path}  ({lines}行)

🎨 还原度报告:
┌────────────┬─────────┬──────────┐
│ 指标        │ 设计稿   │ 实际值    │ 状态  │
├────────────┼─────────┼──────────┤
│ ...         │ ...      │ ...       │ ✅/⚠️  │
└────────────┴─────────┴──────────┘
综合还原度: {percent}%
迭代次数: {rounds} 轮
差异热力图: .lg-docs/diff/{page-name}.png
```

### D2C 禁止事项

- ❌ 不允许使用管理后台组件库（SearchCard/TableCard/PageContainer 等）
- ❌ 不允许简化设计稿的视觉效果
- ❌ 不允许在未标注差异的情况下修改样式参数
- ❌ 不允许混用跨框架特定语法
- ❌ 不允许使用非 BEM 命名的 CSS 类名（如驼峰 `.userCard`、单下划线 `.user_card`）
- ❌ 禁止用 bash heredoc 批量生成 .vue 文件
- ❌ 禁止用 sed 批量修改 .vue 文件
- ❌ 禁止用 `;` 拼接多行 JavaScript 语句
- ✅ 必须用 Write/Edit 工具逐文件生成
