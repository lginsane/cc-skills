---
name: lg-api-code
description: 从 Swagger 文档生成前端 API 定义代码，遵循项目规范
---

# /lg-api-code

基于 Swagger/OpenAPI 后端接口文档，生成前端 API 模块代码。

## 前置检查（MANDATORY）

编码前必须 Read 以下文件：

| 文件 | 用途 | 必须 |
|------|------|------|
| `.claude/prompts/api-generator-from-swagger.md` | 完整 Swagger → API 生成规范（6步流程） | ✅ |
| `.claude/prompts/constants-usage-standards.md` | 常量注册/引用规范（与API配套） | ✅ |
| `src/lib/axios.js` | 请求封装（getRequest/postRequest/postEncryptRequest） | ✅ |
| `src/api/` | 现有 API 模块结构和命名规范 | ✅ |
| `.claude/config/lg-config.json` | Swagger URL + api_dir 配置 | ✅ |
| `.claude/config/type-registry.json` | 去重注册表（生成前查重，生成后更新） | ✅ |

## 调用模式

| 命令 | 用途 |
|------|------|
| `/lg-api-code` | 默认模式：从 Swagger 生成 API 代码（含自动去重 + 注册表更新） |
| `/lg-api-code --check-duplicates` | **检查模式**：全量扫描已有代码，检测重复 type/enum 定义，输出报告 |
| `/lg-api-code --update-registry` | **维护模式**：全量扫描代码文件，重建 `type-registry.json` |

### `/lg-api-code --check-duplicates`

不依赖 Swagger，仅扫描已有代码文件。

**扫描范围：**

| 目录 | 文件模式 | 说明 |
|------|----------|------|
| `src/enums/` | `*.ts` | 全局枚举目录 |
| `src/types/business/` | `*.ts` | 全局业务类型目录 |
| `src/api/business/*/` | `enums.ts` | 各模块局部枚举 |
| `src/api/business/*/` | `types.ts` | 各模块局部类型 |

**检测逻辑：**

1. **Type 重复检测** — 提取所有 `export interface Xxx { ... }` 定义，交叉比较字段名集合：
   ```
   对每对 (A, B)：
     overlap = |A.fields ∩ B.fields| / max(|A.fields|, |B.fields|)
     if overlap >= 0.8 → 报告重复
   ```
2. **Enum 重复检测** — 提取所有 `export enum Xxx { ... }` 定义，分两阶段比较：

   **阶段 1 — 值匹配：**
   ```
   对每对 (A, B)：
     if A.values 排序后 === B.values 排序后 → 进入阶段 2
   ```

   **阶段 2 — 语义过滤（避免纯数值巧合误报）：**
   ```
   满足以下任一条件则报告重复，否则视为巧合（不报告）：
     - A.desc === B.desc && A.desc !== ""              （描述完全一致）
     - A.desc 和 B.desc 共享关键词（如都含"平台"/"状态"/"类型"）
     - A.name 和 B.name 共享关键词（如都含 Platform/Status/Type）
     - A.location 和 B.location 都在 src/api/business/ 下且模块不同
       （同一 Swagger 的不同前缀，很可能语义相同）

   不满足 → 跳过，注释 "# 值相同但语义不同，跳过"
   ```

   > 示例：`FileFolderTypeEnum [1,2,3,4]` 和 `PublishPlatformEnum [1,2,3,4]` 值相同，
   > 但 desc 分别为"文件类型"和"发布平台"，无共享关键词 → **不报告为重复**。
   > 而 `DmsPlatformEnum [1,2,3,4]` 和 `PublishPlatformEnum [1,2,3,4]`，
   > desc 都含"平台" → **报告为重复**。

3. **枚举名冲突值不匹配检测** — 扫描所有同名 TS enum，检查不同模块间是否存在同名但值语义不同的枚举：
   ```
   对每对同名枚举 (A, B)：
     if A.values != B.values → 报告「同名异值」冲突
     输出 A 和 B 的完整值映射
   ```

   > 示例：`TradeTypeEnum`（invoice 模块）vs `TradeTypeEnum`（power 模块）  
   > 若前者值 `{0:品宣种草, 1:寄拍素材}` 后者值 `{1:充值消费, 2:退款}`  
   > → **报告同名异值冲突**，建议重命名为 `InvoiceTradeTypeEnum` / `PowerTradeTypeEnum`

