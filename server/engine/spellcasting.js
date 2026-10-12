import { explorationSpell, npcRecord, npcControlSpell } from './exploration.js';
import { cl, hasSub, subclassesOf } from './classlevel.js';
import { allInvocations, allMetamagic } from './feats.js';
import { SPELLS, findSpellKey, cantripDiceMultiplier } from './data/spells.js';
import { MONSTERS } from './data/monsters.js';
import { ITEMS } from './data/items.js';
import { roll } from './dice.js';
import { isPC, mod, isIncapacitated, activeEffects, creatureType, wearingNonProficientArmor, conditionSet } from './creature.js';
import { castableSpells, spellcastingStats, ritualSpells, itemDef, classSpellList, maxSpellLevel, spellListsFor, spellClassOf } from './character.js';
import { classLevels } from './classlevel.js';
import { savingThrow, abilityCheck } from './checks.js';
import { RuleError, fmtMod, uid } from './util.js';
import { creatureById, combatant, event, inCombat, hostile, requireCreature, allCreatures } from './state.js';
import { requireTurn, spendAction, cbDistance, livingCombatants, auraBonusFor, moveCombatant, pushAway, pullToward, knockProne, checkEncounterEnd, hasActionAvailable, occupiedBy, triggerZone } from './combat.js';
import { inArea, distanceFt, inBounds, squaresOf, pointDistanceFt } from './grid.js';
import { applyDamage, applyHealing, grantTempHp, stabilize } from './damage.js';
import { addEffect, removeEffect, removeEffectsWhere, startConcentration, endConcentration } from './effects.js';
import { rollAttack, resolveAttack, findProfile, reachOf } from './attack.js';
// spells that act on the world (objects, scenery, NPCs) rather than combatants
export const WORLD_SPELLS = ['detectMagic', 'findTraps', 'knock', 'comprehendLanguages', 'tongues', 'light', 'daylight', 'darkness', 'dispelMagic', 'identify', 'charmPerson', 'suggestion', 'calmEmotions', 'zoneOfTruth', 'augury', 'locateObject', 'speakWithAnimals', 'message', 'minorIllusion', 'prestidigitation', 'mageHand', 'thaumaturgy', 'druidcraft', 'mending', 'disguiseSelf', 'fogCloud', 'silence', 'spiderClimb', 'unseenServant', 'featherFall', 'dancingLights', 'darkvision', 'commune', 'hallow'];

// NPCs named in free target text ("the guard and Mira"); all or nothing
function npcsNamed(state, text) {
  const names = String(text).split(/\s*(?:,|\band\b)\s*/i).map(x => x.replace(/^the\s+/i, '').trim()).filter(Boolean);
  const found = names.map(n => npcRecord(state, n));
  if (!found.some(Boolean)) return [];
  const missing = names.filter((_, i) => !found[i]);
  if (missing.length) throw new RuleError(`No known NPC called "${missing[0]}".`);
  return [...new Set(found)];
}

const SP_COST = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 };
export { SP_COST };

export function spellRangeFt(sp, metamagic = []) {
  let r = sp.range === 'self' ? 0 : sp.range === 'touch' ? 5 : sp.range;
  if (metamagic.includes('distant')) r = sp.range === 'touch' ? 30 : r * 2;
  return r;
}

function casterLevelOf(c) {
  if (isPC(c)) return c.level;
  return MONSTERS[c.key].spellcasting?.casterLevel ?? 1;
}

// figure out how this creature can cast this spell right now
export function resolveSource(state, caster, key, params) {
  const sp = SPELLS[key];
  if (params.item) {
    if (!isPC(caster)) throw new RuleError('Only characters use magic items here.');
    const inv = caster.inventory.find(i => i.id === params.item || i.key === params.item);
    if (!inv) throw new RuleError('You do not have that item.');
    const def = itemDef(inv);
    if (!def?.castsSpell || def.castsSpell.spell !== key) throw new RuleError(`${def?.name ?? 'That item'} cannot cast ${sp.name}.`);
    if (def.attunement && !inv.attuned) throw new RuleError(`You must be attuned to ${def.name}.`);
    if (def.kind === 'scroll' && !classLevels(caster).some(x => classSpellList(caster, x.class).has(key))) throw new RuleError(`${sp.name} is not on your class spell list, so you cannot read this scroll.`);
    const stats = spellcastingStats(caster).class ?? { dc: 10, attack: 2, mod: 0, ability: 'int' };
    return { kind: 'item', inv, def, dc: def.castsSpell.dc ?? stats.dc, attack: stats.attack, mod: stats.mod };
  }
  if (!isPC(caster)) {
    const scs = MONSTERS[caster.key].spellcasting;
    if (!scs || (!scs.cantrips.includes(key) && !scs.spells.includes(key))) throw new RuleError(`${caster.name} cannot cast ${sp.name}.`);
    return { kind: 'monster', dc: scs.dc, attack: scs.toHit, mod: mod(caster, scs.ability), ability: scs.ability };
  }
  const castable = castableSpells(caster);
  let source = castable.get(key);
  if (params.ritual && ritualSpells(caster).includes(key)) source = 'ritual';
  if (!source) {
    const hint = cl(caster, 'wizard') && spellListsFor(caster, 'wizard').spellbook?.includes(key) ? ' It is in your spellbook but not prepared.' : '';
    throw new RuleError(`${caster.name} cannot cast ${sp.name}: not known or prepared.${hint}`, 'unknown_spell');
  }
  const stats = spellcastingStats(caster);
  let s;
  if (source === 'race') s = stats.race;
  else if (source.startsWith('innate')) s = stats.innate;
  else if (source === 'feat' || source === 'featOnce') s = stats.feat;
  else if (source.startsWith('class:')) s = stats.classes[source.slice(6)];
  else s = stats.class ?? stats.innate ?? stats.race;
  return { kind: source, castingClass: spellClassOf(caster, key, source), ...s };
}

function pickLevel(caster, sp, src, params) {
  if (sp.level === 0) return { level: 0, slot: null };
  if (src.kind === 'ritual') return { level: sp.level, slot: null, ritual: true };
  if (src.kind === 'item') {
    const cs = src.def.castsSpell;
    const lvl = params.level ?? cs.baseLevel;
    if (lvl < cs.baseLevel || lvl > cs.maxLevel) throw new RuleError(`${src.def.name} casts ${sp.name} at level ${cs.baseLevel}-${cs.maxLevel}.`);
    const charges = cs.chargesPerLevel ? cs.chargesPerLevel * (lvl - cs.baseLevel + 1) : 0;
    if (src.def.charges !== undefined && (src.inv.charges ?? src.def.charges) < charges) throw new RuleError(`${src.def.name} does not have ${charges} charges.`);
    return { level: lvl, slot: null, charges };
  }
  if (src.kind === 'innate' || src.kind === 'innateAtWill') {
    const race = caster.race;
    void race;
    if (src.kind === 'innateAtWill') return { level: sp.level, slot: null };
    const res = caster.resources?.[`innate_${sp.key}`];
    if (!res || res.used >= res.max) throw new RuleError(`You have already used your innate ${sp.name} until you finish a long rest.`);
    const castLevel = sp.key === 'hellishRebuke' ? 2 : sp.level;
    return { level: castLevel, slot: null, resource: `innate_${sp.key}` };
  }
  if (src.kind === 'invocation' || src.kind === 'feat') return { level: sp.level, slot: null };
  if (src.kind === 'featOnce') {
    const key = caster.resources?.[`feat_${sp.key}`] ? `feat_${sp.key}` : 'feat_magicInitiate';
    const res = caster.resources?.[key];
    if (!res || res.used >= res.max) throw new RuleError(`You have already cast ${sp.name} through your feat; it returns after a long rest.`);
    return { level: sp.level, slot: null, resource: key };
  }
  if (!isPC(caster)) {
    const lvl = params.level ?? sp.level;
    const s = caster.slots?.[lvl];
    if (lvl < sp.level || !s || s.used >= s.max) throw new RuleError(`${caster.name} has no level ${lvl} slots left.`);
    return { level: lvl, slot: { table: 'slots', level: lvl } };
  }
  const hasRegular = Object.keys(caster.slots ?? {}).length > 0;
  // warlock spells prefer pact slots; anything can use either slot pool
  const usePact = caster.pactSlots && (params.slot === 'pact' || (!hasRegular && params.slot !== 'normal') || (params.slot !== 'normal' && src.castingClass === 'warlock' && (!params.level || params.level === caster.pactSlots.level)));
  if (params.slot === 'pact' && !caster.pactSlots) throw new RuleError('You have no Pact Magic slots.');
  if (usePact) {
    const lvl = caster.pactSlots.level;
    if (params.level && params.level !== lvl) throw new RuleError(`Pact Magic slots are level ${lvl}; warlock spells are always cast at that level.`);
    if (lvl < sp.level) throw new RuleError(`${sp.name} needs a level ${sp.level} slot.`);
    if (caster.pactSlots.used >= caster.pactSlots.max) throw new RuleError('No Pact Magic slots left. They return on a short rest.', 'no_slot');
    return { level: lvl, slot: { table: 'pact' } };
  }
  const lvl = params.level ?? sp.level;
  if (lvl < sp.level) throw new RuleError(`${sp.name} is a level ${sp.level} spell; it cannot be cast with a level ${lvl} slot.`);
  if (lvl > maxSpellLevel(caster)) throw new RuleError(`You have no spell slots of level ${lvl}.`);
  const s = caster.slots?.[lvl];
  if (!s || s.used >= s.max) throw new RuleError(`No level ${lvl} spell slots left.`, 'no_slot');
  return { level: lvl, slot: { table: 'slots', level: lvl } };
}

