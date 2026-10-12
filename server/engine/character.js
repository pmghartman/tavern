import { ABILITIES, SKILLS, SKILL_NAMES, STANDARD_ARRAY, POINT_BUY_COST, ALIGNMENTS, LANGUAGES, abilityMod, profBonus, levelForXp, XP_THRESHOLDS } from './data/core.js';
import { RACES, DRACONIC_ANCESTRY } from './data/races.js';
import { CLASSES, BACKGROUNDS, METAMAGIC, INVOCATIONS, PACT_BOONS, INFUSIONS, slotsFor, pactSlots, FULL_CASTER_SLOTS, subclassKey } from './data/classes.js';
import { cl, classLevels, subclassOf, subclassDef, hasSub, subclassesOf, castingOf, casterLevelShare } from './classlevel.js';
import { featsOf, hasFeat, featArmor, featChanges, validateFeat, featSpells, allInvocations } from './feats.js';
import { FEATS } from './data/feats.js';
import { MI_ABILITY } from './data/feats.js';
import { SPELLS, spellsForClass } from './data/spells.js';
import { WEAPONS, ARMOR, PACKS, ITEMS, MAGIC_ITEMS } from './data/items.js';
import { uid, clamp } from './util.js';

export const ASI_LEVELS = { default: [4, 8, 12, 16, 19], fighter: [4, 6, 8, 12, 14, 16, 19], rogue: [4, 8, 10, 12, 16, 19] };
export const asiLevelsFor = cls => ASI_LEVELS[cls] ?? ASI_LEVELS.default;

export function hasFeature(char, key) {
  for (const { class: k, level } of classLevels(char)) {
    const sub = subclassOf(char, k);
    if (CLASSES[k]?.features.some(f => f.key === key && f.level <= level && (!f.sub || f.sub === sub))) return true;
  }
  return (RACES[char.race]?.traits ?? []).includes(key);
}

// which classes cast spells at their current level
export function castingClasses(char) {
  return classLevels(char).filter(x => {
    const sc = castingOf(char, x.class);
    return sc && x.level >= (sc.startLevel ?? 1);
  });
}

// multiclass slot table: full levels + half of paladin/ranger levels; pact magic stays separate
export function slotTable(char) {
  const casters = castingClasses(char).map(x => ({ ...x, type: castingOf(char, x.class).type })).filter(x => x.type !== 'pact');
  if (!casters.length) return [];
  if (casters.length === 1) return slotsFor(casters[0].type, casters[0].level);
  const lvl = casters.reduce((s, x) => s + casterLevelShare(x.type, x.level), 0);
  return FULL_CASTER_SLOTS[Math.min(20, lvl)] ?? [];
}

export function maxSpellLevel(char) {
  const fromSlots = slotTable(char).length;
  const wl = cl(char, 'warlock');
  return Math.max(fromSlots, wl ? pactSlots(wl).level : 0);
}

// highest spell level a class lets you learn, as if single-classed
export function learnMaxLevel(cls, level, sub = null) {
  const sc = CLASSES[cls]?.spellcasting ?? CLASSES[cls]?.subclasses?.[sub]?.spellcasting;
  if (!sc || level < (sc.startLevel ?? 1)) return 0;
  if (sc.type === 'pact') return pactSlots(level).level;
  return slotsFor(sc.type, level).length;
}

export function cantripsKnownCount(cls, level, sub = null) {
  const sc = CLASSES[cls]?.spellcasting ?? CLASSES[cls]?.subclasses?.[sub]?.spellcasting;
  if (!sc?.cantrips || level < 1) return 0;
  return sc.cantrips[level - 1];
}

export function spellbookSize(level) {
  return 6 + 2 * (level - 1);
}

export function preparedCount(char, cls = char.class) {
  const sc = castingOf(char, cls);
  if (!sc?.prepared) return null;
  const lv = cl(char, cls);
  const m = abilityMod(finalAbilities(char)[sc.ability]);
  return Math.max(1, m + (sc.type === 'half' || sc.type === 'artificer' ? Math.floor(lv / 2) : lv));
}

export function alwaysPreparedSpells(char) {
  const out = [];
  for (const { class: k, level } of classLevels(char)) {
    const sub = subclassDef(char, k);
    if (!sub?.domainSpells || level < sub.level) continue;
    for (const [lvl, spells] of Object.entries(sub.domainSpells)) if (level >= Number(lvl)) out.push(...spells.filter(s => SPELLS[s]));
  }
  return [...new Set(out)];
}

export function classSpellList(char, cls = char.class) {
  const list = new Set(spellsForClass(castingOf(char, cls)?.list ?? cls));
  const sub = subclassDef(char, cls);
  if (sub?.expandedSpells) for (const spells of Object.values(sub.expandedSpells)) spells.forEach(s => SPELLS[s] && list.add(s));
  // divine soul: the whole cleric list
  if (sub?.expandedFrom) spellsForClass(sub.expandedFrom).forEach(s => list.add(s));
  return list;
}

// the spell lists a character keeps for one of its classes
export function spellListsFor(char, cls) {
  if (cls === char.class) return char.spells ?? {};
  return char.spells?.byClass?.[cls] ?? { cantrips: [], known: [], prepared: [], spellbook: [] };
}

// racial ability bonuses: the race's own, or moved elsewhere with Tasha's
// Customizing Your Origin (moved), plus the free picks some races get
export function racialBonus(race, choices = [], moved = null) {
  const out = {};
  for (const [a, v] of Object.entries(moved ?? race?.asi ?? {})) out[a] = (out[a] ?? 0) + v;
  for (const a of choices ?? []) out[a] = (out[a] ?? 0) + (race?.asiChoice?.amount ?? 1);
  return out;
}

