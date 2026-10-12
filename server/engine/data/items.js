import { dict, finder } from './dict.js';

// costs are in copper pieces, weights in pounds
export const COIN_VALUE = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };
// fifty coins to the pound
export const COIN_WEIGHT = 0.02;

const w = (name, category, cost, weight, damage, damageType, properties = [], extra = {}) => ({ name, kind: 'weapon', category, cost, weight, damage, damageType, properties, ...extra });

export const WEAPONS = dict({
  // simple melee
  club: w('Club', 'simpleMelee', 10, 2, '1d4', 'bludgeoning', ['light']),
  dagger: w('Dagger', 'simpleMelee', 200, 1, '1d4', 'piercing', ['finesse', 'light', 'thrown'], { range: [20, 60] }),
  greatclub: w('Greatclub', 'simpleMelee', 20, 10, '1d8', 'bludgeoning', ['twoHanded']),
  handaxe: w('Handaxe', 'simpleMelee', 500, 2, '1d6', 'slashing', ['light', 'thrown'], { range: [20, 60] }),
  javelin: w('Javelin', 'simpleMelee', 50, 2, '1d6', 'piercing', ['thrown'], { range: [30, 120] }),
  lightHammer: w('Light Hammer', 'simpleMelee', 200, 2, '1d4', 'bludgeoning', ['light', 'thrown'], { range: [20, 60] }),
  mace: w('Mace', 'simpleMelee', 500, 4, '1d6', 'bludgeoning'),
  quarterstaff: w('Quarterstaff', 'simpleMelee', 20, 4, '1d6', 'bludgeoning', ['versatile'], { versatile: '1d8' }),
  sickle: w('Sickle', 'simpleMelee', 100, 2, '1d4', 'slashing', ['light']),
  spear: w('Spear', 'simpleMelee', 100, 3, '1d6', 'piercing', ['thrown', 'versatile'], { range: [20, 60], versatile: '1d8' }),
  // simple ranged
  lightCrossbow: w('Light Crossbow', 'simpleRanged', 2500, 5, '1d8', 'piercing', ['ammunition', 'loading', 'twoHanded'], { range: [80, 320], ammo: 'crossbowBolts' }),
  dart: w('Dart', 'simpleRanged', 5, 0.25, '1d4', 'piercing', ['finesse', 'thrown'], { range: [20, 60] }),
  shortbow: w('Shortbow', 'simpleRanged', 2500, 2, '1d6', 'piercing', ['ammunition', 'twoHanded'], { range: [80, 320], ammo: 'arrows' }),
  sling: w('Sling', 'simpleRanged', 10, 0, '1d4', 'bludgeoning', ['ammunition'], { range: [30, 120], ammo: 'slingBullets' }),
  // martial melee
  battleaxe: w('Battleaxe', 'martialMelee', 1000, 4, '1d8', 'slashing', ['versatile'], { versatile: '1d10' }),
  flail: w('Flail', 'martialMelee', 1000, 2, '1d8', 'bludgeoning'),
  glaive: w('Glaive', 'martialMelee', 2000, 6, '1d10', 'slashing', ['heavy', 'reach', 'twoHanded']),
  greataxe: w('Greataxe', 'martialMelee', 3000, 7, '1d12', 'slashing', ['heavy', 'twoHanded']),
  greatsword: w('Greatsword', 'martialMelee', 5000, 6, '2d6', 'slashing', ['heavy', 'twoHanded']),
  halberd: w('Halberd', 'martialMelee', 2000, 6, '1d10', 'slashing', ['heavy', 'reach', 'twoHanded']),
  lance: w('Lance', 'martialMelee', 1000, 6, '1d12', 'piercing', ['reach', 'special']),
  longsword: w('Longsword', 'martialMelee', 1500, 3, '1d8', 'slashing', ['versatile'], { versatile: '1d10' }),
  maul: w('Maul', 'martialMelee', 1000, 10, '2d6', 'bludgeoning', ['heavy', 'twoHanded']),
  morningstar: w('Morningstar', 'martialMelee', 1500, 4, '1d8', 'piercing'),
  pike: w('Pike', 'martialMelee', 500, 18, '1d10', 'piercing', ['heavy', 'reach', 'twoHanded']),
  rapier: w('Rapier', 'martialMelee', 2500, 2, '1d8', 'piercing', ['finesse']),
  scimitar: w('Scimitar', 'martialMelee', 2500, 3, '1d6', 'slashing', ['finesse', 'light']),
  shortsword: w('Shortsword', 'martialMelee', 1000, 2, '1d6', 'piercing', ['finesse', 'light']),
  trident: w('Trident', 'martialMelee', 500, 4, '1d6', 'piercing', ['thrown', 'versatile'], { range: [20, 60], versatile: '1d8' }),
  warPick: w('War Pick', 'martialMelee', 500, 2, '1d8', 'piercing'),
  warhammer: w('Warhammer', 'martialMelee', 1500, 2, '1d8', 'bludgeoning', ['versatile'], { versatile: '1d10' }),
  whip: w('Whip', 'martialMelee', 200, 3, '1d4', 'slashing', ['finesse', 'reach']),
  // martial ranged
  blowgun: w('Blowgun', 'martialRanged', 1000, 1, '1', 'piercing', ['ammunition', 'loading'], { range: [25, 100], ammo: 'blowgunNeedles' }),
  handCrossbow: w('Hand Crossbow', 'martialRanged', 7500, 3, '1d6', 'piercing', ['ammunition', 'light', 'loading'], { range: [30, 120], ammo: 'crossbowBolts' }),
  heavyCrossbow: w('Heavy Crossbow', 'martialRanged', 5000, 18, '1d10', 'piercing', ['ammunition', 'heavy', 'loading', 'twoHanded'], { range: [100, 400], ammo: 'crossbowBolts' }),
  longbow: w('Longbow', 'martialRanged', 5000, 2, '1d8', 'piercing', ['ammunition', 'heavy', 'twoHanded'], { range: [150, 600], ammo: 'arrows' }),
});

