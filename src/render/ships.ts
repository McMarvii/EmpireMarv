import { epochStyle, type EraStyle } from '../data/epochs';
import type { Look } from '../data/units';
import type { Project } from './camera';
import { shade } from './colors';
import { box3d, circle, ellipse, flag, line, poly, roofGable, roofPyramid, type BuildingLook, type Ctx, type Pt, type UnitLook } from './sprites';

/**
 * Ships and harbours. A ship is one hull drawn from its outline (bow,
 * beam, stern) and lifted as a prism, dressed by era: dugouts and rafts,
 * rowed galleys, sailing ships with castles, gun decks, grey steel and
 * hovering white hulls. Ships rock on the swell and leave a wake.
 */
export const SHIP_LOOKS = new Set<Look>(['fishingboat', 'transportship', 'warship', 'bombardship']);

/** Ships are drawn larger than their footprint, like vehicles. */
const SHIP_SIZE = 1.5;

interface Hull {
  len: number;
  beam: number;
  h: number;
}

const HULL: Record<string, Hull> = {
  fishingboat: { len: 0.4, beam: 0.15, h: 4 },
  transportship: { len: 0.58, beam: 0.27, h: 5 },
  warship: { len: 0.64, beam: 0.19, h: 5 },
  bombardship: { len: 0.76, beam: 0.26, h: 6 },
};

const HULL_COLOR: Record<EraStyle, string> = {
  stone: '#7a5a36',
  ancient: '#94673a',
  medieval: '#6b4a2b',
  imperial: '#4a3422',
  modern: '#6d747b',
  future: '#e8f0f4',
};

const DECK_COLOR: Record<EraStyle, string> = {
  stone: '#a07a4c',
  ancient: '#c09460',
  medieval: '#a9824f',
  imperial: '#b08a58',
  modern: '#8c9399',
  future: '#cddbe3',
};

const MAST = '#4a3420';
const WOOD = '#5a3e22';

