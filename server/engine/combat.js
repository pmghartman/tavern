import { hasFeat } from './feats.js';
import { cl, hasSub } from './classlevel.js';
import { MONSTERS } from './data/monsters.js';
import { CR_XP, crValue } from './data/core.js';
import { roll, averageOf } from './dice.js';
import { initiativeRoll, savingThrow, abilityCheck } from './checks.js';
import { speed, isPC, isIncapacitated, mod, activeEffects, isDown } from './creature.js';
import { footprint, distanceFt, findPath, squaresOf, inBounds, inArea, pointDistanceFt } from './grid.js';
import { RuleError, uid, clamp } from './util.js';
import { creatureById, combatant, requireCombatant, event, currentCid, hostile, allCreatures } from './state.js';
import { tickEffects, removeEffectsWhere, convertCombatDurations, removeEffect, addEffect, expireByClock } from './effects.js';
import { applyDamage, applyHealing, deathSave, grantTempHp, stabilize } from './damage.js';
import { roll as rollDice } from './dice.js';
import { XP_THRESHOLDS as XP_TABLE } from './data/core.js';

export function spawnMonster(key, { name, hpMode = 'average', rng, side = 'enemy' } = {}) {
  const b = MONSTERS[key];
  if (!b) throw new RuleError(`Unknown creature "${key}". Only SRD creatures, or ones the DM has defined, may appear.`, 'unknown_monster');
  const maxHp = hpMode === 'roll' ? Math.max(1, roll(b.hp, rng).total) : Math.max(1, Math.floor(averageOf(b.hp)));
  const m = {
    id: uid('mo_'), kind: 'monster', key, name: name ?? b.name, hp: maxHp, maxHp, tempHp: 0,
    conditions: [], effects: [], exhaustion: 0, recharge: {}, dead: false, side,
  };
  for (const s of b.special ?? []) if (s.recharge) m.recharge[s.key] = true;
  if (b.spellcasting) {
    m.slots = {};
    b.spellcasting.slots.forEach((n, i) => (m.slots[i + 1] = { max: n, used: 0 }));
  }
  return m;
}

export function newTurnState(c) {
  return {
    action: 1, bonus: 1, movement: speed(c), moved: 0, attacksLeft: 0, attackAction: false, multiattack: null,
    spellsCast: [], sneakUsed: false, freeInteraction: 1, loadingFired: false, once: {}, attackedHostile: false,
    surged: false, offhandReady: false, martialArtsReady: false, hasteAction: false, dashes: 0, disengaged: false,
  };
}

const placeOrder = [];
for (let r = 0; r < 40; r++) for (let x = 0; x <= r; x++) placeOrder.push([x, r - x]);

function freeSpotNear(enc, anchor, fp, avoid = new Set()) {
  for (const [dx, dy] of placeOrder) {
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const p = { x: anchor.x + dx * sx, y: anchor.y + dy * sy };
      if (!inBounds(enc.map, p, fp)) continue;
      if (squaresOf(p, fp).some(sq => avoid.has(`${sq.x},${sq.y}`) || occupiedBy(enc, sq))) continue;
      return p;
    }
  }
  throw new RuleError('No room on the map to place a creature.');
}

export function occupiedBy(enc, sq, exceptId = null) {
  for (const cb of Object.values(enc.combatants)) {
    if (cb.id === exceptId || cb.removed) continue;
    const cr = cb.creature ?? null;
    if (cr?.dead && !isPC(cr)) continue;
    const fp = cb.fp ?? 1;
    if (sq.x >= cb.pos.x && sq.x < cb.pos.x + fp && sq.y >= cb.pos.y && sq.y < cb.pos.y + fp) return cb;
  }
  return null;
}

