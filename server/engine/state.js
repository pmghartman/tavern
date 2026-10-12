import { RuleError } from './util.js';

// a creature's id doubles as its combatant id
const own = (o, k) => (o && typeof k === 'string' && Object.hasOwn(o, k) ? o[k] : undefined);

export function creatureById(state, id) {
  return own(state.characters, id) ?? own(state.encounter?.combatants, id)?.creature ?? null;
}

export function combatant(state, id) {
  return own(state.encounter?.combatants, id) ?? null;
}

export function requireCreature(state, id) {
  const c = creatureById(state, id);
  if (!c) throw new RuleError(`No creature "${id}" here.`, 'not_found');
  return c;
}

export function requireCombatant(state, id) {
  const c = combatant(state, id);
  if (!c) throw new RuleError(`${creatureById(state, id)?.name ?? id} is not in this combat.`, 'not_found');
  return c;
}

export function allCreatures(state) {
  const out = new Map();
  for (const c of Object.values(state.characters ?? {})) out.set(c.id, c);
  for (const cb of Object.values(state.encounter?.combatants ?? {})) if (cb.creature) out.set(cb.id, cb.creature);
  return [...out.values()];
}

export function inCombat(state) {
  return state.encounter?.status === 'active';
}

export function currentCid(state) {
  const e = state.encounter;
  if (!e || e.status !== 'active') return null;
  return e.order[e.turn] ?? null;
}

export function sideOf(state, id) {
  const cb = combatant(state, id);
  if (cb) return cb.side;
  return state.characters?.[id] ? 'party' : 'neutral';
}

export const hostile = (state, a, b) => {
  const sa = sideOf(state, a);
  const sb = sideOf(state, b);
  return sa !== sb && sa !== 'neutral' && sb !== 'neutral';
};

export function event(ctx, type, text, data = {}) {
  const ev = { type, text, ...data };
  ctx.events.push(ev);
  return ev;
}

export function nowMinute(state) {
  return state.clock?.minute ?? 0;
}
