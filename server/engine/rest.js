import { cl } from './classlevel.js';
import { CLASSES } from './data/classes.js';
import { roll } from './dice.js';
import { mod } from './creature.js';
import { syncResources, computeMaxHp } from './character.js';
import { RuleError } from './util.js';
import { event, inCombat, nowMinute } from './state.js';
import { expireByClock } from './effects.js';

import { levelHistory } from './character.js';
import { hasFeat } from './feats.js';

// hit dice spent largest first across classes
function nextHitDice(c, n) {
  const dice = levelHistory(c).map(k => CLASSES[k].hitDie).sort((a, b) => b - a);
  return dice.slice(c.hitDiceUsed, c.hitDiceUsed + n);
}

const songDie = lvl => (lvl >= 17 ? '1d12' : lvl >= 13 ? '1d10' : lvl >= 9 ? '1d8' : '1d6');

export function shortRest(ctx, { hitDice = {}, arcaneRecovery = {}, naturalRecovery = {} } = {}) {
  const state = ctx.state;
  if (inCombat(state)) throw new RuleError('You cannot rest during combat.', 'in_combat');
  const chars = Object.values(state.characters).filter(c => !c.dead && !c.absent);
  // validate spending first
  for (const [id, n] of Object.entries(hitDice)) {
    const c = state.characters[id];
    if (!c) throw new RuleError(`Unknown character ${id}.`);
    const avail = c.level - c.hitDiceUsed;
    if (!Number.isInteger(n) || n < 0) throw new RuleError('Hit dice to spend must be a whole number.');
    if (n > avail) throw new RuleError(`${c.name} has only ${avail} hit dice left.`);
    if (c.hp <= 0) throw new RuleError(`${c.name} is unconscious and cannot spend hit dice.`);
  }
  for (const [id, slots] of Object.entries(arcaneRecovery)) validateRecovery(state.characters[id], slots, 'wizard', 'arcaneRecovery');
  for (const [id, slots] of Object.entries(naturalRecovery)) validateRecovery(state.characters[id], slots, 'druid', 'naturalRecovery');
  state.clock.minute = nowMinute(state) + 60;
  event(ctx, 'rest', 'The party takes a short rest (1 hour).');
  const bard = chars.find(c => cl(c, 'bard') >= 2 && c.hp > 0);
  for (const c of chars) {
    const n = hitDice[c.id] ?? 0;
    if (n > 0) {
      let gained = 0;
      const floor = hasFeat(c, 'durable') ? Math.max(2, 2 * mod(c, 'con')) : 0;
      for (const d of nextHitDice(c, n)) gained += Math.max(floor, roll(`1d${d}`, ctx.rng).total + mod(c, 'con'), 0);
      if (bard) gained += roll(songDie(cl(bard, 'bard')), ctx.rng).total;
      c.hitDiceUsed += n;
      const before = c.hp;
      c.hp = Math.min(c.maxHp, c.hp + gained);
      event(ctx, 'heal', `${c.name} spends ${n} hit ${n === 1 ? 'die' : 'dice'} and regains ${c.hp - before} hit points${bard ? ' (Song of Rest)' : ''}.`, { target: c.id });
    }
    for (const r of Object.values(c.resources ?? {})) if (r.recharge === 'short') r.used = 0;
    if (c.pactSlots) c.pactSlots.used = 0;
    if (cl(c, 'sorcerer') >= 20) c.resources.sorceryPoints.used = Math.max(0, c.resources.sorceryPoints.used - 4);
  }
  for (const [id, slots] of Object.entries(arcaneRecovery)) applyRecovery(ctx, state.characters[id], slots, 'arcaneRecovery', 'Arcane Recovery');
  for (const [id, slots] of Object.entries(naturalRecovery)) applyRecovery(ctx, state.characters[id], slots, 'naturalRecovery', 'Natural Recovery');
  expireByClock(ctx);
}

