# 放映、双屏演讲者视图与导出

## 单屏放映

双击 HTML 文件用浏览器打开（Chrome/Edge/Safari 均可，无需服务器）。

| 键 | 功能 | 提供方 |
|---|---|---|
| → ↓ 空格 Enter PgDn / ← ↑ Backspace PgUp | 下一页 / 上一页 | deck-stage + presenter 层 |
| 滚轮 | 翻页（阈值 + 450ms 冷却防触控板连翻） | presenter 层 |
| 1–9 / 0 | 跳第 1–9 / 10 页 | deck-stage |
| Home / End / R | 首页 / 末页 / 回首页 | deck-stage |
| `F` | 全屏放映（自动隐藏缩略图栏与导航条；Esc 退出） | presenter 层 |
| `P` | 弹出演讲者视图窗口 | presenter 层 |
| `B` | 黑屏 / 恢复（任意翻页键也恢复） | presenter 层 |
| `H` / `?` | 快捷键帮助 | presenter 层 |

左侧缩略图栏：点击跳页、拖拽排序、右键 Skip/Move/Duplicate/Delete（**注意**：
这些结构操作只改当前浏览器会话，不落盘；正式增删页要改 HTML 源文件）。

## 双屏演讲（扩展桌面）

1. 打开 deck，按 `P` —— 弹出演讲者视图窗口（当前页大图 + 下一页预览 + 逐字稿 +
   计时器/时钟 + 跳页输入），把它留在**本机屏幕**；
2. 把放映窗口拖到**投屏/外接屏**，按 `F` 全屏；
3. 两个窗口任意一侧翻页，另一侧自动跟随（postMessage 同步，file:// 下可用）；
4. 演讲者窗口按 `B` 可让投屏黑场；`A−/A＋` 调逐字稿字号（记忆偏好）。

若误关演讲者窗口，重按 `P`；若先开了演讲者窗口，其头部有「打开/聚焦放映窗口」按钮。

## 逐字稿机制

`#speaker-notes` = JSON 字符串数组，项数 == 页数，`\n\n` 分段。演讲者视图读它。每页也可用
`data-speaker-notes="…"` 属性覆盖单页（属性优先于数组）。

## 导出 PDF

新版 deck-stage 内建打印支持：浏览器 `⌘P` → 目标"另存为 PDF" → 每页一片、
尺寸 1920×1080、无页边距（`@page` 已由播放器注入）。缩略图栏、控制条、
演讲者 UI 均不入印。备选：decktape generic 模式（须 `--max-slides <页数>`）。

## 无头核验（交付前）

```bash
cd scripts && npm i && npx playwright install chromium   # 首次
node measure-geometry.mjs <deck 绝对路径>   # 每页 footGap/headGap；负数 = 内容与页眉/页脚重叠
node capture-deck.mjs <deck 绝对路径> audit # 逐页 PNG 落 scripts/_audit/ + so/bo 溢出报告
```

判读：`footGap/headGap > 15` 为过线；`so>2` 真裁切、`bo>2` 容器密集。
**so=0 且 bo=0 不代表安全**——居中 body 的表格对称溢出探测不到，以几何量测为准。
截图逐张肉眼过一遍：字重、间距、对齐、留白，几何全过 ≠ 好看。
