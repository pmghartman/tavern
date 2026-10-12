import { cl, hasSub, subclassesOf } from './classlevel.js';
import { MONSTERS } from './data/monsters.js';
import { SPELLS } from './data/spells.js';
import { WEAPONS, GEAR } from './data/items.js';
import { RACES } from './data/races.js';
import { rollD20, roll } from './dice.js';
import { isPC, mod, prof, armorClass, conditionSet, hasTrait, activeEffects, isIncapacitated, size, SIZE_ORDER, wearingNonProficientArmor, creatureType, abilities, isRaging } from './creature.js';
import { equipped, weaponDef, isProficientWeapon, finalAbilities, castableSpells } from './character.js';
import { savingThrow } from './checks.js';
import { RuleError, fmtMod, uid } from './util.js';
import { creatureById, combatant, event, hostile } from './state.js';
import { requireTurn, spendAction, cbDistance, livingCombatants, auraBonusFor, pushAway, hasActionAvailable, checkEncounterEnd } from './combat.js';
import { applyDamage } from './damage.js';
import { addEffect, removeEffect, removeEffectsWhere } from './effects.js';
import { distanceFt } from './grid.js';
import { hasFeat, allStyles, allInvocations } from './feats.js';

const martialArtsDie = lvl => (lvl >= 17 ? '1d10' : lvl >= 11 ? '1d8' : lvl >= 5 ? '1d6' : '1d4');
const rageBonus = lvl => (lvl >= 16 ? 4 : lvl >= 9 ? 3 : 2);
export const sneakDice = lvl => `${Math.ceil(lvl / 2)}d6`;

function isMonkWeapon(w) {
  if (!w) return true;
  const key = w.baseKey ?? Object.keys(WEAPONS).find(k => WEAPONS[k].name === w.name);
  if (key === 'shortsword') return true;
  return w.category === 'simpleMelee' && !w.properties.includes('twoHanded') && !w.properties.includes('heavy');
}

function upDie(a, b) {
  const s = x => Number(/d(\d+)/.exec(x)?.[1] ?? 0) * Number(/(\d+)d/.exec(x)?.[1] ?? 1);
  return s(a) >= s(b) ? a : b;
}

function profileFromWeapon(c, inv, slot, opts = {}) {
  const w = weaponDef(inv);
  if (!w) return null;
  const a = finalAbilities(c);
  const m = k => Math.floor((a[k] - 10) / 2);
  const ranged = w.category.endsWith('Ranged');
  const thrown = opts.thrown;
  const finesse = w.properties.includes('finesse');
  const monk = cl(c, 'monk') > 0 && isMonkWeapon(w) && !ranged;
  const shillelagh = activeEffects(c).some(e => e.shillelagh) && ['club', 'quarterstaff'].includes(w.baseKey ?? inv.key);
  let ab = ranged ? 'dex' : 'str';
  if ((finesse || monk) && m('dex') > m('str')) ab = 'dex';
  if (shillelagh && m('wis') > m(ab)) ab = 'wis';
  const pb = isProficientWeapon(c, w) ? prof(c) : 0;
  const offHandOcc = equipped(c, 'offHand');
  let dice = w.damage;
  const twoHanding = w.properties.includes('versatile') && slot === 'mainHand' && !offHandOcc;
  if (twoHanding) dice = w.versatile;
  if (monk) dice = upDie(dice, martialArtsDie(cl(c, 'monk')));
  if (shillelagh) dice = upDie(dice, '1d8');
  const isOff = slot === 'offHand';
  let dmgBonus = m(ab) + (w.bonus ?? 0);
  if (isOff && m(ab) > 0 && !allStyles(c).includes('twoWeaponFighting')) dmgBonus = w.bonus ?? 0;
  let toHit = m(ab) + pb + (w.bonus ?? 0);
  if ((ranged || thrown) && allStyles(c).includes('archery') && ranged) toHit += 2;
  if (!ranged && !thrown && !isOff && allStyles(c).includes('dueling') && !w.properties.includes('twoHanded') && !twoHanding && !(offHandOcc && weaponDef(offHandOcc))) dmgBonus += 2;
  const reach = ranged || thrown ? null : w.properties.includes('reach') ? 10 : 5;
  return {
    id: `${inv.id}${thrown ? ':thrown' : ''}`, name: `${w.name}${thrown ? ' (thrown)' : ''}${isOff ? ' (off-hand)' : ''}`,
    kind: ranged || thrown ? 'ranged' : 'melee', weaponAttack: true, toHit, reach, range: ranged || thrown ? w.range : null,
    damage: { dice, type: w.damageType, bonus: dmgBonus }, ability: ab, properties: w.properties, magical: !!w.magical,
    invId: inv.id, itemKey: inv.key, baseKey: w.baseKey ?? inv.key, slot, offhand: isOff, thrown: !!thrown, ammo: ranged ? w.ammo : null,
    twoHanded: w.properties.includes('twoHanded') || twoHanding, monk, finesse, ignitable: w.ignitable,
  };
}

export function attackProfiles(state, c) {
  const out = [];
  if (isPC(c) && !c.wildShape) {
    for (const slot of ['mainHand', 'offHand']) {
      const inv = equipped(c, slot);
      if (!inv) continue;
      const w = weaponDef(inv);
      if (!w) continue;
      if (w.category.endsWith('Melee') || w.category.endsWith('Ranged')) out.push(profileFromWeapon(c, inv, slot));
      if (w.properties.includes('thrown') && w.category.endsWith('Melee')) out.push(profileFromWeapon(c, inv, slot, { thrown: true }));
    }
    const a = finalAbilities(c);
    const strM = Math.floor((a.str - 10) / 2);
    const dexM = Math.floor((a.dex - 10) / 2);
    const monk = cl(c, 'monk') > 0;
    const ab = monk && dexM > strM ? 'dex' : 'str';
    const am = ab === 'dex' ? dexM : strM;
    const raging = activeEffects(c).some(e => e.rage);
    if (hasFeat(c, 'polearmMaster')) {
      const main = equipped(c, 'mainHand');
      const w = main ? weaponDef(main) : null;
      if (w && ['glaive', 'halberd', 'quarterstaff', 'spear'].includes(w.baseKey ?? main.key)) {
        const p = profileFromWeapon(c, main, 'mainHand');
        out.push({ ...p, id: 'polearmButt', name: `${w.name} (butt end)`, damage: { dice: '1d4', type: 'bludgeoning', bonus: p.damage.bonus }, baseKey: 'polearmButt' });
      }
    }
    out.push({
      id: 'unarmed', name: 'Unarmed Strike', kind: 'melee', weaponAttack: true, toHit: am + prof(c), reach: 5, range: null,
      damage: monk ? { dice: martialArtsDie(cl(c, 'monk')), type: 'bludgeoning', bonus: am } : { dice: null, flat: 1 + am, type: 'bludgeoning', bonus: 0 },
      ability: ab, properties: [], magical: monk && cl(c, 'monk') >= 6, unarmed: true, monk,
    });
    void raging;
  } else {
    const b = isPC(c) ? MONSTERS[c.wildShape.beast] : MONSTERS[c.key];
    for (const a of b.actions) {
      out.push({
        id: a.key, name: a.name, kind: a.kind, weaponAttack: true, toHit: isPC(c) && c.wildShape ? a.toHit : a.toHit, reach: a.kind === 'melee' ? a.reach ?? 5 : null,
        range: a.range ?? null, damage: parseMonsterDamage(a.damage, a.type), extra: a.extra ?? null, onHit: a.onHit ?? null, magical: false, monster: true, replaces: a.replaces,
      });
    }
  }
  return out;
}

