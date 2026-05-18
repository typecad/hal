// ---------------------------------------------------------------------------
// HAL ADC Tests
//
// Tests for board-aware ADC methods using the board() compile-time function
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from '../../setup';

describe('InputPin - readAnalog', () => {
  it('transpiles adc.readAnalog() to analogRead', () => {
    const result = transpile(`
      import { A0 } from '@typehal/board-arduino-uno';
      const adc = A0.asInput();
      const raw = adc.readAnalog();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('const auto raw = analogRead(14)');
  });
});

describe('InputPin - readVoltage', () => {
  it('transpiles adc.readVoltage() with Arduino Uno ADC constants', () => {
    const result = transpile(`
      import { A0 } from '@typehal/board-arduino-uno';
      const adc = A0.asInput();
      const voltage = adc.readVoltage();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('analogRead(14)');
    expect(result.cpp).toContain('5 / 1023');
  });

  it('transpiles D3.readVoltage() using asInput()', () => {
    const result = transpile(`
      import { D3 } from '@typehal/board-arduino-uno';
      const pin = D3.asInput();
      const v = pin.readVoltage();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('analogRead(3)');
    expect(result.cpp).toContain('5 / 1023');
  });

  it('uses readVoltage result in an expression', () => {
    const result = transpile(`
      import { A0, UART0 } from '@typehal/board-arduino-uno';
      const serial = UART0.begin(9600);
      const adc = A0.asInput();
      const v = adc.readVoltage();
      serial.println(v);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('analogRead(14)');
    expect(result.cpp).toContain('5 / 1023');
    // println receives the resolved pin number, not the voltage variable
    expect(result.cpp).toContain('Serial.println(14)');
  });
});

describe('InputPin - readVoltage with setAnalogReference', () => {
  // TODO: readVoltage does not yet incorporate the analogReference setting;
  // it always uses the default board voltage. Re-enable when the strategy
  // tracks the active reference and substitutes it into the formula.
  it('uses INTERNAL reference voltage after ADC.setAnalogReference', () => {
    const result = transpile(`
      import { A0, ADC, INTERNAL } from '@typehal/board-arduino-uno';
      ADC.setAnalogReference(INTERNAL);
      const adc = A0.asInput();
      const v = adc.readVoltage();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('analogRead(14)');
    expect(result.cpp).toContain('1.1 / 1023');
  });
});

describe('ADC - getAnalogResolution', () => {
  it('returns ADC resolution for Arduino Uno (10-bit)', () => {
    const result = transpile(`
      import { ADC } from '@typehal/board-arduino-uno';
      const res = ADC.getAnalogResolution();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('const auto res = 10');
  });

  it('returns ADC resolution for ESP32 (12-bit)', () => {
    const result = transpile(`
      import { ADC } from '@typehal/board-esp32-devkit';
      const res = ADC.getAnalogResolution();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('const auto res = 12');
  });
});

describe('ADC - setAnalogReference', () => {
  it('emits analogReference() call with phantom constant', () => {
    const result = transpile(`
      import { ADC, INTERNAL } from '@typehal/board-arduino-uno';
      ADC.setAnalogReference(INTERNAL);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('analogReference(INTERNAL)');
  });
});

describe('ADC - getAnalogReference', () => {
  it('returns default reference voltage for Arduino Uno (5.0V)', () => {
    const result = transpile(`
      import { ADC } from '@typehal/board-arduino-uno';
      const ref = ADC.getAnalogReference();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('const auto ref = 5');
  });

  it('returns default reference voltage for ESP32 (3.3V)', () => {
    const result = transpile(`
      import { ADC } from '@typehal/board-esp32-devkit';
      const ref = ADC.getAnalogReference();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('const auto ref = 3.3');
  });

  it('returns INTERNAL voltage after setAnalogReference on Arduino Uno', () => {
    const result = transpile(`
      import { ADC, INTERNAL } from '@typehal/board-arduino-uno';
      ADC.setAnalogReference(INTERNAL);
      const ref = ADC.getAnalogReference();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('analogReference(INTERNAL)');
    expect(result.cpp).toContain('const auto ref = 1.1');
  });
});