export function startEncounter(ctx, spec) {
  const state = ctx.state;
  if (state.encounter?.status === 'active') throw new RuleError('A combat is already in progress.');
  const map = { width: clamp(spec.map?.width ?? 16, 6, 60), height: clamp(spec.map?.height ?? 12, 6, 60), cover: spec.map?.cover ?? [], difficult: spec.map?.difficult ?? [], light: spec.map?.light ?? state.scene?.light ?? 'bright' };
  const enc = { id: uid('enc_'), status: 'active', round: 1, turn: 0, order: [], combatants: {}, map, zones: [], defeated: [], fled: [], recoverable: [], startedAt: Date.now(), log: [] };
  state.encounter = enc;
  const pcs = Object.values(state.characters).filter(c => !c.dead && !c.absent && (spec.participants ? spec.participants.includes(c.id) : true));
  if (!pcs.length) throw new RuleError('No characters are able to fight.');
  const occupied = new Set();
  const partyAnchor = spec.partyAnchor ?? { x: 1, y: Math.floor(map.height / 2) - 1 };
  for (const c of pcs) {
    const want = spec.pcPositions?.[c.id];
    const fp = footprint(c);
    const pos = want && inBounds(map, want, fp) && !occupiedBy(enc, want) ? want : freeSpotNear(enc, partyAnchor, fp, occupied);
    enc.combatants[c.id] = { id: c.id, kind: 'pc', side: 'party', pos, fp, name: c.name };
    squaresOf(pos, fp).forEach(s => occupied.add(`${s.x},${s.y}`));
  }
  const enemyAnchor = spec.enemyAnchor ?? { x: map.width - 3, y: Math.floor(map.height / 2) - 1 };
  const counters = {};
  for (const group of spec.monsters ?? []) {
    const count = clamp(group.count ?? 1, 1, 20);
    for (let i = 0; i < count; i++) {
      const base = MONSTERS[group.key];
      if (!base) throw new RuleError(`Unknown creature "${group.key}". Only SRD creatures may appear.`, 'unknown_monster');
      counters[group.key] = (counters[group.key] ?? 0) + 1;
      const total = (spec.monsters ?? []).filter(g => g.key === group.key).reduce((s, g) => s + (g.count ?? 1), 0);
      const name = group.name ? (count > 1 ? `${group.name} ${i + 1}` : group.name) : total > 1 ? `${base.name} ${counters[group.key]}` : base.name;
      const side = group.side ?? 'enemy';
      const m = spawnMonster(group.key, { name, hpMode: spec.hpMode ?? 'average', rng: ctx.rng, side });
      const fp = footprint(m);
      const want = group.positions?.[i];
      const pos = want && inBounds(map, want, fp) && !occupiedBy(enc, want) ? want : freeSpotNear(enc, side === 'enemy' ? enemyAnchor : partyAnchor, fp, occupied);
      enc.combatants[m.id] = { id: m.id, kind: 'monster', side, pos, fp, name, creature: m };
      squaresOf(pos, fp).forEach(s => occupied.add(`${s.x},${s.y}`));
    }
  }
  if (!Object.values(enc.combatants).some(cb => cb.side === 'enemy')) throw new RuleError('A combat needs at least one hostile creature.');
  // initiative
  const rolls = [];
  for (const cb of Object.values(enc.combatants)) {
    const c = creatureById(state, cb.id);
    const r = initiativeRoll(c, ctx.rng);
    cb.initiative = r.total;
    cb.initDex = mod(c, 'dex');
    cb.tiebreak = ctx.rng.float();
    cb.reaction = true;
    cb.surprised = !hasFeat(c, 'alert') && ((cb.side === 'party' && spec.surprise?.party) || (cb.side === 'enemy' && spec.surprise?.enemies) || false);
    rolls.push(`${c.name} ${r.total}`);
    if (cl(c, 'bard') >= 20 && c.resources?.bardicInspiration?.used >= c.resources.bardicInspiration.max) c.resources.bardicInspiration.used -= 1;
  }
  enc.order = Object.values(enc.combatants).sort((a, b) => b.initiative - a.initiative || b.initDex - a.initDex || b.tiebreak - a.tiebreak).map(cb => cb.id);
  event(ctx, 'combat_start', `Combat begins! Initiative: ${enc.order.map(id => `${enc.combatants[id].name} (${enc.combatants[id].initiative})`).join(', ')}.`, { order: enc.order });
  startTurn(ctx);
  return enc;
}

export function addToEncounter(ctx, { key, name, side = 'enemy', pos, count = 1 }) {
  const enc = ctx.state.encounter;
  if (!enc || enc.status !== 'active') throw new RuleError('No combat in progress.');
  const added = [];
  for (let i = 0; i < clamp(count, 1, 10); i++) {
    const m = spawnMonster(key, { name: name ? (count > 1 ? `${name} ${i + 1}` : name) : undefined, rng: ctx.rng, side });
    const fp = footprint(m);
    const p = pos && i === 0 && inBounds(enc.map, pos, fp) && !occupiedBy(enc, pos) ? pos : freeSpotNear(enc, pos ?? { x: enc.map.width - 2, y: 1 }, fp);
    const r = initiativeRoll(m, ctx.rng);
    enc.combatants[m.id] = { id: m.id, kind: 'monster', side, pos: p, fp, name: m.name, creature: m, initiative: r.total, initDex: mod(m, 'dex'), tiebreak: ctx.rng.float(), reaction: true };
    // insert by initiative, never before the current turn index shift issues
    const cur = enc.order[enc.turn];
    enc.order.push(m.id);
    enc.order.sort((a, b) => enc.combatants[b].initiative - enc.combatants[a].initiative || enc.combatants[b].initDex - enc.combatants[a].initDex);
    enc.turn = enc.order.indexOf(cur);
    added.push(m);
    event(ctx, 'info', `${m.name} joins the fight (initiative ${r.total}).`);
  }
  return added;
}

