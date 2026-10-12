import { classLabel } from '../engine/classlevel.js';
import { featsOf } from '../engine/feats.js';
import { FEATS } from '../engine/data/feats.js';
import { RACES } from '../engine/data/races.js';
import { CLASSES, subclassKey } from '../engine/data/classes.js';
import { SPELLS } from '../engine/data/spells.js';
import { MONSTERS, isSrdMonster } from '../engine/data/monsters.js';
import { SKILL_NAMES } from '../engine/data/core.js';
import { armorClass, speed, conditionSet, passivePerception, skillMod, saveMod } from '../engine/creature.js';
import { castableSpells, spellcastingStats, itemDef, finalAbilities, xpToNext } from '../engine/character.js';
import { attackProfiles } from '../engine/attack.js';
import { creatureById, currentCid } from '../engine/state.js';
import { clockLabel } from '../engine/rest.js';
import { describeHealth } from './monsterAI.js';
import { fmtMod } from '../engine/util.js';

export function charLine(c) {
  const conds = [...conditionSet(c)].filter(x => x !== 'exhaustion');
  const status = c.dead ? 'DEAD' : c.hp <= 0 ? (c.stable ? 'unconscious (stable)' : `dying (${c.deathSaves.successes}S/${c.deathSaves.failures}F)`) : `HP ${c.hp}/${c.maxHp}${c.tempHp ? ` +${c.tempHp} temp` : ''}`;
  const slots = c.pactSlots ? `pact slots ${c.pactSlots.max - c.pactSlots.used}/${c.pactSlots.max} (lvl ${c.pactSlots.level})` : Object.entries(c.slots ?? {}).map(([l, s]) => `L${l} ${s.max - s.used}/${s.max}`).join(' ');
  const res = Object.values(c.resources ?? {}).map(r => `${r.name} ${r.max - r.used}/${r.max}`).join(', ');
  return `- ${c.name} [id ${c.id}]: L${c.level} ${RACES[c.race]?.name} ${classLabel(c, CLASSES)}; ${status}; AC ${armorClass(c)}; speed ${speed(c)}; passive Perception ${passivePerception(c)}${conds.length ? `; conditions: ${conds.join(', ')}` : ''}${c.exhaustion ? `; exhaustion ${c.exhaustion}` : ''}${c.concentration ? `; concentrating on ${c.concentration.name}` : ''}${slots ? `; slots ${slots}` : ''}${res ? `; ${res}` : ''}${c.wildShape ? `; in beast form (${MONSTERS[c.wildShape.beast].name}, ${c.wildShape.hp} HP)` : ''}`;
}

export function partyBlock(state) {
  const chars = Object.values(state.characters);
  if (!chars.length) return 'No characters have joined yet.';
  return chars.map(charLine).join('\n');
}

export function characterDetail(c) {
  const a = finalAbilities(c);
  const spells = [...castableSpells(c).keys()].map(k => SPELLS[k]?.name).filter(Boolean);
  const attacks = attackProfiles({ characters: {}, encounter: null }, c).map(p => `${p.name} ${fmtMod(p.toHit)} (${p.damage.dice ?? p.damage.flat}${p.damage.bonus ? fmtMod(p.damage.bonus) : ''} ${p.damage.type})`);
  const skills = (c.skills ?? []).map(s => `${SKILL_NAMES[s]} ${fmtMod(skillMod(c, s))}`).join(', ');
  const inv = c.inventory.map(i => `${itemDef(i)?.custom?.name ?? i.custom?.name ?? itemDef(i)?.name}${i.qty > 1 ? ` x${i.qty}` : ''}${i.equipped ? ' (equipped)' : ''}`).join(', ');
  const d = c.description ?? {};
  return [
    `${c.name}: ${d.pronouns ? `(${d.pronouns}) ` : ''}${RACES[c.race]?.name} ${classLabel(c, CLASSES)}${c.subclass ? ` (${CLASSES[c.class]?.subclasses?.[subclassKey(c.class, c.subclass)]?.name ?? c.subclass})` : ''}, ${c.alignment}, background ${c.background}.`,
    `Abilities: ${Object.entries(a).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(' ')}. Saves: ${['str', 'dex', 'con', 'int', 'wis', 'cha'].map(k => `${k} ${fmtMod(saveMod(c, k))}`).join(' ')}.`,
    featsOf(c).length ? `Feats: ${featsOf(c).map(f => FEATS[f.key]?.name).join(', ')}.` : '',
    `Skills: ${skills || 'none'}. Attacks: ${attacks.join('; ')}.`,
    spells.length ? `Can cast: ${spells.join(', ')}. ${(() => { const s = spellcastingStats(c).class; return s ? `Spell DC ${s.dc}, attack ${fmtMod(s.attack)}.` : ''; })()}` : '',
    `Gear: ${inv}. Coins: ${Object.entries(c.currency).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}.`,
    `XP ${c.xp}${xpToNext(c) ? `/${xpToNext(c)}` : ''}${c.pendingLevelUp ? ' (LEVEL UP AVAILABLE)' : ''}.`,
    d.appearance ? `Appearance: ${d.appearance}` : '',
    d.personality ? `Personality: ${d.personality}` : '',
    d.backstory ? `Backstory: ${String(d.backstory).slice(0, 600)}` : '',
  ].filter(Boolean).join('\n');
}

export function encounterBlock(state) {
  const enc = state.encounter;
  if (!enc || enc.status !== 'active') return null;
  const cur = currentCid(state);
  const lines = enc.order.map(id => {
    const cb = enc.combatants[id];
    const c = creatureById(state, id);
    if (cb.removed) return null;
    const conds = [...conditionSet(c)].filter(x => x !== 'exhaustion');
    const hp = cb.kind === 'pc' ? `HP ${c.hp}/${c.maxHp}` : describeHealth(c);
    return `${id === cur ? '>> ' : '   '}${cb.name} [id ${id}] (${cb.side}, init ${cb.initiative}) at (${cb.pos.x},${cb.pos.y}) ${hp}${conds.length ? `, ${conds.join(', ')}` : ''}${cb.hidden ? ', hidden' : ''}`;
  }).filter(Boolean);
  return `COMBAT round ${enc.round}, map ${enc.map.width}x${enc.map.height} (5 ft squares, light: ${enc.map.light}). Current turn marked >>.\n${lines.join('\n')}`;
}

export function sceneBlock(state) {
  const s = state.scene ?? {};
  return `Location: ${s.location ?? 'not yet set'}. Light: ${s.light ?? 'bright'}. Time: ${clockLabel(state.clock?.minute ?? 0)}.${s.description ? ` ${s.description}` : ''}${s.shop ? ` A shop is open: ${s.shop.name}.` : ''}`;
}

export function monsterCatalog() {
  return Object.values(MONSTERS).filter(m => isSrdMonster(m.key)).map(m => `${m.key} (${m.name}, CR ${m.cr})`).join(', ');
}
