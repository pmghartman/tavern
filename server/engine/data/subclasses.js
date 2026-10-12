// subclasses beyond the two each class started with: the rest of the Player's
// Handbook, Xanathar's Guide to Everything and Tasha's Cauldron of Everything.
// Descriptions are paraphrased summaries. classes.js merges these in.
//
// Each entry: name, source, desc, features ([key, level, name, desc]) and, where
// the engine applies them:
//   armor / weapons        proficiencies gained at the subclass level
//   cantrips               cantrips known for free
//   domainSpells           always prepared, by class level
//   expandedSpells         added to the class spell list
//   extraAttack            the level a second attack arrives
//   strike                 a once-per-turn rider on weapon hits (Divine Strike and kin)
//   potentSpellcasting     the level cantrips add the casting modifier to damage
//   resist                 [{ level, types, raging }]
//   heavyAcBonus           { level, bonus } while in heavy armor
//   resources(level, m)    limited-use pools
//   spellcasting           a third-caster subclass (Eldritch Knight, Arcane Trickster)

const half = l => Math.floor(l / 2);
const pb = l => Math.ceil(l / 4) + 1;
const ALL_DAMAGE = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];

// third casters: wizard spells, mostly from two schools, slots at a third of the level
const third = schools => ({
  type: 'third', ability: 'int', startLevel: 3, list: 'wizard', schools,
  cantrips: Array.from({ length: 20 }, (_, i) => (i + 1 < 3 ? 0 : i + 1 < 10 ? 2 : 3)),
  known: [0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13],
});