export function finalAbilities(char) {
  const race = RACES[char.race];
  const out = {};
  for (const ab of ABILITIES) {
    let v = char.baseAbilities?.[ab] ?? 10;
    v += racialBonus(race, char.raceAsiChoices, char.raceAsi)[ab] ?? 0;
    for (const asi of char.asiHistory ?? []) v += asi.changes?.[ab] ?? 0;
    v += char.raceFeat?.changes?.[ab] ?? 0;
    out[ab] = clamp(v, 1, 20);
  }
  if (cl(char, 'barbarian') >= 20) {
    out.str = Math.min(24, out.str + 4);
    out.con = Math.min(24, out.con + 4);
  }
  for (const it of char.inventory ?? []) {
    const def = itemDef(it);
    if (def?.passive?.setAbility && (it.attuned || !def.attunement) && it.equipped) {
      for (const [ab, val] of Object.entries(def.passive.setAbility)) out[ab] = Math.max(out[ab], val);
    }
  }
  return out;
}

export function mods(char) {
  const a = finalAbilities(char);
  return Object.fromEntries(ABILITIES.map(k => [k, abilityMod(a[k])]));
}

export function itemDef(inv) {
  if (!inv) return null;
  const base = ITEMS[inv.key];
  if (inv.custom) return { ...(base ?? {}), ...inv.custom };
  return base ?? null;
}

// magic weapon/armor instances store base item in custom.base
export function weaponDef(inv) {
  const def = itemDef(inv);
  if (!def) return null;
  if (def.kind === 'weapon') return { ...def, bonus: inv.custom?.bonus ?? 0 };
  if (def.kind === 'magicWeapon') {
    const baseKey = inv.custom?.base ?? def.base;
    const base = WEAPONS[baseKey];
    if (!base) return null;
    return { ...base, name: inv.custom?.name ?? `${def.name.replace('Weapon', base.name)}`, bonus: def.bonus ?? 0, magical: true, baseKey, ignitable: def.ignitable };
  }
  return null;
}

export function armorDef(inv) {
  const def = itemDef(inv);
  if (!def) return null;
  if (def.kind === 'armor') return { ...def, bonus: 0 };
  if (def.kind === 'magicArmor') {
    const baseKey = inv.custom?.base ?? def.base;
    const base = ARMOR[baseKey];
    if (!base) return null;
    return { ...base, name: inv.custom?.name ?? def.name.replace('Armor', base.name), bonus: def.bonus ?? 0, magical: true, baseKey };
  }
  return null;
}

export function equipped(char, slot) {
  return (char.inventory ?? []).find(i => i.equipped === slot) ?? null;
}

export function weaponProficiencies(char) {
  const out = new Set([...(CLASSES[char.class]?.weapons ?? []), ...(char.multiclassProfs?.weapons ?? []), ...(RACES[char.race]?.weaponProfs ?? [])]);
  if (hasSub(char, 'bard', 'valor', 3)) out.add('martial');
  for (const s of subclassesOf(char)) (s.def.weapons ?? []).forEach(w => out.add(w));
  return out;
}

export function isProficientWeapon(char, wdef) {
  if (!wdef) return false;
  const key = wdef.baseKey ?? Object.keys(WEAPONS).find(k => WEAPONS[k].name === wdef.name);
  const profs = weaponProficiencies(char);
  if (profs.has(key)) return true;
  if (wdef.category?.startsWith('simple') && profs.has('simple')) return true;
  if (wdef.category?.startsWith('martial') && profs.has('martial')) return true;
  return false;
}

export function armorProficiencies(char) {
  const out = new Set([...(CLASSES[char.class]?.armor ?? []), ...(char.multiclassProfs?.armor ?? []), ...featArmor(char)]);
  for (const { class: k, level } of classLevels(char)) {
    const sub = subclassDef(char, k);
    if (sub?.armor && level >= sub.level) sub.armor.forEach(a => out.add(a));
  }
  if (hasSub(char, 'bard', 'valor', 3)) ['medium', 'shield'].forEach(a => out.add(a));
  return out;
}

export function isProficientArmor(char, adef) {
  if (!adef) return true;
  return armorProficiencies(char).has(adef.category);
}

// class taken at each character level; index 0 is the first class
export function levelHistory(char) {
  if (Array.isArray(char.levelHistory) && char.levelHistory.length === char.level) return char.levelHistory;
  return Array.from({ length: char.level }, () => char.class);
}

export function computeMaxHp(char) {
  const m = mods(char).con;
  const hist = levelHistory(char);
  let hp = CLASSES[hist[0]].hitDie + m;
  const rolls = char.hpRolls ?? [];
  for (let i = 1; i < hist.length; i++) {
    const die = CLASSES[hist[i]].hitDie;
    const gain = rolls[i - 1] ?? Math.floor(die / 2) + 1;
    hp += Math.max(1, gain + m);
  }
  if (RACES[char.race]?.hpPerLevel) hp += RACES[char.race].hpPerLevel * char.level;
  if (hasSub(char, 'sorcerer', 'draconic')) hp += cl(char, 'sorcerer');
  if (hasFeat(char, 'tough')) hp += 2 * char.level;
  for (const e of char.effects ?? []) if (e.maxHpBonus) hp += e.maxHpBonus;
  if ((char.exhaustion ?? 0) >= 4) hp = Math.floor(hp / 2);
  return Math.max(1, hp);
}

