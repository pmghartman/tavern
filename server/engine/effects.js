import { uid } from './util.js';
import { allCreatures, creatureById, event, nowMinute, inCombat } from './state.js';

export function addEffect(ctx, target, spec, meta = {}) {
  const state = ctx.state;
  const e = { id: uid('fx_'), ...spec, ...meta };
  if (spec.rounds && inCombat(state)) {
    e.expires = { cid: meta.expiresCid ?? meta.sourceId ?? target.id, phase: meta.phase ?? 'start', count: spec.rounds };
    if (spec.endsAt === 'casterStart') e.expires = { cid: meta.sourceId, phase: 'start', count: spec.rounds };
    if (spec.endsAt === 'casterEnd') e.expires = { cid: meta.sourceId, phase: 'end', count: spec.rounds };
    if (spec.endsAt === 'targetStart') e.expires = { cid: target.id, phase: 'start', count: spec.rounds };
    if (spec.endsAt === 'targetEnd') e.expires = { cid: target.id, phase: 'end', count: spec.rounds };
    if (spec.minutes) e.expiresAtMinute = nowMinute(state) + spec.minutes;
  } else if (spec.minutes || spec.rounds) {
    e.expiresAtMinute = nowMinute(state) + (spec.minutes ?? Math.max(1, Math.ceil(spec.rounds / 10)));
  }
  // same-named effects from the same source do not stack
  target.effects = (target.effects ?? []).filter(x => !(x.name === e.name && x.sourceId === e.sourceId));
  target.effects.push(e);
  if (e.tempHp) target.tempHp = Math.max(target.tempHp ?? 0, e.tempHp);
  if (e.maxHpBonus) {
    target.maxHp += e.maxHpBonus;
    target.hp += e.maxHpBonus;
  }
  return e;
}

export function removeEffect(ctx, target, effectId, reason) {
  const idx = (target.effects ?? []).findIndex(e => e.id === effectId);
  if (idx < 0) return null;
  const [e] = target.effects.splice(idx, 1);
  if (e.maxHpBonus) {
    target.maxHp -= e.maxHpBonus;
    target.hp = Math.min(target.hp, target.maxHp);
  }
  if (e.rage && e.frenzy && target.kind === 'pc') {
    target.exhaustion = Math.min(6, (target.exhaustion ?? 0) + 1);
    event(ctx, 'condition', `${target.name} gains a level of exhaustion from the frenzy.`);
  }
  if (e.lethargyOnEnd && ctx.state.encounter) {
    addEffect(ctx, target, { name: 'Lethargy', loseTurn: true, rounds: 1, endsAt: 'targetEnd' }, { sourceId: target.id });
    event(ctx, 'condition', `${target.name} is overcome by lethargy and loses their next turn.`);
  }
  if (e.wildShapeEnd) delete target.wildShape;
  if (reason !== 'silent') event(ctx, 'effect_end', `${e.name} ends on ${target.name}${reason ? ` (${reason})` : ''}.`, { target: target.id, effect: e.name });
  return e;
}

export function removeEffectsWhere(ctx, target, pred, reason) {
  for (const e of [...(target.effects ?? [])]) if (pred(e)) removeEffect(ctx, target, e.id, reason);
}

export function startConcentration(ctx, caster, spellKey, spellName) {
  if (caster.concentration) endConcentration(ctx, caster, `concentrating on ${spellName} instead`);
  caster.concentration = { spell: spellKey, name: spellName };
}

export function endConcentration(ctx, caster, reason) {
  const conc = caster.concentration;
  if (!conc) return;
  caster.concentration = null;
  event(ctx, 'concentration', `${caster.name} loses concentration on ${conc.name}${reason ? ` (${reason})` : ''}.`, { caster: caster.id });
  for (const c of allCreatures(ctx.state)) removeEffectsWhere(ctx, c, e => e.concentrationOf === caster.id && e.spell === conc.spell, 'silent');
  const enc = ctx.state.encounter;
  if (enc) enc.zones = (enc.zones ?? []).filter(z => !(z.concentrationOf === caster.id && z.spell === conc.spell));
}

// combat turn boundaries
export function tickEffects(ctx, cid, phase) {
  for (const c of allCreatures(ctx.state)) {
    for (const e of [...(c.effects ?? [])]) {
      if (e.expires && e.expires.cid === cid && e.expires.phase === phase) {
        e.expires.count -= 1;
        if (e.expires.count <= 0) removeEffect(ctx, c, e.id, 'duration');
      }
    }
  }
  const enc = ctx.state.encounter;
  if (enc?.zones) {
    for (const z of enc.zones) if (z.expires?.cid === cid && z.expires.phase === phase) z.expires.count -= 1;
    const gone = enc.zones.filter(z => z.expires && z.expires.count <= 0);
    enc.zones = enc.zones.filter(z => !(z.expires && z.expires.count <= 0));
    for (const z of gone) {
      const caster = creatureById(ctx.state, z.concentrationOf ?? z.casterId);
      if (caster?.concentration?.spell === z.spell) caster.concentration = null;
      event(ctx, 'effect_end', `${z.name} fades.`);
    }
  }
}

// out of combat clock based expiry
export function expireByClock(ctx) {
  const now = nowMinute(ctx.state);
  for (const c of allCreatures(ctx.state)) {
    for (const e of [...(c.effects ?? [])]) {
      if (e.expiresAtMinute !== undefined && e.expiresAtMinute <= now) {
        removeEffect(ctx, c, e.id, 'duration');
        if (c.concentration?.spell === e.spell && e.concentrationOf === c.id) c.concentration = null;
      }
    }
    if (c.concentration && !allCreatures(ctx.state).some(x => (x.effects ?? []).some(e => e.concentrationOf === c.id))) {
      c.concentration = null;
    }
  }
}

// when combat ends, round-only effects collapse to clock minutes
export function convertCombatDurations(ctx) {
  const now = nowMinute(ctx.state);
  for (const c of allCreatures(ctx.state)) {
    for (const e of [...(c.effects ?? [])]) {
      if (e.expires) {
        if (e.expiresAtMinute === undefined) {
          const minutes = Math.floor(e.expires.count / 10);
          if (minutes < 1) {
            removeEffect(ctx, c, e.id, 'combat over');
            continue;
          }
          e.expiresAtMinute = now + minutes;
        }
        delete e.expires;
      }
    }
  }
}
