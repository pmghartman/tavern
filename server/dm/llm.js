// OpenAI-compatible chat client for models served on the phosphorus mesh (llama.cpp server)

export function normalizeBase(url) {
  let u = String(url).trim().replace(/\/+$/, '');
  u = u.replace(/\/chat\/completions$/, '');
  if (!/\/v\d+$/.test(u)) u += '/v1';
  return u;
}

// gpt-oss harmony and think tags sometimes leak into content
export function cleanContent(text) {
  if (!text) return '';
  let t = String(text);
  t = t.replace(/<think>[\s\S]*?<\/think>/g, '');
  // the chat template opened <think> itself, so only the closing tag shows up
  if (t.includes('</think>')) t = t.slice(t.lastIndexOf('</think>') + '</think>'.length);
  t = t.replace(/<think>[\s\S]*$/, '');
  t = t.replace(/<\|channel\|>analysis<\|message\|>[\s\S]*?(<\|end\|>|<\|start\|>|$)/g, '');
  t = t.replace(/<\|start\|>assistant/g, '').replace(/<\|channel\|>(final|commentary)<\|message\|>/g, '');
  t = t.replace(/<\|(end|return|call|message|channel|start)\|>/g, '');
  return t.trim();
}

// tool calls embedded in plain text, for models without native tool calling
export function extractTextToolCalls(text, toolNames) {
  const calls = [];
  let rest = text;
  const tryAdd = raw => {
    try {
      const obj = JSON.parse(raw);
      const name = obj.name ?? obj.tool ?? obj.function;
      const args = obj.arguments ?? obj.args ?? obj.parameters ?? {};
      if (name && toolNames.includes(name)) {
        calls.push({ id: `txt_${calls.length}`, name, arguments: typeof args === 'string' ? JSON.parse(args) : args });
        return true;
      }
    } catch {
      /* not json */
    }
    return false;
  };
  rest = rest.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (m, inner) => (tryAdd(inner) ? '' : m));
  rest = rest.replace(/```(?:json|tool)?\s*(\{[\s\S]*?\})\s*```/g, (m, inner) => (tryAdd(inner) ? '' : m));
  return { calls, rest: rest.trim() };
}

export class LLMError extends Error {}

export class LLM {
  constructor(config) {
    this.config = config;
    this.endpoints = (config.models ?? []).map(m => ({ ...m, base: normalizeBase(m.url), status: 'unknown', ids: [] }));
    this.lastProbe = 0;
  }

  get available() {
    return this.endpoints.length > 0;
  }

  endpoint(name) {
    if (!this.endpoints.length) return null;
    return this.endpoints.find(e => e.name === name) ?? this.endpoints.find(e => e.status === 'online') ?? this.endpoints[0];
  }

  headers() {
    const h = { 'content-type': 'application/json' };
    if (this.config.llmApiKey) h.authorization = `Bearer ${this.config.llmApiKey}`;
    return h;
  }

