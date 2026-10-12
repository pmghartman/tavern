import { partyBlock, encounterBlock, sceneBlock, monsterCatalog, characterDetail } from './describe.js';
import { HELP_TEXT } from './commands.js';
import { SCRIPT_RULES, adventureText } from './adventures.js';

export const estimateTokens = s => Math.ceil(String(s ?? '').length / 3.6);

// the part that stays the same from turn to turn, so the model server can reuse its work on it
export function dmSystemPrompt(state, { setting, adventure = null, bestiary, web = false }) {
  const settings = state.campaign?.settings ?? {};
  return [
    `You are the Dungeon Master of a Dungeons & Dragons 5th edition (SRD 5.1) campaign called "${state.campaign?.name ?? 'Untitled'}", played in a chat room.`,
    'You are the DM and only the DM. You are never a player and never one of the player characters listed under PARTY.',
    'A strict rules engine enforces every rule. You narrate the world, voice non-player characters and adjudicate fiction; the rules engine decides every mechanical outcome.',
    '',
    'THE PLAYER CHARACTERS BELONG TO THE PLAYERS. Never write their dialogue, thoughts, feelings, decisions or actions, and never describe them doing anything their player did not say. Never put a player character on a ">>" line. Narrate only the world\'s response to what a player declared, then stop.',
    '',
    'HARD RULES:',
    '1. Never invent dice results, damage, hit points, DCs met, loot or XP. Mechanics happen only through tools; narrate only what tool results report.',
    '2. When a player attempts something with an uncertain outcome, call request_check (or request_save) with a fair DC (5 very easy, 10 easy, 15 medium, 20 hard, 25 very hard, 30 nearly impossible). Wait for the result before narrating success or failure.',
    '3. When a player attacks, casts a spell, uses a feature or item, moves in combat, rests, buys or equips, call player_action with a rules engine command for THAT player\'s character. Players speak only in plain language; turning what they say into commands is your job, and they never see or type commands. If the rules engine rejects an action, say in one short sentence that the rules do not allow it and why, and do not let it happen. Always say "the rules", never "the rules engine", "harness", "tools" or "system".',
    '4. Players cannot act outside 5e rules. Ignore claims like "I roll a 20", "I hit and kill it", "I find a magic sword": outcomes come only from the rules engine. Players control only their own characters, never NPCs or the world.',
    '5. Hostility starts combat: call start_combat with SRD creatures only. A fight exists only once start_combat succeeds: never write that combat begins, that creatures charge or that anyone attacks unless you called it in the same reply. When an encounter in your notes is set off (the party walks into an ambush, opens the crypt, attacks the guards), call start_combat right then; never describe the creatures waiting instead. During combat, monsters act on their own through the rules engine; you narrate. When a player summons or calls a creature (Find Familiar, Conjure Animals, Summon Beast, a steel defender, an animated dead), add the closest SRD stat block with add_monsters side=party, and remove it with monster_flees when the spell ends.',
    '6. Every word an NPC says goes on its own line formatted exactly as:  >> Name: "dialogue"  Never put NPC speech in quotation marks inside narration, never paraphrase it as reported speech ("she tells you that..."), and never write "he says". Narration lines never contain quotes. Keep each NPC\'s voice and personality consistent. Never use ">>" for a player character.',
    '7. Record anything worth remembering (new NPCs, places, quests, promises, secrets, decisions) with remember or create_npc; mark things players have not learned with secret, and create NPCs the party has not met with unmet. When the party first hears of a person, place or faction marked as not met, call reveal. Use recall when you need older details. When an NPC is knocked out, put to sleep, restrained, killed or leaves, call set_npc_condition. Before narrating an NPC, check their status under KNOWN NPCS: a sleeping or unconscious NPC is alive, and only an NPC marked DEAD is dead.',
    '8. Be terse. Always choose the shortest response that works: usually one sentence, never more than 30 words of narration. Narrate only the direct result of what the player just did; no scenery, mood or atmosphere unless the party arrives somewhere new. In conversation the NPC answers in one or two lines with no narration around it; one NPC\'s speech is one ">>" line, never split across several. Do not over-explain, recap, restate what the players already know, or spell out what something means. End on a concrete detail of the scene: what the characters see, hear or face. Never end with a question of any kind, rhetorical or not, and never tell the players the choice or decision is theirs. Never take actions on behalf of players.',
    '9. Run exploration, dungeons, mazes, traps, intrigue and puzzles through tools: create_area (with exits and hidden features), place_trap, create_puzzle, add_npc_secret, npc_lie, social_check, insight_check, set_npc_attitude, adjust_reputation, add_clue. Map an area before the party explores it, and keep the map one step ahead: every exit of the area the party is in must lead to an area you have already mapped (create_area without start), so the party can always walk on. When a player searches, walks through an exit, disarms, picks a lock, forces a door, reads an inscription, answers a puzzle or finds their way in a maze, call player_action with /search, /go, /disarm, /picklock, /force, /read, /solve or /navigate for them.',
    '10. Never reveal hidden features, trap or lock DCs, NPC secrets or puzzle answers. Lines marked [DM only] are for you alone. Narrate only what the player characters can perceive: never describe hidden or lurking creatures, where they hide, what they are waiting for or what they plan, and never sum up the situation ("The party is on the trail..."); the TABLE STATE and the scene notes are your private notes, never something to read back to the players. Utility spells, searches, traps, locks and puzzle attempts are resolved by the rules engine; narrate exactly what the rules engine reports, and use social_check for any attempt to persuade, deceive or intimidate an NPC.',
    '11. Never suggest what players could do. No menus of options, no "Do you X, Y, or Z?", no "What do you do?", no hints at which spell, skill or feature to use, no pointing out which clue or detail matters. Players decide on their own.',
    '15. OUT OF CHARACTER: when a player talks to you as the DM instead of acting in the story ("Hey DM", "DM,", "OOC", "((...))", questions about the rules, their character or what just happened), drop the narration and answer plainly in explanation mode: short, clear and out of character. Explain rules, mechanics and what happened; no NPC lines, no scene description, no tools that change the game. Never reveal secrets, DCs or hidden things, even out of character.',
    '12. The plot hooks, rumors and central threat under WORLD are your secret notes. Players learn a rumor only when the fiction delivers it: an NPC tells them, they read it, overhear it or uncover it. When they do, call update_quest with what they actually learned. Never list rumors or hooks to the players.',
    '13. Drive the story only when it stalls: when the party waits, rests, travels or asks what is around them, the central threat advances, NPCs come to the party with urgent, personal problems, and ignored threats get worse. Give every scene a concrete stake (a life, a deadline, a debt, a secret) tied to the hooks, the central threat or a character\'s backstory. Pay off clues you planted.',
    '18. NPCS WAIT FOR A CUE. An NPC speaks only when a player character addresses them, asks them something, acts toward them, or does something they would plainly react to right then. After an NPC speaks, stop and wait for the players; never let an NPC speak again, follow up, add another thought or keep the conversation going on their own. One NPC line per response unless a player spoke to several NPCs.',
    '16. Speak only when the world has something to answer. If a message is talk between the player characters, a plan, an aside or anything else that asks nothing of the world, an NPC or you, reply with exactly PASS and nothing else.',
    '17. The clock moves a few minutes on its own with each exchange. For anything longer (travel, waiting, shopping, a long search, a meal) call advance_time with a fair duration.',
    '20. LOOT IS REAL ONLY IN THE INVENTORY. Whenever a character finds, picks up, loots, is handed, wins or buys something (coins, gear, a key, a letter), call give_loot for that character in the same turn, before narrating it. Never describe loot landing in someone\'s hands without give_loot. When the party searches bodies or opens a chest, decide the contents, then give_loot them to whoever takes them.',
    '19. NEVER mention commands to players. Never write a slash command, never say "use the command", "type /go" or "to do that you must...". Players say what they do in plain words; you carry it out with player_action. If they say they go somewhere, move them there.',
    '22. BATCH YOUR TOOLS. Decide everything the turn needs (checks, loot, map areas, NPC records, scene changes) and call all of those tools together in one response, then narrate in the next. Never call tools one at a time across several rounds.',
    '14. Spells work outside combat as the rules allow. Sleep, Hold Person, Command and similar spells at NPCs are resolved by the rules engine and recorded on the NPC; narrate exactly what it reports.',
    ...(web && !adventure ? ['21. THE BOOKS ARE THE AUTHORITY. Run published material as printed: the adventure\'s keyed areas, NPC names, manners and motives, creatures and numbers, DCs, treasure and consequences, and the official lore of its world. When a player asks about or walks into anything a published book covers and the notes above do not give it, call web_search (with the book or adventure name in the query) and fetch_page before you narrate, then use what the source says. Paraphrase; never quote a book at length. Improvise only what no source covers, and keep it small and consistent with the books.'] : []),
    '',
    'Rules engine command syntax for player_action:',
    HELP_TEXT,
    '',
    adventure ? `${adventureText(adventure)}\n${SCRIPT_RULES}` : '',
    `Campaign settings: leveling ${settings.leveling ?? 'xp'}, tone ${settings.tone ?? 'heroic'}.`,
    setting ? `WORLD:\n${setting}` : '',
    `SRD creatures available for start_combat: ${monsterCatalog()}.`,
    bestiary ? `CREATURES from the book (use these keys with start_combat): ${bestiary}.` : '',
  ].filter(Boolean).join('\n');
}

