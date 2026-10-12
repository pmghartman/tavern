// Tavern's model on a phosphorus host: phos's chimp, another mesh model, or
// one of OpenCode Zen's free agents. Mesh models (phos/<host>) go through
// phos's model proxy with native tool calls. The free agents (opencode/<id>)
// answer only opencode itself, so they go through tavern's own copy of the
// opencode phos ships, jailed and stripped of every tool (opencode.js); no
// provider key ever leaves phos and nothing that costs money can be picked.

import { join } from 'node:path';
import { LLM, LLMError } from './llm.js';
import { Opencode, FREE_PROVIDER } from './opencode.js';

const STATE_MS = 10000;
const MESH = 'phos';
const MODEL_RE = /^[a-z0-9][a-z0-9._-]{0,63}\/[^\s/]\S{0,199}$/i;
// the setting holding the agent picked in tavern, '' for phos's chimp
export const AGENT_KEY = 'agent';

export class PhosLLM {
  constructor(config, { store } = {}) {
    this.config = config;
    this.store = store;
    this.url = String(config.phosUrl).replace(/\/+$/, '');
    // phos's proxy speaks the OpenAI API, model = the mesh host's name
    this.proxy = new LLM({ ...config, models: [{ name: 'chimp', url: `${this.url}/api/model/v1` }] });
    this.opencode = new Opencode({ bin: config.opencodeBin, home: join(config.dataDir, 'opencode'), sandbox: config.opencodeSandbox });
    this.state = { at: 0, model: null, error: null };
    this.free = { error: null };
    this.last = { status: 'unknown', error: null };
  }

  get available() {
    return true;
  }

  // a free agent picked before the free agents went away falls back to chimp
  get selected() {
    const sel = this.store?.getSetting(AGENT_KEY) ?? '';
    return sel && !sel.startsWith(`${MESH}/`) && this.opencode.unavailable ? '' : sel;
  }

  async select(model) {
    const m = String(model ?? '').trim();
    if (m && !MODEL_RE.test(m)) throw new LLMError('An agent is provider/model, as phos/tower or opencode/big-pickle.');
    if (m && !m.startsWith(`${MESH}/`)) {
      if (!m.startsWith(`${FREE_PROVIDER}/`)) throw new LLMError('Only phos mesh models and OpenCode Zen\'s free agents can be picked here.');
      const why = this.opencode.unavailable;
      if (why) throw new LLMError(why);
      if (!(await this.opencode.freeModels()).some(x => `${FREE_PROVIDER}/${x.id}` === m)) throw new LLMError(`${m} is not one of OpenCode Zen's free agents.`);
    }
    this.store.setSetting(AGENT_KEY, m);
    return this.agents();
  }

  async get(path, timeout = 5000) {
    const res = await fetch(`${this.url}${path}`, { signal: AbortSignal.timeout(timeout) });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error ?? `phos answered ${res.status}`);
    return body;
  }

  // phos's model summary: mesh models, each role's choice and what it resolves to
  async summary(force = false) {
    if (!force && Date.now() - this.state.at < STATE_MS) return this.state.model;
    try {
      this.state = { at: Date.now(), model: (await this.get('/api/state')).model ?? null, error: null };
    } catch (e) {
      this.state = { at: Date.now(), model: null, error: `phos unreachable at ${this.url}: ${e.message}` };
    }
    return this.state.model;
  }

  // Zen's free models, as tavern's jailed opencode lists them; none when it can't run
  async freeAgents() {
    if (this.opencode.unavailable) return [];
    try {
      const list = await this.opencode.freeModels();
      this.free = { error: null };
      return list;
    } catch (e) {
      this.free = { error: e.message };
      return [];
    }
  }

  // the model tavern asks: the picked agent, else whatever phos's chimp is
  async resolve() {
    const sum = await this.summary();
    if (this.selected) return { model: this.selected, chimp: false };
    const chimp = sum?.roles?.chimp;
    const model = chimp?.model || (sum?.chimp ? `${MESH}/${sum.chimp}` : '');
    if (!model) throw new LLMError(this.state.error ?? chimp?.why ?? 'phos has no chimp model loaded');
    if (chimp && !chimp.ready) throw new LLMError(`phos's chimp isn't ready: ${chimp.why || 'loading'}`);
    return { model, chimp: true };
  }

  // the selector's contents: phos's mesh first, then the free agents
  async agents({ refresh = false } = {}) {
    if (refresh) this.opencode.listed = { at: 0, body: null };
    const [sum, free] = await Promise.all([this.summary(refresh), this.freeAgents()]);
    const mesh = (sum?.models ?? []).map(m => ({ id: `${MESH}/${m.host}`, name: m.file ? `${m.host} · ${m.file}` : m.host, ready: !!m.ready, why: m.why || '' }));
    const groups = [
      { id: MESH, name: 'mesh', models: mesh },
      { id: FREE_PROVIDER, name: 'free agents (OpenCode Zen)', models: free.map(m => ({ id: `${FREE_PROVIDER}/${m.id}`, name: m.name, ready: true })) },
    ];
    const sel = this.selected;
    if (sel && !groups.some(g => g.models.some(m => m.id === sel))) {
      const g = groups.find(x => sel.startsWith(`${x.id}/`)) ?? groups[0];
      g.models.push({ id: sel, name: sel.slice(sel.indexOf('/') + 1), ready: false, why: 'not in the list right now' });
    }
    const chimp = sum?.roles?.chimp ?? null;
    return {
      phos: this.url, reachable: !!sum, error: this.state.error ?? this.free.error ?? null,
      selected: sel,
      chimp: chimp ? { model: chimp.model || '', ready: !!chimp.ready, why: chimp.why || '' } : sum?.chimp ? { model: `${MESH}/${sum.chimp}`, ready: true, why: '' } : null,
      groups: groups.filter(g => g.models.length),
      status: this.last,
    };
  }

  async probe(force = false) {
    await this.summary(force);
    return this.describe();
  }

  describe() {
    const sum = this.state.model;
    const sel = this.selected;
    const chimp = sum?.roles?.chimp;
    const model = sel || chimp?.model || (sum?.chimp ? `${MESH}/${sum.chimp}` : '');
    const ready = sel ? !!sum || !sel.startsWith(`${MESH}/`) : !!(model && (chimp ? chimp.ready : true));
    return [{ name: sel ? sel : 'chimp', status: ready ? 'online' : 'offline', models: model ? [model] : [], error: this.state.error ?? (ready ? null : chimp?.why || 'no chimp model loaded'), role: 'chimp' }];
  }

  // the endpoint argument is ignored: tavern only ever asks chimp (or the agent picked in its place)
  async chat(opts) {
    const { model } = await this.resolve();
    try {
      let out;
      if (model.startsWith(`${MESH}/`)) {
        this.proxy.endpoints[0].model = model.slice(MESH.length + 1);
        out = await this.proxy.chat({ ...opts, endpoint: 'chimp' });
      } else {
        const raw = await this.opencode.chat({ ...opts, model, timeoutMs: this.config.llmTimeoutMs });
        out = LLM.finish(raw, opts.tools);
      }
      out.endpoint = model;
      this.last = { status: 'online', error: null, model };
      return out;
    } catch (e) {
      this.last = { status: 'offline', error: e.message, model };
      throw e instanceof LLMError ? e : new LLMError(`${model}: ${e.message}`);
    }
  }

  close() {
    this.opencode.stop();
  }
}
