/**
 * deck-presenter.js — 咨询汇报 HTML 幻灯片“独立放映增强层”
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
 * 功能（对标 PowerPoint 放映交互，v3 新增“窗口放映”，v4 新增“关于面板 +
 * 帮助层一键导出 PDF + chrome 视觉升级”）：
 *   1. 统一控制条   — 底部居中单条胶囊：翻页/页码跳转/回首页/放映/演讲者放映/帮助；
 *                     放映态自动切换为精简放映条（翻页/黑屏/全屏⇄窗口/退出）
 *   2. 放映         — F 从当前页全屏放映（≈PPT Shift+F5）；Shift+F 从头放映（≈F5）；
 *                     放映中 F = 全屏⇄窗口放映切换（退出统一走 Esc / 退出按钮）
 *   3. 窗口放映     — 放映视觉态与 OS 全屏解耦（上游 __omelette_presenting 消息
 *                     与全屏零耦合、无需手势）：干净画布满窗、无缩略图栏。远程
 *                     会议在会议软件中共享本窗口即用此态；进入放映后窗口标题加
 *                     “（放映窗口）”后缀，共享选择器里与“（演讲者视图）”正向可辨
 *   4. 演讲者放映   — P 一键双屏（Window Management API，Chrome 100+）：
 *                     幻灯片全屏投观众屏 + 演讲者视图落本机屏；单屏/镜像弹选择卡
 *                     （远程会议选“演讲者视图＋窗口放映”）；Safari/授权被拒降级为
 *                     手动双屏流程（主窗自动进入窗口放映）
 *   5. 交换屏幕     — X 键或演讲者视图按钮，一键对调两屏内容（防投反）；
 *                     受限时自动降级为放映屏点击层确认
 *   6. 演讲者视图   — ?presenter=1 伴随窗：当前页 + 下一页 + 逐字稿 + 计时器 +
 *                     所有页面网格 + 交换屏幕/结束放映 + 失联恢复 + 主窗状态横幅
 *   7. 翻页优化     — 滚轮翻页（阈值+冷却）；↑/↓、Enter/Backspace；
 *                     数字键缓冲跳页（如 3→7→Enter 跳第 37 页）；页码单击输入跳转
 *   8. 黑屏         — B 键（双窗状态双向同步；任意翻页键恢复）
 *   9. 放映结束页   — 放映态（含窗口放映）末页再前进出结束屏，再按一次退出放映
 *  10. 快捷键帮助   — H 或 ? 键
 *
 * 状态模型（showMode × 是否 OS 全屏 isFs()，5 个合法状态）：
 *   S0 idle×window 浏览态 ｜ S1 show×window 窗口放映 ｜ S2 show×fs 全屏放映
 *   S3 speaker×window 窗口放映＋讲者窗（远程会议核心态）｜ S4 speaker×fs 双屏放映
 *   关键边：S4 --Esc/系统退全屏--> S3（讲者窗活着=放映不死）；S2 --Esc--> S0（solo
 *   一步全退）；S2/S4 --F--> S1/S3（keepPresentingOnFsExit 意图标志，不出横幅）；
 *   S3 --讲者窗关/bye--> S1（放映不断）；S1/S3 --P--> S3（放映中静默开窗，不弹卡）；
 *   S0 --hello 且 !userExited--> S3。防循环规则：心跳只救“意外掉线”，永不推翻
 *   “明确退出”—— userExited 置位仅在 exitShowCompletely（唯一退出漏斗），清零
 *   仅在 enterShow（唯一入场漏斗）与 hello 换源；换源判定因 WindowProxy 跨刷新
 *   恒等，实际只覆盖“讲者窗反向重开主窗”一种情形。
 *
 * 消息协议（本层自有，__dp 前缀避免与上游冲突；postMessage '*'，file:// 可用）：
 *   {__deckp_hello:'presenter'}          演讲者窗口 → 放映窗口（握手/心跳/重连）
 *   {__deckp_sync:{index}}               双向；接收方 index 相同则忽略（防回声）
 *   {__deckp_blackout:bool}              双向（黑屏状态同步）
 *   {__deckp_state:{mode:'idle'|'show'|'speaker', fs, reason, managed,
 *                  canSwap, slidesLabel, presenterLabel}}
 *                                       放映窗口 → 演讲者窗口（握手/状态变化推送）。
 *                                       reason∈{'system','user-toggle','swap','user-exit',null}；
 *                                       讲者窗横幅只认边沿：fs true→false 且
 *                                       reason='system' →“已退出全屏”；mode 非idle→idle
 *                                       →“放映已结束”；心跳电平（reason=null）不动横幅
 *   {__deckp_swap:true}                  演讲者窗口 → 放映窗口（请求交换屏幕）
 *   {__deckp_swap_pending:true}          放映窗口 → 演讲者窗口（需在放映屏点击确认）
 *   {__deckp_swap_done:{ok,vacated}}     放映窗口 → 演讲者窗口（交换完成，附腾出屏几何）
 *   {__deckp_represent:true}             演讲者窗口 → 放映窗口（一键恢复放映：先免手势
 *                                       恢复窗口放映作硬保底，受管双屏再尝试恢复全屏）
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
  const VERSION = 4; // 运行时版本唯一真源：关于面板 / console 横幅 / __deckpPresenter 均引用
  const FONT_STACK = '"Alibaba PuHuiTi 3.0",-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';

  /* ── 共用：postMessage（跨 file:// 双窗，目标可能已关闭） ── */
  function post(win, msg) {
    if (!win) return;
    try { win.postMessage(msg, '*'); } catch (e) {}
  }

  /* ── 共用：键盘事件是否落在输入类控件（各 keydown 守卫统一用这一份） ── */
  const isTypingTarget = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

  /* 模态层是否开着。滚轮与翻页键都要先问这一句，否则弹层浮在上面、底下的片子还在翻，
     用户以为在滚弹层内容，实际把演讲翻走了。
     判据走 DOM 而不是闭包变量：本文件同时跑在主窗与演讲者窗两个 document 里，
     各自的 helpEl / cardEl 互不可见，只有查自己的 DOM 才在两处都成立。 */
  const MODAL_SEL = '.dp-help, .dp-card, .dp-grid';
  const modalOpen = () => !!document.querySelector(MODAL_SEL);

  /* 弹层开着时，翻页键一律不放行。
     必须挂在 window 的捕获阶段：翻页键由 deck-stage 内核自己监听，
     冒泡阶段再拦已经晚了，片子早翻过去了。捕获阶段 window 最先拿到事件，
     stopPropagation 之后内核与本层其余监听都收不到。
     放行三类：Esc 用来关闭，Tab 用来在弹层内走焦点，Enter 与空格用来按弹层里的按钮。 */
  window.addEventListener('keydown', (e) => {
    if (!modalOpen() || isTypingTarget(e.target)) return;
    const k = e.key;
    if (k === 'Escape' || k === 'Tab') return;
    const inModal = e.target && e.target.closest && e.target.closest(MODAL_SEL);
    if ((k === 'Enter' || k === ' ') && inModal) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  /* ── 署名横幅（每窗一次；作者与开源仓见 H 键关于面板） ── */
  try {
    console.log(
      '%c咨询汇报 HTML 幻灯片%c deck-presenter v' + VERSION +
      '\n设计与实现 曾子轩 · https://zixuan.net' +
      '\n开源技能包 https://github.com/sinnohzeng/html-deck-skill' +
      (IS_PRESENTER ? '' : '\n按 H 查看快捷键与关于'), // 演讲者窗未绑 H，不给误导指引
      'color:#7BA0E6;font-weight:700;font-size:13px', 'color:inherit'
    );
  } catch (e) {}

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
      body{background:radial-gradient(1200px 700px at 70% -10%,#16233F 0%,#0B1322 60%);display:flex;flex-direction:column;font-family:${FONT_STACK}}
      .pv-head{flex:none;display:flex;align-items:center;gap:14px;padding:10px 18px;background:#141F36;border-bottom:1px solid rgba(255,255,255,.08);color:#EAF0F8;font-size:14px}
      .pv-head .timer{font-variant-numeric:tabular-nums;font-size:24px;font-weight:700;color:#fff;letter-spacing:.05em}
      .pv-head .clock{font-variant-numeric:tabular-nums;color:rgba(255,255,255,.6)}
      .pv-head .sp{margin-left:auto}
      .pv-head .pgno{font-variant-numeric:tabular-nums;font-size:18px;font-weight:700}
      .pv-head .pgno .tt{color:rgba(255,255,255,.45);font-weight:400}
      .pv-btn{appearance:none;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#ddd;font:inherit;font-size:13px;padding:4px 12px;border-radius:6px;cursor:pointer;white-space:nowrap}
      .pv-btn:hover{background:rgba(123,160,230,.18);color:#fff}
      .pv-btn[disabled]{opacity:.4;cursor:not-allowed}
      .pv-btn .k{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 3px;margin-left:5px;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:rgba(255,255,255,.85);background:rgba(255,255,255,.14);border-radius:4px}
      .pv-btn.acc{border-color:rgba(123,160,230,.55);color:#7BA0E6}
      .pv-btn.acc:hover{background:rgba(123,160,230,.16);color:#CFE0FF}
      #pv-conn .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#52c41a;margin-right:7px;vertical-align:1px}
      #pv-conn[data-off] .dot{background:#ff4d4f}
      #pv-conn[data-off]{border-color:rgba(255,77,79,.5);color:#ffb3b4}
      .pv-banner{flex:none;display:none;align-items:center;gap:14px;padding:9px 18px;background:#4a3200;color:#ffd591;font-size:14px;border-bottom:1px solid rgba(255,255,255,.08)}
      .pv-banner[data-on]{display:flex}
      .pv-banner .pv-btn{border-color:rgba(255,213,145,.5);color:#ffd591}
      .pv-main{flex:1;min-height:0;display:grid;grid-template-columns:1fr 380px;gap:12px;padding:12px}
      .pv-cur{position:relative;flex:1;min-height:0;background:#000;border-radius:8px;overflow:hidden}
      .pv-side{display:flex;flex-direction:column;gap:10px;min-height:0;min-width:0}
      .pv-next{position:relative;flex:1;min-height:0;background:#000;border-radius:8px;overflow:hidden}
      .pv-next .cap,.pv-cur .cap{position:absolute;left:10px;top:8px;z-index:5;font-size:12px;color:#fff;background:rgba(0,0,0,.55);padding:2px 10px;border-radius:999px;letter-spacing:.06em}
      .pv-notes{flex:1;min-height:0;display:flex;flex-direction:column;background:#141F36;border:1px solid rgba(255,255,255,.06);border-radius:8px;overflow:hidden}
      .pv-notes .bar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.6);font-size:13px}
      .pv-notes .bar .sp{margin-left:auto}
      .pv-notes .txt{flex:1;overflow-y:auto;padding:16px 20px;color:#f2f2f2;line-height:1.75;scrollbar-width:thin}
      .pv-notes .txt p{margin:0 0 .9em}
      .pv-notes .txt:empty::before{content:"（本页无逐字稿）";color:rgba(255,255,255,.35)}
      .pv-foot{flex:none;display:flex;align-items:center;gap:14px;padding:10px 18px;background:#141F36;border-top:1px solid rgba(255,255,255,.08);color:#ccc}
      .pv-foot .nav{display:flex;gap:10px}
      .pv-foot .nav .pv-btn{font-size:15px;padding:8px 22px}
      .pv-foot .nxlab{font-size:14px;color:rgba(255,255,255,.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
      .pv-foot .jump{display:flex;align-items:center;gap:6px;font-size:13px;color:rgba(255,255,255,.55)}
      .pv-foot .jump input{width:64px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:6px;color:#fff;font:inherit;font-size:14px;padding:5px 8px;text-align:center}
      .pv-canvas{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center center;background:#fff}
      .pv-end{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.4);font-size:15px;letter-spacing:.1em}
      .pv-grid{position:fixed;inset:0;z-index:60;background:rgba(8,14,32,.96);overflow-y:auto;padding:22px;scrollbar-width:thin}
      .pv-grid .gwrap{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
      .pv-grid .cell{position:relative;aspect-ratio:16/9;background:#000;border-radius:6px;overflow:hidden;cursor:pointer;outline:2px solid transparent;outline-offset:2px}
      .pv-grid .cell:hover{outline-color:rgba(255,255,255,.45)}
      .pv-grid .cell[data-cur]{outline-color:#7BA0E6}
      .pv-grid .cell .no{position:absolute;left:6px;top:5px;z-index:5;font-size:11px;color:#fff;background:rgba(0,0,0,.6);padding:1px 8px;border-radius:999px}
      .pv-grid .ghint{position:sticky;top:0;z-index:8;margin:-22px -22px 14px;padding:10px 22px;background:rgba(8,14,32,.9);color:rgba(255,255,255,.55);font-size:13px}
      @media (max-width:1100px){.pv-main{grid-template-columns:1fr 300px}}
      @media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none !important;animation:none !important}}
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
        <div class="pv-notes">
          <div class="bar">逐字稿
            <span class="sp"></span>
            <button class="pv-btn" id="pv-font-minus">A−</button>
            <button class="pv-btn" id="pv-font-plus">A＋</button>
          </div>
          <div class="txt" id="pv-notes"></div>
        </div>
        <div class="pv-side">
          <div class="pv-cur" id="pv-cur"><span class="cap">当前页</span></div>
          <div class="pv-next" id="pv-next"><span class="cap">下一页</span></div>
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
    let mainFs = null;          // 放映窗口最近一次广播的全屏态（null=未知；null→x 不算边沿）
    let canSwap = false;
    let selfExit = false;       // 本窗主动结束放映时，抑制“已退出全屏”横幅
    let gridEl = null;

    const curBox = $('#pv-cur'), nextBox = $('#pv-next');
    const notesEl = $('#pv-notes'), nxlab = $('#pv-nxlab');
    const curNo = $('#pv-cur-no');
    const swapBtn = $('#pv-swap');

    let notesPx = 28;
    try { notesPx = parseInt(localStorage.getItem('deck-presenter.notesPx'), 10) || 28; } catch (e) {}
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
    function connText() {
      if (mainMode === 'speaker' || mainMode === 'show') return '已连接 · ' + (mainFs ? '全屏放映' : '窗口放映');
      if (mainMode === 'idle') return '已连接 · 未在放映';
      return '已连接';
    }
    function setConn(ok) {
      if (ok) { connBtn.removeAttribute('data-off'); connT.textContent = connText(); connBtn.title = '点击聚焦放映窗口'; }
      else { connBtn.setAttribute('data-off', ''); connT.textContent = '重新打开放映窗口'; connBtn.title = ''; }
    }
    connBtn.addEventListener('click', () => {
      if (showWin && !showWin.closed) { try { showWin.focus(); return; } catch (e) {} }
      openShow();
    });

    /* ── 放映窗口状态广播处理（横幅触发/清除都只认边沿，心跳电平不动横幅） ── */
    function applyState(st) {
      canSwap = !!st.canSwap;
      swapBtn.hidden = !canSwap;
      swapBtn.title = canSwap
        ? ('一键对调两个屏幕的内容（X）' + (st.slidesLabel ? '｜观众屏：' + st.slidesLabel : ''))
        : '';
      const wasMode = mainMode, wasFs = mainFs;
      const fs = st.fs === true;
      if (st.mode === 'idle' && wasMode !== 'idle' && !selfExit) {
        // 放映结束边沿（含 unknown→idle：讲者窗刷新后不丢恢复入口）
        showBanner('放映已结束', '重新放映', () => {
          post(showWin, { __deckp_represent: true });
          hideBanner();
        });
      } else if (st.mode === 'speaker' && wasMode === 'speaker' &&
                 wasFs === true && fs === false && st.reason === 'system') {
        // 系统性退全屏边沿（误 Esc/拔屏）；F 主动降窗（user-toggle）与交换过程（swap）不报
        showBanner('放映窗口已退出全屏，放映未中断',
          st.managed ? '恢复全屏' : '',
          st.managed ? () => { post(showWin, { __deckp_represent: true }); hideBanner(); } : null);
      } else if ((fs === true && wasFs === false) || (st.mode !== 'idle' && wasMode === 'idle')) {
        hideBanner(); // 清除边沿：重新进全屏 / 重新开始放映
      }
      mainMode = st.mode;
      mainFs = fs;
      if (showWin && !showWin.closed) setConn(true); // 复合状态文字随播刷新
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
      notesPx = Math.min(56, notesPx + 2); applyNotesPx();
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
      if (isTypingTarget(e.target)) return;
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

    // 滚轮翻页骨架与放映窗另有一份镜像（阈值 50 / 冷却 450ms），改动请两处同步；
    // 两份 ignore 路径语义不同（此处让行逐字稿/网格，放映窗让行 rail/ctxmenu），不抽象。
    let wheelAcc = 0, wheelCool = 0;
    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return;
      if (modalOpen()) return; // 弹层开着时滚轮归弹层，不许翻片
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

    /* 后台节流自愈加速：讲者窗被会议软件遮挡/最小化时 setInterval 可能被浏览器
       节流到分钟级，回到前台立即补发一次心跳，加速主窗刷新后的自动拉回。 */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && showWin && !showWin.closed) post(showWin, { __deckp_hello: 'presenter' });
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
  let showMode = 'idle';     // 'idle' | 'show'(solo 放映) | 'speaker'(带讲者窗)；全屏与否由 isFs() 正交判定
  let pendingMode = null;    // requestFullscreen 发起时预置，fullscreenchange 落地
  let screensCache = null;   // ScreenDetails（授权后缓存，含 screenschange 监听）
  let slidesScreenRef = null, presenterScreenRef = null;
  let userExited = false;            // 防心跳回拉：明确退出后 hello 不再自动入场（见头注释防循环规则）
  let keepPresentingOnFsExit = false; // F 主动降窗意图标志（onFsChange 消费后复位）
  let swapping = false;              // 交换屏幕过程中抑制 'system' 横幅（commit/失败与超时双清）
  let fsToastShown = false;          // “已切换为窗口放映”一次性提示（每次打开一次）
  const baseTitle = document.title;  // 放映窗标题标记的还原基准

  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const presenting = () => showMode !== 'idle';

  const css = document.createElement('style');
  css.textContent = `
    .dp-bar{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(6px);z-index:2147483000;display:flex;align-items:center;gap:2px;padding:4px;
      background:rgba(15,27,51,.82);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);
      color:#fff;border-radius:999px;border:1px solid rgba(255,255,255,.14);box-shadow:0 10px 30px rgba(8,14,32,.45);
      font-size:12px;opacity:0;pointer-events:none;white-space:nowrap;
      transition:opacity 240ms cubic-bezier(.2,.7,.3,1),transform 240ms cubic-bezier(.2,.7,.3,1);font-family:${FONT_STACK};user-select:none}
    .dp-bar[data-visible]{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0)}
    .dp-bar[data-mode="show"][data-visible]{opacity:.88}
    .dp-bar button{appearance:none;background:transparent;border:0;color:rgba(255,255,255,.72);font:inherit;
      padding:5px 12px;border-radius:999px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;
      transition:background 160ms ease,color 160ms ease}
    .dp-bar button:hover{background:rgba(123,160,230,.18);color:#fff}
    .dp-bar button.nav{padding:5px 9px}
    .dp-bar button.nav svg{display:block}
    .dp-bar .pg{display:inline-flex;align-items:center;gap:3px;padding:5px 8px;border-radius:999px;cursor:pointer;
      font-variant-numeric:tabular-nums;color:rgba(255,255,255,.88)}
    .dp-bar .pg:hover{background:rgba(123,160,230,.18)}
    .dp-bar .pg .sep{color:rgba(255,255,255,.4);margin:0 1px}
    .dp-bar .pg .tot{color:rgba(255,255,255,.55)}
    .dp-bar .pg input{width:44px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.3);border-radius:6px;
      color:#fff;font:inherit;font-size:12px;padding:1px 4px;text-align:center;outline:none;transition:border-color 160ms ease}
    .dp-bar .pg input:focus{border-color:rgba(123,160,230,.65)}
    .dp-bar .divider{width:1px;height:16px;background:rgba(255,255,255,.22);margin:0 4px;flex:none}
    .dp-bar .kbd{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;
      font-family:ui-monospace,Menlo,monospace;font-size:10px;color:#7BA0E6;background:rgba(123,160,230,.14);border-radius:4px}
    .dp-bar[data-mode="show"] .browseonly{display:none}
    .dp-bar .showonly{display:none}
    .dp-bar[data-mode="show"] .showonly{display:inline-flex}
    deck-stage[noscale] ~ .dp-bar,deck-stage[noscale] ~ .dp-toast,deck-stage[noscale] ~ .dp-jumphint,deck-stage[noscale] ~ .dp-bubble,
    deck-stage[noscale] ~ .dp-read,deck-stage[noscale] ~ .dp-prog,deck-stage[noscale] ~ .dp-grid{display:none}
    :fullscreen .dp-bar{display:flex}
    .dp-black{position:fixed;inset:0;z-index:2147483400;background:#000;cursor:none}
    .dp-end{position:fixed;inset:0;z-index:2147483350;background:#000;display:flex;align-items:center;justify-content:center;
      color:rgba(255,255,255,.55);font-size:15px;letter-spacing:.3em;font-family:${FONT_STACK};cursor:default;
      animation:dpFade 400ms ease both}
    @keyframes dpFade{from{opacity:0}to{opacity:1}}
    @keyframes dpCardIn{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
    @keyframes dpRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes dpRiseCentered{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    .dp-help{position:fixed;inset:0;z-index:2147483500;background:rgba(8,14,32,.66);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
      display:flex;align-items:center;justify-content:center;padding:24px;font-family:${FONT_STACK}}
    .dp-help .card,.dp-card .card{position:relative;background:linear-gradient(165deg,#16233F,#0F1B33);color:#EAF0F8;
      border:1px solid rgba(123,160,230,.22);border-radius:16px;
      padding:26px 34px;min-width:420px;max-width:560px;box-shadow:0 24px 64px rgba(0,0,0,.55);
      animation:dpCardIn 200ms cubic-bezier(.2,.7,.3,1) both}
    /* 帮助层往宽里排，不往高里排。
       快捷键原先是一张单列长表，十三行叠起来约 780px，13 寸笔记本开着书签栏就得滚。
       改成翻页/放映/其他三栏并列，最高一栏只有六行，整卡稳定在 460px 上下，任何视口都不用滚。
       max-height 与 overflow 仍然保留，只作为极端矮窗（如横屏手机）的兜底，正常永不触发。 */
    .dp-help .card{width:min(1040px,100%);max-width:none;max-height:100%;overflow-y:auto;overscroll-behavior:contain}
    .dp-help .keys{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 30px;align-items:start}
    .dp-help .kgrp h4{margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.2em;
      color:rgba(123,160,230,.75);text-transform:uppercase}
    .dp-help .krow{display:flex;align-items:baseline;gap:12px;padding:5px 0}
    .dp-help .krow dt{flex:none;font-family:ui-monospace,Menlo,monospace;font-size:12px;
      color:#EAF0F8;background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.13);
      border-radius:5px;padding:2px 7px;white-space:nowrap}
    .dp-help .krow dd{margin:0;font-size:12.5px;line-height:1.5;color:rgba(255,255,255,.62)}
    .dp-help .foot-row{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;
      margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.12)}
    /* about 原本自带上边框与上间距，现在分隔线由 foot-row 提供，去掉重复 */
    .dp-help .foot-row .about{margin-top:0;padding-top:0;border-top:0}
    .dp-help .foot-row .btns{flex:none}
    /* 触屏：控制条按钮放大到 44px 见方，低于这个尺寸拇指点不准（Apple HIG 与 Material 同口径）。
       控制条本身常驻显示，触屏没有 hover，藏起来就再也找不到了。 */
    .dp-bar[data-touch]{bottom:14px;gap:4px;padding:6px}
    .dp-bar[data-touch] button{min-width:44px;min-height:44px}
    .dp-bar[data-touch] .pg{min-height:44px;display:inline-flex;align-items:center;padding:0 12px;font-size:15px}
    .dp-bar[data-touch]{opacity:1 !important;transform:translateX(-50%) !important}
    .dp-bar .touchonly{display:none}
    .dp-bar[data-touch] .touchonly{display:inline-flex}

    /* ── 手机竖屏阅读态 ────────────────────────────────────────────────
       16:9 的片子在 9:19 的屏上按宽铺满只占三成高，剩下七成原本是黑边。
       这七成交给本页逐字稿：上屏只放锚点的片子脱离讲者本就不自足，
       手机上多数打开发生在讲完之后，补的正是这个缺口。 */
    /* 底部空出控制条那条的高度。留在容器上而不是留在正文的 padding 上：
       后者只保护最后一段，滚到中段时文字照样从半透明的控制条底下流过去。
       空出来的这段由面板自己的底色托着，控制条落在实色上。 */
    .dp-read{position:fixed;left:0;right:0;bottom:0;z-index:2147482000;display:flex;flex-direction:column;
      padding-bottom:78px;box-sizing:border-box;
      background:#0B1220;color:#DCE4F2;font-family:${FONT_STACK};border-top:1px solid rgba(123,160,230,.20)}
    .dp-read .lab{flex:none;padding:12px 20px 2px;font-size:11px;letter-spacing:.18em;color:rgba(123,160,230,.72)}
    .dp-read .txt{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;
      padding:8px 20px 12px;font-size:16px;line-height:1.95}
    /* 滚动到底之前给一条渐隐，读者才知道下面还有 */
    .dp-read::after{content:"";position:absolute;left:0;right:0;bottom:78px;height:28px;pointer-events:none;
      background:linear-gradient(to bottom,rgba(11,18,32,0),#0B1220)}
    .dp-read .txt p{margin:0 0 1em}
    .dp-read .txt p:last-child{margin-bottom:0}

    /* 进度贴在画布下沿而非屏幕底部：读者的视线停在片子上，
       进度信息落在同一个视觉区域里才会被看见。 */
    .dp-prog{position:fixed;left:0;height:3px;z-index:2147482100;background:rgba(255,255,255,.13);pointer-events:none}
    .dp-prog i{display:block;height:100%;background:#4874CB;transition:width 220ms cubic-bezier(.2,.7,.3,1)}

    /* ── 缩略图总览 ──────────────────────────────────────────────────
       两列而不是三列：NN/g 的结论是缩略图必须大到能认出来，
       列表里的小图等于没有。 */
    .dp-grid{position:fixed;inset:0;z-index:2147483460;background:rgba(8,14,32,.94);
      backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);font-family:${FONT_STACK};
      display:flex;flex-direction:column;animation:dpFade 180ms ease both}
    .dp-grid .top{flex:none;display:flex;align-items:center;gap:12px;padding:14px 16px 10px;color:#fff}
    .dp-grid .top h3{margin:0;font-size:15px;font-weight:700;letter-spacing:.06em}
    .dp-grid .top .x{margin-left:auto;appearance:none;background:rgba(255,255,255,.08);border:0;color:rgba(255,255,255,.72);
      min-width:44px;min-height:44px;border-radius:999px;font-size:18px;cursor:pointer}
    .dp-grid .list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;
      display:grid;grid-template-columns:repeat(2,1fr);gap:14px;padding:4px 16px 24px}
    .dp-grid .cell{appearance:none;background:transparent;border:0;padding:0;cursor:pointer;text-align:left;color:inherit}
    .dp-grid .shot{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:#fff;border-radius:8px;
      border:2px solid transparent;box-shadow:0 4px 14px rgba(0,0,0,.35)}
    .dp-grid .cell[data-cur] .shot{border-color:#4874CB}
    .dp-grid .cap{margin-top:6px;font-size:12px;line-height:1.5;color:rgba(255,255,255,.62);
      overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .dp-grid .cell[data-cur] .cap{color:#fff}
    .dp-grid .pv-canvas{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center center;background:#fff}
    @media (min-width:560px){.dp-grid .list{grid-template-columns:repeat(3,1fr)}}
    @media (max-width:900px){
      .dp-help .keys{grid-template-columns:repeat(2,1fr)}
    }
    @media (max-width:620px){
      .dp-help .keys{grid-template-columns:1fr}
      .dp-help .foot-row{flex-direction:column;align-items:stretch}
    }
    .dp-help h3,.dp-card h3{margin:0 0 16px;font-size:16px;font-weight:700;color:#fff;letter-spacing:.06em}
    .dp-help table{border-collapse:collapse;font-size:13px;line-height:2}
    .dp-help td{padding:0 8px}
    .dp-help td:first-child{text-align:right;color:rgba(255,255,255,.55);font-family:ui-monospace,Menlo,monospace;white-space:nowrap}
    .dp-help tr.grp td{padding-top:10px;color:rgba(123,160,230,.55);font-size:12px;letter-spacing:.2em;text-align:left}
    .dp-help .tip,.dp-card .tip{margin-top:14px;font-size:12px;color:rgba(255,255,255,.45);line-height:1.8}
    .dp-help .about{margin-top:18px;padding-top:14px;border-top:1px solid rgba(255,255,255,.12);font-size:12px;line-height:2;color:rgba(255,255,255,.55)}
    .dp-help .about a{color:#7BA0E6;text-decoration:none}
    .dp-help .about a:hover{text-decoration:underline}
    .dp-help .a-ver{display:inline-block;padding:1px 8px;margin-left:6px;border-radius:999px;font-size:10px;background:rgba(123,160,230,.16);color:#7BA0E6}
    .dp-help .a-line.dim{color:rgba(255,255,255,.35)}
    .dp-help .x{position:absolute;right:14px;top:12px;appearance:none;background:transparent;border:0;color:rgba(255,255,255,.4);
      font-size:18px;line-height:1;cursor:pointer;padding:2px 6px}
    .dp-help .x:hover{color:#fff}
    .dp-card{position:fixed;inset:0;z-index:2147483450;background:rgba(8,14,32,.66);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
      display:flex;align-items:center;justify-content:center;font-family:${FONT_STACK}}
    .dp-card p{margin:0 0 18px;font-size:14px;line-height:1.9;color:rgba(255,255,255,.78)}
    .dp-card .btns,.dp-help .btns{display:flex;gap:10px;justify-content:flex-end}
    .dp-card .btns button,.dp-help .btns button{appearance:none;font:inherit;font-size:13px;padding:8px 18px;border-radius:8px;cursor:pointer;
      border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);color:#ddd}
    .dp-card .btns button:hover,.dp-help .btns button:hover{background:rgba(255,255,255,.14);color:#fff}
    .dp-card .btns button.pri{background:#4874CB;border-color:#4874CB;color:#fff;font-weight:600}
    .dp-card .btns button.pri:hover{background:#5A85D8;border-color:#5A85D8}
    .dp-toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:2147483600;display:flex;flex-direction:column;
      gap:8px;align-items:center;font-family:${FONT_STACK};pointer-events:none}
    .dp-toast .t{display:flex;align-items:flex-start;gap:12px;background:rgba(20,31,54,.94);color:#EAF0F8;font-size:13px;line-height:1.8;
      backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
      padding:10px 18px;border-radius:10px;border:1px solid rgba(123,160,230,.25);border-left:3px solid #4874CB;
      box-shadow:0 8px 24px rgba(8,14,32,.45);max-width:min(620px,84vw);pointer-events:auto;
      animation:dpRise 220ms cubic-bezier(.2,.7,.3,1) both}
    .dp-toast .t button{appearance:none;flex:none;background:transparent;border:0;color:rgba(255,255,255,.5);font-size:16px;
      line-height:1.4;cursor:pointer;padding:0 2px}
    .dp-toast .t button:hover{color:#fff}
    .dp-jumphint{position:fixed;left:50%;bottom:78px;transform:translateX(-50%);z-index:2147483200;background:rgba(15,27,51,.88);color:#fff;
      backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
      font-size:14px;font-variant-numeric:tabular-nums;padding:8px 18px;border-radius:8px;border:1px solid rgba(123,160,230,.3);
      font-family:${FONT_STACK}}
    .dp-bubble{position:fixed;left:50%;bottom:78px;transform:translateX(-50%);z-index:2147483100;background:rgba(15,27,51,.9);
      backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);animation:dpRiseCentered 220ms cubic-bezier(.2,.7,.3,1) both;
      color:#EAF0F8;font-size:13px;padding:8px 16px;border-radius:8px;border:1px solid rgba(123,160,230,.25);font-family:${FONT_STACK}}
    .dp-clicklayer{position:fixed;inset:0;z-index:2147483650;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:20px;letter-spacing:.12em;cursor:pointer;font-family:${FONT_STACK}}
    html.dp-nocursor,html.dp-nocursor *{cursor:none !important}
    @media (prefers-reduced-motion:reduce){.dp-bar,.dp-help .card,.dp-card .card,.dp-toast .t,.dp-bubble,.dp-end{transition:none !important;animation:none !important}}
    @media print{.dp-bar,.dp-black,.dp-help,.dp-card,.dp-toast,.dp-jumphint,.dp-bubble,.dp-end,.dp-clicklayer,
      .dp-read,.dp-prog,.dp-grid{display:none !important}}
  `;
  document.head.appendChild(css);

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
  const SVG_GRID = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
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
    <button class="browseonly" data-act="speaker" title="演讲者放映：双屏自动投片看讲稿；单屏／远程会议弹出选择（P）">演讲者放映<span class="kbd">P</span></button>
    <button class="showonly" data-act="black" title="黑屏 / 恢复（B）">黑屏<span class="kbd">B</span></button>
    <button class="showonly" data-act="fstoggle" title="切换到全屏放映（F）"><span class="fslab">全屏</span><span class="kbd">F</span></button>
    <button class="showonly" data-act="exit" title="退出放映（Esc）">退出放映<span class="kbd">Esc</span></button>
    <button class="touchonly" data-act="grid" title="缩略图总览" aria-label="缩略图总览">${SVG_GRID}</button>
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
    if (isFs()) return;
    pendingMode = presenting() ? showMode : 'show'; // 放映中升全屏不降级身份
    const de = document.documentElement;
    const fail = () => {
      pendingMode = null;
      if (presenting()) toast('未能进入全屏，仍为窗口放映');
    };
    try {
      // 受管双屏降窗后再升全屏：回到原观众屏，不盖讲稿屏
      const opts = (showMode === 'speaker' && slidesScreenRef) ? { screen: slidesScreenRef } : undefined;
      const p = (de.requestFullscreen || de.webkitRequestFullscreen || function () {}).call(de, opts);
      if (p && p.catch) p.catch(fail);
    } catch (e) { fail(); }
  }
  function exitFullscreenOnly() {
    try {
      (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
    } catch (e) {}
  }
  function toggleFullscreen() {
    if (isFs()) {
      keepPresentingOnFsExit = presenting(); // 主动降窗：保放映，onFsChange 按此定 reason
      exitFullscreenOnly();
    } else startFullscreenShow(false);
  }

  /* ── 光标自动隐藏（任意放映态——远程共享时观众看得到光标） ── */
  let cursorTimer = null;
  function cursorWake() {
    document.documentElement.classList.remove('dp-nocursor');
    clearTimeout(cursorTimer);
    if (presenting()) {
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
    exitShowCompletely(''); // 窗口放映态无全屏可退，必须走完整退出漏斗
  }
  const NEXT_KEYS = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
  const PREV_KEYS = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];

  /* ── 放映态出入口（唯一允许发 __omelette_presenting 的地方） ── */
  function updateFsBtn() {
    const fs = isFs();
    const lab = bar.querySelector('.fslab');
    if (lab) lab.textContent = fs ? '窗口' : '全屏';
    const tog = bar.querySelector('[data-act="fstoggle"]');
    if (tog) tog.title = fs ? '切换到窗口放映，适合在会议软件中共享本窗口（F）' : '切换到全屏放映（F）';
    // S4（双屏放映×全屏）下 Esc 实为退全屏而非退出放映，隐藏错误键帽
    const exitKbd = bar.querySelector('[data-act="exit"] .kbd');
    if (exitKbd) exitKbd.style.display = (fs && showMode === 'speaker') ? 'none' : '';
  }

  function setPresenting(on) {
    try { window.postMessage({ __omelette_presenting: on }, '*'); } catch (e) {}
    if (on) {
      // 标题标记：会议软件共享选择器里与“（演讲者视图）”正向区分
      document.title = baseTitle + '（放映窗口）';
      bar.setAttribute('data-mode', 'show');
      bar.removeAttribute('data-visible');
    } else {
      document.title = baseTitle;
      bar.removeAttribute('data-mode');
      flashBar();
    }
    updateFsBtn();
    cursorWake();
    setTimeout(positionBar, 80); // 等上游 rail 藏/显 reflow 后重定位
  }

  function enterShow(mode) {          // 唯一入场漏斗；幂等
    const was = presenting();
    showMode = mode;
    userExited = false;
    if (!was) setPresenting(true);
    else updateFsBtn();
    broadcastState(null);
  }

  function exitShowCompletely(elapsed) { // 唯一退出漏斗（Esc/退出按钮/结束屏/__deckp_exit）
    if (showMode === 'idle' && !isFs()) return; // 幂等守卫
    userExited = true;
    showMode = 'idle';
    pendingMode = null;
    if (isFs()) exitFullscreenOnly(); // 异步退全屏；onFsChange 见 idle 不再二次处理
    setPresenting(false);
    setBlackout(false);
    removeEndScreen();
    broadcastState('user-exit');
    if (elapsed) toast('放映已结束，共用时 ' + elapsed);
  }

  function maybeFsDownToast() {       // F 首次降窗的一次性引导（接住旧“F=退出”肌肉记忆）
    if (fsToastShown) return;
    fsToastShown = true;
    toast('已切换为窗口放映，放映未结束——再按 F 回全屏，退出请按 Esc');
  }

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

  function broadcastState(reason) {   // reason 是“本次消息的原因”，心跳/hello 回包恒传 null
    post(presenterWin, { __deckp_state: {
      mode: showMode,
      fs: isFs(),
      reason: reason || null,
      managed: !!slidesScreenRef,
      canSwap: showMode === 'speaker' && !!(screensCache && screensCache.screens.length > 1),
      slidesLabel: (slidesScreenRef && slidesScreenRef.label) || '',
      presenterLabel: (presenterScreenRef && presenterScreenRef.label) || ''
    } });
  }

  /* 演讲者窗口被手关：放映继续（speaker→solo 降级），不弹观众可见的提示 */
  setInterval(() => {
    if (presenterWin && presenterWin.closed) {
      presenterWin = null;
      if (showMode === 'speaker') { showMode = 'show'; updateFsBtn(); }
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
    enterShow('speaker'); // 主窗同手势进入窗口放映，不再停浏览态等用户按 F
    toast((prefix ? prefix + '。' : '') +
      '已打开演讲者视图，本窗口已进入窗口放映，翻页两窗自动同步。远程会议：在会议软件中共享本窗口。现场投屏：把本窗口拖到投屏屏幕，按 F 切到全屏。',
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
        <p>远程会议：选“演讲者视图＋窗口放映”，再在会议软件中共享本窗口——观众只看到干净画面，讲稿留在本机。<br>
        现场投屏为“镜像”（观众与你同画面）：直接全屏放映即可。<br>
        需要双屏演讲：在系统显示设置中改为“扩展”后重试。</p>
        <div class="btns">
          <button data-c="fs">直接全屏放映</button>
          <button data-c="pv" class="pri">演讲者视图＋窗口放映</button>
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
      else if (c === 'pv') { openPresenterWindow(null); enterShow('speaker'); }
    });
    document.body.appendChild(cardEl);
  }

  async function startSpeakerShow() {
    if (showMode === 'speaker' && presenterWin && !presenterWin.closed) {
      try { presenterWin.focus(); } catch (e) {}
      return;
    }
    // 放映中按 P（S1/S3 讲者窗不在）：静默开窗升 speaker，绝不弹选择卡曝光给共享观众
    if (presenting()) {
      openPresenterWindow(null);
      enterShow('speaker');
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
            // 拔屏是系统事件≠用户意图：退全屏、降窗口放映留放映，不走退出漏斗
            if (isFs()) exitFullscreenOnly();
            slidesScreenRef = null;
            presenterScreenRef = null;
            toast('屏幕连接已变化，已切换为窗口放映');
          }
          broadcastState(null);
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
    enterShow('speaker'); // onFsChange 已经由 pendingMode 先行入场，此处幂等补齐引用后再广播
    const w = openPresenterWindow(picked.presenterScreen);
    if (!w) {
      toast('演讲者窗口被拦截：请允许本文件弹出窗口，或按 P 重试', { sticky: true });
    }
    broadcastState(null);
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
    // 换屏中 fs 可能瞬时抖动（true→false→true）：swapping 抑制 'system' 误横幅；
    // commit/失败与 8s 超时双清（Plan B 用户放弃点击时的残留兜底）
    swapping = true;
    const swapTimer = setTimeout(() => { swapping = false; }, 8000);
    const done = () => { clearTimeout(swapTimer); swapping = false; };
    const commit = () => {
      slidesScreenRef = newSlides;
      presenterScreenRef = newPresenter;
      done();
      post(presenterWin, { __deckp_swap_done: { ok: true, vacated } });
      broadcastState(null);
    };
    try {
      await document.documentElement.requestFullscreen({ screen: newSlides });
      commit();
    } catch (e) {
      post(presenterWin, { __deckp_swap_pending: true });
      clickLayerFullscreen(newSlides, '点击此处完成屏幕交换', commit, () => {
        done();
        post(presenterWin, { __deckp_swap_done: { ok: false } });
        toast('屏幕交换未完成，请手动调整窗口位置');
      });
    }
  }

  /* ── 全屏状态联动（__omelette_presenting 已收敛进 setPresenting，此处只管状态迁移） ── */
  const onFsChange = () => {
    const fs = isFs();
    if (fs) {
      if (pendingMode) { const m = pendingMode; pendingMode = null; enterShow(m); }
      else enterShow(presenting() ? showMode : 'show'); // 外因全屏：保身份不降级
    } else {
      pendingMode = null;
      const keep = keepPresentingOnFsExit; keepPresentingOnFsExit = false;
      const reason = swapping ? 'swap' : (keep ? 'user-toggle' : 'system');
      if (showMode === 'speaker' && presenterWin && !presenterWin.closed) {
        // S4→S3：讲者窗活着=放映不死；黑屏/结束屏保留（放映未结束）
        updateFsBtn();
        if (keep) maybeFsDownToast();
        broadcastState(reason);
      } else if (presenting() && keep) {
        // S2→S1：F 主动降窗，solo 也保放映
        updateFsBtn();
        maybeFsDownToast();
        broadcastState(reason);
      } else if (presenting()) {
        exitShowCompletely(''); // solo Esc/系统退全屏：一步全退（维持 v2 心智）
      }
    }
    cursorWake();
    positionBar();
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
  let helpPrevFocus = null;
  function toggleHelp() {
    if (helpEl) {
      helpEl.remove(); helpEl = null;
      // 焦点还给打开前那个元素，否则关闭后焦点落到 body，键盘操作会断一拍
      try { if (helpPrevFocus && helpPrevFocus.focus) helpPrevFocus.focus({ preventScroll: true }); } catch (err) {}
      helpPrevFocus = null;
      return;
    }
    const wmOk = typeof window.getScreenDetails === 'function';
    helpEl = document.createElement('div');
    helpEl.className = 'dp-help export-hidden';
    helpEl.setAttribute('data-omelette-chrome', '');
    helpEl.innerHTML = `
      <div class="card" role="dialog" aria-modal="true" aria-label="快捷键与关于">
        <button class="x" data-close title="关闭（Esc）" aria-label="关闭">×</button>
        <h3>快捷键与关于</h3>
        <div class="keys">
          <div class="kgrp">
            <h4>翻页</h4>
            <dl class="krow"><dt>→ ↓ 空格 Enter</dt><dd>下一页</dd></dl>
            <dl class="krow"><dt>← ↑ Backspace</dt><dd>上一页</dd></dl>
            <dl class="krow"><dt>滚轮</dt><dd>上下翻页</dd></dl>
            <dl class="krow"><dt>数字 + Enter</dt><dd>跳到指定页</dd></dl>
            <dl class="krow"><dt>Home / End</dt><dd>首页 / 末页</dd></dl>
            <dl class="krow"><dt>R</dt><dd>回首页</dd></dl>
          </div>
          <div class="kgrp">
            <h4>放映</h4>
            <dl class="krow"><dt>F</dt><dd>全屏放映，放映中切窗口</dd></dl>
            <dl class="krow"><dt>Shift + F</dt><dd>从第 1 页放映</dd></dl>
            <dl class="krow"><dt>P</dt><dd>演讲者放映，双屏自动投片</dd></dl>
            <dl class="krow"><dt>X</dt><dd>交换两个屏幕</dd></dl>
            <dl class="krow"><dt>B</dt><dd>黑屏 / 恢复</dd></dl>
            <dl class="krow"><dt>Esc</dt><dd>退出放映</dd></dl>
          </div>
          <div class="kgrp">
            <h4>其他</h4>
            <dl class="krow"><dt>H 或 ?</dt><dd>本帮助</dd></dl>
            <dl class="krow"><dt>⌘P / Ctrl+P</dt><dd>导出 PDF，每页一片</dd></dl>
            <dl class="krow"><dt>F5</dt><dd>浏览器刷新，放映请用 F 或 P</dd></dl>
          </div>
        </div>
        <div class="tip">远程会议：按 P 选演讲者视图加窗口放映，在会议软件里共享那个放映窗，讲稿留在本机。首次按 P 会请求窗口管理权限，正式汇报前先试一次。若被拒，地址栏左侧 ⓘ → 网站设置 → 窗口管理 → 允许，然后刷新。${wmOk ? '' : '当前浏览器不支持自动双屏，建议换 Chrome 或 Edge，也可以按 P 后手动拖窗。'}</div>
        <div class="foot-row">
          <div class="about">
            <div class="a-name">咨询汇报 HTML 幻灯片播放器 <span class="a-ver">v${VERSION}</span></div>
            <div class="a-line">设计与实现 曾子轩 · <a href="https://zixuan.net" target="_blank" rel="noopener">zixuan.net</a></div>
            <div class="a-line">开源技能包 <a href="https://github.com/sinnohzeng/html-deck-skill" target="_blank" rel="noopener">github.com/sinnohzeng/html-deck-skill</a></div>
            <div class="a-line dim">播放内核 deck-stage（上游组件）· 放映增强 deck-presenter</div>
          </div>
          <div class="btns"><button data-hact="print">导出 PDF</button></div>
        </div>
      </div>
    `;
    helpEl.addEventListener('click', (e) => {
      const c = (sel) => e.target.closest && e.target.closest(sel);
      if (c('a')) return; // 关于区链接放行（file:// 下照常新标签打开）
      if (c('[data-hact="print"]')) {
        toggleHelp(); // 先收帮助层再唤起打印，避免帮助层被打印进 PDF
        setTimeout(() => { try { window.print(); } catch (err) { /* 无打印环境（无头）静默 */ } }, 80);
        return;
      }
      // 背景或 × 才关闭；卡片主体可自由点选复制，不误关
      if (e.target === helpEl || c('[data-close]')) toggleHelp();
    });
    // Tab 在弹层内循环，不让焦点跑到底下的幻灯片上去
    helpEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = helpEl.querySelectorAll('button, a[href]');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    });
    document.body.appendChild(helpEl);
    helpPrevFocus = document.activeElement;
    const closeBtn = helpEl.querySelector('[data-close]');
    if (closeBtn) closeBtn.focus({ preventScroll: true });
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
      if (presenterWin !== e.source) userExited = false; // 换源=新窗口新意图（防护面见头注释）
      presenterWin = e.source;
      // 电平入场：讲者窗活着 ⇒ 主窗应在放映（窗口放映起步）；明确退出后不再回拉
      if ((!presenting() && !userExited) || (presenting() && showMode !== 'speaker')) {
        enterShow('speaker');
      }
      post(presenterWin, { __deckp_sync: { index: stage.index } });
      if (blackCover) post(presenterWin, { __deckp_blackout: true });
      broadcastState(null);
    }
    if (d.__deckp_sync && typeof d.__deckp_sync.index === 'number') {
      if (e.source && e.source !== window) presenterWin = e.source;
      if (d.__deckp_sync.index !== stage.index) stage.goTo(d.__deckp_sync.index);
    }
    if (typeof d.__deckp_blackout === 'boolean') setBlackout(d.__deckp_blackout);
    if (d.__deckp_swap === true) handleSwap();
    if (d.__deckp_exit) exitShowCompletely((d.__deckp_exit && d.__deckp_exit.elapsed) || '');
    if (d.__deckp_bye === 'presenter') {
      presenterWin = null;
      if (showMode === 'speaker') { showMode = 'show'; updateFsBtn(); } // 放映不断，降 solo
    }
    if (d.__deckp_represent === true) {
      // 免手势硬保底：先恢复窗口放映（postMessage 即生效，零点击层）
      enterShow('speaker');
      if (slidesScreenRef) {
        // 受管双屏：继续尝试恢复全屏到原观众屏
        pendingMode = 'speaker';
        const de = document.documentElement;
        try {
          const p = de.requestFullscreen({ screen: slidesScreenRef });
          if (p && p.catch) p.catch(() => {
            pendingMode = null;
            clickLayerFullscreen(slidesScreenRef, '点击此处恢复全屏放映', () => { broadcastState(null); }, () => {});
          });
        } catch (err) { pendingMode = null; }
      } else {
        toast('已恢复窗口放映；如需全屏请按 F');
      }
    }
  });

  bar.addEventListener('click', (e) => {
    const act = e.target.closest && e.target.closest('[data-act]');
    if (!act) return;
    const a = act.getAttribute('data-act');
    if (a === 'prev') stage.prev();
    else if (a === 'next') {
      if (presenting() && stage.index === stage.length - 1) showEndScreen();
      else stage.next();
    }
    else if (a === 'home') stage.goTo(0);
    else if (a === 'show') startFullscreenShow(e.shiftKey);
    else if (a === 'speaker') startSpeakerShow();
    else if (a === 'black') setBlackout(!blackCover);
    else if (a === 'fstoggle') toggleFullscreen();
    else if (a === 'exit') exitShowCompletely('');
    else if (a === 'help') toggleHelp();
    else if (a === 'grid') toggleGrid();
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
    if (isTypingTarget(e.target)) return;
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
    if (isTypingTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!presenting()) return; // 结束屏在任意放映态（含窗口放映）生效
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
    if (isTypingTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (blackCover && (k !== 'b' && k !== 'B' && k !== 'Escape')) { setBlackout(false); }
    if (k === 'Escape') {
      if (gridEl) { closeGrid(); e.preventDefault(); return; }
      if (helpEl) { toggleHelp(); e.preventDefault(); return; }
      if (cardEl) { closeCard(); e.preventDefault(); return; }
      if (presenting() && !isFs()) { e.preventDefault(); exitShowCompletely(''); return; } // 窗口放映：Esc=退出（含黑屏中）
      return; // 全屏退出交给浏览器原生行为（onFsChange 决定降级/退出）
    }
    let handled = true;
    if (k === 'ArrowDown' || k === 'Enter') stage.next();
    else if (k === 'ArrowUp' || k === 'Backspace') stage.prev();
    else if (k === 'f' || k === 'F') {
      if (e.shiftKey && !isFs()) startFullscreenShow(true);
      else if (!presenting() && !isFs()) startFullscreenShow(false);
      else toggleFullscreen(); // 放映中：全屏⇄窗口切换
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

  /* ── 滚轮翻页：累积阈值 + 冷却；末页前进在放映态出结束页 ──
   * 骨架与演讲者窗另有一份镜像（阈值 50 / 冷却 450ms），改动请两处同步；
   * 两份 ignore 路径语义不同（此处让行 rail/ctxmenu，讲者窗让行逐字稿/网格），不抽象。 */
  let wheelAcc = 0, wheelCool = 0;
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return; // 捏合缩放
    if (modalOpen()) return; // 弹层开着时滚轮归弹层，不许翻片
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
      if (endEl) { fwd ? finishEndScreen() : removeEndScreen(); return; }
      if (fwd && presenting() && stage.index === stage.length - 1) { showEndScreen(); return; }
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
  /* 触屏设备：放映、演讲者放映、黑屏这些是上台用的，手机上只有翻阅需求，按钮全收起来，
     控制条只留上一页、页码、下一页、帮助。判据用指针粗细，不用屏幕宽度，
     因为把桌面窗口拖窄的人仍然可能要放映。 */
  const isTouchOnly = typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches;
  if (isTouchOnly) {
    bar.setAttribute('data-touch', '');
    ['home', 'show', 'speaker', 'black', 'fstoggle', 'exit'].forEach((a) => {
      const b = bar.querySelector(`[data-act="${a}"]`);
      if (b) b.remove();
    });
    // 缩略图栏内核按 ≤640px 隐藏，iPad 竖屏是 834 点会漏出来。
    // 判据统一换成指针粗细，与上面收起上台按钮同口径。
    stage.setAttribute('no-rail', '');
  }

  /* ════════════════════════════════════════════════════════════════
   * 手机端查看形态（规约 specs/mobile-viewing/spec.md）
   *
   * 竖屏＝阅读态：片子贴顶按宽铺满，下方补本页逐字稿。
   * 横屏＝观看态：片子铺满，逐字稿收起。
   * 两态之间靠视口比例自动切换，不设按钮：requestFullscreen 在 iPhone
   * 上没有实现，ScreenOrientation.lock 在 Safari 全系不支持，凡是要向
   * 平台申请才生效的能力都不能放在主路径上。
   * ════════════════════════════════════════════════════════════════ */
  const mSections = Array.from(stage.children).filter((el) =>
    !/^(TEMPLATE|SCRIPT|STYLE)$/.test(el.tagName));
  const mNotes = readNotes(mSections);
  const hasAnyNote = mNotes.some((n) => String(n).trim());

  let readEl = null, readTxt = null, readLab = null, progEl = null, progBar = null, gridEl = null;
  let fitBox = null;   // 最近一次 deckfit 广播的画布几何

  const isPortrait = () => window.innerHeight > window.innerWidth;
  const noteOf = (i) => String(mNotes[i] || '').trim();
  /* 阅读态成立的三个条件缺一不可：触屏、竖持、本页确实有话可讲。
     最后一条是逐页判定的，没有逐字稿的页不能留一块空面板。 */
  const readingNow = () => isTouchOnly && hasAnyNote && isPortrait() &&
    !presenting() && !!noteOf(stage.index);

  function ensureRead() {
    if (readEl) return;
    readEl = document.createElement('div');
    readEl.className = 'dp-read export-hidden';
    readEl.setAttribute('data-omelette-chrome', '');
    readEl.innerHTML = '<div class="lab"></div><div class="txt"></div>';
    readLab = readEl.querySelector('.lab');
    readTxt = readEl.querySelector('.txt');
    document.body.appendChild(readEl);
  }

  function ensureProg() {
    if (progEl) return;
    progEl = document.createElement('div');
    progEl.className = 'dp-prog export-hidden';
    progEl.setAttribute('data-omelette-chrome', '');
    progEl.innerHTML = '<i></i>';
    progBar = progEl.querySelector('i');
    document.body.appendChild(progEl);
  }

  function fillRead() {
    if (!readEl) return;
    const i = stage.index;
    readLab.textContent = slideLabel(mSections[i], i);
    readTxt.textContent = '';
    noteOf(i).split(/\n{2,}/).forEach((seg) => {
      const t = seg.trim();
      if (!t) return;
      const p = document.createElement('p');
      p.textContent = t;
      readTxt.appendChild(p);
    });
    readTxt.scrollTop = 0;
  }

  /* 唯一的形态入口。resize、orientationchange、翻页、deckfit 全部汇到这里，
     避免几路各自改一半 DOM 造成中间态。 */
  /* setAttribute 即使值没变也会触发 attributeChangedCallback，内核在那里重跑
     _fit()，_fit() 又派发 deckfit 把这里叫醒，于是自己咬自己的尾巴把栈爆掉。
     所以属性只在状态真的翻转时才动。 */
  function setStageFlag(name, on) {
    if (on === stage.hasAttribute(name)) return;
    on ? stage.setAttribute(name, '') : stage.removeAttribute(name);
  }

  function applyMobileLayout() {
    if (!isTouchOnly) return;
    const reading = readingNow();
    if (reading) {
      setStageFlag('dock-top', true);
      ensureRead();
      fillRead();
      readEl.style.display = '';
      readEl.style.top = (fitBox ? Math.round(fitBox.top + fitBox.height) : 0) + 'px';
    } else {
      setStageFlag('dock-top', false);
      if (readEl) readEl.style.display = 'none';
    }
    ensureProg();
    const total = stage.length || mSections.length || 1;
    progBar.style.width = ((stage.index + 1) / total * 100) + '%';
    if (fitBox && fitBox.width > 0) {
      progEl.style.left = Math.round(fitBox.left) + 'px';
      progEl.style.width = Math.round(fitBox.width) + 'px';
      progEl.style.top = Math.round(fitBox.top + fitBox.height - 3) + 'px';
      progEl.style.display = '';
    } else {
      progEl.style.display = 'none';
    }
  }

  if (isTouchOnly) {
    // 内核解析完就会 fit 一次，那时本文件还没执行，第一发 deckfit 是收不到的。
    // 所以先向内核取一次最近几何做种，否则首屏没有进度条也定不了面板位置。
    fitBox = stage.fitBox;
    stage.addEventListener('deckfit', (e) => { fitBox = e.detail; applyMobileLayout(); });
    stage.addEventListener('slidechange', applyMobileLayout);
    window.addEventListener('resize', applyMobileLayout);
    // iOS 转屏后 innerWidth/innerHeight 有一帧仍是旧值，等一拍再算。
    window.addEventListener('orientationchange', () => setTimeout(applyMobileLayout, 120));
    applyMobileLayout();
  }

  /* ── 滑动翻页 ──────────────────────────────────────────────────
     滑动是手机上的第一直觉，也是控制条按钮的替代品。判定要同时满足
     位移够长与方向够横，否则读逐字稿时的斜向滚动会被误判成翻页。 */
  if (isTouchOnly) {
    const SWIPE_MIN = 48, SWIPE_RATIO = 1.5;
    let sx = 0, sy = 0, tracking = false;
    window.addEventListener('touchstart', (e) => {
      tracking = false;
      if (e.touches.length !== 1) return;
      if (modalOpen() || gridEl) return;
      const t = e.target;
      // 逐字稿面板与总览里归纵向滚动，手势不参与翻页。
      if (t && t.closest && t.closest('.dp-read, .dp-grid, .dp-bar')) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });
    window.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
      const fwd = dx < 0;
      const atEdge = fwd ? stage.index === stage.length - 1 : stage.index === 0;
      if (atEdge) { bounce(fwd); return; }
      fwd ? stage.next() : stage.prev();
    }, { passive: true });
  }

  /* 到边不静默：给画布一次很短的位移，读者立刻知道是到头了而不是没滑动。 */
  let bounceTimer = null;
  function bounce(fwd) {
    const el = stage.shadowRoot && stage.shadowRoot.querySelector('.stage');
    if (!el) return;
    clearTimeout(bounceTimer);
    el.style.transition = 'transform 140ms ease-out';
    el.style.transform = `translateX(${fwd ? -14 : 14}px)`;
    bounceTimer = setTimeout(() => {
      el.style.transform = 'translateX(0)';
      bounceTimer = setTimeout(() => { el.style.transition = ''; el.style.transform = ''; }, 160);
    }, 140);
  }

  /* ── 缩略图总览 ────────────────────────────────────────────────
     手机上没有缩略图栏，页码输入又要求读者预先知道“第 17 页是什么”。
     总览把这件事翻过来：先看见，再跳。 */
  function toggleGrid() { gridEl ? closeGrid() : openGrid(); }

  function closeGrid() {
    if (!gridEl) return;
    gridEl.remove();
    gridEl = null;
  }

  function openGrid() {
    if (gridEl) return;
    if (helpEl) toggleHelp();
    gridEl = document.createElement('div');
    gridEl.className = 'dp-grid export-hidden';
    gridEl.setAttribute('data-omelette-chrome', '');
    gridEl.setAttribute('role', 'dialog');
    gridEl.setAttribute('aria-modal', 'true');
    gridEl.innerHTML = '<div class="top"><h3>全部 ' + mSections.length +
      ' 页</h3><button class="x" aria-label="关闭总览">×</button></div><div class="list"></div>';
    const list = gridEl.querySelector('.list');
    mSections.forEach((sec, i) => {
      const cell = document.createElement('button');
      cell.className = 'cell';
      if (i === stage.index) cell.setAttribute('data-cur', '');
      const shot = document.createElement('div');
      shot.className = 'shot';
      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = slideLabel(sec, i);
      cell.appendChild(shot);
      cell.appendChild(cap);
      cell.addEventListener('click', () => { stage.goTo(i); closeGrid(); });
      list.appendChild(cell);
    });
    gridEl.querySelector('.x').addEventListener('click', closeGrid);
    gridEl.addEventListener('click', (e) => { if (e.target === gridEl) closeGrid(); });
    document.body.appendChild(gridEl);
    // 克隆渲染放到挂载之后：fitPreview 要量 .shot 的实际尺寸，
    // 挂载前量到的是 0，缩略图会全部塌成一个点。
    Array.from(list.children).forEach((cell, i) => {
      renderPreview(cell.querySelector('.shot'), mSections[i]);
    });
    const cur = list.children[stage.index];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'center' });
    gridEl.querySelector('.x').focus();
  }

  (function firstRunIntro() {
    let seen = null;
    try { seen = localStorage.getItem('deck-presenter.introShown'); } catch (e) {}
    if (seen) return;
    if (isTouchOnly) return; // 触屏没有快捷键，别提示按 H
    try { localStorage.setItem('deck-presenter.introShown', '1'); } catch (e) {}
    barPin++;
    bar.setAttribute('data-visible', '');
    const bubble = document.createElement('div');
    bubble.className = 'dp-bubble export-hidden';
    bubble.setAttribute('data-omelette-chrome', '');
    bubble.textContent = '按 H 查看快捷键与关于';
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
    getState: () => ({ mode: showMode, fs: isFs(), userExited }),
    version: VERSION
  };
})();