4. **Params/Response 混用检测** — 扫描所有 Response/Vo/Detail 类型的字段：
   ```
   对每个 export interface XxxResponse / XxxVo / XxxDetail：
     对每个字段：
       if 字段类型名称以 "Params" 结尾 → 报告混用
   ```
   > 示例：`PlanBurstDetail.planBurstDetailReq: MerchantBurstAddParams` → **报告为混用**

**输出格式：**

```
🔍 代码重复检测报告
═══════════════════════════════════════════════════════

⚠️ 发现 2 处重复定义

1. [ENUM 重复] 发布平台
   A: DmsPlatformEnum    → src/api/business/dms/enums.ts
      values: XIAOHONGSHU=1, DOUYIN=2, SHIPINHAO=3, TAOBAO=4
   B: PublishPlatformEnum → src/enums/plan-enum.ts
      values: XHS=1, DY=2, SPH=3, TB=4
   💡 建议：合并到 src/enums/plan-enum.ts，DmsPlatformEnum 改为 import

2. [TYPE 重复] 产品信息 (80% 字段重叠)
   A: ProductVo          → src/api/business/dms-merchant/types.ts
   B: BurstProductInfo   → src/api/business/plan-burst/type.ts
   💡 建议：提取共享 type 到 src/types/business/，二者 import

═══════════════════════════════════════════════════════
```

### `/lg-api-code --update-registry`

全量扫描代码文件，重建 `.claude/config/type-registry.json`。

**流程：**

1. 扫描上述所有范围的文件
2. 提取所有 `export interface` 定义（名称 + 字段名列表 + 文件路径）
3. 提取所有 `export enum` 定义（名称 + 值集合 + 文件路径）
4. 自动检测 aliases（相同 values 的不同枚举名 → 标记为 alias）
5. 写回 `.claude/config/type-registry.json`，更新 `version` 和 `updatedAt`

**输出格式：**

```
🔄 注册表更新完成
types:  15 条目
enums:  8 条目（含 1 组 aliases: DmsPlatformEnum → PublishPlatformEnum）
```

### 注册表维护时机

| 场景 | 触发方式 | 操作 |
|------|----------|------|
| 正常生成 | 自动 | Step 6 自动 append/update |
| 手动修改代码后 | 手动 | `/lg-api-code --update-registry` 全量重建 |
| 定期检查 | 手动 | `/lg-api-code --check-duplicates` 扫描 |
| 生成前 | 自动 | 读注册表做轻量一致性检查（location 路径是否存在，不存在则标记 stale） |

## 流程

按照 `.claude/prompts/api-generator-from-swagger.md` 的 6 步流程执行：

1. Fetch + 解析 Swagger 文档
2. 提取接口，**按 URL 路径前缀 `/xx/*` 分组**（非 Tag）
3. 扫描 `src/api/` 现有模块，与 Swagger 对比（增量生成，不覆盖已有）
4. 扫描 `src/enums/` 提取已有 TS 枚举（去重）；扫描 `src/constants/` 检查常量冲突
5. 生成 **3 个文件**到模块目录（`api.ts` + `types.ts` + `enums.ts`）
6. **🔴 枚举值交叉验证（MANDATORY）** — 对每个 schema 字段引用的枚举类型，必须执行以下检查：
   - 从 Swagger schema `description` 中提取枚举值映射（如 `0-品宣种草 1-寄拍素材`）
   - 若项目中已存在同名枚举（通过 import 路径匹配），对比已有枚举的值与 Swagger description 是否一致
   - **不一致 → 禁止复用**：必须新建枚举（加模块前缀或覆盖旧值），不可静默复用
   - 示例：`TradeTypeEnum` 已有 `RECHARGE_CONSUME=1`，但 Swagger description 为 `0-品宣种草`，值语义完全不同 → 报错并更新
7. **响应类型交叉验证（MANDATORY）** — 生成后必须扫描所有 Response/Vo/Detail 类型字段：
   - 检查是否有字段引用了 `*Params` 后缀的类型
   - 如有 → 报告为错误，替换为对应的 Response/Vo 类型
   - 如对应的 Response 类型不存在 → 新建，即使字段完全一样也不能复用 Params
8. 检查跨模块引用：若枚举/类型被 >=2 模块引用，提示提升到 `src/enums/` / `src/types/`

## 生成文件结构

