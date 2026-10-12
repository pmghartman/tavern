import { SKILLS } from './data/core.js';
import { MONSTERS, findMonsterKey } from './data/monsters.js';
import { SPELLS } from './data/spells.js';
import { roll, rollD20, averageOf } from './dice.js';
import { abilityCheck, savingThrow } from './checks.js';
import { applyDamage } from './damage.js';
import { addEffect } from './effects.js';
import { mod, prof, passivePerception, activeEffects, saveMod } from './creature.js';
import { itemDef } from './character.js';
import { validateHazard, partyLevel } from './dmActions.js';
import { RuleError, uid, publicPlace } from './util.js';
import { event, inCombat, nowMinute, requireCreature } from './state.js';

export const ATTITUDES = ['hostile', 'indifferent', 'friendly'];
// DC by attitude and how much is asked: trivial, minor risk, major risk
export const SOCIAL_DC = {
  friendly: { trivial: 0, minor: 10, major: 20 },
  indifferent: { trivial: 10, minor: 15, major: 25 },
  hostile: { trivial: 20, minor: 25, major: null },
};
const FEATURE_KINDS = ['trap', 'secret', 'text', 'aura', 'clue', 'object'];
const SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'];

export function emptyWorld() {
  return { areas: {}, currentArea: null, features: {}, puzzles: {}, factions: {}, clues: [] };
}

export const world = state => (state.world = state.world ?? emptyWorld());

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function dcOk(dc, label = 'DC') {
  if (!Number.isInteger(dc) || dc < 5 || dc > 30) throw new RuleError(`${label} must be a whole number from 5 to 30.`, 'bad_dc');
  return dc;
}

function cleanText(s, max = 600) {
  return String(s ?? '').slice(0, max);
}

export function findArea(state, ref) {
  const w = world(state);
  if (!ref) return null;
  if (Object.hasOwn(w.areas, ref)) return w.areas[ref];
  return Object.values(w.areas).find(a => norm(a.name) === norm(ref)) ?? null;
}

function requireArea(state, ref) {
  const a = findArea(state, ref);
  if (!a) throw new RuleError(`There is no area called "${ref}".`, 'not_found');
  return a;
}

function currentArea(state) {
  const w = world(state);
  return w.currentArea ? w.areas[w.currentArea] : null;
}

function requireCurrent(state) {
  const a = currentArea(state);
  if (!a) throw new RuleError('The party is not in a mapped area. The DM has to set the scene first.', 'no_area');
  return a;
}

function areaFeatures(state, area) {
  const w = world(state);
  return Object.values(w.features).filter(f => f.area === area.id);
}

// a feature, exit or puzzle referenced by name in the current area
export function findTarget(state, ref, { kinds } = {}) {
  const area = currentArea(state);
  if (!area || !ref) return null;
  const n = norm(ref);
  const visible = f => !f.hidden;
  const feats = areaFeatures(state, area).filter(visible).filter(f => !kinds || kinds.includes(f.kind));
  const f = feats.find(x => x.id === ref || norm(x.name) === n) ?? feats.find(x => norm(x.name).includes(n) && n.length >= 3);
  if (f) return { type: 'feature', feature: f };
  const ex = area.exits.filter(e => !e.hidden).find(e => norm(e.dir) === n || norm(e.toName) === n || (e.door && norm(e.door.name) === n) || (n.length >= 3 && (norm(e.door?.name ?? '').includes(n) || norm(e.dir).startsWith(n))));
  if (ex) return { type: 'exit', exit: ex };
  const pz = Object.values(world(state).puzzles).find(p => p.area === area.id && (p.id === ref || norm(p.name) === n || (n.length >= 3 && norm(p.name).includes(n))));
  if (pz) return { type: 'puzzle', puzzle: pz };
  return null;
}

function party(state) {
  return Object.values(state.characters).filter(c => !c.dead && !c.absent && !c.retired);
}

function awake(state) {
  return party(state).filter(c => c.hp > 0);
}

function noExploreInCombat(state) {
  if (inCombat(state)) throw new RuleError('That takes too long to do during combat.', 'in_combat');
}

function advance(state, minutes) {
  state.clock = state.clock ?? { minute: 0 };
  state.clock.minute = nowMinute(state) + minutes;
}

function validateExit(e, i) {
  if (!e.dir || !e.to) throw new RuleError(`Exit ${i + 1} needs a direction and a destination.`);
  const exit = { dir: cleanText(e.dir, 40), toName: cleanText(e.to, 80), hidden: !!e.hidden, minutes: Math.max(0, Math.min(600, Math.round(e.minutes ?? 1))) };
  if (exit.hidden) exit.detectDc = dcOk(e.detect_dc ?? e.detectDc ?? 15, 'Hidden exit DC');
  if (e.door) {
    const d = e.door;
    exit.door = { name: cleanText(d.name ?? `${exit.dir} door`, 60), locked: !!d.locked, magical: !!d.magical, open: false, broken: false };
    if (exit.door.locked) {
      exit.door.dc = dcOk(d.dc ?? 15, 'Lock DC');
      exit.door.forceDc = dcOk(d.force_dc ?? d.forceDc ?? Math.min(30, exit.door.dc + 5), 'Force DC');
    }
  }
  return exit;
}

// DM: create a room, cavern, street or maze cell
export function createArea(ctx, spec) {
  const state = ctx.state;
  const w = world(state);
  const name = cleanText(spec.name, 80).trim();
  if (!name) throw new RuleError('Areas need a name.');
  if (Object.keys(w.areas).length >= 200) throw new RuleError('Too many areas in this campaign; reuse existing ones.');
  const existing = findArea(state, name);
  const exits = (spec.exits ?? []).slice(0, 12).map(validateExit);
  const area = existing ?? { id: uid('ar_'), name, visited: false };
  Object.assign(area, { description: cleanText(spec.description, 1200), exits, light: spec.light ?? area.light ?? null, stub: false });
  if (area.light && !['bright', 'dim', 'dark', 'sunlight'].includes(area.light)) throw new RuleError('Light must be bright, dim, dark or sunlight.');
  w.areas[area.id] = area;
  for (const f of spec.features ?? []) addFeature(ctx, { ...f, area: area.id });
  event(ctx, 'explore', `${existing ? 'Updated' : 'Mapped'} area: ${name}.`, { area: area.id, dmOnly: true });
  if (spec.start || !w.currentArea) enterArea(ctx, area, { silentTraps: true });
  return area;
}

