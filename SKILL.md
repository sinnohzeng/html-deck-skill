---
name: building-consulting-decks
description: Builds single-file HTML slide decks in a consulting-grade navy/blue design system — copies template.html, assembles pages from registered masters, keeps design tokens locked, syncs speaker notes, and verifies page geometry before delivery. Use when asked to 制作/修改咨询风格的 HTML 幻灯片、汇报 deck、成果汇报片子、领导汇报演示. Triggers on "HTML 幻灯片"、"汇报片子"、"咨询汇报 deck"、"做一版汇报 PPT（HTML）"、"consulting deck".
---

# 咨询汇报 HTML 幻灯片（Building Consulting Decks）

生成**单文件 HTML** 的 16:9 横向汇报 deck：深蓝（navy）+ 主蓝（teal）咨询风设计系统、
`deck-stage.js` 播放器（键盘/触屏翻页 + 缩略图栏 + 打印导出）、
`deck-presenter.js` 放映增强（F 全屏、滚轮翻页、P 双屏演讲者视图、B 黑屏）。
双击 HTML 用浏览器打开即放映，无需服务器与构建。品牌位（logo/机构名/背景）为占位设计，
替换方法见 README「换成贵司品牌」。

## 何时使用

- 面向领导/客户的成果汇报、方案比选、决策汇报（泛体制内 + 咨询报告风格）
- 需要"一个文件发出去就能放"的场景（即时通讯/邮件传输、现场双击播放）

**不适用**：培训课件（信息密度不够）、需要多人协作编辑、需要完全不同视觉风格的场合。

## 工作流

### Step 1 · 对齐需求（动手前）

问清或从上下文确认：① 汇报时长 → 页数（15 分钟 ≈ 10 页，30 分钟 ≈ 20 页）；
② 单报告还是多报告合并（决定是否用 `.rp` 报告徽标与项目总封面）；
③ 章节划分（决定 `.nav` 进度条文案）；④ 有无表格/预算/路线图类内容（决定母版组合）。

### Step 2 · 拷贝种子模板

```bash
mkdir -p <目标目录>
cp <SKILL_ROOT>/template.html <目标目录>/<deck名>.html
cp -r <SKILL_ROOT>/assets <目标目录>/assets
```

`template.html` 完整可运行：设计系统 `<style>`、12 页母版示例、`#speaker-notes`、
播放器接线全部就位。拷贝后立刻做两件事：

1. 全局搜 `【必改】` 替换为实际内容；
2. 替换品牌占位：`assets/logos/logo-on-light.svg` 与 `logo-on-dark.svg` 换成本机构
   正式标识（深浅底各一版），全局搜「机构名称占位」「机构标识占位」改为机构正名。

字体：模板默认回退系统黑体即可放映；追求统一观感时下载阿里巴巴普惠体 3.0
（免费商用）放入 `assets/fonts/`，并取消模板顶部两行 `@font-face` 注释。

### Step 3 · 选母版、填内容

**先读 `references/layouts.md`**（12 个注册母版 + 4 个扩展组件页型，每个都有可粘贴
`<section>` 骨架）。逐页规则：

- 每页一个 `<section data-label="页名">`，内层 `.slide` 三段式 `head / body / foot`
- **类名预检**：只用模板 `<style>` 已定义的类（清单见 `references/components.md`）；
  确需新类，补进该 `<style>` 块，**禁止**建第二个 CSS 文件或 `<link>`（防双源漂移）
- 微调用行内 `style="..."`（字号/间距/宽度），体系性改动走 token
- 正文页标题写**判断句**（"推荐方案 B"），不写名词短语（"方案分析"）

### Step 4 · 逐字稿（演讲者备注）

`#speaker-notes` 是一条 JSON 字符串数组，**项数必须 == `<section>` 数**（顺序对应，
无稿页给空串 `""`）。段落间用 `\n\n`。增删页时两处同步。写完自检：

