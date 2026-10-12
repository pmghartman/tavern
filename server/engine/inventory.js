import { ITEMS, WEAPONS, ARMOR, COIN_VALUE, COIN_WEIGHT, MAGIC_ITEMS, findItemKey } from './data/items.js';
import { itemDef, weaponDef, armorDef, equipped, finalAbilities } from './character.js';
import { RuleError, uid } from './util.js';
import { event, inCombat, combatant, requireCreature } from './state.js';
import { requireTurn, spendAction, cbDistance } from './combat.js';
import { size } from './creature.js';

export const WONDROUS_SLOTS = { ring: 2, cloak: 1, boots: 1, hands: 1, head: 1, neck: 1, wrists: 1, waist: 1, eyes: 1 };

export function totalCp(cur) {
  return Object.entries(COIN_VALUE).reduce((s, [k, v]) => s + (cur[k] ?? 0) * v, 0);
}

// pay exact copper; coins are broken into change automatically
export function pay(cur, costCp) {
  const have = totalCp(cur);
  if (have < costCp) throw new RuleError(`Not enough money: costs ${fmtCoins(costCp)}, you have ${fmtCoins(have)}.`, 'insufficient_funds');
  let remaining = have - costCp;
  const out = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
  // keep platinum and electrum untouched when possible
  const keepPp = Math.min(cur.pp ?? 0, Math.floor(remaining / 1000));
  out.pp = keepPp;
  remaining -= keepPp * 1000;
  const keepEp = Math.min(cur.ep ?? 0, Math.floor(remaining / 50));
  out.ep = keepEp;
  remaining -= keepEp * 50;
  out.gp = Math.floor(remaining / 100);
  remaining -= out.gp * 100;
  out.sp = Math.floor(remaining / 10);
  remaining -= out.sp * 10;
  out.cp = remaining;
  Object.assign(cur, out);
  return cur;
}

export function fmtCoins(cp) {
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const c = cp % 10;
  const parts = [];
  if (gp) parts.push(`${gp} gp`);
  if (sp) parts.push(`${sp} sp`);
  if (c || !parts.length) parts.push(`${Math.round(c * 100) / 100} cp`);
  return parts.join(' ');
}

export function carriedWeight(c) {
  let w = 0;
  for (const i of c.inventory) {
    const d = itemDef(i);
    if (!d) continue;
    w += (d.weight ?? 0) * (i.qty ?? 1);
  }
  const coins = Object.values(c.currency ?? {}).reduce((s, n) => s + n, 0);
  return Math.round((w + coins * COIN_WEIGHT) * 100) / 100;
}

export function carryingCapacity(c) {
  const mult = { Tiny: 0.5, Small: 1, Medium: 1, Large: 2, Huge: 4, Gargantuan: 8 }[size(c)] ?? 1;
  return finalAbilities(c).str * 15 * mult;
}

function ensureCapacity(c, extraLb) {
  const cap = carryingCapacity(c);
  if (carriedWeight(c) + extraLb > cap) throw new RuleError(`${c.name} cannot carry that much (capacity ${cap} lb, carrying ${carriedWeight(c)} lb).`, 'over_capacity');
}

function stackable(key) {
  const d = ITEMS[key];
  return d && (d.kind === 'gear' || d.kind === 'potion' || d.kind === 'treasure' || d.kind === 'scroll' || ['dagger', 'dart', 'javelin', 'handaxe', 'lightHammer'].includes(key));
}

export function addItem(c, key, qty = 1, custom = null, { ignoreCapacity = false } = {}) {
  const d = ITEMS[key];
  if (!d) throw new RuleError(`"${key}" is not an item in this rule set.`, 'unknown_item');
  if (!Number.isInteger(qty) || qty < 1 || qty > 1000) throw new RuleError('Quantity must be 1-1000.');
  const w = (custom?.weight ?? d.weight ?? 0) * qty;
  if (!ignoreCapacity) ensureCapacity(c, w);
  if (!custom && stackable(key)) {
    const ex = c.inventory.find(i => i.key === key && !i.custom);
    if (ex) {
      ex.qty += qty;
      return ex;
    }
    const it = { id: uid('it_'), key, qty };
    if (d.charges !== undefined) it.charges = d.charges;
    c.inventory.push(it);
    return it;
  }
  let last;
  for (let n = 0; n < qty; n++) {
    last = { id: uid('it_'), key, qty: 1, ...(custom ? { custom: { ...custom } } : {}) };
    if (d.charges !== undefined) last.charges = d.charges;
    c.inventory.push(last);
  }
  return last;
}

