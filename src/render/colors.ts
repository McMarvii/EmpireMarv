import type { EraStyle } from '../data/epochs';

const rgbCache = new Map<string, [number, number, number]>();

/** Components of "#rgb", "#rrggbb" or "rgb(r,g,b)" (what shade returns, so shades can be shaded again). */
function rgb(color: string): [number, number, number] {
  let c = rgbCache.get(color);
  if (!c) {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
    if (m) c = [Number(m[1]), Number(m[2]), Number(m[3])];
    else {
      const h = color.replace('#', '');
      const full = h.length === 3 ? h.replace(/(.)/g, '$1$1') : h;
      c = [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
    }
    rgbCache.set(color, c);
  }
  return c;
}

const shadeCache = new Map<string, string>();

/** Lightens (f > 0) or darkens (f < 0) a hex color. */
export function shade(hex: string, f: number): string {
  const key = hex + f;
  const cached = shadeCache.get(key);
  if (cached) return cached;
  const [r, g, b] = rgb(hex);
  const t = f < 0 ? 0 : 255;
  const p = Math.abs(f);
  const out = `rgb(${Math.round(r + (t - r) * p)},${Math.round(g + (t - g) * p)},${Math.round(b + (t - b) * p)})`;
  shadeCache.set(key, out);
  return out;
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export interface EraPalette {
  wall: string;
  wallDark: string;
  roof: string;
  trim: string;
  /** Soldier equipment: helmet / armour accent. */
  metal: string;
}

export const ERA_PALETTE: Record<EraStyle, EraPalette> = {
  stone: { wall: '#8b6a44', wallDark: '#6d5233', roof: '#c9a65e', trim: '#5b4128', metal: '#8a7a66' },
  ancient: { wall: '#dccaa0', wallDark: '#b9a679', roof: '#b4532d', trim: '#8f7a52', metal: '#b48a45' },
  medieval: { wall: '#e7dfca', wallDark: '#c6bca3', roof: '#7b3326', trim: '#4f3727', metal: '#9ea6ae' },
  imperial: { wall: '#cfc7b8', wallDark: '#aaa293', roof: '#4b5b6b', trim: '#efe9dc', metal: '#2f3440' },
  modern: { wall: '#a3a8ad', wallDark: '#80868c', roof: '#5f656b', trim: '#3d4247', metal: '#5c6340' },
  future: { wall: '#e8f0f4', wallDark: '#c3d0d8', roof: '#8fd0e0', trim: '#38d6f5', metal: '#e8f0f4' },
};

export const SKIN = '#e2b68e';

export const TERRAIN_COLORS: string[][] = [
  ['#5b8a38', '#5f8f3b', '#63933d', '#689841'], // grass
  ['#3e6a2b', '#416e2d', '#44722f', '#477531'], // forest floor
  ['#d4c188', '#d8c58d', '#dcca93', '#e0ce98'], // sand
  ['#2a6a9e', '#2c6ea3', '#2e72a8', '#3076ad'], // water
  ['#8a7850', '#8e7c53', '#928056', '#968459'], // dirt
];

/** Colour of each ability, calamity and priestly act: buttons, rings, beams, areas. */
export const ABILITY_COLOR: Record<string, string> = {
  rally: '#f2c84b',
  shieldwall: '#7fb2ff',
  fieldheal: '#7dff8a',
  warcry: '#ff7a3c',
  whirlwind: '#e6e9ee',
  frenzy: '#ff3b3b',
  plague: '#9ccf3c',
  quake: '#b0844e',
  firestorm: '#ff8a1e',
  storm: '#6fd6e8',
  convert: '#ffe27a',
  heal: '#7dff8a',
};