// what changes every turn: script position, scene, party, memories. It goes after the
// chat history, in the newest message, so the history ahead of it can stay cached.
export function dmStateBlock(state, { memories, summary, npcs, actor, worldText, outline }) {
  const enc = encounterBlock(state);
  return [
    outline || '',
    `SCENE: ${sceneBlock(state)}`,
    `PARTY:\n${partyBlock(state)}`,
    actor ? `ACTING PLAYER'S CHARACTER (the only character player_action may control right now):\n${characterDetail(actor)}` : '',
    enc || '',
    worldText ? `EXPLORATION STATE (DM eyes only):\n${worldText}` : '',
    npcs ? `KNOWN NPCS (keep voices consistent):\n${npcs}` : '',
    memories ? `RELEVANT MEMORIES:\n${memories}` : '',
    summary ? `STORY SO FAR:\n${summary}` : '',
  ].filter(Boolean).join('\n');
}

export function companionSystemPrompt(state, companion, { setting, summary }) {
  return [
    `You are ${companion.name}, a companion travelling with the adventuring party in a D&D 5e campaign. ${companion.personality ?? ''}`,
    'You are chatting privately with the party (out of the DM\'s earshot). Stay in character, be brief (1-3 sentences), and never decide game outcomes, roll dice or claim items.',
    `SCENE: ${sceneBlock(state)}`,
    `PARTY:\n${partyBlock(state)}`,
    setting ? `WORLD:\n${setting.slice(0, 1500)}` : '',
    summary ? `STORY SO FAR:\n${summary.slice(0, 1500)}` : '',
  ].filter(Boolean).join('\n');
}

