import { describe, it, expect } from 'vitest';
import { resolveBoardConstants, pinEntryIndexForNumber } from '@typecad/cuttlefish/testing';

// ---------------------------------------------------------------------------
// pins.all sparse-index regression
//
// The pins.all array is keyed by position, but HAL pin numbers are sparse on
// MCUs with unbonded pads — STM32F411 has no PB11, so PB12 (number 28) sits
// at array index 27. Lookups that keyed `pins.all.${number}` read the wrong
// pin's entry (number 28 read PB13's). pinEntryIndexForNumber resolves the
// entry by its `number` field instead.
// ---------------------------------------------------------------------------

describe('pinEntryIndexForNumber (sparse pin arrays)', () => {
  // The MCU file is the source of the flattened pin entries (board files
  // spread ...MCU.pins, which the flattener cannot evaluate directly).
  const bc = resolveBoardConstants(
    'C:/typecad/typecode/mcus/mcu-stm32f411/src/index.ts',
  );

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
    expect(pinEntryIndexForNumber(47, bc)).toBe(33); // PC15 (last pin)
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

describe('board-constants const-reference flattening (capability objects)', () => {
  // Regression: MCU packages declare capabilities via shared const objects
  // (`capabilities: GPIO_ANALOG` where GPIO_ANALOG = { ...FULL_GPIO,
  // analogInput: YES }). The flattener resolved neither the identifier
  // reference nor the spread, so pins.all.N.capabilities.* flattened to
  // nothing and pin-capability validation rejected every pin on these boards.
  const bc = resolveBoardConstants(
    'C:/typecad/typecode/mcus/mcu-stm32f411/src/index.ts',
  );

  it('resolves a const-with-spread capability object (PA0 → GPIO_ANALOG)', () => {
    expect(bc.get('pins.all.0.capabilities.analogInput')).toBe(true);
    // analogInput comes from GPIO_ANALOG itself…
    expect(bc.get('pins.all.0.capabilities.analogInput')).not.toBe(undefined);
    // …and the rest arrives through the FULL_GPIO spread.
    expect(bc.get('pins.all.0.capabilities.interrupt')).toBe(true);
    expect(bc.get('pins.all.0.capabilities.digitalOutput')).toBe(true);
    expect(bc.get('pins.all.0.capabilities.pullDown')).toBe(true);
  });

  it('resolves a plain const capability object (PB2 → FULL_GPIO)', () => {
    expect(bc.get('pins.all.18.capabilities.pwm')).toBe(true);
    expect(bc.get('pins.all.18.capabilities.analogInput')).toBe(false);
  });

  it('leaves unknown identifiers unflattened (no fabricated keys)', () => {
    // A capability the object does not declare must be absent, not false —
    // absence is what lets validators distinguish "no data" from "no".
    expect(bc.has('pins.all.18.capabilities.touch')).toBe(true); // FULL_GPIO declares touch: NO
    expect(bc.get('pins.all.18.capabilities.touch')).toBe(false);
    expect(bc.has('pins.all.18.capabilities.nonexistent')).toBe(false);
  });
});
