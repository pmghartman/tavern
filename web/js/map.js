export const FULL_CELL = 34;
export const MINI_CELL = 12;
// room for the column and row numbers, outside the grid
export const GUTTER = 16;

function creatureOf(view, id) {
  const cb = view.encounter.combatants[id];
  return cb.creature ?? view.characters.find(c => c.id === id);
}

function inArea(area, x, y) {
  const r = area.size / 5;
  if (area.center && (area.shape === 'sphere' || area.shape === 'cylinder')) return Math.max(Math.abs(x - area.center.x), Math.abs(y - area.center.y)) <= r;
  if (area.center && area.shape === 'cube') {
    const n = Math.max(1, Math.round(r));
    const lo = c => c - Math.floor((n - 1) / 2);
    const hi = c => c + Math.ceil((n - 1) / 2);
    return x >= lo(area.center.x) && x <= hi(area.center.x) && y >= lo(area.center.y) && y <= hi(area.center.y);
  }
  return false;
}

// a token's label: "Goblin 3" -> G3, "Bimpnottin Daergel" -> BD
export function tokenLabel(name) {
  const words = String(name).trim().split(/\s+/);
  const num = /^\d+$/.test(words[words.length - 1]) ? words.pop() : '';
  if (num) return `${words[0]?.[0] ?? ''}${num}`.toUpperCase();
  return words.slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

const SIDE_FILL = { me: '#2f6f8f', party: '#4c7a35', enemy: '#9c3f31', other: '#7a6e5a' };
const SIDE_EDGE = { me: '#1d4a60', party: '#2f5221', enemy: '#64241b', other: '#4e4637' };

export function drawMap(canvas, view, { me, mode, cell = 34, mini = false } = {}) {
  const CELL = cell;
  const GUT = mini ? 0 : GUTTER;
  const enc = view.encounter;
  const W = enc.map.width;
  const H = enc.map.height;
  const dpr = window.devicePixelRatio || 1;
  const PW = W * CELL + GUT;
  const PH = H * CELL + GUT;
  canvas.width = Math.round(PW * dpr);
  canvas.height = Math.round(PH * dpr);
  canvas.style.width = `${PW}px`;
  canvas.style.height = `${PH}px`;
  // what mapHit needs to turn a pointer into a square
  canvas._cell = CELL;
  canvas._gutter = GUT;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const dark = enc.map.light === 'dark';
  // the margin with the numbers
  if (GUT) {
    g.fillStyle = dark ? '#a8936c' : '#e2d3ae';
    g.fillRect(0, 0, PW, PH);
    g.fillStyle = '#6f5a3b';
    g.font = `600 ${Math.min(10, Math.max(8, Math.round(CELL * 0.32)))}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const step = CELL < 22 ? 2 : 1;
    for (let x = 0; x < W; x += step) g.fillText(x, GUT + x * CELL + CELL / 2, GUT / 2 + 0.5);
    for (let y = 0; y < H; y += step) g.fillText(y, GUT / 2, GUT + y * CELL + CELL / 2 + 0.5);
    g.textAlign = 'start';
    g.textBaseline = 'alphabetic';
  }
  g.translate(GUT, GUT);
  g.fillStyle = dark ? '#b8a27a' : '#ecdfbf';
  g.fillRect(0, 0, W * CELL, H * CELL);
  // terrain: rough ground hatched, cover as solid blocks
  for (const [x, y] of enc.map.difficult ?? []) {
    g.fillStyle = dark ? '#a8916a' : '#dccba1';
    g.fillRect(x * CELL, y * CELL, CELL, CELL);
    g.strokeStyle = 'rgba(111, 90, 59, 0.35)';
    g.lineWidth = 1;
    g.beginPath();
    for (let k = 0.25; k < 1; k += 0.25) {
      g.moveTo(x * CELL + k * CELL, y * CELL + CELL - 2);
      g.lineTo(x * CELL + k * CELL + CELL * 0.12, y * CELL + CELL * 0.6);
    }
    g.stroke();
  }
  for (const [x, y] of enc.map.cover ?? []) {
    g.fillStyle = '#9c8257';
    g.fillRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4);
  }
  // zones and auras
  for (const z of enc.zones ?? []) {
    g.fillStyle = 'rgba(156,106,28,0.18)';
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      let inside = false;
      if (z.area) inside = inArea(z.area, x, y);
      else if (z.attachedTo) {
        const a = enc.combatants[z.attachedTo];
        if (a) inside = Math.max(Math.abs(x - a.pos.x), Math.abs(y - a.pos.y)) * 5 <= z.radius;
      }
      if (inside) g.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
  // grid, with a darker line every five squares (25 ft) for counting
  const line = i => (i % 5 === 0 ? (dark ? '#7d6a4a' : '#b49c6c') : dark ? '#9a8460' : '#d6c398');
  g.lineWidth = 1;
  for (let x = 0; x <= W; x++) {
    g.strokeStyle = line(x);
    g.beginPath();
    g.moveTo(x * CELL + 0.5, 0);
    g.lineTo(x * CELL + 0.5, H * CELL);
    g.stroke();
  }
  for (let y = 0; y <= H; y++) {
    g.strokeStyle = line(y);
    g.beginPath();
    g.moveTo(0, y * CELL + 0.5);
    g.lineTo(W * CELL, y * CELL + 0.5);
    g.stroke();
  }
  // move range hint
  const cur = enc.order[enc.turn];
  if (mode?.kind === 'move' && cur === me) {
    const cb = enc.combatants[me];
    const left = Math.floor(((cb.turnState?.movement ?? 0) - (cb.turnState?.moved ?? 0)) / 5);
    g.fillStyle = 'rgba(76,122,53,0.18)';
    for (let x = cb.pos.x - left; x <= cb.pos.x + left; x++) for (let y = cb.pos.y - left; y <= cb.pos.y + left; y++) if (x >= 0 && y >= 0 && x < W && y < H) g.fillRect(x * CELL, y * CELL, CELL, CELL);
  }
  // targeting: shade what is within range of the chosen action
  if (mode?.kind === 'target' && mode.range && cur === me) {
    const cb = enc.combatants[me];
    const reach = Math.floor(mode.range / 5);
    const fp = cb.fp ?? 1;
    g.fillStyle = 'rgba(106,63,160,0.13)';
    for (let x = cb.pos.x - reach; x < cb.pos.x + fp + reach; x++) for (let y = cb.pos.y - reach; y < cb.pos.y + fp + reach; y++) if (x >= 0 && y >= 0 && x < W && y < H) g.fillRect(x * CELL, y * CELL, CELL, CELL);
  }
  for (const s of enc.summons ?? []) {
    g.strokeStyle = '#6a3fa0';
    g.lineWidth = 2;
    g.strokeRect(s.pos.x * CELL + CELL * 0.22, s.pos.y * CELL + CELL * 0.22, CELL * 0.56, CELL * 0.56);
  }
  // tokens: the fallen first, so the living are drawn over them
  const down = id => {
    const c = creatureOf(view, id);
    return c.dead || c.hp <= 0 ? 1 : 0;
  };
  const ids = enc.order.filter(id => !enc.combatants[id].removed && creatureOf(view, id)).sort((a, b) => down(b) - down(a));
  for (const id of ids) {
    const cb = enc.combatants[id];
    const c = creatureOf(view, id);
    const fp = cb.fp ?? 1;
    const cx = (cb.pos.x + fp / 2) * CELL;
    const cy = (cb.pos.y + fp / 2) * CELL;
    const r = Math.max(2.5, (fp * CELL) / 2 - (mini ? 1.5 : Math.max(3, CELL * 0.12)));
    const dead = c.dead || (cb.kind !== 'pc' && c.hp <= 0);
    const dying = !dead && cb.kind === 'pc' && c.hp <= 0;
    const side = id === me ? 'me' : SIDE_FILL[cb.side] ? cb.side : 'other';
    g.globalAlpha = dead ? 0.35 : 1;
    // whose turn it is: a gold halo
    if (id === cur && !dead) {
      g.save();
      g.shadowColor = 'rgba(212, 160, 23, 0.9)';
      g.shadowBlur = mini ? 3 : 8;
      g.beginPath();
      g.arc(cx, cy, r + (mini ? 1 : 3), 0, Math.PI * 2);
      g.lineWidth = mini ? 1.5 : 2.5;
      g.strokeStyle = '#d4a017';
      g.stroke();
      g.restore();
    }
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = dying ? '#8c8273' : SIDE_FILL[side];
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = SIDE_EDGE[side];
    g.stroke();
    if (mode?.picked?.includes(id)) {
      g.beginPath();
      g.arc(cx, cy, r + 5, 0, Math.PI * 2);
      g.lineWidth = 2.5;
      g.strokeStyle = '#6a3fa0';
      g.stroke();
    }
    // health shows only once a creature is hurt
    if (!dead && !dying && c.maxHp && c.hp < c.maxHp && !mini) {
      const ratio = Math.max(0, c.hp / c.maxHp);
      g.beginPath();
      g.arc(cx, cy, r - 1.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      g.lineWidth = Math.max(2, CELL * 0.08);
      g.strokeStyle = ratio > 0.5 ? '#7fc06a' : ratio > 0.25 ? '#e0a83a' : '#e4553c';
      g.stroke();
    }
    // a dying character: greyed, ringed in red
    if (dying) {
      g.save();
      g.setLineDash([3, 3]);
      g.beginPath();
      g.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
      g.lineWidth = 2;
      g.strokeStyle = '#b3321e';
      g.stroke();
      g.restore();
    }
    if (mini) {
      g.globalAlpha = 1;
      continue;
    }
    // the label shrinks until it sits inside the token
    const label = tokenLabel(cb.name);
    let size = Math.max(8, Math.min(fp > 1 ? 20 : 13, Math.round(CELL * (fp > 1 ? 0.5 : 0.38))));
    g.font = `700 ${size}px sans-serif`;
    while (size > 7 && g.measureText(label).width > r * 1.6) g.font = `700 ${--size}px sans-serif`;
    g.fillStyle = '#fbf5e4';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // too small to read: the colour and the hover card say who it is
    if (g.measureText(label).width <= r * 2.1) g.fillText(label, cx, cy + 0.5);
    if (dead) {
      g.strokeStyle = '#2e2115';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx - r / 2, cy - r / 2);
      g.lineTo(cx + r / 2, cy + r / 2);
      g.moveTo(cx + r / 2, cy - r / 2);
      g.lineTo(cx - r / 2, cy + r / 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.textAlign = 'start';
    g.textBaseline = 'alphabetic';
  }
}

export function mapHit(canvas, e, view) {
  const enc = view.encounter;
  if (!enc) return null;
  const CELL = canvas._cell ?? FULL_CELL;
  const GUT = canvas._gutter ?? 0;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left - GUT) / CELL);
  const y = Math.floor((e.clientY - rect.top - GUT) / CELL);
  if (x < 0 || y < 0 || x >= enc.map.width || y >= enc.map.height) return null;
  for (const id of enc.order) {
    const cb = enc.combatants[id];
    if (cb.removed) continue;
    const fp = cb.fp ?? 1;
    if (x >= cb.pos.x && x < cb.pos.x + fp && y >= cb.pos.y && y < cb.pos.y + fp) {
      const c = creatureOf(view, id);
      const label = cb.kind === 'pc' ? (c.dead ? 'dead' : c.hp <= 0 ? (c.stable ? 'unconscious, stable' : 'dying') : `HP ${c.hp}/${c.maxHp}`) : c.dead || c.hp <= 0 ? 'dead' : c.hp / c.maxHp > 0.5 ? (c.hp === c.maxHp ? 'unhurt' : 'wounded') : 'bloodied';
      return { x, y, combatant: { id, name: cb.name, side: cb.side }, label };
    }
  }
  return { x, y };
}
