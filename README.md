# Tavern

D&D 5e (SRD 5.1) in a chat room. An AI dungeon master runs on your phosphorus mesh; a strict rules engine decides every outcome.

## Features

- Campaign lobby, AI-written settings or your own adventure module (drop in a PDF or text file), Story and Party chat channels, persistent campaign memory.
- Full character creation, multiclassing, 27 feats, character sheet with inventory and level-up.
- Grid combat with action economy, spells, conditions and concentration; monsters and companions act on their own.
- Dying as the rules have it: a character at 0 hit points rolls a death saving throw on each of its turns (the player rolls it with the button, `/deathsave`, or by saying anything), and the fight goes on while anyone is dying. Foes with no one left standing attack the fallen (each hit a failed save, two for a melee hit within 5 ft). In an adventure module, when the whole party falls the DM first checks the book: if these foes take prisoners (or the book says what happens to a defeated party), they take the characters captive instead, and the characters wake 1d4 hours later with 1 hit point wherever the book puts them. Allies can `/stabilize` with a DC 10 Medicine check, a healer's kit, Spare the Dying or any healing. The fight ends in defeat once no one is standing or dying.
- Character options from the Player's Handbook, Xanathar's Guide to Everything and Tasha's Cauldron of Everything: all 13 classes including the artificer, about 100 subclasses, 470 spells, the newer feats, invocations, infusions, fighting styles, Custom Lineage and Customizing Your Origin.
- Room-based exploration: locks, traps, hidden features, mazes, riddles, NPC attitudes and secrets. Players move by saying where they go, and the DM keeps the map one area ahead. Plain words that call for a roll (search, scan, investigate, examine, listen, sneak, climb, "I roll for perception") roll the check before the DM answers.
- Adventure modules are read once by the DM model into scenes (areas, NPCs, encounters, DCs, treasure, boxed text) and stat blocks, saved under `data/modules`, and run as written: the scene in play and the next are preloaded, the book's read-aloud text is shown verbatim, `consult_adventure` searches the book locally, and its encounters, traps and treasure skip the balance caps. Modules need a DM model to prepare; preparation can be paused and resumed. The whole book is read: stat blocks are found across the full text and read field by field (the model only for the odd one), scanned pages are read by OCR (tesseract.js, which downloads its English data once into `data/modules/.ocr`), passages the model can't answer in one go are read in halves, and each module keeps a `log.txt` of what every passage and stat block gave. The uploaded file is kept so a module can be read again.

The model never changes game state directly: it calls validated tools, dice are rolled on the server, and the engine enforces the rules. Slash commands (`/attack`, `/cast`, `/move`, `/go`, `/help`) go straight to the engine; free text goes to the DM. With no model, the campaign owner runs the game with `/dm` commands.

## Install

Needs Node 20+.

```bash
git clone https://github.com/pmghartman/tavern.git ~/tavern && cd ~/tavern
npm ci --omit=dev
npm start
```

better-sqlite3 is a native module: npm downloads a prebuilt binary or compiles it (needs python3, make, a C++ compiler). `sudo scripts/rebuild.sh` installs and starts it as the systemd user unit `tavern` of the checkout's owner.

## Phosphorus

