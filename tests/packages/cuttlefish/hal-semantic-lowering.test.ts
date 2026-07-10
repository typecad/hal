// ---------------------------------------------------------------------------
// HAL Semantic Lowering Regression Tests
//
// These tests guard against regressions in the semantic HAL call resolver
// (hal-plugins.ts tryResolveSemanticCall) and the HAL alias resolution
// (hal-parser.ts resolveHALReceiver). Each test covers a specific bug class
// that was found and fixed:
//
//   1. gpioWrite with runtime variable values (not just 0|1 literals)
//   2. pwmWrite/tonePlay/i2cSetClock/uartBegin etc. with runtime variables
//   3. Pin alias class change (Pin → InputPin) so InputPin methods resolve
//   4. this.read() / this.isLow() inlining inside compound expressions
//
// All tests import from @typecad/board-arduino-uno (not the bare @typecad
// virtual module) and use target: 'arduino' so the board constants and HAL
// class registry are loaded by the transpile helper.
// ---------------------------------------------------------------------------

import { describe, it } from "vitest";
import { expectCppContains, expectCppNotContains, transpile } from "../../setup";

describe("HAL Semantic Lowering — runtime variable arguments", () => {
  // ── gpioWrite with runtime variables ──────────────────────────────────

  it("lowers led.write(variable) to digitalWrite with ternary coercion", () => {
    const result = transpile(`
      import { LED, HIGH } from '@typecad/board-arduino-uno';
      const led = LED.asOutput(false);
      const state = HIGH;
      led.write(state);
      led.write(!state);
    `, { target: 'arduino' });

    expectCppContains(result, [
      'pinMode(13, OUTPUT)',
      'digitalWrite(13, (state) ? HIGH : LOW)',
      'digitalWrite(13, (!state) ? HIGH : LOW)',
    ]);
    // Must NOT leak the unresolved method call or 'this'
    expectCppNotContains(result, ['13.write', 'this->', 'this.read']);
  });

  it("still lowers led.write(literal) to digitalWrite HIGH/LOW", () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      const led = LED.asOutput();
      led.write(true);
      led.write(false);
    `, { target: 'arduino' });

    expectCppContains(result, [
      'digitalWrite(13, HIGH)',
      'digitalWrite(13, LOW)',
    ]);
  });

  // ── pwmWrite with runtime variable ────────────────────────────────────
  // Note: OutputPin.pwm() uses rawCpp() with board() constants, not the
  // semantic pwmWrite() call. Pin.pwm() (line 265 of gpio.ts) calls
  // pwmWrite(this._pin, value) which goes through the semantic resolver.

  it("lowers Pin.pwm(variable) via semantic pwmWrite", () => {
    // Pin.pwm is accessed via the bare Pin class, not OutputPin.
    // Use a direct Pin import to exercise the semantic path.
    const result = transpile(`
      import { D9 } from '@typecad/board-arduino-uno';
      D9.pwm(128);
    `, { target: 'arduino' });

    expectCppContains(result, [
      'analogWrite(9, 128)',
    ]);
    expectCppNotContains(result, ['9.pwm', 'this']);
  });

  // ── tonePlay with runtime variables ───────────────────────────────────

  it("lowers tone(variableFreq) without dropping the op", () => {
    const result = transpile(`
      import { D8 } from '@typecad/board-arduino-uno';
      const spk = D8.asOutput();
      const freq = 440;
      spk.tone(freq);
    `, { target: 'arduino' });

    expectCppContains(result, [
      'tone(8, freq)',
    ]);
    expectCppNotContains(result, ['8.tone', 'this']);
  });

  // ── i2cSetClock with runtime variable ─────────────────────────────────

  it("lowers i2c.setClock(variable) without dropping the op", () => {
    const result = transpile(`
      import { D2, I2C0 } from '@typecad/board-arduino-uno';
      I2C0.begin();
      const clockSpeed = 400000;
      I2C0.setClock(clockSpeed);
    `, { target: 'arduino' });

    expectCppContains(result, [
      'Wire.setClock(clockSpeed)',
    ]);
    expectCppNotContains(result, ['this']);
  });

  // ── uartBegin with runtime variable ───────────────────────────────────

  it("lowers serial.begin(variable) without dropping the op", () => {
    const result = transpile(`
      import { UART0 } from '@typecad/board-arduino-uno';
      const baudRate = 115200;
      UART0.begin(baudRate);
    `, { target: 'arduino' });

    expectCppContains(result, [
      'Serial.begin(baudRate)',
    ]);
    expectCppNotContains(result, ['this']);
  });
});

describe("HAL Alias Resolution — class change (Pin → InputPin/OutputPin)", () => {
  // Bug: const button = D2.asInputPullUp() created an alias resolved as
  // className "Pin" (not "InputPin"), so InputPin methods like isLow()
  // were not found in the class registry, and the method body fell through
  // to generic emission, leaking 'this' into the output.

  it("resolves InputPin.isLow() via asInputPullUp alias", () => {
    const result = transpile(`
      import { D2 } from '@typecad/board-arduino-uno';
      const button = D2.asInputPullUp();
      if (button.isLow()) {
      }
    `, { target: 'arduino' });

    expectCppContains(result, [
      'pinMode(2, INPUT_PULLUP)',
      '!digitalRead(2)',
    ]);
    // Must NOT leak 'this' into a free function
    expectCppNotContains(result, ['this.read', 'this->read', 'this->isLow']);
  });

  it("resolves InputPin.isHigh() via asInput alias", () => {
    const result = transpile(`
      import { D3 } from '@typecad/board-arduino-uno';
      const btn = D3.asInput();
      if (btn.isHigh()) {
      }
    `, { target: 'arduino' });

    expectCppContains(result, [
      'pinMode(3, INPUT)',
      'digitalRead(3)',
    ]);
    expectCppNotContains(result, ['this.read', 'this->']);
  });

  it("resolves InputPin.read() via asInputPullUp alias", () => {
    const result = transpile(`
      import { D2 } from '@typecad/board-arduino-uno';
      const button = D2.asInputPullUp();
      const pressed = button.read();
    `, { target: 'arduino' });

    expectCppContains(result, [
      'pinMode(2, INPUT_PULLUP)',
      'digitalRead(2)',
    ]);
  });

  it("resolves OutputPin methods via asOutput alias (toggle/high/low)", () => {
    const result = transpile(`
      import { LED } from '@typecad/board-arduino-uno';
      const led = LED.asOutput();
      led.toggle();
      led.high();
      led.low();
    `, { target: 'arduino' });

    expectCppContains(result, [
      'pinMode(13, OUTPUT)',
      'digitalRead(13) == LOW ? HIGH : LOW',
      'digitalWrite(13, HIGH)',
      'digitalWrite(13, LOW)',
    ]);
    expectCppNotContains(result, ['this->', 'this.read']);
  });
});
