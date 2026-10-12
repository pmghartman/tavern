import { h, fill, toast, modal, timeAgo, confirmBox } from './ui.js';
import { api, upload, events, session, getRules } from './api.js';

// adventure modules the owner has dropped in, kept current over the lobby's event stream
let modules = [];
const watchers = new Set();
const setModules = list => {
  modules = list;
  for (const f of [...watchers]) f();
};
// runs fn on every change while el is on the page
const watchModules = (el, fn) => {
  const f = () => (el.isConnected ? fn() : watchers.delete(f));
  watchers.add(f);
  fn();
};

const PHASE = { queued: 'Waiting', reading: 'Reading the file', parsing: 'Preparing scenes' };

// the drop zone and the list of modules with their progress
function modulesPanel() {
  const list = h('div', { class: 'modlist' });
  const input = h('input', { type: 'file', accept: '.pdf,.txt,.md,.markdown,.html,.htm', hidden: true });
  const send = async file => {
    if (!file) return toast('No file came through. Click the box to choose the PDF instead.', 'error');
    if (file.size > 512 * 1024 * 1024) return toast(`${file.name} is larger than 512 MB.`, 'error');
    try {
      toast(`Uploading ${file.name}...`, 'info', 8000);
      await upload('/modules', file);
      toast(`${file.name} is being read`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  input.onchange = () => send(input.files[0]).then(() => (input.value = ''));
  const drop = h('div', { class: 'dropzone', tabindex: 0, role: 'button', onclick: () => input.click(), onkeydown: e => (e.key === 'Enter' || e.key === ' ') && input.click() },
    h('b', {}, 'Drop an adventure module here'), h('span', { class: 'small muted' }, 'PDF, or text pasted into a .txt, .md or .html file. Or click to choose a file.'));
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, e => (e.preventDefault(), drop.classList.add('over')));
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, e => (e.preventDefault(), drop.classList.remove('over')));
  drop.addEventListener('drop', e => send(e.dataTransfer?.files?.[0]));
  const box = h('div', { class: 'modules' }, drop, input,
    h('p', { class: 'small muted' }, 'The DM reads the module once, cover to cover: a few minutes for a short adventure, an hour or more for a long book, several hours for a scanned one. It then runs it as written with no further waiting. Files stay on this server.'), list);
  watchModules(box, () => fill(list, ...(modules.length ? modules.map(row) : [h('p', { class: 'small dim' }, 'No modules yet.')])));
  return box;
}

function row(m) {
  const busy = ['queued', 'reading', 'parsing'].includes(m.status);
  const act = fn => async e => {
    e.target.disabled = true;
    try {
      await fn();
    } catch (err) {
      toast(err.message, 'error');
      e.target.disabled = false;
    }
  };
  return h('div', { class: 'modrow', 'data-module': m.id },
    h('div', { class: 'grow' },
      h('b', {}, m.name),
      m.status === 'ready' ? h('div', { class: 'small muted' }, [m.levels ? `levels ${m.levels.join('-')}` : '', m.pages ? `${m.pages} pages` : '', `${m.chapters} chapters`, `${m.scenes} scenes`, `${m.creatures + (m.srdCreatures ?? 0)} stat blocks`, m.unplayable?.length ? `${m.unplayable.length} not playable (${m.unplayable.join(', ')})` : '', m.ocrPages ? `${m.ocrPages} pages read by OCR` : '', m.unreadPages ? `${m.unreadPages} pages unreadable` : '', m.skipped ? `${m.skipped} passages skipped` : ''].filter(Boolean).join(' · ')) : null,
      busy ? h('div', { class: 'small muted' }, `${m.phase || PHASE[m.status]}${m.total ? ` · ${m.done}/${m.total}` : ''}`, m.total ? h('progress', { max: m.total, value: m.done }) : null) : null,
      !busy && m.status !== 'ready' ? h('div', { class: 'small err' }, m.error || 'Preparation stopped.') : null),
    m.status === 'ready' ? h('span', { class: 'pill green' }, 'ready') : busy ? h('span', { class: 'pill' }, h('span', { class: 'spinner' })) : null,
    m.status === 'paused' ? h('button', { class: 'btn small', onclick: act(() => api('POST', `/modules/${m.id}/resume`)) }, 'Resume') : null,
    !busy && m.rereadable ? h('button', { class: 'btn small', title: 'Read the whole file again from the start', onclick: async e => {
      if (!(await confirmBox(`Read ${m.name} again from the start? For a long book this takes a while; campaigns already running it keep their copy.`))) return;
      await act(() => api('POST', `/modules/${m.id}/reread`))(e);
    } }, 'Read again') : null,
    h('button', { class: 'btn small danger', onclick: async e => {
      if (!(await confirmBox(`Delete the module ${m.name}? It can be added again from the file.`))) return;
      await act(() => api('DELETE', `/modules/${m.id}`))(e);
    } }, 'Delete'));
}

function modulesDialog() {
  const m = modal([h('h2', {}, 'Adventure modules'), modulesPanel(), h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Close'))]);
}

export async function renderLobby(app, { topbar, navigate }) {
  const rules = await getRules();
  const grid = h('div', { class: 'campaigns', id: 'campaigns' });
  const archived = h('section', { class: 'archived', id: 'archived' });
  const models = h('span', { class: 'small muted', id: 'model-status' }, '');
  fill(app, topbar([models]), h('main', { class: 'lobby' },
    h('div', { class: 'lobby-head' },
      h('div', {}, h('h1', {}, 'Campaigns'), h('p', { class: 'muted', style: { margin: 0 } }, 'Pick a campaign to join its table, or start a new one.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', id: 'modules-btn', onclick: modulesDialog }, 'Modules'),
        h('button', { class: 'btn primary', id: 'new-campaign', onclick: () => newCampaign(rules, navigate) }, '+ New campaign'))),
    grid, archived));

  const me = session.player;
  const draw = list => {
    if (!list.length) {
      fill(grid, h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, h('p', {}, 'No campaigns yet. The tavern is quiet.'), h('button', { class: 'btn primary', onclick: () => newCampaign(rules, navigate) }, 'Start the first campaign')));
      return;
    }
    fill(grid, ...list.map(c => {
      if (c.damaged) return h('article', { class: 'card camp', 'data-campaign': c.id }, h('h3', {}, c.name), h('p', { class: 'small err' }, 'This campaign could not be read. Its data is kept; a backup is in data/backups.'));
      const mine = c.characters.find(ch => ch.playerId === me.id && !ch.dead);
      return h('article', { class: 'card camp', 'data-campaign': c.id },
        h('div', { class: 'row' }, h('h3', { class: 'grow' }, c.name), c.inCombat ? h('span', { class: 'pill red' }, 'In combat') : null, c.settingStatus === 'generating' ? h('span', { class: 'pill' }, h('span', { class: 'spinner' }), ' worldbuilding') : null),
        h('div', { class: 'small muted' }, [c.world, c.location].filter(Boolean).join(' · '), ' · ', `level ${c.startLevel}+ · ${c.leveling}`),
        c.overview ? h('div', { class: 'overview' }, c.overview) : null,
        h('div', { class: 'chars' }, c.characters.length ? c.characters.map(ch => h('span', { class: `pill${ch.playerId === me.id ? ' gold' : ''}` }, `${ch.name} · ${ch.race} ${ch.class}${ch.dead ? ' †' : ''}`)) : h('span', { class: 'small dim' }, 'No adventurers yet')),
        h('div', { class: 'small muted' }, c.online.length ? [h('span', { class: 'online-dot' }), `${c.online.map(o => o.name).join(', ')} online`] : 'Nobody at the table', ' · ', `active ${timeAgo(c.updated)}`),
        c.lastMessage ? h('div', { class: 'small dim', style: { fontStyle: 'italic' } }, `“${c.lastMessage.content}”`) : null,
        h('div', { class: 'row', style: { marginTop: 'auto' } },
          mine ? h('button', { class: 'btn primary', onclick: () => navigate(`#/campaign/${c.id}`) }, `Play as ${mine.name}`) : h('button', { class: 'btn primary', onclick: () => navigate(`#/create/${c.id}`) }, 'Join: create character'),
          h('button', { class: 'btn', onclick: () => navigate(`#/campaign/${c.id}`) }, mine ? 'Enter' : 'Watch')));
    }));
  };
  draw(await api('GET', '/campaigns'));
  api('GET', '/modules').then(setModules).catch(() => {});
  api('GET', '/config').then(cfg => {
    if (cfg.models.length) return;
    models.textContent = cfg.dmAvailable ? '' : 'No DM model configured: rules-only mode';
  }).catch(() => {});

  // archived campaigns stay on disk; their owner can bring them back
  let showArchived = false;
  const drawArchived = async () => {
    const list = await api('GET', '/campaigns?status=archived').catch(() => []);
    if (!list.length) return fill(archived);
    fill(archived,
      h('button', { class: 'btn ghost small', id: 'toggle-archived', onclick: () => ((showArchived = !showArchived), drawArchived()) }, `${showArchived ? '▾' : '▸'} Archived (${list.length})`),
      showArchived ? h('div', { class: 'archived-list' }, list.map(c => h('div', { class: 'row archived-row', 'data-archived': c.id },
        h('span', { class: 'grow' }, h('b', {}, c.name), h('span', { class: 'small muted' }, ` · ${c.characters?.length ?? 0} adventurer(s) · last played ${timeAgo(c.updated)}`)),
        c.ownerId === me.id || !c.ownerId ? h('button', { class: 'btn small', onclick: async () => {
          if (!(await confirmBox(`Restore ${c.name} to the active campaigns?`))) return;
          try {
            await api('PATCH', `/campaigns/${c.id}`, { status: 'active' });
            toast(`${c.name} restored`);
          } catch (e) {
            toast(e.message, 'error');
          }
        } }, 'Restore') : h('span', { class: 'tiny dim' }, 'owner can restore or delete'),
        c.ownerId === me.id || !c.ownerId ? h('button', { class: 'btn small danger', 'data-delete': c.id, onclick: async () => {
          if (!(await confirmBox(`Delete ${c.name} for good? Its story, characters, journal and chat are erased, and this cannot be undone.`))) return;
          try {
            await api('DELETE', `/campaigns/${c.id}`);
            toast(`${c.name} deleted`);
            drawArchived();
          } catch (e) {
            toast(e.message, 'error');
          }
        } }, 'Delete') : null))) : null);
  };
  drawArchived();
  const es = events('/lobby/events', { campaigns: list => (draw(list), drawArchived()), modules: setModules });
  return () => {
    es.close();
    watchers.clear();
  };
}

function newCampaign(rules, navigate) {
  const f = {
    name: h('input', { type: 'text', id: 'camp-name', placeholder: 'The Lost Mine of...', maxlength: 60 }),
    preset: h('select', { id: 'camp-preset' }),
    custom: h('textarea', { rows: 3, id: 'camp-custom', placeholder: 'Optional: describe the world, themes, or a premise for the DM to build on.' }),
    startLevel: h('input', { type: 'number', min: 1, max: 20, value: 1, id: 'camp-level' }),
    leveling: h('select', { id: 'camp-leveling' }, h('option', { value: 'xp' }, 'Experience points'), h('option', { value: 'milestone' }, 'Milestones')),
    allowDeadly: h('input', { type: 'checkbox', id: 'camp-deadly' }),
  };
  // the setting list: the modules that are ready first, then a world of the DM's own
  const about = h('p', { class: 'small muted', id: 'camp-about' });
  const custom0 = f.custom.placeholder;
  let autoName = '';
  const picked = () => modules.find(m => `module:${m.id}` === f.preset.value && m.status === 'ready');
  const drawPresets = () => {
    const keep = f.preset.value;
    const ready = modules.filter(m => m.status === 'ready');
    const working = modules.filter(m => m.status !== 'ready');
    fill(f.preset,
      ready.length || working.length ? h('optgroup', { label: 'Your modules' }, ready.map(m => h('option', { value: `module:${m.id}` }, `${m.name}${m.levels ? ` (levels ${m.levels.join('-')})` : ''}`)), working.map(m => h('option', { value: `module:${m.id}`, disabled: true }, `${m.name} (${m.status === 'parsing' ? `preparing ${m.done}/${m.total}` : m.status})`))) : null,
      h('optgroup', { label: 'Your own world' }, Object.entries(rules.presets).map(([k, p]) => h('option', { value: k }, p.name)), h('option', { value: 'custom' }, 'Custom (describe below)')));
    if ([...f.preset.options].some(o => o.value === keep)) f.preset.value = keep;
  };
  const onPick = () => {
    const m = picked();
    fill(about, m?.premise ?? '');
    f.custom.placeholder = m ? 'Optional notes for the DM: house rules, where to begin, what to skip.' : custom0;
    if (!m) return;
    if (m.levels) f.startLevel.value = m.levels[0];
    if (!f.name.value.trim() || f.name.value === autoName) f.name.value = autoName = m.name;
  };
  f.preset.addEventListener('change', onPick);
  const status = h('div', { class: 'small muted' });
  const btn = h('button', { class: 'btn primary', id: 'camp-create' }, 'Create campaign');
  const m = modal([
    h('h2', {}, 'New campaign'),
    h('label', {}, 'Name'), f.name,
    h('label', {}, 'Setting'), f.preset,
    about,
    h('label', {}, 'Premise'), f.custom,
    h('div', { class: 'row' }, h('div', { class: 'grow' }, h('label', {}, 'Starting level'), f.startLevel), h('div', { class: 'grow' }, h('label', {}, 'Leveling'), f.leveling)),
    h('label', { style: { display: 'flex', gap: '.5em', alignItems: 'center' } }, f.allowDeadly, 'Allow encounters beyond deadly difficulty'),
    h('p', { class: 'small muted' }, 'The DM model builds a world of its own, or runs one of your adventure modules as written. Without a model, an offline generator is used.'),
    status,
    h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), btn),
  ]);
  watchModules(f.preset, () => {
    drawPresets();
    onPick();
  });
  f.name.focus();
  btn.onclick = async () => {
    btn.disabled = true;
    const mod = picked();
    fill(status, h('span', { class: 'spinner' }), mod ? ' Setting up the table...' : ' The DM is building your world...');
    try {
      const c = await api('POST', '/campaigns', { name: f.name.value, ...(mod ? { moduleId: mod.id } : { preset: f.preset.value }), custom: f.custom.value, startLevel: Number(f.startLevel.value), leveling: f.leveling.value, allowDeadly: f.allowDeadly.checked });
      m.close();
      toast(`${c.name} is ready`);
      navigate(`#/create/${c.id}`);
    } catch (e) {
      fill(status, h('span', { class: 'err' }, e.message));
      btn.disabled = false;
    }
  };
}
