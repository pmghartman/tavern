import { classLabel, classLevels } from './engine/classlevel.js';
import { Store } from './store.js';
import { SPELLS } from './engine/data/spells.js';
import { randomCharacter } from './engine/randomChar.js';
import { buildCharacter, validateCreation, summarizeCharacter, creationInput, computeMaxHp, syncResources } from './engine/character.js';
import { RACES } from './engine/data/races.js';
import { CLASSES } from './engine/data/classes.js';
import { roll } from './engine/dice.js';
import { cryptoRng } from './engine/rng.js';
import { runAtomic, autoAdvance } from './engine/actions.js';
import { currentCid, creatureById, inCombat, nowMinute } from './engine/state.js';
import { levelUpRequirements, canLevelUp, multiclassOptions } from './engine/leveling.js';
import { dmStartCombat, requestCheck, awardXp, giveLoot, setScene, grantMilestone } from './engine/dmActions.js';
import { endEncounter, knockoutPending, captureParty, fightOn } from './engine/combat.js';
import { RuleError, publicPlace } from './engine/util.js';
import { parseCommand, CommandError, HELP_TEXT, resolveTarget, dyingTurn } from './dm/commands.js';
import { runAiTurn } from './dm/monsterAI.js';
import { DM_TOOLS, WEB_TOOLS, executeTool, normalizeSkill } from './dm/tools.js';
import { dmSystemPrompt, dmStateBlock, companionSystemPrompt, stripSuggestions, stripCommandTalk, dedupeNarration, capNarration, fitHistory, historyToChat, estimateTokens } from './dm/prompt.js';
import { maybeSummarize, relevantMemories } from './dm/memory.js';
import { generateSetting, fallbackSetting, moduleSetting, settingToText, publicSetting, PRESETS, outlineText, nextBeat } from './dm/setting.js';
import { loadBestiary, defineCreature, bestiaryText } from './engine/bestiary.js';
import { MONSTERS, findMonsterKey } from './engine/data/monsters.js';
import { parseSegments, liftNpcQuotes, mergeMonologues } from './dm/voices.js';
import { expireByClock } from './engine/effects.js';
import { worldView, worldBlock, npcLine, npcStatus, exitFromText, unmappedAround, world } from './engine/exploration.js';
import { execute as executeSync } from './engine/actions.js';
import { endTurn } from './engine/combat.js';
import { passivePerception } from './engine/creature.js';
import { checkIntents, attackIntent, narratesCombatStart, stripCombatClaims, stripAttackClaims, stripDmKnowledge, isRecap, hiddenEncounters } from './dm/intent.js';

