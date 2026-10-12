import * as X from './exploration.js';
import { RuleError } from './util.js';
import { creatureById, combatant, inCombat, currentCid, event } from './state.js';
import { endTurn, moveCombatant, checkEncounterEnd, rollDeathSave } from './combat.js';
import { performAttack, oaHandler } from './attack.js';
import { castSpell, moveSpiritualWeapon, sorceryConvert, maybeHellishRebuke } from './spellcasting.js';
import * as F from './features.js';
import * as I from './inventory.js';
import { shortRest, longRest } from './rest.js';
import { levelUp } from './leveling.js';
import { validateSpellChoices, alwaysPreparedSpells, spellListsFor } from './character.js';
import { cl, castingOf } from './classlevel.js';
import { CLASSES } from './data/classes.js';
import { cryptoRng } from './rng.js';

const FEATURES = {
  secondWind: (ctx, id) => F.secondWind(ctx, id),
  actionSurge: (ctx, id) => F.actionSurge(ctx, id),
  rage: (ctx, id, p) => F.rage(ctx, id, p),
  endRage: (ctx, id) => F.endRage(ctx, id),
  bardicInspiration: (ctx, id, p) => F.bardicInspiration(ctx, id, p),
  turnUndead: (ctx, id) => F.turnUndead(ctx, id),
  turnTheUnholy: (ctx, id) => F.turnUndead(ctx, id, { unholy: true }),
  preserveLife: (ctx, id, p) => F.preserveLife(ctx, id, p),
  sacredWeapon: (ctx, id) => F.sacredWeapon(ctx, id),
  vowOfEnmity: (ctx, id, p) => F.vowOfEnmity(ctx, id, p),
  tidesOfChaos: (ctx, id) => F.tidesOfChaos(ctx, id),
  layOnHands: (ctx, id, p) => F.layOnHands(ctx, id, p),
  flurryOfBlows: (ctx, id) => F.flurryOfBlows(ctx, id),
  patientDefense: (ctx, id) => F.patientDefense(ctx, id),
  stepOfTheWind: (ctx, id, p) => F.stepOfTheWind(ctx, id, p),
  cunningAction: (ctx, id, p) => F.cunningAction(ctx, id, p),
  nimbleEscape: (ctx, id, p) => F.nimbleEscape(ctx, id, p),
  wildShape: (ctx, id, p) => F.wildShape(ctx, id, p),
  revertWildShape: (ctx, id) => F.revertWildShape(ctx, id),
  breathWeapon: (ctx, id, p) => F.breathWeapon(ctx, id, p),
  wholenessOfBody: (ctx, id) => F.wholenessOfBody(ctx, id),
  fontOfMagic: (ctx, id, p) => sorceryConvert(ctx, id, p),
  spiritualWeapon: (ctx, id, p) => moveSpiritualWeapon(ctx, id, p),
  special: (ctx, id, p) => F.monsterSpecial(ctx, id, p),
};

