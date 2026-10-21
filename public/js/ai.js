// "Read with AI" on the import screen. The server holds the API key and talks
// to the AI service (src/ai.js); this side asks permission, sends what was
// read from the document, and turns the reply into review rows.
import { api, el, toast, confirmDialog, plural } from './common.js';

let status = { enabled: false };

export async function loadAiStatus() {
  try {
    status = await api('/api/ai/status');
  } catch {
    status = { enabled: false };
  }
  return status;
}

export const aiAvailable = () => status.enabled;

const MAX_SIDE = 1344; // a larger image costs more without reading better
const normalise = (text) => String(text).toUpperCase().replace(/[^A-Z0-9]/g, '');

function toJpeg(canvas) {
  const scale = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height));
  const out = el('canvas', { width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale) });
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.85);
}

// Asks before anything leaves the app, then sends the document.
// Resolves to { rows, vendor, project, info } or null if cancelled or failed.
export async function askAndRead(doc, onStart) {
  const scans = doc.scans ?? [];
  const confirmed = await confirmDialog({
    title: 'Send this document to the AI service?',
    body: [
      el(
        'p',
        {},
        `The text the app read from ${doc.file.name}`,
        scans.length ? ` and ${plural(scans.length, 'image')} of its scanned pages` : '',
        ` will be sent to ${status.provider} (${status.model}), an outside service, to pick out the equipment.`,
      ),
      el('p', {}, "Only do this if your team's data policy allows these documents to leave your network."),
      el('p', { class: 'muted' }, 'Nothing is added to the list until you have checked the rows and confirmed.'),
    ],
    okLabel: 'Send to AI',
  });
  if (!confirmed) return null;
  onStart();
  try {
    const reply = await api('/api/ai/extract', {
      method: 'POST',
      body: { fileName: doc.file.name, text: doc.aiText, images: scans.map(toJpeg) },
    });
    return {
      rows: toRows(reply.rows, doc.aiText),
      vendor: reply.vendor,
      project: reply.project,
      info: { model: reply.model, warnings: reply.warnings, imagesRefused: reply.imagesRefused },
    };
  } catch (err) {
    toast(err.message, 'bad');
    return null;
  }
}

// Low-confidence values show amber. So does any serial the AI gave that isn't
// in the text the app read: it may be a correction of an OCR misreading, or a
// mistake, and either way a person should look.
function toRows(rows, sourceText) {
  const text = normalise(sourceText);
  return rows.map((r) => {
    const found = { hostname: 'read' };
    for (const f of ['brand', 'model', 'serial']) found[f] = !r[f] ? 'missing' : r.confidence === 'low' ? 'guessed' : 'read';
    const notes = r.note ? [/[.!?]$/.test(r.note) ? r.note : `${r.note}.`] : [];
    if (r.serial && !text.includes(normalise(r.serial))) {
      found.serial = 'guessed';
      notes.push("This serial isn't in the text the app read. Check it on the document.");
    }
    return { brand: r.brand, model: r.model, serial: r.serial, hostname: '', found, aiNote: notes.join(' ') };
  });
}

export function aiNotice(doc, onUndo) {
  const { model, warnings = [], imagesRefused } = doc.ai;
  return el(
    'div',
    { class: 'notice warn' },
    el('strong', {}, `Read with AI (${model}). `),
    'AI can misread or miss items, so check every row against the document.',
    imagesRefused ? " The AI service didn't accept the page images, so only the text was sent." : '',
    warnings.length ? el('ul', {}, warnings.map((w) => el('li', {}, w))) : null,
    ' ',
    el('button', { type: 'button', class: 'link', onclick: onUndo }, "Undo and use the app's own reading"),
  );
}
