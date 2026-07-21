import { describe, expect, it } from 'vitest';
import { HAL_OPERATION_KINDS } from '@typecad/cuttlefish/api/shared';
import { DISPLAY_OPERATION_KINDS } from '@typecad/cuttlefish/api/shared';

describe('HAL_OPERATION_KINDS', () => {
  it('is a non-empty const array', () => {
    expect(Array.isArray(HAL_OPERATION_KINDS)).toBe(true);
    expect(HAL_OPERATION_KINDS.length).toBeGreaterThan(50);
  });

  it('contains no duplicates', () => {
    const dupes = HAL_OPERATION_KINDS.filter(
      (k, i) => HAL_OPERATION_KINDS.indexOf(k) !== i,
    );
    expect(dupes).toEqual([]);
  });

  it('contains no display.* entries (those live in DISPLAY_OPERATION_KINDS)', () => {
    const display = HAL_OPERATION_KINDS.filter((k) => k.startsWith('display.'));
    expect(display).toEqual([]);
  });

  it('does not overlap with DISPLAY_OPERATION_KINDS', () => {
    const display = new Set<string>(DISPLAY_OPERATION_KINDS);
    const overlap = HAL_OPERATION_KINDS.filter((k) => display.has(k));
    expect(overlap).toEqual([]);
  });

  it('contains expected core op kinds', () => {
    expect(HAL_OPERATION_KINDS).toContain('gpio.write');
    expect(HAL_OPERATION_KINDS).toContain('i2c.begin');
    expect(HAL_OPERATION_KINDS).toContain('wifi.connect');
    expect(HAL_OPERATION_KINDS).toContain('http.send');
    expect(HAL_OPERATION_KINDS).toContain('raw');
  });
});