function spendSlot(caster, pick, src) {
  if (pick.slot?.table === 'pact') caster.pactSlots.used += 1;
  else if (pick.slot?.table === 'slots') caster.slots[pick.slot.level].used += 1;
  if (pick.resource) caster.resources[pick.resource].used += 1;
  if (src.kind === 'item') {
    if (src.def.consumable) {
      src.inv.qty -= 1;
      if (src.inv.qty <= 0) caster.inventory = caster.inventory.filter(i => i !== src.inv);
    } else if (pick.charges) src.inv.charges = (src.inv.charges ?? src.def.charges) - pick.charges;
  }
}

function checkEconomy(ctx, caster, sp, params, metamagic) {
  const state = ctx.state;
  const combat = inCombat(state) && combatant(state, caster.id);
  let time = sp.time;
  if (metamagic.includes('quickened')) {
    if (time !== 'action') throw new RuleError('Quickened Spell only works on spells with a casting time of 1 action.');
    time = 'bonus';
  }
  if (!combat) {
    return { time, ts: null };
  }
  if (!['action', 'bonus', 'reaction'].includes(time)) throw new RuleError(`${sp.name} takes too long to cast in combat.`);
  if (sp.effect?.outOfCombat) throw new RuleError(`${sp.name} cannot be cast during combat.`);
  if (time === 'reaction') {
    const cb = combatant(state, caster.id);
    if (!params.reactionTrigger) throw new RuleError(`${sp.name} is a reaction spell; it is cast automatically when its trigger happens (see your preferences).`);
    if (!cb.reaction) throw new RuleError('No reaction available.');
    cb.reaction = false;
    return { time, ts: null };
  }
  const { ts } = requireTurn(state, caster.id);
  const leveledCast = ts.spellsCast.some(s => s.level > 0);
  const bonusCast = ts.spellsCast.some(s => s.time === 'bonus');
  if (time === 'bonus') {
    if (ts.spellsCast.some(s => s.level > 0 || s.time === 'bonus')) throw new RuleError('After casting a spell this turn you cannot also cast a bonus action spell (only a 1-action cantrip may accompany a bonus action spell).');
    spendAction(ts, 'bonus', caster);
  } else {
    if (bonusCast && sp.level > 0) throw new RuleError('You cast a bonus action spell this turn, so your action spell must be a cantrip.');
    if (!hasActionAvailable(ts)) throw new RuleError(`${caster.name} has no action left to cast ${sp.name}.`, 'no_action');
    if (ts.action <= 0 && ts.hasteAction) throw new RuleError('The extra action from Haste cannot be used to cast spells.');
    spendAction(ts, 'action', caster, `cast ${sp.name}`);
  }
  void leveledCast;
  return { time, ts };
}

export function scaledDamage(sp, caster, level, which = 'damage') {
  const eff = sp.effect;
  const base = eff[which];
  if (!base) return null;
  let dice = base.dice;
  if (eff.cantripScale) {
    const mult = cantripDiceMultiplier(casterLevelOf(caster));
    dice = dice.replace(/^(\d+)d/, (_, n) => `${Number(n) * mult}d`);
  }
  if (which === 'damage' && eff.upcastDice && level > sp.level) {
    const m = /^(\d+)d(\d+)(.*)$/.exec(dice);
    const u = /^(\d+)d(\d+)$/.exec(eff.upcastDice);
    if (m && u && m[2] === u[2]) dice = `${Number(m[1]) + Number(u[1]) * (level - sp.level)}d${m[2]}${m[3]}`;
    else dice = `${dice}+${Number(u?.[1] ?? 1) * (level - sp.level)}d${u?.[2] ?? 6}`;
  }
  if (which === 'damage' && eff.upcastDicePer2 && level > sp.level) {
    const extra = Math.floor((level - sp.level) / 2);
    if (extra) {
      const m = /^(\d+)d(\d+)(.*)$/.exec(dice);
      dice = `${Number(m[1]) + extra}d${m[2]}${m[3]}`;
    }
  }
  return { dice, type: base.type };
}

function rollEmpowered(expr, rng, n, crit) {
  const r = roll(expr, rng, { crit });
  if (!n) return r;
  let rerolls = n;
  let total = r.total;
  for (const d of r.dice) {
    const avg = (d.sides + 1) / 2;
    const order = d.results.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    for (const [v, i] of order) {
      if (!rerolls || v >= avg) break;
      const nv = rng.int(1, d.sides);
      total += nv - v;
      d.results[i] = nv;
      rerolls--;
    }
  }
  return { ...r, total, detail: `${r.detail} (empowered)` };
}

function damageBonusFor(caster, sp, src) {
  let bonus = 0;
  const notes = [];
  if (isPC(caster) && hasSub(caster, 'wizard', 'evocation', 10) && sp.school === 'evocation' && sp.classes.includes('wizard')) {
    bonus += mod(caster, 'int');
    notes.push('Empowered Evocation');
  }
  const potent = isPC(caster) && (hasSub(caster, 'cleric', 'lightDomain', 8) || subclassesOf(caster).some(s => s.cls === 'cleric' && s.def.potentSpellcasting && s.level >= s.def.potentSpellcasting));
  if (potent && sp.level === 0 && sp.classes.includes('cleric')) {
    bonus += mod(caster, 'wis');
    notes.push('Potent Spellcasting');
  }
  void src;
  return { bonus, notes };
}

function targetCreatures(state, caster, ids, sp, rangeFt, params) {
  const out = [];
  for (const id of ids) {
    const t = creatureById(state, id);
    if (!t) throw new RuleError(`No creature "${id}" to target.`, 'bad_target');
    if (inCombat(state)) {
      const tcb = combatant(state, id);
      if (!tcb || tcb.removed) throw new RuleError(`${t.name} is not in this combat.`);
      const d = cbDistance(state, caster.id, id);
      if (sp.range === 'self' && id !== caster.id) throw new RuleError(`${sp.name} only affects the caster.`);
      if (d > rangeFt && id !== caster.id) throw new RuleError(`${t.name} is ${d} ft away; ${sp.name} has a range of ${rangeFt} ft.`, 'out_of_range');
    }
    out.push(t);
  }
  void params;
  return out;
}