function validateRecovery(c, slots, cls, res) {
  if (!c || !cl(c, cls)) throw new RuleError(`Only ${cls}s can use that recovery feature.`);
  const r = c.resources?.[res];
  if (!r || r.used >= r.max) throw new RuleError(`${c.name} has already used it today.`);
  const total = Object.entries(slots).reduce((s, [lvl, n]) => s + Number(lvl) * n, 0);
  const cap = Math.ceil(cl(c, cls) / 2);
  if (total > cap) throw new RuleError(`${c.name} can recover slots totaling at most ${cap} levels.`);
  for (const [lvl, n] of Object.entries(slots)) {
    if (Number(lvl) >= 6) throw new RuleError('Recovered slots must be 5th level or lower.');
    const s = c.slots[lvl];
    if (!s || s.used < n) throw new RuleError(`${c.name} has not expended ${n} level ${lvl} slot(s).`);
  }
}

function applyRecovery(ctx, c, slots, res, label) {
  for (const [lvl, n] of Object.entries(slots)) c.slots[lvl].used -= n;
  c.resources[res].used += 1;
  event(ctx, 'rest', `${c.name} uses ${label} to recover ${Object.entries(slots).map(([l, n]) => `${n}x level ${l}`).join(', ')} slots.`);
}

export function canLongRest(state, c) {
  if (c.lastLongRestMinute === null || c.lastLongRestMinute === undefined) return true;
  return nowMinute(state) - c.lastLongRestMinute >= 24 * 60;
}

export function longRest(ctx) {
  const state = ctx.state;
  if (inCombat(state)) throw new RuleError('You cannot rest during combat.', 'in_combat');
  const chars = Object.values(state.characters).filter(c => !c.dead && !c.absent);
  const blocked = chars.filter(c => !canLongRest(state, c));
  if (blocked.length) {
    const wait = Math.ceil((24 * 60 - (nowMinute(state) - blocked[0].lastLongRestMinute)) / 60);
    throw new RuleError(`Only one long rest per 24 hours: ${blocked.map(c => c.name).join(', ')} rested too recently (${wait} more hours).`, 'too_soon');
  }
  const start = nowMinute(state);
  state.clock.minute = start + 8 * 60;
  event(ctx, 'rest', 'The party takes a long rest (8 hours).');
  for (const c of chars) {
    c.lastLongRestMinute = start;
    if (c.hp <= 0) {
      // must have at least 1 hp at the start to benefit
      event(ctx, 'info', `${c.name} is at 0 hit points and gains no benefit from the rest.`);
      continue;
    }
    c.tempHp = 0;
    c.deathSaves = { successes: 0, failures: 0 };
    c.stable = false;
    if (c.exhaustion > 0) c.exhaustion -= 1;
    c.maxHp = computeMaxHp(c);
    c.hp = c.maxHp;
    const regain = Math.max(1, Math.floor(c.level / 2));
    c.hitDiceUsed = Math.max(0, c.hitDiceUsed - regain);
    for (const r of Object.values(c.resources ?? {})) r.used = 0;
    for (const s of Object.values(c.slots ?? {})) s.used = 0;
    if (c.pactSlots) c.pactSlots.used = 0;
    c.relentlessRageDc = 10;
    c.preparationOpen = true;
    syncResources(c);
  }
  expireByClock(ctx);
}

export function advanceTime(ctx, minutes) {
  const state = ctx.state;
  if (inCombat(state)) throw new RuleError('Time is measured in rounds during combat.');
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 60 * 24 * 30) throw new RuleError('Time can advance between 0 minutes and 30 days.');
  state.clock.minute = nowMinute(state) + Math.round(minutes);
  expireByClock(ctx);
  event(ctx, 'time', `${formatDuration(minutes)} pass.`);
}

export function formatDuration(min) {
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`;
  if (min < 1440) return `${Math.round((min / 60) * 10) / 10} hours`;
  return `${Math.round((min / 1440) * 10) / 10} days`;
}

export function clockLabel(minute = 0) {
  const day = Math.floor(minute / 1440) + 1;
  const m = minute % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `Day ${day}, ${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
