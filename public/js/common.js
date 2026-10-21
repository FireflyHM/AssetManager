// Shared helpers: API calls, the current user's name, DOM building, toasts.

export const FIELDS = [
  { key: 'brand', label: 'Brand', required: true },
  { key: 'model', label: 'Model', required: true },
  { key: 'serial', label: 'Serial number', required: true, mono: true },
  { key: 'hostname', label: 'Hostname / label', hint: 'Name or asset tag on the device' },
  { key: 'location', label: 'Location', hint: 'e.g. DC1, Hall 2, Rack A01, U12' },
  { key: 'project', label: 'Project' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'warranty_end', label: 'Warranty end', type: 'date' },
  { key: 'maintenance', label: 'Maintenance agreement', hint: 'Contract name or number. Leave blank if not covered.', wide: true },
  { key: 'notes', label: 'Notes', type: 'textarea', wide: true },
];

export const LABELS = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = { 'x-user-name': getUser() };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify({ by: getUser(), ...body });
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0, {});
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status}).`, res.status, data);
  return data;
}

// The name is a per-browser convenience, so storage failures just mean asking again.
let userName = '';
export function getUser() {
  if (!userName) {
    try {
      userName = localStorage.getItem('assetManager.user') || '';
    } catch {}
  }
  return userName;
}
export function setUser(name) {
  userName = name.trim();
  try {
    localStorage.setItem('assetManager.user', userName);
  } catch {}
}

// el('a', { href: '#', class: 'x', onclick: fn }, 'text', childNode)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

export function toast(message, kind = '') {
  const node = el('div', { class: `toast ${kind}`, role: kind === 'bad' ? 'alert' : 'status' }, message);
  document.getElementById('toasts').append(node);
  setTimeout(() => node.remove(), kind === 'bad' ? 8000 : 5000);
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

export const serialKey = (s) => String(s ?? '').trim().toUpperCase();

// Days until a YYYY-MM-DD date; negative when it has passed.
export function daysUntil(isoDate) {
  if (!isoDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${isoDate}T00:00:00`) - today) / 86400000);
}

export function warrantyTag(isoDate) {
  const days = daysUntil(isoDate);
  if (days == null) return null;
  if (days < 0) return el('span', { class: 'tag bad' }, 'Expired');
  if (days <= 90) return el('span', { class: 'tag warn' }, `${days} days left`);
  return null;
}

// Shows a yes/no dialog and resolves true when the person confirms.
export function confirmDialog({ title, body, okLabel = 'Save', danger = false, validate }) {
  const dialog = document.getElementById('confirm-dialog');
  const ok = document.getElementById('confirm-ok');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-body').replaceChildren(...[body].flat());
  ok.textContent = okLabel;
  ok.className = `btn ${danger ? 'danger' : 'primary'}`;
  return new Promise((resolve) => {
    const onClick = (e) => {
      if (validate && !validate()) e.preventDefault();
    };
    ok.addEventListener('click', onClick);
    dialog.addEventListener(
      'close',
      () => {
        ok.removeEventListener('click', onClick);
        resolve(dialog.returnValue === 'ok');
      },
      { once: true },
    );
    dialog.returnValue = '';
    dialog.showModal();
  });
}

// A list of "Field: old → new" lines.
export function changeList(changes) {
  return el(
    'ul',
    { class: 'changes' },
    Object.entries(changes).map(([field, [from, to]]) =>
      el(
        'li',
        {},
        el('strong', {}, LABELS[field] ?? field),
        el(
          'span',
          {},
          from ? el('span', { class: 'from' }, from) : el('span', { class: 'muted' }, '(blank)'),
          ' → ',
          to ? el('span', { class: 'to' }, to) : el('span', { class: 'muted' }, '(blank)'),
        ),
      ),
    ),
  );
}
