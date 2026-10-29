import { epochStyle } from '../data/epochs';
import type { Look } from '../data/units';
import type { Project } from './camera';
import { shade } from './colors';
import { box3d, circle, ellipse, line, poly, type BuildingLook, type Ctx, type Pt, type UnitLook } from './sprites';

/**
 * Aircraft and airfields. Planes are flat silhouettes lifted to their
 * flying height – fuselage, wings, tail fin in the owner's colour – dressed
 * by epoch: propellers in the world wars, swept jets, stealth deltas,
 * drones and glowing space fighters. Balloons go from a gas balloon with
 * a basket to airships and a probe in the stratosphere. A shadow on the
 * ground shows where they really are.
 */
export const AIR_LOOKS = new Set<Look>(['balloon', 'fighter', 'bomber']);

/** Flying height in iso pixels (before zoom). */
export const ALTITUDE: Record<string, number> = { balloon: 86, fighter: 68, bomber: 58 };

/** Aircraft are drawn larger than their footprint, like ships. */
const PLANE_SIZE = 1.6;

/** Where an aircraft is drawn this frame: circling planes and drifting balloons move a little around their real spot. */
export interface AirPose {
  x: number;
  y: number;
  z: number;
  facing: number;
  /** Parked on an airfield. */
  landed: boolean;
}

export function airPose(look: Look, x: number, y: number, facing: number, moving: boolean, seed: number, time: number, landed: boolean): AirPose {
  if (landed) return { x, y, z: 1, facing: -Math.PI / 4, landed };
  if (look === 'balloon') {
    return { x: x + Math.sin(time * 0.3 + seed) * 0.08, y, z: ALTITUDE.balloon + Math.sin(time * 0.8 + seed) * 2.5, facing, landed };
  }
  if (moving) return { x, y, z: ALTITUDE[look] ?? 60, facing, landed };
  // Waiting in the air: a slow circle round the spot.
  const r = look === 'bomber' ? 0.75 : 0.55;
  const a = time * (look === 'bomber' ? 0.9 : 1.4) + seed * 1.7;
  return { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, z: ALTITUDE[look] ?? 60, facing: a + Math.PI / 2, landed };
}

/** The shadow on the ground: smaller and fainter the higher the craft. */
export function drawAirShadow(ctx: Ctx, project: Project, scale: number, look: Look, x: number, y: number, z: number): void {
  const [sx, sy] = project(x, y);
  const size = look === 'bomber' ? 16 : look === 'balloon' ? 11 : 10;
  const k = 1 - Math.min(0.5, z / 200);
  ellipse(ctx, sx, sy, size * scale * k, size * 0.45 * scale * k, `rgba(0,0,0,${(0.3 * k).toFixed(3)})`);
}