export function drawShip(ctx: Ctx, baseProject: Project, scale: number, wx: number, wy: number, u: UnitLook, time: number): void {
  const style = epochStyle(u.epoch);
  const base = HULL[u.look] ?? HULL.warship;
  const len = base.len;
  const beam = base.beam;
  const h = base.h * (style === 'stone' ? 0.6 : style === 'modern' ? 1.3 : style === 'future' ? 1.1 : 1);
  const bob = Math.sin(time * 1.8 + u.seed) * 0.7;
  const project: Project = (x, y, z = 0) => baseProject(wx + (x - wx) * SHIP_SIZE, wy + (y - wy) * SHIP_SIZE, (z + bob) * SHIP_SIZE);
  const flat: Project = (x, y, z = 0) => baseProject(wx + (x - wx) * SHIP_SIZE, wy + (y - wy) * SHIP_SIZE, z * SHIP_SIZE);
  const c = Math.cos(u.facing);
  const s = Math.sin(u.facing);
  /** Ship-local point (along the keel, across the beam) to world. */
  const L = (lx: number, ly: number): Pt => [wx + c * lx - s * ly, wy + s * lx + c * ly];
  const P = (lx: number, ly: number, z: number): Pt => {
    const [x, y] = L(lx, ly);
    return project(x, y, z);
  };
  const hover = style === 'future';
  const fire = u.attackAnim > 0.2;
  // The beam side that faces the viewer (towards the south-east).
  const near = -s + c >= 0 ? 1 : -1;

  // Water: shadow, wake or hover glow.
  const [sx, sy] = flat(wx, wy);
  if (hover) {
    ellipse(ctx, sx, sy, (len * 34 + 6) * scale, (len * 16 + 3) * scale, `rgba(56,214,245,${(0.22 + 0.1 * Math.sin(time * 6)).toFixed(3)})`);
  } else {
    ellipse(ctx, sx, sy, (len * 34 + 4) * scale, (len * 15 + 2) * scale, 'rgba(10,30,50,0.25)');
  }
  if (u.moving && !hover) {
    // A short V of foam behind the stern, fading out.
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      for (const [from, to, alpha] of [
        [0.85, 0.25, 0.35],
        [1.1, 0.5, 0.18],
      ]) {
        const [a0, a1] = L(-len * from, side * beam * 0.6);
        const [b0, b1] = L(-len * from - to, side * (beam * 0.6 + to * 0.7));
        const [p0, p1] = flat(a0, a1);
        const [q0, q1] = flat(b0, b1);
        line(ctx, p0, p1, q0, q1, `rgba(235,248,255,${alpha})`, 1.2 * scale);
      }
    }
    const [bx, by] = flat(...L(len * 1.02, 0));
    ellipse(ctx, bx, by, 4 * scale, 2 * scale, 'rgba(235,248,255,0.55)');
  }

  // Hull outline: a raft is square, everything else has a bow.
  const raft = style === 'stone' && u.look === 'transportship';
  const outline: Pt[] = raft
    ? [
        [len, beam],
        [len, -beam],
        [-len, -beam],
        [-len, beam],
      ]
    : [
        [len * (style === 'modern' ? 1.08 : 1), 0],
        [len * 0.5, -beam],
        [-len * 0.82, -beam * 0.94],
        [-len, -beam * (style === 'modern' || style === 'imperial' ? 0.8 : 0.55)],
        [-len, beam * (style === 'modern' || style === 'imperial' ? 0.8 : 0.55)],
        [-len * 0.82, beam * 0.94],
        [len * 0.5, beam],
      ];
  const hullColor = HULL_COLOR[style];
  const deckColor = DECK_COLOR[style];
  const low = outline.map(([x, y]) => L(x * 0.9, y * 0.8));
  const top = outline.map(([x, y]) => L(x, y));
  const faces = outline.map((_, i) => {
    const j = (i + 1) % outline.length;
    const mid = (top[i][0] + top[j][0] + top[i][1] + top[j][1]) / 2;
    return { i, j, mid };
  });
  faces.sort((a, b) => a.mid - b.mid);
  for (const { i, j, mid } of faces) {
    const front = mid > wx + wy;
    poly(ctx, [project(low[i][0], low[i][1], 0), project(low[j][0], low[j][1], 0), project(top[j][0], top[j][1], h), project(top[i][0], top[i][1], h)], shade(hullColor, front ? -0.08 : -0.3));
    // The owner's colour along the gunwale.
    if (front && !raft) {
      const [a0, a1] = project(top[i][0], top[i][1], h - 1.2);
      const [b0, b1] = project(top[j][0], top[j][1], h - 1.2);
      line(ctx, a0, a1, b0, b1, u.color, 1.5 * scale);
    }
  }
  poly(
    ctx,
    top.map(([x, y]) => project(x, y, h)),
    raft ? '#8a6a40' : deckColor,
  );
  if (raft) {
    // Logs lashed together.
    for (let k = -2; k <= 2; k++) {
      const [a0, a1] = P(-len, (k * beam) / 2.5, h + 0.2);
      const [b0, b1] = P(len, (k * beam) / 2.5, h + 0.2);
      line(ctx, a0, a1, b0, b1, '#6a4c2a', 0.8 * scale);
    }
  }
  if (style === 'future') {
    // A glowing seam round the hull.
    ctx.beginPath();
    top.forEach(([x, y], i) => {
      const [px, py] = project(x, y, h - 0.6);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.strokeStyle = '#38d6f5';
    ctx.lineWidth = 1.1 * scale;
    ctx.stroke();
  }

  const z = h;
  const ctxDeck = { ctx, P, L, project, scale, time, u, style, len, beam, z, near, fire };
  switch (u.look) {
    case 'fishingboat':
      fishingBoat(ctxDeck);
      break;
    case 'transportship':
      transport(ctxDeck);
      break;
    case 'warship':
      warship(ctxDeck);
      break;
    case 'bombardship':
      bombard(ctxDeck);
      break;
  }
}

interface Deck {
  ctx: Ctx;
  P: (lx: number, ly: number, z: number) => Pt;
  L: (lx: number, ly: number) => Pt;
  project: Project;
  scale: number;
  time: number;
  u: UnitLook;
  style: EraStyle;
  len: number;
  beam: number;
  z: number;
  near: number;
  fire: boolean;
}

/** Oars (or paddles) on both sides, sweeping while under way. */
function oars(d: Deck, n: number, reach = 0.35): void {
  const { ctx, P, time, u, len, beam, z, scale } = d;
  for (let k = 0; k < n; k++) {
    const lx = -len * 0.55 + (k * len * 1.1) / Math.max(1, n - 1);
    const sweep = u.moving ? Math.sin(time * 5 + k * 0.4) * 0.12 : 0.04;
    for (const side of [-1, 1]) {
      const [a0, a1] = P(lx, side * beam * 0.95, z * 0.8);
      const [b0, b1] = P(lx + sweep, side * (beam + reach), -0.5);
      line(ctx, a0, a1, b0, b1, WOOD, 0.9 * scale);
    }
  }
}

/** A mast with a square sail across the ship; `stripes` paints the owner's colour in bands. */
function mast(d: Deck, lx: number, height: number, sailColor: string, opts: { sails?: number; stripes?: boolean; width?: number } = {}): void {
  const { ctx, P, scale, u, beam, z, time } = d;
  const [m0, m1] = P(lx, 0, z);
  const [t0, t1] = P(lx, 0, z + height);
  line(ctx, m0, m1, t0, t1, MAST, 1.6 * scale);
  const sails = opts.sails ?? 1;
  const width = opts.width ?? beam + 0.1;
  const billow = u.moving ? 0.07 : 0.03;
  for (let k = 0; k < sails; k++) {
    const z0 = z + height * (0.3 + (k * 0.6) / sails);
    const z1 = z + height * (0.3 + ((k + 1) * 0.6) / sails) - 1;
    const w = width * (1 - k * 0.15);
    const pts: Pt[] = [P(lx, -w, z1), P(lx, w, z1), P(lx + billow, w * 0.95, (z0 + z1) / 2), P(lx, w, z0), P(lx, -w, z0), P(lx + billow, -w * 0.95, (z0 + z1) / 2)];
    poly(ctx, pts, sailColor, shade(sailColor, -0.3), 0.6);
    if (opts.stripes) {
      for (const t of [0.33, 0.66]) {
        const [a0, a1] = P(lx + billow * 0.5, -w * 0.97, z0 + (z1 - z0) * t);
        const [b0, b1] = P(lx + billow * 0.5, w * 0.97, z0 + (z1 - z0) * t);
        line(ctx, a0, a1, b0, b1, u.color, 1.4 * scale);
      }
    }
  }
  // Pennant at the top in the owner's colour.
  const wave = Math.sin(time * 5 + u.seed) * 1.2 * scale;
  poly(ctx, [[t0, t1], [t0 - 7 * scale, t1 + 1 * scale + wave], [t0, t1 + 3 * scale]], u.color);
}

/** Castle (raised deck) at bow or stern. */
function castle(d: Deck, lx: number, half: number, height: number, color: string): void {
  const [x, y] = d.L(lx, 0);
  box3d(d.ctx, d.project, x, y, d.u.facing, half, d.beam * 0.85, d.z, d.z + height, shade(color, 0.12), color);
}

/** Dark gun ports along the side facing the viewer. */
function gunports(d: Deck, n: number, rows: number): void {
  const { ctx, P, len, beam, z, near, scale, fire } = d;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < n; k++) {
      const lx = -len * 0.6 + (k * len * 1.15) / Math.max(1, n - 1);
      const [x, y] = P(lx, near * beam * 0.97, z * (0.45 + r * 0.3));
      ctx.fillStyle = '#1b130c';
      ctx.fillRect(x - 1.1 * scale, y - 0.9 * scale, 2.2 * scale, 1.8 * scale);
      if (fire && (k + r) % 2 === 0) circle(ctx, x, y + 1 * scale, 2.6 * scale, 'rgba(255,207,90,0.85)');
    }
  }
}

