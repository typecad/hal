// ---------------------------------------------------------------------------
// pin-capability-validation.test.ts — the "use any pin as ADC/PWM/DAC" safety
// net, driven off the catalog board model's `capabilities.*` flags.
//
// The pre-catalog validator had three bugs that made the wrong-pin error path
// silently inert on catalog boards:
//   - PWM checking was skipped outright (keyed off the removed `functions.*`
//     entries),
//   - the ADC/DAC op→capability map referenced stale op names (`adc.read`/
//     `dac.write` — long renamed to `adc.read_raw`/`adc.read_mv`/
//     `dac.write_value`), so those checks never fired,
//   - the "Use one of:" hint truncated at a hard 100 pins.
// These regression tests call validatePinCapabilities directly with a
// synthetic IR so they don't depend on the (stale) fixture catalog.
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { validatePinCapabilities } from '../../../packages/cuttlefish/src/ir/pin-capability-validation';

/** Build a minimal ProgramIR with one HAL op on a single declared pin. */
function programFor(op: string, pin: number, caps: Partial<Record<string, boolean>>) {
  const boardConstants = new Map<string, string | number | boolean>();
  boardConstants.set('pins.all.0.number', 0);
  boardConstants.set('pins.all.0.name', 'P0');
  for (const [k, v] of Object.entries(caps)) boardConstants.set(`pins.all.0.capabilities.${k}`, v);
  return {
    boardConstants,
    topLevelStatements: [
      {
        kind: 'hal-op',
        operation: { operation: op, pin },
        sourceSpan: { startLine: 1, startColumn: 1, filePath: 'test.ts' },
      },
    ],
  } as never;
}

const mismatch = (diags: { code?: string }[]) => diags.filter((d) => d.code === 'pin-capability-mismatch');

describe('pin capability validation (catalog board model)', () => {
  it('flags PWM on a non-PWM pin', () => {
    const diags = validatePinCapabilities(programFor('pwm.set_duty', 0, { pwm: false }));
    const hits = mismatch(diags);
    expect(hits.length).toBe(1);
    expect(hits[0]!.message).toMatch(/P0 does not support PWM/);
    expect(hits[0]!.hint).toMatch(/No pins on this board support PWM/);
  });

  it('lowers PWM on a PWM-capable pin without a diagnostic', () => {
    const diags = validatePinCapabilities(programFor('pwm.set_duty', 0, { pwm: true }));
    expect(mismatch(diags).length).toBe(0);
  });

  it('flags ADC (adc.read_raw) on a non-analog pin', () => {
    const diags = validatePinCapabilities(programFor('adc.read_raw', 0, { analogInput: false }));
    expect(mismatch(diags).length).toBe(1);
  });

  it('flags DAC (dac.write_value) on a non-analog-output pin', () => {
    const diags = validatePinCapabilities(programFor('dac.write_value', 0, { analogOutput: false }));
    expect(mismatch(diags).length).toBe(1);
  });

  it('accepts ADC on an analog pin (pin number < 14 is no longer special)', () => {
    // A low-numbered analog pin (e.g. PA0 = 0) must pass, not be skipped by
    // the old `pin < 14` channel-index heuristic.
    const diags = validatePinCapabilities(programFor('adc.read_raw', 0, { analogInput: true }));
    expect(mismatch(diags).length).toBe(0);
  });
});