function parseMonsterDamage(expr, type) {
  const m = /^(.*?)([+-]\d+)?$/.exec(expr.replace(/\s/g, ''));
  if (/d/.test(expr)) return { dice: m[1], type, bonus: Number(m[2] ?? 0) };
  return { dice: null, flat: Number(expr), type, bonus: 0 };
}

export function findProfile(state, c, nameOrId) {
  const profiles = attackProfiles(state, c);
  if (!nameOrId) return profiles[0];
  const norm = String(nameOrId).toLowerCase().replace(/[^a-z0-9:_]/g, '');
  return profiles.find(p => p.id === nameOrId) ?? profiles.find(p => p.name.toLowerCase().replace(/[^a-z0-9]/g, '') === norm) ??
    profiles.find(p => p.baseKey?.toLowerCase() === norm || p.itemKey?.toLowerCase() === norm) ??
    profiles.find(p => p.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(norm) && norm.length >= 3) ?? null;
}

function canSee(state, observer, target) {
  const conds = conditionSet(observer);
  if (conds.has('blinded')) return false;
  const tconds = conditionSet(target);
  const senses = isPC(observer) ? '' : MONSTERS[observer.key].senses ?? '';
  if (tconds.has('invisible') && !/blindsight|truesight/.test(senses)) return false;
  return true;
}

function hasDarkvision(c) {
  if (isPC(c)) return !!RACES[c.race]?.darkvision || allInvocations(c).includes('devilsSight');
  return /darkvision|blindsight|truesight/.test(MONSTERS[c.key].senses ?? '');
}

export function attackModifiers(state, attacker, target, profile, opts = {}) {
  const adv = [];
  const dis = [];
  const aConds = conditionSet(attacker);
  const tConds = conditionSet(target);
  const dist = opts.distance ?? cbDistance(state, attacker.id, target.id);
  const acb = combatant(state, attacker.id);
  const tcb = combatant(state, target.id);
  const light = state.encounter?.map?.light ?? 'bright';
  if (!canSee(state, attacker, target)) dis.push('cannot see the target');
  if (!canSee(state, target, attacker) && !hasFeat(target, 'alert')) adv.push('unseen attacker');
  if (acb?.hidden && !hasFeat(target, 'alert')) adv.push('attacking from hiding');
  if (tcb?.hidden) dis.push('target is hidden');
  if (aConds.has('poisoned')) dis.push('poisoned');
  if (aConds.has('restrained')) dis.push('restrained');
  if (aConds.has('prone')) dis.push('prone');
  if (aConds.has('frightened')) dis.push('frightened');
  if ((attacker.exhaustion ?? 0) >= 3) dis.push('exhaustion');
  if (wearingNonProficientArmor(attacker)) dis.push('non-proficient armor');
  for (const x of ['paralyzed', 'stunned', 'unconscious', 'petrified', 'restrained', 'blinded']) if (tConds.has(x)) adv.push(`target ${x}`);
  if (tConds.has('prone')) dist <= 5 ? adv.push('target prone (adjacent)') : dis.push('target prone (at range)');
  if (tcb?.dodging && canSee(state, target, attacker)) dis.push('target is dodging');
  if (profile.kind === 'ranged' && profile.range) {
    if (dist > profile.range[0] && !(hasFeat(attacker, 'sharpshooter') && profile.weaponAttack)) dis.push('long range');
    const threatened = livingCombatants(state, o => hostile(state, attacker.id, o.id) && o.id !== attacker.id && !isIncapacitated(creatureById(state, o.id)) && creatureById(state, o.id).hp > 0 && distanceFt(o.pos, o.fp, acb.pos, acb.fp) <= 5);
    if (threatened.length && !(hasFeat(attacker, 'crossbowExpert') && profile.weaponAttack)) dis.push('hostile creature adjacent');
  }
  if (profile.properties?.includes('heavy') && ['Small', 'Tiny'].includes(size(attacker))) dis.push('heavy weapon, small creature');
  if (hasTrait(attacker, 'sunlightSensitivity') && light === 'sunlight') dis.push('sunlight sensitivity');
  if (light === 'dark') {
    if (!hasDarkvision(attacker)) dis.push('darkness');
    if (!hasDarkvision(target)) adv.push('target cannot see in the dark');
  }
  if (hasTrait(attacker, 'packTactics')) {
    const ally = livingCombatants(state, o => o.id !== attacker.id && o.id !== target.id && o.side === acb?.side && !isIncapacitated(creatureById(state, o.id)) && creatureById(state, o.id).hp > 0 && distanceFt(o.pos, o.fp, tcb.pos, tcb.fp) <= 5);
    if (ally.length) adv.push('pack tactics');
  }
  if (hasFeat(attacker, 'grappler') && activeEffects(target).some(e => e.grappledBy === attacker.id)) adv.push('Grappler');
  for (const e of activeEffects(target)) {
    if (e.attackedWithAdvantage) adv.push(e.name);
    if (e.attackedWithDisadvantage) dis.push(e.name);
    if (e.helpedBy && e.helpedBy !== attacker.id && combatant(state, e.helpedBy)?.side === acb?.side) adv.push('Help');
    if (e.disadvFromTypes?.includes(creatureType(attacker))) dis.push(e.name);
    if (e.advantageForCaster && e.sourceId === attacker.id) adv.push(e.name);
  }
  if (profile.kind === 'ranged' && profile.weaponAttack && activeEffects(target).some(e => e.rangedDisadvantage)) dis.push('warding wind');
  for (const e of activeEffects(attacker)) {
    if (e.disadvNextAttack && !(e.weaponOnly && !profile.weaponAttack)) dis.push(e.name);
    if (e.disadvVsOthers && e.sourceId && e.sourceId !== target.id) dis.push(e.name);
    if (e.nextHit?.advantage && profile.weaponAttack) adv.push(e.name);
    if (e.tidesOfChaos) adv.push(e.name);
    if (e.vowTarget && e.vowTarget === target.id) adv.push(e.name);
  }
  // Assassinate: a foe that has not had a turn yet this combat
  const enc = state.encounter;
  if (isPC(attacker) && hasSub(attacker, 'rogue', 'assassin', 3) && enc?.round === 1 && tcb && enc.order.indexOf(target.id) > enc.turn) adv.push('Assassinate');
  if (opts.reckless) adv.push('Reckless Attack');
  if (activeEffects(target).some(e => e.reckless)) adv.push('target attacked recklessly');
  if (opts.advVsMetal) {
    const armor = isPC(target) ? equipped(target, 'armor') : null;
    if (armor && ['chainShirt', 'scaleMail', 'breastplate', 'halfPlate', 'ringMail', 'chainMail', 'splint', 'plate'].includes(armor.key)) adv.push('metal armor');
  }
  if (isPC(target) && cl(target, 'rogue') >= 18 && !isIncapacitated(target)) adv.length = 0;
  return { adv, dis };
}

function critThreshold(c, profile) {
  if (!profile.weaponAttack || !isPC(c) || !hasSub(c, 'fighter', 'champion', 3)) return 20;
  if (cl(c, 'fighter') >= 15) return 18;
  if (cl(c, 'fighter') >= 3) return 19;
  return 20;
}

