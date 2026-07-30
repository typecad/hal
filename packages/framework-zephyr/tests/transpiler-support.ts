// Shared types/helpers used across the framework-zephyr hardware-test groups.
// Mirrors framework-avr/tests/transpiler-support.ts.

export type SampleWindow = {
  low: number;
  high: number;
};

export function clampToWindow(value: number, window: SampleWindow): number {
  if (value < window.low) {
    return window.low;
  }

  if (value > window.high) {
    return window.high;
  }

  return value;
}

export class RollingCounter {
  value: number;

  constructor(seed: number) {
    this.value = seed;
  }

  add(step: number): number {
    this.value += step;
    return this.value;
  }
}
