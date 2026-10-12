import { dict, finder, normName } from './dict.js';

// abilities in order str, dex, con, int, wis, cha; hp is the hit dice expression
// (spawned at its average unless rolled); cr is a string so "1/4" stays exact
const m = (name, size, type, cr, ac, hp, speed, abilities, o = {}) => ({
  name, size, type, cr, ac, hp, speed, abilities, senses: '', resist: [], immune: [], vuln: [], condImmune: [], traits: [], ...o,
});
const melee = (key, name, toHit, damage, type, o = {}) => ({ key, name, kind: 'melee', toHit, reach: 5, damage, type, ...o });
const ranged = (key, name, toHit, range, damage, type, o = {}) => ({ key, name, kind: 'ranged', toHit, range, damage, type, ...o });
const t = (key, name, desc) => ({ key, name, desc });

const BPS = ['bludgeoning', 'piercing', 'slashing'];
const UNDEAD_IMMUNE = ['exhaustion', 'poisoned'];

const T = {
  packTactics: t('packTactics', 'Pack Tactics', 'Advantage on attacks against a creature with an ally of this creature within 5 feet of it.'),
  nimbleEscape: t('nimbleEscape', 'Nimble Escape', 'Disengage or Hide as a bonus action.'),
  sunlight: t('sunlightSensitivity', 'Sunlight Sensitivity', 'Disadvantage on attack rolls and sight-based Perception checks in sunlight.'),
  magicResistance: t('magicResistance', 'Magic Resistance', 'Advantage on saving throws against spells and other magical effects.'),
  undeadFortitude: t('undeadFortitude', 'Undead Fortitude', 'When reduced to 0 hit points, a Constitution save (DC 5 + damage taken) leaves it at 1 hit point, unless the damage is radiant or from a critical hit.'),
  martialAdvantage: t('martialAdvantage', 'Martial Advantage', 'Once per turn, 2d6 extra damage to a creature within 5 feet of one of its allies.'),
  relentless: t('relentless', 'Relentless', 'Once per rest, damage of 7 or less that would drop it to 0 hit points leaves it at 1 instead.'),
  brave: t('brave', 'Brave', 'Advantage on saving throws against being frightened.'),
  darkDevotion: t('darkDevotion', 'Dark Devotion', 'Advantage on saving throws against being charmed or frightened.'),
  keenSmell: t('keenSmell', 'Keen Smell', 'Advantage on Wisdom (Perception) checks that rely on smell.'),
  aggressive: t('aggressive', 'Aggressive', 'As a bonus action, move up to its speed toward a hostile creature it can see.'),
};

// casters: slots by spell level, casterLevel for cantrip scaling
const caster = (ability, dc, toHit, casterLevel, cantrips, spells, slots) => ({ ability, dc, toHit, casterLevel, cantrips, spells, slots });

