import { openDb, adoptLegacyDb, backupDb } from './db.js';
import { uid } from './engine/util.js';

const j = s => (s ? JSON.parse(s) : null);

// FTS5 query from free text: quoted terms OR'd together
export function ftsQuery(text) {
  const words = String(text ?? '').toLowerCase().match(/[a-z0-9']{3,}/g) ?? [];
  const stop = new Set(['the', 'and', 'you', 'your', 'with', 'that', 'this', 'for', 'are', 'was', 'what', 'have', 'from', 'into', 'they', 'them', 'there', 'then', 'will', 'can', 'not', 'but', 'his', 'her', 'its']);
  const uniq = [...new Set(words.filter(w => !stop.has(w)).map(w => w.replace(/'/g, '')))].slice(0, 12);
  return uniq.length ? uniq.map(w => `"${w}"`).join(' OR ') : null;
}

export class Store {
  constructor(file = ':memory:') {
    if (file !== ':memory:') adoptLegacyDb(file);
    this.file = file;
    this.db = openDb(file);
    this.locks = new Map();
  }

  // a backup whenever a different tavern version opens this database
  backupOnVersionChange(version) {
    const prev = this.getSetting('version');
    if (prev === version) return null;
    const has = this.db.prepare('SELECT count(*) AS n FROM campaigns').get().n > 0;
    const out = has ? backupDb(this.db, this.file, prev ?? 'unknown') : null;
    this.setSetting('version', version);
    return out;
  }

  close() {
    this.db.close();
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // serialize async work per campaign
  async withLock(key, fn) {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release;
    const next = new Promise(r => (release = r));
    const chained = prev.then(() => next);
    this.locks.set(key, chained);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }

  // tavern-wide settings (the chosen agent)
  getSetting(key) {
    return j(this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value);
  }

  setSetting(key, value) {
    this.db.prepare('INSERT INTO settings (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated').run(key, JSON.stringify(value), Date.now());
  }

  // players
  upsertPlayer({ id, name }) {
    const now = Date.now();
    const clean = String(name ?? '').trim().slice(0, 32);
    if (!clean) throw new Error('name required');
    const pid = id ?? uid('pl_');
    const existing = this.db.prepare('SELECT id FROM players WHERE id = ?').get(pid);
    if (existing) this.db.prepare('UPDATE players SET name = ?, last_seen = ? WHERE id = ?').run(clean, now, pid);
    else this.db.prepare('INSERT INTO players (id, name, created, last_seen) VALUES (?, ?, ?, ?)').run(pid, clean, now, now);
    return this.getPlayer(pid);
  }

  findPlayerByName(name) {
    const clean = String(name ?? '').trim().slice(0, 32);
    return this.db.prepare('SELECT id, name, created, last_seen AS lastSeen FROM players WHERE lower(name) = lower(?) ORDER BY last_seen DESC LIMIT 1').get(clean) ?? null;
  }

  getPlayer(id) {
    return this.db.prepare('SELECT id, name, created, last_seen AS lastSeen FROM players WHERE id = ?').get(id) ?? null;
  }

  touchPlayer(id) {
    this.db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(Date.now(), id);
  }

  // campaigns
  createCampaign({ name, ownerId, data }) {
    const id = uid('cp_');
    const now = Date.now();
    this.db.prepare('INSERT INTO campaigns (id, name, status, owner_id, created, updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, name, 'active', ownerId ?? null, now, now, JSON.stringify(data));
    return this.getCampaign(id);
  }

  getCampaign(id) {
    const r = this.db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    if (!r) return null;
    return { id: r.id, name: r.name, status: r.status, ownerId: r.owner_id, created: r.created, updated: r.updated, ...j(r.data) };
  }

  listCampaigns({ status } = {}) {
    const rows = status ? this.db.prepare('SELECT * FROM campaigns WHERE status = ? ORDER BY updated DESC').all(status) : this.db.prepare('SELECT * FROM campaigns ORDER BY updated DESC').all();
    return rows.map(r => {
      try {
        return { id: r.id, name: r.name, status: r.status, ownerId: r.owner_id, created: r.created, updated: r.updated, ...j(r.data) };
      } catch {
        // unreadable data still lists, so the campaign is never silently gone
        return { id: r.id, name: r.name, status: r.status, ownerId: r.owner_id, created: r.created, updated: r.updated, damaged: true };
      }
    });
  }

  saveCampaign(c) {
    const { id, name, status, ownerId, created, updated, ...data } = c;
    void created;
    void updated;
    this.db.prepare('UPDATE campaigns SET name = ?, status = ?, owner_id = ?, updated = ?, data = ? WHERE id = ?').run(name, status ?? 'active', ownerId ?? null, Date.now(), JSON.stringify(data), id);
  }

  setCampaignStatus(id, status) {
    this.db.prepare('UPDATE campaigns SET status = ?, updated = ? WHERE id = ?').run(status, Date.now(), id);
  }

  deleteCampaign(id) {
    this.tx(() => {
      this.db.prepare('DELETE FROM characters WHERE campaign_id = ?').run(id);
      this.db.prepare('DELETE FROM memories WHERE campaign_id = ?').run(id);
      this.db.prepare('DELETE FROM summaries WHERE campaign_id = ?').run(id);
      this.db.prepare('DELETE FROM messages WHERE campaign_id = ?').run(id);
      this.db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
    });
  }

  // characters
  saveCharacter(ch) {
    const now = Date.now();
    const exists = this.db.prepare('SELECT id FROM characters WHERE id = ?').get(ch.id);
    if (exists) this.db.prepare('UPDATE characters SET campaign_id = ?, player_id = ?, data = ?, updated = ? WHERE id = ?').run(ch.campaignId, ch.playerId ?? null, JSON.stringify(ch), now, ch.id);
    else this.db.prepare('INSERT INTO characters (id, campaign_id, player_id, data, updated) VALUES (?, ?, ?, ?, ?)').run(ch.id, ch.campaignId, ch.playerId ?? null, JSON.stringify(ch), now);
    return ch;
  }

  getCharacter(id) {
    const r = this.db.prepare('SELECT data FROM characters WHERE id = ?').get(id);
    return r ? j(r.data) : null;
  }

  listCharacters(campaignId) {
    return this.db.prepare('SELECT data FROM characters WHERE campaign_id = ? ORDER BY rowid').all(campaignId).map(r => j(r.data));
  }

  deleteCharacter(id) {
    this.db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  }

  // game state assembled from campaign + characters
  loadState(campaignId) {
    const c = this.getCampaign(campaignId);
    if (!c) return null;
    const characters = {};
    for (const ch of this.listCharacters(campaignId)) if (!ch.retired) characters[ch.id] = ch;
    return { campaign: c, characters, encounter: c.encounter ?? null, clock: c.clock ?? { minute: 8 * 60 }, scene: c.scene ?? { light: 'bright' }, npcs: c.npcs ?? {}, world: c.world ?? null, lastEncounter: c.lastEncounter ?? null };
  }

  saveState(state) {
    this.tx(() => {
      const c = { ...state.campaign, encounter: state.encounter, clock: state.clock, scene: state.scene, npcs: state.campaign.npcs ?? state.npcs, world: state.world ?? state.campaign.world ?? null, lastEncounter: state.lastEncounter ?? null };
      this.saveCampaign(c);
      for (const ch of Object.values(state.characters)) this.saveCharacter(ch);
    });
  }

  // messages
  addMessage({ campaignId, channel = 'dm', kind, authorId = null, authorName = null, speaker = null, content, data = null }) {
    const now = Date.now();
    const info = this.db.prepare('INSERT INTO messages (campaign_id, channel, kind, author_id, author_name, speaker, content, data, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(campaignId, channel, kind, authorId, authorName, speaker, String(content), data ? JSON.stringify(data) : null, now);
    this.db.prepare('UPDATE campaigns SET updated = ? WHERE id = ?').run(now, campaignId);
    return { id: Number(info.lastInsertRowid), campaignId, channel, kind, authorId, authorName, speaker, content: String(content), data, created: now };
  }

  listMessages(campaignId, { channel, before, after, limit = 100 } = {}) {
    const conds = ['campaign_id = ?'];
    const args = [campaignId];
    if (channel) {
      conds.push('channel = ?');
      args.push(channel);
    }
    if (before) {
      conds.push('id < ?');
      args.push(before);
    }
    if (after) {
      conds.push('id > ?');
      args.push(after);
    }
    const rows = this.db.prepare(`SELECT * FROM messages WHERE ${conds.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(500, limit));
    return rows.reverse().map(r => ({ id: r.id, campaignId: r.campaign_id, channel: r.channel, kind: r.kind, authorId: r.author_id, authorName: r.author_name, speaker: r.speaker, content: r.content, data: j(r.data), created: r.created }));
  }

  countMessages(campaignId, channel) {
    return this.db.prepare('SELECT count(*) AS n FROM messages WHERE campaign_id = ? AND channel = ?').get(campaignId, channel).n;
  }

  searchMessages(campaignId, text, { limit = 6, beforeId } = {}) {
    const q = ftsQuery(text);
    if (!q) return [];
    const rows = this.db.prepare(`SELECT m.* FROM messages_fts f JOIN messages m ON m.id = f.rowid WHERE messages_fts MATCH ? AND m.campaign_id = ? ${beforeId ? 'AND m.id < ?' : ''} AND m.kind IN ('player','dm','npc','companion') ORDER BY rank LIMIT ?`).all(q, campaignId, ...(beforeId ? [beforeId] : []), limit);
    return rows.map(r => ({ id: r.id, channel: r.channel, kind: r.kind, speaker: r.speaker, authorName: r.author_name, content: r.content, created: r.created }));
  }

  // memories
  addMemory({ campaignId, kind = 'fact', title, content, tags = '', importance = 2, source = 'dm' }) {
    const now = Date.now();
    const existing = this.db.prepare('SELECT id FROM memories WHERE campaign_id = ? AND kind = ? AND lower(title) = lower(?)').get(campaignId, kind, title);
    if (existing) {
      this.db.prepare('UPDATE memories SET content = ?, tags = ?, importance = ?, updated = ? WHERE id = ?').run(content, tags, importance, now, existing.id);
      return this.getMemory(existing.id);
    }
    const info = this.db.prepare('INSERT INTO memories (campaign_id, kind, title, content, tags, importance, source, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(campaignId, kind, title, content, tags, importance, source, now, now);
    return this.getMemory(Number(info.lastInsertRowid));
  }

  getMemory(id) {
    const r = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
    return r ? { id: r.id, campaignId: r.campaign_id, kind: r.kind, title: r.title, content: r.content, tags: r.tags, importance: r.importance, source: r.source, created: r.created, updated: r.updated } : null;
  }

  listMemories(campaignId, { kind } = {}) {
    const rows = kind ? this.db.prepare('SELECT id FROM memories WHERE campaign_id = ? AND kind = ? ORDER BY importance DESC, updated DESC').all(campaignId, kind) : this.db.prepare('SELECT id FROM memories WHERE campaign_id = ? ORDER BY importance DESC, updated DESC').all(campaignId);
    return rows.map(r => this.getMemory(r.id));
  }

  // DM-private notes, undiscovered setting rumors and people, places and
  // factions the party has not come across never go to players
  static isPublic(m) {
    return !/(^|,)\s*(dm-secret|unrevealed)\s*(,|$)/.test(m?.tags ?? '') && !/^\[rumor\]/.test(m?.content ?? '');
  }

  // public once the party knows its subject (Game.knownNames)
  static isUnrevealed(m) {
    return /(^|,)\s*unrevealed\s*(,|$)/.test(m?.tags ?? '') && !/(^|,)\s*dm-secret\s*(,|$)/.test(m?.tags ?? '');
  }

  // everyone who has spoken as an NPC in the story
  npcSpeakers(campaignId) {
    return this.db.prepare("SELECT DISTINCT speaker FROM messages WHERE campaign_id = ? AND kind = 'npc' AND speaker IS NOT NULL").all(campaignId).map(r => r.speaker);
  }

  searchMemories(campaignId, text, { limit = 8 } = {}) {
    const q = ftsQuery(text);
    if (!q) return [];
    return this.db.prepare('SELECT m.id FROM memories_fts f JOIN memories m ON m.id = f.rowid WHERE memories_fts MATCH ? AND m.campaign_id = ? ORDER BY rank LIMIT ?').all(q, campaignId, limit).map(r => this.getMemory(r.id));
  }

  deleteMemory(id) {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  // summaries
  addSummary({ campaignId, channel, uptoMessageId, content }) {
    this.db.prepare('INSERT INTO summaries (campaign_id, channel, upto_message_id, content, created) VALUES (?, ?, ?, ?, ?)').run(campaignId, channel, uptoMessageId, content, Date.now());
  }

  latestSummary(campaignId, channel) {
    const r = this.db.prepare('SELECT * FROM summaries WHERE campaign_id = ? AND channel = ? ORDER BY id DESC LIMIT 1').get(campaignId, channel);
    return r ? { uptoMessageId: r.upto_message_id, content: r.content, created: r.created } : null;
  }

  // ability roll tokens
  saveRollToken(playerId, scores) {
    const token = uid('rt_');
    this.db.prepare('INSERT INTO roll_tokens (token, player_id, scores, created) VALUES (?, ?, ?, ?)').run(token, playerId ?? null, JSON.stringify(scores), Date.now());
    return token;
  }

  getRollToken(token) {
    const r = this.db.prepare('SELECT * FROM roll_tokens WHERE token = ?').get(token);
    return r ? { token: r.token, playerId: r.player_id, scores: j(r.scores), used: !!r.used } : null;
  }

  useRollToken(token) {
    this.db.prepare('UPDATE roll_tokens SET used = 1 WHERE token = ?').run(token);
  }
}
