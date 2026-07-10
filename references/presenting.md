# 放映、双屏演讲者视图与导出

## 打开与浏览

双击 HTML 文件用浏览器打开（推荐 Chrome/Edge；Safari/Firefox 可放映但无自动双屏，见下文降级）。
底部居中一条统一中文控制条（鼠标动时出现）：

```
[◀] [ 3 / 71 ] [▶] │ [回首页 R] │ [放映 F] [演讲者放映 P] │ [?]
```

- 页码可单击 → 输入页码回车跳转；也可直接敲数字键缓冲跳页（如 `3`、`7`、`Enter` 跳第 37 页，单个数字停 0.8 秒自动跳）。
- 左侧缩略图栏：点击跳页、拖拽排序、右键 Skip/Move/Duplicate/Delete（**注意**：这些结构操作只改当前浏览器会话，不落盘；正式增删页要改 HTML 源文件）。

| 键 | 功能 | 提供方 |
|---|---|---|
| → ↓ 空格 Enter PgDn / ← ↑ Backspace PgUp | 下一页 / 上一页 | deck-stage + presenter 层 |
| 滚轮 | 翻页（阈值 + 450ms 冷却防触控板连翻） | presenter 层 |
| 数字 + Enter | 跳到任意页（缓冲式，兼容旧 1–9/0 直跳） | presenter 层 |
| Home / End / R | 首页 / 末页 / 回首页 | deck-stage |
| `F` | 从当前页全屏放映（再按或 Esc 退出）；`Shift+F` 从第 1 页放映 | presenter 层 |
| `P` | 演讲者放映（自动双屏，详见下节） | presenter 层 |
| `X` | 交换两个屏幕的内容（仅双屏放映中） | presenter 层 |
| `B` | 黑屏 / 恢复（任意翻页键也恢复；双窗状态同步） | presenter 层 |
| `H` / `?` | 快捷键帮助 | presenter 层 |

**F5 为浏览器刷新**（刷新后页码经 URL hash 自动恢复，是意外情况下的恢复路径），放映请用 `F` / `P`。

## 放映（对标 PowerPoint）

**「放映」（`F`）= 从当前页全屏**，适用单屏或“镜像”投屏（观众与你看到相同画面）。
放映态鼠标移动浮现精简控制条（翻页/黑屏/退出放映），光标静止 2 秒自动隐藏；
末页再前进出黑色结束屏（“放映结束，再按一次退出放映”），收场不慌。

**「演讲者放映」（`P`）= 一键双屏**（Chrome/Edge，系统显示设置为“扩展”模式）：

1. 点「演讲者放映」或按 `P`——首次会弹“管理窗口”授权（**允许**，浏览器会记住）；
2. 幻灯片自动全屏到**外接屏/投屏**，演讲者视图自动落在**本机屏幕**：
   当前页大图 + 下一页预览 + 逐字稿（`A−/A＋` 调字号并记忆）+ 计时器/时钟 +
   跳页 + 所有页面缩略图网格 + 黑屏；
3. 任意一侧翻页另一侧自动跟随（postMessage 同步，file:// 下可用）；
4. **投反了**？演讲者视图头部点「交换屏幕」（或任一窗口按 `X`），两屏内容一键对调；
5. 结束：演讲者视图点「结束放映」（或按 Esc）——投屏退出全屏、报告总用时、演讲者窗自关。

意外恢复路径（都已内建）：
- 投屏误按 Esc 退出全屏 → 演讲者视图弹横幅，点「重新放映」一键恢复；
- 误关演讲者窗口 → 放映不中断，重按 `P` 重开并自动同步；
- 放映窗口被误关/误刷新 → 演讲者视图弹「重新打开放映窗口」，页码自动恢复。

**建议：正式汇报前在排练时先点一次「演讲者放映」完成授权**，正式开播即零弹窗直达。

### 降级链（自动，无需记忆）

