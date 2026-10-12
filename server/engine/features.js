import { hasFeat } from './feats.js';
import { cl, hasSub } from './classlevel.js';
import { CLASSES } from './data/classes.js';
import { MONSTERS, WILD_SHAPE_BEASTS } from './data/monsters.js';
import { crValue } from './data/core.js';
import { DRACONIC_ANCESTRY, breathDice } from './data/races.js';
import { roll, averageOf } from './dice.js';
import { isPC, mod, prof, isIncapacitated, activeEffects, creatureType, size, SIZE_ORDER, skillMod, passivePerception, conditionSet, speed, hasTrait } from './creature.js';
import { equipped, armorDef, itemDef, weaponDef } from './character.js';
import { abilityCheck, savingThrow, contest } from './checks.js';
import { RuleError, fmtMod } from './util.js';
import { creatureById, combatant, event, inCombat, hostile, requireCreature } from './state.js';
import { requireTurn, spendAction, cbDistance, livingCombatants, auraBonusFor, pushAway, checkEncounterEnd, hasActionAvailable } from './combat.js';
import { inArea } from './grid.js';
import { applyDamage, applyHealing, grantTempHp, stabilize } from './damage.js';
import { addEffect, removeEffect, removeEffectsWhere } from './effects.js';
import { findProfile, rollAttack, attackProfiles, numAttacks } from './attack.js';
import { removeCondition } from './spellcasting.js';

function useResource(c, key, amount = 1, label) {
  const r = c.resources?.[key];
  if (!r) throw new RuleError(`${c.name} does not have ${label ?? key}.`);
  if (r.max - r.used < amount) throw new RuleError(`${c.name} has no ${label ?? r.name} uses left.`, 'no_resource');
  r.used += amount;
}

function turnOrFree(state, cid) {
  if (inCombat(state) && combatant(state, cid)) return requireTurn(state, cid);
  return { ts: null, c: creatureById(state, cid) };
}

function spend(ts, kind, c, label) {
  if (ts) spendAction(ts, kind, c, label);
}

function requireClass(c, cls, level, feature) {
  if (!isPC(c) || cl(c, cls) < level) throw new RuleError(`${feature} requires ${cls} level ${level}.`);
}

function requireSub(c, cls, sub, level, feature) {
  if (!isPC(c) || !hasSub(c, cls, sub, level)) throw new RuleError(`${feature} is a ${CLASSES[cls].subclasses[sub].name} feature (${cls} level ${level}).`);
}

// common combat actions
export function dash(ctx, cid, { bonus = false } = {}) {
  const { ts, c } = requireTurn(ctx.state, cid);
  spendAction(ts, bonus ? 'bonus' : 'action', c, 'Dash');
  ts.movement += speed(c);
  event(ctx, 'action', `${c.name} dashes (${ts.movement - ts.moved} ft of movement left).`);
}

export function disengage(ctx, cid, { bonus = false } = {}) {
  const { ts, c } = requireTurn(ctx.state, cid);
  spendAction(ts, bonus ? 'bonus' : 'action', c, 'Disengage');
  ts.disengaged = true;
  event(ctx, 'action', `${c.name} disengages; their movement provokes no opportunity attacks this turn.`);
}

export function dodge(ctx, cid, { bonus = false } = {}) {
  const { ts, c, cb } = requireTurn(ctx.state, cid);
  spendAction(ts, bonus ? 'bonus' : 'action', c, 'Dodge');
  cb.dodging = true;
  addEffect(ctx, c, { name: 'Dodging', dexSaveAdvantage: true, rounds: 1, endsAt: 'casterStart' }, { sourceId: cid });
  event(ctx, 'action', `${c.name} takes the Dodge action.`);
}

export function help(ctx, cid, { target }) {
  const state = ctx.state;
  const { ts, c } = requireTurn(state, cid);
  const t = requireCreature(state, target);
  if (cbDistance(state, cid, target) > 5) throw new RuleError(`To help attack ${t.name} you must be within 5 ft of it.`);
  spendAction(ts, 'action', c, 'Help');
  addEffect(ctx, t, { name: `Distracted by ${c.name}`, helpedBy: cid, rounds: 1, endsAt: 'casterStart' }, { sourceId: cid });
  event(ctx, 'action', `${c.name} helps: the next ally attack against ${t.name} has advantage.`);
}

// first aid without a kit: an action and a DC 10 Wisdom (Medicine) check stabilizes a dying creature within reach
export function stabilizeAlly(ctx, cid, { target }) {
  const state = ctx.state;
  const c = requireCreature(state, cid);
  const t = requireCreature(state, target);
  if (t.dead) throw new RuleError(`${t.name} is beyond help.`);
  if (t.hp > 0) throw new RuleError(`${t.name} is not dying.`);
  if (t.stable) throw new RuleError(`${t.name} is already stable.`);
  if (inCombat(state) && combatant(state, cid)) {
    const { ts } = requireTurn(state, cid);
    if (cbDistance(state, cid, target) > 5) throw new RuleError(`${t.name} is out of reach; move next to them first.`);
    spendAction(ts, 'action', c, 'Stabilize');
  }
  const ck = abilityCheck(c, { skill: 'medicine', dc: 10, rng: ctx.rng, reason: `stabilizing ${t.name}` });
  ctx.events.push({ type: 'check', text: `${c.name} tends to ${t.name}: Medicine ${ck.total} vs DC 10 - ${ck.success ? 'success' : 'failure'}`, roll: ck });
  if (ck.success) stabilize(ctx, t);
  else event(ctx, 'info', `${t.name} is still dying.`);
}

