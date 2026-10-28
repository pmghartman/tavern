import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// VERSION's <major>.<minor>, then the commit count, as phos stamps its own
function readVersion() {
  let base = '0.0';
  try {
    base = readFileSync(resolve(ROOT, 'VERSION'), 'utf8').trim() || base;
  } catch {
    // no VERSION file: an unversioned checkout
  }
  let count = '0';
  try {
    count = execFileSync('git', ['-C', ROOT, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || count;
  } catch {
    // not a git checkout, or git missing
  }
  return `${base}.${count}`;
}

export const VERSION = readVersion();

// the checkout as it stands now, which differs from VERSION after an update
// that didn't restart tavern
export const diskVersion = () => readVersion();
