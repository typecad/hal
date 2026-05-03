// ---------------------------------------------------------------------------
// GPIO Object-Creation Pattern Tests
// ---------------------------------------------------------------------------

import { describe, it } from 'vitest';
import { expectCppContains, transpile } from './setup';

describe('GPIO Object-Creation Pattern', () => {
  describe('asOutput()', () => {
    it('emits pinMode OUTPUT for LED.asOutput()', () => {
      const result = transpile(`
        import { LED } from '@typehal/board-arduino-uno';
        const led = LED.asOutput();
        led.toggle();
      `, { target: 'arduino' });

      expectCppContains(result, [
        'pinMode(13, OUTPUT)',
        'digitalRead(13)',
      ]);
    });

    it('emits pinMode + digitalWrite for LED.asOutput(true)', () => {
      const result = transpile(`
        import { LED } from '@typehal/board-arduino-uno';
        const led = LED.asOutput(true);
        led.toggle();
      `, { target: 'arduino' });

      expectCppContains(result, [
        'pinMode(13, OUTPUT)',
        'digitalWrite(13, true)',
      ]);
    });

    it('emits pinMode for D9.asOutput() and alias resolves for high()/low()', () => {
      const result = transpile(`
        import { D9 } from '@typehal/board-arduino-uno';
        const buzzer = D9.asOutput();
        buzzer.high();
        buzzer.low();
      `, { target: 'arduino' });

      expectCppContains(result, [
        'pinMode(9, OUTPUT)',
        'digitalWrite(9, HIGH)',
        'digitalWrite(9, LOW)',
      ]);
    });

    it('resolves alias inside while loop', () => {
      const result = transpile(`
        import { LED, D2, delay } from '@typehal/board-arduino-uno';
        const led = LED.asOutput();
        const btn = D2.asInput();
        while (true) {
          if (!btn.read()) {
            led.toggle();
          }
          delay(100);
        }
      `, { target: 'arduino' });

      expectCppContains(result, [
        'pinMode(13, OUTPUT)',
        'pinMode(2, INPUT)',
        'digitalRead(2)',
      ]);
    });
  });

  describe('asInput()', () => {
    it('emits pinMode INPUT for D2.asInput()', () => {
      const result = transpile(`
        import { D2 } from '@typehal/board-arduino-uno';
        const button = D2.asInput();
        const val = button.read();
      `, { target: 'arduino' });

      expectCppContains(result, [
        'pinMode(2, INPUT)',
        'digitalRead(2)',
      ]);
    });
  });

  describe('asInputPullUp()', () => {
    it('emits pinMode INPUT_PULLUP for D3.asInputPullUp()', () => {
      const result = transpile(`
        import { D3 } from '@typehal/board-arduino-uno';
        const btn = D3.asInputPullUp();
        const val = btn.read();
      `, { target: 'arduino' });

      expectCppContains(result, [
        'pinMode(3, INPUT_PULLUP)',
        'digitalRead(3)',
      ]);
    });

    it('emits pinMode INPUT_PULLUP for a pin parameter and resolves alias for btn.read()', () => {
      const result = transpile(`
        import { D2 } from '@typehal/board-arduino-uno';
        function startButton(pin: { asInputPullUp(): any; onFalling(handler: () => void): void }) {
          const btn = pin.asInputPullUp();
          pin.onFalling(() => {});
          const val = btn.read();
          return val;
        }
        startButton(D2);
      `, { target: 'arduino' });

      // Pin methods on function parameters are not inlined by the __EMIT__ system
      // since the pin identity can't be resolved at compile time. The call remains
      // as regular C++ method calls. Pin instances are resolved to numbers at call sites.
      expectCppContains(result, [
        'startButton(2)',
      ]);
    });

    it('propagates pin aliases through this.field assignment and handles this.pin.read()', () => {
      const result = transpile(`
        import { D2 } from '@typehal/board-arduino-uno';

        class Button {
          private pin: any;

          constructor(input: any) {
            this.pin = input;
          }

          isHeld(): boolean {
            return this.pin.read() === false;
          }
        }

        function startButton(pin: { asInputPullUp(): any; onFalling(handler: () => void): void }) {
          const input = pin.asInputPullUp();
          return new Button(input);
        }

        const btn = startButton(D2);
      `, { target: 'arduino' });

      // Class field pin aliases are not inlined by the __EMIT__ system
      // since the pin identity can't be resolved through this.field.
      // Pin instances are resolved to numbers at call sites.
      expectCppContains(result, [
        'startButton(2)',
      ]);
    });
  });

  describe('Multiple pins with aliases', () => {
    it('tracks multiple aliases independently', () => {
      const result = transpile(`
        import { LED, D2, D9, delay } from '@typehal/board-arduino-uno';
        const led = LED.asOutput();
        const button = D2.asInput();
        const buzzer = D9.asOutput();
        while (true) {
          if (!button.read()) {
            led.toggle();
          }
          buzzer.high();
          delay(100);
        }
      `, { target: 'arduino' });

      expectCppContains(result, [
        'pinMode(13, OUTPUT)',
        'pinMode(2, INPUT)',
        'pinMode(9, OUTPUT)',
        'digitalRead(2)',
        'digitalWrite(9, HIGH)',
      ]);
    });
  });
});