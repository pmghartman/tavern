import { HttpError, sendJson, readBody, readRaw, packBody, sendPacked } from './http.js';
import { MAX_UPLOAD } from './dm/modules.js';
import { RuleError } from './engine/util.js';
import { RACES, DRACONIC_ANCESTRY } from './engine/data/races.js';
import { CLASSES, BACKGROUNDS, FIGHTING_STYLES, METAMAGIC, INVOCATIONS, PACT_BOONS, INFUSIONS, MANEUVERS, slotsFor, pactSlots, MULTICLASS } from './engine/data/classes.js';
import { FEATS, MAGIC_INITIATE_CLASSES } from './engine/data/feats.js';
import { SPELLS } from './engine/data/spells.js';
import { WEAPONS, ARMOR, GEAR, PACKS, MAGIC_ITEMS } from './engine/data/items.js';
import { MONSTERS } from './engine/data/monsters.js';
import { SKILLS, SKILL_NAMES, ABILITIES, ABILITY_NAMES, LANGUAGES, ALIGNMENTS, CONDITIONS, STANDARD_ARRAY, POINT_BUY_COST, XP_THRESHOLDS } from './engine/data/core.js';
import { PRESETS } from './dm/setting.js';
import { Store } from './store.js';
import { HELP_TEXT } from './dm/commands.js';
import { VERSION } from './version.js';
import { expandKit } from './engine/character.js';
import { characterOptions } from './options.js';

let rulesCache = null;
export function rulesData() {
  if (rulesCache) return rulesCache;
  const strip = o => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'function' ? undefined : v)));
  // subclasses that cast (Eldritch Knight) carry their own slot table
  const withSubSlots = c => {
    for (const s of Object.values(c.subclasses ?? {})) if (s.spellcasting) s.slotTable = Array.from({ length: 20 }, (_, i) => slotsFor(s.spellcasting.type, i + 1));
    return c;
  };
  rulesCache = {
    races: RACES, ancestries: DRACONIC_ANCESTRY,
    classes: Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, { ...withSubSlots(strip(c)), kits: c.kits.map(kit => ({ name: kit.name, items: expandKit(kit) })), slotTable: Array.from({ length: 20 }, (_, i) => (c.spellcasting?.type === 'pact' ? pactSlots(i + 1) : slotsFor(c.spellcasting?.type, i + 1))) }])),
    backgrounds: BACKGROUNDS, fightingStyles: FIGHTING_STYLES, metamagic: METAMAGIC, invocations: INVOCATIONS, pactBoons: PACT_BOONS, infusions: INFUSIONS, maneuvers: MANEUVERS,
    spells: SPELLS, items: { ...WEAPONS, ...ARMOR, ...GEAR, ...MAGIC_ITEMS }, packs: PACKS,
    monsters: Object.fromEntries(Object.entries(MONSTERS).map(([k, m]) => [k, { key: k, name: m.name, cr: m.cr, type: m.type, size: m.size, ac: m.ac, hp: m.hp }])),
    skills: SKILLS, skillNames: SKILL_NAMES, abilities: ABILITIES, abilityNames: ABILITY_NAMES, languages: LANGUAGES, alignments: ALIGNMENTS,
    feats: FEATS, multiclass: MULTICLASS, magicInitiateClasses: MAGIC_INITIATE_CLASSES, conditions: CONDITIONS, standardArray: STANDARD_ARRAY, pointBuyCost: POINT_BUY_COST, xpThresholds: XP_THRESHOLDS, presets: PRESETS, commandHelp: HELP_TEXT,
  };
  return rulesCache;
}