export function auraBonusFor(state, target) {
  let best = 0;
  const tcb = combatant(state, target.id);
  for (const c of allCreatures(state)) {
    if (!isPC(c) || cl(c, 'paladin') < 6 || isDown(c) || isIncapacitated(c)) continue;
    const pcb = combatant(state, c.id);
    const range = cl(c, 'paladin') >= 18 ? 30 : 10;
    if (tcb && pcb) {
      if (pcb.side !== tcb.side) continue;
      if (distanceFt(pcb.pos, pcb.fp, tcb.pos, tcb.fp) > range) continue;
    } else if (!state.characters[target.id]) continue;
    best = Math.max(best, Math.max(1, mod(c, 'cha')));
  }
  return best;
}

export function cbDistance(state, a, b) {
  const ca = combatant(state, a);
  const cb = combatant(state, b);
  if (!ca || !cb) return Infinity;
  return distanceFt(ca.pos, ca.fp, cb.pos, cb.fp);
}

export function livingCombatants(state, filter = () => true) {
  const enc = state.encounter;
  return Object.values(enc?.combatants ?? {}).filter(cb => !cb.removed && !creatureById(state, cb.id).dead && filter(cb));
}

function zoneAffects(state, zone, cid) {
  const cb = combatant(state, cid);
  if (!cb || cb.removed) return false;
  if (zone.enemiesOnly && !hostile(state, zone.casterId, cid)) return false;
  if (zone.attachedTo) {
    const anchor = combatant(state, zone.attachedTo);
    if (!anchor || zone.attachedTo === cid) return false;
    return distanceFt(anchor.pos, anchor.fp, cb.pos, cb.fp) <= zone.radius;
  }
  return inArea(zone.area, cb.pos, cb.fp);
}

export function zonesAffecting(state, cid) {
  return (state.encounter?.zones ?? []).filter(z => zoneAffects(state, z, cid));
}

export function triggerZone(ctx, zone, cid, why) {
  const state = ctx.state;
  const target = creatureById(state, cid);
  if (!target || target.dead) return;
  zone.triggered = zone.triggered ?? {};
  const key = `${state.encounter.round}:${cid}`;
  if (zone.triggered[key]) return;
  zone.triggered[key] = true;
  const caster = creatureById(state, zone.casterId);
  if (zone.damage) {
    if (zone.pool !== undefined && zone.pool <= 0) return;
    const sv = zone.save ? savingThrow(target, zone.save, { dc: zone.dc, rng: ctx.rng, magical: true, auraBonus: auraBonusFor(state, target) }) : null;
    if (sv) ctx.events.push({ type: 'save', text: `${target.name} ${zone.name} ${sv.label}: ${sv.total ?? '-'} vs DC ${zone.dc} - ${sv.success ? 'success' : 'failure'}`, roll: sv });
    const r = rollDice(zone.damage.dice, ctx.rng);
    let amt = r.total;
    if (sv?.success) amt = zone.halfOnSave ? Math.floor(amt / 2) : 0;
    if (zone.pool !== undefined) {
      amt = Math.min(amt, zone.pool);
      zone.pool -= amt;
    }
    if (amt > 0) applyDamage(ctx, target, [{ amount: amt, type: zone.damage.type, magical: true }], { attacker: caster, source: zone.name, auraBonusFor: t => auraBonusFor(state, t) });
    else event(ctx, 'info', `${target.name} avoids the ${zone.name} (${why}).`);
  } else if (zone.onFailZone) {
    const sv = savingThrow(target, zone.save, { dc: zone.dc, rng: ctx.rng, magical: true, against: 'poison', auraBonus: auraBonusFor(state, target) });
    ctx.events.push({ type: 'save', text: `${target.name} ${zone.name} ${sv.label}: ${sv.total ?? '-'} vs DC ${zone.dc} - ${sv.success ? 'success' : 'failure'}`, roll: sv });
    if (!sv.success) {
      const t = combatant(state, cid);
      if (t?.turnState && currentCid(state) === cid) t.turnState.action = 0;
      else addEffect(ctx, target, { name: zone.onFailZone.name, loseAction: true, rounds: 1, endsAt: 'targetEnd' }, { sourceId: zone.casterId });
      event(ctx, 'condition', `${target.name} is ${zone.onFailZone.name.toLowerCase()} and loses their action.`);
    }
  }
}

