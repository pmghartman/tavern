import { h, fill } from './ui.js';

// why a feat is out of reach, null when it can be taken; ctx {abilities, armor:Set, casts}
export function featBlocker(f, ctx) {
  if (!ctx || !f.prereq) return null;
  for (const [a, min] of Object.entries(f.prereq.ability ?? {})) if ((ctx.abilities?.[a] ?? 0) < min) return `needs ${a.toUpperCase()} ${min}`;
  if (f.prereq.armor && !ctx.armor?.has(f.prereq.armor)) return `needs ${f.prereq.armor} armor`;
  if (f.prereq.spellcasting && !ctx.casts) return 'needs spellcasting';
  if (f.prereq.race && ctx.raceBase && !f.prereq.race.includes(ctx.raceBase)) return `${f.prereq.race.map(r => r.replace(/([A-Z])/g, '-$1').toLowerCase()).join('/')} only`;
  if (f.prereq.raceOrSmall && ctx.raceBase && !f.prereq.raceOrSmall.includes(ctx.raceBase) && ctx.raceSize !== 'Small') return 'dwarf or Small only';
  if (f.prereq.martial && ctx.martial === false) return 'needs martial weapons';
  return null;
}

// renders a feat select plus any sub-choices; onChange({feat, choice})
export function featPicker(rules, value, onChange, { exclude = [], id = 'feat', ctx = null } = {}) {
  const box = h('div', { class: 'feat-picker' });
  let cur = { feat: value?.feat ?? '', choice: structuredClone(value?.choice ?? {}) };
  const emit = () => onChange(cur.feat ? { feat: cur.feat, choice: cur.choice } : null);
  function draw() {
    const f = rules.feats[cur.feat];
    const sel = h('select', { id, 'data-feat-select': '1', onchange: e => {
      cur = { feat: e.target.value, choice: {} };
      emit();
      draw();
    } }, h('option', { value: '' }, 'Choose a feat...'), Object.entries(rules.feats).filter(([k]) => !exclude.includes(k) || k === cur.feat).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([k, v]) => {
      const why = k === cur.feat ? null : featBlocker(v, ctx);
      return h('option', { value: k, selected: cur.feat === k, disabled: !!why }, why ? `${v.name} (${why})` : v.name);
    }));
    const parts = [sel];
    if (f) {
      parts.push(h('div', { class: 'small muted' }, f.source ? h('span', { class: 'pill', style: { marginRight: '.4em' } }, f.source) : null, f.desc, f.prereq ? h('span', { class: 'pill', style: { marginLeft: '.4em' } }, `requires ${prereqText(f.prereq)}`) : null));
      if (f.abilityChoice) parts.push(h('label', {}, 'Ability +1'), h('select', { 'data-feat-ability': '1', onchange: e => ((cur.choice.ability = e.target.value), emit()) }, h('option', { value: '' }, '-'), f.abilityChoice.map(a => h('option', { value: a, selected: cur.choice.ability === a }, a.toUpperCase()))));
      if (f.choice === 'skills') {
        cur.choice.skills = cur.choice.skills ?? [];
        parts.push(h('label', {}, `Choose ${f.count} skills`), h('div', { class: 'checklist' }, Object.keys(rules.skills).map(s => h('label', {}, h('input', { type: 'checkbox', checked: cur.choice.skills.includes(s), onchange: e => {
          if (e.target.checked) cur.choice.skills.push(s);
          else cur.choice.skills = cur.choice.skills.filter(x => x !== s);
          emit();
        } }), rules.skillNames[s]))));
      }
      if (f.choice === 'magicInitiate') {
        const cls = cur.choice.class ?? '';
        parts.push(h('label', {}, 'Spell list'), h('select', { onchange: e => {
          cur.choice = { class: e.target.value, cantrips: [], spell: '' };
          emit();
          draw();
        } }, h('option', { value: '' }, '-'), rules.magicInitiateClasses.map(k => h('option', { value: k, selected: cls === k }, rules.classes[k].name))));
        if (cls) {
          const spells = l => Object.values(rules.spells).filter(s => s.classes.includes(cls) && s.level === l).sort((a, b) => a.name.localeCompare(b.name));
          cur.choice.cantrips = cur.choice.cantrips ?? [];
          parts.push(h('label', {}, 'Two cantrips'), h('div', { class: 'checklist' }, spells(0).map(s => h('label', {}, h('input', { type: 'checkbox', checked: cur.choice.cantrips.includes(s.key), onchange: e => {
            if (e.target.checked) cur.choice.cantrips.push(s.key);
            else cur.choice.cantrips = cur.choice.cantrips.filter(x => x !== s.key);
            emit();
          } }), s.name))));
          parts.push(h('label', {}, 'One 1st-level spell (once per long rest)'), h('select', { onchange: e => ((cur.choice.spell = e.target.value), emit()) }, h('option', { value: '' }, '-'), spells(1).map(s => h('option', { value: s.key, selected: cur.choice.spell === s.key }, s.name))));
        }
      }
    }
    if (f) parts.push(...extraChoices(rules, f, cur, emit));
    fill(box, parts);
  }
  draw();
  return box;
}

