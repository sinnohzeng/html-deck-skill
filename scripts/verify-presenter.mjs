/* 放映增强层核验（交付硬闸门）：无头断言 deck-presenter.js 的控制条 / 协议 / 降级链。
   用法：node verify-presenter.mjs <deck.html 绝对路径>（通常传仓根 template.html）
        VERIFY_HEADED=1 node verify-presenter.mjs <deck>   # 有头模式，全屏类断言可转硬验证
   覆盖：统一控制条渲染与中文文案、上游导航条抑制（rail 存活）、翻页/回首页/数字缓冲跳页、
   __deckp_sync / __deckp_blackout 协议、单屏降级选择卡 → 演讲者窗口全链（同步/网格/黑屏双向/结束放映）、
   窗口放映全链（v3：入场/state.fs 字段/横幅零误报/Esc 退出/心跳防循环/represent 免手势恢复/
   讲者窗关闭降级/退出唯一性）、noscale 不入镜、帮助浮层（v4：导出 PDF 按钮/关于面板署名链接/关闭契约）；
   全屏为 headless best-effort（失败仅告警不阻塞）。
   上游 deck-stage.js 整文件覆盖升级后必须重跑本脚本（overlay 抑制依赖其 open shadowRoot 与 .overlay 类名，
   窗口放映依赖其 __omelette_presenting 消息语义）。 */
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

const browser = await chromium.launch({ headless: !process.env.VERIFY_HEADED });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const consoleTexts = [];
page.on('console', (m) => consoleTexts.push(m.text()));
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
ok(await page.evaluate(() =>
  !!document.querySelector('.dp-bar [data-act="fstoggle"] .fslab')), '全屏⇄窗口切换按钮已就位（showonly）');
ok(await page.evaluate(() => ((document.querySelector('meta[name="author"]') || {}).content || '').includes('曾子轩')), '模板 meta author 署名在位');
soft(consoleTexts.some((t) => t.includes('zixuan.net')), '启动 console 署名横幅出现');

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
const nIdx = Math.min(1, total - 1); // 单页 deck 退化为验证夹紧
await page.evaluate(() => document.querySelector('.dp-bar [data-act="next"]').click());
await page.waitForTimeout(150);
ok(await page.evaluate((i) => document.querySelector('deck-stage').index === i, nIdx), '控制条下一页生效');
ok(await page.evaluate((i) => document.querySelector('.dp-bar .pg .cur').textContent === String(i + 1), nIdx), '页码随 slidechange 联动');
await page.evaluate(() => document.querySelector('.dp-bar [data-act="prev"]').click());
await page.waitForTimeout(150);
ok(await page.evaluate(() => document.querySelector('deck-stage').index === 0), '控制条上一页生效');
const single = Math.min(5, total); // 跳页目标随 deck 长度派生，短 deck 也可核验
await page.keyboard.press(String(single).slice(-1));
const hint = await page.evaluate(() => (document.querySelector('.dp-jumphint') || {}).textContent || '');
ok(hint.includes('跳至 ' + String(single).slice(-1)), '数字键出现跳页浮签');
await page.waitForTimeout(1000);
ok(await page.evaluate((n) => document.querySelector('deck-stage').index === n - 1, Number(String(single).slice(-1))),
  `单数字 800ms 自动跳页（→ 第 ${String(single).slice(-1)} 页）`);
await page.evaluate(() => document.querySelector('deck-stage').goTo(0)); // 起点归零，防与目标重合空转
await page.waitForTimeout(150);
const multi = String(Math.min(10, total));
for (const ch of multi) await page.keyboard.press(ch);
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
ok(await page.evaluate((n) => document.querySelector('deck-stage').index === n - 1, Number(multi)),
  `数字 + Enter 跳页（${multi} → 第 ${multi} 页）`);
await page.evaluate(() => document.querySelector('.dp-bar [data-act="home"]').click());
await page.waitForTimeout(150);
ok(await page.evaluate(() => document.querySelector('deck-stage').index === 0), '「回首页」回到第 1 页');