const a = (name, category, baseAc, cost, weight, extra = {}) => ({ name, kind: 'armor', category, baseAc, cost, weight, ...extra });

export const ARMOR = dict({
  paddedArmor: a('Padded Armor', 'light', 11, 500, 8, { stealthDisadvantage: true }),
  leatherArmor: a('Leather Armor', 'light', 11, 1000, 10),
  studdedLeather: a('Studded Leather', 'light', 12, 4500, 13),
  hideArmor: a('Hide Armor', 'medium', 12, 1000, 12),
  chainShirt: a('Chain Shirt', 'medium', 13, 5000, 20),
  scaleMail: a('Scale Mail', 'medium', 14, 5000, 45, { stealthDisadvantage: true }),
  breastplate: a('Breastplate', 'medium', 14, 40000, 20),
  halfPlate: a('Half Plate', 'medium', 15, 75000, 40, { stealthDisadvantage: true }),
  ringMail: a('Ring Mail', 'heavy', 14, 3000, 40, { stealthDisadvantage: true }),
  chainMail: a('Chain Mail', 'heavy', 16, 7500, 55, { strength: 13, stealthDisadvantage: true }),
  splint: a('Splint Armor', 'heavy', 17, 20000, 60, { strength: 15, stealthDisadvantage: true }),
  plate: a('Plate Armor', 'heavy', 18, 150000, 65, { strength: 15, stealthDisadvantage: true }),
  shield: a('Shield', 'shield', 2, 1000, 6),
});

const g = (name, cost, weight, extra = {}) => ({ name, kind: 'gear', cost, weight, ...extra });
const gem = (name, gp) => ({ name, kind: 'treasure', cost: gp * 100, weight: 0 });

