---
name: lg-schedule
description: 基于 lg-vision + lg-create-smoke 产出 + 项目组件库，通过 AI 分析真实业务内容生成前端开发排期表 xlsx
---

# /lg-schedule — 前端开发排期表生成

基于 vision（UI 结构数据）+ smoke（冒烟用例）+ 项目组件库，调用 Qwen-Max 深度分析业务内容，
自动拆解任务、估算工时、输出标准 xlsx 排期表。

## When to Use

- `/lg-schedule 1.4.8` — 为指定版本生成排期表
- 需要将设计稿/冒烟用例转化为开发排期时

## 前置条件

- 已运行 `lg-vision`，`vision/{version}/` 目录存在
- 已运行 `lg-create-smoke`，`smoke/{version}/` 目录存在 xlsx 文件
- `lg-config.json` 中 dashscope_api_key 已配置

## 流程

1. 读取 `vision/{version}/*.json` → 提取页面结构（表格列详情/表单字段详情/弹窗结构/标注规则/交互/状态）
2. 读取 `smoke/{version}/*.xlsx` → 提取按模块的 P0/P1/P2 用例分布
3. 读取 `lg-components-map.json` + 扫描 `src/components/` → 存量复用分析
4. 组装结构化 prompt → 调用 Qwen-Max 推理
5. 解析 JSON 响应 → 调用 schedule.mjs 生成 xlsx

## 调用方式

```bash
echo '{"version":"1.4.8"}' | MODOA_PROJECT_DIR="$PWD" node ~/.claude/skills/lg-scripts/schedule.mjs
```

## 输出

- xlsx 文件: `schedule_dir/{version}/V{version}-前端开发排期表-{date}.xlsx`
- 格式: 端 | 菜单 | 任务拆解 | 负责人 | 预计工时(h) | 备注
- 含小计行（菜单级）和总计行（端级）
