// ---------------------------------------------------------------------------
// Num — numeric conveniences over the strategy polyfill.
//
// The fluent map/constrain chains (Num.map(x).from(a,b).to(c,d)) were dropped
// with the free map()/constrain() functions in the Zephyr-first cleanup —
// the remap/clamp arithmetic is a three-line helper in user code, and no
// backend honors it natively. abs/min/max stay (bare-call polyfills exist on
// every framework).
// ---------------------------------------------------------------------------

export class NumClass {
  // No __instance_name — Num methods must NOT be intercepted by the HAL
  // resolver. They pass through as bare C++ calls (Num.abs(-7)), which the
  // strategy's __tc_Num polyfill struct provides. The strategy post-processes
  // the output to rename Num.abs( → Num._abs( to match the polyfill's
  // parenthesized method names (which avoid macro collisions with Arduino's
  // abs/min/max macros). See strategy.ts __tc_Num struct + the rewrite regex.
  abs(x: number): number { return 0; }
  min(a: number, b: number): number { return 0; }
  max(a: number, b: number): number { return 0; }
}

export const Num = new NumClass();

export function abs(x: number): number { return 0; }
export function min(a: number, b: number): number { return 0; }
export function max(a: number, b: number): number { return 0; }
