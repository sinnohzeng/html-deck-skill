# deck-stage.js 本地补丁清单

`assets/deck-stage.js` 是上游播放器组件，升级方式是整文件覆盖。
覆盖会把下面这些本地改动一并冲掉，必须逐条重新打上，然后跑
`node scripts/verify-mobile.mjs template.html` 确认全绿。

补丁只有三处，都是通用能力，不含任何产品判断。产品判断全在
`assets/deck-presenter.js`。

## 判据：什么才允许进内核

只有两类：

1. **只有内核知道的信息**。画布最终落在屏幕哪个位置、缩放多少，只有 `_fit()` 知道。
   外层要贴着画布放东西，只能由内核告诉它。
2. **只有内核能做的排布**。画布在 shadow DOM 里，外层的 CSS 够不到。

其余一律进增强层。判断"这份 deck 有没有逐字稿""手机上该显示什么"都是产品知识，
放进内核就等于让三个仓库共用一份产品判断。

## 补丁一：`dock-top` 属性

画布默认垂直居中。加了 `dock-top` 属性时贴视口顶部，把下方空间让给设置者。

**1. 加进 `observedAttributes`**

```js
static get observedAttributes() { return ['width', 'height', 'noscale', 'no-rail', 'dock-top']; }
```

**2. 样式表里 `.stage` 规则之后加一条**

```css
:host([dock-top]) .stage { align-items: flex-start; }
```

**3. `_fit()` 里算完缩放系数之后，设置 transform 之前**

```js
this._canvas.style.transformOrigin = this.hasAttribute('dock-top') ? 'center top' : '';
```

第 3 步是这个补丁里唯一不显然的部分，也是最容易漏的。画布保留 1920×1080 的
**布局盒**，`transform: scale()` 只改视觉不改布局。只做第 2 步的话，flex 移动的是布局盒，
视觉盒仍绕中心缩，画布上边缘会停在 `540 × (1 − scale)` 处。竖持 iPhone 上 scale 约 0.203，
误差 430 点，正好是大半屏。

## 补丁二：`deckfit` 事件

`_fit()` 末尾广播画布几何：

```js
_publishFit(scale, railW, vw, vh) {
  const w = this.designWidth * scale;
  const h = this.designHeight * scale;
  const top = this.hasAttribute('dock-top') ? 0 : (vh - h) / 2;
  const detail = { scale, width: w, height: h, left: railW + (vw - w) / 2, top };
  this._lastFit = detail;
  this.dispatchEvent(new CustomEvent('deckfit', { detail, bubbles: true, composed: true }));
}
```

在 `_fit()` 的末尾调用 `this._publishFit(s, rw, vw, vh);`。

替代方案是让外层去 shadow root 里量 `.canvas`。不采用：`suppressStageOverlay()` 的注释
已经承认上游可能改成 closed shadow root，再加一处穿透只是多一个同类隐患。

## 补丁三：`fitBox` 只读属性

```js
get fitBox() { return this._lastFit || null; }
```

不是 `deckfit` 的冗余。内核被解析到的那一刻就完成首次 fit，那时增强层还没执行，
第一发事件根本没人接。晚到的监听方必须能取到当前值，否则首屏是错的。

这个坑曾经被另一个 bug 盖住过：增强层写属性触发内核重排、重排又广播事件、
事件回来再写属性，形成自激环，反复重发把"收不到首发事件"掩盖了，只在横屏暴露。
`setAttribute` 即使值没变也会触发 `attributeChangedCallback`，所以增强层写内核属性
必须先比对当前状态。

## 上游若已自带同名能力

先跑 `verify-mobile.mjs`。全绿说明上游的实现兼容，补丁不用打。
只要有一条不过，按上面逐条比对差异再决定是补齐还是改接口名。
