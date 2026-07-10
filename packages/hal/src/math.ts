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
  static readonly __instance_name = "Num";
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