export function classResources(char) {
  const m = mods(char);
  const res = {};
  // shared features such as Channel Divinity keep the larger pool
  for (const { class: k, level } of classLevels(char)) {
    for (const [key, r] of Object.entries(CLASSES[k]?.resources?.(level, m, subclassOf(char, k)) ?? {})) {
      if (!res[key] || r.max > res[key].max) res[key] = r;
    }
  }
  const race = RACES[char.race];
  if (race?.traits?.includes('breathWeapon')) res.breathWeapon = { name: 'Breath Weapon', max: 1, recharge: 'short' };
  if (race?.traits?.includes('relentlessEndurance')) res.relentlessEndurance = { name: 'Relentless Endurance', max: 1, recharge: 'long' };
  for (const sp of race?.innateSpells ?? []) {
    if (sp.perLongRest && char.level >= sp.level) res[`innate_${sp.spell}`] = { name: `${SPELLS[sp.spell]?.name ?? sp.spell} (innate)`, max: sp.perLongRest, recharge: 'long' };
  }
  if (hasFeat(char, 'lucky')) res.luck = { name: 'Luck Points', max: 3, recharge: 'long' };
  const mi = featsOf(char).find(f => f.key === 'magicInitiate');
  if (mi?.choice?.spell) res.feat_magicInitiate = { name: `${SPELLS[mi.choice.spell]?.name} (Magic Initiate)`, max: 1, recharge: 'long' };
  for (const k of featSpells(char).once) if (SPELLS[k]) res[`feat_${k}`] = { name: `${SPELLS[k].name} (feat)`, max: 1, recharge: 'long' };
  // metamagic adept: two sorcery points of its own
  if (hasFeat(char, 'metamagicAdept')) res.sorceryPoints = { name: 'Sorcery Points', max: (res.sorceryPoints?.max ?? 0) + 2, recharge: 'long' };
  for (const [k, v] of Object.entries(res)) if (!v.max) delete res[k];
  return res;
}

export function syncResources(char) {
  const defs = classResources(char);
  const out = {};
  for (const [k, d] of Object.entries(defs)) {
    const prev = char.resources?.[k];
    out[k] = { ...d, used: clamp(prev?.used ?? 0, 0, d.max) };
  }
  char.resources = out;
  const slots = {};
  slotTable(char).forEach((max, i) => {
    slots[i + 1] = { max, used: clamp(char.slots?.[i + 1]?.used ?? 0, 0, max) };
  });
  char.slots = slots;
  const wl = cl(char, 'warlock');
  if (wl) {
    const p = pactSlots(wl);
    char.pactSlots = { level: p.level, max: p.count, used: clamp(char.pactSlots?.used ?? 0, 0, p.count) };
  } else char.pactSlots = null;
  return char;
}

