// Add from documents: upload → read → check and correct → confirm into the list.
import { api, el, toast, plural, serialKey, confirmDialog } from './common.js';
import { readDocument } from './readers.js';
import { extractAssets } from './extract.js';
import { isZip, unzipDocuments } from './zip.js';

const ROW_FIELDS = [
  { key: 'brand', label: 'Brand' },
  { key: 'model', label: 'Model' },
  { key: 'serial', label: 'Serial number', mono: true },
  { key: 'hostname', label: 'Hostname / label', optional: true },
];

const BATCH_FIELDS = [
  { key: 'project', label: 'Project' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'location', label: 'Location' },
  { key: 'warranty_end', label: 'Warranty end', type: 'date' },
  { key: 'maintenance', label: 'Maintenance agreement' },
];

const docs = [];
let selected = null;
let reading = Promise.resolve();
let nextId = 1;
const $ = (id) => document.getElementById(id);

export function initImporter() {
  const input = $('file-input');
  const zone = $('dropzone');
  input.addEventListener('change', () => {
    addFiles([...input.files]);
    input.value = '';
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    addFiles([...e.dataTransfer.files]);
  });
}

// Zips are unpacked here; every document inside becomes its own entry.
async function expandZips(files) {
  const out = [];
  for (const file of files) {
    if (!isZip(file)) {
      out.push({ file, from: '' });
      continue;
    }
    try {
      const { files: inside, skipped } = await unzipDocuments(file);
      out.push(...inside);
      if (!inside.length) {
        toast(`${file.name} has no documents the app can read (PDF, Excel, CSV, JPG or PNG).`, 'bad');
      } else {
        toast(
          `Opened ${file.name}: ${plural(inside.length, 'document')}.` +
            (skipped.length ? ` Skipped ${skipped.length}: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''}` : ''),
        );
      }
    } catch (err) {
      toast(err.message, 'bad');
    }
  }
  return out;
}

async function addFiles(dropped) {
  if (!dropped.length) return;
  const files = await expandZips(dropped);
  if (!files.length) return;
  const firstNew = docs.length;
  for (const { file, from } of files) {
    const doc = {
      id: nextId++,
      file,
      from, // the zip it came out of, if any
      status: 'waiting', // waiting | reading | ready | error | added
      message: 'Waiting to be read',
      progress: 0,
      rows: [],
      batch: Object.fromEntries(BATCH_FIELDS.map((f) => [f.key, ''])),
      existing: new Map(),
      preview: null,
      note: '',
    };
    docs.push(doc);
    // Read one at a time: OCR is heavy and shares one worker.
    reading = reading.then(() => readOne(doc));
  }
  $('import-layout').hidden = false;
  if (!selected) selected = docs[firstNew];
  renderQueue();
  renderReview();
}

async function readOne(doc) {
  if (doc.removed) return;
  doc.status = 'reading';
  doc.message = 'Reading…';
  update(doc);
  try {
    const { sources, preview, note } = await readDocument(doc.file, ({ message, progress }) => {
      doc.message = message;
      doc.progress = progress;
      update(doc, { progressOnly: true });
    });
    if (doc.removed) return releasePreview(preview);
    doc.preview = preview;
    doc.note = note ?? '';
    for (const source of sources) {
      const { rows, fields, missedRows } = extractAssets(source);
      doc.missedRows = (doc.missedRows ?? 0) + missedRows;
      doc.rows.push(...rows.map((r) => ({ ...r, hostname: '', found: { ...r.found, hostname: 'read' } })));
      for (const [k, v] of Object.entries(fields)) if (v && !doc.batch[k]) doc.batch[k] = v;
    }
    // Drop repeats across sheets or pages.
    const seen = new Set();
    doc.rows = doc.rows.filter((r) => !r.serial || (!seen.has(serialKey(r.serial)) && seen.add(serialKey(r.serial))));
    doc.found = doc.rows.length;
    doc.unreadable = doc.rows.filter((r) => !r.serial).length;
    if (!doc.rows.length) doc.rows.push(blankRow());
    await refreshExisting(doc);
    doc.status = 'ready';
    doc.message = doc.found ? `Read · ${foundText(doc)}` : 'Read · nothing relevant found';
  } catch (err) {
    doc.status = 'error';
    doc.message = 'Could not be read';
    doc.error = err.message || String(err);
  }
  update(doc);
}

function foundText(doc) {
  return `${plural(doc.found, 'asset')} found` + (doc.unreadable ? `, ${doc.unreadable} without a readable serial` : '');
}

