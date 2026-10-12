import { SPELLS } from './engine/data/spells.js';
import { WILD_SHAPE_BEASTS, MONSTERS } from './engine/data/monsters.js';
import { RACES } from './engine/data/races.js';
import { attackProfiles, powerEligible, hitChance } from './engine/attack.js';
import { resolveSource, scaledDamage, spellRangeFt } from './engine/spellcasting.js';
import { saveMod, hasTrait } from './engine/creature.js';
import { hostile } from './engine/state.js';
import { castableSpells, itemDef, spellcastingStats, maxSpellLevel, ritualSpells } from './engine/character.js';
import { cbDistance } from './engine/combat.js';
import { creatureById, currentCid, inCombat } from './engine/state.js';
import { describeHealth } from './dm/monsterAI.js';
import { speed, armorClass } from './engine/creature.js';
import { classLevels, cl, subclassOf, castingOf } from './engine/classlevel.js';
import { hasFeat } from './engine/feats.js';
import { multiclassOptions } from './engine/leveling.js';
import { CLASSES } from './engine/data/classes.js';

// what each feature costs on a turn, and a one-line reminder of what it does
const FEATURE_INFO = {
  secondWind: ['bonus', 'Regain 1d10 + fighter level hit points.'],
  actionSurge: ['free', 'Take one additional action this turn.'],
  rage: ['bonus', 'Advantage on Strength checks and saves, bonus melee damage, resistance to bludgeoning, piercing and slashing damage.'],
  endRage: ['bonus', 'Stop raging.'],
  bardicInspiration: ['bonus', 'An ally gains an inspiration die to add to one ability check, attack roll or saving throw.'],
  turnUndead: ['action', 'Undead within 30 ft must make a Wisdom save or be turned for 1 minute.'],
  layOnHands: ['action', 'Touch a creature to restore hit points from your healing pool.'],
  sacredWeapon: ['action', 'Add your Charisma modifier to attack rolls with your weapon for 1 minute; it sheds bright light.'],
  turnTheUnholy: ['action', 'Fiends and undead within 30 ft must make a Wisdom save or be turned.'],
  flurryOfBlows: ['bonus', 'Spend 1 ki to make two unarmed strikes.'],
  patientDefense: ['bonus', 'Spend 1 ki to take the Dodge action.'],
  stepOfTheWind: ['bonus', 'Spend 1 ki to Dash or Disengage; your jump distance doubles.'],
  wholenessOfBody: ['action', 'Regain hit points equal to three times your monk level.'],
  cunningAction: ['bonus', 'Dash, Disengage or Hide as a bonus action.'],
  wildShape: ['action', 'Transform into a beast you have seen.'],
  revertWildShape: ['bonus', 'Return to your normal form.'],
  fontOfMagic: ['bonus', 'Convert spell slots and sorcery points into each other.'],
  breathWeapon: ['action', 'Exhale destructive energy in an area; creatures make a saving throw.'],
  spiritualWeapon: ['bonus', 'Your spiritual weapon makes a melee spell attack.'],
  vowOfEnmity: ['bonus', 'Advantage on attack rolls against one creature within 10 ft for 1 minute.'],
  tidesOfChaos: ['free', 'Advantage on your next attack roll.'],
};
const F = (key, label, params = {}) => ({ key, label, time: FEATURE_INFO[key]?.[0] ?? 'action', desc: FEATURE_INFO[key]?.[1] ?? '', ...params });

// reactions this character actually has, for the sheet toggles and the turn tray
export function reactionOptions(c) {
  const cast = castableSpells(c);
  const out = [{ key: 'autoOpportunityAttack', label: 'Opportunity attack', desc: 'Strike a creature that leaves your reach.' }];
  if (cast.has('shield')) out.push({ key: 'autoShield', label: 'Shield', desc: '+5 AC until your next turn when an attack would hit you (uses a spell slot).' });
  if (cl(c, 'rogue') >= 5) out.push({ key: 'autoUncannyDodge', label: 'Uncanny Dodge', desc: 'Halve the damage of an attack that hits you.' });
  if (cl(c, 'fighter') >= 9) out.push({ key: 'autoIndomitable', label: 'Indomitable', desc: 'Reroll a failed saving throw.' });
  if (cast.has('hellishRebuke')) out.push({ key: 'autoHellishRebuke', label: 'Hellish Rebuke', desc: 'Engulf a creature that damaged you in flames.' });
  if (hasFeat(c, 'lucky')) out.push({ key: 'autoLucky', label: 'Lucky', desc: 'Spend a luck point to reroll an attack, check or save.' });
  return out.map(r => ({ ...r, on: c.preferences?.[r.key] !== false }));
}

