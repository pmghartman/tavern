import { FEATS, MAGIC_INITIATE_CLASSES } from './data/feats.js';
import { RACES } from './data/races.js';
import { FIGHTING_STYLES, METAMAGIC, INVOCATIONS } from './data/classes.js';
import { SKILLS, ABILITIES } from './data/core.js';
import { SPELLS } from './data/spells.js';

// feats from ASIs and from a race feature (variant human)
export function featsOf(c) {
  if (!c) return [];
  const out = (c.asiHistory ?? []).filter(a => a.feat).map(a => ({ key: a.feat, choice: a.choice, data: a }));
  if (c.raceFeat?.feat) out.push({ key: c.raceFeat.feat, choice: c.raceFeat.choice, data: c.raceFeat });
  return out;
}

export const hasFeat = (c, key) => c?.kind === 'pc' && featsOf(c).some(f => f.key === key);

// what feats add to a character's own lists (fighting styles, invocations...)
const granted = (c, field) => (c?.kind === 'pc' ? featsOf(c).flatMap(f => f.choice?.[field] ?? []) : []);
export const allStyles = c => [...(c?.fightingStyles ?? []), ...granted(c, 'styles')];
export const allInvocations = c => [...(c?.invocations ?? []), ...granted(c, 'invocations')];
export const allMetamagic = c => [...(c?.metamagic ?? []), ...granted(c, 'metamagic')];
export const allExpertise = c => [...(c?.expertise ?? []), ...granted(c, 'expertise')];

// spells feats grant: { atWill: [], once: [], cantrips: [] }
export function featSpells(c) {
  const out = { atWill: [], once: [], cantrips: [] };
  for (const f of featsOf(c)) {
    const d = FEATS[f.key]?.spells;
    if (!d) continue;
    out.atWill.push(...(d.atWill ?? []));
    out.once.push(...(d.fixed ?? []), ...(f.choice?.spells ?? []));
    out.cantrips.push(...(f.choice?.cantrips ?? []).filter(() => f.key !== 'magicInitiate'));
  }
  return out;
}

export function featSaves(c) {
  return featsOf(c).filter(f => FEATS[f.key]?.grantsSave).map(f => f.choice?.ability).filter(Boolean);
}

export function featArmor(c) {
  return featsOf(c).flatMap(f => FEATS[f.key]?.grantsArmor ?? []);
}

// ability increase a feat grants, used by finalAbilities through entry.changes
export function featChanges(key, choice) {
  const f = FEATS[key];
  if (!f) return {};
  if (f.ability) return { ...f.ability };
  if (f.abilityChoice && choice?.ability) return { [choice.ability]: 1 };
  return {};
}