export const MORE_SUBCLASSES = {
  artificer: {
    alchemist: {
      name: 'Alchemist', source: 'TCE', desc: 'Brewers of elixirs who heal and burn with alchemy.',
      domainSpells: { 3: ['healingWord', 'rayOfSickness'], 5: ['flamingSphere', 'acidArrow'], 9: ['gaseousForm', 'massHealingWord'], 13: ['blight', 'deathWard'], 17: ['cloudkill', 'raiseDead'] },
      features: [
        ['alchemistTools', 3, "Tool Proficiency", "Alchemist's supplies."],
        ['experimentalElixir', 3, 'Experimental Elixir', 'After a long rest, brew a random elixir (healing, swiftness, resilience, boldness, flight or transformation); make more with spell slots.'],
        ['alchemicalSavant', 5, 'Alchemical Savant', 'Add your Intelligence modifier to one healing roll or one acid, fire, necrotic or poison damage roll of your spells.'],
        ['restorativeReagents', 9, 'Restorative Reagents', 'Elixirs grant 2d6 + Intelligence temporary hit points, and you cast Lesser Restoration without a slot, Intelligence modifier times per long rest.'],
        ['chemicalMastery', 15, 'Chemical Mastery', 'Resistance to acid and poison, immunity to poisoning, and free Greater Restoration and Heal once per long rest.'],
      ],
      resist: [{ level: 15, types: ['acid', 'poison'] }],
    },
    armorer: {
      name: 'Armorer', source: 'TCE', desc: 'Inventors who turn their armor into a magical weapon.',
      armor: ['heavy'], extraAttack: 5,
      domainSpells: { 3: ['magicMissile', 'thunderwave'], 5: ['mirrorImage', 'shatter'], 9: ['hypnoticPattern', 'lightningBolt'], 13: ['fireShield', 'greaterInvisibility'], 17: ['passwall', 'wallOfForce'] },
      features: [
        ['armorerTools', 3, 'Tools of the Trade', "Heavy armor and smith's tools."],
        ['arcaneArmor', 3, 'Arcane Armor', 'Turn armor into a spellcasting focus that covers your body, needs no Strength and cannot be removed against your will.'],
        ['armorModel', 3, 'Armor Model', 'Guardian (thunder gauntlets 1d8 that taunt, and a defensive field of temporary hit points) or Infiltrator (lightning launcher 1d6 +1d6 once a turn, +5 speed, advantage on Stealth).'],
        ['extraAttack', 5, 'Extra Attack', 'Attack twice when you take the Attack action.'],
        ['armorModifications', 9, 'Armor Modifications', 'Your armor counts as separate items for infusions, and you can infuse two more items into it.'],
        ['perfectedArmor', 15, 'Perfected Armor', 'Guardian gauntlets pull foes and strike; Infiltrator lightning outlines targets and deals extra damage.'],
      ],
    },
    artillerist: {
      name: 'Artillerist', source: 'TCE', desc: 'Specialists in explosive spells and magical cannons.',
      domainSpells: { 3: ['shield', 'thunderwave'], 5: ['scorchingRay', 'shatter'], 9: ['fireball', 'windWall'], 13: ['iceStorm', 'wallOfFire'], 17: ['coneOfCold', 'wallOfForce'] },
      features: [
        ['artilleristTools', 3, 'Tool Proficiency', "Woodcarver's tools."],
        ['eldritchCannon', 3, 'Eldritch Cannon', 'Create a magical cannon (flamethrower 2d8 fire cone, force ballista 2d8 force, or protector temporary hit points) for an hour, once per long rest or with a slot.'],
        ['arcaneFirearm', 5, 'Arcane Firearm', 'Carve a wand, staff or rod into a firearm; your artificer spells through it add 1d8 to one damage roll.'],
        ['explosiveCannon', 9, 'Explosive Cannon', 'Your cannon\'s damage rises by 1d8, and you can detonate it for 3d8 force damage.'],
        ['fortifiedPosition', 15, 'Fortified Position', 'Two cannons at once, and allies near them have half cover.'],
      ],
      resources: () => ({ eldritchCannon: { name: 'Eldritch Cannon', max: 1, recharge: 'long' } }),
    },
    battleSmith: {
      name: 'Battle Smith', source: 'TCE', desc: 'Warrior-engineers who fight beside a steel defender.',
      weapons: ['martial'], extraAttack: 5,
      domainSpells: { 3: ['heroism', 'shield'], 5: ['brandingSmite', 'wardingBond'], 9: ['auraOfVitality', 'conjureBarrage'], 13: ['auraOfPurity', 'fireShield'], 17: ['banishingSmite', 'massCureWounds'] },
      features: [
        ['battleReady', 3, 'Battle Ready', "Martial weapons and smith's tools; use Intelligence for attack and damage rolls with magic weapons."],
        ['steelDefender', 3, 'Steel Defender', 'A loyal construct companion fights beside you, deflecting attacks against nearby allies.'],
        ['extraAttack', 5, 'Extra Attack', 'Attack twice when you take the Attack action.'],
        ['arcaneJolt', 9, 'Arcane Jolt', 'Once per turn, when you or your defender hit, deal an extra 2d6 force damage or heal a creature 2d6, Intelligence modifier times per long rest.'],
        ['improvedDefender', 15, 'Improved Defender', 'Arcane Jolt deals 4d6, and your defender gains +2 AC and retaliates with force.'],
      ],
      resources: (l, m) => ({ arcaneJolt: { name: 'Arcane Jolt', max: l >= 9 ? Math.max(1, m.int) : 0, recharge: 'long' } }),
    },
  },

  barbarian: {
    ancestralGuardian: {
      name: 'Path of the Ancestral Guardian', source: 'XGtE', desc: 'Ancestor spirits shield your allies and punish the foes you strike.',
      features: [
        ['ancestralProtectors', 3, 'Ancestral Protectors', 'While raging, the first creature you hit on your turn has disadvantage on attacks against anyone but you, and others resist its damage, until your next turn.'],
        ['spiritShield', 6, 'Spirit Shield', 'Reaction while raging: reduce the damage an ally within 30 feet takes by 2d6 (3d6 at 10th, 4d6 at 14th).'],
        ['consultTheSpirits', 10, 'Consult the Spirits', 'Cast Augury or Clairvoyance without a slot, once per short rest.'],
        ['vengefulAncestors', 14, 'Vengeful Ancestors', 'Damage your Spirit Shield prevents is dealt as force damage to the attacker.'],
      ],
      resources: l => ({ consultTheSpirits: { name: 'Consult the Spirits', max: l >= 10 ? 1 : 0, recharge: 'short' } }),
    },
    stormHerald: {
      name: 'Path of the Storm Herald', source: 'XGtE', desc: 'Your rage becomes a storm of desert heat, sea lightning or tundra cold around you.',
      features: [
        ['stormAura', 3, 'Storm Aura', 'While raging, a 10-foot aura of your chosen environment: desert burns nearby foes, sea strikes one creature with lightning, tundra grants allies temporary hit points.'],
        ['stormSoul', 6, 'Storm Soul', 'Resistance to fire (desert), lightning (sea) or cold (tundra), with a minor environmental gift.'],
        ['shieldingStorm', 10, 'Shielding Storm', 'Allies in your aura share your Storm Soul resistance.'],
        ['ragingStorm', 14, 'Raging Storm', 'Your aura lashes back: burning attackers, knocking foes prone or freezing them in place.'],
      ],
    },
    zealot: {
      name: 'Path of the Zealot', source: 'XGtE', desc: 'A warrior of the gods whose rage burns with divine fury and who refuses to die.',
      features: [
        ['divineFury', 3, 'Divine Fury', 'While raging, the first weapon hit each turn deals an extra 1d6 + half your barbarian level radiant or necrotic damage.'],
        ['warriorOfTheGods', 3, 'Warrior of the Gods', 'Spells that return you to life need no material components.'],
        ['fanaticalFocus', 6, 'Fanatical Focus', 'Once per rage, reroll a failed saving throw.'],
        ['zealousPresence', 10, 'Zealous Presence', 'Bonus action: up to ten allies gain advantage on attacks and saves until your next turn, once per long rest.'],
        ['rageBeyondDeath', 14, 'Rage beyond Death', 'While raging, dropping to 0 hit points does not knock you out; you die only if the rage ends there.'],
      ],
      strike: { level: 3, raging: true, dice: l => `1d6+${half(l)}`, type: 'radiant', label: 'Divine Fury' },
      resources: l => ({ zealousPresence: { name: 'Zealous Presence', max: l >= 10 ? 1 : 0, recharge: 'long' } }),
    },
    beast: {
      name: 'Path of the Beast', source: 'TCE', desc: 'A bestial spirit gives you fangs, claws or a tail when you rage.',
      features: [
        ['formOfTheBeast', 3, 'Form of the Beast', 'While raging, grow a bite (1d8, heals you when below half), claws (1d6, an extra claw attack) or a tail (1d8 reach, reaction to add 1d8 to AC).'],
        ['bestialSoul', 6, 'Bestial Soul', 'Your natural weapons are magical, and each rest you gain a swim speed, a climb speed or a mighty jump.'],
        ['infectiousFury', 10, 'Infectious Fury', 'Proficiency bonus times per long rest, a natural weapon hit forces a Wisdom save: the target attacks another creature or takes 2d12 psychic damage.'],
        ['callTheHunt', 14, 'Call the Hunt', 'Proficiency bonus times per long rest, when you rage, allies add 1d6 to one damage roll each turn and you gain 5 temporary hit points per ally.'],
      ],
      resources: l => ({
        infectiousFury: { name: 'Infectious Fury', max: l >= 10 ? pb(l) : 0, recharge: 'long' },
        callTheHunt: { name: 'Call the Hunt', max: l >= 14 ? pb(l) : 0, recharge: 'long' },
      }),
    },
    wildMagic: {
      name: 'Path of Wild Magic', source: 'TCE', desc: 'Raw magic surges out of you when you rage.',
      features: [
        ['magicAwareness', 3, 'Magic Awareness', 'Proficiency bonus times per long rest, sense spells and magic items within 60 feet.'],
        ['wildSurgeBarbarian', 3, 'Wild Surge', 'Entering a rage rolls on the wild magic table: shadowy tendrils, teleports, explosive spirits, protective lights and more.'],
        ['bolsteringMagic', 6, 'Bolstering Magic', 'Proficiency bonus times per long rest, give a creature 1d3 to add to attacks and checks, or restore a low spell slot.'],
        ['unstableBacklash', 10, 'Unstable Backlash', 'When you take damage or fail a save while raging, you can replace your current surge with a new roll.'],
        ['controlledSurge', 14, 'Controlled Surge', 'Roll twice on the surge table and choose either result.'],
      ],
      resources: l => ({
        magicAwareness: { name: 'Magic Awareness', max: pb(l), recharge: 'long' },
        bolsteringMagic: { name: 'Bolstering Magic', max: l >= 6 ? pb(l) : 0, recharge: 'long' },
      }),
    },
  },

  bard: {
    glamour: {
      name: 'College of Glamour', source: 'XGtE', desc: 'Fey-touched performers whose presence grants courage and compels obedience.',
      features: [
        ['mantleOfInspiration', 3, 'Mantle of Inspiration', 'Bonus action: spend an inspiration die to give up to your Charisma modifier of allies temporary hit points (5, rising with level); each can move without provoking.'],
        ['enthrallingPerformance', 3, 'Enthralling Performance', 'After a minute-long performance, charm up to your Charisma modifier of humanoids for an hour, once per short rest.'],
        ['mantleOfMajesty', 6, 'Mantle of Majesty', 'For a minute, cast Command as a bonus action each turn without a slot, once per long rest.'],
        ['unbreakableMajesty', 14, 'Unbreakable Majesty', 'Assume a majestic presence: a creature attacking you must make a Charisma save or pick another target, once per short rest.'],
      ],
      resources: l => ({
        enthrallingPerformance: { name: 'Enthralling Performance', max: 1, recharge: 'short' },
        mantleOfMajesty: { name: 'Mantle of Majesty', max: l >= 6 ? 1 : 0, recharge: 'long' },
        unbreakableMajesty: { name: 'Unbreakable Majesty', max: l >= 14 ? 1 : 0, recharge: 'short' },
      }),
    },
    swords: {
      name: 'College of Swords', source: 'XGtE', desc: 'Blade-dancing entertainers who weave inspiration into flourishing strikes.',
      armor: ['medium'], weapons: ['scimitar'], extraAttack: 6,
      features: [
        ['swordsProficiencies', 3, 'Bonus Proficiencies', 'Proficiency with medium armor and the scimitar; a sword or other melee weapon can be your spellcasting focus.'],
        ['swordsFightingStyle', 3, 'Fighting Style', 'You adopt Dueling or Two-Weapon Fighting.'],
        ['bladeFlourish', 3, 'Blade Flourish', 'Your walking speed rises by 10 feet when you attack; on a hit spend an inspiration die to add it to damage and add it to AC (Defensive), hit a second foe (Slashing) or push the target (Mobile).'],
        ['extraAttack', 6, 'Extra Attack', 'Attack twice when you take the Attack action.'],
        ['mastersFlourish', 14, "Master's Flourish", 'Use a d6 instead of an inspiration die for a Blade Flourish.'],
      ],
    },
    whispers: {
      name: 'College of Whispers', source: 'XGtE', desc: 'Spies and blackmailers whose blades and words cut the mind.',
      features: [
        ['psychicBlades', 3, 'Psychic Blades', 'Once per turn on a weapon hit, spend an inspiration die for 2d6 extra psychic damage (3d6 at 5th, 5d6 at 10th, 8d6 at 15th).'],
        ['wordsOfTerror', 3, 'Words of Terror', 'After a minute alone with a humanoid, it makes a Wisdom save or is frightened of you or someone you name, once per short rest.'],
        ['mantleOfWhispers', 6, 'Mantle of Whispers', "Capture the shadow of a dying humanoid to wear its likeness and recall its memories, once per short rest."],
        ['shadowLore', 14, 'Shadow Lore', 'Whisper a secret: a creature fails a Wisdom save and is charmed for 8 hours, believing you know its worst secret, once per long rest.'],
      ],
      resources: l => ({
        wordsOfTerror: { name: 'Words of Terror', max: 1, recharge: 'short' },
        mantleOfWhispers: { name: 'Mantle of Whispers', max: l >= 6 ? 1 : 0, recharge: 'short' },
        shadowLore: { name: 'Shadow Lore', max: l >= 14 ? 1 : 0, recharge: 'long' },
      }),
    },
    creation: {
      name: 'College of Creation', source: 'TCE', desc: 'Bards who sing the Song of Creation to make objects and set them dancing.',
      features: [
        ['moteOfPotential', 3, 'Mote of Potential', 'Your inspiration dice gain a mote: rolled twice for checks, burst into thunder on attacks, or grant temporary hit points on saves.'],
        ['performanceOfCreation', 3, 'Performance of Creation', 'Create a nonmagical item worth up to 20 times your bard level in gold, once per long rest (or by spending a 2nd-level slot).'],
        ['animatingPerformance', 6, 'Animating Performance', 'Animate a Large or smaller object into a Dancing Item that fights for you for an hour, once per long rest.'],
        ['creativeCrescendo', 14, 'Creative Crescendo', 'Performance of Creation makes several items at once, of any size.'],
      ],
      resources: l => ({
        performanceOfCreation: { name: 'Performance of Creation', max: 1, recharge: 'long' },
        animatingPerformance: { name: 'Animating Performance', max: l >= 6 ? 1 : 0, recharge: 'long' },
      }),
    },
    eloquence: {
      name: 'College of Eloquence', source: 'TCE', desc: 'Masters of oratory whose words never fail to persuade and unsettle.',
      features: [
        ['silverTongue', 3, 'Silver Tongue', 'Treat a d20 roll of 9 or lower as 10 on Persuasion and Deception checks.'],
        ['unsettlingWords', 3, 'Unsettling Words', 'Bonus action: spend an inspiration die; a creature subtracts it from its next saving throw.'],
        ['unfailingInspiration', 6, 'Unfailing Inspiration', 'A creature keeps your inspiration die when its roll still fails.'],
        ['universalSpeech', 6, 'Universal Speech', 'For an hour, up to your Charisma modifier of creatures understand you, once per long rest.'],
        ['infectiousInspiration', 14, 'Infectious Inspiration', 'Reaction, Charisma modifier times per long rest: when your inspiration succeeds, give another creature an inspiration die for free.'],
      ],
      resources: (l, m) => ({
        universalSpeech: { name: 'Universal Speech', max: l >= 6 ? 1 : 0, recharge: 'long' },
        infectiousInspiration: { name: 'Infectious Inspiration', max: l >= 14 ? Math.max(1, m.cha) : 0, recharge: 'long' },
      }),
    },
  },

  cleric: {
    knowledge: {
      name: 'Knowledge Domain', source: 'PHB', desc: 'Seekers of lore who read minds and draw on any skill.',
      domainSpells: { 1: ['command', 'identify'], 3: ['augury', 'suggestion'], 5: ['nondetection', 'speakWithDead'], 7: ['arcaneEye', 'confusion'], 9: ['legendLore', 'scrying'] },
      potentSpellcasting: 8,
      features: [
        ['blessingsOfKnowledge', 1, 'Blessings of Knowledge', 'Two extra languages, and proficiency and expertise in two of Arcana, History, Nature and Religion.'],
        ['knowledgeOfTheAges', 2, 'Channel Divinity: Knowledge of the Ages', 'Gain proficiency with a skill or tool for 10 minutes.'],
        ['readThoughts', 6, 'Channel Divinity: Read Thoughts', 'Read a creature\'s surface thoughts (Wisdom save) and cast Suggestion on it without a slot.'],
        ['potentSpellcasting', 8, 'Potent Spellcasting', 'Add your Wisdom modifier to the damage of cleric cantrips.'],
        ['visionsOfThePast', 17, 'Visions of the Past', 'Meditate to see visions of an object\'s owners or an area\'s past.'],
      ],
    },
    nature: {
      name: 'Nature Domain', source: 'PHB', desc: 'Priests of the wild who command plants and beasts.',
      armor: ['heavy'], cantrips: ['druidcraft'],
      domainSpells: { 1: ['animalFriendship', 'speakWithAnimals'], 3: ['barkskin', 'spikeGrowth'], 5: ['plantGrowth', 'windWall'], 7: ['dominateBeast', 'graspingVine'], 9: ['insectPlague', 'treeStride'] },
      strike: { level: 8, dice: l => (l >= 14 ? '2d8' : '1d8'), type: 'cold', label: 'Divine Strike' },
      features: [
        ['acolyteOfNature', 1, 'Acolyte of Nature', 'Learn a druid cantrip and proficiency in Animal Handling, Nature or Survival.'],
        ['natureBonusProficiency', 1, 'Bonus Proficiency', 'Heavy armor proficiency.'],
        ['charmAnimalsAndPlants', 2, 'Channel Divinity: Charm Animals and Plants', 'Beasts and plants within 30 feet make Wisdom saves or are charmed for a minute.'],
        ['dampenElements', 6, 'Dampen Elements', 'Reaction: grant resistance to acid, cold, fire, lightning or thunder damage as it lands.'],
        ['divineStrike', 8, 'Divine Strike', 'Once per turn, weapon hits deal an extra 1d8 cold, fire or lightning damage (2d8 at 14th).'],
        ['masterOfNature', 17, 'Master of Nature', 'Command charmed beasts and plants as a bonus action.'],
      ],
    },
    tempest: {
      name: 'Tempest Domain', source: 'PHB', desc: 'Storm priests who answer blows with thunder and maximize lightning.',
      armor: ['heavy'], weapons: ['martial'],
      domainSpells: { 1: ['fogCloud', 'thunderwave'], 3: ['gustOfWind', 'shatter'], 5: ['callLightning', 'sleetStorm'], 7: ['controlWater', 'iceStorm'], 9: ['destructiveWave', 'insectPlague'] },
      strike: { level: 8, dice: l => (l >= 14 ? '2d8' : '1d8'), type: 'thunder', label: 'Divine Strike' },
      features: [
        ['tempestProficiencies', 1, 'Bonus Proficiencies', 'Martial weapons and heavy armor.'],
        ['wrathOfTheStorm', 1, 'Wrath of the Storm', 'Reaction when hit in melee: 2d8 lightning or thunder damage to the attacker (Dexterity save for half), Wisdom modifier times per long rest.'],
        ['destructiveWrath', 2, 'Channel Divinity: Destructive Wrath', 'Deal maximum damage with a lightning or thunder damage roll.'],
        ['thunderboltStrike', 6, 'Thunderbolt Strike', 'Your lightning damage pushes Large or smaller creatures 10 feet.'],
        ['divineStrike', 8, 'Divine Strike', 'Once per turn, weapon hits deal an extra 1d8 thunder damage (2d8 at 14th).'],
        ['stormborn', 17, 'Stormborn', 'A flying speed equal to your walking speed outdoors.'],
      ],
      resources: (l, m) => ({ wrathOfTheStorm: { name: 'Wrath of the Storm', max: Math.max(1, m.wis), recharge: 'long' } }),
    },
    trickery: {
      name: 'Trickery Domain', source: 'PHB', desc: 'Servants of trickster gods who deceive with illusions and duplicates.',
      domainSpells: { 1: ['charmPerson', 'disguiseSelf'], 3: ['mirrorImage', 'passWithoutTrace'], 5: ['blink', 'dispelMagic'], 7: ['dimensionDoor', 'polymorph'], 9: ['dominatePerson', 'modifyMemory'] },
      strike: { level: 8, dice: l => (l >= 14 ? '2d8' : '1d8'), type: 'poison', label: 'Divine Strike' },
      features: [
        ['blessingOfTheTrickster', 1, 'Blessing of the Trickster', 'Give a willing creature advantage on Stealth checks for an hour.'],
        ['invokeDuplicity', 2, 'Channel Divinity: Invoke Duplicity', 'An illusory double: cast spells from its space, and gain advantage on attacks when you and it are both next to a foe.'],
        ['cloakOfShadows', 6, 'Channel Divinity: Cloak of Shadows', 'Become invisible until the end of your next turn.'],
        ['divineStrike', 8, 'Divine Strike', 'Once per turn, weapon hits deal an extra 1d8 poison damage (2d8 at 14th).'],
        ['improvedDuplicity', 17, 'Improved Duplicity', 'Create up to four duplicates.'],
      ],
    },
    war: {
      name: 'War Domain', source: 'PHB', desc: 'Champions of battle gods who strike with divine accuracy.',
      armor: ['heavy'], weapons: ['martial'],
      domainSpells: { 1: ['divineFavor', 'shieldOfFaith'], 3: ['magicWeapon', 'spiritualWeapon'], 5: ['crusadersMantle', 'spiritGuardians'], 7: ['freedomOfMovement', 'stoneskin'], 9: ['flameStrike', 'holdMonster'] },
      strike: { level: 8, dice: l => (l >= 14 ? '2d8' : '1d8'), type: 'weapon', label: 'Divine Strike' },
      features: [
        ['warProficiencies', 1, 'Bonus Proficiencies', 'Martial weapons and heavy armor.'],
        ['warPriest', 1, 'War Priest', 'After taking the Attack action, make one weapon attack as a bonus action, Wisdom modifier times per long rest.'],
        ['guidedStrike', 2, 'Channel Divinity: Guided Strike', 'Add +10 to an attack roll after seeing it.'],
        ['warGodsBlessing', 6, "Channel Divinity: War God's Blessing", 'Reaction: add +10 to an ally\'s attack roll within 30 feet.'],
        ['divineStrike', 8, 'Divine Strike', 'Once per turn, weapon hits deal an extra 1d8 damage of the weapon\'s type (2d8 at 14th).'],
        ['avatarOfBattle', 17, 'Avatar of Battle', 'Resistance to nonmagical bludgeoning, piercing and slashing damage.'],
      ],
      resist: [{ level: 17, types: ['bludgeoning', 'piercing', 'slashing'] }],
      resources: (l, m) => ({ warPriest: { name: 'War Priest', max: Math.max(1, m.wis), recharge: 'long' } }),
    },
    forge: {
      name: 'Forge Domain', source: 'XGtE', desc: 'Divine smiths who bless armor and weapons and stand unbowed in fire.',
      armor: ['heavy'],
      domainSpells: { 1: ['identify', 'searingSmite'], 3: ['heatMetal', 'magicWeapon'], 5: ['elementalWeapon', 'protectionFromEnergy'], 7: ['fabricate', 'wallOfFire'], 9: ['animateObjects', 'creation'] },
      strike: { level: 8, dice: l => (l >= 14 ? '2d8' : '1d8'), type: 'fire', label: 'Divine Strike' },
      heavyAcBonus: { level: 6, bonus: 1 },
      resist: [{ level: 6, types: ['fire'] }],
      features: [
        ['forgeProficiencies', 1, 'Bonus Proficiencies', "Heavy armor and smith's tools."],
        ['blessingOfTheForge', 1, 'Blessing of the Forge', 'At each long rest, give a nonmagical weapon or suit of armor a +1 bonus until your next long rest.'],
        ['artisansBlessing', 2, "Channel Divinity: Artisan's Blessing", 'An hour-long ritual crafts a simple metal item worth up to 100 gp.'],
        ['soulOfTheForge', 6, 'Soul of the Forge', 'Resistance to fire, and +1 AC while wearing heavy armor.'],
        ['divineStrike', 8, 'Divine Strike', 'Once per turn, weapon hits deal an extra 1d8 fire damage (2d8 at 14th).'],
        ['saintOfForgeAndFire', 17, 'Saint of Forge and Fire', 'Immunity to fire, and resistance to nonmagical weapon damage while in heavy armor.'],
      ],
    },
    grave: {
      name: 'Grave Domain', source: 'XGtE', desc: 'Guardians of the line between life and death, foes of undeath.',
      domainSpells: { 1: ['bane', 'falseLife'], 3: ['gentleRepose', 'rayOfEnfeeblement'], 5: ['revivify', 'vampiricTouch'], 7: ['blight', 'deathWard'], 9: ['antilifeShell', 'raiseDead'] },
      potentSpellcasting: 8,
      cantrips: ['spareTheDying'],
      features: [
        ['circleOfMortality', 1, 'Circle of Mortality', 'Healing a creature at 0 hit points uses the dice maximum; you know Spare the Dying, cast as a bonus action at 30 feet.'],
        ['eyesOfTheGrave', 1, 'Eyes of the Grave', 'Sense undead within 60 feet, Wisdom modifier times per long rest.'],
        ['pathToTheGrave', 2, 'Channel Divinity: Path to the Grave', 'Curse a creature: the next attack that hits it deals double damage.'],
        ['sentinelAtDeathsDoor', 6, "Sentinel at Death's Door", 'Reaction: turn a critical hit against an ally within 30 feet into a normal hit, Wisdom modifier times per long rest.'],
        ['potentSpellcasting', 8, 'Potent Spellcasting', 'Add your Wisdom modifier to the damage of cleric cantrips.'],
        ['keeperOfSouls', 17, 'Keeper of Souls', 'Once per round when an enemy dies nearby, you or an ally regains hit points equal to its Hit Dice.'],
      ],
      resources: (l, m) => ({
        eyesOfTheGrave: { name: 'Eyes of the Grave', max: Math.max(1, m.wis), recharge: 'long' },
        sentinelAtDeathsDoor: { name: "Sentinel at Death's Door", max: l >= 6 ? Math.max(1, m.wis) : 0, recharge: 'long' },
      }),
    },
    order: {
      name: 'Order Domain', source: 'TCE', desc: 'Enforcers of law whose commands spur allies to strike.',
      armor: ['heavy'],
      domainSpells: { 1: ['command', 'heroism'], 3: ['holdPerson', 'zoneOfTruth'], 5: ['massHealingWord', 'slow'], 7: ['compulsion', 'locateCreature'], 9: ['commune', 'dominatePerson'] },
      strike: { level: 8, dice: l => (l >= 14 ? '2d8' : '1d8'), type: 'psychic', label: 'Divine Strike' },
      features: [
        ['orderProficiencies', 1, 'Bonus Proficiencies', 'Heavy armor, and Intimidation or Persuasion.'],
        ['voiceOfAuthority', 1, 'Voice of Authority', 'When you cast a leveled spell on an ally, it can use its reaction to make one weapon attack.'],
        ['ordersDemand', 2, "Channel Divinity: Order's Demand", 'Creatures of your choice within 30 feet make Wisdom saves or are charmed and drop what they hold.'],
        ['embodimentOfTheLaw', 6, 'Embodiment of the Law', 'Cast enchantment spells of 1st level or higher as a bonus action, Wisdom modifier times per long rest.'],
        ['divineStrike', 8, 'Divine Strike', 'Once per turn, weapon hits deal an extra 1d8 psychic damage (2d8 at 14th).'],
        ['ordersWrath', 17, "Order's Wrath", 'A creature you hit with Divine Strike takes an extra 2d8 psychic damage from the next ally to hit it.'],
      ],
      resources: (l, m) => ({ embodimentOfTheLaw: { name: 'Embodiment of the Law', max: l >= 6 ? Math.max(1, m.wis) : 0, recharge: 'long' } }),
    },
    peace: {
      name: 'Peace Domain', source: 'TCE', desc: 'Peacemakers who bind allies together in mutual protection.',
      domainSpells: { 1: ['heroism', 'sanctuary'], 3: ['aid', 'wardingBond'], 5: ['beaconOfHope', 'sending'], 7: ['auraOfPurity', 'resilientSphere'], 9: ['greaterRestoration', 'telepathicBond'] },
      potentSpellcasting: 8,
      features: [
        ['implementOfPeace', 1, 'Implement of Peace', 'Proficiency in Insight, Performance or Persuasion.'],
        ['emboldeningBond', 1, 'Emboldening Bond', 'Proficiency bonus times per long rest, bond up to that many creatures for 10 minutes: once per turn each adds 1d4 to an attack, check or save while near another.'],
        ['balmOfPeace', 2, 'Channel Divinity: Balm of Peace', 'Move without provoking; each creature you pass within 5 feet of regains 2d6 + Wisdom modifier hit points.'],
        ['protectiveBond', 6, 'Protective Bond', 'A bonded creature can teleport to take the damage meant for another and resist it.'],
        ['potentSpellcasting', 8, 'Potent Spellcasting', 'Add your Wisdom modifier to the damage of cleric cantrips.'],
        ['expansiveBond', 17, 'Expansive Bond', 'Your bond reaches 60 feet, and a protective switch grants resistance to the damage.'],
      ],
      resources: l => ({ emboldeningBond: { name: 'Emboldening Bond', max: pb(l), recharge: 'long' } }),
    },
    twilight: {
      name: 'Twilight Domain', source: 'TCE', desc: 'Guardians of the night who shelter allies in comforting twilight.',
      armor: ['heavy'], weapons: ['martial'],
      domainSpells: { 1: ['faerieFire', 'sleep'], 3: ['moonbeam', 'seeInvisibility'], 5: ['auraOfVitality', 'tinyHut'], 7: ['auraOfLife', 'greaterInvisibility'], 9: ['circleOfPower', 'mislead'] },
      strike: { level: 8, dice: l => (l >= 14 ? '2d8' : '1d8'), type: 'radiant', label: 'Divine Strike' },
      features: [
        ['twilightProficiencies', 1, 'Bonus Proficiencies', 'Martial weapons and heavy armor.'],
        ['eyesOfNight', 1, 'Eyes of Night', 'Darkvision to 300 feet, which you can share with allies for an hour.'],
        ['vigilantBlessing', 1, 'Vigilant Blessing', 'Give a creature advantage on its next initiative roll.'],
        ['twilightSanctuary', 2, 'Channel Divinity: Twilight Sanctuary', 'A 30-foot sphere of twilight for a minute: allies ending a turn there gain 1d6 + cleric level temporary hit points or end a charm or fear.'],
        ['stepsOfNight', 6, 'Steps of Night', 'In dim light or darkness, gain a flying speed for a minute, proficiency bonus times per long rest.'],
        ['divineStrike', 8, 'Divine Strike', 'Once per turn, weapon hits deal an extra 1d8 radiant damage (2d8 at 14th).'],
        ['twilightShroud', 17, 'Twilight Shroud', 'You and allies in your Twilight Sanctuary have half cover.'],
      ],
      resources: l => ({ stepsOfNight: { name: 'Steps of Night', max: l >= 6 ? pb(l) : 0, recharge: 'long' } }),
    },
  },

  druid: {
    dreams: {
      name: 'Circle of Dreams', source: 'XGtE', desc: 'Druids tied to the Feywild who heal and step through dreams.',
      features: [
        ['balmOfTheSummerCourt', 2, 'Balm of the Summer Court', 'A pool of d6s equal to your druid level: as a bonus action spend some to heal a creature within 120 feet and grant temporary hit points.'],
        ['hearthOfMoonlightAndShadow', 6, 'Hearth of Moonlight and Shadow', 'During a rest, a 30-foot sphere grants +5 to Stealth and Perception and hides your camp\'s light.'],
        ['hiddenPaths', 10, 'Hidden Paths', 'Teleport up to 60 feet as a bonus action, or move a willing creature 30 feet, Wisdom modifier times per long rest.'],
        ['walkerInDreams', 14, 'Walker in Dreams', 'After a short rest, cast Dream, Scrying or Teleportation Circle without a slot, once per long rest.'],
      ],
      resources: (l, m) => ({
        balmOfTheSummerCourt: { name: 'Balm of the Summer Court (d6)', max: l, recharge: 'long' },
        hiddenPaths: { name: 'Hidden Paths', max: l >= 10 ? Math.max(1, m.wis) : 0, recharge: 'long' },
      }),
    },
    shepherd: {
      name: 'Circle of the Shepherd', source: 'XGtE', desc: 'Protectors of beasts who summon spirit totems and empower conjured creatures.',
      features: [
        ['speechOfTheWoods', 2, 'Speech of the Woods', 'You speak Sylvan, and know Speak with Animals, always prepared.'],
        ['spiritTotem', 2, 'Spirit Totem', 'Bonus action, once per short rest: a bear (temporary hit points, advantage on Strength), hawk (reaction to grant advantage) or unicorn (better healing) spirit aura for a minute.'],
        ['mightySummoner', 6, 'Mighty Summoner', 'Beasts and fey you conjure gain 2 extra hit points per Hit Die and magical attacks.'],
        ['guardianSpirit', 10, 'Guardian Spirit', 'Your summoned creatures in your totem\'s aura regain half your druid level in hit points each turn.'],
        ['faithfulSummons', 14, 'Faithful Summons', 'When you are reduced to 0 hit points, four beasts of CR 2 appear to protect you, once per long rest.'],
      ],
      domainSpells: { 2: ['speakWithAnimals'] },
      resources: l => ({
        spiritTotem: { name: 'Spirit Totem', max: 1, recharge: 'short' },
        faithfulSummons: { name: 'Faithful Summons', max: l >= 14 ? 1 : 0, recharge: 'long' },
      }),
    },
    spores: {
      name: 'Circle of Spores', source: 'TCE', desc: 'Druids of rot and fungus who poison foes and animate the dead.',
      domainSpells: { 3: ['blindnessDeafness', 'gentleRepose'], 5: ['animateDead', 'gaseousForm'], 7: ['blight', 'confusion'], 9: ['cloudkill', 'contagion'] },
      cantrips: ['chillTouch'],
      features: [
        ['circleSpellsSpores', 2, 'Circle Spells', 'You know Chill Touch, and gain decay-themed circle spells as you level.'],
        ['haloOfSpores', 2, 'Halo of Spores', 'Reaction: a creature within 10 feet makes a Constitution save or takes 1d4 necrotic damage (rising with level).'],
        ['symbioticEntity', 2, 'Symbiotic Entity', 'Spend a Wild Shape use: gain 4 temporary hit points per druid level, double your Halo damage and add 1d6 necrotic to melee hits for 10 minutes.'],
        ['fungalInfestation', 6, 'Fungal Infestation', 'Reaction, Wisdom modifier times per long rest: a Small or Medium beast or humanoid that dies near you rises as a zombie for an hour.'],
        ['spreadingSpores', 10, 'Spreading Spores', 'While symbiotic, hurl a 10-foot cube of spores that deals your Halo damage to those inside.'],
        ['fungalBody', 14, 'Fungal Body', 'You cannot be blinded, deafened, frightened or poisoned, and critical hits against you count as normal hits.'],
      ],
      resources: (l, m) => ({ fungalInfestation: { name: 'Fungal Infestation', max: l >= 6 ? Math.max(1, m.wis) : 0, recharge: 'long' } }),
    },
    stars: {
      name: 'Circle of Stars', source: 'TCE', desc: 'Druids who read the stars and take on a starry, constellation-bright form.',
      cantrips: ['guidance'],
      domainSpells: { 2: ['guidingBolt'] },
      features: [
        ['starMap', 2, 'Star Map', 'You know Guidance and always have Guiding Bolt prepared, casting it without a slot proficiency bonus times per long rest.'],
        ['starryForm', 2, 'Starry Form', 'Spend a Wild Shape use to glow for 10 minutes as the Archer (bonus-action radiant attacks), Chalice (extra healing) or Dragon (concentration and checks at least 10).'],
        ['cosmicOmen', 6, 'Cosmic Omen', 'After a long rest, roll for weal or woe; proficiency bonus times per long rest add or subtract a d6 from a nearby roll.'],
        ['twinklingConstellations', 10, 'Twinkling Constellations', 'Your starry form grows stronger and you can switch constellations each turn.'],
        ['fullOfStars', 14, 'Full of Stars', 'In Starry Form you resist bludgeoning, piercing and slashing damage.'],
      ],
      resources: l => ({
        starMap: { name: 'Guiding Bolt (Star Map)', max: pb(l), recharge: 'long' },
        cosmicOmen: { name: 'Cosmic Omen', max: l >= 6 ? pb(l) : 0, recharge: 'long' },
      }),
    },
    wildfire: {
      name: 'Circle of Wildfire', source: 'TCE', desc: 'Druids of fire and renewal, bonded to a wildfire spirit.',
      domainSpells: { 2: ['burningHands', 'cureWounds'], 3: ['flamingSphere', 'scorchingRay'], 5: ['plantGrowth', 'revivify'], 7: ['auraOfLife', 'fireShield'], 9: ['flameStrike', 'massCureWounds'] },
      features: [
        ['summonWildfireSpirit', 2, 'Summon Wildfire Spirit', 'Spend a Wild Shape use to summon a fiery spirit that burns foes as it appears, attacks with flame and teleports allies.'],
        ['enhancedBond', 6, 'Enhanced Bond', 'While your spirit is summoned, your fire damage and healing spells add 1d8, and spells can originate from the spirit.'],
        ['cauterizingFlames', 10, 'Cauterizing Flames', 'Spectral flames where creatures die heal or burn those who enter them, proficiency bonus times per long rest.'],
        ['blazingRevival', 14, 'Blazing Revival', 'When you drop to 0 hit points, your spirit sacrifices itself to restore you to half your hit points, once per long rest.'],
      ],
      resources: l => ({
        cauterizingFlames: { name: 'Cauterizing Flames', max: l >= 10 ? pb(l) : 0, recharge: 'long' },
        blazingRevival: { name: 'Blazing Revival', max: l >= 14 ? 1 : 0, recharge: 'long' },
      }),
    },
  },

  fighter: {
    eldritchKnight: {
      name: 'Eldritch Knight', source: 'PHB', desc: 'Warriors who blend swordplay with abjuration and evocation magic.',
      spellcasting: third(['abjuration', 'evocation']),
      features: [
        ['ekSpellcasting', 3, 'Spellcasting', 'Learn wizard cantrips and spells, mostly abjuration and evocation, cast with Intelligence.'],
        ['weaponBond', 3, 'Weapon Bond', 'Bond with up to two weapons: they cannot be disarmed and you can summon them to your hand.'],
        ['warMagic', 7, 'War Magic', 'After casting a cantrip with your action, make one weapon attack as a bonus action.'],
        ['eldritchStrike', 10, 'Eldritch Strike', 'A creature you hit with a weapon has disadvantage on its next save against your spells.'],
        ['arcaneCharge', 15, 'Arcane Charge', 'Teleport up to 30 feet when you use Action Surge.'],
        ['improvedWarMagic', 18, 'Improved War Magic', 'After casting a spell with your action, make one weapon attack as a bonus action.'],
      ],
    },
    arcaneArcher: {
      name: 'Arcane Archer', source: 'XGtE', desc: 'Elven-trained archers who weave magic into their arrows.',
      cantrips: ['prestidigitation'],
      features: [
        ['arcaneArcherLore', 3, 'Arcane Archer Lore', 'Proficiency in Arcana or Nature, and the Prestidigitation or Druidcraft cantrip.'],
        ['arcaneShot', 3, 'Arcane Shot', 'Twice per short rest, imbue a hit with an Arcane Shot option (banishing, beguiling, bursting, enfeebling, grasping, piercing, seeking or shadow arrows); you learn more as you level.'],
        ['magicArrow', 7, 'Magic Arrow', 'Your arrows count as magical.'],
        ['curvingShot', 7, 'Curving Shot', 'Bonus action: reroll a missed magic arrow against a different target within 60 feet.'],
        ['everReadyShot', 15, 'Ever-Ready Shot', 'Regain one Arcane Shot use when you roll initiative with none left.'],
      ],
      resources: () => ({ arcaneShot: { name: 'Arcane Shot', max: 2, recharge: 'short' } }),
    },
    cavalier: {
      name: 'Cavalier', source: 'XGtE', desc: 'Mounted warriors who mark foes and protect their allies.',
      features: [
        ['cavalierProficiency', 3, 'Bonus Proficiency', 'Proficiency in Animal Handling, History, Insight, Performance or Persuasion, or a language.'],
        ['bornToTheSaddle', 3, 'Born to the Saddle', 'Advantage against falling off a mount, and mounting or dismounting costs 5 feet.'],
        ['unwaveringMark', 3, 'Unwavering Mark', 'Creatures you hit are marked: they have disadvantage attacking others, and if they do you can make a bonus-action attack with advantage and extra damage, Strength modifier times per long rest.'],
        ['wardingManeuver', 7, 'Warding Maneuver', 'Reaction: add 1d8 to an ally\'s AC against an attack and grant resistance, Constitution modifier times per long rest.'],
        ['holdTheLine', 10, 'Hold the Line', 'Creatures provoke from you when they move within your reach; a hit stops them.'],
        ['ferociousCharger', 15, 'Ferocious Charger', 'After moving 10 feet straight, a hit can knock the target prone (Strength save).'],
        ['vigilantDefender', 18, 'Vigilant Defender', 'One opportunity attack on every other creature\'s turn.'],
      ],
      resources: (l, m) => ({
        unwaveringMark: { name: 'Unwavering Mark', max: Math.max(1, m.str), recharge: 'long' },
        wardingManeuver: { name: 'Warding Maneuver', max: l >= 7 ? Math.max(1, m.con) : 0, recharge: 'long' },
      }),
    },
    samurai: {
      name: 'Samurai', source: 'XGtE', desc: 'Warriors of unbreakable resolve who call on fighting spirit.',
      features: [
        ['samuraiProficiency', 3, 'Bonus Proficiency', 'Proficiency in History, Insight, Performance or Persuasion, or a language.'],
        ['fightingSpirit', 3, 'Fighting Spirit', 'Bonus action, three times per long rest: advantage on weapon attacks this turn and 5 temporary hit points (10 at 10th, 15 at 15th).'],
        ['elegantCourtier', 7, 'Elegant Courtier', 'Add Wisdom to Persuasion checks, and gain proficiency in Wisdom saves.'],
        ['tirelessSpirit', 10, 'Tireless Spirit', 'Regain one Fighting Spirit use when you roll initiative with none left.'],
        ['rapidStrike', 15, 'Rapid Strike', 'Trade advantage on one attack for an extra attack.'],
        ['strengthBeforeDeath', 18, 'Strength before Death', 'When reduced to 0 hit points, take an extra turn immediately, once per long rest.'],
      ],
      resources: () => ({ fightingSpirit: { name: 'Fighting Spirit', max: 3, recharge: 'long' } }),
    },
    psiWarrior: {
      name: 'Psi Warrior', source: 'TCE', desc: 'Fighters who channel psionic energy into strikes, shields and telekinesis.',
      features: [
        ['psionicPower', 3, 'Psionic Power', 'Psionic energy dice (d6, twice your proficiency bonus) fuel a protective field, a psionic strike (extra force damage) and telekinetic movement.'],
        ['telekineticAdept', 7, 'Telekinetic Adept', 'Psi-powered leaps and telekinetic thrusts that push or knock prone.'],
        ['guardedMind', 10, 'Guarded Mind', 'Resistance to psychic damage; spend a die to end charm or fear.'],
        ['bulwarkOfForce', 15, 'Bulwark of Force', 'Give half cover to creatures of your choice for a minute, once per long rest.'],
        ['telekineticMaster', 18, 'Telekinetic Master', 'Cast Telekinesis without a slot and attack while concentrating on it.'],
      ],
      resist: [{ level: 10, types: ['psychic'] }],
      resources: l => ({ psionicEnergy: { name: 'Psionic Energy (d6+)', max: pb(l) * 2, recharge: 'long' } }),
    },
    runeKnight: {
      name: 'Rune Knight', source: 'TCE', desc: 'Fighters who carve giants\' runes into their gear and grow to giant size.',
      features: [
        ['runeKnightProficiencies', 3, 'Bonus Proficiencies', "Smith's tools and the Giant language."],
        ['runeCarver', 3, 'Rune Carver', 'Inscribe runes (cloud, fire, frost, stone, hill, storm) that grant passive benefits and a once-per-rest power.'],
        ['giantsMight', 3, "Giant's Might", 'Bonus action, proficiency bonus times per long rest: become Large for a minute, with advantage on Strength and +1d6 weapon damage once per turn.'],
        ['runicShield', 7, 'Runic Shield', 'Reaction: force a creature to reroll an attack against an ally.'],
        ['greatStature', 10, 'Great Stature', 'You grow taller and Giant\'s Might deals 1d8.'],
        ['masterOfRunes', 15, 'Master of Runes', 'Each rune\'s power can be used twice per rest.'],
        ['runicJuggernaut', 18, 'Runic Juggernaut', 'Giant\'s Might makes you Huge, with 1d10 damage and 5 more feet of reach.'],
      ],
      resources: l => ({
        giantsMight: { name: "Giant's Might", max: pb(l), recharge: 'long' },
        runicShield: { name: 'Runic Shield', max: l >= 7 ? pb(l) : 0, recharge: 'long' },
      }),
    },
  },

  monk: {
    fourElements: {
      name: 'Way of the Four Elements', source: 'PHB', desc: 'Monks who spend ki to bend fire, water, earth and air.',
      features: [
        ['discipleOfTheElements', 3, 'Disciple of the Elements', 'Learn elemental disciplines (more at 6th, 11th and 17th), such as Fangs of the Fire Snake, Water Whip and Fist of Unbroken Air, that spend ki to cast spell-like effects.'],
        ['elementalAttunement', 3, 'Elemental Attunement', 'Minor elemental tricks at will.'],
      ],
    },
    drunkenMaster: {
      name: 'Way of the Drunken Master', source: 'XGtE', desc: 'Monks whose swaying, stumbling style confounds their foes.',
      features: [
        ['drunkenProficiencies', 3, 'Bonus Proficiencies', "Performance and brewer's supplies."],
        ['drunkenTechnique', 3, 'Drunken Technique', 'Flurry of Blows also grants Disengage and 10 more feet of speed.'],
        ['tipsySway', 6, 'Tipsy Sway', 'Stand from prone for 5 feet, and redirect a missed attack to another creature.'],
        ['drunkardsLuck', 11, "Drunkard's Luck", 'Spend 2 ki to cancel disadvantage on a check, attack or save.'],
        ['intoxicatedFrenzy', 17, 'Intoxicated Frenzy', 'Flurry of Blows makes up to five attacks against different creatures.'],
      ],
    },
    kensei: {
      name: 'Way of the Kensei', source: 'XGtE', desc: 'Monks who master chosen weapons as an extension of the body.',
      features: [
        ['pathOfTheKensei', 3, 'Path of the Kensei', 'Choose kensei weapons; +2 AC after an unarmed strike, +1d4 damage with ranged kensei weapons, and calligraphy or painting tools.'],
        ['oneWithTheBlade', 6, 'One with the Blade', 'Kensei weapons are magical; spend 1 ki for a Deft Strike adding your martial arts die to damage.'],
        ['sharpenTheBlade', 11, 'Sharpen the Blade', 'Spend up to 3 ki to give a kensei weapon that bonus to attack and damage for a minute.'],
        ['unerringAccuracy', 17, 'Unerring Accuracy', 'Reroll one missed monk weapon attack each turn.'],
      ],
    },
    sunSoul: {
      name: 'Way of the Sun Soul', source: 'XGtE', desc: 'Monks who hurl searing bolts of radiant ki.',
      features: [
        ['radiantSunBolt', 3, 'Radiant Sun Bolt', 'A ranged spell attack of radiant ki (martial arts die + Dexterity), with a bonus-action extra bolt for 1 ki.'],
        ['searingArcStrike', 6, 'Searing Arc Strike', 'After the Attack action, spend 2+ ki to cast Burning Hands as a bonus action.'],
        ['searingSunburst', 11, 'Searing Sunburst', 'An orb of light explodes for 2d6 radiant damage in a 20-foot radius (Constitution save), more with ki.'],
        ['sunShield', 17, 'Sun Shield', 'You shed light; creatures hitting you in melee take 5 + Wisdom radiant damage.'],
      ],
    },
    mercy: {
      name: 'Way of Mercy', source: 'TCE', desc: 'Masked healers who mend or harm with a touch.',
      features: [
        ['implementsOfMercy', 3, 'Implements of Mercy', "Insight, Medicine and the herbalism kit, and a mask."],
        ['handOfHealing', 3, 'Hand of Healing', 'Spend 1 ki to heal a creature by a martial arts die + Wisdom; one Flurry blow can heal instead.'],
        ['handOfHarm', 3, 'Hand of Harm', 'Once per turn, spend 1 ki on an unarmed hit for an extra martial arts die + Wisdom necrotic damage.'],
        ['physiciansTouch', 6, "Physician's Touch", 'Hand of Healing also ends a disease or condition; Hand of Harm poisons.'],
        ['flurryOfHealingAndHarm', 11, 'Flurry of Healing and Harm', 'Replace each Flurry blow with Hand of Healing, and use Hand of Harm without ki once per turn.'],
        ['handOfUltimateMercy', 17, 'Hand of Ultimate Mercy', 'Spend 5 ki to return a creature dead no more than a day to life, once per long rest.'],
      ],
    },
    astralSelf: {
      name: 'Way of the Astral Self', source: 'TCE', desc: 'Monks who summon spectral arms and visage from their astral self.',
      features: [
        ['armsOfTheAstralSelf', 3, 'Arms of the Astral Self', 'Spend 1 ki: spectral arms deal force damage using Wisdom, with 10 feet of reach, for 10 minutes.'],
        ['visageOfTheAstralSelf', 6, 'Visage of the Astral Self', 'Spectral mask: see in magical darkness, speak at a distance and gain advantage on Insight and Intimidation.'],
        ['bodyOfTheAstralSelf', 11, 'Body of the Astral Self', 'Deflect energy damage and add a martial arts die to one hit each turn.'],
        ['awakenedAstralSelf', 17, 'Awakened Astral Self', 'Spend 5 ki for your full astral self: +2 AC and three attacks with the astral arms.'],
      ],
    },
  },

  paladin: {
    ancients: {
      name: 'Oath of the Ancients', source: 'PHB', desc: 'Green knights sworn to protect light and life.',
      domainSpells: { 3: ['ensnaringStrike', 'speakWithAnimals'], 5: ['mistyStep', 'moonbeam'], 9: ['plantGrowth', 'protectionFromEnergy'], 13: ['iceStorm', 'stoneskin'], 17: ['communeWithNature', 'treeStride'] },
      features: [
        ['naturesWrath', 3, "Channel Divinity: Nature's Wrath", 'Spectral vines restrain a creature (Strength or Dexterity save).'],
        ['turnTheFaithless', 3, 'Channel Divinity: Turn the Faithless', 'Fey and fiends within 30 feet are turned on a failed Wisdom save.'],
        ['auraOfWarding', 7, 'Aura of Warding', 'You and allies within 10 feet resist damage from spells.'],
        ['undyingSentinel', 15, 'Undying Sentinel', 'When reduced to 0 hit points, drop to 1 instead, once per long rest; you no longer age.'],
        ['elderChampion', 20, 'Elder Champion', 'Transform for a minute: regain 10 hit points a turn, cast paladin spells as a bonus action, and enemies near you have disadvantage against your spells.'],
      ],
      resources: l => ({ undyingSentinel: { name: 'Undying Sentinel', max: l >= 15 ? 1 : 0, recharge: 'long' } }),
    },
    conquest: {
      name: 'Oath of Conquest', source: 'XGtE', desc: 'Iron-willed conquerors who rule through fear.',
      domainSpells: { 3: ['armorOfAgathys', 'command'], 5: ['holdPerson', 'spiritualWeapon'], 9: ['bestowCurse', 'fear'], 13: ['dominateBeast', 'stoneskin'], 17: ['cloudkill', 'dominatePerson'] },
      features: [
        ['conqueringPresence', 3, 'Channel Divinity: Conquering Presence', 'Creatures of your choice within 30 feet make Wisdom saves or are frightened for a minute.'],
        ['guidedStrikeConquest', 3, 'Channel Divinity: Guided Strike', 'Add +10 to an attack roll after seeing it.'],
        ['auraOfConquest', 7, 'Aura of Conquest', 'Creatures frightened of you within 10 feet have speed 0 and take psychic damage equal to half your level each turn.'],
        ['scornfulRebuke', 15, 'Scornful Rebuke', 'Creatures that hit you take psychic damage equal to your Charisma modifier.'],
        ['invincibleConqueror', 20, 'Invincible Conqueror', 'For a minute: resist all damage, an extra attack, and crits on 19-20, once per long rest.'],
      ],
    },
    redemption: {
      name: 'Oath of Redemption', source: 'XGtE', desc: 'Peacemakers who fight only when words fail, and take blows for others.',
      domainSpells: { 3: ['sanctuary', 'sleep'], 5: ['calmEmotions', 'holdPerson'], 9: ['counterspell', 'hypnoticPattern'], 13: ['resilientSphere', 'stoneskin'], 17: ['holdMonster', 'wallOfForce'] },
      features: [
        ['emissaryOfPeace', 3, 'Channel Divinity: Emissary of Peace', '+5 to Persuasion checks for 10 minutes.'],
        ['rebukeTheViolent', 3, 'Channel Divinity: Rebuke the Violent', 'Reaction: a creature that just hurt someone takes the same damage as radiant (Wisdom save for half).'],
        ['auraOfTheGuardian', 7, 'Aura of the Guardian', 'Reaction: take the damage an ally within 10 feet would take.'],
        ['protectiveSpirit', 15, 'Protective Spirit', 'At the end of your turn below half hit points, regain 1d6 + half your level.'],
        ['emissaryOfRedemption', 20, 'Emissary of Redemption', 'Resist all damage from creatures, which take half of what they deal to you as radiant damage.'],
      ],
    },
    glory: {
      name: 'Oath of Glory', source: 'TCE', desc: 'Heroes who strive for legendary deeds of athletic and martial excellence.',
      domainSpells: { 3: ['guidingBolt', 'heroism'], 5: ['enhanceAbility', 'magicWeapon'], 9: ['haste', 'protectionFromEnergy'], 13: ['compulsion', 'freedomOfMovement'], 17: ['commune', 'flameStrike'] },
      features: [
        ['peerlessAthlete', 3, 'Channel Divinity: Peerless Athlete', 'For 10 minutes: advantage on Athletics and Acrobatics, more carrying and longer jumps.'],
        ['inspiringSmite', 3, 'Channel Divinity: Inspiring Smite', 'After a Divine Smite, share 2d8 + your level in temporary hit points among creatures near you.'],
        ['auraOfAlacrity', 7, 'Aura of Alacrity', '+10 feet of walking speed, and allies starting their turn near you gain it too.'],
        ['gloriousDefense', 15, 'Glorious Defense', 'Reaction, Charisma modifier times per long rest: add your Charisma modifier to a creature\'s AC; if the attack misses, strike back.'],
        ['livingLegend', 20, 'Living Legend', 'For a minute: advantage on Charisma checks, a missed attack becomes a hit once per turn, and reroll failed saves.'],
      ],
    },
    watchers: {
      name: 'Oath of the Watchers', source: 'TCE', desc: 'Sentinels against extraplanar threats.',
      domainSpells: { 3: ['alarm', 'detectMagic'], 5: ['moonbeam', 'seeInvisibility'], 9: ['counterspell', 'nondetection'], 13: ['banishment', 'arcaneEye'], 17: ['holdMonster', 'scrying'] },
      features: [
        ['watchersWill', 3, "Channel Divinity: Watcher's Will", 'Up to your Charisma modifier of creatures gain advantage on Intelligence, Wisdom and Charisma saves for a minute.'],
        ['abjureTheExtraplanar', 3, 'Channel Divinity: Abjure the Extraplanar', 'Aberrations, celestials, elementals, fey and fiends within 30 feet are turned on a failed Wisdom save.'],
        ['auraOfTheSentinel', 7, 'Aura of the Sentinel', 'You and allies within 10 feet add your proficiency bonus to initiative.'],
        ['vigilantRebuke', 15, 'Vigilant Rebuke', 'Reaction: when a creature succeeds on an Int, Wis or Cha save, deal 2d8 + Charisma force damage to the creature that forced it.'],
        ['mortalBulwark', 20, 'Mortal Bulwark', 'For a minute: truesight, advantage against extraplanar creatures, and banish them on hits.'],
      ],
    },
  },

  ranger: {
    gloomStalker: {
      name: 'Gloom Stalker', source: 'XGtE', desc: 'Hunters of the dark who strike first and unseen.',
      domainSpells: { 3: ['disguiseSelf'], 5: ['ropeTrick'], 9: ['fear'], 13: ['greaterInvisibility'], 17: ['seeming'] },
      features: [
        ['dreadAmbusher', 3, 'Dread Ambusher', 'Add Wisdom to initiative; on your first turn gain 10 feet of speed and an extra attack that deals 1d8 more damage.'],
        ['umbralSight', 3, 'Umbral Sight', 'Darkvision 60 feet (or 30 more), and you are invisible to creatures relying on darkvision.'],
        ['ironMind', 7, 'Iron Mind', 'Proficiency in Wisdom saves (or Intelligence or Charisma if you have it).'],
        ['stalkersFlurry', 11, "Stalker's Flurry", 'Once per turn when you miss with a weapon, attack again.'],
        ['shadowyDodge', 15, 'Shadowy Dodge', 'Reaction: impose disadvantage on an attack against you made without advantage.'],
      ],
    },
    horizonWalker: {
      name: 'Horizon Walker', source: 'XGtE', desc: 'Guardians of the planes who step between places.',
      domainSpells: { 3: ['protectionFromEvilAndGood'], 5: ['mistyStep'], 9: ['haste'], 13: ['banishment'], 17: ['teleportationCircle'] },
      features: [
        ['detectPortal', 3, 'Detect Portal', 'Sense the nearest planar portal within a mile, once per short rest.'],
        ['planarWarrior', 3, 'Planar Warrior', 'Bonus action: your next hit on a creature this turn deals force damage plus 1d8 (2d8 at 11th).'],
        ['etherealStep', 7, 'Ethereal Step', 'Bonus action: step into the Ethereal Plane until the end of the turn, once per short rest.'],
        ['distantStrike', 11, 'Distant Strike', 'Teleport 10 feet before each attack; hitting two creatures earns a third attack.'],
        ['spectralDefense', 15, 'Spectral Defense', 'Reaction: resist all damage from an attack.'],
      ],
    },
    monsterSlayer: {
      name: 'Monster Slayer', source: 'XGtE', desc: 'Hunters of supernatural threats who learn their prey\'s weaknesses.',
      domainSpells: { 3: ['protectionFromEvilAndGood'], 5: ['zoneOfTruth'], 9: ['magicCircle'], 13: ['banishment'], 17: ['holdMonster'] },
      features: [
        ['huntersSense', 3, "Hunter's Sense", 'Learn a creature\'s immunities, resistances and vulnerabilities, Wisdom modifier times per long rest.'],
        ['slayersPrey', 3, "Slayer's Prey", 'Bonus action: mark a creature; your first hit on it each turn deals an extra 1d6.'],
        ['supernaturalDefense', 7, 'Supernatural Defense', 'Add 1d6 to saves and grapple escapes against your prey.'],
        ['magicUsersNemesis', 11, "Magic-User's Nemesis", 'Reaction: a creature casting or teleporting makes a Wisdom save or its magic fails, once per short rest.'],
        ['slayersCounter', 15, "Slayer's Counter", 'Reaction when your prey forces a save: attack it, and on a hit you succeed automatically.'],
      ],
      resources: (l, m) => ({ huntersSense: { name: "Hunter's Sense", max: Math.max(1, m.wis), recharge: 'long' } }),
    },
    feyWanderer: {
      name: 'Fey Wanderer', source: 'TCE', desc: 'Rangers touched by the Feywild who beguile and bewilder.',
      domainSpells: { 3: ['charmPerson'], 5: ['mistyStep'], 9: ['dispelMagic'], 13: ['dimensionDoor'], 17: ['mislead'] },
      strike: { level: 3, dice: l => (l >= 11 ? '2d4' : '1d4'), type: 'psychic', label: 'Dreadful Strikes' },
      features: [
        ['dreadfulStrikes', 3, 'Dreadful Strikes', 'Once per turn, a weapon hit deals an extra 1d4 psychic damage (1d6 at 11th).'],
        ['otherworldlyGlamour', 3, 'Otherworldly Glamour', 'Add Wisdom to Charisma checks, and proficiency in Deception, Performance or Persuasion.'],
        ['beguilingTwist', 7, 'Beguiling Twist', 'Advantage against charm and fear; when a creature resists one, redirect it to another creature (Wisdom save).'],
        ['feyReinforcements', 11, 'Fey Reinforcements', 'Summon Fey is always prepared and castable without a slot or concentration once per long rest.'],
        ['mistyWanderer', 15, 'Misty Wanderer', 'Cast Misty Step without a slot, bringing an ally, Wisdom modifier times per long rest.'],
      ],
    },
    swarmkeeper: {
      name: 'Swarmkeeper', source: 'TCE', desc: 'Rangers bonded to a swarm of nature spirits.',
      domainSpells: { 3: ['faerieFire', 'mageHand'], 5: ['web'], 9: ['gaseousForm'], 13: ['arcaneEye'], 17: ['insectPlague'] },
      cantrips: ['mageHand'],
      strike: { level: 3, dice: l => (l >= 11 ? '1d8' : '1d6'), type: 'piercing', label: 'Gathered Swarm' },
      features: [
        ['gatheredSwarm', 3, 'Gathered Swarm', 'Once per turn on a hit, your swarm deals 1d6 piercing damage, pushes the target 15 feet, or moves you 5 feet.'],
        ['writhingTide', 7, 'Writhing Tide', 'Bonus action: fly at 10 feet for a minute, proficiency bonus times per long rest.'],
        ['mightySwarm', 11, 'Mighty Swarm', 'Gathered Swarm deals 1d8, knocks prone, or grants half cover.'],
        ['swarmingDispersal', 15, 'Swarming Dispersal', 'Reaction: resist damage and teleport 30 feet, proficiency bonus times per long rest.'],
      ],
    },
  },

  rogue: {
    arcaneTrickster: {
      name: 'Arcane Trickster', source: 'PHB', desc: 'Rogues who learn enchantment and illusion magic to aid their thievery.',
      spellcasting: third(['enchantment', 'illusion']),
      cantrips: ['mageHand'],
      features: [
        ['atSpellcasting', 3, 'Spellcasting', 'Learn Mage Hand and wizard spells, mostly enchantment and illusion, cast with Intelligence.'],
        ['mageHandLegerdemain', 3, 'Mage Hand Legerdemain', 'Your mage hand is invisible and can pick pockets and locks.'],
        ['magicalAmbush', 9, 'Magical Ambush', 'Creatures have disadvantage on saves against your spells while you are hidden.'],
        ['versatileTrickster', 13, 'Versatile Trickster', 'Your mage hand distracts a creature, giving you advantage on attacks against it.'],
        ['spellThief', 17, 'Spell Thief', 'Reaction: steal a spell cast at you if the caster fails a save, and cast it yourself for 8 hours.'],
      ],
    },
    inquisitive: {
      name: 'Inquisitive', source: 'XGtE', desc: 'Investigators who read lies and find a foe\'s weak spot.',
      features: [
        ['earForDeceit', 3, 'Ear for Deceit', 'Treat a d20 roll of 7 or lower as 8 on Insight checks to spot lies.'],
        ['eyeForDetail', 3, 'Eye for Detail', 'Bonus action: search for hidden things or decipher clues.'],
        ['insightfulFighting', 3, 'Insightful Fighting', 'Bonus action: an Insight check against a creature lets you Sneak Attack it without advantage for a minute.'],
        ['steadyEye', 9, 'Steady Eye', 'Advantage on Perception and Investigation if you move no more than half your speed.'],
        ['unerringEye', 13, 'Unerring Eye', 'Sense illusions and shapechangers within 30 feet, Wisdom modifier times per long rest.'],
        ['eyeForWeakness', 17, 'Eye for Weakness', 'Sneak Attack against your Insightful Fighting target deals 3d6 more.'],
      ],
    },
    mastermind: {
      name: 'Mastermind', source: 'XGtE', desc: 'Schemers who help allies from a distance and mimic anyone.',
      features: [
        ['masterOfIntrigue', 3, 'Master of Intrigue', 'Disguise kit, forgery kit, a gaming set and two languages; mimic accents.'],
        ['masterOfTactics', 3, 'Master of Tactics', 'Help as a bonus action, and from up to 30 feet away.'],
        ['insightfulManipulator', 9, 'Insightful Manipulator', 'Study a creature for a minute to compare its mental scores and levels to yours.'],
        ['misdirection', 13, 'Misdirection', 'Reaction: redirect an attack aimed at you to a creature providing you cover.'],
        ['soulOfDeceit', 17, 'Soul of Deceit', 'Your thoughts cannot be read and magic cannot detect your lies.'],
      ],
    },
    scout: {
      name: 'Scout', source: 'XGtE', desc: 'Skirmishers and trackers who move ahead of the party.',
      features: [
        ['skirmisher', 3, 'Skirmisher', 'Reaction: move half your speed when an enemy ends its turn within 5 feet, without provoking.'],
        ['survivalist', 3, 'Survivalist', 'Proficiency and expertise in Nature and Survival.'],
        ['superiorMobility', 9, 'Superior Mobility', '+10 feet of walking speed (and climbing and swimming).'],
        ['ambushMaster', 13, 'Ambush Master', 'Advantage on initiative; the first creature you hit in a fight is easier for everyone to hit.'],
        ['suddenStrike', 17, 'Sudden Strike', 'After the Attack action, attack again as a bonus action, with a second Sneak Attack against another target.'],
      ],
    },
    swashbuckler: {
      name: 'Swashbuckler', source: 'XGtE', desc: 'Duelists who dance in and out of melee with panache.',
      features: [
        ['fancyFootwork', 3, 'Fancy Footwork', 'A creature you attack in melee cannot make opportunity attacks against you that turn.'],
        ['rakishAudacity', 3, 'Rakish Audacity', 'Add Charisma to initiative, and Sneak Attack a lone adjacent foe without advantage.'],
        ['panache', 9, 'Panache', 'Persuasion charms a creature, or taunts a hostile one into fighting only you.'],
        ['elegantManeuver', 13, 'Elegant Maneuver', 'Bonus action: advantage on your next Acrobatics or Athletics check.'],
        ['masterDuelist', 17, 'Master Duelist', 'Reroll a missed attack with advantage, once per short rest.'],
      ],
    },
    phantom: {
      name: 'Phantom', source: 'TCE', desc: 'Rogues who walk with ghosts and draw power from the dead.',
      features: [
        ['whispersOfTheDead', 3, 'Whispers of the Dead', 'After each rest, gain proficiency in a skill or tool of your choice.'],
        ['wailsFromTheGrave', 3, 'Wails from the Grave', 'After a Sneak Attack, a second creature within 30 feet takes half the Sneak Attack dice as necrotic damage, proficiency bonus times per long rest.'],
        ['tokensOfTheDeparted', 9, 'Tokens of the Departed', 'Make soul trinkets from the dying: advantage on death and Constitution saves, and spend them to question spirits or wail without cost.'],
        ['ghostWalk', 13, 'Ghost Walk', 'Become spectral for 10 minutes: fly, move through objects, and attacks against you have disadvantage.'],
        ['deathsFriend', 17, "Death's Friend", 'Wails from the Grave also hits the Sneak Attack target, and you always regain a soul trinket.'],
      ],
      resources: l => ({ wailsFromTheGrave: { name: 'Wails from the Grave', max: pb(l), recharge: 'long' } }),
    },
    soulknife: {
      name: 'Soulknife', source: 'TCE', desc: 'Psionic rogues who manifest blades of psychic energy.',
      features: [
        ['psionicPowerRogue', 3, 'Psionic Power', 'Psionic energy dice (d6, twice your proficiency bonus) power Psi-Bolstered Knack and Psychic Whispers.'],
        ['psychicBlades', 3, 'Psychic Blades', 'Manifest a blade of psychic energy (1d6, finesse, thrown) and a bonus-action second blade (1d4).'],
        ['soulBlades', 9, 'Soul Blades', 'Spend a die to add it to a missed blade attack, or teleport with a thrown blade.'],
        ['psychicVeil', 13, 'Psychic Veil', 'Become invisible for an hour, once per long rest or for a die.'],
        ['rendMind', 17, 'Rend Mind', 'A Sneak Attack with your blade stuns the target on a failed Wisdom save.'],
      ],
      resources: l => ({ psionicEnergyRogue: { name: 'Psionic Energy (d6+)', max: pb(l) * 2, recharge: 'long' } }),
    },
  },

  sorcerer: {
    divineSoul: {
      name: 'Divine Soul', source: 'XGtE', desc: 'Sorcerers with a spark of the divine who also draw on cleric magic.',
      expandedFrom: 'cleric',
      features: [
        ['divineMagic', 1, 'Divine Magic', 'Cleric spells count as sorcerer spells for you, and you learn an affinity spell (Cure Wounds, Bless, Inflict Wounds or Protection from Evil and Good).'],
        ['favoredByTheGods', 1, 'Favored by the Gods', 'Add 2d4 to a failed save or missed attack, once per short rest.'],
        ['empoweredHealing', 6, 'Empowered Healing', 'Spend 1 sorcery point to reroll healing dice.'],
        ['otherworldlyWings', 14, 'Otherworldly Wings', 'Sprout wings for a flying speed of 30 feet.'],
        ['unearthlyRecovery', 18, 'Unearthly Recovery', 'Bonus action: regain half your hit points when below half, once per long rest.'],
      ],
      resources: l => ({
        favoredByTheGods: { name: 'Favored by the Gods', max: 1, recharge: 'short' },
        unearthlyRecovery: { name: 'Unearthly Recovery', max: l >= 18 ? 1 : 0, recharge: 'long' },
      }),
    },
    shadowMagic: {
      name: 'Shadow Magic', source: 'XGtE', desc: 'Sorcerers born of the Shadowfell who resist death and call a hound of ill omen.',
      domainSpells: { 3: ['darkness'] },
      features: [
        ['eyesOfTheDark', 1, 'Eyes of the Dark', 'Darkvision 120 feet; cast Darkness with 2 sorcery points and see through it.'],
        ['strengthOfTheGrave', 1, 'Strength of the Grave', 'When reduced to 0 hit points (not by radiant damage or a crit), a Charisma save drops you to 1 instead, once per long rest.'],
        ['houndOfIllOmen', 6, 'Hound of Ill Omen', 'Spend 3 sorcery points to summon a dire wolf hound that hunts a target, which has disadvantage against your spells.'],
        ['shadowWalk', 14, 'Shadow Walk', 'Teleport 120 feet between areas of dim light or darkness as a bonus action.'],
        ['umbralForm', 18, 'Umbral Form', 'Spend 6 sorcery points: resist all damage but force and radiant, and move through objects for a minute.'],
      ],
      resources: () => ({ strengthOfTheGrave: { name: 'Strength of the Grave', max: 1, recharge: 'long' } }),
    },
    stormSorcery: {
      name: 'Storm Sorcery', source: 'XGtE', desc: 'Sorcerers of wind and lightning who fly on the gale.',
      features: [
        ['windSpeaker', 1, 'Wind Speaker', 'You speak Primordial and its dialects.'],
        ['tempestuousMagic', 1, 'Tempestuous Magic', 'Bonus action after casting a leveled spell: fly 10 feet without provoking.'],
        ['heartOfTheStorm', 6, 'Heart of the Storm', 'Resistance to lightning and thunder; your lightning and thunder spells shock nearby creatures for half your level.'],
        ['stormGuide', 6, 'Storm Guide', 'Calm or steer the rain and wind around you.'],
        ['stormsFury', 14, "Storm's Fury", 'Reaction when hit in melee: lightning damage equal to your level, and a Strength save or be pushed 20 feet.'],
        ['windSoul', 18, 'Wind Soul', 'Immunity to lightning and thunder, and a flying speed of 60 feet you can share.'],
      ],
      resist: [{ level: 6, types: ['lightning', 'thunder'] }],
    },
    aberrantMind: {
      name: 'Aberrant Mind', source: 'TCE', desc: 'Sorcerers marked by an alien influence who wield psionic spells.',
      domainSpells: { 1: ['armsOfHadar', 'dissonantWhispers', 'mindSliver'], 3: ['calmEmotions', 'detectThoughts'], 5: ['hungerOfHadar', 'sending'], 7: ['blackTentacles', 'summonAberration'], 9: ['telepathicBond', 'telekinesis'] },
      features: [
        ['psionicSpells', 1, 'Psionic Spells', 'Learn extra psionic spells (Arms of Hadar, Dissonant Whispers, Mind Sliver and more as you level).'],
        ['telepathicSpeech', 1, 'Telepathic Speech', 'Speak telepathically with a creature for minutes equal to your sorcerer level.'],
        ['psionicSorcery', 6, 'Psionic Sorcery', 'Cast psionic spells with sorcery points instead of slots, without components.'],
        ['psychicDefenses', 6, 'Psychic Defenses', 'Resistance to psychic damage and advantage against charm and fear.'],
        ['revelationInFlesh', 14, 'Revelation in Flesh', 'Spend sorcery points to see the invisible, fly, swim or squeeze through gaps.'],
        ['warpingImplosion', 18, 'Warping Implosion', 'Teleport and pull creatures where you left, dealing 3d10 force damage.'],
      ],
      resist: [{ level: 6, types: ['psychic'] }],
    },
    clockworkSoul: {
      name: 'Clockwork Soul', source: 'TCE', desc: 'Sorcerers touched by the cosmic order of Mechanus.',
      domainSpells: { 1: ['alarm', 'protectionFromEvilAndGood'], 3: ['aid', 'lesserRestoration'], 5: ['dispelMagic', 'protectionFromEnergy'], 7: ['freedomOfMovement', 'summonConstruct'], 9: ['greaterRestoration', 'wallOfForce'] },
      features: [
        ['clockworkMagic', 1, 'Clockwork Magic', 'Learn extra spells of order (Alarm, Protection from Evil and Good and more as you level).'],
        ['restoreBalance', 1, 'Restore Balance', 'Reaction: cancel advantage or disadvantage on a roll, proficiency bonus times per long rest.'],
        ['bastionOfLaw', 6, 'Bastion of Law', 'Spend sorcery points to ward a creature with d8s that absorb damage.'],
        ['tranceOfOrder', 14, 'Trance of Order', 'For a minute: attacks cannot have advantage against you, and your d20 rolls of 9 or lower count as 10.'],
        ['clockworkCavalcade', 18, 'Clockwork Cavalcade', 'Summon spirits of order to heal 100 hit points, repair objects and end spells.'],
      ],
      resources: l => ({ restoreBalance: { name: 'Restore Balance', max: pb(l), recharge: 'long' } }),
    },
  },

  warlock: {
    archfey: {
      name: 'The Archfey', source: 'PHB', desc: 'A pact with a lord or lady of the fey: charm, fear and misty escapes.',
      expandedSpells: { 1: ['faerieFire', 'sleep'], 3: ['calmEmotions', 'phantasmalForce'], 5: ['blink', 'plantGrowth'], 7: ['dominateBeast', 'greaterInvisibility'], 9: ['dominatePerson', 'seeming'] },
      features: [
        ['feyPresence', 1, 'Fey Presence', 'Creatures in a 10-foot cube make Wisdom saves or are charmed or frightened until your next turn, once per short rest.'],
        ['mistyEscape', 6, 'Misty Escape', 'Reaction when damaged: turn invisible and teleport 60 feet, once per short rest.'],
        ['beguilingDefenses', 10, 'Beguiling Defenses', 'Immune to charm, and turn charm attempts back on the caster.'],
        ['darkDelirium', 14, 'Dark Delirium', 'A creature is charmed or frightened in an illusory realm for a minute (Wisdom save).'],
      ],
      resources: l => ({
        feyPresence: { name: 'Fey Presence', max: 1, recharge: 'short' },
        mistyEscape: { name: 'Misty Escape', max: l >= 6 ? 1 : 0, recharge: 'short' },
      }),
    },
    celestial: {
      name: 'The Celestial', source: 'XGtE', desc: 'A pact with a being of the Upper Planes: radiant light and healing.',
      cantrips: ['light', 'sacredFlame'],
      expandedSpells: { 1: ['cureWounds', 'guidingBolt'], 3: ['flamingSphere', 'lesserRestoration'], 5: ['daylight', 'revivify'], 7: ['guardianOfFaith', 'wallOfFire'], 9: ['flameStrike', 'greaterRestoration'] },
      features: [
        ['bonusCantripsCelestial', 1, 'Bonus Cantrips', 'You know Light and Sacred Flame.'],
        ['healingLight', 1, 'Healing Light', 'A pool of d6s (1 + warlock level): as a bonus action spend up to your Charisma modifier of them to heal a creature within 60 feet.'],
        ['radiantSoul', 6, 'Radiant Soul', 'Resistance to radiant damage, and add Charisma to one fire or radiant damage roll of each spell.'],
        ['celestialResilience', 10, 'Celestial Resilience', 'After a rest, you and up to five creatures gain temporary hit points.'],
        ['searingVengeance', 14, 'Searing Vengeance', 'When you make a death save, rise with half your hit points and blind nearby foes, once per long rest.'],
      ],
      resist: [{ level: 6, types: ['radiant'] }],
      resources: l => ({ healingLight: { name: 'Healing Light (d6)', max: 1 + l, recharge: 'long' } }),
    },
    hexblade: {
      name: 'The Hexblade', source: 'XGtE', desc: 'A pact with a sentient weapon of the Shadowfell: curses and armed prowess.',
      armor: ['medium', 'shield'], weapons: ['martial'],
      expandedSpells: { 1: ['shield', 'wrathfulSmite'], 3: ['blur', 'brandingSmite'], 5: ['blink', 'elementalWeapon'], 7: ['phantasmalKiller', 'staggeringSmite'], 9: ['banishingSmite', 'coneOfCold'] },
      features: [
        ['hexbladesCurse', 1, "Hexblade's Curse", 'Bonus action, once per short rest: curse a creature; add your proficiency bonus to damage against it, crit on 19-20, and regain hit points when it dies.'],
        ['hexWarrior', 1, 'Hex Warrior', 'Medium armor, shields and martial weapons; use Charisma for attacks with one chosen weapon (or your pact weapon).'],
        ['accursedSpecter', 6, 'Accursed Specter', 'Raise the spirit of a humanoid you kill as a specter that serves you, once per long rest.'],
        ['armorOfHexes', 10, 'Armor of Hexes', 'Reaction: an attack from your cursed target misses on a d6 roll of 4 or higher.'],
        ['masterOfHexes', 14, 'Master of Hexes', 'Move your curse to a new creature when the old target dies.'],
      ],
      resources: l => ({
        hexbladesCurse: { name: "Hexblade's Curse", max: 1, recharge: 'short' },
        accursedSpecter: { name: 'Accursed Specter', max: l >= 6 ? 1 : 0, recharge: 'long' },
      }),
    },
    fathomless: {
      name: 'The Fathomless', source: 'TCE', desc: 'A pact with an entity of the deep: tentacles and the cold of the sea.',
      expandedSpells: { 1: ['createOrDestroyWater', 'thunderwave'], 3: ['gustOfWind', 'silence'], 5: ['lightningBolt', 'sleetStorm'], 7: ['controlWater', 'summonElemental'], 9: ['blackTentacles', 'conjureElemental'] },
      features: [
        ['tentacleOfTheDeeps', 1, 'Tentacle of the Deeps', 'Bonus action, proficiency bonus times per long rest: a spectral tentacle strikes for 1d8 cold damage and slows its target.'],
        ['giftOfTheSea', 1, 'Gift of the Sea', 'A swimming speed of 40 feet and water breathing.'],
        ['oceanicSoul', 6, 'Oceanic Soul', 'Resistance to cold damage, and underwater speech.'],
        ['guardianCoil', 6, 'Guardian Coil', 'Reaction: your tentacle reduces damage to a creature near it by 1d8.'],
        ['graspingTentacles', 10, 'Grasping Tentacles', 'Evard\'s Black Tentacles is always known and castable without a slot once per long rest.'],
        ['fathomlessPlunge', 14, 'Fathomless Plunge', 'Teleport yourself and up to five creatures to a body of water, once per short rest.'],
      ],
      resist: [{ level: 6, types: ['cold'] }],
      resources: l => ({ tentacleOfTheDeeps: { name: 'Tentacle of the Deeps', max: pb(l), recharge: 'long' } }),
    },
    genie: {
      name: 'The Genie', source: 'TCE', desc: 'A pact with a noble genie: a vessel to rest in and elemental wrath.',
      expandedSpells: { 1: ['detectEvilAndGood'], 3: ['phantasmalForce'], 5: ['createFoodAndWater'], 7: ['phantasmalKiller'], 9: ['creation'] },
      features: [
        ['geniesVessel', 1, "Genie's Vessel", 'A vessel you can retreat into, and Genie\'s Wrath: once per turn a hit deals extra damage equal to your proficiency bonus of your patron\'s type.'],
        ['elementalGift', 6, 'Elemental Gift', 'Resistance to your patron\'s damage type, and a flying speed for 10 minutes proficiency bonus times per long rest.'],
        ['sanctuaryVessel', 10, 'Sanctuary Vessel', 'Bring up to five creatures into your vessel, where an hour heals like a short rest.'],
        ['limitedWish', 14, 'Limited Wish', 'Duplicate any spell of 6th level or lower with an action, once per 1d4 long rests.'],
      ],
      strike: { level: 1, dice: l => String(pb(l)), type: 'fire', label: "Genie's Wrath" },
      resources: l => ({ elementalGift: { name: 'Elemental Gift (flight)', max: l >= 6 ? pb(l) : 0, recharge: 'long' } }),
    },
  },

  wizard: {
    conjuration: {
      name: 'School of Conjuration', source: 'PHB', desc: 'Summoners who create objects and teleport at will.',
      features: [
        ['minorConjuration', 2, 'Minor Conjuration', 'Conjure a small nonmagical object for an hour.'],
        ['benignTransposition', 6, 'Benign Transposition', 'Teleport up to 30 feet, or swap places with an ally.'],
        ['focusedConjuration', 10, 'Focused Conjuration', 'Damage cannot break your concentration on conjuration spells.'],
        ['durableSummons', 14, 'Durable Summons', 'Creatures you summon gain 30 temporary hit points.'],
      ],
    },
    divination: {
      name: 'School of Divination', source: 'PHB', desc: 'Seers who replace rolls with portents glimpsed in advance.',
      features: [
        ['portent', 2, 'Portent', 'After each long rest roll two d20s (three at 14th) and use them to replace any attack, check or save you can see.'],
        ['expertDivination', 6, 'Expert Divination', 'Casting a divination spell of 2nd level or higher restores a lower-level slot.'],
        ['theThirdEye', 10, 'The Third Eye', 'Gain darkvision, ethereal sight, the ability to read any language, or see invisibility until a rest.'],
        ['greaterPortent', 14, 'Greater Portent', 'Roll three dice for Portent.'],
      ],
      resources: l => ({ portent: { name: 'Portent dice', max: l >= 14 ? 3 : 2, recharge: 'long' } }),
    },
    enchantment: {
      name: 'School of Enchantment', source: 'PHB', desc: 'Manipulators of mind and emotion.',
      features: [
        ['hypnoticGaze', 2, 'Hypnotic Gaze', 'A creature next to you makes a Wisdom save or is charmed and incapacitated while you maintain the gaze.'],
        ['instinctiveCharm', 6, 'Instinctive Charm', 'Reaction: an attacker must make a Wisdom save or target someone else.'],
        ['splitEnchantment', 10, 'Split Enchantment', 'Single-target enchantment spells can target a second creature.'],
        ['alterMemories', 14, 'Alter Memories', 'A charmed creature forgets it was charmed, and loses hours of memories.'],
      ],
    },
    illusion: {
      name: 'School of Illusion', source: 'PHB', desc: 'Weavers of illusions so real they become partly true.',
      cantrips: ['minorIllusion'],
      features: [
        ['improvedMinorIllusion', 2, 'Improved Minor Illusion', 'You know Minor Illusion, and it can create a sound and an image together.'],
        ['malleableIllusions', 6, 'Malleable Illusions', 'Change your lasting illusions as an action.'],
        ['illusorySelf', 10, 'Illusory Self', 'Reaction: an illusory duplicate makes an attack miss, once per short rest.'],
        ['illusoryReality', 14, 'Illusory Reality', 'Make one object in your illusion real for a minute.'],
      ],
      resources: l => ({ illusorySelf: { name: 'Illusory Self', max: l >= 10 ? 1 : 0, recharge: 'short' } }),
    },
    necromancy: {
      name: 'School of Necromancy', source: 'PHB', desc: 'Masters of life and death who feed on the foes they slay.',
      features: [
        ['grimHarvest', 2, 'Grim Harvest', 'When your spell kills a creature, regain twice the spell\'s level in hit points (three times for necromancy).'],
        ['undeadThralls', 6, 'Undead Thralls', 'Animate Dead raises an extra corpse, and your undead gain hit points and add your proficiency bonus to damage.'],
        ['inuredToUndeath', 10, 'Inured to Undeath', 'Resistance to necrotic damage; your hit point maximum cannot be reduced.'],
        ['commandUndead', 14, 'Command Undead', 'Bring an undead creature under your control (Charisma save).'],
      ],
      resist: [{ level: 10, types: ['necrotic'] }],
    },
    transmutation: {
      name: 'School of Transmutation', source: 'PHB', desc: 'Alchemists who reshape matter and carry a transmuter\'s stone.',
      features: [
        ['minorAlchemy', 2, 'Minor Alchemy', 'Transform wood, stone, iron, copper or silver into another of them for an hour.'],
        ['transmutersStone', 6, "Transmuter's Stone", 'A stone that grants darkvision, speed, a save proficiency or an energy resistance to its bearer.'],
        ['shapechanger', 10, 'Shapechanger', 'Polymorph yourself into a beast of CR 1 or lower without a slot, once per short rest.'],
        ['masterTransmuter', 14, 'Master Transmuter', 'Destroy your stone to transmute matter, cure ailments, restore youth or raise the dead.'],
      ],
    },
    warMagic: {
      name: 'War Magic', source: 'XGtE', desc: 'Battle mages who blend abjuration and evocation on the field.',
      features: [
        ['arcaneDeflection', 2, 'Arcane Deflection', 'Reaction: +2 AC against an attack or +4 to a save; you can only cast cantrips until your next turn ends.'],
        ['tacticalWit', 2, 'Tactical Wit', 'Add your Intelligence modifier to initiative.'],
        ['powerSurge', 6, 'Power Surge', 'Store surges by countering or dispelling spells; spend one to add half your wizard level as force damage.'],
        ['durableMagic', 10, 'Durable Magic', '+2 AC and saving throws while you concentrate on a spell.'],
        ['deflectingShroud', 14, 'Deflecting Shroud', 'Arcane Deflection blasts up to three creatures within 60 feet with force damage.'],
      ],
    },
    bladesinging: {
      name: 'Bladesinging', source: 'TCE', desc: 'Elven-taught warrior-mages who dance with blade and spell.',
      armor: ['light'], weapons: ['rapier', 'longsword', 'scimitar', 'shortsword'], extraAttack: 6,
      features: [
        ['trainingInWarAndSong', 2, 'Training in War and Song', 'Light armor, the one-handed blades (rapier, longsword, scimitar, shortsword), and Performance.'],
        ['bladesong', 2, 'Bladesong', 'Bonus action, proficiency bonus times per long rest, for a minute: add Intelligence to AC and concentration saves, +10 speed and advantage on Acrobatics.'],
        ['extraAttack', 6, 'Extra Attack', 'Attack twice when you take the Attack action; a cantrip can replace one attack.'],
        ['songOfDefense', 10, 'Song of Defense', 'Reaction while bladesinging: expend a spell slot to reduce damage by five times its level.'],
        ['songOfVictory', 14, 'Song of Victory', 'While bladesinging, add Intelligence to melee weapon damage.'],
      ],
      resources: l => ({ bladesong: { name: 'Bladesong', max: pb(l), recharge: 'long' } }),
    },
    scribes: {
      name: 'Order of Scribes', source: 'TCE', desc: 'Wizards whose awakened spellbook bends their spells.',
      features: [
        ['wizardlyQuill', 2, 'Wizardly Quill', 'A magic quill that copies spells into your book in 2 minutes per level.'],
        ['awakenedSpellbook', 2, 'Awakened Spellbook', 'Swap a spell\'s damage type for another from your book, and ritual-cast in normal time once per long rest.'],
        ['manifestMind', 6, 'Manifest Mind', 'Your book\'s spirit appears; see and hear through it and cast spells from its space.'],
        ['masterScrivener', 10, 'Master Scrivener', 'Write a scroll of a 1st or 2nd-level spell from your book that casts one level higher.'],
        ['oneWithTheWord', 14, 'One with the Word', 'Advantage on Arcana checks; your book can absorb damage at the cost of spells.'],
      ],
    },
  },
};

// the subclasses each class started with, labelled by source
export const BASE_SOURCES = {
  berserker: 'SRD', totemWarrior: 'PHB', lore: 'SRD', valor: 'PHB', life: 'SRD', lightDomain: 'PHB', land: 'SRD', moon: 'PHB', champion: 'SRD', battleMaster: 'PHB',
  openHand: 'SRD', shadow: 'PHB', devotion: 'SRD', vengeance: 'PHB', hunter: 'SRD', beastMaster: 'PHB', thief: 'SRD', assassin: 'PHB', draconic: 'SRD', wildMagic: 'PHB',
  fiend: 'SRD', greatOldOne: 'PHB', evocation: 'SRD', abjuration: 'PHB',
};

export { ALL_DAMAGE };