// returns errors[]; strict validation of a creation request
export function validateCreation(input, ctx = {}) {
  const errors = [];
  const err = m => errors.push(m);
  const level = input.level ?? 1;
  if (!input.name || typeof input.name !== 'string' || !input.name.trim()) err('Name is required.');
  else if (input.name.length > 40) err('Name must be 40 characters or fewer.');
  const race = RACES[input.race];
  if (!race) err(`Unknown race "${input.race}".`);
  const cls = CLASSES[input.class];
  if (!cls) err(`Unknown class "${input.class}".`);
  if (!Number.isInteger(level) || level < 1 || level > 20) err('Level must be between 1 and 20.');
  if (ctx.maxLevel && level > ctx.maxLevel) err(`This campaign starts at level ${ctx.maxLevel}.`);
  const bg = BACKGROUNDS[input.background];
  if (!bg) err(`Unknown background "${input.background}".`);
  if (input.alignment && !ALIGNMENTS.includes(input.alignment)) err(`Unknown alignment "${input.alignment}".`);
  if (!race || !cls || !bg) return errors;

  // abilities
  const base = input.baseAbilities ?? {};
  const scores = ABILITIES.map(a => base[a]);
  if (scores.some(s => !Number.isInteger(s))) err('All six ability scores are required as integers.');
  else if (input.abilityMethod === 'standard') {
    const sorted = [...scores].sort((a, b) => b - a);
    if (JSON.stringify(sorted) !== JSON.stringify(STANDARD_ARRAY)) err('Standard array must use exactly 15, 14, 13, 12, 10, 8.');
  } else if (input.abilityMethod === 'pointBuy') {
    if (scores.some(s => s < 8 || s > 15)) err('Point buy scores must be between 8 and 15 before racial bonuses.');
    else {
      const cost = scores.reduce((t, s) => t + POINT_BUY_COST[s], 0);
      if (cost > 27) err(`Point buy costs ${cost} points; the limit is 27.`);
    }
  } else if (input.abilityMethod === 'rolled') {
    const rolled = ctx.rolledScores;
    if (!rolled) err('Rolled scores must come from a server roll token.');
    else {
      const a = [...scores].sort((x, y) => x - y);
      const b = [...rolled].sort((x, y) => x - y);
      if (JSON.stringify(a) !== JSON.stringify(b)) err('Ability scores do not match the server-rolled values.');
    }
  } else err('Ability method must be standard, pointBuy or rolled.');

  if (race.ancestryChoice && !DRACONIC_ANCESTRY[input.ancestry]) err('Dragonborn must choose a draconic ancestry.');
  // subclass, once the class grants one
  if (level >= cls.subclassLevel) {
    if (!input.subclass) err(`${cls.name} chooses a subclass at level ${cls.subclassLevel}.`);
    else if (!subclassKey(input.class, input.subclass)) err(`"${input.subclass}" is not a ${cls.name} subclass.`);
  } else if (input.subclass) err(`${cls.name} chooses a subclass at level ${cls.subclassLevel}, not before.`);
  // Customizing Your Origin: the same bonuses, on other abilities
  const moved = input.raceAsi ?? null;
  if (moved) {
    const want = Object.values(race.asi ?? {}).sort().join(',');
    const got = Object.values(moved).sort().join(',');
    if (want !== got || Object.keys(moved).some(a => !ABILITIES.includes(a))) err(`Moving ${race.name} ability bonuses keeps the same bonuses (${want || 'none'}), each on a different ability.`);
  }
  if (race.asiChoice) {
    const ch = input.raceAsiChoices ?? [];
    // the abilities the race already raises cannot take a free pick too
    const exclude = moved ? Object.keys(moved) : race.asiChoice.exclude;
    if (ch.length !== race.asiChoice.count || new Set(ch).size !== ch.length || ch.some(a => !ABILITIES.includes(a) || exclude.includes(a))) {
      err(`${race.name} must choose ${race.asiChoice.count} different abilit${race.asiChoice.count === 1 ? 'y' : 'ies'}${exclude.length ? ` (not ${exclude.join(', ')})` : ''} to increase by ${race.asiChoice.amount ?? 1}.`);
    }
  } else if (input.raceAsiChoices?.length) err(`${race.name} does not choose ability increases.`);

  // skills
  const fixed = new Set([...(bg.skills ?? []), ...(race.skillProfs ?? [])]);
  const raceSkills = input.raceSkills ?? [];
  if (race.skillChoice) {
    if (raceSkills.length !== race.skillChoice.count) err(`${race.name} must choose ${race.skillChoice.count} skills.`);
  } else if (raceSkills.length) err(`${race.name} does not choose bonus skills.`);
  const classSkills = input.classSkills ?? [];
  if (classSkills.length !== cls.skills.count) err(`${cls.name} must choose exactly ${cls.skills.count} skills.`);
  const all = [...fixed];
  for (const s of [...raceSkills, ...classSkills]) {
    if (!SKILLS[s]) {
      err(`Unknown skill "${s}".`);
      continue;
    }
    if (all.includes(s)) err(`${SKILL_NAMES[s]} is already granted; choose a different skill.`);
    all.push(s);
  }
  for (const s of classSkills) if (SKILLS[s] && cls.skills.from !== 'any' && !cls.skills.from.includes(s)) err(`${SKILL_NAMES[s]} is not a ${cls.name} skill option.`);

  // expertise
  const expertise = input.expertise ?? [];
  let expCount = 0;
  if (input.class === 'rogue') expCount = level >= 6 ? 4 : 2;
  if (input.class === 'bard') expCount = level >= 10 ? 4 : level >= 3 ? 2 : 0;
  if (expertise.length !== expCount) err(`${cls.name} at level ${level} must choose ${expCount} expertise skills.`);
  for (const s of expertise) if (!all.includes(s) && s !== 'thievesTools') err(`Expertise requires proficiency in ${SKILL_NAMES[s] ?? s}.`);
  if (new Set(expertise).size !== expertise.length) err('Expertise choices must be different.');

  // fighting style
  const styles = input.fightingStyles ?? [];
  const fsDef = cls.fightingStyle;
  const fsNeeded = fsDef && level >= fsDef.level ? (input.class === 'fighter' && level >= 10 ? 2 : 1) : 0;
  if (styles.length !== fsNeeded) err(`${cls.name} at level ${level} must choose ${fsNeeded} fighting style(s).`);
  for (const s of styles) if (!fsDef?.options.includes(s)) err(`Fighting style "${s}" is not available to ${cls.name}.`);
  if (new Set(styles).size !== styles.length) err('Fighting styles must be different.');

  // metamagic
  const mm = input.metamagic ?? [];
  const mmNeeded = input.class === 'sorcerer' ? (level >= 17 ? 4 : level >= 10 ? 3 : level >= 3 ? 2 : 0) : 0;
  if (mm.length !== mmNeeded) err(`Sorcerer at level ${level} must choose ${mmNeeded} metamagic options.`.replace(/^Sorcerer/, cls.name));
  for (const x of mm) if (!METAMAGIC[x]) err(`Unknown metamagic "${x}".`);

  // warlock
  if (input.class === 'warlock') {
    const inv = input.invocations ?? [];
    const need = cls.invocations[level - 1];
    if (inv.length !== need) err(`Warlock at level ${level} must choose ${need} invocations.`);
    for (const x of inv) {
      const d = INVOCATIONS[x];
      if (!d) err(`Unknown invocation "${x}".`);
      else {
        if (d.requires?.cantrip && !(input.cantrips ?? []).includes(d.requires.cantrip)) err(`${d.name} requires the ${SPELLS[d.requires.cantrip].name} cantrip.`);
        if (d.requires?.level && level < d.requires.level) err(`${d.name} requires warlock level ${d.requires.level}.`);
        if (d.requires?.pact && input.pactBoon !== d.requires.pact) err(`${d.name} requires ${PACT_BOONS[d.requires.pact]}.`);
      }
    }
    if (level >= 3 && !PACT_BOONS[input.pactBoon]) err('Warlock level 3+ must choose a pact boon.');
    if (level < 3 && input.pactBoon) err('Pact boons are gained at warlock level 3.');
  } else if (input.invocations?.length || input.pactBoon) err('Only warlocks choose invocations and pact boons.');

  // artificer infusions
  const inf = input.infusions ?? [];
  const infNeed = cls.infusions?.[level - 1] ?? 0;
  if (inf.length !== infNeed) err(`${cls.name} at level ${level} must choose ${infNeed} infusions.`);
  for (const x of inf) {
    if (!INFUSIONS[x]) err(`Unknown infusion "${x}".`);
    else if ((INFUSIONS[x].level ?? 2) > level) err(`${INFUSIONS[x].name} needs artificer level ${INFUSIONS[x].level}.`);
  }
  if (new Set(inf).size !== inf.length) err('Infusions must be different.');

  // asi
  const asiLevels = asiLevelsFor(input.class).filter(l => l <= level);
  const asis = input.asiHistory ?? [];
  if (asis.length !== asiLevels.length) err(`Level ${level} ${cls.name} must assign ${asiLevels.length} ability score improvements.`);
  const preAbilities = {};
  const rb = racialBonus(race, input.raceAsiChoices, input.raceAsi);
  for (const ab of ABILITIES) preAbilities[ab] = (base[ab] ?? 10) + (rb[ab] ?? 0);
  const pickedFeats = [];
  const featCtx = () => ({ abilities: preAbilities, armorProfs: new Set([...(cls.armor ?? []), ...(level >= cls.subclassLevel ? cls.subclasses[subclassKey(input.class, input.subclass)]?.armor ?? [] : [])]), casts: !!(cls.spellcasting ?? cls.subclasses[subclassKey(input.class, input.subclass)]?.spellcasting) && level >= ((cls.spellcasting ?? cls.subclasses[subclassKey(input.class, input.subclass)]?.spellcasting)?.startLevel ?? 1) || !!race.cantripChoice || !!race.innateSpells, existing: [...pickedFeats], knownSkills: all, race: input.race, weaponProfs: new Set([...(cls.weapons ?? []), ...(race.weaponProfs ?? []), ...(level >= cls.subclassLevel ? cls.subclasses[subclassKey(input.class, input.subclass)]?.weapons ?? [] : [])]) });
  if (race.featChoice) {
    if (!input.raceFeat?.feat) err(`${race.name} chooses a feat.`);
    else {
      errors.push(...validateFeat(input.raceFeat.feat, input.raceFeat.choice, featCtx()));
      pickedFeats.push(input.raceFeat.feat);
      if (input.raceFeat.choice?.skills) all.push(...input.raceFeat.choice.skills);
    }
  } else if (input.raceFeat) err(`${race.name} does not choose a feat.`);
  for (const a of asis) {
    if (a.feat) {
      errors.push(...validateFeat(a.feat, a.choice, featCtx()));
      pickedFeats.push(a.feat);
      if (a.choice?.skills) all.push(...a.choice.skills);
      continue;
    }
    const total = Object.values(a.changes ?? {}).reduce((s, v) => s + v, 0);
    const vals = Object.values(a.changes ?? {});
    if (total !== 2 || vals.some(v => v < 1 || v > 2) || Object.keys(a.changes ?? {}).some(k => !ABILITIES.includes(k))) err('Each ability score improvement must add +2 to one ability or +1 to two (or choose a feat).');
  }
  if (!errors.length) {
    const tmp = { ...input, level, asiHistory: asis };
    const fa = finalAbilities(tmp);
    // pre-cap check: raw totals over 20 are wasted, which is disallowed
    for (const ab of ABILITIES) {
      let raw = (base[ab] ?? 0) + (racialBonus(race, input.raceAsiChoices, input.raceAsi)[ab] ?? 0);
      for (const a of asis) raw += (a.feat ? featChanges(a.feat, a.choice) : a.changes ?? {})[ab] ?? 0;
      if (input.raceFeat?.feat) raw += featChanges(input.raceFeat.feat, input.raceFeat.choice)[ab] ?? 0;
      if (raw > 20) err(`${ab.toUpperCase()} would exceed 20 (${raw}).`);
    }
    void fa;
  }

  // languages
  const extraLang = (race.extraLanguages ?? 0) + (bg.languages ?? 0);
  const langs = input.extraLanguages ?? [];
  if (langs.length !== extraLang) err(`Choose exactly ${extraLang} additional language(s).`);
  for (const l of langs) {
    if (!LANGUAGES.includes(l)) err(`Unknown language "${l}".`);
    if (race.languages.includes(l)) err(`${l} is already known.`);
  }
  if (new Set(langs).size !== langs.length) err('Languages must be different.');

  // equipment
  if (input.startingGold) {
    // allowed alternative; amount is rolled server-side
  } else if (!Number.isInteger(input.kit) || !cls.kits[input.kit]) err('Choose a valid starting equipment kit.');

  // spells
  errors.push(...validateSpellChoices({ ...input, level }, ctx));

  // race spell choice
  if (race.cantripChoice) {
    const c = input.raceCantrip;
    if (!c || !SPELLS[c] || SPELLS[c].level !== 0 || !SPELLS[c].classes.includes(race.cantripChoice.list)) err(`${race.name} must choose one ${race.cantripChoice.list} cantrip.`);
  } else if (input.raceCantrip) err(`${race.name} does not choose a racial cantrip.`);

  // description
  const d = input.description ?? {};
  for (const [k, v] of Object.entries(d)) {
    if (typeof v !== 'string') err(`Description field ${k} must be text.`);
    else if (v.length > 4000) err(`Description field ${k} is too long.`);
  }
  return errors;
}

