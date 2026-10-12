import { hasFeat } from './feats.js';
import { armorDef, equipped } from './character.js';
import { cl, hasSub } from './classlevel.js';
import { defenses, isPC, hasTrait, activeEffects, mod } from './creature.js';
import { savingThrow } from './checks.js';
import { rollD20 } from './dice.js';
import { event, combatant, creatureById } from './state.js';
import { endConcentration, removeEffectsWhere, addEffect } from './effects.js';
import { MONSTERS } from './data/monsters.js';

export function adjustForDefenses(target, parts) {
  const d = defenses(target);
  const out = [];
  // Heavy Armor Master soaks 3 nonmagical physical damage per hit
  const ham = isPC(target) && hasFeat(target, 'heavyArmorMaster') && armorDef(equipped(target, 'armor'))?.category === 'heavy';
  for (const p of parts) {
    let amt = Math.max(0, Math.floor(p.amount));
    if (ham && !p.magical && ['bludgeoning', 'piercing', 'slashing'].includes(p.type) && p.label !== 'hazard') amt = Math.max(0, amt - 3);
    const type = p.type;
    const nonmagicalPhysical = ['bludgeoning', 'piercing', 'slashing'].includes(type);
    let note = '';
    if (d.immune.includes(type)) {
      amt = 0;
      note = 'immune';
    } else {
      let resisted = d.resist.includes(type);
      // monster BPS resistance in this data is nonmagical only
      if (resisted && nonmagicalPhysical && p.magical && !isPC(target)) resisted = false;
      if (resisted) {
        amt = Math.floor(amt / 2);
        note = 'resisted';
      }
      if (d.vuln.includes(type)) {
        amt *= 2;
        note = note ? `${note}, vulnerable` : 'vulnerable';
      }
    }
    out.push({ ...p, final: amt, note });
  }
  return out;
}

function knockOut(ctx, target) {
  target.hp = 0;
  target.conditions = (target.conditions ?? []).filter(c => (c.name ?? c) !== 'unconscious');
  target.conditions.push({ name: 'unconscious', source: 'dying' });
  // falling unconscious drops a creature prone, and it is still prone when it wakes
  if (!target.conditions.some(c => (c.name ?? c) === 'prone')) target.conditions.push({ name: 'prone', source: 'fell unconscious' });
  target.deathSaves = { successes: 0, failures: 0 };
  target.stable = false;
  if (target.concentration) endConcentration(ctx, target, 'unconscious');
  removeEffectsWhere(ctx, target, e => e.rage, 'unconscious');
}

export function killCreature(ctx, target, reason) {
  target.hp = 0;
  target.dead = true;
  target.diedAtRound = ctx.state.encounter?.round ?? null;
  if (target.concentration) endConcentration(ctx, target, 'died');
  target.conditions = (target.conditions ?? []).filter(c => (c.name ?? c) !== 'unconscious');
  event(ctx, 'death', `${target.name} dies${reason ? ` (${reason})` : ''}.`, { target: target.id });
  const enc = ctx.state.encounter;
  if (enc && !isPC(target)) {
    enc.defeated = enc.defeated ?? [];
    if (!enc.defeated.includes(target.id)) enc.defeated.push(target.id);
  }
}

export function stabilize(ctx, target) {
  target.stable = true;
  target.deathSaves = { successes: 0, failures: 0 };
  event(ctx, 'heal', `${target.name} is stable.`, { target: target.id });
}

