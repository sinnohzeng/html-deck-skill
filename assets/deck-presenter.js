/**
 * deck-presenter.js — 咨询汇报 HTML 幻灯片「独立放映增强层」
 * =====================================================================
 * 定位：deck-stage.js（上游播放器 Web Component，勿改）之外的
 * 本地放映扩展。双击 HTML 直接用浏览器打开即生效，不依赖任何宿主应用。
 *
 * 与上游的边界（零侵入）：只使用 deck-stage 的公开协议 ——
 *   · 公开 API：stage.goTo(i) / stage.next() / stage.prev() / stage.index / stage.length
 *   · 生命周期事件：'slidechange'（bubbles + composed）
 *   · postMessage 协议：{__omelette_presenting: bool} 隐藏缩略图栏与导航条
 * 上游 deck-stage.js 未来整文件覆盖升级，本文件无需跟改。
 *
 * 功能：
 *   1. 全屏放映     — F 键或控制条按钮；进入全屏自动隐藏缩略图栏/导航条
 *   2. 翻页优化     — 滚轮翻页（带阈值与冷却，防触控板惯性连翻）；
 *                     ↑/↓、Enter/Backspace 翻页（对齐 PPT 习惯）
 *   3. 演讲者视图   — P 键或按钮，弹出第二窗口（?presenter=1）：
 *                     当前页大图 + 下一页预览 + 逐字稿 + 计时器 + 时钟 + 跳页；
 *                     双窗口经 postMessage 双向同步（file:// 下亦可用），
 *                     适配扩展桌面：放映窗口拖到投屏全屏，演讲者窗口留在本机
 *   4. 黑屏         — B 键（演讲中临时黑场，任意翻页键恢复）
 *   5. 快捷键帮助   — H 或 ? 键
 *
 * 消息协议（本层自有，__deckp 前缀避免与上游冲突）：
 *   {__deckp_hello:'presenter'}        演讲者窗口 → 放映窗口（握手/重连）
 *   {__deckp_sync:{index}}             双向；接收方 index 相同则忽略（防回声）
 *   {__deckp_blackout:bool}            演讲者窗口 → 放映窗口
 * =====================================================================
 */