// Great Weapon Master with a heavy melee weapon, or Sharpshooter with a ranged weapon
export function powerEligible(attacker, profile) {
  if (!isPC(attacker) || !profile) return false;
  return (hasFeat(attacker, 'greatWeaponMaster') && profile.kind === 'melee' && !!profile.properties?.includes('heavy')) || (hasFeat(attacker, 'sharpshooter') && profile.kind === 'ranged' && !!profile.weaponAttack && !profile.thrown);
}

// the chance to hit, as the attack would be rolled right now (advantage, cover of
// conditions, crit range); the target's AC never leaves the server
export function hitChance(state, attacker, target, profile, { power = false } = {}) {
  const { adv, dis } = attackModifiers(state, attacker, target, profile);
  const bonus = profile.toHit - (power ? 5 : 0);
  const ac = armorClass(target);
  const crit = critThreshold(attacker, profile);
  let ok = 0;
  for (let n = 2; n <= 20; n++) if (n >= crit || n + bonus >= ac) ok += 1;
  let p = ok / 20;
  if (hasTrait(attacker, 'lucky')) p += p / 20;
  const mode = adv.length && !dis.length ? 'advantage' : dis.length && !adv.length ? 'disadvantage' : 'normal';
  if (mode === 'advantage') p = 1 - (1 - p) ** 2;
  else if (mode === 'disadvantage') p *= p;
  return { pct: Math.round(Math.min(1, p) * 100), mode, why: mode === 'advantage' ? adv : mode === 'disadvantage' ? dis : [] };
}

// spell attacks reuse this with profile.spell = true
export function rollAttack(ctx, attacker, target, profile, opts = {}) {
  const state = ctx.state;
  const { adv, dis } = attackModifiers(state, attacker, target, profile, opts);
  const d = rollD20(ctx.rng, { advantage: adv.length > 0, disadvantage: dis.length > 0, luckyHalfling: hasTrait(attacker, 'lucky') });
  let bonus = profile.toHit;
  const notes = [];
  if (opts.power) {
    bonus -= 5;
    notes.push('power attack -5');
  }
  for (const e of activeEffects(attacker)) {
    if (e.attackDie) {
      const r = roll(e.attackDie.replace(/^-/, ''), ctx.rng);
      const v = e.attackDie.startsWith('-') ? -r.total : r.total;
      bonus += v;
      notes.push(`${e.name} ${fmtMod(v)}`);
    }
    if (e.attackBonus && profile.weaponAttack) {
      bonus += e.attackBonus;
      notes.push(`${e.name} ${fmtMod(e.attackBonus)}`);
    }
  }
  // consume one-shot modifiers
  removeEffectsWhere(ctx, attacker, e => e.disadvNextAttack || e.tidesOfChaos, 'silent');
  removeEffectsWhere(ctx, target, e => e.consumeOn === 'attacked' || (e.helpedBy && e.helpedBy !== attacker.id), 'silent');
  removeEffectsWhere(ctx, target, e => e.consumeOn === 'casterAttack' && e.sourceId === attacker.id, 'silent');
  let ac = armorClass(target);
  const natural = d.natural;
  const threshold = critThreshold(attacker, profile);
  let crit = natural >= threshold;
  let total = natural + bonus;
  let hit = natural !== 1 && (crit || total >= ac);
  let finalNatural = natural;
  let rolls = d.rolls;
  // Lucky feat rerolls a miss automatically
  const luck = isPC(attacker) && hasFeat(attacker, 'lucky') && attacker.preferences?.autoLucky !== false ? attacker.resources?.luck : null;
  if (!hit && luck && luck.used < luck.max) {
    luck.used += 1;
    const again = rollD20(ctx.rng, { luckyHalfling: hasTrait(attacker, 'lucky') });
    finalNatural = again.natural;
    rolls = [...d.rolls, again.natural];
    crit = finalNatural >= threshold;
    total = finalNatural + bonus;
    hit = finalNatural !== 1 && (crit || total >= ac);
    notes.push(`Lucky reroll ${again.natural}`);
  }
  if (attacker.inspirationDie && !hit && natural !== 1 && isPC(attacker)) {
    const r = roll(attacker.inspirationDie, ctx.rng);
    total += r.total;
    notes.push(`Bardic Inspiration ${fmtMod(r.total)}`);
    attacker.inspirationDie = null;
    hit = total >= ac;
  }
  // an assassin's hit on a surprised creature is critical
  if (hit && !crit && isPC(attacker) && hasSub(attacker, 'rogue', 'assassin', 3) && combatant(state, target.id)?.surprised && profile.weaponAttack) {
    crit = true;
    notes.push('Assassinate: surprised');
  }
  const result = { natural: finalNatural, rolls, mode: d.mode, bonus, total, ac, hit, crit: hit && crit, adv, dis, notes };
  // target reactions that can turn a hit into a miss
  if (hit && !crit && opts.allowReactions !== false) tryDefensiveReactions(ctx, attacker, target, profile, result);
  // auto crit vs paralyzed/unconscious within 5 ft
  const tConds = conditionSet(target);
  if (result.hit && (tConds.has('paralyzed') || tConds.has('unconscious')) && cbDistance(state, attacker.id, target.id) <= 5) result.crit = true;
  return result;
}

function tryDefensiveReactions(ctx, attacker, target, profile, result) {
  const state = ctx.state;
  const tcb = combatant(state, target.id);
  if (!tcb || !tcb.reaction || isIncapacitated(target)) return;
  // Shield spell
  if (isPC(target) && target.preferences?.autoShield !== false && result.total < result.ac + 5) {
    const knows = castableSpells(target).has('shield');
    const slotLevel = Object.entries(target.slots ?? {}).find(([, s]) => s.used < s.max)?.[0];
    const pact = target.pactSlots && target.pactSlots.used < target.pactSlots.max;
    if (knows && (slotLevel || pact) && !activeEffects(target).some(e => e.rage) && !target.wildShape) {
      if (slotLevel) target.slots[slotLevel].used += 1;
      else target.pactSlots.used += 1;
      tcb.reaction = false;
      addEffect(ctx, target, { name: 'Shield', acBonus: 5, rounds: 1, endsAt: 'casterStart', spell: 'shield' }, { sourceId: target.id });
      result.ac += 5;
      result.hit = result.total >= result.ac;
      event(ctx, 'spell', `${target.name} casts Shield as a reaction (AC ${result.ac}).`, { caster: target.id, spell: 'shield' });
      return;
    }
  }
  // Defensive Duelist
  if (isPC(target) && hasFeat(target, 'defensiveDuelist') && profile.kind === 'melee' && result.total < result.ac + prof(target)) {
    const main = equipped(target, 'mainHand');
    const w = main ? weaponDef(main) : null;
    if (w?.properties.includes('finesse') && isProficientWeapon(target, w)) {
      tcb.reaction = false;
      result.ac += prof(target);
      result.hit = result.total >= result.ac;
      event(ctx, 'info', `${target.name} parries with Defensive Duelist (+${prof(target)} AC).`);
      return;
    }
  }
  // Parry
  const b = !isPC(target) ? MONSTERS[target.key] : null;
  const parry = b?.reactions?.find(r => r.key === 'parry');
  if (parry && profile.kind === 'melee' && result.total < result.ac + parry.acBonus && canSee(state, target, attacker)) {
    tcb.reaction = false;
    result.ac += parry.acBonus;
    result.hit = result.total >= result.ac;
    event(ctx, 'info', `${target.name} parries (+${parry.acBonus} AC).`);
  }
}

