// Turns an uploaded file into text the extractor can read, plus a preview to
// show beside the extracted fields. Everything runs in the browser.
//   readDocument(file, onProgress) → { sources: Source[], preview: Node, note }

import { el } from './common.js';

const MAX_PAGES = 20;
const OCR_MIN_CHARS = 25; // a PDF page with less text than this is treated as a scan

const KINDS = {
  pdf: { label: 'PDF', read: (f, p) => readPdf(f, p) },
  xlsx: { label: 'Excel file', read: (f) => readSpreadsheet(f) },
  xls: { label: 'Excel file', read: (f) => readSpreadsheet(f) },
  csv: { label: 'CSV file', read: (f) => readSpreadsheet(f) },
  jpg: { label: 'JPG image', read: (f, p) => readImage(f, p) },
  jpeg: { label: 'JPG image', read: (f, p) => readImage(f, p) },
  png: { label: 'PNG image', read: (f, p) => readImage(f, p) },
};

// Errors written for the person using the app, passed through unchanged.
class ReadError extends Error {}

export async function readDocument(file, onProgress = () => {}) {
  const ext = file.name.toLowerCase().split('.').pop();
  const kind = KINDS[ext];
  if (!kind) throw new ReadError('This file type cannot be read. Upload a PDF, Excel, CSV, JPG or PNG file.');
  if (!file.size) throw new ReadError(`This ${kind.label} is empty (0 bytes). Ask the vendor to send it again.`);
  await checkSignature(file, ext, kind.label);
  try {
    return await kind.read(file, onProgress);
  } catch (err) {
    if (err instanceof ReadError) throw err;
    console.error(`Reading ${file.name} failed:`, err);
    throw new ReadError(
      `This ${kind.label} looks damaged or incomplete, so it couldn't be read. Ask the vendor to send it again, or type the assets in by hand.`,
    );
  }
}

// Checks the first bytes match the file's extension, to catch things like an
// expired-link page saved as "delivery-order.pdf". Old .xls exports are often
// really HTML or CSV, which the spreadsheet reader handles, so they're not checked.
async function checkSignature(file, ext, label) {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const starts = (...bytes) => bytes.every((b, i) => head[i] === b);
  const ok = {
    pdf: () => new TextDecoder('latin1').decode(head).includes('%PDF'),
    xlsx: () => starts(0x50, 0x4b),
    jpg: () => starts(0xff, 0xd8),
    jpeg: () => starts(0xff, 0xd8),
    png: () => starts(0x89, 0x50, 0x4e, 0x47),
  }[ext];
  if (ok && !ok()) {
    const text = new TextDecoder().decode(head.slice(0, 200)).replace(/\s+/g, ' ').trim();
    const looksLikeText = /^[\x20-\x7e]{10,}/.test(text);
    throw new ReadError(
      `This file is named .${ext} but isn't really a ${label}.` +
        (looksLikeText ? ` It contains text: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"` : '') +
        ' It may be an error page saved instead of the document. Ask the vendor to send it again.',
    );
  }
}

// A JPG ends with FF D9 and a PNG with an IEND chunk; without them the file
// was cut short, and the bottom of the page will be missing.
async function looksTruncated(file, ext) {
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 64)).arrayBuffer());
  if (ext === 'png') return !new TextDecoder('latin1').decode(tail).includes('IEND');
  for (let i = tail.length - 2; i >= 0; i--) if (tail[i] === 0xff && tail[i + 1] === 0xd9) return false;
  return true;
}

// ---- Spreadsheets ----

async function readSpreadsheet(file) {
  const XLSX = await import('/vendor/xlsx/xlsx.mjs');
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, dense: true });
  const sources = [];
  const preview = el('div');
  for (const name of book.SheetNames) {
    const rows = XLSX.utils
      .sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: '', blankrows: true, dateNF: 'yyyy-mm-dd' })
      .map((r) => r.map((c) => String(c ?? '').trim()));
    sources.push({ kind: 'grid', rows });
    preview.append(gridPreview(name, rows, book.SheetNames.length > 1));
  }
  return { sources, preview };
}

function gridPreview(name, rows, showName) {
  const shown = rows.slice(0, 300);
  const width = Math.min(Math.max(0, ...shown.map((r) => r.length)), 40);
  return el(
    'div',
    {},
    showName ? el('div', { class: 'sheet-name' }, name) : null,
    el(
      'table',
      {},
      el('tbody', {}, shown.map((r) => el('tr', {}, Array.from({ length: width }, (_, i) => el('td', {}, r[i] ?? ''))))),
    ),
    rows.length > shown.length ? el('p', { class: 'muted' }, `… ${rows.length - shown.length} more rows`) : null,
  );
}

// ---- PDFs ----

