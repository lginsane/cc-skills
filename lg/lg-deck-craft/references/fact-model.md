# 事实库模型

每条事实必须带来源，禁止无源数字进入 PPT。

```json
{
  "id": "F-001",
  "claim": "2026 年共闭环 758 条工作项",
  "value": 758,
  "unit": "条",
  "period": "2026-01~2026-11",
  "caliber": "closed",
  "formula": null,
  "source": "资料/01-云效/2026工作项统计.md#二、完成情况",
  "owner": "梁傲",
  "verified": true,
  "verification_level": "cross_checked",
  "confidence": "high",
  "category": "delivery",
  "audience": ["leaders", "colleagues"]
}
```

## 字段

- `caliber`：`created`（创建口径）/ `closed`（闭环口径）/ `snapshot`（时点快照）
- `verification_level`：`located`（原文出现）/ `recomputed`（明细复算）/ `cross_checked`（跨源对账）
- `category`：`delivery` / `quality` / `efficiency` / `growth` / `ai` / `risk`
- `confidence`：`high` / `medium` / `low`

## 规则

1. 数字必须能回到 `source`；派生数字必须有 `formula`。
2. `verified: false` 的数据不得进入结论页。
3. 工作量统一创建口径，交付统一闭环口径；同一页不许混用。
4. 每条事实必须带 `owner`；非本人产出不得计入个人成果。

## 示例

| 事实 | value | unit | caliber | formula |
|---|---|---|---|---|
| 2026 年创建工作项 774 条 | 774 | 条 | created | null |
| 2026 年闭环 758 条 | 758 | 条 | closed | null |
| 闭环率 97.9% | 97.9 | % | closed | 758 ÷ 774 |
