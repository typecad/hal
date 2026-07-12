// ---------------------------------------------------------------------------
// Simulator package — contracts (capability guards) and result helpers
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  SimDigitalPin,
  SimPWMPin,
  SimAnalogPin,
  SimInterruptPin,
  hasPWM,
  hasAnalogInput,
  hasInterrupt,
  assertPWM,
  assertAnalog,
  assertInterrupt,
  createByteReadResult,
  createWriteResult,
} from '../../../packages/simulator/src/index';

// ===========================================================================
// Capability type guards and assertions (contracts.ts)
// ===========================================================================

describe('capability guards', () => {
  it('hasPWM is true only for PWM pins', () => {
    expect(hasPWM(new SimPWMPin(9))).toBe(true);
    expect(hasPWM(new SimDigitalPin(2))).toBe(false);
    expect(hasPWM(new SimAnalogPin(0))).toBe(false);
  });

  it('hasAnalogInput is true only for analog pins', () => {
    expect(hasAnalogInput(new SimAnalogPin(0))).toBe(true);
    expect(hasAnalogInput(new SimDigitalPin(2))).toBe(false);
    expect(hasAnalogInput(new SimPWMPin(9))).toBe(false);
  });

  it('hasInterrupt is true only for interrupt pins', () => {
    expect(hasInterrupt(new SimInterruptPin(2))).toBe(true);
    expect(hasInterrupt(new SimDigitalPin(2))).toBe(false);
    expect(hasInterrupt(new SimPWMPin(9))).toBe(false);
  });

  it('guards return false for non-pin values', () => {
    expect(hasPWM(null)).toBe(false);
    expect(hasPWM(undefined)).toBe(false);
    expect(hasPWM({})).toBe(false);
    expect(hasPWM({ number: 1 })).toBe(false); // missing gpio
    expect(hasAnalogInput(42)).toBe(false);
    expect(hasInterrupt('x')).toBe(false);
  });
});

describe('capability assertions', () => {
  it('assertPWM passes for a PWM pin and narrows the type', () => {
    const pin = new SimPWMPin(9);
    assertPWM(pin);
    // After assertion, pin is narrowed to PWMPin
    pin.pwm(50);
    expect(pin.getPwmPercent()).toBe(50);
  });

  it('assertPWM throws with default and custom messages', () => {
    const pin = new SimDigitalPin(2);
    expect(() => assertPWM(pin)).toThrow('Pin does not support PWM');
    expect(() => assertPWM(pin, 'not a pwm pin')).toThrow('not a pwm pin');
  });

  it('assertAnalog throws for a non-analog pin', () => {
    const pin = new SimDigitalPin(2);
    expect(() => assertAnalog(pin)).toThrow('Pin does not support analog input');
    // Passes for a real analog pin
    const a = new SimAnalogPin(0);
    expect(() => assertAnalog(a)).not.toThrow();
  });

  it('assertInterrupt throws for a non-interrupt pin', () => {
    const pin = new SimDigitalPin(2);
    expect(() => assertInterrupt(pin)).toThrow('Pin does not support interrupts');
    // Passes for a real interrupt pin
    const i = new SimInterruptPin(3);
    expect(() => assertInterrupt(i)).not.toThrow();
  });
});

// ===========================================================================
// createByteReadResult (helpers.ts)
// ===========================================================================