// DM: anything the party can find or interact with
export function addFeature(ctx, spec) {
  const state = ctx.state;
  const w = world(state);
  const area = spec.area ? requireArea(state, spec.area) : requireCurrent(state);
  const kind = spec.kind;
  if (!FEATURE_KINDS.includes(kind)) throw new RuleError(`Feature kind must be one of ${FEATURE_KINDS.join(', ')}.`);
  if (areaFeatures(state, area).length >= 40) throw new RuleError('That area already has too many features.');
  const f = { id: uid('ft_'), kind, area: area.id, name: cleanText(spec.name, 80) || kind, description: cleanText(spec.description, 600), hidden: !!spec.hidden };
  if (f.hidden) f.detectDc = dcOk(spec.detect_dc ?? spec.detectDc ?? 15, 'Detection DC');
  if (spec.school || spec.magical) {
    const school = spec.school ?? 'abjuration';
    if (!SCHOOLS.includes(school)) throw new RuleError(`Unknown school of magic "${school}".`);
    f.magic = school;
  }
  if (kind === 'trap') {
    f.disarmDc = dcOk(spec.disarm_dc ?? spec.disarmDc ?? 15, 'Disarm DC');
    f.trigger = ['enter', 'touch', 'exit'].includes(spec.trigger) ? spec.trigger : 'enter';
    if (f.trigger === 'exit') f.exitDir = cleanText(spec.exit ?? spec.exitDir, 40);
    if (spec.attached_to ?? spec.attachedTo) f.attachedTo = cleanText(spec.attached_to ?? spec.attachedTo, 80);
    const e = spec.effect ?? {};
    const save = String(e.save ?? spec.save ?? 'dex').slice(0, 3).toLowerCase();
    if (!['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(save)) throw new RuleError('Trap save must be an ability.');
    const severity = e.severity ?? spec.severity ?? 'dangerous';
    const damage = e.damage ?? spec.damage ?? null;
    const damageType = e.damage_type ?? e.damageType ?? spec.damage_type ?? 'piercing';
    if (damage) validateHazard(state, damage, damageType, severity);
    const condition = e.condition ?? spec.condition ?? null;
    if (condition && !['poisoned', 'restrained', 'prone', 'blinded', 'deafened', 'frightened', 'unconscious'].includes(condition)) throw new RuleError(`Traps cannot inflict "${condition}".`);
    f.effect = { save, dc: dcOk(e.dc ?? spec.dc ?? 13, 'Trap save DC'), damage, damageType, severity, condition, targets: (e.targets ?? spec.targets) === 'party' ? 'party' : 'one' };
    f.armed = true;
  }
  if (kind === 'text') {
    f.language = cleanText(spec.language ?? 'Common', 30);
    f.content = cleanText(spec.content, 1500);
    f.read = false;
  }
  if (kind === 'clue' || kind === 'secret') {
    f.content = cleanText(spec.content ?? spec.description, 1200);
    if (spec.reveals_exit ?? spec.revealsExit) f.revealsExit = cleanText(spec.reveals_exit ?? spec.revealsExit, 40);
  }
  if (kind === 'object' && spec.lock) {
    f.lock = { locked: true, dc: dcOk(spec.lock.dc ?? 15, 'Lock DC'), magical: !!spec.lock.magical };
    f.lock.forceDc = dcOk(spec.lock.force_dc ?? spec.lock.forceDc ?? Math.min(30, f.lock.dc + 5), 'Force DC');
    f.contents = cleanText(spec.contents, 600);
  }
  w.features[f.id] = f;
  event(ctx, 'explore', `Feature placed in ${area.name}: ${f.name} (${kind}${f.hidden ? ', hidden' : ''}).`, { dmOnly: true });
  if (w.currentArea === area.id && f.hidden) noticeHidden(ctx, area);
  return f;
}

// party members notice hidden things with passive Perception
export function noticeHidden(ctx, area) {
  const state = ctx.state;
  const watchers = awake(state);
  if (!watchers.length) return [];
  const best = watchers.reduce((b, c) => (passivePerception(c) > b.pp ? { c, pp: passivePerception(c) } : b), { c: null, pp: -1 });
  const found = [];
  for (const f of areaFeatures(state, area)) {
    if (f.hidden && f.detectDc <= best.pp) {
      f.hidden = false;
      found.push(f.name);
      event(ctx, 'explore', `${best.c.name} notices ${articled(f.name)}${f.kind === 'trap' ? ' (a trap!)' : ''}.`, { feature: f.id });
    }
  }
  for (const e of area.exits) {
    if (e.hidden && e.detectDc <= best.pp) {
      e.hidden = false;
      found.push(e.dir);
      event(ctx, 'explore', `${best.c.name} spots a concealed way ${e.dir}.`);
    }
  }
  return found;
}

const articled = n => (/^(a|an|the)\s/i.test(n) ? n : `the ${n}`);

function enterArea(ctx, area, { silentTraps = false } = {}) {
  const state = ctx.state;
  const w = world(state);
  w.currentArea = area.id;
  const first = !area.visited;
  area.visited = true;
  state.scene = state.scene ?? {};
  const shown = publicPlace(area.name, state.scene.location, area.description);
  state.scene.location = shown;
  if (area.light) state.scene.light = area.light;
  event(ctx, 'explore', shown ? `The party ${first ? 'enters' : 'returns to'} ${shown}.` : 'The party moves on.', { area: area.id });
  noticeHidden(ctx, area);
  if (!silentTraps) {
    for (const t of areaFeatures(state, area).filter(f => f.kind === 'trap' && f.armed && f.trigger === 'enter' && f.hidden)) triggerTrap(ctx, t);
  }
}

// DM: narrative travel to a known area
export function moveParty(ctx, ref) {
  noExploreInCombat(ctx.state);
  enterArea(ctx, requireArea(ctx.state, ref));
}

export function triggerTrap(ctx, trap, { victims } = {}) {
  const state = ctx.state;
  if (!trap.armed) throw new RuleError(`${trap.name} is no longer armed.`);
  trap.armed = false;
  trap.triggered = true;
  trap.hidden = false;
  const pool = victims ?? (trap.effect.targets === 'party' ? awake(state) : awake(state).slice(0, 1));
  event(ctx, 'trap', `The ${trap.name} is triggered!`, { feature: trap.id });
  const e = trap.effect;
  const dmg = e.damage ? roll(e.damage, ctx.rng) : null;
  for (const c of pool) {
    const sv = savingThrow(c, e.save, { dc: e.dc, rng: ctx.rng, against: e.damageType === 'poison' || e.condition === 'poisoned' ? 'poison' : e.condition, reason: trap.name });
    ctx.events.push({ type: 'save', text: `${c.name} ${sv.label}: ${sv.total ?? '-'} vs DC ${e.dc} - ${sv.success ? 'success' : 'failure'}`, roll: sv });
    if (dmg) {
      const amt = sv.success ? Math.floor(dmg.total / 2) : dmg.total;
      if (amt > 0) applyDamage(ctx, c, [{ amount: amt, type: e.damageType, magical: !!trap.magic, label: 'hazard' }], { source: trap.name });
    }
    if (e.condition && !sv.success && !c.dead) {
      addEffect(ctx, c, { name: `${e.condition} (${trap.name})`, conditions: [e.condition], minutes: e.condition === 'poisoned' ? 60 : 1, ...(e.condition === 'restrained' ? { escape: { ability: 'str', dc: e.dc } } : {}) }, { sourceId: 'trap' });
      event(ctx, 'condition', `${c.name} is ${e.condition}.`);
    }
  }
}

function toolBonus(c) {
  const hasTools = c.inventory.some(i => i.key === 'thievesTools');
  if (!hasTools) throw new RuleError(`${c.name} needs thieves' tools for that.`, 'no_tools');
  const proficient = (c.toolProfs ?? []).some(t => /thieves/i.test(t));
  const expert = (c.expertise ?? []).includes('thievesTools');
  return mod(c, 'dex') + (proficient ? prof(c) * (expert ? 2 : 1) : 0);
}

function toolCheck(ctx, c, dc, label) {
  const bonus = toolBonus(c);
  const d = rollD20(ctx.rng, { disadvantage: activeEffects(c).some(e => e.conditions?.includes('poisoned')) });
  const total = d.natural + bonus;
  const success = total >= dc;
  ctx.events.push({ type: 'check', text: `${c.name}: ${label} with thieves' tools ${d.natural} ${bonus >= 0 ? '+' : ''}${bonus} = ${total} vs DC ${dc} - ${success ? 'success' : 'failure'}`, roll: { natural: d.natural, rolls: d.rolls, total, dc, success } });
  return { total, success };
}

function touchTraps(ctx, targetName) {
  const area = currentArea(ctx.state);
  for (const t of areaFeatures(ctx.state, area).filter(f => f.kind === 'trap' && f.armed && f.trigger === 'touch' && f.attachedTo && norm(f.attachedTo) === norm(targetName))) triggerTrap(ctx, t);
}

// player: actively search the current area (10 minutes)
export function search(ctx, charId, { skill = 'perception' } = {}) {
  const state = ctx.state;
  noExploreInCombat(state);
  const c = requireCreature(state, charId);
  const area = requireCurrent(state);
  const sk = skill === 'investigation' ? 'investigation' : 'perception';
  const ck = abilityCheck(c, { skill: sk, rng: ctx.rng, reason: `searching ${area.name}` });
  ctx.events.push({ type: 'check', text: `${c.name} searches ${area.name}: ${SKILLS[sk] ? sk : 'perception'} ${ck.total}`, roll: ck });
  advance(state, 10);
  let found = 0;
  for (const f of areaFeatures(state, area)) {
    if (f.hidden && ck.total >= f.detectDc) {
      f.hidden = false;
      found++;
      event(ctx, 'explore', `${c.name} finds ${articled(f.name)}${f.kind === 'trap' ? ' (a trap)' : ''}.`, { feature: f.id });
    }
  }
  for (const e of area.exits) {
    if (e.hidden && ck.total >= e.detectDc) {
      e.hidden = false;
      found++;
      event(ctx, 'explore', `${c.name} uncovers a hidden way ${e.dir}.`);
    }
  }
  if (!found) event(ctx, 'explore', `${c.name} finds nothing new.`);
  return { found, total: ck.total };
}

export function disarm(ctx, charId, { target }) {
  const state = ctx.state;
  noExploreInCombat(state);
  const c = requireCreature(state, charId);
  const t = findTarget(state, target, { kinds: ['trap'] });
  if (!t || t.type !== 'feature') throw new RuleError(`There is no known trap called "${target}" here.`, 'not_found');
  const trap = t.feature;
  if (!trap.armed) throw new RuleError(`The ${trap.name} is not armed.`);
  const r = toolCheck(ctx, c, trap.disarmDc, `disarming the ${trap.name}`);
  advance(state, 1);
  if (r.success) {
    trap.armed = false;
    trap.disarmed = true;
    event(ctx, 'explore', `${c.name} disarms the ${trap.name}.`);
  } else if (r.total <= trap.disarmDc - 5) {
    event(ctx, 'explore', `${c.name} fumbles the mechanism.`);
    triggerTrap(ctx, trap, { victims: trap.effect.targets === 'party' ? undefined : [c] });
  } else event(ctx, 'explore', `${c.name} fails to disarm the ${trap.name}, but nothing happens.`);
  return r;
}

function lockOf(t) {
  if (t.type === 'exit') return t.exit.door?.locked ? { lock: t.exit.door, name: t.exit.door.name } : null;
  if (t.type === 'feature' && t.feature.lock?.locked) return { lock: t.feature.lock, name: t.feature.name };
  return null;
}

export function pickLock(ctx, charId, { target }) {
  const state = ctx.state;
  noExploreInCombat(state);
  const c = requireCreature(state, charId);
  const t = findTarget(state, target);
  const l = t && lockOf(t);
  if (!l) throw new RuleError(`There is nothing locked called "${target}" here.`, 'not_found');
  const dc = Math.min(30, l.lock.dc + (l.lock.magical ? 10 : 0));
  const r = toolCheck(ctx, c, dc, `picking the ${l.name}${l.lock.magical ? ' (magically sealed, +10 DC)' : ''}`);
  advance(state, 1);
  if (r.success) {
    l.lock.locked = false;
    event(ctx, 'explore', `${c.name} picks the lock of the ${l.name}.`);
    revealContents(ctx, t);
  } else {
    event(ctx, 'explore', `The ${l.name} stays locked.`);
    touchTraps(ctx, l.name);
  }
  return r;
}

export function forceOpen(ctx, charId, { target }) {
  const state = ctx.state;
  noExploreInCombat(state);
  const c = requireCreature(state, charId);
  const t = findTarget(state, target);
  const l = t && lockOf(t);
  if (!l) throw new RuleError(`There is nothing locked called "${target}" here.`, 'not_found');
  const dc = Math.min(30, l.lock.forceDc + (l.lock.magical ? 10 : 0));
  const ck = abilityCheck(c, { skill: 'athletics', dc, rng: ctx.rng, reason: `forcing the ${l.name}` });
  ctx.events.push({ type: 'check', text: `${c.name} tries to force the ${l.name}: Athletics ${ck.total} vs DC ${dc} - ${ck.success ? 'success' : 'failure'}`, roll: ck });
  touchTraps(ctx, l.name);
  if (ck.success) {
    l.lock.locked = false;
    l.lock.broken = true;
    event(ctx, 'explore', `${c.name} smashes the ${l.name} open. The noise echoes.`);
    revealContents(ctx, t);
  } else event(ctx, 'explore', `The ${l.name} holds.`);
  return ck;
}

function revealContents(ctx, t) {
  if (t.type === 'feature' && t.feature.contents) event(ctx, 'explore', `Inside the ${t.feature.name}: ${t.feature.contents}`);
}

// player: move the party through an exit
export function go(ctx, charId, { to }) {
  const state = ctx.state;
  noExploreInCombat(state);
  requireCreature(state, charId);
  const area = requireCurrent(state);
  const n = norm(to);
  const ex = area.exits.filter(e => !e.hidden).find(e => norm(e.dir) === n || norm(e.toName) === n) ?? area.exits.filter(e => !e.hidden).find(e => n.length >= 3 && (norm(e.dir).startsWith(n) || norm(e.toName).includes(n)));
  if (!ex) throw new RuleError(`There is no way "${to}" from ${area.name}. Exits: ${area.exits.filter(e => !e.hidden).map(e => e.dir).join(', ') || 'none known'}.`, 'no_exit');
  if (ex.door?.locked) throw new RuleError(`The ${ex.door.name} is locked.`, 'locked');
  // an exit the DM has not mapped yet still leads somewhere: a stub the DM fills in on arrival
  const dest = findArea(state, ex.toName) ?? stubArea(state, area, ex);
  for (const t of areaFeatures(state, area).filter(f => f.kind === 'trap' && f.armed && f.trigger === 'exit' && f.hidden && norm(f.exitDir) === norm(ex.dir))) triggerTrap(ctx, t);
  if (awake(state).length === 0) return;
  advance(state, ex.minutes ?? 1);
  if (ex.door) ex.door.open = true;
  enterArea(ctx, dest);
}

const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };
const BACK = { ...OPPOSITE, northeast: 'southwest', southwest: 'northeast', northwest: 'southeast', southeast: 'northwest', up: 'down', down: 'up', in: 'out', out: 'in' };

function stubArea(state, from, ex) {
  const w = world(state);
  const name = cleanText(ex.toName, 80).trim();
  const area = { id: uid('ar_'), name, visited: false, description: '', exits: [{ dir: BACK[norm(ex.dir)] ?? `back to ${from.name}`, toName: from.name, hidden: false, minutes: ex.minutes ?? 1 }], light: null, stub: true };
  w.areas[area.id] = area;
  return area;
}

// the exit a plain-language move names ("we head south", "I cross to the old bridge"), if exactly one fits
const MOVE_RE = /\b(?:go|goes|going|head|heads|heading|walk|walks|walking|move|moves|travel|travels|proceed|continue|step|steps|enter|enters|climb|climbs|descend|ascend|cross|crosses|return|returns|run|runs|leave|leaves|follow|follows|venture|make (?:my|our|his|her|their) way|set off|press on)\b/;
export function exitFromText(state, text) {
  if (inCombat(state)) return null;
  const area = currentArea(state);
  const t = ` ${norm(text)} `;
  if (!area || /\?/.test(text) || !MOVE_RE.test(t) || t.length > 240) return null;
  const has = phrase => phrase.length >= 2 && t.includes(` ${phrase} `);
  const fits = area.exits.filter(e => !e.hidden).filter(e => has(norm(e.dir)) || has(norm(e.toName)) || has(norm(e.toName).replace(/^(the|a|an) /, '')) || (e.door && has(norm(e.door.name))));
  return fits.length === 1 ? fits[0].dir : null;
}

// exits of the current area that lead nowhere mapped yet, and whether the area itself still needs describing
export function unmappedAround(state) {
  const area = currentArea(state);
  if (!area || area.maze) return { area: null, stub: false, exits: [] };
  return { area: area.name, stub: !!area.stub, exits: area.exits.filter(e => !findArea(state, e.toName)).map(e => ({ dir: e.dir, to: e.toName })) };
}

// DM: a labyrinth of connected cells; exits are found by walking or /navigate
export function createMaze(ctx, spec) {
  const state = ctx.state;
  const w = world(state);
  noExploreInCombat(state);
  const n = Math.max(3, Math.min(16, Math.round(spec.cells ?? 6)));
  const dc = dcOk(spec.dc ?? 13, 'Navigation DC');
  const name = cleanText(spec.name, 60).trim() || 'Maze';
  if (Object.values(w.areas).some(a => a.maze && norm(a.maze.name) === norm(name))) throw new RuleError(`A maze called ${name} already exists.`);
  if (Object.keys(w.areas).length + n > 200) throw new RuleError('Too many areas in this campaign; reuse existing ones.');
  const from = spec.from ? requireArea(state, spec.from) : requireCurrent(state);
  const width = Math.ceil(Math.sqrt(n));
  const cells = [];
  const at = new Map();
  // random walk that grows a spanning tree
  const start = { x: 0, y: 0, links: {} };
  cells.push(start);
  at.set('0,0', start);
  while (cells.length < n) {
    const open = [];
    for (const c of cells) for (const [d, [dx, dy]] of Object.entries(DIRS)) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (x >= 0 && y >= 0 && x < width && y < width && !at.has(`${x},${y}`)) open.push([c, d, x, y]);
    }
    const [c, d, x, y] = open[ctx.rng.int(0, open.length - 1)];
    const cell = { x, y, links: {} };
    c.links[d] = cell;
    cell.links[OPPOSITE[d]] = c;
    cells.push(cell);
    at.set(`${x},${y}`, cell);
  }
  // one extra loop so it is a maze, not a tree
  for (const c of cells) {
    const d = Object.keys(DIRS).find(k => !c.links[k] && at.get(`${c.x + DIRS[k][0]},${c.y + DIRS[k][1]}`));
    if (d && ctx.rng.int(1, 3) === 1) {
      const o = at.get(`${c.x + DIRS[d][0]},${c.y + DIRS[d][1]}`);
      c.links[d] = o;
      o.links[OPPOSITE[d]] = c;
      break;
    }
  }
  const dist = new Map([[start, 0]]);
  const q = [start];
  while (q.length) {
    const c = q.shift();
    for (const o of Object.values(c.links)) if (!dist.has(o)) {
      dist.set(o, dist.get(c) + 1);
      q.push(o);
    }
  }
  const goal = cells.reduce((b, c) => (dist.get(c) > dist.get(b) ? c : b), start);
  const toGoal = new Map([[goal, 0]]);
  const q2 = [goal];
  while (q2.length) {
    const c = q2.shift();
    for (const o of Object.values(c.links)) if (!toGoal.has(o)) {
      toGoal.set(o, toGoal.get(c) + 1);
      q2.push(o);
    }
  }
  const desc = cleanText(spec.description ?? 'Twisting passages that all look alike.', 400);
  cells.forEach((c, i) => {
    c.name = `${name} (passage ${i + 1})`;
  });
  const exitTo = spec.exit_to ?? spec.exitTo ?? null;
  for (const c of cells) {
    const exits = Object.entries(c.links).map(([d, o]) => ({ dir: d, toName: o.name, hidden: false, minutes: 2 }));
    if (c === start) exits.push({ dir: 'back', toName: from.name, hidden: false, minutes: 2 });
    if (c === goal && exitTo) exits.push({ dir: 'out', toName: cleanText(exitTo, 80), hidden: false, minutes: 2 });
    const area = { id: uid('ar_'), name: c.name, visited: false, description: desc, exits, light: spec.light ?? from.light ?? null, maze: { name, dc, toGoal: toGoal.get(c), goal: c === goal } };
    w.areas[area.id] = area;
  }
  from.exits.push({ dir: cleanText(spec.entrance ?? `into the ${name}`, 40), toName: start.name, hidden: false, minutes: 1 });
  event(ctx, 'explore', `Maze created: ${name}, ${n} passages, navigation DC ${dc}, exit from ${goal.name}.`, { dmOnly: true });
  return { name, cells: n, entrance: start.name, goal: goal.name };
}

