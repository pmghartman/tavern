// hover tooltips for spells, conditions, feats, features and creatures named in text
import { h } from './ui.js';

let terms = null; // lower-case name -> entry
let exactRe = null; // Title Case names (spells, feats, features, creatures)
let looseRe = null; // conditions, any case
let tip = null;

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ord = n => ['Cantrip', '1st', '2nd', '3rd'][n] ?? `${n}th`;
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

function spellMeta(s) {
  const lvl = s.level === 0 ? `${cap(s.school)} cantrip` : `${ord(s.level)}-level ${s.school}`;
  const range = s.range === 'self' ? 'Self' : s.range === 'touch' ? 'Touch' : `${s.range} ft`;
  const time = { action: '1 action', bonus: '1 bonus action', reaction: '1 reaction' }[s.time] ?? s.time;
  return [lvl, time, range, s.duration, (s.components ?? []).join(', '), s.concentration ? 'Concentration' : null, s.ritual ? 'Ritual' : null].filter(Boolean).join(' · ');
}

export function initGlossary(rules) {
  if (terms) return;
  terms = new Map();
  const add = (name, entry, loose = false) => {
    if (!name || name.length < 3 || terms.has(name.toLowerCase())) return;
    terms.set(name.toLowerCase(), { ...entry, loose });
  };
  for (const s of Object.values(rules.spells ?? {})) add(s.name, { kind: 'spell', title: s.name, meta: spellMeta(s), desc: s.desc });
  for (const [k, d] of Object.entries(rules.conditions ?? {})) add(k, { kind: 'condition', title: cap(k), meta: 'Condition', desc: typeof d === 'string' ? d : d?.desc ?? '' }, true);
  for (const f of Object.values(rules.feats ?? {})) add(f.name, { kind: 'feat', title: f.name, meta: 'Feat', desc: f.desc });
  for (const f of Object.values(rules.fightingStyles ?? {})) add(f.name, { kind: 'feature', title: f.name, meta: 'Fighting style', desc: f.desc });
  for (const m of Object.values(rules.metamagic ?? {})) add(m.name, { kind: 'feature', title: m.name, meta: 'Metamagic', desc: m.desc });
  for (const i of Object.values(rules.invocations ?? {})) add(i.name, { kind: 'feature', title: i.name, meta: 'Eldritch invocation', desc: i.desc });
  for (const i of Object.values(rules.infusions ?? {})) add(i.name, { kind: 'feature', title: i.name, meta: 'Artificer infusion', desc: i.desc });
  for (const i of Object.values(rules.maneuvers ?? {})) add(i.name, { kind: 'feature', title: i.name, meta: 'Battle Master maneuver', desc: i.desc });
  for (const c of Object.values(rules.classes ?? {})) for (const f of c.features ?? []) if (f.desc) add(f.name, { kind: 'feature', title: f.name, meta: `${c.name} feature, level ${f.level}`, desc: f.desc });
  for (const m of Object.values(rules.monsters ?? {})) add(m.name, { kind: 'creature', title: m.name, meta: `${cap(m.size ?? '')} ${m.type ?? ''} · CR ${m.cr}`.trim(), desc: `Armor Class ${m.ac} · Hit Points ${m.hp}` });
  const names = loose => [...terms.entries()].filter(([, e]) => e.loose === loose).map(([, e]) => e.title).sort((a, b) => b.length - a.length).map(esc);
  exactRe = new RegExp(`(?<![\\w'-])(${names(false).join('|')})(?![\\w'-])`, 'g');
  looseRe = new RegExp(`(?<![\\w'-])(${names(true).join('|')})(?![\\w'-])`, 'gi');

  tip = h('div', { class: 'tip hidden', role: 'tooltip' });
  document.body.append(tip);
  const show = el => {
    // known terms, or any element carrying its own data-tip text
    const e = el.dataset.term ? terms.get(el.dataset.term) : { kind: 'info', title: el.dataset.tipTitle, meta: el.dataset.tipMeta, desc: el.dataset.tip };
    if (!e?.title) return;
    // replaceChildren writes a null out as the text "null"
    tip.replaceChildren(...[h('div', { class: `tip-title t-${e.kind}` }, e.title), e.meta ? h('div', { class: 'tip-meta' }, e.meta) : null, e.desc ? h('div', { class: 'tip-desc' }, e.desc) : null].filter(Boolean));
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const hgt = tip.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const top = r.top - hgt - 8 >= 8 ? r.top - hgt - 8 : r.bottom + 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  const hide = () => tip.classList.add('hidden');
  document.addEventListener('mouseover', e => {
    const t = e.target.closest?.('[data-term], [data-tip-title]');
    if (t) show(t);
    else hide();
  });
  // touch: tap a term to see it, tap elsewhere to close
  document.addEventListener('click', e => {
    const t = e.target.closest?.('span.term');
    if (t) show(t);
    else hide();
  });
  document.addEventListener('scroll', hide, true);
}

// controls, headings and titles name things rather than mention them; a
// [data-no-terms] block already shows its descriptions inline
const SKIP = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'CODE', 'SCRIPT', 'STYLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'LABEL']);
const skipEl = p => SKIP.has(p.tagName) || p.classList?.contains('term') || p.classList?.contains('t') || p.hasAttribute?.('data-no-terms');
// a capitalized word right before or after: part of a longer name (Rune Knight, Knight Commander)
const LEAD = new Set(['The', 'A', 'An', 'I', 'Your', 'My', 'His', 'Her', 'Their', 'Its', 'Our', 'This', 'That', 'Each', 'Every', 'Another', 'One', 'Two', 'Three']);
const inLongerName = (text, start, end) => {
  const prev = /(?:^|\s)([A-Z][\w'-]*)\s$/.exec(text.slice(Math.max(0, start - 30), start))?.[1];
  return (!!prev && !LEAD.has(prev)) || /^\s[A-Z][a-z]/.test(text.slice(end, end + 3));
};

// wrap known names in the text under root with hoverable spans
export function annotate(root) {
  if (!terms || !root) return root;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => {
      for (let p = n.parentElement; p && p !== root.parentElement; p = p.parentElement) if (skipEl(p)) return NodeFilter.FILTER_REJECT;
      return n.nodeValue.trim().length > 2 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const hits = [];
    for (const re of [exactRe, looseRe]) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const end = m.index + m[0].length;
        if (re === exactRe && inLongerName(text, m.index, end)) continue;
        if (!hits.some(x => m.index < x.end && end > x.start)) hits.push({ start: m.index, end, key: m[0].toLowerCase() });
      }
    }
    if (!hits.length) continue;
    hits.sort((a, b) => a.start - b.start);
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const x of hits) {
      if (x.start > at) frag.append(text.slice(at, x.start));
      const e = terms.get(x.key);
      frag.append(h('span', { class: `term t-${e?.kind ?? 'info'}`, 'data-term': x.key, tabindex: 0 }, text.slice(x.start, x.end)));
      at = x.end;
    }
    if (at < text.length) frag.append(text.slice(at));
    node.replaceWith(frag);
  }
  return root;
}

// a name that is already known to be a term (spell lists, pickers)
export function term(name, kind = '') {
  const key = String(name).toLowerCase();
  if (!terms?.has(key)) return name;
  return h('span', { class: `term t-${terms.get(key).kind ?? kind}`, 'data-term': key, tabindex: 0 }, name);
}