export function featureOptions(c, state) {
  const out = [];
  const has = k => c.resources?.[k] && c.resources[k].used < c.resources[k].max;
  for (const { class: klass, level: L } of classLevels(c)) {
    const sub = subclassOf(c, klass);
    switch (klass) {
    case 'fighter':
      if (has('secondWind')) out.push(F('secondWind', 'Second Wind'));
      if (L >= 2 && has('actionSurge')) out.push(F('actionSurge', 'Action Surge'));
      break;
    case 'barbarian':
      if ((c.effects ?? []).some(e => e.rage)) out.push(F('endRage', 'End Rage'));
      else if (has('rage')) {
        out.push(F('rage', 'Rage'));
        if (L >= 3 && sub === 'berserker') out.push(F('rage', 'Frenzied Rage', { frenzy: true }));
      }
      break;
    case 'bard':
      if (has('bardicInspiration')) out.push(F('bardicInspiration', 'Bardic Inspiration', { needs: 'ally' }));
      break;
    case 'cleric':
      if (L >= 2 && has('channelDivinity')) out.push(F('turnUndead', 'Turn Undead'));
      break;
    case 'paladin':
      if (has('layOnHands')) out.push(F('layOnHands', 'Lay on Hands', { needs: 'ally', amount: c.resources.layOnHands.max - c.resources.layOnHands.used }));
      if (L >= 3 && has('channelDivinity') && sub === 'devotion') out.push(F('sacredWeapon', 'Sacred Weapon'), F('turnTheUnholy', 'Turn the Unholy'));
      if (L >= 3 && has('channelDivinity') && sub === 'vengeance') out.push(F('vowOfEnmity', 'Vow of Enmity', { needs: 'enemy' }));
      break;
    case 'monk':
      if (L >= 2 && has('ki')) out.push(F('flurryOfBlows', 'Flurry of Blows'), F('patientDefense', 'Patient Defense'), F('stepOfTheWind', 'Step of the Wind (dash)', { mode: 'dash' }), F('stepOfTheWind', 'Step of the Wind (disengage)', { mode: 'disengage' }));
      if (L >= 6 && has('wholenessOfBody')) out.push(F('wholenessOfBody', 'Wholeness of Body'));
      break;
    case 'rogue':
      if (L >= 2) out.push(F('cunningAction', 'Cunning Action: Dash', { mode: 'dash' }), F('cunningAction', 'Cunning Action: Disengage', { mode: 'disengage' }), F('cunningAction', 'Cunning Action: Hide', { mode: 'hide' }));
      break;
    case 'druid':
      if (c.wildShape) out.push(F('revertWildShape', 'Revert to normal form'));
      else if (L >= 2 && has('wildShape')) {
        const moon = sub === 'moon';
        const maxCr = moon ? Math.max(1, Math.floor(L / 3)) : L >= 8 ? 1 : L >= 4 ? 0.5 : 0.25;
        const crv = cr => (cr.includes('/') ? Number(cr.split('/')[0]) / Number(cr.split('/')[1]) : Number(cr));
        for (const b of WILD_SHAPE_BEASTS) if (crv(MONSTERS[b].cr) <= maxCr) out.push(F('wildShape', `Wild Shape: ${MONSTERS[b].name}`, { beast: b, ...(moon ? { time: 'bonus' } : {}) }));
      }
      break;
    case 'sorcerer':
      if (L >= 2) out.push(F('fontOfMagic', 'Font of Magic', { needs: 'font' }));
      if (sub === 'wildMagic' && has('tidesOfChaos')) out.push(F('tidesOfChaos', 'Tides of Chaos'));
      break;
    default:
    }
  }
  if (RACES[c.race]?.traits?.includes('breathWeapon') && has('breathWeapon')) out.push(F('breathWeapon', 'Breath Weapon', { needs: 'aim' }));
  if ((state.encounter?.summons ?? []).some(s => s.casterId === c.id && s.name === 'Spiritual Weapon')) out.push(F('spiritualWeapon', 'Spiritual Weapon attack', { needs: 'enemy' }));
  return out;
}

