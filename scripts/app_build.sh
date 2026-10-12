#!/bin/bash
# update this checkout, then build the Tavern desktop app with tauri
#   scripts/app_build.sh                   pull main from upstream (scripts/update.sh), install
#                                          dependencies, build the app and its installers
#   scripts/app_build.sh --no-update       build this checkout as it is
#   scripts/app_build.sh --force           pass --force to the update (discards local changes)
#   scripts/app_build.sh -- <args>         extra args for `tauri build`, e.g. -- --bundles dmg
# TAVERN_APP_URL sets the server the app offers on first launch
# (default http://localhost:8484/); the app remembers what the user picks
set -uo pipefail

# all inside main(), called on the last line, since the update can rewrite
# this file mid-run
main() {
  local dir; dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$dir"

  say() { echo "[app_build] $*"; }
  fail() { echo "[app_build] ERROR: $*" >&2; exit 1; }

  local update=1 upd=() tauri=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-update) update=0 ;;
      --force) upd+=(--force) ;;
      --) shift; tauri=("$@"); break ;;
      -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) fail "unknown option $1" ;;
    esac
    shift
  done

  # --- step 1: update -----------------------------------------------------------

  if [ "$update" = 1 ]; then
    say "updating from upstream"
    bash "$dir/scripts/update.sh" ${upd[@]+"${upd[@]}"} || fail "update failed, nothing built"
    # the update may have brought a new copy of this script: build with that
    local again=(--no-update)
    [ ${#tauri[@]} -gt 0 ] && again+=(-- "${tauri[@]}")
    exec bash "$dir/scripts/app_build.sh" "${again[@]}"
  fi

  # --- step 2: toolchain and dependencies ----------------------------------------

  [ -x "$HOME/.local/node/bin/node" ] && export PATH="$HOME/.local/node/bin:$PATH"
  [ -d "$HOME/.cargo/bin" ] && export PATH="$HOME/.cargo/bin:$PATH"
  command -v node >/dev/null || fail "node not found; install Node 20+"
  command -v cargo >/dev/null || fail "cargo not found; install Rust from https://rustup.rs"

  # all dependencies, the tauri CLI included (the server's rebuild leaves out dev ones)
  say "installing dependencies"
  npm ci --no-audit --no-fund || fail "npm ci failed"

  # --- step 3: build -------------------------------------------------------------

  local version; version="$(tr -d '[:space:]' < VERSION 2>/dev/null || echo 0.0).$(git rev-list --count HEAD 2>/dev/null || echo 0)"
  local server="${TAVERN_APP_URL:-http://localhost:8484/}"
  printf 'window.TAVERN_DEFAULT_SERVER = %s;\n' "$(node -p 'JSON.stringify(process.argv[1])' "$server")" > app/config.js

  say "building Tavern $version (default server $server)"
  npx tauri build --config "{\"version\":\"$version\"}" ${tauri[@]+"${tauri[@]}"} || fail "tauri build failed"

  say "done; bundles are in src-tauri/target/release/bundle/"
  find src-tauri/target/release/bundle -maxdepth 2 -mindepth 2 \( -name "*.app" -o -name "*.dmg" -o -name "*.deb" -o -name "*.rpm" -o -name "*.AppImage" -o -name "*.msi" -o -name "*.exe" \) 2>/dev/null | sed 's/^/  /'
}

main "$@"
exit