export function drawAircraft(ctx: Ctx, baseProject: Project, scale: number, wx: number, wy: number, u: UnitLook, time: number, z = 0): void {
  if (u.look === 'balloon') {
    drawBalloon(ctx, baseProject, scale, wx, wy, u, time, z);
    return;
  }
  const project: Project = (x, y, h = 0) => baseProject(wx + (x - wx) * PLANE_SIZE, wy + (y - wy) * PLANE_SIZE, h * PLANE_SIZE);
  const c = Math.cos(u.facing);
  const s = Math.sin(u.facing);
  const zz = z / PLANE_SIZE;
  const P = (lx: number, ly: number, h = 0): Pt => project(wx + c * lx - s * ly, wy + s * lx + c * ly, zz + h);
  const shape = (pts: Array<[number, number]>, fill: string, h = 0) => {
    // A darker underside a little lower gives the silhouette some body.
    poly(
      ctx,
      pts.map(([a, b]) => P(a, b, h - 1.2)),
      shade(fill, -0.35),
    );
    poly(
      ctx,
      pts.map(([a, b]) => P(a, b, h)),
      fill,
    );
  };
  const e = u.epoch;
  const bomber = u.look === 'bomber';
  const future = epochStyle(e) === 'future';
  const body = future ? (e >= 17 ? '#eef4f7' : '#5d646b') : e >= 15 ? '#3c4248' : e >= 14 ? '#9aa3ab' : bomber ? '#7d8a6a' : '#8c9a74';
  const len = bomber ? 0.34 : 0.24;
  const span = bomber ? 0.5 : 0.28;
  const fly = u.moving || z > 2;

  if (bomber && e === 15) {
    // Tarnkappenbomber: a flying wing.
    shape(
      [
        [len, 0],
        [-len * 0.3, span],
        [-len * 0.55, span * 0.55],
        [-len * 0.35, 0],
        [-len * 0.55, -span * 0.55],
        [-len * 0.3, -span],
      ],
      body,
    );
  } else if (!bomber && e === 15) {
    // Mehrzweckjet: delta with twin fins.
    shape(
      [
        [len, 0],
        [-len * 0.6, span],
        [-len * 0.75, 0],
        [-len * 0.6, -span],
      ],
      body,
    );
  } else if (e >= 16) {
    // Drones and space craft: arrow head with glowing edges.
    shape(
      [
        [len * 1.05, 0],
        [-len * 0.5, span * 0.95],
        [-len * 0.25, 0],
        [-len * 0.5, -span * 0.95],
      ],
      body,
    );
    const glow = `rgba(56,214,245,${(0.65 + 0.3 * Math.sin(time * 5 + u.seed)).toFixed(3)})`;
    const [a0, a1] = P(len * 1.05, 0);
    const [b0, b1] = P(-len * 0.5, span * 0.95);
    const [c0, c1] = P(-len * 0.5, -span * 0.95);
    line(ctx, a0, a1, b0, b1, glow, 1 * scale);
    line(ctx, a0, a1, c0, c1, glow, 1 * scale);
  } else {
    // Straight wings (propellers) or swept ones (jets).
    const swept = e >= 14;
    const wingRoot = bomber ? 0.08 : 0.04;
    const tip = swept ? -len * 0.45 : wingRoot - 0.02;
    const chord = bomber ? 0.09 : 0.07;
    shape(
      [
        [wingRoot + chord * 0.5, 0],
        [tip + chord * 0.4, span],
        [tip - chord * 0.6, span],
        [wingRoot - chord, 0],
        [tip - chord * 0.6, -span],
        [tip + chord * 0.4, -span],
      ],
      shade(body, -0.06),
    );
    // Tailplane.
    shape(
      [
        [-len * 0.78, 0],
        [-len * 0.95, span * 0.38],
        [-len * 1.02, span * 0.38],
        [-len * 0.95, 0],
        [-len * 1.02, -span * 0.38],
        [-len * 0.95, -span * 0.38],
      ],
      shade(body, -0.1),
    );
    // Fuselage.
    shape(
      [
        [len, 0],
        [len * 0.7, 0.035],
        [-len * 0.9, 0.025],
        [-len, 0],
        [-len * 0.9, -0.025],
        [len * 0.7, -0.035],
      ],
      body,
      0.3,
    );
    if (!swept) {
      // Spinning propellers: one on the nose, or four along the bomber's wings.
      const props: Array<[number, number]> = bomber
        ? [
            [wingRoot + 0.06, span * 0.35],
            [wingRoot + 0.06, span * 0.7],
            [wingRoot + 0.06, -span * 0.35],
            [wingRoot + 0.06, -span * 0.7],
          ]
        : [[len + 0.01, 0]];
      for (const [px, py] of props) {
        const [x, y] = P(px, py, 0.5);
        ellipse(ctx, x, y, 3.2 * scale, 1.8 * scale, 'rgba(230,230,230,0.35)');
      }
    } else if (fly) {
      // Jet exhaust.
      const [x, y] = P(-len * 1.02, 0, 0.3);
      circle(ctx, x, y, 1.6 * scale, `rgba(255,170,70,${(0.55 + 0.35 * Math.sin(time * 20 + u.seed)).toFixed(3)})`);
    }
  }
  // Cockpit (none on drones) and the owner's colour on the fin.
  if (e < 16) {
    const [x, y] = P(len * 0.55, 0, 0.8);
    ellipse(ctx, x, y, 1.8 * scale, 1.1 * scale, bomber ? '#9fc4d8' : '#bfe3f2');
  }
  const [f0, f1] = P(-len * 0.88, 0, 0.4);
  const [g0, g1] = P(-len, 0, 0.4);
  const [h0, h1] = P(-len * 0.97, 0, bomber ? 7 : 6);
  poly(
    ctx,
    [
      [f0, f1],
      [g0, g1],
      [h0, h1],
    ],
    u.color,
  );
  // Roundels on the wings.
  for (const side of [-1, 1]) {
    const [x, y] = P(bomber ? 0 : -0.01, side * span * 0.62, 0.2);
    circle(ctx, x, y, 1.4 * scale, u.color);
  }
  // Muzzle flash or the bomb bay opening.
  if (u.attackAnim > 0.2 && !bomber) {
    const [x, y] = P(len * 1.1, 0, 0.5);
    circle(ctx, x, y, 2 * scale, e >= 16 ? '#9ff6ff' : '#ffe28a');
  }
}