export function validateSpellChoices(input) {
  const errors = [];
  const err = m => errors.push(m);
  const cls = CLASSES[input.class];
  const level = input.level;
  const subKey = cls && level >= cls.subclassLevel ? subclassKey(input.class, input.subclass) : null;
  const sc = cls?.spellcasting ?? cls?.subclasses?.[subKey]?.spellcasting;
  const cantrips = input.cantrips ?? [];
  const known = input.spellsKnown ?? [];
  const prepared = input.spellsPrepared ?? [];
  const book = input.spellbook ?? [];
  const casting = sc && level >= (sc.startLevel ?? 1);
  if (!casting) {
    if (cantrips.length || known.length || prepared.length || book.length) err(`${cls?.name ?? 'This class'} has no spellcasting at level ${level}.`);
    return errors;
  }
  const charLike = { class: input.class, level, race: input.race, baseAbilities: input.baseAbilities, raceAsiChoices: input.raceAsiChoices, raceAsi: input.raceAsi, asiHistory: input.asiHistory, inventory: [], subclass: level >= cls.subclassLevel ? subclassKey(input.class, input.subclass) : null };
  const listSet = classSpellList(charLike);
  const maxLvl = maxSpellLevel(charLike);
  const needCantrips = cantripsKnownCount(input.class, level, subKey);
  if (cantrips.length !== needCantrips) err(`${cls.name} at level ${level} knows exactly ${needCantrips} cantrips.`);
  for (const c of cantrips) {
    const s = SPELLS[c];
    if (!s) err(`Unknown spell "${c}".`);
    else if (s.level !== 0) err(`${s.name} is not a cantrip.`);
    else if (!listSet.has(c)) err(`${s.name} is not on the ${cls.name} spell list.`);
  }
  if (new Set(cantrips).size !== cantrips.length) err('Cantrips must be different.');
  const checkLeveled = (arr, label) => {
    for (const k of arr) {
      const s = SPELLS[k];
      if (!s) err(`Unknown spell "${k}".`);
      else if (s.level === 0) err(`${s.name} is a cantrip, not a ${label} spell.`);
      else if (s.level > maxLvl) err(`${s.name} is level ${s.level}; you can only learn spells up to level ${maxLvl}.`);
      else if (!listSet.has(k)) err(`${s.name} is not on the ${cls.name} spell list.`);
    }
    if (new Set(arr).size !== arr.length) err(`Duplicate ${label} spells.`);
  };
  if (sc.known) {
    const need = sc.known[level - 1];
    if (known.length !== need) err(`${cls.name} at level ${level} knows exactly ${need} spells.`);
    checkLeveled(known, 'known');
    if (prepared.length || book.length) err(`${cls.name} does not prepare spells.`);
    // third casters: mostly two schools, a few of free choice at 3rd, 8th, 14th and 20th level
    if (sc.schools) {
      const free = [3, 8, 14, 20].filter(l => level >= l).length;
      const off = known.filter(k => SPELLS[k] && !sc.schools.includes(SPELLS[k].school));
      if (off.length > free) err(`${cls.subclasses[subKey].name} spells must be ${sc.schools.join(' or ')} spells, except ${free} of any school (you have ${off.length}).`);
    }
  } else if (sc.spellbook) {
    const need = spellbookSize(level);
    if (book.length !== need) err(`Wizard spellbook must contain exactly ${need} spells.`);
    checkLeveled(book, 'spellbook');
    const maxPrep = preparedCount(charLike);
    if (prepared.length > maxPrep) err(`You can prepare at most ${maxPrep} spells.`);
    for (const p of prepared) if (!book.includes(p)) err(`${SPELLS[p]?.name ?? p} must be in your spellbook to prepare it.`);
  } else if (sc.prepared) {
    const maxPrep = preparedCount(charLike);
    const always = new Set(alwaysPreparedSpells(charLike));
    const counted = prepared.filter(p => !always.has(p));
    if (counted.length > maxPrep) err(`You can prepare at most ${maxPrep} spells.`);
    checkLeveled(prepared, 'prepared');
    if (known.length || book.length) err(`${cls.name} prepares spells rather than knowing them.`);
  }
  return errors;
}