const CLAIM = /\b(nat(ural)?\s*(20|twenty)|i\s+roll(ed)?\s+(a\s+)?\d+|critical(ly)?\s+hit|i\s+(automatically\s+)?(hit|kill|slay|behead|decapitate|win|succeed|find|loot|steal|gain|level up|instantly))\b/i;
const MAX_TOOL_ROUNDS = 6;
// what the table sees the DM doing while a tool runs: [words after "The DM is", icon]
const TOOL_PHASES = {
  consult_adventure: ['consulting the book', 'book'], read_aloud: ['turning the page', 'book'], advance_outline: ['turning the page', 'book'],
  recall: ['checking the notes', 'book'], lookup_rules: ['checking the rules', 'book'], web_search: ['researching', 'book'], fetch_page: ['researching', 'book'],
  start_combat: ['rolling initiative', 'dice'], add_monsters: ['calling in reinforcements', 'dice'],
  request_check: ['rolling the dice', 'dice'], request_group_check: ['rolling the dice', 'dice'], request_save: ['rolling the dice', 'dice'], request_contest: ['rolling the dice', 'dice'],
  social_check: ['weighing your words', 'dice'], insight_check: ['reading faces', 'dice'], player_action: ['consulting the rules', 'dice'],
  create_area: ['mapping the way ahead', 'map'], add_feature: ['mapping the way ahead', 'map'], create_maze: ['mapping the way ahead', 'map'], move_party: ['mapping the way ahead', 'map'],
  place_trap: ['setting a trap', 'map'], create_puzzle: ['setting a puzzle', 'map'], trigger_trap: ['springing a trap', 'map'],
  give_loot: ['counting the loot', 'coin'], give_item: ['counting the loot', 'coin'], give_gold: ['counting the loot', 'coin'], give_story_item: ['counting the loot', 'coin'], open_shop: ['opening the shop', 'coin'],
  advance_time: ['watching the clock', 'quill'],
};
const toolPhase = name => TOOL_PHASES[name] ?? ['plotting', 'quill'];
// a player talking to the DM rather than playing ("Hey DM, ...", "OOC: ...", "((...))")
export const OOC = /^\s*(?:\(\(|\[?ooc\b|out of character\b|(?:(?:hey|hi|hello|ok|okay|yo|um|so|wait)[\s,]+)?(?:dm|gm|dungeon master)\b)/i;
// table talk that asks nothing of the world; the DM stays out of it without asking the model
const CHATTER = /^\s*(?:ok(?:ay)?|k+|sure|yes|yeah|yep|yup|no|nope|nah|lol|lmao|ha(?:ha)+|hah|hm+|thanks|thank you|ty|cool|nice|great|agreed|same|right|true|got it|brb|back|gg|ready|one sec|sounds good|good idea|:\)|:d|:p|\p{Extended_Pictographic})+[\s.!?]*$/iu;
// the model's way of saying the message needed no answer
const PASS = /^\s*\**PASS\**\.?\s*$/;
// minutes a story exchange takes when the DM did not move the clock itself
export function exchangeMinutes(text) {
  if (/\b(?:travel|journey|ride|march|trek|set out|head (?:to|for|back|out)|walk (?:to|back|over)|go (?:to|back)|wait|nap)\b/i.test(text)) return 30;
  if (/\b(?:search|investigate|examine|inspect|look around|study|read|shop|browse|buy|sell|haggle|trade|barter|eat|drink|meal|bandage|tend)\b/i.test(text)) return 10;
  return 2;
}
const EXPLORE_ACTIONS = ['search', 'disarm', 'pickLock', 'force', 'go', 'solve', 'hint', 'read', 'navigate'];
const EXPLORE_EVENTS = ['trap', 'puzzle', 'explore', 'social'];

// non-combat results the DM model should narrate with full context
export function needsAdjudication(state, action, events) {
  if (inCombat(state)) return false;
  if (EXPLORE_ACTIONS.includes(action?.type)) return true;
  return events.some(e => EXPLORE_EVENTS.includes(e.type) || e.utility);
}

// npcStatus also expires spell conditions whose time has passed
// "the harness refuses" -> "the rules refuse"
const PLURAL = { is: 'are', was: 'were', has: 'have', does: 'do', "doesn't": "don't", says: 'say', refuses: 'refuse', rejects: 'reject', allows: 'allow', forbids: 'forbid', requires: 'require', decides: 'decide', resolves: 'resolve', rolls: 'roll', prevents: 'prevent', permits: 'permit', handles: 'handle' };
export function rulesWording(text) {
  return String(text ?? '').replace(/\b(the\s+)?(?:rules\s+engine|rules\s+harness|harness)\b(\s+(\w+(?:'t)?))?/gi, (m, the, tail, verb) => {
    const lead = m[0] === m[0].toUpperCase() ? 'The rules' : 'the rules';
    if (!tail) return lead;
    const v = PLURAL[verb.toLowerCase()];
    return `${lead} ${v ?? verb}`;
  });
}

const publicNpc =(state, n) => (npcStatus(state, n), { name: n.name, role: n.role, location: n.location ?? null, attitude: n.attitude ?? 'indifferent', charmed: !!n.charmed, status: n.condition?.state && n.condition.state !== 'awake' ? n.condition.state : null, secretsKnown: (n.secrets ?? []).filter(s => s.revealed).map(s => s.text) });

export class Game {
  constructor({ store, llm, hub, config, rng = cryptoRng, search = null, modules = null }) {
    this.store = store;
    this.modules = modules;
    this.search = search;
    this.stateQueued = new Set();
    this.llm = llm;
    this.hub = hub;
    this.config = config;
    this.rng = rng;
    this.pending = new Map();
    hub.onPresence = id => this.hub.broadcast(id, 'presence', this.hub.presence(id));
    // creatures the adventures brought in are known to the engine again after a restart
    try {
      loadBestiary(['active', 'archived'].flatMap(status => store.listCampaigns({ status })).map(c => store.getCampaign(c.id)).filter(Boolean));
    } catch (e) {
      console.error(`bestiary: ${e.message}`);
    }
  }

  // background work tracking so shutdown can await it
  track(campaignId, promise) {
    const list = this.pending.get(campaignId) ?? new Set();
    list.add(promise);
    this.pending.set(campaignId, list);
    promise.finally(() => list.delete(promise)).catch(() => {});
    return promise;
  }

  async idle(campaignId) {
    for (let i = 0; i < 50; i++) {
      const list = [...(this.pending.get(campaignId) ?? [])];
      if (!list.length) return;
      await Promise.allSettled(list);
    }
  }

  dmEndpoint(campaign) {
    return campaign?.settings?.model ?? this.config.dmModel ?? undefined;
  }

  smallEndpoint(campaign) {
    return this.config.smallModel ?? this.dmEndpoint(campaign);
  }

  // campaigns
  // the adventure a campaign runs: its module, or what an older campaign kept of the book
  adventureOf(campaign) {
    const id = campaign?.settings?.moduleId;
    if (id) {
      const module = this.modules?.get(id) ?? null;
      return { name: campaign.outline?.adventure ?? module?.name ?? 'the adventure', levels: module?.meta?.levels ?? null, module };
    }
    return campaign?.outline?.chapters?.length ? { name: campaign.outline.adventure, levels: null, module: null } : null;
  }

  async createCampaign({ name, ownerId, preset = 'classic', moduleId = null, custom = '', tone = 'heroic', startLevel = 1, leveling = 'xp', allowDeadly = false, hpMode = 'average', model = null }) {
    const clean = String(name ?? '').trim().slice(0, 60);
    if (!clean) throw new RuleError('Campaign name is required.');
    if (!Number.isInteger(startLevel) || startLevel < 1 || startLevel > 20) throw new RuleError('Starting level must be 1-20.');
    if (!['xp', 'milestone'].includes(leveling)) throw new RuleError('Leveling must be xp or milestone.');
    const mod = moduleId ? this.modules?.get(moduleId) : null;
    if (moduleId && mod?.status !== 'ready') throw new RuleError(mod ? 'That module is still being prepared.' : 'Unknown module.');
    if (mod) preset = 'module';
    else if (preset && !PRESETS[preset] && preset !== 'custom') throw new RuleError('Unknown setting preset.');
    const data = {
      settings: { preset, ...(mod ? { moduleId: mod.id } : {}), official: !!mod, custom: String(custom).slice(0, 1500), tone: String(tone).slice(0, 60), startLevel, leveling, allowDeadly: !!allowDeadly, hpMode, model },
      setting: null, settingStatus: 'generating', scene: { light: 'bright' }, clock: { minute: 8 * 60 }, encounter: null, npcs: {}, companions: [],
    };
    const c = this.store.createCampaign({ name: clean, ownerId, data });
    const work = this.buildSetting(c.id).catch(() => {});
    this.track(c.id, work);
    await work;
    return this.store.getCampaign(c.id);
  }

  async buildSetting(campaignId) {
    const c = this.store.getCampaign(campaignId);
    let setting = null;
    let source = 'generated';
    // a module's setting is read off its prepared summary: no model, no wait
    const mod = c.settings.moduleId ? this.modules?.get(c.settings.moduleId) : null;
    if (mod) setting = moduleSetting(mod);
    else if (this.llm.available) {
      try {
        setting = await generateSetting(this.llm, { name: c.name, preset: c.settings.preset, custom: c.settings.custom, tone: c.settings.tone, endpoint: this.dmEndpoint(c) });
      } catch {
        setting = null;
      }
    }
    if (!setting) {
      setting = fallbackSetting({ preset: c.settings.preset, name: c.name, seed: [...campaignId].reduce((s, ch) => s + ch.charCodeAt(0), 0) });
      source = 'offline';
    }
    await this.store.withLock(campaignId, async () => {
      const cc = this.store.getCampaign(campaignId);
      cc.setting = setting;
      cc.settingStatus = source;
      cc.scene = { ...cc.scene, location: publicPlace(setting.starting_location?.name, setting.starting_location?.description) ?? cc.scene.location };
      cc.npcs = cc.npcs ?? {};
      for (const n of setting.npcs ?? []) cc.npcs[n.name] = { name: n.name, role: n.role, personality: n.personality, statBlock: 'commoner', known: false };
      if (mod) {
        // the script, and the book's own creatures ready for the engine
        cc.outline = this.modules.skeleton(mod);
        if (mod.chapters[0]?.beats[0]?.readAloud?.length) cc.outline.shown.push('0.0.0');
        for (const spec of mod.creatures ?? []) {
          try {
            defineCreature(cc, spec, mod.id);
          } catch (e) {
            console.error(`creature ${spec.name}: ${e.message}`);
          }
        }
      }
      this.store.saveCampaign(cc);
      // only the starting town is known; the rest waits until the party comes across it
      const add = (kind, title, content, importance = 2, tags = 'unrevealed') => this.store.addMemory({ campaignId, kind, title, content, importance, source: 'setting', tags });
      add('location', setting.starting_location.name, setting.starting_location.description, 3, '');
      for (const r of setting.regions ?? []) add('location', r.name, r.description);
      for (const f of setting.factions ?? []) add('faction', f.name, f.description, 3);
      for (const n of setting.npcs ?? []) add('npc', n.name, `${n.role}. ${n.personality}`, 3);
      // rumors are DM notes until the party hears them (update_quest)
      (setting.hooks ?? []).forEach((h, i) => this.store.addMemory({ campaignId, kind: 'quest', title: `Rumor ${i + 1}`, content: `[rumor] ${h}`, importance: 3, source: 'setting', tags: 'rumor,dm-secret' }));
      if (setting.central_threat) this.store.addMemory({ campaignId, kind: 'fact', title: 'Central threat', content: setting.central_threat, importance: 5, source: 'setting', tags: 'dm-secret' });
    });
    this.broadcastState(campaignId);
    this.hub.broadcast('lobby', 'campaigns', this.listCampaigns());
  }

  // the map stays a step ahead of the party: the area it stands in is
  // described and every exit leads somewhere mapped
  async mapAhead(sess, { onlyStub = false } = {}) {
    if (!this.llm.available || inCombat(sess.state)) return;
    const u = unmappedAround(sess.state);
    if (!u.area || (onlyStub ? !u.stub : !u.stub && !u.exits.length)) return;
    const campaign = sess.campaign;
    const tool = DM_TOOLS.find(t => t.name === 'create_area');
    const adv = this.adventureOf(campaign);
    const outline = adv ? outlineText(campaign.outline, adv.module) : '';
    // the book's own text for the areas about to be drawn
    const ref = adv?.module ? this.modules.search(adv.module, [u.area, ...u.exits.map(e => e.to)].slice(0, 3).join(' '), { chapter: campaign.outline.chapter, chars: 3000 }) : '';
    const wanted = () => {
      const x = unmappedAround(sess.state);
      return [...(x.stub ? [x.area] : []), ...(onlyStub ? [] : x.exits.map(e => e.to))];
    };
    const messages = [
      { role: 'system', content: `You are the mapmaker for the Dungeon Master of a D&D 5e campaign.${outline ? ' Map the published adventure\'s own keyed areas with their real names, contents, traps and exits as the book has them.' : ''} Map each area you are asked for by calling create_area once per area, never with start. Give each a description of what the party sees on arrival (two sentences at most), its exits (always including the way back, with the exact name of the area it leads to) and its features, traps and clues. New exits may lead to areas not mapped yet.${outline ? ' This is a published adventure: use its real areas, names and contents.' : ''}\nWORLD:\n${settingToText(campaign.setting).slice(0, 2500)}${outline ? `\n${outline.slice(0, 3000)}` : ''}${ref ? `\nTHE BOOK'S TEXT for these areas (follow it):\n${ref}` : ''}` },
      { role: 'user', content: `The party is in ${u.area}.\n${worldBlock(sess.state)}\nMap now: ${wanted().join('; ')}.${u.stub ? ` The party is standing in ${u.area}, which has no description yet; describe it and keep its existing exits.` : ''}` },
    ];
    try {
      for (let round = 0; round < 2 && wanted().length; round++) {
        const out = await this.llm.chat({ endpoint: this.dmEndpoint(campaign), messages, tools: [tool], toolChoice: 'auto', temperature: outline ? 0.3 : 0.6, maxTokens: 1500 });
        if (!out.toolCalls.length) break;
        messages.push({ role: 'assistant', content: out.content || '', tool_calls: out.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) } })) });
        for (const tc of out.toolCalls) {
          const result = tc.name === 'create_area' ? await executeTool(sess, 'create_area', { ...(tc.arguments ?? {}), start: false }).catch(e => ({ ok: false, rejected: e.message })) : { ok: false, rejected: 'Only create_area.' };
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 2000) });
        }
        if (wanted().length) messages.push({ role: 'user', content: `Still unmapped: ${wanted().join('; ')}.` });
      }
    } catch (e) {
      console.error(`mapping ahead in ${sess.campaignId}: ${e.message}`);
    }
  }

  listCampaigns({ status = 'active' } = {}) {
    return this.store.listCampaigns({ status }).map(c => {
      try {
        return this.campaignCard(c);
      } catch (e) {
        console.error(`campaign ${c.id} lists without details: ${e.message}`);
        return { id: c.id, name: c.name, status: c.status, ownerId: c.ownerId, updated: c.updated, created: c.created, characters: [], online: [], damaged: true };
      }
    });
  }

  campaignCard(c) {
    const chars = this.store.listCharacters(c.id).filter(x => !x.retired);
    const last = this.store.listMessages(c.id, { channel: 'dm', limit: 1 })[0];
    return {
      id: c.id, name: c.name, ownerId: c.ownerId, status: c.status, updated: c.updated, created: c.created,
      world: c.setting?.world_name ?? null, overview: c.setting?.overview ?? null, settingStatus: c.settingStatus,
      preset: c.settings?.preset, leveling: c.settings?.leveling, startLevel: c.settings?.startLevel,
      location: publicPlace(c.scene?.location), inCombat: c.encounter?.status === 'active',
      characters: chars.map(x => ({ id: x.id, name: x.name, level: x.level, race: RACES[x.race]?.name, class: classLabel(x, CLASSES), playerId: x.playerId, dead: x.dead })),
      online: this.hub.presence(c.id),
      lastMessage: last ? { content: last.content.slice(0, 140), speaker: last.speaker ?? last.authorName, created: last.created } : null,
    };
  }

  // lower-cased names of the people, places and factions the party knows of:
  // NPCs met or heard, places been, factions dealt with, anything the DM revealed
  knownNames(campaignId, state = this.store.loadState(campaignId)) {
    const c = state.campaign;
    const out = new Set([...(c.revealed ?? []), ...this.store.npcSpeakers(campaignId), state.scene?.location, c.setting?.starting_location?.name].filter(Boolean).map(s => s.toLowerCase()));
    for (const n of Object.values(c.npcs ?? {})) if (n.known !== false) out.add(n.name.toLowerCase());
    for (const a of Object.values(state.world?.areas ?? {})) if (a.visited || a.id === state.world?.currentArea) out.add(String(a.name).toLowerCase());
    for (const f of Object.keys(state.world?.factions ?? {})) out.add(f.toLowerCase());
    return out;
  }

  // journal entries a player may read
  playerMemories(campaignId, list) {
    const known = this.knownNames(campaignId);
    return list.filter(m => Store.isPublic(m) || (Store.isUnrevealed(m) && known.has(m.title.toLowerCase())));
  }

  campaignView(campaignId) {
    const state = this.store.loadState(campaignId);
    if (!state) return null;
    const c = state.campaign;
    const known = this.knownNames(campaignId, state);
    const quests = this.store.listMemories(campaignId, { kind: 'quest' }).filter(Store.isPublic);
    const s = c.setting;
    return {
      id: c.id, name: c.name, ownerId: c.ownerId, status: c.status, settings: c.settings, setting: s ? { world_name: s.world_name, overview: s.overview, starting_location: s.starting_location && { ...s.starting_location, name: publicPlace(s.starting_location.name, s.starting_location.description) } } : null, settingStatus: c.settingStatus,
      scene: state.scene && { ...state.scene, location: publicPlace(state.scene.location) }, clock: state.clock, encounter: state.encounter, characters: Object.values(state.characters),
      companions: c.companions ?? [], npcs: Object.values(c.npcs ?? {}).filter(n => known.has(n.name.toLowerCase())).map(n => publicNpc(state, n)),
      places: this.playerMemories(campaignId, this.store.listMemories(campaignId, { kind: 'location' })).map(m => ({ name: m.title, description: m.content, here: m.title.toLowerCase() === String(state.scene?.location ?? '').toLowerCase() })),
      factionsKnown: this.playerMemories(campaignId, this.store.listMemories(campaignId, { kind: 'faction' })).map(m => ({ name: m.title, description: m.content })), world: worldView(state), quests, online: this.hub.presence(campaignId),
      lastEncounter: state.lastEncounter, dmModel: this.llm.available ? 'online' : 'offline',
    };
  }

  // one view per tick however many changes landed, none for an empty room
  broadcastState(campaignId) {
    if (this.stateQueued.has(campaignId)) return;
    this.stateQueued.add(campaignId);
    setImmediate(() => {
      this.stateQueued.delete(campaignId);
      if (!this.hub.clients.get(campaignId)?.size) return;
      const v = this.campaignView(campaignId);
      if (v) this.hub.broadcast(campaignId, 'state', v);
    });
  }

  async updateCampaign(campaignId, playerId, patch) {
    return this.store.withLock(campaignId, async () => {
      const c = this.store.getCampaign(campaignId);
      if (!c) throw new RuleError('No such campaign.', 'not_found');
      if (c.ownerId && c.ownerId !== playerId) throw new RuleError('Only the campaign owner can change settings.', 'forbidden');
      if (patch.name) c.name = String(patch.name).slice(0, 60);
      for (const k of ['tone', 'allowDeadly', 'model', 'leveling']) if (k in patch) c.settings[k] = patch[k];
      const moved = patch.status && ['active', 'archived'].includes(patch.status) && patch.status !== c.status;
      if (moved) c.status = patch.status;
      this.store.saveCampaign(c);
      this.broadcastState(campaignId);
      if (moved) this.hub.broadcast('lobby', 'campaigns', this.listCampaigns());
      return this.campaignView(campaignId);
    });
  }

  // only an archived campaign can be deleted, and only by its owner
  async deleteCampaign(campaignId, playerId) {
    await this.store.withLock(campaignId, async () => {
      const c = this.store.getCampaign(campaignId);
      if (!c) throw new RuleError('No such campaign.', 'not_found');
      if (c.ownerId && c.ownerId !== playerId) throw new RuleError('Only the campaign owner can delete it.', 'forbidden');
      if (c.status !== 'archived') throw new RuleError('Archive the campaign before deleting it.');
      this.store.deleteCampaign(campaignId);
    });
    this.hub.broadcast('lobby', 'campaigns', this.listCampaigns());
    return { ok: true };
  }

  // characters
  rollAbilities(playerId) {
    const scores = Array.from({ length: 6 }, () => roll('4d6kh3', this.rng).total);
    const token = this.store.saveRollToken(playerId, scores);
    return { token, scores };
  }

  validateCharacter(campaignId, input, rollToken, characterId = null) {
    const c = this.store.getCampaign(campaignId);
    // an existing character is checked at its own level with the scores it rolled
    const old = characterId ? this.store.getCharacter(characterId) : null;
    if (old && old.campaignId === campaignId) {
      const rolled = old.creation?.rolledScores ?? (old.abilityMethod === 'rolled' ? Object.values(old.baseAbilities) : null);
      return validateCreation({ ...input, level: old.level }, { maxLevel: old.level, ...(rolled ? { rolledScores: rolled } : {}) });
    }
    const ctx = { maxLevel: c?.settings?.startLevel ?? 1 };
    if (input.abilityMethod === 'rolled' && rollToken) ctx.rolledScores = this.store.getRollToken(rollToken)?.scores;
    return validateCreation({ ...input, level: input.level ?? c?.settings?.startLevel ?? 1 }, ctx);
  }

  // a rules-valid random character that fits the campaign; the model names it and writes its story
  async randomCharacter(campaignId) {
    const c = this.store.getCampaign(campaignId);
    if (!c) throw new RuleError('No such campaign.', 'not_found');
    const input = randomCharacter(() => this.rng.float(), { level: c.settings?.startLevel ?? 1, preset: PRESETS[c.settings?.preset]?.theme ?? c.settings?.preset });
    if (!this.llm.available) return input;
    const world = settingToText(publicSetting(c.setting)).slice(0, 2000);
    const who = `a level ${input.level} ${RACES[input.race].name} ${CLASSES[input.class].name} with the ${input.background} background, ${input.alignment}`;
    try {
      const out = await this.llm.chat({
        endpoint: this.smallEndpoint(c), temperature: 1, maxTokens: 700,
        messages: [
          { role: 'system', content: 'You write player characters for a D&D 5e campaign. Reply with only a JSON object with the string fields name, pronouns, appearance, personality, ideals, bonds, flaws, backstory. The name fits the race and the world. The backstory (3-5 sentences) is rooted in this world and gives the character a reason to be at the starting location. Never reveal or invent world secrets.' },
          { role: 'user', content: `WORLD:\n${world}\n\nCreate ${who}. Campaign tone: ${c.settings?.tone ?? 'heroic'}.` },
        ],
      });
      const m = /\{[\s\S]*\}/.exec(out.content ?? '');
      const j = m ? JSON.parse(m[0]) : null;
      if (j) {
        if (typeof j.name === 'string' && /^[\p{L}][\p{L} .'-]{0,39}$/u.test(j.name.trim())) input.name = j.name.trim();
        for (const k of ['pronouns', 'appearance', 'personality', 'ideals', 'bonds', 'flaws', 'backstory']) if (typeof j[k] === 'string') input.description[k] = j[k].slice(0, 2000);
      }
    } catch {
      /* the mechanical character stands on its own */
    }
    return input;
  }

  async createCharacter(campaignId, playerId, input, rollToken) {
    return this.store.withLock(campaignId, async () => {
      const c = this.store.getCampaign(campaignId);
      if (!c) throw new RuleError('No such campaign.', 'not_found');
      if (!this.store.getPlayer(playerId)) throw new RuleError('Unknown player.', 'forbidden');
      const existing = this.store.listCharacters(campaignId).filter(x => x.playerId === playerId && !x.retired && !x.dead);
      if (existing.length) throw new RuleError('You already have a living character in this campaign.');
      const ctx = { campaignId, playerId, maxLevel: c.settings.startLevel };
      if (input.abilityMethod === 'rolled') {
        const tok = rollToken ? this.store.getRollToken(rollToken) : null;
        if (!tok || tok.used || (tok.playerId && tok.playerId !== playerId)) throw new RuleError('Rolled scores need a valid, unused roll token.');
        ctx.rolledScores = tok.scores;
      }
      if (input.startingGold) ctx.startingGold = roll('5d4', this.rng).total * 10;
      const { character, errors } = buildCharacter({ ...input, level: c.settings.startLevel }, ctx);
      if (errors.length) throw new RuleError(errors.join(' '), 'invalid_character');
      if (input.abilityMethod === 'rolled') this.store.useRollToken(rollToken);
      character.lastLongRestMinute = null;
      // kept so the character can be opened in the creator again
      character.creation = { ...structuredClone(input), level: undefined, rolledScores: ctx.rolledScores ?? null };
      this.store.saveCharacter(character);
      const player = this.store.getPlayer(playerId);
      const firstEver = this.store.countMessages(campaignId, 'dm') === 0;
      this.postSystem(campaignId, `${player.name} joins as ${summarizeCharacter(character)}.`);
      if (firstEver && c.setting?.opening) this.postDm(campaignId, c.setting.opening, c.settings.moduleId ? { model: false } : undefined);
      this.broadcastState(campaignId);
      this.hub.broadcast('lobby', 'campaigns', this.listCampaigns());
      return character;
    });
  }

  async updateCharacterDescription(characterId, playerId, description) {
    const ch = this.store.getCharacter(characterId);
    if (!ch) throw new RuleError('No such character.', 'not_found');
    if (ch.playerId !== playerId) throw new RuleError('That is not your character.', 'forbidden');
    return this.store.withLock(ch.campaignId, async () => {
      const fresh = this.store.getCharacter(characterId);
      for (const [k, v] of Object.entries(description ?? {})) {
        if (!['appearance', 'personality', 'ideals', 'bonds', 'flaws', 'backstory', 'pronouns', 'age', 'height', 'weight', 'notes'].includes(k)) continue;
        fresh.description[k] = String(v).slice(0, 4000);
      }
      this.store.saveCharacter(fresh);
      this.broadcastState(ch.campaignId);
      return fresh;
    });
  }

  // what the creator needs to edit a character, or why it cannot
  buildInfo(characterId, playerId) {
    const ch = this.store.getCharacter(characterId);
    if (!ch) throw new RuleError('No such character.', 'not_found');
    if (ch.playerId !== playerId) throw new RuleError('That is not your character.', 'forbidden');
    const why = ch.dead ? 'Dead characters cannot be rebuilt.' : (ch.classes?.length ?? 1) > 1 ? 'Multiclassed characters can only edit their bio; the creator builds a single class.' : null;
    return { campaignId: ch.campaignId, level: ch.level, input: creationInput(ch), editable: !why, why };
  }

  // the character remade from the creator at its current level; experience,
  // gear, coin, wounds and spent resources carry over
  async rebuildCharacter(characterId, playerId, input) {
    const info = this.buildInfo(characterId, playerId);
    if (!info.editable) throw new RuleError(info.why);
    return this.store.withLock(info.campaignId, async () => {
      const st = this.store.loadState(info.campaignId);
      if (inCombat(st) && st.encounter.combatants[characterId]) throw new RuleError('You cannot rebuild a character mid-combat.');
      const old = this.store.getCharacter(characterId);
      const rolled = old.creation?.rolledScores ?? (old.abilityMethod === 'rolled' ? Object.values(old.baseAbilities) : null);
      const clean = { ...input, level: old.level, id: old.id };
      delete clean.startingGold;
      const ctx = { campaignId: old.campaignId, playerId, maxLevel: old.level, ...(rolled ? { rolledScores: rolled } : {}) };
      const { character, errors } = buildCharacter(clean, ctx);
      if (errors.length) throw new RuleError(errors.join(' '), 'invalid_character');
      for (const k of ['xp', 'inventory', 'currency', 'conditions', 'exhaustion', 'effects', 'deathSaves', 'stable', 'milestoneLevels', 'pendingLevelUp', 'createdAt', 'lastLongRestMinute', 'preferences', 'concentration', 'inspirationDie', 'tempHp']) if (k in old) character[k] = structuredClone(old[k]);
      character.hitDiceUsed = Math.min(old.hitDiceUsed ?? 0, character.level);
      // the same class keeps its rolled hit points
      if (old.class === character.class) character.hpRolls = [...(old.hpRolls ?? [])];
      character.resources = old.resources;
      character.slots = old.slots;
      character.pactSlots = old.pactSlots;
      syncResources(character);
      character.maxHp = computeMaxHp(character);
      character.hp = Math.max(old.hp > 0 ? 1 : 0, Math.min(character.maxHp, character.maxHp - (old.maxHp - old.hp)));
      character.creation = { ...structuredClone(input), level: undefined, rolledScores: rolled };
      this.store.saveCharacter(character);
      this.postSystem(info.campaignId, `${character.name} is now ${summarizeCharacter(character)}.`);
      this.broadcastState(info.campaignId);
      return character;
    });
  }

  async retireCharacter(characterId, playerId) {
    const ch = this.store.getCharacter(characterId);
    if (!ch || ch.playerId !== playerId) throw new RuleError('That is not your character.', 'forbidden');
    return this.store.withLock(ch.campaignId, async () => {
      const st = this.store.loadState(ch.campaignId);
      if (inCombat(st) && st.encounter.combatants[characterId]) throw new RuleError('You cannot retire a character mid-combat.');
      const fresh = this.store.getCharacter(characterId);
      fresh.retired = true;
      this.store.saveCharacter(fresh);
      this.postSystem(ch.campaignId, `${fresh.name} leaves the party.`);
      this.broadcastState(ch.campaignId);
    });
  }

  levelUpInfo(characterId, cls = null, subclass = null) {
    const ch = this.store.getCharacter(characterId);
    if (!ch) throw new RuleError('No such character.', 'not_found');
    const c = this.store.getCampaign(ch.campaignId);
    if (cls && !Object.hasOwn(CLASSES, cls)) throw new RuleError(`Unknown class "${cls}".`);
    return { canLevel: canLevelUp(ch, c), requirements: ch.level < 20 ? levelUpRequirements(ch, cls, { subclass }) : null, classes: classLevels(ch), multiclass: multiclassOptions(ch) };
  }

  // messages
  postMessage(m) {
    const msg = this.store.addMessage(m);
    this.hub.broadcast(m.campaignId, 'message', msg);
    return msg;
  }

  postSystem(campaignId, content, channel = 'dm', data = null) {
    return this.postMessage({ campaignId, channel, kind: 'system', content, data });
  }

  postDm(campaignId, text, { model = true, ooc = false } = {}) {
    const out = [];
    // players hear about "the rules", never the machinery behind them
    if (model) text = rulesWording(text);
    if (ooc) {
      text = String(text ?? '').replace(/\[DM only\][^\n]*/gi, '').replace(/^\s*\(?OOC\)?:?\s*/i, '').trim();
      return text ? [this.postMessage({ campaignId, channel: 'dm', kind: 'dm', speaker: null, content: text, data: { ooc: true } })] : out;
    }
    if (model) {
      // nothing the characters cannot perceive: hidden creatures, their plans, the DM's recap of the table
      text = stripDmKnowledge(stripCommandTalk(stripSuggestions(text))).text;
      const c = this.store.getCampaign(campaignId);
      text = liftNpcQuotes(text, [...Object.keys(c?.npcs ?? {}), ...(c?.companions ?? []).map(x => x.name)]);
    }
    // a model that echoes tool output must not leak DM-only lines
    text = String(text ?? '').replace(/\[DM only\][^\n]*?(?=\[DM only\]|\n|$)/gi, '').replace(/\(\s*\)/g, '').trim();
    if (model) {
      const recent = this.store.listMessages(campaignId, { channel: 'dm', limit: 6 }).filter(m => m.kind === 'dm' || m.kind === 'npc').map(m => m.content);
      text = dedupeNarration(text, recent);
    }
    if (!text) return out;
    // the DM never voices a player character
    const pcNames = model ? this.store.listCharacters(campaignId).flatMap(c => [c.name, c.name.split(' ')[0]]).map(n => n.toLowerCase()) : [];
    let segs = parseSegments(text).filter(s => !(s.speaker && pcNames.includes(s.speaker.toLowerCase())));
    if (model) segs = capNarration(mergeMonologues(segs));
    for (const seg of segs) {
      if (seg.speaker) out.push(this.postMessage({ campaignId, channel: 'dm', kind: 'npc', speaker: seg.speaker, content: seg.text.replace(/^"|"$/g, '') }));
      else out.push(this.postMessage({ campaignId, channel: 'dm', kind: 'dm', speaker: null, content: seg.text }));
    }
    return out;
  }

  postEvents(campaignId, events, { channel = 'dm' } = {}) {
    const ev = events.filter(e => e.text && !e.dmOnly);
    if (!ev.length) return null;
    return this.postMessage({ campaignId, channel, kind: 'roll', content: ev.map(e => e.text).join('\n'), data: { events: ev.map(e => ({ type: e.type, text: e.text, roll: e.roll ? { natural: e.roll.natural, rolls: e.roll.rolls, total: e.roll.total, dc: e.roll.dc, success: e.roll.success } : undefined })) } });
  }

  // in-lock session over mutable state
  session(campaignId, { actorId = null, playerId = null } = {}) {
    const game = this;
    const s = {
      campaignId, actorId, playerId, store: this.store, allEvents: [], holdEvents: false, held: [],
      state: this.store.loadState(campaignId),
      get campaign() {
        return this.state.campaign;
      },
      apply(fn) {
        const r = runAtomic(this.state, ctx => {
          const out = fn(ctx);
          autoAdvance(ctx);
          return out;
        }, { rng: game.rng });
        if (r.ok) {
          this.state = r.state;
          game.afterCombatSync(this.state, r.events);
          // however the fight started, the scene's ambush is no longer waiting
          if (r.events.some(e => e.type === 'combat_start')) {
            game.markSprung(this.state.campaign);
            // a published adventure may have its foes take prisoners: the DM rules on that if the whole party falls
            if (this.state.encounter?.status === 'active' && game.llm.available && game.adventureOf(this.state.campaign)?.module) this.state.encounter.downedPolicy ??= 'ask';
          }
          game.store.saveState(this.state);
          this.allEvents.push(...r.events);
          if (this.holdEvents) this.held.push(...r.events);
          else game.postEvents(campaignId, r.events);
          game.broadcastState(campaignId);
        }
        return r;
      },
      saveCampaign() {
        game.store.saveState(this.state);
        game.broadcastState(campaignId);
      },
      onMemory: m => game.hub.broadcast(campaignId, 'memory', m),
      search: game.search,
    };
    return s;
  }

  // companions keep hp between fights; a companion at 0 leaves for good
  afterCombatSync(state, events) {
    const enc = state.encounter;
    if (!enc || !state.campaign.companions?.length) return;
    for (const cb of Object.values(enc.combatants)) {
      if (!cb.companionId) continue;
      const comp = state.campaign.companions.find(c => c.id === cb.companionId);
      if (comp) comp.hp = Math.max(0, cb.creature.hp);
    }
    if (enc.status !== 'active') {
      const fallen = state.campaign.companions.filter(c => c.hp <= 0);
      state.campaign.companions = state.campaign.companions.filter(c => c.hp > 0);
      for (const f of fallen) events.push({ type: 'death', text: `${f.name} has fallen and is no longer with the party.` });
    }
  }

  ownCharacter(state, playerId, characterId) {
    const ch = characterId ? state.characters[characterId] : Object.values(state.characters).find(c => c.playerId === playerId && !c.dead);
    if (!ch) throw new RuleError('You need a character in this campaign first.', 'no_character');
    if (ch.playerId !== playerId) throw new RuleError('That is not your character.', 'forbidden');
    return ch;
  }

  // player sends a chat message
  async handleMessage(campaignId, playerId, { channel = 'dm', content, characterId }) {
    const text = String(content ?? '').trim().slice(0, 2000);
    if (!text) throw new RuleError('Empty message.');
    if (!['dm', 'party'].includes(channel)) throw new RuleError('Unknown channel.');
    const player = this.store.getPlayer(playerId);
    if (!player) throw new RuleError('Unknown player.', 'forbidden');
    const campaign = this.store.getCampaign(campaignId);
    if (!campaign) throw new RuleError('No such campaign.', 'not_found');
    this.store.touchPlayer(playerId);
    const chars = this.store.listCharacters(campaignId).filter(c => !c.retired);
    const ch = characterId ? chars.find(c => c.id === characterId) : chars.find(c => c.playerId === playerId && !c.dead) ?? chars.find(c => c.playerId === playerId);
    if (ch && ch.playerId !== playerId) throw new RuleError('That is not your character.', 'forbidden');
    // /dm tool arguments can hold secrets, so they are never stored in shared chat
    const hidden = channel === 'dm' && /^\/dm\s+tool\b/i.test(text);
    const msg = hidden ? { campaignId, channel, kind: 'player', authorId: playerId, content: '/dm tool', hidden: true } : this.postMessage({ campaignId, channel, kind: 'player', authorId: playerId, authorName: player.name, speaker: ch?.name ?? null, content: text, data: ch ? { characterId: ch.id } : null });
    const work = this.store.withLock(campaignId, () => (channel === 'party' ? this.partyChat(campaignId, player, ch, text) : this.dmChannel(campaignId, player, ch, text))).catch(e => {
      this.postSystem(campaignId, `Rules error: ${e.message}`, channel);
    });
    this.track(campaignId, work);
    return { message: msg, done: work };
  }

  async dmChannel(campaignId, player, ch, text) {
    const campaign = this.store.getCampaign(campaignId);
    if (text.startsWith('/dm')) return this.manualDm(campaignId, player, campaign, text);
    // a dying character's turn is its death save: whatever its player says in character rolls it
    if (ch && !OOC.test(text)) {
      const sess = this.session(campaignId, { actorId: ch.id, playerId: player.id });
      const pc = sess.state.characters[ch.id];
      if (dyingTurn(sess.state, pc)) {
        let cmd = null;
        try {
          cmd = text.startsWith('/') ? parseCommand(text, sess.state, pc) : null;
        } catch {
          /* not a command the rules know */
        }
        if (!text.startsWith('/') || cmd?.action?.type === 'deathSave') {
          const r = sess.apply(ctx => executeSync(ctx, ch.id, { type: 'deathSave' }));
          if (!r.ok) return this.postSystem(campaignId, `Not allowed: ${r.error}`, 'dm', { rejected: true, for: player.id });
          await this.narrateEvents(sess, r.events, { actor: ch, intent: 'death saving throw' });
          return this.afterAction(sess);
        }
        if (cmd?.kind === 'action') return this.postSystem(campaignId, `${pc.name} is unconscious and dying. Roll your death saving throw (/deathsave, the button, or just say anything).`, 'dm', { rejected: true, for: player.id });
      }
    }
    if (text.startsWith('/') && !this.llm.available) {
      if (!ch) return this.postSystem(campaignId, 'Create a character first.');
      const sess = this.session(campaignId, { actorId: ch.id, playerId: player.id });
      let parsed;
      try {
        parsed = parseCommand(text, sess.state, sess.state.characters[ch.id]);
      } catch (e) {
        if (e instanceof CommandError || e instanceof RuleError) return this.postSystem(campaignId, e.message, 'dm', { rejected: true, for: player.id });
        throw e;
      }
      if (parsed.kind === 'help') return this.postSystem(campaignId, HELP_TEXT, 'dm', { help: true, for: player.id });
      if (parsed.kind === 'info') return this.postSystem(campaignId, parsed.topic === 'whoami' ? summarizeCharacter(sess.state.characters[ch.id]) : 'Open your character sheet to level up.', 'dm', { for: player.id });
      if (parsed.kind === 'roll') {
        try {
          const r = roll(parsed.dice, this.rng);
          return this.postMessage({ campaignId, channel: 'dm', kind: 'roll', content: `${ch.name} rolls ${parsed.dice} for fun: ${r.detail} = ${r.total} (no game effect)`, data: { events: [{ type: 'free_roll', text: `${parsed.dice}: ${r.detail} = ${r.total}` }] } });
        } catch (e) {
          return this.postSystem(campaignId, e.message);
        }
      }
      const r = sess.apply(ctx => this.executeAsPlayer(ctx, ch.id, parsed.action));
      if (!r.ok) return this.postSystem(campaignId, `Not allowed: ${r.error}`, 'dm', { rejected: true, for: player.id });
      if (this.llm.available && needsAdjudication(sess.state, parsed.action, r.events)) await this.adjudicate(sess, { player, ch, intent: text, events: r.events });
      else await this.narrateEvents(sess, r.events, { actor: ch, intent: text });
      return this.afterAction(sess);
    }
    // "we head south", "I cross to the old bridge": the party simply goes
    if (ch && !text.startsWith('/') && !OOC.test(text)) {
      const sess = this.session(campaignId, { actorId: ch.id, playerId: player.id });
      const dir = exitFromText(sess.state, text);
      if (dir) {
        sess.holdEvents = true;
        const r = sess.apply(ctx => this.executeAsPlayer(ctx, ch.id, { type: 'go', to: dir }));
        sess.holdEvents = false;
        if (r.ok) {
          this.postEvents(campaignId, sess.held.splice(0));
          await this.mapAhead(sess, { onlyStub: true });
          if (this.llm.available) await this.adjudicate(sess, { player, ch, intent: text, events: r.events });
          await this.afterAction(sess);
          return this.prepAhead(campaignId);
        }
        // a locked door or the like: the DM answers in the story
        sess.held.length = 0;
        if (!this.llm.available) return this.postSystem(campaignId, r.error, 'dm', { rejected: true, for: player.id });
      }
    }
    if (!this.llm.available) {
      return this.postSystem(campaignId, 'The DM model is offline. Use / commands for actions (type /help). The campaign owner can run the game with /dm commands.', 'dm', { for: player.id });
    }
    if (CHATTER.test(text)) return;
    const sess = this.session(campaignId, { actorId: ch?.id ?? null, playerId: player.id });
    const before = nowMinute(sess.state);
    // "I search the brush", "I examine the arrows": the rules roll first, the DM rules on the totals
    const rolled = this.intentChecks(sess, ch, text);
    const turn = await this.dmTurn(sess, { player, ch, text, harness: rolled });
    // story time passes as the party acts, unless the DM already moved the clock
    if (turn.spoke && !turn.ooc && !inCombat(sess.state) && nowMinute(sess.state) === before) {
      sess.apply(ctx => {
        ctx.state.clock = ctx.state.clock ?? { minute: 0 };
        ctx.state.clock.minute = nowMinute(ctx.state) + exchangeMinutes(text);
        expireByClock(ctx);
      });
    }
    await this.afterAction(sess);
    this.prepAhead(campaignId);
  }

  // map ahead and fold the chronicle once the reply is out, queued behind waiting players
  prepAhead(campaignId) {
    this.track(campaignId, this.store.withLock(campaignId, () => this.mapAhead(this.session(campaignId))).catch(() => null));
    this.track(campaignId, this.compress(campaignId));
  }

  // fold old chat into the running chronicle when it outgrows the prompt
  compress(campaignId) {
    const campaign = this.store.getCampaign(campaignId);
    return maybeSummarize({ store: this.store, llm: this.llm, campaignId, channel: 'dm', endpoint: this.smallEndpoint(campaign), budget: Math.max(2000, Math.floor(this.config.contextTokens * 0.55)) }).catch(() => null);
  }

  executeAsPlayer(ctx, charId, action) {
    return executeSync(ctx, charId, action);
  }

  // structured action from the UI
  // answers once the engine has ruled; narration and monster turns follow over SSE
  async handleAction(campaignId, playerId, characterId, action) {
    let answer;
    const answered = new Promise(res => (answer = res));
    const work = this.store.withLock(campaignId, async () => {
      const sess = this.session(campaignId, { actorId: characterId, playerId });
      const ch = this.ownCharacter(sess.state, playerId, characterId);
      if (!action || typeof action !== 'object' || !action.type) throw new RuleError('Invalid action.');
      sess.holdEvents = true;
      const r = sess.apply(ctx => executeSync(ctx, ch.id, action));
      sess.holdEvents = false;
      if (!r.ok) return { ok: false, error: r.error, code: r.code };
      const label = describeAction(action, sess.state);
      if (label) this.postMessage({ campaignId, channel: 'dm', kind: 'player', authorId: playerId, authorName: this.store.getPlayer(playerId)?.name, speaker: ch.name, content: label, data: { characterId: ch.id, action: true } });
      this.postEvents(campaignId, sess.held.splice(0));
      const result = { ok: true, events: r.events.filter(e => !e.dmOnly).map(e => e.text), result: r.result ?? null };
      answer(result);
      const player = this.store.getPlayer(playerId);
      try {
        if (action.type === 'go') await this.mapAhead(sess, { onlyStub: true });
        if (this.llm.available && player && needsAdjudication(sess.state, action, r.events)) await this.adjudicate(sess, { player, ch, intent: label ?? action.type, events: r.events });
        else if (!['equip', 'unequip', 'setPreference', 'prepare', 'levelUp', 'attune', 'addItem', 'drop'].includes(action.type)) await this.narrateEvents(sess, r.events, { actor: ch, intent: label });
        await this.afterAction(sess);
      } catch (e) {
        this.postSystem(campaignId, `Rules error: ${e.message}`);
      }
      if (!inCombat(sess.state)) this.prepAhead(campaignId);
      return result;
    });
    this.track(campaignId, work);
    work.then(answer, () => {});
    return Promise.race([answered, work]);
  }

  // the scene notes of the beat in play, from the module or the campaign's own copy
  sceneBrief(campaign) {
    const o = campaign?.outline;
    if (!o?.chapters?.length) return null;
    const mod = this.adventureOf(campaign)?.module;
    return (mod ? this.modules.beat(mod, o.chapter, o.beat) : null)?.brief ?? o.chapters[o.chapter]?.beats?.[o.beat]?.brief ?? null;
  }

  // the book's creatures lying in wait in the scene in play that have not attacked yet
  pendingAmbushes(campaign) {
    const o = campaign?.outline;
    if (!o) return [];
    return hiddenEncounters(this.sceneBrief(campaign)).filter(h => !(o.sprung ?? []).includes(`${o.chapter}.${o.beat}.${h.index}`));
  }

  // combat began while ambushes waited: they have been sprung
  markSprung(campaign) {
    const o = campaign?.outline;
    const waiting = this.pendingAmbushes(campaign);
    if (waiting.length) o.sprung = [...(o.sprung ?? []), ...waiting.map(h => `${o.chapter}.${o.beat}.${h.index}`)];
  }

  // the checks a player's words call for, rolled now; returns the DM's note, or null
  intentChecks(sess, ch, text) {
    if (!ch || OOC.test(text) || text.startsWith('/') || inCombat(sess.state)) return null;
    const pc = sess.state.characters[ch.id];
    if (!pc || pc.dead || pc.hp <= 0) return null;
    const skills = checkIntents(text);
    if (!skills.length) return null;
    const mapped = !!world(sess.state).currentArea;
    let searched = false;
    const lines = [];
    for (const skill of skills) {
      // in a mapped area a look around also turns up its hidden features
      const search = mapped && !searched && (skill === 'perception' || skill === 'investigation');
      searched ||= search;
      const r = sess.apply(ctx => (search ? executeSync(ctx, ch.id, { type: 'search', skill }) : requestCheck(ctx, { character: ch.id, skill, reason: text.slice(0, 80) })));
      if (r.ok) lines.push(...r.events.filter(e => e.text).map(e => (e.dmOnly ? `[DM only] ${e.text}` : e.text)));
    }
    if (!lines.length) return null;
    const lurking = skills.includes('perception') ? this.pendingAmbushes(sess.campaign) : [];
    const spot = lurking.length ? `\n[DM only] Lying in wait, per the book: ${lurking.map(h => `${h.creatures} (spotted with Perception ${h.dc} or more)`).join('; ')}. A total that reaches it spots them, and they attack at once with no surprise: call start_combat now. A lower total notices nothing of them.` : '';
    return `The rules rolled ${ch.name}'s ${skills.length > 1 ? 'checks' : 'check'} for what they just did:\n${lines.join('\n')}\nRule on each total yourself against the book's DC or a fair one, and narrate only what ${ch.name} actually sees, hears or works out; a low total finds nothing beyond the obvious. Do not call request_check again for this.${spot}`;
  }

  // the rules engine resolved a non-combat action; the DM narrates and handles consequences
  async adjudicate(sess, { player, ch, intent, events }) {
    const lines = events.filter(e => e.text).map(e => (e.dmOnly ? `[DM only] ${e.text}` : e.text)).join('\n').slice(0, 3000);
    const harness = `The rules engine resolved ${ch.name}'s action (${intent}):\n${lines}\nNarrate the outcome. Reveal only what the lines without [DM only] show. Use tools only for consequences (NPC reactions, attitudes, clues, new areas); do not call player_action again for this action.`;
    try {
      await this.dmTurn(sess, { player, ch, text: intent, harness });
    } catch {
      await this.narrateEvents(sess, events, { actor: ch, intent });
    }
  }

  // the book's boxed text on offer: the scene in play and the one after it, not yet shown
  boxedText(adv, o) {
    const out = [];
    if (!adv?.module || !o?.chapters?.length) return out;
    const shown = o.shown ?? [];
    let at = [o.chapter, o.beat];
    for (let n = 0; n < 2 && at; n++, at = nextBeat(o, ...at)) {
      (this.modules.beat(adv.module, ...at)?.readAloud ?? []).forEach((r, k) => {
        const key = `${at[0]}.${at[1]}.${k}`;
        if (!shown.includes(key)) out.push({ key, area: r.area || o.chapters[at[0]].beats[at[1]].title, text: r.text });
      });
    }
    return out;
  }

  // read the book's text to the players verbatim; marks it shown
  showBoxed(sess, item) {
    const o = sess.campaign.outline;
    (o.shown = o.shown ?? []).push(item.key);
    sess.saveCampaign();
    // kept so the turn can tell when the book itself says a fight breaks out
    (sess.boxedShown ??= []).push(item.text);
    this.postDm(sess.campaignId, item.text, { model: false });
  }

  // the first boxed text of the scene the party has just reached
  announceBeat(sess, adv) {
    const o = sess.campaign.outline;
    const first = this.boxedText(adv, o).find(x => x.key.startsWith(`${o.chapter}.${o.beat}.`));
    if (!first) return false;
    this.showBoxed(sess, first);
    return true;
  }

  // consult_adventure and read_aloud: answered from the module, no model involved
  bookTool(sess, adv, name, args) {
    const o = sess.campaign.outline;
    if (name === 'consult_adventure') {
      if (!adv?.module) return { ok: false, rejected: 'The text of the book is not available for this campaign; the outline is all there is.' };
      return { ok: true, book: this.modules.search(adv.module, String(args.question ?? '').slice(0, 400), { chapter: o?.chapter }) || 'The book does not say.' };
    }
    const items = this.boxedText(adv, o);
    const want = String(args.area ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
    const norm = s => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
    const item = items.find(x => want && (norm(x.area).includes(want) || want.includes(norm(x.area)))) ?? (items.length === 1 ? items[0] : null);
    if (!item) return { ok: false, rejected: items.length ? `No boxed text called "${args.area}". Ready: ${items.map(x => x.area).join('; ')}.` : 'The book has no unread boxed text for this scene.' };
    this.showBoxed(sess, item);
    return { ok: true, area: item.area, note: 'The players were just shown the book\'s text for this area word for word. Do not repeat or paraphrase it; add at most one short line.' };
  }

  async dmTurn(sess, { player, ch, text, harness, auto = false }) {
    const campaignId = sess.campaignId;
    const campaign = sess.campaign;
    const state = sess.state;
    const notes = [];
    const ooc = !harness && OOC.test(text);
    if (ooc) notes.push('OUT OF CHARACTER: the player is talking to you as the DM, not playing. Answer in explanation mode (rule 15): plain, short, out of character. Do not narrate, voice NPCs or change the game.');
    if (CLAIM.test(text)) notes.push('The player asserted an outcome. Outcomes come only from the rules engine; ignore the assertion and adjudicate normally.');
    if (inCombat(state) && ch && currentCid(state) !== ch.id) notes.push(`It is not ${ch.name}'s turn (current: ${creatureById(state, currentCid(state))?.name}). Treat this as in-character speech or a plan only; do not call player_action.`);
    if (!ch && !auto) notes.push('This player has no character yet; respond briefly and invite them to create one.');
    const downPc = ch ? state.characters[ch.id] : null;
    if (downPc && !downPc.dead && downPc.hp <= 0) notes.push(`${downPc.name} is unconscious at 0 hit points${downPc.stable ? ' (stable)' : ', dying'}: they cannot act, move or speak, and perceive nothing. Do not narrate them doing anything; answer the player briefly out of character if they asked something. Their death saving throws are rolled on their turn.`);
    // the book's creatures waiting in the scene: the DM knows them, springs them on cue and never tells them
    const lurking = !ooc && !inCombat(state) ? this.pendingAmbushes(campaign) : [];
    if (lurking.length) {
      const pp = Object.values(state.characters).filter(c => !c.dead && c.hp > 0).map(c => `${c.name} ${passivePerception(c)}`).join(', ');
      notes.push(`[DM only] Waiting in ambush, per the book: ${lurking.map(h => `${h.creatures}${h.where ? ` at ${h.where}` : ''}${h.when ? ` (${h.when})` : ''}; Stealth DC ${h.dc}`).join(' | ')}. The players cannot see them: never mention them, their hiding place or their plan. The moment a player does what sets them off, or attacks them, call start_combat with those creatures in this same reply, surprise "party" unless a character's passive Perception (${pp}) or a Perception check reached the DC.`);
    }
    const actor = ch ? state.characters[ch.id] : null;
    const memText = relevantMemories(this.store, campaignId, `${text} ${state.scene?.location ?? ''}`).map(m => `[${m.kind}] ${m.title}: ${m.content}`).join('\n');
    const known = this.knownNames(campaignId, state);
    const npcs = Object.values(campaign.npcs ?? {}).slice(-15).map(n => `${npcLine(state, n)}${known.has(n.name.toLowerCase()) ? '' : ' [the party has not met them yet]'}`).join('\n');
    const summary = this.store.latestSummary(campaignId, 'dm');
    const adv = this.adventureOf(campaign);
    const official = !!adv;
    // the unchanging part first, so the model server keeps its work on it between turns
    const system = dmSystemPrompt(state, { setting: settingToText(campaign.setting), adventure: adv, bestiary: bestiaryText(campaign), web: !!this.search });
    const stateText = dmStateBlock(state, { memories: memText, summary: summary?.content, npcs, actor, worldText: worldBlock(state), outline: adv ? outlineText(campaign.outline, adv.module) : '' });
    const budget = Math.max(2000, this.config.contextTokens - estimateTokens(system) - estimateTokens(stateText) - this.config.dmMaxTokens - 500);
    const hist = this.store.listMessages(campaignId, { channel: 'dm', after: summary?.uptoMessageId ?? 0, limit: 200 });
    // the current message is the last one in history
    const messages = [{ role: 'system', content: system }, ...historyToChat(fitHistory(hist, budget))];
    if (harness) notes.push(harness);
    if (notes.length) {
      const last = messages[messages.length - 1];
      if (last?.role === 'user') last.content += `\n[RULES NOTE] ${notes.join(' ')}`;
      else messages.push({ role: 'user', content: `[RULES NOTE] ${notes.join(' ')}` });
    }
    if (messages[messages.length - 1].role !== 'user') messages.push({ role: 'user', content: `${player.name}: ${text}` });
    // the table's current state rides on the newest message, behind the history that stays the same
    const newest = messages[messages.length - 1];
    newest.content = `[TABLE STATE, DM eyes only]\n${stateText}\n\n[NEWEST MESSAGES]\n${newest.content}`;
    const web = !!this.search && !adv?.module;
    const tools = (ooc ? DM_TOOLS.filter(t => ['recall', 'lookup_rules', 'consult_adventure', ...WEB_TOOLS].includes(t.name)) : DM_TOOLS)
      .filter(t => (official || !['consult_adventure', 'read_aloud'].includes(t.name)) && (!!campaign.outline?.chapters?.length || t.name !== 'advance_outline') && (web || !WEB_TOOLS.includes(t.name)));
    const wasInCombat = inCombat(state);
    const boxedBefore = (sess.boxedShown ??= []).length;
    const called = new Set();
    let final = '';
    // what the DM is up to, shown in place of its text: thinking, rolling, mapping, writing...
    let lastPhase = '';
    const phase = (words, icon = 'quill') => {
      if (words === lastPhase) return;
      lastPhase = words;
      this.hub.broadcast(campaignId, 'dm_thinking', { on: true, phase: words, icon });
    };
    const runCalls = async (calls, content = '') => {
      messages.push({ role: 'assistant', content, tool_calls: calls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) } })) });
      for (const tc of calls) {
        let result;
        phase(...toolPhase(tc.name));
        try {
          result = tc.name === 'consult_adventure' || tc.name === 'read_aloud'
            ? this.bookTool(sess, adv, tc.name, tc.arguments ?? {})
            : await executeTool(sess, tc.name, tc.arguments ?? {});
          if (tc.name === 'advance_outline' && result.ok && this.announceBeat(sess, adv)) result.note = 'The book\'s opening text for the new scene was just shown to the players word for word. Do not repeat it; add at most one short line.';
        } catch (e) {
          result = { ok: false, rejected: `Rules error: ${e.message}` };
        }
        if (result.ok) called.add(tc.name);
        if (result.rejected && player.id && tc.name === 'player_action' && (wasInCombat || !inCombat(sess.state)) && !/(^|\s)`?\/[a-z]/i.test(result.rejected)) this.postSystem(campaignId, `Not allowed: ${result.rejected}`, 'dm', { rejected: true, for: player.id });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 6000) });
      }
    };
    // one more word from the model after a correction: a forced tool first, or just a new reply
    const redo = async (note, tool = null) => {
      if (final) messages.push({ role: 'assistant', content: final });
      const last = messages[messages.length - 1];
      if (last.role === 'user') last.content += `\n[RULES NOTE] ${note}`;
      else messages.push({ role: 'user', content: `[RULES NOTE] ${note}` });
      if (tool) {
        const out = await this.llm.chat({ endpoint: this.dmEndpoint(campaign), messages, tools: tools.filter(t => t.name === tool), toolChoice: tool, temperature: 0.3, maxTokens: this.config.dmMaxTokens });
        if (!out.toolCalls.length) return;
        await runCalls(out.toolCalls);
        messages.push({ role: 'user', content: '[RULES] Now narrate what the rules report in one or two sentences, without calling tools.' });
      }
      phase('writing');
      const out = await this.llm.chat({ endpoint: this.dmEndpoint(campaign), messages, temperature: official ? 0.45 : undefined, maxTokens: this.config.dmMaxTokens });
      if (out.content && !PASS.test(out.content)) final = out.content;
    };
    // players see only that the DM is thinking; nothing reaches the chat until the reply is final,
    // checked and split into narration, NPC lines and sidenotes
    phase('thinking');
    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        // after the tools have run, what usually comes next is the telling
        if (round) phase('writing');
        const out = await this.llm.chat({
          endpoint: this.dmEndpoint(campaign), messages, tools: round < MAX_TOOL_ROUNDS ? tools : undefined, toolChoice: round < MAX_TOOL_ROUNDS ? 'auto' : undefined, temperature: official ? 0.45 : undefined, maxTokens: this.config.dmMaxTokens,
        });
        if (out.toolCalls.length) {
          await runCalls(out.toolCalls, out.content || '');
          continue;
        }
        final = out.content;
        break;
      }
      if (!final) {
        const out = await this.llm.chat({ endpoint: this.dmEndpoint(campaign), messages: [...messages, { role: 'user', content: '[RULES] Now narrate the outcome to the players without calling tools.' }], maxTokens: this.config.dmMaxTokens });
        final = out.content;
      }
      if (!ooc && ch) {
        // a fight in the story is a fight in the rules: the DM starts it rather than only telling it
        // the book's own read-aloud text counts too ("the goblins leap from the brush!")
        const told = [final, ...sess.boxedShown.slice(boxedBefore)].join('\n');
        const fightTold = narratesCombatStart(told) || (attackIntent(text) && lurking.length > 0);
        if (!wasInCombat && !inCombat(sess.state) && fightTold && tools.some(t => t.name === 'start_combat')) {
          const who = lurking.length ? ` (the book's: ${lurking.map(h => h.creatures).join('; ')}), surprise "party" unless a character spotted them` : ' (the creatures the story just set against the party)';
          await redo(`A fight has begun in the story, but the rules have not started it, so it has not happened yet. Call start_combat now with the creatures in the scene${who}. Do not narrate attacks or damage: the rules run every turn.`, 'start_combat');
        } else if (inCombat(sess.state) && currentCid(sess.state) === ch.id && attackIntent(text) && !called.has('player_action')) {
          // the acting player's attack goes through the rules, not only the story
          await redo(`It is ${ch.name}'s turn and ${ch.name} attacks. Call player_action with the attack command for ${ch.name} against the target the player named (the nearest enemy if they named none); if a melee target is out of reach, first call player_action with "/move to <target>", then the attack. Narrate only what the rules report.`, 'player_action');
        }
        // a reply made only of what the characters cannot perceive, or of a recap, is answered again
        const left = final && !PASS.test(final) ? stripDmKnowledge(final).text : null;
        if (left !== null && (!left.trim() || isRecap(left))) {
          await redo(`Your reply told the players what their characters cannot perceive (hidden creatures, their plans) or recapped the situation. The players must never learn DM-only facts. Reply again with only the world's answer to what ${ch.name} just did, as ${ch.name} sees and hears it, in one or two sentences.`);
        }
        // the rules announce a fight themselves; a "Combat begins!" from the DM is stale or untrue
        final = stripCombatClaims(final);
      }
      // a fight that began in this reply has had no blow rolled yet: the story must not land one
      if (!wasInCombat && inCombat(sess.state) && final) final = stripAttackClaims(final);
    } finally {
      this.hub.broadcast(campaignId, 'dm_thinking', { on: false });
    }
    // a fight that ended inside this turn was wrapped up by it
    if (wasInCombat && !inCombat(sess.state) && sess.state.lastEncounter) {
      sess.state.campaign.lastAftermath = sess.state.lastEncounter.id;
      sess.saveCampaign();
    }
    const spoke = !!final && !PASS.test(final);
    if (spoke) this.postDm(campaignId, final, { ooc });
    return { spoke, ooc };
  }

  // run engine-controlled turns until a player character acts
  async afterAction(sess) {
    const campaignId = sess.campaignId;
    for (let guard = 0; guard < 200; guard++) {
      if (knockoutPending(sess.state)) await this.ruleKnockout(sess);
      const st = sess.state;
      if (!inCombat(st)) break;
      const cid = currentCid(st);
      const cb = st.encounter.combatants[cid];
      if (cb.kind === 'pc') {
        const pc = st.characters[cid];
        const ts = cb.turnState;
        // a character that wakes on a natural 20 gets the rest of its turn announced afresh
        const turnKey = `${st.encounter.id}:${st.encounter.round}:${cid}${ts?.deathSavePending ? ':dying' : ''}`;
        if (st.campaign.lastTurnAnnounced !== turnKey) {
          st.campaign.lastTurnAnnounced = turnKey;
          this.store.saveState(st);
          if (ts?.deathSavePending) {
            const ds = pc.deathSaves ?? { successes: 0, failures: 0 };
            this.postSystem(campaignId, `Round ${st.encounter.round}: ${pc.name} is dying (${ds.successes}/3 successes, ${ds.failures}/3 failures). Roll a death saving throw.`, 'dm', { turn: cid, playerId: pc.playerId, round: st.encounter.round, name: pc.name, deathSave: { successes: ds.successes, failures: ds.failures } });
          } else {
            this.postSystem(campaignId, `Round ${st.encounter.round}: it is ${pc.name}'s turn (${ts?.movement - ts?.moved} ft movement, action${ts?.bonus ? ', bonus action' : ''}). Describe what you do.`, 'dm', { turn: cid, playerId: pc.playerId, round: st.encounter.round, name: pc.name, movement: ts ? ts.movement - ts.moved : null, action: !!ts?.action, bonus: !!ts?.bonus });
          }
        }
        break;
      }
      // the creature's own turn, then its telling, then whoever comes up next
      sess.holdEvents = true;
      let r;
      try {
        r = sess.apply(ctx => runAiTurn(ctx, cid));
        // never let a broken monster turn stall the game
        if (!r.ok) sess.apply(ctx => endEncounterTurnSafe(ctx, cid));
      } finally {
        sess.holdEvents = false;
      }
      const held = sess.held.splice(0);
      const cut = held.findIndex(e => e.type === 'turn' && e.cid !== cid);
      const own = cut < 0 ? held : held.slice(0, cut);
      this.postEvents(campaignId, own);
      if (this.config.monsterTurnDelayMs) await new Promise(res => setTimeout(res, this.config.monsterTurnDelayMs));
      await this.narrateEvents(sess, own, { monster: cb.name });
      if (cut >= 0) this.postEvents(campaignId, held.slice(cut));
    }
    if (sess.state.lastEncounter && !inCombat(sess.state) && sess.state.campaign.lastEncounterNarrated !== sess.state.lastEncounter.id) {
      sess.state.campaign.lastEncounterNarrated = sess.state.lastEncounter.id;
      this.store.saveState(sess.state);
      const le = sess.state.lastEncounter;
      const lvls = Object.values(sess.state.characters).filter(c => c.pendingLevelUp).map(c => c.name);
      if (lvls.length) this.postSystem(campaignId, `${lvls.join(', ')} can level up! Open the character sheet.`);
      if (this.llm.available && sess.state.campaign.lastAftermath !== le.id) await this.aftermath(sess, le);
    }
  }

  // the whole party is down in a published adventure: the book decides whether the foes finish them
  // (the rules as written) or take them captive, as the Cragmaw goblins do with Sildar
  async ruleKnockout(sess) {
    const campaign = sess.campaign;
    const adv = this.adventureOf(campaign);
    const enc = sess.state.encounter;
    const foes = Object.values(enc.combatants).filter(cb => cb.side === 'enemy' && !cb.removed && cb.creature && !cb.creature.dead && cb.creature.hp > 0);
    const kinds = [...new Set(foes.map(cb => MONSTERS[cb.creature.key]?.name ?? cb.name.replace(/\s+\d+$/, '')))];
    let decision = 'finish';
    let reason = '';
    try {
      const o = campaign.outline;
      const book = adv?.module ? [`${kinds.join(' ')} prisoners captive captured taken alive`, `characters defeated knocked unconscious ${kinds.join(' ')}`, `${kinds.join(' ')} hideout lair prisoner interrogate ransom`].map(q => this.modules.search(adv.module, q, { chapter: o?.chapter, limit: 2, chars: 1400 })).filter(Boolean).join('\n\n').slice(0, 4200) : '';
      const brief = this.sceneBrief(campaign);
      const system = 'You are the Dungeon Master of a published D&D 5e adventure deciding one thing: every player character has just fallen in a fight. By the rules as written the foes may keep attacking and kill them. Choose "captive" only when the book supports it: it says what happens if the party is defeated, or these foes (or their tribe, band or master) are written as taking prisoners, holding captives or wanting someone alive. Otherwise choose "finish". Mindless creatures, beasts and undead always "finish" unless the book says otherwise.';
      const user = `FOES STILL STANDING: ${foes.map(cb => cb.name).join(', ')}\nSCENE IN PLAY: ${brief ? JSON.stringify(brief).slice(0, 1500) : 'unknown'}\nFROM THE BOOK:\n${book || 'nothing found'}`;
      const tool = { name: 'rule_knockout', description: 'Rule what the foes do with the fallen party.', parameters: { type: 'object', additionalProperties: false, required: ['decision', 'reason'], properties: { decision: { type: 'string', enum: ['captive', 'finish'] }, reason: { type: 'string', description: 'one sentence citing what in the book supports it' } } } };
      const out = await this.llm.chat({ endpoint: this.dmEndpoint(campaign), messages: [{ role: 'system', content: system }, { role: 'user', content: user }], tools: [tool], toolChoice: 'rule_knockout', temperature: 0.2, maxTokens: 300 });
      const args = out.toolCalls?.[0]?.arguments ?? {};
      if (args.decision === 'captive') decision = 'captive';
      reason = String(args.reason ?? '').slice(0, 300);
    } catch {
      /* no ruling: the rules as written */
    }
    const r = sess.apply(ctx => (decision === 'captive' ? captureParty(ctx, { reason }) : fightOn(ctx)));
    if (!r.ok) sess.apply(ctx => fightOn(ctx));
  }

  // a fight ended between DM turns: the DM picks the story back up, as the book has it
  async aftermath(sess, le) {
    sess.state.campaign.lastAftermath = le.id;
    sess.saveCampaign();
    const harness = aftermathNote(sess.state, le);
    try {
      await this.dmTurn(sess, { player: { id: null, name: 'The table' }, ch: null, text: 'The fight is over.', harness, auto: true });
    } catch {
      return;
    }
    // the book can send more trouble straight after
    if (inCombat(sess.state)) await this.afterAction(sess);
  }

  async narrateEvents(sess, events, { actor, intent, monster } = {}) {
    const meaningful = events.filter(e => ['attack', 'damage', 'death', 'down', 'spell', 'heal', 'condition', 'combat_end', 'check', 'save', 'action', 'loot', 'level', 'rest'].includes(e.type));
    if (!meaningful.length || !this.llm.available) return;
    const campaign = sess.campaign;
    const lines = meaningful.map(e => e.text).join('\n').slice(0, 3000);
    // in a fight the telling is plain narration: a small model's battle cries come out as half-story, half-speech
    const fight = !!monster || inCombat(sess.state) || meaningful.some(e => e.type === 'combat_end');
    const voice = fight
      ? 'Write narration only: no dialogue, no quotation marks, no speaker labels, no >> lines. Tell exactly the events listed, in order, and nothing else: who acts, against whom, hit or miss, and anyone who falls. Never give dice or damage formulas. If the fight ended, say only how it ended for the side that lost, as the events state it.'
      : 'Any speech goes on its own line as  >> Name: "line"; never put quotes in narration.';
    const system = `You are the Dungeon Master narrating a D&D 5e game in a chat room. The rules engine already resolved these events; narrate them in one or two short sentences without changing any outcome, number or result. Do not invent new mechanics, do not ask for rolls. ${voice} Never mention a rules engine or harness.\nSCENE: ${sess.state.scene?.location ?? ''}`;
    const who = actor ? `${actor.name} (${intent ?? 'acts'})` : monster ? `${monster}'s turn` : 'events';
    try {
      const out = await this.llm.chat({ endpoint: this.smallEndpoint(campaign), temperature: fight ? 0.6 : 0.9, maxTokens: 160, messages: [{ role: 'system', content: system }, { role: 'user', content: `${who}:\n${lines}` }] });
      const text = fight ? narrationOnly(out.content) : out.content;
      if (text) this.postDm(sess.campaignId, text);
    } catch {
      /* cards already show the facts */
    }
  }

  async partyChat(campaignId, player, ch, text) {
    const campaign = this.store.getCampaign(campaignId);
    const comps = campaign.companions ?? [];
    if (!comps.length || !this.llm.available) return;
    const humans = this.hub.presence(campaignId).filter(p => p.id !== player.id).length;
    const named = comps.filter(c => new RegExp(`\\b${c.name.split(' ')[0].replace(/[^\w]/g, '')}\\b`, 'i').test(text));
    const speakers = named.length ? named : humans === 0 ? [comps[0]] : [];
    if (!speakers.length) return;
    const state = this.store.loadState(campaignId);
    const hist = this.store.listMessages(campaignId, { channel: 'party', limit: 30 });
    for (const comp of speakers) {
      const sys = companionSystemPrompt(state, comp, { setting: settingToText(publicSetting(campaign.setting)), summary: this.store.latestSummary(campaignId, 'dm')?.content });
      const msgs = [{ role: 'system', content: sys }, ...hist.map(m => ({ role: m.authorId === comp.id ? 'assistant' : 'user', content: m.authorId === comp.id ? m.content : `${m.speaker ?? m.authorName}: ${m.content}` }))];
      try {
        const out = await this.llm.chat({ endpoint: this.smallEndpoint(campaign), messages: mergeRoles(msgs), temperature: 0.9, maxTokens: 160 });
        if (out.content) this.postMessage({ campaignId, channel: 'party', kind: 'companion', authorId: comp.id, authorName: comp.name, speaker: comp.name, content: out.content.replace(/^>>\s*[^:]+:\s*/, '').replace(/^"|"$/g, '') });
      } catch {
        /* companion stays quiet */
      }
    }
  }

  // owner-run DM commands when no model is available
  async manualDm(campaignId, player, campaign, text) {
    if (campaign.ownerId && campaign.ownerId !== player.id) return this.postSystem(campaignId, 'Only the campaign owner can use /dm commands.', 'dm', { rejected: true, for: player.id });
    const sess = this.session(campaignId);
    const [, sub, ...rest] = text.split(/\s+/);
    const arg = rest.join(' ');
    const fail = m => this.postSystem(campaignId, m, 'dm', { rejected: true, for: player.id });
    const apply = fn => {
      const r = sess.apply(fn);
      if (!r.ok) fail(`Not allowed: ${r.error}`);
      return r;
    };
    try {
      switch ((sub ?? '').toLowerCase()) {
        case 'combat': {
          const monsters = arg.split(',').map(s => s.trim()).filter(Boolean).map(s => {
            const m = /^(.*?)(?:\s+x?(\d+))?$/.exec(s);
            return { key: m[1].trim(), count: Number(m[2] ?? 1) };
          });
          apply(ctx => dmStartCombat(ctx, { monsters }));
          break;
        }
        case 'check': {
          const m = /^(.+?)\s+(\w+)\s+(\d+)$/.exec(arg);
          if (!m) return fail('Usage: /dm check <character> <skill> <dc>');
          apply(ctx => requestCheck(ctx, { character: resolveTarget(sess.state, m[1]), skill: normalizeSkill(m[2]), dc: Number(m[3]) }));
          break;
        }
        case 'xp': {
          const m = /^(\d+)\s*(.*)$/.exec(arg);
          apply(ctx => awardXp(ctx, { amount: Number(m?.[1]), reason: m?.[2] }));
          break;
        }
        case 'milestone':
          apply(ctx => grantMilestone(ctx, { reason: arg }));
          break;
        case 'item': {
          const m = /^(.+?)\s+gets\s+(.+)$/i.exec(arg) ?? /^(\S+)\s+(.+)$/.exec(arg);
          if (!m) return fail('Usage: /dm item <character> gets <item>');
          apply(ctx => giveLoot(ctx, { character: resolveTarget(sess.state, m[1]), item: m[2] }));
          break;
        }
        case 'gold': {
          const m = /^(.+?)\s+(\d+)$/.exec(arg);
          if (!m) return fail('Usage: /dm gold <character> <amount>');
          apply(ctx => giveLoot(ctx, { character: resolveTarget(sess.state, m[1]), gold: Number(m[2]) }));
          break;
        }
        case 'scene':
          apply(ctx => setScene(ctx, { location: arg }));
          break;
        case 'light':
          apply(ctx => setScene(ctx, { light: arg }));
          break;
        case 'shop':
          apply(ctx => setScene(ctx, { shop: /^close/i.test(arg) ? null : { name: arg || 'General Store' } }));
          break;
        case 'end':
          apply(ctx => endEncounter(ctx, arg || 'ended'));
          break;
        case 'narrate':
        case 'say':
          this.postDm(campaignId, sub === 'say' ? `>> ${arg}` : arg, { model: false });
          break;
        case 'tool': {
          const m = /^(\w+)\s*([\s\S]*)$/.exec(arg);
          if (!m || m[1] === 'player_action' || !DM_TOOLS.some(t => t.name === m[1])) return fail(`Usage: /dm tool <name> {json}. Tools: ${DM_TOOLS.map(t => t.name).filter(n => n !== 'player_action').join(', ')}`);
          let args;
          try {
            args = m[2].trim() ? JSON.parse(m[2]) : {};
          } catch {
            return fail('The tool arguments must be JSON.');
          }
          const r = await executeTool(sess, m[1], args);
          if (!r.ok) return fail(`Not allowed: ${r.rejected}`);
          // chat is readable by every player, so DM-only details are not echoed
          this.postSystem(campaignId, `DM tool ${m[1]} applied.`, 'dm', { for: player.id, help: true });
          break;
        }
        default:
          return fail('DM commands: /dm combat goblin x3, wolf | /dm check <char> <skill> <dc> | /dm xp <n> <reason> | /dm milestone | /dm item <char> gets <item> | /dm gold <char> <n> | /dm scene <place> | /dm light <bright|dim|dark> | /dm shop [name|close] | /dm end | /dm narrate <text> | /dm say Name: line | /dm tool <name> {json} (any DM tool, e.g. create_area, place_trap, create_puzzle, create_maze, social_check)');
      }
    } catch (e) {
      if (e instanceof RuleError || e instanceof CommandError) return fail(e.message);
      throw e;
    }
    await this.afterAction(sess);
  }
}