export function hide(ctx, cid, { bonus = false } = {}) {
  const state = ctx.state;
  const { ts, c, cb, enc } = requireTurn(state, cid);
  const cover = new Set((enc.map.cover ?? []).map(([x, y]) => `${x},${y}`));
  const inCover = cover.has(`${cb.pos.x},${cb.pos.y}`);
  const invisible = conditionSet(c).has('invisible');
  let naturally = false;
  if (hasTrait(c, 'naturallyStealthy')) {
    naturally = livingCombatants(state, o => o.id !== cid && SIZE_ORDER.indexOf(size(creatureById(state, o.id))) > SIZE_ORDER.indexOf(size(c)) && cbDistance(state, cid, o.id) <= 5).length > 0;
  }
  if (!inCover && !invisible && !naturally && enc.map.light !== 'dark') throw new RuleError(`${c.name} has nothing to hide behind. Hiding needs cover, obscurement or invisibility.`);
  spendAction(ts, bonus ? 'bonus' : 'action', c, 'Hide');
  const ck = abilityCheck(c, { skill: 'stealth', rng: ctx.rng });
  const watchers = livingCombatants(state, o => hostile(state, cid, o.id) && !isIncapacitated(creatureById(state, o.id)) && creatureById(state, o.id).hp > 0);
  const best = Math.max(0, ...watchers.map(o => passivePerception(creatureById(state, o.id))));
  ctx.events.push({ type: 'check', text: `${c.name} Stealth ${ck.total} vs best passive Perception ${best}`, roll: ck });
  if (ck.total > best || (ck.total >= best && best === 0)) {
    cb.hidden = true;
    cb.stealthRoll = ck.total;
    event(ctx, 'action', `${c.name} is hidden.`);
  } else event(ctx, 'action', `${c.name} fails to hide.`);
}

export function search(ctx, cid) {
  const state = ctx.state;
  const { ts, c } = requireTurn(state, cid);
  spendAction(ts, 'action', c, 'Search');
  const ck = abilityCheck(c, { skill: 'perception', rng: ctx.rng });
  ctx.events.push({ type: 'check', text: `${c.name} searches: Perception ${ck.total}`, roll: ck });
  for (const o of livingCombatants(state, o => o.hidden && hostile(state, cid, o.id))) {
    if (ck.total >= (o.stealthRoll ?? 10)) {
      o.hidden = false;
      event(ctx, 'info', `${c.name} spots ${o.name}!`);
    }
  }
}

export function standUp(ctx, cid) {
  const { ts, c } = requireTurn(ctx.state, cid);
  const prone = (c.conditions ?? []).find(x => (x.name ?? x) === 'prone');
  if (!prone) throw new RuleError(`${c.name} is not prone.`);
  const cost = hasFeat(c, 'athlete') ? 5 : Math.floor(speed(c) / 2);
  if (ts.movement - ts.moved < cost) throw new RuleError(`Standing costs ${cost} ft of movement.`);
  ts.moved += cost;
  c.conditions = c.conditions.filter(x => x !== prone);
  event(ctx, 'move', `${c.name} stands up.`);
}

export function dropProne(ctx, cid) {
  const { c } = requireTurn(ctx.state, cid);
  if (!(c.conditions ?? []).some(x => (x.name ?? x) === 'prone')) c.conditions.push({ name: 'prone', source: 'voluntary' });
  event(ctx, 'move', `${c.name} drops prone.`);
}

function consumeAttackSlot(ctx, ts, c) {
  if (ts.attacksLeft > 0) {
    ts.attacksLeft -= 1;
    return;
  }
  if (!hasActionAvailable(ts)) throw new RuleError(`${c.name} has no action left.`, 'no_action');
  spendAction(ts, 'action', c, 'attack');
  ts.attackAction = true;
  const extra = isPC(c) ? numAttacks(c) - 1 : 0;
  ts.attacksLeft = extra;
}

