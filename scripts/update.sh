#!/bin/bash
# pull main from upstream, then rebuild with scripts/rebuild.sh, the git repo as the
# distribution mechanism, as phos updates itself
#   sudo scripts/update.sh       the same, keeping tavern running after logout
#   scripts/update.sh            update from upstream, then rebuild (restarts only
#                                when the running version differs)
#   scripts/update.sh --force    restart even when up to date, and discard
#                                local changes or commits
set -uo pipefail

# all inside main(), called on the last line, since `git reset` rewrites
# this file mid-run
main() {
  local dir; dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  local SELF="$dir/scripts/update.sh" owner uid i
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

  say() { echo "[update] $*"; }
  fail() { echo "[update] ERROR: $*" >&2; exit 1; }

  local force=0 pass=()
  for a in "$@"; do
    case "$a" in
      --force) force=1; pass+=(--force) ;;
      -h|--help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) fail "unknown option $a" ;;
    esac
  done

  [ -d .git ] || fail "not a git checkout: $dir"

  # GitHub is the source of updates, as the "origin" remote
  local url="${TAVERN_UPDATE_URL:-https://github.com/pmghartman/tavern.git}"
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$url"
  else
    git remote add origin "$url"
  fi
  # checkouts updated before this kept it as a second remote called "upstream"
  git remote remove upstream 2>/dev/null

  # --- step 1: the fetch gate, nothing touched until it passes ---------------

  # git asks for the username and password on the terminal (or a credential
  # helper answers); nothing is stored. No terminal: fail instead of hanging
  local prompt=0
  [ -t 0 ] && prompt=1
  [ "$prompt" = 1 ] || export GIT_TERMINAL_PROMPT=0

  say "fetching $url..."
  local tries=0 err
  until err="$(git fetch --quiet origin main 2>&1)"; do
    # a refused login will not fix itself by waiting
    if grep -qiE "could not read Username|Authentication failed|returned error: 40[13]|terminal prompts disabled" <<<"$err"; then
      [ "$prompt" = 1 ] && fail "upstream refused the login, nothing changed"
      fail "upstream needs a login: run this from a terminal, or set up a git credential helper; nothing changed"
    fi
    tries=$((tries + 1))
    [ "$tries" -lt 24 ] || fail "couldn't reach upstream ($(tail -n1 <<<"$err")), nothing changed"
    say "upstream unreachable, retrying in 5s"
    sleep 5
  done

  local here there
  here="$(git rev-parse HEAD)"
  there="$(git rev-parse origin/main)"

  # this checkout may also be where tavern is developed: never throw away
  # uncommitted work or unpushed commits without --force
  if [ "$force" = 0 ]; then
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
      fail "local changes to tracked files; commit or stash them, or pass --force to discard them"
    fi
    if [ -n "$(git rev-list origin/main..HEAD)" ]; then
      fail "$(git rev-list --count origin/main..HEAD) local commit(s) not on origin/main; push them, or pass --force to drop them"
    fi
  fi

  if [ "$here" = "$there" ] && [ "$force" = 0 ]; then
    say "already up to date at $(cat VERSION 2>/dev/null | tr -d '[:space:]').$(git rev-list --count HEAD)"
  else
    # .env and data/ are untracked, so the reset leaves settings and campaigns alone
    git reset --hard --quiet origin/main || fail "couldn't reset to origin/main, nothing changed"
    local version; version="$(tr -d '[:space:]' < VERSION).$(git rev-list --count HEAD)"
    say "now at $version ($(git log -1 --format='%h %s' | cut -c1-72))"
  fi

  # --- step 2: rebuild and restart -------------------------------------------

  # always rebuild, with main's copy of rebuild.sh post-reset; it restarts only
  # when the running version differs (or with --force)
  say "rebuilding"
  bash "$dir/scripts/rebuild.sh" ${pass[@]+"${pass[@]}"} || fail "rebuild failed, the service still runs the previous version"
}

main "$@"
exit
