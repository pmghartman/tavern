import { SKILLS, ABILITY_NAMES, HAZARD_DAMAGE, tierOf, MAX_GOLD_AWARD, RARITY_MIN_LEVEL, ENCOUNTER_THRESHOLDS, CR_XP, encounterMultiplier, DAMAGE_TYPES, CONDITIONS } from './data/core.js';
import { ITEMS, WEAPONS, ARMOR, findItemKey } from './data/items.js';
import { MONSTERS, findMonsterKey } from './data/monsters.js';
import { roll, parseDice, maxOf } from './dice.js';
import { abilityCheck, savingThrow, contest, describeRoll } from './checks.js';
import { RuleError, publicPlace } from './util.js';
import { event, inCombat, requireCreature, creatureById } from './state.js';
import { startEncounter, endEncounter, addToEncounter, removeFromCombat, auraBonusFor } from './combat.js';
import { applyDamage } from './damage.js';
import { addEffect } from './effects.js';
import { addItem } from './inventory.js';
import { refreshLevelState } from './character.js';
import { advanceTime } from './rest.js';

const VALID_DCS = [5, 10, 15, 20, 25, 30];

// published adventures run as printed: their encounters, traps and treasure skip the balance caps
export const byTheBook = state => !!(state.campaign?.settings?.official || state.campaign?.outline?.adventure);

export function partyLevel(state) {
  const chars = Object.values(state.characters).filter(c => !c.dead);
  if (!chars.length) return 1;
  return Math.max(1, Math.round(chars.reduce((s, c) => s + c.level, 0) / chars.length));
}

function validateDc(dc) {
  if (!Number.isInteger(dc) || dc < 5 || dc > 30) throw new RuleError('DCs must be whole numbers from 5 (very easy) to 30 (nearly impossible).', 'bad_dc');
  return dc;
}

export function requestCheck(ctx, { character, skill, ability, dc, advantage = false, disadvantage = false, reason }) {
  const c = requireCreature(ctx.state, character);
  if (skill && !SKILLS[skill]) throw new RuleError(`Unknown skill "${skill}".`);
  if (!skill && !ABILITY_NAMES[ability]) throw new RuleError(`Unknown ability "${ability}".`);
  if (c.dead) throw new RuleError(`${c.name} is dead.`);
  if (c.hp <= 0) throw new RuleError(`${c.name} is unconscious.`);
  if (dc !== undefined && dc !== null) validateDc(dc);
  const r = abilityCheck(c, { skill, ability, dc: dc ?? undefined, advantage, disadvantage, rng: ctx.rng, reason });
  ctx.events.push({ type: 'check', text: describeRoll(r), roll: r, character: c.id });
  return r;
}

export function groupCheck(ctx, { skill, ability, dc, reason, characters }) {
  validateDc(dc);
  const ids = characters ?? Object.values(ctx.state.characters).filter(c => !c.dead && c.hp > 0).map(c => c.id);
  const results = ids.map(id => requestCheck(ctx, { character: id, skill, ability, dc, reason }));
  const passed = results.filter(r => r.success).length;
  const success = passed >= Math.ceil(results.length / 2);
  event(ctx, 'check', `Group check: ${passed}/${results.length} succeed - ${success ? 'the group succeeds' : 'the group fails'}.`);
  return { success, results };
}

export function requestSave(ctx, { character, ability, dc, reason, damage, damageType, halfOnSave = true, condition, severity }) {
  const state = ctx.state;
  const c = requireCreature(state, character);
  validateDc(dc);
  if (!ABILITY_NAMES[ability]) throw new RuleError(`Unknown ability "${ability}".`);
  if (damage) validateHazard(state, damage, damageType, severity);
  if (condition && !CONDITIONS[condition]) throw new RuleError(`Unknown condition "${condition}".`);
  const sv = savingThrow(c, ability, { dc, rng: ctx.rng, reason, against: damageType === 'poison' || condition === 'poisoned' ? 'poison' : condition, auraBonus: auraBonusFor(state, c) });
  ctx.events.push({ type: 'save', text: describeRoll(sv), roll: sv, character: c.id });
  if (damage) {
    const r = roll(damage, ctx.rng);
    const amt = sv.success ? (halfOnSave ? Math.floor(r.total / 2) : 0) : r.total;
    if (amt > 0) applyDamage(ctx, c, [{ amount: amt, type: damageType, magical: false }], { source: reason ?? 'hazard' });
  }
  if (condition && !sv.success && !c.dead) {
    addEffect(ctx, c, { name: `${condition} (${reason ?? 'hazard'})`, conditions: [condition], minutes: condition === 'poisoned' ? 60 : 1, rounds: 10 }, { sourceId: 'dm' });
    event(ctx, 'condition', `${c.name} is ${condition}.`);
  }
  return sv;
}

