import { findSpellKey, SPELLS } from '../engine/data/spells.js';
import { findItemKey } from '../engine/data/items.js';
import { SKILLS } from '../engine/data/core.js';
import { allCreatures, inCombat, combatant } from '../engine/state.js';
import { approachSquare } from './monsterAI.js';
import { itemDef } from '../engine/character.js';

export class CommandError extends Error {}

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

// resolve a creature reference by id, exact name, "goblin 2", or unique prefix
const NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
// "the second goblin", "goblin two", "goblin #2" all mean Goblin 2
function targetWords(ref) {
  let r = norm(ref).replace(/^(?:the|a|an)\s+/, '').replace(/\s+/g, ' ');
  r = r.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)$/, w => NUMS[w]);
  const ord = /^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) (.+)$/.exec(r);
  if (ord) r = `${ord[2]} ${ORDS[ord[1]]}`;
  return r.replace(/([a-z])(\d+)$/, '$1 $2');
}

export function resolveTarget(state, ref, { exclude } = {}) {
  if (!ref) return null;
  const r = targetWords(ref);
  const pool = allCreatures(state).filter(c => c.id !== exclude && !(c.dead && c.kind !== 'pc'));
  const byId = pool.find(c => c.id === ref);
  if (byId) return byId.id;
  const exact = pool.filter(c => norm(c.name) === r);
  if (exact.length === 1) return exact[0].id;
  const compact = pool.filter(c => norm(c.name).replace(/ /g, '') === r.replace(/ /g, ''));
  if (compact.length === 1) return compact[0].id;
  const starts = pool.filter(c => norm(c.name).startsWith(r) || norm(c.name).endsWith(` ${r}`) || norm(c.name).split(' ').some(w => w === r));
  const living = starts.filter(c => !c.dead && c.hp > 0);
  if (living.length === 1) return living[0].id;
  if (starts.length === 1) return starts[0].id;
  if (living.length > 1) throw new CommandError(`"${ref}" is ambiguous: ${living.map(c => c.name).join(', ')}.`);
  const here = pool.filter(c => !c.dead && (c.kind === 'pc' || state.encounter?.combatants?.[c.id])).map(c => c.name);
  throw new CommandError(`No creature called "${ref}" here.${here.length ? ` Here: ${here.join(', ')}.` : ''}`);
}

