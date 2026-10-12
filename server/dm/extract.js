// a module file -> plain text with markdown headings, then paragraph blocks and
// chunks small enough for the DM model to read one at a time
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuleError } from '../engine/util.js';

const HEAD = /^(#{1,3})\s+(.+)$/;
const clean = s => String(s ?? '').replace(/\u00ad/g, '').replace(/[-\u2010\u2011]{2,}|[\u2010\u2011]/g, '-').replace(/[ \t\u00a0]+/g, ' ').trim();

export const SUPPORTED = ['.pdf', '.txt', '.md', '.markdown', '.html', '.htm'];

// opts: onProgress(phase, done, total); ocrCache, the folder OCR language data is kept in;
// ocrWorkers; stats, an object filled with what was read (pages, scanned pages read by OCR, ...)
export async function extractText(buffer, filename = '', opts = {}) {
  const ext = /\.[a-z0-9]+$/i.exec(filename)?.[0].toLowerCase() ?? '';
  if (ext === '.pdf' || buffer.subarray(0, 5).toString('latin1') === '%PDF-') return pdfText(buffer, opts);
  if (!SUPPORTED.includes(ext) && ext) throw new RuleError(`A ${ext} file can't be read. Use a PDF, or text pasted into a .txt, .md or .html file.`);
  const raw = buffer.toString('utf8').replace(/^﻿/, '');
  return ext === '.html' || ext === '.htm' ? htmlText(raw) : raw;
}

function htmlText(html) {
  const ent = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—' };
  return html
    .replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Number(n))} ${t.replace(/<[^>]+>/g, '')}\n\n`)
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_, t) => `\n\n### ${t.replace(/<[^>]+>/g, '')}\n\n`)
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/blockquote)[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
      }
      return ent[e.toLowerCase()] ?? m;
    });
}

// --- PDF ---------------------------------------------------------------

// text a page's fonts could not map to letters: mostly symbols, private-use or replacement characters
function garbled(items) {
  const s = items.map(i => i.str).join('').replace(/\s/g, '');
  if (s.length < 40) return false;
  const letters = (s.match(/[A-Za-z]/g) ?? []).length;
  const junk = (s.match(/[-�\u0000-\u0008]/g) ?? []).length;
  return junk / s.length > 0.1 || letters / s.length < 0.45;
}

