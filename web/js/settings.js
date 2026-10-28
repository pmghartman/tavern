import { h, fill, toast, modal } from './ui.js';
import { api, session } from './api.js';

// the player's own settings: their name, the agent running the DM (phosphorus's
// pick for its tavern agent by default, or another mesh model) and this
// tavern's update from upstream; opened from their name in the top bar
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
  const auto = a.auto;
  return a.status?.status === 'offline' ? a.status.error : a.error ?? (!a.selected && auto && !auto.ready ? auto.why : null);
}

// phosphorus's pick for tavern, as the first option reads
function autoLabel(a) {
  const auto = a.auto;
  if (!auto) return a.reachable ? 'no model loaded' : 'phosphorus unreachable';
  const host = auto.host || auto.model.replace(/^phosphorus\//, '');
  return auto.chosen ? `${host}, assigned on phosphorus` : `${host}, phosphorus's automatic pick`;
}

// the DM's model, picked from a dropdown: phosphorus's pick for its tavern agent, then each mesh group's models
function agentList() {
  const select = h('select', { id: 'settings-agent', 'aria-label': 'DM agent', disabled: true }, h('option', {}, 'Asking phosphorus for its models…'));
  const note = h('div', { class: 'small muted agent-note' });
  const option = (id, label, { on, ready = true, why = '' }) => h('option', { value: id, selected: on, disabled: !ready && !on, title: why || label }, `${label}${ready ? '' : ' (down)'}`);
  const draw = a => {
    const auto = a.auto;
    const groups = (a.groups ?? []).filter(g => g.models.length);
    fill(select,
      option('', `Phosphorus's pick · ${shorten(autoLabel(a), 44)}`, { on: !a.selected, ready: !!auto?.ready, why: auto?.why }),
      groups.map(g => h('optgroup', { label: g.name }, g.models.map(m => option(m.id, shorten(m.name, 60), { on: m.id === a.selected, ready: m.ready, why: m.why })))));
    select.value = a.selected ?? '';
    select.disabled = false;
    const err = agentError(a);
    fill(note, err ? h('span', { class: 'err' }, err) : `Through phosphorus at ${a.phos ?? '(not configured)'}. Phosphorus's Agents page assigns the Tavern agent's model for every tavern on the mesh.`);
  };
  select.addEventListener('change', async () => {
    const id = select.value;
    select.disabled = true;
    try {
      cache = await api('PUT', '/agents', { model: id });
      cacheAt = Date.now();
      draw(cache);
      toast(id ? `DM agent: ${shorten(id, 40)}` : "DM agent: phosphorus's pick");
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

// --- this tavern's update ---------------------------------------------------

const POLL_MS = 2000;

function fmtWhen(t) {
  return t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}

// the running version, the update button and, once pressed, the update's log
// as it comes; the page reloads itself when the server comes back newer
function updateBox() {
  const line = h('div', { class: 'small muted update-line' }, 'Asking the server…');
  const log = h('pre', { class: 'update-log', hidden: true });
  const btn = h('button', { class: 'btn small', id: 'settings-update', disabled: true }, 'Update from source');
  let timer = null;
  let running = null;
  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };
  const show = s => {
    running = s.version;
    const parts = [`Tavern v${s.version}`];
    if (s.state === 'running') parts.push(`updating since ${fmtWhen(s.startedAt)}…`);
    else if (s.state === 'ok') parts.push(s.restartNeeded ? `updated to v${s.to}; restart tavern to run it` : s.to && s.to !== s.from ? `updated from v${s.from} at ${fmtWhen(s.finishedAt)}` : `up to date, checked at ${fmtWhen(s.finishedAt)}`);
    else if (s.state === 'failed') parts.push(h('span', { class: 'err' }, s.error ?? `update failed (exit ${s.code})`));
    else if (!s.canUpdate) parts.push(s.why ?? 'cannot update here');
    fill(line, parts.flatMap((p, i) => (i ? [' · ', p] : [p])));
    log.textContent = s.log ?? '';
    log.hidden = !s.log || s.state === 'idle';
    if (!log.hidden) log.scrollTop = log.scrollHeight;
    btn.disabled = !s.canUpdate || s.state === 'running';
    btn.textContent = s.state === 'running' ? 'Updating…' : 'Update from source';
  };
  // while an update runs the server restarts under us: a failed poll is just that
  const poll = async () => {
    stop();
    let s;
    try {
      s = await api('GET', '/update');
    } catch {
      if (running) fill(line, `Tavern v${running}`, ' · ', 'restarting…');
      timer = setTimeout(poll, POLL_MS);
      return;
    }
    if (running && s.version !== running) {
      toast(`Tavern is now v${s.version}; reloading`);
      setTimeout(() => location.reload(), 1200);
      return;
    }
    show(s);
    if (s.state === 'running') timer = setTimeout(poll, POLL_MS);
  };
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      show(await api('POST', '/update', {}));
      timer = setTimeout(poll, POLL_MS);
    } catch (e) {
      toast(e.message, 'error');
      poll();
    }
  });
  poll();
  return { nodes: [h('div', { class: 'update-row' }, line, btn), log], stop };
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
  const update = updateBox();
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
    h('h4', { style: { marginTop: '1.2rem' } }, 'This tavern'),
    h('p', { class: 'small muted', style: { marginTop: 0 } }, 'Pull the latest Tavern from its source repository, rebuild, and restart the server. Campaigns and settings are kept.'),
    update.nodes,
    h('div', { class: 'modal-foot' }, section?.foot ? [section.foot(() => m.close()), h('span', { class: 'grow' })] : null, h('button', { class: 'btn', onclick: () => m.close() }, 'Close'), h('button', { class: 'btn primary', id: 'settings-save', onclick: save }, 'Save')),
  ], { onClose: update.stop });
  name.focus();
  return m;
}
