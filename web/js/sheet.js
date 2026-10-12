import { h, fill, toast, modal, fmtMod, mod, confirmBox } from './ui.js';
import { api } from './api.js';
import { featPicker } from './featpicker.js';
import { term, annotate } from './glossary.js';

// a class entry's subclass, stored as a key or (older characters) its name
export const subclassOfEntry = (x, rules) => {
  const subs = rules.classes[x.class]?.subclasses ?? {};
  return subs[x.subclass] ?? Object.values(subs).find(s => s.name === x.subclass) ?? null;
};
const SKILL_ORDER = ['acrobatics', 'animalHandling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleightOfHand', 'stealth', 'survival'];

function finalAbilities(c, rules) {
  const race = rules.races[c.race];
  const out = {};
  for (const a of rules.abilities) {
    let v = c.baseAbilities[a] + ((c.raceAsi ?? race.asi)?.[a] ?? 0) + ((c.raceAsiChoices ?? []).includes(a) ? race.asiChoice?.amount ?? 1 : 0);
    for (const x of c.asiHistory ?? []) v += x.changes?.[a] ?? 0;
    v += c.raceFeat?.changes?.[a] ?? 0;
    out[a] = Math.min(20, v);
  }
  if (classLevel(c, 'barbarian') >= 20) {
    out.str = Math.min(24, out.str + 4);
    out.con = Math.min(24, out.con + 4);
  }
  return out;
}
const profBonus = l => Math.ceil(l / 4) + 1;
const classesOf = c => (c.classes?.length > 1 ? c.classes : [{ class: c.class, level: c.level, subclass: c.subclass }]);
const classLevel = (c, k) => classesOf(c).find(x => x.class === k)?.level ?? 0;
const featsOf = c => [...(c.asiHistory ?? []).filter(a => a.feat), ...(c.raceFeat?.feat ? [c.raceFeat] : [])];
export const classLabelOf = (c, rules) => classesOf(c).map(x => `${rules.classes[x.class].name} ${x.level}`).join(' / ');
const subclassLabel = (c, rules) => classesOf(c).map(x => subclassOfEntry(x, rules)?.name).filter(Boolean).join(', ');
const itemName = (it, rules) => it.custom?.name ?? rules.items[it.key]?.name ?? it.key;

