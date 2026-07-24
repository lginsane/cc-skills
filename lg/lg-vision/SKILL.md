---
name: lg-vision
description: 使用 Qwen-VL-Max 识图，将产品图片转为结构化需求信息
---

# /lg-vision

对提取的产品图片进行识图分析。

## 流程

1. 检查已有缓存（`vision_dir/{version}/`），跳过已识别的图片
2. 对未缓存的图片逐张调用 Qwen-VL-Max：

```bash
echo '{"version":"1.4.6","screenshots":["..."],"pageMapping":{...}}' | node ~/.claude/skills/lg-scripts/vision.mjs
```

- 普通页面：UI 元素 + 交互 + 文案
- 弹窗页面：`pageMapping` 中标记 `"type":"modal"`，只分析弹窗内容
- 流程图：标记 `"type":"flowchart"`，侧重流程逻辑

结果缓存到 `vision_dir/{version}/`。

## 增强 Schema (v2)

vision.mjs 输出增加了 6 个维度的结构化信息：

| 字段 | 用途 | lg-code 使用方式 |
|------|------|-----------------|
| `layout_zones[]` | 页面空间区域划分 | 决定整体布局（侧边栏+主内容/顶部导航） |
| `component_tree{}` | 嵌套组件层级 | 生成 Vue 模板组件嵌套 |
| `visual_style{}` | 颜色/字号/间距描述 | 结合 vision-style-map.json 映射到 CSS 变量 |
| `component_details[]` | 表格列/表单字段/弹窗结构 | 生成 a-table columns、a-form fields、a-modal 配置 |
| `annotations[]` | 标注标记→UI元素→规则关联 | 生成表单校验规则、字段约束、业务逻辑 |
| `states[]` | 多状态变体描述 | 生成 SmartEnum 常量、条件渲染模板 |

所有新字段为可选字段。旧字段 `ui_elements[]` 和 `text_content[]` 保留不变。