export function grapple(ctx, cid, { target }) {
  const state = ctx.state;
  const { ts, c } = requireTurn(state, cid);
  const t = requireCreature(state, target);
  if (cbDistance(state, cid, target) > 5) throw new RuleError(`${t.name} is out of reach.`);
  if (SIZE_ORDER.indexOf(size(t)) > SIZE_ORDER.indexOf(size(c)) + 1) throw new RuleError(`${t.name} is too large to grapple.`);
  if (isPC(c) && equipped(c, 'mainHand') && equipped(c, 'offHand')) throw new RuleError('You need a free hand to grapple.');
  consumeAttackSlot(ctx, ts, c);
  const defSkill = skillMod(t, 'athletics') >= skillMod(t, 'acrobatics') ? 'athletics' : 'acrobatics';
  const r = contest(c, { skill: 'athletics' }, t, { skill: defSkill }, ctx.rng);
  ctx.events.push({ type: 'check', text: `Grapple: ${c.name} Athletics ${r.attacker.total} vs ${t.name} ${defSkill} ${r.defender.total}`, roll: r });
  ts.attackedHostile = true;
  if (r.winner === 'attacker') {
    if (isPC(t) ? false : MONSTERS[t.key].condImmune.includes('grappled')) return event(ctx, 'info', `${t.name} cannot be grappled.`);
    addEffect(ctx, t, { name: `Grappled by ${c.name}`, conditions: ['grappled'], grappledBy: cid, escape: { contest: true } }, { sourceId: cid });
    event(ctx, 'condition', `${t.name} is grappled by ${c.name}.`);
  } else event(ctx, 'info', `${t.name} slips the grapple.`);
  checkEncounterEnd(ctx);
}

export function shove(ctx, cid, { target, mode = 'prone' }) {
  const state = ctx.state;
  const { ts, c } = requireTurn(state, cid);
  const t = requireCreature(state, target);
  if (cbDistance(state, cid, target) > 5) throw new RuleError(`${t.name} is out of reach.`);
  if (SIZE_ORDER.indexOf(size(t)) > SIZE_ORDER.indexOf(size(c)) + 1) throw new RuleError(`${t.name} is too large to shove.`);
  consumeAttackSlot(ctx, ts, c);
  const defSkill = skillMod(t, 'athletics') >= skillMod(t, 'acrobatics') ? 'athletics' : 'acrobatics';
  const r = contest(c, { skill: 'athletics' }, t, { skill: defSkill }, ctx.rng);
  ctx.events.push({ type: 'check', text: `Shove: ${c.name} Athletics ${r.attacker.total} vs ${t.name} ${defSkill} ${r.defender.total}`, roll: r });
  ts.attackedHostile = true;
  if (r.winner !== 'attacker') return event(ctx, 'info', `${t.name} holds their ground.`);
  if (mode === 'push') pushAway(ctx, cid, target, 5);
  else {
    if (!(t.conditions ?? []).some(x => (x.name ?? x) === 'prone')) t.conditions.push({ name: 'prone', source: c.name });
    event(ctx, 'condition', `${t.name} is knocked prone.`);
  }
}

export function escape(ctx, cid) {
  const state = ctx.state;
  const { ts, c } = requireTurn(state, cid);
  const e = activeEffects(c).find(x => x.escape);
  if (!e) throw new RuleError(`${c.name} is not grappled or restrained by anything they can escape.`);
  spendAction(ts, 'action', c, 'escape');
  let ok;
  if (e.escape.contest) {
    const g = creatureById(state, e.grappledBy);
    const sk = skillMod(c, 'athletics') >= skillMod(c, 'acrobatics') ? 'athletics' : 'acrobatics';
    const r = contest(c, { skill: sk }, g, { skill: 'athletics' }, ctx.rng);
    ctx.events.push({ type: 'check', text: `Escape: ${c.name} ${sk} ${r.attacker.total} vs ${g.name} Athletics ${r.defender.total}`, roll: r });
    ok = r.winner === 'attacker';
  } else {
    const ck = abilityCheck(c, { skill: e.escape.ability === 'dex' ? 'acrobatics' : 'athletics', dc: e.escape.dc ?? e.dc ?? 10, rng: ctx.rng });
    ctx.events.push({ type: 'check', text: `Escape ${e.name}: ${ck.total} vs DC ${ck.dc}`, roll: ck });
    ok = ck.success;
  }
  if (ok) removeEffect(ctx, c, e.id, 'escaped');
  else event(ctx, 'info', `${c.name} fails to break free.`);
}

// class features
export function secondWind(ctx, cid) {
  const state = ctx.state;
  const { ts, c } = turnOrFree(state, cid);
  requireClass(c, 'fighter', 1, 'Second Wind');
  if (c.hp <= 0) throw new RuleError('You are unconscious.');
  useResource(c, 'secondWind', 1, 'Second Wind');
  spend(ts, 'bonus', c);
  const r = roll('1d10', ctx.rng);
  applyHealing(ctx, c, r.total + cl(c, 'fighter'), `Second Wind ${r.detail} + ${cl(c, 'fighter')}`);
}

export function actionSurge(ctx, cid) {
  const { ts, c } = requireTurn(ctx.state, cid);
  requireClass(c, 'fighter', 2, 'Action Surge');
  if (ts.surged) throw new RuleError('Action Surge can only be used once per turn.');
  useResource(c, 'actionSurge', 1, 'Action Surge');
  ts.surged = true;
  ts.action += 1;
  event(ctx, 'action', `${c.name} surges with renewed vigor: one additional action this turn.`);
}

