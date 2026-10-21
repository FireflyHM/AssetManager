// Change history: who added, edited, removed or imported what, and when.
import { api, el, toast, formatDateTime, LABELS, plural } from './common.js';

const VERBS = {
  added: 'added',
  imported: 'added',
  edited: 'edited',
  removed: 'removed',
  replaced: 'replaced',
  restored: 'put back on the list',
};

export function renderHistoryItem(h, { showAsset = true } = {}) {
  const changes = Object.entries(h.changes ?? {});
  const details =
    h.action === 'edited'
      ? changes.map(([f, [from, to]]) => el('li', {}, `${LABELS[f] ?? f}: ${from || '(blank)'} → ${to || '(blank)'}`))
      : [];
  // Removals and replacements have a reason; other actions just have a note.
  if (h.reason) details.push(el('li', {}, ['removed', 'replaced'].includes(h.action) ? `Reason: ${h.reason}` : h.reason));
  if (h.document_name) details.push(el('li', {}, `From ${h.document_name}`));
  return el(
    'li',
    {},
    el(
      'div',
      { class: 'what' },
      el('span', {}, h.by_name, ' '),
      VERBS[h.action] ?? h.action,
      showAsset ? [' ', el('a', { href: `#/assets/${h.asset_id}` }, `${h.brand} ${h.model}`), el('span', { class: 'mono muted' }, ` ${h.serial}`)] : '',
    ),
    el('div', { class: 'when' }, formatDateTime(h.at), h.action === 'edited' ? ` · ${plural(changes.length, 'field')} changed` : ''),
    details.length ? el('ul', {}, details) : null,
  );
}

export async function loadHistory() {
  try {
    const { history } = await api('/api/history?limit=300');
    const list = document.getElementById('history-list');
    list.replaceChildren(
      ...(history.length
        ? history.map((h) => renderHistoryItem(h))
        : [el('li', { class: 'empty' }, 'No changes yet.')]),
    );
  } catch (err) {
    toast(err.message, 'bad');
  }
}
