---
name: lg-deck-craft
description: 把散落资料转成可演讲的 PPT（deck-craft）。适用于年终总结、述职、项目复盘、技术分享。输入资料目录、听众、时长和可选模板，输出 PPTX、讲述稿和评分卡。触发词：做 PPT、月会汇报、年终总结、述职、项目复盘。
---

# lg-deck-craft

把资料变成一份「能讲、可验证、按听众定制」的 PPT。语义工作由你（Claude）完成，确定性工作交给 `scripts/`。

## 什么时候用

- 年终总结 / 述职 / 项目复盘 / 技术分享；
- 同一批资料要按不同听众重讲（同事、领导、全员）；
- 需要判断 PPT 是否达标，而不是凭感觉。

## 输入契约

```yaml
sources: ./资料                 # 必填：目录或文件列表
audience: colleagues+leaders    # 可选：colleagues | leaders | company | custom
audience_notes: ""              # 可选：听众补充说明
duration_min: 20                # 可选，默认 20
goal: "讲清今年做了什么、带来什么改变、自己成长了什么"
template: null                  # 可选：.pptx 路径
language: zh-CN
industry: null                  # 可选：互联网/制造/金融/医疗/教育/零售
toc_template: auto              # auto | standard | tech | short | executive
style: swiss                    # swiss | default
prior_year: auto                # auto | none | <年份>
must_include: []
must_avoid: []
```

默认值：`audience=colleagues`、`duration_min=20`、`template=null`、`language=zh-CN`、`industry=null`、`toc_template=auto`、`style=swiss`、`prior_year=auto`。

## 输出

工作目录：`work/<project>/`

```
00-normalized/          资料转 md
01-facts.json           事实库
02-audience.md          听众画像
03-outline.json         故事线与页面清单
04-forward-plan.json    下一年规划（引用或推演）
gaps.md                 缺料与口径声明
05-slides/P01.json …    页面脚本
06-deck.pptx            成品
06-build-report.json    构建结果（含模板降级标记）
07-check-report.json    规则检查（check 脚本自动写入）
08-judge.json           评委打分
09-scorecard.md         评分卡
10-speaker-notes.md     讲述稿（export_notes 生成）
```

## 阶段

### 0. 收料

```bash
# 在项目根目录执行（推荐），或给脚本绝对路径
node ~/.claude/skills/lg-deck-craft/scripts/ingest.mjs --sources 资料 --out work/<project>/00-normalized
```

检查生成的 md 是否覆盖关键资料；图片会生成占位说明，需要时人工识图。

### 1. 事实抽取

读 `references/fact-model.md`，产出 `01-facts.json`。

规则：
- 每条事实带 `source`、`owner`、`caliber`、`verification_level`；
- 工作量用 `created` 口径，交付用 `closed` 口径；
- 百分数/派生值必须有 `formula`；
- 非本人产出不得计入个人成果。

校验：

```bash
node ~/.claude/skills/lg-deck-craft/scripts/validate.mjs --work work/<project> --kind facts --root .
```

`--root` 是项目根目录；省略时脚本会从 `.../work/<project>` 反推两级。

**门禁 1：事实校验失败 → 不进入大纲。**

### 2. 听众建模

读 `references/audience-profiles.md`，产出 `02-audience.md`：最关心的 3 个问题、决策标准、反感点、3–5 个刁钻问题、希望带走的一句话。

### 3. 目录提案（必须先确认）

读 `references/toc-templates.md`，按 `toc_template` 选一套目录。先只输出目录表：

`章节 → 页面 → 素材来源 → 是否有缺口`

**门禁：等用户确认、删改后，才写页面脚本。** 用户删除的章节不得偷偷补回。

确认后产出 `03-outline.json`：

```json
{
  "title": "2026 年终总结",
  "audience": "colleagues+leaders",
  "durationMin": 20,
  "weights": { "colleagues": 6, "leaders": 3, "growth": 1 },
  "pages": [
    { "id": "P01", "title": "一年做了 774 条", "core": "交付量", "facts": ["F-001"], "visual": "content", "seconds": 60 }
  ]
}
```

校验：

```bash
node scripts/validate.mjs --work work/<project> --kind outline --duration 20
```

### 4. 规划推演（仅当没有明确下一年规划时）

读 `references/forward-planning.md` 与 `references/industry-profiles.md`，产出 `04-forward-plan.json`。

- 有明确规划：直接引用，`status=confirmed`；
- 没有：从延续 / 补短 / 前瞻三类推演，`status=proposed`；
- 前瞻型必须引用 `industry:<行业>/<方向>`；
- **门禁 2：规划方向未确认 → 不进入结论页。**