export function startTurn(ctx) {
  const state = ctx.state;
  const enc = state.encounter;
  const cid = enc.order[enc.turn];
  const cb = enc.combatants[cid];
  const c = creatureById(state, cid);
  cb.reaction = true;
  cb.turnState = newTurnState(c);
  delete cb.dodging;
  c.tookDamageThisRound = false;
  event(ctx, 'turn', `Round ${enc.round}: ${c.name}'s turn.`, { cid, round: enc.round });
  tickEffects(ctx, cid, 'start');
  // recharge abilities
  if (!isPC(c) && c.recharge) {
    for (const s of MONSTERS[c.key].special ?? []) {
      if (s.recharge && !c.recharge[s.key]) {
        const r = ctx.rng.int(1, 6);
        if (r >= s.recharge) {
          c.recharge[s.key] = true;
          event(ctx, 'info', `${c.name}'s ${s.name} recharges (${r}).`);
        }
      }
    }
  }
  // regeneration
  const regen = !isPC(c) && MONSTERS[c.key].regeneration;
  if (regen && !c.dead && c.hp > 0) {
    if ((c.damageTakenTypes ?? []).some(t => regen.stoppedBy.includes(t))) event(ctx, 'info', `${c.name} does not regenerate this turn.`);
    else if (c.hp < c.maxHp) applyHealing(ctx, c, regen.amount, 'regeneration');
  }
  if (!isPC(c)) c.damageTakenTypes = [];
  // fighter survivor
  if (isPC(c) && hasSub(c, 'fighter', 'champion', 18) && c.hp > 0 && c.hp < c.maxHp / 2) applyHealing(ctx, c, 5 + mod(c, 'con'), 'Survivor');
  // heroism
  for (const e of activeEffects(c)) if (e.tempHpEachTurn) grantTempHp(ctx, c, e.tempHpEachTurn, e.name);
  // ongoing damage: burning, acid, thorny vines
  for (const e of activeEffects(c).filter(x => x.dot)) {
    if (c.dead || c.hp <= 0) break;
    applyDamage(ctx, c, [{ amount: roll(e.dot.dice, ctx.rng).total, type: e.dot.type, magical: true }], { source: e.name });
  }
  // auras and zones at start of turn
  for (const z of zonesAffecting(state, cid)) triggerZone(ctx, z, cid, 'start of turn');
  if (c.dead) return advanceAfterSkip(ctx, cid, 'dead');
  // a dying character's turn is its death saving throw, which its player rolls
  if (isPC(c) && c.hp <= 0) {
    if (c.stable) return advanceAfterSkip(ctx, cid, 'unconscious, stable');
    Object.assign(cb.turnState, { action: 0, bonus: 0, movement: 0, deathSavePending: true });
    event(ctx, 'dying', `${c.name} is dying (${c.deathSaves.successes}/3 successes, ${c.deathSaves.failures}/3 failures) and must roll a death saving throw.`, { cid });
    return null;
  }
  if (cb.surprised && enc.round === 1) {
    cb.surprised = false;
    return advanceAfterSkip(ctx, cid, 'surprised');
  }
  if (activeEffects(c).some(e => e.loseTurn)) {
    removeEffectsWhere(ctx, c, e => e.loseTurn && e.consumeOnTurn !== false, 'silent');
    return advanceAfterSkip(ctx, cid, 'loses the turn');
  }
  if (activeEffects(c).some(e => e.banished)) return advanceAfterSkip(ctx, cid, 'banished');
  if (activeEffects(c).some(e => e.loseAction)) cb.turnState.action = 0;
  if (isIncapacitated(c) && speed(c) === 0) return advanceAfterSkip(ctx, cid, 'incapacitated');
  if (isIncapacitated(c)) {
    cb.turnState.action = 0;
    cb.turnState.bonus = 0;
  }
  if (activeEffects(c).some(e => e.extraAction)) cb.turnState.hasteAction = true;
  return null;
}

function advanceAfterSkip(ctx, cid, why) {
  if (why) event(ctx, 'info', `${creatureById(ctx.state, cid).name} cannot act (${why}).`);
  return endTurn(ctx, cid, { auto: true });
}

// the dying character's player rolls; a natural 20 wakes them with the rest of the turn to use
export function rollDeathSave(ctx, cid) {
  const { cb, ts, c } = requireTurn(ctx.state, cid);
  if (!ts?.deathSavePending) throw new RuleError(c.hp > 0 ? `${c.name} is not dying.` : `${c.name} has already rolled this turn.`, 'no_death_save');
  ts.deathSavePending = false;
  deathSave(ctx, c);
  if (c.dead || c.hp <= 0) return endTurn(ctx, cid, { auto: true });
  cb.turnState = { ...newTurnState(c), once: ts.once };
  event(ctx, 'info', `${c.name} is conscious again, lying prone, and can act this turn.`);
  return null;
}