export function rage(ctx, cid, { frenzy = false } = {}) {
  const state = ctx.state;
  const { ts, c } = requireTurn(state, cid);
  requireClass(c, 'barbarian', 1, 'Rage');
  if (activeEffects(c).some(e => e.rage)) throw new RuleError('Already raging.');
  const armor = equipped(c, 'armor');
  if (armor && armorDef(armor)?.category === 'heavy') throw new RuleError('You cannot rage in heavy armor.');
  if (c.concentration) throw new RuleError('Raging would break your concentration; end it first.');
  useResource(c, 'rage', 1, 'Rage');
  spendAction(ts, 'bonus', c, 'rage');
  if (frenzy) requireSub(c, 'barbarian', 'berserker', 3, 'Frenzy');
  addEffect(ctx, c, { name: frenzy ? 'Frenzied Rage' : 'Rage', rage: true, frenzy, rounds: 10 }, { sourceId: cid });
  ts.attackedHostile = true;
  event(ctx, 'action', `${c.name} flies into a ${frenzy ? 'frenzied ' : ''}rage!`);
}

export function endRage(ctx, cid) {
  const c = requireCreature(ctx.state, cid);
  const e = activeEffects(c).find(x => x.rage);
  if (!e) throw new RuleError('Not raging.');
  if (inCombat(ctx.state)) {
    const { ts } = requireTurn(ctx.state, cid);
    spendAction(ts, 'bonus', c);
  }
  removeEffect(ctx, c, e.id, 'ended');
}

export function bardicInspiration(ctx, cid, { target }) {
  const state = ctx.state;
  const { ts, c } = turnOrFree(state, cid);
  requireClass(c, 'bard', 1, 'Bardic Inspiration');
  if (target === cid) throw new RuleError('You cannot inspire yourself.');
  const t = requireCreature(state, target);
  if (ts && cbDistance(state, cid, target) > 60) throw new RuleError(`${t.name} is more than 60 ft away.`);
  if (t.inspirationDie) throw new RuleError(`${t.name} already holds an inspiration die.`);
  useResource(c, 'bardicInspiration', 1, 'Bardic Inspiration');
  spend(ts, 'bonus', c);
  const bl = cl(c, 'bard');
  const die = bl >= 15 ? '1d12' : bl >= 10 ? '1d10' : bl >= 5 ? '1d8' : '1d6';
  t.inspirationDie = die;
  event(ctx, 'action', `${c.name} inspires ${t.name} (${die}). It will be added automatically when it can turn a failure into success.`);
}

export function turnUndead(ctx, cid, { unholy = false } = {}) {
  const state = ctx.state;
  const { ts, c } = requireTurn(state, cid);
  if (unholy) requireSub(c, 'paladin', 'devotion', 3, 'Turn the Unholy');
  else requireClass(c, 'cleric', 2, 'Turn Undead');
  useResource(c, 'channelDivinity', 1, 'Channel Divinity');
  spendAction(ts, 'action', c, 'Channel Divinity');
  const dc = 8 + prof(c) + mod(c, unholy ? 'cha' : 'wis');
  const types = unholy ? ['undead', 'fiend'] : ['undead'];
  const destroyCr = cl(c, 'cleric') > 0 ? (cl(c, 'cleric') >= 17 ? 4 : cl(c, 'cleric') >= 14 ? 3 : cl(c, 'cleric') >= 11 ? 2 : cl(c, 'cleric') >= 8 ? 1 : cl(c, 'cleric') >= 5 ? 0.5 : -1) : -1;
  event(ctx, 'action', `${c.name} presents their holy symbol: ${unholy ? 'Turn the Unholy' : 'Turn Undead'} (DC ${dc}).`);
  let any = false;
  for (const o of livingCombatants(state, o => cbDistance(state, cid, o.id) <= 30 && o.id !== cid)) {
    const t = creatureById(state, o.id);
    if (!types.includes(creatureType(t)) || t.hp <= 0) continue;
    any = true;
    const sv = savingThrow(t, 'wis', { dc, rng: ctx.rng, magical: true });
    ctx.events.push({ type: 'save', text: `${t.name} Wis save ${sv.total} vs DC ${dc} - ${sv.success ? 'resists' : 'turned'}`, roll: sv });
    if (sv.success) continue;
    if (!isPC(t) && crValue(MONSTERS[t.key].cr) <= destroyCr) {
      t.hp = 0;
      t.dead = true;
      state.encounter.defeated.push(t.id);
      event(ctx, 'death', `${t.name} is destroyed by divine power!`);
    } else {
      addEffect(ctx, t, { name: 'Turned', conditions: ['turned'], turnedBy: cid, rounds: 10, endsOnDamage: true }, { sourceId: cid });
      event(ctx, 'condition', `${t.name} is turned and must flee.`);
    }
  }
  if (!any) event(ctx, 'info', 'No undead within 30 ft are affected.');
  checkEncounterEnd(ctx);
}

