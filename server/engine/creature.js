import { cl, hasSub, subclassesOf } from './classlevel.js';
import { ABILITIES, SKILLS, INCAPACITATING, abilityMod, profBonus, crValue } from './data/core.js';
import { RACES, DRACONIC_ANCESTRY } from './data/races.js';
import { CLASSES } from './data/classes.js';
import { MONSTERS } from './data/monsters.js';
import { finalAbilities, equipped, armorDef, itemDef, hasFeature, isProficientArmor, weaponDef } from './character.js';
import { featSaves, hasFeat, featsOf, allStyles, allExpertise } from './feats.js';
import { FEATS } from './data/feats.js';

export const isPC = c => c?.kind === 'pc';
export const statBlock = c => (isPC(c) ? (c.wildShape ? MONSTERS[c.wildShape.beast] : null) : MONSTERS[c.key]);

export function monsterProf(cr) {
  const v = crValue(cr);
  if (v < 5) return 2;
  return Math.min(9, 2 + Math.ceil((v - 4) / 4));
}

export function abilities(c) {
  if (isPC(c)) {
    const a = finalAbilities(c);
    if (c.wildShape) {
      const b = MONSTERS[c.wildShape.beast];
      return { ...a, str: b.abilities[0], dex: b.abilities[1], con: b.abilities[2] };
    }
    return a;
  }
  const b = MONSTERS[c.key];
  return Object.fromEntries(ABILITIES.map((k, i) => [k, b.abilities[i]]));
}

export const mod = (c, ab) => abilityMod(abilities(c)[ab]);
export const prof = c => (isPC(c) ? profBonus(c.level) : monsterProf(MONSTERS[c.key].cr));

export function activeEffects(c) {
  return c.effects ?? [];
}

export function effectSum(c, field) {
  return activeEffects(c).reduce((s, e) => s + (typeof e[field] === 'number' ? e[field] : 0), 0);
}

export function conditionSet(c) {
  const s = new Set((c.conditions ?? []).map(x => (typeof x === 'string' ? x : x.name)));
  for (const e of activeEffects(c)) for (const cond of e.conditions ?? []) s.add(cond);
  if ((c.exhaustion ?? 0) > 0) s.add('exhaustion');
  const immune = defenses(c).condImmune;
  for (const ci of immune) s.delete(ci);
  if (s.has('paralyzed') || s.has('stunned') || s.has('petrified') || s.has('unconscious')) s.add('incapacitated');
  if (s.has('unconscious')) s.add('prone');
  return s;
}
export const hasCond = (c, name) => conditionSet(c).has(name);
export const isIncapacitated = c => INCAPACITATING.some(x => hasCond(c, x));
export const isDown = c => c.dead || c.hp <= 0;

export function isRaging(c) {
  return activeEffects(c).some(e => e.rage);
}

export function creatureType(c) {
  if (isPC(c)) return c.wildShape ? 'beast' : 'humanoid';
  return MONSTERS[c.key].type;
}
export function size(c) {
  if (isPC(c)) return c.wildShape ? MONSTERS[c.wildShape.beast].size : RACES[c.race].size;
  return MONSTERS[c.key].size;
}
export const SIZE_ORDER = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];

export function defenses(c) {
  const resist = new Set();
  const immune = new Set();
  const vuln = new Set();
  const condImmune = new Set();
  if (isPC(c)) {
    const race = RACES[c.race];
    (race?.resistances ?? []).forEach(r => resist.add(r));
    if (race?.traits?.includes('draconicResistance') && c.ancestry) resist.add(DRACONIC_ANCESTRY[c.ancestry].type);
    if (isRaging(c)) ['bludgeoning', 'piercing', 'slashing'].forEach(r => resist.add(r));
    // Totem Spirit (Bear): everything but psychic while raging
    if (isRaging(c) && hasSub(c, 'barbarian', 'totemWarrior', 3)) ['acid', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'poison', 'radiant', 'thunder'].forEach(r => resist.add(r));
    if (hasSub(c, 'warlock', 'greatOldOne', 10)) resist.add('psychic');
    if (cl(c, 'monk') >= 10) {
      immune.add('poison');
      condImmune.add('poisoned');
    }
    if (hasSub(c, 'druid', 'land', 10)) {
      immune.add('poison');
      condImmune.add('poisoned');
    }
    if (hasSub(c, 'barbarian', 'berserker', 6) && isRaging(c)) {
      condImmune.add('charmed');
      condImmune.add('frightened');
    }
    if (c.fiendishResistance) resist.add(c.fiendishResistance);
    for (const f of featsOf(c)) (FEATS[f.key]?.resist ?? []).forEach(r => resist.add(r));
    for (const s of subclassesOf(c)) for (const r of s.def.resist ?? []) if (s.level >= r.level && (!r.raging || isRaging(c))) r.types.forEach(t => resist.add(t));
  } else {
    const b = MONSTERS[c.key];
    b.resist.forEach(r => resist.add(r));
    b.immune.forEach(r => immune.add(r));
    b.vuln.forEach(r => vuln.add(r));
    b.condImmune.forEach(r => condImmune.add(r));
  }
  for (const e of activeEffects(c)) {
    (e.resistances ?? []).forEach(r => resist.add(r));
    (e.immunities ?? []).forEach(r => immune.add(r));
    (e.immuneConditions ?? []).forEach(r => condImmune.add(r));
  }
  if ((c.conditions ?? []).some(x => (x.name ?? x) === 'petrified')) {
    ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'psychic', 'radiant', 'slashing', 'thunder'].forEach(r => resist.add(r));
    immune.add('poison');
  }
  return { resist: [...resist], immune: [...immune], vuln: [...vuln], condImmune: [...condImmune] };
}