export function expandKit(kit) {
  const items = { ...kit.items };
  if (kit.pack) for (const [k, q] of Object.entries(PACKS[kit.pack].contents)) items[k] = (items[k] ?? 0) + q;
  return items;
}

function addItem(inv, key, qty) {
  const def = ITEMS[key];
  if (!def) return;
  const stackable = def.kind === 'gear' || def.kind === 'potion' || def.kind === 'treasure' || ['dagger', 'dart', 'javelin', 'handaxe', 'lightHammer'].includes(key);
  const existing = stackable && inv.find(i => i.key === key && !i.custom);
  if (existing) existing.qty += qty;
  else if (stackable) inv.push({ id: uid('it_'), key, qty });
  else for (let i = 0; i < qty; i++) inv.push({ id: uid('it_'), key, qty: 1 });
}

export function autoEquip(char) {
  const inv = char.inventory;
  const armor = inv.filter(i => ARMOR[i.key] && ARMOR[i.key].category !== 'shield').sort((a, b) => ARMOR[b.key].baseAc - ARMOR[a.key].baseAc);
  const fa = finalAbilities(char);
  const pick = armor.find(a => isProficientArmor(char, ARMOR[a.key]) && (!ARMOR[a.key].strength || fa.str >= ARMOR[a.key].strength)) ?? armor.find(a => isProficientArmor(char, ARMOR[a.key]));
  if (pick) pick.equipped = 'armor';
  const weapons = inv.filter(i => WEAPONS[i.key]);
  const melee = weapons.filter(i => WEAPONS[i.key].category.endsWith('Melee')).sort((a, b) => avgDie(WEAPONS[b.key].damage) - avgDie(WEAPONS[a.key].damage));
  const ranged = weapons.filter(i => WEAPONS[i.key].category.endsWith('Ranged'));
  const preferRanged = ['archery'].some(s => char.fightingStyles?.includes(s)) || (char.class === 'ranger' && fa.dex > fa.str) || (melee.length === 0);
  const main = (preferRanged && ranged[0]) || melee.find(m => isProficientWeapon(char, WEAPONS[m.key])) || melee[0] || ranged[0];
  if (main) main.equipped = 'mainHand';
  const mainDef = main ? WEAPONS[main.key] : null;
  if (!mainDef?.properties.includes('twoHanded')) {
    const shield = inv.find(i => i.key === 'shield');
    if (shield && isProficientArmor(char, ARMOR.shield) && !(char.class === 'monk')) shield.equipped = 'offHand';
    else if (mainDef?.properties.includes('light')) {
      const off = weapons.find(w => w !== main && WEAPONS[w.key].properties.includes('light') && WEAPONS[w.key].category.endsWith('Melee'));
      if (off && char.fightingStyles?.includes('twoWeaponFighting')) off.equipped = 'offHand';
    }
  }
}

const avgDie = d => {
  const m = /(\d+)d(\d+)/.exec(d);
  return m ? (Number(m[1]) * (Number(m[2]) + 1)) / 2 : Number(d) || 0;
};

