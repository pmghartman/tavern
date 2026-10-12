import { dict } from '../engine/data/dict.js';
import { SETTING_TOOL } from './tools.js';
import { adventureText } from './adventures.js';

export const PRESETS = dict({
  classic: { name: 'Classic High Fantasy', prompt: 'A classic heroic fantasy realm of kingdoms, ancient ruins, dragons and wandering adventurers.' },
  grim: { name: 'Grim and Gritty', prompt: 'A grim, war-torn land where plague, cults and desperate lords make every victory costly.' },
  coastal: { name: 'Coastal Intrigue', prompt: 'Island city-states, smugglers, sea monsters and merchant princes scheming over trade routes.' },
  frontier: { name: 'Wild Frontier', prompt: 'A savage frontier at the edge of civilization: forests, monster lairs, lost dwarven holds and struggling settlements.' },
  underdark: { name: 'Haunted Depths', prompt: 'A region riddled with caverns and haunted crypts where the dead do not rest and light is precious.' },
});

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// deterministic offline generator so campaigns work without a model
export function fallbackSetting({ preset = 'classic', name, seed = Date.now() }) {
  let s = seed % 2147483647 || 1;
  const rng = () => ((s = (s * 48271) % 2147483647) / 2147483647);
  const towns = ['Thornwick', 'Greyhollow', 'Brindlemere', 'Saltmarsh Reach', 'Oakenford', 'Duskvale', 'Highmoor', 'Ravenscar'];
  const regions = ['the Ashen Downs', 'the Whispering Fen', 'the Iron Peaks', 'the Sunken Coast', 'the Verdant Tangle', 'the Old Imperial Road', 'the Shattered Isles'];
  const factions = [['The Lantern Guild', 'merchants who keep the roads lit and taxed'], ['The Crimson Hand', 'a cult that bargains with fiends for power'], ['The Order of the Dawn', 'paladins sworn to purge the undead'], ['The Gravel Kings', 'a goblin warband uniting the hill tribes'], ['The Circle of Thorns', 'druids who resent the spread of farms into the wilds']];
  const npcNames = [['Bartholomew Crane', 'innkeeper of the Gilded Goose', 'warm, gossipy, speaks in proverbs'], ['Sister Ilsa', 'temple healer', 'soft-spoken, tired, fiercely protective of the sick'], ['Captain Varro', 'commander of the town watch', 'gruff, clipped sentences, suspicious of outsiders'], ['Mira Swiftwater', 'half-elf ranger and guide', 'dry humor, notices everything'], ['Old Gorrim', 'dwarven smith', 'loud, laughs at his own jokes, hates goblins']];
  // [rumor, inciting incident for the opening]
  const hooks = [
    ['Three caravans have vanished on the east road this month. The last carried medicine for the plague-struck village of Fernlow, which has perhaps a week left. Survivors speak of small, cackling raiders, but the wagons were emptied with a quartermaster\'s care.', 'The door bangs open and a wagon driver staggers in, an arrow in his shoulder, gasping that the medicine wagon for Fernlow was taken on the east road not an hour ago.'],
    ['The temple bell rang at midnight three nights running, though the tower is locked. Each morning a parishioner is found sleepwalking toward the old crypts, and Sister Ilsa fears the fourth will not wake at all.', 'At the stroke of midnight the temple bell tolls across the town, and through the window a barefoot woman in a nightgown walks past toward the crypts, eyes open and unseeing.'],
    ['A dying messenger reached the town gate with half of a map sealed with a dragon sigil. Two other parties are already hunting the other half, and one of them killed for it.', 'A man in a torn courier\'s tabard collapses against your table, presses a bloodstained half of a map sealed in red wax into the nearest hand, and whispers "they are right behind me" before going still.'],
    ['Wolves larger than horses have taken sheep, then a shepherd, and now they circle the farms at dusk. The hunters who went after them came back changed, and one of them will not stop smiling.', 'A long howl rolls down from the forest edge, answered by another far too close, and the inn falls silent as something heavy scrapes along the outer wall.'],
    ['The mayor\'s daughter went missing near the old crypts two days ago. The mayor offers 100 gold, and has quietly forbidden the watch from searching the family mausoleum.', 'The mayor himself pushes through the crowd, grey with fear, and slams a purse of gold on the bar: his daughter has not come home, and he needs someone who is not from this town.'],
  ];
  const threats = ['A disgraced quartermaster of the town watch has struck a bargain with a goblin warlord, selling out the roads in exchange for a share of the plunder and, soon, the keys to the town gate.', 'A cult of the Crimson Hand is waking something beneath the old crypts, feeding it the dreams of sleepwalkers. When the bell rings a seventh night, it rises.', 'A young dragon is gathering the pieces of its dead mother\'s hoard map through hired killers; whoever holds the map will be hunted, and the town that harbors them will burn.'];
  const town = pick(rng, towns);
  const p = PRESETS[preset] ?? PRESETS.classic;
  const world = name ?? `The Realm of ${pick(rng, ['Aldmere', 'Calvaros', 'Ythria', 'Norhollow', 'Vaelstrand'])}`;
  const chosenFactions = [...factions].sort(() => rng() - 0.5).slice(0, 3);
  const chosenNpcs = [...npcNames].sort(() => rng() - 0.5).slice(0, 3);
  const chosenHooks = [...hooks].sort(() => rng() - 0.5).slice(0, 3);
  return {
    world_name: world,
    overview: `${p.prompt} The town of ${town} sits at the crossroads of ${pick(rng, regions)} and ${pick(rng, regions)}, a place where travelers trade rumors as freely as coin.`,
    starting_location: { name: town, description: `${town} is a walled market town of timber and stone. Smoke rises from the Gilded Goose inn, and notices crowd the board by the gate.` },
    regions: [...regions].sort(() => rng() - 0.5).slice(0, 3).map(r => ({ name: r, description: `Wild country beyond ${town}.` })),
    factions: chosenFactions.map(([n, d]) => ({ name: n, description: d })),
    npcs: chosenNpcs.map(([n, r, pers]) => ({ name: n, role: r, personality: pers })),
    central_threat: pick(rng, threats),
    hooks: chosenHooks.map(h => h[0]),
    opening: `Rain drums on the shingles of the Gilded Goose as you shake off the road. ${chosenHooks[0][1]}`,
  };
}