export const GEAR = dict({
  // ammunition, sold in bundles of `stack`
  arrows: g('Arrow', 5, 0.05, { stack: 20, ammunition: true }),
  crossbowBolts: g('Crossbow Bolt', 5, 0.075, { stack: 20, ammunition: true }),
  slingBullets: g('Sling Bullet', 1, 0.075, { stack: 20, ammunition: true }),
  blowgunNeedles: g('Blowgun Needle', 2, 0.02, { stack: 50, ammunition: true }),
  // adventuring gear
  backpack: g('Backpack', 200, 5),
  bedroll: g('Bedroll', 100, 7),
  blanket: g('Blanket', 50, 3),
  ballBearings: g('Ball Bearings (bag of 1,000)', 100, 2),
  bell: g('Bell', 100, 0),
  book: g('Book', 2500, 5),
  candle: g('Candle', 1, 0),
  chain: g('Chain (10 ft)', 500, 10),
  climbersKit: g("Climber's Kit", 2500, 12),
  crowbar: g('Crowbar', 200, 5),
  grapplingHook: g('Grappling Hook', 200, 4),
  hammer: g('Hammer', 100, 3),
  ink: g('Ink (1 ounce bottle)', 1000, 0),
  inkPen: g('Ink Pen', 2, 0),
  ironPot: g('Iron Pot', 200, 10),
  lantern: g('Hooded Lantern', 500, 2),
  manacles: g('Manacles', 200, 6),
  messKit: g('Mess Kit', 20, 1),
  mirror: g('Steel Mirror', 500, 0.5),
  oil: g('Oil (flask)', 10, 1),
  paper: g('Paper (one sheet)', 20, 0),
  parchment: g('Parchment (one sheet)', 10, 0),
  piton: g('Piton', 5, 0.25),
  pouch: g('Pouch', 50, 1),
  prayerBook: g('Prayer Book', 2500, 5),
  rations: g('Rations (1 day)', 50, 2),
  ropeHempen: g('Hempen Rope (50 ft)', 100, 10),
  ropeSilk: g('Silk Rope (50 ft)', 1000, 5),
  sack: g('Sack', 1, 0.5),
  shovel: g('Shovel', 200, 5),
  signetRing: g('Signet Ring', 500, 0),
  // the base of story items (a letter, a locket, a strange key): a name and notes, no rules
  curio: g('Curio', 0, 0, { story: true }),
  soap: g('Soap', 2, 0),
  tinderbox: g('Tinderbox', 50, 1),
  torch: g('Torch', 1, 1),
  waterskin: g('Waterskin', 20, 5),
  huntingTrap: g('Hunting Trap', 500, 25),
  // clothes
  commonClothes: g('Common Clothes', 50, 3),
  costumeClothes: g('Costume Clothes', 500, 4),
  fineClothes: g('Fine Clothes', 1500, 6),
  travelersClothes: g("Traveler's Clothes", 200, 4),
  // spellcasting focuses
  arcaneFocus: g('Arcane Focus (crystal)', 1000, 1),
  componentPouch: g('Component Pouch', 2500, 2),
  druidicFocus: g('Druidic Focus (sprig of mistletoe)', 100, 0),
  holySymbol: g('Holy Symbol (amulet)', 500, 1),
  spellbook: g('Spellbook', 5000, 3),
  // tools and kits
  disguiseKit: g('Disguise Kit', 2500, 3),
  forgeryKit: g('Forgery Kit', 1500, 5),
  herbalismKit: g('Herbalism Kit', 500, 3),
  healersKit: g("Healer's Kit", 500, 3, { uses: 10, use: { kind: 'stabilize' } }),
  smithsTools: g("Smith's Tools", 2000, 8),
  thievesTools: g("Thieves' Tools", 2500, 1),
  tinkersTools: g("Tinker's Tools", 5000, 10),
  lute: g('Lute', 3500, 2),
  flute: g('Flute', 200, 1),
  drum: g('Drum', 600, 3),
  // consumables
  acidVial: g('Acid (vial)', 2500, 1, { use: { kind: 'throw', range: [20, 20], damage: '2d6', damageType: 'acid' } }),
  alchemistsFire: g("Alchemist's Fire (flask)", 5000, 1, { use: { kind: 'throw', range: [20, 20], damage: '1d4', damageType: 'fire' } }),
  antitoxin: g('Antitoxin (vial)', 5000, 0, { use: { kind: 'antitoxin' } }),
  holyWater: g('Holy Water (flask)', 2500, 1, { use: { kind: 'throw', range: [20, 20], damage: '2d6', damageType: 'radiant', onlyVs: ['fiend', 'undead'] } }),
  goodberry: g('Goodberry', 0, 0, { use: { kind: 'heal', dice: '1' } }),
  // valuables, sold at full value; some are costly spell components
  diamond100: gem('Diamond (100 gp)', 100),
  diamond300: gem('Diamond (300 gp)', 300),
  diamond500: gem('Diamond (500 gp)', 500),
  diamond1000: gem('Diamond (1,000 gp)', 1000),
  pearl100: gem('Pearl (100 gp)', 100),
  gem10: gem('Gemstone (10 gp)', 10),
  gem50: gem('Gemstone (50 gp)', 50),
  artObject25: gem('Art Object (25 gp)', 25),
  artObject250: gem('Art Object (250 gp)', 250),
});

