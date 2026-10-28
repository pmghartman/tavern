// Tavern's model on a phosphorus host: the model phosphorus picks for its
// "tavern" agent (assigned on phosphorus's Agents page, or its automatic
// pick), another mesh model, or one of OpenCode Zen's free agents. Mesh
// models go through phosphorus's model gateway with native tool calls, asked
// as agent-tavern or phosphorus/<host>. The free agents (opencode/<id>)
// answer only opencode itself, so they go through tavern's own copy of
// opencode, jailed and stripped of every tool (opencode.js); no provider key
// ever leaves phosphorus and nothing that costs money can be picked.

import { join } from 'node:path';
import { LLM, LLMError } from './llm.js';
import { Opencode, FREE_PROVIDER } from './opencode.js';

const STATE_MS = 10000;
// a mesh host's model as phosphorus names it, phosphorus/<host>
export const MESH = 'phosphorus';
// what older tavern settings called the mesh
const OLD_MESH = 'phos';
// tavern's agent on phosphorus's Agents page, asked by this name
export const AGENT = 'tavern';
const AGENT_MODEL = `agent-${AGENT}`;
const MODEL_RE = /^[a-z0-9][a-z0-9._-]{0,63}\/[^\s/]\S{0,199}$/i;
// the setting holding the agent picked in tavern, '' for phosphorus's pick
export const AGENT_KEY = 'agent';

const meshHost = id => (id.startsWith(`${MESH}/`) ? id.slice(MESH.length + 1) : '');

export class PhosLLM {
  constructor(config, { store } = {}) {
    this.config = config;
    this.store = store;
    this.url = String(config.phosUrl).replace(/\/+$/, '');
    // phosphorus's gateway speaks the OpenAI API; model = agent-tavern or the mesh host's name
    this.proxy = new LLM({ ...config, models: [{ name: 'phosphorus', url: `${this.url}/api/model/v1` }] });
    this.opencode = new Opencode({ bin: config.opencodeBin, home: join(config.dataDir, 'opencode'), sandbox: config.opencodeSandbox });
    this.state = { at: 0, model: null, error: null };
    this.free = { error: null };
    this.last = { status: 'unknown', error: null };
  }

  get available() {
    return true;
  }

  // the agent picked here: '' for phosphorus's pick; a free agent picked before
  // the free agents went away falls back to it; phos/<host> from older settings reads as phosphorus/<host>
  get selected() {
    let sel = this.store?.getSetting(AGENT_KEY) ?? '';
    if (sel.startsWith(`${OLD_MESH}/`)) sel = `${MESH}/${sel.slice(OLD_MESH.length + 1)}`;
    return sel && !sel.startsWith(`${MESH}/`) && this.opencode.unavailable ? '' : sel;
  }

  async select(model) {
    let m = String(model ?? '').trim();
    if (m.startsWith(`${OLD_MESH}/`)) m = `${MESH}/${m.slice(OLD_MESH.length + 1)}`;
    if (m && !MODEL_RE.test(m)) throw new LLMError(`An agent is provider/model, as ${MESH}/tower or opencode/big-pickle.`);
    if (m && !m.startsWith(`${MESH}/`)) {
      if (!m.startsWith(`${FREE_PROVIDER}/`)) throw new LLMError("Only phosphorus mesh models and OpenCode Zen's free agents can be picked here.");
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
    if (!res.ok) throw new Error(body?.error ?? `phosphorus answered ${res.status}`);
    return body;
  }

  // phosphorus's model summary: the mesh's models and each agent's assignment
  async summary(force = false) {
    if (!force && Date.now() - this.state.at < STATE_MS) return this.state.model;
    try {
      this.state = { at: Date.now(), model: (await this.get('/api/state')).model ?? null, error: null };
    } catch (e) {
      this.state = { at: Date.now(), model: null, error: `phosphorus unreachable at ${this.url}: ${e.message}` };
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

  // the model phosphorus answers tavern's agent with: its assignment when the
  // mesh knows the agent, else the biggest ready model (phosphorus's own rule
  // for an unassigned large agent); null with nothing to go on
  static auto(sum) {
    const row = (sum?.agents ?? []).find(a => a.id === AGENT)?.slots?.model;
    if (row) return { agent: true, model: row.model || '', host: row.host || '', ready: !!row.ready, why: row.why || '', chosen: row.chosen || '' };
    const models = sum?.models ?? [];
    if (!models.length) return null;
    const up = models.filter(m => m.ready).sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
    const m = up[0] ?? models[0];
    return { agent: false, model: `${MESH}/${m.host}`, host: m.host, ready: !!m.ready, why: m.ready ? '' : m.why || 'loading', chosen: '' };
  }

  // the model tavern asks for: the picked agent, else phosphorus's pick for tavern
  async resolve() {
    const sum = await this.summary();
    if (this.selected) return { model: this.selected, auto: false };
    const auto = PhosLLM.auto(sum);
    if (!auto || !auto.model) throw new LLMError(this.state.error ?? auto?.why ?? 'phosphorus has no model loaded');
    if (!auto.ready) throw new LLMError(`phosphorus's model for tavern isn't ready: ${auto.why || 'loading'}`);
    // a mesh that knows the agent resolves it itself; an older one takes the host
    return { model: auto.agent ? AGENT_MODEL : auto.model, auto: true, host: auto.host };
  }

  // the selector's contents: phosphorus's mesh first, then the free agents
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
    return {
      phos: this.url, reachable: !!sum, error: this.state.error ?? this.free.error ?? null,
      selected: sel,
      auto: PhosLLM.auto(sum),
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
    const auto = PhosLLM.auto(sum);
    const model = sel || auto?.model || '';
    const ready = sel ? !!sum || !sel.startsWith(`${MESH}/`) : !!auto?.ready;
    return [{ name: sel || AGENT_MODEL, status: ready ? 'online' : 'offline', models: model ? [model] : [], error: this.state.error ?? (ready ? null : auto?.why || 'no model loaded on the mesh'), role: AGENT }];
  }

  // the endpoint argument is ignored: tavern only ever asks phosphorus (or the agent picked in its place)
  async chat(opts) {
    const { model } = await this.resolve();
    try {
      let out;
      if (model === AGENT_MODEL || model.startsWith(`${MESH}/`)) {
        this.proxy.endpoints[0].model = meshHost(model) || model;
        out = await this.proxy.chat({ ...opts, endpoint: 'phosphorus' });
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