function areaFor(state, caster, sp, params, rangeFt) {
  const area = sp.effect.area;
  const ccb = combatant(state, caster.id);
  let point = params.point;
  if (area.shape === 'sphere' && area.fromSelf) return { ...area, center: { ...ccb.pos } };
  if (!point && params.targets?.length) {
    const tcb = combatant(state, params.targets[0]);
    if (tcb) point = { ...tcb.pos };
  }
  if (!point) throw new RuleError(`${sp.name} needs a target point or creature.`);
  if (!inBounds(state.encounter.map, point)) throw new RuleError('That point is off the map.');
  if (area.shape === 'cone' || area.shape === 'line' || (area.shape === 'cube' && area.fromSelf)) {
    if (point.x === ccb.pos.x && point.y === ccb.pos.y) throw new RuleError('Aim the spell in a direction away from yourself.');
    return { ...area, origin: { ...ccb.pos }, toward: point };
  }
  if (area.fromPoint && area.shape === 'line') {
    return { ...area, origin: point, toward: { x: point.x + 1, y: point.y } };
  }
  const d = distanceFt(ccb.pos, ccb.fp, point, 1);
  if (d > rangeFt) throw new RuleError(`That point is ${d} ft away; ${sp.name} has a range of ${rangeFt} ft.`, 'out_of_range');
  return { ...area, center: point };
}

function creaturesInArea(state, area, { excludeId } = {}) {
  return livingCombatants(state, cb => cb.id !== excludeId && inArea(area, cb.pos, cb.fp)).map(cb => creatureById(state, cb.id)).filter(c => !c.dead);
}

function conditionImmune(t, effect) {
  const imm = new Set();
  for (const e of activeEffects(t)) (e.immuneConditions ?? []).forEach(x => imm.add(x));
  const ci = isPC(t) ? [] : MONSTERS[t.key].condImmune;
  return (effect.conditions ?? []).some(c => imm.has(c) || ci.includes(c));
}

export function castSpell(ctx, casterId, params) {
  const state = ctx.state;
  const caster = requireCreature(state, casterId);
  const key = findSpellKey(params.spell);
  if (!key) throw new RuleError(`"${params.spell}" is not a spell in this rule set.`, 'unknown_spell');
  const sp = SPELLS[key];
  const metamagic = params.metamagic ?? [];
  if (caster.dead || caster.hp <= 0) throw new RuleError(`${caster.name} is in no condition to cast spells.`);
  if (isIncapacitated(caster)) throw new RuleError(`${caster.name} is incapacitated.`);
  if (activeEffects(caster).some(e => e.rage)) throw new RuleError('You cannot cast spells while raging.');
  if (isPC(caster) && caster.wildShape) throw new RuleError('You cannot cast spells in beast form.');
  if (wearingNonProficientArmor(caster)) throw new RuleError('You cannot cast spells while wearing armor you are not proficient with.');
  const src = resolveSource(state, caster, key, params);
  // metamagic
  let spCost = 0;
  if (metamagic.length) {
    if (!isPC(caster) || !cl(caster, 'sorcerer')) throw new RuleError('Only sorcerers can use Metamagic.');
    const known = new Set(allMetamagic(caster));
    for (const mm of metamagic) if (!known.has(mm)) throw new RuleError(`You do not know the ${mm} Metamagic.`);
    if (metamagic.length > 1 && !(metamagic.length === 2 && metamagic.includes('empowered'))) throw new RuleError('Only one Metamagic option per spell (Empowered Spell may be combined).');
  }
  const pick = pickLevel(caster, sp, src, params);
  if (pick.ritual && inCombat(state)) throw new RuleError('Ritual casting takes 10 extra minutes; not possible in combat.');
  for (const mm of metamagic) {
    if (mm === 'twinned') {
      if (sp.effect.area || sp.range === 'self' || (sp.effect.targets ?? 1) !== 1 || sp.effect.rays || sp.effect.beamsScale) throw new RuleError(`${sp.name} cannot be twinned (it must target only one creature).`);
      spCost += Math.max(1, pick.level);
    } else spCost += { careful: 1, distant: 1, empowered: 1, extended: 1, heightened: 3, quickened: 2, subtle: 1 }[mm];
  }
  if (spCost) {
    const r = caster.resources?.sorceryPoints;
    if (!r || r.max - r.used < spCost) throw new RuleError(`Not enough sorcery points (${spCost} needed).`);
  }
  // material components with a cost
  let matInv = null;
  if (sp.material?.item) {
    matInv = isPC(caster) ? caster.inventory.find(i => i.key === sp.material.item && i.qty > 0) : true;
    if (!matInv) throw new RuleError(`${sp.name} requires ${ITEMS[sp.material.item].name}, which you do not have.`, 'no_component');
  }
  const rangeFt = spellRangeFt(sp, metamagic);
  const eff = sp.effect;
  if (inCombat(state) && !combatant(state, casterId)) throw new RuleError(`${caster.name} is not part of the combat.`);
  const worldSpell = !inCombat(state) && WORLD_SPELLS.includes(key) && !(params.targets ?? []).length;
  if (worldSpell) {
    checkEconomy(ctx, caster, sp, params, metamagic);
    spendSlot(caster, pick, src);
    if (spCost) caster.resources.sorceryPoints.used += spCost;
    event(ctx, 'spell', `${caster.name} casts ${sp.name}${pick.level > 0 ? ` at level ${pick.level}` : ''}${pick.ritual ? ' as a ritual' : ''}${params.targetText ? ` on ${params.targetText}` : ''}.`, { caster: casterId, spell: key, level: pick.level, utility: true });
    const handled = explorationSpell(ctx, caster, sp, params, { dc: src.dc, level: pick.level });
    if (!handled) {
      if (eff.type !== 'utility') throw new RuleError(`${sp.name} needs a target here.`);
      event(ctx, 'info', `${sp.name}: ${sp.desc}`, { utility: true });
    }
    if (pick.ritual) state.clock.minute = (state.clock?.minute ?? 0) + 10;
    return { spell: key, level: pick.level, results: [] };
  }
  // outside combat these spells still work (RAW): control spells resolve against named NPCs,
  // and anything aimed at no creature is a free-form cast the DM narrates
  if (!inCombat(state) && ['attack', 'save', 'auto', 'zone', 'aura', 'sleep', 'spiritualWeapon', 'powerWord', 'teleport'].includes(eff.type) && !(eff.type === 'save' && !eff.damage && params.allowOutOfCombat)) {
    const harmful = eff.damage || eff.kill || ['attack', 'auto'].includes(eff.type);
    const npcs = params.targetText ? npcsNamed(state, params.targetText) : [];
    if ((params.targets ?? []).length || (npcs.length && harmful)) {
      throw new RuleError(`${sp.name} would harm ${npcs.length ? npcs.map(n => n.name).join(', ') : 'a creature'}. Attacking someone starts a fight: the DM starts combat first.`, 'no_combat');
    }
    if (npcs.length && !['sleep', 'save', 'powerWord'].includes(eff.type)) throw new RuleError(`${sp.name} cannot target ${npcs[0].name} outside combat.`);
    checkEconomy(ctx, caster, sp, params, metamagic);
    spendSlot(caster, pick, src);
    if (spCost) caster.resources.sorceryPoints.used += spCost;
    if (matInv && sp.material.consumed && isPC(caster)) {
      matInv.qty -= 1;
      if (matInv.qty <= 0) caster.inventory = caster.inventory.filter(i => i !== matInv);
    }
    const lvlTxt = pick.level > 0 ? ` at level ${pick.level}` : '';
    event(ctx, 'spell', `${caster.name} casts ${sp.name}${lvlTxt}${params.targetText ? ` on ${params.targetText}` : ''}.`, { caster: casterId, spell: key, level: pick.level, utility: true });
    if (sp.concentration) startConcentration(ctx, caster, key, sp.name);
    if (npcs.length) npcControlSpell(ctx, caster, sp, npcs, { dc: src.dc, level: pick.level });
    else event(ctx, 'info', `${sp.name}: ${sp.desc} (Outside combat; the DM narrates the effect. The battle map only tracks it when cast during combat.)`, { utility: true });
    return { spell: key, level: pick.level, results: [] };
  }
  // validate targets before spending anything
  const plan = planSpell(ctx, caster, sp, params, { rangeFt, metamagic, level: pick.level, src });
  plan.params = params;
  checkEconomy(ctx, caster, sp, params, metamagic);
  spendSlot(caster, pick, src);
  if (spCost) caster.resources.sorceryPoints.used += spCost;
  if (matInv && sp.material.consumed && isPC(caster)) {
    matInv.qty -= 1;
    if (matInv.qty <= 0) caster.inventory = caster.inventory.filter(i => i !== matInv);
  }
  const cb = combatant(state, casterId);
  if (cb?.turnState) cb.turnState.spellsCast.push({ level: pick.level, time: metamagic.includes('quickened') ? 'bonus' : sp.time });
  if (cb?.hidden && sp.components.includes('V') && !metamagic.includes('subtle')) cb.hidden = false;
  removeEffectsWhere(ctx, caster, e => e.endsOnAttack && (eff.type === 'attack' || eff.type === 'save' || eff.type === 'auto'), 'cast an offensive spell');
  const lvlTxt = pick.level > 0 ? ` at level ${pick.level}` : '';
  const how = src.kind === 'item' ? ` from ${src.def.name}` : pick.ritual ? ' as a ritual' : '';
  event(ctx, 'spell', `${caster.name} casts ${sp.name}${lvlTxt}${how}${metamagic.length ? ` (${metamagic.join(', ')})` : ''}.`, { caster: casterId, spell: key, level: pick.level });
  if (sp.concentration) startConcentration(ctx, caster, key, sp.name);
  const res = executeSpell(ctx, caster, sp, plan, { level: pick.level, src, metamagic });
  if (sp.concentration && !allCreatures(state).some(c => (c.effects ?? []).some(e => e.concentrationOf === caster.id && e.spell === key)) && !(state.encounter?.zones ?? []).some(z => z.concentrationOf === caster.id && z.spell === key)) {
    // nothing stuck, so nothing to concentrate on
    if (caster.concentration?.spell === key && eff.type !== 'utility') caster.concentration = null;
  }
  if (inCombat(state)) checkEncounterEnd(ctx);
  return res;
}