export function renderSheet(c, { rules, mine, act, campaignId, options, navigate }) {
  const fa = finalAbilities(c, rules);
  const pb = profBonus(c.level);
  const cls = rules.classes[c.class];
  const conds = [...(c.conditions ?? []).map(x => x.name ?? x), ...(c.effects ?? []).flatMap(e => e.conditions ?? [])];
  const xpNext = c.level < 20 ? rules.xpThresholds[c.level] : null;
  const skillBonus = s => {
    const ab = rules.skills[s];
    let v = mod(fa[ab]);
    if (c.skills.includes(s)) v += c.expertise.includes(s) ? pb * 2 : pb;
    else if (classLevel(c, 'bard') >= 2) v += Math.floor(pb / 2);
    return v;
  };
  const featSaves = featsOf(c).filter(f => f.feat === 'resilient').map(f => f.choice?.ability);
  const saveBonus = a => mod(fa[a]) + (cls.saves.includes(a) || featSaves.includes(a) || classLevel(c, 'monk') >= 14 ? pb : 0);
  // the name stays pinned; everything else scrolls as one page
  const nameBar = h('div', { class: 'sheet-namebar' },
    h('div', { class: 'nm grow', id: 'sheet-name' }, c.name), c.dead ? h('span', { class: 'pill red' }, 'dead') : null,
    mine && !c.dead && navigate ? h('button', { class: 'btn small ghost', id: 'edit-character', title: (c.classes?.length ?? 1) > 1 ? 'Multiclassed characters edit their bio below' : 'Open this character in the creator', disabled: (c.classes?.length ?? 1) > 1, onclick: () => navigate(`#/edit/${c.id}`) }, 'Edit') : null);

  const head = h('div', { class: 'sheet-head' },
    h('div', { class: 'small muted', id: 'sheet-classes' }, `${rules.races[c.race].name} ${classLabelOf(c, rules)}${subclassLabel(c, rules) ? ` (${subclassLabel(c, rules)})` : ''} · level ${c.level} · ${rules.backgrounds[c.background]?.name} · ${c.alignment}`),
    h('div', { class: 'small muted' }, `XP ${c.xp}${xpNext ? ` / ${xpNext}` : ''}`),
    c.pendingLevelUp && mine ? h('button', { class: 'btn primary small', id: 'level-up', style: { marginTop: '.35rem' }, onclick: () => levelUpDialog(c, rules, act, null, { abilities: fa, armor: new Set([...(cls.armor ?? []), ...(c.multiclassProfs?.armor ?? []), ...featsOf(c).flatMap(f => rules.feats[f.feat]?.grantsArmor ?? [])]), casts: !!options?.spells?.length, raceBase: rules.races[c.race]?.base, raceSize: rules.races[c.race]?.size }) }, '★ Level up') : null,
    h('div', { class: 'stats3' },
      stat('HP', `${c.hp}/${c.maxHp}${c.tempHp ? `+${c.tempHp}` : ''}`, 'sheet-hp'),
      stat('AC', options?.ac ?? '—', 'sheet-ac'),
      stat('Speed', options?.speed ?? rules.races[c.race].speed),
      stat('Prof', fmtMod(pb))),
    c.hp <= 0 && !c.dead ? h('div', { class: 'deathsaves', style: { marginTop: '.4rem' } }, h('span', {}, 'Death saves '), h('span', { class: 'ok' }, `✓ ${c.deathSaves.successes}`), h('span', { class: 'err' }, `✗ ${c.deathSaves.failures}`), c.stable ? h('span', { class: 'pill green' }, 'stable') : null) : null,
    conds.length || c.exhaustion ? h('div', { class: 'row small', style: { marginTop: '.35rem' } }, [...new Set(conds)].map(x => h('span', { class: 'pill red' }, x)), c.exhaustion ? h('span', { class: 'pill red' }, `exhaustion ${c.exhaustion}`) : null) : null,
    c.concentration ? h('div', { class: 'small', style: { marginTop: '.3rem', color: 'var(--purple)' } }, `Concentrating: ${c.concentration.name}`) : null,
    (c.effects ?? []).length ? h('div', { class: 'small muted', style: { marginTop: '.2rem' } }, 'Effects: ', c.effects.map(e => e.name).join(', ')) : null,
    c.inspirationDie ? h('div', { class: 'small', style: { color: 'var(--gold2)' } }, `Bardic inspiration ${c.inspirationDie}`) : null);

  function stat(k, v, id) {
    return h('div', { class: 'stat', id }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
  }

  function statsTab() {
    return [
      h('div', { class: 'abil-mini' }, rules.abilities.map(a => h('div', { class: 'abil' }, h('div', { class: 'k' }, a.toUpperCase()), h('div', { class: 'v' }, fa[a]), h('div', { class: 'm' }, fmtMod(mod(fa[a]))), h('div', { class: 'tiny dim' }, `save ${fmtMod(saveBonus(a))}${cls.saves.includes(a) || featSaves.includes(a) ? ' ●' : ''}`)))),
      h('div', { class: 'section' }, h('h4', {}, 'Skills'), SKILL_ORDER.map(s => h('div', { class: `kv${c.expertise.includes(s) ? ' exp' : c.skills.includes(s) ? ' prof' : ''}` }, h('span', { class: 'n' }, `${rules.skillNames[s]} `, h('span', { class: 'dim tiny' }, rules.skills[s].toUpperCase())), h('span', { class: 'p' }, fmtMod(skillBonus(s)))))),
      h('div', { class: 'kv' }, h('span', {}, 'Passive Perception'), h('span', { class: 'p' }, 10 + skillBonus('perception'))),
      h('div', { class: 'kv' }, h('span', {}, 'Hit dice'), h('span', { class: 'p' }, `${c.level - c.hitDiceUsed}/${c.level} (${classesOf(c).map(x => `${x.level}d${rules.classes[x.class].hitDie}`).join(' + ')})`)),
      options?.attacks?.length ? h('div', { class: 'section' }, h('h4', {}, 'Attacks'), options.attacks.map(a => h('div', { class: 'kv' }, h('span', {}, a.name), h('span', { class: 'p' }, `${fmtMod(a.toHit)} · ${a.damage}`)))) : null,
      Object.keys(c.resources ?? {}).length ? h('div', { class: 'section' }, h('h4', {}, 'Resources'), Object.values(c.resources).map(r => h('div', { class: 'kv' }, h('span', {}, r.name), h('span', { class: 'p' }, `${r.max - r.used}/${r.max >= 99 ? '∞' : r.max} · ${r.recharge} rest`)))) : null,
      h('div', { class: 'section small muted' }, `Languages: ${c.languages.join(', ')}. Tools: ${c.toolProfs.join(', ') || 'none'}.`),
      mine && options?.reactions?.length ? h('div', { class: 'section' }, h('h4', {}, 'Reactions'), h('p', { class: 'tiny muted' }, 'Used automatically when they trigger. Untick one to hold it back.'), options.reactions.map(r => h('label', { class: 'toggle', title: r.desc }, h('input', { type: 'checkbox', checked: r.on, onchange: e => act({ type: 'setPreference', key: r.key, value: e.target.checked }) }), h('span', { class: 'grow' }, r.label, h('span', { class: 'tiny muted' }, ` · ${r.desc}`))))) : null,
      mine && options?.powerAttack ? h('div', { class: 'section' }, h('h4', {}, 'Optional feats'), h('label', { class: 'toggle', id: 'power-pref' }, h('input', { type: 'checkbox', checked: options.powerAttack.on, onchange: e => act({ type: 'setPreference', key: 'powerAttack', value: e.target.checked }) }), h('span', { class: 'grow' }, `${options.powerAttack.feats.join(' / ')}: -5 to hit, +10 damage`, h('span', { class: 'tiny muted' }, ' · on every eligible attack until you switch it off')))) : null,
      mine && !c.dead ? h('div', { class: 'section' }, h('button', { class: 'btn small danger', onclick: async () => {
        if (await confirmBox(`Retire ${c.name}? They leave the party for good.`)) {
          try {
            await api('DELETE', `/characters/${c.id}`);
          } catch (e) {
            toast(e.message, 'error');
          }
        }
      } }, 'Retire character')) : null,
    ];
  }

  function inventoryTab() {
    const weight = c.inventory.reduce((s, i) => s + (i.custom?.weight ?? rules.items[i.key]?.weight ?? 0) * i.qty, 0);
    return [
      mine && !c.dead ? h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn small', id: 'add-item', title: 'Note something you picked up or carry that has no rules: a letter, a keepsake, a key', onclick: addItemDialog }, '+ Add item')) : null,
      h('div', { class: 'row small' }, Object.entries(c.currency).map(([k, v]) => h('span', { class: 'pill gold' }, `${v} ${k}`))),
      h('div', { class: 'small muted', style: { margin: '.3rem 0' } }, `Carrying ${Math.round(weight * 10) / 10} lb of ${fa.str * 15} lb · attuned ${c.inventory.filter(i => i.attuned).length}/3`),
      c.inventory.map(it => {
        const def = rules.items[it.key] ?? {};
        const equippable = ['weapon', 'armor', 'magicWeapon', 'magicArmor'].includes(def.kind) || def.slot;
        return h('div', { class: 'inv-row', 'data-item': it.key },
          h('span', { class: 'grow' }, itemName(it, rules), it.qty > 1 ? h('span', { class: 'muted' }, ` x${it.qty}`) : null, it.equipped ? h('span', { class: 'eq' }, ` [${it.equipped}]`) : null, it.attuned ? h('span', { class: 'eq' }, ' ✦') : null, it.charges !== undefined ? h('span', { class: 'tiny muted' }, ` (${it.charges} charges)`) : null),
          mine && equippable ? h('button', { class: 'btn small', onclick: () => act({ type: it.equipped ? 'unequip' : 'equip', item: it.id }) }, it.equipped ? 'Unequip' : 'Equip') : null,
          mine && def.attunement ? h('button', { class: 'btn small', onclick: () => act({ type: 'attune', item: it.id, on: !it.attuned }) }, it.attuned ? 'Unattune' : 'Attune') : null,
          mine && def.use && def.use.kind !== 'throw' ? h('button', { class: 'btn small', onclick: () => act({ type: 'useItem', item: it.id }) }, 'Use') : null,
          mine ? h('button', { class: 'btn small ghost', title: 'Give or drop', onclick: () => giveDialog(it) }, '⋯') : null,
          it.custom?.description ? h('div', { class: 'tiny muted inv-note' }, it.custom.description) : null);
      }),
    ];
  }

  function addItemDialog() {
    const name = h('input', { type: 'text', id: 'item-name', maxlength: 60, placeholder: 'A sealed letter' });
    const notes = h('textarea', { rows: 3, id: 'item-notes', maxlength: 300, placeholder: 'Addressed to the mayor; the wax bears a raven.' });
    const m = modal([h('h3', {}, 'Add to your pack'), h('p', { class: 'small muted' }, 'Story items have no rules of their own. Weapons, armor, potions and magic come from the DM or a shop.'), h('label', {}, 'Name'), name, h('label', {}, 'Notes'), notes, h('div', { class: 'modal-foot' },
      h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        if (!name.value.trim()) return toast('Name the item.', 'error');
        if (await act({ type: 'addItem', name: name.value, description: notes.value })) m.close();
      } }, 'Add'))]);
    name.focus();
  }

  function giveDialog(it) {
    const qty = h('input', { type: 'number', min: 1, max: it.qty, value: 1 });
    const to = h('select', {}, (options?.combatants ?? []).filter(x => x.side === 'party' && x.id !== c.id).map(x => h('option', { value: x.id }, x.name)));
    const m = modal([h('h3', {}, itemName(it, rules)), h('label', {}, 'Quantity'), qty, h('label', {}, 'Give to'), to, h('div', { class: 'modal-foot' },
      h('button', { class: 'btn danger', onclick: () => (m.close(), act({ type: 'drop', item: it.id, qty: Number(qty.value) })) }, 'Drop'),
      h('button', { class: 'btn primary', disabled: !to.options.length, onclick: () => (m.close(), act({ type: 'give', item: it.id, to: to.value, qty: Number(qty.value) })) }, 'Give'))]);
  }

  function spellsTab() {
    if (!options) return [h('p', { class: 'muted small' }, 'Spell details are private to the player.')];
    if (!options.spells.length) return [h('p', { class: 'muted' }, 'No spells.')];
    const slots = options.pactSlots ? [h('div', { class: 'kv' }, h('span', {}, `Pact slots (level ${options.pactSlots.level})`), pips(options.pactSlots.max, options.pactSlots.max - options.pactSlots.used))] : Object.entries(options.slots ?? {}).map(([l, s]) => h('div', { class: 'kv' }, h('span', {}, `Level ${l}`), pips(s.max, s.max - s.used)));
    return [
      options.spellDc ? h('p', { class: 'small' }, `Save DC ${options.spellDc} · Spell attack ${fmtMod(options.spellAttack ?? 0)}`) : null,
      slots,
      h('div', { class: 'section' }, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => {
        const list = options.spells.filter(s => s.level === l);
        if (!list.length) return null;
        return [h('h4', {}, l ? `Level ${l}` : 'Cantrips'), list.map(s => h('div', { class: 'kv' }, h('span', {}, term(s.name, 'spell'), options?.spells?.find(x => x.key === s.key)?.roll ? h('span', { class: 'tiny muted' }, ` · ${options.spells.find(x => x.key === s.key).roll.text}`) : null, s.concentration ? h('span', { class: 'tiny muted' }, ' (C)') : null, s.ritual ? h('span', { class: 'tiny muted' }, ' (R)') : null), h('span', { class: 'tiny muted' }, s.time)))];
      })),
      mine && options.canPrepare ? (options.prepareClasses ?? []).map(k => h('button', { class: 'btn small', id: `prepare-${k}`, style: { marginRight: '.3rem' }, onclick: () => prepareDialog(k) }, `Prepare ${rules.classes[k].name} spells`)) : null,
    ];
  }

  function pips(max, left) {
    return h('span', { class: 'pips' }, Array.from({ length: max }, (_, i) => h('span', { class: `pip${i < left ? ' full' : ''}` })));
  }

  function prepareDialog(k) {
    const sc = rules.classes[k].spellcasting;
    const lvl = classLevel(c, k);
    const t = rules.classes[k].slotTable[lvl - 1];
    const maxLvl = Array.isArray(t) ? t.length : t?.level ?? 0;
    const lists = k === c.class ? c.spells : c.spells.byClass?.[k] ?? {};
    const pool = sc.spellbook ? lists.spellbook ?? [] : Object.values(rules.spells).filter(x => x.classes.includes(k) && x.level >= 1 && x.level <= maxLvl).map(x => x.key);
    const chosen = new Set(lists.prepared ?? []);
    const cap = Math.max(1, mod(fa[sc.ability]) + (sc.type === 'half' || sc.type === 'artificer' ? Math.floor(lvl / 2) : lvl));
    const counter = h('span', { class: 'muted' });
    const upd = () => (counter.textContent = `${chosen.size}/${cap} prepared`);
    upd();
    const m = modal([h('h2', {}, `Prepare ${rules.classes[k].name} spells`), counter, h('div', { class: 'spell-list' }, pool.map(key => h('label', { class: 'spell-row' }, h('input', { type: 'checkbox', checked: chosen.has(key), onchange: e => {
      if (e.target.checked) chosen.add(key);
      else chosen.delete(key);
      upd();
    } }), h('b', {}, term(rules.spells[key].name, 'spell')), h('span', { class: 'tiny muted' }, `L${rules.spells[key].level}`)))), h('div', { class: 'modal-foot' }, h('button', { class: 'btn primary', onclick: () => (m.close(), act({ type: 'prepare', class: k, spells: [...chosen] })) }, 'Prepare'))], { wide: true });
  }

  function featuresTab() {
    const race = rules.races[c.race];
    return [
      classesOf(c).map(x => [h('h4', {}, `${rules.classes[x.class].name} ${x.level}${subclassOfEntry(x, rules) ? ` (${subclassOfEntry(x, rules).name})` : ''}`), rules.classes[x.class].features.filter(f => f.level <= x.level && f.desc && (!f.sub || f.sub === subclassOfEntry(x, rules)?.key)).map(f => h('div', { class: 'journal-item' }, h('b', {}, `${f.name} `), h('span', { class: 'tiny muted' }, `lvl ${f.level}`), h('div', { class: 'muted' }, f.desc)))]),
      featsOf(c).length ? [h('h4', { style: { marginTop: '.8rem' } }, 'Feats'), featsOf(c).map(f => h('div', { class: 'journal-item', 'data-feat': f.feat }, h('b', {}, rules.feats[f.feat]?.name), f.choice?.ability ? h('span', { class: 'tiny muted' }, ` (${f.choice.ability.toUpperCase()})`) : null, h('div', { class: 'muted' }, rules.feats[f.feat]?.desc)))] : null,
      c.fightingStyles?.length ? h('div', { class: 'journal-item' }, h('b', {}, 'Fighting style: '), c.fightingStyles.map(s => rules.fightingStyles[s].name).join(', ')) : null,
      c.metamagic?.length ? h('div', { class: 'journal-item' }, h('b', {}, 'Metamagic: '), c.metamagic.map(s => rules.metamagic[s].name).join(', ')) : null,
      c.invocations?.length ? h('div', { class: 'journal-item' }, h('b', {}, 'Invocations: '), c.invocations.map(s => rules.invocations[s]?.name ?? s).join(', ')) : null,
      c.infusions?.length ? h('div', { class: 'journal-item' }, h('b', {}, 'Infusions: '), c.infusions.map(s => rules.infusions[s]?.name ?? s).join(', ')) : null,
      h('h4', { style: { marginTop: '.8rem' } }, race.name), h('p', { class: 'small muted' }, race.blurb), h('p', { class: 'small' }, `Traits: ${race.traits.join(', ') || 'none'}${race.darkvision ? `; darkvision ${race.darkvision} ft` : ''}`),
      h('h4', {}, rules.backgrounds[c.background].name), h('p', { class: 'small muted' }, rules.backgrounds[c.background].feature),
    ];
  }

  function bioTab() {
    const fields = ['pronouns', 'appearance', 'personality', 'ideals', 'bonds', 'flaws', 'backstory', 'notes'];
    if (!mine) return fields.filter(f => c.description?.[f]).map(f => h('div', { class: 'journal-item' }, h('b', {}, f), h('div', {}, c.description[f])));
    const inputs = {};
    return [
      fields.map(f => [h('label', {}, f[0].toUpperCase() + f.slice(1)), (inputs[f] = h('textarea', { rows: f === 'backstory' || f === 'notes' ? 5 : 2 }, c.description?.[f] ?? ''))]),
      h('div', { class: 'modal-foot' }, h('button', { class: 'btn primary small', onclick: async () => {
        try {
          await api('PATCH', `/characters/${c.id}`, { description: Object.fromEntries(fields.map(f => [f, inputs[f].value])) });
          toast('Saved');
        } catch (e) {
          toast(e.message, 'error');
        }
      } }, 'Save')),
    ];
  }

  // one page per category, picked from tabs under the name; the choice is remembered
  const sections = [['stats', 'Abilities', 'Abilities & skills', statsTab], ['inventory', 'Equipment', 'Equipment', inventoryTab], ...(options?.spells?.length ? [['spells', 'Spells', 'Spells', spellsTab]] : []), ['features', 'Features', 'Features & traits', featuresTab], ['bio', 'Bio', 'Bio', bioTab]];
  let tab = sheetTab();
  if (!sections.some(([k]) => k === tab)) tab = 'stats';
  const body = h('div', { class: 'sheet-body', id: 'sheet-body' });
  const tabs = h('nav', { class: 'sheet-tabs', role: 'tablist', 'aria-label': 'Character sheet' });
  const show = k => {
    tab = k;
    sheetTab(k);
    const [, , title, fn] = sections.find(([x]) => x === k);
    const sec = h('section', { class: 'sheet-section', 'data-sheet-section': k, role: 'tabpanel' }, h('h3', { class: 'sheet-h' }, title), fn().flat().filter(Boolean));
    // spells carry their own terms; gear names (Shield) are items, not the spell
    if (k !== 'spells' && k !== 'inventory') annotate(sec);
    fill(body, sec);
    fill(tabs, sections.map(([x, label]) => h('button', { class: `stab${x === k ? ' on' : ''}`, role: 'tab', 'aria-selected': String(x === k), 'data-sheet-tab': x, onclick: () => show(x) }, label)));
  };
  show(tab);
  void campaignId;
  return h('div', { class: 'sheet' }, h('div', { class: 'sheet-top' }, nameBar, tabs), head, body);
}