async function pdfText(buffer, { onProgress = () => {}, ocrCache = null, ocrWorkers = 2, ocrAll = false, pageRange = null, stats = {} } = {}) {
  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    throw new RuleError('PDF reading is not installed on the server (run npm ci).');
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true, isEvalSupported: false, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    throw new RuleError(e?.name === 'PasswordException' ? 'That PDF is password protected.' : `That PDF could not be read: ${e.message}`);
  }
  const pages = [];
  // pages with no usable text layer (scans, art, unmapped fonts) are read by OCR afterwards
  const scans = [];
  Object.assign(stats, { pages: doc.numPages, textPages: 0, ocrPages: 0, unreadPages: 0, badPages: 0 });
  for (let n = 1; n <= doc.numPages; n++) {
    if (n === 1 || n % 5 === 0) onProgress(`Reading page ${n} of ${doc.numPages}`, n, doc.numPages);
    if (pageRange && (n < pageRange[0] || n > pageRange[1])) {
      pages.push([]);
      continue;
    }
    let page = null;
    try {
      page = await doc.getPage(n);
      const tc = await page.getTextContent();
      const items = fitLayer(tc.items.filter(i => i.str !== undefined && i.transform).map(i => ({ str: i.str, x: i.transform[4] - page.view[0], y: i.transform[5] - page.view[1], w: i.width, size: Math.abs(i.transform[3]) || i.height || 10 })));
      const chars = items.reduce((k, i) => k + i.str.replace(/\s/g, '').length, 0);
      if (ocrAll || chars < 80 || garbled(items)) {
        scans.push(n - 1);
        // a little text is kept in case OCR is not available
        pages.push(garbled(items) ? [] : layerLines(items, page.view[2] - page.view[0]));
      } else {
        stats.textPages++;
        pages.push(layerLines(items, page.view[2] - page.view[0]));
      }
    } catch (e) {
      // one broken page does not lose the book
      console.error(`pdf page ${n}: ${e.message}`);
      stats.badPages++;
      scans.push(n - 1);
      pages.push([]);
    } finally {
      page?.cleanup();
    }
  }
  if (scans.length) await ocrPages(doc, scans, pages, { onProgress, cache: ocrCache, workers: ocrWorkers, stats });
  await task.destroy();
  const text = linesToText(pages);
  if (text.replace(/\s/g, '').length < 200) {
    throw new RuleError(stats.ocrMissing
      ? `That PDF has no readable text (it looks like a scan) and OCR is not available on the server: ${stats.ocrMissing}`
      : 'That PDF has no readable text, even with OCR. Paste the text into a .txt file instead.');
  }
  return text;
}

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// a scan with a hidden OCR text layer: each word is sized to its own box (so "It"
// is half the size of "Dragons") and lines run uphill with the page's tilt. Such a
// layer is turned level and each word given its line's size, so columns and
// headings read as they would in a typeset PDF
function fitLayer(items) {
  const words = items.filter(i => i.str.trim());
  const slopes = [];
  let pairs = 0;
  let jumps = 0;
  for (let k = 1; k < words.length; k++) {
    const a = words[k - 1];
    const b = words[k];
    const big = Math.max(a.size, b.size);
    const gap = b.x - (a.x + a.w);
    // neighbours on one line, in the order the layer gives them
    if (gap < -1 || gap > big * 2 || Math.abs(b.y - a.y) > big * 0.5) continue;
    pairs++;
    if (big / Math.min(a.size, b.size) > 1.15) jumps++;
    if (b.x - a.x > 1) slopes.push((b.y - a.y) / (b.x - a.x));
  }
  if (pairs < 20 || jumps / pairs < 0.3) return items;
  const t = Math.atan(median(slopes) ?? 0);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const level = items.map(i => ({ ...i, x: i.x * cos + i.y * sin, y: i.y * cos - i.x * sin, fit: true }));
  // runs of words the layer gives one after another on one line share a size: the
  // height of its taller words (capitals and descenders), steadier than any one word
  const live = level.filter(i => i.str.trim());
  const typical = median(live.map(i => i.size));
  let run = [];
  const close = () => {
    const sizes = run.map(i => i.size).sort((a, b) => a - b);
    const size = sizes[Math.floor((sizes.length - 1) * 0.75)];
    for (const i of run) i.size = size;
    run = [];
  };
  for (const it of live) {
    const last = run[run.length - 1];
    if (last && !(it.x > last.x && it.x - (last.x + last.w) < typical * 3 && Math.abs(it.y - last.y) < typical * 0.5)) close();
    run.push(it);
  }
  if (run.length) close();
  for (const i of level) if (!i.str.trim()) i.size = typical;
  return level;
}

// a fitted layer's lines are measured, like OCR's
const layerLines = (items, width) => {
  const lines = pageLines(items, width);
  return items.some(i => i.fit) ? lines.map(l => ({ ...l, ocr: true, fit: true })) : lines;
};

// scanned pages: each is drawn at 300 dpi and read with tesseract; its words go
// through the same column and heading handling as a text layer
const OCR_DPI = 300;

