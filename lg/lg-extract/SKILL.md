---
name: lg-extract
description: 自动提取迭代中所有页面的产品图片，按版本分类存储
---

# /lg-extract

从墨刀提取产品图片。前置：先跑 `/lg-catalog` 获取目录。

## 流程

1. 读取 `catalog_dir` 中最新的 JSON
2. 列出版本列表 → 用户选择版本
3. 展示候选页面 → 用户确认（ok/del/flow/add）
4. 生成 manifest → 调用 extract.mjs：

```bash
echo '{"version":"1.4.6","pages":[...]}' | MODOA_PROJECT_DIR="$PWD" node ~/.claude/skills/lg-scripts/extract.mjs
```

图片存入 `screenshots_dir/{version}/`。已有图片自动跳过。
