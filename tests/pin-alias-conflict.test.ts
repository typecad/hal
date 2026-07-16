import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Pin Alias Conflict Validation', () => {
  it('does not generate warning when a pin is used through only one name', () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      LED.asOutput();
      LED.high();
    `, { target: 'arduino' });

    const aliasWarnings = result.diagnostics.filter(
      d => d.code === 'pin-alias-conflict'
    );

    expect(aliasWarnings.length).toBe(0);
  });

  it('does not generate warning when using D13 directly', () => {
    // In the __EMIT__ system, pin names from aliases (LED, TX, etc.) are
    // resolved to their D-prefixed canonical names at the IR level.
    // Pin alias conflicts are no longer detectable from __EMIT__ nodes
    // since both D13 and LED produce pin number 13, tracked as D13.
    const result = transpile(`
      import { D13, LED } from '@typecad/board-arduino-uno';
      D13.asOutput();
      LED.high();
    `, { target: 'arduino' });

    const aliasWarnings = result.diagnostics.filter(
      d => d.code === 'pin-alias-conflict'
    );

    // Both D13 and LED resolve to pin 13, tracked as D13 — no alias conflict
    // since only one name (D13) is in pinsUsed.
    expect(aliasWarnings.length).toBe(0);
  });

  // Positive coverage: referencing the same physical pin through two genuinely
  // distinct names (A4 and SDA both map to PC4) must be flagged. Without this,
  // the negative cases above would still pass if the validator were deleted.
  it('flags a pin referenced through multiple distinct names (A4 and SDA)', () => {
    const result = transpile(`
      import { A4, SDA } from '@typecad/board-arduino-uno';
      A4.asInput();
      SDA.asInput();
    `, { target: 'arduino' });

    const aliasWarnings = result.diagnostics.filter(
      d => d.code === 'pin-alias-conflict'
    );

    expect(aliasWarnings.length).toBe(1);
    expect(aliasWarnings[0].severity).toBe('warning');
    expect(aliasWarnings[0].message).toContain('PC4');
    expect(aliasWarnings[0].message).toContain('SDA');
  });
});
