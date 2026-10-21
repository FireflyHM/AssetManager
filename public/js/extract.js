// Pulls brand, model and serial number out of vendor documents.
//
// Pure functions with no browser or Node dependencies, so the same code runs in
// the page and in the tests. Readers (readers.js) turn each file type into one
// of two shapes before it gets here:
//   grid:       { kind: 'grid', rows: string[][] }            (spreadsheets)
//   positioned: { kind: 'positioned', lines: Line[] }          (PDF text, OCR)
//               Line = { words: { text, x0, x1, h }[] }
// The result lists one candidate per serial number found, and marks each field
// as 'read', 'guessed' or 'missing' so the review screen can flag gaps.

export const KNOWN_BRANDS = [
  ['Dell', /\b(dell(\s*emc)?|poweredge|powerstore|powervault|powerswitch)\b/i],
  ['HPE', /\b(hpe|hewlett\s*packard\s*enterprise|proliant|aruba|nimble|alletra|3par)\b/i],
  ['HP', /\b(hp|hewlett[\s-]*packard)\b/i],
  ['Cisco', /\b(cisco|catalyst|nexus|meraki|ucs)\b/i],
  ['Lenovo', /\b(lenovo|thinksystem|thinkagile)\b/i],
  ['Juniper', /\b(juniper)\b/i],
  ['Fortinet', /\b(fortinet|fortigate|fortiswitch)\b/i],
  ['Palo Alto Networks', /\b(palo\s*alto|pa-\d{3,4})\b/i],
  ['Arista', /\b(arista)\b/i],
  ['NetApp', /\b(netapp)\b/i],
  ['Huawei', /\b(huawei)\b/i],
  ['Supermicro', /\b(supermicro)\b/i],
  ['APC', /\b(apc|smart-ups|symmetra)\b/i],
  ['Schneider Electric', /\b(schneider)\b/i],
  ['Eaton', /\b(eaton)\b/i],
  ['Vertiv', /\b(vertiv|liebert)\b/i],
  ['IBM', /\b(ibm)\b/i],
  ['Pure Storage', /\b(pure\s*storage|flasharray)\b/i],
  ['Hitachi', /\b(hitachi)\b/i],
  ['Fujitsu', /\b(fujitsu|primergy)\b/i],
  ['Synology', /\b(synology)\b/i],
  ['Ubiquiti', /\b(ubiquiti|unifi)\b/i],
  ['Check Point', /\b(check\s*point)\b/i],
  ['F5', /\b(f5|big-ip)\b/i],
  ['Nutanix', /\b(nutanix)\b/i],
  ['Inspur', /\b(inspur)\b/i],
];

export function guessBrand(text) {
  if (!text) return '';
  for (const [name, re] of KNOWN_BRANDS) if (re.test(text)) return name;
  return '';
}

const HEADER_PATTERNS = {
  serial: [[/\b(serial|s\/n|s\/no|sn|service\s*tag)\b/, 3]],
  brand: [[/\b(brand|make|manufacturer|mfr|mfg|oem)\b/, 3]],
  model: [
    [/\bmodel\b/, 3],
    [/\b(part|p\/n|pn|mtm|sku)\b/, 2],
    [/\b(product|description)\b/, 1],
    // "Item" is often just the line number, so it loses to a real description.
    [/\b(item|equipment|hardware)\b/, 0.5],
  ],
};

function normaliseHeader(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Scores a cell as a header for each field. A cell only counts when it is short,
// so a sentence that happens to contain "model" is not taken as a heading.
function headerScores(text) {
  const t = normaliseHeader(text);
  const scores = {};
  if (!t || t.length > 40) return scores;
  for (const [field, patterns] of Object.entries(HEADER_PATTERNS)) {
    for (const [re, score] of patterns) {
      if (re.test(t)) {
        scores[field] = Math.max(scores[field] ?? 0, score);
      }
    }
  }
  return scores;
}

// Picks the column for each field from a header row; null when no serial column.
export function matchHeader(cells) {
  const best = {};
  cells.forEach((cell, i) => {
    const scores = headerScores(cell);
    for (const [field, score] of Object.entries(scores)) {
      if (!best[field] || score > best[field].score) best[field] = { index: i, score };
    }
  });
  if (!best.serial) return null;
  // One column can't be both the serial and something else.
  for (const f of ['brand', 'model']) if (best[f]?.index === best.serial.index) delete best[f];
  if (!best.brand && !best.model) return null;
  return {
    serial: best.serial.index,
    brand: best.brand?.index ?? null,
    model: best.model?.index ?? null,
    // A "Brand / Model" column counts for both; brand is then guessed from the text.
    brandInModel: best.brand && best.model && best.brand.index === best.model.index,
  };
}

// Serial numbers are one word of 4–30 letters, digits, dashes or slashes, with
// at least one digit or an all-capitals look. Rules out "N/A", "TBC", names, etc.
export function looksLikeSerial(token) {
  const t = String(token ?? '').trim();
  if (t.length < 4 || t.length > 30) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9\-/.]*[A-Za-z0-9]$/.test(t)) return false;
  if (/^(n\/?a|none|nil|tbc|tba|null|total|serial|number)$/i.test(t)) return false;
  if (/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(t)) return false; // a date
  return /\d/.test(t) || (/^[A-Z0-9\-/.]+$/.test(t) && t.length >= 6);
}

