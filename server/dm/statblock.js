// 5e stat blocks found in a book's text and read field by field, so most of a
// module's creatures need no model at all; what this can't read goes to the model
import { CONDITIONS, DAMAGE_TYPES } from '../engine/data/core.js';

const SIZES = 'Tiny|Small|Medium|Large|Huge|Gargantuan';
const TYPES = ['aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead'];
const ABIL = { str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha', strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
const SKILL_KEYS = { acrobatics: 'acrobatics', 'animal handling': 'animalHandling', arcana: 'arcana', athletics: 'athletics', deception: 'deception', history: 'history', insight: 'insight', intimidation: 'intimidation', investigation: 'investigation', medicine: 'medicine', nature: 'nature', perception: 'perception', performance: 'performance', persuasion: 'persuasion', religion: 'religion', 'sleight of hand': 'sleightOfHand', stealth: 'stealth', survival: 'survival' };
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, twice: 2, thrice: 3 };
const SMALL = /^(of|the|and|or|with|in|on|to|a|an|from|by|von|van|de|du|la|le|der|den)$/;
const FIELDS = ['Armor Class', 'Hit Points', 'Speed', 'STR', 'Saving Throws', 'Skills', 'Damage Vulnerabilities', 'Damage Resistances', 'Damage Immunities', 'Condition Immunities', 'Senses', 'Languages', 'Challenge', 'Proficiency Bonus'];
const SECTIONS = /(?:^|\n)[ \t]*(?:#+[ \t]*)?(Actions|Bonus Actions|Reactions|Legendary Actions|Lair Actions|Mythic Actions|Regional Effects)[ \t]*(?=\n|$)/g;

const minus = s => String(s).replace(/[−–—]/g, '-');
const int = s => Number(minus(s).replace(/\s+/g, ''));
const diceOf = s => minus(s).replace(/\s+/g, '').replace(/×/g, '*');
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const camel = s => String(s).toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/ (\w)/g, (_, c) => c.toUpperCase());

