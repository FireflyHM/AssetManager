import { getUser, setUser } from './common.js';
import { initAssets, loadAssets, openEditor } from './assets.js';
import { initImporter } from './importer.js';
import { loadHistory } from './history.js';

const views = ['assets', 'import', 'history'];

function route() {
  const [, view = 'assets', id] = location.hash.match(/^#\/(\w+)(?:\/(\d+))?/) ?? [];
  const current = views.includes(view) ? view : 'assets';
  for (const v of views) document.getElementById(`view-${v}`).hidden = v !== current;
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.view === current) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (current === 'assets') {
    loadAssets();
    if (id) {
      openEditor(Number(id));
      history.replaceState(null, '', '#/assets');
    }
  }
  if (current === 'history') loadHistory();
}

function askName({ required }) {
  const dialog = document.getElementById('name-dialog');
  const input = document.getElementById('name-input');
  input.value = getUser();
  dialog.oncancel = (e) => {
    if (required) e.preventDefault();
  };
  dialog.showModal();
}

document.getElementById('name-form').addEventListener('submit', (e) => {
  const value = document.getElementById('name-input').value.trim();
  if (!value) {
    e.preventDefault();
    return;
  }
  setUser(value);
  document.getElementById('user-name').textContent = value;
});

document.getElementById('user-chip').addEventListener('click', () => askName({ required: false }));

// Light/dark toggle. Until someone picks, the page follows the system setting.
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const themeButton = document.getElementById('theme-toggle');

function activeTheme() {
  return document.documentElement.dataset.theme ?? (darkQuery.matches ? 'dark' : 'light');
}

function showTheme() {
  const active = activeTheme();
  document.documentElement.dataset.themeActive = active;
  const label = `Switch to ${active === 'dark' ? 'light' : 'dark'} mode`;
  themeButton.setAttribute('aria-label', label);
  themeButton.title = label;
}

themeButton.addEventListener('click', () => {
  const next = activeTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('assetManager.theme', next);
  } catch {}
  showTheme();
});
darkQuery.addEventListener('change', showTheme);
showTheme();

initAssets();
initImporter();
window.addEventListener('hashchange', route);
document.getElementById('user-name').textContent = getUser() || '—';
route();
if (!getUser()) askName({ required: true });
