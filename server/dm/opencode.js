// opencode run headless on loopback for OpenCode Zen's free models, the
// agents tavern lists beside phosphorus's mesh models. Its free tier answers
// only opencode itself, so tavern runs an opencode of its own (TAVERN_OPENCODE_BIN,
// else the one findBin turns up), locked down hard:
//   - no provider but Zen's own, no keys, free models only
//   - every tool, MCP server, plugin, skill, instruction file and subagent off,
//     denied by name and by wildcard, one step per answer
//   - inside bubblewrap: a fresh namespace for everything but the network, the
//     system read-only, no home, no tavern checkout, only an empty sandbox dir
//     writable, a cleared environment, killed with tavern
//   - any answer that shows a tool, file or subtask part stops it for good
// The DM's own tools are described in the prompt and come back as JSON in text.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { LLMError } from './llm.js';

const READY_MS = 60000;
const AGENT = 'tavern';
const PROMPT = 'You are the dungeon master of a D&D 5e table. The game engine, not you, decides outcomes. You have no tools here: answer in text only. Follow the instructions you are given exactly.';
// Zen, the one provider allowed: its free models need no key
export const FREE_PROVIDER = 'opencode';
// every tool opencode has had, each denied by name as well as by the wildcard
const TOOLS = ['read', 'edit', 'write', 'patch', 'multiedit', 'glob', 'grep', 'list', 'bash', 'task', 'external_directory', 'todowrite', 'todoread', 'question', 'webfetch', 'websearch', 'codesearch', 'lsp', 'skill', 'doom_loop', 'batch'];
// opencode's own agents, none of them reachable
const BUILTIN_AGENTS = ['build', 'plan', 'general', 'explore'];
// answer parts a text-only agent never produces
const BREACH_PARTS = new Set(['tool', 'file', 'patch', 'subtask', 'agent', 'snapshot']);
// inside the jail
const JAIL_BIN = '/opt/opencode/opencode';
const JAIL_HOME = '/sandbox';
// read-only system paths the binary and TLS need, each bound only if it exists
const SYSTEM_RO = ['/usr', '/lib', '/lib64', '/lib32', '/bin', '/sbin', '/etc/ssl', '/etc/ca-certificates', '/etc/pki', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/localtime'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// a systemd unit's PATH misses the per-user places opencode gets installed:
// tavern's own copy first, then its installer, npm under nvm (next to this
// node), ~/.local, bun
export function findBin(bin, first = []) {
  if (/[\\/]/.test(bin)) return existsSync(bin) ? bin : null;
  const home = homedir();
  const dirs = [
    ...first,
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    join(home, '.opencode', 'bin'), dirname(process.execPath), join(home, '.local', 'bin'), join(home, '.bun', 'bin'),
    join(home, '.npm-global', 'bin'), '/usr/local/bin', '/opt/homebrew/bin',
  ];
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const d of dirs) {
    for (const x of exts) {
      const p = join(d, bin + x);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// the DM's function tools as text, called with ```json {"name","arguments"}```
export function toolPrompt(tools, toolChoice) {
  if (!tools?.length) return '';
  const list = tools.map(t => `- ${t.name}: ${t.description ?? ''}\n  parameters: ${JSON.stringify(t.parameters ?? {})}`).join('\n');
  const must = toolChoice && toolChoice !== 'auto' && toolChoice !== 'none'
    ? `\nYou must call ${toolChoice === 'required' ? 'at least one tool' : `the ${toolChoice} tool`} now.` : '';
  return `\n\n# Tools\nCall a tool by writing a fenced block, one per call, and nothing else for that call:\n\`\`\`json\n{"name": "<tool>", "arguments": { ... }}\n\`\`\`\nTool results come back to you in the next message. Available tools:\n${list}${must}`;
}

// the chat after the system prompt, as one text part
export function transcript(messages) {
  return messages.map(m => {
    if (m.role === 'tool') return `[tool result${m.name ? ` ${m.name}` : ''}]\n${m.content}`;
    if (m.role === 'assistant') {
      const calls = (m.tool_calls ?? []).map(tc => `\`\`\`json\n${JSON.stringify({ name: tc.function?.name, arguments: safeJson(tc.function?.arguments) })}\n\`\`\``);
      return `[you]\n${[m.content, ...calls].filter(Boolean).join('\n')}`;
    }
    return String(m.content ?? '');
  }).join('\n\n');
}

const safeJson = a => {
  if (typeof a !== 'string') return a ?? {};
  try {
    return JSON.parse(a);
  } catch {
    return {};
  }
};

// opencode's config: Zen alone, nothing it could act with
export function lockedConfig() {
  const deny = Object.fromEntries(TOOLS.map(t => [t, 'deny']));
  const off = Object.fromEntries(['*', ...TOOLS].map(t => [t, false]));
  return {
    $schema: 'https://opencode.ai/config.json', autoupdate: false, share: 'disabled', snapshot: false, lsp: false, formatter: false,
    enabled_providers: [FREE_PROVIDER], provider: {}, mcp: {}, plugin: [], instructions: [],
    tools: off, permission: { '*': 'deny', ...deny },
    default_agent: AGENT,
    agent: {
      [AGENT]: { mode: 'primary', prompt: PROMPT, steps: 1, tools: off, permission: { '*': 'deny', ...deny } },
      ...Object.fromEntries(BUILTIN_AGENTS.map(a => [a, { disable: true }])),
    },
  };
}

export class Opencode {
  // sandbox: 'bwrap' (required on linux unless TAVERN_OPENCODE_SANDBOX=off) or 'off'
  constructor({ bin = 'opencode', home, port = 0, sandbox = process.platform === 'linux' ? 'bwrap' : 'off' } = {}) {
    this.bin = bin;
    this.home = home;
    this.port = port;
    this.sandbox = sandbox;
    this.user = 'tavern';
    this.secret = randomBytes(24).toString('hex');
    this.proc = null;
    this.ready = null;
    this.busy = 0;
    this.breached = null;
    this.listed = { at: 0, body: null };
  }

  get auth() {
    return `Basic ${Buffer.from(`${this.user}:${this.secret}`).toString('base64')}`;
  }

  // tavern's own copy (data/opencode/bin), then the usual places
  get binary() {
    return findBin(this.bin, [join(this.home, 'bin')]);
  }

  get jail() {
    return this.sandbox === 'bwrap' ? findBin('bwrap', ['/usr/bin']) : null;
  }

  // why the free agents can't run here, or null
  get unavailable() {
    // Zen refuses tool-less agents and says its free tier is for opencode itself, not other projects
    return "OpenCode Zen's free tier only serves OpenCode itself, so tavern no longer offers it";
    // eslint-disable-next-line no-unreachable
    if (this.breached) return `the free agents are switched off: ${this.breached}`;
    if (!this.binary) return 'opencode is not installed for tavern; scripts/rebuild.sh copies it from the phos container';
    if (this.sandbox === 'bwrap' && !this.jail) return 'bubblewrap (bwrap) is not installed; tavern runs the free agents only inside it (apt install bubblewrap)';
    return null;
  }

  async call(method, path, body, timeout = 10000, signal) {
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    const res = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      method, signal: sig, headers: { authorization: this.auth, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* text */
    }
    if (!res.ok) throw new LLMError(`opencode: ${errorText(data) || text.trim() || `HTTP ${res.status}`}`);
    return data;
  }

  // the command line: the binary jailed by bubblewrap, or bare where there is none
  command() {
    const sandboxDir = join(this.home, 'sandbox');
    const env = {
      HOME: JAIL_HOME, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', TZ: 'UTC',
      XDG_CONFIG_HOME: `${JAIL_HOME}/config`, XDG_DATA_HOME: `${JAIL_HOME}/data`, XDG_CACHE_HOME: `${JAIL_HOME}/cache`, XDG_STATE_HOME: `${JAIL_HOME}/state`,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(lockedConfig()), OPENCODE_SERVER_USERNAME: this.user, OPENCODE_SERVER_PASSWORD: this.secret,
      OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1',
      OPENCODE_DISABLE_LSP_DOWNLOAD: '1', OPENCODE_DISABLE_SHARE: '1',
    };
    const args = ['serve', '--hostname', '127.0.0.1', '--port', String(this.port)];
    if (!this.jail) {
      // dev machines only (TAVERN_OPENCODE_SANDBOX=off): the same config and a cleared environment
      const local = { ...env, HOME: sandboxDir, PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '' };
      for (const d of ['config', 'data', 'cache', 'state']) local[`XDG_${d.toUpperCase()}_HOME`] = join(sandboxDir, d);
      return { file: this.binary, args, cwd: join(sandboxDir, 'work'), env: local };
    }
    const bw = ['--die-with-parent', '--new-session', '--unshare-all', '--share-net', '--clearenv', '--cap-drop', 'ALL',
      '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp'];
    for (const p of SYSTEM_RO) bw.push('--ro-bind-try', p, p);
    bw.push('--ro-bind', this.binary, JAIL_BIN, '--bind', sandboxDir, JAIL_HOME, '--chdir', `${JAIL_HOME}/work`);
    for (const [k, v] of Object.entries(env)) bw.push('--setenv', k, v);
    return { file: this.jail, args: [...bw, '--', JAIL_BIN, ...args], cwd: sandboxDir, env: {} };
  }

  async start() {
    const why = this.unavailable;
    if (why) throw new LLMError(why);
    for (const d of ['config', 'data', 'cache', 'state', 'work']) mkdirSync(join(this.home, 'sandbox', d), { recursive: true });
    if (!this.port) this.port = 18000 + Math.floor(Math.random() * 2000);
    const cmd = this.command();
    const proc = spawn(cmd.file, cmd.args, { cwd: cmd.cwd, env: cmd.env, stdio: ['ignore', 'ignore', 'inherit'] });
    this.proc = proc;
    let failed = null;
    proc.on('error', e => (failed = e));
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
    });
    this.ready = (async () => {
      for (const until = Date.now() + READY_MS; Date.now() < until;) {
        if (failed) throw new LLMError(`opencode failed to start: ${failed.message}`);
        if (this.proc !== proc) throw new LLMError('opencode exited while starting');
        if (await this.call('GET', '/global/health', null, 2000).then(() => true, () => false)) return;
        await sleep(250);
      }
      throw new LLMError('opencode never came up');
    })();
    this.ready.catch(() => proc.kill('SIGKILL'));
  }

  async ensure() {
    if (!this.proc) await this.start();
    await this.ready;
  }

  stop() {
    if (this.proc) this.proc.kill('SIGKILL');
    this.proc = null;
  }

  // something a text-only agent can't do happened: off until tavern restarts
  trip(why) {
    this.breached = why;
    this.stop();
    console.error(`[opencode] ${why}; the free agents are off until tavern restarts`);
    throw new LLMError(`the free agents are switched off: ${why}`);
  }

  // Zen's models that cost nothing, as opencode itself lists them
  async freeModels() {
    if (this.listed.body && Date.now() - this.listed.at < 5 * 60 * 1000) return this.listed.body;
    await this.ensure();
    const r = (await this.call('GET', '/provider', null, 30000)) ?? {};
    const zen = (r.all ?? []).find(p => p.id === FREE_PROVIDER);
    const connected = new Set(r.connected ?? []);
    const body = zen && connected.has(FREE_PROVIDER)
      ? Object.values(zen.models ?? {}).filter(m => m.cost && !m.cost.input && !m.cost.output).map(m => ({ id: m.id, name: m.name || m.id })).sort((a, b) => a.name.localeCompare(b.name))
      : [];
    this.listed = { at: Date.now(), body };
    return body;
  }

  // one answer in a throwaway session; model is opencode/<free model>
  async chat({ model, messages, tools, toolChoice, signal, timeoutMs = 180000 }) {
    const at = model.indexOf('/');
    const providerID = model.slice(0, at);
    const modelID = model.slice(at + 1);
    if (providerID !== FREE_PROVIDER) throw new LLMError(`only OpenCode Zen's free models run here, not ${model}`);
    if (!(await this.freeModels()).some(m => m.id === modelID)) throw new LLMError(`${model} is not one of OpenCode Zen's free models`);
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n') + toolPrompt(tools, toolChoice);
    const rest = messages.filter(m => m.role !== 'system');
    this.busy += 1;
    let session = null;
    try {
      session = await this.call('POST', '/session', { title: 'tavern' });
      const stop = () => this.call('POST', `/session/${session.id}/abort`).catch(() => {});
      signal?.addEventListener('abort', stop, { once: true });
      const r = await this.call('POST', `/session/${session.id}/message`, {
        agent: AGENT, model: { providerID, modelID }, system,
        parts: [{ type: 'text', text: transcript(rest) || '(begin)' }],
      }, timeoutMs, signal);
      signal?.removeEventListener('abort', stop);
      const odd = (r?.parts ?? []).find(p => BREACH_PARTS.has(p.type));
      if (odd) this.trip(`${model} produced a ${odd.type} part${odd.tool ? ` (${odd.tool})` : ''}`);
      if (r?.info?.error) throw new LLMError(`opencode: ${errorText(r.info.error) || 'no answer'}`);
      const content = (r?.parts ?? []).filter(p => p.type === 'text' && !p.synthetic && !p.ignored).map(p => p.text).join('\n\n').trim();
      const reasoning = (r?.parts ?? []).filter(p => p.type === 'reasoning').map(p => p.text).join('\n');
      return { content, reasoning, toolCalls: [], finishReason: 'stop' };
    } finally {
      this.busy -= 1;
      if (session) this.call('DELETE', `/session/${session.id}`).catch(() => {});
    }
  }
}

function errorText(e) {
  if (!e || typeof e !== 'object') return '';
  const d = e.data && typeof e.data === 'object' ? e.data : {};
  return String(d.message || e.message || (typeof e.error === 'string' ? e.error : errorText(e.error)) || e.name || '');
}
