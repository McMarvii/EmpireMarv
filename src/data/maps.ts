/**
 * Map types: each one shapes land and water differently, the fair start
 * resources stay the same everywhere. Water maps add fishing grounds and
 * room for a harbour near every base.
 */
export type MapType = 'continent' | 'coast' | 'inlandSea' | 'islands' | 'rivers' | 'steppe';
/** What the menu offers: a type or a random pick from the seed. */
export type MapChoice = MapType | 'random';

export interface MapTypeDef {
  id: MapType;
  name: string;
  text: string;
  /** Every base has a coast within reach (harbour, fish). */
  water: boolean;
}

export const MAP_TYPES: MapTypeDef[] = [
  { id: 'continent', name: 'Kontinent', text: 'Weites Land mit Seen und Wäldern.', water: false },
  { id: 'coast', name: 'Küste', text: 'Ein Ozean umschließt das Land. Jede Basis liegt nahe am Meer, gekämpft wird in der Mitte.', water: true },
  { id: 'inlandSea', name: 'Binnenmeer', text: 'Ein großes Meer in der Mitte, die Basen an seinen Ufern. Landwege führen außen herum.', water: true },
  { id: 'islands', name: 'Inseln', text: 'Jeder startet auf einer eigenen Insel. Angriffe brauchen Transportschiffe. In der Mitte liegt eine Insel mit Minen.', water: true },
  { id: 'rivers', name: 'Flüsse', text: 'Zwei Flüsse kreuzen sich und trennen die Basen; Furten führen hinüber.', water: true },
  { id: 'steppe', name: 'Steppe', text: 'Offenes Grasland mit wenig Wald, aber mehr Minen und Beeren.', water: false },
];

export const MAP_TYPE_BY_ID = new Map(MAP_TYPES.map((m) => [m.id, m]));

/** The type a choice stands for; "random" picks one from the seed, so every peer gets the same. */
export function resolveMapType(choice: MapChoice | undefined, seed: number): MapType {
  if (!choice) return 'continent';
  if (choice !== 'random') return choice;
  const h = Math.imul((seed >>> 0) ^ 0x9e3779b9, 2654435761) >>> 0;
  return MAP_TYPES[h % MAP_TYPES.length].id;
}
