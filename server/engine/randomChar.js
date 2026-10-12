// random but rules-valid character creation input, weighted toward a campaign's theme
import { ABILITIES, SKILLS, STANDARD_ARRAY, LANGUAGES } from './data/core.js';
import { RACES, DRACONIC_ANCESTRY } from './data/races.js';
import { CLASSES, BACKGROUNDS, METAMAGIC, INVOCATIONS, PACT_BOONS, INFUSIONS } from './data/classes.js';
import { SPELLS } from './data/spells.js';
import { validateCreation, asiLevelsFor, classSpellList, cantripsKnownCount, learnMaxLevel, spellbookSize, preparedCount } from './character.js';

// races and classes that suit each setting preset (weight 3 vs 1 for the rest)
const THEMES = {
  classic: { races: ['human', 'elf', 'dwarf', 'halfling'], classes: ['fighter', 'wizard', 'cleric', 'paladin', 'ranger'], backgrounds: ['folkHero', 'soldier', 'acolyte', 'sage'] },
  grim: { races: ['human', 'halfOrc', 'tiefling', 'dwarf'], classes: ['fighter', 'rogue', 'cleric', 'warlock', 'barbarian'], backgrounds: ['soldier', 'criminal', 'urchin', 'acolyte'] },
  coastal: { races: ['human', 'halfElf', 'halfling', 'tiefling'], classes: ['rogue', 'bard', 'sorcerer', 'fighter', 'warlock'], backgrounds: ['sailor', 'charlatan', 'noble', 'guildArtisan'] },
  frontier: { races: ['human', 'elf', 'dwarf', 'halfOrc', 'gnome'], classes: ['ranger', 'druid', 'barbarian', 'fighter', 'cleric'], backgrounds: ['outlander', 'folkHero', 'hermit', 'soldier'] },
  underdark: { races: ['dwarf', 'gnome', 'human', 'tiefling'], classes: ['cleric', 'paladin', 'wizard', 'warlock', 'rogue'], backgrounds: ['acolyte', 'hermit', 'sage', 'soldier'] },
};