/** Steel bridge and funnel with a little smoke. */
function bridge(d: Deck, lx: number, height: number): void {
  const { ctx, L, project, scale, u, beam, z, time } = d;
  const [x, y] = L(lx, 0);
  const color = d.style === 'future' ? '#f4f8fa' : '#9aa1a8';
  box3d(ctx, project, x, y, u.facing, 0.14, beam * 0.6, z, z + height, shade(color, 0.12), color);
  if (d.style === 'future') {
    const [gx, gy] = project(x, y, z + height * 0.7);
    line(ctx, gx - 4 * scale, gy, gx + 4 * scale, gy, '#38d6f5', 1.2 * scale);
    return;
  }
  const [fx, fy] = L(lx - 0.16, 0);
  box3d(ctx, project, fx, fy, u.facing, 0.05, 0.05, z + height * 0.5, z + height + 4, '#3d4247', '#2c3035');
  const [px, py] = project(fx, fy, z + height + 5);
  for (let k = 0; k < 3; k++) {
    const t = (time * 0.6 + k / 3 + u.seed * 0.1) % 1;
    circle(ctx, px - t * 6 * scale, py - t * 10 * scale, (1.5 + t * 2.5) * scale, `rgba(90,90,90,${(0.45 * (1 - t)).toFixed(3)})`);
  }
}

