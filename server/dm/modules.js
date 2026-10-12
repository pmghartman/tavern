// Adventure modules the owner supplies: a PDF or text file is read once by the DM
// model into scenes (areas, NPCs, encounters, DCs, treasure, read-aloud text) and
// stat blocks, saved under data/modules, and then every campaign that runs it
// plays from that prepared copy with no web lookups.
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync, statSync, appendFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { cpus } from 'node:os';
import { randomBytes } from 'node:crypto';
import { RuleError } from '../engine/util.js';
import { validateCreature } from '../engine/bestiary.js';
import { findMonsterKey } from '../engine/data/monsters.js';
import { DM_TOOLS } from './tools.js';
import { extractText, SUPPORTED, toBlocks, chunkBlocks, chunkPrompt, chunkParagraphs } from './extract.js';
import { findStatBlocks, parseStatBlock, settle } from './statblock.js';

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (x, n, f) => (Array.isArray(x) ? x.slice(0, n).map(f).filter(Boolean) : []);
// read-aloud goes to the players word for word, so a paragraph the model marked that
// talks to the DM (rules, hooks, advice) or never speaks to the party is left out
const DM_FACING = /\b(DM|Dungeon Master|the players?|player characters?|the characters|adventure hook|roleplay\w*|inspiration|stat block|appendix|experience points|XP|ability check|DC \d+|read the following|boxed text)\b/i;
const playerFacing = p => !DM_FACING.test(p) && /\byou(r|rs|'?ve|'?re|’ve|’re)?\b|["“]/i.test(p);
// cut at the end of a sentence, never mid-word
const sentenceClip = (s, n) => {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const end = Math.max(...['. ', '.\n', '! ', '? ', '.” ', '." '].map(e => cut.lastIndexOf(e)));
  return end > n / 2 ? cut.slice(0, end + 1).trim() : `${cut.replace(/\s+\S*$/, '')}…`;
};
const ACTIVE = new Set(['queued', 'reading', 'parsing']);
const THEMES = ['classic', 'grim', 'coastal', 'frontier', 'underdark'];
export const MAX_UPLOAD = 512 * 1024 * 1024;

const SCENES_TOOL = {
  name: 'define_scenes',
  description: 'The playable scenes in this passage of the adventure, in the order the book gives them. Empty when the passage has none.',
  parameters: { type: 'object', additionalProperties: false, required: ['scenes'], properties: { scenes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'summary', 'advance_when'], properties: {
    title: { type: 'string', description: 'scene title, as the book names the area or event' },
    location: { type: 'string', description: 'where it happens, as named in the book' },
    summary: { type: 'string', description: 'one or two sentences in your own words: what is here, who, what happens' },
    advance_when: { type: 'string', description: 'what the party does that ends the scene' },
    setup: { type: 'string', description: 'what the party walks into, two sentences in your own words' },
    npcs: { type: 'array', items: { type: 'string' }, description: 'NPCs and creatures in the scene, as named in the book' },
    areas: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'notes'], properties: { name: { type: 'string', description: 'keyed area name as in the book' }, notes: { type: 'string', description: 'features, hazards, hidden things, exits' } } } },
    npc_notes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'notes'], properties: { name: { type: 'string' }, notes: { type: 'string', description: 'role, manner, wants, what they know and will share' } } } },
    encounters: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['creatures'], properties: { creatures: { type: 'string', description: 'the book\'s creatures and numbers, e.g. "4 goblins, 1 wolf"' }, where: { type: 'string' }, when: { type: 'string', description: 'trigger, and how they behave' } } } },
    checks: { type: 'array', items: { type: 'string' }, description: 'ability checks the book calls for, with skill and DC' },
    treasure: { type: 'array', items: { type: 'string' }, description: 'treasure and rewards found here, as the book lists them' },
    leads: { type: 'array', items: { type: 'string' }, description: 'clues and hooks that point to later scenes' },
    read_aloud: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['paragraphs'], properties: { area: { type: 'string', description: 'the area or moment the text describes' }, paragraphs: { type: 'array', items: { type: 'integer' }, description: 'numbers of the boxed-text paragraphs' } } } },
  } } } } },
};

const MODULE_TOOL = {
  name: 'define_module',
  description: 'The published adventure as a whole.',
  parameters: { type: 'object', additionalProperties: false, required: ['name', 'premise'], properties: {
    name: { type: 'string', description: 'the adventure\'s title' },
    levels: { type: 'array', items: { type: 'integer' }, description: 'lowest and highest character level it is written for' },
    theme: { type: 'string', enum: THEMES },
    tone: { type: 'string', description: 'one or two words: heroic, horror, grim, lighthearted, intrigue' },
    world: { type: 'string', description: 'the setting or region' },
    start: { type: 'object', additionalProperties: false, required: ['name', 'description'], properties: { name: { type: 'string' }, description: { type: 'string', description: 'one or two sentences' } } },
    premise: { type: 'string', description: 'two sentences in your own words: how the adventure opens' },
    threat: { type: 'string', description: 'the villain and plan behind it all, one or two sentences' },
    chapters: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['index', 'summary'], properties: { index: { type: 'integer', description: 'chapter number from the list' }, levels: { type: 'string', description: 'e.g. 1-2' }, summary: { type: 'string', description: 'two sentences: what happens and what the party must achieve' } } } },
  } },
};

