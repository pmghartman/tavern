import { CLASSES, METAMAGIC, INVOCATIONS, PACT_BOONS, INFUSIONS, MULTICLASS, subclassKey } from './data/classes.js';
import { ABILITIES, XP_THRESHOLDS, SKILLS, levelForXp } from './data/core.js';
import { SPELLS } from './data/spells.js';
import { FEATS } from './data/feats.js';
import { roll } from './dice.js';
import { weaponProficiencies, asiLevelsFor, finalAbilities, computeMaxHp, syncResources, validateSpellChoices, cantripsKnownCount, spellbookSize, levelHistory, armorProficiencies, castableSpells, spellListsFor, learnMaxLevel } from './character.js';
import { classLevels, cl, subclassOf } from './classlevel.js';
import { featsOf, featChanges, validateFeat } from './feats.js';
import { RuleError } from './util.js';

const meets = (abil, req, any = false) => {
  if (!req) return true;
  const checks = Object.entries(req).map(([k, v]) => abil[k] >= v);
  return any ? checks.some(Boolean) : checks.every(Boolean);
};

export function multiclassPrereqErrors(char, target) {
  const abil = finalAbilities(char);
  const errs = [];
  const ok = k => meets(abil, MULTICLASS[k].req, false) && meets(abil, MULTICLASS[k].reqAny, true);
  const fmt = k => Object.entries(MULTICLASS[k].req ?? MULTICLASS[k].reqAny).map(([a, v]) => `${a.toUpperCase()} ${v}`).join(MULTICLASS[k].reqAny ? ' or ' : ' and ');
  if (!ok(target)) errs.push(`Multiclassing into ${CLASSES[target].name} requires ${fmt(target)}.`);
  for (const { class: k } of classLevels(char)) if (!ok(k)) errs.push(`To multiclass you must still meet the ${CLASSES[k].name} prerequisite (${fmt(k)}).`);
  return errs;
}

export function multiclassOptions(char) {
  return Object.keys(CLASSES).map(k => ({ class: k, current: cl(char, k), errors: cl(char, k) ? [] : multiclassPrereqErrors(char, k) }));
}

// what a level in `cls` requires the player to choose
export function levelUpRequirements(char, cls = null, { subclass = null } = {}) {
  const target = cls ?? classLevels(char).at(-1)?.class ?? char.class;
  const before = cl(char, target);
  const after = before + 1;
  const def = CLASSES[target];
  const req = { level: char.level + 1, class: target, classLevel: after, newClass: before === 0, hitDie: def.hitDie, asi: asiLevelsFor(target).includes(after) };
  // a subclass can bring spellcasting (Eldritch Knight), so the choice in progress counts
  const subKey = subclassOf(char, target) ?? (subclass ? subclassKey(target, subclass) : null);
  const sc = def.spellcasting ?? def.subclasses?.[subKey]?.spellcasting ?? null;
  if (sc && after >= (sc.startLevel ?? 1)) {
    const prevOk = before >= (sc.startLevel ?? 1);
    req.newCantrips = cantripsKnownCount(target, after, subKey) - (prevOk ? cantripsKnownCount(target, before, subKey) : 0);
    req.listClass = sc.list ?? target;
    if (sc.schools) req.schools = sc.schools;
    if (sc.known) req.newKnown = sc.known[after - 1] - (prevOk ? sc.known[before - 1] : 0);
    if (sc.spellbook) req.newSpellbook = before === 0 ? 6 : 2;
    if (sc.prepared && !prevOk) req.choosePrepared = true;
    req.learnMax = learnMaxLevel(target, after, subKey);
  }
  if (def.fightingStyle && after === def.fightingStyle.level) req.fightingStyle = 1;
  if (target === 'fighter' && after === 10 && subclassOf(char, 'fighter') === 'champion') req.fightingStyle = 1;
  if (after === def.subclassLevel && !subclassOf(char, target)) req.subclass = Object.values(def.subclasses).map(s => ({ key: s.key, name: s.name, desc: s.desc, srd: !!s.srd, source: s.source, casts: !!s.spellcasting }));
  if (target === 'sorcerer') req.metamagic = ({ 3: 2, 10: 1, 17: 1 })[after] ?? 0;
  if (target === 'warlock') {
    req.invocations = def.invocations[after - 1] - (before ? def.invocations[before - 1] : 0);
    if (after === 3) req.pactBoon = true;
  }
  if (def.infusions) req.infusions = def.infusions[after - 1] - (before ? def.infusions[before - 1] : 0);
  if (target === 'rogue' && (after === 1 || after === 6)) req.expertise = 2;
  if (target === 'bard' && (after === 3 || after === 10)) req.expertise = 2;
  if (req.newClass) {
    req.multiclassSkills = MULTICLASS[target].skills ?? 0;
    req.prereqErrors = multiclassPrereqErrors(char, target);
  }
  return req;
}

