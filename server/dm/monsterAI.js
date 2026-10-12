import { MONSTERS } from '../engine/data/monsters.js';
import { SPELLS } from '../engine/data/spells.js';
import { creatureById, combatant, hostile, currentCid } from '../engine/state.js';
import { livingCombatants, cbDistance, occupiedBy } from '../engine/combat.js';
import { attackProfiles, avgDmg } from '../engine/attack.js';
import { isIncapacitated, activeEffects, speed, isPC } from '../engine/creature.js';
import { distanceFt, findPath, squaresOf, inArea } from '../engine/grid.js';
import { execute } from '../engine/actions.js';
import { RuleError } from '../engine/util.js';

// foes still standing; once none are, the ones lying on the ground: a downed character can still be hit,
// each hit a failed death save (two for a critical, as any melee hit within 5 ft is)
function enemiesOf(state, cid) {
  const foes = livingCombatants(state, cb => hostile(state, cid, cb.id) && !cb.removed);
  const standing = foes.filter(cb => creatureById(state, cb.id).hp > 0);
  if (standing.length) return standing;
  // in a book where foes may take prisoners, nobody strikes the fallen until the DM has ruled
  if (state.encounter?.downedPolicy === 'ask') return [];
  return foes.filter(cb => isPC(creatureById(state, cb.id)));
}

function try_(ctx, cid, action) {
  try {
    execute(ctx, cid, action);
    return true;
  } catch (e) {
    if (e instanceof RuleError) return false;
    throw e;
  }
}

// nearest free square adjacent (within reach) to the target that we can reach
export function approachSquare(state, cid, targetId, reach) {
  const enc = state.encounter;
  const me = combatant(state, cid);
  const t = combatant(state, targetId);
  const ts = me.turnState;
  const budget = ts.movement - ts.moved;
  let best = null;
  for (let dx = -reach / 5 - me.fp; dx <= reach / 5 + t.fp; dx++) {
    for (let dy = -reach / 5 - me.fp; dy <= reach / 5 + t.fp; dy++) {
      const p = { x: t.pos.x + dx, y: t.pos.y + dy };
      if (distanceFt(p, me.fp, t.pos, t.fp) > reach) continue;
      if (p.x < 0 || p.y < 0 || p.x + me.fp > enc.map.width || p.y + me.fp > enc.map.height) continue;
      if (squaresOf(p, me.fp).some(sq => occupiedBy(enc, sq, cid))) continue;
      const path = findPath(enc.map, me.pos, p, me.fp, { blocked: sq => { const o = occupiedBy(enc, sq, cid); return !!o && hostile(state, cid, o.id) && creatureById(state, o.id).hp > 0; }, maxCost: 400 });
      if (!path) continue;
      if (!best || path.cost < best.cost) best = { pos: p, cost: path.cost, path: path.path };
    }
  }
  if (!best) return null;
  if (best.cost <= budget) return best.pos;
  // walk as far as budget allows along the path
  let steps = Math.floor(budget / 5);
  while (steps > 0) {
    const p = best.path[Math.min(steps, best.path.length - 1)];
    if (!squaresOf(p, me.fp).some(sq => occupiedBy(enc, sq, cid))) return p;
    steps--;
  }
  return null;
}

function chooseTarget(state, cid, enemies) {
  // prefer conscious, then closest, then lowest hp
  return [...enemies].sort((a, b) => {
    const ca = creatureById(state, a.id);
    const cb = creatureById(state, b.id);
    const da = cbDistance(state, cid, a.id);
    const db = cbDistance(state, cid, b.id);
    if (Math.abs(da - db) > 10) return da - db;
    return ca.hp - cb.hp;
  })[0];
}

function trySpecials(ctx, cid, c, enemies) {
  const state = ctx.state;
  const b = MONSTERS[c.key];
  for (const s of b.special ?? []) {
    if (s.recharge && !c.recharge[s.key]) continue;
    if (s.area) {
      // aim at the enemy that catches the most foes
      let bestAim = null;
      let bestHits = 0;
      const me = combatant(state, cid);
      for (const e of enemies) {
        const area = { ...s.area, origin: me.pos, toward: e.pos };
        const hits = enemies.filter(o => inArea(area, o.pos, o.fp)).length;
        const friendly = livingCombatants(state, o => !hostile(state, cid, o.id) && o.id !== cid && inArea(area, o.pos, o.fp)).length;
        if (hits - friendly > bestHits) {
          bestHits = hits - friendly;
          bestAim = e;
        }
      }
      if (bestAim && (bestHits >= 2 || enemies.length === 1)) {
        const dist = cbDistance(state, cid, bestAim.id);
        if (dist <= s.area.size) return try_(ctx, cid, { type: 'feature', feature: 'special', special: s.key, target: bestAim.id });
      }
    } else if (s.kind === 'ranged') {
      const t = enemies.find(e => cbDistance(state, cid, e.id) <= s.range[1] && !activeEffects(creatureById(state, e.id)).some(x => x.conditions?.includes('restrained')));
      if (t) return try_(ctx, cid, { type: 'feature', feature: 'special', special: s.key, target: t.id });
    }
  }
  return false;
}