// roll all damage parts for a weapon hit
export function rollWeaponDamage(ctx, attacker, target, profile, { crit, extras = [], ts = null, power = false }) {
  const rng = ctx.rng;
  const parts = [];
  const notes = [];
  const gwf = isPC(attacker) && allStyles(attacker).includes('greatWeaponFighting') && profile.kind === 'melee' && profile.twoHanded;
  const rollPart = (dice, type, label, magical = profile.magical) => {
    const r = roll(dice, rng, { crit, rerollBelow: gwf && label === 'weapon' ? 2 : undefined });
    parts.push({ amount: r.total, type, magical, label, detail: r.detail });
    return r;
  };
  if (profile.damage.dice) {
    let r = rollPart(profile.damage.dice, profile.damage.type, 'weapon');
    if (isPC(attacker) && hasFeat(attacker, 'savageAttacker') && profile.weaponAttack && ts && !ts.once.savage) {
      ts.once.savage = true;
      const r2 = roll(profile.damage.dice, rng, { crit, rerollBelow: gwf ? 2 : undefined });
      if (r2.total > r.total) {
        parts[parts.length - 1].amount = r2.total;
        r = r2;
      }
      notes.push('Savage Attacker');
    }
    if (profile.damage.bonus) parts[parts.length - 1].amount = Math.max(0, r.total + profile.damage.bonus);
  } else parts.push({ amount: Math.max(0, (profile.damage.flat ?? 0) + (profile.damage.bonus ?? 0)), type: profile.damage.type, magical: profile.magical, label: 'weapon' });
  if (power) {
    parts[0].amount += 10;
    notes.push('power attack +10');
  }
  if (profile.extra) rollPart(profile.extra.dice, profile.extra.type, profile.extra.type);
  if (isPC(attacker)) {
    const raging = activeEffects(attacker).some(e => e.rage);
    if (raging && profile.kind === 'melee' && profile.ability === 'str') {
      parts[0].amount += rageBonus(cl(attacker, 'barbarian'));
      notes.push(`rage +${rageBonus(cl(attacker, 'barbarian'))}`);
    }
    if (crit && profile.kind === 'melee' && profile.damage.dice && !profile.unarmed) {
      const dieOnly = /\d*d\d+/.exec(profile.damage.dice)?.[0]?.replace(/^\d*/, '1');
      let extraDice = 0;
      if (cl(attacker, 'barbarian') >= 9) extraDice += cl(attacker, 'barbarian') >= 17 ? 3 : cl(attacker, 'barbarian') >= 13 ? 2 : 1;
      if (hasTrait(attacker, 'savageAttacks')) extraDice += 1;
      if (extraDice && dieOnly) {
        const r = roll(dieOnly.replace('1d', `${extraDice}d`), rng);
        parts[0].amount += r.total;
        notes.push(`brutal critical +${r.total}`);
      }
    }
    for (const e of activeEffects(attacker)) {
      if (e.weaponDamage && profile.weaponAttack && !(e.consumeOnHit && profile.kind !== 'melee')) rollPart(e.weaponDamage.dice, e.weaponDamage.type === 'weapon' ? profile.damage.type : e.weaponDamage.type, e.name);
      if (e.rangedDamage && profile.weaponAttack && profile.kind === 'ranged') rollPart(e.rangedDamage.dice, e.rangedDamage.type, e.name);
    }
    if (profile.ignitable && attacker.flameTongueLit) rollPart(profile.ignitable.damage, profile.ignitable.damageType, 'flame');
  }
  for (const e of activeEffects(target)) {
    if (e.bonusDamageFromCaster && e.sourceId === attacker.id) {
      if (e.bonusDamageFromCaster.weaponOnly && !profile.weaponAttack) continue;
      const type = e.bonusDamageFromCaster.type === 'weapon' ? profile.damage.type : e.bonusDamageFromCaster.type;
      rollPart(e.bonusDamageFromCaster.dice, type, e.name);
    }
  }
  for (const x of extras) rollPart(x.dice, x.type, x.label, x.magical ?? true);
  // ray of enfeeblement
  if (profile.weaponAttack && profile.ability === 'str' && activeEffects(attacker).some(e => e.halfWeaponDamage)) {
    for (const p of parts) p.amount = Math.floor(p.amount / 2);
    notes.push('enfeebled: half damage');
  }
  return { parts, notes };
}

function sneakEligible(state, attacker, target, profile, mods) {
  if (!isPC(attacker) || !cl(attacker, 'rogue')) return false;
  if (!(profile.finesse || profile.kind === 'ranged') || !profile.weaponAttack) return false;
  if (mods.dis.length && !mods.adv.length) return false;
  if (mods.adv.length && !mods.dis.length) return true;
  const acb = combatant(state, attacker.id);
  const tcb = combatant(state, target.id);
  return livingCombatants(state, o => o.id !== attacker.id && o.side === acb.side && o.id !== target.id && !isIncapacitated(creatureById(state, o.id)) && creatureById(state, o.id).hp > 0 && distanceFt(o.pos, o.fp, tcb.pos, tcb.fp) <= 5).length > 0 && !mods.dis.length;
}

export function numAttacks(c) {
  if (isPC(c) && !c.wildShape) {
    // extra attack from several classes does not stack
    const f = cl(c, 'fighter');
    let n = f >= 20 ? 4 : f >= 11 ? 3 : f >= 5 ? 2 : 1;
    if (['barbarian', 'monk', 'paladin', 'ranger'].some(k => cl(c, k) >= 5) || hasSub(c, 'bard', 'valor', 6)) n = Math.max(n, 2);
    if (cl(c, 'warlock') >= 5 && allInvocations(c).includes('thirstingBlade')) n = Math.max(n, 2);
    if (subclassesOf(c).some(s => s.def.extraAttack && s.level >= s.def.extraAttack)) n = Math.max(n, 2);
    return n;
  }
  return 1;
}

function consumeAmmo(ctx, attacker, profile) {
  if (!isPC(attacker)) return;
  const enc = ctx.state.encounter;
  if (profile.ammo) {
    const inv = attacker.inventory.find(i => i.key === profile.ammo && i.qty > 0);
    if (!inv) throw new RuleError(`${attacker.name} has no ${GEAR[profile.ammo]?.name ?? profile.ammo} left for the ${profile.name}.`, 'no_ammo');
    inv.qty -= 1;
    if (inv.qty === 0) attacker.inventory = attacker.inventory.filter(i => i !== inv);
    if (enc) addRecoverable(enc, attacker.id, profile.ammo, GEAR[profile.ammo]?.name ?? profile.ammo, false);
  } else if (profile.thrown) {
    const inv = attacker.inventory.find(i => i.id === profile.invId);
    if (!inv) throw new RuleError('That weapon is no longer in hand.');
    if (inv.qty > 1) inv.qty -= 1;
    else {
      attacker.inventory = attacker.inventory.filter(i => i !== inv);
      // throwing the last one empties the hand; a stack auto-draws the next
    }
    if (enc) addRecoverable(enc, attacker.id, inv.key, WEAPONS[inv.key]?.name ?? inv.key, true);
  }
}

function addRecoverable(enc, charId, key, name, thrown) {
  const r = enc.recoverable.find(x => x.charId === charId && x.key === key && x.thrown === thrown);
  if (r) r.qty += 1;
  else enc.recoverable.push({ charId, key, name, qty: 1, thrown });
}

