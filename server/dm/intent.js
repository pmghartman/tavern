// what a player's plain words ask of the rules, and what the DM's reply must not give away.
// These run around the model so a check is rolled and a fight starts even when it forgets.
import { MONSTERS, findMonsterKey } from '../engine/data/monsters.js';
import { SKILLS } from '../engine/data/core.js';

// what the player's character does, with speech in quotes left out ("what the devil happened here")
const deeds = text => String(text ?? '').replace(/["“][^"”]*["”]/g, ' ');

// action words that call for a roll, by skill
const CHECK_WORDS = [
  ['investigation', /\b(?:investigat\w*|examin\w*|inspect\w*|stud(?:y|ies|ying)|analy[sz]\w*|search(?:es|ing)? (?:the |through |his |her |their |its )?(?:bod(?:y|ies)|corpses?|cart|wagon|wreck\w*|room|desk|chest|pack|bags?|saddlebags?|pockets?|remains|ruins?|rubble|area for clues)|look (?:closely|closer) at|check (?:the )?(?:arrows?|tracks|wounds?|bod(?:y|ies)))\b/i],
  ['perception', /\b(?:scan\w*|search(?:es|ing)? (?:for|around|the (?:area|woods|trees|treeline|brush|bushes|surroundings|perimeter|road|trail|horizon|shadows))|look(?:s|ing)? (?:around|out|for)|keep(?:s|ing)? (?:an? )?(?:eye|watch|lookout)|watch(?:es|ing)? (?:for|the)|listen\w*|spot\w*|peer\w*|survey\w*|on (?:the )?lookout|notice anything|perceive)\b/i],
  ['survival', /\b(?:track(?:s|ing)? (?:the|them|it|him|her)|follow(?:s|ing)? (?:the )?(?:tracks|trail|footprints)|forag\w*|hunt for food)\b/i],
  ['medicine', /\b(?:stabili[sz]\w*|check(?:s|ing)? (?:the |his |her )?(?:pulse|wounds?)|tend(?:s|ing)? (?:to )?(?:the |his |her )?wounds?|(?:examine|look at) the wounds?)\b/i],
  ['athletics', /\b(?:climb\w*|swim\w*|jump\w* (?:across|over|the)|leap\w* (?:across|over)|shove|force (?:the |it )?open|push(?:es|ing)? (?:the |it )?(?:boulder|cart|wagon|door|rock))\b/i],
  ['stealth', /\b(?:sneak\w*|creep\w*|hide|hides|hiding|stay(?:s|ing)? (?:hidden|quiet|out of sight)|move(?:s)? (?:quietly|silently|stealthily))\b/i],
];
// "sleightOfHand" -> "sleight of hand"
const SKILL_NAMES = Object.keys(SKILLS).map(k => [k, k.replace(/[A-Z]/g, c => ` ${c.toLowerCase()}`)]);
// "I roll for perception", "roll an investigation check", "make a stealth check"
function askedSkill(t) {
  const after = /\broll(?:s|ing)?\s+(?:(?:an?|for|my)\s+)*(.*)/i.exec(t)?.[1]?.toLowerCase();
  const named = after && SKILL_NAMES.find(([, n]) => after.startsWith(n));
  if (named) return named[0];
  return SKILL_NAMES.find(([, n]) => new RegExp(`\\b${n} check\\b`, 'i').test(t))?.[0] ?? null;
}

// skills the player's words call for, at most two, in the order they come up
export function checkIntents(text) {
  const t = deeds(text);
  const hits = [];
  const asked = askedSkill(t);
  if (asked) hits.push({ skill: asked, at: -1 });
  for (const [skill, re] of CHECK_WORDS) {
    const m = re.exec(t);
    if (m && !hits.some(h => h.skill === skill)) hits.push({ skill, at: m.index });
  }
  return hits.sort((a, b) => a.at - b.at).slice(0, 2).map(h => h.skill);
}

// the player starts or joins a fight
const ATTACK = /(?:^\s*\/(?:attack|combat|fight|initiative)\b|^\s*(?:attack|fight|charge|strike)\b|\b(?:i|we|let'?s)\s+(?:\w+\s+){0,2}?(?:attack|strike|shoot|fire (?:at|an arrow|my)|charge|swing|stab|slash|smite|punch|kick|fight|ambush|draw (?:my|our) (?:weapons?|swords?|axes?|bows?))\b|\b(?:roll|start) (?:for )?(?:initiative|combat)\b|\bcan we (?:attack|fight)\b)/i;
export const attackIntent = text => ATTACK.test(deeds(text));

// narration that says a fight has started
const COMBAT_START = /\b(?:combat begins|roll (?:for )?initiative|initiative order|(?:spring|leap|burst|rush)s? (?:into action|from (?:the|their) (?:woods|brush|bushes|trees|thickets?|shadows|cover|hiding))|(?:shout|scream|howl)s? (?:a )?war ?cr(?:y|ies)|(?:charge|rush|attack|ambush)(?:es|s)? (?:at |toward |towards )?(?:the party|you)\b)\b/i;
export const narratesCombatStart = text => COMBAT_START.test(String(text ?? ''));

// sentences that claim a fight began, for when the rules have not started one
export function stripCombatClaims(text) {
  return eachSentence(text, s => !/\b(?:combat begins|roll (?:for )?initiative|you are ready to fight|ready to fight)\b/i.test(s));
}

// blows the story lands on its own: in the reply that starts a fight no attack has been rolled yet
const BLOW = /\b(?:you take|takes? \d+|\d+\s*(?:points? of )?damage|\d*d\d+(?:\s*[+-]\s*\d+)?|(?:piercing|slashing|bludgeoning|fire|cold|poison) damage|(?:attack|arrow|bolt|blade|blow|shot|strike|swing)s? (?:lands?|hits?|connects?|finds? (?:its|their) mark|strikes?|misses|goes wide|sails (?:past|wide|harmlessly))|(?:hits|strikes|wounds|pierces|slashes|stabs|misses) (?:you|him|her|them)\b|the (?:attack|shot) (?:lands|misses))/i;
export function stripAttackClaims(text) {
  return eachSentence(text, s => !BLOW.test(s));
}

const NUMBER = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, several: 3, some: 3, few: 3 };
// "4 goblins, 1 wolf" or "four goblins and a bugbear" -> [{ key, count }]
export function parseCreatures(text) {
  const out = [];
  for (const part of String(text ?? '').split(/,|;|\band\b|\bplus\b/i)) {
    const m = /^\s*(\d+|[a-z]+)?\s*(.+?)\s*(?:\(.*)?$/i.exec(part);
    if (!m) continue;
    const n = m[1] && (/^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER[m[1].toLowerCase()]);
    const name = n ? m[2] : `${m[1] ?? ''} ${m[2]}`.trim();
    const key = findMonsterKey(name) ?? findMonsterKey(name.split(/\s+/).pop());
    if (key) out.push({ key, count: Math.min(20, n || 1) });
  }
  return out;
}

const LURKS = /\b(?:hid(?:e|es|den|ing)|conceal\w*|ambush\w*|lie in wait|lying in wait|lurk\w*|wait(?:s|ing)? (?:in|for|until)|watch(?:es|ing)? from|unseen|in the (?:brush|thickets?|woods|trees|shadows))\b/i;
// the scene's encounters that lie in wait, with the Stealth DC to spot them (10 + their best Stealth)
export function hiddenEncounters(brief) {
  const out = [];
  for (const [index, e] of (brief?.encounters ?? []).entries()) {
    if (!LURKS.test(`${e.creatures} ${e.where ?? ''} ${e.when ?? ''}`)) continue;
    const creatures = parseCreatures(e.creatures);
    if (!creatures.length) continue;
    const stealth = Math.max(...creatures.map(c => {
      const mon = MONSTERS[c.key];
      return mon?.skills?.stealth ?? Math.floor(((mon?.abilities?.[1] ?? 10) - 10) / 2);
    }));
    out.push({ ...e, index, monsters: creatures, dc: 10 + stealth });
  }
  return out;
}

const SENTENCE = /[^.!?]*[.!?]+["”'’)*_]*\s*|[^.!?]+$/g;
function eachSentence(text, keep) {
  return String(text ?? '').split('\n').map(line => {
    if (line.trimStart().startsWith('>>')) return line;
    return (line.match(SENTENCE) ?? [line]).filter(keep).join('').trimEnd();
  }).filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim())).join('\n').trim();
}

// the DM's own knowledge said out loud: hidden creatures and their plans
const HIDDEN_STATE = /\b(?:is|are|remains?|stay|stays|lie|lies|lay|lurk\w*|wait\w*|crouch\w*|still)\b[^.!?]{0,40}\b(?:hidden|hiding|concealed|unseen|undetected|unnoticed|in wait|in ambush|out of sight)\b/i;
const PLANS = /\b(?:wait(?:s|ing)? for (?:the|their|a|an) (?:perfect|right|best|ideal|opportune) (?:moment|time|chance|opportunity)|waiting for the (?:party|adventurers|heroes|characters)|watching the (?:party|adventurers|heroes|characters)|ready to (?:strike|pounce|spring|ambush)|plan(?:s|ning)? to (?:ambush|attack|strike)|unaware (?:of|that) (?:the )?(?:goblins?|ambush|creatures?|enemies))\b/i;
const RECAP = /^\s*(?:the party|the adventurers|the characters|the heroes) (?:is|are|stands?|remains?|has|have|now|still)\b/i;
const CREATURE_WORDS = /\b(?:they|enemies|ambushers|attackers|figures|creatures|bandits|raiders|archers|monsters)\b/i;
const SEEN = /\b(?:you|your|you're|you've)\b/i;
// creature names that are also everyday words ("hidden in shadow", "the horses are hidden by brush")
const PLAIN_WORDS = /^(?:the|and|bat|bats|cat|cats|rat|rats|ape|owl|elk|imp|shadows?|horses?|mules?|ponies|pony|ox|oxen|swarm)$/i;
const mentionsCreature = s => CREATURE_WORDS.test(s) || s.split(/[^A-Za-z]+/).some(w => w.length > 2 && !PLAIN_WORDS.test(w) && !!findMonsterKey(w));

// a reply that only reads the table state back ("The party is on the Triboar Trail.")
export const isRecap = text => {
  const parts = (String(text ?? '').match(SENTENCE) ?? []).filter(p => p.trim());
  return parts.length > 0 && parts.every(p => RECAP.test(p));
};

// narration with the sentences only the DM could know taken out; dropped counts what went
export function stripDmKnowledge(text) {
  let dropped = 0;
  const kept = eachSentence(text, s => {
    const leak = PLANS.test(s) || (HIDDEN_STATE.test(s) && !SEEN.test(s) && mentionsCreature(s));
    if (leak) dropped += 1;
    return !leak;
  });
  return { text: kept, dropped };
}
