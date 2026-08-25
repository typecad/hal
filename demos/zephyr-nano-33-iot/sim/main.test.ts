// ---------------------------------------------------------------------------
// Hardware simulation — dimmer logic
//
// Runs entirely on your computer with `npm run simulate` (vitest + the
// @typecad/simulator package). No board, serial port, or west toolchain
// required. The firmware's core math (voltage → duty mapping and the
// breathing triangle wave) is factored into pure functions the simulator
// exercises — the same functions src/main.ts inlines into its loop.
//
// This is the fast tier — iterate on logic here, then confirm on real
// hardware with `npm run test:hw` (which flashes tests/ to the board).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

// ===========================================================================
// FIRMWARE LOGIC
// ---------------------------------------------------------------------------
// Pure helpers factored out of src/main.ts's loop so the simulator can
// exercise them. On the board the same expressions run inline in the while
// loop against real pins.
// ===========================================================================

/** Full-scale ADC range: the sam0 driver's ADC_REF_VDD_1_2 = VDDANA/2 (mV). */
const FULL_SCALE_MV = 1650;

/**
 * Maps an ADC millivolt reading onto the 0-255 PWM duty range, saturating at
 * full scale (the sam0 ADC itself saturates above VDDANA/2).
 */
export function millivoltsToDuty(mv: number): number {
  const clamped = Math.max(0, Math.min(FULL_SCALE_MV, mv));
  return Math.min(255, (clamped * 255) / FULL_SCALE_MV);
}

/** One breathing-mode step of the 0-255 triangle wave. */
export function breathStep(breath: number, up: boolean): { breath: number; up: boolean } {
  const next = breath + (up ? 5 : -5);
  if (next >= 250) return { breath: 250, up: false };
  if (next <= 0) return { breath: 0, up: true };
  return { breath: next, up };
}

// ===========================================================================
// TEST BENCH
// ===========================================================================

describe("Dimmer mapping (simulator)", () => {
  it("maps 0 mV to duty 0", () => {
    expect(millivoltsToDuty(0)).toBe(0);
  });

  it("maps full scale linearly", () => {
    expect(millivoltsToDuty(FULL_SCALE_MV)).toBe(255);
    expect(Math.round(millivoltsToDuty(FULL_SCALE_MV / 2))).toBe(128);
  });

  it("saturates above full scale (the sam0 ADC does the same)", () => {
    expect(millivoltsToDuty(3300)).toBe(255);
    expect(millivoltsToDuty(-100)).toBe(0);
  });
});

describe("Breathing triangle wave (simulator)", () => {
  it("rises from 0", () => {
    expect(breathStep(0, true)).toEqual({ breath: 5, up: true });
  });

  it("turns around at the peak", () => {
    expect(breathStep(248, true)).toEqual({ breath: 250, up: false });
  });

  it("turns around at the floor", () => {
    expect(breathStep(2, false)).toEqual({ breath: 0, up: true });
  });

  it("sweeps up and back down over a full cycle", () => {
    let state = { breath: 0, up: true };
    const seen: number[] = [];
    for (let i = 0; i < 220; i++) {
      state = breathStep(state.breath, state.up);
      seen.push(state.breath);
    }
    expect(Math.max(...seen)).toBe(250);
    // After 250/5 = 50 steps up + 50 down, the wave is back near the floor.
    expect(seen[99]).toBeLessThanOrEqual(10);
  });
});