describe('createByteReadResult — integer conversions', () => {
  it('asUint8 reads the first byte', () => {
    expect(createByteReadResult(new Uint8Array([0xAB])).asUint8()).toBe(0xAB);
    expect(createByteReadResult(new Uint8Array([])).asUint8()).toBe(0);
  });

  it('asInt8 sign-extends values above 127', () => {
    expect(createByteReadResult(new Uint8Array([0x7F])).asInt8()).toBe(127);
    expect(createByteReadResult(new Uint8Array([0x80])).asInt8()).toBe(-128);
    expect(createByteReadResult(new Uint8Array([0xFF])).asInt8()).toBe(-1);
  });

  it('asUint16 reads big- and little-endian', () => {
    const r = createByteReadResult(new Uint8Array([0x01, 0x02]));
    expect(r.asUint16('be')).toBe(0x0102);
    expect(r.asUint16('le')).toBe(0x0201);
  });

  it('asUint16 returns 0 for short buffers', () => {
    expect(createByteReadResult(new Uint8Array([0x01])).asUint16('be')).toBe(0);
  });

  it('asInt16 sign-extends above 0x7FFF', () => {
    expect(createByteReadResult(new Uint8Array([0xFF, 0xFF])).asInt16('be')).toBe(-1);
    expect(createByteReadResult(new Uint8Array([0x80, 0x00])).asInt16('be')).toBe(-32768);
    expect(createByteReadResult(new Uint8Array([0x7F, 0xFF])).asInt16('be')).toBe(32767);
  });

  it('asUint32 reads big- and little-endian', () => {
    const r = createByteReadResult(new Uint8Array([0x12, 0x34, 0x56, 0x78]));
    expect(r.asUint32('be')).toBe(0x12345678);
    expect(r.asUint32('le')).toBe(0x78563412);
  });

  it('asUint32 returns 0 for short buffers', () => {
    expect(createByteReadResult(new Uint8Array([1, 2, 3])).asUint32('be')).toBe(0);
  });

  it('asInt32 sign-extends above 0x7FFFFFFF', () => {
    expect(createByteReadResult(new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF])).asInt32('be')).toBe(-1);
    expect(createByteReadResult(new Uint8Array([0x80, 0x00, 0x00, 0x00])).asInt32('be')).toBe(-2147483648);
    expect(createByteReadResult(new Uint8Array([0x7F, 0xFF, 0xFF, 0xFF])).asInt32('be')).toBe(2147483647);
  });
});

describe('createByteReadResult — string and accessors', () => {
  it('asString / asStringTrim decode UTF-8', () => {
    const r = createByteReadResult(new Uint8Array([0x68, 0x69, 0x20, 0x20]));
    expect(r.asString()).toBe('hi  ');
    expect(r.asStringTrim()).toBe('hi');
  });

  it('asInt parses leading integer text', () => {
    expect(createByteReadResult(new Uint8Array([0x31, 0x32, 0x33])).asInt()).toBe(123);
    expect(createByteReadResult(new Uint8Array([0x61, 0x62])).asInt()).toBe(0); // 'ab' → NaN → 0
  });

  it('asFloat parses numeric text', () => {
    expect(createByteReadResult(new Uint8Array([0x31, 0x2E, 0x35])).asFloat()).toBe(1.5);
  });

  it('unwrap returns the raw bytes; bytesRead matches length', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const r = createByteReadResult(bytes);
    expect(r.unwrap()).toBe(bytes);
    expect(r.bytesRead).toBe(3);
  });

  it('unwrapOr returns bytes when ok, default otherwise', () => {
    const bytes = new Uint8Array([1]);
    const fallback = new Uint8Array([9]);
    expect(createByteReadResult(bytes, true).unwrapOr(fallback)).toBe(bytes);
    expect(createByteReadResult(bytes, false).unwrapOr(fallback)).toBe(fallback);
  });

  it('carries status, ok, and timedOut flags', () => {
    const r = createByteReadResult(new Uint8Array([1]), false, 5, true);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(5);
    expect(r.timedOut).toBe(true);
  });
});

// ===========================================================================
// createWriteResult (helpers.ts)
// ===========================================================================

describe('createWriteResult', () => {
  it('unwrap returns the bytesWritten count', () => {
    expect(createWriteResult(42).unwrap()).toBe(42);
  });

  it('unwrapOr returns count when ok, default otherwise', () => {
    expect(createWriteResult(7, true).unwrapOr(99)).toBe(7);
    expect(createWriteResult(7, false).unwrapOr(99)).toBe(99);
  });

  it('carries ok and status flags', () => {
    const r = createWriteResult(3, false, 2);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(2);
    expect(r.bytesWritten).toBe(3);
  });
});
