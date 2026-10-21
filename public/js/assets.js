// Asset list: search, add, edit, remove and restore.
import {
  FIELDS, LABELS, api, el, toast, formatDate, plural, warrantyTag, confirmDialog, changeList, serialKey,
} from './common.js';
import { renderHistoryItem } from './history.js';

const state = { q: '', filter: '', status: 'active', loadId: 0 };
const $ = (id) => document.getElementById(id);

export function initAssets() {
  let timer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = e.target.value;
      loadAssets();
    }, 200);
  });
  $('filter').addEventListener('change', (e) => {
    state.filter = e.target.value;
    loadAssets();
  });
  for (const btn of document.querySelectorAll('.segmented button')) {
    btn.addEventListener('click', () => {
      state.status = btn.dataset.status;
      for (const b of document.querySelectorAll('.segmented button')) b.setAttribute('aria-pressed', String(b === btn));
      loadAssets();
    });
  }
  $('add-asset-btn').addEventListener('click', () => openEditor(null));

  const exportBtn = $('export-btn');
  const exportMenu = $('export-menu');
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.hidden = !exportMenu.hidden;
    exportBtn.setAttribute('aria-expanded', String(!exportMenu.hidden));
  });
  document.addEventListener('click', () => {
    exportMenu.hidden = true;
    exportBtn.setAttribute('aria-expanded', 'false');
  });

  const dialog = $('asset-dialog');
  for (const b of dialog.querySelectorAll('[data-close]')) b.addEventListener('click', () => dialog.close());
  $('asset-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveAsset();
  });
  $('remove-btn').addEventListener('click', removeAsset);
  $('replace-btn').addEventListener('click', openReplace);
  const replaceDialog = $('replace-dialog');
  for (const b of replaceDialog.querySelectorAll('[data-close]')) b.addEventListener('click', () => replaceDialog.close());
  $('replace-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitReplace();
  });
  $('restore-btn').addEventListener('click', restoreAsset);
}

export async function loadAssets() {
  const id = ++state.loadId;
  const params = new URLSearchParams({ q: state.q, filter: state.filter, status: state.status });
  try {
    const { assets, counts } = await api(`/api/assets?${params}`);
    if (id !== state.loadId) return; // a newer search has started
    renderAssets(assets, counts);
  } catch (err) {
    toast(err.message, 'bad');
  }
}

function renderAssets(assets, counts) {
  const total = state.status === 'removed' ? counts.removed : counts.active;
  const filtered = state.q || state.filter;
  $('asset-count').textContent =
    state.status === 'removed'
      ? `${plural(counts.removed, 'removed asset')} · ${plural(counts.active, 'asset')} on the list`
      : filtered
        ? `Showing ${assets.length} of ${plural(total, 'asset')} on the list`
        : `${plural(total, 'asset')} on the list`;

  const tbody = $('asset-table').querySelector('tbody');
  tbody.replaceChildren(
    ...assets.map((a) =>
      el(
        'tr',
        {
          tabindex: '0',
          onclick: () => openEditor(a.id),
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openEditor(a.id);
            }
          },
        },
        el('td', {}, a.brand),
        el('td', {}, a.model),
        el('td', { class: 'mono' }, a.serial),
        el('td', {}, a.location),
        el('td', {}, a.project),
        el(
          'td',
          {},
          state.status === 'removed'
            ? el('span', { class: 'tag info', title: a.removed_reason }, `Removed: ${a.removed_reason}`)
            : a.maintenance || el('span', { class: 'tag warn' }, 'Not covered'),
        ),
        el('td', {}, a.warranty_end ? [formatDate(a.warranty_end), ' ', warrantyTag(a.warranty_end)] : ''),
      ),
    ),
  );

  const empty = $('asset-empty');
  empty.hidden = assets.length > 0;
  if (!assets.length) {
    empty.replaceChildren(
      filtered
        ? 'No assets match. Check the spelling, or try part of the serial number.'
        : state.status === 'removed'
          ? 'Nothing has been removed from the list.'
          : el(
              'span',
              {},
              'The list is empty. ',
              el('button', { type: 'button', class: 'link', onclick: () => openEditor(null) }, 'Add an asset'),
              ' or ',
              el('a', { href: '#/import' }, 'add assets from vendor documents'),
              '.',
            ),
    );
  }
}

// ---- Editor ----

let editing = null; // the asset as loaded, or null when adding
let serialTimer;

