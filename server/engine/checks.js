import { hasFeat } from './feats.js';
import { cl } from './classlevel.js';
import { SKILLS, SKILL_NAMES, ABILITY_NAMES } from './data/core.js';
import { rollD20, roll } from './dice.js';
import { cryptoRng } from './rng.js';
import { isPC, conditionSet, skillMod, checkMod, saveMod, hasTrait, isRaging, activeEffects, skillAdvantageFromItems, stealthDisadvantage, wearingNonProficientArmor, abilities, statBlock } from './creature.js';
import { fmtMod } from './util.js';

function consumeEffect(c, pred) {
  const idx = (c.effects ?? []).findIndex(pred);
  if (idx < 0) return null;
  const [e] = c.effects.splice(idx, 1);
  return e;
}

function useInspiration(c, total, dc, rng, breakdown) {
  if (dc === undefined || total >= dc || !c.inspirationDie) return total;
  const r = roll(c.inspirationDie, rng);
  breakdown.push(`Bardic Inspiration ${r.detail} = ${fmtMod(r.total)}`);
  c.inspirationDie = null;
  return total + r.total;
}

export function abilityCheck(c, { skill, ability, dc, advantage = false, disadvantage = false, rng = cryptoRng, reason, contested = false } = {}) {
  if (skill && !SKILLS[skill]) throw new Error(`unknown skill ${skill}`);
  const ab = skill ? SKILLS[skill] : ability;
  if (!ABILITY_NAMES[ab]) throw new Error(`unknown ability ${ability}`);
  const conds = conditionSet(c);
  const breakdown = [];
  let adv = advantage;
  let dis = disadvantage;
  if (conds.has('poisoned')) (dis = true), breakdown.push('poisoned: disadvantage');
  if (conds.has('frightened')) (dis = true), breakdown.push('frightened: disadvantage');
  if ((c.exhaustion ?? 0) >= 1) (dis = true), breakdown.push('exhaustion: disadvantage');
  if (ab === 'str' && isRaging(c)) (adv = true), breakdown.push('rage: advantage');
  if (skill === 'stealth' && stealthDisadvantage(c)) (dis = true), breakdown.push('armor: stealth disadvantage');
  if ((ab === 'str' || ab === 'dex') && wearingNonProficientArmor(c)) (dis = true), breakdown.push('non-proficient armor: disadvantage');
  if (skill && skillAdvantageFromItems(c, skill)) (adv = true), breakdown.push('magic item: advantage');
  if (activeEffects(c).some(e => e.checkDisadvantage?.includes(ab))) (dis = true), breakdown.push('hex: disadvantage');
  if (skill === 'perception' && hasTrait(c, 'keenHearingSmell')) breakdown.push('keen senses may apply');

  const d = rollD20(rng, { advantage: adv, disadvantage: dis, luckyHalfling: hasTrait(c, 'lucky') });
  let natural = d.natural;
  const bonus = skill ? skillMod(c, skill) : checkMod(c, ab);
  if (isPC(c) && cl(c, 'rogue') >= 11 && skill && c.skills?.includes(skill) && natural < 10) {
    breakdown.push(`Reliable Talent: ${natural} counts as 10`);
    natural = 10;
  }
  let total = natural + bonus;
  if (isPC(c) && cl(c, 'barbarian') >= 18 && ab === 'str' && total < abilities(c).str) {
    breakdown.push('Indomitable Might');
    total = abilities(c).str;
  }
  const guid = consumeEffect(c, e => e.checkDie);
  if (guid) {
    const r = roll(guid.checkDie, rng);
    breakdown.push(`${guid.name} ${r.detail} = ${fmtMod(r.total)}`);
    total += r.total;
  }
  if (!contested) total = useInspiration(c, total, dc, rng, breakdown);
  if (!contested && dc !== undefined && total < dc && spendLuck(c)) {
    const again = rollD20(rng, { luckyHalfling: hasTrait(c, 'lucky') });
    breakdown.push(`Lucky reroll ${again.natural}`);
    total = total - d.natural + again.natural;
  }
  const label = skill ? `${SKILL_NAMES[skill]} (${ABILITY_NAMES[ab]})` : `${ABILITY_NAMES[ab]}`;
  return {
    kind: 'check', who: c.name, label, skill: skill ?? null, ability: ab, natural: d.natural, rolls: d.rolls, mode: d.mode,
    bonus, total, dc: dc ?? null, success: dc === undefined ? null : total >= dc, breakdown, reason: reason ?? null,
  };
}