const CREATURE_TOOL = DM_TOOLS.find(t => t.name === 'define_creature');

function toolArgs(out, name) {
  let a = out.toolCalls.find(c => c.name === name)?.arguments;
  if (a?._raw) a = null;
  if (!a && out.content) {
    const m = /\{[\s\S]*\}/.exec(out.content);
    if (m) {
      try {
        a = JSON.parse(m[0]);
      } catch {
        a = null;
      }
    }
  }
  return a ?? null;
}

// a passage's text with its headings, as the book reads
const chunkText = c => c.blocks.map(b => (b.h ? `${'#'.repeat(b.h)} ${b.t}` : b)).join('\n\n');
// keyed areas and numbered rooms: each one is a scene
const KEYED = /^(?:[A-Z]{1,3}\d{1,3}[a-z]?|\d{1,3}[a-z]?)\.\s+\S|^Area\s+\w+/i;
// back matter is reference, not play: its monsters and items are not scenes
const REFERENCE = /^(appendix|appendices|index|rules index|credits|glossary|pregenerated characters)\b/i;
// a scene answers for a keyed area when it names it ("3. Kennel" by "Kennel")
const covers = (scenes, key) => {
  const name = key.replace(/^(?:[A-Z]{1,3}\d{1,3}[a-z]?|\d{1,3}[a-z]?)\.\s+|^Area\s+/i, '').toLowerCase();
  return scenes.some(s => [s?.title, s?.location, ...(Array.isArray(s?.areas) ? s.areas.map(a => a?.name) : [])].some(t => String(t ?? '').toLowerCase().includes(name)));
};

// a wait that ends early when the job is cancelled
async function pause(ms, ctl) {
  const end = Date.now() + ms;
  while (Date.now() < end && !ctl.cancelled) await new Promise(r => setTimeout(r, Math.min(1000, end - Date.now())));
  ctl.check();
}

export class Modules {
  constructor({ dir, llm, hub = null, config = {} }) {
    this.dir = dir;
    this.llm = llm;
    this.hub = hub;
    this.config = config;
    this.cache = new Map();
    this.running = new Map();
    mkdirSync(dir, { recursive: true });
    // a restart interrupts any ingest in flight; its finished passages are kept
    for (const id of this.ids()) {
      const m = this.read(id);
      if (m && ACTIVE.has(m.status)) this.save({ ...m, status: 'paused', error: 'Interrupted when the server stopped. Resume to continue where it left off.' });
    }
  }

  ids() {
    try {
      return readdirSync(this.dir, { withFileTypes: true }).filter(d => d.isDirectory() && /^[a-z0-9]+$/.test(d.name)).map(d => d.name);
    } catch {
      return [];
    }
  }

  path(id, file) {
    return join(this.dir, id, file);
  }

