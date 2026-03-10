// ---------------------------------------------------------------------------
// HAL Pin Configuration Tests
//
// Tests for fluent pin configuration APIs (config.output.initial, etc.)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from './setup';

describe('Pin Config - Digital Output', () => {
  it('transpiles D13.config.output()', () => {
    const result = transpile(`
      import { D13 } from '@typecode/board-arduino-uno';
      D13.config.output();
    `, { target: 'arduino' });
    
    // D13.config.output() -> pinMode(13, OUTPUT)
    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
  });

  it('transpiles D13.config.output.initial(HIGH)', () => {
    const result = transpile(`
      import { D13, HIGH } from '@typecode/board-arduino-uno';
      D13.config.output.initial(HIGH);
    `, { target: 'arduino' });
    
    // D13.config.output.initial(HIGH) -> pinMode(13, OUTPUT); digitalWrite(13, HIGH)
    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, HIGH)');
  });

  it('transpiles D13.config.output.initial(LOW)', () => {
    const result = transpile(`
      import { D13, LOW } from '@typecode/board-arduino-uno';
      D13.config.output.initial(LOW);
    `, { target: 'arduino' });
    
    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, LOW)');
  });

  it('transpiles LED.config.output.initial(HIGH)', () => {
    const result = transpile(`
      import { LED, HIGH } from '@typecode/board-arduino-uno';
      LED.config.output.initial(HIGH);
    `, { target: 'arduino' });
    
    // LED maps to pin 13 on Arduino Uno (from board constants)
    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, HIGH)');
  });
});

describe('Pin Config - Digital Input', () => {
  it('transpiles D2.config.input.pullup()', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.config.input.pullup();
    `, { target: 'arduino' });
    
    // D2.config.input.pullup() -> pinMode(2, INPUT_PULLUP)
    expect(result.cpp).toContain('pinMode(2, INPUT_PULLUP)');
  });

  it('transpiles D2.config.input.float()', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.config.input.float();
    `, { target: 'arduino' });
    
    // D2.config.input.float() -> pinMode(2, INPUT)
    expect(result.cpp).toContain('pinMode(2, INPUT)');
  });

  it('transpiles D2.config.input.pulldown()', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.config.input.pulldown();
    `, { target: 'arduino' });
    
    // AVR has no pulldown, falls back to INPUT
    expect(result.cpp).toContain('pinMode(2, INPUT)');
  });
});

describe('Pin Config - PWM', () => {
  it('transpiles D9.config.pwm()', () => {
    const result = transpile(`
      import { D9 } from '@typecode/board-arduino-uno';
      D9.config.pwm();
    `, { target: 'arduino' });
    
    // D9.config.pwm() -> pinMode(9, OUTPUT)
    expect(result.cpp).toContain('pinMode(9, OUTPUT)');
  });

  it('transpiles D9.config.pwm.initial(50)', () => {
    const result = transpile(`
      import { D9 } from '@typecode/board-arduino-uno';
      D9.config.pwm.initial(50);
    `, { target: 'arduino' });
    
    // D9.config.pwm.initial(50) -> pinMode(9, OUTPUT); analogWrite(9, 127)
    // 50% = (50 * 255 / 100) = 127
    expect(result.cpp).toContain('pinMode(9, OUTPUT)');
    expect(result.cpp).toContain('analogWrite(9');
  });

  it('transpiles D3.config.pwm.initial(100)', () => {
    const result = transpile(`
      import { D3 } from '@typecode/board-arduino-uno';
      D3.config.pwm.initial(100);
    `, { target: 'arduino' });
    
    // 100% duty cycle
    expect(result.cpp).toContain('pinMode(3, OUTPUT)');
    expect(result.cpp).toContain('analogWrite(3');
  });
});

describe('Pin Config - Analog Input', () => {
  it('transpiles A0.config.analog()', () => {
    const result = transpile(`
      import { A0 } from '@typecode/board-arduino-uno';
      A0.config.analog();
    `, { target: 'arduino' });
    
    // A0.config.analog() -> pinMode(A0, INPUT)
    expect(result.cpp).toContain('pinMode(A0, INPUT)');
  });

  it('transpiles A1.config.analog()', () => {
    const result = transpile(`
      import { A1 } from '@typecode/board-arduino-uno';
      A1.config.analog();
    `, { target: 'arduino' });
    
    expect(result.cpp).toContain('pinMode(A1, INPUT)');
  });
});

describe('Pin Config - Interrupt Attach', () => {
  it('transpiles D2.on.falling(callback)', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.on.falling(() => {});
    `, { target: 'arduino' });
    
    // D2.on.falling(callback) -> attachInterrupt(digitalPinToInterrupt(2), callback, FALLING)
    expect(result.cpp).toContain('attachInterrupt');
    expect(result.cpp).toContain('digitalPinToInterrupt(2)');
    expect(result.cpp).toContain('FALLING');
  });

  it('transpiles D3.on.rising(callback)', () => {
    const result = transpile(`
      import { D3 } from '@typecode/board-arduino-uno';
      D3.on.rising(() => {});
    `, { target: 'arduino' });
    
    expect(result.cpp).toContain('attachInterrupt');
    expect(result.cpp).toContain('digitalPinToInterrupt(3)');
    expect(result.cpp).toContain('RISING');
  });

  it('transpiles D2.on.change(callback)', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.on.change(() => {});
    `, { target: 'arduino' });
    
    expect(result.cpp).toContain('attachInterrupt');
    expect(result.cpp).toContain('CHANGE');
  });
});

describe('Pin Config - Interrupt Detach', () => {
  it('transpiles D2.off.all()', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.off.all();
    `, { target: 'arduino' });
    
    // D2.off.all() -> detachInterrupt(digitalPinToInterrupt(2))
    expect(result.cpp).toContain('detachInterrupt');
    expect(result.cpp).toContain('digitalPinToInterrupt(2)');
  });
});

describe('Pin Config - Combined Usage', () => {
  it('transpiles multiple pin configs in sequence', () => {
    const result = transpile(`
      import { D13, D2, D9, A0, HIGH } from '@typecode/board-arduino-uno';
      D13.config.output.initial(HIGH);
      D2.config.input.pullup();
      D9.config.pwm.initial(50);
      A0.config.analog();
    `, { target: 'arduino' });
    
    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, HIGH)');
    expect(result.cpp).toContain('pinMode(2, INPUT_PULLUP)');
    expect(result.cpp).toContain('pinMode(9, OUTPUT)');
    expect(result.cpp).toContain('analogWrite(9');
    expect(result.cpp).toContain('pinMode(A0, INPUT)');
  });
});
