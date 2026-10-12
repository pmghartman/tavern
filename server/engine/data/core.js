import { dict } from './dict.js';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITY_NAMES = dict({ str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' });

export const SKILLS = dict({
  acrobatics: 'dex', animalHandling: 'wis', arcana: 'int', athletics: 'str', deception: 'cha', history: 'int',
  insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
  performance: 'cha', persuasion: 'cha', religion: 'int', sleightOfHand: 'dex', stealth: 'dex', survival: 'wis',
});

export const SKILL_NAMES = dict({
  acrobatics: 'Acrobatics', animalHandling: 'Animal Handling', arcana: 'Arcana', athletics: 'Athletics', deception: 'Deception',
  history: 'History', insight: 'Insight', intimidation: 'Intimidation', investigation: 'Investigation', medicine: 'Medicine',
  nature: 'Nature', perception: 'Perception', performance: 'Performance', persuasion: 'Persuasion', religion: 'Religion',
  sleightOfHand: 'Sleight of Hand', stealth: 'Stealth', survival: 'Survival', thievesTools: "Thieves' Tools",
});

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export const ALIGNMENTS = ['Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'True Neutral', 'Chaotic Neutral', 'Lawful Evil', 'Neutral Evil', 'Chaotic Evil'];

export const LANGUAGES = ['Common', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc', 'Abyssal', 'Celestial', 'Draconic', 'Deep Speech', 'Infernal', 'Primordial', 'Sylvan', 'Undercommon'];

export const abilityMod = score => Math.floor((score - 10) / 2);
export const profBonus = level => 2 + Math.floor((Math.max(1, level) - 1) / 4);

// XP needed to reach each level; index 0 is level 1
export const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

export function levelForXp(xp) {
  let lvl = 1;
  for (let i = 0; i < XP_THRESHOLDS.length; i++) if (xp >= XP_THRESHOLDS[i]) lvl = i + 1;
  return lvl;
}

export const INCAPACITATING = ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'];

export const CONDITIONS = dict({
  blinded: 'Cannot see; automatically fails checks that need sight. Attacks against it have advantage, its attacks have disadvantage.',
  charmed: 'Cannot attack the charmer or target it with harmful effects; the charmer has advantage on social checks against it.',
  deafened: 'Cannot hear; automatically fails checks that need hearing.',
  exhaustion: 'Cumulative levels: 1 disadvantage on checks, 2 speed halved, 3 disadvantage on attacks and saves, 4 hit point maximum halved, 5 speed 0, 6 death.',
  frightened: 'Disadvantage on checks and attacks while the source of fear is in sight; cannot willingly move closer to it.',
  grappled: 'Speed 0. Ends if the grappler is incapacitated or the creature is moved out of reach.',
  incapacitated: 'Cannot take actions or reactions.',
  invisible: 'Cannot be seen without magic or a special sense. Its attacks have advantage, attacks against it have disadvantage.',
  paralyzed: 'Incapacitated, cannot move or speak. Fails Strength and Dexterity saves. Attacks against it have advantage; hits from within 5 ft are critical.',
  petrified: 'Turned to stone: incapacitated, resistant to all damage, immune to poison and disease.',
  poisoned: 'Disadvantage on attack rolls and ability checks.',
  prone: 'Can only crawl. Disadvantage on attacks. Attacks within 5 ft have advantage against it, farther attacks have disadvantage.',
  restrained: 'Speed 0. Disadvantage on attacks and Dexterity saves; attacks against it have advantage.',
  stunned: 'Incapacitated, cannot move, can speak only falteringly. Fails Strength and Dexterity saves; attacks against it have advantage.',
  unconscious: 'Incapacitated, prone, unaware. Fails Strength and Dexterity saves; attacks against it have advantage, hits from within 5 ft are critical.',
});

export const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];

export function crValue(cr) {
  if (typeof cr === 'number') return cr;
  const s = String(cr ?? '0');
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    return a / b;
  }
  return Number(s) || 0;
}

export const CR_XP = {
  0: 10, '1/8': 25, '1/4': 50, '1/2': 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
  11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 30: 155000,
};

// easy, medium, hard, deadly XP per character, by level (index 0 unused)
export const ENCOUNTER_THRESHOLDS = [
  [0, 0, 0, 0],
  [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500], [250, 500, 750, 1100],
  [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100], [550, 1100, 1600, 2400], [600, 1200, 1900, 2800],
  [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500], [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400],
  [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700],
];

export function encounterMultiplier(count) {
  if (count <= 1) return 1;
  if (count === 2) return 1.5;
  if (count <= 6) return 2;
  if (count <= 10) return 2.5;
  if (count <= 14) return 3;
  return 4;
}

export const tierOf = level => (level <= 4 ? 1 : level <= 10 ? 2 : level <= 16 ? 3 : 4);

// improvised damage by tier and severity (DMG)
export const HAZARD_DAMAGE = {
  1: { setback: '1d10', dangerous: '2d10', deadly: '4d10' },
  2: { setback: '2d10', dangerous: '4d10', deadly: '10d10' },
  3: { setback: '4d10', dangerous: '10d10', deadly: '18d10' },
  4: { setback: '10d10', dangerous: '18d10', deadly: '24d10' },
};

// largest single treasure award in gp, by tier
export const MAX_GOLD_AWARD = { 1: 500, 2: 5000, 3: 30000, 4: 150000 };

export const RARITY_MIN_LEVEL = { common: 1, uncommon: 1, rare: 5, 'very rare': 11, legendary: 17, artifact: 21 };
