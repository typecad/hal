import { describe, it, expect } from 'vitest';
import { pinEntryIndexForNumber } from '@typecad/cuttlefish/testing';
import type { BoardConstants } from '@typecad/cuttlefish/api/shared';

// ---------------------------------------------------------------------------
// pins.all sparse-index regression
//
// The pins.all array is keyed by position, but HAL pin numbers can be sparse
// (unbonded pads excluded at generation). Lookups that keyed
// `pins.all.${number}` read the wrong pin's entry. pinEntryIndexForNumber
// resolves the entry by its `number` field instead.
//
// The board packages that carried a real sparse array are gone; the fixture
// below reproduces the exact shape boardgen emits for a package with an
// unbonded pad (index ≠ number past the gap).
// ---------------------------------------------------------------------------

function sparseFixture(): BoardConstants {
  // Mirrors an F411-class pinout: PA0..PA15, PB0..PB10,
  // (PB11 unbonded — absent), PB12..PB15, PC13..PC15.
  const bc: BoardConstants = new Map();
  const names: [number, string][] = [];
  for (let b = 0; b <= 15; b++) names.push([b, `PA${b}`]);
  for (let b = 0; b <= 10; b++) names.push([16 + b, `PB${b}`]);
  for (let b = 12; b <= 15; b++) names.push([16 + b, `PB${b}`]);
  for (const b of [13, 14, 15]) names.push([32 + b, `PC${b}`]);
  names.forEach(([num, name], idx) => {
    bc.set(`pins.all.${idx}.number`, num);
    bc.set(`pins.all.${idx}.name`, name);
  });
  return bc;
}

describe('pinEntryIndexForNumber (sparse pin arrays)', () => {
  const bc = sparseFixture();

  it('resolves dense-region pins where index === number (PA0..PB10)', () => {
    expect(pinEntryIndexForNumber(0, bc)).toBe(0);   // PA0
    expect(pinEntryIndexForNumber(16, bc)).toBe(16); // PB0
    expect(pinEntryIndexForNumber(26, bc)).toBe(26); // PB10 (last dense pin)
  });

  it('resolves past the PB11 gap by number, not index', () => {
    // PB12 is number 28 but array index 27; PB13 is 29/28; PC13 is 45/31.
    expect(pinEntryIndexForNumber(28, bc)).toBe(27); // PB12
    expect(pinEntryIndexForNumber(29, bc)).toBe(28); // PB13
    expect(pinEntryIndexForNumber(45, bc)).toBe(31); // PC13
  });

  it('returns -1 for numbers no entry declares (PB11 does not exist)', () => {
    expect(pinEntryIndexForNumber(27, bc)).toBe(-1);
    expect(pinEntryIndexForNumber(99, bc)).toBe(-1);
  });

  it('names come back for the resolved entry, not the index neighbor', () => {
    const idx = pinEntryIndexForNumber(28, bc);
    expect(idx).toBe(27);
    expect(String(bc.get(`pins.all.${idx}.name`))).toBe('PB12');
    // The old buggy lookup read index 28 — PB13's entry.
    expect(String(bc.get(`pins.all.28.name`))).toBe('PB13');
  });
});