export function savingThrow(c, ability, { dc, advantage = false, disadvantage = false, rng = cryptoRng, magical = false, against = null, auraBonus = 0, autoSucceed = false, reason } = {}) {
  const conds = conditionSet(c);
  const breakdown = [];
  const label = `${ABILITY_NAMES[ability]} save`;
  if (autoSucceed) return { kind: 'save', who: c.name, label, ability, natural: null, rolls: [], total: null, dc, success: true, breakdown: ['automatic success'], reason };
  if ((ability === 'str' || ability === 'dex') && ['paralyzed', 'stunned', 'unconscious', 'petrified'].some(x => conds.has(x))) {
    return { kind: 'save', who: c.name, label, ability, natural: null, rolls: [], total: null, dc, success: false, breakdown: ['automatic failure (incapacitated)'], autoFail: true, reason };
  }
  let adv = advantage;
  let dis = disadvantage;
  if (disadvantage) breakdown.push('disadvantage');
  if (ability === 'dex' && conds.has('restrained')) (dis = true), breakdown.push('restrained: disadvantage');
  if ((c.exhaustion ?? 0) >= 3) (dis = true), breakdown.push('exhaustion: disadvantage');
  if ((ability === 'str' || ability === 'dex') && wearingNonProficientArmor(c)) (dis = true), breakdown.push('non-proficient armor: disadvantage');
  if (ability === 'str' && isRaging(c)) (adv = true), breakdown.push('rage: advantage');
  if (ability === 'dex' && isPC(c) && cl(c, 'barbarian') >= 2 && !['blinded', 'deafened', 'incapacitated'].some(x => conds.has(x))) (adv = true), breakdown.push('Danger Sense: advantage');
  for (const e of activeEffects(c)) {
    if (e.advSaves?.includes(ability)) (adv = true), breakdown.push(`${e.name}: advantage`);
    if (ability === 'dex' && e.dexSaveAdvantage) (adv = true), breakdown.push(`${e.name}: advantage`);
  }
  if (against === 'poison' && hasTrait(c, 'dwarvenResilience')) (adv = true), breakdown.push('Dwarven Resilience: advantage');
  if (against === 'charmed' && (hasTrait(c, 'feyAncestry') || hasTrait(c, 'darkDevotion'))) (adv = true), breakdown.push('advantage vs charm');
  if (against === 'frightened' && (hasTrait(c, 'brave') || hasTrait(c, 'darkDevotion'))) (adv = true), breakdown.push('advantage vs fear');
  if (magical && ['int', 'wis', 'cha'].includes(ability) && hasTrait(c, 'gnomeCunning')) (adv = true), breakdown.push('Gnome Cunning: advantage');
  if (magical && hasTrait(c, 'magicResistance')) (adv = true), breakdown.push('Magic Resistance: advantage');

  const once = () => {
    const d = rollD20(rng, { advantage: adv, disadvantage: dis, luckyHalfling: hasTrait(c, 'lucky') });
    const bonus = saveMod(c, ability) + auraBonus;
    let total = d.natural + bonus;
    const extra = [];
    for (const e of activeEffects(c)) {
      if (e.saveDie) {
        const r = roll(e.saveDie.replace(/^-/, ''), rng);
        const v = e.saveDie.startsWith('-') ? -r.total : r.total;
        extra.push(`${e.name} ${fmtMod(v)}`);
        total += v;
      }
    }
    return { d, bonus, total, extra };
  };
  let r = once();
  breakdown.push(...r.extra);
  if (auraBonus) breakdown.push(`Aura of Protection ${fmtMod(auraBonus)}`);
  const res = consumeEffect(c, e => e.saveDieOnce);
  if (res) {
    const x = roll(res.saveDieOnce, rng);
    breakdown.push(`${res.name} ${fmtMod(x.total)}`);
    r.total += x.total;
  }
  r.total = useInspiration(c, r.total, dc, rng, breakdown);
  if (dc !== undefined && r.total < dc && spendLuck(c)) {
    const again = rollD20(rng, { luckyHalfling: hasTrait(c, 'lucky') });
    breakdown.push(`Lucky reroll ${again.natural}`);
    r.total = r.total - r.d.natural + again.natural;
  }
  let success = dc === undefined ? null : r.total >= dc;
  const result = { kind: 'save', who: c.name, label, ability, natural: r.d.natural, rolls: r.d.rolls, mode: r.d.mode, bonus: r.bonus, total: r.total, dc, success, breakdown, reason };
  if (success === false && isPC(c) && cl(c, 'fighter') > 0 && c.preferences?.autoIndomitable !== false) {
    const res2 = c.resources?.indomitable;
    if (res2 && res2.used < res2.max) {
      res2.used++;
      const again = once();
      result.breakdown.push(`Indomitable reroll: ${again.d.natural} ${fmtMod(again.bonus)} = ${again.total}`);
      result.total = again.total;
      result.natural = again.d.natural;
      result.success = again.total >= dc;
    }
  }
  return result;
}

function spendLuck(c) {
  const luck = isPC(c) && hasFeat(c, 'lucky') && c.preferences?.autoLucky !== false ? c.resources?.luck : null;
  if (!luck || luck.used >= luck.max) return false;
  luck.used += 1;
  return true;
}

export function contest(a, aSpec, b, bSpec, rng = cryptoRng) {
  const ra = abilityCheck(a, { ...aSpec, rng, contested: true });
  const rb = abilityCheck(b, { ...bSpec, rng, contested: true });
  // ties keep the status quo, so the defender wins
  return { attacker: ra, defender: rb, winner: ra.total > rb.total ? 'attacker' : 'defender' };
}

export function initiativeRoll(c, rng = cryptoRng) {
  const adv = isPC(c) && cl(c, 'barbarian') >= 7;
  const dis = (c.exhaustion ?? 0) >= 1;
  const d = rollD20(rng, { advantage: adv, disadvantage: dis, luckyHalfling: hasTrait(c, 'lucky') });
  const bonus = checkMod(c, 'dex') + (hasFeat(c, 'alert') ? 5 : 0);
  return { natural: d.natural, rolls: d.rolls, bonus, total: d.natural + bonus, mode: d.mode };
}

export function describeRoll(r) {
  if (r.natural === null) return `${r.who}: ${r.label} - ${r.breakdown.join(', ')}`;
  const dice = r.rolls.length > 1 ? `[${r.rolls.join(', ')}] ${r.mode}` : `${r.natural}`;
  const tail = r.dc !== null && r.dc !== undefined ? ` vs DC ${r.dc}: ${r.success ? 'success' : 'failure'}` : '';
  return `${r.who}: ${r.label} ${dice} ${fmtMod(r.bonus)} = ${r.total}${tail}${r.breakdown.length ? ` (${r.breakdown.join('; ')})` : ''}`;
}

export { statBlock };
