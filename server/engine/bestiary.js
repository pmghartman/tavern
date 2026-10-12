// creatures beyond the SRD: a published adventure's own stat blocks, recalled from
// the book by the DM model and checked here so the engine can run them exactly
import { MONSTERS, registerMonster, isSrdMonster } from './data/monsters.js';
import { SPELLS, findSpellKey } from './data/spells.js';
import { CR_XP, DAMAGE_TYPES, CONDITIONS, SKILLS } from './data/core.js';
import { parseDice } from './dice.js';
import { RuleError } from './util.js';

const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
const TYPES = ['aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead'];
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SHAPES = ['cone', 'line', 'sphere', 'cube', 'cylinder'];
// traits the engine knows how to play; anything else is kept as text for the DM
const KNOWN_TRAITS = new Set(Object.values(MONSTERS).flatMap(m => (m.traits ?? []).map(t => t.key)));

const slug = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ (\w)/g, (_, c) => c.toUpperCase());
const text = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const int = (v, lo, hi, what) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < lo || n > hi) throw new RuleError(`${what} must be ${lo}-${hi}.`);
  return n;
};
const dice = (v, what) => {
  const s = String(v ?? '').replace(/\s+/g, '');
  try {
    parseDice(s);
  } catch {
    throw new RuleError(`${what} "${v}" is not a dice expression like 2d6+3.`);
  }
  return s;
};
const dmgType = (v, what) => {
  const t = String(v ?? '').toLowerCase();
  if (!DAMAGE_TYPES.includes(t)) throw new RuleError(`${what}: "${v}" is not a damage type.`);
  return t;
};
const conds = list => (list ?? []).map(c => String(c).toLowerCase()).filter(c => {
  if (!Object.hasOwn(CONDITIONS, c)) throw new RuleError(`"${c}" is not a condition.`);
  return true;
});

function onHit(o, what) {
  if (!o) return undefined;
  const out = {};
  if (o.save) out.save = ABILITIES.includes(o.save) ? o.save : (() => { throw new RuleError(`${what}: save must be an ability.`); })();
  if (o.dc !== undefined) out.dc = int(o.dc, 5, 30, `${what} DC`);
  if (o.damage) Object.assign(out, { damage: dice(o.damage, `${what} damage`), type: dmgType(o.type, what), half: !!o.half });
  if (o.conditions?.length) out.conditions = conds(o.conditions);
  if (o.save_ends) out.saveEnds = out.save ?? o.save_ends;
  if (o.rounds) out.rounds = int(o.rounds, 1, 100, `${what} rounds`);
  if (o.escape_dc) out.escape = { dc: int(o.escape_dc, 5, 30, `${what} escape DC`) };
  return Object.keys(out).length ? out : undefined;
}

function action(a, i) {
  const what = a?.name ? `Action ${a.name}` : `Action ${i + 1}`;
  const name = text(a?.name, 60);
  if (!name) throw new RuleError(`${what} needs a name.`);
  const kind = a.kind === 'ranged' ? 'ranged' : 'melee';
  const out = { key: slug(name) || `a${i}`, name, kind, toHit: int(a.to_hit, -5, 20, `${what} to hit`), damage: dice(a.damage, `${what} damage`), type: dmgType(a.damage_type, what) };
  if (kind === 'melee') out.reach = int(a.reach ?? 5, 5, 30, `${what} reach`);
  else out.range = [int(a.range ?? 30, 5, 1000, `${what} range`), int(a.long_range ?? a.range ?? 30, 5, 2000, `${what} long range`)];
  if (a.extra_damage) out.extra = { dice: dice(a.extra_damage, `${what} extra damage`), type: dmgType(a.extra_type, `${what} extra damage`) };
  const oh = onHit(a.on_hit, what);
  if (oh) out.onHit = oh;
  return out;
}

function special(s, i) {
  const what = s?.name ? `Ability ${s.name}` : `Ability ${i + 1}`;
  const name = text(s?.name, 60);
  if (!name) throw new RuleError(`${what} needs a name.`);
  const out = { key: slug(name) || `s${i}`, name };
  if (s.recharge) out.recharge = int(s.recharge, 2, 6, `${what} recharge`);
  if (!SHAPES.includes(s.shape)) throw new RuleError(`${what}: shape must be ${SHAPES.join(', ')}.`);
  out.area = { shape: s.shape, size: int(s.size, 5, 300, `${what} size`) };
  out.save = ABILITIES.includes(s.save) ? s.save : (() => { throw new RuleError(`${what}: save must be an ability.`); })();
  out.dc = int(s.dc, 5, 30, `${what} DC`);
  if (s.damage) Object.assign(out, { damage: dice(s.damage, `${what} damage`), type: dmgType(s.damage_type, what) });
  if (s.conditions?.length) out.conditions = conds(s.conditions);
  return out;
}