// full attack with action economy; opts: {reckless, smite, stunningStrike, nonlethal, offhand, flurry, opportunity, bonusAttack}
export function performAttack(ctx, attackerId, { attack, target: targetId, ...opts }) {
  const state = ctx.state;
  const attacker = creatureById(state, attackerId);
  const target = creatureById(state, targetId);
  if (!attacker) throw new RuleError('Unknown attacker.');
  if (!target) throw new RuleError(`There is no "${targetId}" to attack.`, 'bad_target');
  if (attackerId === targetId) throw new RuleError('You cannot attack yourself.');
  if (opts.openHand && !(isPC(attacker) && hasSub(attacker, 'monk', 'openHand', 3))) throw new RuleError('Open Hand Technique is a Way of the Open Hand feature.');
  if (target.dead) throw new RuleError(`${target.name} is already dead.`);
  const enc = state.encounter;
  if (!enc || enc.status !== 'active') throw new RuleError('Attacks happen in combat. The DM must start combat first.', 'no_combat');
  if (!combatant(state, targetId) || combatant(state, targetId).removed) throw new RuleError(`${target.name} is not in this combat.`);
  if (isIncapacitated(attacker)) throw new RuleError(`${attacker.name} is incapacitated and cannot attack.`);
  if (activeEffects(attacker).some(e => e.conditions?.includes('charmed') && e.sourceId === targetId)) throw new RuleError(`${attacker.name} is charmed by ${target.name} and cannot attack them.`);
  const profile = findProfile(state, attacker, attack);
  if (!profile) throw new RuleError(`${attacker.name} has no attack called "${attack}". Options: ${attackProfiles(state, attacker).map(p => p.name).join(', ')}.`, 'bad_attack');
  // the character's standing choice for Great Weapon Master or Sharpshooter (-5 to hit, +10 damage)
  if (opts.power === undefined && attacker.preferences?.powerAttack && powerEligible(attacker, profile)) opts.power = true;
  const dist = cbDistance(state, attackerId, targetId);
  if (profile.kind === 'melee' && dist > profile.reach) throw new RuleError(`${target.name} is ${dist} ft away; ${profile.name} reaches ${profile.reach} ft.`, 'out_of_range');
  if (profile.kind === 'ranged' && profile.range && dist > profile.range[1]) throw new RuleError(`${target.name} is ${dist} ft away, beyond ${profile.name}'s maximum range of ${profile.range[1]} ft.`, 'out_of_range');

  let ts;
  if (opts.opportunity) {
    const cb = combatant(state, attackerId);
    if (!cb.reaction) throw new RuleError(`${attacker.name} has no reaction available.`);
    if (profile.kind !== 'melee') throw new RuleError('Opportunity attacks must be melee attacks.');
    cb.reaction = false;
  } else {
    ({ ts } = requireTurn(state, attackerId));
    economyForAttack(ctx, attacker, ts, profile, opts);
  }
  if (profile.properties?.includes('loading') && !opts.opportunity && !(hasFeat(attacker, 'crossbowExpert') && /crossbow/i.test(profile.name))) {
    if (ts.loadingFired) throw new RuleError(`The ${profile.name} has the loading property: only one shot per action.`);
    ts.loadingFired = true;
  }
  consumeAmmo(ctx, attacker, profile);
  const out = resolveAttack(ctx, attacker, target, profile, { ...opts, distance: dist, ts });
  if (!opts.opportunity) checkEncounterEnd(ctx);
  return out;
}

function economyForAttack(ctx, attacker, ts, profile, opts) {
  const b = !isPC(attacker) ? MONSTERS[attacker.key] : attacker.wildShape ? MONSTERS[attacker.wildShape.beast] : null;
  if (opts.offhand || profile.offhand) {
    const dw = hasFeat(attacker, 'dualWielder');
    if (!ts.offhandReady) throw new RuleError(`Two-weapon fighting requires taking the Attack action with a ${dw ? 'one-handed' : 'light'} melee weapon first.`);
    if (profile.kind !== 'melee' || profile.twoHanded || (!profile.properties?.includes('light') && !dw)) throw new RuleError(`The off-hand weapon must be a ${dw ? 'one-handed' : 'light'} melee weapon.`);
    spendAction(ts, 'bonus', attacker);
    ts.offhandReady = false;
    return;
  }
  if (opts.flurry) {
    if (ts.flurryLeft > 0 && profile.unarmed) {
      ts.flurryLeft -= 1;
      return;
    }
    throw new RuleError('No Flurry of Blows strikes remaining.');
  }
  if (opts.bonusAttack) {
    if (opts.bonusAttack === 'martialArts') {
      if (!ts.martialArtsReady) throw new RuleError('Martial Arts bonus strike requires the Attack action with an unarmed strike or monk weapon first.');
      if (!profile.unarmed) throw new RuleError('The Martial Arts bonus attack must be an unarmed strike.');
      spendAction(ts, 'bonus', attacker);
      ts.martialArtsReady = false;
      return;
    }
    if (opts.bonusAttack === 'gwm') {
      if (!ts.gwmReady) throw new RuleError('Great Weapon Master grants a bonus attack only after a critical hit or dropping a creature to 0 hit points this turn.');
      if (profile.kind !== 'melee') throw new RuleError('The Great Weapon Master bonus attack is a melee weapon attack.');
      spendAction(ts, 'bonus', attacker);
      ts.gwmReady = false;
      return;
    }
    if (opts.bonusAttack === 'polearm') {
      if (!hasFeat(attacker, 'polearmMaster') || !ts.polearmReady) throw new RuleError('Polearm Master needs the Attack action with a glaive, halberd, quarterstaff or spear first.');
      spendAction(ts, 'bonus', attacker);
      ts.polearmReady = false;
      return;
    }
    if (opts.bonusAttack === 'frenzy') {
      if (!activeEffects(attacker).some(e => e.rage && e.frenzy)) throw new RuleError('Frenzy attacks require a frenzied rage.');
      if (profile.kind !== 'melee') throw new RuleError('Frenzy attacks are melee weapon attacks.');
      spendAction(ts, 'bonus', attacker);
      return;
    }
    throw new RuleError('Unknown bonus attack.');
  }
  if (ts.attacksLeft > 0) {
    if (ts.multiattack) {
      const slot = ts.multiattack.find(m => m.left > 0 && (m.attack === profile.id || m.attack === profile.replaces));
      if (!slot) throw new RuleError(`${attacker.name}'s remaining attacks this turn are: ${ts.multiattack.filter(m => m.left > 0).map(m => `${m.left}x ${m.attack}`).join(', ')}.`);
      slot.left -= 1;
    }
    ts.attacksLeft -= 1;
  } else {
    if (!hasActionAvailable(ts)) throw new RuleError(`${attacker.name} has no action left to attack with.`, 'no_action');
    const usingHaste = ts.action <= 0 && ts.hasteAction;
    spendAction(ts, 'action', attacker, 'attack');
    ts.attackAction = true;
    if (usingHaste) ts.attacksLeft = 0;
    else if (b?.multiattack) {
      const groups = b.multiattack;
      const main = groups.filter(g => !g.alt);
      const alt = groups.filter(g => g.alt);
      const chosen = alt.length && alt.some(g => g.attack === profile.id) ? alt : main;
      ts.multiattack = chosen.map(g => ({ attack: g.attack, left: g.count }));
      const slot = ts.multiattack.find(m => m.attack === profile.id || m.attack === profile.replaces);
      if (!slot) {
        ts.multiattack = null;
        ts.attacksLeft = 0;
      } else {
        slot.left -= 1;
        ts.attacksLeft = ts.multiattack.reduce((s, m) => s + m.left, 0);
      }
    } else ts.attacksLeft = numAttacks(attacker) - 1;
  }
  const twfMain = profile.properties?.includes('light') || (hasFeat(attacker, 'dualWielder') && !profile.twoHanded);
  if (isPC(attacker) && profile.kind === 'melee' && twfMain && !profile.offhand) ts.offhandReady = !!equipped(attacker, 'offHand') && !!weaponDef(equipped(attacker, 'offHand'));
  if (isPC(attacker) && hasFeat(attacker, 'polearmMaster') && ['glaive', 'halberd', 'quarterstaff', 'spear'].includes(profile.baseKey) && !opts.bonusAttack) ts.polearmReady = true;
  if (isPC(attacker) && cl(attacker, 'monk') > 0 && (profile.unarmed || profile.monk)) ts.martialArtsReady = true;
}