export function endTurn(ctx, cid, { auto = false } = {}) {
  const state = ctx.state;
  const enc = state.encounter;
  if (!enc || enc.status !== 'active') throw new RuleError('No combat in progress.');
  if (enc.order[enc.turn] !== cid) throw new RuleError(`It is not ${creatureById(state, cid)?.name ?? cid}'s turn.`, 'not_your_turn');
  const c = creatureById(state, cid);
  const cb = enc.combatants[cid];
  // a dying character's turn never passes without its death save
  if (cb.turnState?.deathSavePending && !c.dead && c.hp <= 0) {
    cb.turnState.deathSavePending = false;
    deathSave(ctx, c);
    if (c.hp > 0) event(ctx, 'info', `${c.name} wakes as the turn ends.`);
  }
  // rage upkeep
  const rage = activeEffects(c).find(e => e.rage);
  if (rage && !cb.turnState?.attackedHostile && !c.tookDamageThisRound && !(cl(c, 'barbarian') >= 15) && !auto) {
    removeEffect(ctx, c, rage.id, 'no attack or damage this turn');
  }
  // save-ends effects
  for (const e of [...(c.effects ?? [])]) {
    if (e.saveEnds && !c.dead) {
      const caster = creatureById(state, e.sourceId);
      const sv = savingThrow(c, e.saveEnds, { dc: e.dc, rng: ctx.rng, magical: !!e.spell, auraBonus: auraBonusFor(state, c) });
      ctx.events.push({ type: 'save', text: `${c.name} repeats the save against ${e.name}: ${sv.total ?? '-'} vs DC ${e.dc} - ${sv.success ? 'ends' : 'continues'}`, roll: sv });
      if (sv.success) {
        removeEffect(ctx, c, e.id, 'saved');
        if (caster?.concentration?.spell === e.spell && !allCreatures(state).some(x => (x.effects ?? []).some(f => f.concentrationOf === caster.id && f.spell === e.spell))) {
          caster.concentration = null;
        }
      }
    }
  }
  tickEffects(ctx, cid, 'end');
  if (!auto) event(ctx, 'turn_end', `${c.name} ends their turn.`, { cid });
  if (checkEncounterEnd(ctx)) return null;
  // next living combatant
  for (let guard = 0; guard < enc.order.length * 2 + 2; guard++) {
    enc.turn += 1;
    if (enc.turn >= enc.order.length) {
      enc.turn = 0;
      enc.round += 1;
      // six seconds a round; the clock shows each minute as it passes
      if (state.clock) {
        state.clock.seconds = (state.clock.seconds ?? 0) + 6;
        if (state.clock.seconds >= 60) {
          state.clock.seconds -= 60;
          state.clock.minute = (state.clock.minute ?? 0) + 1;
        }
      }
    }
    const next = enc.order[enc.turn];
    const ncb = enc.combatants[next];
    const nc = creatureById(state, next);
    if (ncb.removed) continue;
    if (!isPC(nc) && nc.dead) continue;
    if (isPC(nc) && nc.dead) continue;
    break;
  }
  return startTurn(ctx);
}

export const isDying = c => !!c && isPC(c) && !c.dead && c.hp <= 0 && !c.stable;

// no one in the party is standing but someone still lives, and the DM has yet to rule whether
// the foes finish them (the rules as written) or take them captive (when the book has them do so)
export function knockoutPending(state) {
  const enc = state.encounter;
  if (enc?.status !== 'active' || enc.downedPolicy !== 'ask') return false;
  if (!livingCombatants(state, cb => cb.kind === 'pc').length) return false;
  const standing = livingCombatants(state, cb => cb.side === 'party' && creatureById(state, cb.id).hp > 0);
  const foes = livingCombatants(state, cb => cb.side === 'enemy' && !isDown(creatureById(state, cb.id)));
  return !standing.length && foes.length > 0;
}

// the foes spare the fallen: the dying are stabilized, the fight ends, and after 1d4 hours
// each stable character regains 1 hit point and wakes, in the captors' hands
export function captureParty(ctx, { reason = '' } = {}) {
  const state = ctx.state;
  if (!knockoutPending(state)) throw new RuleError('Only a party with no one left standing can be taken captive.');
  const enc = state.encounter;
  const captors = livingCombatants(state, cb => cb.side === 'enemy' && !isDown(creatureById(state, cb.id))).map(cb => cb.name);
  const fallen = livingCombatants(state, cb => cb.kind === 'pc').map(cb => creatureById(state, cb.id));
  event(ctx, 'info', `${captors.join(', ')} stop short of killing the fallen and take them captive${reason ? ` (${reason})` : ''}.`);
  for (const c of fallen) if (c.hp <= 0 && !c.stable) stabilize(ctx, c);
  enc.captors = captors;
  endEncounter(ctx, 'captured');
  const hours = ctx.rng.int(1, 4);
  if (state.clock) {
    state.clock.minute = (state.clock.minute ?? 0) + hours * 60;
    expireByClock(ctx);
  }
  for (const c of fallen) {
    if (c.dead || c.hp > 0) continue;
    c.hp = 1;
    c.stable = false;
    c.deathSaves = { successes: 0, failures: 0 };
    c.conditions = (c.conditions ?? []).filter(x => (x.name ?? x) !== 'unconscious');
    event(ctx, 'heal', `${hours} hour${hours > 1 ? 's' : ''} later, ${c.name} comes to with 1 hit point.`, { target: c.id });
  }
  Object.assign(state.lastEncounter, { captors, hours, reason });
}

// the DM ruled the rules as written: the foes may finish the fallen
export function fightOn(ctx) {
  const enc = ctx.state.encounter;
  if (enc?.status === 'active') enc.downedPolicy = 'finish';
}

