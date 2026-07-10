/* 几何核验（交付硬闸门）：逐页量 body 内容与页眉/页脚的间隙。
   用法：node measure-geometry.mjs <deck.html 绝对路径>
   判读：footGap / headGap 必须 > 15；负数 = 内容与页眉/页脚重叠（必修）。
   背景：居中 body 的表格对称溢出不改变 scrollHeight，溢出探测（so/bo）测不出，
   必须几何量测——来自真实交付中两次踩坑的定论。 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const deck = process.argv[2];
if (!deck) { console.error('用法: node measure-geometry.mjs <deck.html 绝对路径>'); process.exit(1); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
await page.goto(pathToFileURL(deck).href + '?slide=1', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.evaluate(() => { const ds = document.querySelector('deck-stage'); if (ds) ds.setAttribute('noscale', ''); });
await page.waitForTimeout(400);

const count = await page.evaluate(() => {
  const ds = document.querySelector('deck-stage');
  return (ds && ds._slides && ds._slides.length) || document.querySelectorAll('deck-stage > section').length;
});

let bad = 0;
const out = [];
for (let i = 0; i < count; i++) {
  await page.evaluate((i) => {
    const ds = document.querySelector('deck-stage');
    if (ds && typeof ds.goTo === 'function') ds.goTo(i);
    else location.hash = '#' + (i + 1);
  }, i);
  await page.waitForTimeout(160);
  const m = await page.evaluate(() => {
    const sec = document.querySelector('deck-stage section[data-deck-active]') || document.querySelectorAll('deck-stage > section')[0];
    const slide = sec && sec.querySelector('.slide');
    if (!slide) return null;
    const label = sec.getAttribute('data-label') || '';
    const body = slide.querySelector('.body');
    const foot = slide.querySelector('.foot');
    const head = slide.querySelector('.head');
    if (!body || !foot) return { label, footGap: 'NA', headGap: 'NA' };
    // 绝对定位页脚（封面类悬浮层）：body 弹性填充区从其身后延展，间隙量测无意义
    if (getComputedStyle(foot).position === 'absolute') return { label, footGap: 'NA*', headGap: 'NA*' };
    let contentBottom = 0, contentTop = Infinity;
    for (const el of body.querySelectorAll('table, .band, p, div, ul, .road, .duo')) {
      const r = el.getBoundingClientRect();
      if (r.height < 1) continue;
      if (r.bottom > contentBottom) contentBottom = r.bottom;
      if (r.top < contentTop) contentTop = r.top;
    }
    const footTop = foot.getBoundingClientRect().top;
    const headBottom = head ? head.getBoundingClientRect().bottom : 0;
    return { label, footGap: Math.round(footTop - contentBottom), headGap: Math.round(contentTop - headBottom) };
  });
  const flag = (typeof m.footGap === 'number' && (m.footGap <= 15 || m.headGap <= 15)) ? '  <<< 过近/重叠' : '';
  if (flag) bad++;
  out.push(`${String(i + 1).padStart(2, '0')} | footGap=${String(m.footGap).padStart(4)} headGap=${String(m.headGap).padStart(4)} | ${m.label}${flag}`);
}
console.log(out.join('\n'));
console.log(bad ? `\n${bad} 页需要整改（目标 footGap/headGap > 15）` : '\n全部通过');
await browser.close();
process.exitCode = bad ? 1 : 0;