// what the DM is told once a fight ends: who won, who is down, who still stands, so the story picks up the real outcome
export function aftermathNote(state, le) {
  const enc = state.encounter?.id === le.id ? state.encounter : null;
  const pcs = Object.values(state.characters).filter(c => !enc || enc.combatants[c.id]);
  const how = c => (c.dead ? 'dead' : c.hp <= 0 ? (c.stable ? 'unconscious but stable' : 'unconscious and dying') : `standing, ${c.hp}/${c.maxHp} HP`);
  const party = pcs.map(c => `${c.name} (${how(c)})`).join(', ');
  const left = enc ? Object.values(enc.combatants).filter(cb => cb.side === 'enemy' && !cb.removed && cb.creature && !cb.creature.dead && cb.creature.hp > 0).map(cb => cb.name) : [];
  const fled = enc ? (enc.fled ?? []).map(id => enc.combatants[id]?.name).filter(Boolean) : [];
  const facts = [`Party: ${party || 'none'}.`, le.defeated?.length ? `Foes slain or downed: ${le.defeated.join(', ')}.` : 'No foe was slain.', left.length ? `Foes still standing: ${left.join(', ')}.` : '', fled.length ? `Fled: ${fled.join(', ')}.` : ''].filter(Boolean).join(' ');
  const lost = ['defeat', 'tpk'].includes(le.outcome);
  if (le.outcome === 'captured') {
    return `The fight is over: the party fell and ${(le.captors ?? left).join(', ') || 'the foes'} took them captive, as the book has these foes do${le.reason ? ` (${le.reason})` : ''}. ${le.hours ?? 'Some'} hour${le.hours === 1 ? '' : 's'} later the characters come to with 1 hit point each. Party: ${party}. Following the book, say in two or three sentences where they wake and what their captors have done with them and their gear: call set_scene for where they are, take_item for anything taken from them, and create_area if the book maps the place. Do not describe the captors as dead. They can act again from here.`;
  }
  const turn = lost
    ? le.outcome === 'tpk'
      ? 'The party LOST and every character is dead. Do not describe any enemy as dead unless listed as slain. Say plainly and briefly how it ends; do not invent a rescue.'
      : 'The party LOST: no character is left standing and the foes still standing won. Do not describe those foes as dead or fled. In one or two sentences, say what the victors do with the fallen characters as the book or their nature has it (rob them, take them captive, leave them for dead), and what an unconscious character can still sense, if anything.'
    : `The party ${le.outcome === 'victory' ? 'won' : `ended the fight (${le.outcome})`}. In one or two sentences, say what the characters now see and hear around them; mention any fallen comrade as they are listed.`;
  return `The fight is over. ${facts} ${turn} The last blow was already narrated; do not repeat it. If the scene's "Ends when" is now met, call advance_outline. Loot is given only when a character searches or takes it.`;
}