// player: Survival check to find the way out of a maze
export function navigate(ctx, charId) {
  const state = ctx.state;
  noExploreInCombat(state);
  const c = requireCreature(state, charId);
  const area = requireCurrent(state);
  if (!area.maze) throw new RuleError('There is no maze to find a way through here.', 'no_maze');
  advance(state, 10);
  if (area.maze.goal) {
    event(ctx, 'explore', `${c.name} recognizes the way out of the ${area.maze.name}.`);
    return { success: true };
  }
  const ck = abilityCheck(c, { skill: 'survival', dc: area.maze.dc, rng: ctx.rng, reason: `navigating the ${area.maze.name}` });
  ctx.events.push({ type: 'check', text: `${c.name} navigates the ${area.maze.name}: Survival ${ck.total} vs DC ${area.maze.dc} - ${ck.success ? 'success' : 'failure'}`, roll: ck });
  if (ck.success) {
    const next = area.exits.find(e => findArea(state, e.toName)?.maze?.toGoal === area.maze.toGoal - 1);
    event(ctx, 'explore', next ? `${c.name} is sure the way ${next.dir} leads toward the exit.` : `${c.name} cannot tell which way leads out.`);
  } else event(ctx, 'explore', `${c.name} loses their bearings among the identical passages.`);
  return ck;
}