function parsePoint(s) {
  const m = /(-?\d+)\s*[, ]\s*(-?\d+)/.exec(s ?? '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

function invRef(char, name) {
  const n = norm(name);
  const inv = char.inventory.find(i => i.id === name) ?? char.inventory.find(i => norm(itemDef(i)?.name) === n) ?? char.inventory.find(i => norm(itemDef(i)?.name).startsWith(n)) ?? char.inventory.find(i => norm(i.key) === n.replace(/ /g, ''));
  if (inv) return inv.id;
  const key = findItemKey(name);
  if (key) {
    const k = char.inventory.find(i => i.key === key);
    if (k) return k.id;
  }
  throw new CommandError(`${char.name} has no "${name}".`);
}

const FEATURE_ALIASES = {
  rage: 'rage', endrage: 'endRage', secondwind: 'secondWind', surge: 'actionSurge', actionsurge: 'actionSurge',
  inspire: 'bardicInspiration', inspiration: 'bardicInspiration', turnundead: 'turnUndead', turnunholy: 'turnTheUnholy',
  layonhands: 'layOnHands', loh: 'layOnHands', flurry: 'flurryOfBlows', patient: 'patientDefense', patientdefense: 'patientDefense',
  step: 'stepOfTheWind', stepofthewind: 'stepOfTheWind', cunning: 'cunningAction', wildshape: 'wildShape', revert: 'revertWildShape',
  breath: 'breathWeapon', breathweapon: 'breathWeapon', wholeness: 'wholenessOfBody', sacredweapon: 'sacredWeapon', preservelife: 'preserveLife',
  font: 'fontOfMagic', spiritualweapon: 'spiritualWeapon', sw: 'spiritualWeapon',
};

export const HELP_TEXT = [
  '/attack <target> [with <weapon>] [reckless] [smite <slot>] [offhand] [stun] [power] [gwm] [butt]',
  '/cast <spell> [at <target>[, <target>]] [level <n>] [point <x>,<y>] [pact|normal] [quickened|twinned|...] [ritual]',
  '/move <x> <y>   /move to <target>   /dash   /disengage   /dodge   /hide   /search   /stand   /prone   /escape   /end',
  '/help <target>   /grapple <target>   /shove <target> [push]   /stabilize <dying ally> (Medicine DC 10)',
  '/use <item> [on <target>]   /equip <item> [offhand]   /unequip <item>   /attune <item>',
  '/give <item> to <name> [qty]   /buy <item> [qty]   /sell <item> [qty]   /drop <item>',
  '/rest short [<n> hit dice]   /rest long   /levelup (opens the level-up dialog)',
  '/search [investigation]   /go <exit>   /disarm <trap>   /picklock <door>   /force <door>   /read <writing>   /navigate',
  '/solve [puzzle:] <answer>   /hint [puzzle]   /cast knock on <door>   /cast detect magic   /cast charm person on <NPC>   /cast sleep on <NPC>, <NPC>',
  '/rage  /secondwind  /surge  /inspire <ally>  /layonhands <ally> <hp>  /flurry  /patient  /step [dash|disengage]',
  '/cunning <dash|disengage|hide>  /wildshape <beast>  /revert  /breath <target>  /turnundead  /sacredweapon',
  '/deathsave (on your turn while dying)   /roll <dice> (a table roll with no game effect)   /whoami   /help',
].join('\n');

// it is this character's turn and it lies dying, waiting on its death save
export function dyingTurn(state, char) {
  const enc = state?.encounter;
  if (!char || enc?.status !== 'active' || enc.order[enc.turn] !== char.id) return false;
  return !!enc.combatants[char.id]?.turnState?.deathSavePending;
}

// returns {kind:'action', action} | {kind:'roll', dice} | {kind:'help'} | {kind:'info', topic}
export function parseCommand(text, state, char) {
  const t = text.trim();
  if (!t.startsWith('/')) return null;
  const [head, ...restArr] = t.slice(1).split(/\s+/);
  const cmd = head.toLowerCase();
  const rest = restArr.join(' ').trim();
  const tgt = s => resolveTarget(state, s, { exclude: undefined });
  switch (cmd) {
    case 'help':
    case 'commands':
      if (rest && cmd === 'help' && state.encounter?.status === 'active') return { kind: 'action', action: { type: 'help', target: tgt(rest) } };
      return { kind: 'help' };
    case 'whoami':
      return { kind: 'info', topic: 'whoami' };
    case 'stabilize':
    case 'stabilise':
    case 'firstaid':
      if (!rest) throw new CommandError('Usage: /stabilize <dying ally>');
      return { kind: 'action', action: { type: 'stabilize', target: tgt(rest) } };
    case 'deathsave':
    case 'ds':
    case 'death':
      return { kind: 'action', action: { type: 'deathSave' } };
    case 'roll':
    case 'r':
      if (dyingTurn(state, char) && (!rest || /\b(?:death|save|d20)\b/i.test(rest))) return { kind: 'action', action: { type: 'deathSave' } };
      if (!rest) throw new CommandError('Usage: /roll 1d20+3');
      return { kind: 'roll', dice: rest };
    case 'check':
    case 'save':
      if (cmd === 'save' && dyingTurn(state, char)) return { kind: 'action', action: { type: 'deathSave' } };
      throw new CommandError('Ability checks and saving throws are called for by the DM. Describe what you attempt.');
    case 'attack':
    case 'a': {
      let m = /^(.*?)(?:\s+with\s+(.+?))?(\s+reckless|\s+smite\s+\d|\s+offhand|\s+stun|\s+nonlethal|\s+prone|\s+push|\s+flurry|\s+bonus|\s+power|\s+gwm|\s+butt)*$/i.exec(rest);
      if (!rest) throw new CommandError('Usage: /attack <target> [with <weapon>]');
      const flags = rest.toLowerCase();
      let targetPart = m[1];
      let weapon = m[2];
      for (const f of ['reckless', 'offhand', 'stun', 'nonlethal', 'flurry', 'bonus', 'power', 'gwm', 'butt']) {
        targetPart = targetPart.replace(new RegExp(`\\s+${f}\\b`, 'i'), '');
        if (weapon) weapon = weapon.replace(new RegExp(`\\s+${f}\\b`, 'i'), '');
      }
      targetPart = targetPart.replace(/\s+smite\s+\d/i, '');
      if (weapon) weapon = weapon.replace(/\s+smite\s+\d/i, '').trim();
      const smite = /smite\s+(\d)/.exec(flags)?.[1];
      const action = { type: 'attack', target: tgt(targetPart.trim()), attack: weapon || undefined };
      if (/\breckless\b/.test(flags)) action.reckless = true;
      if (smite) action.smite = Number(smite);
      if (/\boffhand\b/.test(flags)) action.offhand = true;
      if (/\bstun\b/.test(flags)) action.stunningStrike = true;
      if (/\bnonlethal\b/.test(flags)) action.nonlethal = true;
      if (/\bflurry\b/.test(flags)) action.flurry = true;
      if (/\bpower\b/.test(flags)) action.power = true;
      if (/\bmaneuver\b/.test(flags)) action.maneuver = true;
      if (/\bbonus\b/.test(flags)) action.bonusAttack = (char.classes ?? []).some(x => x.class === 'monk') || char.class === 'monk' ? 'martialArts' : 'frenzy';
      if (/\bgwm\b/.test(flags)) action.bonusAttack = 'gwm';
      if (/\bbutt\b/.test(flags)) {
        action.bonusAttack = 'polearm';
        action.attack = 'polearmButt';
      }
      if (action.flurry && /\bprone\b/.test(flags)) action.openHand = 'prone';
      if (action.flurry && /\bpush\b/.test(flags)) action.openHand = 'push';
      if (!action.attack && action.offhand) {
        const off = char.inventory.find(i => i.equipped === 'offHand');
        if (off) action.attack = off.id;
      }
      if (!action.attack && (action.flurry || action.bonusAttack === 'martialArts')) action.attack = 'unarmed';
      return { kind: 'action', action };
    }
    case 'cast':
    case 'c': {
      if (!rest) throw new CommandError('Usage: /cast <spell> [at <target>]');
      const MM = ['careful', 'distant', 'empowered', 'extended', 'heightened', 'quickened', 'subtle', 'twinned'];
      let body = ` ${rest} `;
      const metamagic = MM.filter(mm => new RegExp(`\\s${mm}\\s`, 'i').test(body));
      for (const mm of MM) body = body.replace(new RegExp(`\\s${mm}(?=\\s)`, 'ig'), ' ');
      const slotM = /\s(?:slot\s+)?(pact|normal)(?:\s+slot)?\s/i.exec(body);
      if (slotM) body = body.replace(slotM[0], ' ');
      const ritual = /\sritual\s/i.test(body);
      body = body.replace(/\sritual(?=\s)/i, ' ');
      const level = /\s(?:level|lvl|at level)\s+(\d)\s/i.exec(body)?.[1];
      body = body.replace(/\s(?:at\s+)?(?:level|lvl)\s+\d(?=\s)/i, ' ');
      const pointM = /\s(?:point|at point)\s+(-?\d+\s*[, ]\s*-?\d+)/i.exec(body);
      const point = pointM ? parsePoint(pointM[1]) : null;
      if (pointM) body = body.replace(pointM[0], ' ');
      const choiceM = /\s(?:choice|as|type)\s+(\w+)\s/i.exec(body);
      if (choiceM) body = body.replace(choiceM[0], ' ');
      const [spellPart, targetPart] = body.trim().split(/\s+(?:at|on|targeting|to)\s+/i);
      const spell = findSpellKey(spellPart.trim());
      if (!spell) throw new CommandError(`"${spellPart.trim()}" is not a spell in the SRD rule set.`);
      // names that are not creatures (doors, NPCs, items) go to the world as text
      const texts = [];
      const targets = [];
      for (const s of targetPart ? targetPart.split(/\s*(?:,|\band\b)\s*/i).filter(Boolean) : []) {
        if (/^(me|self|myself)$/i.test(s)) targets.push(char.id);
        else {
          try {
            targets.push(tgt(s));
          } catch (e) {
            if (!(e instanceof CommandError)) throw e;
            texts.push(s.trim());
          }
        }
      }
      const targetText = texts.length ? texts.join(', ') : null;
      if (targetText && targets.length) throw new CommandError(`"${targetText}" is not a creature here.`);
      const action = { type: 'cast', spell, targets };
      if (targetText) action.targetText = targetText;
      if (level) action.level = Number(level);
      if (point) action.point = point;
      if (metamagic.length) action.metamagic = metamagic;
      if (ritual) action.ritual = true;
      if (slotM) action.slot = slotM[1].toLowerCase();
      if (choiceM) action.choice = choiceM[1].toLowerCase();
      if (!targets.length && !targetText && !point && ['heal', 'buff'].includes(SPELLS[spell].effect.type) && SPELLS[spell].range !== 'self' && !SPELLS[spell].effect.partyRadius) action.targets = [char.id];
      return { kind: 'action', action };
    }
    case 'move':
    case 'm': {
      // "/move to goblin 2": the nearest open square beside it, or as far along the way as movement allows
      const toward = /^(?:to|toward|towards|next to|up to)\s+(.+)$/i.exec(rest);
      if (toward && !parsePoint(rest)) {
        if (!inCombat(state)) throw new CommandError('Moving up to a creature is for combat; out of combat, say where you go.');
        const id = tgt(toward[1]);
        if (!id || !combatant(state, id)) throw new CommandError(`${toward[1]} is not in this fight.`);
        const to = approachSquare(state, char.id, id, 5);
        const me = combatant(state, char.id);
        if (!to) throw new CommandError(`There is no open way to ${toward[1]}.`);
        if (me && to.x === me.pos.x && to.y === me.pos.y) throw new CommandError(`${char.name} is already as close as they can get.`);
        return { kind: 'action', action: { type: 'move', to } };
      }
      const p = parsePoint(rest);
      if (!p) throw new CommandError('Usage: /move <x> <y> or /move to <target>');
      return { kind: 'action', action: { type: 'move', to: p } };
    }
    case 'search':
      return { kind: 'action', action: { type: 'search', skill: /invest/i.test(rest) ? 'investigation' : 'perception' } };
    case 'disarm':
      if (!rest) throw new CommandError('Usage: /disarm <trap>');
      return { kind: 'action', action: { type: 'disarm', target: rest } };
    case 'picklock':
    case 'pick':
    case 'unlock':
      if (!rest) throw new CommandError('Usage: /picklock <door or object>');
      return { kind: 'action', action: { type: 'pickLock', target: rest.replace(/^lock\s+(of\s+)?/i, '') } };
    case 'force':
    case 'bash':
      if (!rest) throw new CommandError('Usage: /force <door or object>');
      return { kind: 'action', action: { type: 'force', target: rest } };
    case 'go':
    case 'walk':
    case 'travel':
      if (!rest) throw new CommandError('Usage: /go <direction or place>');
      return { kind: 'action', action: { type: 'go', to: rest.replace(/^to\s+/i, '') } };
    case 'solve':
    case 'answer': {
      if (!rest) throw new CommandError('Usage: /solve [puzzle:] <answer>');
      const m = /^([^:]+):\s*(.+)$/.exec(rest);
      return { kind: 'action', action: m ? { type: 'solve', puzzle: m[1].trim(), answer: m[2].trim() } : { type: 'solve', answer: rest } };
    }
    case 'hint':
    case 'study':
      return { kind: 'action', action: { type: 'hint', puzzle: rest || undefined } };
    case 'navigate':
    case 'wayfind':
      return { kind: 'action', action: { type: 'navigate' } };
    case 'read':
      if (!rest) throw new CommandError('Usage: /read <inscription>');
      return { kind: 'action', action: { type: 'read', target: rest } };
    case 'dash':
    case 'disengage':
    case 'dodge':
    case 'hide':
    case 'stand':
    case 'prone':
    case 'escape':
      return { kind: 'action', action: { type: cmd } };
    case 'end':
    case 'endturn':
    case 'done':
    case 'pass':
      return { kind: 'action', action: { type: 'endTurn' } };
    case 'grapple':
      return { kind: 'action', action: { type: 'grapple', target: tgt(rest) } };
    case 'shove': {
      const push = /\bpush\b/i.test(rest);
      return { kind: 'action', action: { type: 'shove', target: tgt(rest.replace(/\s*\bpush\b|\s*\bprone\b/ig, '').trim()), mode: push ? 'push' : 'prone' } };
    }
    case 'use':
    case 'drink': {
      const [itemPart, targetPart] = rest.split(/\s+(?:on|at)\s+/i);
      const action = { type: 'useItem', item: invRef(char, itemPart.trim()) };
      if (targetPart) action.target = tgt(targetPart.trim());
      return { kind: 'action', action };
    }
    case 'equip':
    case 'wield':
    case 'don': {
      const off = /\boffhand\b/i.test(rest);
      return { kind: 'action', action: { type: 'equip', item: invRef(char, rest.replace(/\s*\boffhand\b/i, '').trim()), slot: off ? 'offHand' : undefined } };
    }
    case 'unequip':
    case 'stow':
    case 'doff':
      return { kind: 'action', action: { type: 'unequip', item: invRef(char, rest) } };
    case 'attune':
      return { kind: 'action', action: { type: 'attune', item: invRef(char, rest) } };
    case 'unattune':
      return { kind: 'action', action: { type: 'attune', item: invRef(char, rest), on: false } };
    case 'drop': {
      const qty = Number(/\s(\d+)$/.exec(rest)?.[1] ?? 1);
      return { kind: 'action', action: { type: 'drop', item: invRef(char, rest.replace(/\s\d+$/, '')), qty } };
    }
    case 'give': {
      const m = /^(.+?)\s+to\s+(.+?)(?:\s+(\d+))?$/i.exec(rest);
      if (!m) throw new CommandError('Usage: /give <item> to <name> [qty]');
      return { kind: 'action', action: { type: 'give', item: invRef(char, m[1]), to: tgt(m[2]), qty: Number(m[3] ?? 1) } };
    }
    case 'buy':
    case 'sell': {
      const qm = /^(.+?)(?:\s+x?(\d+))?$/i.exec(rest);
      if (!qm) throw new CommandError(`Usage: /${cmd} <item> [qty]`);
      const item = cmd === 'sell' ? invRef(char, qm[1]) : qm[1];
      return { kind: 'action', action: { type: cmd, item, qty: Number(qm[2] ?? 1) } };
    }
    case 'rest': {
      if (/^long/i.test(rest)) return { kind: 'action', action: { type: 'rest', kind: 'long' } };
      const n = Number(/(\d+)/.exec(rest)?.[1] ?? 0);
      return { kind: 'action', action: { type: 'rest', kind: 'short', hitDice: n ? { [char.id]: n } : {} } };
    }
    case 'levelup':
      return { kind: 'info', topic: 'levelup' };
    default: {
      const feature = FEATURE_ALIASES[cmd];
      if (!feature) throw new CommandError(`Unknown command /${cmd}. Type /help for the list.`);
      const action = { type: 'feature', feature };
      if (['bardicInspiration', 'layOnHands', 'breathWeapon', 'spiritualWeapon'].includes(feature) && rest) {
        const m = /^(.+?)(?:\s+(\d+))?$/.exec(rest);
        const p = parsePoint(rest);
        if (feature === 'breathWeapon' && p) action.point = p;
        else action.target = tgt(m[1]);
        if (m[2]) action.amount = Number(m[2]);
      }
      if (feature === 'layOnHands' && !action.target) action.target = char.id;
      if (feature === 'stepOfTheWind') action.mode = /disengage/i.test(rest) ? 'disengage' : 'dash';
      if (feature === 'cunningAction') action.mode = rest.toLowerCase() || 'dash';
      if (feature === 'wildShape') action.beast = rest;
      if (feature === 'rage' && /frenzy/i.test(rest)) action.frenzy = true;
      return { kind: 'action', action };
    }
  }
}

export { SKILLS };