function planSpell(ctx, caster, sp, params, { rangeFt, metamagic, level }) {
  const state = ctx.state;
  const eff = sp.effect;
  const plan = { targets: [], area: null, choice: params.choice, commandMode: params.choice, hexAbility: params.choice };
  const upTargets = eff.upcastTargets ? eff.upcastTargets * (level - sp.level) : 0;
  const maxTargets = (eff.targets ?? 1) + upTargets + (metamagic.includes('twinned') ? 1 : 0);
  const ids = params.targets ?? [];
  if (eff.self) {
    plan.targets = [caster];
    return plan;
  }
  if (eff.area && inCombat(state)) {
    plan.area = areaFor(state, caster, sp, params, rangeFt);
    const exclude = ['cone', 'line'].includes(eff.area.shape) || eff.area.fromSelf ? caster.id : null;
    plan.targets = creaturesInArea(state, plan.area, { excludeId: exclude });
    if (eff.maxTargets && plan.targets.length > eff.maxTargets) {
      const chosen = ids.length ? plan.targets.filter(t => ids.includes(t.id)) : plan.targets.filter(t => hostile(state, caster.id, t.id));
      plan.targets = chosen.slice(0, eff.maxTargets);
    }
    return plan;
  }
  if (eff.partyRadius) {
    plan.targets = inCombat(state) ? livingCombatants(state, cb => cb.side === combatant(state, caster.id).side && cbDistance(state, caster.id, cb.id) <= eff.partyRadius).map(cb => creatureById(state, cb.id)) : Object.values(state.characters).filter(c => !c.dead);
    return plan;
  }
  if (['zone', 'spiritualWeapon', 'teleport'].includes(eff.type)) {
    if (!params.point && !(params.targets?.length)) throw new RuleError(`${sp.name} needs a target point.`);
    plan.point = params.point ?? { ...combatant(state, params.targets[0]).pos };
    if (eff.type === 'zone') {
      const ccb = combatant(state, caster.id);
      const d = distanceFt(ccb.pos, ccb.fp, plan.point, 1);
      if (d > rangeFt) throw new RuleError(`That point is ${d} ft away; ${sp.name} has a range of ${rangeFt} ft.`, 'out_of_range');
      plan.area = { ...eff.area, center: plan.point };
    }
    if (eff.type === 'teleport') {
      const ccb = combatant(state, caster.id);
      const d = pointDistanceFt(ccb.pos, plan.point);
      if (d > eff.distance) throw new RuleError(`You can teleport at most ${eff.distance} ft (that is ${d} ft).`, 'out_of_range');
      if (!inBounds(state.encounter.map, plan.point, ccb.fp) || squaresOf(plan.point, ccb.fp).some(sq => occupiedBy(state.encounter, sq, caster.id))) throw new RuleError('You must teleport to an unoccupied space on the map.');
    }
    if (eff.type === 'spiritualWeapon') {
      const ccb = combatant(state, caster.id);
      if (distanceFt(ccb.pos, ccb.fp, plan.point, 1) > rangeFt) throw new RuleError(`The weapon must appear within ${rangeFt} ft.`);
      if (params.targets?.length) plan.targets = targetCreatures(state, caster, params.targets.slice(0, 1), { ...sp, range: 1000 }, 1000, params);
    }
    return plan;
  }
  if (eff.type === 'auto') {
    if (!ids.length) throw new RuleError(`${sp.name} needs at least one target.`);
    plan.targets = targetCreatures(state, caster, ids, sp, rangeFt, params);
    return plan;
  }
  if (eff.type === 'aura' || eff.type === 'createItem' || eff.type === 'utility' || eff.type === 'tempHp') {
    plan.targets = ids.length ? targetCreatures(state, caster, ids.slice(0, maxTargets), sp, rangeFt, params) : [];
    return plan;
  }
  if (eff.type === 'attack' && eff.rays) {
    if (!ids.length) throw new RuleError(`${sp.name} needs targets for its rays.`);
    plan.targets = targetCreatures(state, caster, ids, sp, rangeFt, params);
    return plan;
  }
  if (eff.type === 'attack' && eff.beamsScale) {
    if (!ids.length) throw new RuleError(`${sp.name} needs a target.`);
    plan.targets = targetCreatures(state, caster, ids, sp, rangeFt, params);
    return plan;
  }
  if (!ids.length) {
    if (eff.type === 'buff' || eff.type === 'heal') {
      if (sp.range === 'self' || eff.self) plan.targets = [caster];
      else throw new RuleError(`${sp.name} needs a target (use yourself if you want).`);
      return plan;
    }
    throw new RuleError(`${sp.name} needs a target.`);
  }
  if (ids.length > maxTargets) throw new RuleError(`${sp.name} can affect at most ${maxTargets} creature${maxTargets === 1 ? '' : 's'} at this level.`);
  if (new Set(ids).size !== ids.length) throw new RuleError('Each creature can only be targeted once by this spell.');
  plan.targets = targetCreatures(state, caster, ids, sp, rangeFt, params);
  if (eff.creatureType) for (const t of plan.targets) if (!eff.creatureType.includes(creatureType(t))) throw new RuleError(`${sp.name} only affects ${eff.creatureType.join(' or ')} creatures; ${t.name} is a ${creatureType(t)}.`);
  if (eff.notTypes) for (const t of plan.targets) if (eff.notTypes.includes(creatureType(t))) throw new RuleError(`${sp.name} has no effect on ${creatureType(t)} creatures.`);
  return plan;
}

function concMeta(caster, sp) {
  return sp.concentration ? { concentrationOf: caster.id, spell: sp.key } : { spell: sp.key };
}