// One cell can hold several serials ("ABC123, ABC124" or one per line).
export function splitSerials(text) {
  const tokens = String(text ?? '')
    .split(/[\s,;|]+/)
    // OCR often picks up stray quotes and dots at the edges of a word.
    .map((t) => t.replace(/^[#:("'“”‘’`]+|[):.,"'“”‘’`]+$/g, ''))
    .filter(Boolean);
  if (!tokens.length) return [];
  const serials = tokens.filter(looksLikeSerial);
  // If most of the cell isn't serial-like it's prose, not a list of serials.
  return serials.length * 2 >= tokens.length ? serials : [];
}

// Stray quotes, dashes and dots that OCR leaves at the edges of a value.
const trimEdges = (text) => clean(text).replace(/^[\s"'“”‘’`~\-—–_.,:;|]+|[\s"'“”‘’`~\-—–_,:;|]+$/g, '');

function candidate(brand, model, serial, how = {}) {
  let b = trimEdges(brand);
  let m = trimEdges(model);
  const found = {
    brand: b ? how.brand ?? 'read' : 'missing',
    model: m ? how.model ?? 'read' : 'missing',
    serial: serial ? 'read' : 'missing',
  };
  if (!b && m) {
    b = guessBrand(m);
    if (b) found.brand = 'guessed';
  }
  if (b && m) m = stripBrand(m, b);
  return { brand: b, model: m, serial, found };
}

function clean(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

// "Dell PowerEdge R760" with brand Dell → "PowerEdge R760".
function stripBrand(model, brand) {
  const re = new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s:-]*`, 'i');
  const stripped = model.replace(re, '');
  return stripped || model;
}

function fromGrid(rows) {
  let unreadable = null; // a table whose serials couldn't be read at all
  for (let h = 0; h < rows.length; h++) {
    const cols = matchHeader(rows[h]);
    if (!cols) continue;
    const out = [];
    let last = null;
    for (const row of rows.slice(h + 1)) {
      if (matchHeader(row)) continue; // the heading repeated on the next page
      const serials = splitSerials(row[cols.serial]);
      const brandText = cols.brand != null ? row[cols.brand] : '';
      const modelText = cols.model != null ? row[cols.model] : '';
      const others = row.filter((c, i) => i !== cols.serial && clean(c));
      if (!serials.length) {
        // The serial is unreadable (a stain, a fold, a torn edge) but the row
        // is clearly equipment: keep it with the serial blank so it gets
        // flagged for someone to fill in, rather than silently dropping it.
        if (looksLikeItem(brandText, modelText, cols)) {
          const how = cols.brandInModel ? { brand: 'guessed' } : {};
          out.push(candidate(cols.brandInModel ? guessBrand(brandText) : brandText, modelText, '', how));
          last = null;
        }
        continue;
      }
      // A row with only serials continues the item above (a wrapped serial list).
      if (!others.length && last) {
        // Carrying brand and model down is an inference, so it's flagged.
        for (const s of serials) out.push(candidate(last.brand, last.model, s, { brand: 'guessed', model: 'guessed' }));
        continue;
      }
      const how = cols.brandInModel ? { brand: 'guessed' } : {};
      const brand = cols.brandInModel ? guessBrand(brandText) : brandText;
      last = { brand, model: modelText, how };
      for (const s of serials) out.push(candidate(brand, modelText, s, how));
    }
    if (out.some((r) => r.serial)) return out;
    if (out.length) unreadable ??= out;
  }
  return unreadable ?? [];
}

// A row with a brand, or a model code with digits in it, is equipment even if
// its serial can't be read. Totals and free text in other columns are not.
function looksLikeItem(brandText, modelText, cols) {
  const brand = clean(brandText);
  const model = clean(modelText);
  if (/\b(sub-?total|total|grand total|page \d)\b/i.test(`${brand} ${model}`)) return false;
  if (guessBrand(brand) || guessBrand(model)) return true;
  // An unknown brand counts only with a model beside it, so a line like
  // "Received by:" sitting under the brand column isn't taken for equipment.
  const nameLike = /^[A-Za-z][A-Za-z0-9 &.\-/]{1,29}$/.test(brand);
  if (cols.brand != null && nameLike && model.length >= 2) return true;
  return /\d/.test(model) && model.length >= 3 && model.length <= 60;
}

// Groups words on a line into cells: a gap wider than about one character
// height starts a new cell.
export function lineToCells(words) {
  const sorted = [...words].filter((w) => clean(w.text)).sort((a, b) => a.x0 - b.x0);
  const cells = [];
  for (const w of sorted) {
    const prev = cells.at(-1);
    const gap = prev ? w.x0 - prev.x1 : Infinity;
    const h = Math.max(w.h || 0, prev?.h || 0, 4);
    if (prev && gap < h * 0.9) {
      prev.text += (gap > h * 0.15 ? ' ' : '') + clean(w.text);
      prev.x1 = Math.max(prev.x1, w.x1);
    } else {
      cells.push({ text: clean(w.text), x0: w.x0, x1: w.x1, h: w.h || 0 });
    }
  }
  return cells;
}

// Lines up each cell under the heading whose column it falls in, using the
// left edges of the headings as column boundaries.
function alignToHeader(headerCells, cells) {
  const row = headerCells.map(() => '');
  const tolerance = Math.max(...headerCells.map((c) => c.h || 0), 4);
  for (const cell of cells) {
    let col = 0;
    for (let i = 0; i < headerCells.length; i++) {
      if (cell.x0 >= headerCells[i].x0 - tolerance * 1.5) col = i;
    }
    row[col] = row[col] ? `${row[col]} ${cell.text}` : cell.text;
  }
  return row;
}

// OCR turns table rules, stains and speckle into low-confidence "words" like
// "——eaeelee". Those are dropped unless they look like a serial number, which
// is kept (and flagged for checking) because a real serial beside a stain can
// score just as low.
const JUNK_CONFIDENCE = 40;
function dropOcrJunk(words) {
  return words.filter(
    (w) => typeof w.conf !== 'number' || w.conf >= JUNK_CONFIDENCE || splitSerials(w.text).length > 0,
  );
}

function fromPositioned(lines) {
  const cellLines = lines.map((l) => lineToCells(dropOcrJunk(l.words ?? [])));
  for (let h = 0; h < cellLines.length; h++) {
    const cols = matchHeader(cellLines[h].map((c) => c.text));
    if (!cols) continue;
    const header = cellLines[h];
    const body = cellLines.slice(h + 1).map((cells) => alignToHeader(header, cells));
    const found = fromGrid([header.map((c) => c.text), ...body]);
    if (!found.length) continue;
    // Heights of the rows that hold equipment, to spot a row OCR missed entirely.
    const ys = body
      .map((row, k) => ({ row, y: lines[h + 1 + k].y }))
      .filter(({ row }) => splitSerials(row[cols.serial]).length || looksLikeItem(row[cols.brand] ?? '', row[cols.model] ?? '', cols))
      .map(({ y }) => y);
    return { rows: found, gaps: countGaps(ys) };
  }
  return { rows: fromText(cellLines.map((cells) => cells.map((c) => c.text).join('   '))), gaps: 0 };
}

// Table rows are evenly spaced. A gap of about two rows or more between
// neighbours means a row was there but couldn't be read (a fold, a smear).
function countGaps(ys) {
  if (ys.length < 3 || ys.some((y) => typeof y !== 'number')) return 0;
  const steps = ys.slice(1).map((y, i) => y - ys[i]).filter((d) => d > 0);
  const typical = [...steps].sort((a, b) => a - b)[Math.floor((steps.length - 1) / 2)]; // lower median
  // Much bigger jumps are page breaks or a new section, not a lost row.
  return steps.filter((d) => d > typical * 1.7 && d < typical * 5).reduce((n, d) => n + Math.round(d / typical) - 1, 0);
}

const KEYS = [
  ['brand', /\b(?:brand|make|manufacturer)\s*[:\-]/gi],
  ['model', /\b(?:model|part)(?:\s*(?:no|number|#))?\.?\s*[:\-#]/gi],
  ['serial', /(?:\bserial(?:\s*(?:no|number|#|nos|numbers))?\.?\s*[:\-#]?|\bs\/n\.?\s*[:\-#]?|\bsn\s*[:\-#])/gi],
];

// Reads "Label: value" text, e.g. "Model: PowerEdge R760   S/N: 7XK2Q93".
// Every serial picks up the most recent brand and model seen before it.
export function fromText(lines) {
  const out = [];
  let brand = '';
  let model = '';
  for (const line of lines) {
    const marks = [];
    for (const [field, re] of KEYS) {
      for (const m of String(line).matchAll(re)) marks.push({ field, start: m.index, end: m.index + m[0].length });
    }
    marks.sort((a, b) => a.start - b.start);
    // Drop labels that start inside an earlier label ("Serial No:" also matches "No").
    const keep = marks.filter((m, i) => !marks.slice(0, i).some((p) => m.start < p.end));
    keep.forEach((m, i) => {
      const value = clean(String(line).slice(m.end, keep[i + 1]?.start ?? undefined));
      if (m.field === 'brand') brand = value;
      if (m.field === 'model') model = value;
      if (m.field === 'serial') for (const s of splitSerials(value)) out.push(candidate(brand, model, s));
    });
  }
  return out;
}

// Document-wide details that apply to every row: vendor and project.
export function extractDocumentFields(lines) {
  const out = { vendor: '', project: '' };
  for (const line of lines) {
    const text = String(line);
    const vendor = text.match(/\b(?:vendor|supplier)(?:\s*name)?\s*:\s*(.+?)(?:\s{3,}|$)/i);
    const project = text.match(/\bproject(?:\s*(?:name|title|ref))?\s*:\s*(.+?)(?:\s{3,}|$)/i);
    if (vendor && !out.vendor) out.vendor = clean(vendor[1]);
    if (project && !out.project) out.project = clean(project[1]);
  }
  return out;
}

function uniqueBySerial(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    if (!r.serial) return true; // rows waiting for a serial are all kept
    const key = r.serial.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The document as plain text, one line per row, for sending to the AI.
export function sourceToText(source) {
  const lines =
    source.kind === 'grid'
      ? source.rows.map((r) => r.map(clean).filter(Boolean).join(' | '))
      : source.lines.map((l) => lineToCells(l.words ?? []).map((c) => c.text).join('   '));
  return lines.filter(Boolean).join('\n');
}

// → { rows, fields: { vendor, project }, missedRows }
// missedRows counts table rows that seem to be there but couldn't be read.
export function extractAssets(source) {
  let rows = [];
  let lines = [];
  let missedRows = 0;
  if (source.kind === 'grid') {
    rows = fromGrid(source.rows);
    lines = source.rows.map((r) => r.filter(Boolean).join('   '));
    if (!rows.length) rows = fromText(lines);
  } else {
    ({ rows, gaps: missedRows } = fromPositioned(source.lines));
    lines = source.lines.map((l) => lineToCells(l.words ?? []).map((c) => c.text).join('   '));
    flagUncertain(rows, source.lines);
  }
  return { rows: uniqueBySerial(rows), fields: extractDocumentFields(lines), missedRows };
}

export const CONFIDENT = 80; // OCR confidence (0–100) below which a value needs checking

const normalise = (text) => String(text).toUpperCase().replace(/[^A-Z0-9]/g, '');

// OCR words carry a confidence score. Any field built from a word OCR wasn't
// sure about is marked 'guessed', so it shows amber for someone to check.
function flagUncertain(rows, lines) {
  const words = lines
    .flatMap((l) => l.words ?? [])
    .filter((w) => typeof w.conf === 'number')
    .map((w) => ({ key: normalise(w.text), conf: w.conf }))
    .filter((w) => w.key.length >= 2);
  if (!words.length) return;
  const unsure = (value) =>
    value
      .split(/[\s,]+/)
      .map(normalise)
      .filter((t) => t.length >= 2)
      .some((t) => words.some((w) => (w.key.includes(t) || t.includes(w.key)) && w.conf < CONFIDENT));
  for (const row of rows) {
    for (const f of ['brand', 'model', 'serial']) {
      if (row[f] && row.found[f] === 'read' && unsure(row[f])) row.found[f] = 'guessed';
    }
  }
}
