# 内置主题

默认主题定义在 `lib/theme.mjs`：主色 1F4E79、背景 FFFFFF、正文 1A1A1A、强调色 2E86AB。

要换公司模板，直接用：

```bash
node scripts/build_deck.mjs --work <work> --out <work>/06-deck.pptx --template <模板.pptx>
```

模板会按 `clrScheme` 的 dk1/lt1/dk2/lt2/accent1 角色继承配色与字体；读不到时自动降级。