export function resolveAttack(ctx, attacker, target, profile, opts = {}) {
  const state = ctx.state;
  const acb = combatant(state, attacker.id);
  const ts = opts.ts ?? acb?.turnState;
  // reckless attack must be declared on the first attack of the turn
  if (opts.reckless) {
    if (!(isPC(attacker) && cl(attacker, 'barbarian') >= 2)) throw new RuleError('Only barbarians of level 2+ can attack recklessly.');
    if (profile.kind !== 'melee' || profile.ability !== 'str') throw new RuleError('Reckless Attack applies to Strength-based melee attacks.');
    addEffect(ctx, attacker, { name: 'Reckless', reckless: true, rounds: 1, endsAt: 'casterStart' }, { sourceId: attacker.id });
    if (ts) ts.reckless = true;
  }
  const reckless = opts.reckless || ts?.reckless;
  if (opts.power) {
    const gwm = hasFeat(attacker, 'greatWeaponMaster') && profile.kind === 'melee' && profile.properties?.includes('heavy');
    const ss = hasFeat(attacker, 'sharpshooter') && profile.kind === 'ranged' && profile.weaponAttack && !profile.thrown;
    if (!gwm && !ss) throw new RuleError('Power attacks (-5/+10) need Great Weapon Master with a heavy melee weapon or Sharpshooter with a ranged weapon.');
  }
  if (ts && hostile(state, attacker.id, target.id)) ts.attackedHostile = true;
  // sanctuary
  const sanct = activeEffects(target).find(e => e.sanctuary);
  if (sanct && hostile(state, attacker.id, target.id)) {
    const sv = savingThrow(attacker, 'wis', { dc: sanct.dc, rng: ctx.rng, magical: true });
    ctx.events.push({ type: 'save', text: `${attacker.name} Wis save vs Sanctuary: ${sv.total} vs DC ${sanct.dc} - ${sv.success ? 'success' : 'failure'}`, roll: sv });
    if (!sv.success) {
      event(ctx, 'attack', `${attacker.name} cannot bring themselves to attack ${target.name} (Sanctuary). The attack is lost.`);
      return { hit: false, lost: true };
    }
  }
  // mirror image
  const mi = activeEffects(target).find(e => e.mirrorImages > 0);
  if (mi && canSee(state, attacker, target)) {
    const r = ctx.rng.int(1, 20);
    const need = mi.mirrorImages >= 3 ? 6 : mi.mirrorImages === 2 ? 8 : 11;
    if (r >= need) {
      const imgAc = 10 + mod(target, 'dex');
      const a = rollD20(ctx.rng);
      const tot = a.natural + profile.toHit;
      if (tot >= imgAc) {
        mi.mirrorImages -= 1;
        event(ctx, 'attack', `${attacker.name}'s attack strikes a mirror image of ${target.name} (d20 ${r}); it vanishes. ${mi.mirrorImages} left.`);
        if (mi.mirrorImages <= 0) removeEffect(ctx, target, mi.id, 'no images left');
      } else event(ctx, 'attack', `${attacker.name} swings at a mirror image of ${target.name} and misses.`);
      return { hit: false, image: true };
    }
  }
  const mods = attackModifiers(state, attacker, target, profile, { ...opts, reckless });
  const res = rollAttack(ctx, attacker, target, profile, { ...opts, reckless });
  if (acb?.hidden) {
    acb.hidden = false;
    event(ctx, 'info', `${attacker.name} reveals their position.`);
  }
  removeEffectsWhere(ctx, attacker, e => e.endsOnAttack, 'attacked');
  const modeTxt = res.adv.length && !res.dis.length ? ` with advantage (${res.adv.join(', ')})` : res.dis.length && !res.adv.length ? ` with disadvantage (${res.dis.join(', ')})` : res.adv.length ? ' (advantage and disadvantage cancel)' : '';
  const rollTxt = res.rolls.length > 1 ? `[${res.rolls.join(', ')}]` : `${res.natural}`;
  const header = `${attacker.name} attacks ${target.name} with ${profile.name}${opts.opportunity ? ' (opportunity attack)' : ''}${modeTxt}: ${rollTxt} ${fmtMod(res.bonus)}${res.notes.length ? ` (${res.notes.join(', ')})` : ''} = ${res.total} vs AC ${res.ac}`;
  if (!res.hit) {
    if (ts && isPC(attacker) && profile.kind === 'melee') (ts.meleeTargets = ts.meleeTargets ?? []).push(target.id);
    event(ctx, 'attack', `${header} - ${res.natural === 1 ? 'natural 1, miss' : 'miss'}.`, { attacker: attacker.id, target: target.id, hit: false, roll: res });
    return { hit: false, roll: res };
  }
  event(ctx, 'attack', `${header} - ${res.crit ? 'CRITICAL HIT!' : 'hit'}.`, { attacker: attacker.id, target: target.id, hit: true, crit: res.crit, roll: res });
  const extras = [];
  if (ts && isPC(attacker)) {
    if (!ts.sneakUsed && sneakEligible(state, attacker, target, profile, mods)) {
      ts.sneakUsed = true;
      extras.push({ dice: sneakDice(cl(attacker, 'rogue')), type: profile.damage.type, label: 'Sneak Attack', magical: profile.magical });
    }
    if (hasSub(attacker, 'ranger', 'hunter', 3) && !ts.once.colossus && target.hp < target.maxHp && profile.weaponAttack) {
      ts.once.colossus = true;
      extras.push({ dice: '1d8', type: profile.damage.type, label: 'Colossus Slayer', magical: profile.magical });
    }
    if (hasSub(attacker, 'cleric', 'life', 8) && !ts.once.divineStrike && profile.weaponAttack) {
      ts.once.divineStrike = true;
      extras.push({ dice: cl(attacker, 'cleric') >= 14 ? '2d8' : '1d8', type: 'radiant', label: 'Divine Strike' });
    }
    // Divine Strike and its kin from subclass data: once per turn on a weapon hit
    for (const s of subclassesOf(attacker)) {
      const st = s.def.strike;
      const once = `strike_${s.cls}`;
      if (!st || s.level < st.level || ts.once[once] || !profile.weaponAttack || (st.raging && !isRaging(attacker))) continue;
      ts.once[once] = true;
      extras.push({ dice: typeof st.dice === 'function' ? st.dice(s.level) : st.dice, type: st.type === 'weapon' ? profile.damage.type : st.type, label: st.label, magical: st.type === 'weapon' ? profile.magical : true });
    }
    if (cl(attacker, 'paladin') >= 11 && profile.kind === 'melee' && profile.weaponAttack) extras.push({ dice: '1d8', type: 'radiant', label: 'Improved Divine Smite' });
    for (const x of opts.spellExtras ?? []) extras.push(x);
    if (opts.maneuver) {
      if (!hasSub(attacker, 'fighter', 'battleMaster', 3)) throw new RuleError('Only Battle Masters have superiority dice.');
      const sd = attacker.resources?.superiorityDice;
      if (!sd || sd.used >= sd.max) throw new RuleError(`${attacker.name} has no superiority dice left.`, 'no_resource');
      sd.used += 1;
      const f = cl(attacker, 'fighter');
      extras.push({ dice: f >= 18 ? '1d12' : f >= 10 ? '1d10' : '1d8', type: profile.damage.type, label: 'Superiority Die', magical: profile.magical });
    }
    if (opts.smite) {
      const lvl = Number(opts.smite);
      if (cl(attacker, 'paladin') < 2) throw new RuleError('Only paladins of level 2+ can Divine Smite.');
      if (profile.kind !== 'melee') throw new RuleError('Divine Smite requires a melee weapon attack.');
      const slot = attacker.slots?.[lvl];
      if (!slot || slot.used >= slot.max) throw new RuleError(`No level ${lvl} spell slot available for Divine Smite.`);
      slot.used += 1;
      let n = Math.min(5, 1 + lvl);
      if (['undead', 'fiend'].includes(creatureType(target))) n += 1;
      extras.push({ dice: `${n}d8`, type: 'radiant', label: 'Divine Smite' });
    }
  }
  if (!isPC(attacker) && ts && !ts.once.martialAdvantage && MONSTERS[attacker.key].traits.some(t => t.key === 'martialAdvantage')) {
    const tcb = combatant(state, target.id);
    const ally = livingCombatants(state, o => o.id !== attacker.id && o.side === acb.side && creatureById(state, o.id).hp > 0 && distanceFt(o.pos, o.fp, tcb.pos, tcb.fp) <= 5);
    if (ally.length) {
      ts.once.martialAdvantage = true;
      extras.push({ dice: '2d6', type: profile.damage.type, label: 'Martial Advantage', magical: false });
    }
  }
  // smite spells and their kin ride on the next weapon hit
  const next = profile.weaponAttack ? activeEffects(attacker).find(e => e.nextHit && (!e.nextHit.melee || profile.kind === 'melee') && (!e.nextHit.ranged || profile.kind === 'ranged')) : null;
  if (next?.nextHit.dice) {
    const up = next.nextHit.upcast && next.spellLevel && SPELLS[next.spell] ? next.spellLevel - SPELLS[next.spell].level : 0;
    const dice = up > 0 ? next.nextHit.dice.replace(/^(\d+)d/, (_, n) => `${Number(n) + up * Number(next.nextHit.upcast.split('d')[0])}d`) : next.nextHit.dice;
    extras.push({ dice, type: next.nextHit.type, label: next.name });
  }
  for (const e of activeEffects(attacker)) if (e.consumeOnHit && e.weaponDamage && profile.kind === 'melee') removeEffect(ctx, attacker, e.id, 'silent');
  const { parts, notes } = rollWeaponDamage(ctx, attacker, target, profile, { crit: res.crit, extras, ts, power: !!opts.power });
  // deflect missiles and uncanny dodge
  let halve = false;
  const tcb = combatant(state, target.id);
  if (tcb?.reaction && !isIncapacitated(target) && isPC(target)) {
    if (cl(target, 'monk') >= 3 && profile.kind === 'ranged' && profile.weaponAttack) {
      const r = roll('1d10', ctx.rng).total + mod(target, 'dex') + cl(target, 'monk');
      tcb.reaction = false;
      let rem = r;
      for (const p of parts) {
        const cut = Math.min(p.amount, rem);
        p.amount -= cut;
        rem -= cut;
      }
      event(ctx, 'info', `${target.name} deflects the missile, reducing the damage by ${r}.`);
    } else if (cl(target, 'rogue') >= 5 && target.preferences?.autoUncannyDodge !== false && canSee(state, target, attacker)) {
      tcb.reaction = false;
      halve = true;
      event(ctx, 'info', `${target.name} uses Uncanny Dodge to halve the damage.`);
    }
  }
  const dmgText = parts.map(p => `${p.amount} ${p.label === 'weapon' ? p.type : `${p.label}`}`).join(' + ');
  if (notes.length || parts.length > 1) event(ctx, 'info', `Damage: ${dmgText}${notes.length ? ` (${notes.join(', ')})` : ''}.`);
  const out = applyDamage(ctx, target, parts, { crit: res.crit, attacker, melee: profile.kind === 'melee', nonlethal: !!opts.nonlethal, halve, source: profile.name, auraBonusFor: t => auraBonusFor(state, t) });
  if (next) nextHitRider(ctx, attacker, target, next);
  if (ts && isPC(attacker) && hasFeat(attacker, 'greatWeaponMaster') && profile.kind === 'melee' && (res.crit || target.hp <= 0) && !opts.bonusAttack) ts.gwmReady = true;
  if (opts.opportunity && isPC(attacker) && hasFeat(attacker, 'sentinel') && !target.dead) {
    addEffect(ctx, target, { name: 'Halted (Sentinel)', speedZero: true, rounds: 1, endsAt: 'targetEnd' }, { sourceId: attacker.id });
    const tcb2 = combatant(state, target.id);
    if (tcb2?.turnState) tcb2.turnState.movement = tcb2.turnState.moved;
    event(ctx, 'condition', `${target.name} is stopped in their tracks (Sentinel).`);
  }
  if (ts && isPC(attacker) && profile.kind === 'melee') (ts.meleeTargets = ts.meleeTargets ?? []).push(target.id);
  // on-hit riders
  if (profile.onHit && !target.dead) applyOnHit(ctx, attacker, target, profile.onHit);
  if (opts.stunningStrike && !target.dead) stunningStrike(ctx, attacker, target, profile, ts);
  if (opts.openHand && !target.dead) openHand(ctx, attacker, target, opts.openHand);
  return { hit: true, crit: res.crit, damage: out.total, roll: res };
}

