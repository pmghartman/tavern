import { size } from './creature.js';

export const FOOTPRINT = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 };

export const footprint = c => FOOTPRINT[size(c)] ?? 1;

export function squaresOf(pos, fp) {
  const out = [];
  for (let dx = 0; dx < fp; dx++) for (let dy = 0; dy < fp; dy++) out.push({ x: pos.x + dx, y: pos.y + dy });
  return out;
}

// feet between nearest squares of two footprints, diagonals cost 5 ft
export function distanceFt(posA, fpA, posB, fpB) {
  const dx = Math.max(0, posA.x - (posB.x + fpB - 1), posB.x - (posA.x + fpA - 1));
  const dy = Math.max(0, posA.y - (posB.y + fpB - 1), posB.y - (posA.y + fpA - 1));
  return Math.max(dx, dy) * 5;
}

export function pointDistanceFt(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;
}

export function center(pos, fp) {
  return { x: pos.x + (fp - 1) / 2, y: pos.y + (fp - 1) / 2 };
}

// squares a creature at pos/fp overlaps that fall in an area
export function inArea(area, pos, fp) {
  return squaresOf(pos, fp).some(sq => squareInArea(area, sq));
}

export function squareInArea(area, sq) {
  const r = area.size / 5;
  switch (area.shape) {
    case 'sphere':
    case 'cylinder':
      return Math.max(Math.abs(sq.x - area.center.x), Math.abs(sq.y - area.center.y)) <= r;
    case 'cube': {
      const n = Math.max(1, Math.round(r));
      const lo = c => c - Math.floor((n - 1) / 2);
      const hi = c => c + Math.ceil((n - 1) / 2);
      let xr, yr;
      if (area.origin) {
        const { x: ox, y: oy } = area.origin;
        const dx = Math.sign(area.toward.x - ox);
        const dy = Math.sign(area.toward.y - oy);
        const fwd = (o, d) => (d > 0 ? [o + 1, o + n] : [o - n, o - 1]);
        if (dx && dy) [xr, yr] = [fwd(ox, dx), fwd(oy, dy)];
        else if (dx) [xr, yr] = [fwd(ox, dx), [lo(oy), hi(oy)]];
        else [xr, yr] = [[lo(ox), hi(ox)], fwd(oy, dy || 1)];
      } else {
        xr = [lo(area.center.x), hi(area.center.x)];
        yr = [lo(area.center.y), hi(area.center.y)];
      }
      return sq.x >= xr[0] && sq.x <= xr[1] && sq.y >= yr[0] && sq.y <= yr[1];
    }
    case 'cone': {
      const { origin, toward } = area;
      const vx = toward.x - origin.x;
      const vy = toward.y - origin.y;
      const len = Math.hypot(vx, vy) || 1;
      const px = sq.x - origin.x;
      const py = sq.y - origin.y;
      const d = Math.hypot(px, py);
      if (d === 0 || d > r + 0.5) return false;
      const along = (px * vx + py * vy) / len;
      if (along <= 0) return false;
      // 5e cone: width equals distance from origin, half-angle ~26.6 degrees
      const perp = Math.abs(px * vy - py * vx) / len;
      return perp <= along / 2 + 0.5 && along <= r + 0.01;
    }
    case 'line': {
      const { origin, toward } = area;
      const vx = toward.x - origin.x;
      const vy = toward.y - origin.y;
      const len = Math.hypot(vx, vy) || 1;
      const px = sq.x - origin.x;
      const py = sq.y - origin.y;
      const along = (px * vx + py * vy) / len;
      if (along <= 0 || along > r + 0.01) return false;
      const perp = Math.abs(px * vy - py * vx) / len;
      return perp <= 0.5 + 1e-9;
    }
    default:
      return false;
  }
}

export function inBounds(map, pos, fp = 1) {
  return pos.x >= 0 && pos.y >= 0 && pos.x + fp <= map.width && pos.y + fp <= map.height;
}

const key = p => `${p.x},${p.y}`;

// BFS shortest path in 5ft steps; blocked(sq) for hostile squares, occupied(sq) for final square
export function findPath(map, start, goal, fp, { blocked, canEndAt, maxCost = Infinity, costOf }) {
  if (start.x === goal.x && start.y === goal.y) return { path: [start], cost: 0 };
  const dist = new Map([[key(start), 0]]);
  const prev = new Map();
  const queue = [{ ...start, cost: 0 }];
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift();
    if (cur.x === goal.x && cur.y === goal.y) break;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = { x: cur.x + dx, y: cur.y + dy };
        if (!inBounds(map, nx, fp)) continue;
        if (squaresOf(nx, fp).some(sq => blocked(sq))) continue;
        const step = costOf ? costOf(nx) : 5;
        const nc = cur.cost + step;
        if (nc > maxCost) continue;
        const k = key(nx);
        if (dist.has(k) && dist.get(k) <= nc) continue;
        dist.set(k, nc);
        prev.set(k, key(cur));
        queue.push({ ...nx, cost: nc });
      }
    }
  }
  const gk = key(goal);
  if (!dist.has(gk)) return null;
  if (canEndAt && !canEndAt(goal)) return null;
  const path = [];
  let k = gk;
  while (k) {
    const [x, y] = k.split(',').map(Number);
    path.unshift({ x, y });
    k = prev.get(k);
  }
  return { path, cost: dist.get(gk) };
}