console.log('【4】__dp 协议回归');
const syncIdx = Math.min(5, total - 1);
await page.evaluate((i) => window.postMessage({ __deckp_sync: { index: i } }, '*'), syncIdx);
await page.waitForTimeout(150);
ok(await page.evaluate((i) => document.querySelector('deck-stage').index === i, syncIdx), '__deckp_sync 驱动翻页');
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
ok(await page.evaluate(() => {
  const h = document.querySelector('.dp-help');
  return !!h && h.textContent.includes('导出 PDF') && !!h.querySelector('[data-hact="print"]');
}), '帮助浮层含「导出 PDF」按钮与 ⌘P 说明');
// stub window.print：无头下真实打印对话框会挂死；同时计数验证唤起
await page.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls += 1; }; });
await page.evaluate(() => document.querySelector('.dp-help [data-hact="print"]').click());
await page.waitForTimeout(250); // 覆盖 80ms 收层→打印延时
ok(await page.evaluate(() => window.__printCalls === 1 && !document.querySelector('.dp-help')),
  '点「导出 PDF」收帮助层并唤起 window.print');
await page.keyboard.press('h'); // 重开：验关于面板与关闭契约
await page.waitForTimeout(100);
ok(await page.evaluate(() => {
  const h = document.querySelector('.dp-help');
  return !!h && h.textContent.includes('曾子轩') &&
    !!h.querySelector('a[href="https://zixuan.net"][target="_blank"]') &&
    !!h.querySelector('a[href="https://github.com/sinnohzeng/consulting-deck-skill"][target="_blank"]');
}), '关于面板含作者主页与开源仓链接（新标签打开）');
ok(await page.evaluate(() =>
  document.querySelector('.dp-help').textContent.includes('v' + window.__deckpPresenter.version)),
  '关于面板版本号与 __deckpPresenter.version 一致');
await page.evaluate(() => document.querySelector('.dp-help .card h3').click());
await page.waitForTimeout(100);
ok(await page.evaluate(() => !!document.querySelector('.dp-help')), '点击卡片主体不误关帮助');
await page.evaluate(() => document.querySelector('.dp-help [data-close]').click());
await page.waitForTimeout(100);
ok(await page.evaluate(() => !document.querySelector('.dp-help')), '关闭按钮 × 关闭帮助');
await page.keyboard.press('h'); // 重开供 Esc 断言复用
await page.waitForTimeout(100);
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
ok(true, '「演讲者视图＋窗口放映」弹出伴随窗');
ok(await page.evaluate(() => !document.querySelector('.dp-card')), '选择卡已关闭');
ok(await pv.evaluate(() => !!document.querySelector('.pv-head') && !!document.querySelector('#pv-notes')), '演讲者窗口 UI 已渲染');
ok(await pv.evaluate(() => document.querySelector('#pv-swap').hidden === true), '非受管双屏态「交换屏幕」按钮隐藏');
ok(await pv.evaluate(() => !!document.querySelector('#pv-end-show')), '「结束放映」按钮存在');
await pv.waitForTimeout(2300); // 等一轮 hello 心跳完成握手
ok(await pv.evaluate(() => document.querySelector('#pv-conn-t').textContent === '已连接 · 窗口放映'), '连接状态显示复合态“已连接 · 窗口放映”');
await pv.evaluate(() => document.querySelector('#pv-nexb').click());
await page.waitForTimeout(300);
ok(await page.evaluate((i) => document.querySelector('deck-stage').index === i, nIdx), '演讲者窗翻页同步放映窗');
const gA = Math.min(3, total - 1);
await page.evaluate((i) => document.querySelector('deck-stage').goTo(i), gA);
await pv.waitForTimeout(300);
ok(await pv.evaluate((i) => document.querySelector('#pv-cur-no').textContent === String(i + 1), gA), '放映窗翻页同步演讲者窗');
await pv.evaluate(() => document.querySelector('#pv-grid-btn').click());
await pv.waitForTimeout(400);
ok(await pv.evaluate((t) => document.querySelectorAll('.pv-grid .cell').length === t, total), `「所有页面」网格渲染 ${total} 格`);
ok(await pv.evaluate((i) => {
  const cells = document.querySelectorAll('.pv-grid .cell');
  return cells[i] && cells[i].hasAttribute('data-cur');
}, gA), '网格高亮当前页');
let gB = Math.min(7, total - 1);
if (gB === gA) gB = Math.max(0, gA - 1); // 与当前页错开，防断言空转（单页 deck 退化为夹紧验证）
await pv.evaluate((i) => document.querySelectorAll('.pv-grid .cell')[i].click(), gB);
await page.waitForTimeout(300);
ok(await page.evaluate((i) => document.querySelector('deck-stage').index === i, gB), '网格点击跳页并同步放映窗');
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