export function execute(ctx, actorId, action) {
  const state = ctx.state;
  const actor = creatureById(state, actorId);
  if (!actor) throw new RuleError('Unknown character.', 'not_found');
  if (actor.dead && !['equip', 'unequip', 'give', 'drop', 'endTurn'].includes(action.type)) throw new RuleError(`${actor.name} is dead.`);
  const t = action.type;
  const combatOnly = ['move', 'dash', 'disengage', 'dodge', 'help', 'hide', 'stand', 'prone', 'grapple', 'shove', 'escape', 'endTurn'];
  if (combatOnly.includes(t) && !inCombat(state)) throw new RuleError(`"${t}" only applies in combat. Describe what you do and the DM will adjudicate.`, 'no_combat');
  if (inCombat(state) && combatant(state, actorId) && !['equip', 'unequip', 'setPreference'].includes(t)) {
    const cur = currentCid(state);
    if (cur !== actorId && t !== 'useItem') throw new RuleError(`It is ${creatureById(state, cur)?.name}'s turn. Wait for yours.`, 'not_your_turn');
  }
  if (t === 'deathSave') {
    if (!inCombat(state)) throw new RuleError('Death saving throws are rolled on your turn in combat.', 'no_combat');
    return rollDeathSave(ctx, actorId);
  }
  if (actor.hp <= 0 && actor.kind === 'pc' && !['setPreference', 'endTurn'].includes(t)) throw new RuleError(`${actor.name} is unconscious and dying.${combatant(state, actorId)?.turnState?.deathSavePending && currentCid(state) === actorId ? ' Roll your death saving throw.' : ''}`, 'unconscious');
  switch (t) {
    case 'attack':
      return performAttack(ctx, actorId, action);
    case 'cast':
      return castSpell(ctx, actorId, action);
    case 'move':
      return moveCombatant(ctx, actorId, action.to, { oaHandler: oaHandler(ctx) });
    case 'dash':
      return F.dash(ctx, actorId);
    case 'disengage':
      return F.disengage(ctx, actorId);
    case 'dodge':
      return F.dodge(ctx, actorId);
    case 'help':
      return F.help(ctx, actorId, action);
    case 'stabilize':
      return F.stabilizeAlly(ctx, actorId, action);
    case 'hide':
      return F.hide(ctx, actorId);
    case 'search':
      return inCombat(state) ? F.search(ctx, actorId) : X.search(ctx, actorId, action);
    case 'disarm':
      return X.disarm(ctx, actorId, action);
    case 'pickLock':
      return X.pickLock(ctx, actorId, action);
    case 'force':
      return X.forceOpen(ctx, actorId, action);
    case 'go':
      return X.go(ctx, actorId, action);
    case 'solve':
      return X.solve(ctx, actorId, action);
    case 'hint':
      return X.hint(ctx, actorId, action);
    case 'read':
      return X.read(ctx, actorId, action);
    case 'navigate':
      return X.navigate(ctx, actorId);
    case 'stand':
      return F.standUp(ctx, actorId);
    case 'prone':
      return F.dropProne(ctx, actorId);
    case 'grapple':
      return F.grapple(ctx, actorId, action);
    case 'shove':
      return F.shove(ctx, actorId, action);
    case 'escape':
      return F.escape(ctx, actorId);
    case 'endTurn':
      return endTurn(ctx, actorId);
    case 'feature': {
      const fn = Object.hasOwn(FEATURES, action.feature) ? FEATURES[action.feature] : null;
      if (!fn) throw new RuleError(`Unknown feature "${action.feature}".`);
      return fn(ctx, actorId, action);
    }
    case 'useItem':
      return F.useItem(ctx, actorId, action);
    case 'equip':
      return I.equip(ctx, actorId, action.item, action.slot);
    case 'unequip':
      return I.unequip(ctx, actorId, action.item);
    case 'attune':
      return I.attune(ctx, actorId, action.item, action.on !== false);
    case 'give':
      return I.giveItem(ctx, actorId, action.to, action.item, action.qty ?? 1);
    case 'giveCoins':
      return I.giveCoins(ctx, actorId, action.to, action.coins);
    case 'drop':
      return I.dropItem(ctx, actorId, action.item, action.qty ?? 1);
    case 'addItem':
      return I.addStoryItem(ctx, actorId, action);
    case 'buy':
      return I.buy(ctx, actorId, action.item, action.qty ?? 1);
    case 'sell':
      return I.sell(ctx, actorId, action.item, action.qty ?? 1);
    case 'rest':
      if (action.kind === 'short') return shortRest(ctx, action);
      if (action.kind === 'long') return longRest(ctx);
      throw new RuleError('Rest must be short or long.');
    case 'prepare': {
      I.prepareSpells(ctx, actorId, action.spells);
      const cls = action.class ?? actor.class;
      const lvl = cl(actor, cls);
      const sc = castingOf(actor, cls);
      if (!lvl) throw new RuleError(`You have no levels in ${cls}.`);
      if (!sc?.prepared) throw new RuleError(`${CLASSES[cls].name}s do not prepare spells.`);
      const always = new Set(alwaysPreparedSpells(actor));
      const list = (action.spells ?? []).filter(s => !always.has(s));
      const lists = spellListsFor(actor, cls);
      const errs = validateSpellChoices({ class: cls, level: lvl, race: actor.race, baseAbilities: actor.baseAbilities, raceAsiChoices: actor.raceAsiChoices, raceAsi: actor.raceAsi, asiHistory: actor.asiHistory, raceFeat: actor.raceFeat, cantrips: lists.cantrips ?? [], spellsKnown: [], spellbook: sc.spellbook ? lists.spellbook ?? [] : [], spellsPrepared: list }).filter(e => !/spellbook must contain exactly/.test(e));
      if (errs.length) throw new RuleError(errs.join(' '));
      if (cls === actor.class) actor.spells.prepared = list;
      else {
        actor.spells.byClass = actor.spells.byClass ?? {};
        actor.spells.byClass[cls] = { ...lists, prepared: list };
      }
      event(ctx, 'info', `${actor.name} prepares: ${list.join(', ') || 'nothing'}.`);
      return;
    }
    case 'levelUp': {
      const out = levelUp(actor, action.choices ?? {}, { rng: ctx.rng, campaign: state.campaign });
      event(ctx, 'level', `${actor.name} reaches level ${actor.level}! (+${out.hpGain} max HP${out.features.length ? `; ${out.features.join(', ')}` : ''})`);
      return out;
    }
    case 'setPreference': {
      const allowed = ['autoShield', 'autoUncannyDodge', 'autoOpportunityAttack', 'autoIndomitable', 'autoHellishRebuke', 'autoLucky', 'powerAttack'];
      if (!allowed.includes(action.key)) throw new RuleError('Unknown preference.');
      actor.preferences = actor.preferences ?? {};
      actor.preferences[action.key] = !!action.value;
      return;
    }
    case 'igniteWeapon': {
      const has = actor.inventory?.some(i => i.key === 'flameTongue' && i.equipped && i.attuned);
      if (!has) throw new RuleError('You need an attuned, wielded Flame Tongue.');
      if (inCombat(state)) {
        const cb = combatant(state, actorId);
        if (cb.turnState.bonus <= 0) throw new RuleError('No bonus action left.');
        cb.turnState.bonus -= 1;
      }
      actor.flameTongueLit = !actor.flameTongueLit;
      event(ctx, 'info', `${actor.name}'s blade ${actor.flameTongueLit ? 'bursts into flame' : 'goes dark'}.`);
      return;
    }
    default:
      throw new RuleError(`Unknown action "${t}".`);
  }
}

