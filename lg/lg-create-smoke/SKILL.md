---
name: lg-create-smoke
description: 基于分析结果生成全维度冒烟测试用例（主流程+边界+状态+异常+非预期路径），输出 xlsx
---

# /lg-create-smoke

基于分析数据生成冒烟用例。使用全部 6 类分析结果，确保全面覆盖。

## 流程

1. 读取 `analysis_dir/{version}/` 分析数据
2. 调用 Qwen-Max 按页面模块生成，逐类覆盖：

```bash
echo '{"version":"1.4.6","analyses":[...]}' | MODOA_PROJECT_DIR="$PWD" node ~/.claude/skills/lg-scripts/smoke.mjs
```

3. 生成 xlsx 到 `smoke_cases_dir/{version}/`

## 用例来源覆盖

| source | 来自分析字段 | 优先级 |
|--------|-------------|--------|
| 主流程 | test_checklist | P0 |
| 关键校验 | boundary_conditions | P0 |
| 边界条件 | boundary_conditions | P1 |
| 状态流转 | state_dependencies | P1 |
| 异常处理 | edge_cases | P1 |
| 非预期路径 | unexpected_paths | P1 |
| UI细节 | confirmation_dialogs | P2 |