const NAMES = {
  human: [['Aldric', 'Bram', 'Cedric', 'Edda', 'Garrick', 'Isolde', 'Maren', 'Osric', 'Rowena', 'Tamsin', 'Wendel', 'Yara'], ['Ashford', 'Blackwood', 'Crane', 'Dunmore', 'Fairweather', 'Holt', 'Marsh', 'Thorne', 'Vale']],
  elf: [['Aelar', 'Caelynn', 'Erevan', 'Galinndan', 'Ielenia', 'Lia', 'Naivara', 'Quarion', 'Sariel', 'Thamior'], ['Amakiir', 'Galanodel', 'Holimion', 'Liadon', 'Meliamne', 'Nailo', 'Siannodel']],
  dwarf: [['Bruenor', 'Dagnal', 'Eberk', 'Gunnloda', 'Helja', 'Kildrak', 'Mardred', 'Torbera', 'Vistra'], ['Battlehammer', 'Fireforge', 'Gorunn', 'Ironfist', 'Loderr', 'Rumnaheim', 'Ungart']],
  halfling: [['Alton', 'Cora', 'Eldon', 'Kithri', 'Lavinia', 'Merric', 'Nedda', 'Perrin', 'Seraphina', 'Wellby'], ['Brushgather', 'Goodbarrel', 'Greenbottle', 'Tealeaf', 'Thorngage', 'Underbough']],
  gnome: [['Alston', 'Bimpnottin', 'Carlin', 'Ellyjobell', 'Frug', 'Nissa', 'Orryn', 'Roywyn', 'Zook'], ['Beren', 'Daergel', 'Folkor', 'Garrick', 'Nackle', 'Scheppen', 'Turen']],
  halfOrc: [['Dench', 'Engong', 'Holg', 'Imsh', 'Krusk', 'Ovak', 'Shautha', 'Sutha', 'Volen', 'Yevelda'], ['']],
  dragonborn: [['Arjhan', 'Balasar', 'Donaar', 'Kava', 'Medrash', 'Nala', 'Pandjed', 'Sora', 'Torinn'], ['Clethtinthiallor', 'Daardendrian', 'Kepeshkmolik', 'Myastan', 'Yarjerit']],
  tiefling: [['Akmenos', 'Bryseis', 'Criella', 'Damakos', 'Kallista', 'Leucis', 'Mordai', 'Orianna', 'Rieta', 'Skamos'], ['', 'Ash', 'Sorrow', 'Torment', 'Hope', 'Ember']],
};
NAMES.variantHuman = NAMES.human;
NAMES.halfElf = [[...NAMES.human[0], ...NAMES.elf[0]], [...NAMES.human[1], ...NAMES.elf[1]]];

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const shuffle = (rng, arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const weighted = (rng, keys, favored = []) => {
  const pool = keys.flatMap(k => (favored.includes(k) ? [k, k, k] : [k]));
  return pick(rng, pool);
};

export function randomName(rng, race) {
  const [first, last] = NAMES[race] ?? NAMES.human;
  const l = pick(rng, last);
  return l ? `${pick(rng, first)} ${l}` : pick(rng, first);
}

// ability order for a class: primaries, then con, dex, then the rest at random
function abilityPriority(rng, cls) {
  const prim = CLASSES[cls].primary;
  const order = [...prim];
  for (const a of ['con', 'dex', ...shuffle(rng, ABILITIES)]) if (!order.includes(a)) order.push(a);
  return order;
}

function attempt(rng, { level, preset }) {
  const theme = THEMES[preset] ?? THEMES.classic;
  const race = weighted(rng, Object.keys(RACES).filter(k => !RACES[k].featChoice), theme.races);
  const cls = weighted(rng, Object.keys(CLASSES), theme.classes);
  const background = weighted(rng, Object.keys(BACKGROUNDS), theme.backgrounds);
  const r = RACES[race];
  const c = CLASSES[cls];
  const bg = BACKGROUNDS[background];
  const order = abilityPriority(rng, cls);
  const baseAbilities = {};
  order.forEach((a, i) => (baseAbilities[a] = STANDARD_ARRAY[i]));
  const raceAsiChoices = r.asiChoice ? order.filter(a => !r.asiChoice.exclude.includes(a) && !r.asi?.[a]).slice(0, r.asiChoice.count) : [];
  const raw = a => baseAbilities[a] + (r.asi?.[a] ?? 0) + (raceAsiChoices.includes(a) ? r.asiChoice?.amount ?? 1 : 0);

  const taken = new Set([...(bg.skills ?? []), ...(r.skillProfs ?? [])]);
  const raceSkills = r.skillChoice ? shuffle(rng, Object.keys(SKILLS).filter(s => !taken.has(s))).slice(0, r.skillChoice.count) : [];
  raceSkills.forEach(s => taken.add(s));
  const classPool = c.skills.from === 'any' ? Object.keys(SKILLS) : c.skills.from;
  const classSkills = shuffle(rng, classPool.filter(s => !taken.has(s))).slice(0, c.skills.count);
  classSkills.forEach(s => taken.add(s));
  const expCount = cls === 'rogue' ? (level >= 6 ? 4 : 2) : cls === 'bard' ? (level >= 10 ? 4 : level >= 3 ? 2 : 0) : 0;
  const expertise = shuffle(rng, [...taken]).slice(0, expCount);

  const fsNeeded = c.fightingStyle && level >= c.fightingStyle.level ? (cls === 'fighter' && level >= 10 ? 2 : 1) : 0;
  const fightingStyles = shuffle(rng, c.fightingStyle?.options ?? []).slice(0, fsNeeded);
  const mmNeeded = cls === 'sorcerer' ? (level >= 17 ? 4 : level >= 10 ? 3 : level >= 3 ? 2 : 0) : 0;
  const metamagic = shuffle(rng, Object.keys(METAMAGIC)).slice(0, mmNeeded);

  // ability score improvements: +1 to the two most important scores still under 20
  const asiHistory = [];
  const bumped = {};
  for (let i = 0; i < asiLevelsFor(cls).filter(l => l <= level).length; i++) {
    const changes = {};
    for (let n = 0; n < 2; n++) {
      const a = order.find(x => raw(x) + (bumped[x] ?? 0) + (changes[x] ?? 0) < 20);
      if (!a) break;
      changes[a] = (changes[a] ?? 0) + 1;
    }
    for (const [a, v] of Object.entries(changes)) bumped[a] = (bumped[a] ?? 0) + v;
    asiHistory.push({ changes });
  }

  const extraLanguages = shuffle(rng, LANGUAGES.filter(l => !r.languages.includes(l))).slice(0, (r.extraLanguages ?? 0) + (bg.languages ?? 0));
  const input = {
    name: randomName(rng, race), race, class: cls, background, level,
    alignment: pick(rng, ['Lawful Good', 'Neutral Good', 'Chaotic Good', 'Lawful Neutral', 'True Neutral', 'Chaotic Neutral']),
    abilityMethod: 'standard', baseAbilities, raceAsiChoices, raceSkills, classSkills, expertise, fightingStyles, metamagic,
    invocations: [], pactBoon: null, extraLanguages, kit: Math.floor(rng() * c.kits.length), raceCantrip: null, raceFeat: null,
    cantrips: [], spellsKnown: [], spellsPrepared: [], spellbook: [], asiHistory, description: {},
  };
  if (r.ancestryChoice) input.ancestry = pick(rng, Object.keys(DRACONIC_ANCESTRY));
  if (level >= c.subclassLevel) input.subclass = pick(rng, Object.keys(c.subclasses));
  if (r.cantripChoice) input.raceCantrip = pick(rng, Object.keys(SPELLS).filter(k => SPELLS[k].level === 0 && SPELLS[k].classes.includes(r.cantripChoice.list)));

  // spells
  const subKey = input.subclass ?? null;
  const sc = c.spellcasting ?? c.subclasses?.[subKey]?.spellcasting;
  if (sc && level >= (sc.startLevel ?? 1)) {
    const charLike = { class: cls, level, race, baseAbilities, raceAsiChoices, asiHistory, inventory: [], subclass: input.subclass ?? null };
    const list = [...classSpellList(charLike)];
    const maxLvl = learnMaxLevel(cls, level, subKey);
    const cantrips = shuffle(rng, list.filter(k => SPELLS[k].level === 0));
    if (cls === 'warlock') cantrips.sort((a, b) => (b === 'eldritchBlast') - (a === 'eldritchBlast'));
    input.cantrips = cantrips.slice(0, cantripsKnownCount(cls, level, subKey));
    // favor the highest spell levels a little so higher-level characters are not all first-level spells
    let leveled = shuffle(rng, list.filter(k => SPELLS[k].level > 0 && SPELLS[k].level <= maxLvl));
    // third casters keep to their schools
    if (sc.schools) leveled = [...leveled.filter(k => sc.schools.includes(SPELLS[k].school)), ...leveled.filter(k => !sc.schools.includes(SPELLS[k].school))];
    if (sc.known) input.spellsKnown = leveled.slice(0, sc.known[level - 1]);
    else if (sc.spellbook) {
      input.spellbook = leveled.slice(0, spellbookSize(level));
      input.spellsPrepared = input.spellbook.slice(0, preparedCount(charLike));
    } else if (sc.prepared) input.spellsPrepared = leveled.slice(0, preparedCount(charLike));
  }
  if (c.infusions) input.infusions = shuffle(rng, Object.keys(INFUSIONS).filter(k => (INFUSIONS[k].level ?? 2) <= level)).slice(0, c.infusions[level - 1]);
  if (cls === 'warlock') {
    if (level >= 3) input.pactBoon = pick(rng, Object.keys(PACT_BOONS));
    const ok = Object.values(INVOCATIONS).filter(d => (!d.requires?.cantrip || input.cantrips.includes(d.requires.cantrip)) && (!d.requires?.level || level >= d.requires.level) && (!d.requires?.pact || input.pactBoon === d.requires.pact));
    input.invocations = shuffle(rng, ok.map(d => d.key)).slice(0, c.invocations[level - 1]);
  }
  return input;
}

export function randomCharacter(rng, { level = 1, preset = 'classic' } = {}) {
  let last = [];
  for (let i = 0; i < 40; i++) {
    const input = attempt(rng, { level, preset });
    last = validateCreation(input, { maxLevel: level });
    if (!last.length) return input;
  }
  throw new Error(`Could not build a random character: ${last.join(' ')}`);
}