export function preserveLife(ctx, cid, { allocations }) {
  const state = ctx.state;
  const { ts, c } = turnOrFree(state, cid);
  requireClass(c, 'cleric', 2, 'Preserve Life');
  const pool = 5 * cl(c, 'cleric');
  const entries = Object.entries(allocations ?? {});
  if (!entries.length) throw new RuleError('Choose who receives healing.');
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total > pool) throw new RuleError(`Preserve Life restores at most ${pool} hit points in total.`);
  for (const [id, amt] of entries) {
    const t = requireCreature(state, id);
    if (!Number.isInteger(amt) || amt < 1) throw new RuleError('Allocations must be positive whole numbers.');
    if (t.hp + amt > Math.floor(t.maxHp / 2)) throw new RuleError(`Preserve Life cannot raise ${t.name} above half their maximum (${Math.floor(t.maxHp / 2)}).`);
    if (ts && cbDistance(state, cid, id) > 30) throw new RuleError(`${t.name} is more than 30 ft away.`);
    if (!isPC(t) && ['undead', 'construct'].includes(MONSTERS[t.key].type)) throw new RuleError(`Preserve Life has no effect on ${t.name}.`);
  }
  useResource(c, 'channelDivinity', 1, 'Channel Divinity');
  spend(ts, 'action', c);
  for (const [id, amt] of entries) applyHealing(ctx, requireCreature(state, id), amt, 'Preserve Life');
}

// Oath of Vengeance: advantage on attacks against one creature for a minute
export function vowOfEnmity(ctx, cid, { target }) {
  const { ts, c } = requireTurn(ctx.state, cid);
  requireSub(c, 'paladin', 'vengeance', 3, 'Vow of Enmity');
  const t = requireCreature(ctx.state, target);
  if (cbDistance(ctx.state, cid, target) > 10) throw new RuleError(`${t.name} must be within 10 ft.`);
  useResource(c, 'channelDivinity', 1, 'Channel Divinity');
  spendAction(ts, 'bonus', c);
  removeEffectsWhere(ctx, c, e => e.vowTarget, 'silent');
  addEffect(ctx, c, { name: 'Vow of Enmity', vowTarget: t.id, rounds: 10 }, { sourceId: cid });
  event(ctx, 'action', `${c.name} swears a vow of enmity against ${t.name}.`);
}

// Wild Magic: advantage on the next attack roll
export function tidesOfChaos(ctx, cid) {
  const { c } = turnOrFree(ctx.state, cid);
  requireSub(c, 'sorcerer', 'wildMagic', 1, 'Tides of Chaos');
  if (activeEffects(c).some(e => e.tidesOfChaos)) throw new RuleError('The tides of chaos already favor you.');
  useResource(c, 'tidesOfChaos', 1, 'Tides of Chaos');
  addEffect(ctx, c, { name: 'Tides of Chaos', tidesOfChaos: true, minutes: 60 }, { sourceId: cid });
  event(ctx, 'action', `${c.name} calls on the tides of chaos.`);
}

export function sacredWeapon(ctx, cid) {
  const { ts, c } = requireTurn(ctx.state, cid);
  requireSub(c, 'paladin', 'devotion', 3, 'Sacred Weapon');
  useResource(c, 'channelDivinity', 1, 'Channel Divinity');
  spendAction(ts, 'action', c);
  addEffect(ctx, c, { name: 'Sacred Weapon', attackBonus: Math.max(1, mod(c, 'cha')), rounds: 10 }, { sourceId: cid });
  event(ctx, 'action', `${c.name}'s weapon blazes with holy light (+${Math.max(1, mod(c, 'cha'))} to hit).`);
}

export function layOnHands(ctx, cid, { target, amount, cure }) {
  const state = ctx.state;
  const { ts, c } = turnOrFree(state, cid);
  requireClass(c, 'paladin', 1, 'Lay on Hands');
  const t = requireCreature(state, target);
  if (ts && cbDistance(state, cid, target) > 5) throw new RuleError(`You must touch ${t.name} (within 5 ft).`);
  if (!isPC(t) && ['undead', 'construct'].includes(MONSTERS[t.key].type)) throw new RuleError(`Lay on Hands has no effect on ${t.name}.`);
  const res = c.resources.layOnHands;
  const left = res.max - res.used;
  if (cure) {
    if (left < 5) throw new RuleError('Curing a poison costs 5 points from the pool.');
    spend(ts, 'action', c);
    res.used += 5;
    if (!removeCondition(ctx, t, 'poisoned')) event(ctx, 'info', `${t.name} was not poisoned.`);
    return;
  }
  const amt = Number(amount);
  if (!Number.isInteger(amt) || amt < 1) throw new RuleError('Choose how many hit points to restore.');
  if (amt > left) throw new RuleError(`Only ${left} points remain in your Lay on Hands pool.`);
  spend(ts, 'action', c);
  res.used += amt;
  applyHealing(ctx, t, amt, 'Lay on Hands');
}

