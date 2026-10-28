/**
 * Text encoding for saved games. Plain JSON would lose what the simulation
 * relies on to run on exactly as before: typed arrays (map, fog of war),
 * sets and maps (techs, AI bookkeeping) and the odd numbers -0, ±Infinity
 * and NaN. Everything else goes through as ordinary JSON.
 */

type Tagged =
  | { $n: string }
  | { $set: unknown[] }
  | { $map: Array<[unknown, unknown]> }
  | { $ta: TypedName; b64: string };

type TypedName = 'u8' | 'u16' | 'i16' | 'i32' | 'f32';

const TYPED: Record<TypedName, { new (buffer: ArrayBuffer): ArrayBufferView }> = {
  u8: Uint8Array,
  u16: Uint16Array,
  i16: Int16Array,
  i32: Int32Array,
  f32: Float32Array,
};

function typedName(v: unknown): TypedName | null {
  if (v instanceof Uint8Array) return 'u8';
  if (v instanceof Uint16Array) return 'u16';
  if (v instanceof Int16Array) return 'i16';
  if (v instanceof Int32Array) return 'i32';
  if (v instanceof Float32Array) return 'f32';
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

export function encodeState(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'number') {
      if (Object.is(v, -0)) return { $n: '-0' };
      if (!Number.isFinite(v)) return { $n: String(v) };
      return v;
    }
    const ta = typedName(v);
    if (ta) {
      const view = v as ArrayBufferView;
      return { $ta: ta, b64: toBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)) };
    }
    if (v instanceof Set) return { $set: [...v] };
    if (v instanceof Map) return { $map: [...v] };
    return v;
  });
}

export function decodeState<T>(text: string): T {
  return JSON.parse(text, (_key, v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const t = v as Partial<Record<string, unknown>>;
    if ('$n' in t && Object.keys(t).length === 1) {
      const n = (v as { $n: string }).$n;
      return n === '-0' ? -0 : Number(n);
    }
    if ('$set' in t) return new Set((v as { $set: unknown[] }).$set);
    if ('$map' in t) return new Map((v as { $map: Array<[unknown, unknown]> }).$map);
    if ('$ta' in t) {
      const { $ta, b64 } = v as Extract<Tagged, { $ta: TypedName }>;
      return new TYPED[$ta](fromBase64(b64));
    }
    return v;
  }) as T;
}
