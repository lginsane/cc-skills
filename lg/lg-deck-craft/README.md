# deck-craft

把散落资料转成可演讲的 PPT（Claude Code Skill）。

## 适用

- 年终总结、述职、项目复盘、技术分享
- 同一批资料按不同听众重讲（同事 / 领导 / 全员）
- 需要可验证的达标判断

## 输入

资料目录、听众、时长、可选模板。默认 20 分钟。

## 输出

- `06-deck.pptx`：可编辑 PPTX
- `09-scorecard.md`：9 维评分卡（≥36/45 且无单项 <3 才算达标）
- `10-speaker-notes.md`：逐页讲述稿
- 中间产物：事实库、听众画像、大纲、规划推演、页面脚本

## 换行业 / 换模板

- 行业趋势：改 `references/industry-profiles.md`
- 评分线：改 `scripts/score_deck.mjs` 的 36 分阈值
- 模板：`--template path/to/公司模板.pptx`，读不到主题会自动降级
- 版式：改 `references/pptx-layouts.md` 与 `lib/deck.mjs`

## 依赖

```bash
pnpm install
```