// a creature that drops on its own turn cannot continue it
export function autoAdvance(ctx) {
  const state = ctx.state;
  // whatever changed the state (an opportunity attack, a zone, DM damage), a fight with one side left is over
  if (inCombat(state)) checkEncounterEnd(ctx);
  for (let i = 0; i < 50 && inCombat(state); i++) {
    const cur = currentCid(state);
    const c = creatureById(state, cur);
    if (!c || !(c.dead || c.hp <= 0)) return;
    // a dying character waits for its player to roll the death save
    if (!c.dead && combatant(state, cur)?.turnState?.deathSavePending) return;
    endTurn(ctx, cur, { auto: true });
  }
}

// run an action atomically on a cloned state
export function performAction(state, actorId, action, { rng = cryptoRng } = {}) {
  const draft = structuredClone(state);
  const ctx = { state: draft, rng, events: [] };
  ctx.hooks = { onDamaged: (target, attacker) => maybeHellishRebuke(ctx, target, attacker) };
  try {
    const result = execute(ctx, actorId, action);
    if (inCombat(draft)) checkEncounterEnd(ctx);
    autoAdvance(ctx);
    return { ok: true, state: draft, events: ctx.events, result };
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.message, code: e.code, state, events: [] };
    throw e;
  }
}

export function runAtomic(state, fn, { rng = cryptoRng } = {}) {
  const draft = structuredClone(state);
  const ctx = { state: draft, rng, events: [] };
  ctx.hooks = { onDamaged: (target, attacker) => maybeHellishRebuke(ctx, target, attacker) };
  try {
    const result = fn(ctx);
    if (inCombat(draft)) checkEncounterEnd(ctx);
    return { ok: true, state: draft, events: ctx.events, result };
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.message, code: e.code, state, events: [] };
    throw e;
  }
}