function blankRow() {
  return { brand: '', model: '', serial: '', hostname: '', found: { brand: 'missing', model: 'missing', serial: 'missing', hostname: 'read' } };
}

async function refreshExisting(doc) {
  const serials = doc.rows.map((r) => r.serial.trim()).filter(Boolean);
  if (!serials.length) {
    doc.existing = new Map();
    return;
  }
  try {
    const { existing } = await api('/api/serials/check', { method: 'POST', body: { serials } });
    doc.existing = new Map(existing.map((a) => [serialKey(a.serial), a]));
  } catch {}
}

function update(doc, { progressOnly = false } = {}) {
  renderQueue();
  if (doc !== selected) return;
  if (progressOnly) {
    const bar = $('review').querySelector('.progress > div');
    const msg = $('review').querySelector('.progress-msg');
    if (bar) bar.style.width = `${Math.round(doc.progress * 100)}%`;
    if (msg) msg.textContent = doc.message;
  } else {
    renderReview();
  }
}

function renderQueue() {
  $('doc-queue').replaceChildren(
    ...docs.map((doc) =>
      el(
        'li',
        {},
        el(
          'button',
          {
            type: 'button',
            class: 'doc-select',
            'aria-current': String(doc === selected),
            onclick: () => {
              selected = doc;
              renderQueue();
              renderReview();
            },
          },
          el('span', { class: 'name' }, doc.file.name),
          doc.from ? el('span', { class: 'from' }, `From ${doc.from}`) : null,
          el(
            'span',
            { class: `state ${doc.status === 'error' ? 'bad' : doc.status === 'added' ? 'ok' : ''}` },
            doc.status === 'reading' ? `${doc.message} ${doc.progress ? `${Math.round(doc.progress * 100)}%` : ''}` : doc.message,
          ),
        ),
        el(
          'button',
          {
            type: 'button',
            class: 'icon-btn remove-doc',
            title: 'Remove this document',
            'aria-label': `Remove ${doc.file.name}`,
            onclick: () => askRemove(doc),
          },
          '×',
        ),
      ),
    ),
  );
}

// Only a document whose rows are waiting for review has work that would be lost.
async function askRemove(doc) {
  if (doc.status === 'ready') {
    const confirmed = await confirmDialog({
      title: 'Remove this document?',
      body: el(
        'p',
        {},
        `The rows read from ${doc.file.name} haven't been added to the list yet. Removing the document discards them.`,
      ),
      okLabel: 'Remove document',
      danger: true,
    });
    if (!confirmed) return;
  }
  removeDoc(doc);
  if (doc.status === 'added') toast(`Removed ${doc.file.name} from this page. Its assets stay on the list.`);
}

function removeDoc(doc) {
  const i = docs.indexOf(doc);
  if (i === -1) return;
  docs.splice(i, 1);
  doc.removed = true; // a read still in progress is discarded when it finishes
  releasePreview(doc.preview);
  if (selected === doc) selected = docs[i] ?? docs[i - 1] ?? null;
  $('import-layout').hidden = !docs.length;
  renderQueue();
  renderReview();
}

function releasePreview(preview) {
  for (const img of preview?.querySelectorAll('img') ?? []) URL.revokeObjectURL(img.src);
}

// ---- Review ----

function renderReview() {
  const doc = selected;
  const review = $('review');
  if (!doc) return review.replaceChildren();

  const docPanel = el(
    'section',
    { class: 'panel doc-view', 'aria-label': 'Document' },
    el(
      'div',
      { class: 'panel-head' },
      el('strong', {}, doc.file.name),
      el('span', { class: 'muted' }, `${Math.max(1, Math.round(doc.file.size / 1024))} KB`),
    ),
    el('div', { class: 'panel-body' }, doc.preview ?? el('p', { class: 'muted' }, doc.status === 'error' ? 'No preview.' : 'Preview appears once the document is read.')),
  );

  let side;
  if (doc.status === 'waiting' || doc.status === 'reading') {
    side = el(
      'section',
      { class: 'panel' },
      el('div', { class: 'panel-head' }, el('strong', {}, 'Reading the document')),
      el(
        'div',
        { class: 'panel-body' },
        el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Reading progress' }, el('div', { style: `width:${Math.round(doc.progress * 100)}%` })),
        el('p', { class: 'muted progress-msg' }, doc.message),
        el('p', { class: 'muted' }, 'Scans can take up to a minute a page.'),
      ),
    );
  } else if (doc.status === 'error') {
    side = el(
      'section',
      { class: 'panel' },
      el('div', { class: 'panel-head' }, el('strong', {}, 'This document could not be read')),
      el(
        'div',
        { class: 'panel-body' },
        el('div', { class: 'notice bad' }, doc.error),
        el('p', {}, 'You can still type the assets in by hand.'),
        el('div', {}, el('button', { type: 'button', class: 'btn', onclick: () => manualEntry(doc) }, 'Enter by hand')),
      ),
    );
  } else if (doc.status === 'added') {
    side = el(
      'section',
      { class: 'panel' },
      el('div', { class: 'panel-head' }, el('strong', {}, 'Added to the list')),
      el(
        'div',
        { class: 'panel-body' },
        el('div', { class: 'notice ok' }, `${plural(doc.added.length, 'asset')} from ${doc.file.name} ${doc.added.length === 1 ? 'is' : 'are'} now on the list.`),
        el('ul', {}, doc.added.map((a) => el('li', {}, el('a', { href: `#/assets/${a.id}` }, `${a.brand} ${a.model}`), el('span', { class: 'mono muted' }, ` ${a.serial}`)))),
        el('div', {}, el('a', { class: 'btn', href: '#/assets' }, 'Go to the asset list')),
      ),
    );
  } else {
    side = renderEditor(doc);
  }
  review.replaceChildren(docPanel, side);
}