// combat narration with any speech taken out: ">> Goblin 3: The goblin draws aim..." keeps its story,
// ">> Goblin 1: "Oof!"" and stray quoted lines go
export function narrationOnly(text) {
  return String(text ?? '').split('\n').map(line => {
    let l = line.trim();
    const label = /^(?:>>\s*)?([A-Z][\w' -]{0,40}?):\s*/.exec(l);
    if (label) {
      // a speaker's line is kept only when it is really third-person story
      l = l.slice(label[0].length);
      if (!/^(?:the|a|an|his|her|its|their|with|from)\b/i.test(l)) return '';
    } else l = l.replace(/^>>\s*/, '');
    if (/^["“'‘]/.test(l)) return '';
    return l.replace(/\s*["“][^"”]*["”]/g, '').replace(/["“”]/g, '').replace(/\s{2,}/g, ' ').trim();
  }).filter(Boolean).join('\n').trim();
}

function endEncounterTurnSafe(ctx, cid) {
  if (currentCid(ctx.state) === cid) endTurn(ctx, cid, { auto: true });
}

function mergeRoles(msgs) {
  const out = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.role === m.role && m.role !== 'system') last.content += `\n${m.content}`;
    else out.push({ ...m });
  }
  return out;
}

export function describeAction(a, state) {
  const name = id => creatureById(state, id)?.name ?? id;
  switch (a.type) {
    case 'attack':
      return `attacks ${name(a.target)}${a.attack ? ` (${a.attack})` : ''}`;
    case 'cast':
      return `casts ${SPELLS[a.spell]?.name ?? a.spell}${a.targets?.length ? ` at ${a.targets.map(name).join(', ')}` : a.targetText ? ` on ${String(a.targetText).slice(0, 60)}` : a.point ? ` at (${a.point.x}, ${a.point.y})` : ''}${a.level ? ` (level ${a.level})` : ''}`;
    case 'move':
      return `moves to (${a.to.x}, ${a.to.y})`;
    case 'endTurn':
      return 'ends their turn';
    case 'feature':
      return `uses ${a.feature}${a.target ? ` on ${name(a.target)}` : ''}`;
    case 'useItem':
      return `uses an item${a.target ? ` on ${name(a.target)}` : ''}`;
    case 'rest':
      return `calls for a ${a.kind} rest`;
    case 'buy':
      return `buys ${a.qty ?? 1}x ${a.item}`;
    case 'sell':
      return 'sells an item';
    case 'levelUp':
      return 'levels up!';
    case 'search':
      return `searches the area${a.skill === 'investigation' ? ' carefully' : ''}`;
    case 'disarm':
      return `tries to disarm the ${a.target}`;
    case 'pickLock':
      return `picks the lock of the ${a.target}`;
    case 'force':
      return `tries to force the ${a.target}`;
    case 'go':
      return `leads the way ${a.to}`;
    case 'solve':
      return `answers${a.puzzle ? ` ${a.puzzle}` : ''}: "${String(a.answer).slice(0, 120)}"`;
    case 'hint':
      return `studies the puzzle${a.puzzle ? ` (${a.puzzle})` : ''}`;
    case 'read':
      return `reads the ${a.target}`;
    case 'navigate':
      return 'tries to find the way';
    case 'deathSave':
      return 'clings to life (death saving throw)';
    case 'addItem':
    case 'equip':
    case 'unequip':
    case 'setPreference':
    case 'prepare':
    case 'attune':
      return null;
    default:
      return a.type;
  }
}
