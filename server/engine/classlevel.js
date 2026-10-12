import { CLASSES, subclassKey } from './data/classes.js';

// per-class levels; single-class characters predate the classes array
export function classLevels(c) {
  if (!c || (c.kind && c.kind !== 'pc')) return [];
  if (Array.isArray(c.classes) && c.classes.length > 1) return c.classes;
  if (Array.isArray(c.classes) && c.classes.length === 1) return c.classes[0].level === c.level ? c.classes : [{ ...c.classes[0], level: c.level }];
  return c.class ? [{ class: c.class, level: c.level, subclass: c.subclass ?? null }] : [];
}

export function cl(c, cls) {
  const e = classLevels(c).find(x => x.class === cls);
  return e ? e.level : 0;
}

export function classLabel(c, names) {
  return classLevels(c).map(x => `${names?.[x.class]?.name ?? x.class} ${x.level}`).join(' / ');
}

// the subclass key a character took in a class; characters made before the
// choice existed stored the SRD subclass's name
export function subclassOf(c, cls) {
  const e = classLevels(c).find(x => x.class === cls);
  if (!e?.subclass) return null;
  return subclassKey(cls, e.subclass);
}

export const hasSub = (c, cls, key, level = 1) => cl(c, cls) >= level && subclassOf(c, cls) === key;

export const subclassDef = (c, cls) => CLASSES[cls]?.subclasses?.[subclassOf(c, cls)] ?? null;

// the spellcasting a class gives: its own, or its subclass's (Eldritch Knight,
// Arcane Trickster); sub overrides the stored subclass, for choices in progress
export function castingOf(c, cls, sub = undefined) {
  const def = CLASSES[cls];
  if (def?.spellcasting) return def.spellcasting;
  const key = sub === undefined ? subclassOf(c, cls) : subclassKey(cls, sub);
  return (key && def?.subclasses?.[key]?.spellcasting) || null;
}

// slots a class contributes to the multiclass spellcaster level
export function casterLevelShare(type, level) {
  if (type === 'full') return level;
  if (type === 'half') return Math.floor(level / 2);
  if (type === 'artificer') return Math.ceil(level / 2);
  if (type === 'third') return Math.floor(level / 3);
  return 0;
}

// every subclass a character has reached: [{ cls, level, def }]
export function subclassesOf(c) {
  return classLevels(c).map(x => ({ cls: x.class, level: x.level, def: subclassDef(c, x.class) })).filter(x => x.def && x.level >= (x.def.level ?? 1));
}