const scroll = (spell, name, level, rarity) => ({ name: `Spell Scroll (${name})`, kind: 'scroll', rarity, cost: { common: 5000, uncommon: 20000, rare: 100000 }[rarity], weight: 0, consumable: true, castsSpell: { spell, baseLevel: level, maxLevel: level } });
const potion = (name, rarity, cost, use) => ({ name, kind: 'potion', rarity, cost, weight: 0.5, use });

export const MAGIC_ITEMS = dict({
  // potions
  potionHealing: potion('Potion of Healing', 'common', 5000, { kind: 'heal', dice: '2d4+2' }),
  potionGreaterHealing: potion('Potion of Greater Healing', 'uncommon', 15000, { kind: 'heal', dice: '4d4+4' }),
  potionSuperiorHealing: potion('Potion of Superior Healing', 'rare', 50000, { kind: 'heal', dice: '8d4+8' }),
  potionSupremeHealing: potion('Potion of Supreme Healing', 'very rare', 135000, { kind: 'heal', dice: '10d4+20' }),
  potionFireResistance: potion('Potion of Fire Resistance', 'uncommon', 30000, { kind: 'effect', effect: { name: 'Fire Resistance', resistances: ['fire'], minutes: 60 } }),
  potionHeroism: potion('Potion of Heroism', 'rare', 50000, { kind: 'effect', tempHp: 10, effect: { name: 'Heroism', attackDie: '1d4', saveDie: '1d4', minutes: 60 } }),
  potionInvisibility: potion('Potion of Invisibility', 'very rare', 180000, { kind: 'effect', effect: { name: 'Invisible', conditions: ['invisible'], endsOnAttack: true, minutes: 60 } }),
  potionSpeed: potion('Potion of Speed', 'very rare', 180000, { kind: 'effect', effect: { name: 'Haste', acBonus: 2, speedMultiplier: 2, extraAction: true, dexSaveAdvantage: true, lethargyOnEnd: true, minutes: 1 } }),
  // scrolls
  scrollCureWounds: scroll('cureWounds', 'Cure Wounds', 1, 'common'),
  scrollMagicMissile: scroll('magicMissile', 'Magic Missile', 1, 'common'),
  scrollShield: scroll('shield', 'Shield', 1, 'common'),
  scrollLesserRestoration: scroll('lesserRestoration', 'Lesser Restoration', 2, 'uncommon'),
  scrollMistyStep: scroll('mistyStep', 'Misty Step', 2, 'uncommon'),
  scrollFireball: scroll('fireball', 'Fireball', 3, 'uncommon'),
  scrollRevivify: scroll('revivify', 'Revivify', 3, 'uncommon'),
  // wands and staffs
  wandMagicMissiles: { name: 'Wand of Magic Missiles', kind: 'wand', rarity: 'uncommon', cost: 30000, weight: 1, charges: 7, castsSpell: { spell: 'magicMissile', baseLevel: 1, maxLevel: 3, chargesPerLevel: 1 } },
  wandWeb: { name: 'Wand of Web', kind: 'wand', rarity: 'uncommon', attunement: true, cost: 30000, weight: 1, charges: 7, castsSpell: { spell: 'web', baseLevel: 2, maxLevel: 2, chargesPerLevel: 1, dc: 15 } },
  wandFireballs: { name: 'Wand of Fireballs', kind: 'wand', rarity: 'rare', attunement: true, cost: 400000, weight: 1, charges: 7, castsSpell: { spell: 'fireball', baseLevel: 3, maxLevel: 9, chargesPerLevel: 1, dc: 15 } },
  wandLightningBolts: { name: 'Wand of Lightning Bolts', kind: 'wand', rarity: 'rare', attunement: true, cost: 400000, weight: 1, charges: 7, castsSpell: { spell: 'lightningBolt', baseLevel: 3, maxLevel: 9, chargesPerLevel: 1, dc: 15 } },
  staffHealing: { name: 'Staff of Healing', kind: 'staff', rarity: 'rare', attunement: true, cost: 500000, weight: 4, charges: 10, castsSpell: { spell: 'cureWounds', baseLevel: 1, maxLevel: 4, chargesPerLevel: 1 } },
  // weapons and armor: the base item is chosen when the item is awarded
  weaponPlus1: { name: '+1 Weapon', kind: 'magicWeapon', rarity: 'uncommon', bonus: 1, baseChoice: true, cost: 100000 },
  weaponPlus2: { name: '+2 Weapon', kind: 'magicWeapon', rarity: 'rare', bonus: 2, baseChoice: true, cost: 400000 },
  weaponPlus3: { name: '+3 Weapon', kind: 'magicWeapon', rarity: 'very rare', bonus: 3, baseChoice: true, cost: 1600000 },
  armorPlus1: { name: '+1 Armor', kind: 'magicArmor', rarity: 'rare', bonus: 1, baseChoice: true, cost: 150000 },
  armorPlus2: { name: '+2 Armor', kind: 'magicArmor', rarity: 'very rare', bonus: 2, baseChoice: true, cost: 600000 },
  armorPlus3: { name: '+3 Armor', kind: 'magicArmor', rarity: 'legendary', bonus: 3, baseChoice: true, cost: 2400000 },
  shieldPlus1: { name: '+1 Shield', kind: 'magicArmor', rarity: 'uncommon', bonus: 1, base: 'shield', cost: 100000, weight: 6 },
  shieldPlus2: { name: '+2 Shield', kind: 'magicArmor', rarity: 'rare', bonus: 2, base: 'shield', cost: 400000, weight: 6 },
  flameTongue: { name: 'Flame Tongue (Weapon)', kind: 'magicWeapon', rarity: 'rare', attunement: true, base: 'longsword', bonus: 0, ignitable: { damage: '2d6', damageType: 'fire' }, cost: 500000, weight: 3 },
  // wondrous items
  ringProtection: { name: 'Ring of Protection', kind: 'wondrous', rarity: 'rare', attunement: true, slot: 'ring', cost: 350000, weight: 0, passive: { acBonus: 1, saveBonus: 1 } },
  cloakProtection: { name: 'Cloak of Protection', kind: 'wondrous', rarity: 'uncommon', attunement: true, slot: 'cloak', cost: 350000, weight: 1, passive: { acBonus: 1, saveBonus: 1 } },
  cloakElvenkind: { name: 'Cloak of Elvenkind', kind: 'wondrous', rarity: 'uncommon', attunement: true, slot: 'cloak', cost: 500000, weight: 1, passive: { skillAdvantage: ['stealth'] } },
  bootsElvenkind: { name: 'Boots of Elvenkind', kind: 'wondrous', rarity: 'uncommon', slot: 'boots', cost: 250000, weight: 1, passive: { skillAdvantage: ['stealth'] } },
  bootsStriding: { name: 'Boots of Striding and Springing', kind: 'wondrous', rarity: 'uncommon', attunement: true, slot: 'boots', cost: 500000, weight: 1, passive: { speedFloor: 30 } },
  bracersDefense: { name: 'Bracers of Defense', kind: 'wondrous', rarity: 'rare', attunement: true, slot: 'wrists', cost: 600000, weight: 1, passive: { acBonusUnarmored: 2 } },
  eyesEagle: { name: 'Eyes of the Eagle', kind: 'wondrous', rarity: 'uncommon', attunement: true, slot: 'eyes', cost: 250000, weight: 0, passive: { skillAdvantage: ['perception'] } },
  amuletHealth: { name: 'Amulet of Health', kind: 'wondrous', rarity: 'rare', attunement: true, slot: 'neck', cost: 800000, weight: 1, passive: { setAbility: { con: 19 } } },
  gauntletsOgrePower: { name: 'Gauntlets of Ogre Power', kind: 'wondrous', rarity: 'uncommon', attunement: true, slot: 'hands', cost: 800000, weight: 2, passive: { setAbility: { str: 19 } } },
  headbandIntellect: { name: 'Headband of Intellect', kind: 'wondrous', rarity: 'uncommon', attunement: true, slot: 'head', cost: 800000, weight: 1, passive: { setAbility: { int: 19 } } },
  beltHillGiant: { name: 'Belt of Hill Giant Strength', kind: 'wondrous', rarity: 'rare', attunement: true, slot: 'waist', cost: 2000000, weight: 1, passive: { setAbility: { str: 21 } } },
  bagOfHolding: { name: 'Bag of Holding', kind: 'wondrous', rarity: 'uncommon', cost: 400000, weight: 15 },
});