function prereqText(p) {
  return [
    ...Object.entries(p.ability ?? {}).map(([a, v]) => `${a.toUpperCase()} ${v}`),
    p.armor ? `${p.armor} armor` : null,
    p.spellcasting ? 'spellcasting' : null,
    p.race ? p.race.join(' or ') : null,
    p.raceOrSmall ? 'dwarf or a Small race' : null,
    p.martial ? 'martial weapons' : null,
  ].filter(Boolean).join(', ');
}

// the choices the newer feats bring: spells, an invocation, a style, metamagic, expertise
function extraChoices(rules, f, cur, emit) {
  const out = [];
  const one = (label, field, options) => {
    out.push(h('label', {}, label), h('select', { 'data-feat-pick': field, onchange: e => ((cur.choice[field] = e.target.value ? [e.target.value] : []), emit()) }, h('option', { value: '' }, '-'), options.map(([k, name]) => h('option', { value: k, selected: (cur.choice[field] ?? [])[0] === k }, name))));
  };
  const sp = f.spells;
  if (sp?.atWill?.length || sp?.fixed?.length) out.push(h('div', { class: 'small' }, `Grants ${[...(sp.atWill ?? []).map(k => `${rules.spells[k]?.name} (at will)`), ...(sp.fixed ?? []).map(k => `${rules.spells[k]?.name} (once per long rest)`)].join(', ')}.`));
  if (sp?.cantrips) one(`A ${rules.classes[sp.cantrips.list]?.name ?? sp.cantrips.list} cantrip`, 'cantrips', Object.values(rules.spells).filter(s => s.level === 0 && s.classes.includes(sp.cantrips.list)).sort((a, b) => a.name.localeCompare(b.name)).map(s => [s.key, s.name]));
  if (sp?.pick) one(`A 1st-level ${sp.pick.schools ? sp.pick.schools.join(' or ') : rules.classes[sp.pick.list]?.name ?? ''} spell`, 'spells', Object.values(rules.spells).filter(s => s.level === sp.pick.level && (!sp.pick.list || s.classes.includes(sp.pick.list)) && (!sp.pick.schools || sp.pick.schools.includes(s.school))).sort((a, b) => a.name.localeCompare(b.name)).map(s => [s.key, s.name]));
  if (f.choice === 'invocation') one('Invocation', 'invocations', Object.entries(rules.invocations).filter(([, v]) => !v.requires).map(([k, v]) => [k, v.name]));
  if (f.choice === 'fightingStyle') one('Fighting style', 'styles', Object.entries(rules.fightingStyles).map(([k, v]) => [k, v.name]));
  if (f.choice === 'metamagic') {
    cur.choice.metamagic = cur.choice.metamagic ?? [];
    out.push(h('label', {}, `Choose ${f.count} Metamagic options`), h('div', { class: 'checklist' }, Object.entries(rules.metamagic).map(([k, v]) => h('label', {}, h('input', { type: 'checkbox', checked: cur.choice.metamagic.includes(k), onchange: e => {
      if (e.target.checked) cur.choice.metamagic.push(k);
      else cur.choice.metamagic = cur.choice.metamagic.filter(x => x !== k);
      emit();
    } }), v.name))));
  }
  if (f.expertise) one('Expertise (a skill you are proficient in, or the one above)', 'expertise', Object.keys(rules.skills).map(s => [s, rules.skillNames[s]]));
  return out;
}

export const featChanges = (rules, entry) => {
  const f = rules.feats[entry?.feat];
  if (!f) return {};
  if (f.ability) return { ...f.ability };
  if (f.abilityChoice && entry.choice?.ability) return { [entry.choice.ability]: 1 };
  return {};
};