export async function openEditor(id) {
  const dialog = $('asset-dialog');
  editing = null;
  let history = [];
  if (id != null) {
    try {
      ({ asset: editing, history } = await api(`/api/assets/${id}`));
    } catch (err) {
      toast(err.message, 'bad');
      return;
    }
  }
  fillEditor(editing, history);
  if (!dialog.open) dialog.showModal();
  dialog.querySelector(editing?.status === 'removed' ? '[data-close]' : 'input').focus();
}

function fillEditor(asset, history = []) {
  const removed = asset?.status === 'removed';
  duplicateShown = false;
  $('asset-dialog-title').textContent = asset ? `${asset.brand} ${asset.model}` : 'Add asset';
  $('remove-btn').hidden = !asset || removed;
  $('replace-btn').hidden = !asset || removed;
  $('restore-btn').hidden = !removed;
  $('save-btn').hidden = removed;
  $('save-btn').textContent = asset ? 'Save changes' : 'Add to list';

  const notice = $('asset-notice');
  notice.hidden = !removed;
  notice.className = 'notice warn';
  if (removed) {
    const last = history.find((h) => h.action === 'removed' || h.action === 'replaced');
    notice.replaceChildren(
      `Removed from the list${last ? ` by ${last.by_name} on ${formatDate(last.at)}` : ''}. Reason: ${asset.removed_reason}`,
    );
  }

  $('asset-fields').replaceChildren(
    ...fieldNodes(asset ?? {}, { container: $('asset-fields'), disabled: removed, onSerialInput: checkSerial }),
  );

  // Where the asset came from, and what it replaced or was replaced by.
  const link = (a) =>
    el('button', { type: 'button', class: 'link', onclick: () => openEditor(a.id) }, `${a.brand} ${a.model} (${a.serial})`);
  const lines = [
    asset?.source_doc_id
      ? el('span', {}, 'Added from ', el('a', { href: `/api/documents/${asset.source_doc_id}/file`, target: '_blank', rel: 'noopener' }, asset.source_doc_name))
      : null,
    asset?.replaces ? el('span', {}, 'Replaces ', link(asset.replaces)) : null,
    asset?.replaced_by ? el('span', {}, 'Replaced by ', link(asset.replaced_by)) : null,
  ].filter(Boolean);
  const source = $('asset-source');
  source.hidden = !lines.length;
  source.replaceChildren(...lines);

  const details = $('asset-history');
  details.hidden = !history.length;
  details.open = false;
  details.querySelector('ol').replaceChildren(...history.map((h) => renderHistoryItem(h, { showAsset: false })));
}

