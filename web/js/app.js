import { h, fill, $, toast, TavernIcon, TAVERN_ICON } from './ui.js';
import { api, session, getRules } from './api.js';
import { renderLobby } from './lobby.js';
import { renderCreator } from './creator.js';
import { renderRoom } from './room.js';
import { openSettings } from './settings.js';

let cleanup = null;
// the tab's icon is the top bar's sign
document.querySelector('link[rel=icon]')?.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(TAVERN_ICON)}`);
// the running server's version, asked once per page load
const version = api('GET', '/health').then(r => r.version).catch(() => null);
// the rules load alongside the first screen instead of after it
getRules().catch(() => {});

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// people: who is at the table (the room's list); elsewhere just the player
function topbar(extra = [], { people = null } = {}) {
  const p = session.player;
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand', onclick: () => navigate('#/'), title: 'Back to lobby' }, TavernIcon(), h('span', { class: 'brand-text' }, 'Tavern')),
    versionTag(),
    h('div', { class: 'grow' }, ...extra),
    p ? people ?? h('div', { class: 'at-table' }, meChip()) : null,
  );
}

const GEAR = '<svg viewBox="0 0 24 24" width="1.15em" height="1.15em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

// the settings button (your name, theme, DM agent, and in a room the
// campaign's settings for its owner), then you at the table; your name is
// only changed in settings
function meChip({ section = null } = {}) {
  const p = session.player;
  return [
    h('span', { class: 'who-on me', id: 'whoami', title: 'You' }, h('span', { class: 'online-dot' }), h('span', { class: 'who-name' }, p?.name ?? '')),
    h('button', { class: 'btn ghost settings-btn', id: 'settings', title: 'Settings', 'aria-label': 'Settings', onclick: () => openSettings({ onSaved: route, section: section?.() }) }, h('span', { class: 'gear', html: GEAR })),
  ];
}

function versionTag() {
  const el = h('span', { class: 'version', id: 'app-version', title: 'Tavern version' });
  version.then(v => (el.textContent = v ? `v${v}` : ''));
  return el;
}

async function ensurePlayer() {
  const p = session.player;
  if (p?.id) {
    try {
      session.player = await api('GET', `/players/${p.id}`);
      return true;
    } catch {
      /* re-register below */
    }
  }
  return false;
}

function signIn() {
  const input = h('input', { type: 'text', id: 'player-name', placeholder: 'e.g. Patrick', maxlength: 32, autofocus: true });
  const go = async () => {
    if (!input.value.trim()) return toast('Pick a name', 'error');
    try {
      session.player = await api('POST', '/players', { name: input.value.trim() });
      route();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  input.addEventListener('keydown', e => e.key === 'Enter' && go());
  const app = $('#app');
  fill(app, topbar(), h('div', { class: 'lobby' }, h('div', { class: 'card', style: { maxWidth: '420px', margin: '4rem auto' } },
    h('h1', {}, 'Welcome, traveler'),
    h('p', { class: 'muted' }, 'A strict D&D 5e table run by an AI dungeon master on your phosphorus mesh. What should the table call you?'),
    h('p', { class: 'small dim' }, 'Been here before? Use the same name to pick up your characters.'),
    input, h('div', { class: 'modal-foot' }, h('button', { class: 'btn primary', id: 'sign-in', onclick: go }, 'Enter the tavern')))));
  input.focus();
}

async function route() {
  cleanup?.();
  cleanup = null;
  const app = $('#app');
  if (!(await ensurePlayer())) return signIn();
  const hash = location.hash || '#/';
  const m = /^#\/(campaign|create|edit)\/([\w]+)/.exec(hash);
  try {
    if (m?.[1] === 'create') cleanup = await renderCreator(app, m[2], { topbar, navigate });
    else if (m?.[1] === 'edit') cleanup = await renderCreator(app, null, { topbar, navigate, editId: m[2] });
    else if (m?.[1] === 'campaign') cleanup = await renderRoom(app, m[2], { topbar, navigate, meChip });
    else cleanup = await renderLobby(app, { topbar, navigate });
  } catch (e) {
    console.error(e);
    fill(app, topbar(), h('div', { class: 'empty' }, h('p', {}, `Something went wrong: ${e.message}`), h('button', { class: 'btn', onclick: () => navigate('#/') }, 'Back to lobby')));
  }
}

window.addEventListener('hashchange', route);
route();
