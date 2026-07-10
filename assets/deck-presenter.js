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
 *   · shadowRoot（mode:'open'）：仅注入一条样式隐藏上游英文导航胶囊
 *     （.overlay），由本层统一中文控制条替代；上游若升级为 closed shadow，
 *     自动退化为双胶囊并存，功能不受影响。
 * 上游 deck-stage.js 未来整文件覆盖升级，本文件无需跟改。
 *
 * 功能（对标 PowerPoint 放映交互）：
 *   1. 统一控制条   — 底部居中单条胶囊：翻页/页码跳转/回首页/放映/演讲者放映/帮助；
 *                     放映态自动切换为精简放映条（翻页/黑屏/退出）
 *   2. 放映         — F 从当前页全屏放映（≈PPT Shift+F5）；Shift+F 从头放映（≈F5）
 *   3. 演讲者放映   — P 一键双屏（Window Management API，Chrome 100+）：
 *                     幻灯片全屏投观众屏 + 演讲者视图落本机屏；
 *                     单屏/镜像/Safari/授权被拒自动降级为手动双屏流程
 *   4. 交换屏幕     — X 键或演讲者视图按钮，一键对调两屏内容（防投反）；
 *                     受限时自动降级为放映屏点击层确认
 *   5. 演讲者视图   — ?presenter=1 伴随窗：当前页 + 下一页 + 逐字稿 + 计时器 +
 *                     所有页面网格 + 交换屏幕/结束放映 + 失联恢复
 *   6. 翻页优化     — 滚轮翻页（阈值+冷却）；↑/↓、Enter/Backspace；
 *                     数字键缓冲跳页（如 3→7→Enter 跳第 37 页）；页码单击输入跳转
 *   7. 黑屏         — B 键（双窗状态双向同步；任意翻页键恢复）
 *   8. 放映结束页   — 放映态末页再前进出黑色结束屏，再按一次退出放映
 *   9. 快捷键帮助   — H 或 ? 键
 *
 * 消息协议（本层自有，__deckp 前缀避免与上游冲突；postMessage '*'，file:// 可用）：
 *   {__deckp_hello:'presenter'}          演讲者窗口 → 放映窗口（握手/心跳/重连）
 *   {__deckp_sync:{index}}               双向；接收方 index 相同则忽略（防回声）
 *   {__deckp_blackout:bool}              双向（黑屏状态同步）
 *   {__deckp_state:{mode,canSwap,slidesLabel,presenterLabel}}
 *                                       放映窗口 → 演讲者窗口（握手/全屏变化/交换后推送）
 *   {__deckp_swap:true}                  演讲者窗口 → 放映窗口（请求交换屏幕）
 *   {__deckp_swap_pending:true}          放映窗口 → 演讲者窗口（需在放映屏点击确认）
 *   {__deckp_swap_done:{ok,vacated}}     放映窗口 → 演讲者窗口（交换完成，附腾出屏几何）
 *   {__deckp_represent:true}             演讲者窗口 → 放映窗口（误退全屏后一键恢复放映）
 *   {__deckp_exit:{elapsed}}             演讲者窗口 → 放映窗口（结束放映，附计时）
 *   {__deckp_bye:'presenter'}            演讲者窗口 → 放映窗口（窗口即将关闭）
 *
 * 技术备忘（2026-07-09 实测结论，详见 references/presenting.md 排障附录）：
 *   · file:// 属 secure context，getScreenDetails / requestFullscreen({screen})
 *     均可用；window-management 授权一次持久记住。
 *   · Capability Delegation（postMessage delegate:'fullscreen'）在 file:// 下
 *     不可用：规范要求具体 targetOrigin，而 file:// origin 为 opaque "null"。
 *     故交换屏幕不走 delegation：主窗直接换屏（Plan A），被拒时降级为
 *     放映屏点击层（Plan B）。若未来以 http(s) 分发，可改用 delegation。
 * =====================================================================
 */