export function buildCharacter(input, ctx = {}) {
  const errors = validateCreation(input, ctx);
  if (errors.length) return { errors };
  const cls = CLASSES[input.class];
  const race = RACES[input.race];
  const bg = BACKGROUNDS[input.background];
  const level = input.level ?? 1;
  const char = {
    id: input.id ?? uid('ch_'),
    kind: 'pc',
    campaignId: ctx.campaignId ?? null,
    playerId: ctx.playerId ?? null,
    name: input.name.trim(),
    race: input.race,
    ancestry: input.ancestry ?? null,
    class: input.class,
    subclass: level >= cls.subclassLevel ? subclassKey(input.class, input.subclass) : null,
    level,
    xp: Math.max(XP_THRESHOLDS[level - 1], 0),
    background: input.background,
    alignment: input.alignment ?? 'True Neutral',
    abilityMethod: input.abilityMethod,
    baseAbilities: { ...input.baseAbilities },
    raceAsiChoices: input.raceAsiChoices ?? [],
    raceAsi: input.raceAsi ?? null,
    asiHistory: (input.asiHistory ?? []).map((a, i) => (a.feat ? { level: asiLevelsFor(input.class)[i], class: input.class, feat: a.feat, choice: a.choice ?? null, changes: featChanges(a.feat, a.choice) } : { level: asiLevelsFor(input.class)[i], class: input.class, changes: a.changes })),
    raceFeat: input.raceFeat?.feat ? { feat: input.raceFeat.feat, choice: input.raceFeat.choice ?? null, changes: featChanges(input.raceFeat.feat, input.raceFeat.choice) } : null,
    classes: [{ class: input.class, level, subclass: level >= cls.subclassLevel ? subclassKey(input.class, input.subclass) : null }],
    levelHistory: Array.from({ length: level }, () => input.class),
    multiclassProfs: { armor: [], weapons: [] },
    skills: [...new Set([...(bg.skills ?? []), ...(race.skillProfs ?? []), ...(input.raceSkills ?? []), ...(input.classSkills ?? []), ...(input.raceFeat?.choice?.skills ?? []), ...(input.asiHistory ?? []).flatMap(a => a.choice?.skills ?? [])])],
    expertise: input.expertise ?? [],
    languages: [...race.languages, ...(input.extraLanguages ?? [])],
    toolProfs: [...(cls.tools ?? []), ...(bg.tools ?? []), ...(race.toolProfs ?? [])],
    fightingStyles: input.fightingStyles ?? [],
    metamagic: input.metamagic ?? [],
    invocations: input.invocations ?? [],
    pactBoon: input.pactBoon ?? null,
    infusions: input.infusions ?? [],
    hpRolls: [],
    hitDiceUsed: 0,
    tempHp: 0,
    deathSaves: { successes: 0, failures: 0 },
    stable: false,
    dead: false,
    conditions: [],
    exhaustion: 0,
    effects: [],
    spells: {
      cantrips: input.cantrips ?? [],
      known: input.spellsKnown ?? [],
      spellbook: input.spellbook ?? [],
      prepared: input.spellsPrepared ?? [],
      raceCantrip: input.raceCantrip ?? null,
    },
    slots: {},
    pactSlots: null,
    resources: {},
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: bg.gold ?? 0, pp: 0 },
    description: { ...(input.description ?? {}) },
    preferences: { autoShield: true, autoUncannyDodge: true, autoOpportunityAttack: true, autoIndomitable: true },
    pendingLevelUp: false,
    preparationOpen: true,
    lastLongRestMinute: null,
    createdAt: Date.now(),
  };
  const inv = char.inventory;
  if (input.startingGold) char.currency.gp += ctx.startingGold ?? 0;
  else for (const [k, q] of Object.entries(expandKit(cls.kits[input.kit]))) addItem(inv, k, q);
  for (const [k, q] of Object.entries(bg.items ?? {})) addItem(inv, k, q);
  autoEquip(char);
  syncResources(char);
  char.maxHp = computeMaxHp(char);
  char.hp = char.maxHp;
  return { character: char, errors: [] };
}

// the creator's input that builds this character again, for editing it; older
// characters, made before the input was kept, get it pieced back together
export function creationInput(ch) {
  if (ch.creation) return structuredClone(ch.creation);
  const race = RACES[ch.race];
  const cls = CLASSES[ch.class];
  const bg = BACKGROUNDS[ch.background];
  const fixed = new Set([...(bg?.skills ?? []), ...(race?.skillProfs ?? [])]);
  const featSkills = new Set([...(ch.raceFeat?.choice?.skills ?? []), ...(ch.asiHistory ?? []).flatMap(a => a.choice?.skills ?? [])]);
  const from = cls.skills.from === 'any' ? Object.keys(SKILLS) : cls.skills.from;
  const free = (ch.skills ?? []).filter(s => !fixed.has(s) && !featSkills.has(s));
  const classSkills = free.filter(s => from.includes(s)).slice(0, cls.skills.count);
  return {
    name: ch.name, race: ch.race, ancestry: ch.ancestry ?? null, class: ch.class, subclass: subclassOf(ch, ch.class), background: ch.background, alignment: ch.alignment,
    abilityMethod: ch.abilityMethod, baseAbilities: { ...ch.baseAbilities }, raceAsiChoices: [...(ch.raceAsiChoices ?? [])], raceAsi: ch.raceAsi ? { ...ch.raceAsi } : null,
    raceSkills: race?.skillChoice ? free.filter(s => !classSkills.includes(s)) : [], classSkills, expertise: [...(ch.expertise ?? [])],
    fightingStyles: [...(ch.fightingStyles ?? [])], metamagic: [...(ch.metamagic ?? [])], invocations: [...(ch.invocations ?? [])], pactBoon: ch.pactBoon ?? null, infusions: [...(ch.infusions ?? [])],
    extraLanguages: (ch.languages ?? []).filter(l => !race?.languages.includes(l)), kit: 0, raceCantrip: ch.spells?.raceCantrip ?? null,
    raceFeat: ch.raceFeat?.feat ? { feat: ch.raceFeat.feat, choice: ch.raceFeat.choice ?? {} } : null,
    cantrips: [...(ch.spells?.cantrips ?? [])], spellsKnown: [...(ch.spells?.known ?? [])], spellbook: [...(ch.spells?.spellbook ?? [])], spellsPrepared: [...(ch.spells?.prepared ?? [])],
    asiHistory: (ch.asiHistory ?? []).map(a => (a.feat ? { feat: a.feat, choice: a.choice ?? {} } : { changes: { ...a.changes } })),
    description: { ...(ch.description ?? {}) },
    rolledScores: ch.abilityMethod === 'rolled' ? Object.values(ch.baseAbilities) : null,
  };
}