const STOP = new Set(['the', 'a', 'an', 'it', 'is', 'its', 'answer', 'i', 'say', 'we', 'my', 'our']);
const answerKey = s => norm(s).split(' ').filter(w => !STOP.has(w)).join(' ');

// DM: a riddle, lever sequence, cipher or other challenge
export function createPuzzle(ctx, spec) {
  const state = ctx.state;
  const w = world(state);
  const area = spec.area ? requireArea(state, spec.area) : requireCurrent(state);
  const answers = (spec.answers ?? []).map(answerKey).filter(Boolean);
  if (!answers.length || answers.length > 10) throw new RuleError('Puzzles need 1-10 accepted answers.');
  const p = {
    id: uid('pz_'), area: area.id, name: cleanText(spec.name, 80) || 'Puzzle', prompt: cleanText(spec.prompt, 1500), answers,
    hints: (spec.hints ?? []).slice(0, 3).map(h => cleanText(h, 300)), hintsRevealed: 0, hintDc: dcOk(spec.hint_dc ?? spec.hintDc ?? 13, 'Hint DC'),
    attempts: 0, maxAttempts: Math.max(1, Math.min(10, spec.max_attempts ?? spec.maxAttempts ?? 3)), solved: false, failed: false,
    reward: cleanText(spec.reward, 600), unlocksExit: spec.unlocks_exit ?? spec.unlocksExit ?? null, onFailTrap: spec.on_fail_trap ?? spec.onFailTrap ?? null, hintTried: {},
  };
  w.puzzles[p.id] = p;
  event(ctx, 'puzzle', `A puzzle awaits in ${area.name}: ${p.name}.`, { puzzle: p.id, dmOnly: w.currentArea !== area.id });
  return p;
}

export function solve(ctx, charId, { puzzle, answer }) {
  const state = ctx.state;
  const c = requireCreature(state, charId);
  const t = findTarget(state, puzzle);
  const p = t?.type === 'puzzle' ? t.puzzle : Object.values(world(state).puzzles).find(x => x.area === world(state).currentArea && !x.solved);
  if (!p) throw new RuleError('There is no puzzle here to solve.', 'not_found');
  if (p.solved) throw new RuleError(`${p.name} is already solved.`);
  if (p.failed) throw new RuleError(`${p.name} can no longer be solved.`);
  const key = answerKey(answer);
  if (!key) throw new RuleError('Give an answer.');
  p.attempts += 1;
  if (p.answers.includes(key)) {
    p.solved = true;
    event(ctx, 'puzzle', `${c.name} solves ${p.name}!${p.reward ? ` ${p.reward}` : ''}`, { puzzle: p.id, solved: true });
    if (p.unlocksExit) {
      const area = state.world.areas[p.area];
      const ex = area.exits.find(e => norm(e.dir) === norm(p.unlocksExit) || norm(e.toName) === norm(p.unlocksExit));
      if (ex) {
        ex.hidden = false;
        if (ex.door) ex.door.locked = false;
        event(ctx, 'explore', `The way ${ex.dir} opens.`);
      }
    }
    return { solved: true };
  }
  const left = p.maxAttempts - p.attempts;
  event(ctx, 'puzzle', `"${cleanText(answer, 120)}" is not the answer to ${p.name}. ${left > 0 ? `${left} attempt${left === 1 ? '' : 's'} left.` : 'No attempts left.'}`, { puzzle: p.id, solved: false });
  if (left <= 0) {
    p.failed = true;
    const trap = p.onFailTrap && Object.values(state.world.features).find(f => f.kind === 'trap' && (f.id === p.onFailTrap || norm(f.name) === norm(p.onFailTrap)) && f.armed);
    if (trap) triggerTrap(ctx, trap);
  }
  return { solved: false, left };
}