// The labelled inputs for every asset field, used by the editor and the
// replace form.
function fieldNodes(values, { container, disabled = false, onSerialInput = null }) {
  return FIELDS.map((f) => {
    const value = values[f.key] ?? '';
    const input =
      f.type === 'textarea'
        ? el('textarea', { name: f.key, rows: 3 }, value)
        : el('input', { name: f.key, type: f.type ?? 'text', value, class: f.mono ? 'mono' : null });
    input.disabled = disabled;
    if (f.key === 'serial' && onSerialInput) input.addEventListener('input', () => onSerialInput(input.value));
    input.addEventListener('input', () => clearFieldError(f.key, container));
    return el(
      'label',
      { class: `field${f.wide ? ' wide' : ''}`, dataset: { field: f.key } },
      el('span', {}, f.label, f.required ? el('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
      input,
      f.hint ? el('span', { class: 'hint' }, f.hint) : null,
      el('span', { class: 'error', hidden: true }),
    );
  });
}

function readForm(form = $('asset-form')) {
  return Object.fromEntries(FIELDS.map((f) => [f.key, form.elements[f.key].value.trim()]));
}

// Marks empty required fields; returns true when all are filled in.
function checkRequired(fields, container) {
  let ok = true;
  for (const f of FIELDS) {
    if (f.required && !fields[f.key]) {
      showFieldError(f.key, `${f.label} is required.`, container);
      ok = false;
    }
  }
  if (!ok) container.querySelector('[aria-invalid="true"]').focus();
  return ok;
}

function showFieldError(key, message, container = $('asset-fields')) {
  const field = container.querySelector(`[data-field="${key}"]`);
  field.classList.add('invalid');
  const err = field.querySelector('.error');
  err.textContent = message;
  err.hidden = false;
  field.querySelector('input, textarea').setAttribute('aria-invalid', 'true');
}

function clearFieldError(key, container = $('asset-fields')) {
  const field = container.querySelector(`[data-field="${key}"]`);
  field.classList.remove('invalid');
  field.querySelector('.error').hidden = true;
  field.querySelector('input, textarea').removeAttribute('aria-invalid');
}

function showNotice(kind, ...content) {
  const notice = $('asset-notice');
  notice.className = `notice ${kind}`;
  notice.replaceChildren(...content);
  notice.hidden = false;
}

// Warns while typing if the serial number is already on the list.
function checkSerial(value) {
  clearTimeout(serialTimer);
  const key = serialKey(value);
  if (!key || (editing && key === serialKey(editing.serial))) {
    hideDuplicate();
    return;
  }
  serialTimer = setTimeout(async () => {
    try {
      const { existing } = await api('/api/serials/check', { method: 'POST', body: { serials: [value] } });
      const match = existing.find((a) => a.id !== editing?.id);
      if (match) showDuplicate(match);
      else hideDuplicate();
    } catch {}
  }, 300);
}

let duplicateShown = false;

function hideDuplicate() {
  if (duplicateShown) $('asset-notice').hidden = true;
  duplicateShown = false;
}

function showDuplicate(match) {
  duplicateShown = true;
  showNotice(
    'bad',
    `Serial number ${match.serial} is already on the list as ${match.brand} ${match.model}`,
    match.location ? ` at ${match.location}` : '',
    '. ',
    el('button', { type: 'button', class: 'link', onclick: () => openEditor(match.id) }, 'Open that asset'),
  );
}

async function saveAsset() {
  const fields = readForm();
  if (!checkRequired(fields, $('asset-fields'))) return;

  // Show exactly what will change and ask before saving.
  const changes = {};
  for (const f of FIELDS) {
    const before = editing?.[f.key] ?? '';
    if (fields[f.key] !== before) changes[f.key] = [before, fields[f.key]];
  }
  if (!Object.keys(changes).length) {
    toast('Nothing has changed.');
    $('asset-dialog').close();
    return;
  }
  const confirmed = await confirmDialog({
    title: editing ? 'Save these changes?' : 'Add this asset?',
    body: [
      el('p', {}, editing ? `${editing.brand} ${editing.model} · ${editing.serial}` : 'This will be added to the list:'),
      changeList(changes),
    ],
    okLabel: editing ? 'Save changes' : 'Add to list',
  });
  if (!confirmed) return;

  try {
    const { asset } = editing
      ? await api(`/api/assets/${editing.id}`, { method: 'PUT', body: { fields, version: editing.version } })
      : await api('/api/assets', { method: 'POST', body: { fields } });
    $('asset-dialog').close();
    toast(editing ? `Saved changes to ${asset.brand} ${asset.model} (${asset.serial}).` : `Added ${asset.brand} ${asset.model} (${asset.serial}) to the list.`);
    loadAssets();
  } catch (err) {
    handleSaveError(err);
  }
}

function handleSaveError(err) {
  if (err.status === 409 && err.data.current) {
    // Someone else saved first: show their version instead of overwriting it.
    const theirs = err.data.current;
    showNotice(
      'bad',
      `${err.message} `,
      el('button', { type: 'button', class: 'link', onclick: () => openEditor(theirs.id) }, 'Load their version'),
    );
  } else if (err.status === 409 && err.data.existing) {
    showDuplicate(err.data.existing);
    showFieldError('serial', 'Already on the list.');
  } else if (err.status === 400 && err.data.field) {
    showFieldError(err.data.field, err.message);
  } else {
    showNotice('bad', err.message);
  }
}

async function removeAsset() {
  const reasons = ['Decommissioned', 'Returned to vendor', 'Moved to another site', 'Entered by mistake', 'Other'];
  const select = el('select', { id: 'remove-reason' }, el('option', { value: '' }, 'Choose a reason…'), reasons.map((r) => el('option', {}, r)));
  const detail = el('input', { type: 'text', maxlength: '200', placeholder: 'Optional details, e.g. change ticket' });
  const error = el('span', { class: 'error', hidden: true }, 'Choose a reason.');
  const a = editing;
  const confirmed = await confirmDialog({
    title: 'Remove this asset from the list?',
    body: [
      el(
        'div',
        { class: 'notice warn' },
        el('strong', {}, `${a.brand} ${a.model}`),
        el('br'),
        `Serial ${a.serial}`,
        a.location ? ` · ${a.location}` : '',
      ),
      el('label', { class: 'field' }, el('span', {}, 'Why is it being removed?'), select, error),
      el('label', { class: 'field' }, el('span', {}, 'Details'), detail),
      el('p', { class: 'muted' }, 'It will move to the Removed list, where it can be put back if this was a mistake.'),
    ],
    okLabel: 'Remove from list',
    danger: true,
    validate: () => {
      error.hidden = Boolean(select.value);
      return Boolean(select.value);
    },
  });
  if (!confirmed) return;
  const reason = detail.value.trim() ? `${select.value}: ${detail.value.trim()}` : select.value;
  try {
    await api(`/api/assets/${a.id}/remove`, { method: 'POST', body: { reason, version: a.version } });
    $('asset-dialog').close();
    toast(`Removed ${a.brand} ${a.model} (${a.serial}) from the list.`);
    loadAssets();
  } catch (err) {
    handleSaveError(err);
  }
}

// ---- Replace ----

// Fields a replacement usually shares with what it replaces: it goes in the
// same place, does the same job and is often under the same contract.
const CARRY_OVER = ['hostname', 'location', 'project', 'vendor', 'maintenance'];
let replacing = null;

function openReplace() {
  replacing = editing;
  const a = replacing;
  $('asset-dialog').close();
  $('replace-title').textContent = `Replace ${a.brand} ${a.model}`;
  $('replace-old').replaceChildren(
    el('strong', {}, 'Taking off the list: '),
    `${a.brand} ${a.model} · Serial ${a.serial}`,
    a.location ? ` · ${a.location}` : '',
  );
  $('replace-reason').value = '';
  $('replace-detail').value = '';
  $('replace-reason-error').hidden = true;
  $('replace-notice').hidden = true;
  const values = Object.fromEntries(CARRY_OVER.map((k) => [k, a[k]]));
  $('replace-fields').replaceChildren(...fieldNodes(values, { container: $('replace-fields') }));
  $('replace-dialog').showModal();
  $('replace-reason').focus();
}

async function submitReplace() {
  const old = replacing;
  const fields = readForm($('replace-form'));
  const reasonOk = Boolean($('replace-reason').value);
  $('replace-reason-error').hidden = reasonOk;
  if (!checkRequired(fields, $('replace-fields')) || !reasonOk) {
    if (!reasonOk) $('replace-reason').focus();
    return;
  }
  const detail = $('replace-detail').value.trim();
  const reason = detail ? `${$('replace-reason').value}: ${detail}` : $('replace-reason').value;

  // Old and new side by side, so a wrong brand or serial is easy to spot.
  const differences = {};
  for (const f of FIELDS) if ((old[f.key] ?? '') !== fields[f.key]) differences[f.key] = [old[f.key] ?? '', fields[f.key]];
  const kept = CARRY_OVER.filter((k) => fields[k] && fields[k] === old[k]);
  const confirmed = await confirmDialog({
    title: 'Replace this asset?',
    body: [
      el(
        'ul',
        { class: 'changes' },
        el('li', {}, el('strong', {}, 'Moves to Removed'), `${old.brand} ${old.model} (${old.serial}). Reason: ${reason}`),
        el('li', {}, el('strong', {}, 'Added in its place'), `${fields.brand} ${fields.model} (${fields.serial})`),
      ),
      el('p', { class: 'muted' }, 'Old → new:'),
      changeList(differences),
      kept.length ? el('p', { class: 'muted' }, `Kept the same: ${kept.map((k) => LABELS[k].toLowerCase()).join(', ')}.`) : null,
    ],
    okLabel: 'Replace asset',
  });
  if (!confirmed) return;

  try {
    const { asset } = await api(`/api/assets/${old.id}/replace`, {
      method: 'POST',
      body: { fields, reason, version: old.version },
    });
    $('replace-dialog').close();
    toast(`Replaced ${old.brand} ${old.model} (${old.serial}) with ${asset.brand} ${asset.model} (${asset.serial}).`);
    loadAssets();
  } catch (err) {
    const notice = $('replace-notice');
    notice.className = 'notice bad';
    notice.hidden = false;
    if (err.status === 409 && err.data.existing) {
      const e = err.data.existing;
      notice.replaceChildren(`Serial number ${e.serial} is already on the list as ${e.brand} ${e.model}${e.location ? ` at ${e.location}` : ''}.`);
      showFieldError('serial', 'Already on the list.', $('replace-fields'));
    } else if (err.status === 400 && err.data.field && err.data.field !== 'reason') {
      notice.hidden = true;
      showFieldError(err.data.field, err.message, $('replace-fields'));
    } else {
      notice.replaceChildren(err.message);
    }
  }
}

async function restoreAsset() {
  const a = editing;
  try {
    await api(`/api/assets/${a.id}/restore`, { method: 'POST', body: {} });
    $('asset-dialog').close();
    toast(`Put ${a.brand} ${a.model} (${a.serial}) back on the list.`);
    loadAssets();
  } catch (err) {
    if (err.status === 409) showNotice('bad', err.message);
    else toast(err.message, 'bad');
  }
}