function trySpells(ctx, cid, c, enemies) {
  const state = ctx.state;
  const scs = MONSTERS[c.key]?.spellcasting;
  if (!scs) return false;
  // heal an ally in trouble
  const allies = livingCombatants(state, o => !hostile(state, cid, o.id) && creatureById(state, o.id).hp > 0);
  const hurt = allies.map(o => creatureById(state, o.id)).find(a => a.hp < a.maxHp / 3);
  if (hurt) {
    for (const sp of ['cureWounds', 'healingWord']) {
      if (scs.spells.includes(sp) && cbDistance(state, cid, hurt.id) <= (SPELLS[sp].range === 'touch' ? 5 : SPELLS[sp].range)) {
        for (let lvl = 1; lvl <= 5; lvl++) if (c.slots?.[lvl] && c.slots[lvl].used < c.slots[lvl].max && try_(ctx, cid, { type: 'cast', spell: sp, level: lvl, targets: [hurt.id] })) return true;
      }
    }
  }
  const leveled = scs.spells.filter(s => ['save', 'attack', 'auto'].includes(SPELLS[s]?.effect.type)).sort((a, b) => SPELLS[b].level - SPELLS[a].level);
  for (const sp of leveled) {
    const def = SPELLS[sp];
    const lvl = def.level;
    const slot = Object.keys(c.slots ?? {}).map(Number).filter(l => l >= lvl && c.slots[l].used < c.slots[l].max).sort((a, b) => a - b)[0];
    if (!slot) continue;
    const t = chooseTarget(state, cid, enemies);
    if (!t) return false;
    const act = { type: 'cast', spell: sp, level: slot };
    if (def.effect.area) {
      if (['cone', 'line'].includes(def.effect.area.shape) && cbDistance(state, cid, t.id) > def.effect.area.size) continue;
      act.point = { ...t.pos };
      const area = def.effect.area.shape === 'cone' || def.effect.area.shape === 'line' ? { ...def.effect.area, origin: combatant(state, cid).pos, toward: t.pos } : { ...def.effect.area, center: t.pos };
      const friendly = livingCombatants(state, o => !hostile(state, cid, o.id) && inArea(area, o.pos, o.fp)).length;
      if (friendly) continue;
    } else act.targets = [t.id];
    if (try_(ctx, cid, act)) return true;
  }
  for (const sp of scs.cantrips.filter(s => ['save', 'attack'].includes(SPELLS[s]?.effect.type))) {
    const t = enemies.find(e => cbDistance(state, cid, e.id) <= SPELLS[sp].range);
    if (t && try_(ctx, cid, { type: 'cast', spell: sp, targets: [t.id] })) return true;
  }
  return false;
}