export function validateHazard(state, dice, type, severity = 'dangerous') {
  if (!DAMAGE_TYPES.includes(type)) throw new RuleError(`Unknown damage type "${type}".`);
  parseDice(dice);
  const cap = HAZARD_DAMAGE[tierOf(partyLevel(state))][severity];
  if (!cap) throw new RuleError('Severity must be setback, dangerous or deadly.');
  if (!byTheBook(state) && maxOf(dice) > maxOf(cap)) throw new RuleError(`Hazard damage ${dice} exceeds the ${severity} limit for this party level (${cap}).`, 'hazard_cap');
}

export function contestCheck(ctx, { a, aSkill, b, bSkill, reason }) {
  const ca = requireCreature(ctx.state, a);
  const cb = requireCreature(ctx.state, b);
  const r = contest(ca, { skill: aSkill }, cb, { skill: bSkill }, ctx.rng);
  event(ctx, 'check', `Contest${reason ? ` (${reason})` : ''}: ${ca.name} ${r.attacker.total} vs ${cb.name} ${r.defender.total} - ${r.winner === 'attacker' ? ca.name : cb.name} wins.`, { roll: r });
  return r;
}

export function encounterDifficulty(state, monsters) {
  const chars = Object.values(state.characters).filter(c => !c.dead);
  const th = [0, 0, 0, 0];
  for (const c of chars) ENCOUNTER_THRESHOLDS[c.level].forEach((v, i) => (th[i] += v));
  let xp = 0;
  let count = 0;
  for (const m of monsters) {
    const n = m.count ?? 1;
    xp += (CR_XP[MONSTERS[m.key].cr] ?? 0) * n;
    count += n;
  }
  const adjusted = Math.round(xp * encounterMultiplier(count) * (chars.length < 3 ? 1.5 : chars.length > 5 ? 0.5 : 1));
  const label = adjusted >= th[3] * 1.5 ? 'beyond deadly' : adjusted >= th[3] ? 'deadly' : adjusted >= th[2] ? 'hard' : adjusted >= th[1] ? 'medium' : adjusted >= th[0] ? 'easy' : 'trivial';
  return { xp, adjusted, thresholds: { easy: th[0], medium: th[1], hard: th[2], deadly: th[3] }, label };
}

export function dmStartCombat(ctx, spec) {
  const state = ctx.state;
  const monsters = (spec.monsters ?? []).map(m => {
    const key = findMonsterKey(m.key ?? m.name ?? m.monster);
    if (!key) throw new RuleError(`"${m.key ?? m.name}" is not an SRD creature. Available: ${Object.values(MONSTERS).map(x => x.name).join(', ')}.`, 'unknown_monster');
    return { ...m, key };
  });
  if (!monsters.length) throw new RuleError('Combat needs at least one creature.');
  const diff = encounterDifficulty(state, monsters.filter(m => (m.side ?? 'enemy') === 'enemy'));
  if (diff.label === 'beyond deadly' && !state.campaign?.settings?.allowDeadly && !byTheBook(state)) {
    throw new RuleError(`That encounter is far beyond deadly for this party (${diff.adjusted} adjusted XP vs deadly ${diff.thresholds.deadly}). Choose fewer or weaker creatures.`, 'too_deadly');
  }
  const enc = startEncounter(ctx, { ...spec, monsters });
  enc.difficulty = diff;
  for (const c of Object.values(state.characters)) c.preparationOpen = false;
  return enc;
}

export function awardXp(ctx, { amount, reason, characters }) {
  const state = ctx.state;
  if (state.campaign?.settings?.leveling === 'milestone') throw new RuleError('This campaign uses milestone leveling; grant a milestone instead.');
  if (!Number.isInteger(amount) || amount < 1) throw new RuleError('XP must be a positive whole number.');
  const lvl = partyLevel(state);
  const cap = ENCOUNTER_THRESHOLDS[lvl][2];
  if (amount > cap && !byTheBook(state)) throw new RuleError(`Non-combat XP awards are capped at a hard encounter's worth per character (${cap} XP at level ${lvl}).`, 'xp_cap');
  const ids = characters ?? Object.values(state.characters).filter(c => !c.dead).map(c => c.id);
  for (const id of ids) {
    const c = requireCreature(state, id);
    c.xp += amount;
    refreshLevelState(c);
  }
  event(ctx, 'xp', `${ids.map(id => creatureById(state, id).name).join(', ')} gain${ids.length === 1 ? 's' : ''} ${amount} XP${reason ? ` (${reason})` : ''}.`);
}