/** A gun turret with its barrel along the keel. */
function turret(d: Deck, lx: number, size: number, barrel: number, color = '#7d848b'): void {
  const { ctx, L, project, scale, u, z, fire } = d;
  const [x, y] = L(lx, 0);
  box3d(ctx, project, x, y, u.facing, size, size * 0.9, z, z + 3, shade(color, 0.15), color);
  const dir = lx >= 0 ? 1 : -1;
  const [a0, a1] = project(...L(lx + dir * size * 0.5, 0), z + 2);
  const [b0, b1] = project(...L(lx + dir * (size + barrel), 0), z + 2.5);
  line(ctx, a0, a1, b0, b1, d.style === 'future' ? '#38d6f5' : '#3d4247', 1.6 * scale);
  if (fire) circle(ctx, b0, b1, 3 * scale, d.style === 'future' ? 'rgba(160,240,255,0.9)' : 'rgba(255,207,90,0.9)');
}

function fishingBoat(d: Deck): void {
  const { ctx, P, scale, u, style, len, z, time } = d;
  if (style === 'stone') {
    // Dugout: a fisher with a paddle.
    const [x, y] = P(-len * 0.2, 0, z);
    circle(ctx, x, y - 3 * scale, 1.6 * scale, '#e2b68e');
    line(ctx, x, y, x + 3 * scale, y + 3 * scale, WOOD, 0.9 * scale);
  } else if (style === 'modern' || style === 'future') {
    bridge(d, len * 0.25, style === 'future' ? 3 : 5);
    // A-frame for the net at the stern.
    const [a0, a1] = P(-len * 0.8, -d.beam * 0.7, z);
    const [b0, b1] = P(-len * 0.8, d.beam * 0.7, z);
    const [t0, t1] = P(-len * 0.75, 0, z + 9);
    line(ctx, a0, a1, t0, t1, style === 'future' ? '#cfdce3' : '#d06a2a', 1.2 * scale);
    line(ctx, b0, b1, t0, t1, style === 'future' ? '#cfdce3' : '#d06a2a', 1.2 * scale);
  } else {
    mast(d, len * 0.1, 14, style === 'imperial' ? '#efe8d4' : '#d8c8a0');
  }
  // Net over the side while at work, the catch on deck.
  if (u.working) {
    const [n0, n1] = P(0, d.near * (d.beam + 0.3), -0.5);
    const swing = Math.sin(time * 3 + u.seed) * 1.5 * scale;
    ctx.strokeStyle = 'rgba(230,230,210,0.8)';
    ctx.lineWidth = 0.6 * scale;
    ctx.beginPath();
    ctx.ellipse(n0, n1 + swing * 0.2, 4 * scale, 2 * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (u.carry) {
    for (let k = 0; k < 4; k++) {
      const [x, y] = P(-len * 0.4 + k * 0.05, (k % 2 ? 1 : -1) * 0.04, z + 0.5);
      circle(ctx, x, y, 1.1 * scale, '#c9d7df');
    }
  }
}

function transport(d: Deck): void {
  const { ctx, P, scale, u, style, len, beam, z } = d;
  switch (style) {
    case 'stone':
      break;
    case 'ancient':
      oars(d, 5, 0.3);
      mast(d, 0, 16, '#e8dcc0', { stripes: true });
      break;
    case 'medieval':
      castle(d, -len * 0.7, 0.14, 5, '#7a5634');
      mast(d, 0, 20, '#efe8d4', { stripes: true, width: beam + 0.14 });
      break;
    case 'imperial':
      castle(d, -len * 0.72, 0.15, 6, '#5a4028');
      mast(d, len * 0.25, 22, '#f1ead8', { sails: 2 });
      mast(d, -len * 0.25, 20, '#f1ead8', { sails: 2 });
      break;
    case 'modern': {
      // Landing ship: a ramp at the bow, the bridge aft.
      const [r0, r1] = P(len * 0.95, -beam * 0.6, z + 2);
      const [r2, r3] = P(len * 0.95, beam * 0.6, z + 2);
      line(ctx, r0, r1, r2, r3, '#4a5056', 2.2 * scale);
      bridge(d, -len * 0.7, 6);
      break;
    }
    case 'future':
      bridge(d, -len * 0.55, 4);
      break;
  }
  // Passengers on deck.
  const n = Math.min(10, u.cargo ?? 0);
  for (let k = 0; k < n; k++) {
    const lx = -len * 0.3 + (k % 5) * len * 0.15;
    const ly = (Math.floor(k / 5) - 0.5) * beam * 0.7;
    const [x, y] = P(lx, ly, z);
    line(ctx, x, y, x, y - 3 * scale, shade(u.color, -0.2), 1.6 * scale);
    circle(ctx, x, y - 3.8 * scale, 1.2 * scale, '#e2b68e');
  }
}

function warship(d: Deck): void {
  const { ctx, P, scale, u, style, len, beam, z } = d;
  switch (style) {
    case 'stone':
      // War canoe: paddlers with bows.
      oars(d, 4, 0.2);
      for (let k = 0; k < 3; k++) {
        const [x, y] = P(-len * 0.4 + k * len * 0.4, 0, z);
        circle(ctx, x, y - 2.5 * scale, 1.5 * scale, '#e2b68e');
      }
      break;
    case 'ancient': {
      // Trireme: two banks of oars, a ram, a striped sail.
      oars(d, 7, 0.32);
      oars(d, 6, 0.42);
      const [r0, r1] = P(len, 0, 0.5);
      const [r2, r3] = P(len + 0.12, 0, 0.5);
      line(ctx, r0, r1, r2, r3, '#b48a45', 2 * scale);
      mast(d, 0, 18, '#e8dcc0', { stripes: true });
      break;
    }
    case 'medieval': {
      // Longship: dragon prow and a row of shields.
      oars(d, 6, 0.3);
      const [p0, p1] = P(len, 0, z);
      const [p2, p3] = P(len + 0.05, 0, z + 7);
      line(ctx, p0, p1, p2, p3, WOOD, 1.8 * scale);
      circle(ctx, p2, p3, 1.6 * scale, WOOD);
      for (let k = 0; k < 6; k++) {
        const [x, y] = P(-len * 0.6 + k * len * 0.22, d.near * beam, z - 0.5);
        circle(ctx, x, y, 1.4 * scale, k % 2 ? u.color : '#e9dfc6', '#3a2a1a', 0.5);
      }
      mast(d, 0, 18, '#efe8d4', { stripes: true });
      break;
    }
    case 'imperial':
      // Frigate: gun deck, three masts.
      gunports(d, 6, 1);
      castle(d, -len * 0.74, 0.13, 5, '#5a4028');
      mast(d, len * 0.35, 22, '#f1ead8', { sails: 3, width: beam + 0.06 });
      mast(d, 0, 26, '#f1ead8', { sails: 3, width: beam + 0.08 });
      mast(d, -len * 0.4, 20, '#f1ead8', { sails: 2, width: beam + 0.04 });
      break;
    case 'modern':
      // Destroyer: a forward gun, the bridge, a mast with radar.
      turret(d, len * 0.5, 0.08, 0.2);
      bridge(d, 0, 7);
      break;
    case 'future':
      turret(d, len * 0.45, 0.08, 0.25, '#e8f0f4');
      bridge(d, -len * 0.2, 4);
      break;
  }
}

function bombard(d: Deck): void {
  const { ctx, P, scale, style, len, beam, z, fire } = d;
  switch (style) {
    case 'stone':
    case 'ancient':
    case 'medieval': {
      // Catapult on deck: frame and throwing arm.
      if (style !== 'medieval') oars(d, 6, 0.32);
      const [f0, f1] = P(0, 0, z);
      const [g0, g1] = P(0, 0, z + 5);
      line(ctx, f0, f1, g0, g1, WOOD, 2.4 * scale);
      const [a0, a1] = fire ? P(0.15, 0, z + 12) : P(-0.25, 0, z + 4);
      line(ctx, g0, g1, a0, a1, '#7a5634', 1.6 * scale);
      circle(ctx, a0, a1, 1.6 * scale, '#5b4128');
      if (style === 'medieval') {
        castle(d, -len * 0.72, 0.14, 5, '#7a5634');
        castle(d, len * 0.62, 0.12, 4, '#7a5634');
        mast(d, -len * 0.25, 18, '#efe8d4', { stripes: true });
      } else mast(d, -len * 0.3, 15, '#e8dcc0', { stripes: true });
      break;
    }
    case 'imperial':
      // Ship of the line: two gun decks, three tall masts.
      gunports(d, 7, 2);
      castle(d, -len * 0.75, 0.15, 7, '#5a4028');
      mast(d, len * 0.38, 24, '#f1ead8', { sails: 3, width: beam + 0.05 });
      mast(d, 0, 28, '#f1ead8', { sails: 3, width: beam + 0.07 });
      mast(d, -len * 0.42, 22, '#f1ead8', { sails: 3, width: beam + 0.04 });
      break;
    case 'modern':
      // Battleship: big turrets fore and aft.
      turret(d, len * 0.55, 0.12, 0.3);
      turret(d, len * 0.25, 0.1, 0.25);
      turret(d, -len * 0.55, 0.12, 0.3);
      bridge(d, -len * 0.1, 9);
      break;
    case 'future':
      turret(d, len * 0.45, 0.12, 0.45, '#e8f0f4');
      turret(d, -len * 0.5, 0.11, 0.35, '#e8f0f4');
      bridge(d, -len * 0.05, 5);
      break;
  }
}

// ------------------------------------------------------------------ harbour

const PIER: Record<EraStyle, { deck: string; post: string }> = {
  stone: { deck: '#9a7a4c', post: '#5b4128' },
  ancient: { deck: '#d9c7a0', post: '#8f7a52' },
  medieval: { deck: '#a9824f', post: '#4f3727' },
  imperial: { deck: '#bdb4a3', post: '#6d6558' },
  modern: { deck: '#a3a8ad', post: '#5f656b' },
  future: { deck: '#e8f0f4', post: '#8fd0e0' },
};

/** Harbour: a pier on piles in the water with sheds, cranes and flags of its era. */
export function drawDock(ctx: Ctx, project: Project, scale: number, b: BuildingLook, time: number): void {
  const style = epochStyle(b.epoch);
  const pier = PIER[style];
  const x0 = b.tx + 0.15;
  const y0 = b.ty + 0.15;
  const x1 = b.tx + b.size - 0.15;
  const y1 = b.ty + b.size - 0.15;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (!b.built && b.progress < 0.08) {
    poly(ctx, [project(x0, y0), project(x1, y0), project(x1, y1), project(x0, y1)], 'rgba(120,100,70,0.45)', '#e9d9a6', 1);
    return;
  }
  if (!b.built) ctx.globalAlpha = 0.85;
  // Piles into the water.
  for (let t = 0; t <= 1.001; t += 0.25) {
    for (const [x, y] of [
      [x0 + (x1 - x0) * t, y1],
      [x1, y0 + (y1 - y0) * t],
    ]) {
      const [a0, a1] = project(x, y, -3);
      const [b0, b1] = project(x, y, 3);
      line(ctx, a0, a1, b0, b1, pier.post, 1.6 * scale);
    }
  }
  const deckZ = style === 'modern' || style === 'future' ? 5 : 3;
  box3d(ctx, project, cx, cy, 0, (x1 - x0) / 2, (y1 - y0) / 2, deckZ - 2, deckZ, pier.deck, shade(pier.deck, -0.1));
  if (style !== 'modern' && style !== 'future') {
    // Planks.
    for (let t = 0.15; t < 1; t += 0.17) {
      const [a0, a1] = project(x0 + (x1 - x0) * t, y0, deckZ);
      const [b0, b1] = project(x0 + (x1 - x0) * t, y1, deckZ);
      line(ctx, a0, a1, b0, b1, shade(pier.deck, -0.18), 0.6 * scale);
    }
  }
  const progress = b.built ? 1 : Math.min(1, b.progress * 1.2);
  const shedH = (style === 'stone' ? 9 : style === 'modern' ? 16 : 13) * progress;
  // Shed or warehouse on the back half.
  const sx0 = x0 + 0.15;
  const sy0 = y0 + 0.15;
  const sx1 = cx + 0.1;
  const sy1 = cy + 0.1;
  const wall = style === 'future' ? '#f4f8fa' : style === 'modern' ? '#8a9096' : style === 'imperial' ? '#cfc7b8' : style === 'ancient' ? '#dccaa0' : '#8b6a44';
  box3d(ctx, project, (sx0 + sx1) / 2, (sy0 + sy1) / 2, 0, (sx1 - sx0) / 2, (sy1 - sy0) / 2, deckZ, deckZ + shedH, shade(wall, 0.08), wall);
  // The owner's colour on the shed.
  poly(ctx, [project(sx0, sy1, deckZ + shedH - 3), project(sx1, sy1, deckZ + shedH - 3), project(sx1, sy1, deckZ + shedH), project(sx0, sy1, deckZ + shedH)], b.color);
  if (b.built) {
    const roof = style === 'stone' ? '#c9a65e' : style === 'ancient' ? '#b4532d' : style === 'medieval' ? '#7b3326' : style === 'imperial' ? '#4b5b6b' : '';
    if (style === 'stone') roofPyramid(ctx, project, sx0, sy0, sx1, sy1, deckZ + shedH, 7, roof);
    else if (roof) roofGable(ctx, project, sx0, sy0, sx1, sy1, deckZ + shedH, 6, roof);
  }
  // Era extras on the open front of the pier.
  const fx = x1 - 0.45;
  const fy = y1 - 0.45;
  switch (style) {
    case 'stone': {
      // Drying rack with fish.
      const [a0, a1] = project(fx - 0.4, fy, deckZ);
      const [b0, b1] = project(fx + 0.2, fy, deckZ);
      const [c0, c1] = project(fx - 0.4, fy, deckZ + 8);
      const [d0, d1] = project(fx + 0.2, fy, deckZ + 8);
      line(ctx, a0, a1, c0, c1, pier.post, 1 * scale);
      line(ctx, b0, b1, d0, d1, pier.post, 1 * scale);
      line(ctx, c0, c1, d0, d1, pier.post, 1 * scale);
      for (let k = 0; k < 4; k++) {
        const t = (k + 0.5) / 4;
        circle(ctx, c0 + (d0 - c0) * t, c1 + (d1 - c1) * t + 2 * scale, 1 * scale, '#c9d7df');
      }
      break;
    }
    case 'ancient':
      for (let k = 0; k < 3; k++) {
        const [x, y] = project(fx - k * 0.25, fy + 0.1, deckZ);
        ellipse(ctx, x, y - 2.5 * scale, 1.6 * scale, 2.6 * scale, '#b4532d');
      }
      break;
    case 'medieval':
    case 'imperial': {
      // Treadwheel crane / wooden crane with a hanging load.
      const [p0, p1] = project(fx, fy, deckZ);
      const [q0, q1] = project(fx, fy, deckZ + 20);
      const [r0, r1] = project(fx + 0.5, fy + 0.4, deckZ + 22);
      line(ctx, p0, p1, q0, q1, pier.post, 2 * scale);
      line(ctx, q0, q1, r0, r1, pier.post, 1.6 * scale);
      const sway = Math.sin(time * 1.5 + b.seed) * 1.5 * scale;
      line(ctx, r0, r1, r0 + sway, r1 + 8 * scale, '#3a2a1a', 0.6 * scale);
      ctx.fillStyle = '#8b6a44';
      ctx.fillRect(r0 + sway - 2 * scale, r1 + 8 * scale, 4 * scale, 3 * scale);
      if (style === 'medieval') {
        ctx.beginPath();
        ctx.arc(p0 - 3 * scale, p1 - 5 * scale, 4 * scale, 0, Math.PI * 2);
        ctx.strokeStyle = pier.post;
        ctx.lineWidth = 1.2 * scale;
        ctx.stroke();
      }
      break;
    }
    case 'modern': {
      // Gantry crane in the owner's colour and a stack of containers.
      for (const [dx, dy] of [
        [0, 0],
        [-0.6, 0],
      ]) {
        const [a0, a1] = project(fx + dx, fy + dy, deckZ);
        const [b0, b1] = project(fx + dx, fy + dy, deckZ + 24);
        line(ctx, a0, a1, b0, b1, b.color, 2 * scale);
      }
      const [g0, g1] = project(fx + 0.6, fy, deckZ + 24);
      const [h0, h1] = project(fx - 0.9, fy, deckZ + 24);
      line(ctx, g0, g1, h0, h1, b.color, 2.4 * scale);
      const colors = ['#c0392b', '#2f7de1', '#e0a400'];
      colors.forEach((col, k) => box3d(ctx, project, cx + 0.3, cy + 0.55 - k * 0.32, 0, 0.3, 0.13, deckZ + (k === 2 ? 5 : 0), deckZ + (k === 2 ? 10 : 5), shade(col, 0.1), col));
      break;
    }
    case 'future': {
      const [x, y] = project(fx, fy, deckZ);
      ctx.strokeStyle = `rgba(56,214,245,${(0.6 + 0.3 * Math.sin(time * 3)).toFixed(3)})`;
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      ctx.ellipse(x, y, 10 * scale, 5 * scale, 0, 0, Math.PI * 2);
      ctx.stroke();
      const [t0, t1] = project(fx, fy, deckZ + 20);
      line(ctx, x, y, t0, t1, '#cfdce3', 1.2 * scale);
      circle(ctx, t0, t1, 2 * scale, '#38d6f5');
      break;
    }
  }
  if (b.built) {
    const [px, py] = project(x1, y0 + 0.2, deckZ);
    flag(ctx, px, py, scale, b.color, time, b.seed);
  } else {
    // Scaffold poles while it is built.
    for (const [x, y] of [
      [x0, y1],
      [x1, y1],
      [x1, y0],
    ]) {
      const [a0, a1] = project(x, y, deckZ);
      const [b0, b1] = project(x, y, deckZ + 16);
      line(ctx, a0, a1, b0, b1, '#b58a52', 1.2 * scale);
    }
  }
  ctx.globalAlpha = 1;
}
