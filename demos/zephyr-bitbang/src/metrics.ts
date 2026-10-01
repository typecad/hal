// ---------------------------------------------------------------------------
// metrics.ts — environment conversions (namespace module)
//
// Real TS libraries group helpers under a namespace; the transpiler lowers
// `Metrics.dewPointC(...)` to `Metrics::dewPointC(...)` in a real C++
// namespace. The Magnus formula coefficients are the standard ones used by
// small weather stations.
// ---------------------------------------------------------------------------

export namespace Metrics {
  const MAGNUS_A = 17.62;
  const MAGNUS_B = 33.3;

  /** Magnus dew point from temperature (°C) and relative humidity (%). */
  export function dewPointC(tempC: number, rh: number): number {
    const rhSafe = rh < 1.0 ? 1.0 : rh;
    const gamma = Math.log(rhSafe / 100.0) + (MAGNUS_A * tempC) / (MAGNUS_B + tempC);
    return (MAGNUS_B * gamma) / (MAGNUS_A - gamma);
  }

  /** Absolute humidity in g/m³ — how much water the air actually holds. */
  export function absHumidity(tempC: number, rh: number): number {
    const saturation = 6.112 * Math.exp((MAGNUS_A * tempC) / (MAGNUS_B + tempC));
    return (saturation * rh * 2.1674) / (273.15 + tempC);
  }

  /** Comfort verdict for a living space (the 19–24 °C / 30–60 % band). */
  export function comfort(tempC: number, rh: number): string {
    const tempOk = tempC >= 19.0 && tempC <= 24.0;
    const rhOk = rh >= 30.0 && rh <= 60.0;
    if (tempOk && rhOk) {
      return 'ok';
    }
    if (!tempOk && !rhOk) {
      return 'temp+rh';
    }
    return tempOk ? 'rh' : 'temp';
  }

  /** Fire-risk style point: dry air + heat shortens it. Minutes, 0 = n/a. */
  export function drynessScore(tempC: number, rh: number): number {
    if (rh > 60.0) {
      return 0;
    }
    // NOTE: bounds via typed locals — whole-double literals (100.0) render as
    // int in the generated C++, which breaks template deduction at the call
    // site (see findings suite, documented-open).
    const lo = 0.0;
    const hi = 100.0;
    const base = clamp(Math.floor((60.0 - rh) * (tempC / 30.0)), lo, hi);
    return base;
  }

  /** Generic bounds — the int and double call sites deduce separately. */
  export function clamp<T>(v: T, lo: T, hi: T): T {
    if (v < lo) {
      return lo;
    }
    if (v > hi) {
      return hi;
    }
    return v;
  }
}