function executeSpell(ctx, caster, sp, plan, { level, src, metamagic }) {
  const state = ctx.state;
  const eff = sp.effect;
  const dc = src.dc;
  const results = [];
  const meta = { sourceId: caster.id, ...concMeta(caster, sp), spellLevel: level };
  const empowerN = metamagic.includes('empowered') ? Math.max(1, mod(caster, 'cha')) : 0;
  if ((eff.damageChoice || eff.randomType) && eff.damage) {
    const type = eff.randomType ? eff.randomType[ctx.rng.int(0, eff.randomType.length - 1)] : (plan.choice ?? eff.damage.type);
    if (eff.damageChoice && !eff.damageChoice.includes(type)) throw new RuleError(`Choose a damage type for ${sp.name}: ${eff.damageChoice.join(', ')}.`);
    if (eff.randomType) event(ctx, 'info', `${sp.name} twists into ${type}.`);
    return executeSpell(ctx, caster, { ...sp, effect: { ...eff, damageChoice: null, randomType: null, damage: { ...eff.damage, type } } }, plan, { level, src, metamagic });
  }
  if (eff.woundedDice && plan.targets[0] && plan.targets[0].hp < plan.targets[0].maxHp) {
    return executeSpell(ctx, caster, { ...sp, effect: { ...eff, woundedDice: null, damage: { ...eff.damage, dice: eff.woundedDice } } }, plan, { level, src, metamagic });
  }
  switch (eff.type) {
    case 'utility':
      if (!explorationSpell(ctx, caster, sp, plan.params ?? {}, { dc, level })) event(ctx, 'info', `${sp.name}: ${sp.desc}`, { utility: true });
      break;
    case 'attack': {
      const dmg = scaledDamage(sp, caster, level);
      const { bonus: flatBonus } = damageBonusFor(caster, sp, src);
      let shots = [];
      if (eff.rays) {
        const n = eff.rays + (eff.upcastRays ?? 0) * (level - sp.level);
        for (let i = 0; i < n; i++) shots.push(plan.targets[i % plan.targets.length]);
      } else if (eff.beamsScale) {
        const n = cantripDiceMultiplier(casterLevelOf(caster));
        for (let i = 0; i < n; i++) shots.push(plan.targets[i % plan.targets.length]);
      } else shots = plan.targets;
      const range = spellRangeFt(sp, metamagic) * (isPC(caster) && sp.key === 'eldritchBlast' && allInvocations(caster).includes('eldritchSpear') ? 300 / 120 : 1);
      shots.forEach((t, idx) => {
        if (t.dead) return;
        const profile = { name: sp.name, kind: eff.attack === 'melee' ? 'melee' : 'ranged', toHit: src.attack, reach: 5, range: [range, range], spell: true, magical: true, properties: [] };
        const r = rollAttack(ctx, caster, t, profile, { spell: true, advVsMetal: eff.advVsMetal });
        const rollTxt = r.rolls.length > 1 ? `[${r.rolls.join(', ')}]` : `${r.natural}`;
        if (!r.hit) {
          event(ctx, 'attack', `${sp.name}${shots.length > 1 ? ` #${idx + 1}` : ''} at ${t.name}: ${rollTxt} ${fmtMod(r.bonus)} = ${r.total} vs AC ${r.ac} - miss.`, { attacker: caster.id, target: t.id, hit: false, roll: r });
          return;
        }
        event(ctx, 'attack', `${sp.name}${shots.length > 1 ? ` #${idx + 1}` : ''} at ${t.name}: ${rollTxt} ${fmtMod(r.bonus)} = ${r.total} vs AC ${r.ac} - ${r.crit ? 'CRITICAL HIT!' : 'hit'}.`, { attacker: caster.id, target: t.id, hit: true, crit: r.crit, roll: r });
        const dr = rollEmpowered(dmg.dice, ctx.rng, idx === 0 ? empowerN : 0, r.crit);
        let amt = dr.total + (idx === 0 ? flatBonus : 0) + (eff.addMod ? src.mod : 0);
        if (sp.key === 'eldritchBlast' && isPC(caster) && allInvocations(caster).includes('agonizingBlast')) amt += mod(caster, 'cha');
        const parts = [{ amount: amt, type: dmg.type, magical: true }];
        for (const e of activeEffects(t)) if (e.bonusDamageFromCaster && e.sourceId === caster.id && !e.bonusDamageFromCaster.weaponOnly) parts.push({ amount: roll(e.bonusDamageFromCaster.dice, ctx.rng, { crit: r.crit }).total, type: e.bonusDamageFromCaster.type, magical: true });
        const out = applyDamage(ctx, t, parts, { crit: r.crit, attacker: caster, source: sp.name, auraBonusFor: x => auraBonusFor(state, x) });
        if (eff.drain && out.total > 0) applyHealing(ctx, caster, Math.floor(out.total * eff.drain), sp.name);
        if (eff.onHit?.name && !t.dead) {
          addEffect(ctx, t, { ...eff.onHit, ...(eff.onHit.saveEnds ? { dc } : {}) }, meta);
          event(ctx, 'condition', `${t.name} is affected by ${eff.onHit.name}.`);
        }
        if (eff.onHit?.pull && !t.dead) pullToward(ctx, caster.id, t.id, eff.onHit.pull);
        if (sp.key === 'eldritchBlast' && isPC(caster) && allInvocations(caster).includes('repellingBlast') && !t.dead) pushAway(ctx, caster.id, t.id, 10);
        results.push({ target: t.id, hit: true, damage: out.total });
      });
      if (eff.burst && plan.targets[0]) spellBurst(ctx, caster, plan.targets[0].id, eff.burst, dc, sp.name);
      break;
    }
    case 'weaponCantrip': {
      // booming blade, green-flame blade: a melee weapon attack carrying the spell
      const t = plan.targets[0];
      if (!t) throw new RuleError(`${sp.name} needs a target.`);
      const profile = findProfile(state, caster, plan.params?.weapon) ?? null;
      if (!profile || profile.kind !== 'melee' || !profile.weaponAttack) throw new RuleError(`${sp.name} needs a melee weapon in hand.`);
      if (cbDistance(state, caster.id, t.id) > reachOf(state, caster.id)) throw new RuleError(`${t.name} is out of reach.`, 'out_of_range');
      const n = cantripDiceMultiplier(casterLevelOf(caster)) - 1;
      const bonus = n > 0 ? [{ dice: `${n}d8`, type: eff.bonus.type, label: sp.name }] : [];
      const r = resolveAttack(ctx, caster, t, profile, { spellExtras: bonus });
      if (r.hit && !t.dead && eff.onHit) {
        addEffect(ctx, t, { ...eff.onHit, moveDamage: { ...eff.onHit.moveDamage, dice: `${n + 1}d8` } }, meta);
        event(ctx, 'condition', `${t.name} is sheathed in booming energy.`);
      }
      if (r.hit && eff.leap) {
        const near = livingCombatants(state, o => o.id !== t.id && o.id !== caster.id && hostile(state, caster.id, o.id) && cbDistance(state, t.id, o.id) <= 5)[0];
        if (near) {
          const amt = Math.max(0, src.mod) + (n > 0 ? roll(`${n}d8`, ctx.rng).total : 0);
          event(ctx, 'info', `Green fire leaps to ${creatureById(state, near.id).name}.`);
          applyDamage(ctx, creatureById(state, near.id), [{ amount: amt, type: 'fire', magical: true }], { attacker: caster, source: sp.name });
        }
      }
      break;
    }
    case 'save': {
      const dmg = scaledDamage(sp, caster, level);
      const extra = eff.extraDamage ? { ...eff.extraDamage } : null;
      const { bonus: flatBonus } = damageBonusFor(caster, sp, src);
      const dr = dmg ? rollEmpowered(dmg.dice, ctx.rng, empowerN) : null;
      const xr = extra ? roll(extra.dice, ctx.rng) : null;
      if (dr) event(ctx, 'info', `${sp.name} damage roll: ${dr.detail}${xr ? ` + ${xr.detail}` : ''}.`);
      const sculpted = new Set();
      if (isPC(caster) && hasSub(caster, 'wizard', 'evocation', 2) && sp.school === 'evocation' && plan.area) {
        const allies = plan.targets.filter(t => t.id !== caster.id && !hostile(state, caster.id, t.id));
        allies.slice(0, 1 + level).forEach(t => sculpted.add(t.id));
      }
      if (metamagic.includes('careful')) plan.targets.filter(t => !hostile(state, caster.id, t.id)).slice(0, Math.max(1, mod(caster, 'cha'))).forEach(t => sculpted.add(t.id));
      plan.targets.forEach((t, idx) => {
        if (t.dead) return;
        if (sp.key === 'disintegrate' || !t.dead) void 0;
        const against = eff.onFail?.conditions?.includes('charmed') ? 'charmed' : eff.onFail?.conditions?.includes('frightened') ? 'frightened' : dmg?.type === 'poison' ? 'poison' : null;
        let adv = false;
        if (eff.advIfFighting && inCombat(state) && hostile(state, caster.id, t.id)) adv = true;
        const sv = savingThrow(t, eff.save, { dc, rng: ctx.rng, magical: true, against, advantage: adv, disadvantage: metamagic.includes('heightened') && idx === 0, autoSucceed: sculpted.has(t.id), auraBonus: auraBonusFor(state, t) });
        ctx.events.push({ type: 'save', text: `${t.name} ${sv.label}: ${sv.natural === null ? sv.breakdown.join(', ') : `${sv.total}`} vs DC ${dc} - ${sv.success ? 'success' : 'failure'}`, roll: sv });
        if (dr && !sculpted.has(t.id)) {
          let total = dr.total + flatBonus;
          let xtotal = xr?.total ?? 0;
          let factor = 1;
          const evasion = eff.save === 'dex' && eff.halfOnSave && (cl(t, 'monk') >= 7 || cl(t, 'rogue') >= 7) && !isIncapacitated(t);
          if (sv.success) factor = evasion ? 0 : eff.halfOnSave || (sp.level === 0 && isPC(caster) && hasSub(caster, 'wizard', 'evocation', 6)) ? 0.5 : 0;
          else if (evasion) factor = 0.5;
          const parts = [{ amount: Math.floor(total * factor), type: dmg.type, magical: true }];
          if (xr) parts.push({ amount: Math.floor(xtotal * factor), type: extra.type, magical: true });
          if (factor > 0) {
            const out = applyDamage(ctx, t, parts, { attacker: caster, source: sp.name, auraBonusFor: x => auraBonusFor(state, x) });
            if (eff.cannotKill && t.hp <= 0) t.hp = 1;
            if (eff.disintegrate && t.hp <= 0 && !t.dead) {
              t.dead = true;
              event(ctx, 'death', `${t.name} is reduced to a pile of fine gray dust.`);
            }
            results.push({ target: t.id, damage: out.total, saved: sv.success });
          } else event(ctx, 'info', `${t.name} takes no damage${evasion ? ' (Evasion)' : ''}.`);
        }
        if (!sv.success && !t.dead) {
          if (eff.onFail?.name) {
            if (conditionImmune(t, eff.onFail)) event(ctx, 'info', `${t.name} is immune.`);
            else {
              const spec = { ...eff.onFail };
              if (spec.saveEnds) spec.dc = dc;
              if (spec.escape) spec.escape = { ...spec.escape, dc };
              if (metamagic.includes('extended') && spec.rounds) spec.rounds *= 2;
              if (eff.onFail.forcedMoveAway) void 0;
              addEffect(ctx, t, spec, meta);
              event(ctx, 'condition', `${t.name} is affected by ${spec.name}${spec.conditions?.length ? ` (${spec.conditions.join(', ')})` : ''}.`);
            }
          }
          if (eff.onFail?.push && !t.dead) pushAway(ctx, caster.id, t.id, eff.onFail.push);
          if (eff.onFail?.pull && !t.dead) pullToward(ctx, caster.id, t.id, eff.onFail.pull);
          if (eff.onFail?.prone && !t.dead) knockProne(ctx, t, sp.name);
          if (eff.onFail?.forcedMoveAway && combatant(state, t.id)) {
            event(ctx, 'info', `${t.name} must use its reaction to move away from ${caster.name}.`);
            if (combatant(state, t.id).reaction) {
              combatant(state, t.id).reaction = false;
              pushAway(ctx, caster.id, t.id, 30);
            }
          }
          if (eff.command) {
            const mode = plan.commandMode ?? 'grovel';
            if (mode === 'halt') addEffect(ctx, t, { name: 'Commanded: Halt', loseTurn: true, rounds: 1, endsAt: 'targetEnd' }, meta);
            else {
              t.conditions.push({ name: 'prone', source: 'Command' });
              event(ctx, 'condition', `${t.name} grovels and falls prone.`);
            }
          }
        }
      });
      break;
    }
    case 'auto': {
      const darts = eff.darts + (eff.upcastDarts ?? 0) * (level - sp.level);
      const per = {};
      for (let i = 0; i < darts; i++) {
        const t = plan.targets[i % plan.targets.length];
        per[t.id] = (per[t.id] ?? 0) + 1;
      }
      for (const [tid, n] of Object.entries(per)) {
        const t = creatureById(state, tid);
        if (t.dead) continue;
        if (sp.key === 'magicMissile' && activeEffects(t).some(e => e.name === 'Shield')) {
          event(ctx, 'info', `${t.name}'s Shield blocks the magic missiles.`);
          continue;
        }
        let amt = 0;
        const dice = scaledDamage(sp, caster, level).dice;
        for (let i = 0; i < n; i++) amt += roll(dice, ctx.rng).total;
        event(ctx, 'info', `${n} dart${n > 1 ? 's' : ''} strike ${t.name}.`);
        applyDamage(ctx, t, [{ amount: amt, type: eff.damage.type, magical: true }], { attacker: caster, source: sp.name, auraBonusFor: x => auraBonusFor(state, x) });
      }
      break;
    }
    case 'heal': {
      const maxT = (eff.targets ?? 1);
      const targets = plan.targets.slice(0, maxT);
      const hdice = (() => {
        let d = eff.heal.dice;
        if (eff.upcastDice && level > sp.level) {
          const m = /^(\d+)d(\d+)$/.exec(d);
          const u = /^(\d+)d(\d+)$/.exec(eff.upcastDice);
          if (m && u) d = `${Number(m[1]) + Number(u[1]) * (level - sp.level)}d${m[2]}`;
        }
        if (eff.upcastFlat && level > sp.level) d = `${d}+${eff.upcastFlat * (level - sp.level)}`;
        return d;
      })();
      if (eff.selfDamage) {
        const r = roll(hdice, ctx.rng).total;
        applyDamage(ctx, caster, [{ amount: r, type: eff.selfDamage.type, magical: true }], { source: sp.name, unavoidable: true });
        for (const t of targets) if (t.id !== caster.id) applyHealing(ctx, t, eff.doubleHeal ? r * 2 : r, sp.name);
        break;
      }
      const lifeBonus = isPC(caster) && hasSub(caster, 'cleric', 'life') && level > 0 ? 2 + level : 0;
      const supreme = isPC(caster) && hasSub(caster, 'cleric', 'life', 17);
      if (eff.distribute) {
        let pool = Number(eff.heal.dice);
        for (const t of targets) {
          const need = t.maxHp - t.hp;
          const give = Math.min(need, pool);
          pool -= give;
          if (give > 0) applyHealing(ctx, t, give, sp.name);
        }
        break;
      }
      for (const t of targets) {
        if (!isPC(t) && ['undead', 'construct'].includes(MONSTERS[t.key]?.type)) {
          event(ctx, 'info', `${sp.name} has no effect on ${t.name}.`);
          continue;
        }
        const maximize = supreme || activeEffects(t).some(e => e.maxHealing);
        const r = /d/.test(hdice) ? roll(hdice, ctx.rng) : { total: Number(hdice) };
        const max = /d/.test(hdice) ? hdice.split('+').reduce((s, part) => s + (/d/.test(part) ? Number(part.split('d')[0]) * Number(part.split('d')[1]) : Number(part)), 0) : Number(hdice);
        const base = maximize ? max : r.total;
        const amt = base + (eff.heal.addMod ? src.mod : 0) + lifeBonus;
        applyHealing(ctx, t, amt, sp.name);
        if (eff.cleanse) for (const c of eff.cleanse) removeCondition(ctx, t, c);
      }
      if (isPC(caster) && hasSub(caster, 'cleric', 'life', 6) && level > 0 && targets.some(t => t.id !== caster.id)) applyHealing(ctx, caster, 2 + level, 'Blessed Healer');
      break;
    }
    case 'buff':
    case 'mark': {
      const maxT = (eff.targets ?? 1) + (eff.upcastTargets ?? 0) * (level - sp.level) + (metamagic.includes('twinned') ? 1 : 0);
      if (plan.targets.length > maxT && !eff.partyRadius) throw new RuleError(`${sp.name} can affect at most ${maxT} creatures.`);
      for (const t of plan.targets) {
        const spec = { ...eff.effect };
        if (spec.upcastMaxHp && level > sp.level) spec.maxHpBonus = (spec.maxHpBonus ?? 0) + spec.upcastMaxHp * (level - sp.level);
        if (spec.tempHpEachTurn === 'mod') spec.tempHpEachTurn = Math.max(0, src.mod);
        if (spec.sanctuary || spec.nextHit) spec.dc = dc;
        if (eff.chooseDamageType) {
          const choice = plan.choice ?? eff.chooseDamageType[0];
          if (!eff.chooseDamageType.includes(choice)) throw new RuleError(`Choose one of: ${eff.chooseDamageType.join(', ')}.`);
          spec.resistances = [choice];
        }
        if (spec.checkDisadvantage === undefined && sp.key === 'hex') spec.checkDisadvantage = [plan.hexAbility ?? 'str'];
        if (metamagic.includes('extended')) {
          if (spec.rounds) spec.rounds *= 2;
          if (spec.minutes) spec.minutes = Math.min(1440, spec.minutes * 2);
        }
        if (spec.mageArmor && isPC(t) && t.inventory.some(i => i.equipped === 'armor')) {
          event(ctx, 'info', `Mage Armor has no effect on ${t.name}, who is wearing armor.`);
          continue;
        }
        const target = eff.type === 'mark' ? t : t;
        if (eff.type === 'mark' && t.id === caster.id) throw new RuleError(`${sp.name} must target another creature.`);
        addEffect(ctx, target, spec, { ...meta, ...(spec.endsAt ? {} : { phase: 'start', expiresCid: caster.id }) });
        event(ctx, 'condition', `${t.name} is affected by ${spec.name}.`);
      }
      break;
    }
    case 'tempHp': {
      const r = roll(eff.dice, ctx.rng);
      grantTempHp(ctx, caster, r.total + (eff.upcastFlat ?? 0) * (level - sp.level), sp.name);
      break;
    }
    case 'sleep': {
      let pool = roll(eff.pool.replace(/^(\d+)d/, (_, n) => `${Number(n) + (level - sp.level) * Number(eff.upcastPool.split('d')[0])}d`), ctx.rng).total;
      event(ctx, 'info', `Sleep affects up to ${pool} hit points of creatures.`);
      const se = eff.sleepEffect;
      const cands = plan.targets.filter(t => !t.dead && t.hp > 0 && !conditionSetHas(t, 'unconscious') && (se ? !conditionSetHas(t, 'blinded') : creatureType(t) !== 'undead' && !(isPC(t) && ['elf', 'halfElf'].includes(t.race)) && !(isPC(t) ? false : MONSTERS[t.key].condImmune.includes('charmed')))).sort((a, b) => a.hp - b.hp);
      for (const t of cands) {
        if (t.hp > pool) break;
        pool -= t.hp;
        addEffect(ctx, t, se ? { ...se } : { name: 'Magical Sleep', conditions: ['unconscious'], rounds: 10, endsOnDamage: true }, meta);
        event(ctx, 'condition', se ? `${t.name} is dazzled (${se.name}).` : `${t.name} falls into a magical slumber.`);
      }
      break;
    }
    case 'stabilize': {
      const t = plan.targets[0];
      if (!isPC(t) || t.hp > 0 || t.dead) throw new RuleError(`${sp.name} only works on a living creature at 0 hit points.`);
      stabilize(ctx, t);
      break;
    }
    case 'cleanse': {
      const t = plan.targets[0];
      let removed = false;
      for (const c of eff.conditions) if (removeCondition(ctx, t, c)) removed = true;
      if (eff.exhaustion && t.exhaustion > 0) {
        t.exhaustion -= 1;
        removed = true;
        event(ctx, 'condition', `${t.name}'s exhaustion drops to ${t.exhaustion}.`);
      }
      if (!removed) event(ctx, 'info', `${sp.name} finds nothing to cure on ${t.name}.`);
      break;
    }
    case 'teleport': {
      if (eff.departBurst) spellBurst(ctx, caster, caster.id, { ...eff.departBurst, damage: { ...eff.departBurst.damage, dice: scaledDamage({ ...sp, effect: { damage: eff.departBurst.damage, upcastDice: eff.departBurst.upcastDice } }, caster, level).dice }, halfOnSave: true, skipCenter: true }, dc, sp.name);
      moveCombatant(ctx, caster.id, plan.point, { teleport: true });
      event(ctx, 'move', `${caster.name} teleports to (${plan.point.x}, ${plan.point.y}).`);
      break;
    }
    case 'zone': {
      const dmg = eff.damage ? scaledDamage(sp, caster, level) : null;
      const zone = { id: uid('zn_'), name: sp.name, spell: sp.key, casterId: caster.id, area: plan.area, save: eff.save, dc, halfOnSave: eff.halfOnSave, damage: dmg, onFailZone: eff.onFailZone, pool: eff.pool, enemiesOnly: eff.enemiesOnly, triggered: {}, expires: { cid: caster.id, phase: 'start', count: eff.rounds ?? 10 } };
      if (sp.concentration) zone.concentrationOf = caster.id;
      state.encounter.zones.push(zone);
      for (const t of creaturesInArea(state, plan.area)) {
        if (zone.enemiesOnly && !hostile(state, caster.id, t.id)) continue;
        triggerZoneSafe(ctx, zone, t.id);
      }
      break;
    }
    case 'aura': {
      const dmg = scaledDamage(sp, caster, level);
      const zone = { id: uid('zn_'), name: sp.name, spell: sp.key, casterId: caster.id, attachedTo: caster.id, radius: eff.radius, save: eff.save, dc, halfOnSave: eff.halfOnSave, damage: dmg, enemiesOnly: eff.enemiesOnly, triggered: {}, onEnter: true };
      if (sp.concentration) zone.concentrationOf = caster.id;
      state.encounter.zones.push(zone);
      if (eff.damageOnCast) for (const cb of livingCombatants(state, o => o.id !== caster.id && hostile(state, caster.id, o.id) && cbDistance(state, caster.id, o.id) <= eff.radius)) triggerZoneSafe(ctx, zone, cb.id);
      if (eff.slowEnemies) zone.slow = true;
      break;
    }
    case 'spiritualWeapon': {
      const dmg = scaledDamage(sp, caster, level);
      const w = { id: uid('sw_'), name: 'Spiritual Weapon', casterId: caster.id, pos: plan.point, dice: dmg.dice, type: dmg.type, toHit: src.attack, mod: src.mod, expires: { cid: caster.id, phase: 'start', count: 10 } };
      state.encounter.summons = (state.encounter.summons ?? []).filter(s => !(s.casterId === caster.id && s.name === w.name));
      state.encounter.summons.push(w);
      if (plan.targets[0]) spiritualWeaponStrike(ctx, caster, w, plan.targets[0]);
      break;
    }
    case 'revive': {
      const t = plan.targets[0];
      if (!t.dead) throw new RuleError(`${t.name} is not dead.`);
      if (eff.withinRounds !== Infinity && inCombat(state) && (state.encounter.round - (t.diedAtRound ?? -99)) > eff.withinRounds) throw new RuleError(`${t.name} has been dead too long for ${sp.name}.`);
      t.dead = false;
      t.hp = eff.hp;
      t.deathSaves = { successes: 0, failures: 0 };
      t.conditions = (t.conditions ?? []).filter(c => (c.name ?? c) !== 'unconscious');
      event(ctx, 'heal', `${t.name} returns to life with ${eff.hp} hit point!`);
      break;
    }
    case 'dispel': {
      const t = plan.targets[0];
      for (const e of [...(t.effects ?? [])]) {
        if (!e.spell) continue;
        const elvl = e.spellLevel ?? SPELLS[e.spell]?.level ?? 0;
        let ok = elvl <= level;
        if (!ok) {
          const ck = abilityCheck(caster, { ability: src.ability ?? 'int', dc: 10 + elvl, rng: ctx.rng });
          ctx.events.push({ type: 'check', text: `Dispel check vs ${e.name}: ${ck.total} vs DC ${10 + elvl}`, roll: ck });
          ok = ck.success;
        }
        if (ok) {
          removeEffect(ctx, t, e.id, 'dispelled');
          const src2 = creatureById(state, e.concentrationOf);
          if (src2?.concentration?.spell === e.spell) endConcentration(ctx, src2, 'spell dispelled');
        }
      }
      break;
    }
    case 'createItem': {
      if (!isPC(caster)) break;
      const qty = eff.qty;
      const ex = caster.inventory.find(i => i.key === eff.item);
      if (ex) ex.qty += qty;
      else caster.inventory.push({ id: uid('it_'), key: eff.item, qty });
      event(ctx, 'loot', `${caster.name} creates ${qty} ${ITEMS[eff.item].name}${qty > 1 ? 's' : ''}.`);
      break;
    }
    case 'powerWord': {
      const t = plan.targets[0];
      if (t.hp > eff.threshold) {
        event(ctx, 'info', `${t.name} has too many hit points to be affected.`);
        break;
      }
      if (eff.kill) {
        t.hp = 0;
        t.dead = true;
        event(ctx, 'death', `${t.name} dies instantly.`);
        if (!isPC(t)) state.encounter?.defeated.push(t.id);
      } else {
        addEffect(ctx, t, { ...eff.onApply, dc }, meta);
        event(ctx, 'condition', `${t.name} is stunned.`);
      }
      break;
    }
    default:
      event(ctx, 'info', `${sp.name}: ${sp.desc}`);
  }
  return { spell: sp.key, level, results };
}

// a save-for-damage burst around a creature (ice knife, thunder step)
function spellBurst(ctx, caster, centerId, burst, dc, label) {
  const state = ctx.state;
  if (!combatant(state, centerId)) return;
  const hit = livingCombatants(state, o => cbDistance(state, centerId, o.id) <= burst.radius && !(burst.skipCenter && o.id === centerId) && o.id !== caster.id);
  const r = roll(burst.damage.dice, ctx.rng).total;
  for (const o of hit) {
    const t = creatureById(state, o.id);
    const sv = savingThrow(t, burst.save, { dc, rng: ctx.rng, magical: true });
    ctx.events.push({ type: 'save', text: `${t.name} ${sv.label} ${sv.total ?? '-'} vs DC ${dc} - ${sv.success ? 'success' : 'failure'}`, roll: sv });
    const amt = sv.success ? (burst.halfOnSave ? Math.floor(r / 2) : 0) : r;
    if (amt > 0) applyDamage(ctx, t, [{ amount: amt, type: burst.damage.type, magical: true }], { attacker: caster, source: label });
  }
}

function conditionSetHas(t, c) {
  return conditionSet(t).has(c);
}

function triggerZoneSafe(ctx, zone, cid) {
  return triggerZone(ctx, zone, cid, 'cast');
}

export function removeCondition(ctx, t, name) {
  let removed = false;
  const before = (t.conditions ?? []).length;
  t.conditions = (t.conditions ?? []).filter(c => (c.name ?? c) !== name);
  if (t.conditions.length !== before) removed = true;
  for (const e of [...(t.effects ?? [])]) {
    if (e.conditions?.includes(name)) {
      removeEffect(ctx, t, e.id, 'cured');
      removed = true;
    }
  }
  if (removed) event(ctx, 'condition', `${t.name} is no longer ${name}.`);
  return removed;
}

export function spiritualWeaponStrike(ctx, caster, w, target) {
  const state = ctx.state;
  const tcb = combatant(state, target.id);
  if (!tcb) throw new RuleError('Target not in combat.');
  if (distanceFt(w.pos, 1, tcb.pos, tcb.fp) > 5) throw new RuleError(`${target.name} is not within 5 ft of the spiritual weapon.`);
  const profile = { name: 'Spiritual Weapon', kind: 'melee', toHit: w.toHit, reach: 5, spell: true, magical: true, properties: [] };
  const r = rollAttack(ctx, caster, target, profile, { spell: true, distance: 5 });
  const rollTxt = r.rolls.length > 1 ? `[${r.rolls.join(', ')}]` : `${r.natural}`;
  if (!r.hit) {
    event(ctx, 'attack', `Spiritual Weapon attacks ${target.name}: ${rollTxt} ${fmtMod(r.bonus)} = ${r.total} vs AC ${r.ac} - miss.`, { attacker: caster.id, target: target.id, hit: false });
    return;
  }
  event(ctx, 'attack', `Spiritual Weapon attacks ${target.name}: ${rollTxt} ${fmtMod(r.bonus)} = ${r.total} vs AC ${r.ac} - ${r.crit ? 'CRITICAL HIT!' : 'hit'}.`, { attacker: caster.id, target: target.id, hit: true });
  const d = roll(w.dice, ctx.rng, { crit: r.crit });
  applyDamage(ctx, target, [{ amount: d.total + w.mod, type: w.type, magical: true }], { crit: r.crit, attacker: caster, source: 'Spiritual Weapon', auraBonusFor: x => auraBonusFor(state, x) });
}

export function moveSpiritualWeapon(ctx, casterId, { to, target }) {
  const state = ctx.state;
  const { ts, c } = requireTurn(state, casterId);
  const w = (state.encounter.summons ?? []).find(s => s.casterId === casterId && s.name === 'Spiritual Weapon');
  if (!w) throw new RuleError('You have no spiritual weapon.');
  if (ts.spellsCast.some(s => s.time === 'bonus')) void 0;
  spendAction(ts, 'bonus', c);
  if (to) {
    if (pointDistanceFt(w.pos, to) > 20) throw new RuleError('The spiritual weapon moves up to 20 ft.');
    if (!inBounds(state.encounter.map, to)) throw new RuleError('Off the map.');
    w.pos = { ...to };
    event(ctx, 'move', `The spiritual weapon moves to (${to.x}, ${to.y}).`);
  }
  if (target) spiritualWeaponStrike(ctx, c, w, requireCreature(state, target));
  checkEncounterEnd(ctx);
}

export function sorceryConvert(ctx, casterId, { mode, level }) {
  const state = ctx.state;
  const c = requireCreature(state, casterId);
  if (!isPC(c) || cl(c, 'sorcerer') < 2) throw new RuleError('Only sorcerers of level 2+ have Font of Magic.');
  const res = c.resources.sorceryPoints;
  if (inCombat(state) && combatant(state, casterId)) {
    const { ts } = requireTurn(state, casterId);
    spendAction(ts, 'bonus', c);
  }
  if (mode === 'slotToPoints') {
    const s = c.slots[level];
    if (!s || s.used >= s.max) throw new RuleError(`No level ${level} slot to convert.`);
    if (res.used === 0) throw new RuleError('Your sorcery points are already full.');
    s.used += 1;
    res.used = Math.max(0, res.used - level);
    event(ctx, 'info', `${c.name} converts a level ${level} slot into ${level} sorcery points.`);
  } else if (mode === 'pointsToSlot') {
    const cost = SP_COST[level];
    if (!cost) throw new RuleError('You can only create slots of level 1-5.');
    if (res.max - res.used < cost) throw new RuleError(`Creating a level ${level} slot costs ${cost} sorcery points.`);
    const s = c.slots[level];
    if (!s) throw new RuleError(`You have no level ${level} slots to restore.`);
    if (s.used <= 0) throw new RuleError(`Your level ${level} slots are already full.`);
    res.used += cost;
    s.used -= 1;
    event(ctx, 'info', `${c.name} spends ${cost} sorcery points to create a level ${level} slot.`);
  } else throw new RuleError('Mode must be slotToPoints or pointsToSlot.');
}

export function maybeHellishRebuke(ctx, target, attacker) {
  if (!isPC(target) || !attacker || target.dead || target.hp <= 0 || target.preferences?.autoHellishRebuke === false) return;
  const state = ctx.state;
  if (!inCombat(state) || !combatant(state, target.id)?.reaction || !combatant(state, attacker.id)) return;
  if (cbDistance(state, target.id, attacker.id) > 60 || attacker.dead) return;
  const cast = castableSpells(target);
  if (!cast.has('hellishRebuke')) return;
  const src = cast.get('hellishRebuke');
  const level = src === 'innate' ? 2 : (target.pactSlots?.level ?? 1);
  try {
    castSpell(ctx, target.id, { spell: 'hellishRebuke', targets: [attacker.id], reactionTrigger: true, level: src === 'class' && target.pactSlots ? undefined : src === 'class' ? 1 : undefined });
  } catch (e) {
    if (!(e instanceof RuleError)) throw e;
  }
  void level;
}