// validate a feat pick; ctx carries what prerequisites need
export function validateFeat(key, choice, { abilities, armorProfs, casts, existing = [], knownSkills = [], race = null, weaponProfs = null }) {
  const errs = [];
  const f = Object.hasOwn(FEATS, key ?? '') ? FEATS[key] : null;
  if (!f) return [`Unknown feat "${key}".`];
  if (existing.includes(key)) errs.push(`You already have ${f.name}.`);
  for (const [ab, min] of Object.entries(f.prereq?.ability ?? {})) if ((abilities?.[ab] ?? 0) < min) errs.push(`${f.name} requires ${ab.toUpperCase()} ${min}.`);
  if (f.prereq?.armor && !armorProfs.has(f.prereq.armor)) errs.push(`${f.name} requires proficiency with ${f.prereq.armor} armor.`);
  if (f.prereq?.spellcasting && !casts) errs.push(`${f.name} requires the ability to cast at least one spell.`);
  const base = RACES[race]?.base ?? race;
  if (f.prereq?.race && race && !f.prereq.race.includes(base)) errs.push(`${f.name} is a feat for ${f.prereq.race.join(', ')} characters.`);
  if (f.prereq?.raceOrSmall && race && !f.prereq.raceOrSmall.includes(base) && RACES[race]?.size !== 'Small') errs.push(`${f.name} needs a dwarf or a Small race.`);
  if (f.prereq?.martial && weaponProfs && !weaponProfs.has('martial')) errs.push(`${f.name} requires proficiency with martial weapons.`);
  if (f.expertise) {
    const ex = choice?.expertise ?? [];
    if (ex.length !== f.expertise) errs.push(`${f.name}: choose ${f.expertise} skill for expertise.`);
    for (const s of ex) if (!knownSkills.includes(s) && !(choice?.skills ?? []).includes(s)) errs.push(`${f.name}: expertise needs a skill you are proficient in.`);
  }
  if (f.spells?.cantrips) {
    const cs = choice?.cantrips ?? [];
    if (cs.length !== f.spells.cantrips.count) errs.push(`${f.name}: choose ${f.spells.cantrips.count} cantrip.`);
    for (const k of cs) if (!SPELLS[k] || SPELLS[k].level !== 0 || !SPELLS[k].classes.includes(f.spells.cantrips.list)) errs.push(`${SPELLS[k]?.name ?? k} is not a ${f.spells.cantrips.list} cantrip.`);
  }
  if (f.spells?.pick) {
    const p = f.spells.pick;
    const ss = choice?.spells ?? [];
    if (ss.length !== 1) errs.push(`${f.name}: choose one ${p.level === 1 ? '1st' : p.level}-level spell.`);
    for (const k of ss) {
      const sp = SPELLS[k];
      if (!sp || sp.level !== p.level || (p.list && !sp.classes.includes(p.list)) || (p.schools && !p.schools.includes(sp.school))) errs.push(`${sp?.name ?? k} does not fit ${f.name}.`);
    }
  }
  if (f.choice === 'invocation') {
    const inv = choice?.invocations ?? [];
    if (inv.length !== 1 || !INVOCATIONS[inv[0]]) errs.push(`${f.name}: choose an invocation.`);
    else if (INVOCATIONS[inv[0]].requires) errs.push(`${f.name}: ${INVOCATIONS[inv[0]].name} has a prerequisite.`);
  }
  if (f.choice === 'fightingStyle') {
    const st = choice?.styles ?? [];
    if (st.length !== 1 || !FIGHTING_STYLES[st[0]]) errs.push(`${f.name}: choose a fighting style.`);
  }
  if (f.choice === 'metamagic') {
    const mm = choice?.metamagic ?? [];
    if (mm.length !== f.count || new Set(mm).size !== mm.length || mm.some(m => !METAMAGIC[m])) errs.push(`${f.name}: choose ${f.count} different Metamagic options.`);
  }
  if (f.abilityChoice && !f.abilityChoice.includes(choice?.ability)) errs.push(`${f.name}: choose an ability to increase (${f.abilityChoice.join(', ')}).`);
  if (f.choice === 'skills') {
    const sk = choice?.skills ?? [];
    if (sk.length !== f.count || new Set(sk).size !== sk.length) errs.push(`${f.name}: choose ${f.count} different skills.`);
    for (const s of sk) {
      if (!SKILLS[s]) errs.push(`Unknown skill "${s}".`);
      else if (knownSkills.includes(s)) errs.push(`You are already proficient in ${s}.`);
    }
  }
  if (f.choice === 'magicInitiate') {
    const cls = choice?.class;
    if (!MAGIC_INITIATE_CLASSES.includes(cls)) errs.push(`Magic Initiate: choose a class (${MAGIC_INITIATE_CLASSES.join(', ')}).`);
    else {
      const cantrips = choice.cantrips ?? [];
      if (cantrips.length !== 2 || new Set(cantrips).size !== 2) errs.push('Magic Initiate: choose two different cantrips.');
      for (const k of cantrips) if (!SPELLS[k] || SPELLS[k].level !== 0 || !SPELLS[k].classes.includes(cls)) errs.push(`${SPELLS[k]?.name ?? k} is not a ${cls} cantrip.`);
      const sp = SPELLS[choice.spell];
      if (!sp || sp.level !== 1 || !sp.classes.includes(cls)) errs.push(`Magic Initiate: choose one 1st-level ${cls} spell.`);
    }
  }
  void ABILITIES;
  return errs;
}

export { FEATS };
