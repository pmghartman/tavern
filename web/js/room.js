import { h, fill, toast, md, colorFor, clockLabel, confirmBox, popover, $ } from './ui.js';
import { api, events, session, getRules } from './api.js';
import { renderSheet, classLabelOf } from './sheet.js';
import { drawMap, mapHit, FULL_CELL, GUTTER } from './map.js';
import { initGlossary, annotate } from './glossary.js';

// a plain line-drawn map pin for where the party is
const LOC_ICON = '<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 14.5s-4.5-4.6-4.5-8a4.5 4.5 0 0 1 9 0c0 3.4-4.5 8-4.5 8z"/><circle cx="8" cy="6.5" r="1.6"/></svg>';

export async function renderRoom(app, campaignId, { topbar, navigate, meChip }) {
  const rules = await getRules();
  initGlossary(rules);
  const me = session.player;
  let view = await api('GET', `/campaigns/${campaignId}`);
  let channel = 'dm';
  let selectedChar = null;
  let options = null;
  let mapMode = null;
  // the map fills the panel it sits in, as wide and as tall as there is room for, down to a readable minimum
  const cellSize = () => {
    const m = view.encounter?.map;
    if (!m) return FULL_CELL;
    const cs = getComputedStyle(combatEl);
    const availW = combatEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 4 - GUTTER;
    const availH = Math.max(220, window.innerHeight * 0.62) - GUTTER;
    if (availW <= 0) return FULL_CELL;
    // a phone fits the whole field with smaller squares rather than scrolling it
    return Math.max(narrowMq.matches ? 14 : 20, Math.min(44, Math.floor(Math.min(availW / m.width, availH / m.height))));
  };
  const unread = { dm: 0, party: 0 };
  const myChar = () => view.characters.find(c => c.playerId === me.id && !c.dead) ?? view.characters.find(c => c.playerId === me.id);

  // the right panel: the sheet, the party or the journal, or none so the chat gets the room
  const PANELS = { combat: 'Combat', sheet: 'Character', party: 'Party', journal: 'Journal' };
  const narrowMq = window.matchMedia('(max-width: 860px)');
  let panel = (() => {
    try {
      return localStorage.getItem('tavern.panel');
    } catch {
      return null;
    }
  })();
  if (panel === 'none') panel = null;
  else if (!PANELS[panel]) panel = narrowMq.matches ? null : 'sheet';
  const panelTabs = h('nav', { class: 'panel-tabs', role: 'tablist', 'aria-label': 'Side panels' });
  const panelBody = h('div', { class: 'panel-body', id: 'panel-body' });
  const right = h('aside', { class: 'side right', id: 'side-panel' }, panelBody);
  // where the party is and who is at the table live in the top bar
  const sceneEl = h('div', { class: 'scene', id: 'scenebar' });
  const tableEl = h('div', { class: 'at-table', id: 'online-list' });
  const combatEl = h('div', { class: 'combat hidden', id: 'combat' });
  const exploreEl = h('div', { class: 'explore hidden', id: 'explore' });
  let exploreOpen = (() => {
    try {
      return localStorage.getItem('tavern.exploreOpen') !== '0';
    } catch {
      return true;
    }
  })();
  const tabs = h('div', { class: 'tabs' });
  const logs = { dm: h('div', { class: 'log', id: 'log-dm' }), party: h('div', { class: 'log hidden', id: 'log-party' }) };
  const typing = h('div', { class: 'typing', id: 'typing' });
  const actionbar = h('div', { class: 'actionbar', id: 'actionbar' });
  const input = h('textarea', { id: 'chat-input', rows: 2, placeholder: 'Say what your character does or says...' });
  const sendBtn = h('button', { class: 'btn primary', id: 'send' }, 'Send');
  const composer = h('div', { class: 'composer' }, actionbar, h('div', { class: 'row', style: { alignItems: 'flex-end' } }, h('div', { class: 'grow' }, input), sendBtn));
  // where the party stands and where it can go sits just above the chat box
  const center = h('section', { class: 'center' }, tabs, logs.dm, logs.party, exploreEl, typing, composer);
  // with room to spare the area panel moves into the chat pane's left margin, beside the story
  const placeExplore = () => center.classList.toggle('side-explore', center.clientWidth >= 1100 && !exploreEl.classList.contains('hidden'));
  new ResizeObserver(placeExplore).observe(center);
  // the tab open before a fight, put back when it ends
  let beforeFight = null;
  let wasFighting = false;
  const onResize = () => view.encounter?.status === 'active' && drawCombat();
  const scrim = h('div', { class: 'drawer-scrim', onclick: () => showPanel(null) });
  const room = h('div', { class: 'room' }, center, right, panelTabs, scrim);
  const onKey = e => e.key === 'Escape' && panel && narrowMq.matches && showPanel(null);
  document.addEventListener('keydown', onKey);
  const titleEl = h('span', { class: 'room-title', title: view.name }, view.name);
  fill(app, topbar([titleEl, sceneEl], { people: tableEl }), room);

  // chat follows new messages unless the reader scrolled up to read history
  for (const log of Object.values(logs)) {
    log.pinned = true;
    log.addEventListener('scroll', () => (log.pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 80));
    // panels above the log (combat, exploration) resize it; keep the newest line in view
    new ResizeObserver(() => log.pinned && (log.scrollTop = log.scrollHeight)).observe(log);
  }
  function stickToBottom(log, force = false) {
    if (!force && !log.pinned) return;
    log.pinned = true;
    log.scrollTop = log.scrollHeight;
    requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
  }

  // chat rendering
  function renderMessage(m) {
    const mine = m.authorId === me.id;
    if (m.data?.for && m.data.for !== me.id && (m.data.rejected || m.data.help)) return null;
    if (m.kind === 'roll') {
      const evs = m.data?.events ?? m.content.split('\n').map(t => ({ type: 'info', text: t }));
      return h('div', { class: 'rollcard', 'data-kind': 'roll' }, evs.map(e => h('div', { class: `ev ${e.type}`, html: md(e.text).replace(/CRITICAL HIT!/g, '<span class="crit">CRITICAL HIT!</span>') })));
    }
    if (m.kind === 'system' && m.data?.turn) return turnCard(m);
    if (m.kind === 'system') {
      const cls = ['msg', 'system'];
      if (m.data?.rejected) cls.push('rejected');
      if (m.data?.turn) cls.push('turn');
      if (m.data?.help) cls.push('help');
      return h('div', { class: cls.join(' '), 'data-kind': 'system' }, m.content);
    }
    if (m.kind === 'player') return h('div', { class: `msg player${mine ? '' : ' other'}`, 'data-kind': 'player' }, h('div', { class: 'who' }, h('b', {}, m.speaker ?? m.authorName), m.speaker && m.authorName ? ` (${m.authorName})` : ''), h('div', { class: 'body', html: md(m.data?.action ? `*${m.content}*` : m.content) }));
    if (m.kind === 'npc' || m.kind === 'companion') return h('div', { class: `msg ${m.kind}`, 'data-kind': m.kind, style: { '--who': colorFor(m.speaker) } }, h('div', { class: 'who', style: { color: colorFor(m.speaker) } }, m.speaker), h('div', { class: 'body', html: md(m.content) }));
    if (m.data?.ooc) return h('div', { class: 'msg dm ooc', 'data-kind': 'dm' }, h('div', { class: 'who' }, 'DM · out of character'), h('div', { class: 'body', html: md(m.content) }));
    return h('div', { class: 'msg dm', 'data-kind': 'dm' }, h('div', { class: 'who' }, 'The Dungeon Master'), h('div', { class: 'body', html: md(m.content) }));
  }
  // whose turn it is: a banner with the round and what that character has to spend
  function turnCard(m) {
    const d = m.data;
    // older notices carry only their text
    const t = /^Round (\d+): it is (.+?)'s turn \((\d+) ft movement, action(, bonus action)?\)/.exec(m.content) ?? [];
    const round = d.round ?? t[1];
    const name = d.name ?? t[2] ?? '';
    const move = d.movement ?? t[3];
    const bonus = d.bonus ?? !!t[4];
    const mine = d.playerId === me.id;
    if (d.deathSave) {
      // a dying character's turn: three marks each way, and the roll is the player's
      const marks = (n, cls) => h('span', { class: `ds-marks ${cls}` }, Array.from({ length: 3 }, (_, i) => h('i', { class: i < n ? 'on' : '' })));
      return h('div', { class: `turn-card dying${mine ? ' mine' : ''}`, 'data-kind': 'turn', role: 'status' },
        round ? h('div', { class: 'tc-round' }, h('span', {}, 'Round'), h('b', {}, round)) : null,
        h('div', { class: 'tc-main' },
          h('div', { class: 'tc-name' }, mine ? 'You are dying' : `${name} is dying`),
          h('div', { class: 'tc-eco' }, h('span', { class: 'ds-label' }, 'Successes'), marks(d.deathSave.successes, 'ok'), h('span', { class: 'ds-label' }, 'Failures'), marks(d.deathSave.failures, 'bad'))),
        mine ? h('div', { class: 'tc-hint' }, 'Roll with the button below, /deathsave, or just say something. 10 or higher succeeds; three successes and you stabilize, three failures and you die. A natural 20 brings you back with 1 hit point.') : null);
    }
    return h('div', { class: `turn-card${mine ? ' mine' : ''}`, 'data-kind': 'turn', role: 'status' },
      round ? h('div', { class: 'tc-round' }, h('span', {}, 'Round'), h('b', {}, round)) : null,
      h('div', { class: 'tc-main' },
        h('div', { class: 'tc-name' }, mine ? 'Your turn' : `${name}'s turn`),
        h('div', { class: 'tc-eco' },
          h('span', { class: 'eco action' }, h('span', { class: 'eco-icon' }), 'Action'),
          bonus ? h('span', { class: 'eco bonus' }, h('span', { class: 'eco-icon' }), 'Bonus action') : null,
          move !== undefined && move !== null ? h('span', { class: 'eco move' }, h('span', { class: 'eco-icon' }), `${move} ft`) : null)),
      mine ? h('div', { class: 'tc-hint' }, 'Say what you do, or pick from the tray below.') : null);
  }

  // a DM reply lands as several messages at once (narration, NPC lines): each unfurls just after the last
  let revealAt = 0;
  let revealN = 0;
  function addMessage(m, scroll = true) {
    const log = logs[m.channel] ?? logs.dm;
    const el = annotate(renderMessage(m));
    if (!el) return;
    if (scroll && (m.kind === 'dm' || m.kind === 'npc')) {
      const now = performance.now();
      revealN = now - revealAt < 400 ? revealN + 1 : 0;
      revealAt = now;
      el.classList.add('reveal');
      el.style.setProperty('--delay', `${Math.min(revealN, 6) * 160}ms`);
    }
    log.append(el);
    if (scroll) stickToBottom(log, m.authorId === me.id);
    if (m.channel !== channel) {
      unread[m.channel] += 1;
      drawTabs();
    }
  }
  const [dmMsgs, partyMsgs] = await Promise.all([api('GET', `/campaigns/${campaignId}/messages?channel=dm&limit=200`), api('GET', `/campaigns/${campaignId}/messages?channel=party&limit=200`)]);
  // history lands without the arrival animation
  Object.values(logs).forEach(l => l.classList.add('loading'));
  dmMsgs.forEach(m => addMessage(m, false));
  partyMsgs.forEach(m => addMessage(m, false));
  setTimeout(() => Object.values(logs).forEach(l => l.classList.remove('loading')), 300);
  unread.dm = 0;
  unread.party = 0;
  requestAnimationFrame(() => Object.values(logs).forEach(l => stickToBottom(l, true)));

  function drawTabs() {
    fill(tabs,
      h('div', { class: `tab${channel === 'dm' ? ' on' : ''}`, id: 'tab-dm', 'data-channel': 'dm' }, 'Story', unread.dm ? h('span', { class: 'badge' }, unread.dm) : null),
      h('div', { class: `tab${channel === 'party' ? ' on' : ''}`, id: 'tab-party', 'data-channel': 'party' }, 'Party chat', unread.party ? h('span', { class: 'badge' }, unread.party) : null),
      h('div', { class: 'grow' }),
      h('div', { class: 'small muted hint' }, channel === 'party' ? 'Out of character: the DM does not hear this (companions do).' : 'Talk to the DM and the world.'));
  }
  function setChannel(c) {
    channel = c;
    unread[c] = 0;
    logs.dm.classList.toggle('hidden', c !== 'dm');
    logs.party.classList.toggle('hidden', c !== 'party');
    drawTabs();
    drawActions();
    typing.classList.toggle('hidden', c !== 'dm');
    stickToBottom(logs[c], true);
    input.placeholder = c === 'party' ? 'Talk to your party...' : 'Say what your character does or says...';
  }
  tabs.addEventListener('click', e => {
    const t = e.target.closest('[data-channel]');
    if (t) setChannel(t.dataset.channel);
  });
  drawTabs();

  // sending
  async function send(text) {
    const t = (text ?? input.value).trim();
    if (!t) return;
    if (!text) input.value = '';
    if (pending) cancelIntent();
    try {
      await api('POST', `/campaigns/${campaignId}/messages`, { channel, content: t, characterId: myChar()?.id });
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  sendBtn.onclick = () => send();
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') cancelIntent();
    if (e.key === 'Enter' && !e.shiftKey && pending?.picked?.length) {
      // multi-target spells: Enter casts at the targets picked so far
      e.preventDefault();
      return run(pending.build(pending.picked), pending.text);
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  async function act(action) {
    const ch = myChar();
    if (!ch) return toast('Create a character first.', 'error');
    try {
      await api('POST', `/characters/${ch.id}/action`, { action });
      mapMode = null;
      return true;
    } catch (e) {
      toast(e.message, 'error', 6000);
      return false;
    }
  }

  // scene, table, panels, combat
  function drawScene() {
    const s = view.scene ?? {};
    titleEl.textContent = titleEl.title = view.name;
    fill(sceneEl,
      h('span', { class: 'loc', title: s.location ?? 'Unknown' }, h('span', { class: 'loc-icon', 'aria-hidden': 'true', html: LOC_ICON }), h('b', {}, s.location ?? 'Unknown')),
      h('span', { class: 'light' }, '☀ ', s.light ?? 'bright'),
      h('span', { class: 'clock' }, '🕯 ', clockLabel(view.clock?.minute ?? 0)),
      s.shop ? h('span', { class: 'pill gold' }, `🛒 ${s.shop.name}`) : null,
      view.dmModel === 'online' ? null : h('span', { class: 'muted', title: 'No DM model: play with / commands' }, 'rules only'));
  }

  // who is at the table: you first (your settings), then everyone else online
  function drawTable() {
    const others = view.online.filter(o => o.id !== me.id);
    const [meTag, gear] = meChip({ section: campaignSettings });
    fill(tableEl, meTag, others.slice(0, 4).map(o => h('span', { class: 'who-on', title: `${o.name} is at the table` }, h('span', { class: 'online-dot' }), h('span', { class: 'who-name' }, o.name))), others.length > 4 ? h('span', { class: 'who-on more', title: others.slice(4).map(o => o.name).join(', ') }, `+${others.length - 4}`) : null, gear);
  }

  // a tab opens its panel; the open tab closes it again
  function showPanel(p) {
    panel = p;
    try {
      localStorage.setItem('tavern.panel', p ?? 'none');
    } catch {
      /* private mode */
    }
    drawPanel();
    if (panel === 'combat') drawCombat();
  }

  function drawPanel() {
    // the combat tab exists only while there is a fight
    const fighting = view.encounter?.status === 'active';
    if (panel === 'combat' && !fighting) panel = beforeFight;
    fill(panelTabs, Object.entries(PANELS).filter(([k]) => k !== 'combat' || fighting).map(([k, label]) => h('button', { class: `tab${panel === k ? ' on' : ''}${k === 'combat' ? ' combat-tab' : ''}`, role: 'tab', 'aria-selected': String(panel === k), 'aria-controls': 'side-panel', 'data-panel': k, title: panel === k ? `Hide ${label.toLowerCase()}` : label, onclick: () => showPanel(panel === k ? null : k) }, label)));
    room.classList.toggle('panel-open', !!panel);
    room.classList.toggle('panel-combat', panel === 'combat');
    right.classList.toggle('hidden', !panel);
    panelBody.classList.toggle('is-sheet', panel === 'sheet');
    panelBody.classList.toggle('is-combat', panel === 'combat');
    if (panel === 'combat') fill(panelBody, combatEl);
    else if (panel === 'party') drawParty();
    else if (panel === 'journal') drawJournal();
    else if (panel === 'sheet') drawSheet();
  }

  function drawParty() {
    const mine = myChar();
    const memberEl = c => {
      const ratio = c.maxHp ? c.hp / c.maxHp : 0;
      const online = view.online.some(o => o.id === c.playerId);
      return h('div', { class: `member${c.playerId === me.id ? ' me' : ''}`, 'data-member': c.id, title: 'Open character sheet', onclick: () => {
        selectedChar = c.id;
        showPanel('sheet');
      } },
      h('div', { class: 'row' }, online ? h('span', { class: 'online-dot', title: 'online' }) : null, h('span', { class: 'nm grow' }, c.name), c.dead ? h('span', { class: 'pill red' }, 'dead') : c.hp <= 0 ? h('span', { class: 'pill red' }, 'down') : null),
      h('div', { class: 'small muted' }, `${rules.races[c.race]?.name} ${classLabelOf(c, rules)}`),
      h('div', { class: 'small' }, `HP ${c.hp}/${c.maxHp}${c.tempHp ? ` (+${c.tempHp})` : ''}`),
      h('div', { class: `hpbar ${ratio > 0.6 ? 'ok' : ratio > 0.3 ? 'mid' : ''}` }, h('div', { style: { width: `${Math.max(0, Math.min(100, ratio * 100))}%` } })),
      c.pendingLevelUp ? h('div', { class: 'small', style: { color: 'var(--gold2)' } }, '★ Level up available') : null);
    };
    if (panel !== 'party') return;
    fill(panelBody,
      view.characters.filter(c => !c.retired).map(memberEl),
      mine ? null : h('button', { class: 'btn primary', style: { width: '100%' }, id: 'join-btn', onclick: () => navigate(`#/create/${campaignId}`) }, 'Create a character to join'),
      view.companions?.length ? [h('h4', { style: { marginTop: '1rem' } }, 'Companions'), view.companions.map(c => h('div', { class: 'member' }, h('div', { class: 'nm' }, c.name), h('div', { class: 'small muted' }, `${c.key} · HP ${c.hp}/${c.maxHp}`), h('div', { class: 'tiny dim' }, c.personality)))] : null);
  }

  // the party's journal: what they set out to do, who and what they know, their notes
  const JOURNAL = { quests: 'Quests', people: 'People', places: 'Places', lore: 'Lore', notes: 'Notes', chronicle: 'Chronicle' };
  let journalTab = (() => {
    try {
      return localStorage.getItem('tavern.journalTab');
    } catch {
      return null;
    }
  })();
  if (!JOURNAL[journalTab]) journalTab = 'quests';
  let journalQuery = '';
  let journalExtra = { notes: null, chronicle: null };
  const journalSearch = h('input', { type: 'search', class: 'journal-search', id: 'journal-search', placeholder: 'Search the journal…', 'aria-label': 'Search the journal' });
  journalSearch.addEventListener('input', () => {
    journalQuery = journalSearch.value.trim().toLowerCase();
    drawJournalBody();
  });
  const journalTabs = h('nav', { class: 'journal-tabs', role: 'tablist' });
  const journalBody = h('div', { class: 'journal-body', id: 'journal-body' });
  const matches = (...parts) => !journalQuery || parts.join(' ').toLowerCase().includes(journalQuery);
  const entry = (title, body, extra = null, attrs = {}) => h('article', { class: 'journal-entry', ...attrs }, h('div', { class: 'row' }, h('h5', { class: 'grow' }, title), extra), body ? h('p', {}, body) : null);
  const empty = text => h('p', { class: 'journal-empty' }, journalQuery ? 'Nothing in this section matches.' : text);

  async function loadJournalExtra(kind) {
    try {
      journalExtra[kind] = kind === 'notes' ? await api('GET', `/campaigns/${campaignId}/memories?kind=note`) : (await api('GET', `/campaigns/${campaignId}/chronicle`)).content ?? '';
    } catch (e) {
      journalExtra[kind] = e;
    }
    if (panel === 'journal' && journalTab === kind) drawJournalBody();
  }

  function journalQuests() {
    const status = q => /^\[(completed|failed)\]/.exec(q.content)?.[1] ?? 'active';
    const qs = (view.quests ?? []).filter(q => matches(q.title, q.content));
    const group = (label, list) => (list.length ? [h('h4', {}, label), list.map(q => entry(q.title, q.content.replace(/^\[\w+\]\s*/, ''), status(q) === 'active' ? null : h('span', { class: `pill ${status(q) === 'completed' ? 'green' : 'red'}` }, status(q)), { class: `journal-entry quest ${status(q)}` }))] : null);
    if (!qs.length) return empty('No quests yet. They appear here as the story gives them to you.');
    return [group('Under way', qs.filter(q => status(q) === 'active')), group('Done', qs.filter(q => status(q) !== 'active'))];
  }

  function journalPeople() {
    const npcs = [...(view.npcs ?? [])].reverse().filter(n => matches(n.name, n.role, n.location ?? '', ...(n.secretsKnown ?? [])));
    const comps = (view.companions ?? []).filter(c => matches(c.name, c.personality ?? ''));
    if (!npcs.length && !comps.length) return empty('Nobody yet. The people you meet are written down here.');
    return [
      comps.length ? [h('h4', {}, 'Travelling with you'), comps.map(c => entry(c.name, c.personality, h('span', { class: 'pill green' }, 'companion')))] : null,
      npcs.length ? [h('h4', {}, 'Met along the way'), npcs.map(n => h('article', { class: 'journal-entry', 'data-npc': n.name },
        h('div', { class: 'row' }, h('h5', { class: 'grow', style: { color: colorFor(n.name) } }, n.name), h('span', { class: `pill ${{ friendly: 'green', hostile: 'red' }[n.attitude] ?? ''}` }, n.attitude ?? 'indifferent'), n.charmed ? h('span', { class: 'pill gold' }, 'charmed') : null, n.status ? h('span', { class: `pill ${n.status === 'dead' ? 'red' : ''}` }, n.status) : null),
        h('p', {}, n.role, n.location ? h('span', { class: 'muted' }, ` · ${n.location}`) : null),
        (n.secretsKnown ?? []).map(s => h('p', { class: 'journal-secret' }, s))))] : null,
    ];
  }

  function journalPlaces() {
    const places = (view.places ?? []).filter(p => matches(p.name, p.description));
    if (!places.length) return empty('Places you visit or hear of are written down here.');
    return places.map(p => entry(p.name, p.description, p.here ? h('span', { class: 'pill gold' }, 'you are here') : null));
  }

  function journalLore() {
    const facts = (view.factionsKnown ?? []).filter(f => matches(f.name, f.description));
    const rep = (view.world?.factions ?? []).filter(f => matches(f.name));
    const clues = [...(view.world?.clues ?? [])].reverse().filter(c => matches(c.title, c.content));
    if (!facts.length && !rep.length && !clues.length) return empty('Factions, your standing with them and the clues you gather collect here.');
    const standing = name => rep.find(f => f.name.toLowerCase() === name.toLowerCase())?.standing;
    const pill = s => (s === undefined ? null : h('span', { class: `pill ${s > 0 ? 'green' : s < 0 ? 'red' : ''}`, title: 'Your standing' }, s > 0 ? `+${s}` : String(s)));
    return [
      facts.length || rep.length ? [h('h4', {}, 'Factions'), h('div', { id: 'factions' }, facts.map(f => entry(f.name, f.description, pill(standing(f.name)))), rep.filter(f => !facts.some(x => x.name.toLowerCase() === f.name.toLowerCase())).map(f => entry(f.name, null, pill(f.standing))))] : null,
      clues.length ? [h('h4', {}, 'Clue board'), h('div', { id: 'clues' }, clues.map(c => h('details', { class: 'journal-entry clue', open: !!journalQuery }, h('summary', {}, c.title), h('p', {}, c.content))))] : null,
    ];
  }

  function journalNotes() {
    const title = h('input', { type: 'text', id: 'note-title', placeholder: 'Title', maxlength: 80 });
    const content = h('textarea', { rows: 3, id: 'note-content', placeholder: 'Your note. The DM can read it too.', maxlength: 2000 });
    const form = h('form', { class: 'journal-note-form', onsubmit: async e => {
      e.preventDefault();
      try {
        const m = await api('POST', `/campaigns/${campaignId}/memories`, { title: title.value, content: content.value });
        journalExtra.notes = [m, ...(Array.isArray(journalExtra.notes) ? journalExtra.notes : [])];
        drawJournalBody();
      } catch (err) {
        toast(err.message, 'error');
      }
    } }, title, content, h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn small primary', type: 'submit' }, 'Save note')));
    const notes = journalExtra.notes;
    if (notes === null) loadJournalExtra('notes');
    const list = Array.isArray(notes) ? notes.filter(n => matches(n.title, n.content)) : [];
    return [form, notes === null ? h('p', { class: 'journal-empty' }, 'Loading…') : notes instanceof Error ? h('p', { class: 'err small' }, notes.message) : list.length ? list.map(n => entry(n.title.replace(/^[^:]+:\s*/, ''), n.content, h('span', { class: 'tiny muted' }, n.title.split(':')[0]))) : empty('No notes yet.')];
  }

  function journalChronicle() {
    const c = journalExtra.chronicle;
    if (c === null) {
      loadJournalExtra('chronicle');
      return h('p', { class: 'journal-empty' }, 'Loading…');
    }
    if (c instanceof Error) return h('p', { class: 'err small' }, c.message);
    if (!c) return empty('The chronicle is written once the story has run for a while: a summary of everything so far.');
    return h('div', { class: 'chronicle' }, c.split(/\n+/).filter(p => matches(p)).map(p => h('p', { html: md(p) })));
  }

  function drawJournalBody() {
    const fn = { quests: journalQuests, people: journalPeople, places: journalPlaces, lore: journalLore, notes: journalNotes, chronicle: journalChronicle }[journalTab];
    const focus = document.activeElement;
    fill(journalBody, fn());
    annotate(journalBody);
    if (focus && journalBody.contains(focus)) focus.focus();
  }

  function drawJournal() {
    if (panel !== 'journal') return;
    const counts = { quests: (view.quests ?? []).length, people: (view.npcs ?? []).length + (view.companions ?? []).length, places: (view.places ?? []).length };
    fill(journalTabs, Object.entries(JOURNAL).map(([k, label]) => h('button', { class: `jtab${journalTab === k ? ' on' : ''}`, role: 'tab', 'aria-selected': String(journalTab === k), 'data-journal': k, onclick: () => {
      journalTab = k;
      try {
        localStorage.setItem('tavern.journalTab', k);
      } catch {
        /* private mode */
      }
      if (k === 'notes' || k === 'chronicle') journalExtra[k] = null;
      drawJournal();
    } }, label, counts[k] ? h('span', { class: 'jcount' }, counts[k]) : null)));
    if (panelBody.firstChild !== journalHead) fill(panelBody, journalHead, journalBody);
    drawJournalBody();
  }
  const journalHead = h('div', { class: 'journal-head' }, h('h3', { class: 'panel-title' }, 'Journal'), journalSearch, journalTabs);

  // the owner's /dm commands, a reference card: what to type and what it does; a click copies it
  const DM_COMMANDS = [
    ['Fights', [['/dm combat <creatures>', 'Start a fight: /dm combat goblin x3, wolf'], ['/dm end', 'End the fight now']]],
    ['Rolls & rewards', [['/dm check <character> <skill> <dc>', 'Call for an ability check'], ['/dm xp <n> <reason>', 'Award XP to the party'], ['/dm milestone', 'Let the party level up'], ['/dm item <character> gets <item>', 'Hand over an item'], ['/dm gold <character> <n>', 'Hand over gold']]],
    ['Scene', [['/dm scene <place>', 'Move the party somewhere'], ['/dm light <bright|dim|dark>', 'Set the lighting'], ['/dm shop [name|close]', 'Open or close a shop']]],
    ['Voice', [['/dm narrate <text>', 'Speak as the narrator'], ['/dm say <Name>: <line>', 'Speak as an NPC'], ['/dm tool <name> {json}', 'Run any DM tool directly']]],
  ];
  function dmCommandList() {
    // "<character>" placeholders read as blanks to fill in
    const cmd = text => h('code', { class: 'dmc-cmd' }, text.split(/(<[^>]+>|\[[^\]]+\])/).filter(Boolean).map(p => (/^[<[]/.test(p) ? h('span', { class: 'dmc-ph' }, p.slice(1, -1)) : p)));
    const copy = async text => {
      try {
        await navigator.clipboard.writeText(text.replace(/\s*[<[][^>\]]*[>\]]/g, ' ').replace(/\s+/g, ' ').trim() + ' ');
        toast('Copied. Paste it into the Story chat.');
      } catch {
        /* no clipboard: the card still reads */
      }
    };
    return h('div', { class: 'dm-commands', 'data-no-terms': '' },
      h('div', { class: 'dmc-head' }, h('b', {}, 'DM commands'), h('span', { class: 'tiny muted' }, 'Type them in the Story chat. Only you can use them, and they work without a DM model.')),
      DM_COMMANDS.map(([group, rows]) => h('div', { class: 'dmc-group' }, h('div', { class: 'dmc-title' }, group),
        rows.map(([text, what]) => h('button', { type: 'button', class: 'dmc-row', title: 'Copy', onclick: () => copy(text) }, cmd(text), h('span', { class: 'dmc-what' }, what))))));
  }

  // the campaign's own settings, a section of the settings page for its owner
  function campaignSettings() {
    if (view.ownerId !== me.id) return null;
    const name = h('input', { type: 'text', id: 'campaign-name', value: view.name });
    const tone = h('input', { type: 'text', id: 'campaign-tone', value: view.settings?.tone ?? '' });
    const deadly = h('input', { type: 'checkbox', checked: !!view.settings?.allowDeadly });
    return {
      title: `Campaign: ${view.name}`,
      nodes: [h('label', {}, 'Name'), name, h('label', {}, 'Tone'), tone, h('label', { style: { display: 'flex', gap: '.5em' } }, deadly, 'Allow beyond-deadly encounters'),
        dmCommandList()],
      save: () => api('PATCH', `/campaigns/${campaignId}`, { name: name.value, tone: tone.value, allowDeadly: deadly.checked }),
      foot: close => h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmBox(`Archive ${view.name}? It leaves the lobby; you can restore it from the archived list.`))) return;
        await api('PATCH', `/campaigns/${campaignId}`, { status: 'archived' });
        close();
        navigate('#/');
      } }, 'Archive campaign'),
    };
  }

  // exploration: area, exits, features, puzzles
  let pop = null;
  function drawExplore() {
    const w = view.world;
    const fighting = view.encounter?.status === 'active';
    if (!w?.area || fighting) {
      pop?.close();
      exploreEl.classList.add('hidden');
      return;
    }
    exploreEl.classList.remove('hidden');
    const can = !!myChar() && !myChar().dead;
    const b = (label, fn, attrs = {}) => h('button', { class: 'btn small', disabled: !can, onclick: fn, ...attrs }, label);
    const toggle = () => {
      exploreOpen = !exploreOpen;
      try {
        localStorage.setItem('tavern.exploreOpen', exploreOpen ? '1' : '0');
      } catch {
        /* private mode */
      }
      drawExplore();
    };
    const head = h('div', { class: 'row small' },
      h('span', { class: 'area-name' }, w.area.name),
      w.maze ? h('span', { class: 'pill gold' }, w.maze.out ? 'maze exit here' : `lost in the ${w.maze.name}`) : null,
      h('span', { class: 'grow' }),
      b('Search', () => act({ type: 'search' }), { 'data-explore': 'search' }),
      b('Investigate', () => act({ type: 'search', skill: 'investigation' }), { 'data-explore': 'investigate' }),
      w.maze && !w.maze.out ? b('Navigate', () => act({ type: 'navigate' }), { 'data-explore': 'navigate' }) : null,
      h('button', { class: 'btn small ghost', id: 'explore-toggle', onclick: toggle }, exploreOpen ? '▾' : '▸'));
    if (!exploreOpen) {
      pop?.close();
      return fill(exploreEl, head);
    }
    const exits = h('div', { class: 'exits', id: 'exits' }, w.area.exits.length ? w.area.exits.map(e => h('div', { class: 'exit' },
      b(`→ ${e.dir}`, () => act({ type: 'go', to: e.dir }), { 'data-exit': e.dir, title: e.to, disabled: !can || e.door?.locked }),
      h('span', { class: 'small muted' }, e.to),
      e.door ? h('span', { class: `pill${e.door.locked ? ' red' : ''}` }, `${e.door.name}${e.door.locked ? ' 🔒' : ''}${e.door.magical ? ' ✦' : ''}`) : null,
      e.door?.locked ? [b('Pick', () => act({ type: 'pickLock', target: e.door.name }), { 'data-pick': e.door.name }), b('Force', () => act({ type: 'force', target: e.door.name }))] : null)) : h('span', { class: 'small dim' }, 'No known exits.'));
    // features and puzzles are titles; a click opens the details and what can be done
    const featureCard = f => [
      h('div', { class: 'pop-head' }, h('span', { class: `pill${f.kind === 'trap' && f.armed ? ' red' : ''}` }, f.kind), h('b', {}, f.name)),
      f.description ? h('p', { class: 'small' }, f.description) : null,
      f.kind === 'trap' && !f.armed ? h('div', { class: 'tiny dim' }, f.disarmed ? 'disarmed' : 'sprung') : null,
      f.content ? h('p', { class: 'small quote' }, f.content) : null,
      f.kind === 'text' && !f.content ? h('div', { class: 'tiny dim' }, `Written in ${f.language}`) : null,
      h('div', { class: 'row pop-actions' },
        f.kind === 'trap' && f.armed ? b('Disarm', () => act({ type: 'disarm', target: f.name }), { 'data-disarm': f.name }) : null,
        f.lock?.locked ? [b('Pick', () => act({ type: 'pickLock', target: f.name }), { 'data-pick': f.name }), b('Force', () => act({ type: 'force', target: f.name }))] : null,
        f.kind === 'text' && !f.content ? b('Read', () => act({ type: 'read', target: f.name }), { 'data-read': f.name }) : null),
    ];
    const puzzleCard = p => {
      const ans = h('input', { type: 'text', placeholder: 'Your answer...', 'data-answer': p.name });
      const submit = () => ans.value.trim() && act({ type: 'solve', puzzle: p.name, answer: ans.value.trim() });
      ans.addEventListener('keydown', e => e.key === 'Enter' && submit());
      return [
        h('div', { class: 'pop-head' }, h('span', { class: 'pill gold' }, 'puzzle'), h('b', {}, p.name), h('span', { class: 'grow' }), h('span', { class: 'tiny dim' }, p.solved ? 'solved' : p.failed ? 'failed' : `${p.maxAttempts - p.attempts} attempt(s) left`)),
        h('p', { class: 'small quote' }, p.prompt),
        p.hints.map(x => h('div', { class: 'tiny', style: { color: 'var(--gold2)' } }, `Clue: ${x}`)),
        p.solved ? h('div', { class: 'small ok' }, p.reward || 'Solved.') : p.failed ? null : h('div', { class: 'row pop-actions' }, h('div', { class: 'grow' }, ans), b('Answer', submit, { 'data-solve': p.name }), p.hintsLeft ? b('Study', () => act({ type: 'hint', puzzle: p.name }), { 'data-hint': p.name }) : null),
      ];
    };
    const items = [...w.features.map(f => ({ key: `f:${f.name}`, name: f.name, kind: f.kind, card: () => featureCard(f), attrs: { 'data-feature': f.name }, cls: f.kind === 'trap' && f.armed ? 'danger' : f.kind === 'trap' ? 'spent' : '' })),
      ...w.puzzles.map(p => ({ key: `p:${p.name}`, name: p.name, kind: 'puzzle', card: () => puzzleCard(p), attrs: { 'data-puzzle': p.name }, cls: p.solved || p.failed ? 'spent' : 'gold' }))];
    const chip = it => h('button', { class: `feat-chip ${it.cls}${pop?.key === it.key ? ' on' : ''}`, type: 'button', 'aria-expanded': String(pop?.key === it.key), ...it.attrs, onclick: e => {
      if (pop?.key === it.key) return pop.close();
      const anchor = e.currentTarget;
      const p = popover(anchor, it.card(), { onClose: () => {
        if (pop === p) pop = null;
        anchor.classList.remove('on');
      } });
      p.key = it.key;
      pop = p;
      anchor.classList.add('on');
    } }, h('span', { class: 'fk' }, it.kind), it.name);
    fill(exploreEl, head,
      w.area.description ? h('div', { class: 'small muted', style: { margin: '.25rem 0' } }, w.area.description) : null,
      exits,
      items.length ? h('div', { class: 'features', id: 'features' }, items.map(chip)) : null);
    // an open card follows its title through the redraw, or closes if the thing is gone
    if (pop) {
      const it = items.find(x => x.key === pop.key);
      const anchor = it && [...exploreEl.querySelectorAll('.feat-chip')].find(el => el.textContent === `${it.kind}${it.name}`);
      if (anchor) {
        pop.place(anchor);
        pop.set(it.card());
      } else pop.close();
    }
  }

  let canvas = null;
  function drawCombat() {
    const enc = view.encounter;
    const fighting = enc?.status === 'active';
    if (fighting !== wasFighting) {
      wasFighting = fighting;
      // a fight opens its tab (a drawer on narrow screens waits for a tap); its end puts back what was open
      if (fighting && panel !== 'combat' && !narrowMq.matches) {
        beforeFight = panel;
        return showPanel('combat');
      }
      if (!fighting && panel === 'combat') showPanel(beforeFight);
      else drawPanel();
    }
    if (!fighting) {
      // the fight is over: drop any half-picked target along with the panel
      if (pending || mapMode) {
        if (pending && input.value.startsWith(pending.text)) input.value = '';
        pending = null;
        mapMode = null;
      }
      combatEl.classList.add('hidden');
      return;
    }
    combatEl.classList.remove('hidden');
    // drawn only where it can be seen
    if (panel !== 'combat') return;
    const cur = enc.order[enc.turn];
    const init = h('div', { class: 'initiative', id: 'initiative' }, enc.order.map(id => {
      const cb = enc.combatants[id];
      if (cb.removed) return null;
      const cr = cb.creature ?? view.characters.find(c => c.id === id);
      // party members show their hit points; foes only how hurt they look
      const ratio = cr?.maxHp ? Math.max(0, Math.min(1, cr.hp / cr.maxHp)) : null;
      return h('div', { ...tipAttrs(cb.name, `Initiative ${cb.initiative}${cb.kind === 'pc' && cr ? ` · ${cr.hp}/${cr.maxHp} HP` : ''}`, oddsText(id)), class: `init ${cb.side}${id === cur ? ' cur' : ''}${cr?.dead || (cb.kind !== 'pc' && cr?.hp <= 0) ? ' dead' : cr?.hp <= 0 ? ' down' : ''}${view.characters.find(c => c.id === id)?.playerId === me.id ? ' me' : ''}` },
        h('span', { class: 'ini-n' }, cb.initiative), h('span', { class: 'ini-name' }, cb.name),
        ratio !== null ? h('span', { class: `ini-hp ${ratio > 0.6 ? 'ok' : ratio > 0.3 ? 'mid' : 'low'}` }, h('i', { style: { width: `${Math.round(ratio * 100)}%` } })) : null);
    }));
    if (!canvas) {
      canvas = h('canvas', { class: 'map', id: 'battle-map' });
      // the hover card lives on the page, not inside the scrolling map, so it is never cut off
      const tip = h('div', { class: 'maptip hidden', role: 'tooltip' });
      document.body.append(tip);
      canvas._tip = tip;
      canvas.addEventListener('mousemove', e => {
        const hit = mapHit(canvas, e, view);
        if (!hit) return tip.classList.add('hidden');
        fill(tip, hit.combatant ? [h('b', {}, hit.combatant.name), h('span', { class: 'tiny muted' }, ` (${hit.x}, ${hit.y}) ${hit.label ?? ''}`), oddsList(hit.combatant.id)] : `(${hit.x}, ${hit.y})`);
        tip.classList.remove('hidden');
        // beside the pointer, flipped to whichever side has room
        const w = tip.offsetWidth;
        const hgt = tip.offsetHeight;
        const x = e.clientX + 14 + w > window.innerWidth - 8 ? e.clientX - 14 - w : e.clientX + 14;
        const y = e.clientY + 12 + hgt > window.innerHeight - 8 ? e.clientY - 12 - hgt : e.clientY + 12;
        tip.style.left = `${Math.max(8, x)}px`;
        tip.style.top = `${Math.max(8, y)}px`;
      });
      canvas.addEventListener('mouseleave', () => tip.classList.add('hidden'));
      canvas.addEventListener('click', e => onMapClick(mapHit(canvas, e, view)));
      canvas._wrap = h('div', { class: 'mapwrap' }, canvas);
    }
    const modeTxt = mapMode ? mapMode.hint ?? 'Click a square to move there.' : '';
    fill(combatEl,
      h('div', { class: 'row small combat-head' }, h('span', { class: 'round-badge', title: `Round ${enc.round}` }, h('span', {}, 'Round'), h('b', {}, enc.round)), h('span', { class: 'turn-of' }, view.characters.find(c => c.id === cur)?.playerId === me.id ? 'Your turn' : `${enc.combatants[cur]?.name}'s turn`), enc.difficulty ? h('span', { class: 'pill' }, enc.difficulty.label) : null, h('span', { class: 'grow' }), mapMode ? h('span', { class: 'pill gold' }, modeTxt) : null, pending?.picked?.length ? h('button', { class: 'btn small primary', onclick: () => run(pending.build(pending.picked), pending.text) }, `Go (${pending.picked.length})`) : null, mapMode ? h('button', { class: 'btn small', onclick: cancelIntent }, 'Cancel') : null),
      init, canvas._wrap, mapLegend());
    drawMap(canvas, view, { me: myChar()?.id, mode: mapMode, cell: cellSize() });
    canvas.classList.toggle('targeting', !!mapMode);
  }

  // what the tokens mean
  function mapLegend() {
    const key = (cls, label) => h('span', { class: 'lg' }, h('i', { class: cls }), label);
    return h('div', { class: 'map-legend tiny muted' }, key('me', 'You'), key('party', 'Allies'), key('enemy', 'Foes'), key('cur', 'Acting'), key('dying', 'Dying'), h('span', { class: 'grow' }), h('span', {}, 'Hover a token for details'));
  }

  function onMapClick(hit) {
    if (!hit || !mapMode) return;
    if (!pending) {
      if (mapMode.kind === 'move') act({ type: 'move', to: { x: hit.x, y: hit.y } });
      return;
    }
    if (pending.kind === 'square' || pending.kind === 'point') {
      input.value = `${pending.text} to (${hit.x}, ${hit.y})`;
      return run(pending.build({ x: hit.x, y: hit.y }), pending.text);
    }
    if (!hit.combatant) return toast('Click a creature on the map.', 'error');
    pending.picked.push(hit.combatant);
    mapMode.picked = pending.picked.map(c => c.id);
    input.value = `${pending.text} at ${pending.picked.map(c => c.name).join(', ')}`;
    if (pending.picked.length >= (pending.max ?? 1)) return run(pending.build(pending.picked), pending.text);
    drawCombat();
  }

  // latest request wins; a burst of state updates costs one redraw per answer
  let optionsSeq = 0;
  async function refreshOptions() {
    const ch = myChar();
    const seq = ++optionsSeq;
    const next = ch ? await api('GET', `/characters/${ch.id}/options`).catch(() => null) : null;
    if (seq !== optionsSeq || JSON.stringify(next) === JSON.stringify(options)) return;
    options = next;
    drawActions();
    if (panel === 'sheet') drawSheet();
  }

  // BG3-style turn tray: what this character can still spend, then what it can do with it
  const COST = { action: 'Action', bonus: 'Bonus action', free: 'Free', move: 'Movement' };
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
  const tipAttrs = (title, meta, desc) => ({ 'data-tip': desc ?? '', 'data-tip-title': title, 'data-tip-meta': meta ?? '' });

  function slotLeft(o, level) {
    if (!level) return true;
    if (o.pactSlots && o.pactSlots.level >= level && o.pactSlots.used < o.pactSlots.max) return true;
    return Object.entries(o.slots ?? {}).some(([l, x]) => Number(l) >= level && x.used < x.max);
  }

  function resourceTray(o) {
    const pips = (left, max) => h('span', { class: 'rpips' }, Array.from({ length: max }, (_, i) => h('i', { class: i < left ? 'on' : '' })));
    const chips = [];
    for (const [l, x] of Object.entries(o.slots ?? {})) if (x.max) chips.push(h('div', { class: 'res slot', ...tipAttrs(`Level ${l} spell slots`, `${x.max - x.used} of ${x.max} left · long rest`, 'Spent when you cast a spell of this level or higher.') }, h('b', {}, ROMAN[l] ?? l), pips(x.max - x.used, x.max)));
    if (o.pactSlots?.max) chips.push(h('div', { class: 'res slot pact', ...tipAttrs(`Pact slots (level ${o.pactSlots.level})`, `${o.pactSlots.max - o.pactSlots.used} of ${o.pactSlots.max} left · short rest`, 'Warlock slots; every pact spell is cast at this level.') }, h('b', {}, 'Pact'), pips(o.pactSlots.max - o.pactSlots.used, o.pactSlots.max)));
    // a resource reads as the class feature it powers
    const featureDesc = r => (o.features ?? []).find(f => f.key === r.key && f.desc)?.desc ?? Object.values(rules.classes ?? {}).flatMap(c => c.features ?? []).find(f => f.name === r.name && f.desc)?.desc ?? '';
    for (const r of o.resources ?? []) chips.push(h('div', { class: 'res', ...tipAttrs(r.name, `${r.left} of ${r.max} left · ${r.recharge} rest`, featureDesc(r)) },h('b', {}, r.name), r.max <= 8 ? pips(r.left, r.max) : h('span', { class: 'rnum' }, `${r.left}/${r.max}`)));
    chips.push(h('div', { class: 'res', ...tipAttrs('Hit dice', `${o.hitDiceLeft} left`, 'Spend during a short rest to heal.') }, h('b', {}, 'Hit dice'), h('span', { class: 'rnum' }, String(o.hitDiceLeft))));
    return chips.length ? h('div', { class: 'resources' }, chips) : null;
  }

  // "+5 · 1d8+3": what an attack rolls; with a power attack on, -5 to hit and +10 damage
  const fmtB = n => (n >= 0 ? `+${n}` : `${n}`);
  function attackDice(a, power) {
    const dmg = String(a.damage).split(' ')[0];
    return power && a.power ? `${fmtB(a.toHit - 5)} · ${dmg}+10` : `${fmtB(a.toHit)} · ${dmg}`;
  }
  function spellDice(sp) {
    const r = sp.roll;
    if (!r) return null;
    if (r.kind === 'attack') return `${fmtB(r.bonus)}${r.dice ? ` · ${r.dice}` : ''}`;
    if (r.kind === 'save') return `${r.save.toUpperCase()} ${r.dc}${r.dice ? ` · ${r.dice}` : ''}`;
    return r.dice ?? null;
  }

  // Great Weapon Master / Sharpshooter: a standing choice, -5 to hit for +10 damage
  function powerToggle(o) {
    const p = o.powerAttack;
    if (!p) return null;
    return h('button', { class: `feat-toggle${p.on ? ' on' : ''}`, id: 'power-toggle', role: 'switch', 'aria-checked': String(p.on), ...tipAttrs(p.feats.join(' / '), p.on ? 'On: -5 to hit, +10 damage' : 'Off', 'Applies to every eligible attack (heavy melee weapons for Great Weapon Master, ranged weapons for Sharpshooter) until you switch it off.'), onclick: () => act({ type: 'setPreference', key: 'powerAttack', value: !p.on }).then(refreshOptions) },
      h('span', { class: 'sw' }), h('span', {}, `${p.feats.map(f => f.split(' ').map(w => w[0]).join('')).join('/')} -5/+10`));
  }

  // the same chances as one line of text, for the initiative track's hover card
  function oddsText(targetId) {
    const el = oddsList(targetId);
    return el ? [...el.children].map(r => [...r.children].map(x => x.textContent.trim()).filter(Boolean).join(' ')).join(' · ') : '';
  }

  // hit chances against one creature: the armed action alone, or every weapon and attack spell
  function oddsList(targetId) {
    const row = options?.odds?.[targetId];
    if (!row || targetId === myChar()?.id) return null;
    const armed = pending?.id ?? '';
    const lines = [];
    for (const a of options.attacks ?? []) if (row.attacks[a.id] && (!armed || armed === `attack-${a.id}` || armed === `offhand-${a.id}`)) lines.push([a.name, row.attacks[a.id]]);
    for (const sp of options.spells ?? []) if (row.spells[sp.key] && (armed ? armed === `spell-${sp.key}` : sp.level === 0)) lines.push([sp.name, row.spells[sp.key]]);
    if (!lines.length) return null;
    return h('div', { class: 'odds' }, lines.slice(0, 6).map(([name, x]) => h('div', { class: `odd ${x.pct >= 65 ? 'good' : x.pct >= 40 ? 'fair' : 'poor'}` },
      h('span', { class: 'grow' }, name), x.mode !== 'normal' ? h('span', { class: `odd-mode ${x.mode}`, title: x.why?.join(', ') }, x.mode === 'advantage' ? '▲' : '▼') : null, h('b', {}, `${x.pct}%`), x.save ? h('span', { class: 'tiny muted' }, ' fail') : null)));
  }

  function drawActions() {
    const ch = myChar();
    if (!ch || channel !== 'dm' || !options || ch.dead) return fill(actionbar);
    const o = options;
    const t = o.turn;
    const mine = o.inCombat && o.isMyTurn && t;
    if (!o.inCombat) return fill(actionbar, h('div', { class: 'trayrow' }, resourceTray(o), powerToggle(o)));

    const eco = (kind, label, on, desc) => h('div', { class: `eco ${kind}${on ? '' : ' spent'}`, ...tipAttrs(label, on ? 'Available' : 'Used', desc) }, h('span', { class: 'eco-icon' }), h('span', {}, label));
    const moveTotal = t?.movement || o.speed || 30;
    const moveLeft = mine ? t.movementLeft : 0;
    const economy = h('div', { class: 'economy' },
      eco('action', 'Action', mine && t.action, 'Attack, cast a spell, Dash, Disengage, Dodge, Hide or use an item.'),
      eco('bonus', 'Bonus action', mine && t.bonus, 'Some spells, class features and off-hand attacks use this.'),
      eco('reaction', 'Reaction', o.reactionReady, `Used automatically when it triggers: ${(o.reactions ?? []).filter(r => r.on).map(r => r.label).join(', ') || 'none enabled'}. Refreshes at the start of your turn.`),
      h('div', { class: `eco move${moveLeft ? '' : ' spent'}`, ...tipAttrs('Movement', `${moveLeft} of ${moveTotal} ft left`, 'Move any time during your turn, split up as you like.') }, h('span', { class: 'eco-icon' }), h('div', { class: 'movebar' }, h('div', { style: { width: `${Math.round((100 * moveLeft) / moveTotal)}%` } })), h('span', {}, `${moveLeft} ft`)),
      mine ? null : h('span', { class: 'small muted wait' }, `Waiting for ${o.combatants?.find(c => c.id === view.encounter?.order?.[view.encounter?.turn])?.name ?? 'the next turn'}. You can still talk.`));
    if (!mine) return fill(actionbar, h('div', { class: 'trayrow' }, economy, resourceTray(o), powerToggle(o)));
    // dying: the whole turn is one roll
    if (t.deathSavePending) {
      const ds = o.deathSaves ?? { successes: 0, failures: 0 };
      return fill(actionbar, h('div', { class: 'trayrow dying-tray' }, h('span', { class: 'small' }, h('b', {}, 'You are dying. '), `${ds.successes}/3 successes, ${ds.failures}/3 failures.`), h('span', { class: 'grow' }), h('button', { class: 'btn primary death-save', id: 'death-save', 'data-action': 'death-save', onclick: () => run({ type: 'deathSave' }, '') }, 'Roll death save')));
    }

    const hot = (label, cost, onclick, { disabled = false, sub = null, tip = null, id, term, dice = null } = {}) => h('button', { class: `hot cost-${cost}${pending?.id === (id ?? label) ? ' armed' : ''}`, disabled, onclick, 'data-action': id ?? label.toLowerCase().replace(/\W+/g, '-'), ...(term ? { 'data-term': term } : tipAttrs(label, COST[cost], tip)) }, h('span', { class: 'cost' }), h('span', { class: 'hl' }, label), dice ? h('span', { class: 'hd' }, dice) : null, sub ? h('span', { class: 'hs' }, sub) : null);
    const power = o.powerAttack?.on;
    const can = cost => (cost === 'action' ? t.action : cost === 'bonus' ? t.bonus : true);
    const attackCost = t.action ? 'action' : 'free';
    const weapons = (o.attacks ?? []).filter(a => !a.offhand).map(a => hot(a.name, attackCost, () => intend({ id: `attack-${a.id}`, text: `I attack with my ${a.name}`, kind: 'creature', range: a.kind === 'ranged' ? a.range?.[0] : a.reach, build: ([tg]) => ({ type: 'attack', attack: a.id, target: tg.id }) }), { disabled: !t.action && !t.attacksLeft, id: `attack-${a.id}`, dice: attackDice(a, power), sub: t.attacksLeft > 1 ? `${t.attacksLeft} left` : null, tip: `${a.toHit >= 0 ? '+' : ''}${a.toHit} to hit, ${a.damage}${a.kind === 'ranged' ? `, range ${a.range?.join('/')} ft` : `, reach ${a.reach} ft`}. Pick a target on the map.` }));
    const bonusAttacks = [
      ...(t.offhandReady ? (o.attacks ?? []).filter(a => a.offhand).map(a => hot(`Off-hand ${a.name}`, 'bonus', () => intend({ id: `offhand-${a.id}`, text: `I strike with my off-hand ${a.name}`, kind: 'creature', range: a.reach, build: ([tg]) => ({ type: 'attack', attack: a.id, target: tg.id, offhand: true }) }), { disabled: !t.bonus, id: `offhand-${a.id}`, dice: attackDice(a, false), tip: 'Two-weapon fighting: a bonus attack with your other light weapon.' })) : []),
      ...(t.martialArtsReady ? [hot('Martial Arts strike', 'bonus', () => intend({ id: 'martial-arts', text: 'I follow up with an unarmed strike', kind: 'creature', range: 5, build: ([tg]) => ({ type: 'attack', attack: 'unarmed', bonusAttack: 'martialArts', target: tg.id }) }), { disabled: !t.bonus, id: 'martial-arts', tip: 'An unarmed strike after attacking with a monk weapon.' })] : []),
      ...(t.flurryLeft ? [hot('Flurry strike', 'free', () => intend({ id: 'flurry', text: 'I strike in a flurry', kind: 'creature', range: 5, build: ([tg]) => ({ type: 'attack', attack: 'unarmed', flurry: true, target: tg.id }) }), { id: 'flurry', sub: `${t.flurryLeft} left`, tip: 'One of your Flurry of Blows strikes.' })] : []),
      ...(o.gwmReady ? [hot('Great Weapon Master', 'bonus', () => intend({ id: 'gwm', text: 'I swing again', kind: 'creature', range: 10, build: ([tg]) => ({ type: 'attack', attack: o.attacks?.[0]?.id, bonusAttack: 'gwm', target: tg.id }) }), { disabled: !t.bonus, id: 'gwm', tip: 'A bonus melee attack after a critical hit or a kill.' })] : []),
      ...(o.polearmReady ? [hot('Polearm butt', 'bonus', () => intend({ id: 'polearm', text: 'I jab with the butt of my polearm', kind: 'creature', range: 10, build: ([tg]) => ({ type: 'attack', attack: 'polearmButt', bonusAttack: 'polearm', target: tg.id }) }), { disabled: !t.bonus, id: 'polearm', tip: 'A bonus d4 attack with the opposite end of your polearm.' })] : []),
    ];
    const basics = ['dash', 'disengage', 'dodge', 'hide'].map(k => hot(k[0].toUpperCase() + k.slice(1), 'action', () => intend({ text: `I ${k}`, build: () => ({ type: k }) }), { disabled: !t.action, tip: { dash: 'Double your movement this turn.', disengage: 'Your movement does not provoke opportunity attacks this turn.', dodge: 'Attacks against you have disadvantage until your next turn.', hide: 'Make a Stealth check to become hidden.' }[k] }));
    const items = (o.items ?? []).map(it => hot(it.name, 'action', () => intend(it.kind === 'throw' ? { id: `item-${it.id}`, text: `I throw ${it.name}`, kind: 'creature', range: 20, build: ([tg]) => ({ type: 'useItem', item: it.id, target: tg.id }) } : it.kind === 'spell' ? { id: `item-${it.id}`, text: `I use ${it.name}`, kind: 'creature', build: ([tg]) => ({ type: 'cast', spell: it.spell, item: it.id, targets: [tg.id] }) } : { text: `I use ${it.name}`, build: () => ({ type: 'useItem', item: it.id }) }), { disabled: !t.action, id: `item-${it.id}`, sub: it.qty > 1 ? `x${it.qty}` : null, tip: 'Use this item.' }));
    const feats = (o.features ?? []).map(f => hot(f.label, f.time, () => useFeature(f), { disabled: !can(f.time), tip: f.desc, id: `feature-${f.key}${f.mode ?? ''}${f.beast ?? ''}` }));
    const castable = (o.spells ?? []).filter(sp => !sp.ritualOnly && ['action', 'bonus'].includes(sp.time));
    const spells = castable.map(sp => hot(sp.name, sp.time, () => castSpell(sp), { disabled: !can(sp.time) || !slotLeft(o, sp.level), dice: spellDice(sp), sub: sp.level ? ROMAN[sp.level] : 'cantrip', term: sp.name.toLowerCase(), id: `spell-${sp.key}` }));
    const group = (title, list) => (list.length ? h('div', { class: 'hotgroup' }, h('div', { class: 'hg-title' }, title), h('div', { class: 'hg-items' }, list)) : null);
    const move = hot('Move', 'move', () => intend({ id: 'move', text: 'I move', kind: 'square', build: pt => ({ type: 'move', to: pt }) }), { disabled: !t.movementLeft, id: 'move', sub: `${t.movementLeft} ft`, tip: 'Pick a square on the map.' });
    fill(actionbar,
      h('div', { class: 'trayrow' }, economy, resourceTray(o), powerToggle(o), h('button', { class: 'btn primary end-turn', id: 'end-turn', 'data-action': 'end-turn', onclick: () => intend({ text: 'I end my turn', build: () => ({ type: 'endTurn' }) }) }, 'End turn')),
      h('div', { class: 'hotbar' },
        group('Actions', [move, ...weapons, ...basics, ...items, ...feats.filter(f => f.classList.contains('cost-action'))]),
        group('Bonus', [...bonusAttacks, ...feats.filter(f => f.classList.contains('cost-bonus'))]),
        group('Free', feats.filter(f => f.classList.contains('cost-free'))),
        group('Spells', spells)));
  }

  // a button writes the intent into the chat box; if it needs a target, the battle map supplies it
  let pending = null;
  const actorPos = () => view.encounter?.combatants?.[myChar()?.id]?.pos;
  function intend(it) {
    if (!it.kind) {
      pending = null;
      mapMode = null;
      return run(it.build(), it.text);
    }
    pending = { ...it, picked: [] };
    input.value = `${it.text} …`;
    const what = { creature: (it.max ?? 1) > 1 ? `up to ${it.max} targets` : 'a target', square: 'a square', point: 'a point' }[it.kind];
    mapMode = { kind: it.kind === 'square' ? 'move' : 'target', range: it.range, from: actorPos(), picked: [], hint: `${it.text}: click ${what} on the map` };
    if (panel !== 'combat') {
      beforeFight ??= panel;
      showPanel('combat');
    }
    drawCombat();
    drawActions();
  }

  function castSpell(sp) {
    const range = sp.range === 'touch' ? 5 : typeof sp.range === 'number' ? sp.range : null;
    const base = { type: 'cast', spell: sp.key };
    const text = `I cast ${sp.name}`;
    const id = `spell-${sp.key}`;
    // self spells and self-centred areas need no target; placed areas and summons need a point; the rest need creatures
    if (sp.self || sp.range === 'self' || (!sp.targets && !sp.area && !['zone', 'spiritualWeapon', 'teleport'].includes(sp.effect))) return intend({ id, text, build: () => base });
    if (sp.area || ['zone', 'spiritualWeapon', 'teleport'].includes(sp.effect)) return intend({ id, text, kind: 'point', range, build: pt => ({ ...base, point: pt }) });
    return intend({ id, text, kind: 'creature', range, max: Math.max(1, sp.targets ?? 1), build: tgs => ({ ...base, targets: tgs.map(x => x.id) }) });
  }

  function useFeature(f) {
    const a = { type: 'feature', feature: f.key };
    if (f.mode) a.mode = f.mode;
    if (f.beast) a.beast = f.beast;
    if (f.frenzy) a.frenzy = true;
    const id = `feature-${f.key}${f.mode ?? ''}${f.beast ?? ''}`;
    const text = `I use ${f.label}`;
    if (f.needs === 'ally' || f.needs === 'enemy') return intend({ id, text, kind: 'creature', range: f.needs === 'ally' ? 5 : null, build: ([tg]) => ({ ...a, target: tg.id, ...(f.key === 'layOnHands' ? { amount: f.amount } : {}) }) });
    if (f.needs === 'aim') return intend({ id, text, kind: 'point', build: pt => ({ ...a, point: pt }) });
    if (f.needs) {
      // choices the map cannot express go to the DM in plain words
      input.value = `${text} to `;
      return input.focus();
    }
    intend({ text, build: () => a });
  }

  function cancelIntent() {
    if (!pending && !mapMode) return;
    if (pending && input.value.startsWith(pending.text)) input.value = '';
    pending = null;
    mapMode = null;
    drawCombat();
    drawActions();
  }

  async function run(action, text) {
    const ok = await act(action);
    if (ok) {
      if (!pending || input.value.startsWith(text ?? '\u0000')) input.value = '';
      pending = null;
      mapMode = null;
    } else if (pending) {
      // the rules said no: keep the mode so another target can be picked
      pending.picked = [];
      mapMode.picked = [];
      input.value = `${pending.text} …`;
    }
    drawCombat();
    drawActions();
  }


  function drawSheet() {
    if (panel !== 'sheet') return;
    const ch = view.characters.find(c => c.id === selectedChar) ?? myChar();
    // a redraw for a state update keeps the reader's place on the sheet
    const prev = panelBody.querySelector('.sheet');
    const keep = prev?.dataset.char === ch?.id ? prev.scrollTop : 0;
    fill(panelBody, ch ? renderSheet(ch, { rules, mine: ch.playerId === me.id, act, refresh: () => refreshAll(), campaignId, navigate, options: ch.playerId === me.id ? options : null }) : h('div', { class: 'empty' }, h('p', {}, 'You are watching this table.'), h('button', { class: 'btn primary', onclick: () => navigate(`#/create/${campaignId}`) }, 'Create a character')));
    annotate(panelBody);
    const sheet = panelBody.querySelector('.sheet');
    if (sheet) {
      sheet.dataset.char = ch?.id ?? '';
      sheet.scrollTop = keep;
    }
  }

  // the view draws at once; the turn tray fills in when the options arrive
  function drawAll() {
    drawScene();
    drawTable();
    drawPanel();
    drawCombat();
    drawExplore();
    placeExplore();
  }
  async function refreshAll() {
    drawAll();
    await refreshOptions();
  }
  await refreshOptions();
  drawAll();
  window.addEventListener('resize', onResize);
  let frame = 0;
  const scheduleDraw = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      refreshAll();
    });
  };

  // what the DM is doing while it works, one step at a time: each step stays long enough to read,
  // and a long wait on the model drifts between thinking, plotting and writing
  const IDLE_PHASES = ['thinking', 'plotting', 'weighing the odds', 'writing'];
  const thinker = { queue: [], shown: null, since: 0, step: null, drift: null, cap: null };
  function showPhase(p) {
    thinker.shown = p;
    thinker.since = performance.now();
    fill(typing,
      h('span', { class: `glyph ${p.icon}`, 'aria-hidden': 'true' }),
      h('span', { class: 'phase' }, `The DM is ${p.phase}`),
      h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
    typing.classList.add('on');
  }
  function nextPhase() {
    clearTimeout(thinker.step);
    if (!thinker.queue.length) return;
    const wait = thinker.shown ? Math.max(0, 1100 - (performance.now() - thinker.since)) : 0;
    thinker.step = setTimeout(() => {
      showPhase(thinker.queue.shift());
      nextPhase();
    }, wait);
  }
  function stopThinking() {
    clearTimeout(thinker.step);
    clearTimeout(thinker.cap);
    clearInterval(thinker.drift);
    Object.assign(thinker, { queue: [], shown: null, drift: null });
    fill(typing);
    typing.classList.remove('on');
  }
  function thinking(d) {
    if (!d.on) return stopThinking();
    // the newest steps matter most; a backlog never holds the table up
    thinker.queue = [...thinker.queue, { phase: d.phase ?? 'thinking', icon: d.icon ?? 'quill' }].slice(-3);
    nextPhase();
    clearTimeout(thinker.cap);
    thinker.cap = setTimeout(stopThinking, 120000);
    thinker.drift ??= setInterval(() => {
      const cur = thinker.shown?.phase;
      if (thinker.queue.length || !IDLE_PHASES.includes(cur) || performance.now() - thinker.since < 2400) return;
      showPhase({ phase: IDLE_PHASES[(IDLE_PHASES.indexOf(cur) + 1) % IDLE_PHASES.length], icon: 'quill' });
    }, 600);
  }

  // live updates
  const es = events(`/campaigns/${campaignId}/events`, {
    state: v => {
      view = v;
      scheduleDraw();
    },
    message: m => addMessage(m),
    presence: list => {
      view.online = list;
      drawTable();
      drawParty();
    },
    // a new note or quest: the journal's lists are fetched again when shown
    memory: () => {
      journalExtra = { notes: null, chronicle: null };
      if (panel === 'journal') drawJournal();
    },
    // only the DM's finished reply reaches the chat; until then, what it is doing
    dm_thinking: thinking,
  });
  input.focus();
  return () => {
    stopThinking();
    es.close();
    canvas?._tip?.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
  };
}

export { $ };
