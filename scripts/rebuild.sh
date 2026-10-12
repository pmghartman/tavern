#!/bin/bash
# check node, install runtime dependencies, then restart the tavern service
# onto this checkout and wait until it answers with the new version
#   scripts/rebuild.sh            restart only when the running version differs
#   scripts/rebuild.sh --force    restart regardless
set -uo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF="$dir/scripts/rebuild.sh"
# run with sudo (or as root): enable lingering for the checkout's owner so
# tavern outlives their logins, then carry on as that owner, whose git
# checkout, ~/.local/node and systemd user service these are
if [ "$(id -u)" = 0 ]; then
  owner="$(stat -c %U "$dir")"
  if [ "$owner" != root ]; then
    uid="$(id -u "$owner")"
    loginctl enable-linger "$owner" 2>/dev/null
    for i in 1 2 3 4 5; do [ -S "/run/user/$uid/bus" ] && break; sleep 1; done
    exec sudo -u "$owner" -H env XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$uid/bus" PATH="$PATH" bash "$SELF" "$@"
  fi
fi
cd "$dir"

say() { echo "[rebuild] $*"; }
fail() { echo "[rebuild] ERROR: $*" >&2; exit 1; }

force=0
for a in "$@"; do
  case "$a" in
    --force) force=1 ;;
    -h|--help) sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "unknown option $a" ;;
  esac
done

UNIT="${TAVERN_UNIT:-tavern}"

# node 20+, from PATH or the per-user install in ~/.local/node
[ -x "$HOME/.local/node/bin/node" ] && export PATH="$HOME/.local/node/bin:$PATH"
command -v node >/dev/null || fail "node not found; install Node 20+ (e.g. into ~/.local/node)"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || fail "node $(node -v) is too old; tavern needs 20+"

version="$(tr -d '[:space:]' < VERSION 2>/dev/null || echo 0.0).$(git rev-list --count HEAD 2>/dev/null || echo 0)"
say "building $version with node $(node -v)"

# better-sqlite3 is a native module: npm fetches a prebuilt binary for this
# node, or compiles one (needs python3, make and a C++ compiler). http logging
# and foreground scripts so a slow download or compile shows its progress
say "installing runtime dependencies"
npm ci --omit=dev --no-audit --no-fund --loglevel=http --foreground-scripts || fail "npm ci failed"
say "dependencies installed"

# the systemd user unit, generated from deploy/tavern.service for this checkout
# and this node, and rewritten whenever either changes
if ! systemctl --user show-environment >/dev/null 2>&1; then
  say "no systemd user session here; start tavern with: npm start"
  exit 0
fi
unit_file="$HOME/.config/systemd/user/$UNIT.service"
want="$(sed -e "s|@DIR@|$dir|g" -e "s|@NODE@|$(command -v node)|g" deploy/tavern.service)"
if [ "$(cat "$unit_file" 2>/dev/null)" != "$want" ]; then
  say "installing $unit_file"
  mkdir -p "$(dirname "$unit_file")"
  printf '%s\n' "$want" > "$unit_file" || fail "couldn't write $unit_file"
  systemctl --user daemon-reload || fail "systemctl --user daemon-reload failed"
  systemctl --user enable --quiet "$UNIT" || fail "systemctl --user enable $UNIT failed"
  force=1
fi
if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" = "no" ]; then
  say "note: $UNIT stops when you log out; keep it running with: sudo scripts/rebuild.sh (or sudo loginctl enable-linger $(id -un))"
fi

# the port, from .env as the unit loads it, for the health check
port="$(sed -n 's/^[[:space:]]*TAVERN_PORT[[:space:]]*=[[:space:]]*["'\'']\{0,1\}\([0-9]*\).*/\1/p' .env 2>/dev/null | tail -n1)"
port="${port:-8484}"
health() { curl -s -m 3 "http://127.0.0.1:$port/api/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).version??"")}catch{}})'; }

running="$(health)"
if [ "$force" = 0 ] && [ "$running" = "$version" ] && systemctl --user is-active --quiet "$UNIT"; then
  say "$UNIT already runs $version, nothing to restart"
  exit 0
fi

say "restarting $UNIT${running:+ ($running -> $version)}"
systemctl --user restart "$UNIT" || fail "systemctl --user restart $UNIT failed"
for i in $(seq 1 30); do
  sleep 1
  if [ "$(health)" = "$version" ]; then
    say "$UNIT is up on port $port at $version"
    exit 0
  fi
  [ $((i % 5)) = 0 ] && say "waiting for $UNIT on port $port (${i}s)"
done
journalctl --user -u "$UNIT" --no-pager -n 20 >&2
fail "$UNIT did not come back at $version within 30s"
