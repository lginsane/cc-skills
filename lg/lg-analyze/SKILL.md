---
name: lg-analyze
description: 基于识图结果，使用 Qwen-Max 全维度分析：边界、异常、状态、非预期路径、测试清单
---

# /lg-analyze

对识图结果进行深度需求分析，产出 6 类覆盖。

## 流程

1. 读取 `vision_dir/{version}/` 中的识图 JSON
2. 汇聚 text_content + interactions + description
3. 调用 Qwen-Max 逐页分析：

```bash
echo '{"version":"1.4.6","pages":[...]}' | MODOA_PROJECT_DIR="$PWD" node ~/.claude/skills/lg-scripts/analyze.mjs
```

4. 输出到 `analysis_dir/{version}/`

## 输出字段

| 字段 | 覆盖 | 示例 |
|------|------|------|
| `edge_cases` | 异常/空状态/并发/删除确认 | 输入无效手机号→提示 |
| `boundary_conditions` | 长度/格式/数值/唯一性/排序/数量 | 名称最多10字 |
| `state_dependencies` | 状态→行为/权限变化 | 停用→不能登录 |
| `confirmation_dialogs` | 触发操作→弹窗文案 | 切换模板→确认弹窗 |
| `unexpected_paths` | 后退/刷新/分页/双击/批量 | 编辑完跳回第一页 |
| `test_checklist` | 可执行测试项 | 新增-手机号重复 |