export const MONSTERS = dict({
  // humanoids
  commoner: m('Commoner', 'Medium', 'humanoid', '0', 10, '1d8', 30, [10, 10, 10, 10, 10, 10], {
    senses: 'passive Perception 10',
    actions: [melee('club', 'Club', 2, '1d4', 'bludgeoning')],
  }),
  acolyte: m('Acolyte', 'Medium', 'humanoid', '1/4', 10, '2d8', 30, [10, 10, 10, 10, 14, 11], {
    senses: 'passive Perception 12', skills: { medicine: 4, religion: 2 },
    actions: [melee('club', 'Club', 2, '1d4', 'bludgeoning')],
    spellcasting: caster('wis', 12, 4, 1, ['light', 'sacredFlame', 'thaumaturgy'], ['bless', 'cureWounds', 'sanctuary'], [3]),
  }),
  bandit: m('Bandit', 'Medium', 'humanoid', '1/8', 12, '2d8+2', 30, [11, 12, 12, 10, 10, 10], {
    senses: 'passive Perception 10',
    actions: [melee('scimitar', 'Scimitar', 3, '1d6+1', 'slashing'), ranged('lightCrossbow', 'Light Crossbow', 3, [80, 320], '1d8+1', 'piercing')],
  }),
  banditCaptain: m('Bandit Captain', 'Medium', 'humanoid', '2', 15, '10d8+20', 30, [15, 16, 14, 14, 11, 14], {
    senses: 'passive Perception 10', saves: { str: 4, dex: 5, wis: 2 }, skills: { athletics: 4, deception: 4 },
    actions: [melee('scimitar', 'Scimitar', 5, '1d6+3', 'slashing'), melee('dagger', 'Dagger', 5, '1d4+3', 'piercing')],
    multiattack: [{ attack: 'scimitar', count: 2 }, { attack: 'dagger', count: 1 }],
    reactions: [{ key: 'parry', name: 'Parry', acBonus: 2 }],
  }),
  cultist: m('Cultist', 'Medium', 'humanoid', '1/8', 12, '2d8', 30, [11, 12, 10, 10, 11, 10], {
    senses: 'passive Perception 10', skills: { deception: 2, religion: 2 }, traits: [T.darkDevotion],
    actions: [melee('scimitar', 'Scimitar', 3, '1d6+1', 'slashing')],
  }),
  cultFanatic: m('Cult Fanatic', 'Medium', 'humanoid', '2', 13, '6d8', 30, [11, 14, 12, 10, 13, 14], {
    senses: 'passive Perception 11', skills: { deception: 4, persuasion: 4, religion: 2 }, traits: [T.darkDevotion],
    actions: [melee('dagger', 'Dagger', 4, '1d4+2', 'piercing')],
    multiattack: [{ attack: 'dagger', count: 2 }],
    spellcasting: caster('wis', 11, 3, 4, ['light', 'sacredFlame', 'thaumaturgy'], ['command', 'inflictWounds', 'shieldOfFaith', 'holdPerson', 'spiritualWeapon'], [4, 3]),
  }),
  guard: m('Guard', 'Medium', 'humanoid', '1/8', 16, '2d8+2', 30, [13, 12, 12, 10, 11, 10], {
    senses: 'passive Perception 12', skills: { perception: 2 },
    actions: [melee('spear', 'Spear', 3, '1d6+1', 'piercing'), ranged('spearThrown', 'Spear (thrown)', 3, [20, 60], '1d6+1', 'piercing')],
  }),
  thug: m('Thug', 'Medium', 'humanoid', '1/2', 11, '5d8+10', 30, [15, 11, 14, 10, 10, 11], {
    senses: 'passive Perception 10', skills: { intimidation: 2 }, traits: [T.packTactics],
    actions: [melee('mace', 'Mace', 4, '1d6+2', 'bludgeoning'), ranged('heavyCrossbow', 'Heavy Crossbow', 2, [100, 400], '1d10', 'piercing')],
    multiattack: [{ attack: 'mace', count: 2 }],
  }),
  scout: m('Scout', 'Medium', 'humanoid', '1/2', 13, '3d8', 30, [11, 14, 12, 11, 13, 11], {
    senses: 'passive Perception 15', skills: { nature: 4, perception: 5, stealth: 6, survival: 5 },
    traits: [t('keenHearingSight', 'Keen Hearing and Sight', 'Advantage on Wisdom (Perception) checks that rely on hearing or sight.')],
    actions: [melee('shortsword', 'Shortsword', 4, '1d6+2', 'piercing'), ranged('longbow', 'Longbow', 4, [150, 600], '1d8+2', 'piercing')],
    multiattack: [{ attack: 'shortsword', count: 2 }, { attack: 'longbow', count: 2, alt: true }],
  }),
  veteran: m('Veteran', 'Medium', 'humanoid', '3', 17, '9d8+18', 30, [16, 13, 14, 10, 11, 10], {
    senses: 'passive Perception 12', skills: { athletics: 5, perception: 2 },
    actions: [melee('longsword', 'Longsword', 5, '1d8+3', 'slashing'), melee('shortsword', 'Shortsword', 5, '1d6+3', 'piercing'), ranged('heavyCrossbow', 'Heavy Crossbow', 3, [100, 400], '1d10+1', 'piercing')],
    multiattack: [{ attack: 'longsword', count: 2 }, { attack: 'shortsword', count: 1 }],
  }),
  knight: m('Knight', 'Medium', 'humanoid', '3', 18, '8d8+16', 30, [16, 11, 14, 11, 13, 15], {
    senses: 'passive Perception 11', saves: { con: 4, wis: 2 }, traits: [T.brave],
    actions: [melee('greatsword', 'Greatsword', 5, '2d6+3', 'slashing'), ranged('heavyCrossbow', 'Heavy Crossbow', 2, [100, 400], '1d10', 'piercing')],
    multiattack: [{ attack: 'greatsword', count: 2 }],
    reactions: [{ key: 'parry', name: 'Parry', acBonus: 2 }],
  }),
  priest: m('Priest', 'Medium', 'humanoid', '2', 13, '5d8+5', 30, [10, 10, 12, 13, 16, 13], {
    senses: 'passive Perception 13', skills: { medicine: 7, persuasion: 3, religion: 4 },
    actions: [melee('mace', 'Mace', 2, '1d6', 'bludgeoning')],
    spellcasting: caster('wis', 13, 5, 5, ['light', 'sacredFlame', 'thaumaturgy'], ['cureWounds', 'guidingBolt', 'sanctuary', 'lesserRestoration', 'spiritualWeapon', 'dispelMagic', 'spiritGuardians'], [4, 3, 2]),
  }),
  mage: m('Mage', 'Medium', 'humanoid', '6', 12, '9d8', 30, [9, 14, 11, 17, 12, 11], {
    senses: 'passive Perception 11', saves: { int: 6, wis: 4 }, skills: { arcana: 6, history: 6 },
    actions: [melee('dagger', 'Dagger', 5, '1d4+2', 'piercing')],
    spellcasting: caster('int', 14, 6, 9, ['fireBolt', 'light', 'mageHand', 'prestidigitation'], ['detectMagic', 'mageArmor', 'magicMissile', 'shield', 'mistyStep', 'suggestion', 'counterspell', 'fireball', 'fly', 'greaterInvisibility', 'iceStorm', 'coneOfCold'], [4, 3, 3, 3, 1]),
  }),
  goblin: m('Goblin', 'Small', 'humanoid', '1/4', 15, '2d6', 30, [8, 14, 10, 10, 8, 8], {
    senses: 'darkvision 60 ft., passive Perception 9', skills: { stealth: 6 }, traits: [T.nimbleEscape],
    actions: [melee('scimitar', 'Scimitar', 4, '1d6+2', 'slashing'), ranged('shortbow', 'Shortbow', 4, [80, 320], '1d6+2', 'piercing')],
  }),
  hobgoblin: m('Hobgoblin', 'Medium', 'humanoid', '1/2', 18, '2d8+2', 30, [13, 12, 12, 10, 10, 9], {
    senses: 'darkvision 60 ft., passive Perception 10', traits: [T.martialAdvantage],
    actions: [melee('longsword', 'Longsword', 3, '1d8+1', 'slashing'), ranged('longbow', 'Longbow', 3, [150, 600], '1d8+1', 'piercing')],
  }),
  bugbear: m('Bugbear', 'Medium', 'humanoid', '1', 16, '5d8+5', 30, [15, 14, 13, 8, 11, 9], {
    senses: 'darkvision 60 ft., passive Perception 10', skills: { stealth: 6, survival: 2 },
    traits: [t('brute', 'Brute', 'A melee weapon deals one extra die of its damage when the bugbear hits with it (included).')],
    actions: [melee('morningstar', 'Morningstar', 4, '2d8+2', 'piercing'), ranged('javelin', 'Javelin', 4, [30, 120], '1d6+2', 'piercing')],
  }),
  kobold: m('Kobold', 'Small', 'humanoid', '1/8', 12, '2d6-2', 30, [7, 15, 9, 8, 7, 8], {
    senses: 'darkvision 60 ft., passive Perception 8', traits: [T.sunlight, T.packTactics],
    actions: [melee('dagger', 'Dagger', 4, '1d4+2', 'piercing'), ranged('sling', 'Sling', 4, [30, 120], '1d4+2', 'bludgeoning')],
  }),
  orc: m('Orc', 'Medium', 'humanoid', '1/2', 13, '2d8+6', 30, [16, 12, 16, 7, 11, 10], {
    senses: 'darkvision 60 ft., passive Perception 10', skills: { intimidation: 2 }, traits: [T.aggressive],
    actions: [melee('greataxe', 'Greataxe', 5, '1d12+3', 'slashing'), ranged('javelin', 'Javelin', 5, [30, 120], '1d6+3', 'piercing')],
  }),
  gnoll: m('Gnoll', 'Medium', 'humanoid', '1/2', 15, '5d8', 30, [14, 12, 11, 6, 10, 7], {
    senses: 'darkvision 60 ft., passive Perception 10',
    traits: [t('rampage', 'Rampage', 'After dropping a creature to 0 hit points with a melee attack, it can move half its speed and bite as a bonus action.')],
    actions: [melee('bite', 'Bite', 4, '1d4+2', 'piercing'), melee('spear', 'Spear', 4, '1d6+2', 'piercing'), ranged('longbow', 'Longbow', 3, [150, 600], '1d8+1', 'piercing')],
  }),
  lizardfolk: m('Lizardfolk', 'Medium', 'humanoid', '1/2', 15, '4d8+4', 30, [15, 10, 13, 7, 12, 7], {
    senses: 'passive Perception 13', skills: { perception: 3, stealth: 4, survival: 5 },
    traits: [t('holdBreath', 'Hold Breath', 'Can hold its breath for 15 minutes.')],
    actions: [melee('bite', 'Bite', 4, '1d6+2', 'piercing'), melee('heavyClub', 'Heavy Club', 4, '1d6+2', 'bludgeoning'), ranged('javelin', 'Javelin', 4, [30, 120], '1d6+2', 'piercing')],
    multiattack: [{ attack: 'bite', count: 1 }, { attack: 'heavyClub', count: 1 }],
  }),

  // giants and monstrosities
  ogre: m('Ogre', 'Large', 'giant', '2', 11, '7d10+21', 40, [19, 8, 16, 5, 7, 7], {
    senses: 'darkvision 60 ft., passive Perception 8',
    actions: [melee('greatclub', 'Greatclub', 6, '2d8+4', 'bludgeoning'), ranged('javelin', 'Javelin', 6, [30, 120], '2d6+4', 'piercing')],
  }),
  ettin: m('Ettin', 'Large', 'giant', '4', 12, '10d10+30', 40, [21, 8, 17, 6, 10, 8], {
    senses: 'darkvision 60 ft., passive Perception 14', skills: { perception: 4 },
    traits: [t('twoHeads', 'Two Heads', 'Advantage on Perception checks and on saves against being blinded, charmed, deafened, frightened, stunned or knocked unconscious.')],
    actions: [melee('battleaxe', 'Battleaxe', 7, '2d8+5', 'slashing'), melee('morningstar', 'Morningstar', 7, '2d8+5', 'piercing')],
    multiattack: [{ attack: 'battleaxe', count: 1 }, { attack: 'morningstar', count: 1 }],
  }),
  hillGiant: m('Hill Giant', 'Huge', 'giant', '5', 13, '10d12+40', 40, [21, 8, 19, 5, 9, 6], {
    senses: 'passive Perception 12', skills: { perception: 2 },
    actions: [melee('greatclub', 'Greatclub', 8, '3d8+5', 'bludgeoning', { reach: 10 }), ranged('rock', 'Rock', 8, [60, 240], '3d10+5', 'bludgeoning')],
    multiattack: [{ attack: 'greatclub', count: 2 }],
  }),
  troll: m('Troll', 'Large', 'giant', '5', 15, '8d10+40', 30, [18, 13, 20, 7, 9, 7], {
    senses: 'darkvision 60 ft., passive Perception 12', skills: { perception: 2 }, traits: [T.keenSmell, t('regeneration', 'Regeneration', 'Regains 10 hit points at the start of its turn unless it took acid or fire damage since its last turn.')],
    regeneration: { amount: 10, stoppedBy: ['acid', 'fire'] },
    actions: [melee('bite', 'Bite', 7, '1d6+4', 'piercing'), melee('claw', 'Claw', 7, '2d6+4', 'slashing')],
    multiattack: [{ attack: 'bite', count: 1 }, { attack: 'claw', count: 2 }],
  }),
  minotaur: m('Minotaur', 'Large', 'monstrosity', '3', 14, '9d10+27', 40, [18, 11, 16, 6, 16, 9], {
    senses: 'darkvision 60 ft., passive Perception 17', skills: { perception: 7 },
    traits: [t('labyrinthineRecall', 'Labyrinthine Recall', 'Perfectly recalls any path it has traveled.'), t('reckless', 'Reckless', 'Can gain advantage on its melee attacks at the cost of attacks against it having advantage.')],
    actions: [melee('greataxe', 'Greataxe', 6, '2d12+4', 'slashing'), melee('gore', 'Gore', 6, '2d8+4', 'piercing')],
  }),
  owlbear: m('Owlbear', 'Large', 'monstrosity', '3', 13, '7d10+21', 40, [20, 12, 17, 3, 12, 7], {
    senses: 'darkvision 60 ft., passive Perception 13', skills: { perception: 3 }, traits: [t('keenSightSmell', 'Keen Sight and Smell', 'Advantage on Perception checks that rely on sight or smell.')],
    actions: [melee('beak', 'Beak', 7, '1d10+5', 'piercing'), melee('claws', 'Claws', 7, '2d8+5', 'slashing')],
    multiattack: [{ attack: 'beak', count: 1 }, { attack: 'claws', count: 1 }],
  }),
  ankheg: m('Ankheg', 'Large', 'monstrosity', '2', 14, '6d10+6', 30, [17, 11, 13, 1, 13, 6], {
    senses: 'darkvision 60 ft., tremorsense 60 ft., passive Perception 11',
    actions: [melee('bite', 'Bite', 5, '2d6+3', 'slashing', { extra: { dice: '1d6', type: 'acid' }, onHit: { conditions: ['grappled'], escape: { dc: 13 }, sizeMax: 'Large' } })],
    special: [{ key: 'acidSpray', name: 'Acid Spray', recharge: 6, area: { shape: 'line', size: 30 }, save: 'dex', dc: 13, damage: '3d6', type: 'acid' }],
  }),
  manticore: m('Manticore', 'Large', 'monstrosity', '3', 14, '8d10+24', 30, [17, 16, 17, 7, 12, 8], {
    senses: 'darkvision 60 ft., passive Perception 11',
    actions: [melee('bite', 'Bite', 5, '1d8+3', 'piercing'), melee('claw', 'Claw', 5, '1d6+3', 'slashing'), ranged('tailSpike', 'Tail Spike', 5, [100, 200], '1d8+3', 'piercing')],
    multiattack: [{ attack: 'bite', count: 1 }, { attack: 'claw', count: 2 }, { attack: 'tailSpike', count: 3, alt: true }],
  }),
  harpy: m('Harpy', 'Medium', 'monstrosity', '1', 11, '7d8', 20, [12, 13, 12, 7, 10, 13], {
    senses: 'passive Perception 10',
    actions: [melee('claws', 'Claws', 3, '2d4+1', 'slashing'), melee('club', 'Club', 3, '1d4+1', 'bludgeoning')],
    multiattack: [{ attack: 'claws', count: 1 }, { attack: 'club', count: 1 }],
  }),
  gargoyle: m('Gargoyle', 'Medium', 'elemental', '2', 15, '7d8+21', 30, [15, 11, 16, 6, 11, 7], {
    senses: 'darkvision 60 ft., passive Perception 10', resist: BPS, immune: ['poison'], condImmune: ['exhaustion', 'petrified', 'poisoned'],
    traits: [t('falseAppearance', 'False Appearance', 'While motionless, it is indistinguishable from an inanimate statue.')],
    actions: [melee('bite', 'Bite', 4, '1d6+2', 'piercing'), melee('claws', 'Claws', 4, '1d6+2', 'slashing')],
    multiattack: [{ attack: 'bite', count: 1 }, { attack: 'claws', count: 1 }],
  }),
  animatedArmor: m('Animated Armor', 'Medium', 'construct', '1', 18, '6d8+6', 25, [14, 11, 13, 1, 3, 1], {
    senses: 'blindsight 60 ft. (blind beyond this radius), passive Perception 6', immune: ['poison', 'psychic'],
    condImmune: ['blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'paralyzed', 'petrified', 'poisoned'],
    traits: [t('antimagicSusceptibility', 'Antimagic Susceptibility', 'Incapacitated inside an antimagic field.')],
    actions: [melee('slam', 'Slam', 4, '1d6+2', 'bludgeoning')],
    multiattack: [{ attack: 'slam', count: 2 }],
  }),

  // undead
  skeleton: m('Skeleton', 'Medium', 'undead', '1/4', 13, '2d8+4', 30, [10, 14, 15, 6, 8, 5], {
    senses: 'darkvision 60 ft., passive Perception 9', vuln: ['bludgeoning'], immune: ['poison'], condImmune: UNDEAD_IMMUNE,
    actions: [melee('shortsword', 'Shortsword', 4, '1d6+2', 'piercing'), ranged('shortbow', 'Shortbow', 4, [80, 320], '1d6+2', 'piercing')],
  }),
  zombie: m('Zombie', 'Medium', 'undead', '1/4', 8, '3d8+9', 20, [13, 6, 16, 3, 6, 5], {
    senses: 'darkvision 60 ft., passive Perception 8', saves: { wis: 0 }, immune: ['poison'], condImmune: ['poisoned'], traits: [T.undeadFortitude],
    actions: [melee('slam', 'Slam', 3, '1d6+1', 'bludgeoning')],
  }),
  ghoul: m('Ghoul', 'Medium', 'undead', '1', 12, '5d8', 30, [13, 15, 10, 7, 10, 6], {
    senses: 'darkvision 60 ft., passive Perception 10', immune: ['poison'], condImmune: ['charmed', 'exhaustion', 'poisoned'],
    actions: [melee('bite', 'Bite', 2, '2d6+2', 'piercing'), melee('claws', 'Claws', 4, '2d4+2', 'slashing', { onHit: { save: 'con', dc: 10, conditions: ['paralyzed'], saveEnds: 'con', rounds: 10, notTypes: ['undead'], notRaces: ['elf'] } })],
  }),
  shadow: m('Shadow', 'Medium', 'undead', '1/2', 12, '3d8+3', 40, [6, 14, 13, 6, 10, 8], {
    senses: 'darkvision 60 ft., passive Perception 10', skills: { stealth: 4 },
    vuln: ['radiant'], resist: ['acid', 'cold', 'fire', 'lightning', 'thunder', ...BPS], immune: ['necrotic', 'poison'],
    condImmune: ['exhaustion', 'frightened', 'grappled', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained'],
    traits: [t('amorphous', 'Amorphous', 'Can move through a space as narrow as 1 inch.'), T.sunlight],
    actions: [melee('strengthDrain', 'Strength Drain', 4, '2d6+2', 'necrotic')],
  }),
  wight: m('Wight', 'Medium', 'undead', '3', 14, '6d8+18', 30, [15, 14, 16, 10, 13, 15], {
    senses: 'darkvision 60 ft., passive Perception 13', skills: { perception: 3, stealth: 4 },
    resist: ['necrotic', ...BPS], immune: ['poison'], condImmune: UNDEAD_IMMUNE, traits: [T.sunlight],
    actions: [melee('longsword', 'Longsword', 4, '1d8+2', 'slashing'), melee('lifeDrain', 'Life Drain', 4, '1d6+2', 'necrotic', { replaces: 'longsword' }), ranged('longbow', 'Longbow', 4, [150, 600], '1d8+2', 'piercing')],
    multiattack: [{ attack: 'longsword', count: 2 }, { attack: 'longbow', count: 2, alt: true }],
  }),
  mummy: m('Mummy', 'Medium', 'undead', '3', 11, '9d8+18', 20, [16, 8, 15, 6, 10, 12], {
    senses: 'darkvision 60 ft., passive Perception 10', saves: { wis: 2 },
    vuln: ['fire'], resist: BPS, immune: ['necrotic', 'poison'], condImmune: ['charmed', 'exhaustion', 'frightened', 'paralyzed', 'poisoned'],
    actions: [melee('rottingFist', 'Rotting Fist', 5, '2d6+3', 'bludgeoning', { extra: { dice: '3d6', type: 'necrotic' } })],
  }),

  // beasts (the wild shape forms among them)
  cat: m('Cat', 'Tiny', 'beast', '0', 12, '1d4', 40, [3, 15, 10, 3, 12, 7], {
    senses: 'passive Perception 13', skills: { perception: 3, stealth: 4 }, traits: [T.keenSmell],
    actions: [melee('claws', 'Claws', 0, '1', 'slashing')],
  }),
  giantRat: m('Giant Rat', 'Small', 'beast', '1/8', 12, '2d6', 30, [7, 15, 11, 2, 10, 4], {
    senses: 'darkvision 60 ft., passive Perception 10', traits: [T.keenSmell, T.packTactics],
    actions: [melee('bite', 'Bite', 4, '1d4+2', 'piercing')],
  }),
  wolf: m('Wolf', 'Medium', 'beast', '1/4', 13, '2d8+2', 40, [12, 15, 12, 3, 12, 6], {
    senses: 'passive Perception 13', skills: { perception: 3, stealth: 4 }, traits: [t('keenHearingSmell', 'Keen Hearing and Smell', 'Advantage on Perception checks that rely on hearing or smell.'), T.packTactics],
    actions: [melee('bite', 'Bite', 4, '2d4+2', 'piercing', { onHit: { save: 'str', dc: 11, conditions: ['prone'] } })],
  }),
  boar: m('Boar', 'Medium', 'beast', '1/4', 11, '2d8+2', 40, [13, 11, 12, 2, 9, 5], {
    senses: 'passive Perception 9', traits: [T.relentless],
    actions: [melee('tusk', 'Tusk', 3, '1d6+1', 'slashing')],
  }),
  panther: m('Panther', 'Medium', 'beast', '1/4', 12, '3d8', 50, [14, 15, 10, 3, 14, 7], {
    senses: 'passive Perception 14', skills: { perception: 4, stealth: 6 }, traits: [T.keenSmell],
    actions: [melee('bite', 'Bite', 4, '1d6+2', 'piercing'), melee('claw', 'Claw', 4, '1d4+2', 'slashing')],
  }),
  ridingHorse: m('Riding Horse', 'Large', 'beast', '1/4', 10, '2d10+2', 60, [16, 10, 12, 2, 11, 7], {
    senses: 'passive Perception 10',
    actions: [melee('hooves', 'Hooves', 2, '2d4+3', 'bludgeoning')],
  }),
  giantWolfSpider: m('Giant Wolf Spider', 'Medium', 'beast', '1/4', 13, '2d8+2', 40, [12, 16, 13, 3, 12, 4], {
    senses: 'blindsight 10 ft., darkvision 60 ft., passive Perception 13', skills: { perception: 3, stealth: 7 },
    traits: [t('spiderClimb', 'Spider Climb', 'Climbs difficult surfaces, including ceilings, without a check.')],
    actions: [melee('bite', 'Bite', 3, '1d6+1', 'piercing', { onHit: { save: 'con', dc: 11, damage: '2d6', type: 'poison', half: true } })],
  }),
  blackBear: m('Black Bear', 'Medium', 'beast', '1/2', 11, '3d8+6', 40, [15, 10, 14, 2, 12, 7], {
    senses: 'passive Perception 13', skills: { perception: 3 }, traits: [T.keenSmell],
    actions: [melee('bite', 'Bite', 3, '1d6+2', 'piercing'), melee('claws', 'Claws', 3, '2d4+2', 'slashing')],
    multiattack: [{ attack: 'bite', count: 1 }, { attack: 'claws', count: 1 }],
  }),
  ape: m('Ape', 'Medium', 'beast', '1/2', 12, '3d8+6', 30, [16, 14, 14, 6, 12, 7], {
    senses: 'passive Perception 13', skills: { athletics: 5, perception: 3 },
    actions: [melee('fist', 'Fist', 5, '1d6+3', 'bludgeoning'), ranged('rock', 'Rock', 5, [25, 50], '1d6+3', 'bludgeoning')],
    multiattack: [{ attack: 'fist', count: 2 }],
  }),
  crocodile: m('Crocodile', 'Large', 'beast', '1/2', 12, '3d10+3', 20, [15, 10, 13, 2, 10, 5], {
    senses: 'passive Perception 10', skills: { stealth: 2 }, traits: [t('holdBreath', 'Hold Breath', 'Can hold its breath for 15 minutes.')],
    actions: [melee('bite', 'Bite', 4, '1d10+2', 'piercing', { onHit: { conditions: ['grappled'], escape: { dc: 12 }, sizeMax: 'Medium' } })],
  }),
  warhorse: m('Warhorse', 'Large', 'beast', '1/2', 11, '3d10+3', 60, [18, 12, 13, 2, 12, 7], {
    senses: 'passive Perception 11',
    actions: [melee('hooves', 'Hooves', 6, '2d6+4', 'bludgeoning')],
  }),
  brownBear: m('Brown Bear', 'Large', 'beast', '1', 11, '4d10+12', 40, [19, 10, 16, 2, 13, 7], {
    senses: 'passive Perception 13', skills: { perception: 3 }, traits: [T.keenSmell],
    actions: [melee('bite', 'Bite', 6, '1d8+4', 'piercing'), melee('claws', 'Claws', 6, '2d6+4', 'slashing')],
    multiattack: [{ attack: 'bite', count: 1 }, { attack: 'claws', count: 1 }],
  }),
  direWolf: m('Dire Wolf', 'Large', 'beast', '1', 14, '5d10+10', 50, [17, 15, 15, 3, 12, 7], {
    senses: 'passive Perception 13', skills: { perception: 3, stealth: 4 }, traits: [t('keenHearingSmell', 'Keen Hearing and Smell', 'Advantage on Perception checks that rely on hearing or smell.'), T.packTactics],
    actions: [melee('bite', 'Bite', 5, '2d6+3', 'piercing', { onHit: { save: 'str', dc: 13, conditions: ['prone'] } })],
  }),
  giantSpider: m('Giant Spider', 'Large', 'beast', '1', 14, '4d10+4', 30, [14, 16, 12, 2, 11, 4], {
    senses: 'blindsight 10 ft., darkvision 60 ft., passive Perception 10', skills: { stealth: 7 },
    traits: [t('spiderClimb', 'Spider Climb', 'Climbs difficult surfaces, including ceilings, without a check.'), t('webWalker', 'Web Walker', 'Ignores movement restrictions caused by webbing.')],
    actions: [melee('bite', 'Bite', 5, '1d8+3', 'piercing', { onHit: { save: 'con', dc: 11, damage: '2d8', type: 'poison', half: true } })],
    special: [{ key: 'web', name: 'Web', recharge: 5, kind: 'ranged', toHit: 5, range: [30, 60], onHit: { conditions: ['restrained'], escape: { dc: 12, ability: 'str' } } }],
  }),
  tiger: m('Tiger', 'Large', 'beast', '1', 12, '5d10+10', 40, [17, 15, 14, 3, 12, 8], {
    senses: 'darkvision 60 ft., passive Perception 13', skills: { perception: 3, stealth: 6 }, traits: [T.keenSmell],
    actions: [melee('bite', 'Bite', 5, '1d10+3', 'piercing'), melee('claw', 'Claw', 5, '1d8+3', 'slashing')],
  }),

  // fiends
  imp: m('Imp', 'Tiny', 'fiend', '1', 13, '3d4+3', 20, [6, 17, 13, 11, 12, 14], {
    senses: "darkvision 120 ft. (sees through magical darkness), passive Perception 11", skills: { deception: 4, insight: 3, persuasion: 4, stealth: 5 },
    resist: ['cold', ...BPS], immune: ['fire', 'poison'], condImmune: ['poisoned'], traits: [T.magicResistance],
    actions: [melee('sting', 'Sting', 5, '1d4+3', 'piercing', { onHit: { save: 'con', dc: 11, damage: '3d6', type: 'poison', half: true } })],
  }),
  hellHound: m('Hell Hound', 'Medium', 'fiend', '3', 15, '7d8+14', 50, [17, 12, 14, 6, 13, 6], {
    senses: 'darkvision 60 ft., passive Perception 15', skills: { perception: 5 }, immune: ['fire'], traits: [t('keenHearingSmell', 'Keen Hearing and Smell', 'Advantage on Perception checks that rely on hearing or smell.'), T.packTactics],
    actions: [melee('bite', 'Bite', 5, '1d8+3', 'piercing', { extra: { dice: '2d6', type: 'fire' } })],
    special: [{ key: 'fireBreath', name: 'Fire Breath', recharge: 5, area: { shape: 'cone', size: 15 }, save: 'dex', dc: 12, damage: '6d8', type: 'fire' }],
  }),

  // dragons
  whiteDragonWyrmling: m('White Dragon Wyrmling', 'Medium', 'dragon', '2', 16, '5d8+10', 30, [14, 10, 14, 5, 10, 11], {
    senses: 'blindsight 10 ft., darkvision 60 ft., passive Perception 14', saves: { dex: 2, con: 4, wis: 2, cha: 2 }, skills: { perception: 4, stealth: 2 }, immune: ['cold'],
    actions: [melee('bite', 'Bite', 4, '1d10+2', 'piercing', { extra: { dice: '1d4', type: 'cold' } })],
    special: [{ key: 'coldBreath', name: 'Cold Breath', recharge: 5, area: { shape: 'cone', size: 15 }, save: 'con', dc: 12, damage: '5d8', type: 'cold' }],
  }),
  redDragonWyrmling: m('Red Dragon Wyrmling', 'Medium', 'dragon', '4', 17, '10d8+30', 30, [19, 10, 17, 12, 11, 15], {
    senses: 'blindsight 10 ft., darkvision 60 ft., passive Perception 14', saves: { dex: 2, con: 5, wis: 2, cha: 4 }, skills: { perception: 4, stealth: 2 }, immune: ['fire'],
    actions: [melee('bite', 'Bite', 6, '1d10+4', 'piercing', { extra: { dice: '1d6', type: 'fire' } })],
    special: [{ key: 'fireBreath', name: 'Fire Breath', recharge: 5, area: { shape: 'cone', size: 15 }, save: 'dex', dc: 13, damage: '7d6', type: 'fire' }],
  }),
  youngGreenDragon: m('Young Green Dragon', 'Large', 'dragon', '8', 18, '16d10+48', 40, [19, 12, 17, 16, 13, 15], {
    senses: 'blindsight 30 ft., darkvision 120 ft., passive Perception 17', saves: { dex: 4, con: 6, wis: 4, cha: 5 }, skills: { deception: 5, perception: 7, stealth: 4 },
    immune: ['poison'], condImmune: ['poisoned'], traits: [t('amphibious', 'Amphibious', 'Can breathe air and water.')],
    actions: [melee('bite', 'Bite', 7, '2d10+4', 'piercing', { reach: 10, extra: { dice: '2d6', type: 'poison' } }), melee('claw', 'Claw', 7, '2d6+4', 'slashing')],
    multiattack: [{ attack: 'bite', count: 1 }, { attack: 'claw', count: 2 }],
    special: [{ key: 'poisonBreath', name: 'Poison Breath', recharge: 5, area: { shape: 'cone', size: 30 }, save: 'con', dc: 14, damage: '12d6', type: 'poison' }],
  }),
  youngRedDragon: m('Young Red Dragon', 'Large', 'dragon', '10', 18, '17d10+85', 40, [23, 10, 21, 14, 11, 19], {
    senses: 'blindsight 30 ft., darkvision 120 ft., passive Perception 18', saves: { dex: 4, con: 9, wis: 4, cha: 8 }, skills: { perception: 8, stealth: 4 }, immune: ['fire'],
    actions: [melee('bite', 'Bite', 10, '2d10+6', 'piercing', { reach: 10, extra: { dice: '1d6', type: 'fire' } }), melee('claw', 'Claw', 10, '2d6+6', 'slashing')],
    multiattack: [{ attack: 'bite', count: 1 }, { attack: 'claw', count: 2 }],
    special: [{ key: 'fireBreath', name: 'Fire Breath', recharge: 5, area: { shape: 'cone', size: 30 }, save: 'dex', dc: 17, damage: '16d6', type: 'fire' }],
  }),
});

// beasts a druid can become (CR limits are checked by level)
export const WILD_SHAPE_BEASTS = ['cat', 'giantRat', 'wolf', 'boar', 'panther', 'ridingHorse', 'giantWolfSpider', 'blackBear', 'ape', 'crocodile', 'warhorse', 'brownBear', 'direWolf', 'giantSpider', 'tiger'];

const SRD_KEYS = new Set(Object.keys(MONSTERS));
const srdFind = finder(MONSTERS, { wyrmling: 'redDragonWyrmling', horse: 'ridingHorse', spider: 'giantSpider', rat: 'giantRat', bear: 'brownBear' });
// adventures' own creatures (engine/bestiary.js) join the table at run time
const customNames = new Map();
export const isSrdMonster = key => SRD_KEYS.has(key);
export function registerMonster(key, def) {
  MONSTERS[key] = { ...def, key };
  customNames.set(normName(def.name), key);
  customNames.set(normName(key), key);
}
const findOne = ref => srdFind(ref) ?? customNames.get(normName(ref)) ?? null;
// "Goblin 2", "goblin #3", "the second goblin": a numbered creature in a fight is still its kind
export const findMonsterKey = ref => {
  const hit = findOne(ref);
  if (hit || typeof ref !== 'string') return hit;
  const bare = ref.trim().replace(/^(?:the|a|an)\s+/i, '').replace(/^(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+/i, '').replace(/\s*(?:#|no\.?\s*)?\d+$/i, '').trim();
  return bare && bare !== ref.trim() ? findOne(bare) : null;
};