export function checkEncounterEnd(ctx) {
  const state = ctx.state;
  const enc = state.encounter;
  if (!enc || enc.status !== 'active') return true;
  const enemies = livingCombatants(state, cb => cb.side === 'enemy' && !isDown(creatureById(state, cb.id)) && !creatureById(state, cb.id).knockedOut);
  const party = livingCombatants(state, cb => cb.side === 'party' && creatureById(state, cb.id).hp > 0);
  // the whole party down: the DM rules first whether the foes take them captive
  if (!party.length && knockoutPending(state)) return false;
  // a dying character keeps rolling death saves in initiative until stable, healed or dead
  const dying =livingCombatants(state, cb => cb.kind === 'pc' && isDying(creatureById(state, cb.id)));
  if (dying.length && (!enemies.length || !party.length)) {
    const note = `${enemies.length ? 'n' : 'e'}:${dying.map(cb => cb.id).join(',')}`;
    if (enc.dyingNote !== note) {
      enc.dyingNote = note;
      const names = dying.map(cb => cb.name).join(' and ');
      event(ctx, 'info', enemies.length ? `No one in the party is left standing; ${names} ${dying.length > 1 ? 'are' : 'is'} dying. The fight goes on.` : `No foes remain, but ${names} ${dying.length > 1 ? 'are' : 'is'} still dying. Stabilize or heal them, or they keep rolling death saves.`);
    }
    return false;
  }
  if (!enemies.length) {
    endEncounter(ctx, 'victory');
    return true;
  }
  if (!party.length) {
    const anyAlive = Object.values(state.characters).some(c => !c.dead);
    endEncounter(ctx, anyAlive ? 'defeat' : 'tpk');
    return true;
  }
  return false;
}

export function endEncounter(ctx, outcome = 'ended') {
  const state = ctx.state;
  const enc = state.encounter;
  if (!enc || enc.status !== 'active') throw new RuleError('No combat in progress.');
  enc.status = 'ended';
  enc.outcome = outcome;
  enc.endedAt = Date.now();
  // xp for defeated enemies split among surviving participants
  const defeated = [...new Set(enc.defeated)].map(id => enc.combatants[id]).filter(cb => cb && cb.side === 'enemy');
  const xp = defeated.reduce((s, cb) => s + (CR_XP[MONSTERS[cb.creature.key].cr] ?? 0), 0);
  const recipients = Object.values(enc.combatants).filter(cb => cb.side === 'party' && cb.kind === 'pc' && !state.characters[cb.id]?.dead).map(cb => state.characters[cb.id]);
  enc.xpAwarded = 0;
  if (xp > 0 && recipients.length && state.campaign?.settings?.leveling !== 'milestone') {
    const each = Math.floor(xp / recipients.length);
    for (const r of recipients) {
      r.xp += each;
      r.pendingLevelUp = r.level < 20 && r.xp >= (XP_TABLE[r.level] ?? Infinity);
    }
    enc.xpAwarded = each;
    event(ctx, 'xp', `Each surviving character earns ${each} XP (${xp} total).`, { each, total: xp });
  }
  // half of spent ammunition is recoverable
  for (const rec of enc.recoverable ?? []) {
    const ch = state.characters[rec.charId];
    if (!ch || ch.dead) continue;
    const back = rec.thrown ? rec.qty : Math.floor(rec.qty / 2);
    if (back <= 0) continue;
    const inv = ch.inventory.find(i => i.key === rec.key && !i.custom);
    if (inv) inv.qty += back;
    else ch.inventory.push({ id: uid('it_'), key: rec.key, qty: back });
    event(ctx, 'loot', `${ch.name} recovers ${back} ${rec.name}.`);
  }
  for (const c of Object.values(state.characters)) {
    c.conditions = (c.conditions ?? []).filter(x => !['grappled', 'restrained', 'prone'].includes(x.name ?? x) || (x.name ?? x) === 'unconscious');
  }
  // the rounds already ticked the clock; catching breath takes a minute more
  if (state.clock) state.clock.minute = (state.clock.minute ?? 0) + 1;
  convertCombatDurations(ctx);
  event(ctx, 'combat_end', `Combat ends (${outcome}) after ${enc.round} round${enc.round === 1 ? '' : 's'}.`, { outcome });
  state.lastEncounter = { id: enc.id, outcome, round: enc.round, xp: enc.xpAwarded, defeated: defeated.map(cb => cb.name) };
}


export function requireTurn(state, cid) {
  const enc = state.encounter;
  if (!enc || enc.status !== 'active') throw new RuleError('There is no combat in progress.', 'no_combat');
  const cur = enc.order[enc.turn];
  if (cur !== cid) throw new RuleError(`It is ${creatureById(state, cur)?.name}'s turn, not ${creatureById(state, cid)?.name ?? cid}'s.`, 'not_your_turn');
  const cb = enc.combatants[cid];
  return { enc, cb, ts: cb.turnState, c: creatureById(state, cid) };
}