export function hint(ctx, charId, { puzzle }) {
  const state = ctx.state;
  noExploreInCombat(state);
  const c = requireCreature(state, charId);
  const t = findTarget(state, puzzle);
  const p = t?.type === 'puzzle' ? t.puzzle : Object.values(world(state).puzzles).find(x => x.area === world(state).currentArea && !x.solved);
  if (!p) throw new RuleError('There is no puzzle here.', 'not_found');
  if (p.solved) throw new RuleError(`${p.name} is already solved.`);
  if (p.hintsRevealed >= p.hints.length) throw new RuleError('There are no more clues to tease out of this puzzle.');
  const tryKey = `${c.id}:${p.hintsRevealed}`;
  if (p.hintTried[tryKey]) throw new RuleError(`${c.name} has already studied this as far as they can; someone else may see more.`);
  p.hintTried[tryKey] = true;
  const ck = abilityCheck(c, { skill: 'investigation', dc: p.hintDc, rng: ctx.rng, reason: `studying ${p.name}` });
  ctx.events.push({ type: 'check', text: `${c.name} studies ${p.name}: Investigation ${ck.total} vs DC ${p.hintDc} - ${ck.success ? 'insight' : 'nothing'}`, roll: ck });
  advance(state, 10);
  if (ck.success) {
    const h = p.hints[p.hintsRevealed];
    p.hintsRevealed += 1;
    event(ctx, 'puzzle', `Clue for ${p.name}: ${h}`, { puzzle: p.id });
  }
  return ck;
}

export function read(ctx, charId, { target }) {
  const state = ctx.state;
  const c = requireCreature(state, charId);
  const t = findTarget(state, target, { kinds: ['text'] });
  if (!t || t.type !== 'feature') throw new RuleError(`There is no writing called "${target}" here.`, 'not_found');
  const f = t.feature;
  const comprehend = activeEffects(c).some(e => e.comprehend);
  if (!comprehend && !(c.languages ?? []).some(l => norm(l) === norm(f.language))) {
    event(ctx, 'explore', `${c.name} cannot read ${f.language}.`);
    return { read: false };
  }
  f.read = true;
  event(ctx, 'explore', `${c.name} reads the ${f.name}: "${f.content}"`, { feature: f.id });
  return { read: true };
}

// NPC social mechanics
export function npcRecord(state, ref) {
  const npcs = (state.campaign.npcs = state.campaign.npcs ?? {});
  if (!ref) return null;
  if (Object.hasOwn(npcs, ref)) return npcs[ref];
  return Object.values(npcs).find(n => norm(n.name) === norm(ref)) ?? Object.values(npcs).find(n => norm(ref).length >= 3 && norm(n.name).split(' ').includes(norm(ref))) ?? null;
}

function requireNpc(state, ref) {
  const n = npcRecord(state, ref);
  if (!n) throw new RuleError(`No known NPC called "${ref}". Introduce them with create_npc first.`, 'not_found');
  n.attitude = n.attitude ?? 'indifferent';
  return n;
}

function npcBonus(n, skill) {
  const b = MONSTERS[n.statBlock ?? 'commoner'] ?? MONSTERS.commoner;
  const ab = SKILLS[skill];
  const score = b.abilities[['str', 'dex', 'con', 'int', 'wis', 'cha'].indexOf(ab)];
  return b.skills?.[skill] ?? Math.floor((score - 10) / 2);
}

function npcSaveBonus(n, ab) {
  const key = n.statBlock ?? 'commoner';
  return saveMod({ kind: 'monster', key, effects: [], conditions: [] }, ab);
}

function refreshNpcMagic(state, n) {
  const now = nowMinute(state);
  if (n.condition && n.condition.until != null) {
    const conc = n.condition.concentrationOf ? state.characters?.[n.condition.concentrationOf] : null;
    const lapsed = n.condition.until <= now || (n.condition.concentrationOf && conc?.concentration?.spell !== n.condition.spell);
    if (lapsed) n.condition = { state: 'awake', note: `recovered from ${n.condition.state}${n.condition.source ? ` (${n.condition.source})` : ''}`, at: now };
  }
  if (n.charmed && n.charmed.until <= now) {
    n.attitude = 'hostile';
    n.charmed = null;
    n.resentsCharm = true;
  }
  if (n.truthUntil && n.truthUntil <= now) n.truthUntil = null;
  if (n.lie && n.lie.until <= now) n.lie = null;
}

export function setAttitude(ctx, { npc, attitude, reason }) {
  const n = requireNpc(ctx.state, npc);
  refreshNpcMagic(ctx.state, n);
  if (!ATTITUDES.includes(attitude)) throw new RuleError(`Attitude must be ${ATTITUDES.join(', ')}.`);
  const from = ATTITUDES.indexOf(n.attitude);
  const to = ATTITUDES.indexOf(attitude);
  if (Math.abs(to - from) > 1) throw new RuleError(`Attitudes shift one step at a time (${n.name} is ${n.attitude}).`);
  n.attitude = attitude;
  event(ctx, 'social', `${n.name} is now ${attitude}${reason ? ` (${cleanText(reason, 120)})` : ''}.`);
}

// a character tries to get something from an NPC
export function socialCheck(ctx, { npc, character, approach = 'persuasion', request = 'minor', secret }) {
  const state = ctx.state;
  const n = requireNpc(state, npc);
  refreshNpcMagic(state, n);
  const c = requireCreature(state, character);
  if (!['persuasion', 'deception', 'intimidation', 'performance'].includes(approach)) throw new RuleError('Approach must be persuasion, deception, intimidation or performance.');
  let dc;
  let label;
  let sec = null;
  if (secret) {
    sec = (n.secrets ?? []).find(s => s.id === secret || norm(s.text).includes(norm(secret)));
    if (!sec) throw new RuleError(`${n.name} has no such secret.`);
    if (sec.revealed) throw new RuleError('That secret is already known.');
    dc = Math.min(30, sec.dc + (n.attitude === 'hostile' ? 5 : n.attitude === 'friendly' ? -5 : 0));
    label = 'reveal a secret';
  } else {
    if (!['trivial', 'minor', 'major'].includes(request)) throw new RuleError('Request size must be trivial, minor or major.');
    dc = SOCIAL_DC[n.attitude][request];
    label = `${request} request`;
    if (dc === null) {
      event(ctx, 'social', `${n.name} is hostile and will not take a major risk for ${c.name}, whatever is said.`);
      return { success: false, impossible: true };
    }
  }
  if (approach === 'deception') dc = Math.max(dc, 10 + npcBonus(n, 'insight'));
  if (dc <= 0) {
    event(ctx, 'social', `${n.name} agrees readily (${label}).`);
    return { success: true, dc: 0 };
  }
  const ck = abilityCheck(c, { skill: approach, dc, rng: ctx.rng, reason: `${approach} with ${n.name}`, disadvantage: approach === 'deception' && !!n.truthUntil });
  ctx.events.push({ type: 'check', text: `${c.name} ${approach} with ${n.name} (${n.attitude}, ${label}): ${ck.total} vs DC ${dc} - ${ck.success ? 'success' : 'failure'}`, roll: ck });
  const margin = ck.total - dc;
  if (ck.success) {
    if (sec) {
      sec.revealed = true;
      addClue(ctx, { title: `${n.name}'s secret`, content: sec.text });
    }
    if (approach === 'persuasion' && margin >= 10 && n.attitude !== 'friendly') setAttitude(ctx, { npc: n.name, attitude: ATTITUDES[ATTITUDES.indexOf(n.attitude) + 1], reason: 'won over' });
    if (approach === 'intimidation' && n.attitude !== 'hostile') setAttitude(ctx, { npc: n.name, attitude: ATTITUDES[ATTITUDES.indexOf(n.attitude) - 1], reason: 'resents the threat' });
  } else if (margin <= -10 || (approach === 'deception' && margin <= -5)) {
    if (n.attitude !== 'hostile') setAttitude(ctx, { npc: n.name, attitude: ATTITUDES[ATTITUDES.indexOf(n.attitude) - 1], reason: approach === 'deception' ? 'caught lying' : 'offended' });
  }
  return { success: ck.success, dc, total: ck.total, attitude: n.attitude };
}