export function settingToText(s) {
  if (!s) return '';
  return [
    s.adventure ? adventureText({ name: s.adventure, levels: s.levels }) : '',
    `${s.world_name}: ${s.overview}`,
    s.starting_location ? `Starting location: ${s.starting_location.name}. ${s.starting_location.description}` : '',
    s.regions?.length ? `Regions: ${s.regions.map(r => `${r.name} (${r.description})`).join('; ')}` : '',
    s.factions?.length ? `Factions: ${s.factions.map(f => `${f.name}: ${f.description}`).join('; ')}` : '',
    s.central_threat ? `Central threat (secret): ${s.central_threat}` : '',
    s.hooks?.length ? `Secret plot hooks and rumors (players learn them only through play): ${s.hooks.join(' | ')}` : '',
  ].filter(Boolean).join('\n');
}

export async function generateSetting(llm, { name, preset, custom, tone, endpoint }) {
  const p = PRESETS[preset] ?? PRESETS.classic;
  const messages = [
    { role: 'system', content: 'You are a world-building assistant for Dungeons & Dragons 5th edition (SRD). Create original settings. Respond by calling define_setting.' },
    { role: 'user', content: `Create a campaign setting named "${name}". Style: ${custom || p.prompt} Tone: ${tone || 'heroic adventure'}. Give 3 regions, 3 factions with conflicting goals, 3 memorable NPCs with distinct voices who each want something from the party, a secret central threat, 3 adventure hooks suitable for level 1 characters, and an opening scene. Hooks must be urgent and personal, never generic: a named victim, a place, a deadline, real consequences if ignored, and a twist tied to the central threat. The opening drops the party straight into trouble connected to the first hook.` },
  ];
  const out = await llm.chat({ endpoint, messages, tools: [SETTING_TOOL], toolChoice: 'define_setting', temperature: 0.9, maxTokens: 2400 });
  const call = out.toolCalls.find(c => c.name === 'define_setting');
  let s = call?.arguments;
  if (!s && out.content) {
    const m = /\{[\s\S]*\}/.exec(out.content);
    if (m) s = JSON.parse(m[0]);
  }
  return normalize(s);
}

// a module's setting comes straight from its prepared summary: no model call
export function moduleSetting(mod) {
  const m = mod.meta;
  const first = mod.chapters[0]?.beats[0];
  const opening = first?.readAloud?.[0]?.text ?? `${m.start.description} ${m.premise}`.trim();
  return {
    world_name: m.world, adventure: mod.name, levels: m.levels, overview: m.premise,
    starting_location: m.start,
    regions: [], factions: [], npcs: [], central_threat: m.threat, hooks: [m.premise], opening,
  };
}