export const ITEMS = dict({ ...WEAPONS, ...ARMOR, ...GEAR, ...MAGIC_ITEMS });

const pack = (name, cost, contents) => ({ name, cost, contents });

export const PACKS = dict({
  burglarsPack: pack("Burglar's Pack", 1600, { backpack: 1, ballBearings: 1, bell: 1, candle: 5, crowbar: 1, hammer: 1, piton: 10, lantern: 1, oil: 2, rations: 5, tinderbox: 1, waterskin: 1, ropeHempen: 1 }),
  diplomatsPack: pack("Diplomat's Pack", 3900, { fineClothes: 1, ink: 1, inkPen: 1, lantern: 1, oil: 2, paper: 5, soap: 1 }),
  dungeoneersPack: pack("Dungeoneer's Pack", 1200, { backpack: 1, crowbar: 1, hammer: 1, piton: 10, torch: 10, tinderbox: 1, rations: 10, waterskin: 1, ropeHempen: 1 }),
  entertainersPack: pack("Entertainer's Pack", 4000, { backpack: 1, bedroll: 1, costumeClothes: 2, candle: 5, rations: 5, waterskin: 1, disguiseKit: 1 }),
  explorersPack: pack("Explorer's Pack", 1000, { backpack: 1, bedroll: 1, messKit: 1, tinderbox: 1, torch: 10, rations: 10, waterskin: 1, ropeHempen: 1 }),
  priestsPack: pack("Priest's Pack", 1900, { backpack: 1, blanket: 1, candle: 10, tinderbox: 1, rations: 2, waterskin: 1 }),
  scholarsPack: pack("Scholar's Pack", 4000, { backpack: 1, book: 1, ink: 1, inkPen: 1, parchment: 10, sack: 1 }),
});

export const findItemKey = finder(ITEMS, {
  rope: 'ropeHempen',
  'hempen rope': 'ropeHempen',
  'silk rope': 'ropeSilk',
  ration: 'rations',
  arrow: 'arrows',
  bolt: 'crossbowBolts',
  bolts: 'crossbowBolts',
  'sling bullets': 'slingBullets',
  leather: 'leatherArmor',
  padded: 'paddedArmor',
  hide: 'hideArmor',
  splint: 'splint',
  'healing potion': 'potionHealing',
  'potion of healing': 'potionHealing',
  'greater healing potion': 'potionGreaterHealing',
  'healers kit': 'healersKit',
  'alchemists fire': 'alchemistsFire',
  acid: 'acidVial',
  'holy water': 'holyWater',
  lantern: 'lantern',
  'thieves tools': 'thievesTools',
  '+1 weapon': 'weaponPlus1',
  '+2 weapon': 'weaponPlus2',
  '+3 weapon': 'weaponPlus3',
  '+1 armor': 'armorPlus1',
  '+2 armor': 'armorPlus2',
  '+3 armor': 'armorPlus3',
  '+1 shield': 'shieldPlus1',
  '+2 shield': 'shieldPlus2',
  'flame tongue': 'flameTongue',
});
