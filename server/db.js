import Database from 'better-sqlite3';
import { mkdirSync, existsSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

const MIGRATIONS = [
  `CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL, last_seen INTEGER NOT NULL);
   CREATE TABLE campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', owner_id TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL, data TEXT NOT NULL);
   CREATE TABLE characters (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, player_id TEXT, data TEXT NOT NULL, updated INTEGER NOT NULL);
   CREATE INDEX characters_campaign ON characters(campaign_id);
   CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL, channel TEXT NOT NULL, kind TEXT NOT NULL, author_id TEXT, author_name TEXT, speaker TEXT, content TEXT NOT NULL, data TEXT, created INTEGER NOT NULL);
   CREATE INDEX messages_campaign ON messages(campaign_id, channel, id);
   CREATE VIRTUAL TABLE messages_fts USING fts5(content, speaker, content='messages', content_rowid='id');
   CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, content, speaker) VALUES (new.id, new.content, coalesce(new.speaker, '')); END;
   CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '', importance INTEGER NOT NULL DEFAULT 2, source TEXT NOT NULL DEFAULT 'dm', created INTEGER NOT NULL, updated INTEGER NOT NULL);
   CREATE INDEX memories_campaign ON memories(campaign_id, kind);
   CREATE VIRTUAL TABLE memories_fts USING fts5(title, content, tags, content='memories', content_rowid='id');
   CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(rowid, title, content, tags) VALUES (new.id, new.title, new.content, new.tags); END;
   CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES ('delete', old.id, old.title, old.content, old.tags); END;
   CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES ('delete', old.id, old.title, old.content, old.tags); INSERT INTO memories_fts(rowid, title, content, tags) VALUES (new.id, new.title, new.content, new.tags); END;
   CREATE TABLE summaries (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id TEXT NOT NULL, channel TEXT NOT NULL, upto_message_id INTEGER NOT NULL, content TEXT NOT NULL, created INTEGER NOT NULL);
   CREATE INDEX summaries_campaign ON summaries(campaign_id, channel, id);
   CREATE TABLE roll_tokens (token TEXT PRIMARY KEY, player_id TEXT, scores TEXT NOT NULL, created INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);`,
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL);`,
];

const KEEP_BACKUPS = 10;

// the pre-rename database, data/rpg.db, taken over as tavern.db
export function adoptLegacyDb(file) {
  const legacy = join(dirname(file), 'rpg.db');
  if (existsSync(file) || !existsSync(legacy)) return false;
  for (const ext of ['', '-wal', '-shm']) if (existsSync(legacy + ext)) renameSync(legacy + ext, file + ext);
  return true;
}

// consistent copy into <dir>/backups, oldest pruned past KEEP_BACKUPS
export function backupDb(db, file, label) {
  if (file === ':memory:') return null;
  const dir = join(dirname(file), 'backups');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = join(dir, `${basename(file, '.db')}-${String(label).replace(/[^\w.-]/g, '_')}-${stamp}.db`);
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  const old = readdirSync(dir).filter(f => f.endsWith('.db')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) unlinkSync(join(dir, f));
  return out;
}

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get();
  let v = row?.v ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  // an existing database is copied before any migration touches it
  if (v > 0 && v < MIGRATIONS.length) backupDb(db, file, `schema${v}`);
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      v += 1;
      db.prepare('UPDATE schema_version SET v = ?').run(v);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}