| 场景 | 行为 |
|---|---|
| 单屏 / 镜像模式 | 弹选择卡：「直接全屏放映」（主推）或「仍打开演讲者视图」（排练看讲稿用） |
| Safari / Firefox（无 Window Management API） | 打开演讲者小窗 + 分步指引：讲稿留本机 → 主窗拖到投屏 → 按 `F` 全屏 |
| “窗口管理”授权被拒 | 同上手动流程；重新授权：地址栏左侧 ⓘ → 网站设置 → 窗口管理 → 允许，刷新 |
| 放映中拔掉外接屏 | 自动结束放映并提示 |

## 逐字稿机制

`#speaker-notes` = JSON 字符串数组，项数 == 页数，`\n\n` 分段。演讲者视图读它。每页也可用
`data-speaker-notes="…"` 属性覆盖单页（属性优先于数组）。

## 导出 PDF

新版 deck-stage 内建打印支持：浏览器 `⌘P` → 目标“另存为 PDF” → 每页一片、
尺寸 1920×1080、无页边距（`@page` 已由播放器注入）。缩略图栏、控制条、
演讲者 UI 均不入印。备选：decktape generic 模式（须 `--max-slides <页数>`）。

## 无头核验（交付前）

```bash
cd scripts && npm i && npx playwright install chromium   # 首次
node verify-presenter.mjs <deck 绝对路径>   # 放映增强层 45 项断言（控制条/协议/降级链）
node measure-geometry.mjs <deck 绝对路径>   # 每页 footGap/headGap；负数 = 内容与页眉/页脚重叠
node capture-deck.mjs <deck 绝对路径> audit # 逐页 PNG 落 scripts/_audit/ + so/bo 溢出报告
```

判读：`footGap/headGap > 15` 为过线；`so>2` 真裁切、`bo>2` 容器密集。
**so=0 且 bo=0 不代表安全**——居中 body 的表格对称溢出探测不到，以几何量测为准。
截图逐张肉眼过一遍：字重、间距、对齐、留白，几何全过 ≠ 好看。
双屏放映路径（授权、交换屏幕）无头测不了，须按 authoring-checklist P3 真双屏过一遍。

## 排障附录：多屏 API 在 file:// 下的边界（2026-07-09 实测存档）

供后续维护者复用的调研结论（📘 官方 + 🔬 实测），避免重复踩坑：

- **file:// 属 secure context**：`isSecureContext=true`，`getScreenDetails` /
  `requestFullscreen({screen})` / `window-management` 权限（状态 `prompt`）均可用，
  **无需本地服务器**。（🔬 headless Chromium 实测）
- **`window.screen.isExtended` 免授权**，镜像桌面 = false（镜像是单逻辑屏）——
  所以“镜像投屏用 F、扩展桌面用 P”是可自动判别的。
- **一键双屏 = Fullscreen Companion Window**（Chrome 104+ 默认开启）：同一次点击
  手势内先 `requestFullscreen({screen: 观众屏})` 再 `window.open(演讲者屏坐标)`，
  顺序不能反。（📘 developer.chrome.com/docs/capabilities/web-apis/window-management、
  w3c/window-management HOWTO.md）
- **Capability Delegation 在 file:// 下不可用**：`postMessage(msg, {delegate:'fullscreen'})`
  要求具体 targetOrigin，而 file:// 的 origin 是 opaque 的 `"null"`——
  `targetOrigin:'*'` 抛 NotAllowedError，`'null'` 抛 SyntaxError，两头堵死。
  （📘 wicg.github.io/capability-delegation/spec.html）
  故「交换屏幕」不走 delegation：主窗收到请求后直接 `requestFullscreen({screen: 另一屏})`
  （Plan A）；若被手势策略拒绝，自动在放映屏出「点击此处完成屏幕交换」确认层（Plan B）。
  验证命令（演讲者窗 console）：
  `window.opener.postMessage({t:1},{targetOrigin:'*',delegate:'fullscreen'})` → 预期 NotAllowedError。
  若未来改为 http(s) 分发，可改用 delegation 免掉 Plan B。
- **授权弹窗可能耗尽点击手势**：`getScreenDetails()` 弹授权框后
  `navigator.userActivation.isActive` 可能已为 false，此时代码提示“再点一次”
  （授权已记住，第二次点击零弹窗直达）。这就是“排练时先点一次”交付口径的由来。