export function xpToNext(char) {
  return char.level >= 20 ? null : XP_THRESHOLDS[char.level];
}

export function refreshLevelState(char) {
  char.pendingLevelUp = char.level < 20 && levelForXp(char.xp) > char.level;
  return char;
}

function statsFor(ability, m, pb) {
  return { ability, dc: 8 + pb + m[ability], attack: pb + m[ability], mod: m[ability] };
}

export function spellcastingStats(char) {
  const race = RACES[char.race];
  const m = mods(char);
  const pb = profBonus(char.level);
  const out = { classes: {} };
  for (const { class: k } of castingClasses(char)) out.classes[k] = statsFor(castingOf(char, k).ability, m, pb);
  out.class = out.classes[char.class] ?? Object.values(out.classes)[0];
  if (!out.class) delete out.class;
  if (race?.cantripChoice) out.race = statsFor(race.cantripChoice.ability, m, pb);
  if (race?.innateAbility) out.innate = statsFor(race.innateAbility, m, pb);
  const mi = featsOf(char).find(f => f.key === 'magicInitiate');
  if (mi?.choice?.class) out.feat = statsFor(MI_ABILITY[mi.choice.class], m, pb);
  else {
    // other spell feats: the ability they raised, or the one they name
    const sf = featsOf(char).find(f => FEATS[f.key]?.spells);
    if (sf) out.feat = statsFor(FEATS[sf.key].spellAbility ?? (['int', 'wis', 'cha'].includes(sf.choice?.ability) ? sf.choice.ability : 'int'), m, pb);
  }
  return out;
}

// source tag for a class: the first class keeps the legacy 'class' tag
export const classSource = (char, cls) => (cls === char.class ? 'class' : `class:${cls}`);

// spells the character may cast right now (not counting slots)
export function castableSpells(char) {
  const out = new Map();
  const add = (k, source) => SPELLS[k] && !out.has(k) && out.set(k, source);
  for (const { class: k, level } of castingClasses(char)) {
    const sc = castingOf(char, k);
    const lists = spellListsFor(char, k);
    const src = classSource(char, k);
    (lists.cantrips ?? []).forEach(x => add(x, src));
    if (sc.known) (lists.known ?? []).forEach(x => add(x, src));
    else (lists.prepared ?? []).forEach(x => add(x, src));
    const sub = subclassDef(char, k);
    if (sub?.domainSpells && level >= sub.level) for (const [lv, spells] of Object.entries(sub.domainSpells)) if (level >= Number(lv)) spells.forEach(x => add(x, src));
    if (sub?.cantrips && level >= sub.level) sub.cantrips.forEach(x => add(x, src));
  }
  if (char.spells?.raceCantrip) add(char.spells.raceCantrip, 'race');
  for (const sp of RACES[char.race]?.innateSpells ?? []) if (char.level >= sp.level) add(sp.spell, sp.atWill ? 'innateAtWill' : 'innate');
  const inv = allInvocations(char);
  for (const [i, k] of Object.entries(AT_WILL_INVOCATIONS)) if (inv.includes(i)) add(k, 'invocation');
  // invocations that cast a spell with a warlock slot
  if (cl(char, 'warlock')) for (const [i, k] of Object.entries(SLOT_INVOCATIONS)) if (inv.includes(i)) add(k, classSource(char, 'warlock'));
  const fs = featSpells(char);
  fs.atWill.forEach(x => add(x, 'feat'));
  fs.cantrips.forEach(x => add(x, 'feat'));
  fs.once.forEach(x => add(x, 'featOnce'));
  const mi = featsOf(char).find(f => f.key === 'magicInitiate');
  if (mi?.choice) {
    (mi.choice.cantrips ?? []).forEach(x => add(x, 'feat'));
    if (mi.choice.spell) add(mi.choice.spell, 'featOnce');
  }
  return out;
}

const AT_WILL_INVOCATIONS = { armorOfShadows: 'mageArmor', fiendishVigor: 'falseLife', maskOfManyFaces: 'disguiseSelf', beastSpeech: 'speakWithAnimals', eldritchSight: 'detectMagic', mistyVisions: 'silentImage', ascendantStep: 'levitate', otherworldlyLeap: 'jump', whispersOfTheGrave: 'speakWithDead', shroudOfShadow: 'invisibility', chainsOfCarceri: 'holdMonster' };
const SLOT_INVOCATIONS = { bewitchingWhispers: 'compulsion', dreadfulWord: 'confusion', minionsOfChaos: 'conjureElemental', mireTheMind: 'slow', sculptorOfFlesh: 'polymorph', signOfIllOmen: 'bestowCurse', thiefOfFiveFates: 'bane', tricksterssEscape: 'freedomOfMovement', giftOfTheDepths: 'waterBreathing', undyingServitude: 'animateDead' };

export function ritualSpells(char) {
  const out = [];
  for (const { class: k } of castingClasses(char)) {
    const sc = castingOf(char, k);
    if (!sc.ritual) continue;
    const lists = spellListsFor(char, k);
    const pool = sc.spellbook ? lists.spellbook : sc.known ? lists.known : lists.prepared;
    out.push(...(pool ?? []).filter(x => SPELLS[x]?.ritual));
  }
  return [...new Set(out)];
}

// which class a castable spell belongs to, for slot choice and DC
export function spellClassOf(char, key, source) {
  if (source === 'class') return char.class;
  if (source?.startsWith('class:')) return source.slice(6);
  return null;
}

export function summarizeCharacter(char) {
  const r = RACES[char.race];
  const cls = classLevels(char).map(x => `${CLASSES[x.class]?.name ?? x.class}${classLevels(char).length > 1 ? ` ${x.level}` : ''}`).join('/');
  return `${char.name}, level ${char.level} ${r?.name ?? char.race} ${cls}`;
}

export { MAGIC_ITEMS };