// a story item: a name and notes with no rules attached, added by its owner or the DM
export function addStoryItem(ctx, charId, { name, description = '', qty = 1, weight = 0 }, { by = 'self' } = {}) {
  const c = requireCreature(ctx.state, charId);
  const n = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!n || n.length > 60) throw new RuleError('A story item needs a name of 1-60 characters.');
  if (ITEMS[findItemKey(n)] && by === 'self') throw new RuleError(`${ITEMS[findItemKey(n)].name} is a rules item; the DM hands those out.`);
  if (by === 'self' && inCombat(ctx.state) && combatant(ctx.state, c.id)) throw new RuleError('Sort your pack once the fight is over.');
  const w = Math.max(0, Math.min(50, Number(weight) || 0));
  const it = addItem(c, 'curio', Math.max(1, Math.min(20, Number(qty) || 1)), { name: n, description: String(description ?? '').trim().slice(0, 300), weight: w, story: true });
  event(ctx, 'loot', by === 'self' ? `${c.name} adds ${n} to their pack.` : `${c.name} receives ${n}.`);
  return it;
}

// the DM takes something away (confiscated, used up, lost)
export function takeItem(ctx, charId, ref, qty = 1) {
  const c = requireCreature(ctx.state, charId);
  const inv = findInv(c, ref);
  const name = itemDef(inv)?.name ?? ref;
  if (inv.equipped) delete inv.equipped;
  removeItem(c, inv.id, Math.min(qty, inv.qty));
  event(ctx, 'loot', `${c.name} loses ${qty > 1 ? `${qty}x ` : ''}${name}.`);
}

export function removeItem(c, invId, qty = 1) {
  const inv = c.inventory.find(i => i.id === invId || i.key === invId);
  if (!inv) throw new RuleError(`${c.name} does not have that item.`);
  if (qty > inv.qty) throw new RuleError(`${c.name} only has ${inv.qty}.`);
  inv.qty -= qty;
  if (inv.qty <= 0) c.inventory = c.inventory.filter(i => i !== inv);
  return inv;
}

function findInv(c, ref) {
  const inv = c.inventory.find(i => i.id === ref) ?? c.inventory.find(i => i.key === ref) ?? c.inventory.find(i => itemDef(i)?.name.toLowerCase() === String(ref).toLowerCase());
  if (!inv) throw new RuleError(`${c.name} has no "${ref}".`);
  return inv;
}

function combatGate(ctx, c, kind) {
  if (!inCombat(ctx.state) || !combatant(ctx.state, c.id)) return;
  const { ts } = requireTurn(ctx.state, c.id);
  if (kind === 'armor') throw new RuleError('Donning or doffing armor takes minutes; not possible in combat.');
  if (kind === 'attune') throw new RuleError('Attunement requires a short rest.');
  if (kind === 'shield') return spendAction(ts, 'action', c, 'don a shield');
  if (ts.freeInteraction > 0) ts.freeInteraction -= 1;
  else spendAction(ts, 'action', c, 'interact with another object');
}