// "+5 · 1d10 fire", "DEX DC 13 · 3d6 fire": what a spell rolls for this caster
function spellRoll(state, c, key) {
  const s = SPELLS[key];
  const e = s.effect;
  let src;
  try {
    src = resolveSource(state, c, key, {});
  } catch {
    return null;
  }
  const fmt = n => (n >= 0 ? `+${n}` : `${n}`);
  let dmg = null;
  try {
    const d = scaledDamage(s, c, s.level || 0);
    dmg = d ? `${d.dice ?? d}${e.damage?.type ? ` ${e.damage.type}` : ''}` : null;
  } catch {
    dmg = e.damage ? `${e.damage.dice} ${e.damage.type ?? ''}`.trim() : null;
  }
  const count = e.rays ? `${e.rays}× ` : e.darts ? `${e.darts}× ` : '';
  const dice = dmg ? `${count}${dmg.split(' ')[0]}` : null;
  if (e.type === 'attack') return { kind: 'attack', dice, bonus: src.attack, text: `${fmt(src.attack)} to hit${dmg ? ` · ${count}${dmg}` : ''}` };
  if (e.type === 'save') return { kind: 'save', dice, save: e.save, dc: src.dc, text: `${e.save.toUpperCase()} save DC ${src.dc}${dmg ? ` · ${dmg}${e.halfOnSave ? ', half on save' : ''}` : ''}` };
  if (e.type === 'auto' && dmg) return { kind: 'auto', dice, text: `${count}${dmg}, never misses` };
  if (e.type === 'heal' && e.heal) return { kind: 'heal', dice: e.heal.dice, text: `heals ${e.heal.dice}${e.heal.addMod ? ` ${fmt(src.mod ?? 0)}` : ''}` };
  return null;
}

// hit chances against every creature in the fight, for each weapon and spell: hovering a
// combatant shows them the way BG3 does
function combatOdds(state, c) {
  const out = {};
  const enc = state.encounter;
  const profiles = attackProfiles(state, c);
  const spells = [...castableSpells(c).keys()].filter(k => ['attack', 'save'].includes(SPELLS[k].effect.type));
  for (const id of enc.order) {
    const x = enc.combatants[id];
    const t = creatureById(state, id);
    if (id === c.id || x.removed || !t || t.dead) continue;
    const row = { attacks: {}, spells: {} };
    for (const p of profiles) {
      try {
        row.attacks[p.id] = hitChance(state, c, t, p, { power: !!c.preferences?.powerAttack && powerEligible(c, p) });
      } catch {
        /* out of the map, or no line to it */
      }
    }
    for (const k of spells) {
      const s = SPELLS[k];
      try {
        const src = resolveSource(state, c, k, {});
        if (s.effect.type === 'attack') {
          const r = spellRangeFt(s);
          row.spells[k] = hitChance(state, c, t, { kind: s.range === 'touch' ? 'melee' : 'ranged', range: [r, r], reach: 5, toHit: src.attack, spell: true, weaponAttack: false, properties: [] });
        } else {
          // the chance the target fails its save
          const adv = hasTrait(t, 'magicResistance');
          const need = src.dc - saveMod(t, s.effect.save);
          let pass = Math.max(0, Math.min(20, 21 - need)) / 20;
          if (adv) pass = 1 - (1 - pass) ** 2;
          row.spells[k] = { pct: Math.round((1 - pass) * 100), mode: adv ? 'advantage' : 'normal', save: true, why: adv ? ['Magic Resistance'] : [] };
        }
      } catch {
        /* not castable right now */
      }
    }
    row.hostile = hostile(state, c.id, id);
    out[id] = row;
  }
  return out;
}