// a stat block as the DM tool sends it -> the engine's shape
export function validateCreature(spec) {
  const name = text(spec?.name, 60);
  if (!name) throw new RuleError('A creature needs a name.');
  const cr = String(spec.cr ?? '').trim();
  if (!Object.hasOwn(CR_XP, cr)) throw new RuleError(`CR "${spec.cr}" is not a challenge rating (0, 1/8, 1/4, 1/2, 1-30).`);
  const size = SIZES.find(s => s.toLowerCase() === String(spec.size ?? '').toLowerCase());
  if (!size) throw new RuleError(`Size must be one of ${SIZES.join(', ')}.`);
  const type = String(spec.type ?? '').toLowerCase();
  if (!TYPES.includes(type)) throw new RuleError(`Type must be one of ${TYPES.join(', ')}.`);
  const abilities = ABILITIES.map(a => int(spec.abilities?.[a], 1, 30, `${a.toUpperCase()}`));
  const actions = (spec.actions ?? []).slice(0, 8).map(action);
  if (!actions.length) throw new RuleError(`${name} needs at least one attack.`);
  const def = {
    name, size, type, cr, ac: int(spec.ac, 5, 30, 'AC'), hp: dice(spec.hp, 'Hit points'), speed: int(spec.speed ?? 30, 0, 120, 'Speed'), abilities,
    senses: text(spec.senses, 120), resist: (spec.resist ?? []).map(t => dmgType(t, 'Resistance')), immune: (spec.immune ?? []).map(t => dmgType(t, 'Immunity')), vuln: (spec.vuln ?? []).map(t => dmgType(t, 'Vulnerability')), condImmune: conds(spec.condition_immune),
    traits: (spec.traits ?? []).slice(0, 10).map(t => ({ key: KNOWN_TRAITS.has(t.key) ? t.key : `note_${slug(t.name)}`, name: text(t.name, 60), desc: text(t.desc, 300) })).filter(t => t.name),
    actions,
    source: text(spec.source, 80) || 'adventure',
  };
  if (spec.saves) def.saves = Object.fromEntries(Object.entries(spec.saves).filter(([a]) => ABILITIES.includes(a)).map(([a, v]) => [a, int(v, -5, 20, `${a} save`)]));
  if (spec.skills) def.skills = Object.fromEntries(Object.entries(spec.skills).filter(([k]) => Object.hasOwn(SKILLS, k)).map(([k, v]) => [k, int(v, -5, 20, `${k}`)]));
  if (spec.multiattack?.length) {
    def.multiattack = spec.multiattack.slice(0, 4).map(x => {
      const a = actions.find(y => y.name.toLowerCase() === String(x.attack).toLowerCase() || y.key === x.attack);
      if (!a) throw new RuleError(`Multiattack names "${x.attack}", which is not one of ${name}'s attacks.`);
      return { attack: a.key, count: int(x.count, 1, 6, 'Multiattack count') };
    });
  }
  if (spec.abilities_special?.length) def.special = spec.abilities_special.slice(0, 4).map(special);
  if (spec.parry) def.reactions = [{ key: 'parry', name: 'Parry', acBonus: int(spec.parry, 1, 5, 'Parry bonus') }];
  if (spec.regeneration) def.regeneration = { amount: int(spec.regeneration, 1, 50, 'Regeneration'), stoppedBy: (spec.regeneration_stopped_by ?? []).map(t => dmgType(t, 'Regeneration stopped by')) };
  if (spec.spellcasting) {
    const s = spec.spellcasting;
    const keys = list => (list ?? []).map(k => findSpellKey(k)).filter(k => k && SPELLS[k]);
    def.spellcasting = { ability: ABILITIES.includes(s.ability) ? s.ability : 'int', dc: int(s.dc, 8, 30, 'Spell DC'), toHit: int(s.to_hit, 0, 20, 'Spell attack'), casterLevel: int(s.caster_level ?? 1, 1, 20, 'Caster level'), cantrips: keys(s.cantrips).filter(k => SPELLS[k].level === 0), spells: keys(s.spells).filter(k => SPELLS[k].level > 0), slots: (s.slots ?? []).slice(0, 9).map((n, i) => int(n, 0, 4, `Level ${i + 1} slots`)) };
  }
  // the book's extras the engine cannot play (legendary actions, lair actions): kept for the DM to narrate
  if (spec.notes) def.notes = text(spec.notes, 600);
  return def;
}

// a campaign's creatures get keys of their own
export function creatureKey(scope, name) {
  return `${slug(scope)}_${slug(name)}`;
}

// scope: the adventure's key, so its campaigns share the book's creatures, or the campaign's own id
export function defineCreature(campaign, spec, scope = campaign.id) {
  const def = validateCreature(spec);
  const key = creatureKey(scope, def.name);
  if (isSrdMonster(key)) throw new RuleError(`${def.name} is already in the SRD.`);
  campaign.bestiary = campaign.bestiary ?? {};
  campaign.bestiary[key] = def;
  registerMonster(key, def);
  return key;
}

// at start-up, every campaign's own creatures become known to the engine again
export function loadBestiary(campaigns) {
  for (const c of campaigns) for (const [key, def] of Object.entries(c.bestiary ?? {})) registerMonster(key, def);
}

export function bestiaryText(campaign) {
  return Object.entries(campaign.bestiary ?? {}).map(([k, d]) => `${k} (${d.name}, CR ${d.cr}, AC ${d.ac}, HP ${d.hp})${d.notes ? ` [${d.notes}]` : ''}`).join(', ');
}
