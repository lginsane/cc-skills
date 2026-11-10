---
name: lg-create-smoke
description: 基于分析结果 + UI设计稿生成全维度冒烟测试用例（主流程+边界+状态+异常+非预期路径），输出 xlsx
---

# /lg-create-smoke

基于分析数据 + UI设计稿信息生成冒烟用例。结合 analysis（抽象分析）和 vision（UI结构）双重数据源，确保用例精确到字段/规则级。

## 流程

1. 读取 `analysis_dir/{version}/` 分析数据（6 类覆盖）
2. smoke.mjs 自动读取 `vision_dir/{version}/` UI设计稿数据（组件结构/标注规则/交互/状态）
3. 调用 Qwen-Max 按页面模块生成，逐类覆盖：

```bash
echo '{"version":"1.4.6","analyses":[...]}' | MODOA_PROJECT_DIR="$PWD" node ~/.claude/skills/lg-scripts/smoke.mjs
```

4. 生成 xlsx 到 `smoke_cases_dir/{version}/`

## 双重数据源

| 来源 | 数据类型 | 提供内容 | 优先级 |
|------|---------|---------|--------|
| analysis | 抽象分析 | 边界条件/状态依赖/异常场景/非预期路径/测试清单 | P0-P1 |
| vision | UI结构 | 表格列名/表单字段(label+type+required)/弹窗结构/标注规则(validation+constraint)/交互流程/状态变体 | P0-P2 |

## 用例来源覆盖

| source | 来自数据 | 优先级 |
|--------|-------------|--------|
| 主流程 | analysis:test_checklist + vision:component_details/interactions | P0 |
| 关键校验 | analysis:boundary_conditions + vision:annotations(校验规则) | P0 |
| 边界条件 | analysis:boundary_conditions + vision:component_details(表单字段) | P1 |
| 状态流转 | analysis:state_dependencies + vision:states | P1 |
| 异常处理 | analysis:edge_cases | P1 |
| 非预期路径 | analysis:unexpected_paths | P1 |
| UI细节 | analysis:confirmation_dialogs + vision:ui_elements/text_content | P2 |

## Vision 数据对准确度的提升

- **component_details**: 将用例从"验证必填字段"提升为"在【项目名称】输入框留空点击提交，预期提示'请输入项目名称'"
- **annotations**: 将用例从"验证长度限制"提升为"在项目名称输入框输入51个字符，预期提示'不能超过50个字符'"
- **states**: 补充多状态下的UI变化验证（如"已完成状态下负责人下拉框置灰不可选"）
