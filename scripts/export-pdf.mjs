#!/usr/bin/env node
/* ============================================================================
 * export-pdf.mjs — 幻灯片 PDF 导出（纯片 16:9 ＋ 逐字稿二合一 handout）
 * ----------------------------------------------------------------------------
 * 用法：
 *   node scripts/export-pdf.mjs <deck.html> [选项]
 *     --slides           只导出纯幻灯片 PDF（297mm×167.0625mm 全幅 16:9 矢量）
 *     --handout          只导出二合一 handout（A4 横版：上幻灯片 + 下逐字稿）
 *                        （两个都不给 = 两种都导）
 *     --rp <id>          按 <section data-rp="id"> 过滤分报告子集
 *     --out <dir>        输出目录（默认 = deck 所在目录）
 *     --author <name>    PDF Author 元数据（默认 BRAND.author）
 *     --date <YYYYMMDD>  文件名日期（默认 = 当天）
 *     --keep-temp        保留中间静态 HTML 并打印路径（排障用）
 *
 * 原理（沉淀自 71 页实战 deck 的导出管线）：
 *   不打印“活的”交互 deck —— 用 DOMParser 抽取 <section> 与 <style> 重建
 *   静态流式文档（每片 position:relative + break-after:page），Chromium 打印。
 *   页面尺寸由 CSS @page 驱动（preferCSSPageSize），渲染稳定三连：
 *   networkidle → emulateMedia(print) → document.fonts.ready。
 *
 * 硬闸（任一失败 exit 1）：
 *   · handout 逐字稿条数 ≠ 页数（#speaker-notes 数组与 <section> 数不一致）
 *   · 逐字稿三段自适应（缩字号→dense→双栏）后仍溢出
 *   · 产出 PDF 页数 ≠ 期望页数，或页面尺寸漂移超容差
 * ============================================================================ */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

/* ── 品牌常量（公开仓移植时唯一需检视的块；交付面品牌一律用公开名） ── */
const BRAND = {
  author: '曾子轩 (Zixuan Zeng)',
  creator: 'html-deck-skill · export-pdf.mjs',
  emptyNotes: '（本页无逐字稿）',
};

/* ── 几何（实证数字，勿动）：
 *  纯片页 297mm 宽（A4 横版宽）@96dpi = 1122.52px，1920px 片 → scale 0.58465，
 *  高 1080×0.58465px = 167.0625mm ⇒ 841.89×473.53pt 全幅 16:9 无 letterbox。
 *  handout 片框 186mm = 703.0px → scale 0.36614，高 104.625mm；页 A4 横版。 ── */
const GEO = {
  slides: { pageCss: '297mm 167.0625mm', scale: 0.58465, ptW: 841.89, ptH: 473.53 },
  handout: { pageCss: 'A4 landscape', frameW: '186mm', frameH: '104.625mm', scale: 0.36614, ptW: 841.89, ptH: 595.28 },
  tolerancePt: 2,
};

/* ────────────────────────── CLI ────────────────────────── */

function usageAndExit(msg) {
  if (msg) console.error(`✗ ${msg}\n`);
  console.error('用法：node scripts/export-pdf.mjs <deck.html> [--slides] [--handout] [--rp <id>] [--out <dir>] [--author <name>] [--date <YYYYMMDD>] [--keep-temp]');
  process.exit(1);
}

function parseArgs(argv) {
  const args = { deck: null, slides: false, handout: false, rp: null, out: null, author: null, date: null, keepTemp: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    // 带值选项统一取值：缺失/空串/像另一个 flag 都拒绝，防止把 --slides 吞成取值静默出错
    const takeValue = () => {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) usageAndExit(`${a} 缺少取值`);
      i += 1;
      return v;
    };
    if (a === '--slides') args.slides = true;
    else if (a === '--handout') args.handout = true;
    else if (a === '--rp') args.rp = takeValue();
    else if (a === '--out') args.out = takeValue();
    else if (a === '--author') args.author = takeValue();
    else if (a === '--date') args.date = takeValue();
    else if (a === '--keep-temp') args.keepTemp = true;
    else if (a.startsWith('--')) usageAndExit(`未知选项 ${a}`);
    else if (!args.deck) args.deck = a;
    else usageAndExit(`多余参数 ${a}`);
  }
  if (!args.deck) usageAndExit('缺少 deck.html 路径');
  if (!args.slides && !args.handout) { args.slides = true; args.handout = true; }
  if (args.date && !/^\d{8}$/.test(args.date)) usageAndExit('--date 需为 YYYYMMDD 8 位数字');
  return args;
}