function manualEntry(doc) {
  doc.status = 'ready';
  doc.manual = true;
  doc.message = 'Entering by hand';
  doc.rows = [blankRow()];
  update(doc);
}

function renderEditor(doc) {
  const rowsBody = el('tbody');
  const status = el('p', { class: 'muted', 'aria-live': 'polite' });
  const confirmBtn = el('button', { type: 'button', class: 'btn primary', onclick: () => confirmImport(doc, confirmBtn, status) });

  const drawRows = () => {
    rowsBody.replaceChildren(...doc.rows.map((row, i) => rowView(doc, row, i, refresh, drawRows)));
    refresh();
  };

  // Recolours fields and recounts problems without rebuilding the inputs,
  // so typing never loses focus.
  const refresh = () => {
    const problems = validate(doc);
    [...rowsBody.children].forEach((tr, i) => {
      const row = doc.rows[i];
      for (const f of ROW_FIELDS) {
        const input = tr.querySelector(`[name="${f.key}"]`);
        const empty = !row[f.key].trim();
        input.classList.toggle('missing', !f.optional && empty);
        input.classList.toggle('guessed', !empty && row.found[f.key] === 'guessed');
      }
      const msg = tr.querySelector('.row-msg');
      const p = problems.byRow.get(i);
      msg.textContent = p?.text ?? '';
      msg.className = 'row-msg bad';
    });
    const count = doc.rows.length;
    confirmBtn.textContent = `Add ${plural(count, 'asset')} to the list`;
    confirmBtn.disabled = problems.count > 0 || !count;
    status.textContent = problems.count
      ? `${plural(problems.count, 'row needs', 'rows need')} attention before adding.`
      : count
        ? 'Everything is filled in. Check each row against the document, then add.'
        : 'Add at least one row.';
    status.className = problems.count ? 'row-msg bad' : 'muted';
  };

  const batch = el(
    'div',
    { class: 'batch-fields' },
    BATCH_FIELDS.map((f) =>
      el(
        'label',
        { class: 'field' },
        el('span', {}, f.label),
        el('input', { type: f.type ?? 'text', value: doc.batch[f.key], oninput: (e) => (doc.batch[f.key] = e.target.value) }),
      ),
    ),
  );

  const node = el(
    'section',
    { class: 'panel', 'aria-label': 'Extracted fields' },
    el(
      'div',
      { class: 'panel-head' },
      el('strong', {}, doc.manual ? 'Type the assets in' : doc.found ? `${foundText(doc)} in the document` : 'Nothing relevant found'),
      el(
        'div',
        { class: 'legend' },
        el('span', {}, el('span', { class: 'tag bad' }, 'Red'), ' not found, type it in'),
        el('span', {}, el('span', { class: 'tag warn' }, 'Amber'), ' unsure or guessed, check it'),
      ),
    ),
    el(
      'div',
      { class: 'panel-body' },
      !doc.found && !doc.manual
        ? el(
            'div',
            { class: 'notice warn' },
            'Nothing that looks like equipment (a brand, model and serial number) was found in this document. ' +
              "If it isn't a delivery order, completion document or purchase order, remove it with the × on its card. " +
              'Otherwise, type the assets in below.',
          )
        : null,
      doc.unreadable
        ? el(
            'div',
            { class: 'notice warn' },
            `${plural(doc.unreadable, 'row has', 'rows have')} equipment but no readable serial number. Find the serial on the document or on the device and type it in, or remove the row.`,
          )
        : null,
      doc.missedRows
        ? el(
            'div',
            { class: 'notice warn' },
            `The table seems to have ${plural(doc.missedRows, 'row')} that couldn't be read at all, for example under a fold or a smudge. ` +
              'Compare the rows below with the document and add any that are missing.',
          )
        : null,
      doc.note ? el('div', { class: 'notice warn' }, doc.note) : null,
      el('div', {}, el('p', { class: 'field' }, el('span', {}, 'Applies to every row from this document')), batch),
      el(
        'div',
        { class: 'table-scroll' },
        el(
          'table',
          { class: 'rows' },
          el('thead', {}, el('tr', {}, el('th', {}, '#'), ROW_FIELDS.map((f) => el('th', {}, f.label)), el('th', {}, el('span', { class: 'visually-hidden' }, 'Remove')))),
          rowsBody,
        ),
      ),
      el(
        'div',
        {},
        el(
          'button',
          {
            type: 'button',
            class: 'btn small',
            onclick: () => {
              doc.rows.push(blankRow());
              drawRows();
              rowsBody.lastElementChild?.querySelector('input')?.focus();
            },
          },
          '+ Add a row',
        ),
      ),
      el('div', { class: 'confirm-bar' }, status, confirmBtn),
    ),
  );
  drawRows();
  return node;
}

