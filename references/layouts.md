# 页面母版登记表

12 个注册母版的完整骨架都在 `template.html` 里（按 `data-label` 定位，直接整段复制该
`<section>` 再改文案），本文只登记「什么时候用哪个 + 改造要点」。另附 4 个扩展组件页型
（实战 deck 用过、template 未收录示例页，骨架在本文给出）。

## 选版决策

| 内容形状 | 用母版 |
|---|---|
| 多报告项目总开场 | 01 项目总封面 |
| 单份报告开场 | 02 报告封面 |
| 告诉听众要讲什么 | 03 汇报议程 |
| 每部分开场 | 04 分节页 |
| 2–6 个并列要点 | 05 正文标准页（编号网格） |
| 多方案多维度比较 | 06 表格比选页 |
| 两条路线对照 | 07 双栏对比页 |
| 三个方案要一眼看出推荐谁 | 08 三卡比选页 |
| 分阶段推进节奏 | 09 路线图页 |
| 一个数字立住一个论点 | 10 大数字页 |
| 收尾归纳 N 条结论 | 11 结论页 |
| 致谢收场 | 12 结束页 |
| 两条主线 × 场景清单全景 | 扩展 A `.pano` |
| 三层供给/架构栈 | 扩展 B `.stack` |
| 三方角色协作关系 | 扩展 C `.flow` |
| 两条线 × 两步节奏矩阵 | 扩展 D `.pace` |

## 注册母版要点（骨架见 template.html 同名 section）

1. **项目总封面**（`bg-project` 明亮底）：标题居中做竖直支点，上下两个 `flex:1` 区
   把标题顶到正中；白字靠 `.lift` 投影保证可读。多报告项目才用。
2. **报告封面**（`bg-cover` 深色底）：eyebrow 写「客户名 · 报告序号」；主标题 ≤ 2 行、
   96px；分隔短线 + 一行副题交代项目全称。
3. **汇报议程**（`.toc-row`）：3–4 行为宜；`tt` 名词化、`ts` 一句话判断化预告。
4. **分节页**（`bg-divider`）：序号（`.36em` 字距）+ 90px 大标题 + 一句话预告。
5. **正文标准页**：`head`（eyebrow + 判断句 title + 导言）+ `body > .fill`（编号网格
   `.num-item`，双列 `column-gap:64px`，首行 `border-top:2px solid var(--navy-2)`、
   后续行 `1px var(--line)`）+ `.take` 收口 + `foot`（logo + `.nav`）。
   要点 2–6 个；5 个以上考虑 `.slide.compact`。
6. **表格比选页**：`.mck` 家族按密度选 `tight`/`ops`，推荐列全列 `.pick`（thead 也要）；
   收口用 `.band`。**改完必跑 measure-geometry**。
7. **双栏对比页**：`.duo > .panel × 2`，推荐侧 `.plabel` 用 `accent`；行内内容用 `.kv`
   键值行对齐。`.duo` 勿加 `height:100%`（中缝线会撑满、文字顶对齐）。
8. **三卡比选页**：`.modecards > .modecard × 3`；结论词 `.verdict`（推荐项
   `.verdict.accent` 蓝底胶囊，全 deck 只允许一张卡用）；大数字约 110px。
9. **路线图页**：`.road > .stage × 3–4`；每段 = `tag`（阶段）+ `when`（时间）+ 名称 +
   `.lines` 事项清单（`.key` 高亮里程碑）。
10. **大数字页**：`.mega` 用 `--type-mega`（200px）或 `--type-big`（120px），旁边
    2–3 行含义说明，**必须**标数据来源行。
11. **结论页**：`.grid.concl` 紧排 + `.slide.compact`；每条一句话复述判断不再论证；
    需要边界声明时用 `.redline`（如"本报告提供分析和建议，最终由客户结合实际确定"）。
12. **结束页**（`bg-closing`）：居中致谢语 + 深底 logo，不加联系方式。

## 扩展组件页型（可粘贴骨架）

放进正文标准页的 `body > .fill` 位置即可，`head`/`foot` 结构不变。

### A · 两条主线场景全景 `.pano`

```html
<div class="pano">
  <div class="col x1">
    <div class="dh"><span class="dn">主线一名称</span><span class="sub">面向对象说明</span></div>
    <div class="sysbox">
      <div class="scene"><span class="nm">场景一名称</span><span class="who">使用人</span></div>
      <div class="scene"><span class="nm">场景二名称</span><span class="who">使用人</span></div>
      <div class="scene note"><span class="nm">备注行：补充说明用浅底弱化</span></div>
    </div>
  </div>
  <div class="col x2"><!-- 同结构，表头自动换主蓝底 --></div>
</div>
```

### B · 分层供给栈 `.stack`

```html
<div class="stack">
  <div class="layer l-app"><div class="lh"><span class="ln">第一层</span><span class="lt">层名</span><span class="who assoc">谁负责</span></div>
    <div class="lm">一句话说明</div><div class="chips"><span class="chip">要素一</span><span class="chip">要素二</span></div></div>
  <div class="layer l-tech"><!-- 同结构，中层加深底 --></div>
  <div class="layer l-know"><!-- 同结构，底层深蓝反白；who 徽章有 assoc（实心）/firm（描边）两种 --></div>
</div>
```

### C · 三方协作流程 `.flow`

```html
<div class="flow">
  <div class="fbox"><div class="ft">角色一</div><h4>做什么</h4><p>一句话职责</p></div>
  <div class="farr"><span class="a">→</span><span class="al">交付物/关系说明</span></div>
  <div class="fbox"><div class="ft">角色二</div><h4>做什么</h4><p>一句话职责</p></div>
  <div class="farr"><span class="a">→</span><span class="al">交付物/关系说明</span></div>
  <div class="fbox"><div class="ft">角色三</div><h4>做什么</h4><p>一句话职责</p></div>
</div>
```

### D · 推进节奏矩阵 `.pace`（两条线 × 各两步）

```html
<div class="pace">
  <div class="pace-lane">
    <div class="pace-id"><div class="pace-tag">主线一</div><div class="pace-name">线名</div></div>
    <div class="pace-step"><div class="pace-no">1</div><div><h4>第一步</h4><p>说明</p></div></div>
    <div class="pace-arrow">→</div>
    <div class="pace-step"><div class="pace-no">2</div><div><h4>第二步</h4><p>说明</p></div></div>
  </div>
  <div class="pace-lane"><!-- 主线二同结构 --></div>
</div>
```

## 配图页（figure-as-code 兼容）

整页放一张预渲染 PNG 图（透明底，让底部波浪透出）：

```html
<div class="body"><div class="fill" style="align-items:center">
  <img src="相对路径.png" alt="图片语义描述" style="width:100%;max-height:684px;height:auto;object-fit:contain">
</div></div>
```

图本身建议同一设计系统预渲染（HTML/CSS → 无头 Chromium 截图 @2x、`omitBackground` 透明底），
勿混入其他配色体系的截图。
