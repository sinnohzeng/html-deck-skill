/* 放映增强层核验（交付硬闸门）：无头断言 deck-presenter.js 的控制条 / 协议 / 降级链。
   用法：node verify-presenter.mjs <deck.html 绝对路径>（通常传仓根 template.html）
   覆盖：统一控制条渲染与中文文案、上游导航条抑制（rail 存活）、翻页/回首页/数字缓冲跳页、
   __deckp_sync / __deckp_blackout 协议、单屏降级选择卡 → 演讲者窗口全链（同步/网格/黑屏双向/结束放映）、
   noscale 不入镜、帮助浮层；全屏为 headless best-effort（失败仅告警不阻塞）。
   上游 deck-stage.js 整文件覆盖升级后必须重跑本脚本（overlay 抑制依赖其 open shadowRoot 与 .overlay 类名）。 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const deck = process.argv[2];
if (!deck) { console.error('用法: node verify-presenter.mjs <deck.html 绝对路径>'); process.exit(1); }

let pass = 0, fail = 0, warn = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}   <<< FAIL`); }
};
const soft = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { warn++; console.log(`  ~ ${name}   （headless 限制，仅告警）`); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
await page.goto(pathToFileURL(deck).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

const total = await page.evaluate(() => document.querySelector('deck-stage').length);

console.log('【1】统一控制条');
ok(await page.evaluate(() => !!document.querySelector('.dp-bar')), '控制条 .dp-bar 已渲染');
ok(await page.evaluate(() => !document.querySelector('.dp-chip')), '旧 .dp-chip 胶囊已撤销');
for (const [act, label] of [['home', '回首页'], ['show', '放映'], ['speaker', '演讲者放映']]) {
  ok(await page.evaluate(([a, l]) =>
    (document.querySelector(`.dp-bar [data-act="${a}"]`) || {}).textContent?.startsWith(l),
  [act, label]), `按钮「${label}」文案正确`);
}
ok(await page.evaluate(() =>
  !!document.querySelector('.dp-bar [data-act="prev"] svg') &&
  !!document.querySelector('.dp-bar [data-act="next"] svg')), '上一页/下一页图标按钮存在');
ok(await page.evaluate((t) =>
  document.querySelector('.dp-bar .pg .tot').textContent === String(t), total), `页码总数 = ${total}`);
ok(await page.evaluate(() => {
  const b = document.querySelector('.dp-bubble');
  return !!b && b.textContent.includes('按 H 查看快捷键');
}), '首次打开引导气泡出现');

console.log('【2】上游导航条抑制（rail 存活）');
ok(await page.evaluate(() => {
  const sr = document.querySelector('deck-stage').shadowRoot;
  const ov = sr && sr.querySelector('.overlay');
  return !!ov && getComputedStyle(ov).display === 'none';
}), '上游英文导航胶囊 .overlay 已隐藏');
ok(await page.evaluate(() => {
  const sr = document.querySelector('deck-stage').shadowRoot;
  const rail = sr && sr.querySelector('.rail');
  return !!rail && !rail.hasAttribute('data-presenting') && getComputedStyle(rail).display !== 'none';
}), '缩略图栏 .rail 浏览态存活');
ok(await page.evaluate(() => {
  const sr = document.querySelector('deck-stage').shadowRoot;
  const s = sr && sr.querySelector('.stage');
  return !!s && s.getBoundingClientRect().left > 0;
}), '画布区保留 rail 宽度补偿（.stage left > 0）');

console.log('【3】翻页 / 回首页 / 数字缓冲跳页');
await page.evaluate(() => document.querySelector('.dp-bar [data-act="next"]').click());
await page.waitForTimeout(150);
ok(await page.evaluate(() => document.querySelector('deck-stage').index === 1), '控制条下一页生效');
ok(await page.evaluate(() => document.querySelector('.dp-bar .pg .cur').textContent === '2'), '页码随 slidechange 联动');
await page.evaluate(() => document.querySelector('.dp-bar [data-act="prev"]').click());
await page.waitForTimeout(150);
ok(await page.evaluate(() => document.querySelector('deck-stage').index === 0), '控制条上一页生效');
await page.keyboard.press('5');
const hint = await page.evaluate(() => (document.querySelector('.dp-jumphint') || {}).textContent || '');
ok(hint.includes('跳至 5'), '数字键出现跳页浮签');
await page.waitForTimeout(1000);
ok(await page.evaluate(() => document.querySelector('deck-stage').index === 4), '单数字 800ms 自动跳页（5 → 第 5 页）');
await page.keyboard.press('1');
await page.keyboard.press('0');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
ok(await page.evaluate(() => document.querySelector('deck-stage').index === 9), '多位数字 + Enter 跳页（10 → 第 10 页）');
await page.evaluate(() => document.querySelector('.dp-bar [data-act="home"]').click());
await page.waitForTimeout(150);
ok(await page.evaluate(() => document.querySelector('deck-stage').index === 0), '「回首页」回到第 1 页');

console.log('【4】__deckp 协议回归');
await page.evaluate(() => window.postMessage({ __deckp_sync: { index: 5 } }, '*'));
await page.waitForTimeout(150);
ok(await page.evaluate(() => document.querySelector('deck-stage').index === 5), '__deckp_sync 驱动翻页');
await page.evaluate(() => window.postMessage({ __deckp_blackout: true }, '*'));
await page.waitForTimeout(150);
ok(await page.evaluate(() => !!document.querySelector('.dp-black')), '__deckp_blackout:true 黑屏出现');
await page.evaluate(() => window.postMessage({ __deckp_blackout: false }, '*'));
await page.waitForTimeout(150);
ok(await page.evaluate(() => !document.querySelector('.dp-black')), '__deckp_blackout:false 黑屏解除');

console.log('【5】帮助浮层');
await page.keyboard.press('h');
ok(await page.evaluate(() => {
  const h = document.querySelector('.dp-help');
  return !!h && h.textContent.includes('演讲者放映') && h.textContent.includes('交换两个屏幕');
}), 'H 唤起帮助且含新键位说明');
await page.keyboard.press('Escape');
ok(await page.evaluate(() => !document.querySelector('.dp-help')), 'Esc 关闭帮助');

console.log('【6】单屏降级链 → 演讲者窗口全链');
await page.evaluate(() => document.querySelector('deck-stage').goTo(0));
await page.evaluate(() => document.querySelector('.dp-bar [data-act="speaker"]').click());
await page.waitForTimeout(200);
ok(await page.evaluate(() => {
  const c = document.querySelector('.dp-card');
  return !!c && c.textContent.includes('未检测到第二个屏幕');
}), '单屏点「演讲者放映」出现选择卡');
const [pv] = await Promise.all([
  ctx.waitForEvent('page'),
  page.evaluate(() => document.querySelector('.dp-card [data-c="pv"]').click()),
]);
await pv.waitForLoadState('domcontentloaded');
await pv.waitForTimeout(500);
ok(true, '「仍打开演讲者视图」弹出伴随窗');
ok(await page.evaluate(() => !document.querySelector('.dp-card')), '选择卡已关闭');
ok(await pv.evaluate(() => !!document.querySelector('.pv-head') && !!document.querySelector('#pv-notes')), '演讲者窗口 UI 已渲染');
ok(await pv.evaluate(() => document.querySelector('#pv-swap').hidden === true), '非受管双屏态「交换屏幕」按钮隐藏');
ok(await pv.evaluate(() => !!document.querySelector('#pv-end-show')), '「结束放映」按钮存在');
await pv.waitForTimeout(2300); // 等一轮 hello 心跳完成握手
ok(await pv.evaluate(() => document.querySelector('#pv-conn-t').textContent === '已连接'), '连接状态显示“已连接”');
await pv.evaluate(() => document.querySelector('#pv-nexb').click());
await page.waitForTimeout(300);
ok(await page.evaluate(() => document.querySelector('deck-stage').index === 1), '演讲者窗翻页同步放映窗');
await page.evaluate(() => document.querySelector('deck-stage').goTo(3));
await pv.waitForTimeout(300);
ok(await pv.evaluate(() => document.querySelector('#pv-cur-no').textContent === '4'), '放映窗翻页同步演讲者窗');
await pv.evaluate(() => document.querySelector('#pv-grid-btn').click());
await pv.waitForTimeout(400);
ok(await pv.evaluate((t) => document.querySelectorAll('.pv-grid .cell').length === t, total), `「所有页面」网格渲染 ${total} 格`);
ok(await pv.evaluate(() => {
  const cells = document.querySelectorAll('.pv-grid .cell');
  return cells[3] && cells[3].hasAttribute('data-cur');
}), '网格高亮当前页');
await pv.evaluate(() => document.querySelectorAll('.pv-grid .cell')[7].click());
await page.waitForTimeout(300);
ok(await page.evaluate(() => document.querySelector('deck-stage').index === 7), '网格点击跳页并同步放映窗');
ok(await pv.evaluate(() => !document.querySelector('.pv-grid')), '网格点击后自动关闭');
await pv.evaluate(() => document.querySelector('#pv-black').click());
await page.waitForTimeout(300);
ok(await page.evaluate(() => !!document.querySelector('.dp-black')), '演讲者窗黑屏同步放映窗');
await page.keyboard.press('b');
await pv.waitForTimeout(300);
ok(await pv.evaluate(() => document.querySelector('#pv-black').textContent.includes('黑屏')), '放映窗解除黑屏反向同步演讲者窗按钮文案');
await Promise.all([
  pv.waitForEvent('close'),
  pv.evaluate(() => document.querySelector('#pv-end-show').click()),
]);
ok(true, '「结束放映」演讲者窗自关');
await page.waitForTimeout(300);
ok(await page.evaluate(() => {
  const t = document.querySelector('.dp-toast');
  return !!t && t.textContent.includes('放映已结束');
}), '放映窗收到结束通知并报用时');

console.log('【7】noscale 不入镜（无头量测/截图管线保护）');
await page.evaluate(() => document.querySelector('deck-stage').setAttribute('noscale', ''));
ok(await page.evaluate(() => getComputedStyle(document.querySelector('.dp-bar')).display === 'none'), 'noscale 下控制条隐藏');
await page.evaluate(() => document.querySelector('deck-stage').removeAttribute('noscale'));

console.log('【8】全屏（headless best-effort）');
await page.keyboard.press('f');
await page.waitForTimeout(500);
const fsOk = await page.evaluate(() => !!document.fullscreenElement);
soft(fsOk, 'F 进入全屏');
if (fsOk) {
  ok(await page.evaluate(() => document.querySelector('.dp-bar').getAttribute('data-mode') === 'show'), '放映态控制条切精简模式');
  await page.evaluate(() => document.querySelector('deck-stage').goTo(document.querySelector('deck-stage').length - 1));
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => {
    const el = document.querySelector('.dp-end');
    return !!el && el.textContent.includes('放映结束');
  }), '末页再前进出结束屏');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => !document.fullscreenElement && !document.querySelector('.dp-end')), '结束屏再前进退出放映');
}

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败 / ${warn} 告警`);
process.exitCode = fail ? 1 : 0;
