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

const PERF_KEY = 'empiremarv.perf';

/** Whether the frame rate readout (F3) is shown. */
export function loadPerf(): boolean {
  try {
    return localStorage.getItem(PERF_KEY) === '1';
  } catch {
    return false;
  }
}

export function savePerf(on: boolean): void {
  try {
    localStorage.setItem(PERF_KEY, on ? '1' : '0');
  } catch {
    // Without storage the choice lasts for this session.
  }
}

/** Size of the interface: 0 picks it from the window, otherwise a fixed factor. */
export const UI_SCALES = [0, 1, 1.25, 1.5, 1.75, 2] as const;

const UI_SCALE_KEY = 'empiremarv.uiscale';

export function loadUiScale(): number {
  try {
    const v = Number(localStorage.getItem(UI_SCALE_KEY));
    return (UI_SCALES as readonly number[]).includes(v) ? v : 0;
  } catch {
    return 0;
  }
}

export function saveUiScale(scale: number): void {
  try {
    localStorage.setItem(UI_SCALE_KEY, String(scale));
  } catch {
    // Without storage the choice lasts for this session.
  }
}

/**
 * The factor the interface is drawn at in a window of this size. Automatic: 1 up to Full HD, then in
 * quarter steps (1440p → 1.5, 4K → 2). A fixed choice never grows the bars past what the window holds,
 * because the layout needs about 1280 × 720 of room at any size.
 */
export function uiScaleFor(choice: number, width: number, height: number): number {
  const fits = Math.max(1, Math.min(width / 1280, height / 720));
  const wanted = choice > 0 ? choice : Math.max(1, Math.floor(Math.min(width / 1680, height / 945) * 4) / 4);
  return Math.min(2, wanted, Math.floor(fits * 4) / 4);
}

/** Applies the interface size to the page (the CSS variable --ui-scale); returns the factor. */
export function applyUiScale(): number {
  uiScale = uiScaleFor(loadUiScale(), window.innerWidth, window.innerHeight);
  document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  return uiScale;
}

let uiScale = 1;

/** The interface size last applied. */
export function currentUiScale(): number {
  return uiScale;
}