```bash
node -e "const h=require('fs').readFileSync('<deck>.html','utf8');const n=JSON.parse(h.match(/<script type=\"application\/json\" id=\"speaker-notes\">([\s\S]*?)<\/script>/)[1]).length;const s=(h.match(/<section /g)||[]).length;console.log(n===s?'OK '+n+' 页':'不一致: notes='+n+' sections='+s);process.exitCode=n===s?0:1"
```

### Step 5 · 交付前自检（必做）

按 `references/authoring-checklist.md` 逐项过。其中几何核验是硬闸门：

```bash
cd <SKILL_ROOT>/scripts && npm i && npx playwright install chromium   # 首次
node measure-geometry.mjs <deck 绝对路径>    # 每页 footGap/headGap 必须 > 15，负数=重叠
node capture-deck.mjs <deck 绝对路径> audit  # 逐页 PNG + so/bo 溢出报告，逐张看图
```

**注意**：表格页 so=0 且 bo=0 **不代表**没有重叠（居中 body 撑表是探测盲区），
必须以 measure-geometry 的 footGap/headGap 为准。装不下先删文案，再上密度类
（`.mck.tight` → `.mck.ops` / `.slide.compact`），**禁止**改小 token 字号。

### Step 6 · 放映交付口径

告知使用者：双击打开即放映；`H` 看快捷键；双屏 = 先按 `P` 弹演讲者视图（留本机屏），
再把放映窗口拖到投屏按 `F` 全屏，两窗自动同步；PDF = 浏览器打印（每页一片）。
细节见 `references/presenting.md`。

## 硬规则（违反 = 返工）

1. **设计 token 锁定**：配色只用 `:root` 里的 navy/teal/paper/line/muted 族，
   字号只用 `--type-*` 阶梯；不接受任意 hex 与任意字号体系。
2. **中文标点**：弯引号 `“ ”`（嵌套外双内单）、中文冒号 `：`、中文括号 `（）`；
   ASCII 直引号只许出现在代码/URL。
3. **无装饰 emoji**；图标能省则省，信息层级靠字号、字重、留白与 hairline。
4. **页脚规范**：浅色内容页 = 左 logo + 右 `.nav` 章节进度条（当前章 `.cur`）；
   `.rp` 报告徽标只在多报告合并 deck 使用。
5. **深浅节奏**：封面/分节/结束页用深色母版，正文用浅色；连续深色不超过 2 页。
6. **上游文件勿改**：`assets/deck-stage.js` 是上游播放器组件，
   升级 = 整文件覆盖；本地扩展只进 `assets/deck-presenter.js`。
7. **单一真源**：一个 deck 的样式只在其内联 `<style>`；逐字稿只在 `#speaker-notes`。

## 资源导览

```
consulting-deck-skill/
├── SKILL.md                        ← 本文件（工作流 + 硬规则）
├── template.html                   ← 种子模板：设计系统唯一真源 + 12 页母版示例
├── assets/
│   ├── deck-stage.js               ← 播放器（上游组件，勿改）
│   ├── deck-presenter.js           ← 放映增强层（全屏/滚轮/演讲者视图/黑屏）
│   ├── logos/                      ← 占位标识 SVG（深/浅底各一，替换为贵司 LOGO）
│   └── backgrounds/                ← 波浪装饰 PNG（深色母版底为纯 CSS 渐变）
├── references/
│   ├── layouts.md                  ← 页面母版登记表（可粘贴骨架）
│   ├── components.md               ← 组件类手册 + 易错点
│   ├── design-tokens.md            ← token/字号阶/密度决策树/标点规范
│   ├── presenting.md               ← 放映/双屏演讲者视图/PDF 导出
│   └── authoring-checklist.md      ← 交付自检清单
└── scripts/
    ├── measure-geometry.mjs        ← 几何核验（footGap/headGap，硬闸门）
    ├── capture-deck.mjs            ← 逐页截图 + 溢出报告
    └── package.json                ← 核验脚本依赖声明（playwright）
```

**加载顺序建议**：SKILL.md（本文件）→ layouts.md 挑母版 → 写页 →
components.md 查组件细节 → authoring-checklist.md 自检 → presenting.md 交付口径。