校验：

```bash
node scripts/validate.mjs --work work/<project> --kind forward-plan
```

### 5. 页面脚本

每页一个 `05-slides/Pxx.json`：

```json
{
  "id": "P01",
  "title": "一年做了 774 条",
  "bullets": ["覆盖 4 个项目", "闭环率 97.9%"],
  "notes": "口播稿，约 60 秒……",
  "seconds": 60,
  "facts": ["F-001", "F-002"],
  "allowedNumbers": ["4"],
  "chart": { "type": "bar", "labels": ["1月"], "values": [97] }
}
```

校验：

```bash
node scripts/validate.mjs --work work/<project> --kind slides
```

### 6. 生成 PPTX

```bash
node ~/.claude/skills/lg-deck-craft/scripts/build_deck.mjs \
  --work work/<project> --out work/<project>/06-deck.pptx \
  --style swiss [--template <模板.pptx>]
```

- `--style swiss`：白底、网格、克莱因蓝、大数字（Style A）
- `--style default`：内置深色封面主题
- 模板可选；读不到主题时会降级并提示
- 附录页（`appendix: true`）不计入页数和讲述时长

### 7. 检查与评分

```bash
node ~/.claude/skills/lg-deck-craft/scripts/check_deck.mjs --work work/<project>
# 自动写入 07-check-report.json
```

然后按 `references/rubric.md` 产出 `08-judge.json`：

```json
{
  "dimensions": [
    { "id": "facts", "score": 4, "evidence": "..." },
    { "id": "audience", "score": 4, "evidence": "..." },
    { "id": "narrative", "score": 4, "evidence": "..." },
    { "id": "evidence", "score": 4, "evidence": "..." },
    { "id": "density", "score": 4, "evidence": "..." },
    { "id": "speakability", "score": 4, "evidence": "..." },
    { "id": "visual", "score": 4, "evidence": "..." },
    { "id": "distinct", "score": 4, "evidence": "..." },
    { "id": "plan", "score": 4, "evidence": "..." }
  ],
  "adversarial": [
    { "question": "这套东西现在谁在用？明年怎么复制？", "answered": true, "where": "P13-P14" }
  ]
}
```

```bash
node ~/.claude/skills/lg-deck-craft/scripts/score_deck.mjs --work work/<project>
```

**门禁 3：评分未达 36/45 或任一项 < 3 → 不交付，先迭代。**

### 8. 迭代

只改最低分维度，最多 3 轮；每轮记录「改了什么 → 分数变化」。

## 阶段 6.5：导出讲述稿

```bash
node ~/.claude/skills/lg-deck-craft/scripts/export_notes.mjs --work work/<project>
```

生成 `10-speaker-notes.md`，总时长与目标偏差应 ≤ 15%。

## 缺料处理

产出 `gaps.md`，显式列出缺口。规则：

- 缺上一年基线：有资料就同比；没有就**只影响统计口径**，不在页面或讲述稿提及团队成立时间、融资、历史，也不解释缺口，除非本人明确要求；
- 缺 OKR：用工作项与迭代事实替代，不虚构；
- 缺下一年规划：走第 4 阶段推演；
- 未启动项目：标注「规划中 / 未开发」，不计入当年成果；
- 缺口已声明并经本人确认：对抗审稿不否决，但对应维度最高 3 分。
- 发现 `proposed` 方向要进入结论页时，停下来问本人：确认后把 `status` 改为 `confirmed`，或改写成「建议 / 规划 / 探索」。

## 交付物说明

- `06-deck.pptx`：可直接打开、编辑；
- `10-speaker-notes.md`：按页汇总的讲述稿；
- `09-scorecard.md`：总分、维度、违规、优先改进；
- 所有中间 JSON 可二次修改后重新生成。

## 常用命令

```bash
node scripts/ingest.mjs --sources <dir> --out <work>/00-normalized
node scripts/validate.mjs --work <work> --kind facts
node scripts/validate.mjs --work <work> --kind outline --duration 20
node scripts/validate.mjs --work <work> --kind forward-plan
node scripts/validate.mjs --work <work> --kind slides
node ~/.claude/skills/lg-deck-craft/scripts/validate.mjs --work <work> --kind forward-plan
node ~/.claude/skills/lg-deck-craft/scripts/build_deck.mjs --work <work> --out <work>/06-deck.pptx
node ~/.claude/skills/lg-deck-craft/scripts/check_deck.mjs --work <work>
node ~/.claude/skills/lg-deck-craft/scripts/export_notes.mjs --work <work>
node ~/.claude/skills/lg-deck-craft/scripts/score_deck.mjs --work <work>
```
