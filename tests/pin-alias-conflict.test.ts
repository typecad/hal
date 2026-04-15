import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Pin Alias Conflict Validation', () => {
  it('generates warning when the same physical pin is used through multiple names', () => {
    const result = transpile(`
      import { D13, LED } from '@typecode/board-arduino-uno';
      D13.asOutput();
      LED.high();
    `, { target: 'arduino' });

    const aliasWarnings = result.diagnostics.filter(
      d => d.code === 'pin-alias-conflict'
    );

    expect(aliasWarnings.length).toBeGreaterThan(0);
    expect(aliasWarnings[0].message).toContain('D13');
    expect(aliasWarnings[0].message).toContain('LED');
    expect(aliasWarnings[0].severity).toBe('warning');
  });

  it('does not generate warning when a pin is used through only one name', () => {
    const result = transpile(`
      import { LED } from '@typecode/board-arduino-uno';
      LED.asOutput();
      LED.high();
    `, { target: 'arduino' });

    const aliasWarnings = result.diagnostics.filter(
      d => d.code === 'pin-alias-conflict'
    );

    expect(aliasWarnings.length).toBe(0);
  });
});