export function grantMilestone(ctx, { reason }) {
  const state = ctx.state;
  if (state.campaign?.settings?.leveling !== 'milestone') throw new RuleError('This campaign uses XP; award XP instead.');
  const now = Date.now();
  const last = state.campaign.lastMilestoneAt ?? 0;
  if (state.campaign.milestoneSessionsMin && now - last < 0) void 0;
  for (const c of Object.values(state.characters)) {
    if (c.dead || c.level >= 20) continue;
    if ((c.milestoneLevels ?? 0) > 0) throw new RuleError(`${c.name} has not yet taken their previous level.`);
    c.milestoneLevels = 1;
    c.pendingLevelUp = true;
  }
  state.campaign.lastMilestoneAt = now;
  event(ctx, 'xp', `Milestone reached${reason ? `: ${reason}` : ''}! Every character may level up.`);
}

export function giveLoot(ctx, { character, item, qty = 1, base, gold }) {
  const state = ctx.state;
  const c = requireCreature(state, character);
  if (inCombat(state)) throw new RuleError('Loot is distributed after combat.');
  const lvl = partyLevel(state);
  if (gold) {
    if (!Number.isInteger(gold) || gold < 1) throw new RuleError('Gold must be a positive whole number.');
    const cap = MAX_GOLD_AWARD[tierOf(lvl)];
    if (gold > cap && !byTheBook(state)) throw new RuleError(`A single treasure award is capped at ${cap} gp for this party level.`, 'gold_cap');
    c.currency.gp += gold;
    event(ctx, 'loot', `${c.name} receives ${gold} gp.`);
    return;
  }
  const key = findItemKey(item);
  if (!key) throw new RuleError(`"${item}" is not an item in this rule set.`, 'unknown_item');
  const d = ITEMS[key];
  if (d.rarity && RARITY_MIN_LEVEL[d.rarity] > lvl && !byTheBook(state)) throw new RuleError(`${d.name} is ${d.rarity}; too powerful for a level ${lvl} party (needs level ${RARITY_MIN_LEVEL[d.rarity]}).`, 'rarity_cap');
  let custom = null;
  if (d.baseChoice) {
    const pool = d.kind === 'magicWeapon' ? WEAPONS : ARMOR;
    const bk = Object.keys(pool).find(k => k === base || pool[k].name.toLowerCase() === String(base ?? '').toLowerCase());
    if (!bk || (d.kind === 'magicArmor' && pool[bk].category === 'shield')) throw new RuleError(`${d.name} needs a base ${d.kind === 'magicWeapon' ? 'weapon' : 'armor'} (e.g. longsword).`);
    custom = { base: bk, name: `+${d.bonus} ${pool[bk].name}`, weight: pool[bk].weight };
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > (d.rarity && d.rarity !== 'common' ? 3 : 100)) throw new RuleError('That quantity is not allowed for a single award.');
  addItem(c, key, qty, custom);
  event(ctx, 'loot', `${c.name} receives ${qty > 1 ? `${qty}x ` : ''}${custom?.name ?? d.name}.`);
}

export function setScene(ctx, { location, light, shop, description }) {
  const s = (ctx.state.scene = ctx.state.scene ?? {});
  if (location !== undefined) s.location = (publicPlace(location, s.location, description) ?? s.location ?? '').slice(0, 120) || null;
  if (description !== undefined) s.description = String(description).slice(0, 1000);
  if (light !== undefined) {
    if (!['bright', 'dim', 'dark', 'sunlight'].includes(light)) throw new RuleError('Light must be bright, dim, dark or sunlight.');
    s.light = light;
  }
  if (shop !== undefined) {
    if (shop === null || shop === false) s.shop = null;
    else {
      const items = shop.items ? shop.items.map(i => findItemKey(i)).filter(Boolean) : null;
      const priceMod = shop.priceMod ?? 1;
      if (priceMod < 0.5 || priceMod > 2) throw new RuleError('Shop prices may vary between 50% and 200%.');
      if (items && !byTheBook(ctx.state)) for (const k of items) if (ITEMS[k].rarity && RARITY_MIN_LEVEL[ITEMS[k].rarity] > partyLevel(ctx.state)) throw new RuleError(`${ITEMS[k].name} is too rare for this shop.`);
      s.shop = { name: shop.name ?? 'Merchant', items, priceMod, magic: !!shop.magic };
    }
  }
  event(ctx, 'scene', `Scene: ${s.location ?? 'unknown'}${s.light ? ` (${s.light})` : ''}${s.shop ? `; ${s.shop.name} is open for trade` : ''}.`);
}

export { endEncounter, addToEncounter, removeFromCombat, advanceTime };