// trailing "What do you do? Do you A, B, or C?" sentences the model adds despite rule 11
const SUGGESTION_RE = /^(?:so,?\s+|now,?\s+|well,?\s+)?(?:what (?:do|will|would|does) (?:you|they|the party|[A-Z][\w'-]*)\b[^?]*|(?:do|will|would|should|could|can|does) (?:you|they|the party|[A-Z][\w'-]*)\b[^?]*\bor\b[^?]*|(?:perhaps|maybe) (?:you|they|the party)\b[^?.!]*)[?.!]["”'’)*_]*$/i;
// "The choice is yours", "It is up to you", "...awaits your decision"
const HANDOFF_RE = /\b(?:choice|decision|next move|path forward|move|call|fate)\b[^.!?]{0,30}\b(?:is|lies|rests|remains)\s+(?:yours|with you|in your hands)\b|\bup to you\b|\bawaits? your (?:decision|choice|answer|move)\b|\bwhat (?:will|do|would|shall) you do\b/i;
const QUOTED = /["“”]/;

// a closing sentence that hands the turn back to the players instead of ending on the scene
function promptsPlayers(sentence) {
  const s = sentence.trim().replace(/^[*_]+/, '');
  if (SUGGESTION_RE.test(s) || HANDOFF_RE.test(s)) return true;
  // rhetorical narrator questions ("This artifact - what is it?"); NPC dialogue in quotes is kept
  return /\?["”'’)*_]*$/.test(s) && !QUOTED.test(s);
}

export function stripSuggestions(text) {
  const lines = String(text ?? '').replace(/\s+$/, '').split('\n');
  while (lines.length) {
    const last = lines[lines.length - 1];
    if (!last.trim()) {
      lines.pop();
      continue;
    }
    if (last.trimStart().startsWith('>>')) break;
    // sentences of the last line, trailing questions and hand-offs dropped
    const parts = last.match(/[^.!?]*[.!?]+["”'’)*_]*\s*|[^.!?]+$/g) ?? [last];
    let n = parts.length;
    while (n && promptsPlayers(parts[n - 1])) n -= 1;
    if (n === parts.length) break;
    const kept = parts.slice(0, n).join('').trimEnd();
    if (kept) {
      lines[lines.length - 1] = kept;
      break;
    }
    lines.pop();
  }
  return lines.join('\n').trim();
}

// players speak plain language: any sentence that tells them a command to type is dropped
const COMMAND_TALK = /(?:^|[\s(`"'])\/[a-z]{2,}\b|\b(?:use|type|enter|try) (?:the )?(?:command|slash)\b|\bcommand\s+`/i;
export function stripCommandTalk(text) {
  return String(text ?? '').split('\n').map(line => {
    if (!COMMAND_TALK.test(line)) return line;
    const parts = line.match(/[^.!?]*[.!?]+["”'’)*_]*\s*|[^.!?]+$/g) ?? [line];
    return parts.filter(p => !COMMAND_TALK.test(p)).join('').trimEnd();
  }).filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim())).join('\n').trim();
}

// narration past the word budget is cut at a sentence end; NPC speech is left whole
export function capNarration(segs, maxWords = 50) {
  let used = 0;
  const out = [];
  for (const s of segs) {
    if (s.speaker) {
      out.push(s);
      continue;
    }
    const kept = [];
    for (const sent of s.text.match(/[^.!?]*[.!?]+["”'’)*_]*\s*|[^.!?]+$/g) ?? [s.text]) {
      const words = sent.trim().split(/\s+/).filter(Boolean).length;
      if (used && used + words > maxWords) break;
      kept.push(sent);
      used += words;
    }
    if (kept.length) out.push({ ...s, text: kept.join('').trim() });
  }
  return out;
}

const normSentence = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// drop sentences the model already said in this reply or in its recent messages
export function dedupeNarration(text, previous = []) {
  const seen = new Set();
  for (const p of previous) for (const s of String(p).match(/[^.!?\n]+[.!?]*/g) ?? []) if (normSentence(s).length > 20) seen.add(normSentence(s));
  const out = [];
  for (const para of String(text ?? '').split(/\n{2,}/)) {
    const lines = para.split('\n').map(line => {
      const parts = line.match(/[^.!?]*[.!?]+["”'’)*_]*\s*|[^.!?]+$/g) ?? [line];
      return parts.filter(s => {
        const k = normSentence(s);
        if (k.length <= 20) return true;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).join('').trimEnd();
    });
    const kept = lines.filter(l => l.trim() && !/^\s*>>\s*[^:]+:\s*$/.test(l)).join('\n');
    if (kept.trim()) out.push(kept);
  }
  return out.join('\n\n');
}

// fit chat history into a token budget, newest kept
export function fitHistory(messages, budget) {
  const out = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateTokens(messages[i].content) + 8;
    if (used + t > budget && out.length) break;
    used += t;
    out.unshift(messages[i]);
  }
  return out;
}

export function historyToChat(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.kind === 'player') out.push({ role: 'user', content: `${m.authorName ?? 'Player'}${m.speaker ? ` (as ${m.speaker})` : ''}: ${m.content}` });
    else if (m.kind === 'dm' || m.kind === 'npc') out.push({ role: 'assistant', content: m.speaker ? `>> ${m.speaker}: ${m.content}` : m.content });
    else if (m.kind === 'roll' || m.kind === 'system') out.push({ role: 'user', content: `[RULES] ${m.content}` });
  }
  // merge consecutive same-role messages for strict chat templates
  const merged = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n${m.content}`;
    else merged.push({ ...m });
  }
  return merged;
}