export function flurryOfBlows(ctx, cid) {
  const { ts, c } = requireTurn(ctx.state, cid);
  requireClass(c, 'monk', 2, 'Flurry of Blows');
  if (!ts.attackAction) throw new RuleError('Flurry of Blows follows the Attack action.');
  useResource(c, 'ki', 1, 'ki');
  spendAction(ts, 'bonus', c);
  ts.martialArtsReady = false;
  ts.flurryLeft = 2;
  event(ctx, 'action', `${c.name} unleashes a Flurry of Blows (two unarmed strikes).`);
}

export function patientDefense(ctx, cid) {
  const { ts, c, cb } = requireTurn(ctx.state, cid);
  requireClass(c, 'monk', 2, 'Patient Defense');
  useResource(c, 'ki', 1, 'ki');
  spendAction(ts, 'bonus', c);
  cb.dodging = true;
  addEffect(ctx, c, { name: 'Dodging', dexSaveAdvantage: true, rounds: 1, endsAt: 'casterStart' }, { sourceId: cid });
  event(ctx, 'action', `${c.name} takes the Dodge action (Patient Defense).`);
}

export function stepOfTheWind(ctx, cid, { mode = 'dash' } = {}) {
  const { ts, c } = requireTurn(ctx.state, cid);
  requireClass(c, 'monk', 2, 'Step of the Wind');
  useResource(c, 'ki', 1, 'ki');
  spendAction(ts, 'bonus', c);
  if (mode === 'disengage') ts.disengaged = true;
  else ts.movement += speed(c);
  event(ctx, 'action', `${c.name} uses Step of the Wind to ${mode}.`);
}

export function cunningAction(ctx, cid, { mode }) {
  const { c } = requireTurn(ctx.state, cid);
  requireClass(c, 'rogue', 2, 'Cunning Action');
  if (mode === 'dash') return dash(ctx, cid, { bonus: true });
  if (mode === 'disengage') return disengage(ctx, cid, { bonus: true });
  if (mode === 'hide') return hide(ctx, cid, { bonus: true });
  throw new RuleError('Cunning Action allows dash, disengage or hide.');
}

export function nimbleEscape(ctx, cid, { mode }) {
  const c = creatureById(ctx.state, cid);
  if (!hasTrait(c, 'nimbleEscape')) throw new RuleError(`${c.name} lacks Nimble Escape.`);
  if (mode === 'disengage') return disengage(ctx, cid, { bonus: true });
  if (mode === 'hide') return hide(ctx, cid, { bonus: true });
  throw new RuleError('Nimble Escape allows disengage or hide.');
}

export function wildShape(ctx, cid, { beast }) {
  const state = ctx.state;
  const { ts, c } = turnOrFree(state, cid);
  requireClass(c, 'druid', 2, 'Wild Shape');
  if (c.wildShape) throw new RuleError('Already in beast form.');
  const key = Object.keys(MONSTERS).find(k => k === beast || MONSTERS[k].name.toLowerCase() === String(beast).toLowerCase());
  if (!key || !WILD_SHAPE_BEASTS.includes(key)) throw new RuleError(`Wild Shape options: ${WILD_SHAPE_BEASTS.map(k => MONSTERS[k].name).join(', ')}.`);
  const dl = cl(c, 'druid');
  const moon = hasSub(c, 'druid', 'moon', 2);
  const maxCr = moon ? Math.max(1, Math.floor(dl / 3)) : dl >= 8 ? 1 : dl >= 4 ? 0.5 : 0.25;
  if (crValue(MONSTERS[key].cr) > maxCr) throw new RuleError(`At druid level ${dl} you can become beasts of CR ${maxCr} or lower.`);
  useResource(c, 'wildShape', 1, 'Wild Shape');
  // Combat Wild Shape: a bonus action for the Circle of the Moon
  spend(ts, moon ? 'bonus' : 'action', c);
  if (c.concentration) void 0;
  const hp = Math.floor(averageOf(MONSTERS[key].hp));
  c.wildShape = { beast: key, hp, maxHp: hp };
  addEffect(ctx, c, { name: `Wild Shape (${MONSTERS[key].name})`, wildShapeEnd: true, minutes: Math.max(1, Math.floor(dl / 2)) * 60 }, { sourceId: cid });
  event(ctx, 'action', `${c.name} transforms into a ${MONSTERS[key].name} (${hp} HP).`);
}

export function revertWildShape(ctx, cid) {
  const state = ctx.state;
  const { ts, c } = turnOrFree(state, cid);
  if (!c.wildShape) throw new RuleError('Not in beast form.');
  spend(ts, 'bonus', c);
  delete c.wildShape;
  removeEffectsWhere(ctx, c, e => e.wildShapeEnd, 'silent');
  event(ctx, 'action', `${c.name} returns to their normal form.`);
}

