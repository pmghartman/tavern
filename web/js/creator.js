import { h, fill, toast, fmtMod, mod } from './ui.js';
import { api, getRules } from './api.js';
import { featPicker, featChanges } from './featpicker.js';
import { initGlossary, annotate } from './glossary.js';

const ASI_LEVELS = { default: [4, 8, 12, 16, 19], fighter: [4, 6, 8, 12, 14, 16, 19], rogue: [4, 8, 10, 12, 16, 19] };
const STEPS = ['Race & Class', 'Abilities', 'Skills & Training', 'Equipment', 'Spells', 'Details', 'Review'];

// editId: an existing character opened again, rebuilt at its current level
export async function renderCreator(app, campaignId, { topbar, navigate, editId = null }) {
  const rules = await getRules();
  initGlossary(rules);
  const edit = editId ? await api('GET', `/characters/${editId}/build`) : null;
  if (edit && !edit.editable) throw new Error(edit.why);
  if (edit) campaignId = edit.campaignId;
  const camp = await api('GET', `/campaigns/${campaignId}`);
  const level = edit?.level ?? camp.settings?.startLevel ?? 1;
  const d = {
    name: '', race: 'human', ancestry: null, class: 'fighter', subclass: null, background: 'soldier', alignment: 'Neutral Good', level,
    abilityMethod: 'standard', baseAbilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, rolled: null, rollToken: null,
    raceAsiChoices: [], raceAsi: null, raceSkills: [], classSkills: [], expertise: [], fightingStyles: [], metamagic: [], invocations: [], infusions: [], pactBoon: null,
    extraLanguages: [], kit: 0, raceCantrip: null, raceFeat: null, cantrips: [], spellsKnown: [], spellsPrepared: [], spellbook: [], asiHistory: [],
    description: { pronouns: '', appearance: '', personality: '', ideals: '', bonds: '', flaws: '', backstory: '' },
  };
  if (edit) {
    const x = edit.input;
    Object.assign(d, x, {
      level, rollToken: null, rolled: x.rolledScores ?? null,
      asiHistory: (x.asiHistory ?? []).map(a => (a.feat ? { featMode: true, feat: a.feat, choice: a.choice ?? {} } : { changes: { ...(a.changes ?? {}) } })),
      description: { ...d.description, ...(x.description ?? {}) },
    });
  }
  let step = 0;
  const body = h('div', { id: 'creator-body' });
  const stepsEl = h('div', { class: 'steps' });
  const foot = h('div', { class: 'creator-foot' });
  const randomBtn = h('button', { class: 'btn', id: 'random-character', title: 'Roll up a complete, legal character that suits this campaign. You can change anything before creating it.', onclick: async () => {
    randomBtn.disabled = true;
    randomBtn.textContent = 'Consulting the fates...';
    try {
      const r = await api('POST', `/campaigns/${campaignId}/characters/random`, {});
      Object.assign(d, r, { rolled: null, rollToken: null, description: { ...d.description, ...(r.description ?? {}) } });
      step = STEPS.length - 1;
      draw();
      toast(`${d.name} steps out of the shadows.`);
    } catch (e) {
      toast(e.message, 'error', 8000);
    } finally {
      randomBtn.disabled = false;
      randomBtn.textContent = 'Random adventurer';
    }
  } }, 'Random adventurer');
  fill(app, topbar([h('span', { class: 'muted small' }, `${edit ? 'Rebuilding a character' : 'Creating a character'} for ${camp.name}`)]), h('main', { class: 'creator' }, h('div', { class: 'row', style: { alignItems: 'center' } }, h('h1', { class: 'grow' }, edit ? `Rebuild ${d.name}` : 'Forge your adventurer'), edit ? null : randomBtn), h('p', { class: 'muted' }, edit ? `Level ${level}. Experience, gear, coin and wounds stay as they are; everything else can change. Every choice is checked against the 5e rules.` : `${camp.setting?.world_name ?? camp.name} · starting at level ${level}. Every choice is checked against the 5e rules.`), stepsEl, body, foot));

  const cls = () => rules.classes[d.class];
  const race = () => rules.races[d.race];
  const bg = () => rules.backgrounds[d.background];
  // racial bonus to an ability: the race's own (or moved, Tasha's), plus free picks
  const racial = a => ((d.raceAsi ?? race().asi)?.[a] ?? 0) + (d.raceAsiChoices.includes(a) ? race().asiChoice?.amount ?? 1 : 0);
  const sc = () => cls().spellcasting ?? subDef()?.spellcasting ?? null;
  // the subclass, once the class has one at this level
  const hasSubclass = () => level >= cls().subclassLevel;
  const subDef = () => (hasSubclass() ? cls().subclasses[d.subclass] ?? null : null);
  const classFeatures = () => cls().features.filter(f => f.level <= level && f.desc && (!f.sub || f.sub === d.subclass));
  const casts = () => sc() && level >= (sc().startLevel ?? 1);
  const asiLevels = () => (ASI_LEVELS[d.class] ?? ASI_LEVELS.default).filter(l => l <= level);
  const finalAb = () => {
    const out = {};
    for (const a of rules.abilities) {
      let v = d.baseAbilities[a] + racial(a);
      for (const x of d.asiHistory) v += (x.feat ? featChanges(rules, x) : x.changes ?? {})[a] ?? 0;
      v += featChanges(rules, d.raceFeat)[a] ?? 0;
      out[a] = Math.min(20, v);
    }
    return out;
  };
  const maxSpellLevel = () => {
    // an Eldritch Knight or Arcane Trickster takes its slots from the subclass
    const t = (cls().spellcasting ? cls().slotTable : subDef()?.slotTable ?? cls().slotTable)[level - 1];
    return Array.isArray(t) ? t.length : t?.level ?? 0;
  };
  const counts = () => {
    const s = sc();
    if (!casts()) return {};
    const fa = finalAb();
    const m = mod(fa[s.ability]);
    return {
      cantrips: s.cantrips ? s.cantrips[level - 1] : 0,
      known: s.known ? s.known[level - 1] : null,
      prepared: s.prepared ? Math.max(1, m + (s.type === 'half' || s.type === 'artificer' ? Math.floor(level / 2) : level)) : null,
      spellbook: s.spellbook ? 6 + 2 * (level - 1) : null,
    };
  };
  const expertiseCount = () => (d.class === 'rogue' ? (level >= 6 ? 4 : 2) : d.class === 'bard' ? (level >= 10 ? 4 : level >= 3 ? 2 : 0) : 0);
  const styleCount = () => (cls().fightingStyle && level >= cls().fightingStyle.level ? (d.class === 'fighter' && level >= 10 ? 2 : 1) : 0);
  const mmCount = () => (d.class === 'sorcerer' ? (level >= 17 ? 4 : level >= 10 ? 3 : level >= 3 ? 2 : 0) : 0);
  const invCount = () => (d.class === 'warlock' ? cls().invocations[level - 1] : 0);
  const infCount = () => cls().infusions?.[level - 1] ?? 0;
  const requiresText = r => (r ? ` (needs ${[r.level ? `level ${r.level}` : null, r.pact ? rules.pactBoons[r.pact] : null, r.cantrip ? rules.spells[r.cantrip]?.name : null].filter(Boolean).join(', ')})` : '');
  const langCount = () => (race().extraLanguages ?? 0) + (bg().languages ?? 0);
  // what feat prerequisites see: scores before ASIs and feats, as the server checks them
  const featCtx = () => {
    const abilities = {};
    for (const a of rules.abilities) abilities[a] = d.baseAbilities[a] + racial(a);
    return { abilities, armor: new Set([...(cls().armor ?? []), ...(subDef()?.armor ?? [])]), casts: casts() || !!race().cantripChoice || !!race().innateSpells, raceBase: race().base, raceSize: race().size, martial: [...(cls().weapons ?? []), ...(subDef()?.weapons ?? [])].includes('martial') };
  };
  // a step with nothing to choose is shown greyed out and skipped
  const stepOff = i => (STEPS[i] === 'Equipment' && edit ? 'Your gear and coin carry over as they are' : STEPS[i] === 'Spells' && !casts() && !race().cantripChoice ? (sc() ? `${cls().name}s gain spellcasting at level ${sc().startLevel}` : `${cls().name}s do not cast spells`) : null);
  const nextStep = (from, dir) => {
    let i = from + dir;
    while (i > 0 && i < STEPS.length - 1 && stepOff(i)) i += dir;
    return i;
  };

  const toggle = (arr, v, max) => {
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1);
    else if (arr.length < max) arr.push(v);
    else toast(`You can choose ${max}.`, 'error');
  };

  const choice = (on, title, sub, onclick, extra = {}) => h('div', { class: `choice${on ? ' on' : ''}`, onclick, ...extra }, h('div', { class: 't' }, title), sub ? h('div', { class: 'small muted' }, sub) : null);

  function stepRace() {
    const r = race();
    const c = cls();
    return [
      h('label', {}, 'Name'),
      h('input', { type: 'text', id: 'char-name', value: d.name, maxlength: 40, placeholder: 'Your character\'s name', oninput: e => (d.name = e.target.value) }),
      h('h3', { style: { marginTop: '1rem' } }, 'Race'),
      h('div', { class: 'choices' }, Object.entries(rules.races).map(([k, x]) => choice(d.race === k, x.name, `${Object.entries(x.asi).map(([a, v]) => `${a.toUpperCase()} +${v}`).join(', ')}${x.asiChoice ? `${Object.keys(x.asi).length ? ', ' : ''}+${x.asiChoice.amount ?? 1} to ${x.asiChoice.count === 1 ? 'one' : 'two'}${Object.keys(x.asi).length ? ' others' : ''}` : ''} · speed ${x.speed}${x.source ? ` · ${x.source}` : ''}`, () => {
        d.race = k;
        d.raceAsiChoices = [];
        d.raceAsi = null;
        d.raceSkills = [];
        d.extraLanguages = [];
        d.raceCantrip = null;
        d.raceFeat = null;
        draw();
      }, { 'data-race': k }))),
      h('p', { class: 'muted small' }, r.blurb),
      r.featChoice ? [h('label', {}, `${r.name} feat`), featPicker(rules, d.raceFeat, v => (d.raceFeat = v), { id: 'race-feat', ctx: featCtx() })] : null,
      r.ancestryChoice ? [h('label', {}, 'Draconic ancestry'), h('select', { id: 'ancestry', onchange: e => (d.ancestry = e.target.value || null) }, h('option', { value: '' }, 'Choose...'), Object.entries(rules.ancestries).map(([k, a]) => h('option', { value: k, selected: d.ancestry === k }, `${k} (${a.type}, ${a.size} ft ${a.shape})`)))] : null,
      Object.keys(r.asi ?? {}).length ? originBox(r) : null,
      r.asiChoice ? (() => {
        const ex = d.raceAsi ? Object.keys(d.raceAsi) : r.asiChoice.exclude;
        return [h('label', {}, `${r.name}: +${r.asiChoice.amount ?? 1} to ${r.asiChoice.count === 1 ? 'one ability' : `${r.asiChoice.count} abilities`}${ex.length ? ` (not ${ex.join(', ').toUpperCase()})` : ''}`), h('div', { class: 'checklist' }, rules.abilities.filter(a => !ex.includes(a)).map(a => h('label', {}, h('input', { type: 'checkbox', 'data-race-asi': a, checked: d.raceAsiChoices.includes(a), onchange: () => (toggle(d.raceAsiChoices, a, r.asiChoice.count), draw()) }), rules.abilityNames[a])))];
      })() : null,
      h('h3', { style: { marginTop: '1rem' } }, 'Class'),
      h('div', { class: 'choices' }, Object.entries(rules.classes).map(([k, x]) => choice(d.class === k, x.name, `d${x.hitDie} · ${x.primary.map(p => p.toUpperCase()).join('/')} · saves ${x.saves.map(s => s.toUpperCase()).join(', ')}${x.spellcasting ? (level >= (x.spellcasting.startLevel ?? 1) ? ' · spellcaster' : ` · spells from level ${x.spellcasting.startLevel}`) : ''}`, () => {
        d.class = k;
        Object.assign(d, { subclass: null, classSkills: [], expertise: [], fightingStyles: [], metamagic: [], invocations: [], infusions: [], pactBoon: null, cantrips: [], spellsKnown: [], spellsPrepared: [], spellbook: [], kit: 0, asiHistory: [] });
        draw();
      }, { 'data-class': k }))),
      hasSubclass() ? [h('h3', { style: { marginTop: '1rem' } }, `Subclass`), h('p', { class: 'small muted' }, `${c.name}s choose a subclass at level ${c.subclassLevel}.`), subclassChoices(c)] : null,
      h('div', { class: 'card', style: { marginTop: '.8rem' } }, h('h4', {}, `${c.name}${subDef() ? ` (${subDef().name})` : ''} features up to level ${level}`), h('ul', { class: 'small', 'data-no-terms': '' }, classFeatures().map(f => h('li', {}, h('b', {}, `${f.name} (${f.level}). `), f.desc)))),
    ];
  }

  // subclasses grouped by book, the SRD and Player's Handbook first
  function subclassChoices(c) {
    const books = [['SRD', 'Basic rules'], ['PHB', "Player's Handbook"], ['XGtE', "Xanathar's Guide to Everything"], ['TCE', "Tasha's Cauldron of Everything"]];
    const pick = s => {
      const before = subDef();
      d.subclass = s.key;
      // a subclass that brings spells changes what there is to choose
      if (before?.spellcasting || s.spellcasting) Object.assign(d, { cantrips: [], spellsKnown: [] });
      draw();
    };
    return h('div', { id: 'subclasses' }, books.map(([src, title]) => {
      const own = Object.values(c.subclasses).filter(s => (s.source ?? 'PHB') === src);
      return own.length ? [h('div', { class: 'book-head' }, title), h('div', { class: 'choices' }, own.map(s => choice(d.subclass === s.key, s.name, `${s.desc}${s.spellcasting ? ' Casts wizard spells.' : ''}`, () => pick(s), { 'data-subclass': s.key })))] : null;
    }));
  }

  function stepAbilities() {
    const fa = finalAb();
    const method = m => h('button', { class: `btn${d.abilityMethod === m ? ' active' : ''}`, 'data-method': m, onclick: () => {
      d.abilityMethod = m;
      if (m === 'standard') d.baseAbilities = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
      if (m === 'pointBuy') d.baseAbilities = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
      if (m === 'rolled' && d.rolled) assignRolled();
      draw();
    } }, { standard: 'Standard array', pointBuy: 'Point buy', rolled: '4d6 drop lowest' }[m]);
    const assignRolled = () => {
      const s = [...d.rolled].sort((a, b) => b - a);
      const order = [...cls().primary, 'con', 'dex', 'wis', 'str', 'int', 'cha'].filter((v, i, arr) => arr.indexOf(v) === i);
      order.forEach((a, i) => (d.baseAbilities[a] = s[i]));
    };
    let control;
    if (d.abilityMethod === 'pointBuy') {
      const spent = rules.abilities.reduce((t, a) => t + (rules.pointBuyCost[d.baseAbilities[a]] ?? 99), 0);
      control = h('p', { class: spent > 27 ? 'err' : 'muted' }, `Points spent: ${spent} / 27`);
    } else if (d.abilityMethod === 'rolled') {
      control = h('div', { class: 'row' }, h('button', { class: 'btn', id: 'roll-abilities', disabled: !!d.rolled, onclick: async () => {
        const r = await api('POST', '/rolls/abilities', {});
        d.rolled = r.scores;
        d.rollToken = r.token;
        assignRolled();
        draw();
      } }, d.rolled ? 'Rolled (one roll per character)' : 'Roll 4d6 x6 on the server'), d.rolled ? h('span', { class: 'muted' }, `Your rolls: ${d.rolled.join(', ')}. Swap them between abilities below.`) : null);
    } else control = h('p', { class: 'muted' }, 'Assign 15, 14, 13, 12, 10, 8 to your abilities.');
    const pool = d.abilityMethod === 'standard' ? rules.standardArray : d.rolled ?? [];
    const editor = a => {
      if (d.abilityMethod === 'pointBuy') {
        return h('div', { class: 'row', style: { justifyContent: 'center' } },
          h('button', { class: 'btn small', onclick: () => (d.baseAbilities[a] = Math.max(8, d.baseAbilities[a] - 1), draw()) }, '-'),
          h('span', {}, d.baseAbilities[a]),
          h('button', { class: 'btn small', onclick: () => (d.baseAbilities[a] = Math.min(15, d.baseAbilities[a] + 1), draw()) }, '+'));
      }
      if (!pool.length) return h('span', { class: 'dim' }, '-');
      return h('select', { 'data-ability': a, onchange: e => {
        const v = Number(e.target.value);
        const other = rules.abilities.find(x => x !== a && d.baseAbilities[x] === v);
        if (other) d.baseAbilities[other] = d.baseAbilities[a];
        d.baseAbilities[a] = v;
        draw();
      } }, [...new Set(pool)].sort((x, y) => y - x).map(v => h('option', { value: v, selected: d.baseAbilities[a] === v }, v)));
    };
    const asiUi = asiLevels().map((lvl, i) => {
      const cur = d.asiHistory[i] ?? { changes: {} };
      d.asiHistory[i] = cur;
      const isFeat = !!cur.featMode;
      const toggle = h('select', { onchange: e => {
        d.asiHistory[i] = e.target.value === 'feat' ? { featMode: true, feat: '', choice: {} } : { changes: {} };
        draw();
      } }, h('option', { value: 'asi', selected: !isFeat }, 'Ability scores'), h('option', { value: 'feat', selected: isFeat }, 'Feat'));
      if (isFeat) return h('div', { class: 'card', style: { margin: '.3rem 0' } }, h('div', { class: 'row small' }, `Level ${lvl}:`, toggle), featPicker(rules, cur.feat ? cur : null, v => Object.assign(cur, { feat: v?.feat ?? '', choice: v?.choice ?? {} }), { id: `asi-feat-${i}`, ctx: featCtx() }));
      const sel = n => h('select', { onchange: e => {
        const keys = Object.keys(cur.changes);
        const a = keys[0];
        const b = keys[1];
        const pick = e.target.value;
        if (n === 0) cur.changes = pick ? (b && b !== pick ? { [pick]: 1, [b]: 1 } : { [pick]: 2 }) : {};
        else cur.changes = pick && a && pick !== a ? { [a]: 1, [pick]: 1 } : a ? { [a]: 2 } : {};
        draw();
      } }, h('option', { value: '' }, '-'), rules.abilities.map(x => h('option', { value: x, selected: Object.keys(cur.changes)[n] === x }, x.toUpperCase())));
      return h('div', { class: 'row small' }, `Level ${lvl}:`, toggle, sel(0), sel(1), h('span', { class: 'muted' }, Object.entries(cur.changes).map(([k, v]) => `${k.toUpperCase()} +${v}`).join(', ') || 'choose +2 or +1/+1'));
    });
    return [
      h('div', { class: 'row' }, method('standard'), method('pointBuy'), method('rolled')),
      control,
      h('div', { class: 'abil-grid' }, rules.abilities.map(a => h('div', { class: 'abil' },
        h('div', { class: 'k' }, a.toUpperCase()), editor(a),
        h('div', { class: 'v' }, fa[a]), h('div', { class: 'm' }, fmtMod(mod(fa[a]))),
        h('div', { class: 'tiny dim' }, `${racial(a) ? `racial +${racial(a)}` : ''}`)))),
      asiUi.length ? h('div', { class: 'section' }, h('h4', {}, 'Ability Score Improvements'), asiUi) : null,
    ];
  }

  function stepSkills() {
    const fixed = new Set([...(bg().skills ?? []), ...(race().skillProfs ?? [])]);
    const from = cls().skills.from === 'any' ? Object.keys(rules.skills) : cls().skills.from;
    const all = new Set([...fixed, ...d.raceSkills, ...d.classSkills]);
    return [
      h('label', {}, 'Background'),
      h('select', { id: 'background', onchange: e => {
        d.background = e.target.value;
        d.classSkills = d.classSkills.filter(s => !rules.backgrounds[d.background].skills.includes(s));
        d.extraLanguages = [];
        draw();
      } }, Object.entries(rules.backgrounds).map(([k, b]) => h('option', { value: k, selected: d.background === k }, `${b.name} (${b.skills.map(s => rules.skillNames[s]).join(', ')})`))),
      h('p', { class: 'small muted' }, bg().feature),
      h('p', { class: 'small' }, 'Already proficient: ', [...fixed].map(s => rules.skillNames[s]).join(', ') || 'none'),
      race().skillChoice ? [h('h4', {}, `Racial skills: choose ${race().skillChoice.count}`), h('div', { class: 'checklist' }, Object.keys(rules.skills).filter(s => !fixed.has(s) && !d.classSkills.includes(s)).map(s => h('label', {}, h('input', { type: 'checkbox', checked: d.raceSkills.includes(s), onchange: () => (toggle(d.raceSkills, s, race().skillChoice.count), draw()) }), rules.skillNames[s])))] : null,
      h('h4', { style: { marginTop: '.8rem' } }, `${cls().name} skills: choose ${cls().skills.count} (${d.classSkills.length} chosen)`),
      h('div', { class: 'checklist', id: 'class-skills' }, from.filter(s => !fixed.has(s) && !d.raceSkills.includes(s)).map(s => h('label', {}, h('input', { type: 'checkbox', value: s, checked: d.classSkills.includes(s), onchange: () => (toggle(d.classSkills, s, cls().skills.count), draw()) }), rules.skillNames[s]))),
      expertiseCount() ? [h('h4', { style: { marginTop: '.8rem' } }, `Expertise: choose ${expertiseCount()}`), h('div', { class: 'checklist', id: 'expertise' }, [...all].map(s => h('label', {}, h('input', { type: 'checkbox', checked: d.expertise.includes(s), onchange: () => (toggle(d.expertise, s, expertiseCount()), draw()) }), rules.skillNames[s])))] : null,
      styleCount() ? [h('h4', { style: { marginTop: '.8rem' } }, `Fighting style: choose ${styleCount()}`), h('div', { class: 'choices', id: 'fighting-styles' }, cls().fightingStyle.options.map(k => choice(d.fightingStyles.includes(k), rules.fightingStyles[k].name, rules.fightingStyles[k].desc, () => {
        if (styleCount() === 1) d.fightingStyles = [k];
        else toggle(d.fightingStyles, k, styleCount());
        draw();
      }, { 'data-style': k })))] : null,
      mmCount() ? [h('h4', { style: { marginTop: '.8rem' } }, `Metamagic: choose ${mmCount()}`), h('div', { class: 'choices' }, Object.entries(rules.metamagic).map(([k, m]) => choice(d.metamagic.includes(k), `${m.name} (${m.cost})`, m.desc, () => (toggle(d.metamagic, k, mmCount()), draw()))))] : null,
      invCount() ? [h('h4', { style: { marginTop: '.8rem' } }, `Eldritch invocations: choose ${invCount()}`), h('div', { class: 'choices' }, Object.entries(rules.invocations).filter(([, m]) => !m.requires?.level || level >= m.requires.level).map(([k, m]) => choice(d.invocations.includes(k), m.name, `${m.desc}${requiresText(m.requires)}`, () => (toggle(d.invocations, k, invCount()), draw()))))] : null,
      infCount() ? [h('h4', { style: { marginTop: '.8rem' } }, `Infusions: choose ${infCount()}`), h('div', { class: 'choices', id: 'infusions' }, Object.entries(rules.infusions).filter(([, x]) => (x.level ?? 2) <= level).map(([k, x]) => choice(d.infusions.includes(k), x.name, x.desc, () => (toggle(d.infusions, k, infCount()), draw()), { 'data-infusion': k })))] : null,
      d.class === 'warlock' && level >= 3 ? [h('label', {}, 'Pact boon'), h('select', { onchange: e => (d.pactBoon = e.target.value || null) }, h('option', { value: '' }, 'Choose...'), Object.entries(rules.pactBoons).map(([k, v]) => h('option', { value: k, selected: d.pactBoon === k }, v)))] : null,
      langCount() ? [h('h4', { style: { marginTop: '.8rem' } }, `Languages: choose ${langCount()} (you know ${race().languages.join(', ')})`), h('div', { class: 'checklist', id: 'languages' }, rules.languages.filter(l => !race().languages.includes(l)).map(l => h('label', {}, h('input', { type: 'checkbox', checked: d.extraLanguages.includes(l), onchange: () => (toggle(d.extraLanguages, l, langCount()), draw()) }), l)))] : null,
      h('label', {}, 'Alignment'),
      h('select', { onchange: e => (d.alignment = e.target.value) }, rules.alignments.map(a => h('option', { selected: d.alignment === a }, a))),
    ];
  }

  function stepEquipment() {
    const kits = cls().kits;
    return [
      h('p', { class: 'muted', 'data-no-terms': '' }, `Choose a starting kit. Your ${bg().name} background also grants: ${Object.entries(bg().items).map(([k, q]) => `${rules.items[k]?.name ?? k}${q > 1 ? ` x${q}` : ''}`).join(', ')}, and ${bg().gold} gp.`),
      h('div', { class: 'choices', 'data-no-terms': '' }, kits.map((k, i) => choice(d.kit === i, k.name, Object.entries(k.items).map(([key, q]) => `${rules.items[key]?.name ?? key}${q > 1 ? ` x${q}` : ''}`).join(', '), () => ((d.kit = i), draw()), { 'data-kit': i }))),
    ];
  }

  // Tasha's Customizing Your Origin: put the racial bonuses on other abilities
  function originBox(r) {
    // the race's bonuses, largest first, each assigned to an ability
    const vals = Object.entries(r.asi).sort((a, b) => b[1] - a[1]);
    const order = d.raceAsi ? vals.map(([, v], i) => Object.entries(d.raceAsi).filter(([, x]) => x === v).map(([a]) => a)[vals.slice(0, i).filter(([, w]) => w === v).length]) : vals.map(([a]) => a);
    const commit = o => {
      d.raceAsi = Object.fromEntries(o.map((a, i) => [a, vals[i][1]]));
      d.raceAsiChoices = d.raceAsiChoices.filter(a => !(a in d.raceAsi));
      draw();
    };
    const set = (i, ab) => {
      const o = [...order];
      const j = o.indexOf(ab);
      if (j >= 0) o[j] = o[i];
      o[i] = ab;
      commit(o);
    };
    return h('div', { class: 'origin-box' },
      h('label', { class: 'row', style: { gap: '.4rem', alignItems: 'center' } }, h('input', { type: 'checkbox', id: 'custom-origin', checked: !!d.raceAsi, onchange: e => (e.target.checked ? commit(order) : ((d.raceAsi = null), draw())) }), h('span', {}, "Customize my origin (Tasha's): move the racial ability bonuses")),
      d.raceAsi ? h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '.5rem' } }, vals.map(([, v], i) => h('label', { class: 'small' }, `+${v} to `, h('select', { 'data-origin': i, onchange: e => set(i, e.target.value) }, rules.abilities.map(a => h('option', { value: a, selected: a === order[i] }, a.toUpperCase())))))) : null);
  }

  function stepSpells() {
    if (!casts() && !race().cantripChoice) return [h('p', { class: 'muted' }, `${cls().name}s ${sc() ? `gain spellcasting at level ${sc().startLevel}` : 'do not cast spells'}. Nothing to choose here.`)];
    const n = counts();
    const max = maxSpellLevel();
    // the class's list (a wizard's for Eldritch Knights), plus what the subclass adds
    const extra = new Set(Object.values(subDef()?.expandedSpells ?? {}).flat());
    const listFor = (lvlFilter, clsKey = sc()?.list ?? d.class) => Object.values(rules.spells).filter(s => (s.classes.includes(clsKey) || (clsKey === (sc()?.list ?? d.class) && (extra.has(s.key) || s.classes.includes(subDef()?.expandedFrom)))) && lvlFilter(s.level)).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    const pick = (title, arr, cap, spells, id) => [
      h('h4', { style: { marginTop: '.8rem' } }, `${title}: ${arr.length}/${cap}`),
      h('div', { class: 'spell-list', id }, spells.map(s => h('label', { class: 'spell-row' }, h('input', { type: 'checkbox', checked: arr.includes(s.key), onchange: () => (toggle(arr, s.key, cap), draw()) }), h('b', {}, s.name), h('span', { class: 'tiny muted' }, s.level ? `L${s.level} ${s.school}` : 'cantrip'), h('span', { class: 'small dim grow' }, s.desc)))),
    ];
    const out = [];
    if (race().cantripChoice) out.push(h('label', {}, `${race().name} cantrip (${race().cantripChoice.list})`), h('select', { id: 'race-cantrip', onchange: e => (d.raceCantrip = e.target.value || null) }, h('option', { value: '' }, 'Choose...'), listFor(l => l === 0, race().cantripChoice.list).map(s => h('option', { value: s.key, selected: d.raceCantrip === s.key }, s.name))));
    if (!casts()) return out;
    const sub = subDef();
    const domain = sub?.domainSpells ? Object.entries(sub.domainSpells).filter(([l]) => level >= Number(l)).flatMap(([, s]) => s).filter(k => rules.spells[k]) : [];
    out.push(h('p', { class: 'muted small' }, `Spell slots up to level ${max}. Spellcasting ability: ${sc().ability.toUpperCase()}.${domain.length ? ` Always prepared (${sub.name}): ${domain.map(k => rules.spells[k].name).join(', ')}.` : ''}`));
    if (n.cantrips) out.push(pick('Cantrips', d.cantrips, n.cantrips, listFor(l => l === 0), 'cantrip-list'));
    if (sc().schools) out.push(h('p', { class: 'small muted' }, `${subDef().name} spells come from the wizard list and must be ${sc().schools.join(' or ')} spells, except ${[3, 8, 14, 20].filter(l => level >= l).length} of any school.`));
    if (n.known !== null && n.known !== undefined) out.push(pick('Spells known', d.spellsKnown, n.known, listFor(l => l >= 1 && l <= max), 'known-list'));
    if (n.spellbook) {
      out.push(pick('Spellbook', d.spellbook, n.spellbook, listFor(l => l >= 1 && l <= max), 'spellbook-list'));
      out.push(pick('Prepared today (from spellbook)', d.spellsPrepared, n.prepared, listFor(l => l >= 1 && l <= max).filter(s => d.spellbook.includes(s.key)), 'prepared-list'));
    } else if (n.prepared) out.push(pick('Prepared spells', d.spellsPrepared, n.prepared, listFor(l => l >= 1 && l <= max).filter(s => !domain.includes(s.key)), 'prepared-list'));
    return out;
  }

  function stepDetails() {
    const field = (k, label, rows = 2) => [h('label', {}, label), h('textarea', { rows, 'data-desc': k, oninput: e => (d.description[k] = e.target.value) }, d.description[k])];
    return [
      h('label', {}, 'Pronouns'), h('input', { type: 'text', value: d.description.pronouns, placeholder: 'they/them', oninput: e => (d.description.pronouns = e.target.value) }),
      field('appearance', 'Appearance'), field('personality', 'Personality traits'), field('ideals', 'Ideals', 1), field('bonds', 'Bonds', 1), field('flaws', 'Flaws', 1), field('backstory', 'Backstory', 5),
    ];
  }

  function payload() {
    const s = sc();
    return {
      name: d.name, race: d.race, ancestry: d.ancestry, class: d.class, subclass: hasSubclass() ? d.subclass : null, background: d.background, alignment: d.alignment,
      abilityMethod: d.abilityMethod, baseAbilities: d.baseAbilities, raceAsiChoices: d.raceAsiChoices, raceAsi: d.raceAsi || undefined, raceSkills: d.raceSkills, classSkills: d.classSkills,
      expertise: d.expertise, fightingStyles: d.fightingStyles, metamagic: d.metamagic, invocations: d.invocations, infusions: d.infusions, pactBoon: d.pactBoon,
      extraLanguages: d.extraLanguages, kit: d.kit, raceCantrip: d.raceCantrip || undefined, raceFeat: d.raceFeat || undefined,
      cantrips: casts() ? d.cantrips : [], spellsKnown: casts() && s.known ? d.spellsKnown : [], spellbook: casts() && s.spellbook ? d.spellbook : [], spellsPrepared: casts() && s.prepared ? d.spellsPrepared : [],
      asiHistory: d.asiHistory.slice(0, asiLevels().length).map(a => (a.featMode ? { feat: a.feat, choice: a.choice } : { changes: a.changes })), description: d.description,
    };
  }

  async function stepReview() {
    const box = h('div', {}, h('span', { class: 'spinner' }), ' Checking the rules...');
    api('POST', `/campaigns/${campaignId}/characters/validate`, { character: payload(), rollToken: d.rollToken, characterId: editId }).then(r => {
      const fa = finalAb();
      fill(box, 
        r.errors.length ? h('div', { class: 'errors', id: 'review-errors' }, h('b', {}, 'Fix these before creating:'), h('ul', {}, r.errors.map(e => h('li', {}, e)))) : h('p', { class: 'ok', id: 'review-ok' }, 'All choices are legal under the 5e rules.'),
        h('div', { class: 'card', style: { marginTop: '.8rem' } },
          h('h3', {}, d.name || '(unnamed)'),
          h('p', { class: 'muted' }, `${race().name} ${cls().name} ${level}${subDef() ? ` (${subDef().name})` : ''} · ${bg().name} · ${d.alignment}`),
          h('div', { class: 'abil-grid' }, rules.abilities.map(a => h('div', { class: 'abil' }, h('div', { class: 'k' }, a.toUpperCase()), h('div', { class: 'v' }, fa[a]), h('div', { class: 'm' }, fmtMod(mod(fa[a])))))),
          h('p', { class: 'small' }, 'Skills: ', [...new Set([...(bg().skills ?? []), ...(race().skillProfs ?? []), ...d.raceSkills, ...d.classSkills])].map(s => rules.skillNames[s]).join(', ')),
          casts() ? h('p', { class: 'small' }, 'Spells: ', [...d.cantrips, ...d.spellsKnown, ...(d.spellbook.length ? d.spellbook : d.spellsPrepared)].map(k => rules.spells[k]?.name).join(', ') || 'none') : null));
      createBtn.disabled = r.errors.length > 0;
    }).catch(e => fill(box, h('span', { class: 'err' }, e.message)));
    return [box];
  }

  const createBtn = h('button', { class: 'btn primary', id: 'create-character', onclick: async () => {
    createBtn.disabled = true;
    try {
      if (edit) await api('PUT', `/characters/${editId}/build`, { character: payload() });
      else await api('POST', `/campaigns/${campaignId}/characters`, { character: payload(), rollToken: d.rollToken });
      toast(edit ? `${d.name} is ready.` : `${d.name} joins the adventure!`);
      navigate(`#/campaign/${campaignId}`);
    } catch (e) {
      toast(e.message, 'error', 8000);
      createBtn.disabled = false;
    }
  } }, edit ? 'Save changes' : 'Create character');

  async function draw() {
    if (stepOff(step)) step = nextStep(step, 1);
    fill(stepsEl, ...STEPS.map((s, i) => {
      const off = stepOff(i);
      return h('div', { class: `step${i === step ? ' on' : ''}${i < step ? ' done' : ''}${off ? ' off' : ''}`, title: off ?? undefined, onclick: off ? undefined : () => ((step = i), draw()), 'data-step': i }, `${i + 1}. ${s}`);
    }));
    const parts = [stepRace, stepAbilities, stepSkills, stepEquipment, stepSpells, stepDetails, stepReview][step];
    const focusId = document.activeElement?.id;
    fill(body, h('div', { class: 'card' }, h('h2', {}, STEPS[step]), ...(await parts())));
    annotate(body);
    if (focusId) document.getElementById(focusId)?.focus();
    fill(foot, 
      h('button', { class: 'btn', onclick: () => (step === 0 ? navigate(edit ? `#/campaign/${campaignId}` : '#/') : ((step = nextStep(step, -1)), draw())) }, step === 0 ? 'Cancel' : 'Back'),
      step < STEPS.length - 1 ? h('button', { class: 'btn primary', id: 'next-step', onclick: () => ((step = nextStep(step, 1)), draw()) }, `Next: ${STEPS[nextStep(step, 1)]}`) : createBtn);
  }
  draw();
  return () => {};
}