async function ocrPages(doc, todo, pages, { onProgress, cache, workers, stats }) {
  let createWorker;
  try {
    ({ createWorker } = await import('tesseract.js'));
    await import('@napi-rs/canvas');
  } catch (e) {
    stats.ocrMissing = `${e.message.split('\n')[0]} (run npm ci)`;
    stats.unreadPages = todo.length;
    console.error(`OCR unavailable, ${todo.length} pages without text are skipped: ${stats.ocrMissing}`);
    return;
  }
  const pool = [];
  try {
    // tesseract keeps its language data in the working folder unless told otherwise
    const cachePath = cache ?? join(tmpdir(), 'tavern-ocr');
    for (let i = 0; i < Math.max(1, Math.min(workers, todo.length)); i++) pool.push(await createWorker('eng', 1, { cachePath }));
  } catch (e) {
    stats.ocrMissing = `tesseract could not start: ${e.message}`;
    stats.unreadPages = todo.length;
    console.error(stats.ocrMissing);
    await Promise.allSettled(pool.map(w => w.terminate()));
    return;
  }
  const queue = [...todo];
  let done = 0;
  onProgress(`Reading scanned pages (OCR) 0 of ${todo.length}`, 0, todo.length);
  const run = async worker => {
    while (queue.length) {
      const i = queue.shift();
      let page = null;
      try {
        page = await doc.getPage(i + 1);
        const vp = page.getViewport({ scale: OCR_DPI / 72 });
        const cv = doc.canvasFactory.create(Math.ceil(vp.width), Math.ceil(vp.height));
        await page.render({ canvasContext: cv.context, canvas: cv.canvas, viewport: vp }).promise;
        const png = cv.canvas.toBuffer('image/png');
        doc.canvasFactory.destroy(cv);
        const { data } = await worker.recognize(png, {}, { blocks: true, text: false });
        const items = ocrItems(data, vp.height);
        if (items.length) {
          pages[i] = pageLines(items, vp.width * 72 / OCR_DPI).map(l => ({ ...l, ocr: true }));
          stats.ocrPages++;
        }
      } catch (e) {
        console.error(`OCR page ${i + 1}: ${e.message}`);
        stats.unreadPages++;
      } finally {
        page?.cleanup();
      }
      done++;
      onProgress(`Reading scanned pages (OCR) ${done} of ${todo.length}`, done, todo.length);
    }
  };
  try {
    await Promise.all(pool.map(run));
  } finally {
    await Promise.allSettled(pool.map(w => w.terminate()));
  }
}

// tesseract's words -> text items in PDF points; a word's size is its row height (steadier than its box)
function ocrItems(data, height) {
  const k = 72 / OCR_DPI;
  const out = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) {
    // line boxes include ascenders and descenders, about 1.25 times the type size
    const size = Math.max(4, ((l.rowAttributes?.rowHeight || l.bbox.y1 - l.bbox.y0) * k) / 1.25);
    for (const w of l.words ?? []) {
      const str = String(w.text ?? '').trim();
      if (!str || w.confidence < 20) continue;
      out.push({ str, x: w.bbox.x0 * k, y: (height - l.bbox.y1) * k, w: (w.bbox.x1 - w.bbox.x0) * k, size });
    }
  }
  return out;
}

// text items -> lines in reading order; two-column pages are read column by column
function pageLines(items, width) {
  const live = items.filter(i => i.str.trim());
  if (!live.length) return [];
  const mid = gutter(live, width);
  const crossing = i => i.x < mid - 8 && i.x + i.w > mid + 8;
  const cross = live.filter(crossing);
  const right = live.filter(i => i.x >= mid - 8);
  const left = live.filter(i => i.x < mid - 8 && !crossing(i));
  // a real column has lines that start at the same place; a table does not
  const aligned = items => {
    const lines = rowsToLines(items);
    const bins = new Map();
    for (const l of lines) bins.set(Math.round(l.x / 6), (bins.get(Math.round(l.x / 6)) ?? 0) + 1);
    // two neighbouring bins, as a scan's margin wanders by a few points
    return lines.length >= 3 && Math.max(...[...bins].map(([b, n]) => n + (bins.get(b + 1) ?? 0))) / lines.length >= 0.5;
  };
  const twoCol = cross.length / live.length < 0.08 && right.length / live.length > 0.25 && left.length >= 4 && aligned(left) && aligned(right.filter(i => !crossing(i)));
  if (!twoCol) return rowsToLines(live);
  const seps = [...new Set(cross.map(i => Math.round(i.y)))].sort((a, b) => b - a);
  const bandOf = i => seps.filter(y => y - i.y > 1).length;
  const bands = new Map();
  for (const it of live) {
    const b = bandOf(it);
    const slot = bands.get(b) ?? { full: [], left: [], right: [] };
    (crossing(it) ? slot.full : it.x < mid - 8 ? slot.left : slot.right).push(it);
    bands.set(b, slot);
  }
  const out = [];
  for (const b of [...bands.keys()].sort((a, c) => a - c)) {
    const s = bands.get(b);
    out.push(...rowsToLines(s.full), ...rowsToLines(s.left), ...rowsToLines(s.right));
  }
  return out;
}