export function breathWeapon(ctx, cid, { point, target }) {
  const state = ctx.state;
  const { ts, c, cb } = requireTurn(state, cid);
  if (!isPC(c) || !hasTrait(c, 'breathWeapon')) throw new RuleError('Only dragonborn have a breath weapon.');
  const anc = DRACONIC_ANCESTRY[c.ancestry];
  const aim = point ?? (target ? combatant(state, target)?.pos : null);
  if (!aim) throw new RuleError('Choose a direction (target or point) for your breath weapon.');
  useResource(c, 'breathWeapon', 1, 'Breath Weapon');
  spendAction(ts, 'action', c, 'Breath Weapon');
  const area = { shape: anc.shape, size: anc.size, origin: { ...cb.pos }, toward: aim };
  const dc = 8 + mod(c, 'con') + prof(c);
  const r = roll(breathDice(c.level), ctx.rng);
  event(ctx, 'action', `${c.name} exhales ${anc.type} in a ${anc.size} ft ${anc.shape} (DC ${dc} ${anc.save.toUpperCase()}; ${r.detail}).`);
  for (const o of livingCombatants(state, o => o.id !== cid && inArea(area, o.pos, o.fp))) {
    const t = creatureById(state, o.id);
    const sv = savingThrow(t, anc.save, { dc, rng: ctx.rng, auraBonus: auraBonusFor(state, t) });
    ctx.events.push({ type: 'save', text: `${t.name} ${sv.label} ${sv.total ?? '-'} vs DC ${dc} - ${sv.success ? 'half' : 'full'}`, roll: sv });
    applyDamage(ctx, t, [{ amount: sv.success ? Math.floor(r.total / 2) : r.total, type: anc.type }], { attacker: c, source: 'Breath Weapon', auraBonusFor: x => auraBonusFor(state, x) });
  }
  ts.attackedHostile = true;
  checkEncounterEnd(ctx);
}

export function wholenessOfBody(ctx, cid) {
  const { ts, c } = turnOrFree(ctx.state, cid);
  requireSub(c, 'monk', 'openHand', 6, 'Wholeness of Body');
  useResource(c, 'wholenessOfBody', 1, 'Wholeness of Body');
  spend(ts, 'action', c);
  applyHealing(ctx, c, 3 * cl(c, 'monk'), 'Wholeness of Body');
}

export function monsterSpecial(ctx, cid, { special, target, point }) {
  const state = ctx.state;
  const { ts, c, cb } = requireTurn(state, cid);
  if (isPC(c)) throw new RuleError('Characters use their own features.');
  const s = (MONSTERS[c.key].special ?? []).find(x => x.key === special || x.name.toLowerCase() === String(special).toLowerCase());
  if (!s) throw new RuleError(`${c.name} has no ability "${special}".`);
  if (s.recharge && !c.recharge[s.key]) throw new RuleError(`${c.name}'s ${s.name} has not recharged.`);
  spendAction(ts, 'action', c, s.name);
  if (s.recharge) c.recharge[s.key] = false;
  ts.attackedHostile = true;
  if (s.area) {
    const aim = point ?? combatant(state, target)?.pos;
    if (!aim) throw new RuleError(`${s.name} needs a direction.`);
    const area = { ...s.area, origin: { ...cb.pos }, toward: aim };
    const r = roll(s.damage, ctx.rng);
    event(ctx, 'action', `${c.name} uses ${s.name}! (DC ${s.dc} ${s.save.toUpperCase()}; ${r.detail})`);
    for (const o of livingCombatants(state, o => o.id !== cid && inArea(area, o.pos, o.fp))) {
      const t = creatureById(state, o.id);
      const sv = savingThrow(t, s.save, { dc: s.dc, rng: ctx.rng, against: s.type === 'poison' ? 'poison' : null, auraBonus: auraBonusFor(state, t) });
      ctx.events.push({ type: 'save', text: `${t.name} ${sv.label} ${sv.total ?? '-'} vs DC ${s.dc} - ${sv.success ? 'half' : 'full'}`, roll: sv });
      const evasion = s.save === 'dex' && (cl(t, 'monk') >= 7 || cl(t, 'rogue') >= 7);
      const factor = sv.success ? (evasion ? 0 : 0.5) : evasion ? 0.5 : 1;
      if (factor) applyDamage(ctx, t, [{ amount: Math.floor(r.total * factor), type: s.type }], { attacker: c, source: s.name, auraBonusFor: x => auraBonusFor(state, x) });
      else event(ctx, 'info', `${t.name} evades the blast entirely.`);
    }
  } else if (s.kind === 'ranged') {
    const t = requireCreature(state, target);
    const d = cbDistance(state, cid, target);
    if (d > s.range[1]) throw new RuleError(`${t.name} is out of range for ${s.name}.`);
    const res = rollAttack(ctx, c, t, { name: s.name, kind: 'ranged', toHit: s.toHit, range: s.range, properties: [] }, {});
    event(ctx, 'attack', `${c.name} uses ${s.name} on ${t.name}: ${res.total} vs AC ${res.ac} - ${res.hit ? 'hit' : 'miss'}.`, { attacker: cid, target: t.id, hit: res.hit });
    if (res.hit && s.onHit) {
      addEffect(ctx, t, { name: s.name, conditions: s.onHit.conditions, escape: s.onHit.escape, rounds: s.onHit.rounds }, { sourceId: cid });
      event(ctx, 'condition', `${t.name} is ${s.onHit.conditions.join(', ')}.`);
    }
  }
  checkEncounterEnd(ctx);
}

