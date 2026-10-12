import { cryptoRng } from './rng.js';

const TERM = /([+-]?)\s*(?:(\d*)d(\d+|%)(?:(kh|kl|k|dh|dl)(\d+))?(r(?:<=?)?\d+)?|(\d+))/gy;

export class DiceError extends Error {}

export function parseDice(expr) {
  if (typeof expr !== 'string') throw new DiceError('dice expression must be a string');
  const src = expr.replace(/\s+/g, '').toLowerCase();
  if (!src) throw new DiceError('empty dice expression');
  const terms = [];
  TERM.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    TERM.lastIndex = pos;
    const m = TERM.exec(src);
    if (!m || m.index !== pos || m[0] === '') throw new DiceError(`bad dice expression "${expr}" at ${pos}`);
    if (terms.length && !m[1]) throw new DiceError(`missing operator in "${expr}"`);
    const sign = m[1] === '-' ? -1 : 1;
    if (m[7] !== undefined) {
      terms.push({ type: 'const', sign, value: Number(m[7]) });
    } else {
      const count = m[2] === '' ? 1 : Number(m[2]);
      const sides = m[3] === '%' ? 100 : Number(m[3]);
      if (count < 1 || count > 100) throw new DiceError('dice count must be 1-100');
      if (![2, 3, 4, 6, 8, 10, 12, 20, 100].includes(sides)) throw new DiceError(`d${sides} is not a valid die`);
      const t = { type: 'dice', sign, count, sides };
      if (m[4]) {
        const n = Number(m[5]);
        const mode = m[4] === 'k' ? 'kh' : m[4];
        t.keep = mode === 'dh' ? { mode: 'kl', n: count - n } : mode === 'dl' ? { mode: 'kh', n: count - n } : { mode, n };
        if (t.keep.n < 1 || t.keep.n > count) throw new DiceError('invalid keep count');
      }
      if (m[6]) {
        const rm = /r(?:<=?)?(\d+)/.exec(m[6]);
        t.reroll = { max: Number(rm[1]) };
        if (t.reroll.max >= sides) throw new DiceError('reroll threshold must be below die size');
      }
      terms.push(t);
    }
    pos = TERM.lastIndex;
  }
  return terms;
}

export function roll(expr, rng = cryptoRng, opts = {}) {
  const terms = parseDice(expr);
  let total = 0;
  const parts = [];
  const dice = [];
  for (const t of terms) {
    if (t.type === 'const') {
      total += t.sign * t.value;
      parts.push(`${t.sign < 0 ? '-' : '+'}${t.value}`);
      continue;
    }
    const count = opts.crit ? t.count * 2 : t.count;
    let results = [];
    for (let i = 0; i < count; i++) {
      let r = rng.int(1, t.sides);
      const minReroll = t.reroll?.max ?? opts.rerollBelow;
      if (minReroll && r <= minReroll) r = rng.int(1, t.sides);
      results.push(r);
    }
    let kept = results.map((_, i) => i);
    if (t.keep) {
      const order = results.map((v, i) => [v, i]).sort((a, b) => (t.keep.mode === 'kh' ? b[0] - a[0] : a[0] - b[0]));
      kept = order.slice(0, t.keep.n).map(x => x[1]).sort((a, b) => a - b);
    }
    const sum = kept.reduce((s, i) => s + results[i], 0);
    total += t.sign * sum;
    dice.push({ sides: t.sides, results, kept });
    const shown = results.map((v, i) => (kept.includes(i) ? `${v}` : `~${v}~`)).join(',');
    parts.push(`${t.sign < 0 ? '-' : '+'}${count}d${t.sides}[${shown}]`);
  }
  if (opts.minimum !== undefined) total = Math.max(opts.minimum, total);
  let detail = parts.join(' ');
  if (detail.startsWith('+')) detail = detail.slice(1);
  return { expr, total, dice, detail };
}

// d20 with advantage state; adv and dis cancel
export function rollD20(rng = cryptoRng, { advantage = false, disadvantage = false, luckyHalfling = false } = {}) {
  const mode = advantage && !disadvantage ? 'adv' : disadvantage && !advantage ? 'dis' : 'normal';
  const one = () => {
    let r = rng.int(1, 20);
    let rerolled = null;
    if (luckyHalfling && r === 1) {
      rerolled = r;
      r = rng.int(1, 20);
    }
    return { r, rerolled };
  };
  const a = one();
  const rolls = [a.r];
  const lucky = [];
  if (a.rerolled) lucky.push(a.rerolled);
  let natural = a.r;
  if (mode !== 'normal') {
    const b = one();
    rolls.push(b.r);
    if (b.rerolled) lucky.push(b.rerolled);
    natural = mode === 'adv' ? Math.max(a.r, b.r) : Math.min(a.r, b.r);
  }
  return { natural, rolls, mode, luckyRerolls: lucky };
}

export function averageOf(expr) {
  return parseDice(expr).reduce((s, t) => s + t.sign * (t.type === 'const' ? t.value : (t.count * (t.sides + 1)) / 2), 0);
}

export function maxOf(expr) {
  return parseDice(expr).reduce((s, t) => s + t.sign * (t.type === 'const' ? t.value : t.count * t.sides), 0);
}

export function diceCount(expr) {
  return parseDice(expr).filter(t => t.type === 'dice').reduce((s, t) => s + t.count, 0);
}
