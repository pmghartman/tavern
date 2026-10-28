// web lookups for the DM through a SearXNG: the one TAVERN_SEARXNG_URL names,
// else PHOS_SEARCH_URL, else the usual local address. Pages are read directly,
// and only ones a search returned

import { VERSION } from '../version.js';

const TTL_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const PAGE_BYTES = 1_500_000;
// sites that print the books' content closest to the page
const PREFERRED = /(?:forgottenrealms\.fandom\.com|dnd5e\.wikidot\.com|dndbeyond\.com|5e\.tools|dnd\.wizards\.com|roll20\.net\/compendium|aidedd\.org|fandom\.com)/i;
const UA = `tavern-dm/${VERSION}`;

// doors in, most preferred first: today one SearXNG, named by TAVERN_SEARXNG_URL
export function searchDoors(config) {
  const direct = String(config.searxngUrl ?? process.env.PHOS_SEARCH_URL ?? 'http://127.0.0.1:8888/search').replace(/\/+$/, '').replace(/(?<!\/search)$/, '/search');
  return [{ kind: 'searxng', url: direct }];
}

class Lru extends Map {
  constructor(max) {
    super();
    this.max = max;
  }
  hit(k) {
    const v = super.get(k);
    if (!v || Date.now() - v.at > TTL_MS) return undefined;
    return v.value;
  }
  put(k, value) {
    this.delete(k);
    super.set(k, { at: Date.now(), value });
    while (this.size > this.max) this.delete(this.keys().next().value);
    return value;
  }
}

export function htmlToText(html) {
  let s = String(html);
  // the article body on MediaWiki sites, else <main>/<article>, else the whole page
  const body = /<div[^>]+class="[^"]*mw-parser-output[^"]*"[^>]*>([\s\S]*)/i.exec(s) ?? /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(s);
  if (body) s = body[body.length - 1];
  s = s.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\[\s*(?:edit|\d+)\s*\]/gi, ' ')
    .replace(/[ \t\f\r]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n');
  return s.trim();
}