export function characterOptions(state, charId) {
  const c = state.characters[charId];
  if (!c) return null;
  const combat = inCombat(state) && !!state.encounter.combatants[charId];
  const cb = combat ? state.encounter.combatants[charId] : null;
  const ts = cb?.turnState;
  const stats = spellcastingStats(c);
  const rituals = new Set(ritualSpells(c));
  const spells = [...castableSpells(c).entries()].map(([k, src]) => {
    const s = SPELLS[k];
    const castingClass = src === 'class' ? c.class : src.startsWith('class:') ? src.slice(6) : null;
    return { key: k, name: s.name, level: s.level, time: s.time, range: s.range, roll: spellRoll(state, c, k), concentration: s.concentration, ritual: s.ritual && rituals.has(k), effect: s.effect.type, area: s.effect.area ?? null, targets: s.effect.targets ?? (s.effect.self ? 0 : 1), self: !!s.effect.self, source: src, castingClass, slotted: !!castingClass && s.level > 0, desc: s.desc, upcastTargets: s.effect.upcastTargets ?? 0 };
  });
  for (const k of rituals) if (!spells.some(s => s.key === k)) spells.push({ key: k, name: SPELLS[k].name, level: SPELLS[k].level, time: SPELLS[k].time, ritualOnly: true, ritual: true, effect: SPELLS[k].effect.type, targets: 0, desc: SPELLS[k].desc });
  spells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return {
    isMyTurn: combat && currentCid(state) === charId,
    inCombat: combat,
    reactionReady: combat ? !!cb.reaction : true,
    turn: ts ? { action: ts.action > 0 || ts.hasteAction, bonus: ts.bonus > 0, reaction: !!cb.reaction, movementLeft: Math.max(0, ts.movement - ts.moved), movement: ts.movement, spellsCast: ts.spellsCast ?? [], attacksLeft: ts.attacksLeft, offhandReady: ts.offhandReady, martialArtsReady: ts.martialArtsReady, flurryLeft: ts.flurryLeft ?? 0, deathSavePending: !!ts.deathSavePending } : null,
    deathSaves: c.hp <= 0 && !c.dead ? { successes: c.deathSaves?.successes ?? 0, failures: c.deathSaves?.failures ?? 0, stable: !!c.stable } : null,
    speed: speed(c), ac: armorClass(c),
    attacks: attackProfiles(state, c).map(p => ({ power: powerEligible(c, p), id: p.id, name: p.name, kind: p.kind, reach: p.reach, range: p.range, toHit: p.toHit, damage: `${p.damage.dice ?? p.damage.flat ?? ''}${p.damage.bonus ? (p.damage.bonus > 0 ? `+${p.damage.bonus}` : p.damage.bonus) : ''} ${p.damage.type}`, offhand: !!p.offhand, light: p.properties?.includes('light') })),
    spells, spellDc: stats.class?.dc ?? stats.race?.dc ?? null, spellAttack: stats.class?.attack ?? null, maxSpellLevel: maxSpellLevel(c),
    slots: c.slots, pactSlots: c.pactSlots, metamagic: c.metamagic ?? [], sorceryPoints: c.resources?.sorceryPoints ?? null,
    features: featureOptions(c, state),
    reactions: reactionOptions(c),
    resources: Object.entries(c.resources ?? {}).filter(([, r]) => r.max > 0 && r.max < 99).map(([key, r]) => ({ key, name: r.name, left: r.max - r.used, max: r.max, recharge: r.recharge })),
    items: c.inventory.filter(i => itemDef(i)?.use || itemDef(i)?.castsSpell).map(i => ({ id: i.id, name: itemDef(i).name, qty: i.qty, kind: itemDef(i).use?.kind ?? 'spell', spell: itemDef(i).castsSpell?.spell ?? null })),
    combatants: combat ? state.encounter.order.map(id => {
      const x = state.encounter.combatants[id];
      const cr = creatureById(state, id);
      return { id, name: x.name, side: x.side, distance: cbDistance(state, charId, id), pos: x.pos, health: x.kind === 'pc' ? `${cr.hp}/${cr.maxHp}` : describeHealth(cr), dead: !!cr.dead, removed: !!x.removed };
    }).filter(x => !x.removed) : Object.values(state.characters).map(x => ({ id: x.id, name: x.name, side: 'party', health: `${x.hp}/${x.maxHp}`, dead: !!x.dead })),
    canPrepare: !!c.preparationOpen && !combat,
    prepareClasses: classLevels(c).filter(x => castingOf(c, x.class)?.prepared && x.level >= (castingOf(c, x.class).startLevel ?? 1)).map(x => x.class),
    classes: classLevels(c),
    multiclass: multiclassOptions(c),
    powerAttack: hasFeat(c, 'greatWeaponMaster') || hasFeat(c, 'sharpshooter') ? { on: !!c.preferences?.powerAttack, feats: [hasFeat(c, 'greatWeaponMaster') ? 'Great Weapon Master' : null, hasFeat(c, 'sharpshooter') ? 'Sharpshooter' : null].filter(Boolean) } : null,
    odds: combat ? combatOdds(state, c) : null,
    superiorityDice: c.resources?.superiorityDice ? c.resources.superiorityDice.max - c.resources.superiorityDice.used : null,
    subclasses: classLevels(c).map(x => ({ class: x.class, key: subclassOf(c, x.class), name: CLASSES[x.class].subclasses[subclassOf(c, x.class)]?.name ?? null })),
    gwmReady: !!ts?.gwmReady, polearmReady: !!ts?.polearmReady,
    hitDiceLeft: c.level - c.hitDiceUsed,
  };
}