async function readPdf(file, onProgress) {
  const pdfjs = await import('/vendor/pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = Math.min(pdf.numPages, MAX_PAGES);
  const preview = el('div');
  const words = [];
  const scans = []; // pages that had to be read with OCR, kept for AI reading
  let scanned = 0;
  for (let n = 1; n <= pages; n++) {
    onProgress({ message: `Reading page ${n} of ${pages}`, progress: (n - 1) / pages });
    const page = await pdf.getPage(n);
    const canvas = await renderPage(page, 2);
    preview.append(canvas);

    const viewport = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    const text = items.map((i) => i.str ?? '').join('').trim();
    if (text.length >= OCR_MIN_CHARS) {
      for (const item of items) {
        if (!item.str?.trim()) continue;
        const [, , c, d, x, y] = item.transform;
        const h = item.height || Math.hypot(c, d) || 10;
        // PDF y runs bottom-up; flip it and offset by page so pages stack.
        const top = (n - 1) * 10000 + (viewport.height - y - h);
        words.push({ text: item.str, x0: x, x1: x + item.width, y0: top, y1: top + h });
      }
    } else {
      // No text layer: it's a scan, so read the rendered page with OCR.
      scanned++;
      scans.push(canvas);
      const ocrWords = await ocr(canvas, (p) =>
        onProgress({ message: `Reading scanned page ${n} of ${pages}`, progress: (n - 1 + p) / pages }),
      );
      const scale = viewport.width / canvas.width;
      for (const w of ocrWords) {
        words.push({ ...w, x0: w.x0 * scale, x1: w.x1 * scale, y0: (n - 1) * 10000 + w.y0 * scale, y1: (n - 1) * 10000 + w.y1 * scale });
      }
    }
  }
  const note = [
    pdf.numPages > MAX_PAGES ? `Only the first ${MAX_PAGES} of ${pdf.numPages} pages were read.` : '',
    scanned ? `${scanned === pages ? 'This is a scanned document' : `${scanned} scanned page(s)`}: text was read with OCR, so check every serial number carefully.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return { sources: [{ kind: 'positioned', lines: groupIntoLines(words) }], preview, note, scans };
}

async function renderPage(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = el('canvas', { width: Math.floor(viewport.width), height: Math.floor(viewport.height) });
  await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

// ---- Images ----

async function readImage(file, onProgress) {
  const url = URL.createObjectURL(file);
  const img = el('img', { src: url, alt: `Scan of ${file.name}` });
  await img.decode();
  // OCR is more accurate on larger text, so scale small scans up first.
  const scale = img.naturalWidth < 1600 ? 2 : 1;
  const canvas = el('canvas', { width: img.naturalWidth * scale, height: img.naturalHeight * scale });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const words = await ocr(canvas, (p) => onProgress({ message: 'Reading the scan', progress: p }));
  const ext = file.name.toLowerCase().split('.').pop();
  const cutShort = await looksTruncated(file, ext === 'png' ? 'png' : 'jpg');
  return {
    sources: [{ kind: 'positioned', lines: groupIntoLines(words) }],
    preview: el('div', {}, img),
    scans: [canvas],
    note:
      (cutShort
        ? "This image file is incomplete (it may not have finished downloading), so part of the page is missing. Ask the vendor for the full copy. "
        : '') + 'Text was read from a scan with OCR, so check every serial number carefully.',
  };
}

// ---- OCR (Tesseract, served locally) ----

let workerPromise;
let ocrProgress = () => {};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = el('script', { src });
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the OCR engine.'));
    document.head.append(s);
  });
}

async function getWorker() {
  workerPromise ??= (async () => {
    await loadScript('/vendor/tesseract/tesseract.min.js');
    return window.Tesseract.createWorker('eng', 1, {
      workerPath: '/vendor/tesseract/worker.min.js',
      corePath: '/vendor/tesseract-core',
      langPath: '/vendor/tessdata',
      logger: (m) => {
        if (m.status === 'recognizing text') ocrProgress(m.progress ?? 0);
      },
    });
  })();
  try {
    return await workerPromise;
  } catch (err) {
    workerPromise = null;
    throw err;
  }
}

async function ocr(canvas, onProgress) {
  const worker = await getWorker();
  ocrProgress = onProgress;
  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const words = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          for (const w of line.words ?? []) {
            // Low-confidence words are kept, not dropped: a serial next to a
            // stain can score near 0 and still be right. The extractor flags
            // them for checking instead.
            if (/[a-z0-9]/i.test(w.text ?? '')) {
              words.push({ text: w.text, conf: w.confidence, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 });
            }
          }
        }
      }
    }
    return words;
  } finally {
    ocrProgress = () => {};
  }
}

// ---- Layout ----

// Puts words that sit at the same height on one line, top to bottom, then
// left to right. OCR often reads table columns as separate blocks, so lines
// are rebuilt from positions rather than taken from the OCR output.
export function groupIntoLines(words) {
  const sorted = [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  // A stain or smudge read as a "word" can be many lines tall; cap heights
  // near the typical text height so it can't pull neighbouring rows together.
  const heights = words.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] || 10;
  const lines = [];
  for (const w of sorted) {
    const mid = (w.y0 + w.y1) / 2;
    const h = Math.min(w.y1 - w.y0, typical * 1.5);
    const line = lines.at(-1);
    if (line && Math.abs(mid - line.mid) <= Math.max(h, line.h) * 0.5) {
      line.words.push(w);
      line.mid = (line.mid * (line.words.length - 1) + mid) / line.words.length;
      line.h = Math.max(line.h, h);
    } else {
      lines.push({ mid, h, words: [w] });
    }
  }
  return lines.map((l) => ({
    y: l.mid,
    words: l.words
      .sort((a, b) => a.x0 - b.x0)
      .map((w) => ({ text: w.text, x0: w.x0, x1: w.x1, h: w.y1 - w.y0, conf: w.conf })),
  }));
}