export function equip(ctx, charId, ref, slot) {
  const c = requireCreature(ctx.state, charId);
  const inv = findInv(c, ref);
  const d = itemDef(inv);
  const w = weaponDef(inv);
  const a = armorDef(inv);
  if (inv.equipped) throw new RuleError(`${d.name} is already equipped.`);
  if (w) {
    combatGate(ctx, c, 'weapon');
    const target = slot ?? (equipped(c, 'mainHand') ? 'offHand' : 'mainHand');
    if (!['mainHand', 'offHand'].includes(target)) throw new RuleError('Weapons go in mainHand or offHand.');
    if (w.properties.includes('twoHanded')) {
      for (const s of ['mainHand', 'offHand']) {
        const o = equipped(c, s);
        if (o) delete o.equipped;
      }
      inv.equipped = 'mainHand';
    } else {
      const main = equipped(c, 'mainHand');
      if (main && weaponDef(main)?.properties.includes('twoHanded')) delete main.equipped;
      const occ = equipped(c, target);
      if (occ) delete occ.equipped;
      inv.equipped = target;
    }
  } else if (a) {
    if (a.category === 'shield') {
      combatGate(ctx, c, 'shield');
      const main = equipped(c, 'mainHand');
      if (main && weaponDef(main)?.properties.includes('twoHanded')) throw new RuleError('You cannot hold a shield while wielding a two-handed weapon.');
      const occ = equipped(c, 'offHand');
      if (occ) delete occ.equipped;
      inv.equipped = 'offHand';
    } else {
      combatGate(ctx, c, 'armor');
      const occ = equipped(c, 'armor');
      if (occ) delete occ.equipped;
      inv.equipped = 'armor';
    }
  } else if (d.slot) {
    combatGate(ctx, c, 'wondrous');
    const used = c.inventory.filter(i => i.equipped && itemDef(i)?.slot === d.slot).length;
    if (used >= (WONDROUS_SLOTS[d.slot] ?? 1)) throw new RuleError(`You can only wear ${WONDROUS_SLOTS[d.slot] ?? 1} ${d.slot} item(s).`);
    inv.equipped = d.slot;
  } else throw new RuleError(`${d.name} cannot be equipped.`);
  event(ctx, 'inventory', `${c.name} equips ${w?.name ?? a?.name ?? d.name}.`);
  return inv;
}

export function unequip(ctx, charId, ref) {
  const c = requireCreature(ctx.state, charId);
  const inv = findInv(c, ref);
  if (!inv.equipped) throw new RuleError('That item is not equipped.');
  const a = armorDef(inv);
  combatGate(ctx, c, a && a.category !== 'shield' ? 'armor' : a ? 'shield' : 'weapon');
  delete inv.equipped;
  event(ctx, 'inventory', `${c.name} unequips ${itemDef(inv).name}.`);
}

export function attune(ctx, charId, ref, on = true) {
  const c = requireCreature(ctx.state, charId);
  const inv = findInv(c, ref);
  const d = itemDef(inv);
  if (!d.attunement) throw new RuleError(`${d.name} does not require attunement.`);
  combatGate(ctx, c, 'attune');
  if (on) {
    if (inv.attuned) throw new RuleError('Already attuned.');
    if (c.inventory.filter(i => i.attuned).length >= 3) throw new RuleError('You can be attuned to at most three magic items.');
    inv.attuned = true;
    ctx.state.clock.minute = (ctx.state.clock.minute ?? 0) + 60;
    event(ctx, 'inventory', `${c.name} spends a short rest attuning to ${d.name}.`);
  } else {
    inv.attuned = false;
    event(ctx, 'inventory', `${c.name} ends attunement to ${d.name}.`);
  }
}

export function giveItem(ctx, fromId, toId, ref, qty = 1) {
  const state = ctx.state;
  const a = requireCreature(state, fromId);
  const b = requireCreature(state, toId);
  if (!b.inventory) throw new RuleError(`${b.name} cannot take items.`);
  const inv = findInv(a, ref);
  if (inCombat(state) && combatant(state, fromId)) {
    if (cbDistance(state, fromId, toId) > 5) throw new RuleError(`${b.name} must be within reach to hand them something.`);
    combatGate(ctx, a, 'item');
  }
  if (inv.equipped) delete inv.equipped;
  const d = itemDef(inv);
  ensureCapacity(b, (d.weight ?? 0) * qty);
  if (inv.qty > qty) {
    inv.qty -= qty;
    addItem(b, inv.key, qty, inv.custom ?? null, { ignoreCapacity: true });
  } else if (inv.qty === qty) {
    a.inventory = a.inventory.filter(i => i !== inv);
    if (inv.attuned) inv.attuned = false;
    const ex = !inv.custom && stackable(inv.key) && b.inventory.find(i => i.key === inv.key && !i.custom);
    if (ex) ex.qty += qty;
    else b.inventory.push(inv);
  } else throw new RuleError(`${a.name} only has ${inv.qty}.`);
  event(ctx, 'inventory', `${a.name} gives ${qty > 1 ? `${qty}x ` : ''}${d.name} to ${b.name}.`);
}