export function addSecret(ctx, { npc, text, dc = 15 }) {
  const n = requireNpc(ctx.state, npc);
  n.secrets = n.secrets ?? [];
  if (n.secrets.length >= 10) throw new RuleError(`${n.name} already keeps enough secrets.`);
  const s = { id: uid('sc_'), text: cleanText(text, 600), dc: dcOk(dc), revealed: false };
  n.secrets.push(s);
  event(ctx, 'social', `${n.name} has a secret.`, { dmOnly: true });
  return s;
}

// DM marks that an NPC is lying right now; insight can catch it
export function npcLie(ctx, { npc, about }) {
  const n = requireNpc(ctx.state, npc);
  refreshNpcMagic(ctx.state, n);
  if (n.truthUntil) throw new RuleError(`${n.name} is inside a Zone of Truth and cannot deliberately lie.`, 'truth');
  n.lie = { about: cleanText(about, 200), until: nowMinute(ctx.state) + 30 };
  event(ctx, 'social', `${n.name} is lying.`, { dmOnly: true });
}

export function insightCheck(ctx, { character, npc }) {
  const state = ctx.state;
  const n = requireNpc(state, npc);
  refreshNpcMagic(state, n);
  const c = requireCreature(state, character);
  const dc = 10 + npcBonus(n, 'deception');
  const ck = abilityCheck(c, { skill: 'insight', dc, rng: ctx.rng, reason: `reading ${n.name}` });
  ctx.events.push({ type: 'check', text: `${c.name} reads ${n.name}: Insight ${ck.total} vs DC ${dc} - ${ck.success ? 'success' : 'failure'}`, roll: ck });
  if (ck.success) event(ctx, 'social', n.lie ? `${c.name} senses ${n.name} is lying about ${n.lie.about}.` : `${c.name} believes ${n.name} is being truthful.`);
  else event(ctx, 'social', `${c.name} cannot get a read on ${n.name}.`);
  return { success: ck.success, lying: ck.success ? !!n.lie : null };
}

export function adjustReputation(ctx, { faction, delta, reason }) {
  const w = world(ctx.state);
  const name = cleanText(faction, 60).trim();
  if (!name) throw new RuleError('Name the faction.');
  if (![-1, 1].includes(delta)) throw new RuleError('Reputation changes by one step at a time (-1 or +1).');
  const f = (w.factions[name] = w.factions[name] ?? { standing: 0 });
  f.standing = Math.max(-3, Math.min(3, f.standing + delta));
  event(ctx, 'social', `Reputation with ${name}: ${f.standing > 0 ? '+' : ''}${f.standing}${reason ? ` (${cleanText(reason, 120)})` : ''}.`);
}

export function addClue(ctx, { title, content }) {
  const w = world(ctx.state);
  if (w.clues.length >= 200) w.clues.shift();
  const c = { id: uid('cl_'), title: cleanText(title, 80), content: cleanText(content, 800), at: nowMinute(ctx.state) };
  w.clues.push(c);
  event(ctx, 'explore', `New clue: ${c.title}.`);
  return c;
}

// utility spells that touch the world; returns true when handled
export function explorationSpell(ctx, caster, sp, params, { dc, level }) {
  const state = ctx.state;
  const area = currentArea(state);
  const targetText = params.targetText ?? params.feature ?? null;
  const npcRef = params.npc ?? targetText;
  switch (sp.key) {
    case 'detectMagic': {
      const seen = [];
      if (area) {
        for (const f of areaFeatures(state, area)) {
          if (f.magic) {
            seen.push(`${f.hidden ? 'something hidden' : f.name}: ${f.magic}`);
            if (f.kind === 'trap' && f.hidden) f.hidden = false;
          }
        }
        for (const e of area.exits) if (e.door?.magical && e.door.locked) seen.push(`${e.door.name}: abjuration`);
      }
      for (const c of party(state)) for (const it of c.inventory) {
        const d = itemDef(it);
        if (d && ['magicWeapon', 'magicArmor', 'wondrous', 'wand', 'staff', 'potion', 'scroll'].includes(d.kind)) seen.push(`${c.name}'s ${it.custom?.name ?? d.name}`);
      }
      event(ctx, 'explore', seen.length ? `${caster.name} senses magic: ${seen.join('; ')}.` : `${caster.name} senses no magic nearby.`);
      return true;
    }
    case 'findTraps': {
      const n = area ? areaFeatures(state, area).filter(f => f.kind === 'trap' && f.armed).length : 0;
      event(ctx, 'explore', n ? `${caster.name} senses ${n} trap${n === 1 ? '' : 's'} within range, though not exactly where.` : `${caster.name} senses no traps.`);
      return true;
    }
    case 'knock': {
      const t = findTarget(state, targetText);
      const l = t && lockOf(t);
      if (!l) throw new RuleError(`Knock needs a locked door or object here to target${targetText ? ` ("${targetText}" is not one)` : ''}.`);
      l.lock.locked = false;
      event(ctx, 'explore', `A loud knock rings out and the ${l.name} unlocks${l.lock.magical ? ', its magical seal suppressed' : ''}.`);
      revealContents(ctx, t);
      return true;
    }
    case 'comprehendLanguages':
    case 'tongues': {
      addEffect(ctx, caster, { name: sp.name, comprehend: true, minutes: 60 }, { sourceId: caster.id, spell: sp.key });
      event(ctx, 'explore', `${caster.name} can understand any language for the next hour.`);
      return true;
    }
    case 'light':
      if (state.scene?.light === 'dark') state.scene.light = 'dim';
      event(ctx, 'explore', `${caster.name}'s light pushes back the darkness.`);
      return true;
    case 'daylight':
      state.scene = { ...(state.scene ?? {}), light: 'bright' };
      event(ctx, 'explore', 'Bright daylight floods the area.');
      return true;
    case 'darkness':
      state.scene = { ...(state.scene ?? {}), light: 'dark' };
      event(ctx, 'explore', 'Magical darkness swallows the area.');
      return true;
    case 'dispelMagic': {
      const t = findTarget(state, targetText);
      if (!t) return false;
      if (t.type === 'feature' && t.feature.kind === 'trap' && t.feature.magic && t.feature.armed) {
        t.feature.armed = false;
        t.feature.disarmed = true;
        event(ctx, 'explore', `The ${t.feature.name}'s magic unravels; the trap is inert.`);
        return true;
      }
      const l = lockOf(t);
      if (l?.lock.magical) {
        l.lock.magical = false;
        event(ctx, 'explore', `The magical seal on the ${l.name} fades (the mundane lock remains${l.lock.locked ? '' : ' open'}).`);
        return true;
      }
      if (t.type === 'feature' && t.feature.magic) {
        t.feature.magic = null;
        event(ctx, 'explore', `The magic of the ${t.feature.name} is dispelled.`);
        return true;
      }
      throw new RuleError(`${targetText} has no magic to dispel.`);
    }
    case 'identify': {
      const inv = caster.inventory.find(i => norm(i.custom?.name ?? itemDef(i)?.name) === norm(targetText ?? '') || (targetText && norm(itemDef(i)?.name).includes(norm(targetText))));
      if (!inv) throw new RuleError('Identify needs an item you are holding.');
      const d = itemDef(inv);
      const facts = [d.rarity ? `${d.rarity} magic item` : 'not magical', d.bonus ? `+${d.bonus} bonus` : null, d.attunement ? 'requires attunement' : null, inv.charges !== undefined ? `${inv.charges} charges` : null, d.castsSpell ? `casts ${SPELLS[d.castsSpell.spell]?.name}` : null, d.passive ? `grants ${Object.keys(d.passive).join(', ')}` : null].filter(Boolean);
      event(ctx, 'explore', `${caster.name} identifies ${inv.custom?.name ?? d.name}: ${facts.join(', ')}.`);
      return true;
    }
    case 'charmPerson':
    case 'suggestion':
    case 'calmEmotions':
    case 'zoneOfTruth': {
      const n = npcRecord(state, npcRef);
      if (!n || inCombat(state)) return false;
      refreshNpcMagic(state, n);
      n.attitude = n.attitude ?? 'indifferent';
      const saveAb = sp.key === 'zoneOfTruth' || sp.key === 'calmEmotions' ? 'cha' : 'wis';
      const b = npcSaveBonus(n, saveAb);
      const d = rollD20(ctx.rng);
      const total = d.natural + b;
      const ok = total >= dc;
      ctx.events.push({ type: 'save', text: `${n.name} ${saveAb.toUpperCase()} save vs ${sp.name}: ${total} vs DC ${dc} - ${ok ? 'resists' : 'affected'}`, roll: { natural: d.natural, rolls: d.rolls, total, dc, success: ok } });
      if (ok) {
        event(ctx, 'social', `${n.name} resists the ${sp.name}${sp.key === 'charmPerson' ? ' and knows someone tried to charm them' : ''}.`);
        if (sp.key === 'charmPerson' && n.attitude !== 'hostile') n.attitude = ATTITUDES[ATTITUDES.indexOf(n.attitude) - 1];
        return true;
      }
      const now = nowMinute(state);
      if (sp.key === 'charmPerson') {
        n.charmed = { by: caster.id, until: now + 60, prior: n.attitude };
        n.attitude = 'friendly';
        event(ctx, 'social', `${n.name} regards ${caster.name} as a friendly acquaintance for the next hour (and will know afterwards).`);
      } else if (sp.key === 'suggestion') {
        n.suggested = { by: caster.id, text: cleanText(params.choice ?? params.suggestion ?? 'the suggested course', 200), until: now + 480 };
        event(ctx, 'social', `${n.name} is compelled to pursue the suggestion.`);
      } else if (sp.key === 'calmEmotions') {
        if (n.attitude === 'hostile') n.attitude = 'indifferent';
        event(ctx, 'social', `${n.name}'s hostility drains away.`);
      } else {
        n.truthUntil = now + 10;
        n.lie = null;
        event(ctx, 'social', `${n.name} cannot deliberately lie for the next 10 minutes.`);
      }
      void level;
      return true;
    }
    default:
      return false;
  }
}

