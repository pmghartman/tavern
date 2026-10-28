// an update of this checkout from upstream, pressed from the page:
// scripts/update.sh run outside tavern's own process and, under systemd, in a
// transient unit of its own, since the restart it ends in would otherwise
// kill it along with tavern. Its progress is read back from files in data/,
// so the server that comes up after the restart still reports how it went
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION, diskVersion } from './version.js';

// an update still "running" past this is taken as lost
const STALE_MS = 30 * 60 * 1000;
const LOG_TAIL = 6000;

const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

export class Updater {
  constructor({ root, dataDir }) {
    this.root = root;
    this.dir = join(dataDir, 'update');
  }

  file(name) {
    return join(this.dir, name);
  }

  read(name) {
    try {
      return readFileSync(this.file(name), 'utf8');
    } catch {
      return null;
    }
  }

  get canUpdate() {
    return existsSync(join(this.root, '.git')) && existsSync(join(this.root, 'scripts', 'update.sh'));
  }

  // where the last or current update stands, and whether this checkout can be updated at all
  status() {
    const out = { version: VERSION, canUpdate: this.canUpdate, state: 'idle', log: '' };
    if (!out.canUpdate) out.why = 'not a git checkout with scripts/update.sh';
    const started = this.read('started');
    if (!started) return out;
    let meta = {};
    try {
      meta = JSON.parse(started);
    } catch {
      /* an older marker */
    }
    out.startedAt = meta.at ?? null;
    out.from = meta.from ?? null;
    const log = this.read('log') ?? '';
    out.log = log.length > LOG_TAIL ? log.slice(-LOG_TAIL).replace(/^[^\n]*\n/, '') : log;
    const exit = this.read('exit');
    if (exit !== null) {
      const code = Number(exit.trim());
      out.state = code === 0 ? 'ok' : 'failed';
      out.code = code;
      try {
        out.finishedAt = statSync(this.file('exit')).mtimeMs;
      } catch {
        /* just removed */
      }
      // the checkout's version now; different from the running one when nothing restarted tavern
      out.to = diskVersion();
      out.restartNeeded = out.state === 'ok' && out.to !== VERSION;
      return out;
    }
    if (Date.now() - (meta.at ?? 0) > STALE_MS) {
      out.state = 'failed';
      out.error = 'the update never finished';
      return out;
    }
    out.state = 'running';
    return out;
  }

  // the update started, or the one already running; throws when it can't start
  start({ force = false } = {}) {
    if (!this.canUpdate) throw new Error('This tavern is not a git checkout with scripts/update.sh; update it by hand.');
    const cur = this.status();
    if (cur.state === 'running') return cur;
    mkdirSync(this.dir, { recursive: true });
    rmSync(this.file('exit'), { force: true });
    writeFileSync(this.file('log'), '');
    writeFileSync(this.file('started'), JSON.stringify({ at: Date.now(), from: VERSION, force }));
    const script = join(this.root, 'scripts', 'update.sh');
    const sh = `exec >>${q(this.file('log'))} 2>&1; bash ${q(script)}${force ? ' --force' : ''}; echo $? > ${q(this.file('exit'))}`;
    if (!this.viaSystemd(sh)) {
      const child = spawn('bash', ['-c', sh], { cwd: this.root, detached: true, stdio: 'ignore' });
      child.on('error', e => this.fail(`couldn't start the update: ${e.message}`));
      child.unref();
    }
    return this.status();
  }

  // inside a systemd unit (INVOCATION_ID is systemd's), the update runs as a
  // transient unit, so restarting tavern's unit doesn't take it down
  viaSystemd(sh) {
    if (process.platform !== 'linux' || !process.env.INVOCATION_ID) return false;
    const env = ['PATH', 'TAVERN_UNIT', 'TAVERN_UPDATE_URL'].filter(k => process.env[k] !== undefined).map(k => `--setenv=${k}=${process.env[k]}`);
    const r = spawnSync('systemd-run', ['--user', '--collect', '--quiet', `--unit=tavern-update-${Date.now()}`, `--working-directory=${this.root}`, ...env, 'bash', '-c', sh], { stdio: 'ignore', timeout: 15000 });
    return r.status === 0;
  }

  fail(error) {
    writeFileSync(this.file('log'), `${this.read('log') ?? ''}[update] ERROR: ${error}\n`);
    writeFileSync(this.file('exit'), '1\n');
  }
}