每个 URL 前缀模块独立一个目录，产出 **3 个独立文件**：

```
src/api/business/{prefix}/            # /dms/**
├── {prefix}-api.ts  # 纯 API 方法
├── types.ts         # 请求参数/响应 interface
└── enums.ts         # 本模块专用 TS 枚举

src/api/business/{prefix2}/           # /dmsEmp/**
├── {prefix2}-api.ts # 不同前缀 → 独立目录
├── types.ts
└── enums.ts
```

### {prefix}-api.ts 模板

```ts
/**
 * {模块名} api 封装
 * @author auto-generated by lg-api-code
 */
import { postRequest, getRequest } from '/@/lib/axios';
import { ResponseModel } from '/@/api/base-model/response-model';
import type { XxxParams, XxxResponse } from './types';

export const {module}Api = {
  /** 分页查询 */
  queryPage: (param: XxxParams) => postRequest<ResponseModel<XxxResponse>>('/{module}/queryPage', param),

  /** 获取详情 */
  getDetail: (param: any) => getRequest<ResponseModel<XxxResponse>>('/{module}/detail', param),
};
```

> 🔴 **响应类型注解规则：**
> - 所有 `postRequest` / `getRequest` 必须加 `<ResponseModel<T>>` 泛型
> - 有返回值 → `postRequest<ResponseModel<XxxResponse>>`
> - 无返回值（新增/修改/删除） → `postRequest<ResponseModel<void>>`

### types.ts 模板

```ts
/**
 * {模块名} - 类型定义（XxxParams = 入参, XxxResponse = 出参）
 * @author auto-generated by lg-api-code
 */

/** 分页查询入参 */
export interface XxxParams {
  /** 页码(不能为空) */
  pageNum: number;
  /** 每页数量(不能为空) */
  pageSize: number;
}

/** 分页查询出参 */
export interface XxxResponse {
  /** 结果集 */
  list: any[];
  /** 总记录数 */
  total: number;
}
```

**属性注释规则（MANDATORY）：**

- 每个 interface 属性上方必须添加 `/** 中文含义 */` 注释
- 注释内容来源：Swagger `definitions` → 对应 Schema `properties` → 字段的 `description`
- 如 Swagger 未提供 description，根据字段名和后端惯例推断含义
- 注释格式统一使用单行 `/** 描述 */` 放在属性上方

**雪花算法 ID 规则（MANDATORY）：**

- 后端使用雪花算法生成 ID，Swagger 中定义为 `integer`，但实际返回 **字符串**
- 所有 ID 相关字段（字段名以 `Id` 结尾，如 `userId`、`dmsEmpId`、`accountId`）一律标注类型为 `string`
- 注释中需标注 `（雪花算法，实际为字符串）` 说明原因

**类型命名与引用规范（MANDATORY）：**

| 后缀 | 语义 | 使用场景 |
|------|------|----------|
| `XxxParams` | 入参 | 仅用于 API 请求参数（如 `postRequest<XxxParams>`） |
| `XxxResponse` | 出参 | 仅用于 API 响应体（如 `ResponseModel<XxxResponse>`） |
| `XxxVo` / `XxxDetail` | 展示对象 | 内嵌于 Response 中的业务实体 |
| `XxxItem` | 列表项 | 数组元素类型 |

> 🔴 **禁止规则：**
> - **Response / Vo / Detail 类型的字段禁止引用任何 `*Params` 类型**
> - 入参（`XxxParams`）和出参（`XxxResponse`）必须使用不同的类型定义，即使字段完全一样
> - 错误示例：`planBurstDetailReq: MerchantBurstAddParams`（Response 中引用 Params）
> - 正确示例：`planBurstDetailReq: MerchantBurstDetailResponse`（Response 中引用 Response）

### enums.ts 模板

```ts
/**
 * {模块名} - TS 枚举定义
 * @author auto-generated by lg-api-code
 */

/** 从 Swagger enum 字段提取的 TypeScript 枚举 */
export enum XxxEnum {
  /** 值A中文含义 */
  VALUE_A = 'VALUE_A',
  /** 值B中文含义 */
  VALUE_B = 'VALUE_B',
}
```

**枚举值注释规则（MANDATORY）：**

- 每个枚举值上方必须添加 `/** 中文含义 */` 注释
- 注释内容来源：从后端接口文档 / Swagger `@ApiModelProperty.description` 推断各枚举值的业务含义