// the part of a page that talks about the question, rather than its first screen
export function focus(text, query, max) {
  if (text.length <= max) return text;
  const terms = String(query).toLowerCase().split(/[^a-z0-9']+/).filter(t => t.length > 3);
  if (!terms.length) return text.slice(0, max);
  const low = text.toLowerCase();
  const step = Math.floor(max / 4);
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < low.length; i += step) {
    const win = low.slice(i, i + max);
    const score = terms.reduce((n, t) => n + (win.split(t).length - 1), 0);
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  return text.slice(best, best + max);
}

export class Search {
  constructor(config = {}, { fetchImpl = globalThis.fetch } = {}) {
    this.doors = searchDoors(config);
    this.fetch = fetchImpl;
    this.down = new Map();
    this.used = null;
    this.error = null;
    this.results = new Lru(300);
    this.pages = new Lru(64);
    // urls a search returned, the only ones the direct fallback reads
    this.allowed = new Set();
  }

  async viaDoor(door, query, page) {
    const params = { q: query, format: 'json', pageno: String(page) };
    const res = await this.fetch(`${door.url}?${new URLSearchParams(params)}`, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body?.results)) throw new Error('gave no results list');
    const box = body.infoboxes?.[0];
    return { results: body.results.map(x => ({ title: x.title, url: x.url, snippet: x.content, date: x.publishedDate })), answers: (body.answers ?? []).map(a => (typeof a === 'string' ? a : a.answer)).filter(Boolean), infobox: box ? { title: box.infobox, content: box.content } : null };
  }

  // each door in turn; one that failed is skipped for a minute
  async search(q, { page = 1 } = {}) {
    const query = String(q ?? '').trim().slice(0, 300);
    if (!query) throw new Error('Empty search.');
    const pg = Math.min(5, Math.max(1, Math.trunc(Number(page)) || 1));
    const key = `${pg}:${query}`;
    const cached = this.results.hit(key);
    if (cached) return cached;
    const errors = [];
    for (const door of this.doors) {
      if (Date.now() - (this.down.get(door.url) ?? 0) < RETRY_MS) continue;
      try {
        const raw = await this.viaDoor(door, query, pg);
        this.down.delete(door.url);
        this.used = door;
        this.error = null;
        const seen = new Set();
        const results = raw.results.filter(r => /^https?:\/\//.test(r.url ?? '') && !seen.has(r.url) && seen.add(r.url))
          .map((r, i) => ({ title: String(r.title ?? '').slice(0, 140), url: r.url, snippet: String(r.snippet ?? '').replace(/\s+/g, ' ').slice(0, 400), ...(r.date ? { date: String(r.date).slice(0, 10) } : {}), rank: i - (PREFERRED.test(r.url) ? 5 : 0) }))
          .sort((a, b) => a.rank - b.rank)
          .slice(0, 8)
          .map(({ rank, ...r }) => r);
        for (const r of results) this.allowed.add(r.url);
        if (this.allowed.size > 2000) this.allowed = new Set([...this.allowed].slice(-1000));
        return this.results.put(key, { results, answers: raw.answers.slice(0, 3).map(a => String(a).slice(0, 400)), infobox: raw.infobox, via: door.kind });
      } catch (e) {
        this.down.set(door.url, Date.now());
        errors.push(`${door.kind}: ${e.message}`);
      }
    }
    this.error = errors.length ? `web search is down (${errors.join('; ')})` : this.error ?? 'web search is down';
    throw new Error(this.error);
  }

  // a direct read of a url a search returned, the part about the question
  async read(url, { query = '', max = 4000 } = {}) {
    const u = String(url ?? '').trim();
    if (!/^https?:\/\//.test(u)) throw new Error('Not a web address.');
    let text = this.pages.hit(u);
    if (text === undefined) {
      if (!this.allowed.has(u)) throw new Error('Only pages returned by web_search can be read.');
      text = await this.fetchText(u);
      this.pages.put(u, text);
    }
    return focus(text, query, max);
  }

  async fetchText(url) {
    const res = await this.fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,text/plain' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
    if (!/text\/|html|xml/.test(res.headers.get('content-type') ?? '')) throw new Error('Not a text page.');
    const reader = res.body?.getReader?.();
    if (!reader) return htmlToText(await res.text());
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
      if (size > PAGE_BYTES) {
        reader.cancel().catch(() => {});
        break;
      }
    }
    return htmlToText(Buffer.concat(chunks).toString('utf8'));
  }

  // search, then read the best pages: grounding for one question about a book
  async research(q, { pages = 2, max = 2500 } = {}) {
    const found = await this.search(q);
    const read = await Promise.all(found.results.slice(0, pages).map(h => this.read(h.url, { query: q, max }).then(text => ({ ...h, text }), () => null)));
    return { ...found, pages: read.filter(p => p?.text) };
  }

  // which door answers; probes once when nothing has been searched yet
  async status() {
    if (!this.used) await this.search('dungeons and dragons 5e').catch(() => {});
    return { via: this.used?.kind ?? null, url: this.used?.url ?? null, error: this.used ? null : this.error, doors: this.doors };
  }
}

// excerpts for a prompt, each with where it came from
export function sourcesText(research, max = 6000) {
  if (!research) return '';
  const parts = [];
  for (const a of research.answers ?? []) parts.push(`ANSWER: ${a}`);
  if (research.infobox?.content) parts.push(`INFOBOX ${research.infobox.title ?? ''}: ${String(research.infobox.content).slice(0, 600)}`);
  for (const p of research.pages) parts.push(`SOURCE ${p.title} <${p.url}>\n${p.text}`);
  const used = new Set(research.pages.map(p => p.url));
  for (const h of research.results) if (!used.has(h.url) && h.snippet) parts.push(`SNIPPET ${h.title} <${h.url}>: ${h.snippet}`);
  return parts.join('\n\n').slice(0, max);
}
