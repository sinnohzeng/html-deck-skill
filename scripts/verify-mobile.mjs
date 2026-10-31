/* 手机端查看形态核验（交付门禁）：无头断言竖屏阅读态、横屏观看态、滑动、进度与总览。
   用法：node verify-mobile.mjs <deck.html 绝对路径>（通常传仓根 template.html）
        node verify-mobile.mjs <deck> --shots     # 顺带出截图到 .verify/
   覆盖：四种视口（iPhone 竖 / iPhone 横 / iPad 竖 / 桌面）的画布几何与贴顶、
        逐字稿面板位置与字号、面板底不压半透明控制条、进度条与画布同宽、
        触屏控制条按钮集（上台按钮收起、总览按钮出现）、缩略图栏在触屏一律不外露、
        真实触摸事件序列的左右滑翻页与面板内纵滑不误翻、总览格数与真实渲染。
   没有逐字稿的 deck 会自动跳过阅读态相关断言，并改为断言画布垂直居中、不留空面板。
   上游 deck-stage.js 整文件覆盖升级后必须重跑本脚本：阅读态依赖其 dock-top 属性、
   deckfit 事件与 fitBox 属性，缺任何一个都会静默退化成竖屏满屏黑边。 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import { mkdirSync } from 'fs';
import path from 'path';

const PFX = 'dp';                         // 本层 CSS 前缀
const deck = process.argv[2];
if (!deck || deck.startsWith('--')) {
  console.error('用法: node verify-mobile.mjs <deck.html 绝对路径> [--shots]');
  process.exit(1);
}
const SHOTS = process.argv.includes('--shots');
const OUT = '.verify';
const URL_ = pathToFileURL(deck).href;

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}   <<< FAIL`); }
};

/* iPad 竖屏单列，是因为它宽 834 点，落在内核隐藏缩略图栏的 640 阈值之外，最容易漏。 */
const PROFILES = [
  { name: 'iphone-portrait',  width: 390,  height: 844,  dpr: 3, mobile: true,  touch: true,  portrait: true  },
  { name: 'iphone-landscape', width: 844,  height: 390,  dpr: 3, mobile: true,  touch: true,  portrait: false },
  { name: 'ipad-portrait',    width: 834,  height: 1112, dpr: 2, mobile: true,  touch: true,  portrait: true  },
  { name: 'desktop',          width: 1440, height: 900,  dpr: 2, mobile: false, touch: false, portrait: false },
];

const MEASURE = (pfx) => {
  const stage = document.querySelector('deck-stage');
  const sr = stage.shadowRoot;
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const canvas = sr && sr.querySelector('.canvas');
  const read = document.querySelector('.' + pfx + '-read');
  const readTxt = read && read.querySelector('.txt');
  const prog = document.querySelector('.' + pfx + '-prog');
  const bar = document.querySelector('.' + pfx + '-bar');
  const rail = sr && sr.querySelector('.rail');
  const shown = (el) => el && el.style.display !== 'none';
  return {
    index: stage.index, total: stage.length,
    dockTop: stage.hasAttribute('dock-top'),
    hasFitBox: !!stage.fitBox,
    railVisible: !!(rail && rail.getBoundingClientRect().width > 0),
    scale: +((canvas ? canvas.getBoundingClientRect().width : 0) / stage.designWidth).toFixed(4),
    canvas: rect(canvas),
    read: shown(read) ? rect(read) : null,
    readFontPx: readTxt ? parseFloat(getComputedStyle(readTxt).fontSize) : 0,
    readTxtBottom: readTxt ? Math.round(readTxt.getBoundingClientRect().bottom) : 0,
    barTop: bar ? Math.round(bar.getBoundingClientRect().top) : 0,
    prog: shown(prog) ? rect(prog) : null,
    // 只数看得见的：总览按钮在桌面上是留在 DOM 里由 CSS 藏起来的，
    // 数 DOM 会把藏没藏住这个问题直接漏过去。
    barActs: bar ? Array.from(bar.querySelectorAll('[data-act]'))
      .filter((b) => b.offsetParent !== null).map((b) => b.getAttribute('data-act')) : [],
  };
};

const browser = await chromium.launch();
if (SHOTS) mkdirSync(OUT, { recursive: true });

// 先探一次这份 deck 有没有逐字稿，没有就跳过阅读态相关断言。
let hasNotes = false;
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  hasNotes = await page.evaluate(() => {
    const tag = document.getElementById('speaker-notes');
    let json = [];
    if (tag) { try { json = JSON.parse(tag.textContent || '[]'); } catch (e) { json = []; } }
    const secs = Array.from(document.querySelector('deck-stage').children)
      .filter((el) => !/^(TEMPLATE|SCRIPT|STYLE)$/.test(el.tagName));
    return secs.some((s, i) => (s.getAttribute('data-speaker-notes') || json[i] || '').trim());
  });
  await ctx.close();
}
console.log(hasNotes ? '本 deck 带逐字稿，阅读态断言全开。' : '本 deck 无逐字稿，跳过阅读态断言。');