(() => {
  'use strict';

  const IS_PRESENTER = /[?&]presenter=1/.test(location.search);
  // 无头截图（noscale / _snthumb）与打印场景下，本层 UI 一律不出现。
  const IS_THUMB = /[?&]_snthumb=/.test(location.search);
  if (IS_THUMB) return;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const FONT_STACK = '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';

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
      body{background:#111;display:flex;flex-direction:column;font-family:"Alibaba PuHuiTi 3.0",${FONT_STACK}}
      .pv-head{flex:none;display:flex;align-items:center;gap:14px;padding:10px 18px;background:#1c1c1c;border-bottom:1px solid rgba(255,255,255,.08);color:#eee;font-size:14px}
      .pv-head .timer{font-variant-numeric:tabular-nums;font-size:22px;font-weight:700;color:#fff;letter-spacing:.04em}
      .pv-head .clock{font-variant-numeric:tabular-nums;color:rgba(255,255,255,.6)}
      .pv-head .sp{margin-left:auto}
      .pv-head .pgno{font-variant-numeric:tabular-nums;font-size:18px;font-weight:700}
      .pv-head .pgno .tt{color:rgba(255,255,255,.45);font-weight:400}
      .pv-btn{appearance:none;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#ddd;font:inherit;font-size:13px;padding:4px 12px;border-radius:6px;cursor:pointer;white-space:nowrap}
      .pv-btn:hover{background:rgba(255,255,255,.14);color:#fff}
      .pv-btn[disabled]{opacity:.4;cursor:not-allowed}
      .pv-btn .k{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 3px;margin-left:5px;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:rgba(255,255,255,.85);background:rgba(255,255,255,.14);border-radius:4px}
      .pv-btn.acc{border-color:rgba(74,158,255,.55);color:#8fc2ff}
      .pv-btn.acc:hover{background:rgba(74,158,255,.16);color:#cfe6ff}
      #pv-conn .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#52c41a;margin-right:7px;vertical-align:1px}
      #pv-conn[data-off] .dot{background:#ff4d4f}
      #pv-conn[data-off]{border-color:rgba(255,77,79,.5);color:#ffb3b4}
      .pv-banner{flex:none;display:none;align-items:center;gap:14px;padding:9px 18px;background:#4a3200;color:#ffd591;font-size:14px;border-bottom:1px solid rgba(255,255,255,.08)}
      .pv-banner[data-on]{display:flex}
      .pv-banner .pv-btn{border-color:rgba(255,213,145,.5);color:#ffd591}
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
      .pv-grid{position:fixed;inset:0;z-index:60;background:rgba(8,8,8,.96);overflow-y:auto;padding:22px;scrollbar-width:thin}
      .pv-grid .gwrap{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
      .pv-grid .cell{position:relative;aspect-ratio:16/9;background:#000;border-radius:6px;overflow:hidden;cursor:pointer;outline:2px solid transparent;outline-offset:2px}
      .pv-grid .cell:hover{outline-color:rgba(255,255,255,.45)}
      .pv-grid .cell[data-cur]{outline-color:#4a9eff}
      .pv-grid .cell .no{position:absolute;left:6px;top:5px;z-index:5;font-size:11px;color:#fff;background:rgba(0,0,0,.6);padding:1px 8px;border-radius:999px}
      .pv-grid .ghint{position:sticky;top:0;z-index:8;margin:-22px -22px 14px;padding:10px 22px;background:rgba(8,8,8,.9);color:rgba(255,255,255,.55);font-size:13px}
      @media (max-width:1100px){.pv-main{grid-template-columns:1fr 320px}}
    `;
    document.head.appendChild(css);

    document.body.innerHTML = `
      <div class="pv-head">
        <span class="timer" id="pv-timer">00:00:00</span>
        <button class="pv-btn" id="pv-reset">计时归零</button>
        <span class="clock" id="pv-clock"></span>
        <span class="sp"></span>
        <button class="pv-btn" id="pv-conn"><span class="dot"></span><span id="pv-conn-t">已连接</span></button>
        <button class="pv-btn acc" id="pv-swap" hidden>交换屏幕<span class="k">X</span></button>
        <button class="pv-btn" id="pv-end-show">结束放映</button>
        <span class="pgno"><span id="pv-cur-no">1</span><span class="tt"> / ${total}</span></span>
      </div>
      <div class="pv-banner" id="pv-banner">
        <span id="pv-banner-t"></span>
        <button class="pv-btn" id="pv-banner-act"></button>
        <span class="sp"></span>
        <button class="pv-btn" id="pv-banner-x">关闭</button>
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
        <button class="pv-btn" id="pv-grid-btn">所有页面</button>
        <span class="jump">跳页 <input id="pv-jump" type="number" min="1" max="${total}" placeholder="页码"> 回车</span>
        <button class="pv-btn" id="pv-black">黑屏<span class="k">B</span></button>
      </div>
    `;

    let index = 0;
    let showWin = window.opener || null;
    let blackout = false;
    let mainMode = 'unknown';   // 放映窗口最近一次广播的模式
    let canSwap = false;
    let selfExit = false;       // 本窗主动结束放映时，抑制“已退出全屏”横幅
    let gridEl = null;

    const curBox = $('#pv-cur'), nextBox = $('#pv-next');
    const notesEl = $('#pv-notes'), nxlab = $('#pv-nxlab');
    const curNo = $('#pv-cur-no');
    const swapBtn = $('#pv-swap');

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
      if (gridEl) markGridCurrent();
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

    /* ── 横幅（失联 / 误退全屏 / 交换等待） ── */
    const banner = $('#pv-banner'), bannerT = $('#pv-banner-t'), bannerAct = $('#pv-banner-act');
    let bannerCb = null;
    function showBanner(text, actLabel, cb) {
      bannerT.textContent = text;
      bannerCb = cb || null;
      bannerAct.textContent = actLabel || '';
      bannerAct.hidden = !actLabel;
      banner.setAttribute('data-on', '');
    }
    function hideBanner() { banner.removeAttribute('data-on'); bannerCb = null; }
    bannerAct.addEventListener('click', () => { if (bannerCb) bannerCb(); });
    $('#pv-banner-x').addEventListener('click', hideBanner);

    /* ── 连接状态 ── */
    const connBtn = $('#pv-conn'), connT = $('#pv-conn-t');
    function setConn(ok) {
      if (ok) { connBtn.removeAttribute('data-off'); connT.textContent = '已连接'; connBtn.title = '点击聚焦放映窗口'; }
      else { connBtn.setAttribute('data-off', ''); connT.textContent = '重新打开放映窗口'; connBtn.title = ''; }
    }
    connBtn.addEventListener('click', () => {
      if (showWin && !showWin.closed) { try { showWin.focus(); return; } catch (e) {} }
      openShow();
    });

    /* ── 放映窗口状态广播处理 ── */
    function applyState(st) {
      canSwap = !!st.canSwap;
      swapBtn.hidden = !canSwap;
      swapBtn.title = canSwap
        ? ('一键对调两个屏幕的内容（X）' + (st.slidesLabel ? '｜观众屏：' + st.slidesLabel : ''))
        : '';
      if (mainMode === 'speaker' && st.mode === 'idle' && !selfExit) {
        showBanner('放映窗口已退出全屏', '重新放映', () => {
          post(showWin, { __deckp_represent: true });
          hideBanner();
        });
      } else if (st.mode === 'speaker') {
        hideBanner();
      }
      mainMode = st.mode;
    }

    /* ── 交换屏幕 ── */
    function requestSwap() {
      if (!canSwap || !showWin || showWin.closed) return;
      post(showWin, { __deckp_swap: true });
    }
    swapBtn.addEventListener('click', requestSwap);

    /* ── 结束放映 ── */
    function endShowFromPresenter() {
      selfExit = true;
      post(showWin, { __deckp_exit: { elapsed: $('#pv-timer').textContent } });
      setTimeout(() => { try { window.close(); } catch (e) {} }, 300);
    }
    $('#pv-end-show').addEventListener('click', endShowFromPresenter);

    /* ── 所有页面网格 ── */
    function markGridCurrent() {
      if (!gridEl) return;
      gridEl.querySelectorAll('.cell').forEach((c, i) => {
        if (i === index) c.setAttribute('data-cur', '');
        else c.removeAttribute('data-cur');
      });
    }
    function fitGridCells() {
      if (!gridEl) return;
      gridEl.querySelectorAll('.cell').forEach((cell) => {
        const holder = cell.querySelector('.pv-canvas');
        if (!holder) return;
        const s = cell.clientWidth / 1920 || 0.1;
        holder.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
      });
    }
    function toggleGrid() {
      if (gridEl) { gridEl.remove(); gridEl = null; return; }
      gridEl = document.createElement('div');
      gridEl.className = 'pv-grid';
      const hint = document.createElement('div');
      hint.className = 'ghint';
      hint.textContent = '所有页面 — 单击跳页（两个窗口同步），Esc 或再点“所有页面”关闭';
      gridEl.appendChild(hint);
      const wrap = document.createElement('div');
      wrap.className = 'gwrap';
      sections.forEach((sec, i) => {
        const cell = document.createElement('div');
        cell.className = 'cell';
        const no = document.createElement('span');
        no.className = 'no';
        no.textContent = slideLabel(sec, i);
        const holder = document.createElement('div');
        holder.className = 'pv-canvas';
        const clone = sec.cloneNode(true);
        clone.removeAttribute('id');
        clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
        clone.setAttribute('data-deck-active', '');
        clone.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;box-sizing:border-box;overflow:hidden;visibility:visible;opacity:1;pointer-events:none;';
        holder.appendChild(clone);
        cell.appendChild(no);
        cell.appendChild(holder);
        cell.addEventListener('click', () => { goTo(i); toggleGrid(); });
        wrap.appendChild(cell);
      });
      gridEl.appendChild(wrap);
      document.body.appendChild(gridEl);
      requestAnimationFrame(() => { fitGridCells(); markGridCurrent(); });
    }
    $('#pv-grid-btn').addEventListener('click', toggleGrid);

    /* ── 消息入口：放映窗口 → 演讲者 ── */
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d) return;
      if (e.source && e.source !== window) { showWin = e.source; setConn(true); }
      if (d.__deckp_sync && typeof d.__deckp_sync.index === 'number') {
        goTo(d.__deckp_sync.index, true);
      }
      if (typeof d.__deckp_blackout === 'boolean') {
        blackout = d.__deckp_blackout;
        $('#pv-black').innerHTML = blackout ? '恢复画面<span class="k">B</span>' : '黑屏<span class="k">B</span>';
      }
      if (d.__deckp_state) applyState(d.__deckp_state);
      if (d.__deckp_swap_pending) {
        showBanner('等待交换确认：请在放映屏幕上点击一次', '', null);
      }
      if (d.__deckp_swap_done) {
        if (d.__deckp_swap_done.ok && d.__deckp_swap_done.vacated) {
          const v = d.__deckp_swap_done.vacated;
          try {
            window.moveTo(v.left, v.top);
            window.resizeTo(v.width, v.height);
          } catch (err) {}
          hideBanner();
          setTimeout(() => { fitPreview(curBox); fitPreview(nextBox); fitGridCells(); }, 350);
        } else {
          showBanner('未能自动交换屏幕，请手动拖动窗口调整', '', null);
        }
      }
    });

    /* 打开/聚焦放映窗口 */
    function openShow() {
      const u = new URL(location.href);
      u.searchParams.delete('presenter');
      u.hash = '#' + (index + 1);
      const w = window.open(u.href, 'dp-deck-show');
      if (w) { showWin = w; try { w.focus(); } catch (e) {} }
      hideBanner();
    }

    /* 连接看护：断连出横幅；在连时以 hello 作心跳（覆盖放映窗口被刷新的重连） */
    setInterval(() => {
      if (showWin && showWin.closed) {
        showWin = null;
        setConn(false);
        showBanner('与放映窗口失去连接', '重新打开放映窗口', openShow);
        return;
      }
      if (showWin) post(showWin, { __deckp_hello: 'presenter' });
    }, 2000);

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
      $('#pv-black').innerHTML = blackout ? '恢复画面<span class="k">B</span>' : '黑屏<span class="k">B</span>';
    };
    $('#pv-black').addEventListener('click', toggleBlack);

    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      let handled = true;
      if (k === 'Escape') {
        if (gridEl) toggleGrid();
        else endShowFromPresenter();
      }
      else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') next();
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') prev();
      else if (k === 'Home') goTo(0);
      else if (k === 'End') goTo(total - 1);
      else if (k === 'b' || k === 'B') toggleBlack();
      else if (k === 'x' || k === 'X') requestSwap();
      else handled = false;
      if (handled) e.preventDefault();
    });

    let wheelAcc = 0, wheelCool = 0;
    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return;
      const path = e.composedPath ? e.composedPath() : [];
      for (const n of path) {
        if (n === notesEl || (n.classList && n.classList.contains('txt'))) return; // 逐字稿区滚动优先
        if (n === gridEl) return; // 网格内滚动优先
      }
      const now = Date.now();
      if (now < wheelCool) return;
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) > 50) {
        wheelAcc > 0 ? next() : prev();
        wheelAcc = 0; wheelCool = now + 450;
      }
    }, { passive: true });

    const refit = () => { fitPreview(curBox); fitPreview(nextBox); fitGridCells(); };
    window.addEventListener('resize', refit);

    /* 关窗告别（放映窗口的轮询作为兜底） */
    window.addEventListener('pagehide', () => {
      post(showWin, { __deckp_bye: 'presenter' });
    });

    /* 握手：向放映窗口报到，放映窗口会回发当前页码与状态 */
    post(showWin, { __deckp_hello: 'presenter' });
    setConn(!!(showWin && !showWin.closed));
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
  let cardEl = null;
  let endEl = null;
  let toastBox = null;
  let barPin = 0;            // >0 时控制条常显（页码输入 / 首次引导）
  let showMode = 'idle';     // 'idle' | 'fullscreen' | 'speaker'
  let pendingMode = null;    // requestFullscreen 发起时预置，fullscreenchange 落地
  let screensCache = null;   // ScreenDetails（授权后缓存，含 screenschange 监听）
  let slidesScreenRef = null, presenterScreenRef = null;

  const css = document.createElement('style');
  css.textContent = `
    .dp-bar{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:2px;padding:4px;
      background:#000;color:#fff;border-radius:999px;font-size:12px;opacity:0;pointer-events:none;white-space:nowrap;
      transition:opacity 260ms ease;font-family:${FONT_STACK};user-select:none}
    .dp-bar[data-visible]{opacity:1;pointer-events:auto}
    .dp-bar[data-mode="show"][data-visible]{opacity:.85}
    .dp-bar button{appearance:none;background:transparent;border:0;color:rgba(255,255,255,.72);font:inherit;
      padding:5px 12px;border-radius:999px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
    .dp-bar button:hover{background:rgba(255,255,255,.12);color:#fff}
    .dp-bar button.nav{padding:5px 9px}
    .dp-bar button.nav svg{display:block}
    .dp-bar .pg{display:inline-flex;align-items:center;gap:3px;padding:5px 8px;border-radius:999px;cursor:pointer;
      font-variant-numeric:tabular-nums;color:rgba(255,255,255,.88)}
    .dp-bar .pg:hover{background:rgba(255,255,255,.12)}
    .dp-bar .pg .sep{color:rgba(255,255,255,.4);margin:0 1px}
    .dp-bar .pg .tot{color:rgba(255,255,255,.55)}
    .dp-bar .pg input{width:44px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);border-radius:6px;
      color:#fff;font:inherit;font-size:12px;padding:1px 4px;text-align:center;outline:none}
    .dp-bar .divider{width:1px;height:16px;background:rgba(255,255,255,.22);margin:0 4px;flex:none}
    .dp-bar .kbd{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;
      font-family:ui-monospace,Menlo,monospace;font-size:10px;color:rgba(255,255,255,.88);background:rgba(255,255,255,.12);border-radius:4px}
    .dp-bar[data-mode="show"] .browseonly{display:none}
    .dp-bar .showonly{display:none}
    .dp-bar[data-mode="show"] .showonly{display:inline-flex}
    deck-stage[noscale] ~ .dp-bar,deck-stage[noscale] ~ .dp-toast,deck-stage[noscale] ~ .dp-jumphint,deck-stage[noscale] ~ .dp-bubble{display:none}
    :fullscreen .dp-bar{display:flex}
    .dp-black{position:fixed;inset:0;z-index:2147483400;background:#000;cursor:none}
    .dp-end{position:fixed;inset:0;z-index:2147483350;background:#000;display:flex;align-items:center;justify-content:center;
      color:rgba(255,255,255,.42);font-size:16px;letter-spacing:.22em;font-family:${FONT_STACK};cursor:default}
    .dp-help{position:fixed;inset:0;z-index:2147483500;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;
      font-family:${FONT_STACK}}
    .dp-help .card,.dp-card .card{background:#1f1f1f;color:#eee;border:1px solid rgba(255,255,255,.12);border-radius:12px;
      padding:26px 34px;min-width:420px;max-width:560px;box-shadow:0 12px 32px rgba(0,0,0,.5)}
    .dp-help h3,.dp-card h3{margin:0 0 16px;font-size:16px;font-weight:700;color:#fff;letter-spacing:.06em}
    .dp-help table{border-collapse:collapse;font-size:13px;line-height:2}
    .dp-help td{padding:0 8px}
    .dp-help td:first-child{text-align:right;color:rgba(255,255,255,.55);font-family:ui-monospace,Menlo,monospace;white-space:nowrap}
    .dp-help tr.grp td{padding-top:10px;color:rgba(255,255,255,.38);font-size:12px;letter-spacing:.2em;text-align:left}
    .dp-help .tip,.dp-card .tip{margin-top:14px;font-size:12px;color:rgba(255,255,255,.45);line-height:1.8}
    .dp-card{position:fixed;inset:0;z-index:2147483450;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;
      font-family:${FONT_STACK}}
    .dp-card p{margin:0 0 18px;font-size:14px;line-height:1.9;color:rgba(255,255,255,.78)}
    .dp-card .btns{display:flex;gap:10px;justify-content:flex-end}
    .dp-card .btns button{appearance:none;font:inherit;font-size:13px;padding:8px 18px;border-radius:8px;cursor:pointer;
      border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);color:#ddd}
    .dp-card .btns button:hover{background:rgba(255,255,255,.14);color:#fff}
    .dp-card .btns button.pri{background:#fff;border-color:#fff;color:#111;font-weight:600}
    .dp-card .btns button.pri:hover{background:rgba(255,255,255,.88)}
    .dp-toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:2147483600;display:flex;flex-direction:column;
      gap:8px;align-items:center;font-family:${FONT_STACK};pointer-events:none}
    .dp-toast .t{display:flex;align-items:flex-start;gap:12px;background:rgba(28,28,28,.96);color:#eee;font-size:13px;line-height:1.8;
      padding:10px 18px;border-radius:10px;border:1px solid rgba(255,255,255,.14);box-shadow:0 8px 24px rgba(0,0,0,.4);
      max-width:min(620px,84vw);pointer-events:auto}
    .dp-toast .t button{appearance:none;flex:none;background:transparent;border:0;color:rgba(255,255,255,.5);font-size:16px;
      line-height:1.4;cursor:pointer;padding:0 2px}
    .dp-toast .t button:hover{color:#fff}
    .dp-jumphint{position:fixed;left:50%;bottom:78px;transform:translateX(-50%);z-index:2147483200;background:#000;color:#fff;
      font-size:14px;font-variant-numeric:tabular-nums;padding:8px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.2);
      font-family:${FONT_STACK}}
    .dp-bubble{position:fixed;left:50%;bottom:78px;transform:translateX(-50%);z-index:2147483100;background:rgba(28,28,28,.96);
      color:#eee;font-size:13px;padding:8px 16px;border-radius:8px;border:1px solid rgba(255,255,255,.16);font-family:${FONT_STACK}}
    .dp-clicklayer{position:fixed;inset:0;z-index:2147483650;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:20px;letter-spacing:.12em;cursor:pointer;font-family:${FONT_STACK}}
    html.dp-nocursor,html.dp-nocursor *{cursor:none !important}
    @media print{.dp-bar,.dp-black,.dp-help,.dp-card,.dp-toast,.dp-jumphint,.dp-bubble,.dp-end,.dp-clicklayer{display:none !important}}
  `;
  document.head.appendChild(css);

  function post(win, msg) {
    if (!win) return;
    try { win.postMessage(msg, '*'); } catch (e) {}
  }

  /* ── 抑制上游英文导航胶囊（不改上游文件；shadowRoot 为 open 时生效） ── */
  function suppressStageOverlay() {
    try {
      const sr = stage.shadowRoot;
      if (!sr) return false;
      const st = document.createElement('style');
      st.setAttribute('data-dp-chrome', '');
      st.textContent = '.overlay{display:none !important}';
      sr.appendChild(st);
      return true;
    } catch (e) { return false; }
  }

  /* ── 轻提示 ── */
  function toast(msg, opts) {
    opts = opts || {};
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'dp-toast export-hidden';
      toastBox.setAttribute('data-omelette-chrome', '');
      document.body.appendChild(toastBox);
    }
    const t = document.createElement('div');
    t.className = 't';
    const span = document.createElement('span');
    span.textContent = msg;
    t.appendChild(span);
    if (opts.sticky) {
      const x = document.createElement('button');
      x.textContent = '×';
      x.title = '关闭';
      x.addEventListener('click', () => t.remove());
      t.appendChild(x);
    } else {
      setTimeout(() => t.remove(), opts.ms || 4200);
    }
    toastBox.appendChild(t);
    return t;
  }

  /* ── 统一控制条 ── */
  const SVG_L = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  const SVG_R = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  const bar = document.createElement('div');
  bar.className = 'dp-bar export-hidden';
  bar.setAttribute('data-omelette-chrome', '');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', '放映控制');
  bar.innerHTML = `
    <button class="nav" data-act="prev" title="上一页（←）" aria-label="上一页">${SVG_L}</button>
    <span class="pg" data-act="page" title="单击输入页码跳转"><span class="cur">1</span><span class="sep">/</span><span class="tot">1</span></span>
    <button class="nav" data-act="next" title="下一页（→）" aria-label="下一页">${SVG_R}</button>
    <span class="divider"></span>
    <button class="browseonly" data-act="home" title="回到第 1 页（R）">回首页<span class="kbd">R</span></button>
    <span class="divider browseonly"></span>
    <button class="browseonly" data-act="show" title="从当前页全屏放映（F）；Shift+点击从头放映">放映<span class="kbd">F</span></button>
    <button class="browseonly" data-act="speaker" title="双屏放映：观众屏放片，本屏看讲稿（P）">演讲者放映<span class="kbd">P</span></button>
    <button class="showonly" data-act="black" title="黑屏 / 恢复（B）">黑屏<span class="kbd">B</span></button>
    <button class="showonly" data-act="exit" title="退出放映（Esc）">退出放映<span class="kbd">Esc</span></button>
    <span class="divider"></span>
    <button data-act="help" title="快捷键与帮助（H）">?</button>
  `;
  document.body.appendChild(bar);

  const pgCur = bar.querySelector('.pg .cur');
  const pgTot = bar.querySelector('.pg .tot');
  let barTimer = null;

  function positionBar() {
    let x = window.innerWidth / 2;
    try {
      const s = stage.shadowRoot && stage.shadowRoot.querySelector('.stage');
      if (s) {
        const r = s.getBoundingClientRect();
        if (r.width > 0) x = r.left + r.width / 2;
      }
    } catch (e) {}
    bar.style.left = Math.round(x) + 'px';
  }

  function updateBar() {
    pgCur.textContent = String((stage.index || 0) + 1);
    pgTot.textContent = String(stage.length || 1);
  }

  function flashBar(ms) {
    positionBar();
    bar.setAttribute('data-visible', '');
    clearTimeout(barTimer);
    if (barPin > 0) return;
    barTimer = setTimeout(() => {
      if (barPin > 0) return;
      bar.removeAttribute('data-visible');
    }, ms || 1800);
  }
  window.addEventListener('mousemove', () => flashBar(), { passive: true });
  window.addEventListener('resize', positionBar);

  /* ── 页码单击输入跳转 ── */
  function openPgInput() {
    const pg = bar.querySelector('.pg');
    if (pg.querySelector('input')) return;
    barPin++;
    const keep = pg.innerHTML;
    pg.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.placeholder = '页码';
    pg.appendChild(input);
    input.focus();
    const close = () => {
      barPin = Math.max(0, barPin - 1);
      pg.innerHTML = keep;
      updateBar();
      flashBar();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const n = parseInt(input.value, 10);
        if (n >= 1 && n <= stage.length) stage.goTo(n - 1);
        close();
      } else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', close);
  }

  /* ── 全屏放映（F；Shift 从头） ── */
  function startFullscreenShow(fromStart) {
    if (fromStart) stage.goTo(0);
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    pendingMode = 'fullscreen';
    const de = document.documentElement;
    try {
      const p = (de.requestFullscreen || de.webkitRequestFullscreen || function () {}).call(de);
      if (p && p.catch) p.catch(() => { pendingMode = null; });
    } catch (e) { pendingMode = null; }
  }
  function exitShow() {
    try {
      (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
    } catch (e) {}
  }
  function toggleFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) exitShow();
    else startFullscreenShow(false);
  }

  /* ── 光标自动隐藏（仅放映态） ── */
  let cursorTimer = null;
  function cursorWake() {
    document.documentElement.classList.remove('dp-nocursor');
    clearTimeout(cursorTimer);
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      cursorTimer = setTimeout(() => {
        document.documentElement.classList.add('dp-nocursor');
      }, 2000);
    }
  }
  window.addEventListener('mousemove', cursorWake, { passive: true });

  /* ── 放映结束页 ── */
  function showEndScreen() {
    if (endEl) return;
    endEl = document.createElement('div');
    endEl.className = 'dp-end export-hidden';
    endEl.setAttribute('data-omelette-chrome', '');
    endEl.textContent = '放映结束，再按一次退出放映';
    endEl.addEventListener('click', finishEndScreen);
    document.body.appendChild(endEl);
  }
  function removeEndScreen() {
    if (endEl) { endEl.remove(); endEl = null; }
  }
  function finishEndScreen() {
    removeEndScreen();
    exitShow();
  }
  const NEXT_KEYS = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
  const PREV_KEYS = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];

  /* ── 演讲者窗口管理 ── */
  function openPresenterWindow(screen) {
    const u = new URL(location.href);
    u.searchParams.set('presenter', '1');
    u.hash = '';
    let feat = 'menubar=no,toolbar=no,location=no,status=no';
    if (screen) {
      feat += ',left=' + screen.availLeft + ',top=' + screen.availTop +
              ',width=' + screen.availWidth + ',height=' + screen.availHeight;
    } else {
      feat += ',width=1360,height=850';
    }
    const w = window.open(u.href, 'dp-deck-presenter', feat);
    if (w) presenterWin = w;
    return w;
  }

  function broadcastState() {
    post(presenterWin, { __deckp_state: {
      mode: showMode,
      canSwap: showMode === 'speaker' && !!(screensCache && screensCache.screens.length > 1),
      slidesLabel: (slidesScreenRef && slidesScreenRef.label) || '',
      presenterLabel: (presenterScreenRef && presenterScreenRef.label) || ''
    } });
  }

  /* 演讲者窗口被手关：放映继续（双屏→单屏降级），不弹观众可见的提示 */
  setInterval(() => {
    if (presenterWin && presenterWin.closed) {
      presenterWin = null;
      if (showMode === 'speaker') showMode = 'fullscreen';
    }
  }, 2000);

  /* ── 演讲者放映（P）：一键双屏状态机 ── */
  async function queryWMPermission() {
    for (const name of ['window-management', 'window-placement']) {
      try {
        const st = await navigator.permissions.query({ name });
        if (st && st.state) return st.state;
      } catch (e) { /* 尝试下一个名字 */ }
    }
    return 'unsupported';
  }

  function pickScreens(sd) {
    const cur = sd.currentScreen;
    const others = sd.screens.filter((s) => s !== cur);
    const slides = others.find((s) => !s.isInternal) || others[0];
    return { slidesScreen: slides, presenterScreen: cur };
  }

  function manualDualFlow(prefix) {
    openPresenterWindow(null);
    toast((prefix ? prefix + '。' : '') +
      '已打开演讲者视图。请手动完成双屏：① 演讲者视图留在本机屏幕；② 把本窗口拖到投屏；③ 按 F 全屏。翻页两窗自动同步。',
      { sticky: true });
  }

  /* 单屏 / 镜像时的选择卡 */
  function closeCard() {
    if (cardEl) { cardEl.remove(); cardEl = null; }
  }
  function showChoiceCard() {
    if (cardEl) return;
    cardEl = document.createElement('div');
    cardEl.className = 'dp-card export-hidden';
    cardEl.setAttribute('data-omelette-chrome', '');
    cardEl.innerHTML = `
      <div class="card">
        <h3>未检测到第二个屏幕</h3>
        <p>若已连接投屏，当前可能处于“镜像”模式——观众与你看到相同画面，无需演讲者视图。若需双屏演讲，请在系统显示设置中改为“扩展”模式后重试。</p>
        <div class="btns">
          <button data-c="pv">仍打开演讲者视图</button>
          <button data-c="fs" class="pri">直接全屏放映</button>
        </div>
        <div class="tip">按 Esc 取消</div>
      </div>
    `;
    cardEl.addEventListener('click', (e) => {
      if (e.target === cardEl) { closeCard(); return; }
      const b = e.target.closest && e.target.closest('[data-c]');
      if (!b) return;
      const c = b.getAttribute('data-c');
      closeCard();
      if (c === 'fs') startFullscreenShow(false);
      else if (c === 'pv') openPresenterWindow(null);
    });
    document.body.appendChild(cardEl);
  }

  async function startSpeakerShow() {
    if (showMode === 'speaker' && presenterWin && !presenterWin.closed) {
      try { presenterWin.focus(); } catch (e) {}
      return;
    }
    // 分支 1：浏览器不支持多屏 API（Safari / Firefox）
    if (typeof window.getScreenDetails !== 'function') {
      manualDualFlow('当前浏览器不支持自动双屏（建议 Chrome/Edge）');
      return;
    }
    // 分支 2：单屏或镜像桌面
    if (window.screen.isExtended !== true) {
      showChoiceCard();
      return;
    }
    // 分支 3：扩展桌面 → 授权 → 一键双屏
    let sd = screensCache;
    if (!sd) {
      const perm = await queryWMPermission();
      if (perm === 'denied') {
        toast('未获得“窗口管理”权限，已切换为手动双屏流程（重新授权：地址栏左侧 ⓘ → 网站设置 → 窗口管理 → 允许）', { ms: 8000 });
        manualDualFlow();
        return;
      }
      try {
        sd = await window.getScreenDetails();
      } catch (e) {
        toast('未获得“窗口管理”权限，已切换为手动双屏流程');
        manualDualFlow();
        return;
      }
      screensCache = sd;
      try {
        sd.addEventListener('screenschange', () => {
          if (showMode === 'speaker' && screensCache && screensCache.screens.length < 2) {
            endShow('');
            toast('屏幕连接已变化，放映已结束');
          }
          broadcastState();
        });
      } catch (e) {}
      // 授权弹窗可能耗尽本次点击手势：判定后走“再点一次”预热兜底
      if (perm === 'prompt' && !(navigator.userActivation && navigator.userActivation.isActive)) {
        toast('已完成授权，请再点一次“演讲者放映”开始');
        return;
      }
    }
    if (!sd.screens || sd.screens.length < 2) {
      showChoiceCard();
      return;
    }
    const picked = pickScreens(sd);
    // 同一手势内按序：① 主窗全屏到观众屏 ② 伴随窗开到演讲者屏（Chrome 104+）
    pendingMode = 'speaker';
    try {
      await document.documentElement.requestFullscreen({ screen: picked.slidesScreen });
    } catch (e) {
      pendingMode = null;
      manualDualFlow('未能自动全屏');
      return;
    }
    slidesScreenRef = picked.slidesScreen;
    presenterScreenRef = picked.presenterScreen;
    showMode = 'speaker';
    const w = openPresenterWindow(picked.presenterScreen);
    if (!w) {
      toast('演讲者窗口被拦截：请允许本文件弹出窗口，或按 P 重试', { sticky: true });
    }
    broadcastState();
  }

  /* ── 交换屏幕（Plan A 直接换屏；被拒走 Plan B 放映屏点击层） ── */
  function clickLayerFullscreen(screen, text, onOk, onFail) {
    const layer = document.createElement('div');
    layer.className = 'dp-clicklayer export-hidden';
    layer.setAttribute('data-omelette-chrome', '');
    layer.textContent = text;
    layer.addEventListener('click', async () => {
      layer.remove();
      try {
        await document.documentElement.requestFullscreen(screen ? { screen } : undefined);
        if (onOk) onOk();
      } catch (e) {
        if (onFail) onFail(e);
      }
    });
    document.body.appendChild(layer);
    return layer;
  }

  async function handleSwap() {
    if (showMode !== 'speaker' || !screensCache || !slidesScreenRef || !presenterScreenRef) return;
    const newSlides = presenterScreenRef;
    const newPresenter = slidesScreenRef;
    const vacated = {
      left: newPresenter.availLeft, top: newPresenter.availTop,
      width: newPresenter.availWidth, height: newPresenter.availHeight
    };
    const commit = () => {
      slidesScreenRef = newSlides;
      presenterScreenRef = newPresenter;
      post(presenterWin, { __deckp_swap_done: { ok: true, vacated } });
      broadcastState();
    };
    try {
      await document.documentElement.requestFullscreen({ screen: newSlides });
      commit();
    } catch (e) {
      post(presenterWin, { __deckp_swap_pending: true });
      clickLayerFullscreen(newSlides, '点击此处完成屏幕交换', commit, () => {
        post(presenterWin, { __deckp_swap_done: { ok: false } });
        toast('屏幕交换未完成，请手动调整窗口位置');
      });
    }
  }

  /* ── 结束放映 ── */
  function endShow(elapsed) {
    exitShow();
    showMode = 'idle';
    pendingMode = null;
    setBlackout(false);
    removeEndScreen();
    broadcastState();
    if (elapsed) toast('放映已结束，共用时 ' + elapsed);
  }

  /* ── 全屏状态联动 ── */
  const onFsChange = () => {
    const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    try { window.postMessage({ __omelette_presenting: fs }, '*'); } catch (e) {}
    if (fs) {
      if (pendingMode) { showMode = pendingMode; pendingMode = null; }
      else if (showMode === 'idle') showMode = 'fullscreen';
      bar.setAttribute('data-mode', 'show');
      bar.removeAttribute('data-visible');
    } else {
      showMode = 'idle';
      pendingMode = null;
      bar.removeAttribute('data-mode');
      removeEndScreen();
      setBlackout(false); // 黑屏中退出放映自动清黑屏
      flashBar();
    }
    cursorWake();
    positionBar();
    broadcastState();
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  /* ── 黑屏（双窗双向同步） ── */
  function setBlackout(on) {
    if (on && !blackCover) {
      blackCover = document.createElement('div');
      blackCover.className = 'dp-black export-hidden';
      blackCover.setAttribute('data-omelette-chrome', '');
      blackCover.addEventListener('click', () => setBlackout(false));
      document.body.appendChild(blackCover);
      post(presenterWin, { __deckp_blackout: true });
    } else if (!on && blackCover) {
      blackCover.remove();
      blackCover = null;
      post(presenterWin, { __deckp_blackout: false });
    }
  }

  /* ── 帮助 ── */
  function toggleHelp() {
    if (helpEl) { helpEl.remove(); helpEl = null; return; }
    const wmOk = typeof window.getScreenDetails === 'function';
    helpEl = document.createElement('div');
    helpEl.className = 'dp-help export-hidden';
    helpEl.setAttribute('data-omelette-chrome', '');
    helpEl.innerHTML = `
      <div class="card">
        <h3>放映快捷键</h3>
        <table>
          <tr class="grp"><td colspan="2">翻页</td></tr>
          <tr><td>→ ↓ 空格 Enter PgDn</td><td>下一页</td></tr>
          <tr><td>← ↑ Backspace PgUp</td><td>上一页</td></tr>
          <tr><td>滚轮</td><td>上下翻页</td></tr>
          <tr><td>数字 + Enter</td><td>跳到任意页（如 3、7、Enter 跳第 37 页）</td></tr>
          <tr><td>Home / End / R</td><td>首页 / 末页 / 回首页</td></tr>
          <tr class="grp"><td colspan="2">放映</td></tr>
          <tr><td>F</td><td>从当前页放映（再按或 Esc 退出）</td></tr>
          <tr><td>Shift+F</td><td>从第 1 页放映</td></tr>
          <tr><td>P</td><td>演讲者放映（自动双屏：观众屏放片，本屏看讲稿）</td></tr>
          <tr><td>X</td><td>交换两个屏幕的内容</td></tr>
          <tr><td>B</td><td>黑屏 / 恢复</td></tr>
          <tr class="grp"><td colspan="2">其他</td></tr>
          <tr><td>H 或 ?</td><td>本帮助</td></tr>
        </table>
        <div class="tip">首次使用“演讲者放映”会请求“窗口管理”权限，建议正式汇报前先试一次完成授权。若权限被拒：地址栏左侧 ⓘ → 网站设置 → 窗口管理 → 允许，然后刷新。${wmOk ? '' : '当前浏览器不支持自动双屏（建议 Chrome/Edge）：按 P 打开演讲者视图后手动拖窗。'}F5 为浏览器刷新，放映请用 F / P。</div>
      </div>
    `;
    helpEl.addEventListener('click', () => toggleHelp());
    document.body.appendChild(helpEl);
  }

  /* ── 同步：deck-stage 每次换页广播给演讲者窗口 ── */
  stage.addEventListener('slidechange', (e) => {
    post(presenterWin, { __deckp_sync: { index: e.detail.index } });
    if (blackCover) setBlackout(false); // 翻页即恢复画面
    removeEndScreen();
    updateBar();
    flashBar();
  });

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d) return;
    if (d.__deckp_hello === 'presenter' && e.source && e.source !== window) {
      presenterWin = e.source;
      post(presenterWin, { __deckp_sync: { index: stage.index } });
      if (blackCover) post(presenterWin, { __deckp_blackout: true });
      broadcastState();
    }
    if (d.__deckp_sync && typeof d.__deckp_sync.index === 'number') {
      if (e.source && e.source !== window) presenterWin = e.source;
      if (d.__deckp_sync.index !== stage.index) stage.goTo(d.__deckp_sync.index);
    }
    if (typeof d.__deckp_blackout === 'boolean') setBlackout(d.__deckp_blackout);
    if (d.__deckp_swap === true) handleSwap();
    if (d.__deckp_exit) endShow((d.__deckp_exit && d.__deckp_exit.elapsed) || '');
    if (d.__deckp_bye === 'presenter') {
      presenterWin = null;
      if (showMode === 'speaker') showMode = 'fullscreen';
    }
    if (d.__deckp_represent === true) {
      pendingMode = slidesScreenRef ? 'speaker' : 'fullscreen';
      const de = document.documentElement;
      try {
        const p = de.requestFullscreen(slidesScreenRef ? { screen: slidesScreenRef } : undefined);
        if (p && p.catch) p.catch(() => {
          pendingMode = null;
          clickLayerFullscreen(slidesScreenRef, '点击此处恢复放映', () => {
            showMode = slidesScreenRef ? 'speaker' : 'fullscreen';
            broadcastState();
          }, () => {});
        });
      } catch (err) { pendingMode = null; }
    }
  });

  bar.addEventListener('click', (e) => {
    const act = e.target.closest && e.target.closest('[data-act]');
    if (!act) return;
    const a = act.getAttribute('data-act');
    if (a === 'prev') stage.prev();
    else if (a === 'next') {
      if ((document.fullscreenElement || document.webkitFullscreenElement) &&
          stage.index === stage.length - 1) showEndScreen();
      else stage.next();
    }
    else if (a === 'home') stage.goTo(0);
    else if (a === 'show') startFullscreenShow(e.shiftKey);
    else if (a === 'speaker') startSpeakerShow();
    else if (a === 'black') setBlackout(!blackCover);
    else if (a === 'exit') exitShow();
    else if (a === 'help') toggleHelp();
    else if (a === 'page') openPgInput();
  });

  /* ── 数字键缓冲跳页（捕获阶段接管，覆盖 deck-stage 的 1–9/0 直跳） ── */
  let jumpBuf = '', jumpTimer = null, jumpHintEl = null;
  function showJumpHint() {
    if (!jumpHintEl) {
      jumpHintEl = document.createElement('div');
      jumpHintEl.className = 'dp-jumphint export-hidden';
      jumpHintEl.setAttribute('data-omelette-chrome', '');
      document.body.appendChild(jumpHintEl);
    }
    jumpHintEl.textContent = '跳至 ' + jumpBuf + ' ↵';
    jumpHintEl.style.left = bar.style.left || '50%';
  }
  function cancelJump() {
    jumpBuf = '';
    clearTimeout(jumpTimer);
    if (jumpHintEl) { jumpHintEl.remove(); jumpHintEl = null; }
  }
  function commitJump() {
    let n = parseInt(jumpBuf, 10);
    cancelJump();
    if (isNaN(n)) return;
    if (n === 0) n = 10; // 兼容上游“0 = 第 10 页”肌肉记忆
    n = Math.max(1, Math.min(stage.length, n));
    removeEndScreen();
    stage.goTo(n - 1);
  }
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (/^[0-9]$/.test(k)) {
      e.preventDefault();
      e.stopPropagation();
      jumpBuf += k;
      showJumpHint();
      clearTimeout(jumpTimer);
      jumpTimer = setTimeout(commitJump, jumpBuf.length === 1 ? 800 : 1400);
      return;
    }
    if (jumpBuf) {
      if (k === 'Enter') { e.preventDefault(); e.stopPropagation(); commitJump(); }
      else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelJump(); }
      else if (k === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        jumpBuf = jumpBuf.slice(0, -1);
        if (jumpBuf) { showJumpHint(); } else cancelJump();
      }
      else cancelJump(); // 其他键：放弃缓冲，按键照常生效
    }
  }, true);

  /* ── 放映结束页：末页再前进（捕获阶段拦截 deck-stage 自处理的键） ── */
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!(document.fullscreenElement || document.webkitFullscreenElement)) return;
    const k = e.key;
    if (endEl) {
      if (NEXT_KEYS.indexOf(k) !== -1) { e.preventDefault(); e.stopPropagation(); finishEndScreen(); }
      else if (PREV_KEYS.indexOf(k) !== -1) { e.preventDefault(); e.stopPropagation(); removeEndScreen(); }
      return;
    }
    if (NEXT_KEYS.indexOf(k) !== -1 && stage.index === stage.length - 1 && !jumpBuf) {
      e.preventDefault();
      e.stopPropagation();
      showEndScreen();
    }
  }, true);

  /* ── 键盘增强：只补 deck-stage 未占用的键 ── */
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (blackCover && (k !== 'b' && k !== 'B' && k !== 'Escape')) { setBlackout(false); }
    if (k === 'Escape') {
      if (helpEl) { toggleHelp(); e.preventDefault(); return; }
      if (cardEl) { closeCard(); e.preventDefault(); return; }
      return; // 全屏退出交给浏览器原生行为
    }
    let handled = true;
    if (k === 'ArrowDown' || k === 'Enter') stage.next();
    else if (k === 'ArrowUp' || k === 'Backspace') stage.prev();
    else if (k === 'f' || k === 'F') {
      if (document.fullscreenElement || document.webkitFullscreenElement) exitShow();
      else startFullscreenShow(e.shiftKey);
    }
    else if (k === 'p' || k === 'P') startSpeakerShow();
    else if (k === 'x' || k === 'X') {
      if (showMode === 'speaker') handleSwap();
      else handled = false;
    }
    else if (k === 'b' || k === 'B') setBlackout(!blackCover);
    else if (k === 'h' || k === 'H' || k === '?') toggleHelp();
    else handled = false;
    if (handled) e.preventDefault();
  });

  /* ── 滚轮翻页：累积阈值 + 冷却；末页前进在放映态出结束页 ── */
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
      const fwd = wheelAcc > 0;
      wheelAcc = 0; wheelCool = now + 450;
      const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (endEl) { fwd ? finishEndScreen() : removeEndScreen(); return; }
      if (fwd && fs && stage.index === stage.length - 1) { showEndScreen(); return; }
      fwd ? stage.next() : stage.prev();
    }
  }, { passive: true });

  /* ── 插入第二个屏幕的即时引导（浏览态一次性提示） ── */
  if (typeof window.screen.isExtended === 'boolean') {
    let wasExtended = window.screen.isExtended;
    let plugToastShown = false;
    setInterval(() => {
      const now = window.screen.isExtended === true;
      if (now && !wasExtended && showMode === 'idle' && !plugToastShown) {
        plugToastShown = true;
        toast('检测到第二个屏幕——按 P 一键进入演讲者放映（首次使用会请求权限）', { ms: 8000 });
      }
      wasExtended = now;
    }, 3000);
  }

  /* ── 初始化 ── */
  const overlaySuppressed = suppressStageOverlay();
  if (!overlaySuppressed) {
    // 上游 shadowRoot 不可及（未来升级为 closed）：退化为双胶囊并存，功能不受影响。
    try { console.warn('[deck-presenter] 未能抑制上游导航条（shadowRoot 不可及），双胶囊并存。'); } catch (e) {}
  }
  updateBar();
  positionBar();
  requestAnimationFrame(() => { updateBar(); positionBar(); });

  /* 首次打开引导：控制条亮 4 秒 + 快捷键气泡（localStorage 记一次） */
  (function firstRunIntro() {
    let seen = null;
    try { seen = localStorage.getItem('deck-presenter.introShown'); } catch (e) {}
    if (seen) return;
    try { localStorage.setItem('deck-presenter.introShown', '1'); } catch (e) {}
    barPin++;
    bar.setAttribute('data-visible', '');
    const bubble = document.createElement('div');
    bubble.className = 'dp-bubble export-hidden';
    bubble.setAttribute('data-omelette-chrome', '');
    bubble.textContent = '按 H 查看快捷键';
    bubble.style.left = bar.style.left || '50%';
    document.body.appendChild(bubble);
    setTimeout(() => {
      bubble.remove();
      barPin = Math.max(0, barPin - 1);
      flashBar();
    }, 4000);
  })();

  window.__deckpPresenter = {
    openPresenter: openPresenterWindow,
    toggleFullscreen,
    startFullscreenShow,
    startSpeakerShow,
    version: 2
  };
})();