  async probe(force = false) {
    if (!force && Date.now() - this.lastProbe < 30000) return this.describe();
    this.lastProbe = Date.now();
    await Promise.all(this.endpoints.map(async e => {
      try {
        const r = await fetch(`${e.base}/models`, { headers: this.headers(), signal: AbortSignal.timeout(4000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        e.ids = (body.data ?? body.models ?? []).map(m => m.id ?? m.name).filter(Boolean);
        e.status = 'online';
        e.error = null;
      } catch (err) {
        e.status = 'offline';
        e.error = err.message;
      }
    }));
    return this.describe();
  }

  describe() {
    return this.endpoints.map(e => ({ name: e.name, status: e.status, models: e.ids, error: e.error ?? null, role: e.role ?? null }));
  }

  // returns {content, toolCalls, reasoning, finishReason}
  // reasoning: low (the default), medium, high or off; 'default' leaves it to the model
  async chat({ endpoint, messages, tools, toolChoice, temperature = 0.8, maxTokens, onDelta, signal, json = false, reasoning }) {
    const ep = this.endpoint(endpoint);
    if (!ep) throw new LLMError('No model endpoints configured.');
    const body = {
      model: ep.model ?? ep.ids?.[0] ?? ep.name,
      messages,
      temperature,
      max_tokens: maxTokens ?? this.config.llmMaxTokens,
      stream: !!onDelta,
      // llama.cpp keeps the prompt's shared prefix between requests
      cache_prompt: true,
    };
    const effort = reasoning ?? this.config.reasoning ?? 'low';
    if (effort !== 'default') {
      const level = effort === 'off' ? 'low' : effort;
      body.reasoning_effort = level;
      body.chat_template_kwargs = { reasoning_effort: level, enable_thinking: level === 'medium' || level === 'high' };
    }
    if (tools?.length) {
      body.tools = tools.map(t => ({ type: 'function', function: t }));
      body.parallel_tool_calls = true;
      if (toolChoice) body.tool_choice = toolChoice === 'required' || toolChoice === 'auto' || toolChoice === 'none' ? toolChoice : { type: 'function', function: { name: toolChoice } };
    }
    if (json) body.response_format = { type: 'json_object' };
    const timeout = AbortSignal.timeout(this.config.llmTimeoutMs ?? 180000);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res;
    try {
      res = await fetch(`${ep.base}/chat/completions`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: sig });
    } catch (e) {
      ep.status = 'offline';
      throw new LLMError(`Model ${ep.name} unreachable: ${e.message}`);
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new LLMError(`Model ${ep.name} error ${res.status}: ${txt.slice(0, 300)}`);
    }
    ep.status = 'online';
    let out;
    if (body.stream) out = await this.readStream(res, onDelta);
    else {
      const data = await res.json();
      const msg = data.choices?.[0]?.message ?? {};
      out = {
        content: msg.content ?? '',
        reasoning: msg.reasoning_content ?? msg.reasoning ?? '',
        toolCalls: (msg.tool_calls ?? []).map(tc => ({ id: tc.id, name: tc.function?.name, arguments: parseArgs(tc.function?.arguments) })),
        finishReason: data.choices?.[0]?.finish_reason ?? null,
      };
    }
    out = LLM.finish(out, tools);
    out.endpoint = ep.name;
    return out;
  }

  // reasoning tags stripped, tool calls written as text taken as calls
  static finish(out, tools) {
    const toolNames = (tools ?? []).map(t => t.name);
    out.content = cleanContent(out.content);
    if (!out.toolCalls.length && toolNames.length && out.content) {
      const { calls, rest } = extractTextToolCalls(out.content, toolNames);
      if (calls.length) {
        out.toolCalls = calls;
        out.content = rest;
      }
    }
    return out;
  }

  async readStream(res, onDelta) {
    const decoder = new TextDecoder();
    let buf = '';
    let content = '';
    let reasoning = '';
    let finishReason = null;
    const calls = new Map();
    let inAnalysis = false;
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        let data;
        try {
          data = JSON.parse(payload);
        } catch {
          continue;
        }
        const ch = data.choices?.[0];
        if (!ch) continue;
        if (ch.finish_reason) finishReason = ch.finish_reason;
        const d = ch.delta ?? {};
        if (d.reasoning_content || d.reasoning) reasoning += d.reasoning_content ?? d.reasoning;
        if (d.content) {
          content += d.content;
          if (content.includes('<|channel|>analysis')) inAnalysis = !/<\|channel\|>final<\|message\|>/.test(content.slice(content.lastIndexOf('<|channel|>analysis')));
          if (!inAnalysis && !/<\|/.test(d.content) && !/^\s*[{<`]/.test(content)) onDelta?.(d.content);
        }
        for (const tc of d.tool_calls ?? []) {
          const k = tc.index ?? 0;
          const cur = calls.get(k) ?? { id: tc.id, name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(k, cur);
        }
      }
    }
    return { content, reasoning, finishReason, toolCalls: [...calls.values()].map(c => ({ id: c.id ?? `call_${Math.random().toString(36).slice(2)}`, name: c.name, arguments: parseArgs(c.args) })) };
  }
}

function parseArgs(a) {
  if (!a) return {};
  if (typeof a === 'object') return a;
  try {
    return JSON.parse(a);
  } catch {
    // tolerate trailing junk from small models
    const m = /\{[\s\S]*\}/.exec(a);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fallthrough */
      }
    }
    return { _raw: a };
  }
}