export function canLevelUp(char, campaign) {
  if (char.level >= 20) return false;
  if (campaign?.settings?.leveling === 'milestone') return (char.milestoneLevels ?? 0) > 0;
  return char.xp >= XP_THRESHOLDS[char.level];
}

// choices: {class, hp, asi:{changes}|feat:{key, choice}, cantrips, spellsKnown, spellbook, spellsPrepared, replaceSpell, fightingStyle, metamagic, invocations, pactBoon, expertise, skills}
export function levelUp(char, choices = {}, { rng, campaign } = {}) {
  if (!canLevelUp(char, campaign)) throw new RuleError(`${char.name} has not earned a level yet.`, 'no_level');
  const target = choices.class ?? classLevels(char).at(-1)?.class ?? char.class;
  if (!Object.hasOwn(CLASSES, target)) throw new RuleError(`Unknown class "${choices.class}".`);
  const req = levelUpRequirements(char, target, { subclass: choices.subclass });
  const def = CLASSES[target];
  if (req.newClass && req.prereqErrors.length) throw new RuleError(req.prereqErrors.join(' '), 'multiclass_prereq');
  const scDef = def.spellcasting ?? def.subclasses?.[subclassOf(char, target) ?? subclassKey(target, choices.subclass)]?.spellcasting ?? null;
  const casting = scDef && req.classLevel >= (scDef.startLevel ?? 1);
  const allowed = { subclass: !!req.subclass, cantrips: casting && req.newCantrips > 0, spellsKnown: casting && !!scDef?.known, replaceSpell: casting && !!scDef?.known && !req.newClass && req.classLevel > (scDef.startLevel ?? 1), spellbook: casting && !!scDef?.spellbook, spellsPrepared: casting && !!scDef?.prepared, fightingStyle: !!req.fightingStyle, metamagic: !!req.metamagic, invocations: !!req.invocations, infusions: !!req.infusions, pactBoon: !!req.pactBoon, expertise: !!req.expertise, skills: !!req.multiclassSkills, feat: req.asi, asi: req.asi };
  for (const [k, ok] of Object.entries(allowed)) {
    const v = choices[k];
    const present = Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '';
    if (present && !ok) throw new RuleError(k === 'asi' || k === 'feat' ? `${def.name} level ${req.classLevel} does not grant an Ability Score Improvement.` : `${def.name} level ${req.classLevel} does not choose ${k}.`);
  }
  const draft = structuredClone(char);
  const out = { hpGain: 0, features: def.features.filter(f => f.level === req.classLevel).map(f => f.name), class: target, classLevel: req.classLevel };
  // class bookkeeping
  draft.classes = classLevels(char).map(x => ({ ...x }));
  draft.levelHistory = [...levelHistory(char), target];
  const entry = draft.classes.find(x => x.class === target);
  if (entry) entry.level += 1;
  else draft.classes.push({ class: target, level: 1, subclass: null });
  draft.level = char.level + 1;
  const ce = draft.classes.find(x => x.class === target);
  if (req.subclass) {
    const key = subclassKey(target, choices.subclass);
    if (!key) throw new RuleError(`${def.name} level ${req.classLevel} chooses a subclass: ${req.subclass.map(s => s.name).join(' or ')}.`);
    ce.subclass = key;
    out.features.push(def.subclasses[key].name);
  }
  if (target === draft.class) draft.subclass = ce.subclass;
  // multiclass proficiencies
  if (req.newClass) {
    const mc = MULTICLASS[target];
    draft.multiclassProfs = { armor: [...new Set([...(draft.multiclassProfs?.armor ?? []), ...(mc.armor ?? [])])], weapons: [...new Set([...(draft.multiclassProfs?.weapons ?? []), ...(mc.weapons ?? [])])] };
    draft.toolProfs = [...new Set([...(draft.toolProfs ?? []), ...(mc.tools ?? [])])];
    const sk = choices.skills ?? [];
    if (sk.length !== req.multiclassSkills) throw new RuleError(`Multiclassing into ${def.name} grants ${req.multiclassSkills} skill proficienc${req.multiclassSkills === 1 ? 'y' : 'ies'}; choose ${req.multiclassSkills}.`);
    const pool = target === 'bard' ? Object.keys(SKILLS) : def.skills.from === 'any' ? Object.keys(SKILLS) : def.skills.from;
    for (const s of sk) {
      if (!pool.includes(s)) throw new RuleError(`${s} is not a ${def.name} skill.`);
      if (draft.skills.includes(s)) throw new RuleError(`You are already proficient in ${s}.`);
    }
    draft.skills.push(...sk);
  }
  // hit points
  let gain;
  if (choices.hp === 'roll') gain = roll(`1d${def.hitDie}`, rng).total;
  else if (!choices.hp || choices.hp === 'average') gain = Math.floor(def.hitDie / 2) + 1;
  else throw new RuleError('Hit points must be average or roll.');
  draft.hpRolls = [...(draft.hpRolls ?? []), gain];
  // ability score improvement or feat
  if (req.asi) {
    if (choices.feat) {
      const { key, choice } = choices.feat;
      const errs = validateFeat(key, choice, { abilities: finalAbilities(char), armorProfs: armorProficiencies(char), casts: castableSpells(char).size > 0, existing: featsOf(char).map(f => f.key), knownSkills: draft.skills, race: char.race, weaponProfs: weaponProficiencies(char) });
      if (errs.length) throw new RuleError(errs.join(' '));
      const changes = featChanges(key, choice);
      const before = finalAbilities(char);
      for (const [k, v] of Object.entries(changes)) if (before[k] + v > 20) throw new RuleError(`${k.toUpperCase()} cannot exceed 20.`);
      draft.asiHistory = [...(draft.asiHistory ?? []), { level: draft.level, class: target, feat: key, choice: choice ?? null, changes }];
      if (choice?.skills?.length) draft.skills.push(...choice.skills.filter(s => !draft.skills.includes(s)));
      out.features.push(`Feat: ${FEATS[key].name}`);
    } else {
      const ch = choices.asi?.changes;
      if (!ch) throw new RuleError(`${def.name} level ${req.classLevel} grants an Ability Score Improvement: choose +2 to one ability, +1 to two, or a feat.`);
      const vals = Object.values(ch);
      if (vals.reduce((a, b) => a + b, 0) !== 2 || vals.some(v => v < 1 || v > 2) || Object.keys(ch).some(k => !ABILITIES.includes(k))) throw new RuleError('An Ability Score Improvement is +2 to one ability or +1 to two.');
      const before = finalAbilities(char);
      for (const [k, v] of Object.entries(ch)) if (before[k] + v > 20) throw new RuleError(`${k.toUpperCase()} cannot exceed 20.`);
      draft.asiHistory = [...(draft.asiHistory ?? []), { level: draft.level, class: target, changes: ch }];
    }
  }
  // spells for this class
  if (casting) {
    const sc = scDef;
    const primary = target === draft.class;
    draft.spells = draft.spells ?? {};
    if (!primary) draft.spells.byClass = { ...(draft.spells.byClass ?? {}) };
    const lists = primary ? draft.spells : (draft.spells.byClass[target] = { cantrips: [], known: [], prepared: [], spellbook: [], ...(structuredClone(spellListsFor(char, target))) });
    const newC = choices.cantrips ?? [];
    if (newC.length !== (req.newCantrips ?? 0)) throw new RuleError(`Choose exactly ${req.newCantrips ?? 0} new ${def.name} cantrip(s).`);
    lists.cantrips = [...(lists.cantrips ?? []), ...newC];
    if (sc.known) {
      const add = choices.spellsKnown ?? [];
      if (add.length !== req.newKnown) throw new RuleError(`Choose exactly ${req.newKnown} new ${def.name} spell(s) known.`);
      let known = [...(lists.known ?? []), ...add];
      if (choices.replaceSpell) {
        const { from, to } = choices.replaceSpell;
        if (!known.includes(from)) throw new RuleError(`You do not know ${SPELLS[from]?.name ?? from}.`);
        known = known.map(k => (k === from ? to : k));
      }
      lists.known = known;
    }
    if (sc.spellbook) {
      const add = choices.spellbook ?? [];
      if (add.length !== req.newSpellbook) throw new RuleError(`Add exactly ${req.newSpellbook} spells to your spellbook.`);
      lists.spellbook = [...(lists.spellbook ?? []), ...add];
    }
    if (sc.prepared && choices.spellsPrepared) lists.prepared = choices.spellsPrepared;
    const errs = validateSpellChoices({
      class: target, subclass: ce.subclass, level: req.classLevel, race: draft.race, baseAbilities: draft.baseAbilities, raceAsiChoices: draft.raceAsiChoices, raceAsi: draft.raceAsi, asiHistory: draft.asiHistory, raceFeat: draft.raceFeat,
      cantrips: lists.cantrips ?? [], spellsKnown: sc.known ? lists.known : [], spellbook: sc.spellbook ? (lists.spellbook ?? []).slice(0, spellbookSize(req.classLevel)) : [], spellsPrepared: sc.prepared ? lists.prepared ?? [] : [],
    }).filter(e => !/spellbook must contain exactly/.test(e) && !(req.newClass && sc.spellbook && /spellbook/.test(e) && false));
    if (sc.spellbook) {
      for (const s of choices.spellbook ?? []) {
        const d = SPELLS[s];
        if (!d || !d.classes.includes('wizard') || d.level === 0) errs.push(`${d?.name ?? s} cannot be added to a spellbook.`);
      }
      if (new Set(lists.spellbook).size !== lists.spellbook.length) errs.push('Your spellbook already has that spell.');
    }
    if (errs.length) throw new RuleError(errs.join(' '));
  }
  if (req.fightingStyle) {
    const fs = choices.fightingStyle;
    const opts = def.fightingStyle.options.filter(o => !draft.fightingStyles.includes(o));
    if (!fs || !opts.includes(fs)) throw new RuleError(`Choose a new fighting style: ${opts.join(', ')}.`);
    draft.fightingStyles.push(fs);
  }
  if (req.metamagic) {
    const mm = choices.metamagic ?? [];
    if (mm.length !== req.metamagic || mm.some(m => !Object.hasOwn(METAMAGIC, m) || draft.metamagic.includes(m))) throw new RuleError(`Choose ${req.metamagic} new Metamagic option(s).`);
    draft.metamagic.push(...mm);
  }
  if (req.invocations) {
    const inv = choices.invocations ?? [];
    if (inv.length !== req.invocations || inv.some(i => !Object.hasOwn(INVOCATIONS, i) || draft.invocations.includes(i))) throw new RuleError(`Choose ${req.invocations} new invocation(s).`);
    draft.invocations.push(...inv);
  }
  if (req.infusions) {
    const inf = choices.infusions ?? [];
    draft.infusions = draft.infusions ?? [];
    if (inf.length !== req.infusions || inf.some(i => !Object.hasOwn(INFUSIONS, i) || draft.infusions.includes(i) || (INFUSIONS[i].level ?? 2) > req.classLevel)) throw new RuleError(`Choose ${req.infusions} new infusion(s) you meet the level for.`);
    draft.infusions.push(...inf);
  }
  if (req.pactBoon) {
    if (!Object.hasOwn(PACT_BOONS, choices.pactBoon ?? '')) throw new RuleError('Choose a pact boon: blade, chain, tome or talisman.');
    draft.pactBoon = choices.pactBoon;
  }
  if (req.expertise) {
    const ex = choices.expertise ?? [];
    if (ex.length !== req.expertise || ex.some(s => !draft.skills.includes(s) || draft.expertise.includes(s))) throw new RuleError(`Choose ${req.expertise} proficient skills for Expertise.`);
    draft.expertise.push(...ex);
  }
  // commit
  const oldMax = char.maxHp;
  syncResources(draft);
  draft.maxHp = computeMaxHp(draft);
  draft.hp = Math.max(1, char.hp + (draft.maxHp - oldMax));
  out.hpGain = draft.maxHp - oldMax;
  if (campaign?.settings?.leveling === 'milestone') {
    draft.milestoneLevels = Math.max(0, (draft.milestoneLevels ?? 1) - 1);
    draft.xp = Math.max(draft.xp, XP_THRESHOLDS[draft.level - 1]);
  }
  draft.pendingLevelUp = draft.level < 20 && (campaign?.settings?.leveling === 'milestone' ? (draft.milestoneLevels ?? 0) > 0 : levelForXp(draft.xp) > draft.level);
  Object.assign(char, draft);
  return out;
}
