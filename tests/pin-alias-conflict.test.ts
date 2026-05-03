import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Pin Alias Conflict Validation', () => {
  it('does not generate warning when a pin is used through only one name', () => {
    const result = transpile(`
      import { LED } from '@typehal/board-arduino-uno';
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
      import { D13, LED } from '@typehal/board-arduino-uno';
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
});