function drawBalloon(ctx: Ctx, baseProject: Project, scale: number, wx: number, wy: number, u: UnitLook, time: number, z: number): void {
  const e = u.epoch;
  const [cx, cy] = baseProject(wx, wy, z);
  const c = Math.cos(u.facing);
  const s = Math.sin(u.facing);
  if (e <= 11) {
    // Gas balloon: striped envelope, net, basket on ropes.
    const r = 9 * scale;
    const by = cy + r * 1.9;
    line(ctx, cx - r * 0.7, cy + r * 0.6, cx - 2.2 * scale, by, '#5a4a36', 0.5 * scale);
    line(ctx, cx + r * 0.7, cy + r * 0.6, cx + 2.2 * scale, by, '#5a4a36', 0.5 * scale);
    ctx.fillStyle = '#8b6a44';
    ctx.fillRect(cx - 2.6 * scale, by, 5.2 * scale, 3.4 * scale);
    circle(ctx, cx, cy, r, '#efe4c8');
    // Gores in the owner's colour.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    for (let k = -2; k <= 2; k += 2) {
      ctx.beginPath();
      ctx.ellipse(cx + k * r * 0.33, cy, r * 0.16, r, 0, 0, Math.PI * 2);
      ctx.fillStyle = u.color;
      ctx.fill();
    }
    ctx.restore();
    circle(ctx, cx - r * 0.35, cy - r * 0.4, r * 0.25, 'rgba(255,255,255,0.35)');
    return;
  }
  if (e >= 17) {
    // Stratosphere probe: a white sphere with a glowing ring.
    const r = 7 * scale;
    circle(ctx, cx, cy, r, '#f0f5f8');
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 1.7, r * 0.5, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(56,214,245,${(0.6 + 0.3 * Math.sin(time * 3 + u.seed)).toFixed(3)})`;
    ctx.lineWidth = 1.4 * scale;
    ctx.stroke();
    circle(ctx, cx, cy + r * 1.2, 1.6 * scale, u.color);
    return;
  }
  // Airships: a long envelope along the heading, gondola beneath, fins at the tail.
  const len = 0.42 * PLANE_SIZE;
  const [ax, ay] = baseProject(wx + c * len, wy + s * len, z);
  const [bx, by] = baseProject(wx - c * len, wy - s * len, z);
  const angle = Math.atan2(ay - by, ax - bx);
  const half = Math.max(7 * scale, Math.hypot(ax - bx, ay - by) / 2);
  const thick = 5.5 * scale;
  const hull = e >= 15 ? '#e9eef2' : '#b8b4a6';
  // Gondola and fins first, so the envelope sits on top.
  ctx.fillStyle = '#5b5b55';
  ctx.fillRect(cx - 3 * scale, cy + thick * 0.8, 6 * scale, 2.4 * scale);
  const [tx, ty] = [cx - Math.cos(angle) * half * 0.85, cy - Math.sin(angle) * half * 0.85];
  poly(
    ctx,
    [
      [tx, ty - thick * 1.2],
      [tx - Math.cos(angle) * 4 * scale, ty - Math.sin(angle) * 4 * scale],
      [tx, ty + thick * 1.2],
    ],
    u.color,
  );
  ctx.beginPath();
  ctx.ellipse(cx, cy, half, thick, angle, 0, Math.PI * 2);
  ctx.fillStyle = hull;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy - thick * 0.3, half * 0.85, thick * 0.35, angle, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fill();
  // A band in the owner's colour round the middle, or solar cells along the back.
  if (e >= 15) {
    ctx.beginPath();
    ctx.ellipse(cx, cy - thick * 0.45, half * 0.6, thick * 0.22, angle, 0, Math.PI * 2);
    ctx.fillStyle = '#2b5c8a';
    ctx.fill();
  }
  const nx = -Math.sin(angle) * thick;
  const ny = Math.cos(angle) * thick;
  line(ctx, cx - nx, cy - ny, cx + nx, cy + ny, u.color, 2 * scale);
}

/**
 * Airfields: a runway along the field with a hangar behind it. Grass strip
 * and an arched hangar in the world wars, concrete with a control tower
 * later, landing pads with glowing rings in the future eras.
 */
export function drawAirfield(ctx: Ctx, project: Project, scale: number, b: BuildingLook, time: number): void {
  const x0 = b.tx + 0.1;
  const y0 = b.ty + 0.1;
  const x1 = b.tx + b.size - 0.1;
  const y1 = b.ty + b.size - 0.1;
  const future = epochStyle(b.epoch) === 'future';
  const concrete = b.epoch >= 14;
  if (!b.built && b.progress < 0.08) {
    poly(ctx, [project(x0, y0), project(x1, y0), project(x1, y1), project(x0, y1)], 'rgba(120,100,70,0.45)', '#e9d9a6', 1);
    return;
  }
  if (!b.built) ctx.globalAlpha = 0.85;
  // The ground of the field.
  poly(ctx, [project(x0, y0), project(x1, y0), project(x1, y1), project(x0, y1)], future ? '#c9d3da' : concrete ? '#8f9598' : '#7d9a52');
  if (!future) {
    // Runway along the front edge with a dashed centre line.
    const ry0 = y1 - 1.35;
    const ry1 = y1 - 0.35;
    poly(ctx, [project(x0 + 0.1, ry0), project(x1 - 0.1, ry0), project(x1 - 0.1, ry1), project(x0 + 0.1, ry1)], concrete ? '#4f5458' : '#a88d5c');
    for (let t = 0.08; t < 0.95; t += 0.14) {
      const [a0, a1] = project(x0 + (x1 - x0) * t, (ry0 + ry1) / 2);
      const [c0, c1] = project(x0 + (x1 - x0) * (t + 0.07), (ry0 + ry1) / 2);
      line(ctx, a0, a1, c0, c1, concrete ? '#f2f2ea' : '#d8c79a', 0.9 * scale);
    }
  } else {
    // Landing pads.
    for (const [px, py] of [
      [b.tx + 1.2, b.ty + 2.8],
      [b.tx + 2.8, b.ty + 2.8],
    ]) {
      const [x, y] = project(px, py, 1);
      ctx.beginPath();
      ctx.ellipse(x, y, 13 * scale, 6.5 * scale, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#9fb0bb';
      ctx.fill();
      ctx.strokeStyle = `rgba(56,214,245,${(0.55 + 0.35 * Math.sin(time * 3 + px)).toFixed(3)})`;
      ctx.lineWidth = 1.4 * scale;
      ctx.stroke();
    }
  }
  const progress = b.built ? 1 : Math.min(1, b.progress * 1.2);
  // Hangar on the back half.
  const hx0 = x0 + 0.25;
  const hy0 = y0 + 0.2;
  const hx1 = x0 + 2.1;
  const hy1 = y0 + 1.5;
  const hangarH = (future ? 14 : concrete ? 16 : 13) * progress;
  const wall = future ? '#f4f8fa' : concrete ? '#9aa2a8' : '#7a7f6b';
  box3d(ctx, project, (hx0 + hx1) / 2, (hy0 + hy1) / 2, 0, (hx1 - hx0) / 2, (hy1 - hy0) / 2, 0, hangarH, shade(wall, 0.1), wall);
  if (b.built && !future) {
    // An arched roof: a few ribs over the hangar.
    for (let t = 0; t <= 1.001; t += 0.25) {
      const x = hx0 + (hx1 - hx0) * t;
      const [a0, a1] = project(x, hy0, hangarH);
      const [m0, m1] = project(x, (hy0 + hy1) / 2, hangarH + 6);
      const [c0, c1] = project(x, hy1, hangarH);
      ctx.beginPath();
      ctx.moveTo(a0, a1);
      ctx.quadraticCurveTo(m0, m1 - 4 * scale, c0, c1);
      ctx.strokeStyle = shade(wall, -0.25);
      ctx.lineWidth = 1.2 * scale;
      ctx.stroke();
    }
  }
  // The owner's colour over the hangar door.
  poly(ctx, [project(hx0, hy1, hangarH - 3), project(hx1, hy1, hangarH - 3), project(hx1, hy1, hangarH), project(hx0, hy1, hangarH)], b.color);
  if (concrete && b.built) {
    // Control tower with a glass cabin.
    const tx = x1 - 0.55;
    const ty = y0 + 0.55;
    box3d(ctx, project, tx, ty, 0, 0.22, 0.22, 0, 22, shade(wall, 0.08), wall);
    box3d(ctx, project, tx, ty, 0, 0.3, 0.3, 22, 28, future ? '#38d6f5' : '#9fd0e6', '#5b7f92');
  } else if (b.built) {
    // Windsock.
    const [p0, p1] = project(x1 - 0.4, y0 + 0.4, 0);
    const [q0, q1] = project(x1 - 0.4, y0 + 0.4, 18);
    line(ctx, p0, p1, q0, q1, '#5a4a36', 1 * scale);
    const flap = Math.sin(time * 3 + b.seed) * 1.5;
    poly(
      ctx,
      [
        [q0, q1],
        [q0 + 8 * scale, q1 + 1 + flap],
        [q0 + 8 * scale, q1 + 4 + flap],
        [q0, q1 + 4],
      ],
      '#e8742c',
    );
  }
  ctx.globalAlpha = 1;
}
