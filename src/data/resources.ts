export const RESOURCES = ['food', 'wood', 'stone', 'gold', 'iron'] as const;
export type Res = (typeof RESOURCES)[number];
export type Cost = Partial<Record<Res, number>>;
export type Stock = Record<Res, number>;

export const RES_LABEL: Record<Res, string> = {
  food: 'Nahrung',
  wood: 'Holz',
  stone: 'Stein',
  gold: 'Gold',
  iron: 'Eisen',
};

export const RES_COLOR: Record<Res, string> = {
  food: '#e0a33a',
  wood: '#8a5a2b',
  stone: '#9aa0a6',
  gold: '#f2c84b',
  iron: '#7d8fa3',
};

export function emptyStock(): Stock {
  return { food: 0, wood: 0, stone: 0, gold: 0, iron: 0 };
}

export function canAfford(stock: Stock, cost: Cost): boolean {
  for (const r of RESOURCES) {
    if ((cost[r] ?? 0) > stock[r]) return false;
  }
  return true;
}

export function pay(stock: Stock, cost: Cost): void {
  for (const r of RESOURCES) stock[r] -= cost[r] ?? 0;
}

export function refund(stock: Stock, cost: Cost): void {
  for (const r of RESOURCES) stock[r] += cost[r] ?? 0;
}

/** Lists the resources a player is missing for a cost, e.g. "120 Holz, 40 Gold". */
export function missingText(stock: Stock, cost: Cost): string {
  const parts: string[] = [];
  for (const r of RESOURCES) {
    const need = (cost[r] ?? 0) - stock[r];
    if (need > 0) parts.push(`${Math.ceil(need)} ${RES_LABEL[r]}`);
  }
  return parts.join(', ');
}

export function costText(cost: Cost): string {
  return RESOURCES.filter((r) => (cost[r] ?? 0) > 0)
    .map((r) => `${cost[r]} ${RES_LABEL[r]}`)
    .join(' · ');
}

/** A cost scaled by a factor and rounded down, e.g. the unbuilt share of a construction site. */
export function multiplyCost(cost: Cost, factor: number): Cost {
  const out: Cost = {};
  for (const r of RESOURCES) if (cost[r]) out[r] = Math.floor((cost[r] ?? 0) * factor);
  return out;
}
