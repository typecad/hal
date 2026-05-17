// ---------------------------------------------------------------------------
// HAL Pin Configuration Tests
//
// Tests for type-narrowed pin pattern: Pin → OutputPin / InputPin
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { transpile } from '../../setup';

describe('Pin Config - Digital Output', () => {
  it('transpiles D13.asOutput()', () => {
    const result = transpile(`
      import { D13 } from '@typehal/board-arduino-uno';
      D13.asOutput();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
  });

  it('transpiles const led = D13.asOutput(); led.write(true)', () => {
    const result = transpile(`
      import { D13 } from '@typehal/board-arduino-uno';
      const led = D13.asOutput();
      led.write(true);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, HIGH)');
  });

  it('transpiles const led = D13.asOutput(); led.write(false)', () => {
    const result = transpile(`
      import { D13 } from '@typehal/board-arduino-uno';
      const led = D13.asOutput();
      led.write(false);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, LOW)');
  });

  it('transpiles const led = LED.asOutput(); led.high()', () => {
    const result = transpile(`
      import { LED } from '@typehal/board-arduino-uno';
      const led = LED.asOutput();
      led.high();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, HIGH)');
  });
});

describe('Pin Config - Digital Input', () => {
  it('transpiles D2.asInput()', () => {
    const result = transpile(`
      import { D2 } from '@typehal/board-arduino-uno';
      D2.asInput();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(2, INPUT)');
  });

  it('transpiles D2.inputPullUp()', () => {
    const result = transpile(`
      import { D2 } from '@typehal/board-arduino-uno';
      D2.inputPullUp();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(2, INPUT_PULLUP)');
  });

  it('errors on D2.inputPullDown() on boards without pulldown support', () => {
    const result = transpile(`
      import { D2 } from '@typehal/board-arduino-uno';
      D2.inputPullDown();
    `, { target: 'arduino' });

    // Arduino Uno (AVR) has no hardware pulldown — should produce a compile error
    expect(result.diagnostics?.some(d => d.code === 'pulldown-not-supported')).toBe(true);
  });
});

describe('Pin Config - PWM', () => {
  it('transpiles const led = D9.asOutput(); led.pwm(50)', () => {
    const result = transpile(`
      import { D9 } from '@typehal/board-arduino-uno';
      const led = D9.asOutput();
      led.pwm(50);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(9, OUTPUT)');
    expect(result.cpp).toContain('led.pwm(50)');
  });

  it('transpiles const led = D3.asOutput(); led.pwm(100)', () => {
    const result = transpile(`
      import { D3 } from '@typehal/board-arduino-uno';
      const led = D3.asOutput();
      led.pwm(100);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(3, OUTPUT)');
    expect(result.cpp).toContain('led.pwm(100)');
  });
});

describe('Pin Config - Interrupt Attach', () => {
  it('transpiles D2.onFalling(callback)', () => {
    const result = transpile(`
      import { D2 } from '@typehal/board-arduino-uno';
      D2.onFalling(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).toContain('attachInterrupt');
    expect(result.cpp).toContain('digitalPinToInterrupt(2)');
    expect(result.cpp).toContain('FALLING');
  });

  it('emits a named ISR function for D2.onFalling(callback), not a placeholder', () => {
    const result = transpile(`
      import { D2 } from '@typehal/board-arduino-uno';
      D2.onFalling(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).not.toContain('/* callback:');
    expect(result.cpp).toMatch(/attachInterrupt\(digitalPinToInterrupt\(2\),\s*__CALLBACK_\d+__,\s*FALLING\)/);
    expect(result.cpp).toMatch(/void [A-Za-z0-9_]+_isr_\d+\(\)/);
  });

  it('emits a named ISR function with body for D2.onFalling(callback)', () => {
    const result = transpile(`
      import { D2, LED } from '@typehal/board-arduino-uno';
      const led = LED.asOutput();
      let ledState = false;
      D2.onFalling(() => {
        ledState = !ledState;
        if (ledState) { led.high(); } else { led.low(); }
      });
    `, { target: 'arduino' });

    expect(result.cpp).not.toContain('/* callback:');
    expect(result.cpp).toMatch(/void [A-Za-z0-9_]+_isr_\d+\(\)/);
    expect(result.cpp).toMatch(/attachInterrupt\(digitalPinToInterrupt\(2\),\s*__CALLBACK_\d+__,\s*FALLING\)/);
  });

  it('transpiles an interrupt callback capturing a global pointer variable and emits pointer access correctly', () => {
    const result = transpile(`
      import { D2 } from '@typehal/board-arduino-uno';

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
      import { D2 } from '@typehal/board-arduino-uno';
      D2.onRising(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).toContain('attachInterrupt');
    expect(result.cpp).toContain('digitalPinToInterrupt(2)');
    expect(result.cpp).toContain('RISING');
  });

  it('emits a named ISR function for D2.onRising(callback), not a placeholder', () => {
    const result = transpile(`
      import { D2 } from '@typehal/board-arduino-uno';
      D2.onRising(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).not.toContain('/* callback:');
    expect(result.cpp).toMatch(/attachInterrupt\(digitalPinToInterrupt\(2\),\s*__CALLBACK_\d+__,\s*RISING\)/);
    expect(result.cpp).toMatch(/void [A-Za-z0-9_]+_isr_\d+\(\)/);
  });

  it('transpiles D2.onChange(callback)', () => {
    const result = transpile(`
      import { D2 } from '@typehal/board-arduino-uno';
      D2.onChange(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).toContain('attachInterrupt');
    expect(result.cpp).toContain('CHANGE');
  });

  it('emits a named ISR function for D2.onChange(callback), not a placeholder', () => {
    const result = transpile(`
      import { D2 } from '@typehal/board-arduino-uno';
      D2.onChange(() => {});
    `, { target: 'arduino' });

    expect(result.cpp).not.toContain('/* callback:');
    expect(result.cpp).toMatch(/attachInterrupt\(digitalPinToInterrupt\(2\),\s*__CALLBACK_\d+__,\s*CHANGE\)/);
    expect(result.cpp).toMatch(/void [A-Za-z0-9_]+_isr_\d+\(\)/);
  });
});

describe('Pin Config - Interrupt Detach', () => {
  it('transpiles const pin = D2.asInput(); pin.offAll()', () => {
    const result = transpile(`
      import { D2 } from '@typehal/board-arduino-uno';
      const pin = D2.asInput();
      pin.offAll();
    `, { target: 'arduino' });

    expect(result.cpp).toContain('detachInterrupt');
    expect(result.cpp).toContain('digitalPinToInterrupt(2)');
  });
});

describe('Pin Config - Combined Usage', () => {
  it('transpiles multiple pin configs in sequence', () => {
    const result = transpile(`
      import { D13, D2, D9 } from '@typehal/board-arduino-uno';
      const led = D13.asOutput();
      led.write(true);
      const btn = D2.asInputPullUp();
      const pwm = D9.asOutput();
      pwm.pwm(50);
    `, { target: 'arduino' });

    expect(result.cpp).toContain('pinMode(13, OUTPUT)');
    expect(result.cpp).toContain('digitalWrite(13, HIGH)');
    expect(result.cpp).toContain('pinMode(2, INPUT_PULLUP)');
    expect(result.cpp).toContain('pinMode(9, OUTPUT)');
    expect(result.cpp).toContain('pwm.pwm(50)');
  });
});