**🔴 枚举复用校验规则（MANDATORY）：**

> **绝不允许仅凭「同名」就复用已有枚举。** 必须对比值语义是否匹配。

生成 enums.ts 时，对每个 Swagger schema 字段（如 `tradeType: integer # 交易类型 0-品宣种草 1-寄拍素材`）：

1. 从 Swagger `description` 中解析枚举映射：`{0: '品宣种草', 1: '寄拍素材', ...}`
2. 在已有代码中搜索同名 TS enum（按 `enum XxxEnum` 名称 + import 路径匹配）
3. 若找到同名枚举，逐值对比：
   ```
   对每个 key：
     Swagger description 的语义 vs 已有 enum key 的注释/desc
     若语义明显不同（如 Swagger 说"品宣种草"但已有 enum 说"充值消费"）
     → 🔴 冲突！不可复用
   ```
4. **冲突处理**：
   - 若当前 Swagger 是权威来源 → **覆写**已有 enum 值（并同步更新 SmartEnum 常量）
   - 若已有 enum 来自另一个 Swagger 模块且有不同语义 → **新建**带模块前缀的枚举（如 `DmsTradeTypeEnum`）

> 示例：Swagger `tradeType: 0-品宣种草 1-寄拍素材 2-赠拍素材 3-邮寄运费`，
> 已有 `TradeTypeEnum { RECHARGE_CONSUME=1, REFUND=2 }`，
> 值集合 `{0,1,2,3}` ≠ `{1,2}` 且 key 语义完全不同 → **冲突，覆盖旧值**。

### constants/ 模板（SmartEnum）

> 🔴 **强制规则：生成 enums.ts 后必须同步生成对应的 SmartEnum 常量文件，二者成对产出。**

```ts
/**
 * {模块名} - SmartEnum 常量映射
 * @author auto-generated by lg-api-code
 */
import { SmartEnum } from '/@/types/smart-enum';
import { XxxEnum } from '/@/api/business/{module}/enums';

/** 枚举中文含义 */
export const XXX_ENUM: SmartEnum<XxxEnum> = {
  VALUE_A: {
    value: XxxEnum.VALUE_A,
    desc: '值A中文含义',
  },
  VALUE_B: {
    value: XxxEnum.VALUE_B,
    desc: '值B中文含义',
  },
};
```

**SmartEnum 常量规则（MANDATORY）：**

- 文件命名：与 `src/api/` 目录结构保持一致，`src/api/business/{module}/` → `src/constants/business/{module}-const.ts`，其他目录同理
- 变量命名：大写下划线 `XXX_ENUM`，与 enum 类型名对应
- `value` 字段引用 `enums.ts` 中的枚举值（而非直接写字符串/数字）
- `desc` 字段与枚举值注释保持一致
- 生成后需在 `src/constants/index.ts` 中注册导出

### enums.ts 与 constants/ 的关系

```
enums.ts                          constants/{module}-const.ts
─────────                         ──────────────────────────
enum DmsUserTypeEnum {            DMS_USER_TYPE_ENUM: SmartEnum<DmsUserTypeEnum>
  /** 管理员员工 */                   ADMIN_EMPLOYEE: { value: DmsUserTypeEnum.ADMIN_EMPLOYEE,
  ADMIN_EMPLOYEE = 'ADMIN_EMPLOYEE',                    desc: '管理员员工' }
}                                 }

TS enum 定义枚举字面值            SmartEnum 定义 value+desc 映射，用于 UI 渲染
                                  （smart-enum-select / smart-enum-radio 等组件）
```

- `enums.ts` — 定义 TS `enum`（`XxxEnum` 后缀），值来自 Swagger `enum` 字段
- `constants/` — 定义 `SmartEnum<T>` 对象，泛型 T 来自 enums.ts 的 enum 类型
- **生成时必须同时产出 enums.ts + SmartEnum 常量文件，不可只生成其一**

## 全局提升规则

生成的 `enums.ts` / `types.ts` 中，若某 TS 枚举或 type 被 **>=2 个模块引用**：
- TS enum -> 手动移动到 `src/enums/`
- type / interface -> 手动移动到 `src/types/business/`
- 更新所有 import 路径

## 配置

`.claude/config/lg-config.json`:
```json
{
  "swagger_url": "https://api.example.com/v2/api-docs",
  "api_dir": "./src/api/"
}
```