function route(method, pattern) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}/?$`);
  return { method, re, keys };
}

export function buildApi({ game, store, llm, hub, config, search = null, modules = null, updater = null }) {
  const routes = [];
  const on = (method, pattern, handler, opts = {}) => routes.push({ ...route(method, pattern), handler, ...opts });
  const playerFrom = (req, body, query) => {
    const id = req.headers['x-player-id'] ?? body?.playerId ?? query?.get('playerId');
    if (!id) throw new HttpError(401, 'Choose a player name first.', 'no_player');
    const p = store.getPlayer(id);
    if (!p) throw new HttpError(401, 'Unknown player; please sign in again.', 'no_player');
    return p;
  };
  const campaignOr404 = id => {
    const c = store.getCampaign(id);
    if (!c) throw new HttpError(404, 'Campaign not found.', 'not_found');
    return c;
  };

  on('GET', '/health', () => ({ ok: true, version: VERSION, time: Date.now() }));
  on('GET', '/config', async () => ({ models: await llm.probe(), dmAvailable: llm.available, version: VERSION }));
  on('GET', '/search', () => (search ? search.status() : { url: null, error: 'web search is off' }));
  on('GET', '/models', async ({ query }) => ({ models: await llm.probe(query.get('refresh') === '1') }));
  let rulesPacked = null;
  on('GET', '/rules', ({ res }) => sendPacked(res, (rulesPacked ??= packBody(JSON.stringify(rulesData()), 'application/json; charset=utf-8'))));
  // this tavern's update from upstream: where the last one stands, and a press to start one
  on('GET', '/update', () => (updater ? updater.status() : { version: VERSION, canUpdate: false, state: 'idle', log: '', why: 'updates are off' }));
  on('POST', '/update', ({ req, body, query }) => {
    playerFrom(req, body, query);
    if (!updater) throw new HttpError(409, 'Updates are off on this tavern.');
    try {
      return updater.start({ force: body?.force === true });
    } catch (e) {
      throw new HttpError(409, e.message);
    }
  });
  // the agent selector: phosphorus's mesh models and opencode's free list; tavern
  // asks phosphorus's pick for its agent unless one is picked here
  on('GET', '/agents', async ({ query }) => {
    if (!llm.agents) return { phos: null, selected: '', auto: null, groups: [], error: 'Tavern is set to direct model endpoints (TAVERN_MODELS), not phosphorus.' };
    return llm.agents({ refresh: query.get('refresh') === '1' });
  });
  on('PUT', '/agents', async ({ req, body, query }) => {
    playerFrom(req, body, query);
    if (!llm.select) throw new HttpError(409, 'Tavern is set to direct model endpoints (TAVERN_MODELS), not phosphorus.');
    try {
      return await llm.select(body?.model ?? '');
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  });

  // a new browser signing in with a known name gets that player back, characters and all
  on('POST', '/players', async ({ body }) => store.upsertPlayer({ id: body.id ?? store.findPlayerByName(body.name)?.id, name: body.name }));
  on('GET', '/players/:id', ({ params }) => {
    const p = store.getPlayer(params.id);
    if (!p) throw new HttpError(404, 'No such player.');
    return p;
  });

  // adventure modules: a file is dropped in, the DM model prepares it, campaigns run from the result
  on('GET', '/modules', () => modules.list());
  on('POST', '/modules', async ({ req, query }) => {
    playerFrom(req, null, query);
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'Module'));
    const buffer = await readRaw(req, MAX_UPLOAD);
    if (!buffer.length) throw new HttpError(400, 'That file is empty.');
    return modules.create({ filename, buffer });
  }, { raw: true });
  on('POST', '/modules/:id/resume', ({ req, body, query, params }) => {
    playerFrom(req, body, query);
    return modules.resume(params.id);
  });
  on('POST', '/modules/:id/reread', ({ req, body, query, params }) => {
    playerFrom(req, body, query);
    return modules.reread(params.id);
  });
  on('DELETE', '/modules/:id', ({ req, body, query, params }) => {
    playerFrom(req, body, query);
    if (store.listCampaigns({ status: 'active' }).concat(store.listCampaigns({ status: 'archived' })).some(c => store.getCampaign(c.id)?.settings?.moduleId === params.id)) throw new HttpError(409, 'A campaign runs this module. Delete that campaign first.');
    modules.remove(params.id);
    return { ok: true };
  });

  on('GET', '/campaigns', ({ query }) => game.listCampaigns({ status: query.get('status') === 'archived' ? 'archived' : 'active' }));
  on('POST', '/campaigns', async ({ req, body, query }) => {
    const p = playerFrom(req, body, query);
    return game.createCampaign({ ...body, ownerId: p.id });
  });
  on('GET', '/campaigns/:id', ({ params }) => {
    campaignOr404(params.id);
    return game.campaignView(params.id);
  });
  on('PATCH', '/campaigns/:id', async ({ req, body, query, params }) => game.updateCampaign(params.id, playerFrom(req, body, query).id, body));
  on('DELETE', '/campaigns/:id', async ({ req, body, query, params }) => game.deleteCampaign(params.id, playerFrom(req, body, query).id));
  on('GET', '/campaigns/:id/messages', ({ params, query }) => {
    campaignOr404(params.id);
    return store.listMessages(params.id, { channel: query.get('channel') ?? undefined, before: Number(query.get('before')) || undefined, after: Number(query.get('after')) || undefined, limit: Number(query.get('limit')) || 100 });
  });
  on('POST', '/campaigns/:id/messages', async ({ req, body, query, params }) => {
    campaignOr404(params.id);
    const p = playerFrom(req, body, query);
    const { message, done } = await game.handleMessage(params.id, p.id, { channel: body.channel, content: body.content, characterId: body.characterId });
    if (body.wait) await done;
    return message;
  });
  on('GET', '/campaigns/:id/memories', ({ params, query }) => {
    campaignOr404(params.id);
    const q = query.get('q');
    return game.playerMemories(params.id, q ? store.searchMemories(params.id, q, { limit: 30 }) : store.listMemories(params.id, { kind: query.get('kind') ?? undefined }));
  });
  // the running chronicle of the story so far, folded from the chat players saw
  on('GET', '/campaigns/:id/chronicle', ({ params }) => {
    campaignOr404(params.id);
    return { content: store.latestSummary(params.id, 'dm')?.content ?? '' };
  });
  on('POST', '/campaigns/:id/memories', ({ req, body, query, params }) => {
    campaignOr404(params.id);
    const p = playerFrom(req, body, query);
    const title = String(body.title ?? '').trim().slice(0, 80);
    const content = String(body.content ?? '').trim().slice(0, 2000);
    if (!title || !content) throw new HttpError(400, 'Title and content are required.');
    const m = store.addMemory({ campaignId: params.id, kind: 'note', title: `${p.name}: ${title}`, content, tags: 'player-note', importance: 2, source: p.id });
    hub.broadcast(params.id, 'memory', m);
    return m;
  });
  on('GET', '/campaigns/:id/events', ({ req, res, params, query }) => {
    campaignOr404(params.id);
    const pid = query.get('playerId');
    const player = pid ? store.getPlayer(pid) : null;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 3000\n\n');
    hub.add(params.id, player, res);
    hub.send(res, 'state', game.campaignView(params.id));
    req.on('close', () => res.end());
    return undefined;
  });
  on('GET', '/lobby/events', ({ req, res }) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 5000\n\n');
    hub.add('lobby', null, res);
    hub.send(res, 'campaigns', game.listCampaigns());
    hub.send(res, 'modules', modules.list());
    req.on('close', () => res.end());
    return undefined;
  });

  on('POST', '/rolls/abilities', ({ req, body, query }) => game.rollAbilities(playerFrom(req, body, query).id));
  on('POST', '/campaigns/:id/characters/validate', ({ body, params }) => {
    campaignOr404(params.id);
    return { errors: game.validateCharacter(params.id, body.character ?? body, body.rollToken, body.characterId) };
  });
  on('POST', '/campaigns/:id/characters/random', ({ params }) => {
    campaignOr404(params.id);
    return game.randomCharacter(params.id);
  });
  on('POST', '/campaigns/:id/characters', async ({ req, body, query, params }) => {
    campaignOr404(params.id);
    const p = playerFrom(req, body, query);
    return game.createCharacter(params.id, p.id, body.character ?? body, body.rollToken);
  });
  on('GET', '/characters/:id', ({ params }) => {
    const ch = store.getCharacter(params.id);
    if (!ch) throw new HttpError(404, 'No such character.');
    return ch;
  });
  on('PATCH', '/characters/:id', async ({ req, body, query, params }) => game.updateCharacterDescription(params.id, playerFrom(req, body, query).id, body.description ?? body));
  on('DELETE', '/characters/:id', async ({ req, body, query, params }) => {
    await game.retireCharacter(params.id, playerFrom(req, body, query).id);
    return { ok: true };
  });
  on('GET', '/characters/:id/build', ({ req, body, query, params }) => game.buildInfo(params.id, playerFrom(req, body, query).id));
  on('PUT', '/characters/:id/build', async ({ req, body, query, params }) => game.rebuildCharacter(params.id, playerFrom(req, body, query).id, body.character ?? body));
  on('GET', '/characters/:id/levelup', ({ params, query }) => game.levelUpInfo(params.id, query.get('class'), query.get('subclass')));
  on('GET', '/characters/:id/options', ({ params }) => {
    const ch = store.getCharacter(params.id);
    if (!ch) throw new HttpError(404, 'No such character.');
    return characterOptions(store.loadState(ch.campaignId), ch.id);
  });
  on('POST', '/characters/:id/action', async ({ req, body, query, params }) => {
    const ch = store.getCharacter(params.id);
    if (!ch) throw new HttpError(404, 'No such character.');
    const p = playerFrom(req, body, query);
    const r = await game.handleAction(ch.campaignId, p.id, ch.id, body.action ?? body);
    if (!r.ok) throw new HttpError(422, r.error, r.code ?? 'rule');
    return r;
  });

  return async function handle(req, res, apiPath, query) {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(apiPath);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      try {
        const body = !r.raw && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? await readBody(req) : {};
        const out = await r.handler({ req, res, params, query, body });
        if (out !== undefined && !res.headersSent) sendJson(res, 200, out);
      } catch (e) {
        if (res.headersSent) return;
        if (e instanceof HttpError) sendJson(res, e.status, { error: e.message, code: e.code });
        else if (e instanceof RuleError) sendJson(res, e.code === 'not_found' ? 404 : e.code === 'forbidden' ? 403 : 422, { error: e.message, code: e.code });
        else {
          console.error(e);
          sendJson(res, 500, { error: 'Internal error' });
        }
      }
      return;
    }
    sendJson(res, 404, { error: `No route ${method} ${apiPath}` });
  };
}