// what players may see: hidden things and answers stay with the DM
export function worldView(state) {
  const w = world(state);
  const area = currentArea(state);
  const visibleExit = e => (e.hidden ? null : { dir: e.dir, to: publicPlace(e.toName) ?? '', door: e.door ? { name: e.door.name, locked: e.door.locked, magical: e.door.magical && e.door.locked, broken: e.door.broken } : null, minutes: e.minutes });
  const feature = f => {
    const out = { id: f.id, kind: f.kind, name: f.name, description: f.description };
    if (f.kind === 'trap') Object.assign(out, { armed: f.armed, disarmed: !!f.disarmed, triggered: !!f.triggered });
    if (f.kind === 'text') Object.assign(out, { language: f.language, content: f.read ? f.content : null });
    if (f.kind === 'clue' || f.kind === 'secret') out.content = f.content;
    if (f.lock) out.lock = { locked: f.lock.locked, magical: f.lock.magical && f.lock.locked };
    return out;
  };
  return {
    area: area ? { id: area.id, name: publicPlace(area.name, state.scene?.location) ?? '', description: area.description, exits: area.exits.map(visibleExit).filter(Boolean) } : null,
    features: area ? areaFeatures(state, area).filter(f => !f.hidden).map(feature) : [],
    maze: area?.maze ? { name: area.maze.name, out: !!area.maze.goal } : null,
    puzzles: area ? Object.values(w.puzzles).filter(p => p.area === area.id).map(p => ({ id: p.id, name: p.name, prompt: p.prompt, hints: p.hints.slice(0, p.hintsRevealed), hintsLeft: p.hints.length - p.hintsRevealed, attempts: p.attempts, maxAttempts: p.maxAttempts, solved: p.solved, failed: p.failed, reward: p.solved ? p.reward : null })) : [],
    visited: Object.values(w.areas).filter(a => a.visited).map(a => ({ id: a.id, name: publicPlace(a.name) ?? '' })).filter(a => a.name),
    factions: Object.entries(w.factions).map(([name, f]) => ({ name, standing: f.standing })),
    clues: w.clues,
  };
}

// full detail for the DM prompt
export function worldBlock(state) {
  const w = world(state);
  const area = currentArea(state);
  if (!area && !Object.keys(w.areas).length && !w.clues.length) return null;
  const lines = [];
  if (area) {
    lines.push(`Current area: ${area.name}. ${area.description}${area.maze ? ` [maze ${area.maze.name}: ${area.maze.goal ? 'exit cell' : `${area.maze.toGoal} steps from the exit`}, navigation DC ${area.maze.dc}]` : ''}`);
    lines.push(`Exits: ${area.exits.map(e => `${e.dir} -> ${e.toName}${findArea(state, e.toName) ? '' : ' (unmapped)'}${e.hidden ? ` [hidden, DC ${e.detectDc}]` : ''}${e.door ? ` [${e.door.name}${e.door.locked ? `, locked DC ${e.door.dc}${e.door.magical ? ', magical' : ''}` : ', unlocked'}]` : ''}`).join('; ') || 'none'}`);
    for (const f of areaFeatures(state, area)) lines.push(`- ${f.kind} "${f.name}" [id ${f.id}]${f.hidden ? ` [hidden, DC ${f.detectDc}]` : ''}${f.magic ? ` [magic: ${f.magic}]` : ''}${f.kind === 'trap' ? ` [${f.armed ? 'armed' : 'inert'}, disarm DC ${f.disarmDc}, trigger ${f.trigger}, ${f.effect.save.toUpperCase()} DC ${f.effect.dc}${f.effect.damage ? ` ${f.effect.damage} ${f.effect.damageType}` : ''}${f.effect.condition ? ` ${f.effect.condition}` : ''}]` : ''}${f.lock ? ` [lock DC ${f.lock.dc}${f.lock.locked ? '' : ', open'}]` : ''}${f.content ? `: ${f.content}` : ''}${f.kind === 'text' ? ` (${f.language})` : ''}`);
    for (const p of Object.values(w.puzzles).filter(x => x.area === area.id)) lines.push(`- puzzle "${p.name}" [id ${p.id}] ${p.solved ? 'SOLVED' : p.failed ? 'FAILED' : `attempts ${p.attempts}/${p.maxAttempts}`}: ${p.prompt} (accepted answers: ${p.answers.join(' | ')}; hints revealed ${p.hintsRevealed}/${p.hints.length})`);
  }
  const others = Object.values(w.areas).filter(a => a.id !== area?.id).map(a => `${a.name}${a.visited ? '' : ' (unvisited)'}`);
  if (others.length) lines.push(`Other mapped areas: ${others.join(', ')}`);
  const fac = Object.entries(w.factions);
  if (fac.length) lines.push(`Faction standing: ${fac.map(([n, f]) => `${n} ${f.standing > 0 ? '+' : ''}${f.standing}`).join(', ')}`);
  if (w.clues.length) lines.push(`Clues found: ${w.clues.slice(-10).map(c => c.title).join('; ')}`);
  return lines.join('\n');
}