// parts: [{amount, type, magical}] already rolled
export function applyDamage(ctx, target, parts, opts = {}) {
  const { crit = false, attacker = null, source = '', melee = false, nonlethal = false } = opts;
  if (target.dead) return { total: 0, parts: [] };
  const adjusted = adjustForDefenses(target, parts);
  let total = adjusted.reduce((s, p) => s + p.final, 0);
  if (opts.halve) total = Math.floor(total / 2);
  const breakdown = adjusted.map(p => `${p.final} ${p.type}${p.note ? ` (${p.note})` : ''}`).join(' + ');
  if (total <= 0) {
    event(ctx, 'damage', `${target.name} takes no damage${breakdown ? ` (${breakdown})` : ''}.`, { target: target.id, amount: 0 });
    return { total: 0, parts: adjusted };
  }
  // regeneration tracking
  target.damageTakenTypes = [...new Set([...(target.damageTakenTypes ?? []), ...adjusted.filter(p => p.final > 0).map(p => p.type)])];
  target.tookDamageThisRound = true;

  let remaining = total;
  if (target.tempHp > 0) {
    const absorbed = Math.min(target.tempHp, remaining);
    target.tempHp -= absorbed;
    remaining -= absorbed;
  }
  // wild shape absorbs first
  if (isPC(target) && target.wildShape && remaining > 0) {
    const ws = target.wildShape;
    const used = Math.min(ws.hp, remaining);
    ws.hp -= used;
    remaining -= used;
    if (ws.hp <= 0) {
      event(ctx, 'effect_end', `${target.name} reverts from beast form.`);
      delete target.wildShape;
      removeEffectsWhere(ctx, target, e => e.wildShapeEnd, 'silent');
    } else {
      remaining = 0;
    }
  }
  const wasAt = target.hp;
  event(ctx, 'damage', `${target.name} takes ${total} damage${breakdown && parts.length > 1 ? ` (${breakdown})` : adjusted[0]?.note ? ` (${breakdown})` : ` ${adjusted[0]?.type ?? ''}`.trimEnd()}${opts.halve ? ' (halved)' : ''}.`, { target: target.id, amount: total, crit, source });

  if (isPC(target) && wasAt <= 0) {
    if (remaining >= target.maxHp) {
      killCreature(ctx, target, 'massive damage');
      return { total, parts: adjusted };
    }
    if (remaining > 0) {
      target.stable = false;
      target.deathSaves.failures = Math.min(3, target.deathSaves.failures + (crit ? 2 : 1));
      event(ctx, 'death_save', `${target.name} suffers ${crit ? 'two death save failures' : 'a death save failure'} (${target.deathSaves.failures}/3).`, { target: target.id });
      if (target.deathSaves.failures >= 3) killCreature(ctx, target, 'three failed death saves');
    }
    return { total, parts: adjusted };
  }

  target.hp -= remaining;
  if (target.hp <= 0) {
    const overflow = -target.hp;
    target.hp = 0;
    if (isPC(target)) {
      if (overflow >= target.maxHp) {
        killCreature(ctx, target, 'massive damage');
        return { total, parts: adjusted };
      }
      if (tryDeathWard(ctx, target) || tryRelentlessEndurance(ctx, target) || tryRelentlessRage(ctx, target)) {
        // survived at 1 hp
      } else {
        knockOut(ctx, target);
        event(ctx, 'down', `${target.name} falls unconscious and is dying.`, { target: target.id });
      }
    } else {
      const b = MONSTERS[target.key];
      if (b.traits.some(t => t.key === 'undeadFortitude') && !crit && !adjusted.some(p => p.type === 'radiant' && p.final > 0)) {
        const dc = 5 + total;
        const sv = savingThrow(target, 'con', { dc, rng: ctx.rng, reason: 'Undead Fortitude' });
        ctx.events.push({ type: 'save', text: `Undead Fortitude: ${target.name} Con save ${sv.total} vs DC ${dc}`, roll: sv });
        if (sv.success) {
          target.hp = 1;
          event(ctx, 'info', `${target.name} refuses to fall!`);
        }
      }
      if (target.hp <= 0 && b.traits.some(t => t.key === 'relentless') && !target.relentlessUsed && total <= 7) {
        target.relentlessUsed = true;
        target.hp = 1;
        event(ctx, 'info', `${target.name} keeps going (Relentless).`);
      }
      if (target.hp <= 0) {
        if (nonlethal && melee) {
          target.conditions = [...(target.conditions ?? []), { name: 'unconscious', source: 'knocked out' }];
          target.stable = true;
          target.knockedOut = true;
          event(ctx, 'down', `${target.name} is knocked unconscious.`, { target: target.id });
          const enc = ctx.state.encounter;
          if (enc) (enc.defeated = enc.defeated ?? []).push(target.id);
        } else killCreature(ctx, target);
      }
    }
    if (target.hp <= 0 && attacker) onReducedToZero(ctx, attacker, target);
  }
  // effects ended by damage
  removeEffectsWhere(ctx, target, e => e.endsOnDamage, 'took damage');
  if (attacker && attacker.id !== target.id) ctx.hooks?.onDamaged?.(target, attacker);
  if (attacker) removeEffectsWhere(ctx, target, e => e.endsOnDamageFromCaster && e.sourceId === attacker.id, 'harmed by caster');
  // concentration
  if (target.concentration && !target.dead && target.hp > 0) {
    const dc = Math.max(10, Math.floor(total / 2));
    const sv = savingThrow(target, 'con', { dc, rng: ctx.rng, reason: 'concentration', advantage: hasFeat(target, 'warCaster'), auraBonus: opts.auraBonusFor?.(target) ?? 0 });
    ctx.events.push({ type: 'save', text: `${target.name} concentration check: ${sv.total} vs DC ${dc} - ${sv.success ? 'holds' : 'broken'}`, roll: sv });
    if (!sv.success) endConcentration(ctx, target, 'failed concentration check');
  }
  return { total, parts: adjusted };
}

function tryDeathWard(ctx, t) {
  const dw = activeEffects(t).find(e => e.deathWard);
  if (!dw) return false;
  t.hp = 1;
  t.effects = t.effects.filter(e => e !== dw);
  event(ctx, 'info', `Death Ward holds ${t.name} at 1 hit point.`);
  return true;
}

