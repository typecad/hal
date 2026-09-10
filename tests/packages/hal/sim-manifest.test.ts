// ---------------------------------------------------------------------------
// @typecad/hal/sim — createBoardFromManifest
//
// The `typecad-hal create` starter sim must model the PROJECT's board (the
// generated board.json manifest), not an arduino-Uno-shaped default. These
// tests exercise the exact helper surface the scaffolded sim uses, against
// the real blackpill boardgen output shape.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  createBoardFromManifest,
  manifestPinNumberByName,
  type BoardManifest,
} from '../../../packages/hal/src/sim';

const BLACKPILL_CONSTANTS: Record<string, string | number | boolean> = {
  // Pin sweep (excerpt): PA0 = 0, PB6 = 22, PB7 = 23, PC13 = 45 (LED).
  'pins.all.0.number': 0,
  'pins.all.0.name': 'PA0',
  'pins.all.0.capabilities.pwm': true,
  'pins.all.0.capabilities.interrupt': true,
  'pins.all.22.number': 22,
  'pins.all.22.name': 'PB6',
  'pins.all.22.capabilities.pwm': true,
  'pins.all.22.capabilities.interrupt': true,
  'pins.all.45.number': 45,
  'pins.all.45.name': 'PC13',
  'pins.all.45.capabilities.interrupt': true,
  'pins.all.63.number': 63,
  'pins.all.63.name': 'PD2',
  'pins.all.63.capabilities.interrupt': true,
  'pins.aliases.LED': 'PC13',
  'pins.aliases.BUTTON': 'PA0',
  'peripherals.uart.count': 1,
  'peripherals.i2c.count': 1,
  'peripherals.spi.count': 1,
};

const manifest: BoardManifest = { constants: BLACKPILL_CONSTANTS };

describe('manifestPinNumberByName', () => {
  it('resolves datasheet names and silkscreen aliases to pin numbers', () => {
    expect(manifestPinNumberByName(manifest, 'PC13')).toBe(45);
    expect(manifestPinNumberByName(manifest, 'LED')).toBe(45); // alias → PC13
    expect(manifestPinNumberByName(manifest, 'BUTTON')).toBe(0); // alias → PA0
  });

  it('returns undefined for pins the board does not export', () => {
    expect(manifestPinNumberByName(manifest, 'PE1')).toBeUndefined();
    expect(manifestPinNumberByName(manifest, 'NOPE')).toBeUndefined();
  });
});

describe('createBoardFromManifest', () => {
  it('sizes the board from the manifest pins, not an arduino default', () => {
    const board = createBoardFromManifest(manifest);
    // The manifest sweep ends at PD2 = 63 — pin 45 must exist (the old
    // Uno-default 14-pin sim threw on it, which is exactly the point).
    expect(board.digitalPins.size).toBe(64);
    expect(() => board.digital(45)).not.toThrow();
    expect(() => board.digital(13)).not.toThrow();
  });

  it('derives PWM and interrupt capability sets from the pin facts', () => {
    const board = createBoardFromManifest(manifest);
    expect(board.pwm(0)).toBeDefined(); // PA0 capabilities.pwm
    expect(board.pwm(22)).toBeDefined(); // PB6 capabilities.pwm
    expect(() => board.pwm(45)).toThrow(); // PC13 has no PWM fact
    expect(board.interrupt(63)).toBeDefined(); // PD2 capabilities.interrupt
  });

  it('takes bus counts from the peripheral facts', () => {
    const board = createBoardFromManifest(manifest);
    expect(board.serial(0)).toBeDefined();
    expect(() => board.serial(1)).toThrow();
    expect(board.i2c(0)).toBeDefined();
    expect(board.spi(0)).toBeDefined();
  });
});