export function useItem(ctx, cid, { item, target }) {
  const state = ctx.state;
  const c = requireCreature(state, cid);
  if (!isPC(c)) throw new RuleError('Only characters use items here.');
  const inv = c.inventory.find(i => i.id === item || i.key === item);
  if (!inv) throw new RuleError(`${c.name} has no such item.`);
  const def = itemDef(inv);
  if (!def?.use) throw new RuleError(`${def?.name ?? 'That item'} cannot be used that way.`);
  const combat = inCombat(state) && combatant(state, cid);
  let ts = null;
  if (combat) {
    ({ ts } = requireTurn(state, cid));
    // fast hands lets a thief use objects as a bonus action
    if (hasSub(c, 'rogue', 'thief', 3) && ts.action <= 0 && ts.bonus > 0) spendAction(ts, 'bonus', c);
    else spendAction(ts, 'action', c, `use ${def.name}`);
  }
  const consume = () => {
    if (def.uses !== undefined) {
      inv.usesLeft = (inv.usesLeft ?? def.uses) - 1;
      if (inv.usesLeft <= 0) {
        inv.qty -= 1;
        inv.usesLeft = def.uses;
      }
    } else inv.qty -= 1;
    if (inv.qty <= 0) c.inventory = c.inventory.filter(i => i !== inv);
  };
  const u = def.use;
  if (u.kind === 'heal') {
    const t = target ? requireCreature(state, target) : c;
    if (combat && t.id !== cid && cbDistance(state, cid, t.id) > 5) throw new RuleError(`${t.name} is out of reach.`);
    const r = roll(u.dice, ctx.rng);
    consume();
    applyHealing(ctx, t, r.total, `${def.name} ${r.detail}`);
  } else if (u.kind === 'stabilize') {
    const t = requireCreature(state, target ?? cid);
    if (combat && cbDistance(state, cid, t.id) > 5) throw new RuleError(`${t.name} is out of reach.`);
    if (t.dead) throw new RuleError(`${t.name} is beyond help.`);
    if (hasFeat(c, 'healer')) {
      consume();
      if (t.hp <= 0) {
        stabilize(ctx, t);
        applyHealing(ctx, t, 1, 'Healer');
      } else {
        if ((t.healerFeatUsedBy ?? []).includes(cid)) throw new RuleError(`${t.name} must finish a rest before benefiting from your Healer feat again.`);
        t.healerFeatUsedBy = [...(t.healerFeatUsedBy ?? []), cid];
        const r = roll('1d6', ctx.rng);
        applyHealing(ctx, t, r.total + 4 + (t.level ?? 1), `Healer ${r.detail} + 4 + ${t.level ?? 1}`);
      }
      return;
    }
    if (t.hp > 0) throw new RuleError(`${t.name} is not dying.`);
    consume();
    stabilize(ctx, t);
  } else if (u.kind === 'antitoxin') {
    consume();
    addEffect(ctx, c, { name: 'Antitoxin', advSaves: [], poisonAdvantage: true, minutes: 60 }, { sourceId: cid });
    event(ctx, 'action', `${c.name} drinks antitoxin.`);
  } else if (u.kind === 'effect') {
    consume();
    if (u.tempHp) grantTempHp(ctx, c, u.tempHp, def.name);
    addEffect(ctx, c, { ...u.effect }, { sourceId: cid });
    event(ctx, 'action', `${c.name} uses ${def.name}.`);
  } else if (u.kind === 'throw') {
    if (!combat) throw new RuleError('Throwing that is an attack: the DM must start combat first.', 'no_combat');
    const t = requireCreature(state, target);
    const d = cbDistance(state, cid, target);
    if (d > u.range[1]) throw new RuleError(`${t.name} is out of throwing range.`);
    consume();
    const res = rollAttack(ctx, c, t, { name: def.name, kind: 'ranged', toHit: mod(c, 'dex'), range: u.range, properties: [] }, {});
    event(ctx, 'attack', `${c.name} throws ${def.name} at ${t.name}: ${res.total} vs AC ${res.ac} - ${res.hit ? 'hit' : 'miss'}.`, { attacker: cid, target: t.id, hit: res.hit });
    if (res.hit) {
      if (u.onlyVs && !u.onlyVs.includes(creatureType(t))) event(ctx, 'info', `${def.name} has no effect on ${t.name}.`);
      else applyDamage(ctx, t, [{ amount: roll(u.damage, ctx.rng, { crit: res.crit }).total, type: u.damageType, magical: false }], { attacker: c, source: def.name });
    }
    ts.attackedHostile = true;
    checkEncounterEnd(ctx);
  } else throw new RuleError('Unsupported item.');
}

export { findProfile, attackProfiles, fmtMod, weaponDef };