function tryRelentlessEndurance(ctx, t) {
  const r = t.resources?.relentlessEndurance;
  if (!r || r.used >= r.max) return false;
  r.used++;
  t.hp = 1;
  event(ctx, 'info', `${t.name} refuses to fall (Relentless Endurance) and stays at 1 hit point.`);
  return true;
}

function tryRelentlessRage(ctx, t) {
  if (!(cl(t, 'barbarian') >= 11 && activeEffects(t).some(e => e.rage))) return false;
  t.relentlessRageDc = t.relentlessRageDc ?? 10;
  const sv = savingThrow(t, 'con', { dc: t.relentlessRageDc, rng: ctx.rng, reason: 'Relentless Rage' });
  ctx.events.push({ type: 'save', text: `Relentless Rage: ${sv.total} vs DC ${t.relentlessRageDc}`, roll: sv });
  t.relentlessRageDc += 5;
  if (sv.success) {
    t.hp = 1;
    event(ctx, 'info', `${t.name} rages on at 1 hit point!`);
    return true;
  }
  return false;
}

function onReducedToZero(ctx, attacker, target) {
  if (!(isPC(attacker) && hasSub(attacker, 'warlock', 'fiend'))) return;
  const sa = combatant(ctx.state, attacker.id)?.side ?? 'party';
  const st = combatant(ctx.state, target.id)?.side;
  if (st === sa) return;
  const amt = Math.max(1, mod(attacker, 'cha') + cl(attacker, 'warlock'));
  if (amt > (attacker.tempHp ?? 0)) {
    attacker.tempHp = amt;
    event(ctx, 'heal', `${attacker.name} gains ${amt} temporary hit points (Dark One's Blessing).`, { target: attacker.id });
  }
}

export function applyHealing(ctx, target, amount, source = '') {
  if (target.dead) {
    event(ctx, 'info', `${target.name} is dead and cannot be healed.`);
    return 0;
  }
  if (activeEffects(target).some(e => e.noHealing)) {
    event(ctx, 'info', `${target.name} cannot regain hit points right now.`);
    return 0;
  }
  if (!isPC(target) && ['undead', 'construct'].includes(MONSTERS[target.key]?.type) && source !== 'regeneration') {
    event(ctx, 'info', `Healing has no effect on ${target.name}.`);
    return 0;
  }
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + Math.max(0, amount));
  const gained = target.hp - before;
  if (before <= 0 && target.hp > 0) {
    target.conditions = (target.conditions ?? []).filter(c => (c.name ?? c) !== 'unconscious');
    target.deathSaves = { successes: 0, failures: 0 };
    target.stable = false;
    if (target.knockedOut) delete target.knockedOut;
  }
  event(ctx, 'heal', `${target.name} regains ${gained} hit points${source ? ` (${source})` : ''} [${target.hp}/${target.maxHp}].`, { target: target.id, amount: gained });
  return gained;
}

export function grantTempHp(ctx, target, amount, source = '') {
  if (amount > (target.tempHp ?? 0)) {
    target.tempHp = amount;
    event(ctx, 'heal', `${target.name} gains ${amount} temporary hit points${source ? ` (${source})` : ''}.`, { target: target.id });
  } else event(ctx, 'info', `${target.name} keeps their existing ${target.tempHp} temporary hit points.`);
}

export function deathSave(ctx, target) {
  const adv = activeEffects(target).some(e => e.advSaves?.includes('death'));
  const d = rollD20(ctx.rng, { advantage: adv, luckyHalfling: hasTrait(target, 'lucky') });
  const n = d.natural;
  const ds = target.deathSaves;
  const die = d.rolls.length > 1 ? `d20 (${d.rolls.join(', ')}) ${n}` : `d20 ${n}`;
  const tally = () => `${ds.successes}/3 successes, ${ds.failures}/3 failures`;
  let text;
  if (n === 20) {
    target.hp = 1;
    target.conditions = target.conditions.filter(c => (c.name ?? c) !== 'unconscious');
    target.deathSaves = { successes: 0, failures: 0 };
    target.stable = false;
    text = `${target.name} death saving throw: ${die} - natural 20! ${target.name} regains 1 hit point and wakes.`;
  } else if (n === 1) {
    ds.failures = Math.min(3, ds.failures + 2);
    text = `${target.name} death saving throw: ${die} - natural 1, two failures (${tally()}).`;
  } else if (n >= 10) {
    ds.successes += 1;
    text = `${target.name} death saving throw: ${die} vs 10 - success (${tally()}).`;
  } else {
    ds.failures += 1;
    text = `${target.name} death saving throw: ${die} vs 10 - failure (${tally()}).`;
  }
  ctx.events.push({ type: 'death_save', text, roll: { natural: n, rolls: d.rolls, total: n, dc: 10, success: n >= 10 }, target: target.id });
  if (ds.failures >= 3) killCreature(ctx, target, 'failed death saves');
  else if (ds.successes >= 3) stabilize(ctx, target);
  return n;
}

export { creatureById, addEffect };