/* ────────────────────────── 小工具 ────────────────────────── */

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/* 逐字稿纯文本 → HTML：\n\n 分段，段内 \n 转 <br> */
function notesToHtml(text) {
  return String(text)
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function ymdToCn(ymd) {
  return `${ymd.slice(0, 4)} 年 ${Number(ymd.slice(4, 6))} 月 ${Number(ymd.slice(6, 8))} 日`;
}

function fmtBytes(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

/* ────────────────────────── 抽取 ──────────────────────────
 * 在已启动的 Chromium 里用 DOMParser 解析（不执行任何脚本，section 纯净、
 * 属性精确读取），比正则法健壮：属性顺序/引号/嵌套标签全不敏感。 */

async function extractDeck(browser, deckPath) {
  const html = fs.readFileSync(deckPath, 'utf8');
  const page = await browser.newPage();
  try {
    return await page.evaluate((src) => {
      const doc = new DOMParser().parseFromString(src, 'text/html');
      const styles = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n\n');
      const title = (doc.querySelector('title')?.textContent || '').trim();
      let notesArr = null;
      const tag = doc.getElementById('speaker-notes');
      if (tag) {
        try {
          const parsed = JSON.parse(tag.textContent || '[]');
          if (Array.isArray(parsed)) notesArr = parsed;
        } catch { /* 保持 null，主流程按缺失处理 */ }
      }
      // 页收集规则镜像运行时（deck-presenter/deck-stage）：deck-stage 的任意元素子节点
      // 都是一页（TEMPLATE/SCRIPT/STYLE 除外），不限 <section>——避免导出静默丢页。
      const stage = doc.querySelector('deck-stage');
      const slides = [...(stage ? stage.children : [])]
        .filter((el) => !/^(TEMPLATE|SCRIPT|STYLE)$/.test(el.tagName))
        .map((sec, i) => {
          const attr = sec.getAttribute('data-speaker-notes'); // 与 deck-presenter.readNotes 同优先级：属性覆写数组
          return {
            html: sec.outerHTML,
            label: sec.getAttribute('data-label') || '',
            rp: sec.getAttribute('data-rp') || null,
            skip: sec.hasAttribute('data-deck-skip'),
            hasNote: attr !== null || !!(notesArr && typeof notesArr[i] === 'string'),
            note: attr !== null ? attr : (notesArr && typeof notesArr[i] === 'string' ? notesArr[i] : ''),
          };
        });
      return { styles, title, slides, notesCount: notesArr ? notesArr.length : null };
    }, html);
  } finally {
    await page.close();
  }
}

/* ────────────────────────── 文档组装 ────────────────────────── */

/* 两族共用的 section 归位块：把绝对定位的片强制回文档流（belt-and-braces） */
const SECTION_NORMALIZE = `
  .sl-scale > *, .ho-scale > * {
    position: relative !important; inset: auto !important;
    width: 1920px !important; height: 1080px !important;
    display: block !important; opacity: 1 !important; visibility: visible !important;
    pointer-events: none !important; overflow: hidden !important; box-sizing: border-box !important;
  }`;

const PRINT_BASE = `
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; overflow: visible !important; }`;

function docShell({ title, baseHref, styles, familyCss, body }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${baseHref}">
<title>${escapeHtml(title)}</title>
<style>
${styles}
</style>
<style>
${PRINT_BASE}
${SECTION_NORMALIZE}
${familyCss}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function buildSlidesHtml({ title, baseHref, styles, slides }) {
  const familyCss = `
  @page { size: ${GEO.slides.pageCss}; margin: 0; }
  html, body { width: 297mm !important; }
  .sl-page {
    width: 297mm; height: 167.0625mm;
    overflow: hidden; background: #fff; position: relative;
    break-after: page; page-break-after: always;
  }
  .sl-page:last-child { break-after: auto; page-break-after: auto; }
  .sl-scale { width: 1920px; height: 1080px; transform: scale(${GEO.slides.scale}); transform-origin: top left; overflow: hidden; }
  @media screen {
    body { background: #e5e7eb !important; }
    .sl-page { margin: 12px auto; box-shadow: 0 12px 40px rgba(15, 23, 42, .16); }
  }`;
  const body = slides.map((s, i) => `
    <article class="sl-page" data-page="${i + 1}">
      <div class="sl-scale">${s.html}</div>
    </article>`).join('\n');
  return docShell({ title: `${title}（幻灯片）`, baseHref, styles, familyCss, body });
}

function buildHandoutHtml({ title, baseHref, styles, slides, dateCn, rp }) {
  const total = slides.length;
  const rpBadge = rp ? `<span class="ho-badge">${escapeHtml(rp.toUpperCase())}</span>` : '';
  const familyCss = `
  @page { size: ${GEO.handout.pageCss}; margin: 0; }
  html, body { width: 297mm !important; }
  .ho-page {
    width: 297mm; height: 210mm; box-sizing: border-box;
    padding: 9mm 12mm; display: flex; flex-direction: column;
    background: #fff; overflow: hidden;
    break-after: page; page-break-after: always;
    font-family: var(--ff-sans, "Alibaba PuHuiTi 3.0", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif);
  }
  .ho-page:last-child { break-after: auto; page-break-after: auto; }
  .ho-head {
    flex: none; display: flex; justify-content: space-between; align-items: baseline;
    padding-bottom: 2mm; margin-bottom: 3.5mm; border-bottom: 0.3mm solid var(--line, #D7E0EE);
    font-size: 9pt; line-height: 1.2;
  }
  .ho-head-title { font-weight: 700; color: var(--navy-2, #14233D); }
  .ho-head-date { color: var(--muted, #566479); }
  .ho-frame {
    flex: none; width: ${GEO.handout.frameW}; height: ${GEO.handout.frameH};
    margin: 0 auto 3.5mm; overflow: hidden; background: #fff;
    border: 0.25mm solid var(--line, #D7E0EE); box-sizing: content-box;
  }
  .ho-scale { width: 1920px; height: 1080px; transform: scale(${GEO.handout.scale}); transform-origin: top left; overflow: hidden; }
  .ho-notes-h {
    flex: none; display: flex; align-items: baseline; margin-bottom: 2mm;
    padding-left: 2.4mm; border-left: 0.8mm solid var(--teal, #4874CB);
    font-size: 9pt; font-weight: 700; color: var(--navy-2, #14233D); line-height: 1.2;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ho-notes {
    flex: 1; min-height: 0; overflow: hidden;
    font-size: 14pt; line-height: 1.55; color: var(--navy-2, #14233D); text-align: left;
  }
  .ho-notes.dense { font-size: 11pt; line-height: 1.45; }
  .ho-notes.cols2 { column-count: 2; column-gap: 7mm; column-fill: balance; }
  .ho-notes p { break-inside: avoid; margin: 0 0 1.2mm; padding: 0; }
  .ho-notes p:last-child { margin-bottom: 0; }
  .ho-notes .ho-empty { color: var(--muted, #566479); }
  .ho-foot {
    flex: none; display: flex; justify-content: space-between; align-items: center;
    margin-top: auto; padding-top: 1.6mm; border-top: 0.2mm solid var(--line-2, #EAF0F8);
    font-size: 8.5pt; color: var(--muted, #566479); line-height: 1.2;
  }
  .ho-badge {
    display: inline-block; padding: 0.4mm 2mm; border-radius: 2mm;
    background: var(--paper-2, #EEF3FB); color: var(--teal, #4874CB); font-weight: 700;
  }
  @media screen {
    body { background: #e5e7eb !important; }
    .ho-page { margin: 12px auto; box-shadow: 0 12px 40px rgba(15, 23, 42, .16); }
  }`;
  const body = slides.map((s, i) => {
    const heading = `第 ${i + 1} 页${s.label ? ` · ${escapeHtml(s.label)}` : ''}`;
    const notesHtml = s.note.trim()
      ? notesToHtml(s.note)
      : `<p class="ho-empty">${escapeHtml(BRAND.emptyNotes)}</p>`;
    return `
    <article class="ho-page" data-page="${i + 1}">
      <header class="ho-head">
        <div class="ho-head-title">${escapeHtml(title)}</div>
        <div class="ho-head-date">${escapeHtml(dateCn)}</div>
      </header>
      <div class="ho-frame"><div class="ho-scale">${s.html}</div></div>
      <div class="ho-notes-h">${heading}</div>
      <div class="ho-notes">${notesHtml}</div>
      <footer class="ho-foot">
        <div>${rpBadge}</div>
        <div>第 ${i + 1} 页 / 共 ${total} 页</div>
      </footer>
    </article>`;
  }).join('\n');
  return docShell({ title: `${title}（幻灯片和逐字稿）`, baseHref, styles, familyCss, body });
}

/* ────────────────────────── 逐字稿自适应 ──────────────────────────
 * 三段梯子：缩字号（0.5px 步进，下限 12px）→ .dense → .cols2 双栏（下限 9.5px）。
 * 双栏用更低下限：固定高度多栏溢出会横向流入被裁切的额外栏，必须压进两栏内。 */

async function fitNotes(page) {
  return page.evaluate(() => {
    const failures = [];
    const hasOverflow = (el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    const stats = { dense: 0, cols2: 0 };
    for (const pageEl of document.querySelectorAll('.ho-page')) {
      const body = pageEl.querySelector('.ho-notes');
      let size = Number.parseFloat(getComputedStyle(body).fontSize);
      const shrink = (min) => {
        while (hasOverflow(body) && size > min) { size -= 0.5; body.style.fontSize = `${size}px`; }
      };
      shrink(12);
      if (hasOverflow(body)) {
        body.classList.add('dense');
        stats.dense += 1;
        size = Number.parseFloat(getComputedStyle(body).fontSize);
        shrink(12);
      }
      if (hasOverflow(body)) {
        body.classList.add('cols2');
        stats.cols2 += 1;
        body.style.fontSize = '';
        size = Number.parseFloat(getComputedStyle(body).fontSize);
        shrink(9.5);
      }
      if (hasOverflow(body)) failures.push(Number(pageEl.getAttribute('data-page')));
    }
    return { failures, stats };
  });
}

/* ────────────────────────── 校验 + 元数据 ──────────────────────────
 * 主链 pdf-lib：页数/首页尺寸校验 + Title/Author/Subject/Creator 元数据。
 * 降级链：pdf-lib 缺失 → pdfinfo 只校验；再缺失 → 告警跳过。 */

async function finalizePdf(outPdf, { title, deckBase, expectedPages, ptW, ptH, author }) {
  let PDFDocument = null;
  try { ({ PDFDocument } = await import('pdf-lib')); } catch { /* 走降级链 */ }

  if (!PDFDocument) {
    try {
      const info = execFileSync('pdfinfo', [outPdf], { encoding: 'utf8' });
      const pages = Number((info.match(/^Pages:\s+(\d+)/m) || [])[1]);
      const [, w, h] = info.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m) || [];
      if (pages !== expectedPages) throw new Error(`页数 ${pages} ≠ 期望 ${expectedPages}`);
      if (Math.abs(Number(w) - ptW) > GEO.tolerancePt || Math.abs(Number(h) - ptH) > GEO.tolerancePt) {
        throw new Error(`页面尺寸 ${w}×${h}pt 漂移超容差（期望 ${ptW}×${ptH}pt）`);
      }
      console.warn('  ~ pdf-lib 未安装（scripts/ 下 npm i 可补），已用 pdfinfo 校验；PDF 元数据未写入');
      return { pages, w: Number(w), h: Number(h) };
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.warn('  ~ pdf-lib 与 pdfinfo 均不可用，跳过页数/尺寸校验与元数据写入');
        return null;
      }
      throw err;
    }
  }

  const doc = await PDFDocument.load(fs.readFileSync(outPdf), { updateMetadata: false });
  const pages = doc.getPageCount();
  if (pages !== expectedPages) throw new Error(`页数 ${pages} ≠ 期望 ${expectedPages}（分页断裂？用 --keep-temp 查看中间 HTML）`);
  const { width, height } = doc.getPage(0).getSize();
  if (Math.abs(width - ptW) > GEO.tolerancePt || Math.abs(height - ptH) > GEO.tolerancePt) {
    throw new Error(`页面尺寸 ${width.toFixed(1)}×${height.toFixed(1)}pt 漂移超容差（期望 ${ptW}×${ptH}pt）`);
  }
  doc.setTitle(title);
  doc.setAuthor(author);
  doc.setSubject(deckBase);
  doc.setCreator(BRAND.creator);
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  fs.writeFileSync(outPdf, await doc.save());
  return { pages, w: width, h: height };
}

/* ────────────────────────── 渲染管线 ────────────────────────── */

async function renderFamily(browser, { html, tmpHtml, outPdf, isHandout }) {
  fs.writeFileSync(tmpHtml, html);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1131 }, deviceScaleFactor: 1 });
  try {
    await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    // fonts.ready 在 file:// 下正常也会 resolve，但包 15s race 保证管线永不挂死
    await Promise.race([
      page.evaluate(() => document.fonts && document.fonts.ready),
      new Promise((resolve) => setTimeout(resolve, 15000)),
    ]).catch(() => console.warn('  ~ 字体就绪等待超时，继续导出'));
    await page.waitForTimeout(200);

    let fit = { failures: [], stats: { dense: 0, cols2: 0 } };
    if (isHandout) {
      fit = await fitNotes(page);
      // 硬闸前置：溢出即抛，绝不落盘残缺 PDF（防覆盖同名好版本）
      if (fit.failures.length) {
        throw new Error(`第 ${fit.failures.join('、')} 页逐字稿超长（三段自适应后仍溢出），请精简逐字稿或拆页`);
      }
    }

    await page.pdf({
      path: outPdf,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return fit;
  } finally {
    await page.close();
  }
}

/* ────────────────────────── 主流程 ────────────────────────── */

const args = parseArgs(process.argv.slice(2));
const deckPath = path.resolve(args.deck);
if (!fs.existsSync(deckPath)) usageAndExit(`找不到文件 ${deckPath}`);

const deckDir = path.dirname(deckPath);
const deckBase = path.basename(deckPath, path.extname(deckPath));
const outDir = args.out ? path.resolve(args.out) : deckDir;
fs.mkdirSync(outDir, { recursive: true });
const ymd = args.date || todayYmd();
const author = args.author || BRAND.author;

const browser = await chromium.launch({
  headless: true,
  // 两个 flag 让临时文档经 <base href> 跨目录加载 file:// 字体/图片（CORS 豁免）
  args: ['--allow-file-access-from-files', '--disable-web-security'],
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-export-'));
let exitCode = 0;

try {
  const deck = await extractDeck(browser, deckPath);
  if (!deck.slides.length) throw new Error(`deck 里的 <deck-stage> 下找不到任何页元素：${deckPath}`);

  // 逐字稿硬闸（handout 前置；与放映侧同口径：数组项或 data-speaker-notes 属性均算稿源）
  if (args.handout) {
    if (deck.notesCount !== null && deck.notesCount !== deck.slides.length) {
      throw new Error(`#speaker-notes 条数 ${deck.notesCount} ≠ 页数 ${deck.slides.length}——数组存在时必须与页一一对应（见 SKILL.md Step 4 自检一行命令）`);
    }
    const uncovered = deck.slides.map((s, i) => (s.hasNote ? 0 : i + 1)).filter(Boolean);
    if (uncovered.length === deck.slides.length) {
      throw new Error('deck 缺少 #speaker-notes（或 JSON 解析失败），且无任何 data-speaker-notes 属性稿，无法生成二合一 handout；只需纯片请加 --slides');
    }
    if (uncovered.length) {
      throw new Error(`第 ${uncovered.join('、')} 页无逐字稿稿源（#speaker-notes 数组未覆盖、也无 data-speaker-notes 属性）；无稿页请在数组中留空字符串 ""`);
    }
  }

  // data-deck-skip 页剔除（与 deck-stage 打印行为一致），随后 --rp 过滤（元组同移，notes 保持对齐）
  let slides = deck.slides.filter((s) => !s.skip);
  const skipped = deck.slides.length - slides.length;
  if (args.rp) {
    const subset = slides.filter((s) => s.rp === args.rp);
    if (!subset.length) {
      const seen = [...new Set(slides.map((s) => s.rp).filter(Boolean))];
      throw new Error(seen.length
        ? `没有 data-rp="${args.rp}" 的页；本 deck 实际存在：${seen.join('、')}`
        : `本 deck 无 data-rp 标注，无法用 --rp 过滤（data-rp 写法见 references/authoring-checklist.md）`);
    }
    slides = subset;
  }

  const title = deck.title || deckBase;
  const baseHref = `${pathToFileURL(deckDir).href}/`;
  const suffix = args.rp ? `-${args.rp}` : '';
  console.log(`deck=${path.basename(deckPath)}  sections=${deck.slides.length}  notes=${deck.notesCount ?? '无'}${skipped ? `  （data-deck-skip 跳过 ${skipped} 页）` : ''}${args.rp ? `  rp=${args.rp} 命中 ${slides.length} 页` : ''}`);

  const families = [];
  if (args.slides) {
    families.push({
      key: 'slides', label: '幻灯片',
      outPdf: path.join(outDir, `${deckBase}${suffix}-幻灯片-${ymd}.pdf`),
      html: buildSlidesHtml({ title, baseHref, styles: deck.styles, slides }),
      ptW: GEO.slides.ptW, ptH: GEO.slides.ptH, isHandout: false,
    });
  }
  if (args.handout) {
    families.push({
      key: 'handout', label: '幻灯片和逐字稿',
      outPdf: path.join(outDir, `${deckBase}${suffix}-幻灯片和逐字稿-${ymd}.pdf`),
      html: buildHandoutHtml({ title, baseHref, styles: deck.styles, slides, dateCn: ymdToCn(ymd), rp: args.rp }),
      ptW: GEO.handout.ptW, ptH: GEO.handout.ptH, isHandout: true,
    });
  }

  for (const fam of families) {
    const tmpHtml = path.join(tmpDir, `${fam.key}.html`);
    // 先写 .part 中间名，页数/尺寸/元数据全部通过后才改名到正式交付名——
    // 任何失败都不会留下或覆盖正式 PDF。
    const partPdf = path.join(path.dirname(fam.outPdf), `.${path.basename(fam.outPdf)}.part`);
    try {
      const fit = await renderFamily(browser, { html: fam.html, tmpHtml, outPdf: partPdf, isHandout: fam.isHandout });
      const meta = await finalizePdf(partPdf, {
        title: `${title}（${fam.label}）`, deckBase: path.basename(deckPath),
        expectedPages: slides.length, ptW: fam.ptW, ptH: fam.ptH, author,
      });
      fs.renameSync(partPdf, fam.outPdf);
      const size = fs.statSync(fam.outPdf).size;
      console.log(`✓ ${fam.label.padEnd(7, '　')} ${path.basename(fam.outPdf)}  ${slides.length} 页 · ${meta ? `${meta.w.toFixed(1)}×${meta.h.toFixed(1)}pt · ` : ''}${fmtBytes(size)}`);
      if (fam.isHandout) console.log(`  逐字稿排版：${fit.stats.dense} 页 dense，${fit.stats.cols2} 页双栏，0 页溢出`);
    } finally {
      fs.rmSync(partPdf, { force: true }); // 成功已改名走空；失败清掉残件
    }
  }
} catch (err) {
  console.error(`✗ ${err.message}`);
  exitCode = 1;
} finally {
  await browser.close();
  // 只有确实写过中间文件才保留并提示，早期失败（抽取/校验阶段）不留空目录误导排障
  const kept = (args.keepTemp || exitCode) && fs.readdirSync(tmpDir).length > 0;
  if (kept) {
    console.log(`  中间 HTML 保留于 ${tmpDir}`);
  } else {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

process.exit(exitCode);
