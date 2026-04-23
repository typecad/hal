// ---------------------------------------------------------------------------
// HAL Pin Configuration Tests
//
// Tests for direct pin configuration APIs (asOutput, asInput, inputPullUp, pwm)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from '../../setup';

describe('Pin Config - Digital Output', () => {
  it('transpiles D13.asOutput()', () => {
    const result = transpile(`
      import { D13 } from '@typecode/board-arduino-uno';
      D13.asOutput();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
  });

  it('transpiles D13.asOutput(true)', () => {
    const result = transpile(`
      import { D13 } from '@typecode/board-arduino-uno';
      D13.asOutput(true);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, true)');
  });

  it('transpiles D13.asOutput(false)', () => {
    const result = transpile(`
      import { D13 } from '@typecode/board-arduino-uno';
      D13.asOutput(false);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, false)');
  });

  it('transpiles LED.asOutput(true)', () => {
    const result = transpile(`
      import { LED } from '@typecode/board-arduino-uno';
      LED.asOutput(true);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, true)');
  });
});

describe('Pin Config - Digital Input', () => {
  it('transpiles D2.asInput()', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.asInput();
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
    // Literal percent should be pre-computed: Math.round(50 * 255 / 100) = 128
    expect(result.cpp).toContain('analogWrite(9, 128)');
  });

  it('transpiles D3.pwm(100)', () => {
    const result = transpile(`
      import { D3 } from '@typecode/board-arduino-uno';
      D3.pwm(100);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(3, OUTPUT)');
    expect(result.cpp).toContain('analogWrite(3, 255)');
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

  it('emits a named ISR function for D2.onFalling(callback), not a placeholder', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.onFalling(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).not.toContain('/* callback:');
    expect(result.cpp).toMatch(/attachInterrupt\(digitalPinToInterrupt\(2\),\s*[A-Za-z0-9_]+_isr_\d+,\s*FALLING\)/);
    expect(result.cpp).toMatch(/void [A-Za-z0-9_]+_isr_\d+\(\)/);
  });

  it('emits a named ISR function with body for D2.onFalling(callback)', () => {
    const result = transpile(`
      import { D2, LED } from '@typecode/board-arduino-uno';
      const led = LED.asOutput(false);
      let ledState = false;
      D2.onFalling(() => {
        ledState = !ledState;
        if (ledState) { led.high(); } else { led.low(); }
      });
    `, { target: 'arduino' });

    expect(result.cpp).not.toContain('/* callback:');
    expect(result.cpp).toMatch(/void [A-Za-z0-9_]+_isr_\d+\(\)/);
    expect(result.cpp).toMatch(/attachInterrupt\(digitalPinToInterrupt\(2\),\s*[A-Za-z0-9_]+_isr_\d+,\s*FALLING\)/);
  });

  it('transpiles an interrupt callback capturing a global pointer variable and emits pointer access correctly', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';

      type Handler = () => void;

      class Button {
        private lastPress = 0;
        private handler: Handler | null = null;

        static start(pin: { asInputPullUp(): any; onFalling(handler: () => void): void }): Button {
          const btn = new Button();
          pin.onFalling(() => {
            btn.lastPress = 1;
            if (btn.handler !== null) {
              btn.handler();
            }
          });
          return btn;
        }

        onPress(handler: Handler): this {
          this.handler = handler;
          return this;
        }
      }

      const btn = Button.start(D2).onPress(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).not.toContain('btn.handler');
    expect(result.cpp).toContain('btn->lastPress');
    expect(result.cpp).toContain('btn->handler');
    expect(result.cpp).toMatch(/friend void [A-Za-z0-9_]+_isr_\d+\(\);/);
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

  it('emits a named ISR function for D2.onRising(callback), not a placeholder', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.onRising(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).not.toContain('/* callback:');
    expect(result.cpp).toMatch(/attachInterrupt\(digitalPinToInterrupt\(2\),\s*[A-Za-z0-9_]+_isr_\d+,\s*RISING\)/);
    expect(result.cpp).toMatch(/void [A-Za-z0-9_]+_isr_\d+\(\)/);
  });

  it('transpiles D2.onChange(callback)', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.onChange(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).toContain('attachInterrupt');
    expect(result.cpp).toContain('CHANGE');
  });

  it('emits a named ISR function for D2.onChange(callback), not a placeholder', () => {
    const result = transpile(`
      import { D2 } from '@typecode/board-arduino-uno';
      D2.onChange(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).not.toContain('/* callback:');
    expect(result.cpp).toMatch(/attachInterrupt\(digitalPinToInterrupt\(2\),\s*[A-Za-z0-9_]+_isr_\d+,\s*CHANGE\)/);
    expect(result.cpp).toMatch(/void [A-Za-z0-9_]+_isr_\d+\(\)/);
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

    expect(result.cpp).toContain('D13.output(true)');
    expect(result.cpp).toContain('pinMode(2, INPUT_PULLUP)');
    expect(result.cpp).toContain('pinMode(9, OUTPUT)');
    expect(result.cpp).toContain('analogWrite(9, 128)');
  });
});