Tavern is built for a [phosphorus](https://github.com/pmghartman/phosphorus) host. To put it on the mesh desktop, add to phosphorus's `config/services.export`:

```ini
[tavern]
port = 8484
mode = path
```

The page uses relative URLs, so it works under phosphorus's `/tavern/` path as it does at the root. The DM is a phosphorus **agent** called Tavern: phosphorus's Agents page assigns it a mesh model (or leaves it to the automatic pick, the biggest model that is ready), and tavern asks phosphorus's model gateway as `agent-tavern`. Settings in tavern can pin another mesh model or one of OpenCode Zen's free agents instead.

## Configuration

Optional `.env` in the repo root:

| Variable | Default | Purpose |
|---|---|---|
| `TAVERN_PORT` | `8484` | Port |
| `TAVERN_HOST` | `0.0.0.0` | Bind address |
| `TAVERN_PHOS_URL` | `http://127.0.0.1:8090` | phosphorus's frontend; the DM asks the model phosphorus picks for its Tavern agent, other agents are picked in Settings |
| `TAVERN_SEARXNG_URL` | `PHOS_SEARCH_URL` or `127.0.0.1:8888/search` | A SearXNG for the DM's `web_search` and `fetch_page` (`off` disables search) |
| `TAVERN_MODELS` | | `name=url,...` OpenAI-compatible endpoints instead of phosphorus |
| `TAVERN_UPDATES` | | `off` hides the update button in Settings |
| `TAVERN_CONTEXT_TOKENS` | `12000` | Prompt budget |
| `TAVERN_DM_MAX_TOKENS` | `700` | Longest DM reply, tool calls included |
| `TAVERN_REASONING` | `low` | Model thinking effort: `low`, `medium`, `high`, `off`, or `default` to leave it to the model |
| `TAVERN_INGEST_CONCURRENCY` | `2` | Passages of a module read in parallel (1-4) |
| `TAVERN_OCR_WORKERS` | spare cores, up to 4 | Scanned PDF pages read by OCR in parallel |
| `TAVERN_MODULES_DIR` | `/repo/files/tavern/modules:/opt/phosphorus/files/tavern/modules` | Folders (`:`-separated) scanned every minute for module files (PDF, .txt, .md, .html) to read in; `off` disables |
| `TAVERN_DATA_DIR` | `data` | Database and backups |
| `LLM_API_KEY`, `LLM_TIMEOUT_MS`, `LLM_MAX_TOKENS` | | Model request settings |

## Updates

Settings has an **Update from source** button: the server runs `scripts/update.sh` beside itself (under systemd, as a transient unit of its own, so the restart at its end doesn't kill it), the page shows the log and reloads once the new version answers. The same from a shell:

```bash
npm run update      # pull main from upstream, then rebuild
npm run rebuild     # npm ci, restart the systemd unit if the version changed
```

`--force` restarts regardless and lets `update` discard local changes. `.env` and `data/` survive updates, and the database is backed up on each version change. The version is `VERSION` plus the commit count. `TAVERN_UPDATES=off` hides the button.

## Desktop app

`src-tauri/` wraps Tavern in a [Tauri](https://tauri.app) window for macOS, Windows and Linux. The app is a window onto a running Tavern server: on first launch it asks for the server's address, `localhost:8484` by default (Server › Change Server... to switch later). Campaigns, characters and the DM's agents all live on that server, so every app pointed at it shares them. Building needs Node, Rust (https://rustup.rs) and on Linux the [Tauri system packages](https://tauri.app/start/prerequisites/).

```bash
scripts/app_build.sh               # update from upstream (as scripts/update.sh), then build
scripts/app_build.sh --no-update   # build this checkout as it is
scripts/app_build.sh --install     # then install the build over /Applications/Tavern.app (macOS)
TAVERN_APP_URL=http://tavern.lan:8484/ scripts/app_build.sh   # another server to offer on first launch
npm run app:dev                    # run the app without bundling
```

Installers land in `src-tauri/target/release/bundle/`. The app's **Server › Update App from Source...** runs `scripts/app_build.sh --install` in the checkout it was built from (or `TAVERN_SRC`), shows the build log, and relaunches into the new build. The server it is connected to updates itself from the page's Settings, as above.

## Layout

```
server/engine/  rules engine and game data (data/spellsMore.js and data/subclasses.js hold the PHB, Xanathar's and Tasha's additions)
server/dm/      model clients, DM tools, prompts, memory
server/         game loop, REST + SSE API, SQLite store
web/            single-page app, no build step
app/            the desktop app's own pages: the launcher and the update page
scripts/        update.sh, rebuild.sh, app_build.sh
```

## License

SRD 5.1 material by Wizards of the Coast LLC, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode); descriptions are paraphrased. Content from the Player's Handbook, Xanathar's Guide to Everything and Tasha's Cauldron of Everything (beyond the SRD) is for personal use by owners of those books: the game mechanics are implemented and the descriptions are short summaries written for tavern, not the books' text. Many narrative features are left to the DM rather than automated.
