/* 无头逐页截图 + 溢出检测。
   用法：node capture-deck.mjs <deck.html 绝对路径> [输出前缀]
   产物：scripts/_audit/<前缀>-NN.png（1920×1080）+ so/bo 溢出报告。
   判读：so>2 = 整页真裁切；bo>2 = 某容器内容密集。
   注意：so=0 且 bo=0 不代表安全，几何间隙以 measure-geometry.mjs 为准。 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';

const deck = process.argv[2];
const prefix = process.argv[3] || 'deck';
if (!deck) { console.error('用法: node capture-deck.mjs <deck.html 绝对路径> [前缀]'); process.exit(1); }

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '_audit');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

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
console.log(`deck=${path.basename(deck)} slides=${count}`);

const report = [];
for (let i = 0; i < count; i++) {
  await page.evaluate((i) => {
    const ds = document.querySelector('deck-stage');
    if (ds && typeof ds.goTo === 'function') ds.goTo(i);
    else location.hash = '#' + (i + 1);
  }, i);
  await page.waitForTimeout(220);

  const m = await page.evaluate(() => {
    const sec = document.querySelector('deck-stage section[data-deck-active]')
              || document.querySelectorAll('deck-stage > section')[0];
    const vis = sec && sec.querySelector('.slide');
    if (!vis) return { label: '(no .slide)', so: 0, bo: 0 };
    const label = sec?.getAttribute('data-label') || sec?.getAttribute('data-screen-label') || '';
    const so = Math.max(0, vis.scrollHeight - vis.clientHeight);
    let bo = 0;
    for (const el of vis.querySelectorAll('*')) {
      const over = el.scrollHeight - el.clientHeight;
      if (over > bo && getComputedStyle(el).overflow !== 'visible') bo = over;
    }
    return { label, so, bo };
  });

  const n = String(i + 1).padStart(2, '0');
  await page.screenshot({ path: path.join(outDir, `${prefix}-${n}.png`) });
  const flag = m.so > 2 ? '  <<< SO 裁切' : (m.bo > 2 ? '  << BO 密集' : '');
  report.push(`${n} | so=${m.so} bo=${m.bo} | ${m.label}${flag}`);
}

console.log('\n=== 溢出报告（so>2=真裁切，bo>2=容器密集；so/bo=0 仍须以几何量测为准） ===');
console.log(report.join('\n'));
await browser.close();
