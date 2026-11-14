# 规划推演

## 触发条件

- 资料中有明确的下一年规划：直接引用、结构化，不推演。
- 资料中没有：进入推演，产出候选方向，由本人确认后才进入页面。

## 三类来源

1. **延续型（continuation）**：今年投入最多、收益最高的方向。
2. **补短型（gap_fix）**：缺陷簇、线上故障、技术债、反复出现的问题。
3. **前瞻型（foresight）**：行业与市场趋势，必须引用 `industry:` 来源。

## 输出格式

```json
{
  "directions": [
    {
      "id": "D1",
      "title": "AI 工具链复制到后端 / 产品 / 测试",
      "type": "continuation",
      "basis": ["F-032", "F-041"],
      "confidence": "high",
      "action": "先选 1 个后端场景做 MVP，再推广",
      "status": "proposed"
    }
  ]
}
```

## 规则

- 每个方向必须有 `basis`、`confidence`、`status`。
- 推断内容在 PPT 中写「规划 / 探索 / 建议」，不能写成「将实现」。
- 本人确认后 `status` 改为 `confirmed`，才可进入正式页面。
- 未确认方向只能放「候选想法」页。