function rowView(doc, row, i, refresh, redraw) {
  let serialTimer;
  return el(
    'tr',
    {},
    el('td', {}, String(i + 1)),
    ROW_FIELDS.map((f) =>
      el(
        'td',
        {},
        el('input', {
          name: f.key,
          value: row[f.key],
          class: f.mono ? 'mono' : null,
          'aria-label': `Row ${i + 1} ${f.label}`,
          oninput: (e) => {
            row[f.key] = e.target.value;
            row.found[f.key] = 'edited';
            if (f.key === 'serial') {
              clearTimeout(serialTimer);
              serialTimer = setTimeout(() => refreshExisting(doc).then(refresh), 300);
            }
            refresh();
          },
        }),
        f.key === 'serial' ? el('div', { class: 'row-msg' }) : null,
      ),
    ),
    el(
      'td',
      {},
      el(
        'button',
        {
          type: 'button',
          class: 'icon-btn',
          title: 'Remove this row',
          'aria-label': `Remove row ${i + 1}`,
          onclick: () => {
            doc.rows.splice(i, 1);
            redraw();
          },
        },
        '×',
      ),
    ),
  );
}

function validate(doc) {
  const byRow = new Map();
  const seen = new Map();
  doc.rows.forEach((row, i) => {
    const missing = ROW_FIELDS.filter((f) => !f.optional && !row[f.key].trim()).map((f) => f.label.toLowerCase());
    const key = serialKey(row.serial);
    let text = '';
    if (missing.length) text = `Fill in ${missing.join(', ')}`;
    else if (seen.has(key)) text = `Same serial as row ${seen.get(key) + 1}`;
    else if (doc.existing.has(key)) {
      const a = doc.existing.get(key);
      text = `Already on the list as ${a.brand} ${a.model}${a.location ? ` at ${a.location}` : ''}. Remove this row.`;
    }
    if (key && !seen.has(key)) seen.set(key, i);
    if (text) byRow.set(i, { text });
  });
  return { byRow, count: byRow.size };
}

async function confirmImport(doc, button, status) {
  button.disabled = true;
  status.textContent = 'Adding…';
  try {
    const form = new FormData();
    // Keep the zip's name with the document so the asset's source is traceable.
    form.append('file', doc.file, doc.from ? `${doc.from} › ${doc.file.name}` : doc.file.name);
    if (!doc.documentId) {
      const { document } = await api('/api/documents', { method: 'POST', form });
      doc.documentId = document.id;
    }
    const rows = doc.rows.map(({ brand, model, serial, hostname }) => ({ ...doc.batch, brand, model, serial, hostname }));
    const { assets } = await api('/api/import', { method: 'POST', body: { documentId: doc.documentId, rows } });
    doc.status = 'added';
    doc.added = assets;
    doc.message = `Added ${plural(assets.length, 'asset')}`;
    toast(`${plural(assets.length, 'asset')} added to the list.`);
    update(doc);
  } catch (err) {
    if (err.status === 409 && err.data.existing) {
      await refreshExisting(doc);
      renderReview();
    }
    toast(err.message, 'bad');
    button.disabled = false;
    status.textContent = err.message;
  }
}