function sheetTab(set) {
  try {
    if (set) localStorage.setItem('tavern.sheetTab', set);
    return localStorage.getItem('tavern.sheetTab') ?? 'stats';
  } catch {
    return set ?? 'stats';
  }
}

async function levelUpDialog(c, rules, act, cls = null, featCtx = null, sub = null) {
  const q = new URLSearchParams({ ...(cls ? { class: cls } : {}), ...(sub ? { subclass: sub } : {}) }).toString();
  const info = await api('GET', `/characters/${c.id}/levelup${q ? `?${q}` : ''}`);
  const req = info.requirements;
  if (!info.canLevel || !req) return toast('No level available yet.');
  const target = req.class;
  const def = rules.classes[target];
  const choices = {};
  const classSel = h('select', { id: 'lvl-class', onchange: e => {
    m.close();
    levelUpDialog(c, rules, act, e.target.value, featCtx);
  } }, info.multiclass.map(o => h('option', { value: o.class, selected: o.class === target, disabled: !o.current && o.errors.length > 0, title: o.errors.join(' ') }, `${rules.classes[o.class].name}${o.current ? ` (${o.current} → ${o.current + 1})` : o.errors.length ? ' (prerequisites not met)' : ' (new class)'}`)));
  let subclass = sub;
  // a subclass that casts (Eldritch Knight) adds spell choices: reopen with it picked
  const pickSub = key => {
    const casts = k => req.subclass?.find(s => s.key === k)?.casts;
    if (casts(key) || casts(subclass)) {
      m.close();
      levelUpDialog(c, rules, act, target, featCtx, key);
    } else subclass = key;
  };
  const parts = [
    h('h2', {}, `${c.name} reaches level ${req.level}`),
    h('label', {}, 'Class to advance'), classSel,
    req.subclass ? [h('h4', { style: { marginTop: '.8rem' } }, `${def.name} subclass`), h('div', { class: 'choices', id: 'lvl-subclass' }, req.subclass.map(s => h('label', { class: 'choice', 'data-subclass': s.key }, h('div', { class: 't' }, h('input', { type: 'radio', name: 'lvl-subclass', value: s.key, checked: s.key === subclass, onchange: () => pickSub(s.key) }), ' ', s.name, s.source ? h('span', { class: 'pill', style: { marginLeft: '.4em' } }, s.source) : null), h('div', { class: 'small muted' }, `${s.desc}${s.casts ? ' Casts wizard spells.' : ''}`))))] : null,
    req.newClass ? h('p', { class: 'small', style: { color: 'var(--gold2)' } }, `Multiclassing into ${def.name}: you gain proficiency with ${[...(rules.multiclass[target].armor ?? []).map(x => ({ light: 'light armor', medium: 'medium armor', heavy: 'heavy armor', shield: 'shields' })[x]), ...(rules.multiclass[target].weapons ?? []).map(x => ({ simple: 'simple weapons', martial: 'martial weapons', shortsword: 'shortswords' })[x] ?? x)].join(', ') || 'nothing new'}${rules.multiclass[target].skills ? ` and ${rules.multiclass[target].skills} skill` : ''}. Saving throws stay those of your first class.`) : null,
    h('p', { class: 'muted' }, `${def.name} level ${req.classLevel}: ${def.features.filter(f => f.level === req.classLevel).map(f => f.name).join(', ') || 'more hit points and proficiency'}.`),
  ];
  const hp = h('select', { id: 'lvl-hp' }, h('option', { value: 'average' }, `Take average (${Math.floor(req.hitDie / 2) + 1})`), h('option', { value: 'roll' }, `Roll 1d${req.hitDie} on the server`));
  parts.push(h('label', {}, 'Hit points'), hp);
  let asiA;
  let asiB;
  let asiMode = 'asi';
  let feat = null;
  if (req.asi) {
    const opts = () => [h('option', { value: '' }, '-'), ...rules.abilities.map(a => h('option', { value: a }, a.toUpperCase()))];
    asiA = h('select', { id: 'lvl-asi-a' }, opts());
    asiB = h('select', { id: 'lvl-asi-b' }, opts());
    const asiBox = h('div', { class: 'row' }, asiA, asiB);
    const featBox = h('div', { class: 'hidden' }, featPicker(rules, null, v => (feat = v), { id: 'lvl-feat', exclude: featsOf(c).map(f => f.feat), ctx: featCtx }));
    const mode = h('select', { id: 'lvl-asi-mode', onchange: e => {
      asiMode = e.target.value;
      asiBox.classList.toggle('hidden', asiMode !== 'asi');
      featBox.classList.toggle('hidden', asiMode !== 'feat');
    } }, h('option', { value: 'asi' }, 'Ability Score Improvement'), h('option', { value: 'feat' }, 'Take a feat instead'));
    parts.push(h('label', {}, 'Ability Score Improvement or feat'), mode, asiBox, featBox);
  }
  const multi = (title, max, list, key) => {
    if (!max) return;
    const sel = new Set();
    parts.push(h('h4', { style: { marginTop: '.8rem' } }, `${title}: choose ${max}`), h('div', { class: 'spell-list', 'data-pick': key }, list.map(([k, label]) => h('label', { class: 'spell-row' }, h('input', { type: 'checkbox', value: k, onchange: e => (e.target.checked ? sel.add(k) : sel.delete(k)) }), annotate(h('span', {}, label))))));
    choices[key] = sel;
  };
  const lists = target === c.class ? c.spells : c.spells.byClass?.[target] ?? {};
  const known = new Set([...(lists.cantrips ?? []), ...(lists.known ?? []), ...(lists.spellbook ?? [])]);
  const spellList = lvlF => Object.values(rules.spells).filter(s => s.classes.includes(req.listClass ?? target) && lvlF(s.level) && !known.has(s.key)).map(s => [s.key, `${s.name} (${s.level ? `L${s.level} ${s.school}` : 'cantrip'})`]);
  if (req.schools) parts.push(h('p', { class: 'small muted' }, `Spells from the wizard list, ${req.schools.join(' or ')} except a few of any school.`));
  multi('New cantrips', req.newCantrips, spellList(l => l === 0), 'cantrips');
  multi('New spells known', req.newKnown, spellList(l => l >= 1 && l <= (req.learnMax ?? 0)), 'spellsKnown');
  multi('Spellbook additions', req.newSpellbook, spellList(l => l >= 1 && l <= (req.learnMax ?? 0)), 'spellbook');
  if (req.choosePrepared) multi('Prepared spells (up to your limit)', 99, spellList(l => l >= 1 && l <= (req.learnMax ?? 0)), 'spellsPrepared');
  multi('Metamagic', req.metamagic, Object.entries(rules.metamagic).filter(([k]) => !c.metamagic.includes(k)).map(([k, v]) => [k, v.name]), 'metamagic');
  multi('Invocations', req.invocations, Object.entries(rules.invocations).filter(([k, v]) => !c.invocations.includes(k) && (!v.requires?.level || req.classLevel >= v.requires.level)).map(([k, v]) => [k, v.name]), 'invocations');
  multi('Infusions', req.infusions, Object.entries(rules.infusions).filter(([k, v]) => !(c.infusions ?? []).includes(k) && (v.level ?? 2) <= req.classLevel).map(([k, v]) => [k, v.name]), 'infusions');
  const mcFrom = target === 'bard' || def.skills.from === 'any' ? Object.keys(rules.skills) : def.skills.from;
  multi(`${def.name} skill proficiency`, req.multiclassSkills, mcFrom.filter(s => !c.skills.includes(s)).map(s => [s, rules.skillNames[s]]), 'skills');
  multi('Expertise (proficient skills, including one gained above)', req.expertise, [...new Set([...c.skills, ...(req.multiclassSkills ? mcFrom : [])])].filter(s => !c.expertise.includes(s)).map(s => [s, rules.skillNames[s]]), 'expertise');
  let fs;
  if (req.fightingStyle) {
    fs = h('select', {}, def.fightingStyle.options.filter(o => !c.fightingStyles.includes(o)).map(o => h('option', { value: o }, rules.fightingStyles[o].name)));
    parts.push(h('label', {}, 'Fighting style'), fs);
  }
  let boon;
  if (req.pactBoon) {
    boon = h('select', {}, Object.entries(rules.pactBoons).map(([k, v]) => h('option', { value: k }, v)));
    parts.push(h('label', {}, 'Pact boon'), boon);
  }
  const m = modal([...parts, h('div', { class: 'modal-foot' }, h('button', { class: 'btn primary', id: 'confirm-level', onclick: () => {
    if (req.subclass && !subclass) return toast(`Choose a ${def.name} subclass.`, 'error');
    const out = { class: target, hp: hp.value, ...(subclass ? { subclass } : {}) };
    if (req.asi) {
      if (asiMode === 'feat') out.feat = feat ? { key: feat.feat, choice: feat.choice } : { key: '' };
      else {
        const a = asiA.value;
        const b = asiB.value;
        out.asi = { changes: a && b && a !== b ? { [a]: 1, [b]: 1 } : a ? { [a]: 2 } : {} };
      }
    }
    for (const k of ['cantrips', 'spellsKnown', 'spellbook', 'spellsPrepared', 'metamagic', 'invocations', 'infusions', 'skills', 'expertise']) if (choices[k]) out[k] = [...choices[k]];
    if (fs) out.fightingStyle = fs.value;
    if (boon) out.pactBoon = boon.value;
    m.close();
    act({ type: 'levelUp', choices: out });
  } }, 'Level up'))], { wide: true });
}