(() => {
  'use strict';

  const IS_PRESENTER = /[?&]presenter=1/.test(location.search);
  // 无头截图（noscale / _snthumb）与打印场景下，本层 UI 一律不出现。
  const IS_THUMB = /[?&]_snthumb=/.test(location.search);
  if (IS_THUMB) return;

  const $ = (sel, root) => (root || document).querySelector(sel);

  /* ── 共用：读取逐字稿（与 deck-stage._loadNotes 同一优先级规则） ── */
  function readNotes(sections) {
    let json = null;
    const tag = document.getElementById('speaker-notes');
    if (tag) try {
      const p = JSON.parse(tag.textContent || '[]');
      if (Array.isArray(p)) json = p;
    } catch (e) { /* 保持 null */ }
    return sections.map((s, i) => {
      const a = s.getAttribute('data-speaker-notes');
      return a !== null ? a : (json && typeof json[i] === 'string' ? json[i] : '');
    });
  }

  function slideLabel(sec, i) {
    const t = sec && (sec.getAttribute('data-label') || '');
    return (i + 1) + (t ? ' · ' + t : '');
  }

  /* ── 共用：把一页 section 克隆渲染进任意预览盒（transform 缩放） ── */
  function renderPreview(box, sec) {
    box.textContent = '';
    if (!sec) {
      const end = document.createElement('div');
      end.className = 'pv-end';
      end.textContent = '已是最后一页';
      box.appendChild(end);
      return;
    }
    const holder = document.createElement('div');
    holder.className = 'pv-canvas';
    const clone = sec.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    clone.setAttribute('data-deck-active', '');
    clone.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;box-sizing:border-box;overflow:hidden;visibility:visible;opacity:1;pointer-events:none;';
    holder.appendChild(clone);
    box.appendChild(holder);
    fitPreview(box);
  }

  function fitPreview(box) {
    const holder = box.querySelector('.pv-canvas');
    if (!holder) return;
    const r = box.getBoundingClientRect();
    const s = Math.min(r.width / 1920, r.height / 1080) || 0.1;
    holder.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }

  /* ════════════════════════════════════════════════════════════════
   * 演讲者窗口（?presenter=1）
   * ════════════════════════════════════════════════════════════════ */
  if (IS_PRESENTER) {
    const stageEl = $('deck-stage');
    if (!stageEl) return;
    const sections = Array.from(stageEl.children).filter((el) =>
      !/^(TEMPLATE|SCRIPT|STYLE)$/.test(el.tagName));
    const notes = readNotes(sections);
    const total = sections.length;
    // 卸下 deck-stage：演讲者窗口自渲染预览，避免其占满视口与键盘监听抢事件。
    // sections 已持引用，脱离文档后仍可克隆（文档级 CSS 对克隆照常生效）。
    stageEl.remove();

    document.title = document.title.replace(/（演讲者视图）$/, '') + '（演讲者视图）';

    const css = document.createElement('style');
    css.textContent = `
      html,body{height:100%;overflow:hidden}
      body{background:#111;display:flex;flex-direction:column;font-family:"Alibaba PuHuiTi 3.0",-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
      .pv-head{flex:none;display:flex;align-items:center;gap:18px;padding:10px 18px;background:#1c1c1c;border-bottom:1px solid rgba(255,255,255,.08);color:#eee;font-size:14px}
      .pv-head .timer{font-variant-numeric:tabular-nums;font-size:22px;font-weight:700;color:#fff;letter-spacing:.04em}
      .pv-head .clock{font-variant-numeric:tabular-nums;color:rgba(255,255,255,.6)}
      .pv-head .pgno{margin-left:auto;font-variant-numeric:tabular-nums;font-size:18px;font-weight:700}
      .pv-head .pgno .tt{color:rgba(255,255,255,.45);font-weight:400}
      .pv-btn{appearance:none;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#ddd;font:inherit;font-size:13px;padding:4px 12px;border-radius:6px;cursor:pointer;white-space:nowrap}
      .pv-btn:hover{background:rgba(255,255,255,.14);color:#fff}
      .pv-main{flex:1;min-height:0;display:grid;grid-template-columns:1fr 420px;gap:10px;padding:10px}
      .pv-cur{position:relative;background:#000;border-radius:8px;overflow:hidden;min-width:0}
      .pv-side{display:flex;flex-direction:column;gap:10px;min-height:0;min-width:0}
      .pv-next{position:relative;flex:none;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden}
      .pv-next .cap,.pv-cur .cap{position:absolute;left:10px;top:8px;z-index:5;font-size:12px;color:#fff;background:rgba(0,0,0,.55);padding:2px 10px;border-radius:999px;letter-spacing:.06em}
      .pv-notes{flex:1;min-height:0;display:flex;flex-direction:column;background:#1c1c1c;border-radius:8px;overflow:hidden}
      .pv-notes .bar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.6);font-size:13px}
      .pv-notes .bar .sp{margin-left:auto}
      .pv-notes .txt{flex:1;overflow-y:auto;padding:16px 20px;color:#f2f2f2;line-height:1.75;scrollbar-width:thin}
      .pv-notes .txt p{margin:0 0 .9em}
      .pv-notes .txt:empty::before{content:"（本页无逐字稿）";color:rgba(255,255,255,.35)}
      .pv-foot{flex:none;display:flex;align-items:center;gap:14px;padding:10px 18px;background:#1c1c1c;border-top:1px solid rgba(255,255,255,.08);color:#ccc}
      .pv-foot .nav{display:flex;gap:10px}
      .pv-foot .nav .pv-btn{font-size:15px;padding:8px 22px}
      .pv-foot .nxlab{font-size:14px;color:rgba(255,255,255,.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
      .pv-foot .jump{display:flex;align-items:center;gap:6px;font-size:13px;color:rgba(255,255,255,.55)}
      .pv-foot .jump input{width:64px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:6px;color:#fff;font:inherit;font-size:14px;padding:5px 8px;text-align:center}
      .pv-canvas{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center center;background:#fff}
      .pv-end{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.4);font-size:15px;letter-spacing:.1em}
      @media (max-width:1100px){.pv-main{grid-template-columns:1fr 320px}}
    `;
    document.head.appendChild(css);

    document.body.innerHTML = `
      <div class="pv-head">
        <span class="timer" id="pv-timer">00:00:00</span>
        <button class="pv-btn" id="pv-reset">计时归零</button>
        <span class="clock" id="pv-clock"></span>
        <button class="pv-btn" id="pv-open-show">打开/聚焦放映窗口</button>
        <span class="pgno"><span id="pv-cur-no">1</span><span class="tt"> / ${total}</span></span>
      </div>
      <div class="pv-main">
        <div class="pv-cur" id="pv-cur"><span class="cap">当前页</span></div>
        <div class="pv-side">
          <div class="pv-next" id="pv-next"><span class="cap">下一页</span></div>
          <div class="pv-notes">
            <div class="bar">逐字稿
              <span class="sp"></span>
              <button class="pv-btn" id="pv-font-minus">A−</button>
              <button class="pv-btn" id="pv-font-plus">A＋</button>
            </div>
            <div class="txt" id="pv-notes"></div>
          </div>
        </div>
      </div>
      <div class="pv-foot">
        <div class="nav">
          <button class="pv-btn" id="pv-prev">◀ 上一页</button>
          <button class="pv-btn" id="pv-nexb">下一页 ▶</button>
        </div>
        <span class="nxlab" id="pv-nxlab"></span>
        <span class="jump">跳页 <input id="pv-jump" type="number" min="1" max="${total}" placeholder="页码"> 回车</span>
        <button class="pv-btn" id="pv-black">黑屏 B</button>
      </div>
    `;

    let index = 0;
    let showWin = window.opener || null;
    let blackout = false;

    const curBox = $('#pv-cur'), nextBox = $('#pv-next');
    const notesEl = $('#pv-notes'), nxlab = $('#pv-nxlab');
    const curNo = $('#pv-cur-no');

    let notesPx = 22;
    try { notesPx = parseInt(localStorage.getItem('deck-presenter.notesPx'), 10) || 22; } catch (e) {}
    const applyNotesPx = () => { notesEl.style.fontSize = notesPx + 'px'; };
    applyNotesPx();

    function render() {
      renderPreview(curBox, sections[index]);
      curBox.insertAdjacentHTML('afterbegin', '<span class="cap">当前页</span>');
      renderPreview(nextBox, sections[index + 1] || null);
      nextBox.insertAdjacentHTML('afterbegin', '<span class="cap">下一页</span>');
      curNo.textContent = String(index + 1);
      nxlab.textContent = sections[index + 1]
        ? ('下一页：' + slideLabel(sections[index + 1], index + 1)) : '（最后一页）';
      notesEl.textContent = '';
      String(notes[index] || '').split(/\n{2,}/).forEach((seg) => {
        const t = seg.trim();
        if (!t) return;
        const p = document.createElement('p');
        p.textContent = t;
        notesEl.appendChild(p);
      });
      notesEl.scrollTop = 0;
    }

    function post(win, msg) {
      if (!win) return;
      try { win.postMessage(msg, '*'); } catch (e) {}
    }

    function goTo(n, silent) {
      const c = Math.max(0, Math.min(total - 1, n));
      if (c === index) return;
      index = c;
      render();
      if (!silent) post(showWin, { __deckp_sync: { index: c } });
    }

    /* 同步：放映窗口 → 演讲者 */
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (d && d.__deckp_sync && typeof d.__deckp_sync.index === 'number') {
        if (e.source && e.source !== window) showWin = e.source;
        goTo(d.__deckp_sync.index, true);
      }
    });

    /* 打开/聚焦放映窗口 */
    function openShow() {
      const u = new URL(location.href);
      u.searchParams.delete('presenter');
      u.hash = '#' + (index + 1);
      const w = window.open(u.href, 'dp-deck-show');
      if (w) { showWin = w; try { w.focus(); } catch (e) {} }
    }
    $('#pv-open-show').addEventListener('click', () => {
      if (showWin && !showWin.closed) { try { showWin.focus(); return; } catch (e) {} }
      openShow();
    });

    /* 计时器 + 时钟 */
    let t0 = Date.now();
    const pad = (n) => String(n).padStart(2, '0');
    setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      $('#pv-timer').textContent = pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
      const d = new Date();
      $('#pv-clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    }, 1000);
    $('#pv-reset').addEventListener('click', () => { t0 = Date.now(); });

    /* 控制 */
    const prev = () => goTo(index - 1);
    const next = () => goTo(index + 1);
    $('#pv-prev').addEventListener('click', prev);
    $('#pv-nexb').addEventListener('click', next);
    $('#pv-font-minus').addEventListener('click', () => {
      notesPx = Math.max(14, notesPx - 2); applyNotesPx();
      try { localStorage.setItem('deck-presenter.notesPx', String(notesPx)); } catch (e) {}
    });
    $('#pv-font-plus').addEventListener('click', () => {
      notesPx = Math.min(44, notesPx + 2); applyNotesPx();
      try { localStorage.setItem('deck-presenter.notesPx', String(notesPx)); } catch (e) {}
    });
    $('#pv-jump').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      const n = parseInt(e.target.value, 10);
      if (n >= 1 && n <= total) { goTo(n - 1); e.target.value = ''; e.target.blur(); }
    });
    const toggleBlack = () => {
      blackout = !blackout;
      post(showWin, { __deckp_blackout: blackout });
      $('#pv-black').textContent = blackout ? '恢复画面 B' : '黑屏 B';
    };
    $('#pv-black').addEventListener('click', toggleBlack);

    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      let handled = true;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') next();
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') prev();
      else if (k === 'Home') goTo(0);
      else if (k === 'End') goTo(total - 1);
      else if (k === 'b' || k === 'B') toggleBlack();
      else handled = false;
      if (handled) e.preventDefault();
    });

    let wheelAcc = 0, wheelCool = 0;
    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return;
      const path = e.composedPath ? e.composedPath() : [];
      for (const n of path) {
        if (n === notesEl || (n.classList && n.classList.contains('txt'))) return; // 逐字稿区滚动优先
      }
      const now = Date.now();
      if (now < wheelCool) return;
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) > 50) {
        wheelAcc > 0 ? next() : prev();
        wheelAcc = 0; wheelCool = now + 450;
      }
    }, { passive: true });

    const refit = () => { fitPreview(curBox); fitPreview(nextBox); };
    window.addEventListener('resize', refit);

    /* 握手：向放映窗口报到，放映窗口会回发当前页码 */
    post(showWin, { __deckp_hello: 'presenter' });
    render();
    return;
  }

  /* ════════════════════════════════════════════════════════════════
   * 放映窗口（默认模式）
   * ════════════════════════════════════════════════════════════════ */
  const stage = $('deck-stage');
  if (!stage) return;

  let presenterWin = null;
  let blackCover = null;
  let helpEl = null;

  const css = document.createElement('style');
  css.textContent = `
    .dp-chip{position:fixed;right:22px;bottom:22px;z-index:2147483000;display:flex;gap:4px;padding:4px;
      background:#000;color:#fff;border-radius:999px;font-size:12px;opacity:0;pointer-events:none;
      transition:opacity 260ms ease;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;user-select:none}
    .dp-chip[data-visible]{opacity:1;pointer-events:auto}
    .dp-chip button{appearance:none;background:transparent;border:0;color:rgba(255,255,255,.72);font:inherit;
      padding:5px 12px;border-radius:999px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
    .dp-chip button:hover{background:rgba(255,255,255,.12);color:#fff}
    .dp-chip .kbd{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;
      font-family:ui-monospace,Menlo,monospace;font-size:10px;color:rgba(255,255,255,.88);background:rgba(255,255,255,.12);border-radius:4px}
    deck-stage[noscale] ~ .dp-chip{display:none}
    :fullscreen .dp-chip{display:flex}
    .dp-black{position:fixed;inset:0;z-index:2147483400;background:#000;cursor:none}
    .dp-help{position:fixed;inset:0;z-index:2147483500;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;
      font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
    .dp-help .card{background:#1f1f1f;color:#eee;border:1px solid rgba(255,255,255,.12);border-radius:12px;
      padding:26px 34px;min-width:420px;box-shadow:0 12px 32px rgba(0,0,0,.5)}
    .dp-help h3{margin:0 0 16px;font-size:16px;font-weight:700;color:#fff;letter-spacing:.06em}
    .dp-help table{border-collapse:collapse;font-size:13px;line-height:2}
    .dp-help td{padding:0 8px}
    .dp-help td:first-child{text-align:right;color:rgba(255,255,255,.55);font-family:ui-monospace,Menlo,monospace;white-space:nowrap}
    .dp-help .tip{margin-top:14px;font-size:12px;color:rgba(255,255,255,.45)}
    @media print{.dp-chip,.dp-black,.dp-help{display:none !important}}
  `;
  document.head.appendChild(css);

  /* 控制条（鼠标动时出现，与 deck-stage 底部导航条同节奏淡出） */
  const chip = document.createElement('div');
  chip.className = 'dp-chip export-hidden';
  chip.setAttribute('data-omelette-chrome', '');
  chip.innerHTML = `
    <button data-act="presenter" title="打开演讲者视图（P）">演讲者视图<span class="kbd">P</span></button>
    <button data-act="fullscreen" title="全屏放映（F）">全屏<span class="kbd">F</span></button>
    <button data-act="help" title="快捷键（H）">?</button>
  `;
  document.body.appendChild(chip);
  let chipTimer = null;
  const flashChip = () => {
    if (document.fullscreenElement) return; // 全屏放映保持画面干净
    chip.setAttribute('data-visible', '');
    clearTimeout(chipTimer);
    chipTimer = setTimeout(() => chip.removeAttribute('data-visible'), 1800);
  };
  window.addEventListener('mousemove', flashChip, { passive: true });

  /* 全屏：进出时同步 __omelette_presenting，deck-stage 自行隐藏缩略图栏/导航条 */
  function toggleFullscreen() {
    const de = document.documentElement;
    if (!document.fullscreenElement) {
      (de.requestFullscreen || de.webkitRequestFullscreen || function () {}).call(de);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
    }
  }
  const onFsChange = () => {
    const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    try { window.postMessage({ __omelette_presenting: fs }, '*'); } catch (e) {}
    if (fs) chip.removeAttribute('data-visible');
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  /* 黑屏 */
  function setBlackout(on) {
    if (on && !blackCover) {
      blackCover = document.createElement('div');
      blackCover.className = 'dp-black export-hidden';
      blackCover.setAttribute('data-omelette-chrome', '');
      blackCover.addEventListener('click', () => setBlackout(false));
      document.body.appendChild(blackCover);
    } else if (!on && blackCover) {
      blackCover.remove();
      blackCover = null;
    }
  }

  /* 帮助 */
  function toggleHelp() {
    if (helpEl) { helpEl.remove(); helpEl = null; return; }
    helpEl = document.createElement('div');
    helpEl.className = 'dp-help export-hidden';
    helpEl.setAttribute('data-omelette-chrome', '');
    helpEl.innerHTML = `
      <div class="card">
        <h3>放映快捷键</h3>
        <table>
          <tr><td>→ ↓ 空格 Enter PgDn</td><td>下一页</td></tr>
          <tr><td>← ↑ Backspace PgUp</td><td>上一页</td></tr>
          <tr><td>滚轮</td><td>上下翻页</td></tr>
          <tr><td>1–9 / 0</td><td>跳到第 1–9 / 10 页</td></tr>
          <tr><td>Home / End / R</td><td>首页 / 末页 / 回到首页</td></tr>
          <tr><td>F</td><td>全屏放映（Esc 退出）</td></tr>
          <tr><td>P</td><td>演讲者视图（双屏：本窗口拖到投屏并按 F）</td></tr>
          <tr><td>B</td><td>黑屏 / 恢复</td></tr>
          <tr><td>H 或 ?</td><td>本帮助</td></tr>
        </table>
        <div class="tip">双屏放映：先按 P 打开演讲者视图留在本机屏幕，再把本窗口拖到投屏、按 F 全屏。两窗口翻页自动同步。</div>
      </div>
    `;
    helpEl.addEventListener('click', () => toggleHelp());
    document.body.appendChild(helpEl);
  }

  /* 演讲者视图 */
  function openPresenter() {
    const u = new URL(location.href);
    u.searchParams.set('presenter', '1');
    u.hash = '';
    const w = window.open(u.href, 'dp-deck-presenter',
      'width=1360,height=850,menubar=no,toolbar=no,location=no,status=no');
    if (w) presenterWin = w;
  }

  function post(win, msg) {
    if (!win) return;
    try { win.postMessage(msg, '*'); } catch (e) {}
  }

  /* 同步：deck-stage 每次换页（含键盘/点击/缩略图/API）广播给演讲者窗口 */
  stage.addEventListener('slidechange', (e) => {
    post(presenterWin, { __deckp_sync: { index: e.detail.index } });
    if (blackCover) setBlackout(false); // 翻页即恢复画面
  });

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d) return;
    if (d.__deckp_hello === 'presenter' && e.source && e.source !== window) {
      presenterWin = e.source;
      post(presenterWin, { __deckp_sync: { index: stage.index } });
    }
    if (d.__deckp_sync && typeof d.__deckp_sync.index === 'number') {
      if (e.source && e.source !== window) presenterWin = e.source;
      if (d.__deckp_sync.index !== stage.index) stage.goTo(d.__deckp_sync.index);
    }
    if (typeof d.__deckp_blackout === 'boolean') setBlackout(d.__deckp_blackout);
  });

  chip.addEventListener('click', (e) => {
    const act = e.target.closest && e.target.closest('[data-act]');
    if (!act) return;
    const a = act.getAttribute('data-act');
    if (a === 'fullscreen') toggleFullscreen();
    else if (a === 'presenter') openPresenter();
    else if (a === 'help') toggleHelp();
  });

  /* 键盘增强：只补 deck-stage 未占用的键（↑/↓/Enter/Backspace/F/P/B/H/?） */
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (blackCover && (k !== 'b' && k !== 'B')) { setBlackout(false); }
    if (helpEl && k === 'Escape') { toggleHelp(); e.preventDefault(); return; }
    let handled = true;
    if (k === 'ArrowDown' || k === 'Enter') stage.next();
    else if (k === 'ArrowUp' || k === 'Backspace') stage.prev();
    else if (k === 'f' || k === 'F') toggleFullscreen();
    else if (k === 'p' || k === 'P') openPresenter();
    else if (k === 'b' || k === 'B') setBlackout(!blackCover);
    else if (k === 'h' || k === 'H' || k === '?') toggleHelp();
    else handled = false;
    if (handled) e.preventDefault();
  });

  /* 滚轮翻页：累积阈值 + 冷却，防触控板惯性连翻；缩略图栏内滚动不受影响 */
  let wheelAcc = 0, wheelCool = 0;
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return; // 捏合缩放
    const path = e.composedPath ? e.composedPath() : [];
    for (const n of path) {
      if (n && n.classList && (n.classList.contains('rail') || n.classList.contains('ctxmenu'))) return;
    }
    const now = Date.now();
    if (now < wheelCool) return;
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) > 50) {
      wheelAcc > 0 ? stage.next() : stage.prev();
      wheelAcc = 0; wheelCool = now + 450;
    }
  }, { passive: true });

  window.__deckpPresenter = { openPresenter, toggleFullscreen };
})();
