// tiny DOM helpers
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, x) : (el.style[p] = x);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function toast(text, kind = 'info', ms = 3500) {
  const el = h('div', { class: `toast ${kind}` }, text);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

export function modal(content, { wide = false, onClose } = {}) {
  const back = h('div', { class: 'modal-back' });
  const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog' }, content);
  back.append(box);
  const close = () => {
    back.remove();
    onClose?.();
  };
  back.addEventListener('mousedown', e => {
    if (e.target === back) close();
  });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', esc);
      close();
    }
  });
  document.body.append(back);
  return { close, box };
}

// a small card that opens from a title and closes on Escape or a click elsewhere;
// set() swaps its content, place() follows a redrawn anchor
let openPop = null;
export function popover(anchor, content, { onClose } = {}) {
  openPop?.close();
  const el = h('div', { class: 'popover', role: 'dialog' });
  document.body.append(el);
  let at = anchor;
  const place = a => {
    at = a ?? at;
    const r = at.getBoundingClientRect();
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
    el.style.top = `${r.top - hgt - 6 >= 8 ? r.top - hgt - 6 : Math.min(window.innerHeight - hgt - 8, r.bottom + 6)}px`;
  };
  const outside = e => !el.contains(e.target) && !at.contains(e.target) && p.close();
  const esc = e => e.key === 'Escape' && p.close();
  // its title scrolled or redrawn away: follow it, or close when it is gone
  const follow = () => (at.isConnected ? place() : p.close());
  const p = {
    el,
    set(c) {
      fill(el, c);
      place();
    },
    place,
    close() {
      if (openPop !== p) return;
      openPop = null;
      el.remove();
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', esc);
      document.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
      onClose?.();
    },
  };
  openPop = p;
  p.set(content);
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('keydown', esc);
  document.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);
  return p;
}

export function confirmBox(text) {
  return new Promise(resolve => {
    const m = modal([h('p', {}, text), h('div', { class: 'modal-foot' }, h('button', { class: 'btn', onclick: () => (m.close(), resolve(false)) }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => (m.close(), resolve(true)) }, 'Confirm'))]);
  });
}

export const fmtMod = n => (n >= 0 ? `+${n}` : `${n}`);
export const mod = s => Math.floor((s - 10) / 2);

// safe minimal markdown: **bold**, *italic*, line breaks
export function md(text) {
  const esc = String(text ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return esc.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<i>$2</i>').replace(/\n/g, '<br>');
}

export function colorFor(name) {
  let x = 0;
  for (const c of String(name)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  // lightness follows the theme so names stay readable on dark pages
  return `hsl(${x % 360} 55% var(--name-l, 30%))`;
}

export function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function clockLabel(minute = 0) {
  const day = Math.floor(minute / 1440) + 1;
  const m = minute % 1440;
  return `Day ${day}, ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// the tavern's sign: a foaming tankard in the book's oxblood and gold; the
// browser tab shows the same drawing (index.html carries a copy for first paint)
export const TAVERN_ICON = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><path d='M45 25h5a8 8 0 0 1 8 8v6a8 8 0 0 1-8 8h-5' fill='none' stroke='#58180d' stroke-width='6'/><rect x='12' y='18' width='35' height='40' rx='4' fill='#7a200d' stroke='#3d0f06' stroke-width='2'/><rect x='12' y='26' width='35' height='4' fill='#c9ad6a'/><rect x='12' y='48' width='35' height='4' fill='#c9ad6a'/><path d='M23 34v11M36 34v11' stroke='#58180d' stroke-width='2' stroke-linecap='round'/><path d='M10 22c-1-5 3-9 8-8 2-5 9-7 13-3 4-4 11-3 13 2 5 0 7 5 5 9z' fill='#fdf1dc' stroke='#8a6a22' stroke-width='2' stroke-linejoin='round'/></svg>";
export const TavernIcon = () => {
  const s = new DOMParser().parseFromString(TAVERN_ICON, 'image/svg+xml').documentElement;
  s.setAttribute('class', 'brand-icon');
  s.setAttribute('aria-hidden', 'true');
  return document.importNode(s, true);
};

// replaceChildren that flattens arrays and drops null/false
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false).map(c => (c instanceof Node ? c : document.createTextNode(String(c)))));
  return el;
}
