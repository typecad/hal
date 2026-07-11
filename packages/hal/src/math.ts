export class MapChain {
  constructor(value: number) {}
  from(low: number, high: number): MapChain { return this; }
  to(low: number, high: number): number { return 0; }
  toPercent(): number { return 0; }
  toByte(): number { return 0; }
}

export class ConstrainChain {
  constructor(value: number) {}
  between(low: number, high: number): number { return 0; }
}

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
  constrain(value: number): ConstrainChain { return new ConstrainChain(value); }
  map(value: number): MapChain { return new MapChain(value); }
}

export const Num = new NumClass();

export function abs(x: number): number { return 0; }
export function min(a: number, b: number): number { return 0; }
export function max(a: number, b: number): number { return 0; }