for (const p of PROFILES) {
  console.log(`\n【${p.name}】${p.width}×${p.height}`);
  const reading = hasNotes && p.touch && p.portrait;
  const ctx = await browser.newContext({
    viewport: { width: p.width, height: p.height },
    deviceScaleFactor: p.dpr, isMobile: p.mobile, hasTouch: p.touch,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(700);   // 内核在 document.fonts.ready 之前压着首帧

  const m = await page.evaluate(MEASURE, PFX);
  ok(errs.length === 0, `零控制台报错${errs.length ? '：' + errs[0].slice(0, 120) : ''}`);
  ok(m.hasFitBox, 'deck-stage 暴露 fitBox（晚到的监听方能取到首帧几何）');
  ok(m.dockTop === reading, `dock-top === ${reading}`);
  ok(!!m.read === reading, `逐字稿面板 ${reading ? '出现' : '不出现'}`);
  ok(m.railVisible === !p.touch, `缩略图栏 ${p.touch ? '不外露' : '可见'}`);

  /* 版面截图必须在任何交互之前拍。放到后面拍，拍到的是被测试自己搅动过的
     状态（滚过的面板、跳过的页），当成产物看会得出错误结论。 */
  if (SHOTS) {
    await page.screenshot({ path: path.join(OUT, p.name + '.png') });
  }

  if (reading) {
    ok(m.canvas.y === 0, `阅读态画布贴顶（y=${m.canvas.y}）`);
    ok(m.read.y === m.canvas.y + m.canvas.h, `面板紧贴画布下沿（${m.read.y} vs ${m.canvas.y + m.canvas.h}）`);
    ok(m.readFontPx >= 15, `逐字稿字号 ${m.readFontPx} 不小于 15`);
    ok(m.read.h > p.height * 0.45, `面板吃满剩余高度（${m.read.h}）`);
    // 控制条是半透明的，正文只要还能滚到它下面就会互相透出来
    ok(m.readTxtBottom <= m.barTop, `正文可滚区底 ${m.readTxtBottom} 不越过控制条顶 ${m.barTop}`);
  } else if (p.touch && !hasNotes && p.portrait) {
    ok(m.canvas.y > 0, '无逐字稿时画布垂直居中，不留空面板');
  }

  if (p.touch) {
    ok(m.barActs.includes('grid'), '控制条出现总览按钮');
    ok(!m.barActs.includes('show') && !m.barActs.includes('speaker'), '上台按钮已收起');
    ok(!!m.prog, '进度条存在');
    if (m.prog && m.canvas) ok(Math.abs(m.prog.w - m.canvas.w) <= 1, `进度条与画布同宽（${m.prog.w} vs ${m.canvas.w}）`);

    /* 滑动用真实 touch 事件序列打，不用合成 API，否则测的是自己写的分发逻辑
       而不是浏览器的。 */
    const cx = Math.round(p.width / 2), cy = Math.round(m.canvas.h / 2);
    await page.evaluate(() => document.querySelector('deck-stage').goTo(0));
    await page.waitForTimeout(200);
    await swipe(page, cx + 120, cy, cx - 120, cy);
    await page.waitForTimeout(320);
    ok(await page.evaluate(() => document.querySelector('deck-stage').index) === 1, '左滑进一页');
    await swipe(page, cx - 120, cy, cx + 120, cy);
    await page.waitForTimeout(320);
    ok(await page.evaluate(() => document.querySelector('deck-stage').index) === 0, '右滑回一页');

    if (reading) {
      await page.evaluate(() => document.querySelector('deck-stage').goTo(1));
      await page.waitForTimeout(250);
      const ry = await page.evaluate((pfx) => {
        const r = document.querySelector('.' + pfx + '-read').getBoundingClientRect();
        return Math.round(r.y + r.height / 2);
      }, PFX);
      await swipe(page, cx, ry + 60, cx, ry - 60);
      await page.waitForTimeout(320);
      ok(await page.evaluate(() => document.querySelector('deck-stage').index) === 1, '面板内纵滑不误翻页');
    }

    await page.evaluate((pfx) => document.querySelector('.' + pfx + '-bar [data-act="grid"]').click(), PFX);
    await page.waitForTimeout(400);
    const g = await page.evaluate((pfx) => {
      const el = document.querySelector('.' + pfx + '-grid');
      if (!el) return null;
      const cells = el.querySelectorAll('.cell');
      const shot = cells[0] && cells[0].querySelector('.shot');
      const holder = shot && shot.querySelector('.pv-canvas');
      return {
        cells: cells.length,
        shotW: shot ? Math.round(shot.getBoundingClientRect().width) : 0,
        rendered: !!holder && /scale\(/.test(holder.style.transform),
        curMarked: !!el.querySelector('.cell[data-cur]'),
      };
    }, PFX);
    ok(g && g.cells === m.total, `总览格数 ${g && g.cells} 等于总页数 ${m.total}`);
    ok(g && g.rendered, '总览缩略图渲染出真实内容');
    ok(g && g.shotW >= 120, `总览缩略图宽 ${g && g.shotW} 认得出`);
    ok(g && g.curMarked, '总览标出当前页');
    if (SHOTS) await page.screenshot({ path: path.join(OUT, p.name + '-grid.png') });
    await page.evaluate((pfx) => document.querySelector('.' + pfx + '-grid .x').click(), PFX);
    await page.waitForTimeout(250);
    ok(await page.evaluate((pfx) => !document.querySelector('.' + pfx + '-grid'), PFX), '总览可关闭');
  } else {
    ok(m.barActs.includes('show') && m.barActs.includes('speaker'), '桌面控制条保留放映按钮');
    ok(!m.barActs.includes('grid'), '桌面不出现总览按钮（那儿有缩略图栏）');
    ok(!m.prog, '桌面不出现手机端进度条');
  }
  await ctx.close();
}

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

async function swipe(page, x1, y1, x2, y2) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (x, y) => [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x1, y1) });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: pt(Math.round(x1 + (x2 - x1) * i / 6), Math.round(y1 + (y2 - y1) * i / 6)),
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
