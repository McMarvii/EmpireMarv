/**
 * Trigonometry and distances the simulation can rely on in every browser.
 *
 * Lockstep multiplayer and replays need bit-identical results on every
 * machine. `+ - * /` and `Math.sqrt` are exactly rounded in IEEE 754, but
 * `Math.sin`, `cos`, `atan2`, `hypot` and `**` are only approximated, and
 * Chrome, Firefox and Safari differ in the last bits. These replacements
 * use nothing but exact operations, so they agree everywhere. They are
 * accurate to about 1e-11, plenty for a game.
 */

const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
const QUARTER_PI = 0.7853981633974483;
const TAU = 6.283185307179586;
/** tan(π/8): above it, atan shifts the argument by π/4. */
const TAN_PI_8 = 0.41421356237309503;

/** Distance of a vector, without `Math.hypot`. */
export function hypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** Angle wrapped into [-π, π]. */
function wrap(a: number): number {
  return a - TAU * Math.round(a / TAU);
}

/** Taylor series of sin on [-π/2, π/2]. */
function sinCore(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
  );
}

/** Taylor series of cos on [-π/2, π/2]. */
function cosCore(x: number): number {
  const x2 = x * x;
  return (
    1 +
    x2 *
      (-1 / 2 +
        x2 *
          (1 / 24 +
            x2 *
              (-1 / 720 +
                x2 *
                  (1 / 40320 +
                    x2 * (-1 / 3628800 + x2 * (1 / 479001600 + x2 * (-1 / 87178291200 + x2 * (1 / 20922789888000))))))))
  );
}

export function sin(a: number): number {
  let x = wrap(a);
  // sin(π - x) = sin(x) folds the outer quarters in.
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  return sinCore(x);
}

export function cos(a: number): number {
  const x = wrap(a);
  // cos(π - x) = -cos(x).
  if (x > HALF_PI) return -cosCore(PI - x);
  if (x < -HALF_PI) return -cosCore(-PI - x);
  return cosCore(x);
}

/** atan for |t| <= tan(π/8), by its alternating series. */
function atanSeries(t: number): number {
  const t2 = t * t;
  let sum = 0;
  for (let n = 27; n >= 3; n -= 2) sum = t2 * ((n % 4 === 1 ? 1 : -1) / n + sum);
  return t * (1 + sum);
}

/** atan for 0 <= t <= 1: above tan(π/8) via atan(t) = π/4 + atan((t - 1) / (t + 1)). */
function atanUnit(t: number): number {
  return t > TAN_PI_8 ? QUARTER_PI + atanSeries((t - 1) / (t + 1)) : atanSeries(t);
}

export function atan(z: number): number {
  const t = z < 0 ? -z : z;
  // atan(t) = π/2 - atan(1/t) for t > 1.
  const r = t > 1 ? HALF_PI - atanUnit(1 / t) : atanUnit(t);
  return z < 0 ? -r : r;
}

/** Angle of the vector (x, y), like `Math.atan2(y, x)`. */
export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  // -0 counts as below the axis, like Math.atan2.
  if (x < 0) return y < 0 || (y === 0 && 1 / y < 0) ? atan(y / x) - PI : atan(y / x) + PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}