function applyOnHit(ctx, attacker, target, onHit) {
  if (onHit.notTypes?.includes(creatureType(target))) return;
  if (onHit.notRaces && isPC(target) && onHit.notRaces.includes(RACES[target.race]?.base)) return;
  if (onHit.sizeMax && SIZE_ORDER.indexOf(size(target)) > SIZE_ORDER.indexOf(onHit.sizeMax)) return;
  let failed = true;
  if (onHit.save) {
    const sv = savingThrow(target, onHit.save, { dc: onHit.dc, rng: ctx.rng, against: onHit.type === 'poison' ? 'poison' : onHit.conditions?.[0], auraBonus: auraBonusFor(ctx.state, target) });
    ctx.events.push({ type: 'save', text: `${target.name} ${sv.label}: ${sv.total ?? '-'} vs DC ${onHit.dc} - ${sv.success ? 'success' : 'failure'}`, roll: sv });
    failed = !sv.success;
  }
  if (onHit.damage) {
    const r = roll(onHit.damage, ctx.rng);
    const amt = failed ? r.total : onHit.half ? Math.floor(r.total / 2) : 0;
    if (amt > 0) applyDamage(ctx, target, [{ amount: amt, type: onHit.type, magical: false }], { attacker, source: 'venom', auraBonusFor: t => auraBonusFor(ctx.state, t) });
  }
  if (failed && onHit.conditions?.length && !target.dead) {
    const spec = { name: onHit.conditions.join(', '), conditions: onHit.conditions };
    if (onHit.rounds) spec.rounds = onHit.rounds;
    if (onHit.saveEnds) Object.assign(spec, { saveEnds: onHit.saveEnds, dc: onHit.dc });
    if (onHit.escape) spec.escape = { ...onHit.escape };
    if (onHit.conditions.includes('grappled')) spec.grappledBy = attacker.id;
    if (onHit.conditions.includes('prone')) {
      if (!(target.conditions ?? []).some(c => (c.name ?? c) === 'prone')) target.conditions.push({ name: 'prone', source: attacker.name });
      event(ctx, 'condition', `${target.name} is knocked prone.`);
      return;
    }
    addEffect(ctx, target, spec, { sourceId: attacker.id });
    event(ctx, 'condition', `${target.name} is ${onHit.conditions.join(' and ')}.`);
  }
}

