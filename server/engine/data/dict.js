// lookup tables without a prototype, so "constructor" or "__proto__" never
// match a rule, and each object entry carries its own key
export function dict(obj) {
  const out = Object.create(null);
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && !Object.hasOwn(v, 'key') ? { key: k, ...v } : v;
  }
  return out;
}

// case- and punctuation-blind lookup by key or display name
export const normName = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function finder(table, aliases = {}) {
  const byName = new Map();
  for (const [k, v] of Object.entries(table)) {
    byName.set(normName(k), k);
    if (v?.name) byName.set(normName(v.name), k);
  }
  for (const [a, k] of Object.entries(aliases)) byName.set(normName(a), k);
  return ref => {
    if (ref === undefined || ref === null || ref === '') return null;
    if (Object.hasOwn(table, ref)) return ref;
    const n = normName(ref);
    if (!n) return null;
    if (byName.has(n)) return byName.get(n);
    // plurals: "goblins", "torches"
    for (const cut of [n.replace(/es$/, ''), n.replace(/s$/, '')]) if (byName.has(cut)) return byName.get(cut);
    return null;
  };
}
