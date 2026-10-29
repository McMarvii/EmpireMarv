/**
 * What draws the map. Automatic: WebGL where the graphics card renders it,
 * the canvas where WebGL only runs emulated in software (blocked drivers),
 * which would be slower than the canvas. WebGL and canvas force one.
 */
export type GraphicsMode = 'auto' | 'webgl' | 'canvas';

const STORAGE_KEY = 'empiremarv.graphics';

export function loadGraphics(): GraphicsMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'webgl' || v === 'canvas' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveGraphics(mode: GraphicsMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Without storage the choice lasts for this session.
  }
}