// a scan's hidden text layer reads digits as letters ("ld8", "4dl0", "ii (+0)",
// "Challenge!", "30 ft./l 20 ft."); where a stat block needs a number it is read back
const OCR_DIGITS = { l: '1', I: '1', i: '1', '|': '1', '!': '1', o: '0', O: '0' };
const ocrNum = s => s.replace(/[lIi|!oO]/g, c => OCR_DIGITS[c]).replace(/\s+/g, '');
const DIE_SIDES = new Set(['4', '6', '8', '10', '12', '20', '100']);
function ocrFix(text) {
  return text
    .replace(/(?<![A-Za-z0-9])([0-9lI]{1,2}) ?d ?([0-9lIoO](?: ?[0-9lIoO]){0,2})(?![A-Za-z0-9])/g, (m, n, s) => (/^\d+$/.test(ocrNum(n)) && DIE_SIDES.has(ocrNum(s)) ? `${ocrNum(n)}d${ocrNum(s)}` : m))
    .replace(/(\d+ ?ft\. ?\/) ?([0-9lIoO](?: ?[0-9lIoO]){0,3})(?= ?ft\b)/g, (m, a, b) => a + ocrNum(b))
    .replace(/\bChallenge ?([0-9lI!|]{1,2}(?: ?\/ ?[0-9lI]{1,2})?)(?= ?\()/g, (m, c) => `Challenge ${ocrNum(c)}`)
    // a dropped colon: "Hit 5 (1d8 + 1)", "Weapon Attack +3 to hit"
    .replace(/\bHit(?=\s+\d+\s*\()/g, 'Hit:')
    .replace(/\b(Weapon|Spell) Attack(?=\s*[+\-−–]\s*\d+\s+to hit)/g, '$1 Attack:');
}
const XP_CR = { 10: '0', 25: '1/8', 50: '1/4', 100: '1/2', 200: '1', 450: '2', 700: '3', 1100: '4', 1800: '5', 2300: '6', 2900: '7', 3900: '8', 5000: '9', 5900: '10', 7200: '11', 8400: '12', 10000: '13', 11500: '14', 13000: '15', 15000: '16', 18000: '17', 20000: '18', 22000: '19', 25000: '20', 33000: '21', 41000: '22', 50000: '23', 62000: '24', 75000: '25', 90000: '26', 105000: '27', 120000: '28', 135000: '29', 155000: '30' };

const SIZE_LINE =new RegExp(`\\b(${SIZES})(?:\\s+or\\s+(?:${SIZES}))?\\s+(?:swarm\\s+of\\s+(?:${SIZES})\\s+)?([A-Za-z]+?)s?(?:\\s*\\(([^)]{0,60})\\))?\\s*,\\s*((?:any|unaligned|lawful|neutral|chaotic|typically)[^\\n]{0,80}?)(?=\\s*(?:\\n|Armor Class|$))`, 'g');

// the name: the run of capitalized words just before the size and type
function nameBefore(text) {
  const line = text.split('\n').pop().replace(/^#+\s*/, '').trim();
  const words = line.split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = words.length - 1; i >= 0 && out.length < 7; i--) {
    const w = words[i];
    if (/^[A-Z][\w'’-]*,?$/.test(w) || (out.length && SMALL.test(w)) || /^\(.*\)$/.test(w)) out.unshift(w);
    else break;
  }
  while (out.length && SMALL.test(out[0])) out.shift();
  const name = out.join(' ').replace(/,$/, '');
  return name.length >= 2 ? name : '';
}

// a name set in capitals ("CULTIST", "SlLDAR HALLWINTER" with an l read for I) in title case
const tidyName = name => (/[A-Z]{3}/.test(name) && !/[a-km-z]/.test(name) ? name.replace(/l/g, 'I').toLowerCase().split(' ').map((w, i) => (i && SMALL.test(w) ? w : w.replace(/[a-z]/, c => c.toUpperCase()))).join(' ') : name);

// every stat block in the text: [{name, text}], each running to the next one
export function findStatBlocks(text) {
  const src = String(text);
  const starts = [];
  for (const m of src.matchAll(/Armor Class\s+\d+/g)) {
    if (!/Hit Points\s+\d+/.test(src.slice(m.index, m.index + 400))) continue;
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    const sizes = [...before.matchAll(SIZE_LINE)];
    const s = sizes[sizes.length - 1];
    if (!s) continue;
    const at = Math.max(0, m.index - 400) + s.index;
    const lead = src.slice(Math.max(0, at - 200), at).replace(/\s+$/, '');
    const name = nameBefore(lead);
    if (!name) continue;
    const from = Math.max(0, at - 200) + lead.lastIndexOf(name);
    if (starts.length && from <= starts[starts.length - 1].from) continue;
    starts.push({ name, from: Math.max(0, from), ac: m.index });
  }
  return starts.map((s, i) => {
    let end = Math.min(starts[i + 1]?.from ?? src.length, s.ac + 9000);
    // a chapter or section heading after the block ends it
    const tail = src.slice(s.ac, end);
    const h = /\n#{1,2} (?!Actions|Bonus Actions|Reactions|Legendary Actions|Lair Actions|Mythic Actions|Regional Effects)/.exec(tail);
    if (h) end = s.ac + h.index;
    return { name: tidyName(s.name), text: src.slice(s.from, end).trim() };
  });
}

// "Name. text Name. text" -> [{name, text}]; a name is a few capitalized words
// (with a usage note in brackets) at the start of a sentence, followed by a full stop
function entries(text) {
  const src = String(text).replace(/\n+/g, ' ').trim();
  const out = [];
  const head = /([A-Z][\w'’-]*(?:\s+(?:[A-Z0-9][\w'’/-]*|of|the|and|or|with|in|on|to|a|an|from|by))*)(\s*\((?:[^()]|\([^)]*\)){1,60}\))?\.\s+/y;
  const startsAt = [];
  for (let i = 0; i < src.length; i++) {
    if (i && !/[.!?:)"”]\s$/.test(src.slice(i - 2, i))) continue;
    head.lastIndex = i;
    const m = head.exec(src);
    if (!m) continue;
    const words = m[1].split(/\s+/);
    if (words.length > 7 || /^(Hit|DC|The|It|If|On|While|When|Each|A|An|This|Its|As|After|Until)$/.test(m[1])) continue;
    // a running head read into the text ("MONSTERS Javelin") is not part of the name
    startsAt.push({ at: i, name: (m[1].replace(/^(?:[A-Z]{3,}\s+)+(?=[A-Z][a-z])/, '') + (m[2] ?? '')).trim(), body: i + m[0].length });
    i += m[0].length - 1;
  }
  startsAt.forEach((s, k) => out.push({ name: s.name, text: src.slice(s.body, startsAt[k + 1]?.at ?? src.length).trim() }));
  return out;
}

function field(head, label) {
  const at = head.search(new RegExp(`\\b${label}\\b`));
  if (at < 0) return '';
  let end = head.length;
  for (const f of FIELDS) {
    if (f === label) continue;
    const re = new RegExp(`\\b${f}\\b`, 'g');
    re.lastIndex = at + label.length;
    const m = re.exec(head);
    if (m && m.index < end) end = m.index;
  }
  return head.slice(at + label.length, end).trim();
}

const types = s => DAMAGE_TYPES.filter(t => new RegExp(`\\b${t}\\b`, 'i').test(s));
const conditionsIn = s => Object.keys(CONDITIONS).filter(c => new RegExp(`\\b${c}\\b`, 'i').test(s));
const SAVE = /DC\s*(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i;
const DMG = /(\d+)\s*\(([^)]*\d+d\d+[^)]*)\)\s*([a-z]+)\s+damage/i;

function roundsOf(text) {
  if (/for 1 minute/i.test(text)) return 10;
  if (/until the (?:end|start) of (?:its|the \w+'s|your) next turn/i.test(text)) return 1;
  const m = /for (\d+) rounds?/i.exec(text);
  return m ? Number(m[1]) : undefined;
}

function attack(name, text) {
  const m = /(Melee or Ranged|Melee|Ranged)\s+(?:Weapon|Spell)\s+Attack:\s*([+\-−–]\s*\d+)\s+to hit/i.exec(text);
  if (!m) return null;
  const hit = text.slice(text.search(/Hit:/i) >= 0 ? text.search(/Hit:/i) : 0);
  const reach = /reach\s+(\d+)\s*ft/i.exec(text);
  const range = /range\s+(\d+)(?:\s*ft\.?)?(?:\s*\/\s*(\d+))?\s*ft/i.exec(text);
  const kind = /^ranged$/i.test(m[1]) || (!reach && range) ? 'ranged' : 'melee';
  let dmg = DMG.exec(hit);
  let damage;
  let type;
  if (dmg) [damage, type] = [diceOf(dmg[2]), dmg[3].toLowerCase()];
  else {
    const flat = /Hit:\s*(\d+)\s+([a-z]+)\s+damage/i.exec(hit);
    // a line broken up by the page ("2 (1d6 - bludgeoning damage plus ... poison 1) damage"):
    // the average and dice printed first give the modifier, the first damage type the type
    const torn = !flat && /Hit:\s*(\d+)\s*\(\s*(\d+)d(\d+)/i.exec(hit);
    const tornType = torn && new RegExp(`\\b(${DAMAGE_TYPES.join('|')})\\b`, 'i').exec(hit.slice(torn.index));
    if (flat) [damage, type] = [flat[1], flat[2].toLowerCase()];
    else if (tornType) {
      const mod = Number(torn[1]) - Math.floor((Number(torn[2]) * (Number(torn[3]) + 1)) / 2);
      [damage, type] = [`${torn[2]}d${torn[3]}${mod ? (mod > 0 ? `+${mod}` : mod) : ''}`, tornType[1].toLowerCase()];
    } else return null;
  }
  if (!DAMAGE_TYPES.includes(type)) return null;
  const a = { name, kind, to_hit: int(m[2]), damage, damage_type: type };
  // swarms attack "reach 0 ft." (creatures in their space)
  if (kind === 'melee') a.reach = Math.max(5, reach ? Number(reach[1]) : 5);
  else {
    a.range = range ? Number(range[1]) : 30;
    a.long_range = range?.[2] ? Number(range[2]) : a.range;
  }
  const plus = /plus\s+(\d+)\s*\(([^)]*\d+d\d+[^)]*)\)\s*([a-z]+)\s+(?:\d+\)\s+)?damage/i.exec(hit);
  if (plus && DAMAGE_TYPES.includes(plus[3].toLowerCase())) Object.assign(a, { extra_damage: diceOf(plus[2]), extra_type: plus[3].toLowerCase() });
  const on = {};
  const save = SAVE.exec(hit);
  if (save) {
    on.save = ABIL[save[2].toLowerCase()];
    on.dc = Number(save[1]);
    const rest = hit.slice(save.index);
    const sd = DMG.exec(rest);
    if (sd && DAMAGE_TYPES.includes(sd[3].toLowerCase()) && !(plus && sd.index + save.index < plus.index)) Object.assign(on, { damage: diceOf(sd[2]), type: sd[3].toLowerCase(), half: /half as much/i.test(rest) });
    if (/repeat the saving throw/i.test(rest)) on.save_ends = on.save;
  }
  const conds = conditionsIn(hit.replace(/\bunconscious\b(?=[^.]*\b0 hit points)/gi, ''));
  if (conds.length) on.conditions = conds;
  const esc = /escape DC\s*(\d+)/i.exec(hit);
  if (esc) {
    on.escape_dc = Number(esc[1]);
    if (!conds.includes('grappled')) on.conditions = [...(on.conditions ?? []), 'grappled'];
  }
  const r = (on.conditions || on.save) && roundsOf(hit);
  if (r) on.rounds = r;
  if (on.save && !on.dc) delete on.save;
  if (Object.keys(on).length) a.on_hit = on;
  return a;
}

function areaAbility(name, text) {
  const shape = /(\d+)-foot(?:-radius|-long|-wide)?\s+(cone|line|sphere|cube|cylinder)/i.exec(text) ?? /(\d+)-foot[- ]radius/i.exec(text);
  const save = SAVE.exec(text);
  if (!shape || !save || Number(shape[1]) < 5) return null;
  const rech = /\(Recharge\s+(\d)/i.exec(name);
  const s = { name: name.replace(/\s*\(.*\)$/, ''), shape: shape[2]?.toLowerCase() ?? 'sphere', size: Number(shape[1]), save: ABIL[save[2].toLowerCase()], dc: Number(save[1]) };
  if (rech) s.recharge = Number(rech[1]);
  const d = DMG.exec(text.slice(save.index)) ?? DMG.exec(text);
  if (d && DAMAGE_TYPES.includes(d[3].toLowerCase())) Object.assign(s, { damage: diceOf(d[2]), damage_type: d[3].toLowerCase() });
  const c = conditionsIn(text);
  if (c.length) s.conditions = c;
  return s;
}

function spellcasting(text) {
  const lvl = /(\d+)(?:st|nd|rd|th)-level spellcaster/i.exec(text);
  const dc = /spell save DC\s*(\d+)/i.exec(text);
  if (!lvl || !dc) return null;
  const ability = /spellcasting ability is (\w+)/i.exec(text);
  const hit = /([+\-−–]\s*\d+) to hit with spell attacks/i.exec(text);
  const names = s => s.split(/,|;/).map(x => x.replace(/[*†‡•]/g, '').replace(/\(.*?\)/g, '').trim().toLowerCase()).filter(x => x && x.length < 40);
  const cantrips = /Cantrips\s*\(at will\)\s*:\s*(.*?)(?=\s*\d(?:st|nd|rd|th)\s+level\s*\(|$)/i.exec(text);
  const spells = [];
  const slots = [];
  for (const m of text.matchAll(/(\d)(?:st|nd|rd|th)\s+level\s*\((\d+)\s+slots?\)\s*:\s*(.*?)(?=\s*\d(?:st|nd|rd|th)\s+level\s*\(|$)/gi)) {
    spells.push(...names(m[3]));
    slots[Number(m[1]) - 1] = Math.min(4, Number(m[2]));
  }
  return { ability: ABIL[ability?.[1]?.toLowerCase()] ?? 'int', dc: Number(dc[1]), to_hit: hit ? int(hit[1]) : Number(dc[1]) - 8, caster_level: Math.min(20, Number(lvl[1])), cantrips: cantrips ? names(cantrips[1]) : [], spells, slots: Array.from({ length: slots.length }, (_, i) => slots[i] ?? 0) };
}

// a parsed stat block the engine refuses loses the part it refuses (kept in the
// notes for the DM) rather than the whole creature; null when even that fails
export function settle(spec, validate) {
  let s = structuredClone(spec);
  for (let i = 0; i < 8; i++) {
    try {
      validate(s);
      return s;
    } catch (e) {
      const msg = String(e.message);
      const drop = (what, keep) => {
        s.notes = clip(`${s.notes ?? ''} ${keep}`, 600);
        return what;
      };
      const named = /^(Action|Ability) (.+?)(?: (?:to hit|damage|reach|range|long range|DC|size|recharge|extra damage|rounds|escape DC)\b| needs|:| must)/.exec(msg);
      if (named?.[1] === 'Action' && s.actions?.length > 1) {
        s.actions = s.actions.filter(a => a.name !== named[2]);
        s.multiattack = s.multiattack?.filter(m => m.attack !== named[2]);
        drop(null, `${named[2]}: not playable by the engine.`);
      } else if (named?.[1] === 'Action') {
        const a = s.actions.find(x => x.name === named[2]);
        if (!a?.on_hit) return null;
        delete a.on_hit;
        drop(null, `${named[2]} has a rider effect on a hit.`);
      } else if (named?.[1] === 'Ability') s.abilities_special = s.abilities_special?.filter(a => a.name !== named[2]);
      else if (/^Multiattack/.test(msg)) delete s.multiattack;
      else if (/Spell|slots|Caster/.test(msg)) delete s.spellcasting;
      else if (/ save must/.test(msg)) delete s.saves;
      else if (/Regeneration/.test(msg)) delete s.regeneration;
      else if (/Parry/.test(msg)) delete s.parry;
      else if (/Resistance|Immunity|Vulnerability/.test(msg)) [s.resist, s.immune, s.vuln] = [[], [], []];
      else if (/is not a condition/.test(msg)) delete s.condition_immune;
      else if (s.skills && Object.keys(s.skills).some(k => msg.startsWith(k))) delete s.skills;
      else return null;
    }
  }
  return null;
}

// a stat block's text -> define_creature's arguments, or null with why
export function parseStatBlock(block, source = '') {
  const text = ocrFix(String(block.text ?? block).replace(/[-\u2010\u2011]{2,}|[\u2010\u2011]/g, '-'));
  const sz = [...text.slice(0, 600).matchAll(SIZE_LINE)][0];
  if (!sz) return { error: 'no size and type line' };
  let type = sz[2].toLowerCase();
  if (!TYPES.includes(type)) type = TYPES.find(t => type.startsWith(t)) ?? type;
  if (!TYPES.includes(type)) return { error: `unknown type ${sz[2]}` };
  const acAt = text.search(/Armor Class/);
  const body = text.slice(acAt);
  let chal = /Challenge\s+(\d+(?:\/\d+)?)(?:\s*\([^)]*\))?/.exec(body);
  // the rating misread past repair: its XP gives it
  const xp = !chal && /Challenge\s*\S{0,5}\s*\(([\d,]+)\s*XP\)/.exec(body);
  if (xp && XP_CR[xp[1].replace(/,/g, '')]) chal = Object.assign([xp[0], XP_CR[xp[1].replace(/,/g, '')]], { index: xp.index });
  if (!chal) return { error: 'no challenge rating' };
  let headEnd = chal.index + chal[0].length;
  const pb = /^\s*Proficiency Bonus\s*[+\-−–]\s*\d+/.exec(body.slice(headEnd));
  if (pb) headEnd += pb[0].length;
  const head = body.slice(0, headEnd).replace(/\n+/g, ' ');
  const rest = body.slice(headEnd);

  const spec = { name: block.name ?? nameBefore(text.slice(0, sz.index)), source, size: sz[1], type, cr: chal[1] };
  const ac = /Armor Class\s+(\d+)/.exec(head);
  const hp = /Hit Points\s+(\d+)(?:\s*\(([^)]*)\))?/.exec(head);
  if (!ac || !hp) return { error: 'no armor class or hit points' };
  spec.ac = Number(ac[1]);
  spec.hp = hp[2] && /\d+d\d+/.test(hp[2]) ? diceOf(hp[2]) : hp[1];
  const speed = field(head, 'Speed');
  spec.speed = Number(/(\d+)\s*ft/.exec(speed)?.[1] ?? 30);
  // "11 (+0)"; a misread score ("ii", "n", "io") is taken from its modifier
  const scores = [...head.slice(Math.max(0, head.search(/\bSTR\b/))).matchAll(/(?<![A-Za-z])([0-9lIion|O]{1,2})\s*\(\s*([+\-−–—]?)\s*([0-9lIioO])\s*\)/g)].slice(0, 6).map(m => {
    if (/^\d+$/.test(m[1])) return Number(m[1]);
    const mod = (/[+]|^$/.test(m[2]) ? 1 : -1) * Number(ocrNum(m[3]));
    const raw = Number(ocrNum(m[1].replace(/n/g, '11')));
    return Math.floor((raw - 10) / 2) === mod ? raw : 10 + 2 * mod;
  });
  if (scores.length < 6) return { error: 'ability scores not found' };
  spec.abilities = Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a, i) => [a, scores[i]]));
  const saves = field(head, 'Saving Throws');
  if (saves) spec.saves = Object.fromEntries([...saves.matchAll(/\b(Str|Dex|Con|Int|Wis|Cha)\w*\s*([+\-−–]\s*\d+)/gi)].map(m => [ABIL[m[1].toLowerCase()], int(m[2])]));
  const skills = field(head, 'Skills');
  if (skills) spec.skills = Object.fromEntries([...skills.matchAll(/\b(Acrobatics|Animal Handling|Arcana|Athletics|Deception|History|Insight|Intimidation|Investigation|Medicine|Nature|Perception|Performance|Persuasion|Religion|Sleight of Hand|Stealth|Survival)\s*([+\-−–]\s*\d+)/gi)].map(m => [SKILL_KEYS[m[1].toLowerCase()], int(m[2])]));
  const vuln = types(field(head, 'Damage Vulnerabilities'));
  const resist = types(field(head, 'Damage Resistances'));
  const immune = types(field(head, 'Damage Immunities'));
  const cimm = conditionsIn(field(head, 'Condition Immunities'));
  if (vuln.length) spec.vuln = vuln;
  if (resist.length) spec.resist = resist;
  if (immune.length) spec.immune = immune;
  if (cimm.length) spec.condition_immune = cimm;
  spec.senses = clip(field(head, 'Senses'), 120);

  // traits, then the sections in order
  const marks = [...rest.matchAll(SECTIONS)];
  let traitsEnd = marks[0]?.index ?? rest.length;
  let sections = marks.map((m, i) => ({ name: m[1], text: rest.slice(m.index + m[0].length, marks[i + 1]?.index ?? rest.length) }));
  if (!marks.length) {
    // "Actions" run into the text: the first "Actions" after the traits followed by an entry
    const m = /\bActions\s+(?=(?:Multiattack|[A-Z][\w'’ -]{0,40}\.\s+(?:Melee|Ranged)))/.exec(rest);
    if (m) {
      traitsEnd = m.index;
      sections = [{ name: 'Actions', text: rest.slice(m.index + m[0].length) }];
    }
  }
  const notes = [];
  if (/,/.test(speed)) notes.push(`Speed ${clip(speed, 80)}.`);
  const traits = entries(rest.slice(0, traitsEnd));
  spec.traits = [];
  for (const t of traits) {
    if (/^(Innate )?Spellcasting/i.test(t.name) && !/^Innate/i.test(t.name)) {
      const sc = spellcasting(t.text);
      if (sc) spec.spellcasting = sc;
    }
    const regen = /^Regeneration/i.test(t.name) && /regains\s+(\d+)\s+hit points/i.exec(t.text);
    if (regen) {
      spec.regeneration = Number(regen[1]);
      const stop = types(/takes? ([^.]*?) damage/i.exec(t.text)?.[1] ?? '');
      if (stop.length) spec.regeneration_stopped_by = stop;
    }
    spec.traits.push({ key: camel(t.name), name: clip(t.name, 60), desc: clip(t.text, 300) });
  }
  spec.actions = [];
  const multi = [];
  const special = [];
  for (const sec of sections) {
    const list = entries(sec.text);
    if (sec.name === 'Actions') {
      for (const e of list) {
        if (/^Multiattack/i.test(e.name)) {
          multi.push(e.text);
          continue;
        }
        const a = attack(e.name.replace(/\s*\(.*\)$/, ''), e.text);
        if (a) {
          spec.actions.push(a);
          continue;
        }
        const s = areaAbility(e.name, e.text);
        if (s) special.push(s);
        else notes.push(`${e.name}. ${clip(e.text, 200)}`);
      }
    } else if (sec.name === 'Reactions') {
      for (const e of list) {
        const p = /^Parry/i.test(e.name) && /adds?\s+(\d+)\s+to its AC/i.exec(e.text);
        if (p) spec.parry = Number(p[1]);
        else notes.push(`Reaction: ${e.name}. ${clip(e.text, 200)}`);
      }
    } else {
      notes.unshift(`${sec.name}: ${list.length ? list.map(e => `${e.name}. ${clip(e.text, 120)}`).join(' ') : clip(sec.text, 300)}`);
    }
  }
  if (!spec.actions.length) return { error: 'no attacks found', spec };
  if (special.length) spec.abilities_special = special.slice(0, 4);
  // "makes three attacks: one with its bite and two with its claws"
  for (const t of multi) {
    const list = [];
    const find = w => {
      const k = w.toLowerCase().replace(/s$/, '').replace(/^(its|his|her|their)\s+/, '').trim();
      return spec.actions.find(a => a.name.toLowerCase() === k || a.name.toLowerCase().replace(/s$/, '') === k) ?? spec.actions.find(a => a.name.toLowerCase().includes(k) || k.includes(a.name.toLowerCase()));
    };
    for (const m of t.matchAll(/\b(one|two|three|four|five|six|twice|thrice)\s+(?:times\s+)?with\s+(?:its|his|her|their)\s+([a-z][a-z' ]*?)(?=,|\.|\band\b|\bor\b|$)/gi)) {
      const a = find(m[2]);
      if (a) list.push({ attack: a.name, count: NUM[m[1].toLowerCase()] });
    }
    if (!list.length) {
      const m = /makes\s+(one|two|three|four|five|six)\s+(?:([a-z][a-z' ]*?)\s+)?attacks?/i.exec(t);
      if (m && !m[2]) m[2] = 'melee';
      const a = m && (/^(melee|weapon|melee weapon|ranged|ranged weapon)$/i.test(m[2]) ? spec.actions.find(x => x.kind === (/ranged/i.test(m[2]) ? 'ranged' : 'melee')) : find(m[2]));
      if (a) list.push({ attack: a.name, count: NUM[m[1].toLowerCase()] });
      else if (m && spec.actions.length === 1) list.push({ attack: spec.actions[0].name, count: NUM[m[1].toLowerCase()] });
    }
    const merged = [];
    for (const x of list) {
      const prev = merged.find(y => y.attack === x.attack);
      if (prev) prev.count += x.count;
      else merged.push(x);
    }
    if (merged.length) spec.multiattack = merged.slice(0, 4).map(x => ({ ...x, count: Math.min(6, x.count) }));
    if (!merged.length || /\bor\b|instead|in place of|alternatively/i.test(t)) notes.push(`Multiattack. ${clip(t, 200)}`);
  }
  if (notes.length) spec.notes = clip(notes.join(' '), 600);
  return { spec };
}
