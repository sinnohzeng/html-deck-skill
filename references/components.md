# 组件类手册

模板 `<style>` 是类名唯一来源。用到清单外的类 = 先补样式再用；禁止凭空发明类名。

## 类名总清单（预检用）

- **页骨架**：`slide` `dark` `bg-img` `bg-cover` `bg-project` `bg-divider` `bg-closing`
  `head` `body` `body.flow` `fill` `foot` `compact`
- **标题/文字**：`eyebrow` `title` `rule` `sub` `kicker` `sans` `accent` `mega`
- **收口强调**：`take`（lab/ph）`band`（blab）`redline`（lab/ph）
- **页脚**：`foot-logo` `brand` `nav`（`cur` `rp`）`src`（来源行，默认隐藏备用）
  `pg`（页码，默认隐藏备用）`cover-logo` `close-logo` `cover-mark`
  `cover-hero` `lift` `cover-eyebrow-mark` `cover-foot-logo`
- **网格/清单**：`grid` `num-item`（n）`concl` `toc-row`（tn/tt/ts）`kv`（k/v）
  `badges`（blab/bd）`chips` `chip`
- **表格族**：`mck` + 修饰 `tight` `ops` `cmp` `budget`（grp/sum）`grouped`（gs/hl）
  `flat`（span）+ 单元格 `pick` `rep` `amt` `num` `dim`
- **版式组件**：`duo`（panel/plabel/pname）`modecards`（modecard/verdict/mname/amt/unit）
  `road`（stage/tag/when/lines/key）`pano`（col x1 x2/dh/dn/sysbox/scene/nm/who/note）
  `stack`（layer l-app l-tech l-know/lh/ln/lt/who assoc firm/lm）
  `flow`（fbox/ft/farr/a/al）`pace`（pace-lane/pace-id/pace-tag/pace-name/pace-step/pace-no/pace-arrow）

## 关键组件用法与易错点

### `.slide` 三段式

`head`（flex:none）+ `body`（flex:1，**默认竖直居中**）+ `foot`（flex:none）。
个别页要顶对齐用 `.body.flow`；带 `.fill` 的页在两种对齐下表现一致。
深色页加 `.dark`（文字/eyebrow/nav 全套自动反白）。

### 表格族 `.mck` 密度决策

| 场景 | 写法 |
|---|---|
| 常规 ≤ 5 行 | `.mck` |
| 行多、先收行距 | `.mck.tight`（padding 12px） |
| 仍溢出、最后手段 | `.mck.ops`（27px 字号 + 1.26 行高） |
| 备查对比表（多行 + 结论行） | `.mck.tight.cmp` |
| 预算/分组账目 | `.mck.tight.budget`（`.grp` 组格 + `tr.sum` 合计行） |
| 跨行 rowspan 分组 | `.mck.grouped`（`tr.gs` 组首粗线 + `tr.hl` 例外行高亮） |
| colspan 共性行 | `.mck.flat` + `td.span` |

**斑马纹冲突**：`budget`/`grouped`/`flat` 都会停用斑马纹——分组线、rowspan、pick 列与
斑马纹互相打架，靠分隔线 + 单点高亮分层。
**推荐列 `.pick`**：thead 的 th 与 tbody 的 td 都要挂，只挂 tbody 会出现"蓝身白头"。
**金额**：`td.num` 右对齐 + tabular-nums；金额文字包 `<b>`（budget 表内自动 nowrap）。

### 竖直溢出的正确处理顺序

1. 删文案（首选，永远优先）；2. 表格上密度类；3. 整页 `.slide.compact`（num-item/
stack/concl 字号与间距回落一档）；4. 局部行内 style 微调。
**禁止**：改 `--type-*` token、改 `--pad-*` 页边距——那会影响全 deck。

### `.take` / `.band` / `.redline` 三种收口条

- `.take`：浅色页"所以呢"收口，最常用；
- `.band`：证据/结论强调（多用于表格页下方）；
- `.redline` 深蓝底：**只**用于硬边界、红线类表述，一个 deck 少于 3 次。

### `.nav` 章节进度条 + `.rp` 报告徽标

每个浅色内容页页脚右侧放全议程 `.nav`，当前章加 `.cur`；封面/分节/结束页无 `.nav`。
`.rp`（实心蓝胶囊）只在多报告合并 deck 用，单报告 deck 删掉。
**注意**：`.nav` 单行嵌入 `.foot`，不要另起一行（会抬高页脚、压缩 body）。

### 深浅背景母版

`bg-cover`/`bg-closing`（深，带左深右浅渐变蒙版）、`bg-divider`（深，蒙版略浅）、
`bg-project`（亮，不加蒙版，文字靠 `.lift` 投影）。浅色正文页自动带底部波浪装饰
（`.slide:not(.dark)::before`，opacity .4，被 `z-index:1` 的内容盖住、不挡文字）。

### 播放器接线（勿动）

```html
<deck-stage width="1920" height="1080"> …sections… </deck-stage>
<script type="application/json" id="speaker-notes">[…]</script>
<script src="assets/deck-stage.js"></script>
<script src="assets/deck-presenter.js"></script>
```

`deck-stage:not(:defined){visibility:hidden}` 防首帧闪烁，已在模板 `<style>` 里。
section 上勿写 position/inset/width/height（播放器会绝对定位每一页）。
