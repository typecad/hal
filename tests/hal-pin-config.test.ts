// ---------------------------------------------------------------------------
// HAL Pin Configuration Tests
//
// Tests for direct pin configuration APIs (output, input, inputPullUp, pwm)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Pin Config - Digital Output', () => {
  it('transpiles D13.output()', () => {
    const result = transpile(`
      import { D13 } from '@typecode/board-arduino-uno';
      D13.output();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
  });

  it('transpiles D13.output(true)', () => {
    const result = transpile(`
      import { D13 } from '@typecode/board-arduino-uno';
      D13.output(true);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, true)');
  });

  it('transpiles D13.output(false)', () => {
    const result = transpile(`
      import { D13 } from '@typecode/board-arduino-uno';
      D13.output(false);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, false)');
  });

  it('transpiles LED.output(true)', () => {
    const result = transpile(`
      import { LED } from '@typecode/board-arduino-uno';
      LED.output(true);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, true)');
  });
});

describe('Pin Config - Digital Input', () => {
  it('transpiles D2.input()', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.input();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(2, INPUT)');
  });

  it('transpiles D2.inputPullUp()', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.inputPullUp();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(2, INPUT_PULLUP)');
  });

  it('errors on D2.inputPullDown() on boards without pulldown support', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.inputPullDown();
    `, { target: 'arduino' });

    // Arduino Uno (AVR) has no hardware pulldown — should produce a compile error
    expect(result.diagnostics?.some(d => d.code === 'pulldown-not-supported')).toBe(true);
  });
});

describe('Pin Config - PWM', () => {
  it('transpiles D9.pwm()', () => {
    const result = transpile(`
      import { D9 } from '@typecode/board-arduino-uno';
      D9.pwm();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(9, OUTPUT)');
  });

  it('transpiles D9.pwm(50)', () => {
    const result = transpile(`
      import { D9 } from '@typecode/board-arduino-uno';
      D9.pwm(50);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(9, OUTPUT)');
    expect(result.cpp).toContain('analogWrite(9');
  });

  it('transpiles D3.pwm(100)', () => {
    const result = transpile(`
      import { D3 } from '@typecode/board-arduino-uno';
      D3.pwm(100);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(3, OUTPUT)');
    expect(result.cpp).toContain('analogWrite(3');
  });
});

describe('Pin Config - Interrupt Attach', () => {
  it('transpiles D2.onFalling(callback)', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.onFalling(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).toContain('attachInterrupt');
    expect(result.cpp).toContain('digitalPinToInterrupt(2)');
    expect(result.cpp).toContain('FALLING');
  });

  it('transpiles D2.onRising(callback)', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.onRising(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).toContain('attachInterrupt');
    expect(result.cpp).toContain('digitalPinToInterrupt(2)');
    expect(result.cpp).toContain('RISING');
  });

  it('transpiles D2.onChange(callback)', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.onChange(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).toContain('attachInterrupt');
    expect(result.cpp).toContain('CHANGE');
  });
});

describe('Pin Config - Interrupt Detach', () => {
  it('transpiles D2.offAll()', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.offAll();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('detachInterrupt');
    expect(result.cpp).toContain('digitalPinToInterrupt(2)');
  });
});

describe('Pin Config - Combined Usage', () => {
  it('transpiles multiple pin configs in sequence', () => {
    const result = transpile(`
      import { D13, D2, D9 } from '@typecode/board-arduino-uno';
      D13.output(true);
      D2.inputPullUp();
      D9.pwm(50);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, true)');
    expect(result.cpp).toContain('pinMode(2, INPUT_PULLUP)');
    expect(result.cpp).toContain('pinMode(9, OUTPUT)');
    expect(result.cpp).toContain('analogWrite(9');
  });
});