// the gap between two columns: the emptiest run of points across the middle of the
// page, which is not always the exact middle (a scan sits where it was laid)
function gutter(live, width) {
  const lo = Math.floor(width * 0.35);
  const cover = new Array(Math.ceil(width * 0.65) - lo + 1).fill(0);
  for (const i of live) for (let x = Math.max(lo, Math.ceil(i.x)); x <= Math.min(lo + cover.length - 1, Math.floor(i.x + i.w)); x++) cover[x - lo]++;
  const least = Math.min(...cover);
  let best = [width / 2, 0];
  for (let k = 0, from = -1; k <= cover.length; k++) {
    if (cover[k] === least) {
      if (from < 0) from = k;
    } else if (from >= 0) {
      if (k - from > best[1]) best = [lo + (from + k - 1) / 2, k - from];
      from = -1;
    }
  }
  return best[0];
}

function rowsToLines(items) {
  const rows = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    // a heading or drop cap beside body text on the same baseline is a line of its own
    const row = rows.find(r => Math.abs(r.y - it.y) <= Math.max(2, Math.min(it.size, r.size) * 0.35) && Math.max(it.size, r.size) / Math.min(it.size, r.size) < 1.5);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, size: it.size, items: [it] });
  }
  return rows.sort((a, b) => b.y - a.y).map(r => {
    const its = r.items.sort((a, b) => a.x - b.x);
    let text = '';
    let last = null;
    for (const it of its) {
      if (last && it.x - (last.x + last.w) > it.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
      text += it.str;
      last = it;
    }
    const sizes = its.filter(i => i.str.trim()).map(i => i.size).sort((a, b) => a - b);
    return { text: clean(text), size: sizes[Math.floor(sizes.length / 2)] ?? 10, y: r.y, x: its[0].x };
  }).filter(l => l.text);
}

