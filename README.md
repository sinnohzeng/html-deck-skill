# consulting-deck-skill — 咨询汇报 HTML 幻灯片技能包

一套**咨询级 HTML 汇报幻灯片体系**，打包成可复用的智能体技能（Agent Skill）：
统一设计系统、页面母版库、播放器与双屏演讲者视图、交付核验脚本。
交给任意代码型 AI 智能体（Claude Code、OpenClaw、飞书 Aily、腾讯 Workbuddy、
阿里 Qoder Work、字节 TRAE Work 等），即可产出风格统一、几何过检的单文件 HTML 汇报 deck。
体系经多轮真实汇报场景打磨，母版与硬规则都来自实际交付踩坑后的定论。

## 这套东西是什么

- **单文件 HTML deck**：双击用浏览器打开即放映，无需服务器、无需构建、即时通讯直接传
- **统一设计系统**：深蓝/主蓝咨询风，配色与字号 token 锁定，投屏后排可读（正文 ≥ 34px）
- **12 个注册母版**：项目总封面 / 报告封面 / 议程 / 分节 / 正文 / 表格比选 / 双栏对比 /
  三卡比选 / 路线图 / 大数字 / 结论 / 结束页（另有 4 个扩展组件页型）
- **播放器**：`deck-stage.js`（上游播放器组件）+ `deck-presenter.js`（本仓扩展：
  统一中文控制条、`F` 全屏⇄窗口放映切换、`P` **一键双屏演讲者放映**〔Window Management API：
  幻灯片自动投外屏 + 演讲者视图落本机，逐字稿/计时器/下一页预览/所有页面网格〕、
  单屏按 `P` 可选**窗口放映＋演讲者视图**〔远程会议共享放映窗口，讲稿留本机〕、
  `X` 交换屏幕防投反、`B` 黑屏双窗同步、数字缓冲跳页、放映结束屏、失联/误退一键恢复、`H` 帮助；
  单屏/镜像/Safari/授权被拒自动降级为手动双屏流程）
- **核验脚本**：放映增强层无头断言（全绿硬闸门）+ 无头 Chromium 逐页几何探测（防内容撑进页脚）+ 逐页截图溢出报告
- **品牌中立**：logo/机构名为占位设计，深色背景为纯 CSS 渐变，替换品牌只要三步（见下）

## 快速开始（人类）

```bash
git clone https://github.com/sinnohzeng/consulting-deck-skill.git
open consulting-deck-skill/template.html   # 直接看 12 页母版演示（速览设计系统）
```

做一份新 deck：把 `template.html` 复制改名 + 拷走 `assets/`，按 `references/layouts.md`
挑母版填内容。放映快捷键在 deck 里按 `H` 查看。

## 快速开始（AI 智能体）

**Claude Code**：把本仓放入 `~/.claude/skills/`（或项目 `.claude/skills/`）即自动发现；
或直接说"按 consulting-deck-skill 的规范做一份汇报幻灯片"。

**其他平台（OpenClaw / 飞书 Aily / 腾讯 Workbuddy / 阿里 Qoder Work / 字节 TRAE Work）**：
把整个仓库（或 zip）交给智能体，并附一句引导词：

> 请先完整阅读仓库根目录的 SKILL.md，严格按其工作流和硬规则，
> 基于 template.html 和 references/ 里的母版制作幻灯片。

SKILL.md 为平台中立写法（纯文件操作 + bash 命令），不依赖任何特定智能体框架。

## 换成贵司品牌（三步）

1. **标识**：用贵司正式 LOGO 替换 `assets/logos/logo-on-light.svg`（浅底用）与
   `logo-on-dark.svg`（深底用），保持相近宽高比即可，模板按高度自适应；
2. **机构名**：全局搜「机构名称占位」「机构标识占位」替换为机构正名；
3. **背景（可选）**：深色母版默认是纯 CSS 渐变；需要品牌实景底图时，在模板
   `.bg-cover / .bg-project / .bg-divider / .bg-closing` 恢复
   `background-image:url(...)` 写法。其中 `.bg-cover / .bg-divider / .bg-closing`
   的深色蒙版 `::before` 已就位、文字可读性不受影响；`.bg-project`（项目总封面）
   按设计不加蒙版，请选明亮通透的底图，白字靠 `.lift` 投影保证可读。

**字体（推荐但不随仓分发）**：推荐阿里巴巴普惠体 3.0——免费商用授权、两枚字重即可
覆盖全字阶，观感稳重适合汇报场合。从官网下载后放入 `assets/fonts/`，取消模板顶部两行
`@font-face` 注释即全 deck 生效；不安装也能用，自动回退苹方/微软雅黑，版式与几何不变。

## 仓库结构

| 路径 | 说明 |
|---|---|
| `SKILL.md` | 技能入口：工作流六步 + 硬规则七条（智能体读这个） |
| `template.html` | 种子模板 = 设计系统唯一真源 + 12 页母版示例（占位内容） |
| `assets/deck-stage.js` | 播放器 Web Component（上游组件，升级=整文件覆盖，勿改） |
| `assets/deck-presenter.js` | 放映增强层（本仓维护，只走 deck-stage 公开协议） |
| `assets/logos/` `assets/backgrounds/` | 占位标识 SVG / 波浪装饰 PNG |
| `references/` | 母版登记表 · 组件手册 · token 规范 · 放映指南 · 自检清单 |
| `scripts/` | verify-presenter.mjs（放映层断言）· measure-geometry.mjs（几何硬闸门）· capture-deck.mjs（截图审阅） |

## 设计上的几个关键决策

1. **单一真源**：设计系统只存在于 `template.html` 的内联 `<style>`，不设独立 CSS 文件
   ——源自"可读副本与内联样式双源漂移"的实际教训。
2. **上游/扩展分层**：`deck-stage.js` 保持原样（未来上游更新可整文件覆盖），
   全部本地功能在 `deck-presenter.js`，只通过公开 API（`goTo`）、`slidechange` 事件与
   postMessage 协议交互，零侵入。唯一例外：为用统一中文控制条替代上游英文导航胶囊，
   向其 open shadowRoot 运行时注入一条 `.overlay{display:none}` 样式——不改上游文件，
   上游若升级为 closed shadow 自动退化为双胶囊并存（verify-presenter 会报警）。
3. **演讲者视图不走 iframe**：`?presenter=1` 窗口加载同一 HTML 文件，用本文档 DOM
   克隆 + transform 缩放渲染当前/下一页预览；双窗口经 `postMessage('*')` 同步，
   在 `file://` 双击场景下稳定可用（BroadcastChannel 在 file 协议下不可用）。
4. **几何核验是闸门不是建议**：居中 body 的表格溢出是 scrollHeight 探测盲区，
   必须用 footGap/headGap 几何量测（两次真实踩坑后的定论）。

## 维护

- **同步上游播放器**：拿到新版 `deck-stage.js` 后整文件覆盖 `assets/deck-stage.js`，
  跑一遍 `scripts/` 三个脚本（verify-presenter 必跑——控制条依赖上游 shadow 结构）
  + 手动过一遍 `template.html` 即可。
- **改设计系统**：只改 `template.html` 的 `<style>`；组件类增删同步更新
  `references/components.md` 清单。

## 许可

代码与文档以 [MIT 协议](LICENSE)开源。`assets/backgrounds/wave.png` 为通用几何波浪纹理。
阿里巴巴普惠体不随仓分发，请从官方渠道获取（免费商用授权）。
