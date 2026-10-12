import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { LLM } from './dm/llm.js';
import { PhosLLM } from './dm/phos.js';
import { Hub } from './realtime.js';
import { Game } from './game.js';
import { Search } from './dm/search.js';
import { Modules } from './dm/modules.js';
import { buildApi } from './api.js';
import { splitPath, serveStatic, sendJson } from './http.js';
import { VERSION } from './version.js';

export async function startServer() {
  const config = loadConfig();
  const store = new Store(config.dbFile ?? join(config.dataDir, 'tavern.db'));
  const llm = config.phosUrl ? new PhosLLM(config, { store }) : new LLM(config);
  const backup = store.backupOnVersionChange(VERSION);
  if (backup) console.log(`database backed up to ${backup}`);
  const hub = new Hub();
  const search = config.searxngUrl === 'off' ? null : new Search({ ...config, phosUrl: config.phosUrl ?? 'http://127.0.0.1:8090' });
  const modules = new Modules({ dir: join(config.dataDir, 'modules'), llm, hub, config });
  modules.watchInbox();
  const game = new Game({ store, llm, hub, config, search, modules });
  const api = buildApi({ game, store, llm, hub, config, search, modules });
  const server = createServer(async (req, res) => {
    try {
      const parts = splitPath(req.url, config.basePath);
      if (parts.api !== undefined) return await api(req, res, parts.api, parts.query);
      return await serveStatic(res, config.webDir, parts.static, req.url);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
    }
  });
  server.keepAliveTimeout = 65000;
  await new Promise(resolve => server.listen(config.port, config.host, resolve));
  const addr = server.address();
  if (llm.available) llm.probe(true).catch(() => {});
  search?.status().then(s => (s.via ? console.log(`web search: ${s.via} at ${s.url}`) : console.warn(`web search: ${s.error}`)));
  const close = async () => {
    hub.close();
    await modules.stop();
    llm.close?.();
    // requests still waiting on the model are cut, not waited for
    const closed = new Promise(r => server.close(r));
    server.closeAllConnections?.();
    await closed;
    store.close();
  };
  return { server, port: addr.port, game, store, llm, hub, config, modules, close };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const s = await startServer();
  const models = s.llm.describe();
  console.log(`tavern ${VERSION} listening on ${s.config.host}:${s.port}`);
  if (s.llm instanceof PhosLLM) console.log(`model: phos chimp via ${s.config.phosUrl}`);
  else console.log(models.length ? `models: ${models.map(m => `${m.name}`).join(', ')}` : 'no models configured (set TAVERN_PHOS_URL or TAVERN_MODELS); running in harness-only mode');
  const stop = async () => {
    // a restart never hangs on work that won't stop: what is saved is saved
    setTimeout(() => {
      console.error('shutdown took too long; exiting');
      process.exit(0);
    }, 15000).unref();
    await s.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