  read(id) {
    try {
      return JSON.parse(readFileSync(this.path(id, 'module.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  save(m) {
    m.updated = Date.now();
    mkdirSync(join(this.dir, m.id), { recursive: true });
    const tmp = this.path(m.id, 'module.json.tmp');
    writeFileSync(tmp, JSON.stringify(m));
    renameSync(tmp, this.path(m.id, 'module.json'));
    this.cache.set(m.id, { ...(this.cache.get(m.id) ?? {}), mod: m, index: null });
    this.announce();
  }

  announce() {
    this.hub?.broadcast('lobby', 'modules', this.list());
  }

  source(id) {
    try {
      return JSON.parse(readFileSync(this.path(id, 'source.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  // the module as campaigns use it: prepared scenes plus its source text for lookups
  get(id) {
    if (!/^[a-z0-9]{6,32}$/.test(String(id))) return null;
    const hit = this.cache.get(id);
    const mod = hit?.mod ?? this.read(id);
    if (!mod) return null;
    if (!hit) this.cache.set(id, { mod, index: null });
    return mod;
  }

  list() {
    return this.ids().map(id => this.get(id)).filter(Boolean).map(m => this.summary(m)).sort((a, b) => b.created - a.created);
  }

  summary(m) {
    const beats = (m.chapters ?? []).reduce((n, c) => n + c.beats.length, 0);
    return {
      id: m.id, name: m.name, file: m.file, status: m.status, phase: m.phase ?? '', done: m.done ?? 0, total: m.total ?? 0, error: m.error ?? null,
      created: m.created, updated: m.updated, levels: m.meta?.levels ?? null, theme: m.meta?.theme ?? null, tone: m.meta?.tone ?? null, world: m.meta?.world ?? null,
      premise: m.meta?.premise ?? null, chapters: (m.chapters ?? []).length, scenes: beats, creatures: (m.creatures ?? []).length, srdCreatures: (m.srd ?? []).length, unplayable: m.unplayable ?? [], skipped: m.failed ?? 0,
      pages: m.read?.pages ?? null, ocrPages: m.read?.ocrPages ?? 0, unreadPages: m.read?.unreadPages ?? 0, statBlocks: m.read?.statBlocks ?? null,
      rereadable: existsSync(this.path(m.id, 'original' + extname(m.file || '').toLowerCase())) && !this.running.has(m.id),
    };
  }

  // the uploaded file, kept so a module can be read again by a newer reader
  original(m) {
    const p = this.path(m.id, 'original' + extname(m.file || '').toLowerCase());
    return existsSync(p) ? p : null;
  }

  log(id, line) {
    try {
      appendFileSync(this.path(id, 'log.txt'), `${new Date().toISOString()} ${line}\n`);
    } catch {
      /* the module was deleted */
    }
  }

  // a new module: the file is read at once, the DM model prepares it in the background
  create({ filename, buffer }) {
    const id = randomBytes(6).toString('hex');
    const name = String(filename ?? 'Module').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 80) || 'Module';
    const m = { id, name, file: String(filename ?? '').slice(0, 120), status: 'queued', phase: 'Queued', done: 0, total: 0, error: null, created: Date.now(), chapters: [], creatures: [], parts: {}, beasts: {}, failed: 0, meta: null };
    this.save(m);
    writeFileSync(this.path(id, 'original' + extname(m.file).toLowerCase()), buffer);
    // a long book's file is not held in memory for the hours its scenes take
    const held = { buffer };
    this.start(id, async () => {
      if (!this.llm.available) throw new RuleError('A DM model is needed to prepare a module, and none is configured.');
      await this.readFile(id, held.buffer, filename);
      held.buffer = null;
      await this.prepare(id);
    });
    return this.summary(m);
  }

  // files left in the inbox folder are picked up like a drop; each is read once
  // (name, size and mtime recorded) so a module the owner deleted does not return
  scanInbox() {
    const dirs = this.config.modulesInbox ?? [];
    if (!dirs.length || !this.llm.available) return 0;
    const seenFile = join(this.dir, 'inbox.json');
    let seen = {};
    try {
      seen = JSON.parse(readFileSync(seenFile, 'utf8'));
    } catch {
      /* first scan */
    }
    this.warned ??= new Set();
    const warn = (what, e) => {
      // missing is fine; unreadable is worth saying, once
      if (e.code === 'ENOENT' || this.warned.has(what + e.code)) return;
      this.warned.add(what + e.code);
      console.error(`module inbox ${what}: ${e.message}`);
    };
    let added = 0;
    for (const dir of dirs) {
      let names;
      try {
        names = readdirSync(dir);
      } catch (e) {
        warn(dir, e);
        continue;
      }
      for (const name of names) {
        if (!SUPPORTED.includes(extname(name).toLowerCase())) continue;
        const file = join(dir, name);
        try {
          const st = statSync(file);
          const key = `${name}:${st.size}:${Math.floor(st.mtimeMs)}`;
          if (!st.isFile() || !st.size || st.size > MAX_UPLOAD || seen[key]) continue;
          // still being copied in: wait for the next scan
          if (Date.now() - st.mtimeMs < 5000) continue;
          const buffer = readFileSync(file);
          seen[key] = Date.now();
          writeFileSync(seenFile, JSON.stringify(seen));
          this.create({ filename: name, buffer });
          added++;
        } catch (e) {
          // unreadable files are tried again next scan
          warn(file, e);
        }
      }
    }
    return added;
  }

  watchInbox(everyMs = 60000) {
    if (!(this.config.modulesInbox ?? []).length) return;
    this.scanInbox();
    this.inboxTimer = setInterval(() => this.scanInbox(), everyMs);
    this.inboxTimer.unref();
  }

  resume(id) {
    const m = this.get(id);
    if (!m) throw new RuleError('No such module.', 'not_found');
    if (this.running.has(id) || m.status === 'ready') return this.summary(m);
    if (!this.source(id)) throw new RuleError('This module was never read in full; upload the file again.');
    this.start(id, () => this.prepare(id));
    return this.summary(this.get(id));
  }

  // read the kept file again from the start (a newer reader, or a run that went wrong)
  reread(id) {
    const m = this.get(id);
    if (!m) throw new RuleError('No such module.', 'not_found');
    if (this.running.has(id)) return this.summary(m);
    const file = this.original(m);
    if (!file) throw new RuleError('The file for this module was not kept; upload it again.');
    this.save({ ...m, status: 'queued', phase: 'Queued', done: 0, total: 0, error: null, parts: {}, beasts: {}, failed: 0 });
    this.log(id, 'read again from the start');
    this.start(id, async () => {
      if (!this.llm.available) throw new RuleError('A DM model is needed to prepare a module, and none is configured.');
      await this.readFile(id, readFileSync(file), m.file);
      await this.prepare(id);
    });
    return this.summary(this.get(id));
  }

  remove(id) {
    const m = this.get(id);
    if (!m) throw new RuleError('No such module.', 'not_found');
    this.running.get(id)?.cancel();
    this.cache.delete(id);
    rmSync(join(this.dir, id), { recursive: true, force: true });
    this.announce();
  }

  start(id, job) {
    const ctl = { cancelled: false, abort: new AbortController() };
    ctl.signal = ctl.abort.signal;
    // stops the job where it is, including a model request in flight
    ctl.cancel = () => {
      ctl.cancelled = true;
      ctl.abort.abort(new Error('cancelled'));
    };
    ctl.check = () => {
      if (ctl.cancelled) throw new Error('cancelled');
    };
    ctl.patch = p => {
      const m = this.read(id);
      if (m && !ctl.cancelled) this.save({ ...m, ...p });
    };
    this.running.set(id, ctl);
    ctl.done = (async () => {
      try {
        await job();
      } catch (e) {
        // a request aborted by the cancel surfaces as a model error
        if (!ctl.cancelled) {
          console.error(`module ${id}: ${e.message}`);
          // once the file is read, whatever stopped it can be resumed
          ctl.patch({ status: this.source(id) ? 'paused' : 'error', phase: '', error: e.message });
        }
      } finally {
        this.running.delete(id);
      }
    })();
    return ctl;
  }

  async idle() {
    await Promise.allSettled([...this.running.values()].map(c => c.done));
  }

  // shutdown: preparation in flight stops where it is; finished passages are kept and
  // the module is marked paused on the next start. A step that can't be interrupted
  // (a page being read by OCR) is not waited on for long
  async stop(wait = 5000) {
    clearInterval(this.inboxTimer);
    for (const ctl of this.running.values()) ctl.cancel();
    let timer;
    await Promise.race([this.idle(), new Promise(r => (timer = setTimeout(r, wait)))]);
    clearTimeout(timer);
  }

  async readFile(id, buffer, filename) {
    const ctl = this.running.get(id);
    ctl.patch({ status: 'reading', phase: 'Reading the file', done: 0, total: 0 });
    // page progress, written at most every two seconds
    let last = 0;
    const onProgress = (phase, done, total) => {
      if (Date.now() - last < 2000 && done < total) return;
      last = Date.now();
      ctl.check();
      ctl.patch({ phase, done, total });
    };
    const stats = {};
    const started = Date.now();
    const ocrCache = join(this.dir, '.ocr');
    mkdirSync(ocrCache, { recursive: true });
    const workers = this.config.ocrWorkers ?? Math.max(1, Math.min(4, cpus().length - 1));
    const text = await extractText(buffer, filename, { onProgress, ocrCache, ocrWorkers: workers, stats });
    ctl.check();
    const { chapters, chunks } = chunkBlocks(toBlocks(text));
    if (!chunks.length) throw new RuleError('Nothing readable was found in that file.');
    // stat blocks are read from the whole text, so none is cut in two by a passage break
    const statblocks = findStatBlocks(text);
    mkdirSync(join(this.dir, id), { recursive: true });
    writeFileSync(this.path(id, 'source.json'), JSON.stringify({ chapters, chunks, statblocks }));
    const read = { ...stats, chars: text.length, chapters: chapters.length, passages: chunks.length, statBlocks: statblocks.length, seconds: Math.round((Date.now() - started) / 1000) };
    this.log(id, `read ${filename}: ${JSON.stringify(read)}`);
    if (stats.ocrMissing) this.log(id, `OCR unavailable: ${stats.ocrMissing}`);
    ctl.patch({ chars: text.length, read, total: statblocks.length + chunks.length + 1, done: 0 });
  }

  // stat blocks first (most need no model), then passage by passage the scenes, then the whole-book summary
  async prepare(id) {
    const ctl = this.running.get(id);
    const src = this.source(id);
    // modules read before stat blocks were found book-wide
    src.statblocks ??= findStatBlocks(src.chunks.map(chunkText).join('\n\n'));
    const endpoint = this.config.dmModel ?? undefined;
    const total = src.statblocks.length + src.chunks.length + 1;
    const progress = m => Object.values(m.beasts ?? {}).filter(b => !b.failed).length + Object.values(m.parts ?? {}).filter(p => !p.failed).length;
    ctl.patch({ status: 'parsing', phase: 'Reading stat blocks', error: null, total });
    await this.prepareCreatures(id, src, endpoint, ctl, progress);
    ctl.patch({ phase: 'Preparing scenes' });
    // passages that failed on an earlier run are tried again
    const first = this.read(id);
    const queue = src.chunks.map((_, i) => i).filter(i => !first.parts?.[i] || first.parts[i].failed);
    ctl.patch({ failed: 0, done: progress(first) });
    let streak = 0;
    const retried = new Set();
    const worker = async () => {
      while (queue.length) {
        ctl.check();
        const i = queue.shift();
        let part = null;
        if (REFERENCE.test(src.chapters[src.chunks[i].chapter] ?? '')) {
          part = { scenes: [], creatures: [], reference: true };
          this.log(id, `passage ${i + 1}/${src.chunks.length} [${src.chunks[i].path || src.chapters[src.chunks[i].chapter]}]: reference, no scenes`);
        } else try {
          part = await this.parseChunk(src, i, endpoint, this.read(id).name, ctl);
          streak = 0;
          this.log(id, `passage ${i + 1}/${src.chunks.length} [${src.chunks[i].path || src.chapters[src.chunks[i].chapter] || ''}]: ${part.scenes.length} scenes${part.split ? `, read in ${part.split} parts` : ''}`);
        } catch (e) {
          ctl.check();
          console.error(`module ${id} passage ${i + 1}: ${e.message}`);
          this.log(id, `passage ${i + 1}/${src.chunks.length} failed: ${e.message}`);
          // the model is not answering: wait for it (up to about half an hour) instead of skipping the book
          if (++streak >= 3) {
            if (streak >= 9) throw new RuleError(`The DM model is not answering (${e.message}). Resume once it is back.`);
            const wait = Math.min(600000, 30000 * 2 ** (streak - 3));
            ctl.patch({ phase: `The DM model is not answering; trying again in ${Math.round(wait / 60000) || 1} min` });
            queue.unshift(i);
            await pause(wait, ctl);
            ctl.patch({ phase: 'Preparing scenes' });
            continue;
          }
          // a passage that failed once more is tried again at the end
          if (!retried.has(i)) {
            retried.add(i);
            queue.push(i);
            continue;
          }
        }
        ctl.check();
        const m = this.read(id);
        m.parts = { ...(m.parts ?? {}), [i]: part ?? { scenes: [], creatures: [], failed: true } };
        m.failed = Object.values(m.parts).filter(p => p.failed).length;
        m.done = progress(m);
        this.save(m);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(4, this.config.ingestConcurrency ?? 2)) }, worker));
    ctl.check();
    ctl.patch({ phase: 'Putting the adventure together' });
    const m = this.assemble(this.read(id), src);
    if (!m.chapters.length) throw new RuleError('No playable scenes were found in that file. Is it an adventure?');
    m.meta = await this.parseMeta(m, src, endpoint, ctl).catch(e => (console.error(`module ${id} summary: ${e.message}`), null)) ?? fallbackMeta(m);
    ctl.check();
    m.name = clip(m.meta.name, 80) || m.name;
    for (const c of m.chapters) c.summary ||= c.beats[0]?.summary ?? '';
    this.log(id, `ready: ${m.chapters.length} chapters, ${m.chapters.reduce((n, c) => n + c.beats.length, 0)} scenes, ${m.creatures.length + m.srd.length} stat blocks (${m.srd.length} from the SRD${m.unplayable.length ? `; not playable: ${m.unplayable.join(', ')}` : ''}), ${m.failed ?? 0} passages skipped`);
    this.save({ ...m, status: 'ready', phase: '', error: null, done: m.total, parts: undefined, beasts: undefined });
  }

  // every stat block in the book: read field by field, the model only for what that can't read
  async prepareCreatures(id, src, endpoint, ctl, progress) {
    const m0 = this.read(id);
    const todo = src.statblocks.map((_, i) => i).filter(i => !m0.beasts?.[i] || m0.beasts[i].failed);
    let pending = {};
    const flush = () => {
      if (!Object.keys(pending).length) return;
      const m = this.read(id);
      m.beasts = { ...(m.beasts ?? {}), ...pending };
      m.done = progress(m);
      this.save(m);
      pending = {};
    };
    let llmFails = 0;
    for (const i of todo) {
      ctl.check();
      const block = src.statblocks[i];
      let out;
      const parsed = parseStatBlock(block, this.read(id).name);
      const spec = parsed.spec && settle(parsed.spec, validateCreature);
      if (spec && !parsed.error) {
        out = findMonsterKey(spec.name) ? { srd: true, name: spec.name } : { spec: { ...spec, name: validateCreature(spec).name } };
      } else if (findMonsterKey(block.name)) out = { srd: true, name: block.name };
      else if (llmFails >= 5) out = { failed: true, name: block.name, why: 'the model is not answering' };
      else {
        flush();
        ctl.patch({ phase: `Reading stat block ${block.name}` });
        try {
          const llm = await this.parseCreature(block.text.slice(0, 6000), endpoint, this.read(id).name, parsed.error, ctl);
          out = llm ? { spec: llm, model: true } : { skipped: true, name: block.name, why: parsed.error };
          llmFails = 0;
        } catch (e) {
          ctl.check();
          llmFails++;
          out = { failed: true, name: block.name, why: e.message };
        }
        ctl.patch({ phase: 'Reading stat blocks' });
      }
      this.log(id, `stat block ${i + 1}/${src.statblocks.length} ${block.name}: ${out.spec ? (out.model ? 'read by the model' : 'read') : out.srd ? 'in the SRD already' : out.failed ? `failed (${out.why})` : `not playable (${out.why})`}`);
      pending[i] = out;
      if (Object.keys(pending).length >= 10) flush();
    }
    flush();
  }

  // the scenes of one passage; a passage the model can't answer in one go is read in halves
  async parseChunk(src, i, endpoint, name, ctl = null) {
    const chunk = src.chunks[i];
    const ctx = { src, i, endpoint, name, ctl, chunk, splits: 0 };
    const scenes = await this.sceneBlocks(ctx, chunk.blocks, 0);
    return { scenes, creatures: [], split: ctx.splits ? ctx.splits + 1 : 0 };
  }

  async sceneBlocks(ctx, blocks, depth) {
    const { src, i, endpoint, name, chunk } = ctx;
    const sub = { ...chunk, blocks };
    const paras = chunkParagraphs(sub);
    const keyed = blocks.filter(b => b.h && KEYED.test(b.t)).map(b => b.t);
    let args = null;
    let best = null;
    let err = null;
    let answered = false;
    let timedOut = false;
    let hint = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const out = await this.llm.chat({ endpoint, signal: ctx.ctl?.signal, temperature: 0.2, maxTokens: 8000, tools: [SCENES_TOOL], toolChoice: 'define_scenes', messages: [
          { role: 'system', content: 'You are preparing a published Dungeons & Dragons 5th edition adventure for a dungeon master to run exactly as written. You are given one passage of the book; its paragraphs are numbered [n]. List every playable scene in this passage in the order the book gives them: each keyed area or room (a numbered or lettered area such as "E1. Village Gates" is always its own scene), encounter, social scene or event the party goes through (a scene is one location or event). Use the book\'s own names for places and NPCs. Summarize in your own words, never copying more than a few words, but give creatures and numbers, DCs, treasure and what leads onward exactly as written. In read_aloud give the numbers of the paragraphs that are boxed text or text the DM reads aloud to the players (usually second person, "You see..."), with the area each one describes; never include paragraphs written for the DM. Leave out credits, contents pages, appendices, stat blocks, magic item descriptions and rules sidebars. If the passage holds no playable scene, return an empty list. Respond by calling define_scenes.' },
          { role: 'user', content: `Adventure: ${name}. Chapter: ${src.chapters[chunk.chapter] ?? ''}. Passage ${i + 1} of ${src.chunks.length}${sub.path ? ` (${sub.path})` : ''}.\n\n${chunkPrompt(sub)}${hint}` },
        ] });
        answered = true;
        args = toolArgs(out, 'define_scenes');
        if (!args || !Array.isArray(args.scenes)) {
          args = null;
          // cut off mid-answer: the passage is too much for one answer
          if (out.finishReason === 'length') break;
          throw new Error('the model returned no scene list');
        }
        const missing = keyed.filter(k => !covers(args.scenes, k));
        if (!best || missing.length < best.missing.length) best = { args, missing };
        // keyed areas left out (or run together into one scene): once more, naming them
        if (best.missing.length && !hint) {
          hint = `\n\nThis passage describes these keyed areas, each its own scene: ${keyed.join('; ')}.${args.scenes.length ? ` Your last answer left out: ${missing.join('; ')}.` : ''}`;
          continue;
        }
        err = null;
        break;
      } catch (e) {
        err = e;
        // a first answer stands if asking again fails
        if (best) break;
        // a passage too long to answer in time is read in halves rather than asked again
        if (/timeout|timed out/i.test(e.message) && !ctx.ctl?.cancelled && blocks.length > 1 && depth < 3) {
          timedOut = true;
          break;
        }
        if (ctx.ctl) await pause(attempt ? 20000 : 5000, ctx.ctl);
      }
    }
    args = best?.args ?? null;
    if (!args && (answered || timedOut) && blocks.length > 1 && depth < 3) {
      // halves at the heading nearest the middle
      let cut = Math.floor(blocks.length / 2);
      const heads = blocks.map((b, k) => (b.h && k > 0 ? k : -1)).filter(k => k > 0);
      if (heads.length) cut = heads.reduce((a, b) => (Math.abs(b - blocks.length / 2) < Math.abs(a - blocks.length / 2) ? b : a));
      ctx.splits++;
      return [...await this.sceneBlocks(ctx, blocks.slice(0, cut), depth + 1), ...await this.sceneBlocks(ctx, blocks.slice(cut), depth + 1)];
    }
    if (!args) throw err ?? new Error('the model returned no scene list');
    const used = new Set();
    return args.scenes.map(s => {
      const readAloud = list(s.read_aloud, 8, r => {
        const ns = (Array.isArray(r?.paragraphs) ? r.paragraphs : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= paras.length && !used.has(n)).slice(0, 6);
        ns.forEach(n => used.add(n));
        const text = ns.map(n => paras[n - 1]).filter(playerFacing).join('\n\n').trim();
        return text.length > 20 && { area: clip(r.area, 80), text: sentenceClip(text, 2000) };
      });
      return {
        title: clip(s.title, 80), location: clip(s.location, 80), summary: clip(s.summary, 400), advanceWhen: clip(s.advance_when, 200), npcs: list(s.npcs, 12, x => clip(x, 60)), chunk: i,
        brief: {
          setup: clip(s.setup || s.summary, 500),
          areas: list(s.areas, 16, x => x?.name && { name: clip(x.name, 60), notes: clip(x.notes, 400) }),
          npcs: list(s.npc_notes, 12, x => x?.name && { name: clip(x.name, 60), notes: clip(x.notes, 400) }),
          encounters: list(s.encounters, 10, x => x?.creatures && { creatures: clip(x.creatures, 140), where: clip(x.where, 80), when: clip(x.when, 220) }),
          checks: list(s.checks, 12, x => clip(x, 180)),
          treasure: list(s.treasure, 12, x => clip(x, 180)),
          leads: list(s.leads, 8, x => clip(x, 200)),
        },
        readAloud,
      };
    }).filter(b => b.title);
  }

  // a stat block from the book, checked by the engine's own validator
  async parseCreature(block, endpoint, name, why = '', ctl = null) {
    let problem = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = await this.llm.chat({ endpoint, signal: ctl?.signal, temperature: 0.1, maxTokens: 2200, tools: [CREATURE_TOOL], toolChoice: 'define_creature', messages: [
        { role: 'system', content: 'You read Dungeons & Dragons 5th edition stat blocks precisely. The passage holds a creature\'s stat block from a published adventure; its name is the line just before its size and type. Give that stat block exactly as printed: AC, hit points, speed, ability scores, saves, skills, senses, attacks (to hit, damage, reach or range), multiattack, special abilities and spellcasting. Respond by calling define_creature.' },
        { role: 'user', content: `Adventure: ${name}.${why ? ` (A plain reading of it failed: ${why}.)` : ''}\n\n${block}${problem ? `\n\nYour last answer was rejected: ${problem} Fix that.` : ''}` },
      ] });
      const args = toolArgs(out, 'define_creature');
      if (!args) {
        problem = 'no stat block was returned.';
        continue;
      }
      try {
        const def = validateCreature(args);
        if (findMonsterKey(def.name)) return null;
        return { ...args, name: def.name, source: args.source || name };
      } catch (e) {
        problem = e.message;
        // the last try keeps what the engine can play
        const kept = attempt === 1 && settle(args, validateCreature);
        if (kept) return findMonsterKey(kept.name) ? null : { ...kept, name: validateCreature(kept).name, source: kept.source || name };
      }
    }
    return null;
  }

  assemble(m, src) {
    const chapters = src.chapters.map(title => ({ title: clip(title, 80), levels: '', summary: '', locations: [], npcs: [], beats: [] }));
    const creatures = [];
    for (const i of Object.keys(m.parts ?? {}).map(Number).sort((a, b) => a - b)) {
      const part = m.parts[i];
      const ch = chapters[src.chunks[i]?.chapter ?? 0];
      if (!ch) continue;
      for (const b of part.scenes ?? []) if (!ch.beats.some(x => x.title.toLowerCase() === b.title.toLowerCase() && x.location === b.location)) ch.beats.push(b);
      for (const c of part.creatures ?? []) if (!creatures.some(x => x.name.toLowerCase() === c.name.toLowerCase())) creatures.push(c);
    }
    // the book's stat blocks: its own creatures, those the engine has from the SRD, and any it can't play
    const srd = [];
    const unplayable = [];
    for (const i of Object.keys(m.beasts ?? {}).map(Number).sort((a, b) => a - b)) {
      const b = m.beasts[i];
      const c = b.spec;
      if (c && !creatures.some(x => x.name.toLowerCase() === c.name.toLowerCase())) creatures.push(c);
      else if (b.srd && !srd.includes(b.name)) srd.push(b.name);
      else if (!c && !b.srd && b.name) unplayable.push(b.name);
    }
    for (const c of chapters) {
      c.locations = [...new Set(c.beats.map(b => b.location).filter(Boolean))].slice(0, 16);
      c.npcs = [...new Set(c.beats.flatMap(b => b.npcs))].slice(0, 20);
    }
    return { ...m, chapters: chapters.filter(c => c.beats.length), creatures: creatures.slice(0, 500), srd, unplayable };
  }

  async parseMeta(m, src, endpoint, ctl = null) {
    const intro = src.chunks.slice(0, 2).map(c => chunkPrompt(c)).join('\n\n').slice(0, 3500);
    const out = await this.llm.chat({ endpoint, signal: ctl?.signal, temperature: 0.2, maxTokens: 2500, tools: [MODULE_TOOL], toolChoice: 'define_module', messages: [
      { role: 'system', content: 'You summarize a published Dungeons & Dragons 5th edition adventure for its dungeon master, in your own words, never quoting the book. Respond by calling define_module.' },
      { role: 'user', content: `File: ${m.file}\n\nOPENING PAGES:\n${intro}\n\nCHAPTERS AND THEIR SCENES:\n${m.chapters.map((c, i) => `${i + 1}. ${c.title}: ${c.beats.slice(0, 12).map(b => b.title).join('; ')}`).join('\n').slice(0, 5000)}\n\nGive the adventure's title, character levels, theme, tone, setting, its real starting location, the opening premise, the true villain and plan, and a summary of each chapter by its number.` },
    ] });
    const a = toolArgs(out, 'define_module');
    if (!a?.premise) throw new Error('the model returned no summary');
    for (const c of Array.isArray(a.chapters) ? a.chapters : []) {
      const ch = m.chapters[Number(c.index) - 1];
      if (ch) Object.assign(ch, { summary: clip(c.summary, 400), levels: clip(c.levels, 12) });
    }
    const lv = (Array.isArray(a.levels) ? a.levels : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 20);
    const first = m.chapters[0].beats[0];
    return {
      name: clip(a.name, 80) || m.name,
      levels: lv.length ? [Math.min(...lv), Math.max(...lv)] : [1, 20],
      theme: THEMES.includes(a.theme) ? a.theme : 'classic',
      tone: clip(a.tone, 30) || null,
      world: clip(a.world, 80) || 'the adventure',
      start: { name: clip(a.start?.name, 80) || first.location || first.title, description: clip(a.start?.description, 300) || first.summary },
      premise: clip(a.premise, 500),
      threat: clip(a.threat, 400),
    };
  }

  // --- what campaigns use ---

  // the campaign's copy of the structure; briefs and read-aloud stay in the module
  skeleton(m) {
    return {
      adventure: m.name, moduleId: m.id, chapter: 0, beat: 0, shown: [],
      chapters: m.chapters.map(c => ({ title: c.title, levels: c.levels, summary: c.summary, locations: c.locations, npcs: c.npcs, beats: c.beats.map(b => ({ title: b.title, location: b.location, summary: b.summary, npcs: b.npcs, advanceWhen: b.advanceWhen })) })),
    };
  }

  beat(m, ci, bi) {
    return m?.chapters?.[ci]?.beats?.[bi] ?? null;
  }

  // passages of the book that answer a question, best first
  search(m, query, { chapter = null, limit = 3, chars = 2600 } = {}) {
    const src = this.source(m.id);
    if (!src) return '';
    const hit = this.cache.get(m.id);
    if (!hit.index) hit.index = buildIndex(src);
    const q = tokens(query);
    if (!q.length) return '';
    const idf = t => Math.log(1 + hit.index.passages.length / (1 + (hit.index.df.get(t) ?? 0)));
    const scored = hit.index.passages.map(p => {
      let s = 0;
      for (const t of q) {
        const tf = p.tf.get(t);
        if (tf) s += idf(t) * (1 + Math.log(tf));
        if (p.pathTerms.has(t)) s += idf(t) * 1.5;
      }
      if (chapter != null && p.chapter === chapter) s *= 1.25;
      return { p, s };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit);
    let used = 0;
    const out = [];
    for (const { p } of scored) {
      const t = `[${p.path || src.chapters[p.chapter] || ''}] ${p.text}`.slice(0, Math.max(300, chars - used));
      out.push(t);
      used += t.length;
      if (used >= chars) break;
    }
    return out.join('\n\n');
  }
}

function fallbackMeta(m) {
  const first = m.chapters[0].beats[0];
  return { name: m.name, levels: [1, 20], theme: 'classic', tone: null, world: 'the adventure', start: { name: first.location || first.title, description: first.summary }, premise: first.summary, threat: '' };
}

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'what', 'who', 'where', 'when', 'how', 'does', 'did', 'are', 'was', 'were', 'have', 'has', 'from', 'into', 'about', 'their', 'there', 'they', 'them', 'will', 'can', 'you', 'your', 'not', 'but', 'any', 'all', 'its', 'book', 'say', 'says']);
const tokens = s => [...String(s ?? '').toLowerCase().matchAll(/[a-z0-9']{3,}/g)].map(m => m[0].replace(/'s$|'/g, '')).filter(t => t.length >= 3 && !STOP.has(t));

// passages of about 900 characters, each with the heading path it sits under
function buildIndex(src) {
  const passages = [];
  for (const chunk of src.chunks) {
    let path = chunk.path;
    let cur = '';
    const push = () => {
      if (cur.trim()) passages.push({ chapter: chunk.chapter, path, text: cur.trim() });
      cur = '';
    };
    for (const b of chunk.blocks) {
      if (b.h) {
        push();
        path = b.t;
        continue;
      }
      if (cur && cur.length + b.length > 900) push();
      cur += (cur ? '\n' : '') + b;
    }
    push();
  }
  const df = new Map();
  for (const p of passages) {
    p.tf = new Map();
    for (const t of tokens(p.text)) p.tf.set(t, (p.tf.get(t) ?? 0) + 1);
    p.pathTerms = new Set(tokens(p.path));
    for (const t of p.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return { passages, df };
}
