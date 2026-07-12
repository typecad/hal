// ---------------------------------------------------------------------------
// Simulator — createBoardFromDefinition (board-package integration)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { ArduinoUno } from '@typecad/board-arduino-uno';
import type { BoardDefinition } from '@typecad/cuttlefish/api/schema';
import {
  createBoardFromDefinition,
  SimPWMPin,
  SimAnalogPin,
} from '../../../packages/simulator/src/index';

// ===========================================================================
// Real board package: Arduino Uno
// ===========================================================================

describe('createBoardFromDefinition — Arduino Uno', () => {
  const board = createBoardFromDefinition(ArduinoUno);

  it('derives digital and analog pin counts from the board definition', () => {
    expect(board.digitalPins.size).toBe(20); // PD0-PD7, PB0-PB5, PC0-PC5
    expect(board.analogPins.size).toBe(6); // A0-A5 (PC0-PC5)
  });

  it('derives PWM pins from pins.all capabilities', () => {
    expect(Array.from(board.pwmPins.keys())).toEqual([3, 5, 6, 9, 10, 11]);
    expect(board.pwm(9)).toBeInstanceOf(SimPWMPin);
  });

  it('derives interrupt pins from the capability flag', () => {
    // ATmega328P flags only PD2 (INT0) and PD3 (INT1) with the interrupt
    // capability in its board-definition data, so the derivation yields [2, 3].
    expect(Array.from(board.interruptPins.keys())).toEqual([2, 3]);
  });

  it('derives bus counts from peripherals', () => {
    expect(board.i2cBuses.size).toBe(1);
    expect(board.spiBuses.size).toBe(1);
    expect(board.serialPorts.size).toBe(1);
  });

  it('applies the board ADC resolution to every analog pin', () => {
    expect(board.analog(0).getAnalogResolution()).toBe(10);
  });

  it('applies the board ADC reference voltage so readVoltage is accurate', () => {
    const a0 = board.analog(0);
    a0.injectValue(1023); // full-scale on a 10-bit ADC
    // 1023/1023 * 5.0V = 5.0
    expect(a0.readVoltage()).toBeCloseTo(5.0, 5);
  });

  it('drives the on-board LED pin (D13 / PB5) end-to-end', () => {
    const led = board.digital(13);
    led.asOutput();
    led.high();
    expect(led.getBitValue()).toBe(1);
  });

  it('PWM duty math respects the 8-bit resolution from the board package', () => {
    const motor = board.pwm(9);
    motor.asOutput();
    motor.write(255); // 8-bit max → 100%
    expect(motor.getPwmPercent()).toBeCloseTo(100, 0);
  });
});

// ===========================================================================
// Generic / synthetic board — proves the helper is not Uno-specific
// ===========================================================================

describe('createBoardFromDefinition — synthetic board', () => {
  const synthetic: BoardDefinition = {
    id: 'test-mcu',
    name: 'Test MCU',
    vendor: 'Test',
    description: 'Synthetic board for helper coverage',
    mcu: {} as any,
    clockSpeed: 8000000,
    pins: {
      all: [
        { number: 0, name: 'GP0', capabilities: { digitalInput: true, digitalOutput: true, analogInput: false, analogOutput: false, pwm: false, interrupt: true, pullUp: true, pullDown: false, touch: false, openDrain: false }, unsafe: true },
        { number: 1, name: 'GP1', capabilities: { digitalInput: true, digitalOutput: true, analogInput: false, analogOutput: false, pwm: true, interrupt: false, pullUp: true, pullDown: false, touch: false, openDrain: false } },
        { number: 2, name: 'GP2', capabilities: { digitalInput: true, digitalOutput: true, analogInput: false, analogOutput: false, pwm: true, interrupt: true, pullUp: true, pullDown: false, touch: false, openDrain: false } },
        { number: 3, name: 'GP3', capabilities: { digitalInput: true, digitalOutput: true, analogInput: true, analogOutput: false, pwm: false, interrupt: false, pullUp: true, pullDown: false, touch: false, openDrain: false } },
      ],
      digital: ['GP0', 'GP1', 'GP2', 'GP3'],
      analog: ['GP3'],
      pwm: ['GP1', 'GP2'],
      unsafe: ['GP0'],
      i2c: { 0: { sda: 'GP1', scl: 'GP2' }, 1: { sda: 'GP3', scl: 'GP0' } },
      spi: { 0: { mosi: 'GP1', miso: 'GP2', sck: 'GP3' } },
      uart: { 0: { tx: 'GP1', rx: 'GP2' }, 1: { tx: 'GP3', rx: 'GP0' } },
    } as any,
    peripherals: {
      i2c: [{ instance: 0, defaultPins: {} }, { instance: 1, defaultPins: {} }],
      spi: [{ instance: 0, defaultPins: {} }],
      uart: [{ instance: 0, defaultPins: {} }, { instance: 1, defaultPins: {} }],
      adc: [{ instance: 0, channels: 1, resolution: 12, referenceVoltage: 3.3, maxValue: 4095 }],
      pwm: { channels: 2, resolution: 16, maxFrequency: 100000 },
    } as any,
    build: {},
  };

  const board = createBoardFromDefinition(synthetic);

  it('derives counts and bus counts from the synthetic definition', () => {
    expect(board.digitalPins.size).toBe(4);
    expect(board.analogPins.size).toBe(1);
    expect(board.i2cBuses.size).toBe(2);
    expect(board.spiBuses.size).toBe(1);
    expect(board.serialPorts.size).toBe(2);
  });

  it('derives PWM pins from capability flags', () => {
    expect(Array.from(board.pwmPins.keys())).toEqual([1, 2]);
  });

  it('excludes unsafe pins from the interrupt set', () => {
    // GP0 is interrupt-capable but unsafe → excluded. GP2 is the only
    // remaining interrupt-capable, non-unsafe pin.
    expect(Array.from(board.interruptPins.keys())).toEqual([2]);
  });

  it('applies the 12-bit ADC resolution and 3.3V reference', () => {
    const a = board.analog(0);
    expect(a.getAnalogResolution()).toBe(12);
    a.injectValue(4095); // full-scale on 12-bit
    expect(a.readVoltage()).toBeCloseTo(3.3, 5);
  });

  it('returns SimAnalogPin instances', () => {
    expect(board.analog(0)).toBeInstanceOf(SimAnalogPin);
  });
});
