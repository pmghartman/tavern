import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// .env style file, values never override real env
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvFile(resolve(ROOT, '.env'));

// MODELS: "name=url,name2=url2" or JSON [{name,url,model,role}]
function parseModels(raw) {
  if (!raw) return [];
  const t = raw.trim();
  if (t.startsWith('[')) return JSON.parse(t);
  return t.split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    const [name, ...rest] = entry.split('=');
    return { name: name.trim(), url: rest.join('=').trim() };
  });
}

// TAVERN_* names, with the older RPG_* names still honored
const pick = name => process.env[`TAVERN_${name}`] ?? process.env[`RPG_${name}`];

export function loadConfig() {
  const env = process.env;
  const models = parseModels(pick('MODELS') ?? env.MODELS ?? '');
  if (!models.length && (env.LLM_BASE_URL || env.OPENAI_BASE_URL)) models.push({ name: 'default', url: env.LLM_BASE_URL ?? env.OPENAI_BASE_URL, model: env.LLM_MODEL });
  return {
    root: ROOT,
    host: pick('HOST') ?? '0.0.0.0',
    port: Number(pick('PORT') ?? env.PORT ?? 8484),
    dataDir: resolve(ROOT, pick('DATA_DIR') ?? 'data'),
    dbFile: pick('DB') ?? null,
    webDir: resolve(ROOT, 'web'),
    basePath: (pick('BASE_PATH') ?? '').replace(/\/+$/, ''),
    models,
    // phos's frontend on this host; tavern asks its chimp. Unset with TAVERN_MODELS set: direct endpoints
    phosUrl: pick('PHOS_URL') ?? (models.length ? null : 'http://127.0.0.1:8090'),
    // SearXNG in the phos container, for the DM's web_search; unset: probed
    searxngUrl: pick('SEARXNG_URL') ?? env.SEARXNG_URL ?? null,
    // folders of adventure files tavern also reads modules from (':'-separated); 'off' disables
    modulesInbox: (pick('MODULES_DIR') ?? '/repo/files/tavern/modules:/opt/phosphorus/files/tavern/modules') === 'off' ? [] : (pick('MODULES_DIR') ?? '/repo/files/tavern/modules:/opt/phosphorus/files/tavern/modules').split(':').filter(Boolean),
    opencodeBin: pick('OPENCODE_BIN') ?? 'opencode',
    // the free agents run inside bubblewrap on linux; 'off' only for a dev machine without it
    opencodeSandbox: pick('OPENCODE_SANDBOX') === 'off' || process.platform !== 'linux' ? 'off' : 'bwrap',
    dmModel: pick('DM_MODEL') ?? null,
    smallModel: pick('SMALL_MODEL') ?? null,
    llmApiKey: env.LLM_API_KEY ?? env.OPENAI_API_KEY ?? '',
    llmTimeoutMs: Number(env.LLM_TIMEOUT_MS ?? 180000),
    llmMaxTokens: Number(env.LLM_MAX_TOKENS ?? 1200),
    // the DM's turns: shorter, with less thinking, to answer sooner
    dmMaxTokens: Number(pick('DM_MAX_TOKENS') ?? 700),
    reasoning: pick('REASONING') ?? 'low',
    ingestConcurrency: Number(pick('INGEST_CONCURRENCY') ?? 2),
    // tesseract workers for scanned pages; unset: one per spare core, up to 4
    ocrWorkers: pick('OCR_WORKERS') ? Number(pick('OCR_WORKERS')) : undefined,
    contextTokens: Number(pick('CONTEXT_TOKENS') ?? 12000),
    monsterTurnDelayMs: Number(pick('MONSTER_DELAY_MS') ?? 0),
  };
}