function linesToText(pages) {
  // running headers and footers repeat on most pages
  const edge = new Map();
  const key = t => t.toLowerCase().replace(/\d+/g, '#');
  // a page's edges are its highest and lowest lines; with two columns a footer is
  // read after the first column, not last
  const edges = lines => {
    if (lines.length <= 8) return new Set();
    const ys = lines.map(l => l.y).sort((a, b) => a - b);
    const lo = ys[1];
    const hi = ys[ys.length - 2];
    // a chapter title at the top of its page is not a running head
    const type = median(lines.map(l => l.size));
    return new Set(lines.filter(l => (l.y <= lo + 1 || l.y >= hi - 1) && l.size < type * 1.5));
  };
  for (const lines of pages) for (const l of edges(lines)) edge.set(key(l.text), (edge.get(key(l.text)) ?? 0) + 1);
  const repeated = new Set([...edge].filter(([, n]) => n >= Math.max(3, pages.length * 0.1)).map(([k]) => k));
  // running heads naming the part ("PART 2: PHANDALIN") mark where each part starts,
  // even where its title page is only art; a misread copy is still dropped
  const RUNNING = /^(part|chapter|appendix|act)(?=[\s:0-9]|[IVXL]+\b|$)\s*([0-9]+|[IVXL]+\b|[A-Z]\b)?/i;
  const ROMAN = { I: 1, V: 5, X: 10, L: 50 };
  const runId = t => {
    const m = RUNNING.exec(t);
    if (!m || t.length > 40) return null;
    let n = m[2] ?? '';
    if (/^[IVXL]+$/i.test(n) && !/^appendix$/i.test(m[1])) n = [...n.toUpperCase()].reduce((v, c, i, a) => v + (ROMAN[a[i + 1]] > ROMAN[c] ? -ROMAN[c] : ROMAN[c]), 0);
    return `${m[1].toLowerCase()} ${String(n).toLowerCase()}`.trim();
  };
  const titles = new Map();
  const running = pages.map(lines => {
    const l = [...edges(lines)].find(x => runId(x.text) && /\s*\S+\s*:?\s+\S/.test(x.text));
    if (!l) return null;
    const id = runId(l.text);
    const t = titles.get(id) ?? new Map();
    t.set(l.text, (t.get(l.text) ?? 0) + 1);
    titles.set(id, t);
    return id;
  });
  const titleOf = id => {
    const t = [...titles.get(id)].sort((a, b) => b[1] - a[1])[0][0];
    return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s:(-])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : t;
  };
  const multi = new Set(running.filter(Boolean)).size >= 2;
  const all = [];
  let part = null;
  for (const [n, lines] of pages.entries()) {
    const ends = edges(lines);
    if (multi && running[n] && running[n] !== part) {
      if (running.indexOf(running[n]) === n) all.push({ part: titleOf(running[n]), id: running[n] });
      part = running[n];
    }
    for (const l of lines) {
      if (ends.has(l) && (repeated.has(key(l.text)) || /^\d{1,3}$/.test(l.text) || runId(l.text) || /^introduction$/i.test(l.text))) continue;
      all.push(l);
    }
    all.push({ page: true });
  }
  // body size: the most common size by characters (OCR sizes are measured, so coarser)
  const bucket = l => (l.ocr ? Math.round(l.size) : Math.round(l.size * 2) / 2);
  const bySize = new Map();
  for (const l of all) if (!l.page && !l.part) bySize.set(bucket(l), (bySize.get(bucket(l)) ?? 0) + l.text.length);
  const body = [...bySize].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
  // a drop cap (one huge letter) or a page number is never a heading
  // nor are a map's labels read through a scan ("mmm", "Jm^Hv"): a title is mostly letters, with a real word
  const titleLike = l => {
    const letters = (l.text.match(/[a-z]/gi) ?? []).length;
    return l.text.length <= 100 && letters >= 3 && letters / l.text.replace(/\s/g, '').length >= 0.75 && /[a-z]*[aeiouy][a-z]*/i.test(l.text) && l.text.split(/\s+/).some(w => /^[a-z’']{3,}[.,:!?]?$/i.test(w) && /[aeiouy]/i.test(w));
  };
  const big = l => l.size >= body * (l.ocr ? 1.4 : 1.2);
  // heading sizes: the three largest, sizes within 8% of each other (OCR noise) counted as one
  const sizes = [...new Set(all.filter(l => !l.page && !l.part && big(l) && titleLike(l)).map(bucket))].sort((a, b) => b - a);
  const heads = [];
  const lines = all.filter(l => !l.page && !l.part);
  const measured = lines.filter(l => l.ocr).length > lines.length / 2;
  for (const s of sizes) {
    const last = heads[heads.length - 1];
    // measured sizes wander a point or so, and a chain of near sizes would fold every level into one
    if (last && (measured ? s >= last.hi * 0.88 : s >= last.lo * 0.92)) last.lo = s;
    else heads.push({ hi: s, lo: s });
  }
  heads.splice(3);
  const levelOf = l => {
    if (!big(l) || !titleLike(l)) return 0;
    const b = bucket(l);
    const i = heads.findIndex(h => b >= h.lo - 0.01 && b <= h.hi + 0.01);
    return i + 1;
  };
  // keyed areas ("E1. Village Gates", "12. Guard Room") on a line of their own
  const KEYED = /^(?:[A-Z]{1,3}\d{1,3}[a-z]?|\d{1,3}[a-z]?)\.\s+([A-Z][^.!?]{1,55})$/;
  // a scan's text layer: "L Cave Mouth" for "1. Cave Mouth" ("1L" for "11."), "4 . Steep Passage", a map's
  // underlines trailing a heading ("7. Twin Pools Cave ___")
  const keyFix = l => {
    let t = l.text.replace(/(?<=\S)[\s_~^|]*_[\s_~^|]*$/, '').replace(/^(\d{1,3}[a-z]?) \.\s/, '$1. ');
    if (big(l)) t = t.replace(/^(\d?)[lLI|]\.?\s+(?=[A-Z][a-z])/, '$11. ');
    return t === l.text ? l : { ...l, text: t };
  };
  const keyed = l => {
    const m = KEYED.exec(l.text);
    if (!m) return false;
    const words = m[1].split(/\s+/);
    return words.filter(w => /^[A-Z0-9'’"(]/.test(w) || /^(of|the|and|in|to|a|an|on|at|for|with|or)$/.test(w)).length / words.length >= 0.7;
  };
  const titled = t => {
    const words = t.split(/\s+/);
    return words.length <= 6 && words.filter(w => /^[A-Z0-9’'"(]/.test(w) || /^(of|the|and|in|to|a|an|on|at|for|with|or)$/.test(w)).length / words.length >= 0.8;
  };
  const numbered = all.some(l => /^(Part|Chapter|Act)\s*\d/i.test(l.text ?? ''));
  const out = [];
  let para = '';
  let prev = null;
  let drop = '';
  const flush = () => {
    if (para.trim()) out.push(para.trim());
    para = '';
  };
  for (const [k, l0] of all.entries()) {
    if (l0.part) {
      // the part's own title on its first page stands; otherwise its running head gives it
      let titled = false;
      for (let j = k + 1; j < all.length && !all[j].page; j++) if (levelOf(all[j]) && runId(all[j].text) === l0.id) titled = true;
      if (!titled) {
        flush();
        out.push(`# ${l0.part}`);
        prev = null;
      }
      continue;
    }
    if (l0.page) {
      prev = prev && { ...prev, y: null, paged: true };
      continue;
    }
    let l = l0;
    if (/^[A-Z]$/.test(l.text) && l.size >= body * 1.5) {
      drop = l.text;
      continue;
    }
    let lvl = levelOf(l);
    // a heading set larger than the body but in none of the three heading sizes (a scan's
    // sizes wander): a short title-cased line ("Dragon’s Tower") is taken at the lowest level
    if (!lvl && big(l) && titleLike(l) && titled(l.text) && (!para || /[.!?:"”)]$/.test(para) || measured)) lvl = Math.min(3, heads.length + 1);
    const fixed = keyFix(l);
    if (keyed(fixed) && (lvl || big(l) || !para || /[.!?:"”)]$/.test(para))) {
      l = fixed;
      lvl ||= 3;
    }
    if (drop && !lvl) {
      l = { ...l, text: drop + l.text };
      drop = '';
    }
    if (lvl) {
      const last = out[out.length - 1];
      // a heading that wraps onto a second line, not two headings in a row
      const wrapped = prev?.lvl === lvl && prev.y != null && prev.y - l.y > 0 && prev.y - l.y < l.size * 2;
      // "PartI: Goblin Arrows": a 1 read as I with its space lost, in a book that numbers its parts
      l = { ...l, text: l.text.replace(/^(Part|Chapter|Act)\s*[Il|](?=\s*:)/i, (m, w) => (numbered ? `${w} 1` : m)).replace(/^(Part|Chapter|Act|Appendix)(?=[0-9IVX]+\s*:)/i, '$1 ') };
      if (!para && last?.startsWith('#'.repeat(lvl) + ' ') && wrapped) out[out.length - 1] = `${last} ${l.text}`;
      else {
        flush();
        out.push(`${'#'.repeat(lvl)} ${l.text}`);
      }
      prev = { ...l, lvl };
      continue;
    }
    const gap = prev?.y != null && !prev.lvl ? prev.y - l.y : null;
    // a page break ends a paragraph only where a sentence did
    if (prev?.paged && /[.!?:"”)]$/.test(para) && /^[A-Z"“]/.test(l.text)) flush();
    // a measured line's size wanders with its letters, so the body size is the floor
    const unit = l.ocr ? Math.max(l.size, prev?.size ?? 0, body) : l.size;
    // (a fitted layer's sizes are its words' boxes, smaller than the type)
    if (gap != null && (gap > unit * (l.fit ? 2.1 : 1.7) || gap < -unit)) flush();
    else if (prev?.lvl) flush();
    if (para && /[a-z]-$/.test(para) && /^[a-z]/.test(l.text)) para = para.slice(0, -1) + l.text;
    else para += (para ? ' ' : '') + l.text;
    prev = { ...l, lvl: 0 };
  }
  flush();
  return out.join('\n\n');
}

// --- text -> blocks -> chunks -----------------------------------------------

// text with no markdown headings (pasted from a reader): short title-like lines become headings
function inferHeadings(paras) {
  return paras.map(p => {
    if (p.includes('\n') || p.length > 70 || /[.,;:!?]$/.test(p)) return p;
    const words = p.split(/\s+/);
    if (words.length > 9) return p;
    if (/^(chapter|part|appendix|act)\b/i.test(p)) return `# ${p}`;
    if (/^(area\s+\w+|[A-Z]?\d{1,2}[.:]\s+\S)/.test(p)) return `### ${p}`;
    const letters = p.replace(/[^A-Za-z]/g, '');
    const caps = letters.length > 2 && letters === letters.toUpperCase();
    const titled = words.filter(w => /^[A-Z]/.test(w) || /^(of|the|and|in|to|a|an|on|at|for|with)$/.test(w)).length / words.length >= 0.8;
    return caps || titled ? `## ${p}` : p;
  });
}

// [{h: level, t: title} | 'paragraph text']
export function toBlocks(text) {
  let paras = String(text).replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => p.split('\n').map(clean).filter(Boolean).join(p.includes('\n#') ? '\n' : ' ')).filter(Boolean);
  if (!paras.some(p => HEAD.test(p))) paras = inferHeadings(paras);
  const blocks = [];
  for (const p of paras) {
    const m = HEAD.exec(p);
    if (m) blocks.push({ h: m[1].length, t: clean(m[2]) });
    else blocks.push(p);
  }
  return blocks;
}

// the heading level the book's chapters sit at: the shallowest with a few of them
function chapterLevel(blocks) {
  const n = [0, 0, 0, 0];
  for (const b of blocks) if (b.h) n[b.h] += 1;
  for (let l = 1; l <= 3; l++) if (n[l] >= 2 && n[l] <= 40) return l;
  for (let l = 1; l <= 3; l++) if (n[l] >= 1) return l;
  return 1;
}

const sentences = s => s.match(/[^.!?]+[.!?]+["”')]*\s*|[^.!?]+$/g) ?? [s];

// chunks of about `max` characters that break at headings and paragraphs; each
// belongs to the chapter it falls in
export function chunkBlocks(blocks, max = 6500) {
  const level = chapterLevel(blocks);
  const chapters = [];
  const chunks = [];
  let cur = null;
  let path = [];
  const open = () => {
    cur = { chapter: Math.max(0, chapters.length - 1), path: path.join(' > '), blocks: [], size: 0 };
    chunks.push(cur);
  };
  const add = (b, size) => {
    if (!cur) open();
    cur.blocks.push(b);
    cur.size += size;
  };
  for (const b of blocks) {
    if (b.h) {
      path = path.slice(0, b.h - 1);
      path[b.h - 1] = b.t;
      if (b.h <= level || !chapters.length) {
        chapters.push(b.t);
        cur = null;
      } else if (cur && cur.size > max * 0.6) cur = null;
      add(b, b.t.length);
      continue;
    }
    if (!chapters.length) chapters.push('Introduction');
    const parts = b.length > max ? splitLong(b, max) : [b];
    for (const part of parts) {
      if (cur && cur.size + part.length > max) cur = null;
      add(part, part.length);
    }
  }
  // tiny chunks (a stray heading) join the previous one in the same chapter
  const merged = [];
  for (const c of chunks) {
    const last = merged[merged.length - 1];
    if (last && last.chapter === c.chapter && c.size < 400 && last.size + c.size <= max * 1.2) {
      last.blocks.push(...c.blocks);
      last.size += c.size;
    } else merged.push(c);
  }
  return { chapters, chunks: merged.map(({ size, ...c }) => c) };
}

function splitLong(text, max) {
  const out = [];
  let cur = '';
  for (const s of sentences(text)) {
    if (cur && cur.length + s.length > max) {
      out.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// the chunk as the model reads it: headings as they are, paragraphs numbered
export function chunkPrompt(chunk) {
  let n = 0;
  return chunk.blocks.map(b => (b.h ? `${'#'.repeat(b.h)} ${b.t}` : `[${++n}] ${b}`)).join('\n\n');
}

// paragraphs by their numbers in chunkPrompt
export function chunkParagraphs(chunk) {
  return chunk.blocks.filter(b => !b.h);
}
