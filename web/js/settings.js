import { h, fill, toast, modal } from './ui.js';
import { api, session } from './api.js';

// the player's own settings: their name and the agent running the DM (phos's
// chimp by default, or another mesh model); opened from their name in the top bar
let cache = null;
let cacheAt = 0;
const CACHE_MS = 30000;

async function loadAgents(refresh = false) {
  if (!refresh && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  cache = await api('GET', `/agents${refresh ? '?refresh=1' : ''}`);
  cacheAt = Date.now();
  return cache;
}

// long model names keep their start and their end: "tower · Qwen3-30B-A3B…Q4_K_M.gguf"
export function shorten(s, max = 34) {
  const t = String(s ?? '');
  if (t.length <= max) return t;
  const tail = Math.floor((max - 1) / 3);
  return `${t.slice(0, max - 1 - tail)}…${t.slice(-tail)}`;
}

function agentError(a) {
  const chimp = a.chimp;
  return a.status?.status === 'offline' ? a.status.error : a.error ?? (!a.selected && chimp && !chimp.ready ? chimp.why : null);
}

// the DM's model, picked from a dropdown: phos's chimp, then each mesh group's models
function agentList() {
  const select = h('select', { id: 'settings-agent', 'aria-label': 'DM agent', disabled: true }, h('option', {}, 'Asking phos for its models…'));
  const note = h('div', { class: 'small muted agent-note' });
  const option = (id, label, { on, ready = true, why = '' }) => h('option', { value: id, selected: on, disabled: !ready && !on, title: why || label }, `${label}${ready ? '' : ' (down)'}`);
  const draw = a => {
    const chimp = a.chimp;
    const groups = (a.groups ?? []).filter(g => g.models.length);
    const sub = chimp?.model ? chimp.model.replace(/^phos\//, '') : a.reachable ? 'no model loaded' : 'phos unreachable';
    fill(select,
      option('', `Phos's chimp · ${shorten(sub, 40)}`, { on: !a.selected, ready: !!chimp?.ready || (!chimp && a.reachable), why: chimp?.why }),
      groups.map(g => h('optgroup', { label: g.name }, g.models.map(m => option(m.id, shorten(m.name, 60), { on: m.id === a.selected, ready: m.ready, why: m.why })))));
    select.value = a.selected ?? '';
    select.disabled = false;
    const err = agentError(a);
    fill(note, err ? h('span', { class: 'err' }, err) : `Through phos at ${a.phos ?? '(not configured)'}.`);
  };
  select.addEventListener('change', async () => {
    const id = select.value;
    select.disabled = true;
    try {
      cache = await api('PUT', '/agents', { model: id });
      cacheAt = Date.now();
      draw(cache);
      toast(id ? `DM agent: ${shorten(id, 40)}` : "DM agent: phos's chimp");
    } catch (e) {
      toast(e.message, 'error');
      if (cache) draw(cache);
      else select.disabled = false;
    }
  });
  loadAgents(true).then(draw).catch(e => {
    fill(select, h('option', {}, 'Models unavailable'));
    fill(note, h('span', { class: 'err' }, e.message));
  });
  return [select, note];
}

// light, dark, or whatever the system prefers; applied at once and remembered on this device
const THEMES = { system: 'System', light: 'Light', dark: 'Dark' };
export function currentTheme() {
  try {
    return THEMES[localStorage.getItem('tavern.theme')] ? localStorage.getItem('tavern.theme') : 'system';
  } catch {
    return 'system';
  }
}
function setTheme(t) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('tavern.theme', t);
  } catch {
    /* private mode */
  }
}
function themePicker() {
  const seg = h('div', { class: 'seg theme-seg', role: 'radiogroup', 'aria-label': 'Theme' });
  const draw = () => fill(seg, Object.entries(THEMES).map(([k, label]) => h('button', { class: `btn small${currentTheme() === k ? ' active' : ''}`, role: 'radio', 'aria-checked': String(currentTheme() === k), 'data-theme-pick': k, onclick: () => (setTheme(k), draw()) }, label)));
  draw();
  return seg;
}

// section: an extra part from the page that opened it (the campaign's own
// settings in a room), { title, nodes, save, foot }
export function openSettings({ onSaved, section = null } = {}) {
  const p = session.player;
  const name = h('input', { type: 'text', id: 'settings-name', value: p?.name ?? '', maxlength: 32 });
  const save = async () => {
    const v = name.value.trim();
    try {
      await section?.save?.();
      if (v && v !== p?.name) {
        session.player = await api('POST', '/players', { id: p?.id, name: v });
        m.close();
        return onSaved?.();
      }
      m.close();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  name.addEventListener('keydown', e => e.key === 'Enter' && save());
  const m = modal([
    h('h2', {}, 'Settings'),
    h('label', { for: 'settings-name' }, 'Your name at the table'), name,
    h('label', {}, 'Appearance'), themePicker(),
    h('h4', { style: { marginTop: '1.2rem' } }, 'Dungeon Master'),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, 'The model that runs the DM for every campaign on this tavern.'),
    agentList(),
    section ? [h('h4', { style: { marginTop: '1.2rem' } }, section.title), section.nodes] : null,
    h('div', { class: 'modal-foot' }, section?.foot ? [section.foot(() => m.close()), h('span', { class: 'grow' })] : null, h('button', { class: 'btn', onclick: () => m.close() }, 'Close'), h('button', { class: 'btn primary', id: 'settings-save', onclick: save }, 'Save')),
  ]);
  name.focus();
  return m;
}