console.log('【8】全屏（headless best-effort；VERIFY_HEADED=1 可转硬验证）');
await page.keyboard.press('f');
await page.waitForTimeout(500);
const fsOk = await page.evaluate(() => !!document.fullscreenElement);
soft(fsOk, 'F 进入全屏');
if (fsOk) {
  ok(await page.evaluate(() => document.querySelector('.dp-bar').getAttribute('data-mode') === 'show'), '放映态控制条切精简模式');
  ok(await page.evaluate(() => (document.querySelector('.dp-bar .fslab') || {}).textContent === '窗口'), '全屏态切换按钮显示「窗口」');
  await page.keyboard.press('f'); // F 主动降窗（S2→S1）
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => !document.fullscreenElement &&
      window.__deckpPresenter.getState().mode === 'show' &&
      document.querySelector('.dp-bar').getAttribute('data-mode') === 'show'),
    'F 主动降窗保放映（keepPresentingOnFsExit）');
  ok(await page.evaluate(() => (document.querySelector('.dp-bar .fslab') || {}).textContent === '全屏'), '降窗后切换按钮回「全屏」');
  await page.evaluate(() => document.querySelector('deck-stage').goTo(document.querySelector('deck-stage').length - 1));
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => {
    const el = document.querySelector('.dp-end');
    return !!el && el.textContent.includes('放映结束');
  }), '末页再前进出结束屏（窗口放映态同样生效）');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => !document.fullscreenElement && !document.querySelector('.dp-end') &&
      window.__deckpPresenter.getState().mode === 'idle'), '结束屏再前进完整退出放映');
}

console.log('【9】窗口放映入场（选择卡「演讲者视图＋窗口放映」路径）');
await page.evaluate(() => (document.exitFullscreen ? document.exitFullscreen().catch(() => {}) : 0)); // 组前置防御
await page.waitForTimeout(300);
ok(await page.evaluate(() => window.__deckpPresenter.getState().mode === 'idle'), '组前置：处于浏览态');
await page.evaluate(() => {
  window.__pfCount = 0;
  window.addEventListener('message', (e) => {
    if (e.data && e.data.__omelette_presenting === false) window.__pfCount++;
  });
});
await page.evaluate(() => document.querySelector('deck-stage').goTo(0));
await page.evaluate(() => document.querySelector('.dp-bar [data-act="speaker"]').click());
await page.waitForTimeout(200);
ok(await page.evaluate(() => {
  const c = document.querySelector('.dp-card');
  return !!c && c.textContent.includes('远程会议') && !!c.querySelector('[data-c="pv"].pri');
}), '选择卡含远程会议指引且「演讲者视图＋窗口放映」为主按钮');
const [pv2] = await Promise.all([
  ctx.waitForEvent('page'),
  page.evaluate(() => document.querySelector('.dp-card [data-c="pv"]').click()),
]);
await pv2.waitForLoadState('domcontentloaded');
await page.waitForTimeout(400);
ok(await page.evaluate(() => document.querySelector('.dp-bar').getAttribute('data-mode') === 'show'), '主窗控制条切放映态（窗口放映）');
ok(await page.evaluate(() => !document.fullscreenElement), '窗口放映不依赖 OS 全屏（fullscreenElement 为空）');
ok(await page.evaluate(() => {
  const sr = document.querySelector('deck-stage').shadowRoot;
  const rail = sr && sr.querySelector('.rail');
  return !!rail && getComputedStyle(rail).display === 'none';
}), '缩略图栏已隐藏（__omelette_presenting 生效）');
ok(await page.evaluate(() => (document.querySelector('.dp-bar .fslab') || {}).textContent === '全屏'), '切换按钮显示「全屏」（当前为窗口态）');
ok(await page.evaluate(() => window.__deckpPresenter.getState().mode === 'speaker'), 'getState().mode === speaker');
ok(await page.evaluate(() => document.title.endsWith('（放映窗口）')), '窗口标题加「（放映窗口）」标记（共享选择器可辨）');