function stunningStrike(ctx, attacker, target, profile, ts) {
  if (!(isPC(attacker) && cl(attacker, 'monk') >= 5)) throw new RuleError('Only monks of level 5+ can use Stunning Strike.');
  if (profile.kind !== 'melee') throw new RuleError('Stunning Strike requires a melee weapon attack.');
  const ki = attacker.resources?.ki;
  if (!ki || ki.used >= ki.max) throw new RuleError('No ki points left for Stunning Strike.');
  ki.used += 1;
  const dc = 8 + prof(attacker) + mod(attacker, 'wis');
  const sv = savingThrow(target, 'con', { dc, rng: ctx.rng, auraBonus: auraBonusFor(ctx.state, target) });
  ctx.events.push({ type: 'save', text: `${target.name} Con save vs Stunning Strike: ${sv.total ?? '-'} vs DC ${dc} - ${sv.success ? 'resists' : 'stunned'}`, roll: sv });
  if (!sv.success) {
    addEffect(ctx, target, { name: 'Stunned', conditions: ['stunned'], rounds: 2, endsAt: 'casterEnd' }, { sourceId: attacker.id });
    event(ctx, 'condition', `${target.name} is stunned until the end of ${attacker.name}'s next turn.`);
  }
  void ts;
}

function openHand(ctx, attacker, target, mode) {
  const dc = 8 + prof(attacker) + mod(attacker, 'wis');
  if (mode === 'prone') {
    const sv = savingThrow(target, 'dex', { dc, rng: ctx.rng });
    ctx.events.push({ type: 'save', text: `${target.name} Dex save vs Open Hand: ${sv.total ?? '-'} vs DC ${dc}`, roll: sv });
    if (!sv.success) {
      target.conditions.push({ name: 'prone', source: attacker.name });
      event(ctx, 'condition', `${target.name} is knocked prone.`);
    }
  } else if (mode === 'push') {
    const sv = savingThrow(target, 'str', { dc, rng: ctx.rng });
    ctx.events.push({ type: 'save', text: `${target.name} Str save vs Open Hand: ${sv.total ?? '-'} vs DC ${dc}`, roll: sv });
    if (!sv.success) pushAway(ctx, attacker.id, target.id, 15);
  } else if (mode === 'noReactions') {
    addEffect(ctx, target, { name: 'Open Hand', noReactions: true, rounds: 1, endsAt: 'casterEnd' }, { sourceId: attacker.id });
  }
}

// what a smite does after its damage: a save, a push, an effect, a banishment
function nextHitRider(ctx, attacker, target, e) {
  const nh = e.nextHit;
  const ends = e.concentrationOf ? false : true;
  removeEffect(ctx, attacker, e.id, 'silent');
  if (!ends && attacker.concentration?.spell === e.spell && !nh.apply?.saveEnds && !nh.apply?.dot) attacker.concentration = null;
  if (target.dead || target.hp <= 0) return;
  const dc = e.dc ?? spellDcOf(attacker);
  let failed = true;
  if (nh.save) {
    const sv = savingThrow(target, nh.save, { dc, rng: ctx.rng, magical: true });
    ctx.events.push({ type: 'save', text: `${target.name} ${sv.label} ${sv.total ?? '-'} vs DC ${dc} - ${sv.success ? 'success' : 'failure'}`, roll: sv });
    failed = !sv.success;
  }
  if (nh.banishAt && target.hp <= nh.banishAt) {
    addEffect(ctx, target, { name: 'Banished', banished: true, rounds: 10 }, { sourceId: attacker.id, concentrationOf: attacker.id, spell: e.spell });
    event(ctx, 'condition', `${target.name} is banished.`);
    return;
  }
  if (!failed) return;
  if (nh.push) pushAway(ctx, attacker.id, target.id, nh.push);
  if (nh.prone && !(target.conditions ?? []).some(x => (x.name ?? x) === 'prone')) {
    (target.conditions ??= []).push({ name: 'prone', source: e.name });
    event(ctx, 'condition', `${target.name} is knocked prone.`);
  }
  if (nh.apply) {
    addEffect(ctx, target, { ...nh.apply, dc }, { sourceId: attacker.id, ...(e.concentrationOf ? { concentrationOf: attacker.id, spell: e.spell } : {}) });
    event(ctx, 'condition', `${target.name} is affected by ${nh.apply.name}.`);
  }
}

function spellDcOf(c) {
  const best = Math.max(...['int', 'wis', 'cha'].map(a => mod(c, a)));
  return 8 + prof(c) + best;
}

export function reachOf(state, cid) {
  const c = creatureById(state, cid);
  const cb = combatant(state, cid);
  if (!c || c.dead || c.hp <= 0 || !cb?.reaction || isIncapacitated(c)) return 0;
  if (activeEffects(c).some(e => e.noReactions)) return 0;
  if (isPC(c) && c.preferences?.autoOpportunityAttack === false) return 0;
  const melee = attackProfiles(state, c).filter(p => p.kind === 'melee');
  if (!melee.length) return 0;
  return Math.max(...melee.map(p => p.reach ?? 5));
}

export function opportunityAttack(ctx, reactorId, targetId) {
  const state = ctx.state;
  const c = creatureById(state, reactorId);
  const melee = attackProfiles(state, c).filter(p => p.kind === 'melee').sort((a, b) => avgDmg(b) - avgDmg(a));
  const dist = cbDistance(state, reactorId, targetId);
  const p = melee.find(m => m.reach >= dist) ?? melee[0];
  try {
    performAttack(ctx, reactorId, { attack: p.id, target: targetId, opportunity: true });
  } catch (e) {
    if (!(e instanceof RuleError)) throw e;
  }
}

export function oaHandler(ctx) {
  return {
    reachOf: id => reachOf(ctx.state, id),
    trigger: (reactor, mover) => opportunityAttack(ctx, reactor, mover),
    // Mobile: no opportunity attacks from creatures you meleed this turn
    exempt: (reactor, mover) => {
      const m = creatureById(ctx.state, mover);
      const ts = combatant(ctx.state, mover)?.turnState;
      return hasFeat(m, 'mobile') && (ts?.meleeTargets ?? []).includes(reactor);
    },
    // Sentinel ignores Disengage
    ignoresDisengage: reactor => hasFeat(creatureById(ctx.state, reactor), 'sentinel'),
  };
}

export function avgDmg(p) {
  const d = p.damage;
  if (!d.dice) return d.flat ?? 0;
  const m = /(\d+)d(\d+)/.exec(d.dice);
  return (m ? (Number(m[1]) * (Number(m[2]) + 1)) / 2 : 0) + (d.bonus ?? 0);
}

export { uid, abilities };