export function dropItem(ctx, charId, ref, qty = 1) {
  const c = requireCreature(ctx.state, charId);
  const inv = findInv(c, ref);
  if (inv.equipped && inCombat(ctx.state)) void 0;
  const d = itemDef(inv);
  removeItem(c, inv.id, qty);
  event(ctx, 'inventory', `${c.name} drops ${qty > 1 ? `${qty}x ` : ''}${d.name}.`);
}

export function giveCoins(ctx, fromId, toId, coins) {
  const a = requireCreature(ctx.state, fromId);
  const b = requireCreature(ctx.state, toId);
  for (const [k, v] of Object.entries(coins)) {
    if (!COIN_VALUE[k] || !Number.isInteger(v) || v < 0) throw new RuleError('Invalid coins.');
    if ((a.currency[k] ?? 0) < v) throw new RuleError(`${a.name} does not have ${v} ${k}.`);
  }
  for (const [k, v] of Object.entries(coins)) {
    a.currency[k] -= v;
    b.currency[k] = (b.currency[k] ?? 0) + v;
  }
  event(ctx, 'inventory', `${a.name} gives ${Object.entries(coins).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ')} to ${b.name}.`);
}

export function shopPrice(shop, key) {
  const d = ITEMS[key];
  if (!d) return null;
  if (shop.items && !shop.items.includes(key)) return null;
  if (!shop.items) {
    const mundane = ['weapon', 'armor', 'gear'].includes(d.kind);
    if (!mundane && !(shop.magic && d.rarity && ['common', 'uncommon'].includes(d.rarity))) return null;
  }
  if (!d.cost) return null;
  return Math.round(d.cost * (shop.priceMod ?? 1));
}

export function buy(ctx, charId, itemRef, qty = 1) {
  const state = ctx.state;
  const shop = state.scene?.shop;
  if (!shop) throw new RuleError('There is no merchant here. The DM must open a shop first.', 'no_shop');
  if (inCombat(state)) throw new RuleError('No shopping during combat.');
  const c = requireCreature(state, charId);
  const key = findItemKey(itemRef);
  if (!key) throw new RuleError(`"${itemRef}" is not an item in this rule set.`, 'unknown_item');
  const price = shopPrice(shop, key);
  if (price === null) throw new RuleError(`${shop.name ?? 'This merchant'} does not sell ${ITEMS[key].name}.`);
  const d = ITEMS[key];
  const bundle = d.stack ?? 1;
  const units = qty * bundle;
  const cost = Math.ceil(price * units);
  ensureCapacity(c, (d.weight ?? 0) * units);
  pay(c.currency, cost);
  addItem(c, key, units, null, { ignoreCapacity: true });
  event(ctx, 'inventory', `${c.name} buys ${units > 1 ? `${units}x ` : ''}${d.name} for ${fmtCoins(cost)}.`);
}

export function sell(ctx, charId, ref, qty = 1) {
  const state = ctx.state;
  const shop = state.scene?.shop;
  if (!shop) throw new RuleError('There is no merchant here to buy from you.', 'no_shop');
  if (inCombat(state)) throw new RuleError('No trading during combat.');
  const c = requireCreature(state, charId);
  const inv = findInv(c, ref);
  const d = itemDef(inv);
  if (!d.cost) throw new RuleError(`${d.name} has no market value.`);
  if (inv.equipped) throw new RuleError('Unequip it first.');
  const unit = d.kind === 'treasure' ? d.cost : Math.floor(d.cost / 2);
  removeItem(c, inv.id, qty);
  const got = unit * qty;
  c.currency.cp += got % 10;
  c.currency.sp += Math.floor((got % 100) / 10);
  c.currency.gp += Math.floor(got / 100);
  event(ctx, 'inventory', `${c.name} sells ${qty > 1 ? `${qty}x ` : ''}${d.name} for ${fmtCoins(got)}.`);
}

export function prepareSpells(ctx, charId, list) {
  const state = ctx.state;
  const c = requireCreature(state, charId);
  if (inCombat(state)) throw new RuleError('You cannot change prepared spells during combat.');
  if (!c.preparationOpen) throw new RuleError('Prepared spells can only be changed after a long rest.', 'prep_closed');
  return { c, list };
}

export { WEAPONS, ARMOR, MAGIC_ITEMS };
