import { dict } from './dict.js';

// SRD races (the SRD subrace for each) plus the variant human
export const RACES = dict({
  human: {
    name: 'Human', base: 'human', size: 'Medium', speed: 30, darkvision: 0,
    asi: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
    languages: ['Common'], extraLanguages: 1, traits: [],
    blurb: 'Ambitious and adaptable, humans gain +1 to every ability score and one extra language.',
  },
  // Tasha's Cauldron of Everything: a lineage of your own design
  customLineage: {
    name: 'Custom Lineage', base: 'customLineage', source: 'TCE', size: 'Medium', speed: 30, darkvision: 0,
    asi: {}, asiChoice: { count: 1, amount: 2, exclude: [] }, skillChoice: { count: 1 }, featChoice: true,
    languages: ['Common'], extraLanguages: 1, traits: [],
    blurb: 'A people of your own invention (Tasha\'s): +2 to one ability, a feat, a skill proficiency and an extra language. Small or Medium, as you like.',
  },
  variantHuman: {
    name: 'Variant Human', base: 'human', size: 'Medium', speed: 30, darkvision: 0,
    asi: {}, asiChoice: { count: 2, exclude: [] }, skillChoice: { count: 1 }, featChoice: true,
    languages: ['Common'], extraLanguages: 1, traits: [],
    blurb: 'Variant humans raise two abilities by 1, gain one skill proficiency and start with a feat.',
  },
  dwarf: {
    name: 'Hill Dwarf', base: 'dwarf', size: 'Medium', speed: 25, darkvision: 60,
    asi: { con: 2, wis: 1 }, hpPerLevel: 1, resistances: ['poison'],
    traits: ['dwarvenResilience', 'stonecunning', 'dwarvenToughness'],
    weaponProfs: ['battleaxe', 'handaxe', 'lightHammer', 'warhammer'], toolProfs: ["smith's tools"],
    languages: ['Common', 'Dwarvish'], extraLanguages: 0,
    blurb: 'Stout and wise, hill dwarves resist poison, see in the dark and gain an extra hit point every level. Heavy armor does not slow them.',
  },
  elf: {
    name: 'High Elf', base: 'elf', size: 'Medium', speed: 30, darkvision: 60,
    asi: { dex: 2, int: 1 }, skillProfs: ['perception'],
    traits: ['feyAncestry', 'trance', 'keenSenses'],
    weaponProfs: ['longsword', 'shortsword', 'shortbow', 'longbow'],
    cantripChoice: { list: 'wizard', ability: 'int' },
    languages: ['Common', 'Elvish'], extraLanguages: 1,
    blurb: 'Graceful and keen-eyed, high elves resist charms, never sleep, know one wizard cantrip and an extra language.',
  },
  halfling: {
    name: 'Lightfoot Halfling', base: 'halfling', size: 'Small', speed: 25, darkvision: 0,
    asi: { dex: 2, cha: 1 },
    traits: ['lucky', 'brave', 'halflingNimbleness', 'naturallyStealthy'],
    languages: ['Common', 'Halfling'], extraLanguages: 0,
    blurb: 'Lucky (reroll natural 1s), brave against fear, and able to hide behind larger creatures.',
  },
  gnome: {
    name: 'Rock Gnome', base: 'gnome', size: 'Small', speed: 25, darkvision: 60,
    asi: { int: 2, con: 1 },
    traits: ['gnomeCunning', 'artificersLore', 'tinker'], toolProfs: ["tinker's tools"],
    languages: ['Common', 'Gnomish'], extraLanguages: 0,
    blurb: 'Inventive and hardy, rock gnomes have advantage on Int, Wis and Cha saves against magic.',
  },
  halfElf: {
    name: 'Half-Elf', base: 'halfElf', size: 'Medium', speed: 30, darkvision: 60,
    asi: { cha: 2 }, asiChoice: { count: 2, exclude: ['cha'] }, skillChoice: { count: 2 },
    traits: ['feyAncestry'],
    languages: ['Common', 'Elvish'], extraLanguages: 1,
    blurb: 'Charismatic wanderers: +2 Charisma, +1 to two other abilities, two extra skills and fey ancestry.',
  },
  halfOrc: {
    name: 'Half-Orc', base: 'halfOrc', size: 'Medium', speed: 30, darkvision: 60,
    asi: { str: 2, con: 1 }, skillProfs: ['intimidation'],
    traits: ['relentlessEndurance', 'savageAttacks'],
    languages: ['Common', 'Orc'], extraLanguages: 0,
    blurb: 'Fierce and enduring: drop to 1 hit point instead of 0 once per long rest, and roll an extra weapon die on melee crits.',
  },
  dragonborn: {
    name: 'Dragonborn', base: 'dragonborn', size: 'Medium', speed: 30, darkvision: 0,
    asi: { str: 2, cha: 1 }, ancestryChoice: true,
    traits: ['breathWeapon', 'draconicResistance'],
    languages: ['Common', 'Draconic'], extraLanguages: 0,
    blurb: 'Born of dragons: a breath weapon and resistance to the damage type of your draconic ancestry.',
  },
  tiefling: {
    name: 'Tiefling', base: 'tiefling', size: 'Medium', speed: 30, darkvision: 60,
    asi: { cha: 2, int: 1 }, resistances: ['fire'],
    traits: ['hellishResistance', 'infernalLegacy'],
    innateSpells: [{ spell: 'thaumaturgy', level: 1, atWill: true }, { spell: 'hellishRebuke', level: 3, perLongRest: 1 }, { spell: 'darkness', level: 5, perLongRest: 1 }],
    innateAbility: 'cha',
    languages: ['Common', 'Infernal'], extraLanguages: 0,
    blurb: 'Infernal heritage grants fire resistance, Thaumaturgy, and later Hellish Rebuke and Darkness once per long rest.',
  },
});

export const DRACONIC_ANCESTRY = dict({
  black: { type: 'acid', shape: 'line', size: 30, save: 'dex' },
  blue: { type: 'lightning', shape: 'line', size: 30, save: 'dex' },
  brass: { type: 'fire', shape: 'line', size: 30, save: 'dex' },
  bronze: { type: 'lightning', shape: 'line', size: 30, save: 'dex' },
  copper: { type: 'acid', shape: 'line', size: 30, save: 'dex' },
  gold: { type: 'fire', shape: 'cone', size: 15, save: 'dex' },
  green: { type: 'poison', shape: 'cone', size: 15, save: 'con' },
  red: { type: 'fire', shape: 'cone', size: 15, save: 'dex' },
  silver: { type: 'cold', shape: 'cone', size: 15, save: 'con' },
  white: { type: 'cold', shape: 'cone', size: 15, save: 'con' },
});

export const breathDice = level => (level >= 16 ? '5d6' : level >= 11 ? '4d6' : level >= 6 ? '3d6' : '2d6');
