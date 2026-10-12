import { randomUUID } from 'node:crypto';

export const uid = (prefix = '') => prefix + randomUUID().replace(/-/g, '').slice(0, 12);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const sum = arr => arr.reduce((a, b) => a + b, 0);
export const fmtMod = n => (n >= 0 ? `+${n}` : `${n}`);

export class RuleError extends Error {
  constructor(message, code = 'rule') {
    super(message);
    this.code = code;
  }
}
export const fail = (msg, code) => {
  throw new RuleError(msg, code);
};

// a place as the players see it: a name that gives away what waits there ("Goblin Ambush") is not shown,
// the place the party was already in, or one named in the description, stands in for it
const GIVEAWAY = /\b(?:ambush\w*|trap(?:s|ped)?|encounter|battle|fight|skirmish|attack|assault|raid|showdown|betrayal|lair of)\b/i;
const PLACE = /\b((?:the\s)?(?:[A-Z][\w']+\s){1,3}(?:Trail|Road|Way|Path|Pass|Bridge|Ford|Inn|Tavern|Town|Village|Keep|Castle|Manor|Forest|Wood|Woods|Hills|Mountains|Cave|Caves|Hideout|Ruins|Tower|Temple|Crossing|Gate|Square|Market))\b/;
export function publicPlace(name, ...fallbacks) {
  const n = String(name ?? '').trim();
  if (n && !GIVEAWAY.test(n)) return n;
  for (const f of fallbacks) {
    const s = String(f ?? '').trim();
    if (!s) continue;
    if (s.length <= 80 && !/[.!?]/.test(s) && !GIVEAWAY.test(s)) return s;
    const m = PLACE.exec(s);
    if (m && !GIVEAWAY.test(m[1])) return m[1].replace(/^the\s/, 'The ');
  }
  return null;
}