console.log('【10】__deckp_state 扩展字段与横幅零误报');
await pv2.evaluate(() => {
  window.__lastState = null;
  window.addEventListener('message', (e) => { if (e.data && e.data.__deckp_state) window.__lastState = e.data.__deckp_state; });
});
await pv2.waitForTimeout(4200); // 覆盖两拍 2s 心跳
ok(await pv2.evaluate(() => window.__lastState && window.__lastState.mode === 'speaker' && window.__lastState.fs === false),
  '__deckp_state 携带 fs:false 且 mode:speaker');
ok(await pv2.evaluate(() => !document.querySelector('#pv-banner').hasAttribute('data-on')),
  '窗口放映常态下讲者窗横幅零误报');
ok(await pv2.evaluate(() => document.querySelector('#pv-conn-t').textContent === '已连接 · 窗口放映'),
  '连接按钮复合状态「已连接 · 窗口放映」');

console.log('【11】Esc 退出窗口放映 + 心跳防循环 + 「放映已结束」横幅');
await page.bringToFront();
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok(await page.evaluate(() => !document.querySelector('.dp-bar').hasAttribute('data-mode') &&
    window.__deckpPresenter.getState().mode === 'idle'), '窗口放映 Esc 退出到浏览态');
ok(await page.evaluate(() => {
  const sr = document.querySelector('deck-stage').shadowRoot;
  const rail = sr && sr.querySelector('.rail');
  return !!rail && getComputedStyle(rail).display !== 'none';
}), '缩略图栏恢复可见');
ok(await page.evaluate(() => !document.title.endsWith('（放映窗口）')), '窗口标题标记已还原');
ok(await page.evaluate(() => window.__pfCount === 1), '__omelette_presenting:false 只发一次（退出唯一性）');
await page.waitForTimeout(4200); // 跨两拍心跳
ok(await page.evaluate(() => {
  const st = window.__deckpPresenter.getState();
  return st.mode === 'idle' && st.userExited === true;
}), '明确退出后心跳不回拉（跨两拍心跳仍 idle）');
ok(await pv2.evaluate(() =>
  document.querySelector('#pv-banner').hasAttribute('data-on') &&
  document.querySelector('#pv-banner-t').textContent.includes('放映已结束') &&
  document.querySelector('#pv-banner-act').textContent === '重新放映'),
  '讲者窗「放映已结束」横幅常驻（跨两拍心跳未被电平清除）');

console.log('【12】「重新放映」免手势恢复窗口放映');
await pv2.evaluate(() => document.querySelector('#pv-banner-act').click());
await page.waitForTimeout(400);
ok(await page.evaluate(() => window.__deckpPresenter.getState().mode === 'speaker' && !document.fullscreenElement),
  'represent 免手势恢复 speaker 窗口放映（零点击层）');
ok(await page.evaluate(() => {
  const sr = document.querySelector('deck-stage').shadowRoot;
  const rail = sr && sr.querySelector('.rail');
  return !!rail && getComputedStyle(rail).display === 'none';
}), '缩略图栏再次隐藏');
ok(await pv2.evaluate(() => !document.querySelector('#pv-banner').hasAttribute('data-on')), '恢复后讲者窗横幅清除');

console.log('【13】讲者窗关闭 → 放映不断（S3→S1）→ Esc 完整退出');
await pv2.evaluate(() => window.close());
await page.waitForTimeout(600); // __deckp_bye 即时送达；2s 轮询为兜底
ok(await page.evaluate(() => window.__deckpPresenter.getState().mode === 'show'), '讲者窗关闭后降 solo 放映（放映不断）');
ok(await page.evaluate(() => {
  const sr = document.querySelector('deck-stage').shadowRoot;
  const rail = sr && sr.querySelector('.rail');
  return !!rail && getComputedStyle(rail).display === 'none';
}), '窗口放映视觉态保持（rail 仍隐藏）');
await page.evaluate(() => { window.__pfCount = 0; });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok(await page.evaluate(() => window.__deckpPresenter.getState().mode === 'idle'), 'S1（solo 窗口放映）下 Esc 退出放映');
ok(await page.evaluate(() => window.__pfCount === 1), '再次退出仍只发一次 presenting:false');

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败 / ${warn} 告警`);
process.exitCode = fail ? 1 : 0;