function passiveItems(c) {
  if (!isPC(c)) return [];
  return (c.inventory ?? []).filter(i => i.equipped && i.equipped !== 'pack').map(i => ({ inv: i, def: itemDef(i) })).filter(x => x.def?.passive && (!x.def.attunement || x.inv.attuned));
}

export function armorClass(c) {
  const effAc = effectSum(c, 'acBonus');
  if (!isPC(c)) return MONSTERS[c.key].ac + effAc + (activeEffects(c).some(e => e.mageArmor) ? 3 : 0);
  if (c.wildShape) return MONSTERS[c.wildShape.beast].ac + effAc;
  const dex = mod(c, 'dex');
  const armorInv = equipped(c, 'armor');
  const offInv = equipped(c, 'offHand');
  const armor = armorInv ? armorDef(armorInv) : null;
  const shield = offInv ? armorDef(offInv) : null;
  const hasShield = shield?.category === 'shield';
  let base;
  if (armor) {
    if (armor.category === 'light') base = armor.baseAc + dex;
    else if (armor.category === 'medium') base = armor.baseAc + Math.min(2, dex);
    else base = armor.baseAc;
    base += armor.bonus ?? 0;
    if (armor.category === 'heavy') for (const s of subclassesOf(c)) if (s.def.heavyAcBonus && s.level >= s.def.heavyAcBonus.level) base += s.def.heavyAcBonus.bonus;
    if (allStyles(c).includes('defense')) base += 1;
  } else {
    const options = [10 + dex];
    if (hasFeature(c, 'unarmoredDefenseBarbarian')) options.push(10 + dex + mod(c, 'con'));
    if (hasFeature(c, 'unarmoredDefenseMonk') && !hasShield) options.push(10 + dex + mod(c, 'wis'));
    if (hasSub(c, 'sorcerer', 'draconic')) options.push(13 + dex);
    if (featsOf(c).some(f => FEATS[f.key]?.unarmoredAc)) options.push(13 + dex);
    if (activeEffects(c).some(e => e.mageArmor)) options.push(13 + dex);
    base = Math.max(...options);
    for (const p of passiveItems(c)) if (p.def.passive.acBonusUnarmored && !hasShield) base += p.def.passive.acBonusUnarmored;
  }
  if (hasShield) base += 2 + (shield.bonus ?? 0);
  if (hasFeat(c, 'dualWielder') && offInv && weaponDef(offInv) && equipped(c, 'mainHand') && weaponDef(equipped(c, 'mainHand'))) base += 1;
  for (const p of passiveItems(c)) base += p.def.passive.acBonus ?? 0;
  // barkskin: a floor, not a bonus
  const floor = Math.max(0, ...activeEffects(c).map(e => e.minAc ?? 0));
  return Math.max(base + effAc, floor);
}

