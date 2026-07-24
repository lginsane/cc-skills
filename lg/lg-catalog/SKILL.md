---
name: lg-catalog
description: 提取墨刀原型左侧目录结构，输出 JSON + MD
---

# /lg-catalog

提取墨刀原型左侧目录结构。

## 流程

```bash
MODOA_PROJECT_DIR="$PWD" node ~/.claude/skills/lg-scripts/catalog.mjs
```

输出到 `catalog_dir`（默认 `./..lg-docs/catalog/`）：
- `catalog-output.json`
- `catalog.md`
