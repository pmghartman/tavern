import { dict } from './dict.js';
import { MORE_SUBCLASSES, BASE_SOURCES } from './subclasses.js';

// full-caster slots by caster level (index 0 unused)
export const FULL_CASTER_SLOTS = [
  [],
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

// slot counts per spell level for a single-classed caster
export function slotsFor(type, level) {
  const l = Math.max(0, Math.min(20, level));
  if (type === 'full') return [...FULL_CASTER_SLOTS[l]];
  if (type === 'half') return l < 2 ? [] : [...FULL_CASTER_SLOTS[Math.ceil(l / 2)]];
  // the artificer is a half caster from 1st level, rounding up
  if (type === 'artificer') return [...FULL_CASTER_SLOTS[Math.ceil(l / 2)]];
  if (type === 'third') return l < 3 ? [] : [...FULL_CASTER_SLOTS[Math.ceil(l / 3)]];
  return [];
}

// warlock pact magic: slot level and count
export function pactSlots(level) {
  const l = Math.max(1, Math.min(20, level));
  return { level: l >= 9 ? 5 : Math.ceil(l / 2), count: l >= 17 ? 4 : l >= 11 ? 3 : l >= 2 ? 2 : 1 };
}

const by = (...ranges) => lvl => {
  let v = 0;
  for (const [from, val] of ranges) if (lvl >= from) v = val;
  return v;
};
const table = fn => Array.from({ length: 20 }, (_, i) => fn(i + 1));

// sub: the subclass a feature belongs to; without one every member of the class has it
const f = (key, level, name, desc, sub = null) => ({ key, level, name, desc, ...(sub ? { sub } : {}) });

export const FIGHTING_STYLES = dict({
  archery: { name: 'Archery', desc: '+2 to attack rolls with ranged weapons.' },
  defense: { name: 'Defense', desc: '+1 AC while wearing armor.' },
  dueling: { name: 'Dueling', desc: '+2 damage with a one-handed melee weapon and no other weapon.' },
  greatWeaponFighting: { name: 'Great Weapon Fighting', desc: 'Reroll 1s and 2s on damage dice of two-handed melee weapons.' },
  protection: { name: 'Protection', desc: 'Use your reaction and a shield to impose disadvantage on an attack against an adjacent ally.' },
  twoWeaponFighting: { name: 'Two-Weapon Fighting', desc: 'Add your ability modifier to the damage of your off-hand attack.' },
  // Tasha's Cauldron of Everything
  blindFighting: { name: 'Blind Fighting', source: 'TCE', desc: 'Blindsight to 10 feet: you see what is near you even in darkness or when it is invisible.' },
  interception: { name: 'Interception', source: 'TCE', desc: 'Reaction with a shield or weapon: reduce the damage to an adjacent ally by 1d10 + your proficiency bonus.' },
  superiorTechnique: { name: 'Superior Technique', source: 'TCE', desc: 'Learn one Battle Master maneuver and gain one superiority die (d6), regained on a short rest.' },
  thrownWeaponFighting: { name: 'Thrown Weapon Fighting', source: 'TCE', desc: 'Draw a thrown weapon as part of the attack, and +2 damage with thrown weapon attacks.' },
  unarmedFighting: { name: 'Unarmed Fighting', source: 'TCE', desc: 'Unarmed strikes deal 1d6 + Strength (1d8 with both hands free), and you deal 1d4 to a creature you grapple each turn.' },
});

export const METAMAGIC = dict({
  careful: { name: 'Careful Spell', cost: 1, desc: 'Up to your Cha modifier of creatures automatically succeed on the spell\'s save.' },
  distant: { name: 'Distant Spell', cost: 1, desc: 'Double the range, or 30 ft for touch spells.' },
  empowered: { name: 'Empowered Spell', cost: 1, desc: 'Reroll up to your Cha modifier of damage dice. Combines with another option.' },
  extended: { name: 'Extended Spell', cost: 1, desc: 'Double a duration of 1 minute or longer.' },
  heightened: { name: 'Heightened Spell', cost: 3, desc: 'One target has disadvantage on its first save against the spell.' },
  quickened: { name: 'Quickened Spell', cost: 2, desc: 'Cast a 1-action spell as a bonus action.' },
  subtle: { name: 'Subtle Spell', cost: 1, desc: 'Cast without verbal or somatic components.' },
  twinned: { name: 'Twinned Spell', cost: '1 per level', desc: 'Target a second creature with a single-target spell.' },
  seeking: { name: 'Seeking Spell', cost: 2, source: 'TCE', desc: 'Reroll a missed spell attack roll.' },
  transmuted: { name: 'Transmuted Spell', cost: 1, source: 'TCE', desc: 'Change an acid, cold, fire, lightning, poison or thunder spell to another of those types.' },
});

export const INVOCATIONS = dict({
  agonizingBlast: { name: 'Agonizing Blast', desc: 'Add your Cha modifier to Eldritch Blast damage.', requires: { cantrip: 'eldritchBlast' } },
  armorOfShadows: { name: 'Armor of Shadows', desc: 'Cast Mage Armor on yourself at will.' },
  beastSpeech: { name: 'Beast Speech', desc: 'Cast Speak with Animals at will.' },
  devilsSight: { name: "Devil's Sight", desc: 'See normally in darkness, magical or not, to 120 ft.' },
  eldritchSpear: { name: 'Eldritch Spear', desc: 'Eldritch Blast range becomes 300 ft.', requires: { cantrip: 'eldritchBlast' } },
  eyesOfTheRuneKeeper: { name: 'Eyes of the Rune Keeper', desc: 'Read all writing.' },
  fiendishVigor: { name: 'Fiendish Vigor', desc: 'Cast False Life on yourself at will.' },
  maskOfManyFaces: { name: 'Mask of Many Faces', desc: 'Cast Disguise Self at will.' },
  repellingBlast: { name: 'Repelling Blast', desc: 'Eldritch Blast pushes creatures 10 ft away.', requires: { cantrip: 'eldritchBlast' } },
  thirstingBlade: { name: 'Thirsting Blade', desc: 'Attack twice with your pact weapon when you take the Attack action.', requires: { level: 5, pact: 'blade' } },
  // the rest of the Player's Handbook
  ascendantStep: { name: 'Ascendant Step', desc: 'Cast Levitate on yourself at will.', requires: { level: 9 } },
  beguilingInfluence: { name: 'Beguiling Influence', desc: 'Proficiency in Deception and Persuasion.' },
  bewitchingWhispers: { name: 'Bewitching Whispers', desc: 'Cast Compulsion once with a warlock slot per long rest.', requires: { level: 7 } },
  bookOfAncientSecrets: { name: 'Book of Ancient Secrets', desc: 'Inscribe and cast ritual spells from any class in your Book of Shadows.', requires: { pact: 'tome' } },
  chainsOfCarceri: { name: 'Chains of Carceri', desc: 'Cast Hold Monster at will on celestials, fiends or elementals.', requires: { level: 15, pact: 'chain' } },
  dreadfulWord: { name: 'Dreadful Word', desc: 'Cast Confusion once with a warlock slot per long rest.', requires: { level: 7 } },
  eldritchSight: { name: 'Eldritch Sight', desc: 'Cast Detect Magic at will.' },
  gazeOfTwoMinds: { name: 'Gaze of Two Minds', desc: "Perceive through a willing humanoid's senses." },
  lifedrinker: { name: 'Lifedrinker', desc: 'Your pact weapon deals extra necrotic damage equal to your Charisma modifier.', requires: { level: 12, pact: 'blade' } },
  minionsOfChaos: { name: 'Minions of Chaos', desc: 'Cast Conjure Elemental once with a warlock slot per long rest.', requires: { level: 9 } },
  mireTheMind: { name: 'Mire the Mind', desc: 'Cast Slow once with a warlock slot per long rest.', requires: { level: 5 } },
  mistyVisions: { name: 'Misty Visions', desc: 'Cast Silent Image at will.' },
  oneWithShadows: { name: 'One with Shadows', desc: 'In dim light or darkness, become invisible until you move or act.', requires: { level: 5 } },
  otherworldlyLeap: { name: 'Otherworldly Leap', desc: 'Cast Jump on yourself at will.', requires: { level: 9 } },
  sculptorOfFlesh: { name: 'Sculptor of Flesh', desc: 'Cast Polymorph once with a warlock slot per long rest.', requires: { level: 7 } },
  signOfIllOmen: { name: 'Sign of Ill Omen', desc: 'Cast Bestow Curse once with a warlock slot per long rest.', requires: { level: 5 } },
  thiefOfFiveFates: { name: 'Thief of Five Fates', desc: 'Cast Bane once with a warlock slot per long rest.' },
  voiceOfTheChainMaster: { name: 'Voice of the Chain Master', desc: 'Communicate telepathically with your familiar and perceive through it at any distance.', requires: { pact: 'chain' } },
  whispersOfTheGrave: { name: 'Whispers of the Grave', desc: 'Cast Speak with Dead at will.', requires: { level: 9 } },
  witchSight: { name: 'Witch Sight', desc: 'See the true form of shapechangers and illusions within 30 feet.', requires: { level: 15 } },
  // Xanathar's Guide to Everything
  aspectOfTheMoon: { name: 'Aspect of the Moon', source: 'XGtE', desc: 'You need no sleep and rest by light activity.', requires: { pact: 'tome' } },
  cloakOfFlies: { name: 'Cloak of Flies', source: 'XGtE', desc: 'A swarm of flies gives advantage on Intimidation and poisons those who end their turn next to you, once per short rest.', requires: { level: 5 } },
  eldritchSmite: { name: 'Eldritch Smite', source: 'XGtE', desc: 'Spend a pact slot on a pact weapon hit for 1d8 + 1d8 per slot level of force damage and knock the target prone.', requires: { level: 5, pact: 'blade' } },
  ghostlyGaze: { name: 'Ghostly Gaze', source: 'XGtE', desc: 'See through solid objects to 30 feet for a minute, once per short rest.', requires: { level: 7 } },
  giftOfTheDepths: { name: 'Gift of the Depths', source: 'XGtE', desc: 'Breathe underwater, swim at your walking speed, and cast Water Breathing once per long rest.', requires: { level: 5 } },
  giftOfTheEverLivingOnes: { name: 'Gift of the Ever-Living Ones', source: 'XGtE', desc: 'Healing dice are maximized while your familiar is within 100 feet.', requires: { pact: 'chain' } },
  graspOfHadar: { name: 'Grasp of Hadar', source: 'XGtE', desc: 'Once per turn, an Eldritch Blast hit pulls the target 10 feet toward you.', requires: { cantrip: 'eldritchBlast' } },
  improvedPactWeapon: { name: 'Improved Pact Weapon', source: 'XGtE', desc: 'Your pact weapon gains +1 to attack and damage and can be a bow or crossbow.', requires: { pact: 'blade' } },
  lanceOfLethargy: { name: 'Lance of Lethargy', source: 'XGtE', desc: 'Once per turn, an Eldritch Blast hit reduces the target\'s speed by 10 feet.', requires: { cantrip: 'eldritchBlast' } },
  maddeningHex: { name: 'Maddening Hex', source: 'XGtE', desc: 'Bonus action: deal psychic damage equal to your Charisma modifier to your hexed target and creatures next to it.', requires: { level: 5 } },
  relentlessHex: { name: 'Relentless Hex', source: 'XGtE', desc: 'Bonus action: teleport 30 feet to a space next to your hexed target.', requires: { level: 7 } },
  shroudOfShadow: { name: 'Shroud of Shadow', source: 'XGtE', desc: 'Cast Invisibility at will.', requires: { level: 15 } },
  tombOfLevistus: { name: 'Tomb of Levistus', source: 'XGtE', desc: 'Reaction when damaged: encase yourself in ice for 10 temporary hit points per warlock level, once per short rest.', requires: { level: 5 } },
  tricksterssEscape: { name: "Trickster's Escape", source: 'XGtE', desc: 'Cast Freedom of Movement on yourself once per long rest.', requires: { level: 7 } },
  // Tasha's Cauldron of Everything
  bondOfTheTalisman: { name: 'Bond of the Talisman', source: 'TCE', desc: 'Teleport to the wearer of your talisman, proficiency bonus times per long rest.', requires: { level: 12, pact: 'talisman' } },
  eldritchMind: { name: 'Eldritch Mind', source: 'TCE', desc: 'Advantage on Constitution saves to keep concentration.' },
  farScribe: { name: 'Far Scribe', source: 'TCE', desc: 'Send messages to creatures who signed your Book of Shadows.', requires: { level: 5, pact: 'tome' } },
  giftOfTheProtectors: { name: 'Gift of the Protectors', source: 'TCE', desc: 'A creature who signed your book drops to 1 hit point instead of 0, once per long rest.', requires: { level: 9, pact: 'tome' } },
  investmentOfTheChainMaster: { name: 'Investment of the Chain Master', source: 'TCE', desc: 'Your familiar flies or swims at 40 feet, attacks with your spell DC and magical attacks, and resists damage.', requires: { pact: 'chain' } },
  protectionOfTheTalisman: { name: 'Protection of the Talisman', source: 'TCE', desc: 'The talisman\'s wearer adds 1d4 to failed saving throws.', requires: { level: 7, pact: 'talisman' } },
  rebukeOfTheTalisman: { name: 'Rebuke of the Talisman', source: 'TCE', desc: 'Reaction when the wearer is hit: psychic damage equal to your proficiency bonus and push the attacker 10 feet.', requires: { pact: 'talisman' } },
  undyingServitude: { name: 'Undying Servitude', source: 'TCE', desc: 'Cast Animate Dead without a slot once per long rest.', requires: { level: 5 } },
});

// artificer infusions (Tasha's): known by level, and the level an infusion needs
export const INFUSIONS = dict({
  enhancedArcaneFocus: { name: 'Enhanced Arcane Focus', desc: 'A rod, staff or wand gives +1 to spell attack rolls (+2 at 10th) and ignores half cover.' },
  enhancedDefense: { name: 'Enhanced Defense', desc: 'A suit of armor or a shield gives +1 AC (+2 at 10th).' },
  enhancedWeapon: { name: 'Enhanced Weapon', desc: 'A simple or martial weapon gains +1 to attack and damage rolls (+2 at 10th).' },
  homunculusServant: { name: 'Homunculus Servant', desc: 'A gem becomes a tiny flying construct that acts on your turn and can deliver your touch spells.' },
  mindSharpener: { name: 'Mind Sharpener', desc: 'Armor or robes let the wearer turn a failed concentration save into a success, four times a day.' },
  repeatingShot: { name: 'Repeating Shot', desc: 'A ranged weapon with ammunition gains +1 to attack and damage and loads itself.' },
  replicateMagicItem: { name: 'Replicate Magic Item', desc: 'Make a common or uncommon magic item from the artificer list (bag of holding, goggles of night, and more at higher levels).' },
  returningWeapon: { name: 'Returning Weapon', desc: 'A thrown weapon gains +1 to attack and damage and flies back to your hand.' },
  bootsOfTheWindingPath: { name: 'Boots of the Winding Path', level: 6, desc: 'Boots that teleport the wearer back to a space it occupied this turn.' },
  radiantWeapon: { name: 'Radiant Weapon', level: 6, desc: 'A weapon gains +1, sheds light, and can blind an attacker as a reaction.' },
  repulsionShield: { name: 'Repulsion Shield', level: 6, desc: 'A shield gives +1 AC and can push an attacker 15 feet as a reaction.' },
  resistantArmor: { name: 'Resistant Armor', level: 6, desc: 'Armor grants resistance to one damage type you choose.' },
  spellRefuelingRing: { name: 'Spell-Refueling Ring', level: 6, desc: 'A ring that restores one spell slot of 3rd level or lower once a day.' },
  armorOfMagicalStrength: { name: 'Armor of Magical Strength', level: 10, desc: 'Armor with charges that add the wearer\'s Intelligence to Strength checks and saves, or keep it from being knocked prone.' },
  helmOfAwareness: { name: 'Helm of Awareness', level: 10, desc: 'Advantage on initiative, and the wearer cannot be surprised.' },
  arcanePropulsionArmor: { name: 'Arcane Propulsion Armor', level: 14, desc: 'Armor with +5 speed, force gauntlets (1d8 force, thrown 20/60) and limbs that cannot be removed.' },
});

export const PACT_BOONS = dict({ blade: 'Pact of the Blade', chain: 'Pact of the Chain', tome: 'Pact of the Tome', talisman: 'Pact of the Talisman' });

// Battle Master maneuvers (Player's Handbook and Tasha's); superiority dice add damage in the engine,
// the rest the DM narrates
export const MANEUVERS = dict({
  commandersStrike: { name: "Commander's Strike", desc: 'Forgo an attack so an ally can strike with its reaction, adding the die to damage.' },
  disarmingAttack: { name: 'Disarming Attack', desc: 'Add the die to damage; the target makes a Strength save or drops what it holds.' },
  distractingStrike: { name: 'Distracting Strike', desc: 'Add the die to damage; the next ally attack on the target has advantage.' },
  evasiveFootwork: { name: 'Evasive Footwork', desc: 'Add the die to your AC while you move.' },
  feintingAttack: { name: 'Feinting Attack', desc: 'Bonus action: advantage on your next attack, adding the die to damage.' },
  goadingAttack: { name: 'Goading Attack', desc: 'Add the die to damage; the target has disadvantage against others (Wisdom save).' },
  lungingAttack: { name: 'Lunging Attack', desc: 'Add 5 feet of reach and the die to damage.' },
  maneuveringAttack: { name: 'Maneuvering Attack', desc: 'Add the die to damage; an ally moves half its speed without provoking.' },
  menacingAttack: { name: 'Menacing Attack', desc: 'Add the die to damage; the target is frightened (Wisdom save).' },
  parry: { name: 'Parry', desc: 'Reaction: reduce melee damage by the die + Dexterity.' },
  precisionAttack: { name: 'Precision Attack', desc: 'Add the die to an attack roll.' },
  pushingAttack: { name: 'Pushing Attack', desc: 'Add the die to damage and push the target 15 feet (Strength save).' },
  rally: { name: 'Rally', desc: 'Bonus action: an ally gains temporary hit points equal to the die + Charisma.' },
  riposte: { name: 'Riposte', desc: 'Reaction when missed in melee: attack back, adding the die to damage.' },
  sweepingAttack: { name: 'Sweeping Attack', desc: 'Damage a second adjacent creature by the die.' },
  tripAttack: { name: 'Trip Attack', desc: 'Add the die to damage; the target falls prone (Strength save).' },
  ambush: { name: 'Ambush', source: 'TCE', desc: 'Add the die to a Stealth check or initiative.' },
  baitAndSwitch: { name: 'Bait and Switch', source: 'TCE', desc: 'Swap places with an ally, who adds the die to AC.' },
  brace: { name: 'Brace', source: 'TCE', desc: 'Reaction: attack a creature moving into your reach, adding the die to damage.' },
  commandingPresence: { name: 'Commanding Presence', source: 'TCE', desc: 'Add the die to an Intimidation, Performance or Persuasion check.' },
  grapplingStrike: { name: 'Grappling Strike', source: 'TCE', desc: 'After a hit, grapple as a bonus action, adding the die to the check.' },
  quickToss: { name: 'Quick Toss', source: 'TCE', desc: 'Bonus action: throw a weapon, adding the die to damage.' },
  tacticalAssessment: { name: 'Tactical Assessment', source: 'TCE', desc: 'Add the die to an Investigation, History or Insight check.' },
});

const ALL_STYLES = ['archery', 'defense', 'dueling', 'greatWeaponFighting', 'protection', 'twoWeaponFighting', 'blindFighting', 'interception', 'superiorTechnique', 'thrownWeaponFighting', 'unarmedFighting'];

export const CLASSES = dict({
  artificer: {
    name: 'Artificer', source: 'TCE', hitDie: 8, primary: ['int'], saves: ['con', 'int'],
    armor: ['light', 'medium', 'shield'], weapons: ['simple'], tools: ["thieves' tools", "tinker's tools", "one type of artisan's tools"],
    skills: { count: 2, from: ['arcana', 'history', 'investigation', 'medicine', 'nature', 'perception', 'sleightOfHand'] },
    spellcasting: { type: 'artificer', ability: 'int', startLevel: 1, prepared: true, ritual: true, cantrips: table(by([1, 2], [10, 3], [14, 4])) },
    infusions: [0, 4, 4, 4, 4, 6, 6, 6, 6, 8, 8, 8, 8, 10, 10, 10, 10, 12, 12, 12],
    infusedItems: [0, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6],
    features: [
      f('magicalTinkering', 1, 'Magical Tinkering', 'Imbue a Tiny object with a minor magical property: light, a recorded message, a scent or sound, or a static image.'),
      f('artificerSpellcasting', 1, 'Spellcasting', 'Prepare artificer spells with Intelligence each day; you cast through tools or infused items, and can cast rituals.'),
      f('infuseItem', 2, 'Infuse Item', 'Learn infusions and, after a long rest, place them into nonmagical items, which become magic items.'),
      f('artificerSpecialist', 3, 'Artificer Specialist', 'Choose a specialty: Alchemist, Armorer, Artillerist or Battle Smith.'),
      f('theRightToolForTheJob', 3, 'The Right Tool for the Job', 'Conjure a set of artisan\'s tools over an hour.'),
      f('toolExpertise', 6, 'Tool Expertise', 'Double your proficiency bonus for checks with tools you are proficient with.'),
      f('flashOfGenius', 7, 'Flash of Genius', 'Reaction: add your Intelligence modifier to an ability check or save made by you or a creature within 30 feet, Intelligence modifier times per long rest.'),
      f('magicItemAdept', 10, 'Magic Item Adept', 'Attune to four magic items, and craft common and uncommon items quickly and cheaply.'),
      f('spellStoringItem', 11, 'Spell-Storing Item', 'Store a 1st or 2nd-level artificer spell in a weapon or focus; anyone holding it can cast it, twice your Intelligence modifier times.'),
      f('magicItemSavant', 14, 'Magic Item Savant', 'Attune to five magic items, and ignore class, race, spell and level requirements on them.'),
      f('magicItemMaster', 18, 'Magic Item Master', 'Attune to six magic items.'),
      f('soulOfArtifice', 20, 'Soul of Artifice', '+1 to all saves per attuned item, and end an infusion to drop to 1 hit point instead of 0.'),
    ],
    kits: [
      { name: 'Light crossbow, studded leather and tools', items: { lightCrossbow: 1, crossbowBolts: 20, studdedLeather: 1, dagger: 2, thievesTools: 1 }, pack: 'dungeoneersPack' },
      { name: 'Handaxes, scale mail and tools', items: { handaxe: 2, scaleMail: 1, lightCrossbow: 1, crossbowBolts: 20, thievesTools: 1 }, pack: 'dungeoneersPack' },
    ],
    resources: (level, m) => ({ flashOfGenius: { name: 'Flash of Genius', max: level >= 7 ? Math.max(1, m.int) : 0, recharge: 'long' } }),
  },
  barbarian: {
    name: 'Barbarian', hitDie: 12, primary: ['str'], saves: ['str', 'con'],
    armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'], tools: [],
    skills: { count: 2, from: ['animalHandling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'] },
    features: [
      f('rage', 1, 'Rage', 'Bonus action: advantage on Strength checks and saves, bonus melee damage, resistance to bludgeoning, piercing and slashing.'),
      f('unarmoredDefenseBarbarian', 1, 'Unarmored Defense', 'Without armor, AC is 10 + Dex + Con.'),
      f('recklessAttack', 2, 'Reckless Attack', 'Advantage on Strength melee attacks this turn; attacks against you have advantage until your next turn.'),
      f('dangerSense', 2, 'Danger Sense', 'Advantage on Dexterity saves against effects you can see.'),
      f('bearTotem', 3, 'Totem Spirit: Bear', 'Path of the Totem Warrior: while raging you resist every damage type except psychic.', 'totemWarrior'),
      f('aspectOfTheBear', 6, 'Aspect of the Bear', 'Your carrying capacity doubles, and you have advantage on Strength checks to push, pull, lift or break things.', 'totemWarrior'),
      f('spiritWalker', 10, 'Spirit Walker', 'Commune with nature as a ritual.', 'totemWarrior'),
      f('totemicAttunement', 14, 'Totemic Attunement: Bear', 'While you rage, hostile creatures next to you have disadvantage on attacks against anyone but you.', 'totemWarrior'),
      f('frenzy', 3, 'Frenzy', 'Path of the Berserker: a frenzied rage grants a bonus-action melee attack each turn, then exhaustion.', 'berserker'),
      f('extraAttack', 5, 'Extra Attack', 'Attack twice when you take the Attack action.'),
      f('fastMovement', 5, 'Fast Movement', '+10 ft speed without heavy armor.'),
      f('mindlessRage', 6, 'Mindless Rage', 'Cannot be charmed or frightened while raging.', 'berserker'),
      f('feralInstinct', 7, 'Feral Instinct', 'Advantage on initiative.'),
      f('brutalCritical', 9, 'Brutal Critical', 'Roll extra weapon dice on melee critical hits.'),
      f('relentlessRage', 11, 'Relentless Rage', 'Drop to 1 hit point instead of 0 on a Con save while raging.'),
      f('persistentRage', 15, 'Persistent Rage', 'Rage only ends early if you fall unconscious.'),
      f('indomitableMight', 18, 'Indomitable Might', 'Strength checks total at least your Strength score.'),
      f('primalChampion', 20, 'Primal Champion', 'Strength and Constitution increase by 4 (max 24).'),
    ],
    kits: [
      { name: 'Greataxe, handaxes and javelins', items: { greataxe: 1, handaxe: 2, javelin: 4 }, pack: 'explorersPack' },
      { name: 'Greatsword and javelins', items: { greatsword: 1, javelin: 4, spear: 1 }, pack: 'explorersPack' },
    ],
    resources: level => ({
      rage: { name: 'Rage', max: level >= 20 ? 99 : by([1, 2], [3, 3], [6, 4], [12, 5], [17, 6])(level), recharge: 'long' },
    }),
  },
  bard: {
    name: 'Bard', hitDie: 8, primary: ['cha'], saves: ['dex', 'cha'],
    armor: ['light'], weapons: ['simple', 'handCrossbow', 'longsword', 'rapier', 'shortsword'], tools: ['three musical instruments'],
    skills: { count: 3, from: 'any' },
    spellcasting: {
      type: 'full', ability: 'cha', startLevel: 1, ritual: true,
      cantrips: table(by([1, 2], [4, 3], [10, 4])),
      known: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
    },
    features: [
      f('bardicInspiration', 1, 'Bardic Inspiration', 'Bonus action: give an ally an inspiration die (d6, growing with level) to add to a failed roll.'),
      f('jackOfAllTrades', 2, 'Jack of All Trades', 'Add half your proficiency bonus to checks you are not proficient in.'),
      f('songOfRest', 2, 'Song of Rest', 'Allies regain extra hit points during a short rest.'),
      f('expertise', 3, 'Expertise', 'Double proficiency in two skills (two more at 10th level).'),
      f('cuttingWords', 3, 'Cutting Words', 'College of Lore: spend inspiration to reduce an enemy roll.', 'lore'),
      f('valorProficiencies', 3, 'Bonus Proficiencies', 'College of Valor: proficiency with medium armor, shields and martial weapons.', 'valor'),
      f('combatInspiration', 3, 'Combat Inspiration', 'A creature holding your inspiration can add it to a weapon damage roll or to its AC against one attack.', 'valor'),
      f('extraAttack', 6, 'Extra Attack', 'College of Valor: attack twice when you take the Attack action.', 'valor'),
      f('battleMagic', 14, 'Battle Magic', 'After casting a bard spell with your action, make one weapon attack as a bonus action.', 'valor'),
      f('fontOfInspiration', 5, 'Font of Inspiration', 'Bardic Inspiration recharges on a short rest.'),
      f('countercharm', 6, 'Countercharm', 'Allies near you have advantage against fear and charm.'),
      f('magicalSecrets', 10, 'Magical Secrets', 'Learn spells from any class.'),
      f('superiorInspiration', 20, 'Superior Inspiration', 'Regain one inspiration when you roll initiative with none left.'),
    ],
    kits: [
      { name: 'Rapier, leather armor and lute', items: { rapier: 1, leatherArmor: 1, dagger: 1, lute: 1 }, pack: 'entertainersPack' },
      { name: 'Longsword, leather armor and lute', items: { longsword: 1, leatherArmor: 1, dagger: 1, lute: 1 }, pack: 'diplomatsPack' },
    ],
    resources: (level, m) => ({ bardicInspiration: { name: 'Bardic Inspiration', max: Math.max(1, m.cha), recharge: level >= 5 ? 'short' : 'long' } }),
  },
  cleric: {
    name: 'Cleric', hitDie: 8, primary: ['wis'], saves: ['wis', 'cha'],
    armor: ['light', 'medium', 'shield'], weapons: ['simple'], tools: [],
    skills: { count: 2, from: ['history', 'insight', 'medicine', 'persuasion', 'religion'] },
    spellcasting: { type: 'full', ability: 'wis', startLevel: 1, prepared: true, ritual: true, cantrips: table(by([1, 3], [4, 4], [10, 5])) },
    features: [
      f('discipleOfLife', 1, 'Disciple of Life', 'Life Domain: healing spells restore 2 + the spell\'s level extra hit points. Heavy armor proficiency.', 'life'),
      f('lightBonusCantrip', 1, 'Bonus Cantrip', 'Light Domain: you know the Light cantrip.', 'lightDomain'),
      f('wardingFlare', 1, 'Warding Flare', 'Reaction: flare with light to impose disadvantage on an attack against you, Wis modifier times per long rest.', 'lightDomain'),
      f('radianceOfTheDawn', 2, 'Radiance of the Dawn', 'Channel Divinity: dispel magical darkness and sear hostile creatures within 30 ft with radiant light (Con save for half).', 'lightDomain'),
      f('improvedFlare', 6, 'Improved Flare', 'Warding Flare can protect allies within 30 ft.', 'lightDomain'),
      f('potentSpellcasting', 8, 'Potent Spellcasting', 'Add your Wisdom modifier to the damage of cleric cantrips.', 'lightDomain'),
      f('coronaOfLight', 17, 'Corona of Light', 'Emit sunlight that gives enemies disadvantage on saves against fire and radiant spells.', 'lightDomain'),
      f('channelDivinity', 2, 'Channel Divinity', 'Turn Undead or Preserve Life (once per short rest; more uses at 6th and 18th level).'),
      f('destroyUndead', 5, 'Destroy Undead', 'Turned undead of low challenge rating are destroyed.'),
      f('blessedHealer', 6, 'Blessed Healer', 'Healing others with a spell also heals you for 2 + the spell\'s level.', 'life'),
      f('divineStrike', 8, 'Divine Strike', 'Once per turn, weapon hits deal an extra 1d8 radiant (2d8 at 14th).', 'life'),
      f('divineIntervention', 10, 'Divine Intervention', 'Call on your deity for aid.'),
      f('supremeHealing', 17, 'Supreme Healing', 'Healing spell dice are always maximized.', 'life'),
    ],
    kits: [
      { name: 'Mace, scale mail, shield and crossbow', items: { mace: 1, scaleMail: 1, shield: 1, lightCrossbow: 1, crossbowBolts: 20, holySymbol: 1 }, pack: 'priestsPack' },
      { name: 'Mace, chain mail and shield', items: { mace: 1, chainMail: 1, shield: 1, holySymbol: 1 }, pack: 'priestsPack' },
    ],
    resources: (level, m, sub) => ({
      channelDivinity: { name: 'Channel Divinity', max: by([2, 1], [6, 2], [18, 3])(level), recharge: 'short' },
      wardingFlare: { name: 'Warding Flare', max: sub === 'lightDomain' ? Math.max(1, m.wis) : 0, recharge: 'long' },
    }),
  },
  druid: {
    name: 'Druid', hitDie: 8, primary: ['wis'], saves: ['int', 'wis'],
    armor: ['light', 'medium', 'shield'], weapons: ['club', 'dagger', 'dart', 'javelin', 'mace', 'quarterstaff', 'scimitar', 'sickle', 'sling', 'spear'], tools: ['herbalism kit'],
    skills: { count: 2, from: ['arcana', 'animalHandling', 'insight', 'medicine', 'nature', 'perception', 'religion', 'survival'] },
    spellcasting: { type: 'full', ability: 'wis', startLevel: 1, prepared: true, ritual: true, cantrips: table(by([1, 2], [4, 3], [10, 4])) },
    features: [
      f('druidic', 1, 'Druidic', 'You know the secret language of druids.'),
      f('wildShape', 2, 'Wild Shape', 'Turn into a beast you have seen (CR 1/4, 1/2 at 4th, 1 at 8th) twice per short rest.'),
      f('naturalRecovery', 2, 'Natural Recovery', 'Circle of the Land: recover spell slots totaling half your druid level on a short rest, once a day.', 'land'),
      f('landsStride', 6, "Land's Stride", 'Difficult terrain of plants costs no extra movement.', 'land'),
      f('naturesWard', 10, "Nature's Ward", 'Immune to poison and disease.', 'land'),
      f('combatWildShape', 2, 'Combat Wild Shape', 'Circle of the Moon: Wild Shape as a bonus action.', 'moon'),
      f('circleForms', 2, 'Circle Forms', 'Circle of the Moon: Wild Shape into beasts of CR 1, and later of CR up to a third of your druid level.', 'moon'),
      f('primalStrike', 6, 'Primal Strike', 'Your beast-form attacks count as magical.', 'moon'),
      f('elementalWildShape', 10, 'Elemental Wild Shape', 'Spend two uses of Wild Shape to become an elemental.', 'moon'),
      f('thousandForms', 14, 'Thousand Forms', 'Cast Alter Self at will.', 'moon'),
      f('timelessBody', 18, 'Timeless Body', 'You age slowly.'),
      f('archdruid', 20, 'Archdruid', 'Unlimited Wild Shape.'),
    ],
    kits: [
      { name: 'Shield, scimitar and leather armor', items: { shield: 1, scimitar: 1, leatherArmor: 1, druidicFocus: 1 }, pack: 'explorersPack' },
      { name: 'Quarterstaff and leather armor', items: { quarterstaff: 1, sling: 1, leatherArmor: 1, druidicFocus: 1 }, pack: 'explorersPack' },
    ],
    resources: (level, m, sub) => ({
      wildShape: { name: 'Wild Shape', max: level >= 20 ? 99 : level >= 2 ? 2 : 0, recharge: 'short' },
      naturalRecovery: { name: 'Natural Recovery', max: level >= 2 && sub === 'land' ? 1 : 0, recharge: 'long' },
    }),
  },
  fighter: {
    name: 'Fighter', hitDie: 10, primary: ['str', 'dex'], saves: ['str', 'con'],
    armor: ['light', 'medium', 'heavy', 'shield'], weapons: ['simple', 'martial'], tools: [],
    skills: { count: 2, from: ['acrobatics', 'animalHandling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'] },
    fightingStyle: { level: 1, options: ALL_STYLES },
    features: [
      f('fightingStyle', 1, 'Fighting Style', 'Adopt a fighting style (a second one at 10th level).'),
      f('secondWind', 1, 'Second Wind', 'Bonus action: regain 1d10 + fighter level hit points, once per short rest.'),
      f('actionSurge', 2, 'Action Surge', 'Take one additional action on your turn, once per short rest (twice from 17th).'),
      f('improvedCritical', 3, 'Improved Critical', 'Champion: weapon attacks crit on 19-20 (18-20 from 15th).', 'champion'),
      f('combatSuperiority', 3, 'Combat Superiority', 'Battle Master: superiority dice (d8, four per short rest) fuel combat maneuvers; on a hit, spend one to add it to the damage.', 'battleMaster'),
      f('studentOfWar', 3, 'Student of War', "Proficiency with one type of artisan's tools.", 'battleMaster'),
      f('knowYourEnemy', 7, 'Know Your Enemy', 'Study a creature for a minute to learn how it compares to you.', 'battleMaster'),
      f('improvedSuperiority', 10, 'Improved Combat Superiority', 'Superiority dice become d10s (d12s at 18th).', 'battleMaster'),
      f('relentless', 15, 'Relentless', 'Regain a superiority die when you roll initiative with none left.', 'battleMaster'),
      f('extraAttack', 5, 'Extra Attack', 'Attack twice (three times at 11th, four at 20th) when you take the Attack action.'),
      f('remarkableAthlete', 7, 'Remarkable Athlete', 'Add half proficiency to Str, Dex and Con checks you lack proficiency in.', 'champion'),
      f('indomitable', 9, 'Indomitable', 'Reroll a failed saving throw (more uses at 13th and 17th).'),
      f('superiorCritical', 15, 'Superior Critical', 'Weapon attacks crit on 18-20.', 'champion'),
      f('survivor', 18, 'Survivor', 'Regain 5 + Con hit points each turn while below half.', 'champion'),
    ],
    kits: [
      { name: 'Chain mail, longsword and shield', items: { chainMail: 1, longsword: 1, shield: 1, lightCrossbow: 1, crossbowBolts: 20 }, pack: 'dungeoneersPack' },
      { name: 'Leather armor and longbow', items: { leatherArmor: 1, longbow: 1, arrows: 20, shortsword: 2 }, pack: 'explorersPack' },
      { name: 'Chain mail and greatsword', items: { chainMail: 1, greatsword: 1, handaxe: 2 }, pack: 'explorersPack' },
    ],
    resources: (level, m, sub) => ({
      secondWind: { name: 'Second Wind', max: 1, recharge: 'short' },
      actionSurge: { name: 'Action Surge', max: by([2, 1], [17, 2])(level), recharge: 'short' },
      indomitable: { name: 'Indomitable', max: by([9, 1], [13, 2], [17, 3])(level), recharge: 'long' },
      superiorityDice: { name: 'Superiority Dice', max: sub === 'battleMaster' ? by([3, 4], [7, 5], [15, 6])(level) : 0, recharge: 'short' },
    }),
  },
  monk: {
    name: 'Monk', hitDie: 8, primary: ['dex', 'wis'], saves: ['str', 'dex'],
    armor: [], weapons: ['simple', 'shortsword'], tools: [],
    skills: { count: 2, from: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'] },
    features: [
      f('unarmoredDefenseMonk', 1, 'Unarmored Defense', 'Without armor or shield, AC is 10 + Dex + Wis.'),
      f('martialArts', 1, 'Martial Arts', 'Use Dex for unarmed strikes and monk weapons, roll a martial arts die, and strike again as a bonus action.'),
      f('ki', 2, 'Ki', 'Ki points fuel Flurry of Blows, Patient Defense and Step of the Wind.'),
      f('unarmoredMovement', 2, 'Unarmored Movement', '+10 ft speed without armor, rising with level.'),
      f('deflectMissiles', 3, 'Deflect Missiles', 'Reaction: reduce ranged weapon damage by 1d10 + Dex + monk level.'),
      f('openHandTechnique', 3, 'Open Hand Technique', 'Way of the Open Hand: Flurry hits can knock prone, push or deny reactions.', 'openHand'),
      f('shadowArts', 3, 'Shadow Arts', 'Way of Shadow: spend 2 ki to cast Darkness, Darkvision, Pass without Trace or Silence; you know Minor Illusion.', 'shadow'),
      f('shadowStep', 6, 'Shadow Step', 'Bonus action: teleport up to 60 ft between areas of dim light or darkness, with advantage on your next melee attack.', 'shadow'),
      f('cloakOfShadows', 11, 'Cloak of Shadows', 'Become invisible in dim light or darkness.', 'shadow'),
      f('opportunist', 17, 'Opportunist', 'Reaction: attack a creature next to you that was just hit by someone else.', 'shadow'),
      f('extraAttack', 5, 'Extra Attack', 'Attack twice when you take the Attack action.'),
      f('stunningStrike', 5, 'Stunning Strike', 'Spend 1 ki on a melee hit: Con save or stunned until the end of your next turn.'),
      f('kiEmpoweredStrikes', 6, 'Ki-Empowered Strikes', 'Unarmed strikes count as magical.'),
      f('wholenessOfBody', 6, 'Wholeness of Body', 'Action: regain three times your monk level in hit points, once per long rest.', 'openHand'),
      f('evasion', 7, 'Evasion', 'Dexterity saves for half damage deal none on a success and half on a failure.'),
      f('purityOfBody', 10, 'Purity of Body', 'Immune to disease and poison.'),
      f('diamondSoul', 14, 'Diamond Soul', 'Proficiency in all saving throws.'),
    ],
    kits: [
      { name: 'Shortsword and darts', items: { shortsword: 1, dart: 10 }, pack: 'dungeoneersPack' },
      { name: 'Quarterstaff and darts', items: { quarterstaff: 1, dart: 10 }, pack: 'explorersPack' },
    ],
    resources: (level, m, sub) => ({
      ki: { name: 'Ki', max: level >= 2 ? level : 0, recharge: 'short' },
      wholenessOfBody: { name: 'Wholeness of Body', max: level >= 6 && sub === 'openHand' ? 1 : 0, recharge: 'long' },
    }),
  },
  paladin: {
    name: 'Paladin', hitDie: 10, primary: ['str', 'cha'], saves: ['wis', 'cha'],
    armor: ['light', 'medium', 'heavy', 'shield'], weapons: ['simple', 'martial'], tools: [],
    skills: { count: 2, from: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'] },
    spellcasting: { type: 'half', ability: 'cha', startLevel: 2, prepared: true },
    fightingStyle: { level: 2, options: ['defense', 'dueling', 'greatWeaponFighting', 'protection', 'blindFighting', 'interception'] },
    features: [
      f('divineSense', 1, 'Divine Sense', 'Sense celestials, fiends and undead nearby.'),
      f('layOnHands', 1, 'Lay on Hands', 'A pool of five times your paladin level in healing; 5 points cure a poison.'),
      f('fightingStyle', 2, 'Fighting Style', 'Adopt a fighting style.'),
      f('divineSmite', 2, 'Divine Smite', 'Spend a spell slot on a melee hit for 2d8 radiant (+1d8 per slot level, +1d8 vs undead and fiends).'),
      f('sacredWeapon', 3, 'Sacred Weapon', 'Oath of Devotion: Channel Divinity adds your Cha modifier to weapon attacks for a minute.', 'devotion'),
      f('vowOfEnmity', 3, 'Vow of Enmity', 'Oath of Vengeance: Channel Divinity as a bonus action gives you advantage on attacks against one creature within 10 ft for a minute.', 'vengeance'),
      f('abjureEnemy', 3, 'Abjure Enemy', 'Channel Divinity: frighten one creature you can see.', 'vengeance'),
      f('relentlessAvenger', 7, 'Relentless Avenger', 'After an opportunity attack hits, move half your speed without provoking.', 'vengeance'),
      f('soulOfVengeance', 15, 'Soul of Vengeance', 'Reaction: attack the target of your vow when it attacks.', 'vengeance'),
      f('extraAttack', 5, 'Extra Attack', 'Attack twice when you take the Attack action.'),
      f('auraOfProtection', 6, 'Aura of Protection', 'You and allies within 10 ft add your Cha modifier to saving throws.'),
      f('auraOfDevotion', 7, 'Aura of Devotion', 'You and nearby allies cannot be charmed.', 'devotion'),
      f('improvedDivineSmite', 11, 'Improved Divine Smite', 'Melee weapon hits deal an extra 1d8 radiant.'),
      f('cleansingTouch', 14, 'Cleansing Touch', 'End a spell on a willing creature.'),
    ],
    kits: [
      { name: 'Longsword, shield and chain mail', items: { longsword: 1, shield: 1, chainMail: 1, javelin: 5, holySymbol: 1 }, pack: 'priestsPack' },
      { name: 'Greatsword and chain mail', items: { greatsword: 1, chainMail: 1, javelin: 5, holySymbol: 1 }, pack: 'explorersPack' },
    ],
    resources: level => ({
      layOnHands: { name: 'Lay on Hands', max: 5 * level, recharge: 'long' },
      channelDivinity: { name: 'Channel Divinity', max: level >= 3 ? 1 : 0, recharge: 'short' },
    }),
  },
  ranger: {
    name: 'Ranger', hitDie: 10, primary: ['dex', 'wis'], saves: ['str', 'dex'],
    armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'], tools: [],
    skills: { count: 3, from: ['animalHandling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'] },
    spellcasting: { type: 'half', ability: 'wis', startLevel: 2, known: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11] },
    fightingStyle: { level: 2, options: ['archery', 'defense', 'dueling', 'twoWeaponFighting', 'blindFighting', 'thrownWeaponFighting'] },
    features: [
      f('favoredEnemy', 1, 'Favored Enemy', 'Advantage on tracking and recalling lore about chosen foes.'),
      f('naturalExplorer', 1, "Natural Explorer", 'Expert travel and tracking in favored terrain.'),
      f('fightingStyle', 2, 'Fighting Style', 'Adopt a fighting style.'),
      f('colossusSlayer', 3, 'Colossus Slayer', 'Hunter: once per turn, deal an extra 1d8 to a creature below its hit point maximum.', 'hunter'),
      f('rangersCompanion', 3, "Ranger's Companion", 'Beast Master: a beast of CR 1/4 or lower joins you as a companion; the DM brings it into the party.', 'beastMaster'),
      f('exceptionalTraining', 7, 'Exceptional Training', 'Your companion can Dash, Disengage, Dodge or Help as a bonus action, and its attacks count as magical.', 'beastMaster'),
      f('bestialFury', 11, 'Bestial Fury', 'Your companion attacks twice.', 'beastMaster'),
      f('shareSpells', 15, 'Share Spells', 'Spells you cast on yourself can also affect your companion.', 'beastMaster'),
      f('extraAttack', 5, 'Extra Attack', 'Attack twice when you take the Attack action.'),
      f('landsStride', 8, "Land's Stride", 'Difficult terrain of plants costs no extra movement.'),
      f('hideInPlainSight', 10, 'Hide in Plain Sight', 'Camouflage yourself to hide.'),
      f('vanish', 14, 'Vanish', 'Hide as a bonus action.'),
      f('feralSenses', 18, 'Feral Senses', 'Fight unseen creatures without disadvantage.'),
    ],
    kits: [
      { name: 'Scale mail, two shortswords and a longbow', items: { scaleMail: 1, shortsword: 2, longbow: 1, arrows: 20 }, pack: 'explorersPack' },
      { name: 'Leather armor, two shortswords and a longbow', items: { leatherArmor: 1, shortsword: 2, longbow: 1, arrows: 20 }, pack: 'dungeoneersPack' },
    ],
    resources: () => ({}),
  },
  rogue: {
    name: 'Rogue', hitDie: 8, primary: ['dex'], saves: ['dex', 'int'],
    armor: ['light'], weapons: ['simple', 'handCrossbow', 'longsword', 'rapier', 'shortsword'], tools: ["thieves' tools"],
    skills: { count: 4, from: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleightOfHand', 'stealth'] },
    features: [
      f('expertise', 1, 'Expertise', 'Double proficiency in two skills or thieves\' tools (two more at 6th).'),
      f('sneakAttack', 1, 'Sneak Attack', 'Once per turn, extra damage with a finesse or ranged weapon when you have advantage or an ally is adjacent.'),
      f('cunningAction', 2, 'Cunning Action', 'Dash, Disengage or Hide as a bonus action.'),
      f('fastHands', 3, 'Fast Hands', 'Thief: use objects as a bonus action.', 'thief'),
      f('assassinate', 3, 'Assassinate', 'Assassin: advantage on attacks against creatures that have not acted yet this combat; hits against surprised creatures are critical.', 'assassin'),
      f('assassinProficiencies', 3, 'Bonus Proficiencies', "Proficiency with the disguise kit and the poisoner's kit.", 'assassin'),
      f('infiltrationExpertise', 9, 'Infiltration Expertise', 'Build a false identity over a week.', 'assassin'),
      f('impostor', 13, 'Impostor', 'Mimic the speech, writing and behaviour of another person.', 'assassin'),
      f('deathStrike', 17, 'Death Strike', 'A surprised creature you hit must make a Con save or take double damage.', 'assassin'),
      f('uncannyDodge', 5, 'Uncanny Dodge', 'Reaction: halve the damage of an attack you can see.'),
      f('evasion', 7, 'Evasion', 'Dexterity saves for half damage deal none on a success and half on a failure.'),
      f('reliableTalent', 11, 'Reliable Talent', 'Proficient checks treat a d20 roll of 9 or lower as 10.'),
      f('slipperyMind', 15, 'Slippery Mind', 'Proficiency in Wisdom saves.'),
      f('elusive', 18, 'Elusive', 'No attack roll has advantage against you while you are not incapacitated.'),
    ],
    kits: [
      { name: 'Rapier, shortbow and leather armor', items: { rapier: 1, shortbow: 1, arrows: 20, leatherArmor: 1, dagger: 2, thievesTools: 1 }, pack: 'burglarsPack' },
      { name: 'Shortsword, shortbow and leather armor', items: { shortsword: 2, shortbow: 1, arrows: 20, leatherArmor: 1, thievesTools: 1 }, pack: 'dungeoneersPack' },
    ],
    resources: () => ({}),
  },
  sorcerer: {
    name: 'Sorcerer', hitDie: 6, primary: ['cha'], saves: ['con', 'cha'],
    armor: [], weapons: ['dagger', 'dart', 'sling', 'quarterstaff', 'lightCrossbow'], tools: [],
    skills: { count: 2, from: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'] },
    spellcasting: {
      type: 'full', ability: 'cha', startLevel: 1,
      cantrips: table(by([1, 4], [4, 5], [10, 6])),
      known: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
    },
    features: [
      f('draconicResilience', 1, 'Draconic Resilience', 'Draconic Bloodline: +1 hit point per sorcerer level, and AC 13 + Dex without armor.', 'draconic'),
      f('wildMagicSurge', 1, 'Wild Magic Surge', 'Wild Magic: casting a leveled spell may unleash a random magical effect, at the DM\'s call.', 'wildMagic'),
      f('tidesOfChaos', 1, 'Tides of Chaos', 'Gain advantage on your next attack roll, once per long rest.', 'wildMagic'),
      f('bendLuck', 6, 'Bend Luck', 'Reaction: spend 2 sorcery points to add or subtract 1d4 from another creature\'s roll.', 'wildMagic'),
      f('controlledChaos', 14, 'Controlled Chaos', 'Roll twice on the surge table and pick.', 'wildMagic'),
      f('spellBombardment', 18, 'Spell Bombardment', 'Roll one maximum damage die again and add it.', 'wildMagic'),
      f('fontOfMagic', 2, 'Font of Magic', 'Sorcery points equal to your level; convert them to and from spell slots.'),
      f('metamagic', 3, 'Metamagic', 'Twist spells with Metamagic options (more at 10th and 17th).'),
      f('elementalAffinity', 6, 'Elemental Affinity', 'Add Cha to one damage roll of your ancestry\'s type.', 'draconic'),
      f('sorcerousRestoration', 20, 'Sorcerous Restoration', 'Regain 4 sorcery points on a short rest.'),
    ],
    kits: [
      { name: 'Light crossbow and daggers', items: { lightCrossbow: 1, crossbowBolts: 20, componentPouch: 1, dagger: 2 }, pack: 'dungeoneersPack' },
      { name: 'Quarterstaff and daggers', items: { quarterstaff: 1, arcaneFocus: 1, dagger: 2 }, pack: 'explorersPack' },
    ],
    resources: (level, m, sub) => ({
      sorceryPoints: { name: 'Sorcery Points', max: level >= 2 ? level : 0, recharge: 'long' },
      tidesOfChaos: { name: 'Tides of Chaos', max: sub === 'wildMagic' ? 1 : 0, recharge: 'long' },
    }),
  },
  warlock: {
    name: 'Warlock', hitDie: 8, primary: ['cha'], saves: ['wis', 'cha'],
    armor: ['light'], weapons: ['simple'], tools: [],
    skills: { count: 2, from: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'] },
    spellcasting: {
      type: 'pact', ability: 'cha', startLevel: 1,
      cantrips: table(by([1, 2], [4, 3], [10, 4])),
      known: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
    },
    invocations: [0, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8],
    features: [
      f('pactMagic', 1, 'Pact Magic', 'Few spell slots, always of your highest level, regained on a short rest.'),
      f('darkOnesBlessing', 1, "Dark One's Blessing", 'The Fiend: gain temporary hit points when you drop a hostile creature to 0.', 'fiend'),
      f('awakenedMind', 1, 'Awakened Mind', 'The Great Old One: speak telepathically to any creature within 30 ft that knows a language.', 'greatOldOne'),
      f('entropicWard', 6, 'Entropic Ward', 'Reaction: impose disadvantage on an attack against you; if it misses, gain advantage on your next attack against the attacker.', 'greatOldOne'),
      f('thoughtShield', 10, 'Thought Shield', 'Your thoughts cannot be read; you resist psychic damage.', 'greatOldOne'),
      f('createThrall', 14, 'Create Thrall', 'Charm an incapacitated humanoid indefinitely.', 'greatOldOne'),
      f('eldritchInvocations', 2, 'Eldritch Invocations', 'Occult fragments of knowledge that grant lasting abilities.'),
      f('pactBoon', 3, 'Pact Boon', 'Pact of the Blade, Chain or Tome.'),
      f('darkOnesOwnLuck', 6, "Dark One's Own Luck", 'Add a d10 to a check or save once per short rest.', 'fiend'),
      f('mysticArcanum', 11, 'Mystic Arcanum', 'One spell each of 6th to 9th level once per long rest.'),
      f('eldritchMaster', 20, 'Eldritch Master', 'Regain all pact slots once per long rest.'),
    ],
    kits: [
      { name: 'Light crossbow and leather armor', items: { lightCrossbow: 1, crossbowBolts: 20, componentPouch: 1, leatherArmor: 1, dagger: 2 }, pack: 'scholarsPack' },
      { name: 'Quarterstaff and leather armor', items: { quarterstaff: 1, arcaneFocus: 1, leatherArmor: 1, dagger: 2 }, pack: 'dungeoneersPack' },
    ],
    resources: () => ({}),
  },
  wizard: {
    name: 'Wizard', hitDie: 6, primary: ['int'], saves: ['int', 'wis'],
    armor: [], weapons: ['dagger', 'dart', 'sling', 'quarterstaff', 'lightCrossbow'], tools: [],
    skills: { count: 2, from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'] },
    spellcasting: { type: 'full', ability: 'int', startLevel: 1, spellbook: true, prepared: true, ritual: true, cantrips: table(by([1, 3], [4, 4], [10, 5])) },
    features: [
      f('arcaneRecovery', 1, 'Arcane Recovery', 'Once a day on a short rest, recover spell slots totaling half your wizard level.'),
      f('sculptSpells', 2, 'Sculpt Spells', 'School of Evocation: allies in your evocation spells automatically succeed on their saves and take no damage.', 'evocation'),
      f('arcaneWard', 2, 'Arcane Ward', 'School of Abjuration: casting an abjuration spell of 1st level or higher weaves a ward that absorbs damage (twice your wizard level + Int hit points).', 'abjuration'),
      f('projectedWard', 6, 'Projected Ward', 'Reaction: your ward absorbs damage for an ally within 30 ft.', 'abjuration'),
      f('improvedAbjuration', 10, 'Improved Abjuration', 'Add proficiency to ability checks made as part of abjuration spells.', 'abjuration'),
      f('spellResistance', 14, 'Spell Resistance', 'Advantage on saves against spells and resistance to spell damage.', 'abjuration'),
      f('potentCantrip', 6, 'Potent Cantrip', 'Creatures that succeed on a save against your cantrip still take half damage.', 'evocation'),
      f('empoweredEvocation', 10, 'Empowered Evocation', 'Add Int to the damage of wizard evocation spells.', 'evocation'),
      f('overchannel', 14, 'Overchannel', 'Deal maximum damage with a low-level spell.', 'evocation'),
      f('spellMastery', 18, 'Spell Mastery', 'Cast a 1st and 2nd level spell at will.'),
      f('signatureSpells', 20, 'Signature Spells', 'Two 3rd-level spells are always prepared.'),
    ],
    kits: [
      { name: 'Quarterstaff and spellbook', items: { quarterstaff: 1, componentPouch: 1, spellbook: 1 }, pack: 'scholarsPack' },
      { name: 'Dagger and spellbook', items: { dagger: 1, arcaneFocus: 1, spellbook: 1 }, pack: 'explorersPack' },
    ],
    resources: () => ({ arcaneRecovery: { name: 'Arcane Recovery', max: 1, recharge: 'long' } }),
  },
});

// the subclasses each class can take: the SRD one tavern always had first, then
// one from the Player's Handbook (descriptions paraphrased). Features only one
// subclass has carry its key (f(..., sub)); its spells are domainSpells (always
// prepared) or expandedSpells (added to the class list)
const SUBCLASSES = {
  artificer: { level: 3, list: {} },
  barbarian: { level: 3, list: {
    berserker: { name: 'Path of the Berserker', srd: true, desc: 'Rage becomes a frenzy of extra attacks, at the cost of exhaustion.' },
    totemWarrior: { name: 'Path of the Totem Warrior', desc: 'A bear spirit guides you: while raging you shrug off nearly every kind of harm.' },
  } },
  bard: { level: 3, list: {
    lore: { name: 'College of Lore', srd: true, desc: 'Collectors of knowledge whose words cut down a foe\'s best efforts.' },
    valor: { name: 'College of Valor', desc: 'Skalds who fight beside the heroes they sing of: armor, martial weapons and a second attack.' },
  } },
  cleric: { level: 1, list: {
    life: { name: 'Life Domain', srd: true, desc: 'Healers in heavy armor whose spells mend more.', armor: ['heavy'], domainSpells: { 1: ['bless', 'cureWounds'], 3: ['lesserRestoration', 'spiritualWeapon'], 5: ['beaconOfHope', 'revivify'], 7: ['deathWard', 'guardianOfFaith'], 9: ['massCureWounds', 'raiseDead'] } },
    lightDomain: { name: 'Light Domain', desc: 'Servants of the sun who burn away darkness with fire and radiance.', cantrips: ['light'], domainSpells: { 1: ['burningHands', 'faerieFire'], 3: ['flamingSphere', 'scorchingRay'], 5: ['daylight', 'fireball'], 7: ['guardianOfFaith'], 9: ['flameStrike'] } },
  } },
  druid: { level: 2, list: {
    land: { name: 'Circle of the Land', srd: true, desc: 'Mystics who draw spell slots back from the land itself.' },
    moon: { name: 'Circle of the Moon', desc: 'Shapeshifters who take far stronger beast forms, and take them in an instant.' },
  } },
  fighter: { level: 3, list: {
    champion: { name: 'Champion', srd: true, desc: 'Raw athletic power: critical hits come easier and you keep getting up.' },
    battleMaster: { name: 'Battle Master', desc: 'A tactician who spends superiority dice on maneuvers that hit harder.' },
  } },
  monk: { level: 3, list: {
    openHand: { name: 'Way of the Open Hand', srd: true, desc: 'Masters of unarmed combat who knock foes down and heal their own wounds.' },
    shadow: { name: 'Way of Shadow', desc: 'Ninja who bend darkness and silence with ki and step between shadows.', cantrips: ['minorIllusion'] },
  } },
  paladin: { level: 3, list: {
    devotion: { name: 'Oath of Devotion', srd: true, desc: 'The classic knight of honesty, courage and mercy.', domainSpells: { 3: ['protectionFromEvilAndGood', 'sanctuary'], 5: ['lesserRestoration', 'zoneOfTruth'], 9: ['beaconOfHope', 'dispelMagic'], 13: ['freedomOfMovement', 'guardianOfFaith'], 17: ['commune', 'flameStrike'] } },
    vengeance: { name: 'Oath of Vengeance', desc: 'A grim avenger who swears to bring down one foe at any cost.', domainSpells: { 3: ['bane', 'huntersMark'], 5: ['holdPerson', 'mistyStep'], 9: ['haste', 'protectionFromEnergy'], 13: ['banishment', 'dimensionDoor'], 17: ['holdMonster'] } },
  } },
  ranger: { level: 3, list: {
    hunter: { name: 'Hunter', srd: true, desc: 'A slayer of monsters who finishes wounded prey.' },
    beastMaster: { name: 'Beast Master', desc: 'A ranger bonded to an animal companion that fights at their side.' },
  } },
  rogue: { level: 3, list: {
    thief: { name: 'Thief', srd: true, desc: 'Burglars and treasure hunters with quick hands.' },
    assassin: { name: 'Assassin', desc: 'Killers who strike first and strike hardest against an unready foe.' },
  } },
  sorcerer: { level: 1, list: {
    draconic: { name: 'Draconic Bloodline', srd: true, desc: 'Dragon blood toughens your hide and fuels your element.' },
    wildMagic: { name: 'Wild Magic', desc: 'Chaotic magic that surges unpredictably and bends luck.' },
  } },
  warlock: { level: 1, list: {
    fiend: { name: 'The Fiend', srd: true, desc: 'A pact with a devil or demon: fire spells and vitality from kills.', expandedSpells: { 1: ['burningHands', 'command'], 3: ['blindnessDeafness', 'scorchingRay'], 5: ['fireball', 'stinkingCloud'], 7: ['fireShield', 'wallOfFire'], 9: ['flameStrike', 'hallow'] } },
    greatOldOne: { name: 'The Great Old One', desc: 'A pact with an alien mind: telepathy and spells that unravel others\' thoughts.', expandedSpells: { 1: ['dissonantWhispers', 'hideousLaughter'] } },
  } },
  wizard: { level: 2, list: {
    evocation: { name: 'School of Evocation', srd: true, desc: 'Blasters who shape their spells around allies.' },
    abjuration: { name: 'School of Abjuration', desc: 'Protectors who wrap themselves in an arcane ward.' },
  } },
};
for (const [cls, subs] of Object.entries(MORE_SUBCLASSES)) {
  for (const [key, { features = [], ...d }] of Object.entries(subs)) {
    SUBCLASSES[cls].list[key] = d;
    for (const [fk, fl, fn, fd] of features) CLASSES[cls].features.push(f(fk, fl, fn, fd, key));
  }
  CLASSES[cls].features.sort((a, b) => a.level - b.level);
}
for (const [k, { list }] of Object.entries(SUBCLASSES)) for (const [key, d] of Object.entries(list)) d.source ??= BASE_SOURCES[key] ?? 'PHB';
for (const [k, { level, list }] of Object.entries(SUBCLASSES)) {
  const c = CLASSES[k];
  c.subclassLevel = level;
  c.subclasses = dict(Object.fromEntries(Object.entries(list).map(([key, d]) => [key, { level, ...d }])));
  c.defaultSubclass = Object.keys(list)[0];
  // the SRD subclass, for code that knew only one
  c.subclass = c.subclasses[c.defaultSubclass];
  // subclass pools join the class's own once the subclass is taken
  const base = c.resources;
  c.resources = (lvl, m, sub) => ({ ...base(lvl, m, sub), ...(lvl >= level ? c.subclasses[sub]?.resources?.(lvl, m) ?? {} : {}) });
}

// a subclass key from a key or a stored name ('Champion'), or null
export function subclassKey(cls, ref) {
  const subs = CLASSES[cls]?.subclasses;
  if (!subs || !ref) return null;
  if (Object.hasOwn(subs, ref)) return ref;
  return Object.keys(subs).find(k => subs[k].name.toLowerCase() === String(ref).toLowerCase()) ?? null;
}

export const BACKGROUNDS = dict({
  acolyte: { name: 'Acolyte', skills: ['insight', 'religion'], tools: [], languages: 2, gold: 15, items: { holySymbol: 1, prayerBook: 1, commonClothes: 1 }, feature: 'Shelter of the Faithful: your temple and faith provide food, lodging and help.' },
  charlatan: { name: 'Charlatan', skills: ['deception', 'sleightOfHand'], tools: ['disguise kit', 'forgery kit'], languages: 0, gold: 15, items: { fineClothes: 1, disguiseKit: 1 }, feature: 'False Identity: a second identity with documents and contacts.' },
  criminal: { name: 'Criminal', skills: ['deception', 'stealth'], tools: ["thieves' tools", 'gaming set'], languages: 0, gold: 15, items: { crowbar: 1, commonClothes: 1 }, feature: 'Criminal Contact: a reliable link to a network of criminals.' },
  entertainer: { name: 'Entertainer', skills: ['acrobatics', 'performance'], tools: ['disguise kit', 'musical instrument'], languages: 0, gold: 15, items: { costumeClothes: 1 }, feature: 'By Popular Demand: you find a place to perform and lodging in return.' },
  folkHero: { name: 'Folk Hero', skills: ['animalHandling', 'survival'], tools: ["artisan's tools", 'vehicles (land)'], languages: 0, gold: 10, items: { shovel: 1, ironPot: 1, commonClothes: 1 }, feature: 'Rustic Hospitality: common folk shelter and hide you.' },
  guildArtisan: { name: 'Guild Artisan', skills: ['insight', 'persuasion'], tools: ["artisan's tools"], languages: 1, gold: 15, items: { travelersClothes: 1 }, feature: 'Guild Membership: your guild offers lodging, help and political pull.' },
  hermit: { name: 'Hermit', skills: ['medicine', 'religion'], tools: ['herbalism kit'], languages: 1, gold: 5, items: { herbalismKit: 1, blanket: 1, commonClothes: 1 }, feature: 'Discovery: your seclusion revealed a unique and powerful secret.' },
  noble: { name: 'Noble', skills: ['history', 'persuasion'], tools: ['gaming set'], languages: 1, gold: 25, items: { fineClothes: 1, signetRing: 1 }, feature: 'Position of Privilege: people of high birth receive you, commoners defer.' },
  outlander: { name: 'Outlander', skills: ['athletics', 'survival'], tools: ['musical instrument'], languages: 1, gold: 10, items: { huntingTrap: 1, travelersClothes: 1 }, feature: 'Wanderer: you recall maps and find food and water for yourself and five others.' },
  sage: { name: 'Sage', skills: ['arcana', 'history'], tools: [], languages: 2, gold: 10, items: { ink: 1, inkPen: 1, commonClothes: 1 }, feature: 'Researcher: you know where to find information you lack.' },
  sailor: { name: 'Sailor', skills: ['athletics', 'perception'], tools: ["navigator's tools", 'vehicles (water)'], languages: 0, gold: 10, items: { ropeSilk: 1, commonClothes: 1 }, feature: "Ship's Passage: you can secure free passage on a sailing ship." },
  soldier: { name: 'Soldier', skills: ['athletics', 'intimidation'], tools: ['gaming set', 'vehicles (land)'], languages: 0, gold: 10, items: { commonClothes: 1 }, feature: 'Military Rank: soldiers loyal to your former organization recognize your authority.' },
  urchin: { name: 'Urchin', skills: ['sleightOfHand', 'stealth'], tools: ['disguise kit', "thieves' tools"], languages: 0, gold: 10, items: { commonClothes: 1 }, feature: 'City Secrets: you move through a city twice as fast as others.' },
});

// multiclassing prerequisites and the proficiencies a new class grants
export const MULTICLASS = dict({
  artificer: { req: { int: 13 }, armor: ['light', 'medium', 'shield'], tools: ["thieves' tools", "tinker's tools"] },
  barbarian: { req: { str: 13 }, armor: ['shield'], weapons: ['simple', 'martial'] },
  bard: { req: { cha: 13 }, armor: ['light'], skills: 1, tools: ['one musical instrument'] },
  cleric: { req: { wis: 13 }, armor: ['light', 'medium', 'shield'] },
  druid: { req: { wis: 13 }, armor: ['light', 'medium', 'shield'] },
  fighter: { reqAny: { str: 13, dex: 13 }, armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'] },
  monk: { req: { dex: 13, wis: 13 }, weapons: ['simple', 'shortsword'] },
  paladin: { req: { str: 13, cha: 13 }, armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'] },
  ranger: { req: { dex: 13, wis: 13 }, armor: ['light', 'medium', 'shield'], weapons: ['simple', 'martial'], skills: 1 },
  rogue: { req: { dex: 13 }, armor: ['light'], skills: 1, tools: ["thieves' tools"] },
  sorcerer: { req: { cha: 13 } },
  warlock: { req: { cha: 13 }, armor: ['light'], weapons: ['simple'] },
  wizard: { req: { int: 13 } },
});