export function speed(c) {
  let s;
  if (isPC(c)) {
    if (c.wildShape) s = MONSTERS[c.wildShape.beast].speed;
    else {
      s = RACES[c.race].speed;
      const armorInv = equipped(c, 'armor');
      const armor = armorInv ? armorDef(armorInv) : null;
      if (armor?.strength && abilities(c).str < armor.strength) s -= 10;
      if (cl(c, 'barbarian') >= 5 && armor?.category !== 'heavy') s += 10;
      if (cl(c, 'monk') >= 2 && !armor && equipped(c, 'offHand')?.key !== 'shield') {
        { const m = cl(c, 'monk'); s += m >= 18 ? 30 : m >= 14 ? 25 : m >= 10 ? 20 : m >= 6 ? 15 : 10; }
      }
      for (const p of passiveItems(c)) if (p.def.passive.speedFloor) s = Math.max(s, p.def.passive.speedFloor);
    }
  } else s = MONSTERS[c.key].speed;
  if (hasFeat(c, 'mobile')) s += 10;
  s += effectSum(c, 'speedBonus');
  s -= effectSum(c, 'speedPenalty');
  for (const e of activeEffects(c)) if (e.speedMultiplier) s = Math.floor(s * e.speedMultiplier);
  const ex = c.exhaustion ?? 0;
  if (ex >= 2) s = Math.floor(s / 2);
  if (ex >= 5) s = 0;
  const conds = conditionSet(c);
  if (conds.has('grappled') || conds.has('restrained') || conds.has('paralyzed') || conds.has('stunned') || conds.has('unconscious') || conds.has('petrified')) s = 0;
  if (activeEffects(c).some(e => e.speedZero)) s = 0;
  return Math.max(0, s);
}

export function saveProficient(c, ab) {
  if (!isPC(c)) return MONSTERS[c.key].saves?.[ab] !== undefined;
  if (cl(c, 'monk') >= 14) return true;
  if (cl(c, 'rogue') >= 15 && ab === 'wis') return true;
  return CLASSES[c.class].saves.includes(ab) || featSaves(c).includes(ab);
}

export function saveMod(c, ab) {
  if (!isPC(c)) {
    const b = MONSTERS[c.key];
    return (b.saves?.[ab] ?? mod(c, ab)) + (ab === 'dex' ? effectSum(c, 'dexSaveBonus') : 0) + effectSum(c, 'saveBonus');
  }
  let v = mod(c, ab) + (saveProficient(c, ab) ? prof(c) : 0);
  for (const p of passiveItems(c)) v += p.def.passive.saveBonus ?? 0;
  if (ab === 'dex') v += effectSum(c, 'dexSaveBonus');
  return v + effectSum(c, 'saveBonus');
}

export function skillMod(c, skill) {
  const ab = SKILLS[skill];
  if (!isPC(c)) return MONSTERS[c.key].skills?.[skill] ?? mod(c, ab);
  const pb = prof(c);
  let v = mod(c, ab);
  if (c.skills?.includes(skill)) v += allExpertise(c).includes(skill) ? pb * 2 : pb;
  else if (cl(c, 'bard') >= 2) v += Math.floor(pb / 2);
  else if (hasSub(c, 'fighter', 'champion', 7) && ['str', 'dex', 'con'].includes(ab)) v += Math.ceil(pb / 2);
  for (const e of activeEffects(c)) v += e.skillBonus?.[skill] ?? 0;
  return v;
}

export function checkMod(c, ab) {
  if (!isPC(c)) return mod(c, ab);
  let v = mod(c, ab);
  const pb = prof(c);
  if (cl(c, 'bard') >= 2) v += Math.floor(pb / 2);
  else if (hasSub(c, 'fighter', 'champion', 7) && ['str', 'dex', 'con'].includes(ab)) v += Math.ceil(pb / 2);
  return v;
}

export function passivePerception(c) {
  return 10 + skillMod(c, 'perception') + (hasFeat(c, 'observant') ? 5 : 0);
}

export function hasTrait(c, key) {
  if (isPC(c)) return RACES[c.race]?.traits?.includes(key) || hasFeature(c, key);
  return MONSTERS[c.key].traits.some(t => t.key === key);
}

export function skillAdvantageFromItems(c, skill) {
  return passiveItems(c).some(p => p.def.passive.skillAdvantage?.includes(skill));
}

export function stealthDisadvantage(c) {
  if (!isPC(c)) return false;
  const a = equipped(c, 'armor');
  return !!(a && armorDef(a)?.stealthDisadvantage);
}

export function wearingNonProficientArmor(c) {
  if (!isPC(c)) return false;
  const a = equipped(c, 'armor');
  const s = equipped(c, 'offHand');
  return (a && !isProficientArmor(c, armorDef(a))) || (s && armorDef(s)?.category === 'shield' && !isProficientArmor(c, armorDef(s)));
}

export function maxHp(c) {
  return c.maxHp;
}