function briefText(r) {
  const lines = [`  SCENE NOTES (from the book): ${r.setup}`];
  for (const a of r.areas ?? []) lines.push(`  - Area ${a.name}: ${a.notes}`);
  for (const n of r.npcs ?? []) lines.push(`  - NPC ${n.name}: ${n.notes}`);
  for (const e of r.encounters ?? []) lines.push(`  - Encounter: ${e.creatures}${e.where ? ` at ${e.where}` : ''}${e.when ? `; ${e.when}` : ''}`);
  if (r.checks?.length) lines.push(`  - Checks: ${r.checks.join('; ')}`);
  if (r.treasure?.length) lines.push(`  - Treasure: ${r.treasure.join('; ')}`);
  if (r.leads?.length) lines.push(`  - Leads onward: ${r.leads.join('; ')}`);
  return lines.join('\n');
}

// the beat after (ci, bi), across chapter ends
export const nextBeat = (o, ci, bi) => (bi + 1 < (o.chapters[ci]?.beats?.length ?? 0) ? [ci, bi + 1] : ci + 1 < o.chapters.length && o.chapters[ci + 1].beats?.length ? [ci + 1, 0] : null);

// what the DM sees of the script: every chapter in a line, the scene in play in full
// with its boxed text ready, the next scene previewed, the rest of the chapter listed.
// mod: the module the beats' scene notes live in (older campaigns carry them inline)
export function outlineText(o, mod = null) {
  if (!o?.chapters?.length) return '';
  const full = (ci, bi) => mod?.chapters?.[ci]?.beats?.[bi] ?? o.chapters[ci]?.beats?.[bi];
  const lines = [`ADVENTURE OUTLINE for "${o.adventure}" (follow it in order; DM eyes only):`];
  o.chapters.forEach((c, i) => {
    const mark = i < o.chapter ? 'done' : i === o.chapter ? 'CURRENT' : i === o.chapter + 1 ? 'next' : '';
    lines.push(`Ch ${i + 1}${mark ? ` [${mark}]` : ''}: ${c.title}${c.levels ? ` (levels ${c.levels})` : ''}${i >= o.chapter && i <= o.chapter + 1 && c.summary ? ` - ${c.summary}` : ''}`);
  });
  const beats = o.chapters[o.chapter]?.beats ?? [];
  const now = beats[o.beat];
  if (now) {
    const f = full(o.chapter, o.beat);
    lines.push(`NOW [${o.chapter + 1}.${o.beat + 1}] ${now.title}${now.location ? ` @ ${now.location}` : ''}: ${now.summary}${now.npcs?.length ? ` NPCs: ${now.npcs.join(', ')}.` : ''} Ends when: ${now.advanceWhen}`);
    if (f?.brief) lines.push(briefText(f.brief));
    const unread = (ci, bi, title) => (full(ci, bi)?.readAloud ?? []).map((r, k) => [r, k]).filter(([, k]) => !(o.shown ?? []).includes(`${ci}.${bi}.${k}`)).map(([r]) => r.area || title);
    const ready = unread(o.chapter, o.beat, now.title);
    if (ready.length) lines.push(`  - READ-ALOUD ready (call read_aloud with the area): ${ready.join('; ')}`);
    const nx = nextBeat(o, o.chapter, o.beat);
    if (nx) {
      const [nc, nb] = nx;
      const b = o.chapters[nc].beats[nb];
      const nf = full(nc, nb)?.brief;
      const bits = nf ? [nf.areas?.length ? `areas ${nf.areas.map(a => a.name).join(', ')}` : '', nf.encounters?.length ? `encounters ${nf.encounters.map(e => e.creatures).join('; ')}` : ''].filter(Boolean).join('; ') : '';
      lines.push(`NEXT [${nc + 1}.${nb + 1}] ${b.title}${b.location ? ` @ ${b.location}` : ''}: ${b.summary}${bits ? ` (${bits})` : ''}`);
      const nextReady = unread(nc, nb, b.title);
      if (nextReady.length) lines.push(`  - READ-ALOUD ready for it (call read_aloud with the area when the party gets there): ${nextReady.join('; ')}`);
    }
    const later = beats.slice(o.beat + (nx && nx[0] === o.chapter ? 2 : 1)).map(b => b.title).join('; ');
    if (later) lines.push(`Later in this chapter: ${later.slice(0, 700)}`);
  }
  return lines.join('\n');
}

function normalize(s) {
  if (!s?.world_name || !s?.overview) throw new Error('Model did not return a setting.');
  s.regions = s.regions ?? [];
  s.factions = s.factions ?? [];
  s.npcs = s.npcs ?? [];
  s.hooks = s.hooks ?? [];
  s.starting_location = s.starting_location ?? { name: 'a crossroads inn', description: '' };
  return s;
}

// what players may see of the setting: no rumors or central threat
export function publicSetting(s) {
  if (!s) return s;
  const { hooks, central_threat, ...rest } = s;
  void hooks;
  void central_threat;
  return rest;
}