// a full engine-driven turn for a monster or companion; ends the turn
export function runAiTurn(ctx, cid) {
  const state = ctx.state;
  if (currentCid(state) !== cid) return;
  const c = creatureById(state, cid);
  const cb = combatant(state, cid);
  const done = () => {
    if (state.encounter?.status === 'active' && currentCid(state) === cid) try_(ctx, cid, { type: 'endTurn' });
  };
  if (!c || c.dead || c.hp <= 0 || isIncapacitated(c)) return done();
  const turned = activeEffects(c).find(e => e.turnedBy);
  let enemies = enemiesOf(state, cid);
  if (!enemies.length) return done();
  if (turned) {
    const src = combatant(state, turned.turnedBy);
    if (src) {
      const away = { x: Math.max(0, Math.min(state.encounter.map.width - 1, cb.pos.x + Math.sign(cb.pos.x - src.pos.x) * 6)), y: Math.max(0, Math.min(state.encounter.map.height - 1, cb.pos.y + Math.sign(cb.pos.y - src.pos.y) * 6)) };
      try_(ctx, cid, { type: 'dash' });
      for (let k = 6; k > 0; k--) {
        const p = { x: Math.max(0, Math.min(state.encounter.map.width - 1, cb.pos.x + Math.sign(cb.pos.x - src.pos.x) * k)), y: Math.max(0, Math.min(state.encounter.map.height - 1, cb.pos.y + Math.sign(cb.pos.y - src.pos.y) * k)) };
        if (try_(ctx, cid, { type: 'move', to: p })) break;
      }
      void away;
    }
    return done();
  }
  // stand up if prone
  if ((c.conditions ?? []).some(x => (x.name ?? x) === 'prone') && speed(c) > 0) try_(ctx, cid, { type: 'stand' });
  if (!isPC(c) && trySpecials(ctx, cid, c, enemies)) {
    enemies = enemiesOf(state, cid);
  } else if (!isPC(c) && trySpells(ctx, cid, c, enemies)) {
    enemies = enemiesOf(state, cid);
  } else {
    const profiles = attackProfiles(state, c);
    const melee = profiles.filter(p => p.kind === 'melee').sort((a, b) => avgDmg(b) - avgDmg(a));
    const ranged = profiles.filter(p => p.kind === 'ranged').sort((a, b) => avgDmg(b) - avgDmg(a));
    let target = chooseTarget(state, cid, enemies);
    const dist = cbDistance(state, cid, target.id);
    const reach = melee[0]?.reach ?? 5;
    const canCloseIn = melee.length && dist - reach <= cb.turnState.movement - cb.turnState.moved;
    const preferRanged = ranged.length && (!melee.length || (!canCloseIn && dist <= ranged[0].range[1]) || (avgDmg(ranged[0]) > avgDmg(melee[0]) * 1.2 && dist > 5));
    if (!preferRanged && melee.length) {
      if (dist > reach) {
        const spot = approachSquare(state, cid, target.id, reach);
        if (spot) try_(ctx, cid, { type: 'move', to: spot });
      }
      if (state.encounter?.status !== 'active' || c.dead || c.hp <= 0) return done();
      // keep attacking while attacks remain
      for (let i = 0; i < 6; i++) {
        enemies = enemiesOf(state, cid);
        if (!enemies.length) break;
        const inReach = enemies.filter(e => cbDistance(state, cid, e.id) <= reach).sort((a, b) => creatureById(state, a.id).hp - creatureById(state, b.id).hp);
        if (!inReach.length) break;
        const t = inReach.find(e => creatureById(state, e.id).hp > 0) ?? inReach[0];
        const ts = cb.turnState;
        let p = melee[0];
        if (ts.multiattack) {
          const slot = ts.multiattack.find(m => m.left > 0);
          if (!slot) break;
          p = melee.find(x => x.id === slot.attack) ?? profiles.find(x => x.id === slot.attack) ?? p;
        } else if (ts.attacksLeft <= 0 && !(ts.action > 0)) break;
        if (!try_(ctx, cid, { type: 'attack', attack: p.id, target: t.id })) break;
        if (state.encounter?.status !== 'active') return done();
      }
    } else if (ranged.length) {
      target = enemies.filter(e => cbDistance(state, cid, e.id) <= ranged[0].range[1]).sort((a, b) => creatureById(state, a.id).hp - creatureById(state, b.id).hp)[0] ?? target;
      // step away from adjacent enemies if possible
      if (enemies.some(e => cbDistance(state, cid, e.id) <= 5)) {
        try_(ctx, cid, { type: 'feature', feature: 'nimbleEscape', mode: 'disengage' });
        const t0 = combatant(state, target.id);
        for (let k = 3; k > 0; k--) {
          const p = { x: cb.pos.x + Math.sign(cb.pos.x - t0.pos.x) * k, y: cb.pos.y };
          if (try_(ctx, cid, { type: 'move', to: p })) break;
        }
      } else if (cbDistance(state, cid, target.id) > ranged[0].range[0]) {
        const spot = approachSquare(state, cid, target.id, ranged[0].range[0]);
        if (spot) try_(ctx, cid, { type: 'move', to: spot });
      }
      for (let i = 0; i < 4; i++) {
        if (state.encounter?.status !== 'active' || c.dead) return done();
        const ts = cb.turnState;
        let p = ranged[0];
        if (ts.multiattack) {
          const slot = ts.multiattack.find(m => m.left > 0);
          if (!slot) break;
          p = profiles.find(x => x.id === slot.attack) ?? p;
        }
        const tt = enemiesOf(state, cid).filter(e => cbDistance(state, cid, e.id) <= p.range?.[1]).sort((a, b) => creatureById(state, a.id).hp - creatureById(state, b.id).hp)[0];
        if (!tt || !try_(ctx, cid, { type: 'attack', attack: p.id, target: tt.id })) break;
      }
    }
  }
  if (state.encounter?.status === 'active' && !c.dead && c.hp > 0 && MONSTERS[c.key]?.traits.some(t => t.key === 'nimbleEscape') && cb.turnState.bonus > 0) {
    const adj = enemiesOf(state, cid).some(e => cbDistance(state, cid, e.id) <= 5);
    if (adj) try_(ctx, cid, { type: 'feature', feature: 'nimbleEscape', mode: 'disengage' });
  }
  done();
}

export function describeHealth(c) {
  if (c.dead) return 'dead';
  if (c.hp <= 0) return 'down';
  const r = c.hp / c.maxHp;
  return r >= 1 ? 'unhurt' : r > 0.5 ? 'wounded' : r > 0.25 ? 'bloodied' : 'near death';
}