export const NPC_STATES = ['awake', 'asleep', 'unconscious', 'paralyzed', 'incapacitated', 'restrained', 'frightened', 'blinded', 'prone', 'dead', 'gone'];

const STATE_NOTE = {
  asleep: 'ALIVE, magically asleep; wakes if damaged or someone uses an action to shake them',
  unconscious: 'ALIVE but unconscious',
  paralyzed: 'ALIVE, paralyzed and aware',
  incapacitated: 'ALIVE, incapacitated',
  restrained: 'ALIVE, restrained',
  frightened: 'ALIVE, frightened of the caster',
  blinded: 'ALIVE, blinded',
  prone: 'ALIVE, prone',
  dead: 'DEAD',
  gone: 'has left the scene',
};

export function npcStatus(state, n) {
  refreshNpcMagic(state, n);
  const c = n.condition;
  if (!c || c.state === 'awake') return c?.note && nowMinute(state) - (c.at ?? 0) <= 60 ? `awake (${c.note})` : null;
  const until = c.until != null ? `, until ${clockText(c.until)}` : '';
  return `${STATE_NOTE[c.state] ?? c.state}${c.source ? ` from ${c.source}` : ''}${until}`;
}

const clockText = m => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// the DM records what happened to an NPC so later narration does not contradict it
export function setNpcCondition(ctx, { npc, state: st, reason, minutes }) {
  const n = requireNpc(ctx.state, npc);
  if (!NPC_STATES.includes(st)) throw new RuleError(`State must be one of ${NPC_STATES.join(', ')}.`);
  const now = nowMinute(ctx.state);
  n.condition = st === 'awake' ? { state: 'awake', note: cleanText(reason ?? 'awake', 120), at: now } : { state: st, source: reason ? cleanText(reason, 120) : null, at: now, until: minutes ? now + minutes : null };
  event(ctx, 'social', st === 'awake' ? `${n.name} is up and about.` : `${n.name}: ${STATE_NOTE[st] ?? st}.`);
}

// control spells cast at NPCs outside combat (Sleep on a guard, Hold Person on a fleeing thief)
export function npcControlSpell(ctx, caster, sp, npcs, { dc, level }) {
  const state = ctx.state;
  const eff = sp.effect;
  const now = nowMinute(state);
  const minutes = sp.duration === '1 round' ? 1 : /hour/.test(sp.duration ?? '') ? 60 : /10 minutes/.test(sp.duration ?? '') ? 10 : 1;
  const conc = sp.concentration ? { concentrationOf: caster.id, spell: sp.key } : {};
  const statBlock = n => MONSTERS[n.statBlock ?? 'commoner'] ?? MONSTERS.commoner;
  const live = npcs.filter(n => {
    refreshNpcMagic(state, n);
    return !['dead', 'gone'].includes(n.condition?.state);
  });
  if (!live.length) throw new RuleError(`${npcs.map(n => n.name).join(', ')} cannot be affected.`);
  if (eff.type === 'sleep') {
    let pool = roll(eff.pool.replace(/^(\d+)d/, (_, k) => `${Number(k) + (level - sp.level) * Number(eff.upcastPool.split('d')[0])}d`), ctx.rng).total;
    event(ctx, 'info', `Sleep affects up to ${pool} hit points of creatures.`);
    const cands = live.filter(n => !['asleep', 'unconscious'].includes(n.condition?.state) && statBlock(n).type !== 'undead' && !statBlock(n).condImmune?.includes('charmed')).map(n => ({ n, hp: Math.floor(averageOf(statBlock(n).hp)) })).sort((a, b) => a.hp - b.hp);
    let any = false;
    for (const { n, hp } of cands) {
      if (hp > pool) break;
      pool -= hp;
      any = true;
      n.condition = { state: 'asleep', source: sp.name, at: now, until: now + minutes, spell: sp.key };
      event(ctx, 'condition', `${n.name} falls into a magical slumber (alive, asleep for up to a minute or until hurt or shaken awake).`);
    }
    if (!any) event(ctx, 'info', `The magic washes over ${live.map(n => n.name).join(', ')} without effect.`);
    return true;
  }
  if (eff.type === 'powerWord') {
    const n = live[0];
    const hp = Math.floor(averageOf(statBlock(n).hp));
    if (hp > eff.threshold) event(ctx, 'info', `${n.name} has too many hit points to be affected.`);
    else {
      n.condition = { state: 'incapacitated', source: `${sp.name} (stunned)`, at: now, until: now + 1, spell: sp.key };
      event(ctx, 'condition', `${n.name} is stunned.`);
    }
    return true;
  }
  const max = (eff.targets ?? 1) + (eff.upcastTargets ? eff.upcastTargets * (level - sp.level) : 0);
  if (!eff.area && live.length > max) throw new RuleError(`${sp.name} can affect at most ${max} creature${max === 1 ? '' : 's'} at this level.`);
  for (const n of live) {
    const type = statBlock(n).type;
    if (eff.creatureType && !eff.creatureType.includes(type)) throw new RuleError(`${sp.name} only affects ${eff.creatureType.join(' or ')} creatures; ${n.name} is a ${type}.`);
    if (eff.notTypes?.includes(type)) throw new RuleError(`${sp.name} has no effect on ${type} creatures.`);
  }
  for (const n of live) {
    const b = npcSaveBonus(n, eff.save);
    const d = rollD20(ctx.rng);
    const total = d.natural + b;
    const ok = total >= dc;
    ctx.events.push({ type: 'save', text: `${n.name} ${eff.save.toUpperCase()} save vs ${sp.name}: ${total} vs DC ${dc} - ${ok ? 'resists' : 'affected'}`, roll: { natural: d.natural, rolls: d.rolls, total, dc, success: ok } });
    if (ok) {
      event(ctx, 'condition', `${n.name} shrugs off the ${sp.name}.`);
      continue;
    }
    if (eff.command) {
      n.condition = { state: 'incapacitated', source: `${sp.name}: obeys a one-word command`, at: now, until: now + 1, spell: sp.key };
      event(ctx, 'condition', `${n.name} must obey the command on their next turn.`);
      continue;
    }
    const conds = eff.onFail?.conditions ?? [];
    const st = conds.includes('paralyzed') ? 'paralyzed' : conds.includes('unconscious') ? 'unconscious' : conds.includes('incapacitated') ? 'incapacitated' : conds.includes('restrained') ? 'restrained' : conds.includes('frightened') ? 'frightened' : conds.includes('blinded') ? 'blinded' : conds.includes('prone') ? 'prone' : 'incapacitated';
    n.condition = { state: st, source: sp.name, at: now, until: now + minutes, ...conc };
    event(ctx, 'condition', `${n.name} is ${st} by ${sp.name}${eff.onFail?.saveEnds ? ' (repeating the save every few seconds)' : ''}.`);
  }
  return true;
}

export function npcLine(state, n) {
  refreshNpcMagic(state, n);
  const bits = [n.attitude ?? 'indifferent'];
  const status = npcStatus(state, n);
  if (status) bits.unshift(status);
  if (n.charmed) bits.push('charmed');
  if (n.truthUntil) bits.push('cannot lie');
  if (n.lie) bits.push(`currently lying about ${n.lie.about}`);
  if (n.suggested) bits.push(`under suggestion: ${n.suggested.text}`);
  const secrets = (n.secrets ?? []).filter(s => !s.revealed).map(s => `${s.text} (DC ${s.dc}, id ${s.id})`);
  return `${n.name} (${n.role}; ${bits.join(', ')}): ${n.personality}${secrets.length ? ` Secrets: ${secrets.join('; ')}` : ''}`;
}

export { partyLevel, findMonsterKey };