export function spendAction(ts, kind, c, label) {
  if (kind === 'action') {
    if (ts.action > 0) ts.action -= 1;
    else if (ts.hasteAction) ts.hasteAction = false;
    else throw new RuleError(`${c.name} has already used their action this turn${label ? ` (cannot ${label})` : ''}.`, 'no_action');
  } else if (kind === 'bonus') {
    if (ts.bonus <= 0) throw new RuleError(`${c.name} has already used their bonus action this turn.`, 'no_bonus');
    ts.bonus -= 1;
  } else if (kind === 'reaction') {
    // caller manages reaction on combatant
  }
}

export function hasActionAvailable(ts) {
  return ts.action > 0 || ts.hasteAction;
}

// movement with opportunity attacks; returns the final position
export function moveCombatant(ctx, cid, to, { teleport = false, free = false, forced = false, oaHandler = null } = {}) {
  const state = ctx.state;
  const enc = state.encounter;
  const cb = requireCombatant(state, cid);
  const c = creatureById(state, cid);
  if (!Number.isInteger(to?.x) || !Number.isInteger(to?.y)) throw new RuleError('Movement needs whole-square coordinates.');
  if (!inBounds(enc.map, to, cb.fp)) throw new RuleError(`(${to.x}, ${to.y}) is off the battle map (${enc.map.width}x${enc.map.height}).`);
  if (squaresOf(to, cb.fp).some(sq => occupiedBy(enc, sq, cid))) throw new RuleError(`That space is occupied.`);
  if (teleport || forced) {
    cb.pos = { ...to };
    afterMoveZones(ctx, cid);
    return cb.pos;
  }
  // booming blade: moving on purpose sets it off
  const boom = activeEffects(c).find(e => e.moveDamage);
  if (boom) {
    removeEffect(ctx, c, boom.id, 'silent');
    event(ctx, 'info', `${boom.name} erupts as ${c.name} moves.`);
    applyDamage(ctx, c, [{ amount: roll(boom.moveDamage.dice, ctx.rng).total, type: boom.moveDamage.type, magical: true }], { source: boom.name });
    if (c.dead || c.hp <= 0) return cb.pos;
  }
  const ts = cb.turnState;
  if (!free) {
    if (enc.order[enc.turn] !== cid) throw new RuleError(`${c.name} can only move on their own turn.`, 'not_your_turn');
    if (speed(c) === 0) throw new RuleError(`${c.name} cannot move (speed 0).`);
  }
  // standing from prone costs half speed
  const prone = (c.conditions ?? []).find(x => (x.name ?? x) === 'prone');
  if (prone && !free) {
    const cost = hasFeat(c, 'athlete') ? 5 : Math.floor(speed(c) / 2);
    if (ts.movement - ts.moved < cost) throw new RuleError(`${c.name} needs ${cost} ft of movement to stand up.`);
    ts.moved += cost;
    c.conditions = c.conditions.filter(x => x !== prone);
    event(ctx, 'move', `${c.name} stands up.`);
  }
  const frightSources = activeEffects(c).filter(e => e.conditions?.includes('frightened')).map(e => e.sourceId).filter(Boolean);
  const difficult = new Set((enc.map.difficult ?? []).map(([x, y]) => `${x},${y}`));
  const budget = free ? Infinity : ts.movement - ts.moved;
  const isHostileSq = sq => {
    const o = occupiedBy(enc, sq, cid);
    if (!o) return false;
    const oc = creatureById(state, o.id);
    if (oc.dead || oc.hp <= 0) return false;
    return hostile(state, cid, o.id);
  };
  const result = findPath(enc.map, cb.pos, to, cb.fp, {
    blocked: isHostileSq,
    canEndAt: p => !squaresOf(p, cb.fp).some(sq => occupiedBy(enc, sq, cid)),
    maxCost: budget,
    costOf: p => (squaresOf(p, cb.fp).some(sq => difficult.has(`${sq.x},${sq.y}`)) && !(isPC(c) && (hasSub(c, 'druid', 'land', 6) || cl(c, 'ranger') >= 8)) ? 10 : 5),
  });
  if (!result) {
    const straight = pointDistanceFt(cb.pos, to);
    throw new RuleError(`${c.name} cannot reach (${to.x}, ${to.y}): ${straight} ft away with ${budget} ft of movement left, or the way is blocked.`, 'too_far');
  }
  // walk the path step by step for opportunity attacks and fear
  for (let i = 1; i < result.path.length; i++) {
    const from = result.path[i - 1];
    const step = result.path[i];
    for (const src of frightSources) {
      const scb = combatant(state, src);
      if (scb && distanceFt(step, cb.fp, scb.pos, scb.fp) < distanceFt(from, cb.fp, scb.pos, scb.fp)) {
        throw new RuleError(`${c.name} is frightened and cannot move closer to ${scb.name}.`);
      }
    }
    if (oaHandler) {
      for (const other of livingCombatants(state, o => o.id !== cid && hostile(state, cid, o.id))) {
        if (ts?.disengaged && !oaHandler.ignoresDisengage?.(other.id)) continue;
        if (oaHandler.exempt?.(other.id, cid)) continue;
        const reach = oaHandler.reachOf(other.id);
        if (!reach) continue;
        const before = distanceFt(from, cb.fp, other.pos, other.fp);
        const after = distanceFt(step, cb.fp, other.pos, other.fp);
        if (before <= reach && after > reach) {
          cb.pos = { ...from };
          oaHandler.trigger(other.id, cid);
          if (c.dead || c.hp <= 0 || speed(c) === 0) {
            if (!free) ts.moved += movedCost(result.path.slice(0, i), difficult);
            event(ctx, 'move', `${c.name}'s movement is stopped at (${from.x}, ${from.y}).`);
            return cb.pos;
          }
        }
      }
    }
    cb.pos = { ...step };
    afterMoveZones(ctx, cid);
    if (c.dead || c.hp <= 0) break;
  }
  if (!free) ts.moved += result.cost;
  event(ctx, 'move', `${c.name} moves to (${cb.pos.x}, ${cb.pos.y})${free ? '' : ` [${result.cost} ft, ${Math.max(0, ts.movement - ts.moved)} ft left]`}.`, { cid, pos: cb.pos });
  // grapples break if the grappler leaves reach
  for (const other of Object.values(enc.combatants)) {
    const oc = creatureById(state, other.id);
    for (const e of [...(oc.effects ?? [])]) {
      if (e.grappledBy === cid && distanceFt(cb.pos, cb.fp, other.pos, other.fp) > 5) removeEffect(ctx, oc, e.id, 'grappler moved away');
    }
  }
  const myGrapple = activeEffects(c).find(e => e.grappledBy);
  if (myGrapple) removeEffect(ctx, c, myGrapple.id, 'moved');
  return cb.pos;
}

function movedCost(path, difficult) {
  return (path.length - 1) * 5 + path.slice(1).filter(p => difficult.has(`${p.x},${p.y}`)).length * 5;
}

function afterMoveZones(ctx, cid) {
  for (const z of zonesAffecting(ctx.state, cid)) if (z.onEnter !== false) triggerZone(ctx, z, cid, 'entered');
}

export function pushAway(ctx, fromCid, targetCid, feet) {
  const state = ctx.state;
  const src = combatant(state, fromCid);
  const t = combatant(state, targetCid);
  if (!src || !t) return;
  const dx = Math.sign(t.pos.x - src.pos.x);
  const dy = Math.sign(t.pos.y - src.pos.y);
  let pos = { ...t.pos };
  for (let i = 0; i < feet / 5; i++) {
    const nx = { x: pos.x + (dx || 0), y: pos.y + (dy || (dx ? 0 : 1)) };
    if (!inBounds(state.encounter.map, nx, t.fp) || squaresOf(nx, t.fp).some(sq => occupiedBy(state.encounter, sq, targetCid))) break;
    pos = nx;
  }
  if (pos.x !== t.pos.x || pos.y !== t.pos.y) {
    t.pos = pos;
    event(ctx, 'move', `${t.name} is pushed to (${pos.x}, ${pos.y}).`, { cid: targetCid, pos });
    afterMoveZones(ctx, targetCid);
  }
}

// drag a creature up to feet toward another (thorn whip, lightning lure)
export function pullToward(ctx, toCid, targetCid, feet) {
  const state = ctx.state;
  const dst = combatant(state, toCid);
  const t = combatant(state, targetCid);
  if (!dst || !t) return;
  let pos = { ...t.pos };
  for (let i = 0; i < feet / 5; i++) {
    if (distanceFt(pos, t.fp, dst.pos, dst.fp) <= 5) break;
    const nx = { x: pos.x + Math.sign(dst.pos.x - pos.x), y: pos.y + Math.sign(dst.pos.y - pos.y) };
    if (!inBounds(state.encounter.map, nx, t.fp) || squaresOf(nx, t.fp).some(sq => occupiedBy(state.encounter, sq, targetCid))) break;
    pos = nx;
  }
  if (pos.x !== t.pos.x || pos.y !== t.pos.y) {
    t.pos = pos;
    event(ctx, 'move', `${t.name} is pulled to (${pos.x}, ${pos.y}).`, { cid: targetCid, pos });
    afterMoveZones(ctx, targetCid);
  }
}

export function knockProne(ctx, c, source) {
  if ((c.conditions ?? []).some(x => (x.name ?? x) === 'prone')) return;
  (c.conditions ??= []).push({ name: 'prone', source });
  event(ctx, 'condition', `${c.name} is knocked prone.`);
}

export function removeFromCombat(ctx, cid, reason = 'leaves the battle') {
  const enc = ctx.state.encounter;
  const cb = requireCombatant(ctx.state, cid);
  cb.removed = true;
  enc.fled.push(cid);
  event(ctx, 'info', `${cb.name} ${reason}.`);
  checkEncounterEnd(ctx);
}

export { abilityCheck, crValue };
